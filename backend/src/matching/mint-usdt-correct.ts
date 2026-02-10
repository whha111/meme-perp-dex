import { createWalletClient, http, parseUnits } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { baseSepolia } from "viem/chains";
import fs from "fs";

const USDT_ADDRESS = "0xAa2a6b49C37E0241f9b5385dc4637eDF51026519";
const RPC_URL = "https://sepolia.base.org";

// 正确的ABI - mintTo函数
const USDT_ABI = [
  {
    inputs: [
      { name: "to", type: "address" },
      { name: "amount", type: "uint256" }
    ],
    name: "mintTo",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function"
  }
];

const mainWallets = JSON.parse(fs.readFileSync("main-wallets.json", "utf-8"));
const tradingWallets = JSON.parse(fs.readFileSync("trading-wallets.json", "utf-8"));

// 使用有6 ETH的钱包#1作为minter
const minter = mainWallets[0];
const account = privateKeyToAccount(minter.privateKey as any);

const client = createWalletClient({
  account,
  chain: baseSepolia,
  transport: http(RPC_URL),
});

console.log("=== 开始给派生钱包充值USDT ===");
console.log("Minter:", account.address);
console.log("");

let successCount = 0;
let failCount = 0;

for (let i = 0; i < tradingWallets.length; i++) {
  const wallet = tradingWallets[i];
  const amount = parseUnits("10000", 6); // 10000 USDT
  
  try {
    console.log(`[${i + 1}/100] 充值到 ${wallet.derivedAddress.slice(0, 12)}...`);
    
    const hash = await client.writeContract({
      address: USDT_ADDRESS,
      abi: USDT_ABI,
      functionName: "mintTo",
      args: [wallet.derivedAddress, amount],
    });
    
    console.log(`✅ 成功! TX: ${hash.slice(0, 20)}...`);
    successCount++;
    
    // 每5个暂停避免限流
    if ((i + 1) % 5 === 0) {
      await new Promise(r => setTimeout(r, 2000));
    }
    
  } catch (error: any) {
    console.log(`❌ 失败: ${error.message.slice(0, 80)}`);
    failCount++;
  }
}

console.log("");
console.log("=== 充值完成 ===");
console.log(`✅ 成功: ${successCount}/100`);
console.log(`❌ 失败: ${failCount}/100`);
