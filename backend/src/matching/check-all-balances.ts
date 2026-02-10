import { createPublicClient, http, formatEther } from "viem";
import { baseSepolia } from "viem/chains";
import fs from "fs";

const wallets = JSON.parse(fs.readFileSync("main-wallets.json", "utf-8"));
const client = createPublicClient({
  chain: baseSepolia,
  transport: http("https://base-sepolia-rpc.publicnode.com"),
});

console.log("=== 检查所有 200 个主钱包 ETH 余额 ===\n");

let totalBalance = 0n;
let walletsWithBalance: any[] = [];

for (let i = 0; i < wallets.length; i++) {
  try {
    const balance = await client.getBalance({ address: wallets[i].address });
    
    if (balance > 0n) {
      walletsWithBalance.push({
        index: i + 1,
        address: wallets[i].address,
        balance: formatEther(balance)
      });
      totalBalance += balance;
      console.log(`✅ 钱包 #${i + 1}: ${wallets[i].address} = ${formatEther(balance)} ETH`);
    }
    
    // 每10个显示进度
    if ((i + 1) % 10 === 0) {
      console.log(`📊 进度: ${i + 1}/200 已检查`);
    }
    
    // 暂停避免限流
    await new Promise(r => setTimeout(r, 200));
  } catch (error: any) {
    console.log(`❌ 钱包 #${i + 1}: 查询失败 - ${error.message}`);
  }
}

console.log("\n" + "=".repeat(60));
console.log(`📊 统计结果:`);
console.log(`✅ 有余额的钱包: ${walletsWithBalance.length}/200`);
console.log(`💰 总余额: ${formatEther(totalBalance)} ETH`);
console.log("=".repeat(60));

if (walletsWithBalance.length > 0) {
  console.log("\n💎 有余额的钱包列表:");
  walletsWithBalance.forEach(w => {
    console.log(`   #${w.index}: ${w.address.slice(0, 10)}...${w.address.slice(-8)} = ${w.balance} ETH`);
  });
}
