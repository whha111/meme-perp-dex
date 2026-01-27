/**
 * 测试签名验证
 */

import { createWalletClient, createPublicClient, http, type Address, type Hex, verifyTypedData } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { baseSepolia } from "viem/chains";

const CONFIG = {
  RPC_URL: "https://base-sepolia.g.alchemy.com/v2/Dr8sMe-1MYIF7jBYuZZj8PMOPAAeJ16d",
  SETTLEMENT_ADDRESS: "0x8dd0De655628c0E8255e3d6c38c3DF2BE36e4D8d" as Address,
  TEST_PRIVATE_KEY: "0xf9a07bb59ea400ef88bfbcf314d89f357c8580d1a4fb543e48cfb98b02b41d2c" as Hex,
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

async function main() {
  console.log("=== 签名测试 ===\n");

  const account = privateKeyToAccount(CONFIG.TEST_PRIVATE_KEY);
  const walletClient = createWalletClient({
    account,
    chain: baseSepolia,
    transport: http(CONFIG.RPC_URL),
  });

  console.log(`钱包地址: ${account.address}`);

  // 创建测试订单
  const order = {
    trader: account.address,
    token: "0x223095F2c63DB913Baa46FdC2f401E65cB8799F4" as Address,
    isLong: true,
    size: 10000000n, // 10 USDT
    leverage: 50000n, // 5x
    price: 1000000n, // $1.00
    deadline: BigInt(Math.floor(Date.now() / 1000) + 3600),
    nonce: 0n,
    orderType: 1, // LIMIT
  };

  console.log("\n订单内容:");
  console.log(`  trader: ${order.trader}`);
  console.log(`  token: ${order.token}`);
  console.log(`  isLong: ${order.isLong}`);
  console.log(`  size: ${order.size}`);
  console.log(`  leverage: ${order.leverage}`);
  console.log(`  price: ${order.price}`);
  console.log(`  deadline: ${order.deadline}`);
  console.log(`  nonce: ${order.nonce}`);
  console.log(`  orderType: ${order.orderType}`);

  // 签名
  console.log("\n签名中...");
  const signature = await walletClient.signTypedData({
    account,
    domain: EIP712_DOMAIN,
    types: ORDER_TYPES,
    primaryType: "Order",
    message: order,
  });

  console.log(`签名: ${signature}`);

  // 本地验证
  console.log("\n本地验证签名...");
  const isValid = await verifyTypedData({
    address: account.address,
    domain: EIP712_DOMAIN,
    types: ORDER_TYPES,
    primaryType: "Order",
    message: order,
    signature,
  });

  console.log(`本地验证结果: ${isValid ? "有效" : "无效"}`);

  // 提交到撮合引擎
  console.log("\n提交到撮合引擎...");
  const response = await fetch("http://localhost:8081/api/order/submit", {
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
  console.log(`撮合引擎响应: ${JSON.stringify(result)}`);
}

main().catch(console.error);
