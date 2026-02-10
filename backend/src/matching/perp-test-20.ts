/**
 * 合约交易测试：20 个派生钱包 (10 多 10 空, 10x-80x 杠杆)
 *
 * Step 1: 10 多头 + 10 空头 市价单开仓
 * Step 2: 用现货拉高价格，触发空头爆仓
 * Step 3: 用现货砸盘价格，触发多头爆仓
 * Step 4: 检查仓位和爆仓状态
 *
 * 运行: bun run perp-test-20.ts
 */

import {
  createWalletClient,
  createPublicClient,
  http,
  parseEther,
  formatEther,
  getAddress,
  type Address,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { baseSepolia } from "viem/chains";
import fs from "fs";

// ============================================================
// 配置
// ============================================================

const CONFIG = {
  RPC_URL: process.env.RPC_URL || "https://sepolia.base.org",
  API_URL: "http://localhost:8081",
  CHAIN_ID: 84532,

  TOKEN_FACTORY_ADDRESS: getAddress("0x8de2Ce2a0f974b4CB00EC5B56BD89382690b5523"),
  SETTLEMENT_ADDRESS: getAddress("0x35ce4ed5e5d2515Ea05a2f49A70170Fa78e13F7c"),
  TEST_TOKEN: getAddress("0x9ab99d816b7e98d904f6a74098a490cd48dfa63f"), // TPEPE2
};

// 杠杆分配：10个不同杠杆
const LEVERAGES = [10, 15, 20, 25, 30, 40, 50, 60, 70, 80];

// ============================================================
// ABI
// ============================================================

const TOKEN_FACTORY_ABI = [
  {
    inputs: [{ name: "token", type: "address" }, { name: "minAmountOut", type: "uint256" }],
    name: "buy",
    outputs: [{ name: "amountOut", type: "uint256" }],
    stateMutability: "payable",
    type: "function",
  },
  {
    inputs: [{ name: "token", type: "address" }, { name: "tokenAmount", type: "uint256" }, { name: "minEthOut", type: "uint256" }],
    name: "sell",
    outputs: [{ name: "ethAmountOut", type: "uint256" }],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [{ name: "tokenAddress", type: "address" }],
    name: "getCurrentPrice",
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
] as const;

const ERC20_ABI = [
  {
    inputs: [{ name: "account", type: "address" }],
    name: "balanceOf",
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [{ name: "spender", type: "address" }, { name: "amount", type: "uint256" }],
    name: "approve",
    outputs: [{ name: "", type: "bool" }],
    stateMutability: "nonpayable",
    type: "function",
  },
] as const;

const EIP712_DOMAIN = {
  name: "MemePerp",
  version: "1",
  chainId: CONFIG.CHAIN_ID,
  verifyingContract: CONFIG.SETTLEMENT_ADDRESS,
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
} as const;

// ============================================================
// 工具
// ============================================================

const publicClient = createPublicClient({
  chain: baseSepolia,
  transport: http(CONFIG.RPC_URL),
});

interface TradingWallet {
  index: number;
  mainAddress: string;
  derivedAddress: string;
  privateKey: string;
}

interface MainWallet {
  index: number;
  address: string;
  privateKey: string;
}

const tradingWallets: TradingWallet[] = JSON.parse(fs.readFileSync("trading-wallets.json", "utf-8"));
const mainWallets: MainWallet[] = JSON.parse(fs.readFileSync("main-wallets.json", "utf-8"));

function createWallet(privateKey: Hex) {
  const account = privateKeyToAccount(privateKey);
  return createWalletClient({
    account,
    chain: baseSepolia,
    transport: http(CONFIG.RPC_URL),
  });
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function randomBetween(min: number, max: number) {
  return Math.random() * (max - min) + min;
}

// ============================================================
// 提交永续合约订单
// ============================================================

async function submitPerpOrder(params: {
  privateKey: Hex;
  trader: Address;
  isLong: boolean;
  size: bigint;
  leverage: bigint;
  price: bigint;
  orderType: number;
}): Promise<any> {
  try {
    const account = privateKeyToAccount(params.privateKey);
    const walletClient = createWalletClient({
      account,
      chain: baseSepolia,
      transport: http(CONFIG.RPC_URL),
    });

    // 获取 nonce
    let nonce = 0n;
    try {
      const nonceRes = await fetch(`${CONFIG.API_URL}/api/user/${params.trader}/nonce`);
      const nonceData = await nonceRes.json();
      nonce = BigInt(nonceData.nonce || 0);
    } catch {
      nonce = 0n;
    }

    const deadline = BigInt(Math.floor(Date.now() / 1000) + 3600);

    const orderMessage = {
      trader: params.trader,
      token: CONFIG.TEST_TOKEN,
      isLong: params.isLong,
      size: params.size,
      leverage: params.leverage,
      price: params.price,
      deadline,
      nonce,
      orderType: params.orderType,
    };

    // EIP-712 签名
    const signature = await walletClient.signTypedData({
      domain: EIP712_DOMAIN,
      types: ORDER_TYPES,
      primaryType: "Order",
      message: orderMessage,
    });

    // 提交到 API
    const response = await fetch(`${CONFIG.API_URL}/api/order/submit`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        trader: orderMessage.trader,
        token: orderMessage.token,
        isLong: orderMessage.isLong,
        size: orderMessage.size.toString(),
        leverage: orderMessage.leverage.toString(),
        price: orderMessage.price.toString(),
        deadline: orderMessage.deadline.toString(),
        nonce: orderMessage.nonce.toString(),
        orderType: orderMessage.orderType,
        signature,
      }),
    });

    const result = await response.json();
    return { success: result.success !== false && !result.error, ...result };
  } catch (e: any) {
    return { success: false, error: e.message?.slice(0, 100) };
  }
}

