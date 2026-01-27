/**
 * 测试撮合 - 提交卖单与已有买单撮合
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

async function main() {
  console.log("=== 撮合测试 ===\n");

  const wallets = loadWallets();
  const shortWallet = wallets[0]; // 使用第一个测试钱包做空

  const account = privateKeyToAccount(shortWallet.privateKey as Hex);
  const walletClient = createWalletClient({
    account,
    chain: baseSepolia,
    transport: http(CONFIG.RPC_URL),
  });

  console.log(`卖方钱包: ${account.address}`);

  // 获取 nonce
  const nonceRes = await fetch(`${CONFIG.MATCHING_ENGINE_URL}/api/user/${account.address}/nonce`);
  const nonceData = await nonceRes.json();
  const nonce = BigInt(nonceData.nonce);
  console.log(`当前 nonce: ${nonce}`);

  // 创建卖单 (做空)
  const order = {
    trader: account.address,
    token: CONFIG.USDT_ADDRESS,
    isLong: false, // 做空
    size: 10000000n, // 10 USDT
    leverage: 50000n, // 5x
    price: 1000000n, // $1.00 - 与买单同价撮合
    deadline: BigInt(Math.floor(Date.now() / 1000) + 3600),
    nonce: nonce,
    orderType: 0, // MARKET - 市价单更容易撮合
  };

  console.log("\n卖单内容:");
  console.log(`  isLong: ${order.isLong}`);
  console.log(`  size: ${Number(order.size) / 1e6} USDT`);
  console.log(`  price: $${Number(order.price) / 1e6}`);
  console.log(`  orderType: ${order.orderType === 0 ? "MARKET" : "LIMIT"}`);

  // 签名
  const signature = await walletClient.signTypedData({
    account,
    domain: EIP712_DOMAIN,
    types: ORDER_TYPES,
    primaryType: "Order",
    message: order,
  });

  console.log(`\n签名: ${signature.slice(0, 20)}...`);

  // 提交
  const response = await fetch(`${CONFIG.MATCHING_ENGINE_URL}/api/order/submit`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      trader: order.trader,
      token: order.token,
      isLong: order.isLong,
      size: order.size.toString(),
      leverage: order.leverage.toString(),
      price: order.price.toString(),
      deadline: order.deadline.toString(),
      nonce: order.nonce.toString(),
      orderType: order.orderType,
      signature: signature,
    }),
  });

  const result = await response.json();
  console.log(`\n撮合引擎响应:`);
  console.log(JSON.stringify(result, null, 2));

  // 检查订单簿
  console.log("\n订单簿状态:");
  const orderbookRes = await fetch(`${CONFIG.MATCHING_ENGINE_URL}/api/orderbook/${CONFIG.USDT_ADDRESS}`);
  const orderbook = await orderbookRes.json();
  console.log(`  买单: ${orderbook.longs?.length || 0}`);
  console.log(`  卖单: ${orderbook.shorts?.length || 0}`);
  console.log(`  最新价: $${Number(orderbook.lastPrice || 0) / 1e6}`);

  // 如果有撮合，检查待提交的批次
  if (result.matches && result.matches.length > 0) {
    console.log(`\n撮合成功！${result.matches.length} 笔交易`);
    console.log("等待批量提交到链上...");
  }
}

main().catch(console.error);
