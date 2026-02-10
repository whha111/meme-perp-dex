/**
 * 测试提交单个订单并查看详细响应
 */

import { ethers } from "ethers";
import { createWalletClient, http, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { baseSepolia } from "viem/chains";
import fs from "fs";

const CONFIG = {
  RPC_URL: "https://sepolia.base.org",
  SETTLEMENT_ADDRESS: "0x027131BbC5EF6427826F64D12BACAAb447Ee1B13" as Address,
  TOKEN_ADDRESS: "0x01eA557E2B17f65604568791Edda8dE1Ae702BE8" as Address,
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
const testWallet = tradingWallets[0];

console.log("=== 测试订单提交 ===");
console.log(`钱包: ${testWallet.derivedAddress}`);
console.log("");

async function main() {
  // 1. 获取nonce
  console.log("1. 获取nonce...");
  const nonceRes = await fetch(`${CONFIG.API_URL}/api/user/${testWallet.derivedAddress}/nonce`);
  const nonceData = await nonceRes.json();
  const nonce = BigInt(nonceData.nonce || "0");
  console.log(`   Nonce: ${nonce}`);
  console.log("");

  // 2. 签名订单
  console.log("2. 签名订单...");
  const account = privateKeyToAccount(testWallet.privateKey as Hex);
  const walletClient = createWalletClient({
    account,
    chain: baseSepolia,
    transport: http(CONFIG.RPC_URL),
  });

  const LEVERAGE_PRECISION = 10000n;
  const orderParams = {
    trader: account.address,
    token: CONFIG.TOKEN_ADDRESS,
    isLong: true,
    size: 100n * 10n ** 18n, // 100 tokens
    leverage: 5n * LEVERAGE_PRECISION, // 5x
    price: 1000000000000n, // $0.001
    deadline: BigInt(Math.floor(Date.now() / 1000) + 3600),
    nonce,
    orderType: 1, // LIMIT
  };

  console.log(`   订单详情:`);
  console.log(`   - 方向: LONG`);
  console.log(`   - 数量: 100 tokens`);
  console.log(`   - 杠杆: 5x`);
  console.log(`   - 价格: $0.001`);
  console.log("");

  const signature = await walletClient.signTypedData({
    account: walletClient.account!,
    domain: EIP712_DOMAIN,
    types: ORDER_TYPES,
    primaryType: "Order",
    message: orderParams,
  });

  console.log(`   签名: ${signature.slice(0, 20)}...`);
  console.log("");

  // 3. 提交订单
  console.log("3. 提交订单到 Matching Engine...");
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

  console.log("4. 响应:");
  console.log(JSON.stringify(result, null, 2));
  console.log("");

  // 5. 检查订单簿
  console.log("5. 检查订单簿...");
  const orderbookRes = await fetch(`${CONFIG.API_URL}/api/orderbook/${CONFIG.TOKEN_ADDRESS}`);
  const orderbook = await orderbookRes.json();
  console.log(`   买单数量: ${orderbook.data?.bids?.length || 0}`);
  console.log(`   卖单数量: ${orderbook.data?.asks?.length || 0}`);
}

main().catch(console.error);
