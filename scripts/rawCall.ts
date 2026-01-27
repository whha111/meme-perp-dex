import { createPublicClient, http, encodeFunctionData, decodeFunctionResult, type Address } from "viem";
import { baseSepolia } from "viem/chains";

const RPC_URL = "https://base-sepolia-rpc.publicnode.com";
const USER = "0xCAE244A3417e75699da37c0e7EadA6cB244AA2B7" as Address;
const OLD_CONTRACT = "0xeCA6E2f7466c0A1BA6dB3083a09b8B09969D77Ee" as Address;

const client = createPublicClient({
  chain: baseSepolia,
  transport: http(RPC_URL),
});

async function main() {
  console.log("=== Raw Call 测试 ===");

  // getPosition(address) selector = 0xeb02c301
  const calldata = "0xeb02c301000000000000000000000000" + USER.slice(2).toLowerCase();
  
  console.log("Calldata:", calldata);
  
  const result = await client.call({
    to: OLD_CONTRACT,
    data: calldata as `0x${string}`,
  });
  
  console.log("Raw result:", result.data);
  
  // 手动解析返回数据
  // 假设返回: (uint256 size, uint256 collateral, uint256 entryPrice, uint256 leverage, bool isLong, int256 lastFundingIndex, uint256 openTime)
  if (result.data) {
    const data = result.data.slice(2); // 去掉 0x
    const chunkSize = 64; // 32 bytes = 64 hex chars
    
    const chunks = [];
    for (let i = 0; i < data.length; i += chunkSize) {
      chunks.push(data.slice(i, i + chunkSize));
    }
    
    console.log("\n解析结果 (每32字节):");
    for (let i = 0; i < chunks.length; i++) {
      const val = BigInt("0x" + chunks[i]);
      console.log("  [" + i + "]:", val.toString());
      
      // 尝试解释
      if (val > 0n && val < 10n**20n) {
        console.log("       可能是 ETH:", Number(val) / 1e18, "ETH");
      }
    }
  }
}

main().catch(console.error);
