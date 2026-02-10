/**
 * 测试单个钱包的充值流程
 */

import { createWalletClient, createPublicClient, http, parseUnits } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { baseSepolia } from "viem/chains";
import fs from "fs";

const RPC_URL = "https://sepolia.base.org";
const SETTLEMENT_ADDRESS = "0x027131BbC5EF6427826F64D12BACAAb447Ee1B13";
const USDT_ADDRESS = "0xAa2a6b49C37E0241f9b5385dc4637eDF51026519";

const SETTLEMENT_ABI = [
  {
    inputs: [
      { name: "recipient", type: "address" },
      { name: "token", type: "address" },
      { name: "amount", type: "uint256" }
    ],
    name: "depositTo",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function"
  },
  {
    inputs: [{ name: "user", type: "address" }],
    name: "getUserBalance",
    outputs: [
      { name: "available", type: "uint256" },
      { name: "locked", type: "uint256" }
    ],
    stateMutability: "view",
    type: "function"
  }
] as const;

const mainWallets = JSON.parse(fs.readFileSync("main-wallets.json", "utf-8"));
const tradingWallets = JSON.parse(fs.readFileSync("trading-wallets.json", "utf-8"));

const mainWallet = mainWallets[0];
const testWallet = tradingWallets[0];

const account = privateKeyToAccount(mainWallet.privateKey as any);

const walletClient = createWalletClient({
  account,
  chain: baseSepolia,
  transport: http(RPC_URL),
});

const publicClient = createPublicClient({
  chain: baseSepolia,
  transport: http(RPC_URL),
});

console.log("=== 测试单个钱包充值 ===");
console.log(`主钱包: ${account.address}`);
console.log(`测试钱包: ${testWallet.derivedAddress}`);
console.log("");

async function main() {
  try {
    // 1. 检查充值前余额
    console.log("1. 检查充值前余额...");
    const [beforeAvailable, beforeLocked] = await publicClient.readContract({
      address: SETTLEMENT_ADDRESS,
      abi: SETTLEMENT_ABI,
      functionName: "getUserBalance",
      args: [testWallet.derivedAddress],
    }) as [bigint, bigint];

    console.log(`   可用余额: ${Number(beforeAvailable) / 1e6} USDT`);
    console.log(`   锁定余额: ${Number(beforeLocked) / 1e6} USDT`);
    console.log("");

    // 2. 充值
    const amount = parseUnits("1000", 6); // 测试充值1000 USDT
    console.log("2. 执行 depositTo...");
    console.log(`   金额: 1000 USDT`);

    const hash = await walletClient.writeContract({
      address: SETTLEMENT_ADDRESS,
      abi: SETTLEMENT_ABI,
      functionName: "depositTo",
      args: [testWallet.derivedAddress, USDT_ADDRESS, amount],
    });

    console.log(`   TX: ${hash}`);
    console.log("   等待确认...");
    await new Promise(r => setTimeout(r, 5000));
    console.log("");

    // 3. 检查交易状态
    console.log("3. 检查交易状态...");
    try {
      const receipt = await publicClient.getTransactionReceipt({ hash });
      console.log(`   状态: ${receipt.status === "success" ? "✅ 成功" : "❌ 失败"}`);
      console.log(`   Gas used: ${receipt.gasUsed}`);
      if (receipt.status !== "success") {
        console.log("   ⚠️  交易被revert了！");
      }
    } catch (e: any) {
      console.log(`   ❌ 获取receipt失败: ${e.message}`);
    }
    console.log("");

    // 4. 检查充值后余额
    console.log("4. 检查充值后余额...");
    const [afterAvailable, afterLocked] = await publicClient.readContract({
      address: SETTLEMENT_ADDRESS,
      abi: SETTLEMENT_ABI,
      functionName: "getUserBalance",
      args: [testWallet.derivedAddress],
    }) as [bigint, bigint];

    console.log(`   可用余额: ${Number(afterAvailable) / 1e6} USDT`);
    console.log(`   锁定余额: ${Number(afterLocked) / 1e6} USDT`);
    console.log(`   增加: ${Number(afterAvailable - beforeAvailable) / 1e6} USDT`);

  } catch (error: any) {
    console.error("❌ 错误:", error.message);
    console.error(error);
  }
}

main();
