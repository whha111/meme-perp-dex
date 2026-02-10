/**
 * 借贷清算模块
 *
 * 功能:
 * 1. 追踪活跃借贷仓位
 * 2. 检测不健康的借贷 (利用率 > 90%)
 * 3. 执行链上借贷清算 (LendingPool.liquidateBorrow)
 *
 * 触发条件:
 * - 池子利用率超过 MAX_UTILIZATION (90%)
 * - 由 riskEngine 每个周期调用检测
 *
 * 与永续清算的区别:
 * - 永续清算: 价格驱动，紧急 (ms级)
 * - 借贷清算: 利用率驱动，相对缓慢 (秒级)
 */

import type { Address, Hex } from "viem";
import { LENDING_POOL_ADDRESS, LENDING } from "../config";
import { logger } from "../utils/logger";

// ============================================================
// LendingPool ABI (minimal — only what we need)
// ============================================================

const LENDING_POOL_ABI = [
  {
    name: "getUserBorrow",
    type: "function",
    stateMutability: "view",
    inputs: [
      { name: "token", type: "address" },
      { name: "user", type: "address" },
    ],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    name: "getUtilization",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "token", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    name: "getAvailableLiquidity",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "token", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    name: "isTokenEnabled",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "token", type: "address" }],
    outputs: [{ name: "", type: "bool" }],
  },
  {
    name: "liquidateBorrow",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "token", type: "address" },
      { name: "borrower", type: "address" },
    ],
    outputs: [{ name: "seized", type: "uint256" }],
  },
] as const;

// ============================================================
// Types
// ============================================================

export interface BorrowTracking {
  token: Address;
  borrower: Address;
  amount: bigint;          // Last known borrow amount (local cache)
  trackedAt: number;       // Timestamp of last track
  lastChecked: number;     // Timestamp of last on-chain check
}

export interface LendingLiquidationCandidate {
  token: Address;
  borrower: Address;
  borrowAmount: bigint;
  utilization: bigint;     // Pool utilization in BPS
  urgency: number;         // 0-100, higher = more urgent
}

// ============================================================
// State
// ============================================================

// token (lowercase) → borrower (lowercase) → tracking info
const activeBorrows = new Map<string, Map<string, BorrowTracking>>();

// Pending liquidation queue
let lendingLiquidationQueue: LendingLiquidationCandidate[] = [];

// Contract clients (set via init)
let publicClient: any = null;
let walletClient: any = null;
let lendingPoolAddress: Address = LENDING_POOL_ADDRESS;
let initialized = false;

// Metrics
let lendingLiquidationsExecuted = 0;
let lendingLiquidationsFailed = 0;
let lastCheckTime = 0;

// ============================================================
// Initialization
// ============================================================

/**
 * Initialize lending liquidation module
 * Must be called during server startup with blockchain clients
 */
export function initLendingLiquidation(
  _publicClient: any,
  _walletClient: any,
  _lendingPoolAddress?: Address
): void {
  publicClient = _publicClient;
  walletClient = _walletClient;
  if (_lendingPoolAddress) {
    lendingPoolAddress = _lendingPoolAddress;
  }
  initialized = true;

  logger.info("LendingLiq", `Module initialized, LendingPool: ${lendingPoolAddress}`);
}

// ============================================================
// Borrow Tracking
// ============================================================

/**
 * Track a new borrow or increase existing borrow
 * Called by matching engine when a short position borrows tokens
 */
