import { createPublicClient, http, formatEther, formatUnits, type Address, decodeFunctionResult } from "viem";
import { baseSepolia } from "viem/chains";

const RPC_URL = "https://base-sepolia-rpc.publicnode.com";
const USER = "0xCAE244A3417e75699da37c0e7EadA6cB244AA2B7" as Address;
const OLD_PERP_DEX = "0xeCA6E2f7466c0A1BA6dB3083a09b8B09969D77Ee" as Address;

const client = createPublicClient({
  chain: baseSepolia,
  transport: http(RPC_URL),
});

// 旧合约可能的 ABI
const OLD_ABI = [
  {
    inputs: [{ name: "user", type: "address" }],
    name: "getPosition",
    outputs: [
      { name: "size", type: "uint256" },
      { name: "collateral", type: "uint256" },
      { name: "entryPrice", type: "uint256" },
      { name: "leverage", type: "uint256" },
      { name: "isLong", type: "bool" },
    ],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [{ name: "user", type: "address" }],
    name: "getUnrealizedPnL",
    outputs: [
      { name: "hasProfit", type: "bool" },
      { name: "pnl", type: "uint256" },
    ],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [],
    name: "getMarkPrice",
    outputs: [{ type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
] as const;

async function main() {
  console.log("=== 查询旧 PerpetualDEX 仓位 ===");
  console.log("用户:", USER);
  console.log("合约:", OLD_PERP_DEX);

  // 尝试 getPosition
  try {
    const result = await client.readContract({
      address: OLD_PERP_DEX,
      abi: OLD_ABI,
      functionName: "getPosition",
      args: [USER],
    });
    
    console.log("\n✅ 找到仓位!");
    console.log("  Size:", formatEther(result[0]), "ETH");
    console.log("  Collateral:", formatEther(result[1]), "ETH");
    console.log("  Entry Price:", formatUnits(result[2], 18));
    console.log("  Leverage:", result[3].toString());
    console.log("  Is Long:", result[4]);
  } catch (e: any) {
    console.log("getPosition 失败:", e.message?.slice(0, 100));
  }

  // 尝试 getUnrealizedPnL
  try {
    const pnl = await client.readContract({
      address: OLD_PERP_DEX,
      abi: OLD_ABI,
      functionName: "getUnrealizedPnL",
      args: [USER],
    });
    console.log("\n盈亏:");
    console.log("  Has Profit:", pnl[0]);
    console.log("  PnL:", formatEther(pnl[1]), "ETH");
  } catch (e: any) {
    console.log("getUnrealizedPnL 失败:", e.message?.slice(0, 100));
  }

  // 尝试 getMarkPrice
  try {
    const price = await client.readContract({
      address: OLD_PERP_DEX,
      abi: OLD_ABI,
      functionName: "getMarkPrice",
    });
    console.log("\n当前标记价格:", formatUnits(price, 18), "ETH");
  } catch (e: any) {
    console.log("getMarkPrice 失败:", e.message?.slice(0, 100));
  }
}

main().catch(console.error);
