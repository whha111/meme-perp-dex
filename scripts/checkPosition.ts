/**
 * Check Position PnL
 * Query perpetual position and calculate profit/loss
 */

import {
  createPublicClient,
  http,
  formatUnits,
  formatEther,
  type Address,
} from "viem";
import { baseSepolia } from "viem/chains";

const RPC_URL = "https://base-sepolia.g.alchemy.com/v2/Dr8sMe-1MYIF7jBYuZZj8PMOPAAeJ16d";

const TARGET_TOKEN = "0x6Bf5C512a5714D610379b1EA0Dec0BEFb46888f7" as Address; // COP400

const CONTRACTS = {
  POSITION_MANAGER: "0x72E9a39aD581e78DF55fD14D803eD05fB6413660" as Address,
  PRICE_FEED: "0xd69A4DB60cEc962A46C6B9Bc8CC0883081c4eFb7" as Address,
  VAULT: "0x467a18E3Ec98587Cd88683E6F9e1792C480C09c7" as Address,
};

const POSITION_MANAGER_ABI = [
  {
    inputs: [
      { name: "user", type: "address" },
      { name: "token", type: "address" },
    ],
    name: "getPositionByToken",
    outputs: [
      {
        components: [
          { name: "size", type: "uint256" },
          { name: "collateral", type: "uint256" },
          { name: "entryPrice", type: "uint256" },
          { name: "leverage", type: "uint256" },
          { name: "isLong", type: "bool" },
          { name: "lastFundingIndex", type: "int256" },
          { name: "openTime", type: "uint256" },
        ],
        type: "tuple",
      },
    ],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [
      { name: "user", type: "address" },
      { name: "token", type: "address" },
    ],
    name: "getTokenUnrealizedPnL",
    outputs: [
      { name: "hasProfit", type: "bool" },
      { name: "pnl", type: "uint256" },
    ],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [
      { name: "user", type: "address" },
      { name: "token", type: "address" },
    ],
    name: "getTokenLiquidationPrice",
    outputs: [{ type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
] as const;

const PRICE_FEED_ABI = [
  {
    inputs: [{ name: "token", type: "address" }],
    name: "getTokenMarkPrice",
    outputs: [{ type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
] as const;

const VAULT_ABI = [
  {
    inputs: [{ name: "user", type: "address" }],
    name: "getBalance",
    outputs: [{ type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
] as const;

// Check multiple addresses
const ADDRESSES_TO_CHECK = [
  // Add user addresses here, or use command line arg
  process.argv[2],
].filter(Boolean) as string[];

async function main() {
  console.log("========== 仓位盈亏查询 ==========\n");
  console.log("代币: COP400 (" + TARGET_TOKEN + ")\n");

  const publicClient = createPublicClient({
    chain: baseSepolia,
    transport: http(RPC_URL),
  });

  // Get current mark price
  const markPrice = await publicClient.readContract({
    address: CONTRACTS.PRICE_FEED,
    abi: PRICE_FEED_ABI,
    functionName: "getTokenMarkPrice",
    args: [TARGET_TOKEN],
  });
  console.log("当前标记价格:", formatUnits(markPrice, 18), "ETH\n");

  if (ADDRESSES_TO_CHECK.length === 0) {
    console.log("用法: npx ts-node scripts/checkPosition.ts <钱包地址>");
    console.log("\n示例: npx ts-node scripts/checkPosition.ts 0x1234...");
    return;
  }

  for (const userAddress of ADDRESSES_TO_CHECK) {
    console.log("=".repeat(50));
    console.log("钱包:", userAddress);
    console.log("=".repeat(50));

    try {
      // Get position
      const position = await publicClient.readContract({
        address: CONTRACTS.POSITION_MANAGER,
        abi: POSITION_MANAGER_ABI,
        functionName: "getPositionByToken",
        args: [userAddress as Address, TARGET_TOKEN],
      });

      if (position.size === 0n) {
        console.log("❌ 无仓位\n");
        continue;
      }

      console.log("\n📊 仓位信息:");
      console.log("  方向:", position.isLong ? "🟢 做多 (LONG)" : "🔴 做空 (SHORT)");
      console.log("  仓位大小:", formatEther(position.size), "ETH");
      console.log("  保证金:", formatEther(position.collateral), "ETH");
      console.log("  入场价格:", formatUnits(position.entryPrice, 18), "ETH");
      console.log("  杠杆:", Number(position.leverage) / 10000, "x");
      console.log("  开仓时间:", new Date(Number(position.openTime) * 1000).toLocaleString());

      // Get PnL
      const [hasProfit, pnl] = await publicClient.readContract({
        address: CONTRACTS.POSITION_MANAGER,
        abi: POSITION_MANAGER_ABI,
        functionName: "getTokenUnrealizedPnL",
        args: [userAddress as Address, TARGET_TOKEN],
      });

      const pnlPercent = Number(pnl) / Number(position.collateral) * 100;

      console.log("\n💰 盈亏:");
      console.log("  未实现盈亏:", hasProfit ? "+" : "-", formatEther(pnl), "ETH");
      console.log("  收益率:", hasProfit ? "+" : "-", pnlPercent.toFixed(2), "%");

      // Get liquidation price
      try {
        const liqPrice = await publicClient.readContract({
          address: CONTRACTS.POSITION_MANAGER,
          abi: POSITION_MANAGER_ABI,
          functionName: "getTokenLiquidationPrice",
          args: [userAddress as Address, TARGET_TOKEN],
        });
        console.log("  清算价格:", formatUnits(liqPrice, 18), "ETH");
      } catch (e) {
        console.log("  清算价格: 无法获取");
      }

      // Get vault balance
      const vaultBalance = await publicClient.readContract({
        address: CONTRACTS.VAULT,
        abi: VAULT_ABI,
        functionName: "getBalance",
        args: [userAddress as Address],
      });
      console.log("\n🏦 Vault 余额:", formatEther(vaultBalance), "ETH");

    } catch (e: any) {
      console.log("❌ 查询失败:", e.message?.slice(0, 100));
    }
    console.log("");
  }
}

main().catch(console.error);
