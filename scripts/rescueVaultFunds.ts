/**
 * 救援 Vault 资金
 * 通过已授权的 PositionManager 调用 Vault 函数来解锁用户资金
 */
import {
  createPublicClient,
  createWalletClient,
  http,
  formatEther,
  parseEther,
  type Address,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { baseSepolia } from "viem/chains";

const RPC_URL = "https://base-sepolia-rpc.publicnode.com";
const NEW_PM = "0xa3AF42aa965FCBCC9f19b97b7223E881f7C534e0" as Address;
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
    inputs: [{ name: "user", type: "address" }, { name: "collateral", type: "uint256" }, { name: "profit", type: "uint256" }],
    name: "settleProfit",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [{ name: "user", type: "address" }, { name: "amount", type: "uint256" }],
    name: "unlockMargin",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
] as const;

async function main() {
  console.log("=== Vault 资金救援 ===\n");

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
  const vaultTotal = await client.getBalance({ address: VAULT });

  console.log("Vault 总 ETH:", formatEther(vaultTotal), "ETH");
  console.log("用户余额:", formatEther(balance), "ETH");
  console.log("用户锁定:", formatEther(locked), "ETH");

  // 尝试通过 NEW_PM 调用 settleProfit
  // 这会尝试解锁 locked 余额并加到 balance
  console.log("\n尝试调用 settleProfit 解锁资金...");

  try {
    // 使用 NEW_PM 来调用（因为它是授权合约）
    // 但我们是 owner，直接调用可能也行
    const hash = await walletClient.writeContract({
      address: VAULT,
      abi: VAULT_ABI,
      functionName: "settleProfit",
      args: [USER, locked, 0n], // 解锁所有锁定余额，profit=0
    });
    await client.waitForTransactionReceipt({ hash });
    console.log("  ✅ settleProfit 成功");
  } catch (e: any) {
    console.log("  ❌ settleProfit 失败:", e.message?.slice(0, 100));

    // 尝试直接解锁
    console.log("\n尝试直接 unlockMargin...");
    try {
      const hash2 = await walletClient.writeContract({
        address: VAULT,
        abi: VAULT_ABI,
        functionName: "unlockMargin",
        args: [USER, locked],
      });
      await client.waitForTransactionReceipt({ hash: hash2 });
      console.log("  ✅ unlockMargin 成功");
    } catch (e2: any) {
      console.log("  ❌ unlockMargin 失败:", e2.message?.slice(0, 100));
    }
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

main().catch(console.error);
