/**
 * Verify Derived Wallet Balances
 *
 * Checks that all derived wallets have the expected USDT balance in Settlement contract
 */

import { createPublicClient, http, type Address } from "viem";
import { baseSepolia } from "viem/chains";
import fs from "fs";
import path from "path";

// Configuration
const RPC_URL = process.env.BASE_SEPOLIA_RPC || "https://sepolia.base.org";
const SETTLEMENT_ADDRESS = (process.env.SETTLEMENT_ADDRESS || "0x027131BbC5EF6427826F64D12BACAAb447Ee1B13") as Address;
const EXPECTED_BALANCE = 10_000_000_000n; // 10,000 USDT (6 decimals)
const DERIVED_WALLETS_FILE = "./trading-wallets.json";

// Settlement ABI
const SETTLEMENT_ABI = [
  {
    name: "balances",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "user", type: "address" }],
    outputs: [
      { name: "available", type: "uint256" },
      { name: "reserved", type: "uint256" },
    ],
  },
] as const;

// Create public client
const publicClient = createPublicClient({
  chain: baseSepolia,
  transport: http(RPC_URL),
});

interface DerivedWallet {
  address: Address;
  privateKey: string;
  index: number;
}

interface BalanceResult {
  address: Address;
  index: number;
  available: bigint;
  reserved: bigint;
  total: bigint;
  status: "OK" | "ZERO" | "INSUFFICIENT" | "ERROR";
  error?: string;
}

async function loadDerivedWallets(): Promise<DerivedWallet[]> {
  const filePath = path.resolve(DERIVED_WALLETS_FILE);

  if (!fs.existsSync(filePath)) {
    console.error(`❌ File not found: ${filePath}`);
    return [];
  }

  const data = fs.readFileSync(filePath, "utf-8");
  const wallets = JSON.parse(data);

  return wallets.map((w: any) => ({
    address: w.derivedAddress as Address,
    privateKey: w.privateKey,
    index: w.index,
  }));
}

