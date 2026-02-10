/**
 * 使用主钱包批量为派生钱包充值 USDT 到 Settlement 合约
 *
 * 流程:
 * 1. 主钱包 mint USDT (100个钱包 × 10,000 USDT = 1,000,000 USDT)
 * 2. 主钱包 approve Settlement 合约
 * 3. 主钱包调用 depositTo 批量充值
 *
 * 优点: 派生钱包不需要 ETH，所有 gas 由主钱包支付
 */

import { createWalletClient, http, parseUnits, createPublicClient } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { baseSepolia } from "viem/chains";
import fs from "fs";

const RPC_URL = "https://sepolia.base.org";
const SETTLEMENT_ADDRESS = "0x027131BbC5EF6427826F64D12BACAAb447Ee1B13";
const USDT_ADDRESS = "0xAa2a6b49C37E0241f9b5385dc4637eDF51026519";

// USDT ABI
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
  },
  {
    inputs: [
      { name: "spender", type: "address" },
      { name: "amount", type: "uint256" }
    ],
    name: "approve",
    outputs: [{ name: "", type: "bool" }],
    stateMutability: "nonpayable",
    type: "function"
  },
  {
    inputs: [{ name: "account", type: "address" }],
    name: "balanceOf",
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
    type: "function"
  }
] as const;

// Settlement ABI
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
  }
] as const;

const mainWallets = JSON.parse(fs.readFileSync("main-wallets.json", "utf-8"));
const tradingWallets = JSON.parse(fs.readFileSync("trading-wallets.json", "utf-8"));

// 使用主钱包#1 (有 6 ETH)
const mainWallet = mainWallets[0];
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

console.log("=== 批量充值 USDT 到 Settlement 合约 ===");
console.log(`主钱包: ${account.address}`);
console.log(`Settlement: ${SETTLEMENT_ADDRESS}`);
console.log(`派生钱包数: ${tradingWallets.length}`);
console.log("");

async function main() {
  try {
    // Step 1: Mint USDT 到主钱包
    const totalUSDT = parseUnits((tradingWallets.length * 10000).toString(), 6); // 1,000,000 USDT
    console.log(`📊 需要充值总额: ${tradingWallets.length * 10000} USDT`);
    console.log("");

    console.log("💰 Step 1: Mint USDT 到主钱包...");
    const mintHash = await walletClient.writeContract({
      address: USDT_ADDRESS,
      abi: USDT_ABI,
      functionName: "mintTo",
      args: [account.address, totalUSDT],
    });
    console.log(`✅ Mint TX: ${mintHash}`);
    console.log("⏳ 等待确认...");
    await new Promise(r => setTimeout(r, 3000));

    // 检查余额
    const balance = await publicClient.readContract({
      address: USDT_ADDRESS,
      abi: USDT_ABI,
      functionName: "balanceOf",
      args: [account.address],
    });
    console.log(`💵 主钱包 USDT 余额: ${Number(balance) / 1e6} USDT`);
    console.log("");

    // Step 2: Approve Settlement
    console.log("🔓 Step 2: Approve Settlement 合约...");
    const approveHash = await walletClient.writeContract({
      address: USDT_ADDRESS,
      abi: USDT_ABI,
      functionName: "approve",
      args: [SETTLEMENT_ADDRESS, totalUSDT],
    });
    console.log(`✅ Approve TX: ${approveHash}`);
    console.log("⏳ 等待确认...");
    await new Promise(r => setTimeout(r, 3000));
    console.log("");

    // Step 3: 批量充值
    console.log("💸 Step 3: 批量调用 depositTo...");
    const amountPerWallet = parseUnits("10000", 6); // 10,000 USDT

    let successCount = 0;
    let failCount = 0;

    for (let i = 0; i < tradingWallets.length; i++) {
      const wallet = tradingWallets[i];

      try {
        console.log(`[${i + 1}/${tradingWallets.length}] 充值到 ${wallet.derivedAddress.slice(0, 12)}...`);

        const depositHash = await walletClient.writeContract({
          address: SETTLEMENT_ADDRESS,
          abi: SETTLEMENT_ABI,
          functionName: "depositTo",
          args: [wallet.derivedAddress, USDT_ADDRESS, amountPerWallet],
        });

        console.log(`  ✅ TX: ${depositHash.slice(0, 20)}...`);
        successCount++;

        // 每 10 个暂停避免限流
        if ((i + 1) % 10 === 0) {
          console.log(`  ⏸️  暂停 2 秒...`);
          await new Promise(r => setTimeout(r, 2000));
        } else {
          // 小暂停避免 nonce 问题
          await new Promise(r => setTimeout(r, 500));
        }

      } catch (error: any) {
        console.log(`  ❌ 失败: ${error.message.slice(0, 100)}`);
        failCount++;
      }
    }

    console.log("");
    console.log("=== 充值完成 ===");
    console.log(`✅ 成功: ${successCount}/${tradingWallets.length}`);
    console.log(`❌ 失败: ${failCount}/${tradingWallets.length}`);

  } catch (error: any) {
    console.error("❌ 致命错误:", error.message);
    console.error(error);
  }
}

main();
