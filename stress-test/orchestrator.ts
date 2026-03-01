/**
 * Stress Test Orchestrator — Main entry point
 *
 * Manages all engines, monitors, and scenario schedulers.
 *
 * Usage:
 *   bun run orchestrator.ts --duration 48h --wallets 300 --spot 200 --perp 100
 *   bun run orchestrator.ts --duration 10m --wallets 20 --spot 15 --perp 5
 */
import { formatEther } from "viem";
import { loadWallets, getSpotWallets, getPerpWallets, type StressWallet } from "./utils/wallet-manager.js";
import { getRpcPool } from "./utils/rpc-pool.js";
import { SpotEngine } from "./engines/spot-engine.js";
import { PerpEngine } from "./engines/perp-engine.js";
import { FundAuditor } from "./monitors/fund-auditor.js";
import { PnlTracker } from "./monitors/pnl-tracker.js";
import { InsuranceMonitor } from "./monitors/insurance-monitor.js";
import { LiquidationVerifier } from "./monitors/liquidation-verifier.js";
import { ScenarioScheduler } from "./scenarios/scenario-scheduler.js";
import { generateReport, type FullReport } from "./utils/reporter.js";
import { MONITOR_INTERVALS } from "./config.js";

// ── CLI Args ───────────────────────────────────────────────────

function parseArgs(): { durationMs: number; spotCount: number; perpCount: number; deployerKey: string } {
  const args = process.argv.slice(2);
  let durationMs = 48 * 3600 * 1000; // Default 48h
  let spotCount = 200;
  let perpCount = 100;
  let deployerKey = process.env.DEPLOYER_KEY || "";

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--duration" && args[i + 1]) {
      const val = args[i + 1];
      if (val.endsWith("h")) durationMs = parseFloat(val) * 3600 * 1000;
      else if (val.endsWith("m")) durationMs = parseFloat(val) * 60 * 1000;
      else durationMs = parseFloat(val) * 1000;
      i++;
    } else if (args[i] === "--spot" && args[i + 1]) {
      spotCount = parseInt(args[i + 1]); i++;
    } else if (args[i] === "--perp" && args[i + 1]) {
      perpCount = parseInt(args[i + 1]); i++;
    } else if (args[i] === "--deployer-key" && args[i + 1]) {
      deployerKey = args[i + 1]; i++;
    }
  }

  return { durationMs, spotCount, perpCount, deployerKey };
}

// ── Main ───────────────────────────────────────────────────────

