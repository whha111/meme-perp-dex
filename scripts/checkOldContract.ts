import { createPublicClient, http, formatEther, formatUnits, type Address } from "viem";
import { baseSepolia } from "viem/chains";

const RPC_URL = "https://base-sepolia-rpc.publicnode.com";
const USER = "0xCAE244A3417e75699da37c0e7EadA6cB244AA2B7" as Address;
const OLD_PERP_DEX = "0xeCA6E2f7466c0A1BA6dB3083a09b8B09969D77Ee" as Address;

const client = createPublicClient({
  chain: baseSepolia,
  transport: http(RPC_URL),
});

// 尝试不同的 ABI 来读取仓位
const POSITION_ABIS = [
  // 方式1: getPosition(address)
  {
    inputs: [{ name: "user", type: "address" }],
    name: "getPosition",
    outputs: [{
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
    }],
    stateMutability: "view",
    type: "function",
  },
  // 方式2: positions(address)
  {
    inputs: [{ name: "user", type: "address" }],
    name: "positions",
    outputs: [{
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
    }],
    stateMutability: "view",
    type: "function",
  },
];

async function main() {
  console.log("=== 查询旧合约仓位 ===");
  console.log("用户:", USER);
  console.log("旧合约:", OLD_PERP_DEX);

  for (const abi of POSITION_ABIS) {
    try {
      console.log("\n尝试调用:", abi.name);
      const result = await client.readContract({
        address: OLD_PERP_DEX,
        abi: [abi],
        functionName: abi.name,
        args: [USER],
      }) as any;

      console.log("结果:", result);
      
      if (result && result.size > 0n) {
        console.log("\n✅ 找到仓位!");
        console.log("  大小:", formatEther(result.size), "ETH");
        console.log("  保证金:", formatEther(result.collateral), "ETH");
        console.log("  方向:", result.isLong ? "LONG" : "SHORT");
        console.log("  入场价:", formatUnits(result.entryPrice, 18));
      }
    } catch (e: any) {
      console.log("  失败:", e.message?.slice(0, 80));
    }
  }

  // 直接查询 mapping
  console.log("\n--- 尝试其他方式 ---");
  
  // 查询事件
  const latestBlock = await client.getBlockNumber();
  const fromBlock = latestBlock - 1000n;
  
  const logs = await client.getLogs({
    address: OLD_PERP_DEX,
    fromBlock,
    toBlock: latestBlock,
  });
  
  console.log("旧合约最近事件数:", logs.length);
  
  // 找用户相关的事件
  const userLogs = logs.filter(l => 
    l.topics.some(t => t?.toLowerCase().includes(USER.slice(2).toLowerCase()))
  );
  console.log("用户相关事件:", userLogs.length);
  
  for (const log of userLogs) {
    console.log("  区块:", log.blockNumber?.toString());
    console.log("  交易:", log.transactionHash);
  }
}

main().catch(console.error);
