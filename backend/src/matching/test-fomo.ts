/**
 * Test script for FOMO Events & Leaderboard API
 */

import type { Address } from "viem";
import {
  recordOpenPosition,
  recordClosePosition,
  recordLiquidation,
  getRecentFomoEvents,
  getGlobalLeaderboard,
  getTokenLeaderboard,
  getTraderStats,
} from "./modules/fomo";

const API_URL = "http://localhost:8081";

// Test addresses
const TRADER_1: Address = "0x1234567890123456789012345678901234567890";
const TRADER_2: Address = "0xabcdefabcdefabcdefabcdefabcdefabcdefabcd";
const TOKEN_1: Address = "0x7777777777777777777777777777777777777777";
const TOKEN_2: Address = "0x8888888888888888888888888888888888888888";

async function testFomoModule() {
  console.log("🧪 Testing FOMO Events & Leaderboard Module\n");

  try {
    // Test 1: Record large open position
    console.log("Test 1: Record large open position");
    const openEvent = recordOpenPosition(
      TRADER_1,
      TOKEN_1,
      "PEPE",
      true, // long
      BigInt(2e18), // 2 ETH
      BigInt(1e18), // price
      BigInt(100000) // 10x leverage
    );
    if (openEvent) {
      console.log("  ✅ Created FOMO event:", openEvent.type);
      console.log("  Message:", openEvent.message);
    }
    console.log("");

    // Test 2: Record big win
    console.log("Test 2: Record big win");
    const winEvent = recordClosePosition(
      TRADER_1,
      TOKEN_1,
      "PEPE",
      true, // long
      BigInt(2e18), // 2 ETH
      BigInt(15e17), // price
      BigInt(5e17) // 0.5 ETH profit
    );
    if (winEvent) {
      console.log("  ✅ Created FOMO event:", winEvent.type);
      console.log("  Message:", winEvent.message);
    }
    console.log("");

    // Test 3: Record big loss from Trader 2
    console.log("Test 3: Record big loss (Trader 2)");
    const lossEvent = recordClosePosition(
      TRADER_2,
      TOKEN_1,
      "PEPE",
      false, // short
      BigInt(15e17), // 1.5 ETH
      BigInt(1e18), // price
      BigInt(-3e17) // -0.3 ETH loss
    );
    if (lossEvent) {
      console.log("  ✅ Created FOMO event:", lossEvent.type);
      console.log("  Message:", lossEvent.message);
    }
    console.log("");

    // Test 4: Record liquidation
    console.log("Test 4: Record liquidation");
    const liqEvent = recordLiquidation(
      TRADER_2,
      TOKEN_2,
      "DOGE",
      true, // long
      BigInt(5e18), // 5 ETH
      BigInt(1e18), // price
      BigInt(-5e18) // -5 ETH loss
    );
    console.log("  ✅ Created FOMO event:", liqEvent.type);
    console.log("  Message:", liqEvent.message);
    console.log("");

    // Test 5: Get recent FOMO events
    console.log("Test 5: Get recent FOMO events");
    const events = getRecentFomoEvents(10);
    console.log(`  Found ${events.length} events:`);
    events.forEach((event, i) => {
      console.log(`    ${i + 1}. [${event.type}] ${event.message}`);
    });
    console.log("");

    // Test 6: Get global leaderboard
    console.log("Test 6: Get global leaderboard (by PnL)");
    const globalBoard = getGlobalLeaderboard("pnl", 10);
    console.log(`  Top ${globalBoard.length} traders by PnL:`);
    globalBoard.forEach((entry, i) => {
      const pnl = Number(entry.totalPnL) / 1e18;
      const volume = Number(entry.totalVolume) / 1e18;
      console.log(
        `    ${i + 1}. ${entry.displayName} - PnL: ${pnl.toFixed(3)} ETH, Volume: ${volume.toFixed(3)} ETH, Trades: ${entry.tradeCount}, Win Rate: ${entry.winRate.toFixed(1)}%`
      );
    });
    console.log("");

    // Test 7: Get token leaderboard
    console.log("Test 7: Get token leaderboard (PEPE)");
    const tokenBoard = getTokenLeaderboard(TOKEN_1, "pnl", 10);
    console.log(`  Top ${tokenBoard.length} traders for PEPE:`);
    tokenBoard.forEach((entry, i) => {
      const pnl = Number(entry.totalPnL) / 1e18;
      console.log(
        `    ${i + 1}. ${entry.displayName} - PnL: ${pnl.toFixed(3)} ETH`
      );
    });
    console.log("");

    // Test 8: Get trader stats
    console.log("Test 8: Get trader stats (Trader 1)");
    const stats = getTraderStats(TRADER_1);
    if (stats) {
      const pnl = Number(stats.totalPnL) / 1e18;
      const volume = Number(stats.totalVolume) / 1e18;
      const biggestWin = Number(stats.biggestWin) / 1e18;
      const biggestLoss = Number(stats.biggestLoss) / 1e18;
      console.log("  ✅ Trader stats:");
      console.log(`    Total PnL: ${pnl.toFixed(3)} ETH`);
      console.log(`    Total Volume: ${volume.toFixed(3)} ETH`);
      console.log(`    Trade Count: ${stats.tradeCount}`);
      console.log(`    Win Rate: ${stats.winRate.toFixed(1)}%`);
      console.log(`    Biggest Win: ${biggestWin.toFixed(3)} ETH`);
      console.log(`    Biggest Loss: ${biggestLoss.toFixed(3)} ETH`);
    }
    console.log("");

    console.log("✅ All FOMO module tests passed! 🎉\n");
  } catch (error) {
    console.error("❌ Test failed:", error);
    throw error;
  }
}

