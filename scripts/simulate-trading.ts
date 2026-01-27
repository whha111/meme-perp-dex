/**
 * 交易模拟脚本 - 通过 API 提交订单，模拟真实交易
 *
 * 这个脚本会：
 * 1. 通过撮合引擎 API 提交买卖订单
 * 2. 订单会显示在前端订单簿
 * 3. 撮合后生成仓位和成交记录
 * 4. 价格变动会更新 K 线图
 */

import { createWalletClient, createPublicClient, http, type Address, type Hex, parseEther, formatEther } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { baseSepolia } from "viem/chains";
import * as fs from "fs";

// ============================================================
// Configuration
// ============================================================

const CONFIG = {
  RPC_URL: "https://base-sepolia.g.alchemy.com/v2/Dr8sMe-1MYIF7jBYuZZj8PMOPAAeJ16d",
  MATCHING_ENGINE_URL: "http://localhost:8081",
  SETTLEMENT_ADDRESS: "0x8dd0De655628c0E8255e3d6c38c3DF2BE36e4D8d" as Address,
  USDT_ADDRESS: "0x223095F2c63DB913Baa46FdC2f401E65cB8799F4" as Address,
  WALLETS_PATH: "/Users/qinlinqiu/Desktop/Namespace/scripts/market-maker/wallets.json",
};

const EIP712_DOMAIN = {
  name: "MemePerp",
  version: "1",
  chainId: 84532,
  verifyingContract: CONFIG.SETTLEMENT_ADDRESS,
};

const ORDER_TYPES = {
  Order: [
    { name: "trader", type: "address" },
    { name: "token", type: "address" },
    { name: "isLong", type: "bool" },
    { name: "size", type: "uint256" },
    { name: "leverage", type: "uint256" },
    { name: "price", type: "uint256" },
    { name: "deadline", type: "uint256" },
    { name: "nonce", type: "uint256" },
    { name: "orderType", type: "uint8" },
  ],
} as const;

// ============================================================
// Helpers
// ============================================================

interface Wallet {
  privateKey: string;
  address: string;
  index: number;
}

function loadWallets(): Wallet[] {
  const data = JSON.parse(fs.readFileSync(CONFIG.WALLETS_PATH, "utf-8"));
  return data.wallets;
}

function createClient() {
  return createPublicClient({
    chain: baseSepolia,
    transport: http(CONFIG.RPC_URL),
  });
}

function createWallet(privateKey: Hex) {
  const account = privateKeyToAccount(privateKey);
  const client = createWalletClient({
    account,
    chain: baseSepolia,
    transport: http(CONFIG.RPC_URL),
  });
  return { account, client };
}

async function getNonce(trader: Address): Promise<bigint> {
  const response = await fetch(`${CONFIG.MATCHING_ENGINE_URL}/api/user/${trader}/nonce`);
  const data = await response.json();
  return BigInt(data.nonce);
}

async function submitOrder(params: {
  trader: Address;
  token: Address;
  isLong: boolean;
  size: bigint;
  leverage: bigint;
  price: bigint;
  orderType: number;
  signature: Hex;
  nonce: bigint;
  deadline: bigint;
}): Promise<any> {
  const response = await fetch(`${CONFIG.MATCHING_ENGINE_URL}/api/order/submit`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      trader: params.trader,
      token: params.token,
      isLong: params.isLong,
      size: params.size.toString(),
      leverage: params.leverage.toString(),
      price: params.price.toString(),
      orderType: params.orderType,
      signature: params.signature,
      nonce: params.nonce.toString(),
      deadline: params.deadline.toString(),
    }),
  });
  return response.json();
}

