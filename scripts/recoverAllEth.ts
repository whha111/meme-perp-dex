/**
 * 回收所有测试 ETH 到 Deployer 钱包
 *
 * 包括：
 * 1. 200个测试钱包中的 ETH
 * 2. Settlement V3 合约中的 ETH
 * 3. Vault 合约中的 ETH
 */

import {
  createPublicClient,
  createWalletClient,
  http,
  formatEther,
  parseEther,
  type Address,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { baseSepolia } from "viem/chains";
import * as fs from "fs";

const RPC_URL = "https://base-sepolia.g.alchemy.com/v2/Dr8sMe-1MYIF7jBYuZZj8PMOPAAeJ16d";
const WALLETS_PATH = "/Users/qinlinqiu/Desktop/Namespace/scripts/market-maker/wallets.json";

// 目标钱包 - Deployer (从私钥推导的正确地址)
const TARGET_ADDRESS = "0x5AF11d4784c3739cf2FD51Fdc272ae4957ADf7fE" as Address;
const DEPLOYER_KEY = "0xf9a07bb59ea400ef88bfbcf314d89f357c8580d1a4fb543e48cfb98b02b41d2c" as Hex;

// 合约地址
const SETTLEMENT_V3 = "0x2F0cb9cb3e96f0733557844e34C5152bFC887aA5" as Address;
const VAULT = "0x467a18E3Ec98587Cd88683E6F9e1792C480C09c7" as Address;

// 保留的 gas 费 (用于发送交易本身)
const GAS_RESERVE = parseEther("0.0001"); // 0.0001 ETH

// Settlement V3 ABI
const SETTLEMENT_V3_ABI = [
  {
    inputs: [{ name: "user", type: "address" }],
    name: "getUserBalance",
    outputs: [
      { name: "available", type: "uint256" },
      { name: "locked", type: "uint256" },
    ],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [{ name: "amount", type: "uint256" }],
    name: "withdraw",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
] as const;

// Vault ABI
const VAULT_ABI = [
  {
    inputs: [{ name: "user", type: "address" }],
    name: "getBalance",
    outputs: [{ type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [{ name: "amount", type: "uint256" }],
    name: "withdraw",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
] as const;

interface Wallet {
  privateKey: string;
  address: string;
  index: number;
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function main() {
  const client = createPublicClient({
    chain: baseSepolia,
    transport: http(RPC_URL),
  });

  const deployerAccount = privateKeyToAccount(DEPLOYER_KEY);
  const deployerClient = createWalletClient({
    account: deployerAccount,
    chain: baseSepolia,
    transport: http(RPC_URL),
  });

  console.log("=== 回收所有测试 ETH ===\n");
  console.log("目标地址: " + TARGET_ADDRESS + "\n");

  let totalRecovered = 0n;

  // ==========================================
  // 1. 从 200 个测试钱包回收 ETH
  // ==========================================
  console.log("--- 1. 从测试钱包回收 ETH ---\n");

  const data = JSON.parse(fs.readFileSync(WALLETS_PATH, "utf-8"));
  const wallets: Wallet[] = data.wallets;

  let walletRecovered = 0n;
  let successCount = 0;
  let skipCount = 0;

  for (let i = 0; i < wallets.length; i++) {
    const wallet = wallets[i];
    const address = wallet.address as Address;

    try {
      const balance = await client.getBalance({ address });

      // 如果余额太少，跳过
      if (balance <= GAS_RESERVE * 2n) {
        skipCount++;
        continue;
      }

      // 计算可转出金额（保留 gas）
      const transferAmount = balance - GAS_RESERVE;

      const account = privateKeyToAccount(wallet.privateKey as Hex);
      const walletClient = createWalletClient({
        account,
        chain: baseSepolia,
        transport: http(RPC_URL),
      });

      // 发送交易
      const hash = await walletClient.sendTransaction({
        to: TARGET_ADDRESS,
        value: transferAmount,
      });

      console.log("[" + i + "] " + formatEther(transferAmount) + " ETH - tx: " + hash.slice(0, 18) + "...");

      walletRecovered += transferAmount;
      successCount++;

      // 等待一下避免 rate limit
      await sleep(200);
    } catch (e: any) {
      console.log("[" + i + "] Error: " + e.message.slice(0, 50));
    }

    // 进度显示
    if ((i + 1) % 50 === 0) {
      console.log("\n已处理 " + (i + 1) + "/200 个钱包...\n");
    }
  }

  console.log("\n测试钱包回收完成:");
  console.log("  成功: " + successCount + " 个钱包");
  console.log("  跳过: " + skipCount + " 个钱包 (余额太少)");
  console.log("  回收: " + formatEther(walletRecovered) + " ETH\n");

  totalRecovered += walletRecovered;

  // ==========================================
  // 2. 从 Settlement V3 回收 ETH
  // ==========================================
  console.log("--- 2. 从 Settlement V3 回收 ETH ---\n");

  // 检查每个测试钱包在 Settlement V3 的余额并 withdraw
  for (let i = 0; i < wallets.length; i++) {
    const wallet = wallets[i];
    const address = wallet.address as Address;

    try {
      const [available, locked] = await client.readContract({
        address: SETTLEMENT_V3,
        abi: SETTLEMENT_V3_ABI,
        functionName: "getUserBalance",
        args: [address],
      });

      if (available > 0n) {
        const account = privateKeyToAccount(wallet.privateKey as Hex);
        const walletClient = createWalletClient({
          account,
          chain: baseSepolia,
          transport: http(RPC_URL),
        });

        // Withdraw from Settlement
        const hash = await walletClient.writeContract({
          address: SETTLEMENT_V3,
          abi: SETTLEMENT_V3_ABI,
          functionName: "withdraw",
          args: [available],
        });

        console.log("[" + i + "] Settlement V3 withdraw " + formatEther(available) + " ETH - tx: " + hash.slice(0, 18) + "...");

        totalRecovered += available;
        await sleep(500);
      }
    } catch (e: any) {
      // 忽略错误
    }
  }

  // ==========================================
  // 3. 从 Vault 回收 ETH
  // ==========================================
  console.log("\n--- 3. 从 Vault 回收 ETH ---\n");

  for (let i = 0; i < Math.min(wallets.length, 50); i++) {
    const wallet = wallets[i];
    const address = wallet.address as Address;

    try {
      const balance = await client.readContract({
        address: VAULT,
        abi: VAULT_ABI,
        functionName: "getBalance",
        args: [address],
      });

      if (balance > 0n) {
        const account = privateKeyToAccount(wallet.privateKey as Hex);
        const walletClient = createWalletClient({
          account,
          chain: baseSepolia,
          transport: http(RPC_URL),
        });

        const hash = await walletClient.writeContract({
          address: VAULT,
          abi: VAULT_ABI,
          functionName: "withdraw",
          args: [balance],
        });

        console.log("[" + i + "] Vault withdraw " + formatEther(balance) + " ETH - tx: " + hash.slice(0, 18) + "...");

        totalRecovered += balance;
        await sleep(500);
      }
    } catch (e: any) {
      // 忽略错误
    }
  }

  // ==========================================
  // 4. 最终汇总 - 再次从测试钱包转出
  // ==========================================
  console.log("\n--- 4. 第二轮回收（从 withdraw 后的钱包）---\n");

  await sleep(3000); // 等待前面的交易确认

  let secondRoundRecovered = 0n;

  for (let i = 0; i < wallets.length; i++) {
    const wallet = wallets[i];
    const address = wallet.address as Address;

    try {
      const balance = await client.getBalance({ address });

      if (balance > GAS_RESERVE * 2n) {
        const transferAmount = balance - GAS_RESERVE;

        const account = privateKeyToAccount(wallet.privateKey as Hex);
        const walletClient = createWalletClient({
          account,
          chain: baseSepolia,
          transport: http(RPC_URL),
        });

        const hash = await walletClient.sendTransaction({
          to: TARGET_ADDRESS,
          value: transferAmount,
        });

        console.log("[" + i + "] " + formatEther(transferAmount) + " ETH - tx: " + hash.slice(0, 18) + "...");
        secondRoundRecovered += transferAmount;
        await sleep(200);
      }
    } catch (e: any) {
      // 忽略
    }
  }

  totalRecovered += secondRoundRecovered;
  console.log("\n第二轮回收: " + formatEther(secondRoundRecovered) + " ETH");

  // ==========================================
  // 最终统计
  // ==========================================
  console.log("\n=== 回收完成 ===\n");

  const targetBalance = await client.getBalance({ address: TARGET_ADDRESS });
  console.log("目标钱包最终余额: " + formatEther(targetBalance) + " ETH");
  console.log("本次回收总计: ~" + formatEther(totalRecovered) + " ETH");
}

main().catch(console.error);
