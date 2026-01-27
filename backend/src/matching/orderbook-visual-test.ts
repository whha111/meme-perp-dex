/**
 * 订单簿可视化测试
 *
 * 展示订单簿深度和撮合过程
 */

import { MatchingEngine, OrderType, OrderStatus } from "./engine.js";
import type { Address, Hex } from "viem";

const TOKEN = "0x0000000000000000000000000000000000000001" as Address;
const MOCK_SIGNATURE = "0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef1b" as Hex;

function generateTraderAddress(index: number): Address {
  const hex = index.toString(16).padStart(40, "0");
  return `0x${hex}` as Address;
}

function parseEther(value: string): bigint {
  return BigInt(Math.floor(parseFloat(value) * 1e18));
}

function formatEther(value: bigint): string {
  return (Number(value) / 1e18).toFixed(2);
}

function formatPrice(value: bigint): string {
  return (Number(value) / 1e18).toFixed(2);
}

function getDeadline(): bigint {
  return BigInt(Math.floor(Date.now() / 1000) + 86400);
}

// 可视化订单簿
function visualizeOrderBook(engine: MatchingEngine, token: Address) {
  const orderBook = engine.getOrderBook(token);
  const depth = orderBook.getDepth(15);
  const currentPrice = orderBook.getCurrentPrice();

  console.log("\n" + "═".repeat(60));
  console.log("                    📊 ORDER BOOK");
  console.log("═".repeat(60));
  console.log(`                  Current Price: ${formatPrice(currentPrice)} ETH`);
  console.log("-".repeat(60));

  // 卖单 (从高到低)
  console.log("     ASKS (Sell Orders)");
  console.log("-".repeat(60));
  console.log("  Price (ETH)    |    Size (ETH)    |  Orders |  Visual");
  console.log("-".repeat(60));

  const maxSize = Math.max(
    ...depth.longs.map(l => Number(l.totalSize) / 1e18),
    ...depth.shorts.map(s => Number(s.totalSize) / 1e18),
    1
  );

  // 显示卖单 (倒序显示，最低卖价在底部靠近中间)
  const shortsReversed = [...depth.shorts].reverse();
  shortsReversed.forEach(level => {
    const size = Number(level.totalSize) / 1e18;
    const barLength = Math.round((size / maxSize) * 20);
    const bar = "█".repeat(barLength);
    console.log(`  ${formatPrice(level.price).padStart(10)}   |   ${size.toFixed(2).padStart(10)}     |    ${level.orders.length.toString().padStart(3)}   | ${bar}`);
  });

  console.log("-".repeat(60));
  console.log(`                    ↑ SPREAD ↑`);
  if (depth.longs.length > 0 && depth.shorts.length > 0) {
    const spread = depth.shorts[0].price - depth.longs[0].price;
    console.log(`              (${formatPrice(spread)} ETH / ${((Number(spread) / Number(depth.longs[0].price)) * 100).toFixed(2)}%)`);
  }
  console.log("-".repeat(60));

  // 买单 (从高到低)
  console.log("     BIDS (Buy Orders)");
  console.log("-".repeat(60));
  console.log("  Price (ETH)    |    Size (ETH)    |  Orders |  Visual");
  console.log("-".repeat(60));

  depth.longs.forEach(level => {
    const size = Number(level.totalSize) / 1e18;
    const barLength = Math.round((size / maxSize) * 20);
    const bar = "█".repeat(barLength);
    console.log(`  ${formatPrice(level.price).padStart(10)}   |   ${size.toFixed(2).padStart(10)}     |    ${level.orders.length.toString().padStart(3)}   | ${bar}`);
  });

  console.log("═".repeat(60));

  // 统计信息
  const totalBidSize = depth.longs.reduce((sum, l) => sum + l.totalSize, 0n);
  const totalAskSize = depth.shorts.reduce((sum, l) => sum + l.totalSize, 0n);
  const bidOrders = depth.longs.reduce((sum, l) => sum + l.orders.length, 0);
  const askOrders = depth.shorts.reduce((sum, l) => sum + l.orders.length, 0);

  console.log("\n  📈 Summary:");
  console.log(`     Total Bid Size: ${formatEther(totalBidSize)} ETH (${bidOrders} orders)`);
  console.log(`     Total Ask Size: ${formatEther(totalAskSize)} ETH (${askOrders} orders)`);
  console.log(`     Bid/Ask Ratio: ${(Number(totalBidSize) / Number(totalAskSize || 1n)).toFixed(2)}`);
}