async function checkWalletBalance(wallet: DerivedWallet): Promise<BalanceResult> {
  try {
    const result = await publicClient.readContract({
      address: SETTLEMENT_ADDRESS,
      abi: SETTLEMENT_ABI,
      functionName: "balances",
      args: [wallet.address],
    });

    const available = result[0];
    const reserved = result[1];
    const total = available + reserved;

    let status: "OK" | "ZERO" | "INSUFFICIENT" = "OK";

    if (total === 0n) {
      status = "ZERO";
    } else if (total < EXPECTED_BALANCE) {
      status = "INSUFFICIENT";
    }

    return {
      address: wallet.address,
      index: wallet.index,
      available,
      reserved,
      total,
      status,
    };
  } catch (error) {
    return {
      address: wallet.address,
      index: wallet.index,
      available: 0n,
      reserved: 0n,
      total: 0n,
      status: "ERROR",
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

async function verifyAllWallets() {
  console.log("=".repeat(70));
  console.log("派生钱包余额验证");
  console.log("=".repeat(70));
  console.log("");

  // Load wallets
  console.log("📂 Loading derived wallets...");
  const wallets = await loadDerivedWallets();

  if (wallets.length === 0) {
    console.error("❌ No wallets found!");
    return;
  }

  console.log(`✅ Loaded ${wallets.length} wallets`);
  console.log("");

  // Configuration
  console.log("⚙️  Configuration:");
  console.log(`   Settlement: ${SETTLEMENT_ADDRESS}`);
  console.log(`   Expected Balance: ${Number(EXPECTED_BALANCE) / 1e6} USDT`);
  console.log(`   RPC: ${RPC_URL}`);
  console.log("");

  // Check balances
  console.log("🔍 Checking balances...");
  console.log("");

  const results: BalanceResult[] = [];

  // Check in batches to avoid rate limiting
  const batchSize = 10;
  for (let i = 0; i < wallets.length; i += batchSize) {
    const batch = wallets.slice(i, i + batchSize);
    const batchResults = await Promise.all(batch.map(checkWalletBalance));
    results.push(...batchResults);

    // Progress indicator
    const progress = Math.min(i + batchSize, wallets.length);
    console.log(`   Progress: ${progress}/${wallets.length} wallets checked...`);

    // Small delay between batches
    if (i + batchSize < wallets.length) {
      await new Promise(resolve => setTimeout(resolve, 100));
    }
  }

  console.log("");
  console.log("=".repeat(70));
  console.log("📊 Results Summary");
  console.log("=".repeat(70));
  console.log("");

  // Categorize results
  const ok = results.filter(r => r.status === "OK");
  const zero = results.filter(r => r.status === "ZERO");
  const insufficient = results.filter(r => r.status === "INSUFFICIENT");
  const errors = results.filter(r => r.status === "ERROR");

  console.log(`✅ OK (≥${Number(EXPECTED_BALANCE) / 1e6} USDT): ${ok.length} wallets`);
  console.log(`⚠️  ZERO BALANCE: ${zero.length} wallets`);
  console.log(`⚠️  INSUFFICIENT (<${Number(EXPECTED_BALANCE) / 1e6} USDT): ${insufficient.length} wallets`);
  console.log(`❌ ERRORS: ${errors.length} wallets`);
  console.log("");

  // Calculate total balance
  const totalBalance = results.reduce((sum, r) => sum + r.total, 0n);
  console.log(`💰 Total Balance: ${Number(totalBalance) / 1e6} USDT`);
  console.log(`📈 Average Balance: ${Number(totalBalance / BigInt(results.length)) / 1e6} USDT`);
  console.log("");

  // Show problems
  if (zero.length > 0) {
    console.log("=".repeat(70));
    console.log("⚠️  Wallets with ZERO balance:");
    console.log("=".repeat(70));
    zero.slice(0, 10).forEach(r => {
      console.log(`   [${r.index}] ${r.address}`);
    });
    if (zero.length > 10) {
      console.log(`   ... and ${zero.length - 10} more`);
    }
    console.log("");
  }

  if (insufficient.length > 0) {
    console.log("=".repeat(70));
    console.log("⚠️  Wallets with INSUFFICIENT balance:");
    console.log("=".repeat(70));
    insufficient.slice(0, 10).forEach(r => {
      console.log(`   [${r.index}] ${r.address}: ${Number(r.total) / 1e6} USDT`);
    });
    if (insufficient.length > 10) {
      console.log(`   ... and ${insufficient.length - 10} more`);
    }
    console.log("");
  }

  if (errors.length > 0) {
    console.log("=".repeat(70));
    console.log("❌ Wallets with ERRORS:");
    console.log("=".repeat(70));
    errors.slice(0, 10).forEach(r => {
      console.log(`   [${r.index}] ${r.address}: ${r.error}`);
    });
    if (errors.length > 10) {
      console.log(`   ... and ${errors.length - 10} more`);
    }
    console.log("");
  }

  // Show sample of OK wallets
  if (ok.length > 0) {
    console.log("=".repeat(70));
    console.log("✅ Sample of wallets with correct balance:");
    console.log("=".repeat(70));
    ok.slice(0, 5).forEach(r => {
      console.log(`   [${r.index}] ${r.address}: ${Number(r.total) / 1e6} USDT (${Number(r.available) / 1e6} available, ${Number(r.reserved) / 1e6} reserved)`);
    });
    if (ok.length > 5) {
      console.log(`   ... and ${ok.length - 5} more`);
    }
    console.log("");
  }

  // Final verdict
  console.log("=".repeat(70));
  console.log("📋 Final Verdict");
  console.log("=".repeat(70));
  console.log("");

  if (ok.length === wallets.length) {
    console.log("🎉 SUCCESS! All wallets have correct balance!");
    console.log("");
    console.log("✅ All derived wallets verified:");
    console.log(`   - ${wallets.length} wallets checked`);
    console.log(`   - ${wallets.length} wallets have ≥${Number(EXPECTED_BALANCE) / 1e6} USDT`);
    console.log(`   - Total: ${Number(totalBalance) / 1e6} USDT`);
  } else {
    console.log("⚠️  VERIFICATION INCOMPLETE!");
    console.log("");
    console.log("Issues found:");
    if (zero.length > 0) {
      console.log(`   - ${zero.length} wallets have ZERO balance`);
    }
    if (insufficient.length > 0) {
      console.log(`   - ${insufficient.length} wallets have INSUFFICIENT balance`);
    }
    if (errors.length > 0) {
      console.log(`   - ${errors.length} wallets had ERRORS`);
    }
    console.log("");
    console.log("Possible causes:");
    console.log("   - Task #6 (充值) may not have completed successfully");
    console.log("   - Network issues during deposit");
    console.log("   - Settlement contract address mismatch");
    console.log("   - RPC endpoint issues");
    console.log("");
    console.log("Recommended actions:");
    console.log("   1. Re-run Task #6 to fund wallets with zero balance");
    console.log("   2. Check Settlement contract address configuration");
    console.log("   3. Verify network connectivity");
  }

  console.log("");
  console.log("=".repeat(70));

  // Save detailed report
  const reportPath = "./derived-wallets-verification-report.json";
  fs.writeFileSync(
    reportPath,
    JSON.stringify(
      {
        timestamp: new Date().toISOString(),
        totalWallets: wallets.length,
        expectedBalance: Number(EXPECTED_BALANCE) / 1e6,
        summary: {
          ok: ok.length,
          zero: zero.length,
          insufficient: insufficient.length,
          errors: errors.length,
        },
        totalBalance: Number(totalBalance) / 1e6,
        averageBalance: Number(totalBalance / BigInt(results.length)) / 1e6,
        results: results.map(r => ({
          index: r.index,
          address: r.address,
          available: Number(r.available) / 1e6,
          reserved: Number(r.reserved) / 1e6,
          total: Number(r.total) / 1e6,
          status: r.status,
          error: r.error,
        })),
      },
      null,
      2
    )
  );

  console.log(`💾 Detailed report saved to: ${reportPath}`);
  console.log("");
}

verifyAllWallets().catch(console.error);
