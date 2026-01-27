import { createPublicClient, http, formatEther, formatUnits, type Address, parseAbiItem } from "viem";
import { baseSepolia } from "viem/chains";

const RPC_URL = "https://base-sepolia-rpc.publicnode.com";
const COP400 = "0x6Bf5C512a5714D610379b1EA0Dec0BEFb46888f7" as Address;
const POSITION_MANAGER = "0x72E9a39aD581e78DF55fD14D803eD05fB6413660" as Address;

const client = createPublicClient({
  chain: baseSepolia,
  transport: http(RPC_URL),
});

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
] as const;

// 常见测试地址
const testAddresses = [
  "0x5AF11d4784c3739cf2FD51Fdc272ae4957ADf7fE", // deployer
];

// 从 wallets.json 加载前几个钱包
import * as fs from "fs";
const walletsPath = "/Users/qinlinqiu/Desktop/Namespace/scripts/market-maker/wallets.json";
const data = fs.readFileSync(walletsPath, "utf-8");
const wallets = JSON.parse(data).wallets.slice(0, 20);
for (const w of wallets) {
  testAddresses.push(w.address);
}

async function main() {
  console.log("=== 查找所有 COP400 仓位 ===\n");
  console.log("代币:", COP400);
  console.log("检查", testAddresses.length, "个地址...\n");

  let found = 0;
  for (const addr of testAddresses) {
    try {
      const position = await client.readContract({
        address: POSITION_MANAGER,
        abi: POSITION_MANAGER_ABI,
        functionName: "getPositionByToken",
        args: [addr as Address, COP400],
      });

      if (position.size > 0n) {
        found++;
        console.log("✅ 找到仓位!");
        console.log("  地址:", addr);
        console.log("  方向:", position.isLong ? "LONG" : "SHORT");
        console.log("  大小:", formatEther(position.size), "ETH");
        console.log("  保证金:", formatEther(position.collateral), "ETH");
        console.log("  入场价:", formatUnits(position.entryPrice, 18), "ETH");
        console.log("  杠杆:", Number(position.leverage) / 10000, "x");
        console.log("  开仓时间:", new Date(Number(position.openTime) * 1000).toLocaleString());
        console.log("");
      }
    } catch (e) {
      // 忽略错误
    }
  }

  if (found === 0) {
    console.log("❌ 在检查的地址中没有找到 COP400 仓位");
  } else {
    console.log("总共找到", found, "个仓位");
  }
}

main().catch(console.error);
