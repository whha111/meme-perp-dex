/**
 * Mini Market Maker — lightweight price movement generator
 * Uses deployer wallet directly, minimal ETH (~0.1 ETH total)
 * Purpose: Demonstrate real-time WSS price updates
 *
 * Usage: cd scripts && npx tsx mini-market-maker.ts
 */

import {
  createPublicClient,
  createWalletClient,
  http,
  parseEther,
  formatEther,
  erc20Abi,
  maxUint256,
  type Address,
  type Hex,
} from "viem";
import { privateKeyToAccount, generatePrivateKey } from "viem/accounts";
import { baseSepolia } from "viem/chains";

const RPC_URL = "https://sepolia.base.org";
const CHAIN_ID = 84532;

// AUDIT-FIX DP-C01: Read key from env
const DEPLOYER_KEY = (process.env.DEPLOYER_PRIVATE_KEY || process.env.PRIVATE_KEY) as Hex;
if (!DEPLOYER_KEY) { console.error("❌ Set DEPLOYER_PRIVATE_KEY env var"); process.exit(1); }
const TOKEN_FACTORY = "0x757eF02C2233b8cE2161EE65Fb7D626776b8CB73" as Address;

const TOKENS: [string, Address][] = [
  ["DOGE", "0x1BC7c612e55b8CC8e24aA4041FAC3732d50C4C6F"],
  ["PEPE", "0x0d0156063c5f805805d5324af69932FB790819D5"],
  ["SHIB", "0x0724863BD88e1F4919c85294149ae87209E917Da"],
];

// Tiny amounts — enough to move bonding curve prices
const BUY_ETH_MIN = 0.001;
const BUY_ETH_MAX = 0.005;
const TRADE_INTERVAL = 2000; // 2 seconds between trades
const WALLET_FUND = "0.08"; // ETH per wallet

const TF_ABI = [
  { inputs: [{ name: "t", type: "address" }, { name: "m", type: "uint256" }], name: "buy", outputs: [], stateMutability: "payable", type: "function" },
  { inputs: [{ name: "t", type: "address" }, { name: "a", type: "uint256" }, { name: "m", type: "uint256" }], name: "sell", outputs: [], stateMutability: "nonpayable", type: "function" },
  { inputs: [{ name: "t", type: "address" }], name: "getCurrentPrice", outputs: [{ type: "uint256" }], stateMutability: "view", type: "function" },
] as const;

const transport = http(RPC_URL, { timeout: 30_000 });
const pub = createPublicClient({ chain: baseSepolia, transport });

const deployer = (() => {
  const acc = privateKeyToAccount(DEPLOYER_KEY);
  return {
    acc,
    addr: acc.address,
    cli: createWalletClient({ account: acc, chain: baseSepolia, transport }),
    nonce: -1,
  };
})();

// 2 trading wallets
const traders: { acc: ReturnType<typeof privateKeyToAccount>; addr: Address; cli: ReturnType<typeof createWalletClient>; nonce: number; holdings: Map<Address, bigint> }[] = [];

const ts = () => new Date().toISOString().split("T")[1].split(".")[0];
const log = (tag: string, msg: string) => console.log(`[${ts()}] [${tag}] ${msg}`);
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
const rand = (a: number, b: number) => a + Math.random() * (b - a);

let nBuy = 0, nSell = 0, nFail = 0;

