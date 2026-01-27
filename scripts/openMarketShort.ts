/**
 * 开一个市价空单 - 用于撮合测试
 * Token: 123 (0x01c6058175eDA34Fc8922EeAe32BC383CB203211)
 */
import { createPublicClient, createWalletClient, http, formatUnits } from "viem";
import { baseSepolia } from "viem/chains";
import { privateKeyToAccount } from "viem/accounts";
import * as fs from "fs";

const RPC_URL = "https://base-sepolia.g.alchemy.com/v2/Dr8sMe-1MYIF7jBYuZZj8PMOPAAeJ16d";
const SETTLEMENT = "0xa139057B6f391fb123bFdA22763418E80ddf9c8F";
const TOKEN_123 = "0x01c6058175eDA34Fc8922EeAe32BC383CB203211";

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

async function main() {
  console.log("╔════════════════════════════════════════════════════════════╗");
  console.log("║     开市价空单 - $10,000 @ 75x 杠杆                         ║");
  console.log("╚════════════════════════════════════════════════════════════╝\n");

  // 加载测试钱包 (使用第二个钱包作为对手方)
  const walletsData = JSON.parse(fs.readFileSync("/Users/qinlinqiu/Desktop/Namespace/scripts/market-maker/wallets.json", "utf-8"));
  const wallet = walletsData.wallets[1]; // 使用第二个钱包
  const account = privateKeyToAccount(wallet.privateKey as `0x${string}`);

  console.log("钱包地址:", account.address);

  const publicClient = createPublicClient({
    chain: baseSepolia,
    transport: http(RPC_URL),
  });

  const walletClient = createWalletClient({
    account,
    chain: baseSepolia,
    transport: http(RPC_URL),
  });

  // 获取nonce
  const nonce = await publicClient.readContract({
    address: SETTLEMENT as `0x${string}`,
    abi: SETTLEMENT_ABI,
    functionName: "nonces",
    args: [account.address],
  });
  console.log("当前nonce:", nonce.toString());

  // 先获取当前价格
  const tickerRes = await fetch("http://localhost:8081/api/orderbook/" + TOKEN_123);
  const ticker = await tickerRes.json();
  const currentPrice = BigInt(ticker.lastPrice || "7152118");
  console.log("当前价格 (1e12):", currentPrice.toString(), "($" + (Number(currentPrice) / 1e12) + ")");

  // 订单参数 - 与多单相同的大小
  const notionalValue = 10000n * (10n ** 6n); // $10,000 in 1e6 precision
  const sizeInTokens = (notionalValue * (10n ** 24n)) / currentPrice;
  console.log("计算代币数量:", sizeInTokens.toString(), "(", Number(sizeInTokens) / 1e18, "tokens)");

  const leverage = 750000n; // 75x leverage (4 decimals: 75 * 10000)
  const price = 0n; // 市价单
  const deadline = BigInt(Math.floor(Date.now() / 1000) + 3600);

  console.log("\n=== 订单参数 ===");
  console.log("Token:", TOKEN_123);
  console.log("方向: 空 (Short)");
  console.log("代币数量:", Number(sizeInTokens) / 1e18, "tokens");
  console.log("名义价值: ~$10,000");
  console.log("杠杆: 75x");
  console.log("类型: 市价单");

  // 构建订单
  const order = {
    trader: account.address,
    token: TOKEN_123 as `0x${string}`,
    isLong: false, // 空单
    size: sizeInTokens,
    leverage,
    price,
    deadline,
    nonce,
    orderType: 0, // MARKET
  };

  // 签名
  console.log("\n签名订单...");
  const signature = await walletClient.signTypedData({
    domain: EIP712_DOMAIN,
    types: ORDER_TYPES,
    primaryType: "Order",
    message: order,
  });
  console.log("签名:", signature.slice(0, 30) + "...");

  // 提交到撮合引擎
  console.log("\n提交订单到撮合引擎...");

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
  console.log("\n=== 订单提交结果 ===");
  console.log(JSON.stringify(result, null, 2));

  if (result.success && result.matches?.length > 0) {
    console.log("\n✅ 空单已成交！撮合信息:");
    for (const match of result.matches) {
      console.log(`  - 成交价: $${Number(match.matchPrice) / 1e12}`);
      console.log(`  - 成交量: ${Number(match.matchSize) / 1e18} tokens`);
      console.log(`  - 对手方: ${match.counterparty}`);
    }
  } else if (result.success) {
    console.log("\n⏳ 空单已提交，等待撮合...");
  } else {
    console.log("\n❌ 订单提交失败:", result.error);
  }
}

main().catch(console.error);