// ============================================================
// 主逻辑
// ============================================================

async function main() {
  console.log("=".repeat(60));
  console.log("  合约交易测试: 20 钱包 (10 多 / 10 空, 10x-80x)");
  console.log("=".repeat(60));

  // 检查撮合引擎
  try {
    const health = await fetch(`${CONFIG.API_URL}/health`).then(r => r.json());
    console.log(`\n撮合引擎: ${health.status}`);
  } catch {
    console.log("\n❌ 撮合引擎未运行!");
    return;
  }

  // 获取当前价格
  const currentPrice = await publicClient.readContract({
    address: CONFIG.TOKEN_FACTORY_ADDRESS,
    abi: TOKEN_FACTORY_ABI,
    functionName: "getCurrentPrice",
    args: [CONFIG.TEST_TOKEN],
  });
  const priceNum = Number(currentPrice);
  console.log(`当前价格: ${(priceNum / 1e18).toExponential(4)} ETH`);

  // 前 10 个做多，后 10 个做空
  const longWallets = tradingWallets.slice(0, 10);
  const shortWallets = tradingWallets.slice(10, 20);

  console.log(`\n多头钱包: #0-#9 (${longWallets.length} 个)`);
  console.log(`空头钱包: #10-#19 (${shortWallets.length} 个)`);

  // 检查余额
  console.log(`\n--- 检查保证金余额 ---`);
  for (let i = 0; i < 3; i++) {
    const addr = longWallets[i].derivedAddress;
    try {
      const res = await fetch(`${CONFIG.API_URL}/api/user/${addr}/balance`);
      const data = await res.json();
      console.log(`  LONG #${i}: available=${data.display?.availableBalance}`);
    } catch {
      console.log(`  LONG #${i}: 查询失败`);
    }
  }
  for (let i = 0; i < 3; i++) {
    const addr = shortWallets[i].derivedAddress;
    try {
      const res = await fetch(`${CONFIG.API_URL}/api/user/${addr}/balance`);
      const data = await res.json();
      console.log(`  SHORT #${i}: available=${data.display?.availableBalance}`);
    } catch {
      console.log(`  SHORT #${i}: 查询失败`);
    }
  }

  // === Step 1: 市价单开仓 (10 多 + 10 空) ===
  console.log(`\n--- Step 1: 市价单开仓 (10 多 + 10 空) ---`);

  let longSuccess = 0;
  let shortSuccess = 0;

  // 10 多头
  for (let i = 0; i < 10; i++) {
    const wallet = longWallets[i];
    const leverage = LEVERAGES[i];
    // margin 约 0.003~0.006 ETH, size = margin * leverage
    const marginEth = randomBetween(0.003, 0.006);
    const sizeEth = marginEth * leverage;
    const sizeWei = parseEther(sizeEth.toFixed(6));

    const result = await submitPerpOrder({
      privateKey: wallet.privateKey as Hex,
      trader: wallet.derivedAddress as Address,
      isLong: true,
      size: sizeWei,
      leverage: BigInt(leverage) * 10000n, // 1e4 精度
      price: 0n,     // 市价
      orderType: 0,  // MARKET
    });

    if (result.success) {
      longSuccess++;
      const matchCount = result.matches?.length || 0;
      console.log(`  LONG #${i} ${leverage}x: ✅ margin=${marginEth.toFixed(4)} size=${sizeEth.toFixed(4)} ETH (${matchCount} matches)`);
    } else {
      console.log(`  LONG #${i} ${leverage}x: ❌ ${result.error || JSON.stringify(result).slice(0, 100)}`);
    }
    await sleep(300);
  }

  // 10 空头
  for (let i = 0; i < 10; i++) {
    const wallet = shortWallets[i];
    const leverage = LEVERAGES[i];
    const marginEth = randomBetween(0.003, 0.006);
    const sizeEth = marginEth * leverage;
    const sizeWei = parseEther(sizeEth.toFixed(6));

    const result = await submitPerpOrder({
      privateKey: wallet.privateKey as Hex,
      trader: wallet.derivedAddress as Address,
      isLong: false,
      size: sizeWei,
      leverage: BigInt(leverage) * 10000n,
      price: 0n,
      orderType: 0,
    });

    if (result.success) {
      shortSuccess++;
      const matchCount = result.matches?.length || 0;
      console.log(`  SHORT #${i} ${leverage}x: ✅ margin=${marginEth.toFixed(4)} size=${sizeEth.toFixed(4)} ETH (${matchCount} matches)`);
    } else {
      console.log(`  SHORT #${i} ${leverage}x: ❌ ${result.error || JSON.stringify(result).slice(0, 100)}`);
    }
    await sleep(300);
  }

  console.log(`\n  结果: LONG ✅ ${longSuccess}/10, SHORT ✅ ${shortSuccess}/10`);

  // === Step 2: 检查仓位 ===
  console.log(`\n--- Step 2: 检查仓位状态 ---`);
  await sleep(2000);

  let totalPositions = 0;
  for (let i = 0; i < 10; i++) {
    const longTrader = longWallets[i].derivedAddress;
    const shortTrader = shortWallets[i].derivedAddress;

    try {
      const longRes = await fetch(`${CONFIG.API_URL}/api/user/${longTrader}/positions`);
      const longData = await longRes.json();
      const longPos = longData.positions || [];
      if (longPos.length > 0) {
        totalPositions++;
        const p = longPos[0];
        console.log(`  LONG #${i}: size=${p.size}, pnl=${p.unrealizedPnL}, liq=${p.liquidationPrice}`);
      }
    } catch { }

    try {
      const shortRes = await fetch(`${CONFIG.API_URL}/api/user/${shortTrader}/positions`);
      const shortData = await shortRes.json();
      const shortPos = shortData.positions || [];
      if (shortPos.length > 0) {
        totalPositions++;
        const p = shortPos[0];
        console.log(`  SHORT #${i}: size=${p.size}, pnl=${p.unrealizedPnL}, liq=${p.liquidationPrice}`);
      }
    } catch { }
  }
  console.log(`  活跃仓位总数: ${totalPositions}`);

  // === Step 3: 用现货制造价格波动 ===
  console.log(`\n--- Step 3: 现货波动触发爆仓 ---`);

  // Phase A: 买入推高价格 (触发空头爆仓)
  console.log(`\n  📈 大量买入推高价格...`);
  const priceBefore = Number(await publicClient.readContract({
    address: CONFIG.TOKEN_FACTORY_ADDRESS,
    abi: TOKEN_FACTORY_ABI,
    functionName: "getCurrentPrice",
    args: [CONFIG.TEST_TOKEN],
  }));

  let buySuccess = 0;
  for (let i = 1; i <= 15; i++) {
    try {
      const wallet = createWallet(mainWallets[i].privateKey as Hex);
      const buyAmount = parseEther(randomBetween(0.1, 0.3).toFixed(4));
      await wallet.writeContract({
        address: CONFIG.TOKEN_FACTORY_ADDRESS,
        abi: TOKEN_FACTORY_ABI,
        functionName: "buy",
        args: [CONFIG.TEST_TOKEN, 0n],
        value: buyAmount,
      });
      buySuccess++;
      if (buySuccess % 5 === 0) {
        const p = await publicClient.readContract({
          address: CONFIG.TOKEN_FACTORY_ADDRESS,
          abi: TOKEN_FACTORY_ABI,
          functionName: "getCurrentPrice",
          args: [CONFIG.TEST_TOKEN],
        });
        const change = ((Number(p) - priceBefore) / priceBefore * 100).toFixed(2);
        console.log(`    ${buySuccess} 笔买入, 价格变化: +${change}%`);
      }
      await sleep(300);
    } catch (e: any) {
      // ignore
    }
  }

  const priceAfterBuy = Number(await publicClient.readContract({
    address: CONFIG.TOKEN_FACTORY_ADDRESS,
    abi: TOKEN_FACTORY_ABI,
    functionName: "getCurrentPrice",
    args: [CONFIG.TEST_TOKEN],
  }));
  const totalBuyChange = ((priceAfterBuy - priceBefore) / priceBefore * 100).toFixed(2);
  console.log(`  买入完成: ${buySuccess} 笔, 价格变化: +${totalBuyChange}%`);

  // 等待风控引擎检测
  console.log(`  等待 5 秒让风控引擎检测...`);
  await sleep(5000);

  // Phase B: 大量卖出压低价格 (触发多头爆仓)
  console.log(`\n  📉 大量卖出压低价格...`);
  let sellCount = 0;
  for (let i = 1; i <= 25; i++) {
    try {
      const wallet = mainWallets[i];
      const client = createWallet(wallet.privateKey as Hex);

      const tokenBalance = await publicClient.readContract({
        address: CONFIG.TEST_TOKEN,
        abi: ERC20_ABI,
        functionName: "balanceOf",
        args: [wallet.address as Address],
      });

      if (tokenBalance > 0n) {
        await client.writeContract({
          address: CONFIG.TEST_TOKEN,
          abi: ERC20_ABI,
          functionName: "approve",
          args: [CONFIG.TOKEN_FACTORY_ADDRESS, tokenBalance],
        });
        await sleep(300);

        await client.writeContract({
          address: CONFIG.TOKEN_FACTORY_ADDRESS,
          abi: TOKEN_FACTORY_ABI,
          functionName: "sell",
          args: [CONFIG.TEST_TOKEN, tokenBalance, 0n],
        });
        sellCount++;

        if (sellCount % 5 === 0) {
          const p = await publicClient.readContract({
            address: CONFIG.TOKEN_FACTORY_ADDRESS,
            abi: TOKEN_FACTORY_ABI,
            functionName: "getCurrentPrice",
            args: [CONFIG.TEST_TOKEN],
          });
          const change = ((Number(p) - priceAfterBuy) / priceAfterBuy * 100).toFixed(2);
          console.log(`    ${sellCount} 笔卖出, 价格变化: ${change}%`);
        }
        await sleep(300);
      }
    } catch { }
  }

  const priceAfterSell = Number(await publicClient.readContract({
    address: CONFIG.TOKEN_FACTORY_ADDRESS,
    abi: TOKEN_FACTORY_ABI,
    functionName: "getCurrentPrice",
    args: [CONFIG.TEST_TOKEN],
  }));
  const totalSellChange = ((priceAfterSell - priceAfterBuy) / priceAfterBuy * 100).toFixed(2);
  console.log(`  卖出完成: ${sellCount} 笔, 价格变化: ${totalSellChange}%`);

  // 等待风控引擎检测
  console.log(`\n  等待 10 秒让风控引擎检测爆仓...`);
  console.log(`  👀 请观察前端：持仓列表、爆仓事件、ADL 事件`);
  await sleep(10000);

  // === Step 4: 最终检查 ===
  console.log(`\n--- Step 4: 最终仓位检查 ---`);

  let liquidated = 0;
  let surviving = 0;

  for (let i = 0; i < 10; i++) {
    const longTrader = longWallets[i].derivedAddress;
    try {
      const res = await fetch(`${CONFIG.API_URL}/api/user/${longTrader}/positions`);
      const data = await res.json();
      const positions = data.positions || [];
      if (positions.length > 0) {
        surviving++;
        const p = positions[0];
        console.log(`  LONG #${i} (${LEVERAGES[i]}x): 存活 pnl=${p.unrealizedPnL}`);
      } else {
        liquidated++;
        console.log(`  LONG #${i} (${LEVERAGES[i]}x): ❌ 已爆仓`);
      }
    } catch { }
  }

  for (let i = 0; i < 10; i++) {
    const shortTrader = shortWallets[i].derivedAddress;
    try {
      const res = await fetch(`${CONFIG.API_URL}/api/user/${shortTrader}/positions`);
      const data = await res.json();
      const positions = data.positions || [];
      if (positions.length > 0) {
        surviving++;
        const p = positions[0];
        console.log(`  SHORT #${i} (${LEVERAGES[i]}x): 存活 pnl=${p.unrealizedPnL}`);
      } else {
        liquidated++;
        console.log(`  SHORT #${i} (${LEVERAGES[i]}x): ❌ 已爆仓`);
      }
    } catch { }
  }

  // 检查订单簿
  console.log(`\n--- 订单簿状态 ---`);
  try {
    const obRes = await fetch(`${CONFIG.API_URL}/api/orderbook/${CONFIG.TEST_TOKEN}`);
    const ob = await obRes.json();
    console.log(`  买单: ${ob.data?.bids?.length || 0} 档`);
    console.log(`  卖单: ${ob.data?.asks?.length || 0} 档`);
  } catch { }

  // 最终价格
  const finalPrice = await publicClient.readContract({
    address: CONFIG.TOKEN_FACTORY_ADDRESS,
    abi: TOKEN_FACTORY_ABI,
    functionName: "getCurrentPrice",
    args: [CONFIG.TEST_TOKEN],
  });

  console.log(`\n` + "=".repeat(60));
  console.log(`  测试总结`);
  console.log("=".repeat(60));
  console.log(`  初始价格: ${(priceBefore / 1e18).toExponential(4)} ETH`);
  console.log(`  最高价格: ${(priceAfterBuy / 1e18).toExponential(4)} ETH (+${totalBuyChange}%)`);
  console.log(`  最终价格: ${(Number(finalPrice) / 1e18).toExponential(4)} ETH`);
  console.log(`  总仓位: 20 -> 存活 ${surviving}, 爆仓 ${liquidated}`);
  console.log("=".repeat(60));
}

main().catch((e) => {
  console.error("测试失败:", e);
  process.exit(1);
});
