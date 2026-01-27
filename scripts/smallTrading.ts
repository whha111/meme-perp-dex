/**
 * 小规模真实交易测试 - 只用有余额的钱包
 */
import { createPublicClient, createWalletClient, http } from "viem";
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

// 有余额的钱包索引
const WALLET_INDICES = [0, 1, 2, 3, 4];

const CONFIG = {
  basePrice: 2000000000000n,
  priceRange: 100000000000n,
  minSize: 10000n,  // 0.01 USDT
  maxSize: 50000n,  // 0.05 USDT
  leverage: 100000n,
  ordersPerSecond: 1,
};

const publicClient = createPublicClient({
  chain: baseSepolia,
  transport: http(RPC_URL),
});

const walletsData = JSON.parse(fs.readFileSync("/Users/qinlinqiu/Desktop/Namespace/scripts/market-maker/wallets.json", "utf-8"));

let totalOrders = 0;
let successfulOrders = 0;
let matchedOrders = 0;

async function main() {
  console.log("=== 小规模真实交易 ===\n");

  // 初始化钱包
  const wallets = [];
  for (const i of WALLET_INDICES) {
    const wallet = walletsData.wallets[i];
    const account = privateKeyToAccount(wallet.privateKey);
    const walletClient = createWalletClient({
      account,
      chain: baseSepolia,
      transport: http(RPC_URL),
    });

    // 获取nonce
    const nonceRes = await fetch("http://localhost:8081/api/user/" + account.address + "/nonce");
    const nonceData = await nonceRes.json();

    wallets.push({ account, walletClient, nonce: BigInt(nonceData.nonce) });
  }

  console.log("已加载 " + wallets.length + " 个钱包\n");

  // 持续交易
  const interval = 1000 / CONFIG.ordersPerSecond;

  while (true) {
    const wi = Math.floor(Math.random() * wallets.length);
    const wallet = wallets[wi];
    const isLong = Math.random() > 0.5;
    const priceOffset = BigInt(Math.floor(Math.random() * Number(CONFIG.priceRange * 2n)) - Number(CONFIG.priceRange));
    const price = CONFIG.basePrice + priceOffset;
    const size = CONFIG.minSize + BigInt(Math.floor(Math.random() * Number(CONFIG.maxSize - CONFIG.minSize)));
    const orderType = Math.random() > 0.3 ? 0 : 1;
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
        successfulOrders++;
        wallet.nonce++;
        if (result.matches?.length > 0) matchedOrders++;
      }

      const side = isLong ? "多" : "空";
      const type = orderType === 0 ? "市" : "限";
      const status = result.success ? (result.matches?.length > 0 ? "撮" : "挂") : "x";

      console.log(
        new Date().toLocaleTimeString() + " " +
        "#" + totalOrders + " W" + wi + " " + side + type + " " +
        "P:" + (Number(price) / 1e12).toFixed(4) + " " +
        "S:" + (Number(size) / 1e6).toFixed(3) + " " +
        status + " | " +
        "OK:" + successfulOrders + " M:" + matchedOrders
      );
    } catch (e) {
      console.log("错误:", e.message?.slice(0, 30));
    }

    await new Promise(r => setTimeout(r, interval));
  }
}

main().catch(console.error);
