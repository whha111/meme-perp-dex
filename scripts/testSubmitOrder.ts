/**
 * 测试提交订单到撮合引擎
 */
import { createPublicClient, createWalletClient, http, parseEther, parseUnits } from "viem";
import { baseSepolia } from "viem/chains";
import { privateKeyToAccount } from "viem/accounts";
import * as fs from "fs";

const RPC_URL = "https://base-sepolia.g.alchemy.com/v2/Dr8sMe-1MYIF7jBYuZZj8PMOPAAeJ16d";
const SETTLEMENT = "0xB06C32C7536EC5EAD101fEe2AD4005a5eedcB258";
const TOKEN_123 = "0x01c6058175eda34fc8922eeae32bc383cb203211";

const SETTLEMENT_ABI = [
  { inputs: [{ name: "user", type: "address" }], name: "nonces", outputs: [{ type: "uint256" }], stateMutability: "view", type: "function" },
] as const;

const EIP712_DOMAIN = {
  name: "MemePerp",
  version: "1",
  chainId: 84532,
  verifyingContract: SETTLEMENT as `0x${string}`,
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

async function submitOrder(walletClient: any, account: any, publicClient: any, isLong: boolean, nonce: bigint) {
  const size = parseUnits("100", 6); // 100 USDT面值
  const leverage = 50000n; // 5倍杠杆
  const price = parseEther("0.000000002"); // 价格
  const deadline = BigInt(Math.floor(Date.now() / 1000) + 3600);

  const order = {
    trader: account.address,
    token: TOKEN_123 as `0x${string}`,
    isLong,
    size,
    leverage,
    price,
    deadline,
    nonce,
    orderType: 0, // MARKET
  };

  const signature = await walletClient.signTypedData({
    domain: EIP712_DOMAIN,
    types: ORDER_TYPES,
    primaryType: "Order",
    message: order,
  });

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
      signature,
    }),
  });

  return await response.json();
}

async function main() {
  const walletsData = JSON.parse(fs.readFileSync("/Users/qinlinqiu/Desktop/Namespace/scripts/market-maker/wallets.json", "utf-8"));

  const longWallet = walletsData.wallets[0];
  const shortWallet = walletsData.wallets[1];

  const longAccount = privateKeyToAccount(longWallet.privateKey as `0x${string}`);
  const shortAccount = privateKeyToAccount(shortWallet.privateKey as `0x${string}`);

  const publicClient = createPublicClient({
    chain: baseSepolia,
    transport: http(RPC_URL),
  });

  const longWalletClient = createWalletClient({
    account: longAccount,
    chain: baseSepolia,
    transport: http(RPC_URL),
  });

  const shortWalletClient = createWalletClient({
    account: shortAccount,
    chain: baseSepolia,
    transport: http(RPC_URL),
  });

  console.log("=== 测试: 提交订单到撮合引擎 ===");

  // 获取nonce
  const longNonce = await publicClient.readContract({
    address: SETTLEMENT as `0x${string}`,
    abi: SETTLEMENT_ABI,
    functionName: "nonces",
    args: [longAccount.address],
  });
  const shortNonce = await publicClient.readContract({
    address: SETTLEMENT as `0x${string}`,
    abi: SETTLEMENT_ABI,
    functionName: "nonces",
    args: [shortAccount.address],
  });

  console.log("多头地址:", longAccount.address);
  console.log("空头地址:", shortAccount.address);
  console.log("多头nonce:", longNonce.toString());
  console.log("空头nonce:", shortNonce.toString());

  // 提交多头订单
  console.log("\n提交多头订单...");
  const longResult = await submitOrder(longWalletClient, longAccount, publicClient, true, longNonce);
  console.log("多头结果:", JSON.stringify(longResult, null, 2));

  // 提交空头订单
  console.log("\n提交空头订单...");
  const shortResult = await submitOrder(shortWalletClient, shortAccount, publicClient, false, shortNonce);
  console.log("空头结果:", JSON.stringify(shortResult, null, 2));

  // 等待一下然后检查订单簿
  console.log("\n等待3秒...");
  await new Promise(r => setTimeout(r, 3000));

  // 检查订单簿
  const orderbookResponse = await fetch("http://localhost:8081/api/orderbook/" + TOKEN_123);
  const orderbook = await orderbookResponse.json();
  console.log("\n订单簿:", JSON.stringify(orderbook, null, 2));

  // 检查撮合引擎状态
  const healthResponse = await fetch("http://localhost:8081/health");
  const health = await healthResponse.json();
  console.log("\n撮合引擎状态:", JSON.stringify(health, null, 2));
}

main().catch(console.error);
