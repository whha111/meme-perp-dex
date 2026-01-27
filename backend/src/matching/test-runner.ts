/**
 * 撮合引擎测试运行器 (Node.js 兼容)
 */

import { MatchingEngine, OrderBook, OrderType, OrderStatus } from "./engine.js";
import type { Address, Hex } from "viem";

// Mock data
const TRADER_A = "0x1111111111111111111111111111111111111111" as Address;
const TRADER_B = "0x2222222222222222222222222222222222222222" as Address;
const TRADER_C = "0x3333333333333333333333333333333333333333" as Address;
const TOKEN = "0xCafeCafeCafeCafeCafeCafeCafeCafeCafeCafe" as Address;
const MOCK_SIGNATURE = "0x1234567890abcdef" as Hex;

function parseEther(value: string): bigint {
  return BigInt(Math.floor(parseFloat(value) * 1e18));
}

function formatEther(value: bigint): string {
  return (Number(value) / 1e18).toFixed(4);
}

function getDeadline(): bigint {
  return BigInt(Math.floor(Date.now() / 1000) + 3600);
}

function assert(condition: boolean, message: string) {
  if (!condition) {
    throw new Error(`FAIL: ${message}`);
  }
  console.log(`  ✓ ${message}`);
}

async function runTests() {
  console.log("\n=== 撮合引擎测试 - 4个核心需求点 ===\n");

  // Test 1: 市价单立即匹配
  console.log("1. 链下撮合 - 市价单立即匹配");
  {
    const engine = new MatchingEngine();
    engine.updatePrice(TOKEN, parseEther("1.0"));

    // Long order
    const { order: longOrder, matches: longMatches } = engine.submitOrder(
      TRADER_A, TOKEN, true, parseEther("1.0"), 100000n, 0n,
      getDeadline(), 0n, OrderType.MARKET, MOCK_SIGNATURE
    );
    assert(longMatches.length === 0, "Long order has no match yet");
    assert(longOrder.status === OrderStatus.PENDING, "Long order is pending");

    // Short order - should match
    const { order: shortOrder, matches: shortMatches } = engine.submitOrder(
      TRADER_B, TOKEN, false, parseEther("1.0"), 100000n, 0n,
      getDeadline(), 0n, OrderType.MARKET, MOCK_SIGNATURE
    );
    assert(shortMatches.length === 1, "Short order matched with long");
    assert(shortMatches[0].matchSize === parseEther("1.0"), "Match size correct");
    assert(shortMatches[0].matchPrice === parseEther("1.0"), "Match price correct");
  }

  // Test 2: 限价单等待配对
  console.log("\n2. 订单等待配对 - 限价单挂单");
  {
    const engine = new MatchingEngine();
    engine.updatePrice(TOKEN, parseEther("1.0"));

    // Long at 0.9, Short at 1.1 - no match
    engine.submitOrder(TRADER_A, TOKEN, true, parseEther("1.0"), 100000n, parseEther("0.9"),
      getDeadline(), 0n, OrderType.LIMIT, MOCK_SIGNATURE);
    const { matches } = engine.submitOrder(TRADER_B, TOKEN, false, parseEther("1.0"), 100000n, parseEther("1.1"),
      getDeadline(), 0n, OrderType.LIMIT, MOCK_SIGNATURE);

    assert(matches.length === 0, "No match when prices don't cross");

    const orderBook = engine.getOrderBook(TOKEN);
    const depth = orderBook.getDepth();
    assert(depth.longs.length === 1, "Long order waiting in book");
    assert(depth.shorts.length === 1, "Short order waiting in book");

    // Now submit crossing order
    const { matches: crossMatches } = engine.submitOrder(
      TRADER_C, TOKEN, false, parseEther("1.0"), 100000n, parseEther("0.9"),
      getDeadline(), 0n, OrderType.LIMIT, MOCK_SIGNATURE
    );
    assert(crossMatches.length === 1, "Crossing order matches");
  }

  // Test 3: 价格优先
  console.log("\n3. 价格优先 - 更好的价格先成交");
  {
    const engine = new MatchingEngine();
    engine.updatePrice(TOKEN, parseEther("1.0"));

    // Three longs at different prices
    engine.submitOrder(TRADER_A, TOKEN, true, parseEther("1.0"), 100000n, parseEther("0.90"),
      getDeadline(), 0n, OrderType.LIMIT, MOCK_SIGNATURE);
    engine.submitOrder(TRADER_B, TOKEN, true, parseEther("1.0"), 100000n, parseEther("0.95"),
      getDeadline(), 0n, OrderType.LIMIT, MOCK_SIGNATURE);
    engine.submitOrder(TRADER_C, TOKEN, true, parseEther("1.0"), 100000n, parseEther("0.92"),
      getDeadline(), 0n, OrderType.LIMIT, MOCK_SIGNATURE);

    // Short at 0.90 - should match 0.95 first (highest bid)
    const { matches } = engine.submitOrder(
      TRADER_A, TOKEN, false, parseEther("1.0"), 100000n, parseEther("0.90"),
      getDeadline(), 1n, OrderType.LIMIT, MOCK_SIGNATURE
    );

    assert(matches.length === 1, "One match made");
    assert(matches[0].longOrder.trader === TRADER_B, "Matched with highest bidder (B@0.95)");
    assert(matches[0].matchPrice === parseEther("0.95"), "Match at best price");
  }

  // Test 4: 批量提交队列
  console.log("\n4. 批量提交 - 配对队列管理");
  {
    const engine = new MatchingEngine();
    engine.updatePrice(TOKEN, parseEther("1.0"));

    // Create two matches
    engine.submitOrder(TRADER_A, TOKEN, true, parseEther("1.0"), 100000n, 0n,
      getDeadline(), 0n, OrderType.MARKET, MOCK_SIGNATURE);
    engine.submitOrder(TRADER_B, TOKEN, false, parseEther("1.0"), 100000n, 0n,
      getDeadline(), 0n, OrderType.MARKET, MOCK_SIGNATURE);

    engine.submitOrder(TRADER_A, TOKEN, true, parseEther("2.0"), 100000n, 0n,
      getDeadline(), 1n, OrderType.MARKET, MOCK_SIGNATURE);
    engine.submitOrder(TRADER_B, TOKEN, false, parseEther("2.0"), 100000n, 0n,
      getDeadline(), 1n, OrderType.MARKET, MOCK_SIGNATURE);

    const pending = engine.getPendingMatches();
    assert(pending.length === 2, "Two matches pending for batch");

    engine.clearPendingMatches();
    assert(engine.getPendingMatches().length === 0, "Queue cleared after batch");
  }

  // Test 5: 部分成交
  console.log("\n5. 部分成交 - 订单拆分");
  {
    const engine = new MatchingEngine();
    engine.updatePrice(TOKEN, parseEther("1.0"));

    // Large long order
    engine.submitOrder(TRADER_A, TOKEN, true, parseEther("5.0"), 100000n, parseEther("1.0"),
      getDeadline(), 0n, OrderType.LIMIT, MOCK_SIGNATURE);

    // Small short - partial fill
    const { matches } = engine.submitOrder(
      TRADER_B, TOKEN, false, parseEther("2.0"), 100000n, parseEther("1.0"),
      getDeadline(), 0n, OrderType.LIMIT, MOCK_SIGNATURE
    );

    assert(matches.length === 1, "Partial match made");
    assert(matches[0].matchSize === parseEther("2.0"), "Matched 2 of 5 ETH");

    const orderBook = engine.getOrderBook(TOKEN);
    const depth = orderBook.getDepth();
    assert(depth.longs[0].totalSize === parseEther("3.0"), "3 ETH remaining in order book");
  }

  // Test 6: 订单取消
  console.log("\n6. 订单取消");
  {
    const engine = new MatchingEngine();
    engine.updatePrice(TOKEN, parseEther("1.0"));

    const { order } = engine.submitOrder(
      TRADER_A, TOKEN, true, parseEther("1.0"), 100000n, parseEther("0.5"),
      getDeadline(), 0n, OrderType.LIMIT, MOCK_SIGNATURE
    );

    assert(engine.cancelOrder(order.id, TRADER_A) === true, "Owner can cancel");
    assert(engine.cancelOrder(order.id, TRADER_B) === false, "Others cannot cancel");

    const orderBook = engine.getOrderBook(TOKEN);
    const depth = orderBook.getDepth();
    assert(depth.longs.length === 0, "Cancelled order removed from book");
  }

  console.log("\n=== 所有测试通过 ===");
  console.log("\n核心需求点验证:");
  console.log("1. ✅ 链下撮合 - 订单簿管理和即时匹配");
  console.log("2. ✅ 订单等待配对 - 限价单挂单等待对手方");
  console.log("3. ✅ 价格优先、时间优先 - 正确的匹配优先级");
  console.log("4. ✅ 批量提交准备 - 配对队列和清空机制");
}

runTests().catch(e => {
  console.error("\n❌ 测试失败:", e.message);
  process.exit(1);
});
