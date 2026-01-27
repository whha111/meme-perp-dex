/**
 * 测试爆仓清算
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

  // 使用钱包5和钱包6进行清算测试
  const longWallet = walletsData.wallets[4];
  const shortWallet = walletsData.wallets[5];
  const liquidatorWallet = walletsData.wallets[6]; // 清算人

  const longAccount = privateKeyToAccount(longWallet.privateKey as `0x${string}`);
  const shortAccount = privateKeyToAccount(shortWallet.privateKey as `0x${string}`);
  const liquidatorAccount = privateKeyToAccount(liquidatorWallet.privateKey as `0x${string}`);
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

  const liquidatorWalletClient = createWalletClient({
    account: liquidatorAccount,
    chain: baseSepolia,
    transport: http(RPC_URL),
  });

  const matcherWalletClient = createWalletClient({
    account: matcherAccount,
    chain: baseSepolia,
    transport: http(RPC_URL),
  });

  console.log("=== 测试: 爆仓清算 ===");
  console.log("多头钱包:", longAccount.address);
  console.log("空头钱包:", shortAccount.address);
  console.log("清算人:", liquidatorAccount.address);
  console.log("Matcher:", matcherAccount.address);

  // Step 1: 检查/存入保证金
  console.log("\n--- Step 1: 检查/存入保证金 ---");
  const WETH = "0x4200000000000000000000000000000000000006";
  const WETH_ABI = [
    { inputs: [], name: "deposit", outputs: [], stateMutability: "payable", type: "function" },
    { inputs: [{ name: "spender", type: "address" }, { name: "amount", type: "uint256" }], name: "approve", outputs: [{ type: "bool" }], stateMutability: "nonpayable", type: "function" },
  ] as const;
  const DEPOSIT_ABI = [
    { inputs: [{ name: "token", type: "address" }, { name: "amount", type: "uint256" }], name: "deposit", outputs: [], stateMutability: "nonpayable", type: "function" },
  ] as const;

  for (const [name, walletClient, account] of [
    ["多头", longWalletClient, longAccount],
    ["空头", shortWalletClient, shortAccount],
  ] as const) {
    const balance = await publicClient.readContract({
      address: SETTLEMENT as `0x${string}`,
      abi: SETTLEMENT_ABI,
      functionName: "getUserBalance",
      args: [account.address],
    });
    console.log(`${name}当前余额: available=${balance[0]}, locked=${balance[1]}`);

    if (balance[0] < 50000n) {
      console.log(`${name}余额不足，存入保证金...`);
      try {
        const wrapHash = await walletClient.writeContract({
          address: WETH as `0x${string}`,
          abi: WETH_ABI,
          functionName: "deposit",
          value: BigInt(0.02e18),
        });
        await publicClient.waitForTransactionReceipt({ hash: wrapHash });

        const approveHash = await walletClient.writeContract({
          address: WETH as `0x${string}`,
          abi: WETH_ABI,
          functionName: "approve",
          args: [SETTLEMENT as `0x${string}`, BigInt(1e18)],
        });
        await publicClient.waitForTransactionReceipt({ hash: approveHash });

        const depositHash = await walletClient.writeContract({
          address: SETTLEMENT as `0x${string}`,
          abi: DEPOSIT_ABI,
          functionName: "deposit",
          args: [WETH as `0x${string}`, BigInt(0.02e18)],
        });
        await publicClient.waitForTransactionReceipt({ hash: depositHash });
        console.log(`${name}存入完成`);
      } catch (e: any) {
        console.error(`${name}存入失败:`, e.message?.slice(0, 200));
      }
    }
  }

  // Step 2: 设置初始价格
  console.log("\n--- Step 2: 设置初始价格 ---");
  const initialPrice = BigInt(2000000000000); // 0.000002
  try {
    const priceHash = await matcherWalletClient.writeContract({
      address: SETTLEMENT as `0x${string}`,
      abi: SETTLEMENT_ABI,
      functionName: "updatePrice",
      args: [TOKEN_123 as `0x${string}`, initialPrice],
    });
    await publicClient.waitForTransactionReceipt({ hash: priceHash });
    console.log("初始价格设置:", initialPrice.toString());
  } catch (e: any) {
    console.error("设置价格失败:", e.message?.slice(0, 200));
  }

  // Step 3: 开高杠杆仓位
  console.log("\n--- Step 3: 开高杠杆仓位 (50x) ---");
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

  const size = parseUnits("0.5", 6); // 0.5 USDT面值
  const leverage = 500000n; // 50倍杠杆
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

  // 提交订单
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
  console.log("多头订单:", await longResponse.json());

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
  console.log("空头订单:", await shortResponse.json());

  // 等待链上结算
  console.log("\n等待链上结算 (40秒)...");
  await new Promise(r => setTimeout(r, 40000));

  // 获取仓位ID
  const nextPairId = await publicClient.readContract({
    address: SETTLEMENT as `0x${string}`,
    abi: SETTLEMENT_ABI,
    functionName: "nextPairId",
  });
  const pairId = nextPairId - 1n;
  console.log("仓位ID:", pairId.toString());

  // 检查仓位
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
    console.log("\n仓位不是ACTIVE状态，无法测试清算");
    return;
  }

  // Step 4: 修改价格触发清算
  console.log("\n--- Step 4: 修改价格触发清算 ---");
  // 50x杠杆，多头爆仓价大约是 entryPrice * (1 - 1/50) = entryPrice * 0.98
  // 设置价格下跌20%来确保触发清算
  const newPrice = (initialPrice * 80n) / 100n;
  console.log("新价格:", newPrice.toString(), "(下跌20%)");

  try {
    const priceHash = await matcherWalletClient.writeContract({
      address: SETTLEMENT as `0x${string}`,
      abi: SETTLEMENT_ABI,
      functionName: "updatePrice",
      args: [TOKEN_123 as `0x${string}`, newPrice],
    });
    await publicClient.waitForTransactionReceipt({ hash: priceHash });
    console.log("价格更新成功");
  } catch (e: any) {
    console.error("价格更新失败:", e.message?.slice(0, 200));
  }

  // 检查是否可清算
  const canLiq = await publicClient.readContract({
    address: SETTLEMENT as `0x${string}`,
    abi: SETTLEMENT_ABI,
    functionName: "canLiquidate",
    args: [pairId],
  });
  console.log("\n可清算状态:");
  console.log("  多头可清算:", canLiq[0]);
  console.log("  空头可清算:", canLiq[1]);

  if (!canLiq[0] && !canLiq[1]) {
    console.log("\n双方都不可清算，尝试更大的价格变动");
    // 设置更极端的价格
    const extremePrice = (initialPrice * 50n) / 100n;
    console.log("极端价格:", extremePrice.toString(), "(下跌50%)");
    const priceHash = await matcherWalletClient.writeContract({
      address: SETTLEMENT as `0x${string}`,
      abi: SETTLEMENT_ABI,
      functionName: "updatePrice",
      args: [TOKEN_123 as `0x${string}`, extremePrice],
    });
    await publicClient.waitForTransactionReceipt({ hash: priceHash });

    const canLiq2 = await publicClient.readContract({
      address: SETTLEMENT as `0x${string}`,
      abi: SETTLEMENT_ABI,
      functionName: "canLiquidate",
      args: [pairId],
    });
    console.log("可清算状态 (极端价格):");
    console.log("  多头可清算:", canLiq2[0]);
    console.log("  空头可清算:", canLiq2[1]);
  }

  // Step 5: 执行清算
  console.log("\n--- Step 5: 执行清算 ---");
  const liquidatorBalanceBefore = await publicClient.readContract({
    address: SETTLEMENT as `0x${string}`,
    abi: SETTLEMENT_ABI,
    functionName: "getUserBalance",
    args: [liquidatorAccount.address],
  });
  console.log("清算人余额 (清算前):", liquidatorBalanceBefore[0].toString());

  try {
    const liqHash = await liquidatorWalletClient.writeContract({
      address: SETTLEMENT as `0x${string}`,
      abi: SETTLEMENT_ABI,
      functionName: "liquidate",
      args: [pairId],
    });
    const receipt = await publicClient.waitForTransactionReceipt({ hash: liqHash });
    console.log("清算交易:", liqHash);
    console.log("状态:", receipt.status === "success" ? "✅ 成功" : "❌ 失败");

    // 检查清算后状态
    const positionAfter = await publicClient.readContract({
      address: SETTLEMENT as `0x${string}`,
      abi: SETTLEMENT_ABI,
      functionName: "getPairedPosition",
      args: [pairId],
    });
    console.log("\n仓位状态 (清算后):", positionAfter.status === 0 ? "ACTIVE" : positionAfter.status === 1 ? "CLOSED" : "LIQUIDATED");

    const liquidatorBalanceAfter = await publicClient.readContract({
      address: SETTLEMENT as `0x${string}`,
      abi: SETTLEMENT_ABI,
      functionName: "getUserBalance",
      args: [liquidatorAccount.address],
    });
    console.log("清算人余额 (清算后):", liquidatorBalanceAfter[0].toString());
    console.log("清算奖励:", (Number(liquidatorBalanceAfter[0]) - Number(liquidatorBalanceBefore[0])).toString());

  } catch (e: any) {
    console.error("清算失败:", e.message?.slice(0, 500));
  }
}

main().catch(console.error);
