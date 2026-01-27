/**
 * Add limit orders to order book (at different prices so they don't match)
 */
import { createWalletClient, http, parseUnits } from "viem";
import { baseSepolia } from "viem/chains";
import { privateKeyToAccount } from "viem/accounts";
import * as fs from "fs";

const RPC_URL = "https://base-sepolia.g.alchemy.com/v2/Dr8sMe-1MYIF7jBYuZZj8PMOPAAeJ16d";
const SETTLEMENT = "0xB06C32C7536EC5EAD101fEe2AD4005a5eedcB258";
const TOKEN_123 = "0x01c6058175eda34fc8922eeae32bc383cb203211";

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

  console.log("=== 添加限价单到订单簿 ===\n");

  // Use multiple wallets to add orders
  for (let i = 2; i < 10; i++) {
    const wallet = walletsData.wallets[i];
    const account = privateKeyToAccount(wallet.privateKey as `0x${string}`);

    const walletClient = createWalletClient({
      account,
      chain: baseSepolia,
      transport: http(RPC_URL),
    });

    // Get nonce from matching engine
    const nonceRes = await (await fetch(`http://localhost:8081/api/user/${account.address}/nonce`)).json();
    const nonce = BigInt(nonceRes.nonce);

    const size = parseUnits("1", 6); // 1 USDT
    const leverage = 100000n; // 10x
    const deadline = BigInt(Math.floor(Date.now() / 1000) + 3600);

    // Alternate between long and short orders at different prices
    const isLong = i % 2 === 0;
    // Spread prices: longs at lower prices, shorts at higher prices
    const basePrice = 2000000000000n; // 0.000002
    const priceOffset = BigInt(i - 5) * 100000000000n; // spread
    const price = isLong ? basePrice - priceOffset : basePrice + priceOffset;

    const order = {
      trader: account.address,
      token: TOKEN_123 as `0x${string}`,
      isLong,
      size,
      leverage,
      price,
      deadline,
      nonce,
      orderType: 1, // LIMIT order
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

    const result = await response.json();
    console.log(`钱包${i} (${isLong ? '多' : '空'}): price=${price.toString()}, result=${result.success ? '成功' : result.error}`);
  }

  // Check order book
  const orderBook = await (await fetch(`http://localhost:8081/api/orderbook/${TOKEN_123}`)).json();
  console.log("\n=== 订单簿状态 ===");
  console.log(`多头订单: ${orderBook.longs.length}`);
  console.log(`空头订单: ${orderBook.shorts.length}`);
}

main().catch(console.error);
