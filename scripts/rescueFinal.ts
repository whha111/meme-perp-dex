import { createPublicClient, createWalletClient, http, formatEther, parseEther, type Address } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { baseSepolia } from "viem/chains";

const RPC_URL = "https://base-sepolia-rpc.publicnode.com";
const NEW_PM = "0x5eedddef0cb860adcdd148b880de4ae4b5cb82e7" as Address;
const VAULT = "0x467a18E3Ec98587Cd88683E6F9e1792C480C09c7" as Address;
const USER = "0xCAE244A3417e75699da37c0e7EadA6cB244AA2B7" as Address;
const DEPLOYER_KEY = "0xf9a07bb59ea400ef88bfbcf314d89f357c8580d1a4fb543e48cfb98b02b41d2c";

const client = createPublicClient({
  chain: baseSepolia,
  transport: http(RPC_URL),
});

const account = privateKeyToAccount(DEPLOYER_KEY);
const walletClient = createWalletClient({
  account,
  chain: baseSepolia,
  transport: http(RPC_URL),
});

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
    inputs: [{ name: "addr", type: "address" }],
    name: "authorizedContracts",
    outputs: [{ type: "bool" }],
    stateMutability: "view",
    type: "function",
  },
] as const;

const PM_ABI = [
  {
    inputs: [{ name: "user", type: "address" }, { name: "amount", type: "uint256" }],
    name: "rescueUnlockMargin",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [{ name: "user", type: "address" }, { name: "collateral", type: "uint256" }, { name: "profit", type: "uint256" }],
    name: "rescueSettleProfit",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
] as const;

async function main() {
  console.log("=== 救援资金 ===\n");

  // 1. 检查并授权新 PM
  console.log("步骤 1: 检查/授权新 PositionManager...");
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

  // 检查当前状态
  const balance = await client.readContract({
    address: VAULT,
    abi: VAULT_ABI,
    functionName: "getBalance",
    args: [USER],
  });
  const locked = await client.readContract({
    address: VAULT,
    abi: VAULT_ABI,
    functionName: "lockedBalances",
    args: [USER],
  });
  console.log("\n用户当前 Vault 状态:");
  console.log("  余额:", formatEther(balance), "ETH");
  console.log("  锁定:", formatEther(locked), "ETH");

  // 2. 通过新 PM 调用 rescueSettleProfit
  console.log("\n步骤 2: 调用 rescueSettleProfit 解锁资金...");
  try {
    const rescueHash = await walletClient.writeContract({
      address: NEW_PM,
      abi: PM_ABI,
      functionName: "rescueSettleProfit",
      args: [USER, locked, 0n],
    });
    await client.waitForTransactionReceipt({ hash: rescueHash });
    console.log("  ✅ 解锁成功");
  } catch (e: any) {
    console.log("  ❌ 解锁失败:", e.message?.slice(0, 150));
  }

  // 检查新状态
  const newBalance = await client.readContract({
    address: VAULT,
    abi: VAULT_ABI,
    functionName: "getBalance",
    args: [USER],
  });
  const newLocked = await client.readContract({
    address: VAULT,
    abi: VAULT_ABI,
    functionName: "lockedBalances",
    args: [USER],
  });

  console.log("\n=== 新状态 ===");
  console.log("用户余额:", formatEther(newBalance), "ETH");
  console.log("用户锁定:", formatEther(newLocked), "ETH");
  console.log("可提取:", formatEther(newBalance - newLocked), "ETH");
}

main().catch((e) => console.log("错误:", e.message?.slice(0, 200)));
