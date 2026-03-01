/**
 * 提取全仓余额到 Vault
 * 用户执行此脚本来提取自己的全仓盈利
 */
import {
  createPublicClient,
  createWalletClient,
  http,
  formatEther,
  type Address,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { baseSepolia } from "viem/chains";

const RPC_URL = "https://base-sepolia-rpc.publicnode.com";

const NEW_PM = "0xa3AF42aa965FCBCC9f19b97b7223E881f7C534e0" as Address;
const VAULT = "0x467a18E3Ec98587Cd88683E6F9e1792C480C09c7" as Address;

// AUDIT-FIX DP-C01: Read key from env
const USER_PRIVATE_KEY = (process.env.DEPLOYER_PRIVATE_KEY || process.env.PRIVATE_KEY) as `0x${string}`;
if (!USER_PRIVATE_KEY) { console.error("Set DEPLOYER_PRIVATE_KEY env var"); process.exit(1); }

const client = createPublicClient({
  chain: baseSepolia,
  transport: http(RPC_URL),
});

const PM_ABI = [
  {
    inputs: [{ name: "user", type: "address" }],
    name: "crossMarginBalances",
    outputs: [{ type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [{ name: "amount", type: "uint256" }],
    name: "withdrawCrossMargin",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
] as const;

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

async function main() {
  console.log("=== 提取全仓余额 ===\n");

  const account = privateKeyToAccount(USER_PRIVATE_KEY);
  const walletClient = createWalletClient({
    account,
    chain: baseSepolia,
    transport: http(RPC_URL),
  });

  console.log("用户地址:", account.address);

  // 1. 检查全仓余额
  const crossBalance = await client.readContract({
    address: NEW_PM,
    abi: PM_ABI,
    functionName: "crossMarginBalances",
    args: [account.address],
  });
  console.log("全仓余额:", formatEther(crossBalance), "ETH");

  if (crossBalance === 0n) {
    console.log("没有全仓余额可提取");
    return;
  }

  // 2. 检查 Vault 余额 (提取前)
  const vaultBalanceBefore = await client.readContract({
    address: VAULT,
    abi: VAULT_ABI,
    functionName: "getBalance",
    args: [account.address],
  });
  console.log("Vault 余额 (提取前):", formatEther(vaultBalanceBefore), "ETH");

  // 3. 调用 withdrawCrossMargin
  console.log("\n正在提取全仓余额到 Vault...");
  try {
    const withdrawHash = await walletClient.writeContract({
      address: NEW_PM,
      abi: PM_ABI,
      functionName: "withdrawCrossMargin",
      args: [crossBalance],
    });
    const receipt = await client.waitForTransactionReceipt({ hash: withdrawHash });

    if (receipt.status === "success") {
      console.log("  ✅ 提取成功!");
      console.log("  交易:", withdrawHash);
    } else {
      console.log("  ❌ 提取失败");
      return;
    }
  } catch (e: any) {
    console.log("  ❌ 错误:", e.message?.slice(0, 200));
    return;
  }

  // 4. 检查 Vault 余额 (提取后)
  const vaultBalanceAfter = await client.readContract({
    address: VAULT,
    abi: VAULT_ABI,
    functionName: "getBalance",
    args: [account.address],
  });
  console.log("\nVault 余额 (提取后):", formatEther(vaultBalanceAfter), "ETH");

  // 5. 检查新的全仓余额
  const newCrossBalance = await client.readContract({
    address: NEW_PM,
    abi: PM_ABI,
    functionName: "crossMarginBalances",
    args: [account.address],
  });
  console.log("全仓余额 (提取后):", formatEther(newCrossBalance), "ETH");

  console.log("\n=== 提取完成 ===");
  console.log("提取金额:", formatEther(crossBalance), "ETH");
  console.log("Vault 余额增加:", formatEther(vaultBalanceAfter - vaultBalanceBefore), "ETH");
  console.log("\n现在可以从 Vault 提取 ETH 到钱包了");
}

main().catch(console.error);
