/**
 * 拉盘测试脚本 - 测试合约价格与现货价格锚定
 * Token: 123 (0x01c6058175eDA34Fc8922EeAe32BC383CB203211)
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

const RPC_URL = "https://base-sepolia.g.alchemy.com/v2/Dr8sMe-1MYIF7jBYuZZj8PMOPAAeJ16d";

// 123 Token
const TARGET_TOKEN = "0x01c6058175eDA34Fc8922EeAe32BC383CB203211" as Address;

const CONTRACTS = {
  TOKEN_FACTORY: "0xCfDCD9F8D39411cF855121331B09aef1C88dc056" as Address,
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
  {
    inputs: [{ name: "tokenAddress", type: "address" }],
    name: "getTokenPrice",
    outputs: [{ type: "uint256" }],
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
  {
    inputs: [{ name: "token", type: "address" }],
    name: "getSpotPrice",
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

async function getPrices(publicClient: any): Promise<{
  spotPrice: bigint;
  markPrice: bigint;
  poolState: any;
}> {
  const [spotPrice, markPrice, poolState] = await Promise.all([
    publicClient.readContract({
      address: CONTRACTS.TOKEN_FACTORY,
      abi: TOKEN_FACTORY_ABI,
      functionName: "getTokenPrice",
      args: [TARGET_TOKEN],
    }).catch(() => 0n),
    publicClient.readContract({
      address: CONTRACTS.PRICE_FEED,
      abi: PRICE_FEED_ABI,
      functionName: "getTokenMarkPrice",
      args: [TARGET_TOKEN],
    }).catch(() => 0n),
    publicClient.readContract({
      address: CONTRACTS.TOKEN_FACTORY,
      abi: TOKEN_FACTORY_ABI,
      functionName: "getPoolState",
      args: [TARGET_TOKEN],
    }),
  ]);

  return { spotPrice, markPrice, poolState };
}

function formatPrice(price: bigint): string {
  // 价格单位: 6 decimals (USD with 6 decimals)
  const usd = Number(price) / 1e6;
  return `$${usd.toFixed(10)}`;
}

async function main() {
  console.log("╔═══════════════════════════════════════════════════════════╗");
  console.log("║     拉盘测试 - 合约价格与现货价格锚定验证                    ║");
  console.log("╠═══════════════════════════════════════════════════════════╣");
  console.log(`║ 目标代币: 123 (${TARGET_TOKEN.slice(0, 10)}...)     ║`);
  console.log("╚═══════════════════════════════════════════════════════════╝\n");

  const publicClient = createPublicClient({
    chain: baseSepolia,
    transport: http(RPC_URL),
  });

  // 获取初始价格
  console.log("📊 获取初始价格状态...\n");
  const initial = await getPrices(publicClient);

  console.log("┌─────────────────────────────────────────────────────────┐");
  console.log("│ 初始状态                                                │");
  console.log("├─────────────────────────────────────────────────────────┤");
  console.log(`│ 现货价格 (TokenFactory): ${formatPrice(initial.spotPrice).padEnd(20)}│`);
  console.log(`│ 合约价格 (PriceFeed):    ${formatPrice(initial.markPrice).padEnd(20)}│`);
  console.log(`│ ETH储备:                 ${formatEther(initial.poolState.realETHReserve).slice(0, 12).padEnd(20)}│`);
  console.log("└─────────────────────────────────────────────────────────┘\n");

  // 加载钱包
  const wallets = loadWallets();
  console.log(`📁 已加载 ${wallets.length} 个测试钱包\n`);

  // 找有余额的钱包
  console.log("🔍 检查钱包余额...");
  const eligibleWallets: Wallet[] = [];
  for (const wallet of wallets.slice(0, 100)) {
    const balance = await publicClient.getBalance({ address: wallet.address as Address });
    if (balance >= parseEther("0.002")) {
      eligibleWallets.push(wallet);
    }
    if (eligibleWallets.length >= 50) break;
  }

  console.log(`✅ 找到 ${eligibleWallets.length} 个有余额的钱包\n`);

  if (eligibleWallets.length === 0) {
    console.log("❌ 没有找到有足够余额的钱包！请先给钱包充值。");
    return;
  }

  // 开始批量买入
  console.log("═══════════════════════════════════════════════════════════");
  console.log("                    开始批量买入拉盘                        ");
  console.log("═══════════════════════════════════════════════════════════\n");

  let successCount = 0;
  let totalEthSpent = 0n;
  const priceHistory: { round: number; spotPrice: string; markPrice: string; premium: string }[] = [];

  const TOTAL_ROUNDS = Math.min(30, eligibleWallets.length);
  const BUY_AMOUNT = parseEther("0.001"); // 每次买入 0.001 ETH

  for (let i = 0; i < TOTAL_ROUNDS; i++) {
    const wallet = eligibleWallets[i];

    const account = privateKeyToAccount(wallet.privateKey as `0x${string}`);
    const walletClient = createWalletClient({
      account,
      chain: baseSepolia,
      transport: http(RPC_URL),
    });

    try {
      process.stdout.write(`[${(i + 1).toString().padStart(2)}/${TOTAL_ROUNDS}] 钱包 #${wallet.index} 买入 ${formatEther(BUY_AMOUNT)} ETH... `);

      const hash = await walletClient.writeContract({
        address: CONTRACTS.TOKEN_FACTORY,
        abi: TOKEN_FACTORY_ABI,
        functionName: "buy",
        args: [TARGET_TOKEN, 0n],
        value: BUY_AMOUNT,
      });

      await publicClient.waitForTransactionReceipt({ hash });
      console.log(`✅ ${hash.slice(0, 16)}...`);

      successCount++;
      totalEthSpent += BUY_AMOUNT;

      // 每5次买入后检查价格
      if ((i + 1) % 5 === 0 || i === TOTAL_ROUNDS - 1) {
        await sleep(2000); // 等待价格同步
        const current = await getPrices(publicClient);

        const spotUsd = Number(current.spotPrice) / 1e6;
        const markUsd = Number(current.markPrice) / 1e6;
        const premium = markUsd > 0 ? ((spotUsd - markUsd) / markUsd * 100) : 0;

        priceHistory.push({
          round: i + 1,
          spotPrice: formatPrice(current.spotPrice),
          markPrice: formatPrice(current.markPrice),
          premium: `${premium >= 0 ? '+' : ''}${premium.toFixed(4)}%`,
        });

        console.log(`\n   📊 价格检查点 [第 ${i + 1} 轮]:`);
        console.log(`      现货: ${formatPrice(current.spotPrice)} | 合约: ${formatPrice(current.markPrice)} | 溢价: ${premium >= 0 ? '+' : ''}${premium.toFixed(4)}%\n`);
      }

    } catch (e: any) {
      console.log(`❌ 失败: ${e.message?.slice(0, 40)}`);
    }

    await sleep(300); // 防止 RPC 限流
  }

  // 等待最终价格同步
  console.log("\n⏳ 等待价格同步 (5秒)...\n");
  await sleep(5000);

  // 最终状态
  const final = await getPrices(publicClient);

  console.log("╔═══════════════════════════════════════════════════════════╗");
  console.log("║                      拉盘测试结果                          ║");
  console.log("╠═══════════════════════════════════════════════════════════╣");

  console.log(`║ 成功买入: ${successCount.toString().padEnd(3)} 笔                                      ║`);
  console.log(`║ 总花费:   ${formatEther(totalEthSpent).padEnd(12)} ETH                          ║`);

  console.log("╠═══════════════════════════════════════════════════════════╣");
  console.log("║ 价格变化:                                                 ║");

  const initialSpotUsd = Number(initial.spotPrice) / 1e6;
  const finalSpotUsd = Number(final.spotPrice) / 1e6;
  const initialMarkUsd = Number(initial.markPrice) / 1e6;
  const finalMarkUsd = Number(final.markPrice) / 1e6;

  const spotChange = initialSpotUsd > 0 ? ((finalSpotUsd - initialSpotUsd) / initialSpotUsd * 100) : 0;
  const markChange = initialMarkUsd > 0 ? ((finalMarkUsd - initialMarkUsd) / initialMarkUsd * 100) : 0;
  const finalPremium = finalMarkUsd > 0 ? ((finalSpotUsd - finalMarkUsd) / finalMarkUsd * 100) : 0;

  console.log(`║ 现货: ${formatPrice(initial.spotPrice)} → ${formatPrice(final.spotPrice)} (${spotChange >= 0 ? '+' : ''}${spotChange.toFixed(2)}%) ║`);
  console.log(`║ 合约: ${formatPrice(initial.markPrice)} → ${formatPrice(final.markPrice)} (${markChange >= 0 ? '+' : ''}${markChange.toFixed(2)}%) ║`);

  console.log("╠═══════════════════════════════════════════════════════════╣");
  console.log("║ 锚定验证:                                                 ║");
  console.log(`║ 最终溢价: ${finalPremium >= 0 ? '+' : ''}${finalPremium.toFixed(4)}%                                    ║`);

  if (Math.abs(finalPremium) < 1) {
    console.log("║ ✅ 价格锚定正常 (溢价 < 1%)                               ║");
  } else if (Math.abs(finalPremium) < 5) {
    console.log("║ ⚠️  价格有偏差 (1% < 溢价 < 5%)                           ║");
  } else {
    console.log("║ ❌ 价格锚定异常 (溢价 > 5%)                               ║");
  }

  console.log("╚═══════════════════════════════════════════════════════════╝\n");

  // 打印价格历史
  console.log("📈 价格变化历史:");
  console.log("┌───────┬─────────────────────┬─────────────────────┬────────────┐");
  console.log("│ 轮次  │ 现货价格            │ 合约价格            │ 溢价       │");
  console.log("├───────┼─────────────────────┼─────────────────────┼────────────┤");
  for (const record of priceHistory) {
    console.log(`│ ${record.round.toString().padStart(5)} │ ${record.spotPrice.padEnd(19)} │ ${record.markPrice.padEnd(19)} │ ${record.premium.padEnd(10)} │`);
  }
  console.log("└───────┴─────────────────────┴─────────────────────┴────────────┘");
}

main().catch(console.error);