export function trackBorrow(token: Address, borrower: Address, amount: bigint): void {
  const normalizedToken = token.toLowerCase();
  const normalizedBorrower = borrower.toLowerCase();

  let tokenBorrows = activeBorrows.get(normalizedToken);
  if (!tokenBorrows) {
    tokenBorrows = new Map();
    activeBorrows.set(normalizedToken, tokenBorrows);
  }

  const existing = tokenBorrows.get(normalizedBorrower);
  const newAmount = existing ? existing.amount + amount : amount;
  const now = Date.now();

  tokenBorrows.set(normalizedBorrower, {
    token: token.toLowerCase() as Address,
    borrower: borrower.toLowerCase() as Address,
    amount: newAmount,
    trackedAt: now,
    lastChecked: existing?.lastChecked || 0,
  });

  logger.debug("LendingLiq", `Tracked borrow: ${borrower.slice(0, 10)} borrows ${amount} of ${token.slice(0, 10)} (total: ${newAmount})`);
}

/**
 * Track a repayment (reduce or clear borrow)
 * Called by matching engine when a short position repays
 */
export function trackRepay(token: Address, borrower: Address, amount: bigint): void {
  const normalizedToken = token.toLowerCase();
  const normalizedBorrower = borrower.toLowerCase();

  const tokenBorrows = activeBorrows.get(normalizedToken);
  if (!tokenBorrows) return;

  const existing = tokenBorrows.get(normalizedBorrower);
  if (!existing) return;

  const newAmount = existing.amount > amount ? existing.amount - amount : 0n;

  if (newAmount === 0n) {
    tokenBorrows.delete(normalizedBorrower);
    logger.debug("LendingLiq", `Borrow fully repaid: ${borrower.slice(0, 10)} for ${token.slice(0, 10)}`);
  } else {
    tokenBorrows.set(normalizedBorrower, {
      ...existing,
      amount: newAmount,
      trackedAt: Date.now(),
    });
    logger.debug("LendingLiq", `Partial repay: ${borrower.slice(0, 10)} remaining=${newAmount} for ${token.slice(0, 10)}`);
  }
}

/**
 * Remove all borrows for a borrower (e.g., after liquidation)
 */
export function clearBorrowerTracking(token: Address, borrower: Address): void {
  const normalizedToken = token.toLowerCase();
  const normalizedBorrower = borrower.toLowerCase();

  const tokenBorrows = activeBorrows.get(normalizedToken);
  if (tokenBorrows) {
    tokenBorrows.delete(normalizedBorrower);
  }
}

// ============================================================
// Health Checks
// ============================================================

/**
 * Check borrow health for a single borrower (on-chain query)
 */
async function checkBorrowHealth(token: Address, borrower: Address): Promise<{
  healthy: boolean;
  borrowAmount: bigint;
  utilization: bigint;
}> {
  if (!publicClient) {
    return { healthy: true, borrowAmount: 0n, utilization: 0n };
  }

  try {
    const [borrowAmount, utilization] = await Promise.all([
      publicClient.readContract({
        address: lendingPoolAddress,
        abi: LENDING_POOL_ABI,
        functionName: "getUserBorrow",
        args: [token, borrower],
      }) as Promise<bigint>,
      publicClient.readContract({
        address: lendingPoolAddress,
        abi: LENDING_POOL_ABI,
        functionName: "getUtilization",
        args: [token],
      }) as Promise<bigint>,
    ]);

    // Borrow is unhealthy if pool utilization exceeds critical threshold
    const healthy = utilization < LENDING.UTILIZATION_CRITICAL;

    return { healthy, borrowAmount, utilization };
  } catch (error) {
    logger.error("LendingLiq", `Health check failed for ${borrower.slice(0, 10)}:`, error);
    return { healthy: true, borrowAmount: 0n, utilization: 0n }; // Assume healthy on error
  }
}

/**
 * Detect liquidatable lending positions for a specific token
 * Called by the risk engine on each cycle
 */
