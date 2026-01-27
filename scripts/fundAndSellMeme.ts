/**
 * 1. 给测试钱包充值 gas 费
 * 2. 卖出所有 meme 币换成 ETH
 */

import {
  createPublicClient,
  createWalletClient,
  http,
  formatEther,
  parseEther,
  type Address,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { baseSepolia } from "viem/chains";
import * as fs from "fs";

const RPC_URL = "https://base-sepolia.g.alchemy.com/v2/Dr8sMe-1MYIF7jBYuZZj8PMOPAAeJ16d";
const WALLETS_PATH = "/Users/qinlinqiu/Desktop/Namespace/scripts/market-maker/wallets.json";

const DEPLOYER_KEY = "0xf9a07bb59ea400ef88bfbcf314d89f357c8580d1a4fb543e48cfb98b02b41d2c" as Hex;
const TOKEN_FACTORY = "0xE0ddf67E89f5773c960Bc2329109815E8c66BAAe" as Address;

// 每个钱包需要的 gas 费（用于 approve + sell）
const GAS_PER_WALLET = parseEther("0.002");

const TOKEN_FACTORY_ABI = [
  {
    inputs: [],
    name: "getAllTokens",
    outputs: [{ type: "address[]" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [
      { name: "tokenAddress", type: "address" },
      { name: "tokenAmount", type: "uint256" },
      { name: "minETHOut", type: "uint256" },
    ],
    name: "sell",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
] as const;

const ERC20_ABI = [
  {
    inputs: [{ name: "account", type: "address" }],
    name: "balanceOf",
    outputs: [{ type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [
      { name: "spender", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    name: "approve",
    outputs: [{ type: "bool" }],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [],
    name: "symbol",
    outputs: [{ type: "string" }],
    stateMutability: "view",
    type: "function",
  },
] as const;

interface Wallet {
  privateKey: string;
  address: string;
  index: number;
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function main() {
  const client = createPublicClient({
    chain: baseSepolia,
    transport: http(RPC_URL),
  });

  const deployerAccount = privateKeyToAccount(DEPLOYER_KEY);
  const deployerClient = createWalletClient({
    account: deployerAccount,
    chain: baseSepolia,
    transport: http(RPC_URL),
  });

  const data = JSON.parse(fs.readFileSync(WALLETS_PATH, "utf-8"));
  const wallets: Wallet[] = data.wallets;

  console.log("=== 卖出 meme 币换 ETH ===\n");
  console.log("Deployer: " + deployerAccount.address);

  // 获取所有代币
  const allTokens = await client.readContract({
    address: TOKEN_FACTORY,
    abi: TOKEN_FACTORY_ABI,
    functionName: "getAllTokens",
  }) as Address[];

  console.log("共 " + allTokens.length + " 个代币\n");

  // Step 1: 找出持有 meme 币的钱包
  console.log("--- Step 1: 扫描持仓 ---\n");

  interface Holding {
    walletIndex: number;
    wallet: Wallet;
    token: Address;
    symbol: string;
    amount: bigint;
  }

  const holdings: Holding[] = [];

  for (let i = 0; i < wallets.length; i++) {
    const wallet = wallets[i];
    const addr = wallet.address as Address;

    for (const token of allTokens) {
      try {
        const bal = await client.readContract({
          address: token,
          abi: ERC20_ABI,
          functionName: "balanceOf",
          args: [addr],
        });

        if (bal > 0n) {
          let sym = "???";
          try {
            sym = await client.readContract({
              address: token,
              abi: ERC20_ABI,
              functionName: "symbol",
            });
          } catch {}

          holdings.push({
            walletIndex: i,
            wallet,
            token,
            symbol: sym,
            amount: bal,
          });
        }
      } catch {}
    }

    if ((i + 1) % 50 === 0) {
      console.log("已扫描 " + (i + 1) + "/200 个钱包...");
    }
  }

  console.log("\n找到 " + holdings.length + " 个持仓");

  if (holdings.length === 0) {
    console.log("没有 meme 币可卖");
    return;
  }

  // 找出需要 gas 的钱包
  const uniqueWallets = [...new Set(holdings.map(h => h.walletIndex))];
  console.log("涉及 " + uniqueWallets.length + " 个钱包\n");

  // Step 2: 给钱包充 gas
  console.log("--- Step 2: 充值 gas ---\n");

  for (const idx of uniqueWallets) {
    const wallet = wallets[idx];
    const addr = wallet.address as Address;

    const balance = await client.getBalance({ address: addr });

    if (balance < GAS_PER_WALLET) {
      const needed = GAS_PER_WALLET - balance;
      console.log("[" + idx + "] 充值 " + formatEther(needed) + " ETH");

      try {
        const hash = await deployerClient.sendTransaction({
          to: addr,
          value: needed,
        });
        await client.waitForTransactionReceipt({ hash });
        await sleep(200);
      } catch (e: any) {
        console.log("  充值失败: " + e.message.slice(0, 40));
      }
    }
  }

  // Step 3: 卖出 meme 币
  console.log("\n--- Step 3: 卖出 meme 币 ---\n");

  let sellCount = 0;
  let totalEthGained = 0n;

  for (const h of holdings) {
    const addr = h.wallet.address as Address;

    console.log("[" + h.walletIndex + "] 卖出 " + formatEther(h.amount) + " " + h.symbol);

    const ethBefore = await client.getBalance({ address: addr });

    const account = privateKeyToAccount(h.wallet.privateKey as Hex);
    const walletClient = createWalletClient({
      account,
      chain: baseSepolia,
      transport: http(RPC_URL),
    });

    try {
      // Approve
      const approveHash = await walletClient.writeContract({
        address: h.token,
        abi: ERC20_ABI,
        functionName: "approve",
        args: [TOKEN_FACTORY, h.amount],
      });
      await client.waitForTransactionReceipt({ hash: approveHash });

      // Sell
      const sellHash = await walletClient.writeContract({
        address: TOKEN_FACTORY,
        abi: TOKEN_FACTORY_ABI,
        functionName: "sell",
        args: [h.token, h.amount, 0n],
      });
      await client.waitForTransactionReceipt({ hash: sellHash });

      const ethAfter = await client.getBalance({ address: addr });
      const gained = ethAfter > ethBefore ? ethAfter - ethBefore : 0n;

      if (gained > 0n) {
        console.log("  -> 获得 " + formatEther(gained) + " ETH");
        totalEthGained += gained;
      }

      sellCount++;
      await sleep(300);
    } catch (e: any) {
      console.log("  失败: " + e.message.slice(0, 50));
    }
  }

  console.log("\n=== 完成 ===");
  console.log("成功卖出: " + sellCount + "/" + holdings.length);
  console.log("获得约: " + formatEther(totalEthGained) + " ETH");

  // 最终余额
  let finalTotal = 0n;
  for (const w of wallets) {
    const bal = await client.getBalance({ address: w.address as Address });
    finalTotal += bal;
  }
  console.log("\n测试钱包最终总余额: " + formatEther(finalTotal) + " ETH");
}

main().catch(console.error);
