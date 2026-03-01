/**
 * Fund Conservation Auditor
 *
 * Every 5 minutes, verifies:
 *   Σ(all wallet available) + Σ(all wallet locked) + insurance fund + platform fees
 *   ≈ Settlement contract ETH balance
 *
 * Tolerance: ±0.001 ETH (gas-related drift).
 * Alerts and optional pause on deviation.
 */
import { formatEther, type Address } from "viem";
import { getRpcPool } from "../utils/rpc-pool.js";
import { type StressWallet } from "../utils/wallet-manager.js";
import { CONTRACTS, SETTLEMENT_ABI, INSURANCE_FUND_ABI, AUDIT_THRESHOLDS } from "../config.js";

// ── Types ──────────────────────────────────────────────────────

export interface AuditSnapshot {
  timestamp: number;
  totalAvailable: bigint;
  totalLocked: bigint;
  insuranceFund: bigint;
  settlementBalance: bigint;
  deviation: bigint;
  deviationEth: string;
  pass: boolean;
}

export interface AuditStats {
  totalAudits: number;
  passedAudits: number;
  failedAudits: number;
  maxDeviation: bigint;
  snapshots: AuditSnapshot[];
}

// ── Fund Auditor ───────────────────────────────────────────────

export class FundAuditor {
  private running = false;
  private wallets: StressWallet[] = [];
  private onPause?: () => void;
  readonly stats: AuditStats = {
    totalAudits: 0, passedAudits: 0, failedAudits: 0,
    maxDeviation: 0n, snapshots: [],
  };

  constructor(wallets: StressWallet[], onPause?: () => void) {
    this.wallets = wallets;
    this.onPause = onPause;
  }

  /** Run a single audit (useful for one-off checks) */
  async runOnce(): Promise<AuditSnapshot> {
    const pool = getRpcPool();

    // 1. Read all wallet balances from Settlement
    let totalAvailable = 0n;
    let totalLocked = 0n;

    const balanceCalls = this.wallets.map(w => () =>
      pool.httpClient.readContract({
        address: CONTRACTS.settlement,
        abi: SETTLEMENT_ABI,
        functionName: "getUserBalance",
        args: [w.address],
      })
    );

    const balanceResults = await pool.batchRead(balanceCalls);
    for (const r of balanceResults) {
      if (r.success && r.result) {
        const [available, locked] = r.result as [bigint, bigint];
        totalAvailable += available;
        totalLocked += locked;
      }
    }

    // 2. Read Insurance Fund balance
    let insuranceFund = 0n;
    try {
      insuranceFund = await pool.call(() =>
        pool.httpClient.getBalance({ address: CONTRACTS.insuranceFund })
      );
    } catch {}

    // 3. Read Settlement contract ETH balance
    const settlementBalance = await pool.call(() =>
      pool.httpClient.getBalance({ address: CONTRACTS.settlement })
    );

    // 4. Calculate deviation
    const accountedFor = totalAvailable + totalLocked + insuranceFund;
    const deviation = accountedFor > settlementBalance
      ? accountedFor - settlementBalance
      : settlementBalance - accountedFor;

    const toleranceWei = BigInt(Math.floor(AUDIT_THRESHOLDS.conservationToleranceEth * 1e18));
    const pass = deviation <= toleranceWei;

    const snapshot: AuditSnapshot = {
      timestamp: Date.now(),
      totalAvailable,
      totalLocked,
      insuranceFund,
      settlementBalance,
      deviation,
      deviationEth: formatEther(deviation),
      pass,
    };

    // Update stats
    this.stats.totalAudits++;
    if (pass) {
      this.stats.passedAudits++;
    } else {
      this.stats.failedAudits++;
    }
    if (deviation > this.stats.maxDeviation) {
      this.stats.maxDeviation = deviation;
    }
    this.stats.snapshots.push(snapshot);

    // Log
    const status = pass ? "✓ PASS" : "✗ FAIL";
    console.log(
      `[FundAudit] ${status} | ` +
      `available=${formatEther(totalAvailable)} locked=${formatEther(totalLocked)} ` +
      `insurance=${formatEther(insuranceFund)} | ` +
      `settlement=${formatEther(settlementBalance)} | ` +
      `deviation=${formatEther(deviation)} ETH`
    );

    // Alert on significant deviation
    const alertWei = BigInt(Math.floor(AUDIT_THRESHOLDS.alertToleranceEth * 1e18));
    const pauseWei = BigInt(Math.floor(AUDIT_THRESHOLDS.pauseToleranceEth * 1e18));

    if (deviation > pauseWei) {
      console.error(`[FundAudit] ⚠️ CRITICAL: Deviation ${formatEther(deviation)} ETH exceeds pause threshold!`);
      this.onPause?.();
    } else if (deviation > alertWei) {
      console.warn(`[FundAudit] ⚠ WARNING: Deviation ${formatEther(deviation)} ETH exceeds alert threshold`);
    }

    return snapshot;
  }

  /** Start periodic auditing */
  async startPeriodic(intervalMs: number): Promise<void> {
    this.running = true;
    console.log(`[FundAudit] Started periodic auditing every ${intervalMs / 1000}s`);

    while (this.running) {
      try {
        await this.runOnce();
      } catch (err: any) {
        console.error(`[FundAudit] Audit error: ${err.message}`);
      }
      await new Promise(r => setTimeout(r, intervalMs));
    }
  }

  stop(): void {
    this.running = false;
  }
}
