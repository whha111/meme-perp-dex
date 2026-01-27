/**
 * 测试小额订单
 */
import { createPublicClient, createWalletClient, http, parseUnits } from "viem";
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

  console.log("=== 测试: 小额订单 ===");

  // 获取nonce - 从撮合引擎获取期望的nonce
  const longNonceRes = await (await fetch(`http://localhost:8081/api/user/${longAccount.address}/nonce`)).json();
  const shortNonceRes = await (await fetch(`http://localhost:8081/api/user/${shortAccount.address}/nonce`)).json();

  const longNonce = BigInt(longNonceRes.nonce);
  const shortNonce = BigInt(shortNonceRes.nonce);

  console.log("多头nonce:", longNonce.toString());
  console.log("空头nonce:", shortNonce.toString());

  // 小额订单: 0.1 USDT面值，10倍杠杆，需要0.01保证金
  const size = parseUnits("0.1", 6); // 0.1 USDT = 100000 内部单位
  const leverage = 100000n; // 10倍杠杆
  const price = parseUnits("0.000002", 18); // 价格
  const deadline = BigInt(Math.floor(Date.now() / 1000) + 3600);

  console.log("订单参数:");
  console.log("  size:", size.toString(), "(0.1 USDT)");
  console.log("  leverage:", leverage.toString(), "(10x)");
  console.log("  需要保证金:", (Number(size) / (Number(leverage) / 10000)).toString(), "= 0.01 USDT");

  // 多头订单
  const longOrder = {
    trader: longAccount.address,
    token: TOKEN_123 as `0x${string}`,
    isLong: true,
    size,
    leverage,
    price,
    deadline,
    nonce: longNonce,
    orderType: 0,
  };

  // 空头订单
  const shortOrder = {
    trader: shortAccount.address,
    token: TOKEN_123 as `0x${string}`,
    isLong: false,
    size,
    leverage,
    price,
    deadline,
    nonce: shortNonce,
    orderType: 0,
  };

  // 签名
  const longSignature = await longWalletClient.signTypedData({
    domain: EIP712_DOMAIN,
    types: ORDER_TYPES,
    primaryType: "Order",
    message: longOrder,
  });

  const shortSignature = await shortWalletClient.signTypedData({
    domain: EIP712_DOMAIN,
    types: ORDER_TYPES,
    primaryType: "Order",
    message: shortOrder,
  });

  // 提交
  console.log("\n提交订单...");

  const longResponse = await fetch("http://localhost:8081/api/order/submit", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      trader: longOrder.trader,
      token: longOrder.token,
      isLong: longOrder.isLong,
      size: longOrder.size.toString(),
      leverage: longOrder.leverage.toString(),
      price: longOrder.price.toString(),
      deadline: longOrder.deadline.toString(),
      nonce: longOrder.nonce.toString(),
      orderType: longOrder.orderType,
      signature: longSignature,
    }),
  });
  console.log("多头:", await longResponse.json());

  const shortResponse = await fetch("http://localhost:8081/api/order/submit", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      trader: shortOrder.trader,
      token: shortOrder.token,
      isLong: shortOrder.isLong,
      size: shortOrder.size.toString(),
      leverage: shortOrder.leverage.toString(),
      price: shortOrder.price.toString(),
      deadline: shortOrder.deadline.toString(),
      nonce: shortOrder.nonce.toString(),
      orderType: shortOrder.orderType,
      signature: shortSignature,
    }),
  });
  console.log("空头:", await shortResponse.json());

  // 等待链上提交
  console.log("\n等待链上提交 (35秒)...");
  await new Promise(r => setTimeout(r, 35000));

  // 检查结果
  const health = await (await fetch("http://localhost:8081/health")).json();
  console.log("\n撮合引擎状态:", health);
}

main().catch(console.error);