async function testFomoAPI() {
  console.log("🧪 Testing FOMO Events & Leaderboard API Endpoints\n");

  try {
    // Test 1: Get FOMO events
    console.log("Test 1: GET /api/fomo/events");
    const eventsRes = await fetch(`${API_URL}/api/fomo/events?limit=5`);
    const eventsData = await eventsRes.json();
    if (eventsData.code === "0") {
      console.log(`  ✅ Retrieved ${eventsData.data.length} events`);
      eventsData.data.forEach((event: any, i: number) => {
        console.log(`    ${i + 1}. [${event.type}] ${event.message}`);
      });
    } else {
      console.error("  ❌ Failed:", eventsData.msg);
    }
    console.log("");

    // Test 2: Get global leaderboard
    console.log("Test 2: GET /api/leaderboard/global");
    const globalRes = await fetch(
      `${API_URL}/api/leaderboard/global?sortBy=pnl&limit=10`
    );
    const globalData = await globalRes.json();
    if (globalData.code === "0") {
      console.log(`  ✅ Retrieved ${globalData.data.length} traders`);
      globalData.data.forEach((entry: any, i: number) => {
        const pnl = parseFloat(entry.totalPnL) / 1e18;
        console.log(
          `    ${i + 1}. ${entry.displayName} - PnL: ${pnl.toFixed(3)} ETH, Win Rate: ${entry.winRate.toFixed(1)}%`
        );
      });
    } else {
      console.error("  ❌ Failed:", globalData.msg);
    }
    console.log("");

    // Test 3: Get token leaderboard
    console.log("Test 3: GET /api/leaderboard/token/{token}");
    const tokenRes = await fetch(
      `${API_URL}/api/leaderboard/token/${TOKEN_1}?sortBy=pnl&limit=10`
    );
    const tokenData = await tokenRes.json();
    if (tokenData.code === "0") {
      console.log(`  ✅ Retrieved ${tokenData.data.length} traders for token`);
      tokenData.data.forEach((entry: any, i: number) => {
        const pnl = parseFloat(entry.totalPnL) / 1e18;
        console.log(`    ${i + 1}. ${entry.displayName} - PnL: ${pnl.toFixed(3)} ETH`);
      });
    } else {
      console.error("  ❌ Failed:", tokenData.msg);
    }
    console.log("");

    // Test 4: Get trader stats
    console.log("Test 4: GET /api/trader/{trader}/stats");
    const statsRes = await fetch(`${API_URL}/api/trader/${TRADER_1}/stats`);
    const statsData = await statsRes.json();
    if (statsData.code === "0") {
      console.log("  ✅ Retrieved trader stats:");
      const stats = statsData.data;
      const pnl = parseFloat(stats.totalPnL) / 1e18;
      const volume = parseFloat(stats.totalVolume) / 1e18;
      console.log(`    Total PnL: ${pnl.toFixed(3)} ETH`);
      console.log(`    Total Volume: ${volume.toFixed(3)} ETH`);
      console.log(`    Trade Count: ${stats.tradeCount}`);
      console.log(`    Win Rate: ${stats.winRate.toFixed(1)}%`);
    } else {
      console.error("  ❌ Failed:", statsData.msg);
    }
    console.log("");

    console.log("✅ All FOMO API tests passed! 🎉\n");
  } catch (error) {
    console.error("❌ API test failed:", error);
    throw error;
  }
}

async function runAllTests() {
  console.log("=".repeat(60));
  console.log("FOMO Events & Leaderboard - Complete Test Suite");
  console.log("=".repeat(60));
  console.log("");

  // Test module functions first
  await testFomoModule();

  console.log("---");
  console.log("");

  // Test API endpoints (requires server to be running)
  console.log("⚠️  Make sure the server is running on http://localhost:8081");
  console.log("");

  try {
    await testFomoAPI();
  } catch (error) {
    console.error("\n❌ API tests failed - make sure server is running!");
    console.error("Error:", error);
  }

  console.log("=".repeat(60));
  console.log("✅ Test suite completed!");
  console.log("=".repeat(60));
}

runAllTests().catch(console.error);
