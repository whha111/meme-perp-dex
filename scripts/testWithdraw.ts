/**
 * 测试盈利提现
 */
import { createPublicClient, createWalletClient, http, formatEther } from "viem";
import { baseSepolia } from "viem/chains";
import { privateKeyToAccount } from "viem/accounts";
import * as fs from "fs";

const RPC_URL = "https://base-sepolia.g.alchemy.com/v2/Dr8sMe-1MYIF7jBYuZZj8PMOPAAeJ16d";
const SETTLEMENT = "0xB06C32C7536EC5EAD101fEe2AD4005a5eedcB258";
const WETH = "0x4200000000000000000000000000000000000006";

const SETTLEMENT_ABI = [
  { inputs: [{ name: "user", type: "address" }], name: "getUserBalance", outputs: [{ name: "available", type: "uint256" }, { name: "locked", type: "uint256" }], stateMutability: "view", type: "function" },
  { inputs: [{ name: "token", type: "address" }, { name: "amount", type: "uint256" }], name: "withdraw", outputs: [], stateMutability: "nonpayable", type: "function" },
] as const;

const WETH_ABI = [
  { inputs: [{ name: "account", type: "address" }], name: "balanceOf", outputs: [{ type: "uint256" }], stateMutability: "view", type: "function" },
] as const;

async function main() {
  const walletsData = JSON.parse(fs.readFileSync("/Users/qinlinqiu/Desktop/Namespace/scripts/market-maker/wallets.json", "utf-8"));

  // 使用钱包2 (空头获利方)
  const wallet = walletsData.wallets[1];
  const account = privateKeyToAccount(wallet.privateKey as `0x${string}`);

  const publicClient = createPublicClient({
    chain: baseSepolia,
    transport: http(RPC_URL),
  });

  const walletClient = createWalletClient({
    account,
    chain: baseSepolia,
    transport: http(RPC_URL),
  });

  console.log("=== 测试: 盈利提现 ===");
  console.log("钱包:", account.address);

  // 检查Settlement余额
  const balance = await publicClient.readContract({
    address: SETTLEMENT as `0x${string}`,
    abi: SETTLEMENT_ABI,
    functionName: "getUserBalance",
    args: [account.address],
  });
  console.log("\nSettlement余额:");
  console.log("  available:", balance[0].toString());
  console.log("  locked:", balance[1].toString());

  if (balance[0] === 0n) {
    console.log("\n没有可提现余额");
    return;
  }

  // 检查当前WETH余额
  const wethBefore = await publicClient.readContract({
    address: WETH as `0x${string}`,
    abi: WETH_ABI,
    functionName: "balanceOf",
    args: [account.address],
  });
  console.log("\nWETH余额 (提现前):", formatEther(wethBefore));

  // 提现一部分 (10000 internal units)
  const withdrawAmount = 10000n;
  console.log("\n--- 提现 ---");
  console.log("提现金额 (internal):", withdrawAmount.toString());

  try {
    const hash = await walletClient.writeContract({
      address: SETTLEMENT as `0x${string}`,
      abi: SETTLEMENT_ABI,
      functionName: "withdraw",
      args: [WETH as `0x${string}`, withdrawAmount],
    });
    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    console.log("交易状态:", receipt.status === "success" ? "✅ 成功" : "❌ 失败");

    // 检查提现后余额
    const balanceAfter = await publicClient.readContract({
      address: SETTLEMENT as `0x${string}`,
      abi: SETTLEMENT_ABI,
      functionName: "getUserBalance",
      args: [account.address],
    });
    console.log("\nSettlement余额 (提现后):");
    console.log("  available:", balanceAfter[0].toString());
    console.log("  locked:", balanceAfter[1].toString());

    const wethAfter = await publicClient.readContract({
      address: WETH as `0x${string}`,
      abi: WETH_ABI,
      functionName: "balanceOf",
      args: [account.address],
    });
    console.log("\nWETH余额 (提现后):", formatEther(wethAfter));
    console.log("WETH增加:", formatEther(wethAfter - wethBefore));

  } catch (e: any) {
    console.error("提现失败:", e.message?.slice(0, 500));
  }
}

main().catch(console.error);
