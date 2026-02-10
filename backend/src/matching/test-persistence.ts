/**
 * 测试订单持久化完整流程
 */

import { ethers } from "ethers";
import { createWalletClient, http, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { baseSepolia } from "viem/chains";
import fs from "fs";

const CONFIG = {
  RPC_URL: "https://sepolia.base.org",
  SETTLEMENT_ADDRESS: "0x027131BbC5EF6427826F64D12BACAAb447Ee1B13" as Address,
  // 使用当前支持的代币
  TOKEN_ADDRESS: "0x197512828dBDB8340e0bA4815f4479B0c5D1eBd2" as Address,
  API_URL: "http://localhost:8081",
  CHAIN_ID: 84532,
};

const EIP712_DOMAIN = {
  name: "MemePerp",
  version: "1",
  chainId: CONFIG.CHAIN_ID,
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
};

const tradingWallets = JSON.parse(fs.readFileSync("trading-wallets.json", "utf-8"));
const testWallet = tradingWallets[5]; // 使用第6个钱包

console.log("=== 订单持久化测试 ===");
console.log(`测试代币: ${CONFIG.TOKEN_ADDRESS}`);
console.log(`测试钱包: ${testWallet.derivedAddress}`);
console.log("");

async function main() {
  // 1. 提交订单
  console.log("1. 提交订单...");
  const account = privateKeyToAccount(testWallet.privateKey as Hex);
  const walletClient = createWalletClient({
    account,
    chain: baseSepolia,
    transport: http(CONFIG.RPC_URL),
  });

  // 获取nonce
  const nonceRes = await fetch(`${CONFIG.API_URL}/api/user/${testWallet.derivedAddress}/nonce`);
  const nonceData = await nonceRes.json();
  const nonce = BigInt(nonceData.nonce || "0");

  const LEVERAGE_PRECISION = 10000n;
  const orderParams = {
    trader: account.address,
    token: CONFIG.TOKEN_ADDRESS,
    isLong: true,
    size: 50n * 10n ** 18n, // 50 tokens
    leverage: 3n * LEVERAGE_PRECISION, // 3x
    price: 5000000000000n, // $0.005
    deadline: BigInt(Math.floor(Date.now() / 1000) + 3600),
    nonce,
    orderType: 1, // LIMIT
  };

  console.log(`   方向: LONG, 数量: 50, 杠杆: 3x, 价格: $0.005`);

  const signature = await walletClient.signTypedData({
    account: walletClient.account!,
    domain: EIP712_DOMAIN,
    types: ORDER_TYPES,
    primaryType: "Order",
    message: orderParams,
  });

  const response = await fetch(`${CONFIG.API_URL}/api/order/submit`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      trader: orderParams.trader,
      token: orderParams.token,
      isLong: orderParams.isLong,
      size: orderParams.size.toString(),
      leverage: orderParams.leverage.toString(),
      price: orderParams.price.toString(),
      deadline: orderParams.deadline.toString(),
      nonce: orderParams.nonce.toString(),
      orderType: orderParams.orderType,
      signature,
    }),
  });

  const result = await response.json();
  if (!result.success) {
    console.error(`   ❌ 订单提交失败: ${result.error}`);
    process.exit(1);
  }

  const orderId = result.orderId;
  console.log(`   ✅ 订单提交成功: ${orderId}`);
  console.log("");

  // 2. 检查订单簿
  console.log("2. 检查订单簿...");
  const orderbookRes = await fetch(`${CONFIG.API_URL}/api/orderbook/${CONFIG.TOKEN_ADDRESS}`);
  const orderbook = await orderbookRes.json();
  console.log(`   多单: ${orderbook.longs?.length || 0}`);
  console.log(`   空单: ${orderbook.shorts?.length || 0}`);
  console.log("");

  // 3. 检查用户订单
  console.log("3. 检查用户订单 (内存)...");
  const userOrdersRes = await fetch(`${CONFIG.API_URL}/api/user/${testWallet.derivedAddress}/orders`);
  const userOrders = await userOrdersRes.json();
  console.log(`   订单数量: ${Array.isArray(userOrders) ? userOrders.length : 0}`);
  console.log("");

  // 4. 检查 Redis
  console.log("4. 检查 Redis 数据库...");
  const { execSync } = require("child_process");
  try {
    const redisData = execSync(`redis-cli --raw HGETALL "memeperp:order:${orderId}"`, { encoding: "utf-8" });
    if (redisData.includes("PENDING")) {
      console.log(`   ✅ 订单在 Redis 中: ${orderId}`);
    } else {
      console.log(`   ❌ 订单不在 Redis 中`);
    }
  } catch (e) {
    console.log(`   ❌ 无法查询 Redis: ${e.message}`);
  }
  console.log("");

  console.log("✅ 测试完成！请重启服务器验证订单是否加载。");
  console.log("");
  console.log("重启命令:");
  console.log("  pkill -f 'bun.*server.ts' && sleep 3 && bun run server.ts &");
  console.log("");
  console.log("验证命令:");
  console.log(`  curl "http://localhost:8081/api/user/${testWallet.derivedAddress}/orders" | jq`);
}

main().catch(console.error);
