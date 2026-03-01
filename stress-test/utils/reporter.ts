/**
 * Report Generator — generates JSON + HTML report after test completion
 */
import { writeFileSync, mkdirSync } from "fs";
import { formatEther } from "viem";
import type { SpotStats } from "../engines/spot-engine.js";
import type { PerpStats } from "../engines/perp-engine.js";
import type { AuditStats } from "../monitors/fund-auditor.js";
import type { PnlStats } from "../monitors/pnl-tracker.js";
import type { InsuranceStats } from "../monitors/insurance-monitor.js";
import type { LiquidationStats } from "../monitors/liquidation-verifier.js";
import type { SchedulerStats } from "../scenarios/scenario-scheduler.js";

export interface FullReport {
  meta: {
    startTime: number;
    endTime: number;
    durationHours: number;
    totalWallets: number;
    spotWallets: number;
    perpWallets: number;
  };
  spot: SpotStats;
  perp: PerpStats;
  audit: AuditStats;
  pnl: PnlStats;
  insurance: InsuranceStats;
  liquidation: LiquidationStats;
  scenarios: SchedulerStats;
  rpc: { totalRequests: number; retries: number; failures: number };
}

export function generateReport(report: FullReport): void {
  const reportsDir = new URL("../reports", import.meta.url).pathname;
  mkdirSync(reportsDir, { recursive: true });

  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");

  // Write JSON
  const jsonPath = `${reportsDir}/report-${timestamp}.json`;
  writeFileSync(jsonPath, JSON.stringify(report, (_key, value) =>
    typeof value === "bigint" ? value.toString() : value, 2));

  // Write HTML
  const htmlPath = `${reportsDir}/report-${timestamp}.html`;
  writeFileSync(htmlPath, generateHtml(report));

  // Symlink latest
  const latestJson = `${reportsDir}/latest.json`;
  const latestHtml = `${reportsDir}/latest.html`;
  try { writeFileSync(latestJson, JSON.stringify(report, (_key, value) =>
    typeof value === "bigint" ? value.toString() : value, 2)); } catch {}
  try { writeFileSync(latestHtml, generateHtml(report)); } catch {}

  console.log(`[Reporter] Reports saved:`);
  console.log(`  JSON: ${jsonPath}`);
  console.log(`  HTML: ${htmlPath}`);
}

