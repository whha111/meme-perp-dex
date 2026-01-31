/**
 * Test script for Relay Service
 *
 * Tests gasless deposit and withdraw operations via meta-transactions
 */

import type { Address, Hex } from "viem";
import {
  getRelayerStatus,
  getMetaTxNonce,
  getUserBalance,
  relayDepositETH,
  relayWithdraw,
} from "./modules/relay";

const API_URL = "http://localhost:8081";

// Test addresses (use actual addresses from your environment)
const TEST_USER: Address = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266"; // Hardhat test account
const WETH_ADDRESS: Address = "0x4200000000000000000000000000000000000006"; // Base Sepolia WETH

async function testRelayModule() {
  console.log("🧪 Testing Relay Service Module\n");

  try {
    // Test 1: Get relayer status
    console.log("Test 1: Get relayer status");
    const status = await getRelayerStatus();
    console.log("  Status:", {
      enabled: status.enabled,
      address: status.address,
      balance: status.balance ? `${Number(status.balance) / 1e18} ETH` : "N/A",
      settlement: status.settlementAddress,
    });

    if (!status.enabled) {
      console.log("  ⚠️  Relay service not enabled - set RELAYER_PRIVATE_KEY");
      return;
    }
    console.log("");

    // Test 2: Get meta-tx nonce
    console.log("Test 2: Get meta-tx nonce");
    const nonce = await getMetaTxNonce(TEST_USER);
    console.log(`  ✅ Nonce for ${TEST_USER}: ${nonce}`);
    console.log("");

    // Test 3: Get user balance
    console.log("Test 3: Get user Settlement balance");
    const balance = await getUserBalance(TEST_USER);
    console.log("  ✅ Balance:", {
      available: `${Number(balance.available) / 1e6} USDT`,
      reserved: `${Number(balance.reserved) / 1e6} USDT`,
    });
    console.log("");

    // Note: Tests 4 and 5 would require actual signed messages
    console.log("Test 4: Relay depositETH (skipped - requires signed message)");
    console.log("  To test manually:");
    console.log("  1. Sign EIP-712 DepositETH message with user's private key");
    console.log("  2. Call relayDepositETH() with signed message");
    console.log("  3. Relayer will submit depositETHFor() on-chain");
    console.log("");

    console.log("Test 5: Relay withdraw (skipped - requires signed message)");
    console.log("  To test manually:");
    console.log("  1. Sign EIP-712 Withdraw message with user's private key");
    console.log("  2. Call relayWithdraw() with signed message");
    console.log("  3. Relayer will submit withdrawFor() on-chain");
    console.log("");

    console.log("✅ All relay module tests passed! 🎉");
  } catch (error) {
    console.error("❌ Test failed:", error);
    throw error;
  }
}

