import { createPublicClient, http, formatEther } from "viem";
import { baseSepolia } from "viem/chains";
import fs from "fs";

const wallets = JSON.parse(fs.readFileSync("main-wallets.json", "utf-8"));

// 尝试多个不同的RPC
const RPC_URLS = [
  "https://sepolia.base.org",
  "https://base-sepolia-rpc.publicnode.com", 
  "https://base-sepolia.blockpi.network/v1/rpc/public",
];

console.log("=== 用多个RPC节点重新检查钱包余额 ===\n");

for (const rpcUrl of RPC_URLS) {
  console.log(`\n📡 使用 RPC: ${rpcUrl}`);
  console.log("=".repeat(60));
  
  try {
    const client = createPublicClient({
      chain: baseSepolia,
      transport: http(rpcUrl),
    });
    
    // 检查前20个钱包
    let totalBalance = 0n;
    let walletsWithBalance = 0;
    const walletList: any[] = [];
    
    for (let i = 0; i < Math.min(20, wallets.length); i++) {
      const balance = await client.getBalance({ address: wallets[i].address });
      
      if (balance > 0n) {
        walletsWithBalance++;
        totalBalance += balance;
        walletList.push({
          index: i + 1,
          address: wallets[i].address,
          balance: formatEther(balance)
        });
        console.log(`✅ #${i + 1}: ${wallets[i].address} = ${formatEther(balance)} ETH`);
      }
      
      await new Promise(r => setTimeout(r, 100));
    }
    
    console.log(`\n📊 结果: ${walletsWithBalance}/20 有余额`);
    console.log(`💰 总计: ${formatEther(totalBalance)} ETH`);
    
    if (walletsWithBalance > 0) {
      console.log("\n✅ 找到有余额的钱包！");
      break;
    }
    
  } catch (error: any) {
    console.log(`❌ RPC连接失败: ${error.message}`);
  }
}

// 显示前10个钱包地址供用户验证
console.log("\n\n=== 前10个钱包地址（请在区块浏览器验证）===");
for (let i = 0; i < 10; i++) {
  console.log(`#${i + 1}: ${wallets[i].address}`);
  console.log(`     https://sepolia.basescan.org/address/${wallets[i].address}`);
}
