/**
 * 测试多单提交 - 验证撮合引擎是否能正常撮合
 */

import {
  createPublicClient,
  createWalletClient,
  http,
  parseEther,
  formatEther,
  type Address,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { baseSepolia } from "viem/chains";

// Configuration
const RPC_URL = "https://base-sepolia.g.alchemy.com/v2/Dr8sMe-1MYIF7jBYuZZj8PMOPAAeJ16d";
const MATCHING_ENGINE_URL = "http://localhost:8081";
const SETTLEMENT_ADDRESS = "0x2F0cb9cb3e96f0733557844e34C5152bFC887aA5" as Address;

// Test wallet - you can replace with any funded wallet
const TEST_PRIVATE_KEY = process.env.TEST_PRIVATE_KEY || "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80"; // Default Hardhat #0

// Settlement ABI
const SETTLEMENT_ABI = [
  {
    inputs: [],
    name: "deposit",
    outputs: [],
    stateMutability: "payable",
    type: "function",
  },
  {
    inputs: [{ name: "user", type: "address" }],
    name: "balances",
    outputs: [
      { name: "available", type: "uint256" },
      { name: "locked", type: "uint256" },
    ],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [{ name: "user", type: "address" }],
    name: "nonces",
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
] as const;

// EIP-712 Domain
const EIP712_DOMAIN = {
  name: "MemePerp",
  version: "1",
  chainId: 84532,
  verifyingContract: SETTLEMENT_ADDRESS,
};

// Order Types (must match server.ts exactly)
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

const LEVERAGE_PRECISION = 10000n;

interface SignedOrder {
  trader: Address;
  token: Address;
  isLong: boolean;
  orderType: number;
  size: string;
  price: string;
  leverage: number;
  nonce: number;
  deadline: number;
  signature: Hex;
}

async function main() {
  const args = process.argv.slice(2);
  const tokenAddress = (args[0] || "0x01c6058175eDA34Fc8922EeAe32BC383CB203211") as Address;
  const sizeEth = args[1] || "0.05";

  const account = privateKeyToAccount(TEST_PRIVATE_KEY as `0x${string}`);

  const publicClient = createPublicClient({
    chain: baseSepolia,
    transport: http(RPC_URL),
  });

  const walletClient = createWalletClient({
    account,
    chain: baseSepolia,
    transport: http(RPC_URL),
  });

  console.log("=== 测试多单提交 ===");
  console.log(`钱包: ${account.address}`);
  console.log(`代币: ${tokenAddress}`);
  console.log(`订单大小: ${sizeEth} ETH`);
  console.log(`Settlement: ${SETTLEMENT_ADDRESS}`);
  console.log("");

  // 1. 检查 Settlement 余额
  const balance = await publicClient.readContract({
    address: SETTLEMENT_ADDRESS,
    abi: SETTLEMENT_ABI,
    functionName: "balances",
    args: [account.address],
  });

  const available = balance[0];
  const size = parseEther(sizeEth);
  const leverage = 10n * LEVERAGE_PRECISION; // 10x leverage
  const requiredMargin = (size * LEVERAGE_PRECISION) / leverage;

  console.log(`Settlement 余额: ${formatEther(available)} ETH`);
  console.log(`需要保证金: ${formatEther(requiredMargin)} ETH`);

  if (available < requiredMargin + parseEther("0.001")) {
    console.log("\n余额不足，需要先存款...");
    const depositAmount = requiredMargin + parseEther("0.002");

    const walletBalance = await publicClient.getBalance({ address: account.address });
    if (walletBalance < depositAmount + parseEther("0.001")) {
      console.error("钱包 ETH 余额不足，无法存款");
      process.exit(1);
    }

    const hash = await walletClient.writeContract({
      address: SETTLEMENT_ADDRESS,
      abi: SETTLEMENT_ABI,
      functionName: "deposit",
      args: [],
      value: depositAmount,
    });
    console.log(`存款交易: ${hash}`);
    await publicClient.waitForTransactionReceipt({ hash });
    console.log("存款完成");
  }

  // 2. 获取 nonce
  const nonce = await publicClient.readContract({
    address: SETTLEMENT_ADDRESS,
    abi: SETTLEMENT_ABI,
    functionName: "nonces",
    args: [account.address],
  });

  // 3. 构建订单
  const order = {
    trader: account.address,
    token: tokenAddress,
    isLong: true, // 开多
    orderType: 0, // Market order
    size: size,
    price: 0n, // Market order
    leverage: leverage,
    nonce: nonce,
    deadline: BigInt(Math.floor(Date.now() / 1000) + 3600),
  };

  console.log(`\n签名多单: ${formatEther(order.size)} ETH, 10x 杠杆`);

  // 4. 签名 EIP-712
  const signature = await account.signTypedData({
    domain: EIP712_DOMAIN,
    types: ORDER_TYPES,
    primaryType: "Order",
    message: order,
  });

  // 5. 提交订单
  const signedOrder: SignedOrder = {
    trader: order.trader,
    token: order.token,
    isLong: order.isLong,
    orderType: order.orderType,
    size: order.size.toString(),
    price: order.price.toString(),
    leverage: Number(order.leverage),
    nonce: Number(order.nonce),
    deadline: Number(order.deadline),
    signature,
  };

  console.log("\n提交订单到撮合引擎...");
  console.log("请求体:", JSON.stringify(signedOrder, null, 2));

  try {
    const response = await fetch(`${MATCHING_ENGINE_URL}/api/order/submit`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(signedOrder),
    });

    const result = await response.json() as { success: boolean; orderId?: string; error?: string; matches?: number };

    if (result.success) {
      console.log(`\n✅ 订单提交成功!`);
      console.log(`订单 ID: ${result.orderId}`);
      if (result.matches && result.matches > 0) {
        console.log(`撮合数量: ${result.matches}`);
        console.log("\n🎉 订单已撮合! 等待链上结算...");
      } else {
        console.log(`撮合数量: 0 (订单已添加到订单簿，等待对手方)`);
      }
    } else {
      console.log(`\n❌ 订单提交失败: ${result.error}`);
    }
  } catch (error) {
    console.error("提交失败:", error);
  }

  // 6. 检查订单簿状态
  console.log("\n检查订单簿状态...");
  const orderBookResponse = await fetch(`${MATCHING_ENGINE_URL}/api/orderbook/${tokenAddress}`);
  const orderBook = await orderBookResponse.json();
  console.log("订单簿:", JSON.stringify(orderBook, null, 2));
}

main().catch(console.error);
