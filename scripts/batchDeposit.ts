/**
 * 批量给钱包充值 - 使用WETH存入Settlement合约
 */
import { createPublicClient, createWalletClient, http, parseEther, formatEther } from "viem";
import { baseSepolia } from "viem/chains";
import { privateKeyToAccount } from "viem/accounts";
import * as fs from "fs";

const RPC_URL = "https://base-sepolia.g.alchemy.com/v2/Dr8sMe-1MYIF7jBYuZZj8PMOPAAeJ16d";
const SETTLEMENT = "0xB06C32C7536EC5EAD101fEe2AD4005a5eedcB258";
const WETH = "0x4200000000000000000000000000000000000006";

// 充值金额: 0.001 ETH (约 $3.5)
const DEPOSIT_AMOUNT = parseEther("0.001");
const NUM_WALLETS = 50;

const WETH_ABI = [
  { inputs: [], name: "deposit", outputs: [], stateMutability: "payable", type: "function" },
  { inputs: [{ name: "spender", type: "address" }, { name: "amount", type: "uint256" }], name: "approve", outputs: [{ type: "bool" }], stateMutability: "nonpayable", type: "function" },
  { inputs: [{ name: "account", type: "address" }], name: "balanceOf", outputs: [{ type: "uint256" }], stateMutability: "view", type: "function" },
] as const;

const SETTLEMENT_ABI = [
  { inputs: [{ name: "token", type: "address" }, { name: "amount", type: "uint256" }], name: "deposit", outputs: [], stateMutability: "nonpayable", type: "function" },
  { inputs: [{ name: "user", type: "address" }], name: "getUserBalance", outputs: [{ name: "available", type: "uint256" }, { name: "locked", type: "uint256" }], stateMutability: "view", type: "function" },
] as const;

const publicClient = createPublicClient({
  chain: baseSepolia,
  transport: http(RPC_URL),
});

const walletsData = JSON.parse(fs.readFileSync("/Users/qinlinqiu/Desktop/Namespace/scripts/market-maker/wallets.json", "utf-8"));

async function depositForWallet(index: number): Promise<boolean> {
  const wallet = walletsData.wallets[index];
  const account = privateKeyToAccount(wallet.privateKey as `0x${string}`);

  const walletClient = createWalletClient({
    account,
    chain: baseSepolia,
    transport: http(RPC_URL),
  });

  try {
    // 检查ETH余额
    const ethBalance = await publicClient.getBalance({ address: account.address });
    if (ethBalance < DEPOSIT_AMOUNT + parseEther("0.0005")) {
      console.log(`钱包${index}: ETH不足 (${formatEther(ethBalance)} ETH)`);
      return false;
    }

    // 检查Settlement余额
    const settleBalance = await publicClient.readContract({
      address: SETTLEMENT as `0x${string}`,
      abi: SETTLEMENT_ABI,
      functionName: "getUserBalance",
      args: [account.address],
    });

    if (settleBalance[0] > 100000n) {
      console.log(`钱包${index}: 已有余额 ${settleBalance[0]}`);
      return true;
    }

    // 1. Wrap ETH to WETH
    console.log(`钱包${index}: 包装 ETH -> WETH...`);
    const wrapHash = await walletClient.writeContract({
      address: WETH as `0x${string}`,
      abi: WETH_ABI,
      functionName: "deposit",
      value: DEPOSIT_AMOUNT,
    });
    await publicClient.waitForTransactionReceipt({ hash: wrapHash });

    // 2. Approve Settlement to spend WETH
    console.log(`钱包${index}: 授权 WETH...`);
    const approveHash = await walletClient.writeContract({
      address: WETH as `0x${string}`,
      abi: WETH_ABI,
      functionName: "approve",
      args: [SETTLEMENT as `0x${string}`, DEPOSIT_AMOUNT],
    });
    await publicClient.waitForTransactionReceipt({ hash: approveHash });

    // 3. Deposit to Settlement
    console.log(`钱包${index}: 存入 Settlement...`);
    const depositHash = await walletClient.writeContract({
      address: SETTLEMENT as `0x${string}`,
      abi: SETTLEMENT_ABI,
      functionName: "deposit",
      args: [WETH as `0x${string}`, DEPOSIT_AMOUNT],
    });
    await publicClient.waitForTransactionReceipt({ hash: depositHash });

    console.log(`钱包${index}: ✅ 充值完成`);
    return true;
  } catch (e: any) {
    console.log(`钱包${index}: ❌ 失败 - ${e.message?.slice(0, 50)}`);
    return false;
  }
}

async function main() {
  console.log("=== 批量充值 ===\n");
  console.log(`目标: ${NUM_WALLETS}个钱包`);
  console.log(`金额: ${formatEther(DEPOSIT_AMOUNT)} ETH 每个\n`);

  let success = 0;
  let failed = 0;

  // 串行处理，避免RPC限流
  for (let i = 0; i < NUM_WALLETS; i++) {
    const result = await depositForWallet(i);
    if (result) success++;
    else failed++;
    // 每个钱包之间等待500ms
    await new Promise(r => setTimeout(r, 500));
  }

  console.log(`\n=== 完成 ===`);
  console.log(`成功: ${success}`);
  console.log(`失败: ${failed}`);
}

main().catch(console.error);