function generateHtml(r: FullReport): string {
  const duration = ((r.meta.endTime - r.meta.startTime) / 3600000).toFixed(1);
  const totalTrades = r.spot.buys + r.spot.sells + r.spot.creates + r.perp.ordersSubmitted;
  const auditPassRate = r.audit.totalAudits > 0
    ? ((r.audit.passedAudits / r.audit.totalAudits) * 100).toFixed(1)
    : "N/A";

  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>Stress Test Report</title>
<style>
  body { font-family: -apple-system, sans-serif; max-width: 900px; margin: 2em auto; background: #0d1117; color: #c9d1d9; }
  h1 { color: #58a6ff; } h2 { color: #79c0ff; border-bottom: 1px solid #30363d; padding-bottom: 8px; }
  table { width: 100%; border-collapse: collapse; margin: 1em 0; }
  th, td { padding: 8px 12px; text-align: left; border: 1px solid #30363d; }
  th { background: #161b22; color: #58a6ff; }
  .pass { color: #3fb950; } .fail { color: #f85149; }
  .stat-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 1em; margin: 1em 0; }
  .stat-card { background: #161b22; border: 1px solid #30363d; border-radius: 8px; padding: 1em; }
  .stat-value { font-size: 2em; font-weight: bold; color: #58a6ff; }
  .stat-label { color: #8b949e; font-size: 0.9em; }
</style></head><body>
<h1>Meme-Perp-DEX Stress Test Report</h1>
<p>Duration: <b>${duration} hours</b> | Wallets: <b>${r.meta.totalWallets}</b> (${r.meta.spotWallets} spot + ${r.meta.perpWallets} perp)</p>
<p>Period: ${new Date(r.meta.startTime).toLocaleString()} — ${new Date(r.meta.endTime).toLocaleString()}</p>

<div class="stat-grid">
  <div class="stat-card"><div class="stat-value">${totalTrades.toLocaleString()}</div><div class="stat-label">Total Trades</div></div>
  <div class="stat-card"><div class="stat-value ${auditPassRate === "100.0" ? "pass" : "fail"}">${auditPassRate}%</div><div class="stat-label">Fund Audit Pass Rate</div></div>
  <div class="stat-card"><div class="stat-value">${r.liquidation.liquidationsSucceeded}</div><div class="stat-label">Liquidations Executed</div></div>
</div>

<h2>Spot Trading</h2>
<table>
  <tr><th>Metric</th><th>Value</th></tr>
  <tr><td>Rounds</td><td>${r.spot.totalRounds}</td></tr>
  <tr><td>Buys</td><td>${r.spot.buys}</td></tr>
  <tr><td>Sells</td><td>${r.spot.sells}</td></tr>
  <tr><td>Token Creates</td><td>${r.spot.creates}</td></tr>
  <tr><td>Failures</td><td>${r.spot.failures}</td></tr>
</table>

<h2>Perpetual Trading</h2>
<table>
  <tr><th>Metric</th><th>Value</th></tr>
  <tr><td>Rounds</td><td>${r.perp.totalRounds}</td></tr>
  <tr><td>Orders Submitted</td><td>${r.perp.ordersSubmitted}</td></tr>
  <tr><td>Orders Matched</td><td>${r.perp.ordersMatched}</td></tr>
  <tr><td>Deposits Made</td><td>${r.perp.deposits}</td></tr>
  <tr><td>Failures</td><td>${r.perp.failures}</td></tr>
</table>

<h2>Fund Conservation Audit</h2>
<table>
  <tr><th>Metric</th><th>Value</th></tr>
  <tr><td>Total Audits</td><td>${r.audit.totalAudits}</td></tr>
  <tr><td>Passed</td><td class="pass">${r.audit.passedAudits}</td></tr>
  <tr><td>Failed</td><td class="${r.audit.failedAudits > 0 ? "fail" : ""}">${r.audit.failedAudits}</td></tr>
  <tr><td>Max Deviation</td><td>${r.audit.maxDeviation.toString()} wei</td></tr>
</table>

<h2>Liquidation & Profit Withdrawal</h2>
<table>
  <tr><th>Metric</th><th>Value</th></tr>
  <tr><td>Scans</td><td>${r.liquidation.totalScans}</td></tr>
  <tr><td>Liquidations Triggered</td><td>${r.liquidation.liquidationsTriggered}</td></tr>
  <tr><td>Liquidations Succeeded</td><td>${r.liquidation.liquidationsSucceeded}</td></tr>
  <tr><td>Profit Withdrawals</td><td>${r.liquidation.profitWithdrawals}</td></tr>
</table>

<h2>Extreme Market Scenarios</h2>
<table>
  <tr><th>Scenario</th><th>Executions</th></tr>
  ${Object.entries(r.scenarios.scenarioCounts).map(([k, v]) =>
    `<tr><td>${k}</td><td>${v}</td></tr>`
  ).join("\n  ")}
  <tr><th>Total</th><th>${r.scenarios.executedScenarios.length}</th></tr>
</table>

<h2>RPC Usage</h2>
<table>
  <tr><th>Metric</th><th>Value</th></tr>
  <tr><td>Total Requests</td><td>${r.rpc.totalRequests.toLocaleString()}</td></tr>
  <tr><td>Retries</td><td>${r.rpc.retries}</td></tr>
  <tr><td>Failures</td><td>${r.rpc.failures}</td></tr>
</table>

<footer style="color:#8b949e;margin-top:2em;text-align:center;">
Generated by meme-perp-dex stress test system | ${new Date().toISOString()}
</footer></body></html>`;
}
