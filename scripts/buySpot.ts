/**
 * Buy Spot Tokens Script
 * Buys tokens to push up the price
 */

import {
  createPublicClient,
  createWalletClient,
  http,
  parseEther,
  formatEther,
  formatUnits,
  type Address,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { baseSepolia } from "viem/chains";
import * as fs from "fs";
import * as path from "path";

const RPC_URL = "https://base-sepolia.g.alchemy.com/v2/Dr8sMe-1MYIF7jBYuZZj8PMOPAAeJ16d";

// COP400 Token
const TARGET_TOKEN = "0x6Bf5C512a5714D610379b1EA0Dec0BEFb46888f7" as Address;

const CONTRACTS = {
  TOKEN_FACTORY: "0xE0ddf67E89f5773c960Bc2329109815E8c66BAAe" as Address,
  PRICE_FEED: "0xd69A4DB60cEc962A46C6B9Bc8CC0883081c4eFb7" as Address,
};

const TOKEN_FACTORY_ABI = [
  {
    inputs: [
      { name: "tokenAddress", type: "address" },
      { name: "minTokensOut", type: "uint256" },
    ],
    name: "buy",
    outputs: [],
    stateMutability: "payable",
    type: "function",
  },
  {
    inputs: [{ name: "tokenAddress", type: "address" }],
    name: "getPoolState",
    outputs: [{
      components: [
        { name: "realETHReserve", type: "uint256" },
        { name: "realTokenReserve", type: "uint256" },
        { name: "soldTokens", type: "uint256" },
        { name: "isGraduated", type: "bool" },
        { name: "isActive", type: "bool" },
        { name: "creator", type: "address" },
        { name: "createdAt", type: "uint64" },
        { name: "metadataURI", type: "string" },
      ],
      type: "tuple",
    }],
    stateMutability: "view",
    type: "function",
  },
] as const;

const PRICE_FEED_ABI = [
  {
    inputs: [{ name: "token", type: "address" }],
    name: "getTokenMarkPrice",
    outputs: [{ type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
] as const;

interface Wallet {
  privateKey: string;
  address: string;
  index: number;
}

function loadWallets(): Wallet[] {
  const walletsPath = "/Users/qinlinqiu/Desktop/Namespace/scripts/market-maker/wallets.json";
  const data = fs.readFileSync(walletsPath, "utf-8");
  return JSON.parse(data).wallets;
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function main() {
  console.log("========== 现货买入脚本 ==========\n");
  console.log(`目标代币: COP400 (${TARGET_TOKEN})\n`);

  const publicClient = createPublicClient({
    chain: baseSepolia,
    transport: http(RPC_URL),
  });

  // 获取初始价格
  const initialPrice = await publicClient.readContract({
    address: CONTRACTS.PRICE_FEED,
    abi: PRICE_FEED_ABI,
    functionName: "getTokenMarkPrice",
    args: [TARGET_TOKEN],
  });
  console.log(`初始标记价格: ${formatUnits(initialPrice, 18)} ETH\n`);

  // 获取初始池子状态
  const initialPool = await publicClient.readContract({
    address: CONTRACTS.TOKEN_FACTORY,
    abi: TOKEN_FACTORY_ABI,
    functionName: "getPoolState",
    args: [TARGET_TOKEN],
  });
  console.log(`初始ETH储备: ${formatEther(initialPool.realETHReserve)} ETH`);
  console.log(`初始代币储备: ${formatEther(initialPool.realTokenReserve)}\n`);

  const wallets = loadWallets();

  // 找有余额的钱包
  const eligibleWallets: Wallet[] = [];
  for (const wallet of wallets.slice(0, 50)) {
    const balance = await publicClient.getBalance({ address: wallet.address as Address });
    if (balance >= parseEther("0.01")) {
      eligibleWallets.push(wallet);
    }
    if (eligibleWallets.length >= 20) break;
  }

  console.log(`找到 ${eligibleWallets.length} 个有余额的钱包\n`);
  console.log("开始批量买入...\n");

  let successCount = 0;
  let totalEthSpent = 0n;

  // 批量买入
  for (let i = 0; i < Math.min(10, eligibleWallets.length); i++) {
    const wallet = eligibleWallets[i];
    const buyAmount = parseEther("0.005"); // 每个钱包买 0.005 ETH

    const account = privateKeyToAccount(wallet.privateKey as `0x${string}`);
    const walletClient = createWalletClient({
      account,
      chain: baseSepolia,
      transport: http(RPC_URL),
    });

    try {
      console.log(`[Wallet ${wallet.index}] 买入 ${formatEther(buyAmount)} ETH...`);

      const hash = await walletClient.writeContract({
        address: CONTRACTS.TOKEN_FACTORY,
        abi: TOKEN_FACTORY_ABI,
        functionName: "buy",
        args: [TARGET_TOKEN, 0n],
        value: buyAmount,
      });

      await publicClient.waitForTransactionReceipt({ hash });
      console.log(`  ✅ 成功 - tx: ${hash.slice(0, 20)}...`);
      successCount++;
      totalEthSpent += buyAmount;

      // 每次买入后检查价格
      const currentPrice = await publicClient.readContract({
        address: CONTRACTS.PRICE_FEED,
        abi: PRICE_FEED_ABI,
        functionName: "getTokenMarkPrice",
        args: [TARGET_TOKEN],
      });
      console.log(`  当前价格: ${formatUnits(currentPrice, 18)} ETH\n`);

    } catch (e: any) {
      console.log(`  ❌ 失败: ${e.message?.slice(0, 50)}\n`);
    }

    await sleep(500);
  }

  // 最终状态
  console.log("\n========== 买入完成 ==========\n");

  const finalPrice = await publicClient.readContract({
    address: CONTRACTS.PRICE_FEED,
    abi: PRICE_FEED_ABI,
    functionName: "getTokenMarkPrice",
    args: [TARGET_TOKEN],
  });

  const finalPool = await publicClient.readContract({
    address: CONTRACTS.TOKEN_FACTORY,
    abi: TOKEN_FACTORY_ABI,
    functionName: "getPoolState",
    args: [TARGET_TOKEN],
  });

  console.log(`成功买入: ${successCount} 笔`);
  console.log(`总花费: ${formatEther(totalEthSpent)} ETH`);
  console.log(`\n价格变化:`);
  console.log(`  初始: ${formatUnits(initialPrice, 18)} ETH`);
  console.log(`  最终: ${formatUnits(finalPrice, 18)} ETH`);

  const priceChange = ((Number(finalPrice) - Number(initialPrice)) / Number(initialPrice) * 100);
  console.log(`  涨幅: ${priceChange.toFixed(4)}%`);

  console.log(`\n池子变化:`);
  console.log(`  ETH储备: ${formatEther(initialPool.realETHReserve)} -> ${formatEther(finalPool.realETHReserve)} ETH`);

  console.log("\n你现在可以去检查你的永续合约仓位盈亏了！");
}

main().catch(console.error);
