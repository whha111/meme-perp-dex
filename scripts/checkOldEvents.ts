import { createPublicClient, http, formatEther, type Address } from "viem";
import { baseSepolia } from "viem/chains";

const RPC_URL = "https://base-sepolia-rpc.publicnode.com";
const USER = "0xCAE244A3417e75699da37c0e7EadA6cB244AA2B7" as Address;
const OLD_CONTRACT = "0xeCA6E2f7466c0A1BA6dB3083a09b8B09969D77Ee" as Address;

const client = createPublicClient({
  chain: baseSepolia,
  transport: http(RPC_URL),
});

async function main() {
  console.log("=== 查询旧合约的所有用户事件 ===");
  
  const latestBlock = await client.getBlockNumber();
  const fromBlock = latestBlock - 2000n;
  
  console.log("查询范围:", fromBlock.toString(), "-", latestBlock.toString());
  
  // 获取所有日志
  const logs = await client.getLogs({
    address: OLD_CONTRACT,
    fromBlock,
    toBlock: latestBlock,
  });
  
  console.log("总事件数:", logs.length);
  
  // 过滤用户相关事件
  const userAddress = USER.slice(2).toLowerCase().padStart(64, "0");
  
  for (const log of logs) {
    // 检查是否与用户相关
    const isUserRelated = log.topics.some(t => 
      t?.toLowerCase().includes(USER.slice(2).toLowerCase())
    );
    
    if (isUserRelated) {
      console.log("\n--- 用户相关事件 ---");
      console.log("区块:", log.blockNumber?.toString());
      console.log("交易:", log.transactionHash);
      console.log("主题0:", log.topics[0]?.slice(0, 20) + "...");
      
      // 事件签名识别
      const sig = log.topics[0];
      if (sig === "0x2e1a7d4d13322e7b96f9a57413e1525c250fb7a9021cf91d1540d5b69f16a49f") {
        console.log("事件类型: PositionOpened");
      } else if (sig === "0xdec2bacdd2f05b59de34da9b523dff8be42e5e38e818c82fdb0bae774387a724") {
        console.log("事件类型: PositionClosed");  
      } else if (sig === "0x5e3cde32fde115aebe4c7e0454b76e5d2326bbcbdfe9da41be06f2e17d80f521") {
        console.log("事件类型: Liquidation");
      } else if (sig === "0x90890809c654f11d6e72a28fa60149770a0d11ec6c92319d6ceb2bb0a4ea1a15") {
        console.log("事件类型: Deposited");
      }
      
      // 打印数据
      if (log.data && log.data.length > 2) {
        const dataHex = log.data.slice(2);
        const chunks = [];
        for (let i = 0; i < dataHex.length; i += 64) {
          chunks.push(dataHex.slice(i, i + 64));
        }
        console.log("数据块数:", chunks.length);
        for (let i = 0; i < Math.min(5, chunks.length); i++) {
          const val = BigInt("0x" + chunks[i]);
          if (val > 0n && val < 10n**21n) {
            console.log("  数据[" + i + "]:", formatEther(val), "ETH");
          } else {
            console.log("  数据[" + i + "]:", val.toString());
          }
        }
      }
    }
  }
}

main().catch(console.error);
