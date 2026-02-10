import { privateKeyToAccount } from "viem/accounts";
import { createWalletClient, http, parseEther } from "viem";
import { baseSepolia } from "viem/chains";
import fs from "fs";

const CONFIG = {
  RPC_URL: "https://sepolia.base.org",
  SETTLEMENT_ADDRESS: "0x027131BbC5EF6427826F64D12BACAAb447Ee1B13",
  TOKEN_ADDRESS: "0x01eA557E2B17f65604568791Edda8dE1Ae702BE8", // MEME token
  API_URL: "http://localhost:8081",
};

const tradingWallets = JSON.parse(fs.readFileSync("trading-wallets.json", "utf-8"));

console.log("🚀 === 开始做市测试 ===");
console.log(`代币: ${CONFIG.TOKEN_ADDRESS}`);
console.log(`撮合引擎: ${CONFIG.API_URL}`);
console.log(`钱包数量: ${tradingWallets.length}`);
console.log("");
console.log("💡 打开浏览器查看实时效果:");
console.log(`   http://localhost:3000/perp?symbol=${CONFIG.TOKEN_ADDRESS}`);
console.log("");

// TODO: 实现订单签名和提交逻辑
console.log("⏳ 准备提交订单...");
console.log("📊 这将需要实现EIP-712签名和订单提交");
console.log("");
console.log("✅ 测试环境已就绪！");
console.log("📝 下一步: 实现完整的做市逻辑");

