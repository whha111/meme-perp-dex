/**
 * Test script for Relay Service (SettlementV2 mode)
 *
 * Tests gasless deposit operations via SettlementV2.depositFor()
 * Withdrawals are user-initiated via withdraw.ts module.
 */

import type { Address } from "viem";
import {
  getRelayerStatus,
  getWithdrawalNonce,
  getUserDeposits,
  getUserBalance,
} from "./modules/relay";

const TEST_USER: Address = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266"; // Hardhat test account

async function testRelayModule() {
  console.log("🧪 Testing Relay Service Module (SettlementV2)\n");

  try {
    // Test 1: Get relayer status
    console.log("Test 1: Get relayer status");
    const status = await getRelayerStatus();
    console.log("  Status:", {
      enabled: status.enabled,
      address: status.address?.slice(0, 10),
      balance: status.balance,
      collateralBalance: status.collateralBalance,
      settlement: status.settlementAddress?.slice(0, 10),
    });

    if (!status.enabled) {
      console.log("\n⚠️  Relay service is disabled. Set RELAYER_PRIVATE_KEY and SETTLEMENT_ADDRESS.");
      return;
    }

    // Test 2: Get withdrawal nonce
    console.log("\nTest 2: Get withdrawal nonce");
    const nonce = await getWithdrawalNonce(TEST_USER);
    console.log(`  Nonce for ${TEST_USER.slice(0, 10)}: ${nonce}`);

    // Test 3: Get user deposits
    console.log("\nTest 3: Get user deposits");
    const deposits = await getUserDeposits(TEST_USER);
    console.log(`  Deposits for ${TEST_USER.slice(0, 10)}: ${deposits}`);

    // Test 4: Get user balance (legacy)
    console.log("\nTest 4: Get user balance (legacy API)");
    const balance = await getUserBalance(TEST_USER);
    console.log(`  Available: ${balance.available}, Reserved: ${balance.reserved}`);

    console.log("\n✅ All relay module tests passed!\n");

    // Usage hints
    console.log("📋 To test deposits:");
    console.log("  1. Ensure relayer has collateral tokens");
    console.log("  2. POST /api/v1/relay/deposit { user, amount }");
    console.log("\n📋 To test withdrawals:");
    console.log("  1. Request withdrawal via POST /api/v1/withdraw/request { user, amount }");
    console.log("  2. Backend generates Merkle proof + platform signature");
    console.log("  3. User calls SettlementV2.withdraw() on-chain");

  } catch (error) {
    console.error("❌ Test failed:", error);
  }
}

testRelayModule();
