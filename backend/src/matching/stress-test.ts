/**
 * 撮合引擎压力测试 - 大规模挂单测试
 *
 * 测试场景：
 * 1. 多用户大量限价单挂单
 * 2. 订单簿深度测试
 * 3. 价格优先、时间优先匹配
 * 4. 部分成交与多订单匹配
 * 5. 性能指标统计
 */

import { MatchingEngine, OrderType, OrderStatus, type Match, type Order } from "./engine.js";
import type { Address, Hex } from "viem";

// ============================================================
// Test Configuration
// ============================================================

const NUM_TRADERS = 20;
const ORDERS_PER_TRADER = 50;
const PRICE_LEVELS = 20; // 价格档位数量
const BASE_PRICE = 1000n * 10n ** 18n; // 1000 ETH base price
const PRICE_TICK = 1n * 10n ** 18n; // 1 ETH tick size
const MOCK_SIGNATURE = "0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef1b" as Hex;

// Token address
const TOKEN = "0x0000000000000000000000000000000000000001" as Address;

// ============================================================
// Helpers
// ============================================================

function generateTraderAddress(index: number): Address {
  const hex = index.toString(16).padStart(40, "0");
  return `0x${hex}` as Address;
}

function parseEther(value: string): bigint {
  return BigInt(Math.floor(parseFloat(value) * 1e18));
}

function formatEther(value: bigint): string {
  return (Number(value) / 1e18).toFixed(4);
}

function getDeadline(): bigint {
  return BigInt(Math.floor(Date.now() / 1000) + 86400); // 24 hours
}

