/**
 * 检查测试钱包持有的 meme 币
 */

import {
  createPublicClient,
  http,
  formatEther,
  type Address,
} from "viem";
import { baseSepolia } from "viem/chains";
import * as fs from "fs";

const RPC_URL = "https://base-sepolia.g.alchemy.com/v2/Dr8sMe-1MYIF7jBYuZZj8PMOPAAeJ16d";
const WALLETS_PATH = "/Users/qinlinqiu/Desktop/Namespace/scripts/market-maker/wallets.json";

const TOKEN_FACTORY = "0xE0ddf67E89f5773c960Bc2329109815E8c66BAAe" as Address;

const TOKEN_FACTORY_ABI = [
  {
    inputs: [],
    name: "getAllTokens",
    outputs: [{ type: "address[]" }],
    stateMutability: "view",
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
    inputs: [],
    name: "symbol",
    outputs: [{ type: "string" }],
    stateMutability: "view",
    type: "function",
  },
] as const;

async function main() {
  const client = createPublicClient({
    chain: baseSepolia,
    transport: http(RPC_URL),
  });

  const data = JSON.parse(fs.readFileSync(WALLETS_PATH, "utf-8"));
  const wallets = data.wallets;

  console.log("=== 检查测试钱包持有的 meme 币 ===\n");

  // 获取所有代币
  const allTokens = await client.readContract({
    address: TOKEN_FACTORY,
    abi: TOKEN_FACTORY_ABI,
    functionName: "getAllTokens",
  }) as Address[];

  console.log("TokenFactory 共有 " + allTokens.length + " 个代币\n");

  // 获取每个代币的符号
  const tokenSymbols: Record<string, string> = {};
  for (const token of allTokens) {
    try {
      const symbol = await client.readContract({
        address: token,
        abi: ERC20_ABI,
        functionName: "symbol",
      });
      tokenSymbols[token] = symbol;
    } catch {
      tokenSymbols[token] = "???";
    }
  }

  // 统计持仓
  const holdings: { wallet: number; token: string; symbol: string; amount: bigint }[] = [];

  for (let i = 0; i < wallets.length; i++) {
    const wallet = wallets[i];
    const address = wallet.address as Address;

    for (const token of allTokens) {
      try {
        const balance = await client.readContract({
          address: token,
          abi: ERC20_ABI,
          functionName: "balanceOf",
          args: [address],
        });

        if (balance > 0n) {
          holdings.push({
            wallet: i,
            token,
            symbol: tokenSymbols[token],
            amount: balance,
          });
        }
      } catch {}
    }

    if ((i + 1) % 50 === 0) {
      console.log("已检查 " + (i + 1) + "/200 个钱包...");
    }
  }

  console.log("\n=== 持仓统计 ===\n");
  console.log("持有代币的钱包数: " + new Set(holdings.map(h => h.wallet)).size);
  console.log("持仓记录数: " + holdings.length);

  // 按代币汇总
  const byToken: Record<string, { symbol: string; total: bigint; wallets: number[] }> = {};
  for (const h of holdings) {
    if (!byToken[h.token]) {
      byToken[h.token] = { symbol: h.symbol, total: 0n, wallets: [] };
    }
    byToken[h.token].total += h.amount;
    byToken[h.token].wallets.push(h.wallet);
  }

  console.log("\n按代币汇总:");
  for (const [token, info] of Object.entries(byToken)) {
    console.log("  " + info.symbol + ": " + formatEther(info.total) + " (持有人: " + info.wallets.length + " 个钱包)");
  }

  // 显示前20个持仓
  console.log("\n前20个持仓详情:");
  for (const h of holdings.slice(0, 20)) {
    console.log("  [" + h.wallet + "] " + formatEther(h.amount) + " " + h.symbol);
  }
}

main().catch(console.error);