async function setup() {
  log("SETUP", "🚀 Mini Market Maker — lightweight price mover");

  const bal = await pub.getBalance({ address: deployer.addr });
  log("SETUP", `Deployer: ${formatEther(bal)} ETH`);

  if (bal < parseEther("0.2")) {
    log("SETUP", "❌ Need at least 0.2 ETH. Aborting.");
    process.exit(1);
  }

  deployer.nonce = await pub.getTransactionCount({ address: deployer.addr, blockTag: "pending" });

  // Create 2 wallets
  for (let i = 0; i < 2; i++) {
    const key = generatePrivateKey();
    const acc = privateKeyToAccount(key);
    traders.push({
      acc,
      addr: acc.address,
      cli: createWalletClient({ account: acc, chain: baseSepolia, transport }),
      nonce: 0,
      holdings: new Map(),
    });
  }
  log("SETUP", `Created ${traders.length} wallets`);

  // Fund wallets
  log("SETUP", "Funding wallets...");
  for (const t of traders) {
    const h = await deployer.cli.sendTransaction({
      to: t.addr,
      value: parseEther(WALLET_FUND),
      nonce: deployer.nonce++,
    });
    await pub.waitForTransactionReceipt({ hash: h, timeout: 30_000 });
    log("SETUP", `  Funded ${t.addr.slice(0, 10)}... with ${WALLET_FUND} ETH`);
  }

  // Sync nonces + approve tokens
  log("SETUP", "Approving tokens...");
  for (const t of traders) {
    t.nonce = await pub.getTransactionCount({ address: t.addr, blockTag: "pending" });
    for (const [name, token] of TOKENS) {
      const h = await t.cli.writeContract({
        address: token,
        abi: erc20Abi,
        functionName: "approve",
        args: [TOKEN_FACTORY, maxUint256],
        nonce: t.nonce++,
      });
      await pub.waitForTransactionReceipt({ hash: h, timeout: 30_000 });
    }
  }

  // Initial buy for each token — so wallets have tokens to sell
  log("SETUP", "Initial buys...");
  for (const t of traders) {
    for (const [name, token] of TOKENS) {
      try {
        const h = await t.cli.writeContract({
          address: TOKEN_FACTORY,
          abi: TF_ABI,
          functionName: "buy",
          args: [token, 0n],
          value: parseEther("0.003"),
          nonce: t.nonce++,
        });
        const receipt = await pub.waitForTransactionReceipt({ hash: h, timeout: 30_000 });
        // Read actual balance
        const bal = await pub.readContract({
          address: token,
          abi: erc20Abi,
          functionName: "balanceOf",
          args: [t.addr],
        });
        t.holdings.set(token, bal);
        log("SETUP", `  ${t.addr.slice(0, 8)} bought ${name}`);
      } catch (e: any) {
        log("SETUP", `  Failed to buy ${name}: ${e.message?.slice(0, 60)}`);
      }
    }
  }

  log("SETUP", "✅ Setup complete. Starting trading loop...\n");
}

async function tradeLoop() {
  let round = 0;
  while (true) {
    round++;
    const [name, token] = TOKENS[round % TOKENS.length];
    const t = traders[round % traders.length];

    try {
      // 60% buy, 40% sell
      const doBuy = Math.random() < 0.6 || (t.holdings.get(token) || 0n) === 0n;

      if (doBuy) {
        const ethAmt = parseEther(rand(BUY_ETH_MIN, BUY_ETH_MAX).toFixed(6));
        const h = await t.cli.writeContract({
          address: TOKEN_FACTORY,
          abi: TF_ABI,
          functionName: "buy",
          args: [token, 0n],
          value: ethAmt,
          nonce: t.nonce++,
        });
        nBuy++;
        // Update holdings estimate
        const newBal = await pub.readContract({
          address: token,
          abi: erc20Abi,
          functionName: "balanceOf",
          args: [t.addr],
        }).catch(() => t.holdings.get(token) || 0n);
        t.holdings.set(token, newBal);

        const price = await pub.readContract({
          address: TOKEN_FACTORY,
          abi: TF_ABI,
          functionName: "getCurrentPrice",
          args: [token],
        }).catch(() => 0n);

        log("BUY", `${name} +${formatEther(ethAmt)} ETH → price: ${(Number(price) / 1e18).toExponential(4)} | total: ${nBuy}B/${nSell}S/${nFail}F`);
      } else {
        // Sell 10-50% of holdings
        const balance = t.holdings.get(token) || 0n;
        if (balance > 0n) {
          const pct = Math.floor(rand(10, 50));
          const sellAmt = balance * BigInt(pct) / 100n;
          if (sellAmt > 0n) {
            const h = await t.cli.writeContract({
              address: TOKEN_FACTORY,
              abi: TF_ABI,
              functionName: "sell",
              args: [token, sellAmt, 0n],
              nonce: t.nonce++,
            });
            nSell++;
            t.holdings.set(token, balance - sellAmt);

            const price = await pub.readContract({
              address: TOKEN_FACTORY,
              abi: TF_ABI,
              functionName: "getCurrentPrice",
              args: [token],
            }).catch(() => 0n);

            log("SELL", `${name} -${pct}% → price: ${(Number(price) / 1e18).toExponential(4)} | total: ${nBuy}B/${nSell}S/${nFail}F`);
          }
        }
      }
    } catch (e: any) {
      nFail++;
      // Resync nonce on error
      try { t.nonce = await pub.getTransactionCount({ address: t.addr, blockTag: "pending" }); } catch {}
      log("ERR", `${name}: ${e.message?.slice(0, 80)}`);
    }

    await sleep(TRADE_INTERVAL);
  }
}

setup().then(tradeLoop).catch(e => {
  console.error("Fatal:", e);
  process.exit(1);
});