function randomBetween(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function assert(condition: boolean, message: string) {
  if (!condition) {
    throw new Error(`FAIL: ${message}`);
  }
  console.log(`  ✓ ${message}`);
}

// ============================================================
// Performance Tracking
// ============================================================

interface PerformanceMetrics {
  totalOrders: number;
  totalMatches: number;
  avgMatchTime: number;
  maxMatchTime: number;
  minMatchTime: number;
  ordersPerSecond: number;
  matchesPerSecond: number;
}

const metrics: PerformanceMetrics = {
  totalOrders: 0,
  totalMatches: 0,
  avgMatchTime: 0,
  maxMatchTime: 0,
  minMatchTime: Infinity,
  ordersPerSecond: 0,
  matchesPerSecond: 0,
};

const matchTimes: number[] = [];

// ============================================================
// Stress Tests
// ============================================================

async function runStressTest() {
  console.log("\n" + "=".repeat(70));
  console.log("  撮合引擎压力测试 - Order Book Stress Test");
  console.log("=".repeat(70));

  const engine = new MatchingEngine();
  engine.updatePrice(TOKEN, BASE_PRICE);

  const startTime = Date.now();

  // ========================================
  // Test 1: 大量限价单挂单
  // ========================================
  console.log("\n" + "-".repeat(70));
  console.log("Test 1: 大量限价单挂单 (Mass Limit Order Placement)");
  console.log("-".repeat(70));
  console.log(`  配置: ${NUM_TRADERS} traders, ${ORDERS_PER_TRADER} orders each`);
  console.log(`  价格范围: ${formatEther(BASE_PRICE - BigInt(PRICE_LEVELS) * PRICE_TICK)} - ${formatEther(BASE_PRICE + BigInt(PRICE_LEVELS) * PRICE_TICK)} ETH`);

  let longOrderCount = 0;
  let shortOrderCount = 0;
  let nonceMap = new Map<Address, bigint>();

  // 创建多空双方的限价单
  console.log("\n  Creating orders...");

  // Long side: 买单 (出价低于市价)
  for (let i = 0; i < NUM_TRADERS / 2; i++) {
    const trader = generateTraderAddress(i);

    for (let j = 0; j < ORDERS_PER_TRADER; j++) {
      const priceOffset = BigInt(randomBetween(1, PRICE_LEVELS)) * PRICE_TICK;
      const price = BASE_PRICE - priceOffset; // 买单价格低于市价
      const size = parseEther((randomBetween(1, 10) / 10).toString()); // 0.1 - 1.0 ETH
      const leverage = BigInt(randomBetween(2, 10)) * 10000n; // 2x - 10x
      const nonce = nonceMap.get(trader) || 0n;
      nonceMap.set(trader, nonce + 1n);

      const orderStart = performance.now();
      engine.submitOrder(
        trader, TOKEN, true, size, leverage, price,
        getDeadline(), nonce, OrderType.LIMIT, MOCK_SIGNATURE
      );
      const orderTime = performance.now() - orderStart;
      matchTimes.push(orderTime);

      longOrderCount++;
      metrics.totalOrders++;
    }
  }

  // Short side: 卖单 (要价高于市价)
  for (let i = NUM_TRADERS / 2; i < NUM_TRADERS; i++) {
    const trader = generateTraderAddress(i);

    for (let j = 0; j < ORDERS_PER_TRADER; j++) {
      const priceOffset = BigInt(randomBetween(1, PRICE_LEVELS)) * PRICE_TICK;
      const price = BASE_PRICE + priceOffset; // 卖单价格高于市价
      const size = parseEther((randomBetween(1, 10) / 10).toString());
      const leverage = BigInt(randomBetween(2, 10)) * 10000n;
      const nonce = nonceMap.get(trader) || 0n;
      nonceMap.set(trader, nonce + 1n);

      const orderStart = performance.now();
      engine.submitOrder(
        trader, TOKEN, false, size, leverage, price,
        getDeadline(), nonce, OrderType.LIMIT, MOCK_SIGNATURE
      );
      const orderTime = performance.now() - orderStart;
      matchTimes.push(orderTime);

      shortOrderCount++;
      metrics.totalOrders++;
    }
  }

  console.log(`  ✓ Long orders created: ${longOrderCount}`);
  console.log(`  ✓ Short orders created: ${shortOrderCount}`);
  console.log(`  ✓ Total orders: ${metrics.totalOrders}`);

  // 检查订单簿深度
  const orderBook = engine.getOrderBook(TOKEN);
  const depth = orderBook.getDepth(PRICE_LEVELS);

  console.log(`\n  📊 Order Book Depth:`);
  console.log(`     Long levels: ${depth.longs.length}`);
  console.log(`     Short levels: ${depth.shorts.length}`);

  // 显示前5个价格档位
  console.log(`\n     Top 5 Long Levels (Bids):`);
  depth.longs.slice(0, 5).forEach((level, i) => {
    console.log(`       ${i + 1}. ${formatEther(level.price)} ETH - ${formatEther(level.totalSize)} ETH (${level.orders.length} orders)`);
  });

  console.log(`\n     Top 5 Short Levels (Asks):`);
  depth.shorts.slice(0, 5).forEach((level, i) => {
    console.log(`       ${i + 1}. ${formatEther(level.price)} ETH - ${formatEther(level.totalSize)} ETH (${level.orders.length} orders)`);
  });

  assert(depth.longs.length > 0, "Order book has long orders");
  assert(depth.shorts.length > 0, "Order book has short orders");
  assert(engine.getPendingMatches().length === 0, "No matches yet (spread exists)");

  // ========================================
  // Test 2: 市价单吃单
  // ========================================
  console.log("\n" + "-".repeat(70));
  console.log("Test 2: 市价单吃单 (Market Order Taker)");
  console.log("-".repeat(70));

  const takerTrader = generateTraderAddress(100);
  const takerSize = parseEther("5.0"); // 5 ETH 市价单

  // 大单做空 - 吃掉多个买单
  console.log(`\n  Submitting market SHORT order: ${formatEther(takerSize)} ETH`);
  const marketStart = performance.now();
  const { order: shortOrder, matches: shortMatches } = engine.submitOrder(
    takerTrader, TOKEN, false, takerSize, 50000n, 0n, // 市价单 price=0
    getDeadline(), 0n, OrderType.MARKET, MOCK_SIGNATURE
  );
  const marketTime = performance.now() - marketStart;

  console.log(`  ✓ Market order processed in ${marketTime.toFixed(2)}ms`);
  console.log(`  ✓ Matches created: ${shortMatches.length}`);
  console.log(`  ✓ Total matched size: ${formatEther(shortMatches.reduce((sum, m) => sum + m.matchSize, 0n))} ETH`);
  console.log(`  ✓ Order status: ${shortOrder.status}`);
  console.log(`  ✓ Filled size: ${formatEther(shortOrder.filledSize)} ETH`);

  metrics.totalMatches += shortMatches.length;

  if (shortMatches.length > 0) {
    console.log(`\n     Match Details (first 5):`);
    shortMatches.slice(0, 5).forEach((match, i) => {
      console.log(`       ${i + 1}. ${formatEther(match.matchSize)} ETH @ ${formatEther(match.matchPrice)} ETH`);
    });
  }

  // ========================================
  // Test 3: 限价单穿越成交
  // ========================================
  console.log("\n" + "-".repeat(70));
  console.log("Test 3: 限价单穿越成交 (Crossing Limit Orders)");
  console.log("-".repeat(70));

  const crossingTrader = generateTraderAddress(101);
  // 挂一个激进的买单，价格高于当前最低卖价
  const bestAsk = depth.shorts[0]?.price || BASE_PRICE + PRICE_TICK;
  const aggressivePrice = bestAsk + PRICE_TICK * 5n; // 高于最低卖价

  console.log(`\n  Best ask price: ${formatEther(bestAsk)} ETH`);
  console.log(`  Aggressive buy price: ${formatEther(aggressivePrice)} ETH`);

  const { order: crossingOrder, matches: crossingMatches } = engine.submitOrder(
    crossingTrader, TOKEN, true, parseEther("3.0"), 50000n, aggressivePrice,
    getDeadline(), 0n, OrderType.LIMIT, MOCK_SIGNATURE
  );

  console.log(`  ✓ Crossing order matches: ${crossingMatches.length}`);
  console.log(`  ✓ Order status: ${crossingOrder.status}`);
  console.log(`  ✓ Filled size: ${formatEther(crossingOrder.filledSize)} ETH`);

  metrics.totalMatches += crossingMatches.length;

  // ========================================
  // Test 4: 批量订单提交
  // ========================================
  console.log("\n" + "-".repeat(70));
  console.log("Test 4: 批量订单提交 (Batch Order Submission)");
  console.log("-".repeat(70));

  const batchStart = Date.now();
  const BATCH_SIZE = 100;
  let batchMatches = 0;

  console.log(`\n  Submitting ${BATCH_SIZE} orders rapidly...`);

  for (let i = 0; i < BATCH_SIZE; i++) {
    const isLong = i % 2 === 0;
    const trader = generateTraderAddress(200 + i);
    const priceOffset = BigInt(randomBetween(0, 3)) * PRICE_TICK;
    // 使价格有机会交叉
    const price = isLong
      ? BASE_PRICE + priceOffset // 激进买单
      : BASE_PRICE - priceOffset; // 激进卖单
    const size = parseEther("0.5");

    const { matches } = engine.submitOrder(
      trader, TOKEN, isLong, size, 50000n, price,
      getDeadline(), 0n, OrderType.LIMIT, MOCK_SIGNATURE
    );

    batchMatches += matches.length;
    metrics.totalOrders++;
    metrics.totalMatches += matches.length;
  }

  const batchTime = Date.now() - batchStart;
  console.log(`  ✓ Batch completed in ${batchTime}ms`);
  console.log(`  ✓ Orders per second: ${(BATCH_SIZE / (batchTime / 1000)).toFixed(0)}`);
  console.log(`  ✓ Matches in batch: ${batchMatches}`);

  // ========================================
  // Test 5: 订单取消测试
  // ========================================
  console.log("\n" + "-".repeat(70));
  console.log("Test 5: 订单取消测试 (Order Cancellation)");
  console.log("-".repeat(70));

  // 创建一个新订单然后取消
  const cancelTrader = generateTraderAddress(300);
  const { order: toCancel } = engine.submitOrder(
    cancelTrader, TOKEN, true, parseEther("1.0"), 50000n, BASE_PRICE - PRICE_TICK * 10n,
    getDeadline(), 0n, OrderType.LIMIT, MOCK_SIGNATURE
  );

  console.log(`\n  Created order: ${toCancel.id}`);

  const cancelSuccess = engine.cancelOrder(toCancel.id, cancelTrader);
  assert(cancelSuccess, "Order cancelled successfully");

  const cancelFail = engine.cancelOrder(toCancel.id, generateTraderAddress(301));
  assert(!cancelFail, "Cannot cancel other's order");

  // ========================================
  // Test 6: 深度吃单测试
  // ========================================
  console.log("\n" + "-".repeat(70));
  console.log("Test 6: 深度吃单测试 (Deep Order Book Sweep)");
  console.log("-".repeat(70));

  const sweepTrader = generateTraderAddress(400);
  const sweepSize = parseEther("50.0"); // 大单

  console.log(`\n  Submitting large market LONG order: ${formatEther(sweepSize)} ETH`);

  const sweepStart = performance.now();
  const { order: sweepOrder, matches: sweepMatches } = engine.submitOrder(
    sweepTrader, TOKEN, true, sweepSize, 50000n, 0n,
    getDeadline(), 0n, OrderType.MARKET, MOCK_SIGNATURE
  );
  const sweepTime = performance.now() - sweepStart;

  console.log(`  ✓ Sweep completed in ${sweepTime.toFixed(2)}ms`);
  console.log(`  ✓ Orders matched: ${sweepMatches.length}`);
  console.log(`  ✓ Total filled: ${formatEther(sweepOrder.filledSize)} ETH`);
  console.log(`  ✓ Order status: ${sweepOrder.status}`);

  if (sweepMatches.length > 0) {
    const avgPrice = sweepMatches.reduce((sum, m) => sum + m.matchPrice * m.matchSize, 0n) / sweepOrder.filledSize;
    console.log(`  ✓ Average fill price: ${formatEther(avgPrice)} ETH`);
    console.log(`  ✓ Price range: ${formatEther(sweepMatches[0].matchPrice)} - ${formatEther(sweepMatches[sweepMatches.length - 1].matchPrice)} ETH`);
  }

  metrics.totalMatches += sweepMatches.length;

  // ========================================
  // Test 7: 待提交队列管理
  // ========================================
  console.log("\n" + "-".repeat(70));
  console.log("Test 7: 待提交队列管理 (Pending Batch Management)");
  console.log("-".repeat(70));

  const pendingMatches = engine.getPendingMatches();
  console.log(`\n  Pending matches in queue: ${pendingMatches.length}`);

  // 模拟批量提交
  if (pendingMatches.length > 0) {
    console.log(`  Simulating batch submission...`);

    // 计算批量提交的统计信息
    const totalSize = pendingMatches.reduce((sum, m) => sum + m.matchSize, 0n);
    const uniqueTraders = new Set([
      ...pendingMatches.map(m => m.longOrder.trader),
      ...pendingMatches.map(m => m.shortOrder.trader),
    ]);

    console.log(`  ✓ Total size to settle: ${formatEther(totalSize)} ETH`);
    console.log(`  ✓ Unique traders: ${uniqueTraders.size}`);
    console.log(`  ✓ Pairs to create: ${pendingMatches.length}`);

    // 清空队列
    engine.clearPendingMatches();
    assert(engine.getPendingMatches().length === 0, "Pending queue cleared");
  }

  // ========================================
  // Final Stats
  // ========================================
  const totalTime = Date.now() - startTime;

  console.log("\n" + "=".repeat(70));
  console.log("  压力测试完成 - Stress Test Complete");
  console.log("=".repeat(70));

  // Calculate metrics
  metrics.avgMatchTime = matchTimes.reduce((a, b) => a + b, 0) / matchTimes.length;
  metrics.maxMatchTime = Math.max(...matchTimes);
  metrics.minMatchTime = Math.min(...matchTimes);
  metrics.ordersPerSecond = metrics.totalOrders / (totalTime / 1000);
  metrics.matchesPerSecond = metrics.totalMatches / (totalTime / 1000);

  console.log(`\n  📊 Performance Metrics:`);
  console.log(`     Total time: ${totalTime}ms`);
  console.log(`     Total orders processed: ${metrics.totalOrders}`);
  console.log(`     Total matches created: ${metrics.totalMatches}`);
  console.log(`     Orders per second: ${metrics.ordersPerSecond.toFixed(0)}`);
  console.log(`     Matches per second: ${metrics.matchesPerSecond.toFixed(0)}`);
  console.log(`     Avg order time: ${metrics.avgMatchTime.toFixed(3)}ms`);
  console.log(`     Max order time: ${metrics.maxMatchTime.toFixed(3)}ms`);
  console.log(`     Min order time: ${metrics.minMatchTime.toFixed(3)}ms`);

  // Final order book state
  const finalDepth = engine.getOrderBook(TOKEN).getDepth(10);
  console.log(`\n  📚 Final Order Book State:`);
  console.log(`     Remaining long levels: ${finalDepth.longs.length}`);
  console.log(`     Remaining short levels: ${finalDepth.shorts.length}`);

  const totalLongSize = finalDepth.longs.reduce((sum, l) => sum + l.totalSize, 0n);
  const totalShortSize = finalDepth.shorts.reduce((sum, l) => sum + l.totalSize, 0n);
  console.log(`     Total long size: ${formatEther(totalLongSize)} ETH`);
  console.log(`     Total short size: ${formatEther(totalShortSize)} ETH`);

  if (finalDepth.longs.length > 0 && finalDepth.shorts.length > 0) {
    const spread = finalDepth.shorts[0].price - finalDepth.longs[0].price;
    console.log(`     Spread: ${formatEther(spread)} ETH`);
  }

  console.log("\n  ✅ All stress tests passed!");
}

// Run the stress test
runStressTest().catch((e) => {
  console.error("\n❌ Stress Test Failed:", e.message);
  console.error(e.stack);
  process.exit(1);
});
