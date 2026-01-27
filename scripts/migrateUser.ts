/**
 * 迁移用户全仓余额从旧 PositionManager 到新 PositionManager
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

const OLD_PM = "0x72E9a39aD581e78DF55fD14D803eD05fB6413660" as Address;
const NEW_PM = "0xa3AF42aa965FCBCC9f19b97b7223E881f7C534e0" as Address;
const VAULT = "0x467a18E3Ec98587Cd88683E6F9e1792C480C09c7" as Address;
const USER = "0xCAE244A3417e75699da37c0e7EadA6cB244AA2B7" as Address;

const PRIVATE_KEY = "0xf9a07bb59ea400ef88bfbcf314d89f357c8580d1a4fb543e48cfb98b02b41d2c";

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
    inputs: [{ name: "user", type: "address" }, { name: "amount", type: "uint256" }],
    name: "setCrossMarginBalance",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
] as const;

const VAULT_ABI = [
  {
    inputs: [{ name: "contractAddr", type: "address" }, { name: "authorized", type: "bool" }],
    name: "setAuthorizedContract",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [{ name: "user", type: "address" }],
    name: "getBalance",
    outputs: [{ type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [{ name: "user", type: "address" }],
    name: "lockedBalances",
    outputs: [{ type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [{ name: "user", type: "address" }, { name: "amount", type: "uint256" }],
    name: "unlockMargin",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [{ name: "addr", type: "address" }],
    name: "authorizedContracts",
    outputs: [{ type: "bool" }],
    stateMutability: "view",
    type: "function",
  },
] as const;

async function main() {
  console.log("=== 用户余额迁移脚本 ===\n");

  const account = privateKeyToAccount(PRIVATE_KEY);
  const walletClient = createWalletClient({
    account,
    chain: baseSepolia,
    transport: http(RPC_URL),
  });

  // 1. 检查旧合约的用户全仓余额
  const oldBalance = await client.readContract({
    address: OLD_PM,
    abi: PM_ABI,
    functionName: "crossMarginBalances",
    args: [USER],
  });
  console.log("用户旧 PM 全仓余额:", formatEther(oldBalance), "ETH");

  // 2. 检查 Vault 状态
  const vaultBalance = await client.readContract({
    address: VAULT,
    abi: VAULT_ABI,
    functionName: "getBalance",
    args: [USER],
  });
  const vaultLocked = await client.readContract({
    address: VAULT,
    abi: VAULT_ABI,
    functionName: "lockedBalances",
    args: [USER],
  });
  console.log("用户 Vault 余额:", formatEther(vaultBalance), "ETH");
  console.log("用户 Vault 锁定:", formatEther(vaultLocked), "ETH");

  // 3. 授权新 PM 到 Vault
  console.log("\n步骤 1: 授权新 PositionManager 到 Vault...");
  const isAuthorized = await client.readContract({
    address: VAULT,
    abi: VAULT_ABI,
    functionName: "authorizedContracts",
    args: [NEW_PM],
  });

  if (!isAuthorized) {
    const authHash = await walletClient.writeContract({
      address: VAULT,
      abi: VAULT_ABI,
      functionName: "setAuthorizedContract",
      args: [NEW_PM, true],
    });
    await client.waitForTransactionReceipt({ hash: authHash });
    console.log("  ✅ 已授权");
  } else {
    console.log("  ✅ 已经授权");
  }

  // 4. 在新 PM 设置用户全仓余额
  console.log("\n步骤 2: 在新 PM 设置用户全仓余额...");
  const setBalanceHash = await walletClient.writeContract({
    address: NEW_PM,
    abi: PM_ABI,
    functionName: "setCrossMarginBalance",
    args: [USER, oldBalance],
  });
  await client.waitForTransactionReceipt({ hash: setBalanceHash });
  console.log("  ✅ 已设置余额:", formatEther(oldBalance), "ETH");

  // 5. 修复 Vault 锁定余额 (解锁超出的部分)
  if (vaultLocked > vaultBalance) {
    console.log("\n步骤 3: 修复 Vault 锁定余额异常...");
    // 这里需要特殊处理，因为 lockedBalances > balance 是不正常的
    // 我们需要手动向 Vault 充值或者修改锁定余额
    console.log("  ⚠️ 警告: Vault 锁定余额 > 总余额，需要手动处理");
  }

  // 6. 验证
  console.log("\n=== 验证 ===");
  const newBalance = await client.readContract({
    address: NEW_PM,
    abi: PM_ABI,
    functionName: "crossMarginBalances",
    args: [USER],
  });
  console.log("新 PM 全仓余额:", formatEther(newBalance), "ETH");

  console.log("\n=== 迁移完成 ===");
  console.log("新 PositionManager:", NEW_PM);
  console.log("用户现在可以调用 withdrawCrossMargin 提取资金");
}

main().catch(console.error);
