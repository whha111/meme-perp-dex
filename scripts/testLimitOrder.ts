/**
 * 测试限价开仓
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

  // 使用钱包3和钱包4测试限价单（保留钱包1、2的仓位用于后续测试）
  const bidWallet = walletsData.wallets[2];
  const askWallet = walletsData.wallets[3];

  const bidAccount = privateKeyToAccount(bidWallet.privateKey as `0x${string}`);
  const askAccount = privateKeyToAccount(askWallet.privateKey as `0x${string}`);

  const publicClient = createPublicClient({
    chain: baseSepolia,
    transport: http(RPC_URL),
  });

  const bidWalletClient = createWalletClient({
    account: bidAccount,
    chain: baseSepolia,
    transport: http(RPC_URL),
  });

  const askWalletClient = createWalletClient({
    account: askAccount,
    chain: baseSepolia,
    transport: http(RPC_URL),
  });

  console.log("=== 测试: 限价开仓 ===");
  console.log("买单钱包:", bidAccount.address);
  console.log("卖单钱包:", askAccount.address);

  // 先存入保证金
  console.log("\n--- 存入保证金 ---");
  const WETH = "0x4200000000000000000000000000000000000006";
  const WETH_ABI = [
    { inputs: [], name: "deposit", outputs: [], stateMutability: "payable", type: "function" },
    { inputs: [{ name: "spender", type: "address" }, { name: "amount", type: "uint256" }], name: "approve", outputs: [{ type: "bool" }], stateMutability: "nonpayable", type: "function" },
  ] as const;
  const DEPOSIT_ABI = [
    { inputs: [{ name: "token", type: "address" }, { name: "amount", type: "uint256" }], name: "deposit", outputs: [], stateMutability: "nonpayable", type: "function" },
    { inputs: [{ name: "user", type: "address" }], name: "getUserBalance", outputs: [{ name: "available", type: "uint256" }, { name: "locked", type: "uint256" }], stateMutability: "view", type: "function" },
  ] as const;

  for (const [name, walletClient, account] of [
    ["买单", bidWalletClient, bidAccount],
    ["卖单", askWalletClient, askAccount],
  ] as const) {
    try {
      // 检查当前余额
      const balance = await publicClient.readContract({
        address: SETTLEMENT as `0x${string}`,
        abi: DEPOSIT_ABI,
        functionName: "getUserBalance",
        args: [account.address],
      });
      console.log(`${name}当前余额: available=${balance[0]}, locked=${balance[1]}`);

      if (balance[0] < 50000n) {
        console.log(`${name}余额不足，存入保证金...`);
        // Wrap ETH
        const wrapHash = await walletClient.writeContract({
          address: WETH as `0x${string}`,
          abi: WETH_ABI,
          functionName: "deposit",
          value: BigInt(0.02e18),
        });
        await publicClient.waitForTransactionReceipt({ hash: wrapHash });

        // Approve
        const approveHash = await walletClient.writeContract({
          address: WETH as `0x${string}`,
          abi: WETH_ABI,
          functionName: "approve",
          args: [SETTLEMENT as `0x${string}`, BigInt(1e18)],
        });
        await publicClient.waitForTransactionReceipt({ hash: approveHash });

        // Deposit
        const depositHash = await walletClient.writeContract({
          address: SETTLEMENT as `0x${string}`,
          abi: DEPOSIT_ABI,
          functionName: "deposit",
          args: [WETH as `0x${string}`, BigInt(0.02e18)],
        });
        await publicClient.waitForTransactionReceipt({ hash: depositHash });

        const newBalance = await publicClient.readContract({
          address: SETTLEMENT as `0x${string}`,
          abi: DEPOSIT_ABI,
          functionName: "getUserBalance",
          args: [account.address],
        });
        console.log(`${name}新余额: available=${newBalance[0]}, locked=${newBalance[1]}`);
      }
    } catch (e: any) {
      console.error(`${name}存入失败:`, e.message?.slice(0, 200));
    }
  }

  // 获取nonce
  const bidNonce = await publicClient.readContract({
    address: SETTLEMENT as `0x${string}`,
    abi: SETTLEMENT_ABI,
    functionName: "nonces",
    args: [bidAccount.address],
  });

  const askNonce = await publicClient.readContract({
    address: SETTLEMENT as `0x${string}`,
    abi: SETTLEMENT_ABI,
    functionName: "nonces",
    args: [askAccount.address],
  });

  console.log("\n买单nonce:", bidNonce.toString());
  console.log("卖单nonce:", askNonce.toString());

  // 限价单参数
  const size = parseUnits("0.1", 6); // 0.1 USDT面值
  const leverage = 100000n; // 10倍杠杆
  const deadline = BigInt(Math.floor(Date.now() / 1000) + 3600);

  // 1. 先提交买单 (限价做多) - 价格低于当前价
  const bidPrice = BigInt(1800000000000); // 0.0000018 (比当前价0.000002低10%)
  console.log("\n--- 提交限价买单 (做多) ---");
  console.log(`价格: ${bidPrice} (0.0000018)`);

  const bidOrder = {
    trader: bidAccount.address,
    token: TOKEN_123 as `0x${string}`,
    isLong: true,
    size,
    leverage,
    price: bidPrice,
    deadline,
    nonce: bidNonce,
    orderType: 1, // LIMIT
  };

  const bidSignature = await bidWalletClient.signTypedData({
    domain: EIP712_DOMAIN,
    types: ORDER_TYPES,
    primaryType: "Order",
    message: bidOrder,
  });

  const bidResponse = await fetch("http://localhost:8081/api/order/submit", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      trader: bidOrder.trader,
      token: bidOrder.token,
      isLong: bidOrder.isLong,
      size: bidOrder.size.toString(),
      leverage: bidOrder.leverage.toString(),
      price: bidOrder.price.toString(),
      deadline: bidOrder.deadline.toString(),
      nonce: bidOrder.nonce.toString(),
      orderType: bidOrder.orderType,
      signature: bidSignature,
    }),
  });
  const bidResult = await bidResponse.json();
  console.log("买单结果:", bidResult);

  // 检查订单簿
  await new Promise(r => setTimeout(r, 2000));
  const orderbook1 = await (await fetch(`http://localhost:8081/api/orderbook/${TOKEN_123}`)).json();
  console.log("\n订单簿 (买单后):", JSON.stringify(orderbook1, null, 2));

  // 2. 提交卖单 (限价做空) - 价格高于当前价
  const askPrice = BigInt(2200000000000); // 0.0000022 (比当前价0.000002高10%)
  console.log("\n--- 提交限价卖单 (做空) ---");
  console.log(`价格: ${askPrice} (0.0000022)`);

  const askOrder = {
    trader: askAccount.address,
    token: TOKEN_123 as `0x${string}`,
    isLong: false,
    size,
    leverage,
    price: askPrice,
    deadline,
    nonce: askNonce,
    orderType: 1, // LIMIT
  };

  const askSignature = await askWalletClient.signTypedData({
    domain: EIP712_DOMAIN,
    types: ORDER_TYPES,
    primaryType: "Order",
    message: askOrder,
  });

  const askResponse = await fetch("http://localhost:8081/api/order/submit", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      trader: askOrder.trader,
      token: askOrder.token,
      isLong: askOrder.isLong,
      size: askOrder.size.toString(),
      leverage: askOrder.leverage.toString(),
      price: askOrder.price.toString(),
      deadline: askOrder.deadline.toString(),
      nonce: askOrder.nonce.toString(),
      orderType: askOrder.orderType,
      signature: askSignature,
    }),
  });
  const askResult = await askResponse.json();
  console.log("卖单结果:", askResult);

  // 检查订单簿
  await new Promise(r => setTimeout(r, 2000));
  const orderbook2 = await (await fetch(`http://localhost:8081/api/orderbook/${TOKEN_123}`)).json();
  console.log("\n订单簿 (卖单后):", JSON.stringify(orderbook2, null, 2));

  // 3. 提交一个市价单来吃掉限价买单
  console.log("\n--- 提交市价卖单吃掉限价买单 ---");
  const marketOrder = {
    trader: askAccount.address,
    token: TOKEN_123 as `0x${string}`,
    isLong: false,
    size,
    leverage,
    price: BigInt(1800000000000), // 愿意以这个价格卖
    deadline,
    nonce: askNonce + 1n,
    orderType: 0, // MARKET
  };

  const marketSignature = await askWalletClient.signTypedData({
    domain: EIP712_DOMAIN,
    types: ORDER_TYPES,
    primaryType: "Order",
    message: marketOrder,
  });

  const marketResponse = await fetch("http://localhost:8081/api/order/submit", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      trader: marketOrder.trader,
      token: marketOrder.token,
      isLong: marketOrder.isLong,
      size: marketOrder.size.toString(),
      leverage: marketOrder.leverage.toString(),
      price: marketOrder.price.toString(),
      deadline: marketOrder.deadline.toString(),
      nonce: marketOrder.nonce.toString(),
      orderType: marketOrder.orderType,
      signature: marketSignature,
    }),
  });
  const marketResult = await marketResponse.json();
  console.log("市价卖单结果:", marketResult);

  // 等待链上结算
  console.log("\n等待链上结算 (35秒)...");
  await new Promise(r => setTimeout(r, 35000));

  // 检查最终状态
  const health = await (await fetch("http://localhost:8081/health")).json();
  console.log("\n撮合引擎状态:", health);

  const finalOrderbook = await (await fetch(`http://localhost:8081/api/orderbook/${TOKEN_123}`)).json();
  console.log("最终订单簿:", JSON.stringify(finalOrderbook, null, 2));
}

main().catch(console.error);
