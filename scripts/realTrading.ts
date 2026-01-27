/**
 * 真实交易 - 只用余额充足的钱包
 */
import { createPublicClient, createWalletClient, http } from "viem";
import { baseSepolia } from "viem/chains";
import { privateKeyToAccount } from "viem/accounts";
import * as fs from "fs";

const RPC_URL = "https://base-sepolia.g.alchemy.com/v2/Dr8sMe-1MYIF7jBYuZZj8PMOPAAeJ16d";
const SETTLEMENT = "0xB06C32C7536EC5EAD101fEe2AD4005a5eedcB258" as const;
const TOKEN_123 = "0x01c6058175eda34fc8922eeae32bc383cb203211" as const;

const EIP712_DOMAIN = {
  name: "MemePerp",
  version: "1",
  chainId: 84532,
  verifyingContract: SETTLEMENT,
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

// 余额充足的钱包
const WALLET_INDICES = [0, 1, 2, 3, 5];  // available >= 15000

const CONFIG = {
  // Meme币真实价格范围: $0.0000056 左右
  // 内部精度: 12位小数, 所以 0.0000056 = 5600000n (5.6 * 10^6)
  basePrice: 5600000n,           // $0.0000056
  priceRange: 560000n,           // ±10% 价格波动 ($0.00000056)
  minSize: 100000000n,           // 100 USDT 的代币 (约 17,857,142 个代币)
  maxSize: 500000000n,           // 500 USDT 的代币
  leverage: 100000n,             // 10x 杠杆
  ordersPerSecond: 3,            // 每秒3笔订单
};

const publicClient = createPublicClient({
  chain: baseSepolia,
  transport: http(RPC_URL),
});

const walletsData = JSON.parse(fs.readFileSync("/Users/qinlinqiu/Desktop/Namespace/scripts/market-maker/wallets.json", "utf-8"));

let totalOrders = 0;
let matchedOrders = 0;

async function main() {
  console.log("=== 真实链上交易 ===\n");

  const wallets: any[] = [];
  for (const i of WALLET_INDICES) {
    const wallet = walletsData.wallets[i];
    const account = privateKeyToAccount(wallet.privateKey);
    const walletClient = createWalletClient({
      account,
      chain: baseSepolia,
      transport: http(RPC_URL),
    });

    const nonceRes = await fetch(`http://localhost:8081/api/user/${account.address}/nonce`);
    const nonceData = await nonceRes.json();

    wallets.push({ account, walletClient, nonce: BigInt(nonceData.nonce), index: i });
  }

  console.log(`已加载 ${wallets.length} 个钱包\n`);

  while (true) {
    const wi = Math.floor(Math.random() * wallets.length);
    const wallet = wallets[wi];
    const isLong = Math.random() > 0.5;
    const priceOffset = BigInt(Math.floor(Math.random() * Number(CONFIG.priceRange * 2n)) - Number(CONFIG.priceRange));
    const price = CONFIG.basePrice + priceOffset;
    const size = CONFIG.minSize + BigInt(Math.floor(Math.random() * Number(CONFIG.maxSize - CONFIG.minSize)));
    const orderType = Math.random() > 0.5 ? 0 : 1;  // 50% 市价, 50% 限价
    const deadline = BigInt(Math.floor(Date.now() / 1000) + 3600);

    const order = {
      trader: wallet.account.address,
      token: TOKEN_123,
      isLong,
      size,
      leverage: CONFIG.leverage,
      price,
      deadline,
      nonce: wallet.nonce,
      orderType,
    };

    try {
      const signature = await wallet.walletClient.signTypedData({
        domain: EIP712_DOMAIN,
        types: ORDER_TYPES,
        primaryType: "Order",
        message: order,
      });

      const res = await fetch("http://localhost:8081/api/order/submit", {
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

      const result = await res.json();
      totalOrders++;

      if (result.success) {
        wallet.nonce++;
        if (result.matches?.length > 0) matchedOrders++;
        const side = isLong ? "多" : "空";
        const type = orderType === 0 ? "市" : "限";
        const status = result.matches?.length > 0 ? "撮合" : "挂单";
        // 价格精度: 12位小数，显示10位 (0.0000056789)
        const priceDisplay = (Number(price)/1e12).toFixed(10);
        // 订单大小: 6位小数，显示2位 (USDT价值)
        const sizeDisplay = (Number(size)/1e6).toFixed(2);
        console.log(`[${new Date().toLocaleTimeString()}] #${totalOrders} 钱包${wallet.index} ${side}${type} P:${priceDisplay} S:$${sizeDisplay} ${status} (撮合:${matchedOrders})`);
      } else {
        console.log(`[${new Date().toLocaleTimeString()}] #${totalOrders} 失败: ${result.error?.slice(0, 30)}`);
      }
    } catch (e: any) {
      console.log(`错误: ${e.message?.slice(0, 30)}`);
    }

    await new Promise(r => setTimeout(r, 1000 / CONFIG.ordersPerSecond));
  }
}

main().catch(console.error);
