/**
 * 大规模真实交易脚本
 * 使用200个钱包在Base Sepolia测试网上真实下单、撮合、结算
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
  { inputs: [{ name: "user", type: "address" }], name: "getUserBalance", outputs: [{ name: "available", type: "uint256" }, { name: "locked", type: "uint256" }], stateMutability: "view", type: "function" },
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

// 配置
const CONFIG = {
  numWallets: 50,           // 使用钱包数量
  ordersPerSecond: 2,       // 每秒下单数
  basePrice: 2000000000000n, // 基础价格 0.000002
  priceRange: 200000000000n, // 价格波动范围 ±10%
  minSize: 100000n,         // 最小订单 0.1 USDT
  maxSize: 1000000n,        // 最大订单 1 USDT
  leverage: 100000n,        // 10x 杠杆
};

const publicClient = createPublicClient({
  chain: baseSepolia,
  transport: http(RPC_URL),
});

// 统计
let totalOrders = 0;
let successfulOrders = 0;
let matchedOrders = 0;
let failedOrders = 0;

async function getOnChainNonce(address: string): Promise<bigint> {
  return await publicClient.readContract({
    address: SETTLEMENT as `0x${string}`,
    abi: SETTLEMENT_ABI,
    functionName: "nonces",
    args: [address as `0x${string}`],
  });
}

async function submitOrder(
  walletClient: any,
  account: any,
  isLong: boolean,
  size: bigint,
  price: bigint,
  nonce: bigint,
  orderType: number
): Promise<{ success: boolean; matched: boolean; error?: string }> {
  const deadline = BigInt(Math.floor(Date.now() / 1000) + 3600);

  const order = {
    trader: account.address,
    token: TOKEN_123 as `0x${string}`,
    isLong,
    size,
    leverage: CONFIG.leverage,
    price,
    deadline,
    nonce,
    orderType,
  };

  try {
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

    const result = await response.json();

    if (result.success) {
      const matched = result.matches && result.matches.length > 0;
      return { success: true, matched };
    } else {
      return { success: false, matched: false, error: result.error };
    }
  } catch (e: any) {
    return { success: false, matched: false, error: e.message };
  }
}

function randomBigInt(min: bigint, max: bigint): bigint {
  const range = max - min;
  const randomFactor = BigInt(Math.floor(Math.random() * Number(range)));
  return min + randomFactor;
}

async function main() {
  console.log("=== 大规模真实交易测试 ===\n");

  // 加载钱包
  const walletsData = JSON.parse(
    fs.readFileSync("/Users/qinlinqiu/Desktop/Namespace/scripts/market-maker/wallets.json", "utf-8")
  );

  const wallets: { account: any; walletClient: any; nonce: bigint }[] = [];

  console.log(`加载 ${CONFIG.numWallets} 个钱包...`);

  for (let i = 0; i < CONFIG.numWallets && i < walletsData.wallets.length; i++) {
    const wallet = walletsData.wallets[i];
    const account = privateKeyToAccount(wallet.privateKey as `0x${string}`);
    const walletClient = createWalletClient({
      account,
      chain: baseSepolia,
      transport: http(RPC_URL),
    });

    // 获取链上nonce
    const nonce = await getOnChainNonce(account.address);

    wallets.push({ account, walletClient, nonce });
  }

  console.log(`已加载 ${wallets.length} 个钱包\n`);
  console.log("开始持续下单...\n");
  console.log("按 Ctrl+C 停止\n");

  // 持续下单循环
  const interval = 1000 / CONFIG.ordersPerSecond;

  const runTrading = async () => {
    while (true) {
      // 随机选择钱包
      const walletIndex = Math.floor(Math.random() * wallets.length);
      const wallet = wallets[walletIndex];

      // 随机方向
      const isLong = Math.random() > 0.5;

      // 随机价格 (基础价格 ± 波动范围)
      const priceOffset = randomBigInt(-CONFIG.priceRange, CONFIG.priceRange);
      const price = CONFIG.basePrice + priceOffset;

      // 随机订单大小
      const size = randomBigInt(CONFIG.minSize, CONFIG.maxSize);

      // 随机订单类型 (70% 市价单, 30% 限价单)
      const orderType = Math.random() > 0.3 ? 0 : 1;

      totalOrders++;

      const result = await submitOrder(
        wallet.walletClient,
        wallet.account,
        isLong,
        size,
        price,
        wallet.nonce,
        orderType
      );

      if (result.success) {
        successfulOrders++;
        wallet.nonce++; // 增加本地nonce

        if (result.matched) {
          matchedOrders++;
        }
      } else {
        failedOrders++;
        // 如果是nonce错误，尝试从链上重新同步
        if (result.error?.includes("nonce")) {
          wallet.nonce = await getOnChainNonce(wallet.account.address);
        }
      }

      // 打印状态
      const side = isLong ? "多" : "空";
      const type = orderType === 0 ? "市价" : "限价";
      const status = result.success ? (result.matched ? "✓撮合" : "✓挂单") : `✗${result.error?.slice(0, 20)}`;

      console.log(
        `[${new Date().toLocaleTimeString()}] ` +
        `#${totalOrders} 钱包${walletIndex} ${side}${type} ` +
        `价格:${(Number(price) / 1e12).toFixed(6)} ` +
        `数量:${(Number(size) / 1e6).toFixed(2)} ` +
        `${status} | ` +
        `成功:${successfulOrders} 撮合:${matchedOrders} 失败:${failedOrders}`
      );

      await new Promise(r => setTimeout(r, interval));
    }
  };

  // 启动交易
  runTrading().catch(console.error);
}

main().catch(console.error);
