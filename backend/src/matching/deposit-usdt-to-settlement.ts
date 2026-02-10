/**
 * 将派生钱包的 USDT 充值到 Settlement 合约
 *
 * 流程:
 * 1. 加载所有派生钱包
 * 2. 每个钱包 approve USDT 到 Settlement
 * 3. 每个钱包 deposit USDT 到 Settlement
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
      { name: "token", type: "address" },
      { name: "amount", type: "uint256" }
    ],
    name: "deposit",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function"
  }
] as const;

const tradingWallets = JSON.parse(fs.readFileSync("trading-wallets.json", "utf-8"));

console.log("=== 开始充值 USDT 到 Settlement 合约 ===");
console.log(`Settlement: ${SETTLEMENT_ADDRESS}`);
console.log(`USDT: ${USDT_ADDRESS}`);
console.log(`钱包数量: ${tradingWallets.length}`);
console.log("");

let successCount = 0;
let failCount = 0;

const publicClient = createPublicClient({
  chain: baseSepolia,
  transport: http(RPC_URL),
});

for (let i = 0; i < tradingWallets.length; i++) {
  const wallet = tradingWallets[i];
  const account = privateKeyToAccount(wallet.privateKey as any);

  const walletClient = createWalletClient({
    account,
    chain: baseSepolia,
    transport: http(RPC_URL),
  });

  try {
    console.log(`[${i + 1}/${tradingWallets.length}] ${wallet.derivedAddress.slice(0, 12)}...`);

    // 1. 检查 USDT 余额
    const balance = await publicClient.readContract({
      address: USDT_ADDRESS,
      abi: USDT_ABI,
      functionName: "balanceOf",
      args: [account.address],
    });

    const balanceFormatted = Number(balance) / 1e6;
    console.log(`  💵 USDT 余额: ${balanceFormatted.toFixed(2)}`);

    if (balance === 0n) {
      console.log(`  ⚠️  跳过 (余额为0)`);
      failCount++;
      continue;
    }

    // 2. Approve USDT
    console.log(`  🔓 Approve USDT...`);
    const approveHash = await walletClient.writeContract({
      address: USDT_ADDRESS,
      abi: USDT_ABI,
      functionName: "approve",
      args: [SETTLEMENT_ADDRESS, balance],
    });
    console.log(`  ✅ Approve TX: ${approveHash.slice(0, 20)}...`);

    // 等待确认
    await new Promise(r => setTimeout(r, 2000));

    // 3. Deposit to Settlement
    console.log(`  💰 Deposit 到 Settlement...`);
    const depositHash = await walletClient.writeContract({
      address: SETTLEMENT_ADDRESS,
      abi: SETTLEMENT_ABI,
      functionName: "deposit",
      args: [USDT_ADDRESS, balance],
    });
    console.log(`  ✅ Deposit TX: ${depositHash.slice(0, 20)}...`);

    successCount++;

    // 每 5 个暂停避免限流
    if ((i + 1) % 5 === 0) {
      console.log(`  ⏸️  暂停 2 秒...`);
      await new Promise(r => setTimeout(r, 2000));
    }

  } catch (error: any) {
    console.log(`  ❌ 失败: ${error.message.slice(0, 100)}`);
    failCount++;
  }

  console.log("");
}

console.log("=== 充值完成 ===");
console.log(`✅ 成功: ${successCount}/${tradingWallets.length}`);
console.log(`❌ 失败: ${failCount}/${tradingWallets.length}`);
