/**
 * 添加 USDT 到 Settlement 合约的支持代币列表
 */

import { createWalletClient, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { baseSepolia } from "viem/chains";

const RPC_URL = "https://sepolia.base.org";
const SETTLEMENT_ADDRESS = "0x027131BbC5EF6427826F64D12BACAAb447Ee1B13";
const USDT_ADDRESS = "0xAa2a6b49C37E0241f9b5385dc4637eDF51026519";
const DEPLOYER_KEY = "0xf9a07bb59ea400ef88bfbcf314d89f357c8580d1a4fb543e48cfb98b02b41d2c";

const SETTLEMENT_ABI = [
  {
    inputs: [
      { name: "token", type: "address" },
      { name: "decimals", type: "uint8" }
    ],
    name: "addSupportedToken",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function"
  }
] as const;

const account = privateKeyToAccount(DEPLOYER_KEY as any);

const client = createWalletClient({
  account,
  chain: baseSepolia,
  transport: http(RPC_URL),
});

console.log("=== 添加 USDT 到 Settlement 支持列表 ===");
console.log(`Deployer: ${account.address}`);
console.log(`Settlement: ${SETTLEMENT_ADDRESS}`);
console.log(`USDT: ${USDT_ADDRESS}`);
console.log("");

async function main() {
  try {
    console.log("🔧 调用 addSupportedToken...");

    const hash = await client.writeContract({
      address: SETTLEMENT_ADDRESS,
      abi: SETTLEMENT_ABI,
      functionName: "addSupportedToken",
      args: [USDT_ADDRESS, 6], // USDT has 6 decimals
    });

    console.log(`✅ TX: ${hash}`);
    console.log("⏳ 等待确认...");
    await new Promise(r => setTimeout(r, 5000));
    console.log("✅ USDT 已添加到支持列表！");

  } catch (error: any) {
    console.error("❌ 失败:", error.message);
    console.error(error);
  }
}

main();
