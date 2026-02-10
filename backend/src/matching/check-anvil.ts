import { createPublicClient, http, formatEther } from "viem";
import { foundry } from "viem/chains";
import fs from "fs";

const wallets = JSON.parse(fs.readFileSync("main-wallets.json", "utf-8"));

// 尝试连接本地 Anvil
const client = createPublicClient({
  chain: foundry,
  transport: http("http://127.0.0.1:8545"),
});

console.log("=== 检查本地 Anvil 链上的余额 ===\n");

try {
  const chainId = await client.getChainId();
  console.log(`✅ Anvil 运行中 (Chain ID: ${chainId})\n`);
  
  let totalBalance = 0n;
  let walletsWithBalance = 0;
  
  for (let i = 0; i < Math.min(10, wallets.length); i++) {
    const balance = await client.getBalance({ address: wallets[i].address });
    
    if (balance > 0n) {
      walletsWithBalance++;
      totalBalance += balance;
      console.log(`✅ 钱包 #${i + 1}: ${wallets[i].address.slice(0, 10)}... = ${formatEther(balance)} ETH`);
    } else {
      console.log(`❌ 钱包 #${i + 1}: ${wallets[i].address.slice(0, 10)}... = 0 ETH`);
    }
  }
  
  console.log(`\n📊 统计: ${walletsWithBalance}/10 有余额`);
  console.log(`💰 总计: ${formatEther(totalBalance)} ETH`);
  
} catch (error) {
  console.log("❌ Anvil 未运行 - 这些钱包可能需要在本地链上使用");
  console.log("💡 提示: 运行 `anvil` 启动本地测试链");
}