export async function detectLendingLiquidations(token: Address): Promise<LendingLiquidationCandidate[]> {
  if (!initialized || !publicClient) return [];

  const normalizedToken = token.toLowerCase();
  const tokenBorrows = activeBorrows.get(normalizedToken);
  if (!tokenBorrows || tokenBorrows.size === 0) return [];

  const candidates: LendingLiquidationCandidate[] = [];

  // First check pool utilization (cheap — single RPC call)
  let poolUtilization: bigint;
  try {
    poolUtilization = await publicClient.readContract({
      address: lendingPoolAddress,
      abi: LENDING_POOL_ABI,
      functionName: "getUtilization",
      args: [token],
    }) as bigint;
  } catch {
    return []; // Can't check utilization, skip
  }

  // If utilization is below warning level, no need to check individual borrowers
  if (poolUtilization < LENDING.UTILIZATION_WARNING) {
    return [];
  }

  // Pool is stressed — check each borrower
  const now = Date.now();
  for (const [borrowerAddr, tracking] of tokenBorrows) {
    // Don't check too frequently (min 3 seconds between checks per borrower)
    if (now - tracking.lastChecked < 3000) continue;

    try {
      const borrowAmount = await publicClient.readContract({
        address: lendingPoolAddress,
        abi: LENDING_POOL_ABI,
        functionName: "getUserBorrow",
        args: [token, borrowerAddr as Address],
      }) as bigint;

      // Update tracking
      tracking.lastChecked = now;
      tracking.amount = borrowAmount;

      if (borrowAmount === 0n) {
        // Borrow already repaid on-chain, clean up tracking
        tokenBorrows.delete(borrowerAddr);
        continue;
      }

      // If pool utilization > 90%, all borrowers are candidates for liquidation
      if (poolUtilization >= LENDING.UTILIZATION_CRITICAL) {
        const urgency = Math.min(100, Number((poolUtilization - LENDING.UTILIZATION_CRITICAL) / 100n));
        candidates.push({
          token: token.toLowerCase() as Address,
          borrower: borrowerAddr as Address,
          borrowAmount,
          utilization: poolUtilization,
          urgency,
        });
      }
    } catch (error) {
      logger.error("LendingLiq", `Failed to check borrower ${borrowerAddr.slice(0, 10)}:`, error);
    }
  }

  // Sort by urgency (highest first) then by borrow amount (largest first)
  candidates.sort((a, b) => {
    if (b.urgency !== a.urgency) return b.urgency - a.urgency;
    return Number(b.borrowAmount - a.borrowAmount);
  });

  return candidates;
}

/**
 * Detect lending liquidations for ALL tracked tokens
 */
export async function detectAllLendingLiquidations(): Promise<LendingLiquidationCandidate[]> {
  const allCandidates: LendingLiquidationCandidate[] = [];

  for (const tokenAddr of activeBorrows.keys()) {
    const candidates = await detectLendingLiquidations(tokenAddr as Address);
    allCandidates.push(...candidates);
  }

  return allCandidates;
}

// ============================================================
// Liquidation Execution
// ============================================================

/**
 * Execute a single lending liquidation on-chain
 */
export async function executeLendingLiquidation(
  token: Address,
  borrower: Address
): Promise<{ success: boolean; seized: bigint; txHash?: string }> {
  if (!walletClient) {
    logger.error("LendingLiq", "No wallet client — cannot execute on-chain liquidation");
    return { success: false, seized: 0n };
  }

  logger.warn("LendingLiq", `Executing lending liquidation: borrower=${borrower.slice(0, 10)} token=${token.slice(0, 10)}`);

  try {
    const txHash = await walletClient.writeContract({
      address: lendingPoolAddress,
      abi: LENDING_POOL_ABI,
      functionName: "liquidateBorrow",
      args: [token, borrower],
    });

    logger.info("LendingLiq", `Liquidation tx sent: ${txHash}`);

    // Wait for confirmation
    if (publicClient) {
      try {
        const receipt = await publicClient.waitForTransactionReceipt({
          hash: txHash,
          timeout: 30000,
        });

        if (receipt.status === "success") {
          lendingLiquidationsExecuted++;
          clearBorrowerTracking(token, borrower);
          logger.info("LendingLiq", `Liquidation confirmed: ${txHash} (block ${receipt.blockNumber})`);
          return { success: true, seized: 0n, txHash }; // seized amount from event logs
        } else {
          lendingLiquidationsFailed++;
          logger.error("LendingLiq", `Liquidation tx reverted: ${txHash}`);
          return { success: false, seized: 0n, txHash };
        }
      } catch (waitError) {
        // Tx submitted but receipt wait timed out — assume success
        logger.warn("LendingLiq", `Liquidation tx wait timed out: ${txHash}`);
        clearBorrowerTracking(token, borrower);
        return { success: true, seized: 0n, txHash };
      }
    }

    lendingLiquidationsExecuted++;
    clearBorrowerTracking(token, borrower);
    return { success: true, seized: 0n, txHash };
  } catch (error: any) {
    lendingLiquidationsFailed++;
    const errorMsg = error?.shortMessage || error?.message || String(error);
    logger.error("LendingLiq", `Liquidation failed: ${errorMsg.slice(0, 100)}`);
    return { success: false, seized: 0n };
  }
}

