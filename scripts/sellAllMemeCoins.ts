/**
 * 卖出所有钱包持有的 meme 币，换回 ETH
 *
 * 支持两组钱包：extended (spot) + main (perp)
 * 并发批量处理，加速卖出过程
 */

import {
  createPublicClient,
  createWalletClient,
  http,
  formatEther,
  type Address,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { baseSepolia } from "viem/chains";
import * as fs from "fs";

// ── Current contract addresses (2026-02-28 deployment) ──
const RPC_URL = "https://base-sepolia-rpc.publicnode.com";
const RPC_BACKUP = "https://base-sepolia.g.alchemy.com/v2/Dr8sMe-1MYIF7jBYuZZj8PMOPAAeJ16d";
const TOKEN_FACTORY = "0x757eF02C2233b8cE2161EE65Fb7D626776b8CB73" as Address;

// ── Wallet paths ──
const EXTENDED_WALLETS = "/Users/qinlinqiu/Desktop/Namespace/scripts/market-maker/wallets.json";
const MAIN_WALLETS = "/Users/qinlinqiu/Desktop/meme-perp-dex/backend/src/matching/main-wallets.json";

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
  index?: number;
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

// ── Load all wallets from both sources ──
function loadAllWallets(): Wallet[] {
  const all: Wallet[] = [];

  // Extended wallets (spot wallets 0-199)
  if (fs.existsSync(EXTENDED_WALLETS)) {
    const data = JSON.parse(fs.readFileSync(EXTENDED_WALLETS, "utf-8"));
    const wallets = data.wallets || data;
    console.log(`[Extended] 加载 ${wallets.length} 个钱包`);
    all.push(...wallets);
  }

  // Main wallets (perp wallets 200-299)
  if (fs.existsSync(MAIN_WALLETS)) {
    const data = JSON.parse(fs.readFileSync(MAIN_WALLETS, "utf-8"));
    const wallets = data.wallets || data;
    console.log(`[Main] 加载 ${wallets.length} 个钱包`);
    all.push(...wallets);
  }

  return all;
}

// ── Sell all tokens for one wallet ──
async function sellForWallet(
  client: ReturnType<typeof createPublicClient>,
  wallet: Wallet,
  tokens: Address[],
  idx: number,
): Promise<{ sells: number; ethGained: bigint }> {
  const address = wallet.address as Address;
  let sells = 0;
  let ethGained = 0n;

  // Check gas
  const ethBalance = await client.getBalance({ address });
  if (ethBalance < 50000000000000n) return { sells, ethGained }; // < 0.00005 ETH

  for (const token of tokens) {
    try {
      const tokenBalance = await client.readContract({
        address: token,
        abi: ERC20_ABI,
        functionName: "balanceOf",
        args: [address],
      });

      if (tokenBalance === 0n) continue;

      let symbol = "???";
      try {
        symbol = await client.readContract({
          address: token,
          abi: ERC20_ABI,
          functionName: "symbol",
        });
      } catch {}

      console.log(`[W${idx}] 卖出 ${formatEther(tokenBalance)} ${symbol} (${token.slice(0, 10)}...)`);

      const account = privateKeyToAccount(wallet.privateKey as Hex);
      const walletClient = createWalletClient({
        account,
        chain: baseSepolia,
        transport: http(RPC_URL),
      });

      // Approve
      try {
        const approveHash = await walletClient.writeContract({
          address: token,
          abi: ERC20_ABI,
          functionName: "approve",
          args: [TOKEN_FACTORY, tokenBalance],
        });
        await client.waitForTransactionReceipt({ hash: approveHash, timeout: 30_000 });
      } catch (e: any) {
        console.log(`  [W${idx}] Approve 失败: ${e.message?.slice(0, 60)}`);
        continue;
      }

      // Sell
      const ethBefore = await client.getBalance({ address });
      try {
        const sellHash = await walletClient.writeContract({
          address: TOKEN_FACTORY,
          abi: TOKEN_FACTORY_ABI,
          functionName: "sell",
          args: [token, tokenBalance, 0n],
        });
        await client.waitForTransactionReceipt({ hash: sellHash, timeout: 30_000 });

        const ethAfter = await client.getBalance({ address });
        const gained = ethAfter - ethBefore;
        if (gained > 0n) {
          ethGained += gained;
          console.log(`  [W${idx}] +${formatEther(gained)} ETH`);
        }
        sells++;
        await sleep(200);
      } catch (e: any) {
        console.log(`  [W${idx}] Sell 失败: ${e.message?.slice(0, 60)}`);
      }
    } catch {}
  }

  return { sells, ethGained };
}

// ── Main ──
async function main() {
  const client = createPublicClient({
    chain: baseSepolia,
    transport: http(RPC_URL),
  });

  console.log("╔══════════════════════════════════════════╗");
  console.log("║  卖出所有 Meme 代币 → 换回 ETH          ║");
  console.log("╚══════════════════════════════════════════╝\n");

  const wallets = loadAllWallets();
  console.log(`\n共 ${wallets.length} 个钱包\n`);

  // 1. 获取所有代币
  const allTokens = (await client.readContract({
    address: TOKEN_FACTORY,
    abi: TOKEN_FACTORY_ABI,
    functionName: "getAllTokens",
  })) as Address[];

  console.log(`TokenFactory 共有 ${allTokens.length} 个代币\n`);

  if (allTokens.length === 0) {
    console.log("没有代币需要卖出。");
    return;
  }

  // 2. 并发处理钱包 (每批 3 个钱包, 避免 RPC 限流)
  const BATCH_SIZE = 3;
  let totalSells = 0;
  let totalEth = 0n;

  for (let i = 0; i < wallets.length; i += BATCH_SIZE) {
    const batch = wallets.slice(i, i + BATCH_SIZE);
    const results = await Promise.allSettled(
      batch.map((w, j) => sellForWallet(client, w, allTokens, i + j)),
    );

    for (const r of results) {
      if (r.status === "fulfilled") {
        totalSells += r.value.sells;
        totalEth += r.value.ethGained;
      }
    }

    // Rate limit: 500ms between batches
    await sleep(500);

    if ((i + BATCH_SIZE) % 30 === 0 || i + BATCH_SIZE >= wallets.length) {
      console.log(`\n── 进度: ${Math.min(i + BATCH_SIZE, wallets.length)}/${wallets.length} 钱包 | ${totalSells} 笔卖出 | +${formatEther(totalEth)} ETH ──\n`);
    }
  }

  console.log("\n╔══════════════════════════════════════════╗");
  console.log(`║  卖出完成: ${totalSells} 笔`);
  console.log(`║  回收 ETH: ~${formatEther(totalEth)} ETH`);
  console.log("╚══════════════════════════════════════════╝");
}

main().catch(console.error);
