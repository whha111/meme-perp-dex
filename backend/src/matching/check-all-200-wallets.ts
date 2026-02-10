import { createPublicClient, http, formatEther } from "viem";
import { baseSepolia } from "viem/chains";
import fs from "fs";

const wallets = JSON.parse(fs.readFileSync("main-wallets.json", "utf-8"));
const client = createPublicClient({
  chain: baseSepolia,
  transport: http("https://sepolia.base.org"),
});

console.log("=== 检查全部 200 个钱包 (Base Sepolia) ===\n");

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
      console.log(`✅ 找到! 钱包 #${i + 1}: ${wallets[i].address} = ${formatEther(balance)} ETH`);
    }
    
    // 每50个显示进度
    if ((i + 1) % 50 === 0) {
      console.log(`📊 已检查: ${i + 1}/200`);
    }
    
    // 避免限流
    await new Promise(r => setTimeout(r, 150));
  } catch (error: any) {
    console.log(`❌ 钱包 #${i + 1} 查询失败`);
  }
}

console.log("\n" + "=".repeat(60));
console.log(`📊 最终结果:`);
console.log(`✅ 有余额的钱包: ${walletsWithBalance.length}/200`);
console.log(`💰 总余额: ${formatEther(totalBalance)} ETH`);
console.log("=".repeat(60));

if (walletsWithBalance.length > 0) {
  console.log("\n💎 有余额的钱包列表:");
  walletsWithBalance.forEach(w => {
    console.log(`   #${w.index}: ${w.address} = ${w.balance} ETH`);
  });
} else {
  console.log("\n❌ 所有200个钱包在Base Sepolia上余额都是0");
  console.log("\n请确认:");
  console.log("1. 这些钱包是否在其他链上？");
  console.log("2. 或者提供一个您确认有余额的具体地址？");
}
