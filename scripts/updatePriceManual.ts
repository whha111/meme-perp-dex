/**
 * Manual Price Update Script
 * Uses owner authority to update price in PriceFeed
 *
 * Strategy:
 * 1. Owner temporarily sets themselves as tokenFactory
 * 2. Calls updateTokenPriceFromFactory
 * 3. Restores original tokenFactory
 */

import {
  createPublicClient,
  createWalletClient,
  http,
  formatUnits,
  formatEther,
  type Address,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { baseSepolia } from "viem/chains";
import * as fs from "fs";

const RPC_URL = "https://base-sepolia.g.alchemy.com/v2/Dr8sMe-1MYIF7jBYuZZj8PMOPAAeJ16d";

const TARGET_TOKEN = "0x6Bf5C512a5714D610379b1EA0Dec0BEFb46888f7" as Address;
const TOKEN_FACTORY = "0xE0ddf67E89f5773c960Bc2329109815E8c66BAAe" as Address;
const PRICE_FEED = "0xd69A4DB60cEc962A46C6B9Bc8CC0883081c4eFb7" as Address;

const PRICE_FEED_ABI = [
  {
    inputs: [],
    name: "owner",
    outputs: [{ type: "address" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [],
    name: "tokenFactory",
    outputs: [{ type: "address" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [{ name: "_tokenFactory", type: "address" }],
    name: "setTokenFactory",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [
      { name: "token", type: "address" },
      { name: "newPrice", type: "uint256" },
    ],
    name: "updateTokenPriceFromFactory",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [{ name: "token", type: "address" }],
    name: "getTokenMarkPrice",
    outputs: [{ type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
] as const;

const TOKEN_FACTORY_ABI = [
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

// Deployer private key (from .env)
const DEPLOYER_PRIVATE_KEY = "0xf9a07bb59ea400ef88bfbcf314d89f357c8580d1a4fb543e48cfb98b02b41d2c";

// Load wallets to find owner
function findOwnerWallet(ownerAddress: string): string | null {
  // First check if it matches the deployer
  const deployerAccount = privateKeyToAccount(DEPLOYER_PRIVATE_KEY as `0x${string}`);
  if (deployerAccount.address.toLowerCase() === ownerAddress.toLowerCase()) {
    return DEPLOYER_PRIVATE_KEY;
  }

  const walletsPath = "/Users/qinlinqiu/Desktop/Namespace/scripts/market-maker/wallets.json";
  const data = fs.readFileSync(walletsPath, "utf-8");
  const wallets = JSON.parse(data).wallets;

  for (const wallet of wallets) {
    if (wallet.address.toLowerCase() === ownerAddress.toLowerCase()) {
      return wallet.privateKey;
    }
  }
  return null;
}

async function main() {
  console.log("========== 手动更新 PriceFeed 价格 ==========\n");

  const publicClient = createPublicClient({
    chain: baseSepolia,
    transport: http(RPC_URL),
  });

  // Get owner address
  const ownerAddress = await publicClient.readContract({
    address: PRICE_FEED,
    abi: PRICE_FEED_ABI,
    functionName: "owner",
  });
  console.log("PriceFeed owner:", ownerAddress);

  // Try to find owner private key
  const ownerPrivateKey = findOwnerWallet(ownerAddress);
  if (!ownerPrivateKey) {
    console.log("\n❌ 未找到 owner 私钥，无法更新价格");
    console.log("请确保你有 owner 地址的私钥");
    return;
  }
  console.log("✅ 找到 owner 私钥\n");

  // Calculate current spot price from pool
  const poolState = await publicClient.readContract({
    address: TOKEN_FACTORY,
    abi: TOKEN_FACTORY_ABI,
    functionName: "getPoolState",
    args: [TARGET_TOKEN],
  });

  const spotPrice = poolState.realETHReserve * BigInt(1e18) / poolState.realTokenReserve;
  console.log("当前池子现货价格:", formatUnits(spotPrice, 18), "ETH");

  // Get current mark price
  const currentMarkPrice = await publicClient.readContract({
    address: PRICE_FEED,
    abi: PRICE_FEED_ABI,
    functionName: "getTokenMarkPrice",
    args: [TARGET_TOKEN],
  });
  console.log("当前标记价格:", formatUnits(currentMarkPrice, 18), "ETH");

  // Create wallet client
  const account = privateKeyToAccount(ownerPrivateKey as `0x${string}`);
  const walletClient = createWalletClient({
    account,
    chain: baseSepolia,
    transport: http(RPC_URL),
  });

  // Get original tokenFactory
  const originalTokenFactory = await publicClient.readContract({
    address: PRICE_FEED,
    abi: PRICE_FEED_ABI,
    functionName: "tokenFactory",
  });
  console.log("\n原始 tokenFactory:", originalTokenFactory);

  // Step 1: Set owner as tokenFactory
  console.log("\n步骤 1: 设置 owner 为临时 tokenFactory...");
  try {
    const hash1 = await walletClient.writeContract({
      address: PRICE_FEED,
      abi: PRICE_FEED_ABI,
      functionName: "setTokenFactory",
      args: [ownerAddress],
    });
    await publicClient.waitForTransactionReceipt({ hash: hash1 });
    console.log("  ✅ 已设置");
  } catch (e: any) {
    console.log("  ❌ 失败:", e.message?.slice(0, 100));
    return;
  }

  // Step 2: Update price
  console.log("\n步骤 2: 更新代币价格...");
  try {
    const hash2 = await walletClient.writeContract({
      address: PRICE_FEED,
      abi: PRICE_FEED_ABI,
      functionName: "updateTokenPriceFromFactory",
      args: [TARGET_TOKEN, spotPrice],
    });
    await publicClient.waitForTransactionReceipt({ hash: hash2 });
    console.log("  ✅ 价格已更新");
  } catch (e: any) {
    console.log("  ❌ 失败:", e.message?.slice(0, 100));
  }

  // Step 3: Restore original tokenFactory
  console.log("\n步骤 3: 恢复原始 tokenFactory...");
  try {
    const hash3 = await walletClient.writeContract({
      address: PRICE_FEED,
      abi: PRICE_FEED_ABI,
      functionName: "setTokenFactory",
      args: [originalTokenFactory],
    });
    await publicClient.waitForTransactionReceipt({ hash: hash3 });
    console.log("  ✅ 已恢复");
  } catch (e: any) {
    console.log("  ❌ 失败:", e.message?.slice(0, 100));
  }

  // Verify new price
  const newMarkPrice = await publicClient.readContract({
    address: PRICE_FEED,
    abi: PRICE_FEED_ABI,
    functionName: "getTokenMarkPrice",
    args: [TARGET_TOKEN],
  });

  console.log("\n========== 更新完成 ==========");
  console.log("旧标记价格:", formatUnits(currentMarkPrice, 18), "ETH");
  console.log("新标记价格:", formatUnits(newMarkPrice, 18), "ETH");

  const priceChange = Number(newMarkPrice - currentMarkPrice) / Number(currentMarkPrice) * 100;
  console.log("价格变化:", priceChange.toFixed(2), "%");
  console.log("\n现在去检查你的永续合约仓位！");
}

main().catch(console.error);
