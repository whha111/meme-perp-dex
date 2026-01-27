/**
 * 实时交易模拟 - 持续生成订单和交易
 *
 * 用于测试前端实时显示：
 * - K线更新
 * - 订单簿变化
 * - 成交记录
 * - 仓位变化
 */

import { createWalletClient, http, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { baseSepolia } from "viem/chains";
import * as fs from "fs";

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

interface Wallet {
  privateKey: string;
  address: string;
  index: number;
}

function loadWallets(): Wallet[] {
  const data = JSON.parse(fs.readFileSync(CONFIG.WALLETS_PATH, "utf-8"));
  return data.wallets;
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

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  console.log("=".repeat(60));
  console.log("实时交易模拟 - 按 Ctrl+C 停止");
  console.log("=".repeat(60));
  console.log(`撮合引擎: ${CONFIG.MATCHING_ENGINE_URL}`);
  console.log(`交易代币: ${CONFIG.USDT_ADDRESS}`);
  console.log("");

  const wallets = loadWallets();
  let basePrice = 1000000n; // $1.00
  let round = 0;

  // 持续循环
  while (true) {
    round++;
    console.log(`\n--- Round ${round} ---`);

    // 随机价格波动 (±2%)
    const priceChange = BigInt(Math.floor(Math.random() * 40000) - 20000);
    basePrice += priceChange;
    if (basePrice < 800000n) basePrice = 800000n;
    if (basePrice > 1200000n) basePrice = 1200000n;

    console.log(`价格: $${(Number(basePrice) / 1e6).toFixed(4)}`);

    // 更新链上价格
    try {
      const priceUpdateRes = await fetch(`${CONFIG.MATCHING_ENGINE_URL}/api/price/update`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          token: CONFIG.USDT_ADDRESS,
          price: basePrice.toString(),
        }),
      });
      const priceResult = await priceUpdateRes.json();
      if (priceResult.success) {
        console.log(`  价格已更新`);
      }
    } catch (e) {
      // Ignore price update errors
    }

    // 选择随机钱包下单
    const walletIndex = Math.floor(Math.random() * 10);
    const wallet = wallets[walletIndex];
    const { account, client } = createWallet(wallet.privateKey as Hex);

    // 随机买或卖
    const isLong = Math.random() > 0.5;
    const orderType = Math.random() > 0.3 ? 1 : 0; // 70% 限价, 30% 市价
    const size = BigInt(10000000 + Math.floor(Math.random() * 90000000)); // 10-100 USDT
    const leverage = 50000n; // 5x

    // 价格偏移 (限价单)
    const priceOffset = isLong ? -BigInt(Math.floor(Math.random() * 10000)) : BigInt(Math.floor(Math.random() * 10000));
    const orderPrice = orderType === 1 ? basePrice + priceOffset : basePrice;

    try {
      const nonce = await getNonce(wallet.address as Address);

      const order = {
        trader: wallet.address as Address,
        token: CONFIG.USDT_ADDRESS,
        isLong,
        size,
        leverage,
        price: orderPrice,
        deadline: BigInt(Math.floor(Date.now() / 1000) + 3600),
        nonce,
        orderType,
      };

      const signature = await client.signTypedData({
        account,
        domain: EIP712_DOMAIN,
        types: ORDER_TYPES,
        primaryType: "Order",
        message: order,
      });

      const result = await submitOrder({ ...order, signature });

      const side = isLong ? "买" : "卖";
      const type = orderType === 0 ? "市价" : "限价";
      const sizeStr = (Number(size) / 1e6).toFixed(2);
      const priceStr = (Number(orderPrice) / 1e6).toFixed(4);

      if (result.success) {
        const status = result.status === "FILLED" ? "已成交" : "挂单中";
        const matches = result.matches?.length || 0;
        console.log(`  ${side}${type}: ${sizeStr} USDT @ $${priceStr} - ${status} (${matches} 笔撮合)`);
      } else {
        console.log(`  ${side}${type}: ${sizeStr} USDT @ $${priceStr} - 失败: ${result.error}`);
      }
    } catch (e: any) {
      console.log(`  订单失败: ${e.message.slice(0, 50)}`);
    }

    // 显示订单簿摘要
    try {
      const orderbookRes = await fetch(`${CONFIG.MATCHING_ENGINE_URL}/api/orderbook/${CONFIG.USDT_ADDRESS}`);
      const orderbook = await orderbookRes.json();
      const bids = orderbook.longs?.length || 0;
      const asks = orderbook.shorts?.length || 0;
      console.log(`  订单簿: ${bids} 买单, ${asks} 卖单`);
    } catch {}

    // 等待 3-8 秒
    const waitTime = 3000 + Math.floor(Math.random() * 5000);
    await sleep(waitTime);
  }
}

main().catch(console.error);