async function signOrder(
  walletClient: any,
  account: any,
  order: {
    trader: Address;
    token: Address;
    isLong: boolean;
    size: bigint;
    leverage: bigint;
    price: bigint;
    deadline: bigint;
    nonce: bigint;
    orderType: number;
  }
): Promise<Hex> {
  return walletClient.signTypedData({
    account,
    domain: EIP712_DOMAIN,
    types: ORDER_TYPES,
    primaryType: "Order",
    message: order,
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ============================================================
// Trading Simulation
// ============================================================

async function main() {
  console.log("=".repeat(60));
  console.log("交易模拟 - 通过 API 提交订单");
  console.log("=".repeat(60));
  console.log(`撮合引擎: ${CONFIG.MATCHING_ENGINE_URL}`);
  console.log(`交易代币: ${CONFIG.USDT_ADDRESS}`);
  console.log("");

  const wallets = loadWallets();
  const client = createClient();

  // 使用前 10 个钱包进行交易
  const tradeWallets = wallets.slice(0, 10);

  // 基础价格 $1.00 (6 decimals)
  let basePrice = 1000000n;
  const priceStep = 1000n; // $0.001 每步

  console.log("开始提交订单到撮合引擎...\n");

  // 循环提交买卖订单
  for (let round = 0; round < 5; round++) {
    console.log(`--- Round ${round + 1} ---`);

    // 随机价格波动
    const priceChange = BigInt(Math.floor(Math.random() * 20000) - 10000); // ±$0.01
    basePrice += priceChange;
    if (basePrice < 900000n) basePrice = 900000n;
    if (basePrice > 1100000n) basePrice = 1100000n;

    console.log(`当前基准价格: $${Number(basePrice) / 1e6}`);

    // 提交多个买单和卖单
    for (let i = 0; i < 4; i++) {
      const buyWallet = tradeWallets[i * 2];
      const sellWallet = tradeWallets[i * 2 + 1];

      // 买单 (做多)
      const { account: buyAccount, client: buyClient } = createWallet(buyWallet.privateKey as Hex);
      const buyNonce = await getNonce(buyWallet.address as Address);
      const buyPrice = basePrice - BigInt(i) * priceStep; // 略低于基准价
      const buySize = 10000000n + BigInt(Math.floor(Math.random() * 40000000)); // 10-50 USDT

      const buyOrder = {
        trader: buyWallet.address as Address,
        token: CONFIG.USDT_ADDRESS,
        isLong: true,
        size: buySize,
        leverage: 50000n, // 5x
        price: buyPrice,
        deadline: BigInt(Math.floor(Date.now() / 1000) + 3600),
        nonce: buyNonce,
        orderType: 1, // LIMIT
      };

      try {
        const buySignature = await signOrder(buyClient, buyAccount, buyOrder);
        const buyResult = await submitOrder({ ...buyOrder, signature: buySignature });
        console.log(`  买单 #${i}: ${Number(buySize) / 1e6} USDT @ $${Number(buyPrice) / 1e6} - ${buyResult.success ? "成功" : buyResult.error}`);
      } catch (e: any) {
        console.log(`  买单 #${i}: 失败 - ${e.message.slice(0, 50)}`);
      }

      // 卖单 (做空)
      const { account: sellAccount, client: sellClient } = createWallet(sellWallet.privateKey as Hex);
      const sellNonce = await getNonce(sellWallet.address as Address);
      const sellPrice = basePrice + BigInt(i) * priceStep; // 略高于基准价
      const sellSize = 10000000n + BigInt(Math.floor(Math.random() * 40000000)); // 10-50 USDT

      const sellOrder = {
        trader: sellWallet.address as Address,
        token: CONFIG.USDT_ADDRESS,
        isLong: false,
        size: sellSize,
        leverage: 50000n, // 5x
        price: sellPrice,
        deadline: BigInt(Math.floor(Date.now() / 1000) + 3600),
        nonce: sellNonce,
        orderType: 1, // LIMIT
      };

      try {
        const sellSignature = await signOrder(sellClient, sellAccount, sellOrder);
        const sellResult = await submitOrder({ ...sellOrder, signature: sellSignature });
        console.log(`  卖单 #${i}: ${Number(sellSize) / 1e6} USDT @ $${Number(sellPrice) / 1e6} - ${sellResult.success ? "成功" : sellResult.error}`);
      } catch (e: any) {
        console.log(`  卖单 #${i}: 失败 - ${e.message.slice(0, 50)}`);
      }

      await sleep(500);
    }

    // 检查订单簿
    console.log("\n  订单簿状态:");
    const orderbookRes = await fetch(`${CONFIG.MATCHING_ENGINE_URL}/api/orderbook/${CONFIG.USDT_ADDRESS}`);
    const orderbook = await orderbookRes.json();
    console.log(`    多单: ${orderbook.longs?.length || 0}, 空单: ${orderbook.shorts?.length || 0}`);
    console.log(`    最新价: $${Number(orderbook.lastPrice || 0) / 1e6}`);

    console.log("");
    await sleep(2000);
  }

  // 最终状态
  console.log("\n" + "=".repeat(60));
  console.log("最终订单簿状态");
  console.log("=".repeat(60));

  const finalOrderbook = await fetch(`${CONFIG.MATCHING_ENGINE_URL}/api/orderbook/${CONFIG.USDT_ADDRESS}`).then(r => r.json());
  console.log(`多单数量: ${finalOrderbook.longs?.length || 0}`);
  console.log(`空单数量: ${finalOrderbook.shorts?.length || 0}`);

  if (finalOrderbook.longs?.length > 0) {
    console.log("\n买单列表 (前 5 个):");
    finalOrderbook.longs.slice(0, 5).forEach((o: any, i: number) => {
      console.log(`  ${i + 1}. ${Number(o.size) / 1e6} USDT @ $${Number(o.price) / 1e6}`);
    });
  }

  if (finalOrderbook.shorts?.length > 0) {
    console.log("\n卖单列表 (前 5 个):");
    finalOrderbook.shorts.slice(0, 5).forEach((o: any, i: number) => {
      console.log(`  ${i + 1}. ${Number(o.size) / 1e6} USDT @ $${Number(o.price) / 1e6}`);
    });
  }

  console.log("\n前端应该现在可以看到订单簿更新了！");
  console.log("打开 http://localhost:3000 查看交易界面");
}

main().catch(console.error);
