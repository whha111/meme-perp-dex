/**
 * 存入更多WETH到Settlement
 */
import { createPublicClient, createWalletClient, http, parseEther, formatEther } from "viem";
import { baseSepolia } from "viem/chains";
import { privateKeyToAccount } from "viem/accounts";
import * as fs from "fs";

const RPC_URL = "https://base-sepolia.g.alchemy.com/v2/Dr8sMe-1MYIF7jBYuZZj8PMOPAAeJ16d";
const SETTLEMENT = "0xB06C32C7536EC5EAD101fEe2AD4005a5eedcB258";
const WETH = "0x4200000000000000000000000000000000000006";

const WETH_ABI = [
  { inputs: [], name: "deposit", outputs: [], stateMutability: "payable", type: "function" },
  { inputs: [{ name: "account", type: "address" }], name: "balanceOf", outputs: [{ type: "uint256" }], stateMutability: "view", type: "function" },
  { inputs: [{ name: "spender", type: "address" }, { name: "amount", type: "uint256" }], name: "approve", outputs: [{ type: "bool" }], stateMutability: "nonpayable", type: "function" },
] as const;

const SETTLEMENT_ABI = [
  { inputs: [{ name: "token", type: "address" }, { name: "amount", type: "uint256" }], name: "deposit", outputs: [], stateMutability: "nonpayable", type: "function" },
  { inputs: [{ name: "user", type: "address" }], name: "getUserBalance", outputs: [{ name: "available", type: "uint256" }, { name: "locked", type: "uint256" }], stateMutability: "view", type: "function" },
] as const;

async function depositForWallet(walletClient: any, account: any, publicClient: any, name: string) {
  console.log(`\n=== ${name} ===`);
  console.log("地址:", account.address);

  // 检查ETH余额
  const ethBalance = await publicClient.getBalance({ address: account.address });
  console.log("ETH余额:", formatEther(ethBalance));

  if (ethBalance < parseEther("0.01")) {
    console.log("ETH余额不足，跳过");
    return;
  }

  // Wrap 0.005 ETH
  const wrapAmount = parseEther("0.005");
  console.log("Wrap", formatEther(wrapAmount), "ETH...");

  const wrapHash = await walletClient.writeContract({
    address: WETH as `0x${string}`,
    abi: WETH_ABI,
    functionName: "deposit",
    value: wrapAmount,
  });
  await publicClient.waitForTransactionReceipt({ hash: wrapHash });
  console.log("Wrap成功");

  // 授权
  const approveHash = await walletClient.writeContract({
    address: WETH as `0x${string}`,
    abi: WETH_ABI,
    functionName: "approve",
    args: [SETTLEMENT as `0x${string}`, wrapAmount],
  });
  await publicClient.waitForTransactionReceipt({ hash: approveHash });
  console.log("授权成功");

  // 存入
  const depositHash = await walletClient.writeContract({
    address: SETTLEMENT as `0x${string}`,
    abi: SETTLEMENT_ABI,
    functionName: "deposit",
    args: [WETH as `0x${string}`, wrapAmount],
  });
  await publicClient.waitForTransactionReceipt({ hash: depositHash });
  console.log("存入成功");

  // 查询余额
  const balance = await publicClient.readContract({
    address: SETTLEMENT as `0x${string}`,
    abi: SETTLEMENT_ABI,
    functionName: "getUserBalance",
    args: [account.address],
  });
  console.log("Settlement余额 (内部精度6位):");
  console.log("  available:", balance.available.toString(), "=", Number(balance.available) / 1e6, "USDT等值");
  console.log("  locked:", balance.locked.toString());
}

async function main() {
  const walletsData = JSON.parse(fs.readFileSync("/Users/qinlinqiu/Desktop/Namespace/scripts/market-maker/wallets.json", "utf-8"));

  const publicClient = createPublicClient({
    chain: baseSepolia,
    transport: http(RPC_URL),
  });

  // 为前两个钱包存入WETH
  for (let i = 0; i < 2; i++) {
    const wallet = walletsData.wallets[i];
    const account = privateKeyToAccount(wallet.privateKey as `0x${string}`);
    const walletClient = createWalletClient({
      account,
      chain: baseSepolia,
      transport: http(RPC_URL),
    });

    await depositForWallet(walletClient, account, publicClient, `钱包${i + 1}`);
  }

  console.log("\n=== 完成 ===");
}

main().catch(console.error);