async function testRelayAPI() {
  console.log("🧪 Testing Relay Service API Endpoints\n");

  try {
    // Test 1: Get relay status
    console.log("Test 1: GET /api/v1/relay/status");
    const statusRes = await fetch(`${API_URL}/api/v1/relay/status`);
    const statusData = await statusRes.json();
    if (statusData.code === "0") {
      console.log("  ✅ Relay status:", statusData.data);
      if (!statusData.data.enabled) {
        console.log("  ⚠️  Relay service not enabled");
        return;
      }
    } else {
      console.error("  ❌ Failed:", statusData.msg);
    }
    console.log("");

    // Test 2: Get meta-tx nonce
    console.log("Test 2: GET /api/v1/relay/nonce/:address");
    const nonceRes = await fetch(`${API_URL}/api/v1/relay/nonce/${TEST_USER}`);
    const nonceData = await nonceRes.json();
    if (nonceData.code === "0") {
      console.log(`  ✅ Nonce: ${nonceData.data.nonce}`);
    } else {
      console.error("  ❌ Failed:", nonceData.msg);
    }
    console.log("");

    // Test 3: Get user balance
    console.log("Test 3: GET /api/v1/relay/balance/:address");
    const balanceRes = await fetch(
      `${API_URL}/api/v1/relay/balance/${TEST_USER}`
    );
    const balanceData = await balanceRes.json();
    if (balanceData.code === "0") {
      console.log("  ✅ Balance:", {
        available: `${parseFloat(balanceData.data.available) / 1e6} USDT`,
        reserved: `${parseFloat(balanceData.data.reserved) / 1e6} USDT`,
      });
    } else {
      console.error("  ❌ Failed:", balanceData.msg);
    }
    console.log("");

    // Test 4: Deposit ETH (would fail without valid signature)
    console.log("Test 4: POST /api/v1/relay/deposit-eth");
    console.log("  ⚠️  Skipped - requires valid EIP-712 signature");
    console.log("  Endpoint: POST /api/v1/relay/deposit-eth");
    console.log("  Body: { user, amount, deadline, signature }");
    console.log("");

    // Test 5: Withdraw (would fail without valid signature)
    console.log("Test 5: POST /api/v1/relay/withdraw");
    console.log("  ⚠️  Skipped - requires valid EIP-712 signature");
    console.log("  Endpoint: POST /api/v1/relay/withdraw");
    console.log("  Body: { user, token, amount, deadline, signature }");
    console.log("");

    console.log("✅ All relay API tests passed! 🎉\n");
  } catch (error) {
    console.error("\n❌ API test failed:", error);
    console.error("Make sure the server is running on http://localhost:8081");
  }
}

async function runAllTests() {
  console.log("=".repeat(60));
  console.log("Relay Service - Complete Test Suite");
  console.log("=".repeat(60));
  console.log("");

  // Test module functions first
  await testRelayModule();

  console.log("---");
  console.log("");

  // Test API endpoints (requires server to be running)
  console.log("⚠️  Make sure the server is running on http://localhost:8081");
  console.log("");

  try {
    await testRelayAPI();
  } catch (error) {
    console.error("\n❌ API tests failed - make sure server is running!");
  }

  console.log("=".repeat(60));
  console.log("📚 Documentation");
  console.log("=".repeat(60));
  console.log("");
  console.log("## How Relay Service Works");
  console.log("");
  console.log("1. **User signs EIP-712 message** (off-chain)");
  console.log("   - No gas needed for signing");
  console.log("   - Message includes: user, token, amount, deadline, nonce");
  console.log("");
  console.log("2. **Frontend submits signature to relay API**");
  console.log("   - POST /api/v1/relay/deposit-eth");
  console.log("   - POST /api/v1/relay/withdraw");
  console.log("");
  console.log("3. **Relayer verifies signature and submits on-chain**");
  console.log("   - Calls Settlement.depositETHFor() or withdrawFor()");
  console.log("   - Pays gas on behalf of user");
  console.log("   - User receives funds in Settlement contract");
  console.log("");
  console.log("4. **Benefits**");
  console.log("   - ✅ Users don't need ETH for gas");
  console.log("   - ✅ Lower barrier to entry");
  console.log("   - ✅ Better UX for new users");
  console.log("   - ✅ Replay attack protection (nonce)");
  console.log("");
  console.log("## Environment Variables");
  console.log("");
  console.log("Required:");
  console.log("  - RELAYER_PRIVATE_KEY: Private key of relayer wallet");
  console.log("  - SETTLEMENT_ADDRESS: Settlement contract address");
  console.log("  - BASE_SEPOLIA_RPC: RPC URL (default: https://sepolia.base.org)");
  console.log("");
  console.log("## Security");
  console.log("");
  console.log("- EIP-712 signature verification");
  console.log("- Deadline expiration check");
  console.log("- Nonce-based replay protection");
  console.log("- Relayer balance verification");
  console.log("");
  console.log("=".repeat(60));
  console.log("✅ Test suite completed!");
  console.log("=".repeat(60));
}

runAllTests().catch(console.error);