/**
 * Update the lending liquidation queue
 */
export function updateLendingLiquidationQueue(candidates: LendingLiquidationCandidate[]): void {
  lendingLiquidationQueue = candidates;
}

/**
 * Process pending lending liquidations
 * Called by the risk engine after detection
 */
export async function processLendingLiquidations(): Promise<number> {
  if (lendingLiquidationQueue.length === 0) return 0;

  let processed = 0;
  const toProcess = lendingLiquidationQueue.splice(0, LENDING.MAX_LIQUIDATIONS_PER_CYCLE);

  for (const candidate of toProcess) {
    const result = await executeLendingLiquidation(candidate.token, candidate.borrower);
    if (result.success) {
      processed++;
    }
  }

  if (processed > 0) {
    logger.info("LendingLiq", `Processed ${processed}/${toProcess.length} lending liquidations`);
  }

  return processed;
}

// ============================================================
// View Functions
// ============================================================

/**
 * Get all tracked borrows for a token
 */
export function getActiveBorrows(token: Address): BorrowTracking[] {
  const normalizedToken = token.toLowerCase();
  const tokenBorrows = activeBorrows.get(normalizedToken);
  if (!tokenBorrows) return [];
  return Array.from(tokenBorrows.values());
}

/**
 * Get all tracked borrows across all tokens
 */
export function getAllActiveBorrows(): Map<string, BorrowTracking[]> {
  const result = new Map<string, BorrowTracking[]>();
  for (const [token, borrows] of activeBorrows) {
    result.set(token, Array.from(borrows.values()));
  }
  return result;
}

/**
 * Get lending liquidation queue
 */
export function getLendingLiquidationQueue(): LendingLiquidationCandidate[] {
  return [...lendingLiquidationQueue];
}

/**
 * Get module metrics
 */
export function getLendingLiquidationMetrics(): {
  initialized: boolean;
  trackedTokens: number;
  totalBorrowers: number;
  queueSize: number;
  liquidationsExecuted: number;
  liquidationsFailed: number;
  lastCheckTime: number;
} {
  let totalBorrowers = 0;
  for (const borrows of activeBorrows.values()) {
    totalBorrowers += borrows.size;
  }

  return {
    initialized,
    trackedTokens: activeBorrows.size,
    totalBorrowers,
    queueSize: lendingLiquidationQueue.length,
    liquidationsExecuted: lendingLiquidationsExecuted,
    liquidationsFailed: lendingLiquidationsFailed,
    lastCheckTime,
  };
}

// ============================================================
// Export
// ============================================================

export default {
  initLendingLiquidation,
  trackBorrow,
  trackRepay,
  clearBorrowerTracking,
  detectLendingLiquidations,
  detectAllLendingLiquidations,
  executeLendingLiquidation,
  updateLendingLiquidationQueue,
  processLendingLiquidations,
  getActiveBorrows,
  getAllActiveBorrows,
  getLendingLiquidationQueue,
  getLendingLiquidationMetrics,
};
