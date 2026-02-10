import { createPublicClient, http, formatEther, mnemonicToAccount } from "viem";
import { baseSepolia } from "viem/chains";

// Foundry 默认助记词
const FOUNDRY_MNEMONIC = "test test test test test test test test test test test junk";

const client = createPublicClient({
  chain: baseSepolia,
  transport: http("https://base-sepolia-rpc.publicnode.com"),
});

console.log("=== 检查 Foundry 默认测试账户 (前10个) ===\n");

let totalBalance = 0n;
let walletsWithBalance = 0;

for (let i = 0; i < 10; i++) {
  const account = mnemonicToAccount(FOUNDRY_MNEMONIC, { addressIndex: i });
  
  try {
    const balance = await client.getBalance({ address: account.address });
    
    if (balance > 0n) {
      walletsWithBalance++;
      totalBalance += balance;
      console.log(`✅ #${i}: ${account.address} = ${formatEther(balance)} ETH`);
    } else {
      console.log(`❌ #${i}: ${account.address} = 0 ETH`);
    }
    
    await new Promise(r => setTimeout(r, 300));
  } catch (e) {
    console.log(`❌ #${i}: 查询失败`);
  }
}

console.log(`\n📊 统计: ${walletsWithBalance}/10 有余额`);
console.log(`💰 总计: ${formatEther(totalBalance)} ETH`);
