/**
 * 测试市价开仓 - 使用WETH作为保证金
 */
import { createPublicClient, createWalletClient, http, parseEther, formatEther, parseUnits } from "viem";
import { baseSepolia } from "viem/chains";
import { privateKeyToAccount } from "viem/accounts";
import * as fs from "fs";

const RPC_URL = "https://base-sepolia.g.alchemy.com/v2/Dr8sMe-1MYIF7jBYuZZj8PMOPAAeJ16d";
const SETTLEMENT = "0xB06C32C7536EC5EAD101fEe2AD4005a5eedcB258";
const WETH = "0x4200000000000000000000000000000000000006";
const TOKEN_123 = "0x01c6058175eda34fc8922eeae32bc383cb203211";

const WETH_ABI = [
  { inputs: [], name: "deposit", outputs: [], stateMutability: "payable", type: "function" },
  { inputs: [{ name: "account", type: "address" }], name: "balanceOf", outputs: [{ type: "uint256" }], stateMutability: "view", type: "function" },
  { inputs: [{ name: "spender", type: "address" }, { name: "amount", type: "uint256" }], name: "approve", outputs: [{ type: "bool" }], stateMutability: "nonpayable", type: "function" },
] as const;

const SETTLEMENT_ABI = [
  { inputs: [{ name: "token", type: "address" }, { name: "amount", type: "uint256" }], name: "deposit", outputs: [], stateMutability: "nonpayable", type: "function" },
  { inputs: [{ name: "user", type: "address" }], name: "getUserBalance", outputs: [{ name: "available", type: "uint256" }, { name: "locked", type: "uint256" }], stateMutability: "view", type: "function" },
  { inputs: [{ name: "user", type: "address" }], name: "nonces", outputs: [{ type: "uint256" }], stateMutability: "view", type: "function" },
  { inputs: [{ name: "token", type: "address" }], name: "tokenPrices", outputs: [{ type: "uint256" }], stateMutability: "view", type: "function" },
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

  // 使用两个钱包：一个开多，一个开空（用于对冲）
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

  console.log("=== 测试: 合约市价开仓 ===");
  console.log("多头钱包:", longAccount.address);
  console.log("空头钱包:", shortAccount.address);

  // Step 1: 检查WETH余额，不够就wrap
  const wrapAmount = parseEther("0.02"); // 每个钱包0.02 ETH

  for (const [name, walletClient, account] of [
    ["多头", longWalletClient, longAccount],
    ["空头", shortWalletClient, shortAccount],
  ] as const) {
    const wethBalance = await publicClient.readContract({
      address: WETH as `0x${string}`,
      abi: WETH_ABI,
      functionName: "balanceOf",
      args: [account.address],
    });

    console.log(`\n${name} WETH余额:`, formatEther(wethBalance));

    if (wethBalance < wrapAmount) {
      console.log(`${name} 正在wrap ETH...`);
      const hash = await walletClient.writeContract({
        address: WETH as `0x${string}`,
        abi: WETH_ABI,
        functionName: "deposit",
        value: wrapAmount,
      });
      await publicClient.waitForTransactionReceipt({ hash });
      console.log(`${name} Wrap成功`);
    }
  }

  // Step 2: 授权Settlement使用WETH
  console.log("\n=== 授权Settlement ===");
  const approveAmount = parseEther("100"); // 授权足够多

  for (const [name, walletClient] of [
    ["多头", longWalletClient],
    ["空头", shortWalletClient],
  ] as const) {
    const hash = await walletClient.writeContract({
      address: WETH as `0x${string}`,
      abi: WETH_ABI,
      functionName: "approve",
      args: [SETTLEMENT as `0x${string}`, approveAmount],
    });
    await publicClient.waitForTransactionReceipt({ hash });
    console.log(`${name} 授权成功`);
  }

  // Step 3: 存入WETH到Settlement
  console.log("\n=== 存入WETH到Settlement ===");
  const depositAmount = parseEther("0.01"); // 存入0.01 WETH

  for (const [name, walletClient, account] of [
    ["多头", longWalletClient, longAccount],
    ["空头", shortWalletClient, shortAccount],
  ] as const) {
    try {
      const hash = await walletClient.writeContract({
        address: SETTLEMENT as `0x${string}`,
        abi: SETTLEMENT_ABI,
        functionName: "deposit",
        args: [WETH as `0x${string}`, depositAmount],
      });
      await publicClient.waitForTransactionReceipt({ hash });
      console.log(`${name} 存入成功`);

      // 查询余额
      const balance = await publicClient.readContract({
        address: SETTLEMENT as `0x${string}`,
        abi: SETTLEMENT_ABI,
        functionName: "getUserBalance",
        args: [account.address],
      });
      console.log(`${name} Settlement余额: available=${balance.available}, locked=${balance.locked}`);
    } catch (e: any) {
      console.error(`${name} 存入失败:`, e.message?.slice(0, 200));
    }
  }

  // Step 4: 签名订单并提交到撮合引擎
  console.log("\n=== 签名并提交订单 ===");

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

  console.log("多头nonce:", longNonce.toString());
  console.log("空头nonce:", shortNonce.toString());

  // 订单参数
  const size = parseUnits("100", 6); // 100 USDT面值（内部精度6位）
  const leverage = 50000n; // 5倍杠杆 (精度4位)
  const price = parseEther("0.000000002"); // 价格
  const deadline = BigInt(Math.floor(Date.now() / 1000) + 3600); // 1小时后过期

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
    orderType: 0, // MARKET
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
    orderType: 0, // MARKET
  };

  // 签名
  const longSignature = await longWalletClient.signTypedData({
    domain: EIP712_DOMAIN,
    types: ORDER_TYPES,
    primaryType: "Order",
    message: longOrder,
  });
  console.log("多头签名:", longSignature.slice(0, 20) + "...");

  const shortSignature = await shortWalletClient.signTypedData({
    domain: EIP712_DOMAIN,
    types: ORDER_TYPES,
    primaryType: "Order",
    message: shortOrder,
  });
  console.log("空头签名:", shortSignature.slice(0, 20) + "...");

  // 提交到撮合引擎
  console.log("\n=== 提交到撮合引擎 ===");

  try {
    // 提交多头订单
    const longResponse = await fetch("http://localhost:8081/api/order/submit", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        order: {
          trader: longOrder.trader,
          token: longOrder.token,
          isLong: longOrder.isLong,
          size: longOrder.size.toString(),
          leverage: longOrder.leverage.toString(),
          price: longOrder.price.toString(),
          deadline: longOrder.deadline.toString(),
          nonce: longOrder.nonce.toString(),
          orderType: longOrder.orderType,
        },
        signature: longSignature,
      }),
    });
    const longResult = await longResponse.json();
    console.log("多头订单提交:", longResult);

    // 提交空头订单
    const shortResponse = await fetch("http://localhost:8081/api/order/submit", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        order: {
          trader: shortOrder.trader,
          token: shortOrder.token,
          isLong: shortOrder.isLong,
          size: shortOrder.size.toString(),
          leverage: shortOrder.leverage.toString(),
          price: shortOrder.price.toString(),
          deadline: shortOrder.deadline.toString(),
          nonce: shortOrder.nonce.toString(),
          orderType: shortOrder.orderType,
        },
        signature: shortSignature,
      }),
    });
    const shortResult = await shortResponse.json();
    console.log("空头订单提交:", shortResult);

    // 等待撮合
    console.log("\n等待撮合 (30秒)...");
    await new Promise(r => setTimeout(r, 5000));

    // 检查订单簿状态
    const orderbookResponse = await fetch("http://localhost:8081/api/order/submitbook/" + TOKEN_123);
    const orderbook = await orderbookResponse.json();
    console.log("订单簿状态:", JSON.stringify(orderbook, null, 2));

  } catch (e: any) {
    console.error("提交失败:", e.message?.slice(0, 300));
  }
}

main().catch(console.error);
