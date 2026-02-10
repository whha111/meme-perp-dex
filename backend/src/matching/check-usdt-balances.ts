import { createPublicClient, http, formatUnits } from "viem";
import { baseSepolia } from "viem/chains";
import fs from "fs";

const USDT_ADDRESS = "0xAa2a6b49C37E0241f9b5385dc4637eDF51026519";
const USDT_ABI = [
  {
    inputs: [{ name: "account", type: "address" }],
    name: "balanceOf",
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
    type: "function"
  },
  {
    inputs: [],
    name: "decimals",
    outputs: [{ name: "", type: "uint8" }],
    stateMutability: "view",
    type: "function"
  }
];

const wallets = JSON.parse(fs.readFileSync("trading-wallets.json", "utf-8"));
const client = createPublicClient({
  chain: baseSepolia,
  transport: http("https://base-sepolia-rpc.publicnode.com"),
});

console.log("=== 检查派生钱包 USDT 余额 (前20个) ===\n");

let totalBalance = 0n;
let walletsWithBalance = 0;

for (let i = 0; i < Math.min(20, wallets.length); i++) {
  try {
    const balance = await client.readContract({
      address: USDT_ADDRESS,
      abi: USDT_ABI,
      functionName: "balanceOf",
      args: [wallets[i].derivedAddress]
    });
    
    const formatted = formatUnits(balance, 6);
    
    if (balance > 0n) {
      walletsWithBalance++;
      totalBalance += balance;
      console.log(`✅ 钱包 #${i + 1}: ${wallets[i].derivedAddress.slice(0, 10)}... = ${formatted} USDT`);
    } else {
      console.log(`❌ 钱包 #${i + 1}: ${wallets[i].derivedAddress.slice(0, 10)}... = 0 USDT`);
    }
    
    await new Promise(r => setTimeout(r, 300));
  } catch (error: any) {
    console.log(`❌ 钱包 #${i + 1}: 查询失败`);
  }
}

console.log(`\n📊 统计: ${walletsWithBalance}/20 个钱包有USDT余额`);
console.log(`💰 总余额: ${formatUnits(totalBalance, 6)} USDT`);

if (walletsWithBalance > 0) {
  console.log("\n✅ 可以开始做市交易！");
} else {
  console.log("\n⚠️ 需要先给派生钱包充值 USDT");
}