async function main() {
  const { durationMs, spotCount, perpCount, deployerKey } = parseArgs();
  const durationHours = durationMs / 3600000;
  const startTime = Date.now();

  console.log("╔══════════════════════════════════════════════════╗");
  console.log("║   Meme-Perp-DEX 24-48h Stress Test System       ║");
  console.log("╚══════════════════════════════════════════════════╝");
  console.log(`Duration: ${durationHours}h | Spot: ${spotCount} | Perp: ${perpCount}`);
  console.log(`Start: ${new Date().toLocaleString()}`);
  console.log(`End:   ${new Date(startTime + durationMs).toLocaleString()}\n`);

  // ── 1. Load Wallets ────────────────────────────────────────
  const allWallets = loadWallets(spotCount, perpCount);
  const spotWallets = getSpotWallets(allWallets);
  const perpWallets = getPerpWallets(allWallets);

  // ── 2. Check Balances ──────────────────────────────────────
  console.log("\n[Init] Checking wallet balances...");
  const pool = getRpcPool();
  let totalEth = 0n;
  let fundedCount = 0;

  // Sample first 10 of each group
  for (const w of [...spotWallets.slice(0, 5), ...perpWallets.slice(0, 5)]) {
    try {
      const balance = await pool.call(() =>
        pool.httpClient.getBalance({ address: w.address })
      );
      if (balance > 0n) {
        totalEth += balance;
        fundedCount++;
      }
    } catch {}
  }

  console.log(`[Init] Sampled 10 wallets: ${fundedCount} funded, ~${formatEther(totalEth)} ETH total`);

  // ── 3. Initialize Components ───────────────────────────────
  const spotEngine = new SpotEngine(spotWallets);
  const perpEngine = new PerpEngine(perpWallets);

  // Pass a pause callback that stops trading engines
  const pauseAll = () => {
    console.error("\n⚠️ EMERGENCY PAUSE: Stopping all trading engines!\n");
    spotEngine.stop();
    perpEngine.stop();
  };

  const fundAuditor = new FundAuditor(allWallets, pauseAll);
  const pnlTracker = new PnlTracker(perpWallets);
  const insuranceMonitor = new InsuranceMonitor();
  const liquidationVerifier = new LiquidationVerifier(
    perpWallets,
    spotWallets[0], // Use first spot wallet as liquidation executor
  );

  let scenarioScheduler: ScenarioScheduler | null = null;
  if (deployerKey) {
    scenarioScheduler = new ScenarioScheduler(
      deployerKey as `0x${string}`,
      fundAuditor,
    );
  } else {
    console.warn("[Init] No DEPLOYER_KEY — scenario injection disabled");
  }

  // ── 4. Start All Components ────────────────────────────────
  console.log("\n[Init] Starting all components...\n");

  // Fire and forget — all run concurrently
  const tasks = [
    spotEngine.start(),
    perpEngine.start(),
    // Warmup delay: wait 120s for batch deposits to settle before first audit
    (async () => {
      console.log("[FundAudit] Waiting 120s warmup for deposits to settle...");
      await new Promise(r => setTimeout(r, 120_000));
      return fundAuditor.startPeriodic(MONITOR_INTERVALS.fundAuditMs);
    })(),
    pnlTracker.startPeriodic(MONITOR_INTERVALS.pnlTrackMs),
    insuranceMonitor.startPeriodic(MONITOR_INTERVALS.insuranceTrackMs),
    liquidationVerifier.startScanning(
      MONITOR_INTERVALS.liquidationScanMs,
      MONITOR_INTERVALS.profitWithdrawalMs,
    ),
  ];

  if (scenarioScheduler) {
    tasks.push(scenarioScheduler.start());
  }

  // ── 5. Summary Logger ──────────────────────────────────────
  const summaryInterval = setInterval(() => {
    const elapsed = (Date.now() - startTime) / 3600000;
    const remaining = durationHours - elapsed;
    const rpcStats = pool.getStats();

    console.log(`\n╔══ Summary [${elapsed.toFixed(1)}h / ${durationHours}h] ══════════════════╗`);
    console.log(`║ Spot:  rounds=${spotEngine.stats.totalRounds} buys=${spotEngine.stats.buys} sells=${spotEngine.stats.sells} creates=${spotEngine.stats.creates}`);
    console.log(`║ Perp:  rounds=${perpEngine.stats.totalRounds} orders=${perpEngine.stats.ordersSubmitted} matched=${perpEngine.stats.ordersMatched}`);
    console.log(`║ Audit: ${fundAuditor.stats.passedAudits}/${fundAuditor.stats.totalAudits} passed`);
    console.log(`║ Liq:   ${liquidationVerifier.stats.liquidationsSucceeded} liquidations`);
    console.log(`║ RPC:   ${rpcStats.totalRequests} calls, ${rpcStats.retries} retries, ${rpcStats.failures} failures`);
    if (scenarioScheduler) {
      console.log(`║ Scenarios: ${scenarioScheduler.stats.executedScenarios.length} executed`);
    }
    console.log(`║ Remaining: ${remaining.toFixed(1)} hours`);
    console.log(`╚═══════════════════════════════════════════════════╝\n`);
  }, MONITOR_INTERVALS.summaryMs);

  // ── 6. Duration Timer ──────────────────────────────────────
  const timeout = setTimeout(() => {
    console.log("\n\n⏰ Duration reached. Shutting down gracefully...\n");
    shutdown();
  }, durationMs);

  // ── 7. Graceful Shutdown ───────────────────────────────────
  let isShuttingDown = false;

  function shutdown() {
    if (isShuttingDown) return;
    isShuttingDown = true;

    clearInterval(summaryInterval);
    clearTimeout(timeout);

    console.log("[Shutdown] Stopping engines...");
    spotEngine.stop();
    perpEngine.stop();
    fundAuditor.stop();
    pnlTracker.stop();
    insuranceMonitor.stop();
    liquidationVerifier.stop();
    scenarioScheduler?.stop();

    // Final audit
    console.log("[Shutdown] Running final audit...");
    fundAuditor.runOnce().then(() => {
      // Generate report
      const report: FullReport = {
        meta: {
          startTime,
          endTime: Date.now(),
          durationHours: (Date.now() - startTime) / 3600000,
          totalWallets: allWallets.length,
          spotWallets: spotWallets.length,
          perpWallets: perpWallets.length,
        },
        spot: spotEngine.stats,
        perp: perpEngine.stats,
        audit: fundAuditor.stats,
        pnl: pnlTracker.stats,
        insurance: insuranceMonitor.stats,
        liquidation: liquidationVerifier.stats,
        scenarios: scenarioScheduler?.stats ?? {
          executedScenarios: [],
          scenarioCounts: { flash_crash: 0, pump: 0, dump: 0, whipsaw: 0, slow_bleed: 0, near_zero: 0 },
          nextScheduled: 0,
        },
        rpc: pool.getStats(),
      };

      generateReport(report);
      console.log("\n[Shutdown] Complete. Reports generated.");
      process.exit(0);
    });
  }

  process.on("SIGINT", () => {
    console.log("\n\nReceived SIGINT...");
    shutdown();
  });

  process.on("SIGTERM", () => {
    console.log("\n\nReceived SIGTERM...");
    shutdown();
  });

  // Wait for all tasks
  await Promise.allSettled(tasks);
}

main().catch(err => {
  console.error("Fatal error:", err);
  process.exit(1);
});
