/**
 * 简化的爆仓清算测试 - 使用已有余额的钱包
 */
import { createPublicClient, createWalletClient, http, parseUnits } from "viem";
import { baseSepolia } from "viem/chains";
import { privateKeyToAccount } from "viem/accounts";
import * as fs from "fs";

const RPC_URL = "https://base-sepolia.g.alchemy.com/v2/Dr8sMe-1MYIF7jBYuZZj8PMOPAAeJ16d";
const SETTLEMENT = "0xB06C32C7536EC5EAD101fEe2AD4005a5eedcB258";
const TOKEN_123 = "0x01c6058175eda34fc8922eeae32bc383cb203211";
const MATCHER_PRIVATE_KEY = "0xf9a07bb59ea400ef88bfbcf314d89f357c8580d1a4fb543e48cfb98b02b41d2c";

const SETTLEMENT_ABI = [
  { inputs: [{ name: "user", type: "address" }], name: "nonces", outputs: [{ type: "uint256" }], stateMutability: "view", type: "function" },
  { inputs: [{ name: "user", type: "address" }], name: "getUserBalance", outputs: [{ name: "available", type: "uint256" }, { name: "locked", type: "uint256" }], stateMutability: "view", type: "function" },
  { inputs: [{ name: "token", type: "address" }, { name: "price", type: "uint256" }], name: "updatePrice", outputs: [], stateMutability: "nonpayable", type: "function" },
  { inputs: [{ name: "token", type: "address" }], name: "tokenPrices", outputs: [{ type: "uint256" }], stateMutability: "view", type: "function" },
  { inputs: [{ name: "pairId", type: "uint256" }], name: "canLiquidate", outputs: [{ name: "liquidateLong", type: "bool" }, { name: "liquidateShort", type: "bool" }], stateMutability: "view", type: "function" },
  { inputs: [{ name: "pairId", type: "uint256" }], name: "liquidate", outputs: [], stateMutability: "nonpayable", type: "function" },
  { inputs: [{ name: "pairId", type: "uint256" }], name: "getPairedPosition", outputs: [{
    type: "tuple",
    components: [
      { name: "pairId", type: "uint256" },
      { name: "longTrader", type: "address" },
      { name: "shortTrader", type: "address" },
      { name: "token", type: "address" },
      { name: "size", type: "uint256" },
      { name: "entryPrice", type: "uint256" },
      { name: "longCollateral", type: "uint256" },
      { name: "shortCollateral", type: "uint256" },
      { name: "longSize", type: "uint256" },
      { name: "shortSize", type: "uint256" },
      { name: "openTime", type: "uint256" },
      { name: "accFundingLong", type: "int256" },
      { name: "accFundingShort", type: "int256" },
      { name: "status", type: "uint8" },
    ]
  }], stateMutability: "view", type: "function" },
  { inputs: [], name: "nextPairId", outputs: [{ type: "uint256" }], stateMutability: "view", type: "function" },
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

  // 使用钱包1和2 (已有余额)
  const longWallet = walletsData.wallets[0];
  const shortWallet = walletsData.wallets[1];

  const longAccount = privateKeyToAccount(longWallet.privateKey as `0x${string}`);
  const shortAccount = privateKeyToAccount(shortWallet.privateKey as `0x${string}`);
  const matcherAccount = privateKeyToAccount(MATCHER_PRIVATE_KEY as `0x${string}`);

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

  const matcherWalletClient = createWalletClient({
    account: matcherAccount,
    chain: baseSepolia,
    transport: http(RPC_URL),
  });

  console.log("=== 测试: 爆仓清算 (简化版) ===");

  // 检查余额
  const longBalance = await publicClient.readContract({
    address: SETTLEMENT as `0x${string}`,
    abi: SETTLEMENT_ABI,
    functionName: "getUserBalance",
    args: [longAccount.address],
  });
  const shortBalance = await publicClient.readContract({
    address: SETTLEMENT as `0x${string}`,
    abi: SETTLEMENT_ABI,
    functionName: "getUserBalance",
    args: [shortAccount.address],
  });
  console.log("多头余额:", longBalance[0].toString(), "available,", longBalance[1].toString(), "locked");
  console.log("空头余额:", shortBalance[0].toString(), "available,", shortBalance[1].toString(), "locked");

  // 获取当前nextPairId
  const nextPairIdBefore = await publicClient.readContract({
    address: SETTLEMENT as `0x${string}`,
    abi: SETTLEMENT_ABI,
    functionName: "nextPairId",
  });
  console.log("当前nextPairId:", nextPairIdBefore.toString());

  // 设置初始价格
  console.log("\n--- 设置初始价格 ---");
  const initialPrice = BigInt(2000000000000);
  const priceHash = await matcherWalletClient.writeContract({
    address: SETTLEMENT as `0x${string}`,
    abi: SETTLEMENT_ABI,
    functionName: "updatePrice",
    args: [TOKEN_123 as `0x${string}`, initialPrice],
  });
  await publicClient.waitForTransactionReceipt({ hash: priceHash });
  console.log("初始价格:", initialPrice.toString());

  // 获取nonces
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
  console.log("多头nonce:", longNonce.toString());
  console.log("空头nonce:", shortNonce.toString());

  // 开高杠杆仓位 (50x)
  console.log("\n--- 开高杠杆仓位 (50x) ---");
  const size = parseUnits("0.1", 6); // 0.1 USDT
  const leverage = 500000n; // 50x
  const deadline = BigInt(Math.floor(Date.now() / 1000) + 3600);

  const longOrder = {
    trader: longAccount.address,
    token: TOKEN_123 as `0x${string}`,
    isLong: true,
    size,
    leverage,
    price: initialPrice,
    deadline,
    nonce: longNonce,
    orderType: 0,
  };

  const shortOrder = {
    trader: shortAccount.address,
    token: TOKEN_123 as `0x${string}`,
    isLong: false,
    size,
    leverage,
    price: initialPrice,
    deadline,
    nonce: shortNonce,
    orderType: 0,
  };

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

  const longRes = await fetch("http://localhost:8081/api/order/submit", {
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
  console.log("多头:", await longRes.json());

  const shortRes = await fetch("http://localhost:8081/api/order/submit", {
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
  console.log("空头:", await shortRes.json());

  // 等待链上结算
  console.log("\n等待链上结算 (40秒)...");
  await new Promise(r => setTimeout(r, 40000));

  // 检查新仓位
  const nextPairIdAfter = await publicClient.readContract({
    address: SETTLEMENT as `0x${string}`,
    abi: SETTLEMENT_ABI,
    functionName: "nextPairId",
  });
  console.log("新nextPairId:", nextPairIdAfter.toString());

  if (nextPairIdAfter <= nextPairIdBefore) {
    console.log("没有新仓位创建，检查匹配引擎日志");
    return;
  }

  const pairId = nextPairIdAfter - 1n;
  console.log("新仓位ID:", pairId.toString());

  const position = await publicClient.readContract({
    address: SETTLEMENT as `0x${string}`,
    abi: SETTLEMENT_ABI,
    functionName: "getPairedPosition",
    args: [pairId],
  });
  console.log("仓位信息:");
  console.log("  size:", position.size.toString());
  console.log("  entryPrice:", position.entryPrice.toString());
  console.log("  longCollateral:", position.longCollateral.toString());
  console.log("  shortCollateral:", position.shortCollateral.toString());
  console.log("  status:", position.status === 0 ? "ACTIVE" : position.status === 1 ? "CLOSED" : "LIQUIDATED");

  if (position.status !== 0) {
    console.log("\n仓位不是ACTIVE状态");
    return;
  }

  // 修改价格触发清算 - 下跌50%触发多头清算
  console.log("\n--- 修改价格触发清算 ---");
  const newPrice = (initialPrice * 50n) / 100n;
  console.log("新价格:", newPrice.toString(), "(下跌50%)");

  const priceHash2 = await matcherWalletClient.writeContract({
    address: SETTLEMENT as `0x${string}`,
    abi: SETTLEMENT_ABI,
    functionName: "updatePrice",
    args: [TOKEN_123 as `0x${string}`, newPrice],
  });
  await publicClient.waitForTransactionReceipt({ hash: priceHash2 });

  // 检查可清算状态
  const canLiq = await publicClient.readContract({
    address: SETTLEMENT as `0x${string}`,
    abi: SETTLEMENT_ABI,
    functionName: "canLiquidate",
    args: [pairId],
  });
  console.log("可清算: 多头=", canLiq[0], ", 空头=", canLiq[1]);

  if (!canLiq[0] && !canLiq[1]) {
    console.log("双方都不可清算");
    return;
  }

  // 执行清算 (使用matcher作为清算人)
  console.log("\n--- 执行清算 ---");
  const matcherBalanceBefore = await publicClient.readContract({
    address: SETTLEMENT as `0x${string}`,
    abi: SETTLEMENT_ABI,
    functionName: "getUserBalance",
    args: [matcherAccount.address],
  });
  console.log("清算人余额 (前):", matcherBalanceBefore[0].toString());

  try {
    const liqHash = await matcherWalletClient.writeContract({
      address: SETTLEMENT as `0x${string}`,
      abi: SETTLEMENT_ABI,
      functionName: "liquidate",
      args: [pairId],
    });
    const receipt = await publicClient.waitForTransactionReceipt({ hash: liqHash });
    console.log("清算状态:", receipt.status === "success" ? "✅ 成功" : "❌ 失败");

    const positionAfter = await publicClient.readContract({
      address: SETTLEMENT as `0x${string}`,
      abi: SETTLEMENT_ABI,
      functionName: "getPairedPosition",
      args: [pairId],
    });
    console.log("仓位状态 (后):", positionAfter.status === 0 ? "ACTIVE" : positionAfter.status === 1 ? "CLOSED" : "LIQUIDATED");

    const matcherBalanceAfter = await publicClient.readContract({
      address: SETTLEMENT as `0x${string}`,
      abi: SETTLEMENT_ABI,
      functionName: "getUserBalance",
      args: [matcherAccount.address],
    });
    console.log("清算人余额 (后):", matcherBalanceAfter[0].toString());
    console.log("清算奖励:", (Number(matcherBalanceAfter[0]) - Number(matcherBalanceBefore[0])).toString());
  } catch (e: any) {
    console.error("清算失败:", e.message?.slice(0, 500));
  }
}

main().catch(console.error);