async function runOrderBookTest() {
  console.log("\n" + "═".repeat(60));
  console.log("       订单簿深度测试 - Order Book Depth Test");
  console.log("═".repeat(60));

  const engine = new MatchingEngine();
  const BASE_PRICE = parseEther("100");
  engine.updatePrice(TOKEN, BASE_PRICE);

  let traderIndex = 0;
  let nonceMap = new Map<Address, bigint>();

  const getNonce = (trader: Address): bigint => {
    const nonce = nonceMap.get(trader) || 0n;
    nonceMap.set(trader, nonce + 1n);
    return nonce;
  };

  // ========================================
  // 阶段1: 构建初始订单簿
  // ========================================
  console.log("\n🔨 Phase 1: Building Initial Order Book\n");

  // 买单 (Bids) - 从 95 到 99.5 ETH
  const bidPrices = [99.5, 99, 98.5, 98, 97.5, 97, 96.5, 96, 95.5, 95];
  const bidSizes = [2, 3, 5, 4, 6, 3, 4, 5, 3, 2];

  console.log("  Creating BID orders...");
  bidPrices.forEach((price, i) => {
    for (let j = 0; j < bidSizes[i]; j++) {
      const trader = generateTraderAddress(traderIndex++);
      const size = parseEther((Math.random() * 2 + 0.5).toFixed(2));
      engine.submitOrder(
        trader, TOKEN, true, size, 50000n, parseEther(price.toString()),
        getDeadline(), getNonce(trader), OrderType.LIMIT, MOCK_SIGNATURE
      );
    }
  });

  // 卖单 (Asks) - 从 100.5 到 105 ETH
  const askPrices = [100.5, 101, 101.5, 102, 102.5, 103, 103.5, 104, 104.5, 105];
  const askSizes = [2, 4, 3, 5, 4, 3, 4, 3, 2, 2];

  console.log("  Creating ASK orders...");
  askPrices.forEach((price, i) => {
    for (let j = 0; j < askSizes[i]; j++) {
      const trader = generateTraderAddress(traderIndex++);
      const size = parseEther((Math.random() * 2 + 0.5).toFixed(2));
      engine.submitOrder(
        trader, TOKEN, false, size, 50000n, parseEther(price.toString()),
        getDeadline(), getNonce(trader), OrderType.LIMIT, MOCK_SIGNATURE
      );
    }
  });

  console.log("  ✓ Initial order book created");
  visualizeOrderBook(engine, TOKEN);

  // ========================================
  // 阶段2: 市价单吃单
  // ========================================
  console.log("\n🎯 Phase 2: Market Order Execution\n");

  const takerTrader = generateTraderAddress(traderIndex++);
  console.log(`  Taker submitting MARKET BUY for 10 ETH...`);

  const { order, matches } = engine.submitOrder(
    takerTrader, TOKEN, true, parseEther("10"), 50000n, 0n,
    getDeadline(), getNonce(takerTrader), OrderType.MARKET, MOCK_SIGNATURE
  );

  console.log(`  ✓ Order filled: ${formatEther(order.filledSize)} ETH`);
  console.log(`  ✓ Matches: ${matches.length}`);

  if (matches.length > 0) {
    const totalValue = matches.reduce((sum, m) => sum + m.matchPrice * m.matchSize / (10n ** 18n), 0n);
    const avgPrice = totalValue * (10n ** 18n) / order.filledSize;
    console.log(`  ✓ Average price: ${formatPrice(avgPrice)} ETH`);
    console.log(`  ✓ Price impact: ${((Number(matches[matches.length-1].matchPrice) - Number(matches[0].matchPrice)) / Number(matches[0].matchPrice) * 100).toFixed(2)}%`);
  }

  visualizeOrderBook(engine, TOKEN);

  // ========================================
  // 阶段3: 大单深度吃单
  // ========================================
  console.log("\n💥 Phase 3: Large Order Sweep\n");

  const whaleTrader = generateTraderAddress(traderIndex++);
  console.log(`  Whale submitting MARKET SELL for 30 ETH...`);

  const { order: whaleOrder, matches: whaleMatches } = engine.submitOrder(
    whaleTrader, TOKEN, false, parseEther("30"), 50000n, 0n,
    getDeadline(), getNonce(whaleTrader), OrderType.MARKET, MOCK_SIGNATURE
  );

  console.log(`  ✓ Order filled: ${formatEther(whaleOrder.filledSize)} ETH`);
  console.log(`  ✓ Matches: ${whaleMatches.length}`);

  if (whaleMatches.length > 0) {
    console.log(`  ✓ First fill price: ${formatPrice(whaleMatches[0].matchPrice)} ETH`);
    console.log(`  ✓ Last fill price: ${formatPrice(whaleMatches[whaleMatches.length-1].matchPrice)} ETH`);
  }

  visualizeOrderBook(engine, TOKEN);

  // ========================================
  // 阶段4: 限价单补充流动性
  // ========================================
  console.log("\n💧 Phase 4: Refilling Liquidity\n");

  // 补充买单
  console.log("  Adding new BID orders...");
  for (let i = 0; i < 20; i++) {
    const trader = generateTraderAddress(traderIndex++);
    const price = parseEther((95 + Math.random() * 5).toFixed(2));
    const size = parseEther((Math.random() * 3 + 1).toFixed(2));
    engine.submitOrder(
      trader, TOKEN, true, size, 50000n, price,
      getDeadline(), getNonce(trader), OrderType.LIMIT, MOCK_SIGNATURE
    );
  }

  // 补充卖单
  console.log("  Adding new ASK orders...");
  for (let i = 0; i < 20; i++) {
    const trader = generateTraderAddress(traderIndex++);
    const price = parseEther((100 + Math.random() * 5).toFixed(2));
    const size = parseEther((Math.random() * 3 + 1).toFixed(2));
    engine.submitOrder(
      trader, TOKEN, false, size, 50000n, price,
      getDeadline(), getNonce(trader), OrderType.LIMIT, MOCK_SIGNATURE
    );
  }

  console.log("  ✓ Liquidity refilled");
  visualizeOrderBook(engine, TOKEN);

  // ========================================
  // 阶段5: 限价单穿越成交
  // ========================================
  console.log("\n⚡ Phase 5: Crossing Limit Orders\n");

  // 获取当前最佳卖价
  const currentDepth = engine.getOrderBook(TOKEN).getDepth(1);
  const bestAsk = currentDepth.shorts[0]?.price || parseEther("101");
  const bestBid = currentDepth.longs[0]?.price || parseEther("99");

  console.log(`  Current best bid: ${formatPrice(bestBid)} ETH`);
  console.log(`  Current best ask: ${formatPrice(bestAsk)} ETH`);

  // 挂一个激进的买单 (高于最佳卖价)
  const aggressiveBuyer = generateTraderAddress(traderIndex++);
  const aggressiveBuyPrice = bestAsk + parseEther("0.5"); // 比最佳卖价高 0.5

  console.log(`\n  Aggressive BUY limit order at ${formatPrice(aggressiveBuyPrice)} ETH for 5 ETH`);

  const { order: aggOrder, matches: aggMatches } = engine.submitOrder(
    aggressiveBuyer, TOKEN, true, parseEther("5"), 50000n, aggressiveBuyPrice,
    getDeadline(), getNonce(aggressiveBuyer), OrderType.LIMIT, MOCK_SIGNATURE
  );

  console.log(`  ✓ Filled: ${formatEther(aggOrder.filledSize)} ETH`);
  console.log(`  ✓ Matches: ${aggMatches.length}`);
  console.log(`  ✓ Status: ${aggOrder.status}`);

  visualizeOrderBook(engine, TOKEN);

  // ========================================
  // 最终统计
  // ========================================
  console.log("\n" + "═".repeat(60));
  console.log("                  📊 FINAL STATISTICS");
  console.log("═".repeat(60));

  const pendingMatches = engine.getPendingMatches();
  console.log(`\n  Total matches pending: ${pendingMatches.length}`);

  const totalMatchedSize = pendingMatches.reduce((sum, m) => sum + m.matchSize, 0n);
  console.log(`  Total matched volume: ${formatEther(totalMatchedSize)} ETH`);

  const uniqueTraders = new Set([
    ...pendingMatches.map(m => m.longOrder.trader),
    ...pendingMatches.map(m => m.shortOrder.trader),
  ]);
  console.log(`  Unique traders: ${uniqueTraders.size}`);

  console.log("\n  ✅ Order book visualization test complete!");
}

runOrderBookTest().catch((e) => {
  console.error("\n❌ Test Failed:", e.message);
  process.exit(1);
});
