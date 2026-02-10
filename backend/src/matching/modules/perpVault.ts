/**
 * PerpVault 模块 — GMX-style LP Pool 交互
 *
 * 功能:
 * 1. 查询链上 PerpVault 池子状态 (poolValue, sharePrice, OI)
 * 2. 在开/平仓时执行链上 OI 更新
 * 3. 在平仓/清算时执行链上结算 (settleTraderProfit/Loss, settleLiquidation)
 * 4. 收取交易手续费 (collectFee)
 *
 * 使用方式:
 * - server.ts 启动时调用 initPerpVault()
 * - position.ts 开仓时调用 increaseOI()
 * - position.ts 平仓时调用 decreaseOI() + settleTraderPnL()
 * - liquidation.ts 清算时调用 settleLiquidation()
 * - funding.ts 资金费结算时调用 collectTradingFee()
 */

import type { Address, Hex } from "viem";
import { logger } from "../utils/logger";

// ============================================================
// PerpVault ABI (minimal — only what we need)
// ============================================================

const PERP_VAULT_ABI = [
  {
    name: "getPoolValue",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    name: "getSharePrice",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    name: "getMaxOI",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    name: "getTotalOI",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    name: "getTokenOI",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "token", type: "address" }],
    outputs: [
      { name: "long_", type: "uint256" },
      { name: "short_", type: "uint256" },
    ],
  },
  {
    name: "getPoolStats",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [
      { name: "poolValue", type: "uint256" },
      { name: "sharePrice", type: "uint256" },
      { name: "_totalShares", type: "uint256" },
      { name: "totalOI", type: "uint256" },
      { name: "maxOI", type: "uint256" },
      { name: "utilization", type: "uint256" },
      { name: "_totalFeesCollected", type: "uint256" },
      { name: "_totalProfitsPaid", type: "uint256" },
      { name: "_totalLossesReceived", type: "uint256" },
      { name: "_totalLiquidationReceived", type: "uint256" },
    ],
  },
  {
    name: "getLPValue",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "lp", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    name: "shares",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    name: "getWithdrawalInfo",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "lp", type: "address" }],
    outputs: [
      { name: "pendingShares", type: "uint256" },
      { name: "requestTime", type: "uint256" },
      { name: "executeAfter", type: "uint256" },
      { name: "estimatedETH", type: "uint256" },
    ],
  },
  {
    name: "getUtilization",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
  // ── Write functions ──
  {
    name: "settleTraderProfit",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "trader", type: "address" },
      { name: "profitETH", type: "uint256" },
    ],
    outputs: [],
  },
  {
    name: "settleTraderLoss",
    type: "function",
    stateMutability: "payable",
    inputs: [{ name: "lossETH", type: "uint256" }],
    outputs: [],
  },
  {
    name: "settleLiquidation",
    type: "function",
    stateMutability: "payable",
    inputs: [
      { name: "collateralETH", type: "uint256" },
      { name: "liquidatorReward", type: "uint256" },
      { name: "liquidator", type: "address" },
    ],
    outputs: [],
  },
  {
    name: "increaseOI",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "token", type: "address" },
      { name: "isLong", type: "bool" },
      { name: "sizeETH", type: "uint256" },
    ],
    outputs: [],
  },
  {
    name: "decreaseOI",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "token", type: "address" },
      { name: "isLong", type: "bool" },
      { name: "sizeETH", type: "uint256" },
    ],
    outputs: [],
  },
  {
    name: "collectFee",
    type: "function",
    stateMutability: "payable",
    inputs: [{ name: "feeETH", type: "uint256" }],
    outputs: [],
  },
] as const;

// ============================================================
// Types
// ============================================================

export interface PerpVaultPoolStats {
  poolValue: bigint;
  sharePrice: bigint;
  totalShares: bigint;
  totalOI: bigint;
  maxOI: bigint;
  utilization: bigint;
  totalFeesCollected: bigint;
  totalProfitsPaid: bigint;
  totalLossesReceived: bigint;
  totalLiquidationReceived: bigint;
}

export interface PerpVaultLPInfo {
  shares: bigint;
  value: bigint;
  pendingWithdrawalShares: bigint;
  withdrawalRequestTime: bigint;
  withdrawalExecuteAfter: bigint;
  withdrawalEstimatedETH: bigint;
}

// ============================================================
// State
// ============================================================

let publicClient: any = null;
let walletClient: any = null;
let perpVaultAddress: Address | null = null;
let initialized = false;

// Metrics
let settlementsExecuted = 0;
let settlementsFailed = 0;
let oiUpdatesExecuted = 0;
let oiUpdatesFailed = 0;
let feesCollectedCount = 0;

// Cache (refreshed every 5s)
let cachedPoolStats: PerpVaultPoolStats | null = null;
let lastPoolStatsFetch = 0;
const POOL_STATS_CACHE_MS = 5000;

// ============================================================
// Initialization
// ============================================================

/**
 * Initialize PerpVault module
 * Must be called during server startup with blockchain clients
 */
export function initPerpVault(
  _publicClient: any,
  _walletClient: any,
  _perpVaultAddress: Address
): void {
  publicClient = _publicClient;
  walletClient = _walletClient;
  perpVaultAddress = _perpVaultAddress;
  initialized = true;

  logger.info("PerpVault", `Module initialized, PerpVault: ${perpVaultAddress}`);
}

/**
 * Check if PerpVault module is initialized and has a valid address
 */
export function isPerpVaultEnabled(): boolean {
  return initialized && perpVaultAddress !== null && perpVaultAddress !== ("" as Address);
}

// ============================================================
// Read Functions (on-chain queries)
// ============================================================

/**
 * Get pool value (ETH balance of PerpVault contract)
 */
export async function getPoolValue(): Promise<bigint> {
  if (!isPerpVaultEnabled()) return 0n;

  try {
    return (await publicClient.readContract({
      address: perpVaultAddress!,
      abi: PERP_VAULT_ABI,
      functionName: "getPoolValue",
    })) as bigint;
  } catch (error) {
    logger.error("PerpVault", "Failed to get pool value:", error);
    return 0n;
  }
}

/**
 * Get share price (1e18 precision)
 */
export async function getSharePrice(): Promise<bigint> {
  if (!isPerpVaultEnabled()) return 10n ** 18n; // Default 1:1

  try {
    return (await publicClient.readContract({
      address: perpVaultAddress!,
      abi: PERP_VAULT_ABI,
      functionName: "getSharePrice",
    })) as bigint;
  } catch (error) {
    logger.error("PerpVault", "Failed to get share price:", error);
    return 10n ** 18n;
  }
}

/**
 * Get full pool stats (cached for 5s to reduce RPC calls)
 */
export async function getPoolStats(): Promise<PerpVaultPoolStats | null> {
  if (!isPerpVaultEnabled()) return null;

  const now = Date.now();
  if (cachedPoolStats && now - lastPoolStatsFetch < POOL_STATS_CACHE_MS) {
    return cachedPoolStats;
  }

  try {
    const result = (await publicClient.readContract({
      address: perpVaultAddress!,
      abi: PERP_VAULT_ABI,
      functionName: "getPoolStats",
    })) as readonly [bigint, bigint, bigint, bigint, bigint, bigint, bigint, bigint, bigint, bigint];

    cachedPoolStats = {
      poolValue: result[0],
      sharePrice: result[1],
      totalShares: result[2],
      totalOI: result[3],
      maxOI: result[4],
      utilization: result[5],
      totalFeesCollected: result[6],
      totalProfitsPaid: result[7],
      totalLossesReceived: result[8],
      totalLiquidationReceived: result[9],
    };
    lastPoolStatsFetch = now;

    return cachedPoolStats;
  } catch (error) {
    logger.error("PerpVault", "Failed to get pool stats:", error);
    return null;
  }
}

/**
 * Get OI for a specific token
 */
export async function getTokenOI(token: Address): Promise<{ longOI: bigint; shortOI: bigint }> {
  if (!isPerpVaultEnabled()) return { longOI: 0n, shortOI: 0n };

  try {
    const result = (await publicClient.readContract({
      address: perpVaultAddress!,
      abi: PERP_VAULT_ABI,
      functionName: "getTokenOI",
      args: [token],
    })) as readonly [bigint, bigint];

    return { longOI: result[0], shortOI: result[1] };
  } catch (error) {
    logger.error("PerpVault", `Failed to get token OI for ${token.slice(0, 10)}:`, error);
    return { longOI: 0n, shortOI: 0n };
  }
}

/**
 * Check if a new position would exceed OI limits
 */
export async function canIncreaseOI(
  token: Address,
  isLong: boolean,
  sizeETH: bigint
): Promise<boolean> {
  if (!isPerpVaultEnabled()) return true; // No PerpVault → no OI limit

  try {
    const [totalOI, maxOI] = await Promise.all([
      publicClient.readContract({
        address: perpVaultAddress!,
        abi: PERP_VAULT_ABI,
        functionName: "getTotalOI",
      }) as Promise<bigint>,
      publicClient.readContract({
        address: perpVaultAddress!,
        abi: PERP_VAULT_ABI,
        functionName: "getMaxOI",
      }) as Promise<bigint>,
    ]);

    if (maxOI === 0n) return true; // Empty pool
    return totalOI + sizeETH <= maxOI;
  } catch (error) {
    logger.error("PerpVault", "Failed to check OI limits:", error);
    return true; // Allow on error
  }
}

/**
 * Get LP info for a specific address
 */
export async function getLPInfo(lp: Address): Promise<PerpVaultLPInfo | null> {
  if (!isPerpVaultEnabled()) return null;

  try {
    const [sharesResult, valueResult, withdrawalResult] = await Promise.all([
      publicClient.readContract({
        address: perpVaultAddress!,
        abi: PERP_VAULT_ABI,
        functionName: "shares",
        args: [lp],
      }) as Promise<bigint>,
      publicClient.readContract({
        address: perpVaultAddress!,
        abi: PERP_VAULT_ABI,
        functionName: "getLPValue",
        args: [lp],
      }) as Promise<bigint>,
      publicClient.readContract({
        address: perpVaultAddress!,
        abi: PERP_VAULT_ABI,
        functionName: "getWithdrawalInfo",
        args: [lp],
      }) as Promise<readonly [bigint, bigint, bigint, bigint]>,
    ]);

    return {
      shares: sharesResult,
      value: valueResult,
      pendingWithdrawalShares: withdrawalResult[0],
      withdrawalRequestTime: withdrawalResult[1],
      withdrawalExecuteAfter: withdrawalResult[2],
      withdrawalEstimatedETH: withdrawalResult[3],
    };
  } catch (error) {
    logger.error("PerpVault", `Failed to get LP info for ${lp.slice(0, 10)}:`, error);
    return null;
  }
}

// ============================================================
// Write Functions (on-chain transactions)
// ============================================================

/**
 * Settle trader PnL — either profit (pool pays) or loss (pool receives)
 */
export async function settleTraderPnL(
  trader: Address,
  amount: bigint,
  isProfit: boolean
): Promise<{ success: boolean; txHash?: string }> {
  if (!isPerpVaultEnabled() || !walletClient) {
    logger.warn("PerpVault", "Not enabled or no wallet client — skipping PnL settlement");
    return { success: false };
  }

  if (amount === 0n) return { success: true };

  try {
    let txHash: string;

    if (isProfit) {
      // Pool pays trader profit (no ETH sent with call)
      txHash = await walletClient.writeContract({
        address: perpVaultAddress!,
        abi: PERP_VAULT_ABI,
        functionName: "settleTraderProfit",
        args: [trader, amount],
      });
    } else {
      // Pool receives trader loss (ETH sent with call)
      txHash = await walletClient.writeContract({
        address: perpVaultAddress!,
        abi: PERP_VAULT_ABI,
        functionName: "settleTraderLoss",
        args: [amount],
        value: amount,
      });
    }

    settlementsExecuted++;
    cachedPoolStats = null; // Invalidate cache

    logger.info("PerpVault", `PnL settled: trader=${trader.slice(0, 10)} ${isProfit ? "profit" : "loss"}=${amount} tx=${txHash}`);
    return { success: true, txHash };
  } catch (error: any) {
    settlementsFailed++;
    const errorMsg = error?.shortMessage || error?.message || String(error);
    logger.error("PerpVault", `PnL settlement failed: ${errorMsg.slice(0, 100)}`);
    return { success: false };
  }
}

/**
 * Settle liquidation — collateral goes to pool, reward to liquidator
 */
export async function settleLiquidation(
  collateralETH: bigint,
  liquidatorReward: bigint,
  liquidator: Address
): Promise<{ success: boolean; txHash?: string }> {
  if (!isPerpVaultEnabled() || !walletClient) {
    return { success: false };
  }

  try {
    const txHash = await walletClient.writeContract({
      address: perpVaultAddress!,
      abi: PERP_VAULT_ABI,
      functionName: "settleLiquidation",
      args: [collateralETH, liquidatorReward, liquidator],
      value: collateralETH,
    });

    settlementsExecuted++;
    cachedPoolStats = null;

    logger.info("PerpVault", `Liquidation settled: collateral=${collateralETH} reward=${liquidatorReward} liquidator=${liquidator.slice(0, 10)} tx=${txHash}`);
    return { success: true, txHash };
  } catch (error: any) {
    settlementsFailed++;
    const errorMsg = error?.shortMessage || error?.message || String(error);
    logger.error("PerpVault", `Liquidation settlement failed: ${errorMsg.slice(0, 100)}`);
    return { success: false };
  }
}

/**
 * Increase open interest (on position open)
 */
export async function increaseOI(
  token: Address,
  isLong: boolean,
  sizeETH: bigint
): Promise<{ success: boolean; txHash?: string }> {
  if (!isPerpVaultEnabled() || !walletClient) return { success: false };
  if (sizeETH === 0n) return { success: true };

  try {
    const txHash = await walletClient.writeContract({
      address: perpVaultAddress!,
      abi: PERP_VAULT_ABI,
      functionName: "increaseOI",
      args: [token, isLong, sizeETH],
    });

    oiUpdatesExecuted++;
    cachedPoolStats = null;

    logger.debug("PerpVault", `OI increased: token=${token.slice(0, 10)} ${isLong ? "LONG" : "SHORT"} +${sizeETH} tx=${txHash}`);
    return { success: true, txHash };
  } catch (error: any) {
    oiUpdatesFailed++;
    const errorMsg = error?.shortMessage || error?.message || String(error);
    logger.error("PerpVault", `increaseOI failed: ${errorMsg.slice(0, 100)}`);
    return { success: false };
  }
}

/**
 * Decrease open interest (on position close)
 */
export async function decreaseOI(
  token: Address,
  isLong: boolean,
  sizeETH: bigint
): Promise<{ success: boolean; txHash?: string }> {
  if (!isPerpVaultEnabled() || !walletClient) return { success: false };
  if (sizeETH === 0n) return { success: true };

  try {
    const txHash = await walletClient.writeContract({
      address: perpVaultAddress!,
      abi: PERP_VAULT_ABI,
      functionName: "decreaseOI",
      args: [token, isLong, sizeETH],
    });

    oiUpdatesExecuted++;
    cachedPoolStats = null;

    logger.debug("PerpVault", `OI decreased: token=${token.slice(0, 10)} ${isLong ? "LONG" : "SHORT"} -${sizeETH} tx=${txHash}`);
    return { success: true, txHash };
  } catch (error: any) {
    oiUpdatesFailed++;
    const errorMsg = error?.shortMessage || error?.message || String(error);
    logger.error("PerpVault", `decreaseOI failed: ${errorMsg.slice(0, 100)}`);
    return { success: false };
  }
}

/**
 * Collect trading fee — ETH goes into pool, increasing share price
 */
export async function collectTradingFee(
  feeETH: bigint
): Promise<{ success: boolean; txHash?: string }> {
  if (!isPerpVaultEnabled() || !walletClient) return { success: false };
  if (feeETH === 0n) return { success: true };

  try {
    const txHash = await walletClient.writeContract({
      address: perpVaultAddress!,
      abi: PERP_VAULT_ABI,
      functionName: "collectFee",
      args: [feeETH],
      value: feeETH,
    });

    feesCollectedCount++;
    cachedPoolStats = null;

    logger.debug("PerpVault", `Fee collected: ${feeETH} ETH tx=${txHash}`);
    return { success: true, txHash };
  } catch (error: any) {
    const errorMsg = error?.shortMessage || error?.message || String(error);
    logger.error("PerpVault", `collectFee failed: ${errorMsg.slice(0, 100)}`);
    return { success: false };
  }
}

// ============================================================
// Metrics
// ============================================================

/**
 * Get module metrics
 */
export function getPerpVaultMetrics(): {
  initialized: boolean;
  enabled: boolean;
  address: string | null;
  settlementsExecuted: number;
  settlementsFailed: number;
  oiUpdatesExecuted: number;
  oiUpdatesFailed: number;
  feesCollectedCount: number;
} {
  return {
    initialized,
    enabled: isPerpVaultEnabled(),
    address: perpVaultAddress,
    settlementsExecuted,
    settlementsFailed,
    oiUpdatesExecuted,
    oiUpdatesFailed,
    feesCollectedCount,
  };
}

// ============================================================
// Export
// ============================================================

export default {
  initPerpVault,
  isPerpVaultEnabled,
  getPoolValue,
  getSharePrice,
  getPoolStats,
  getTokenOI,
  canIncreaseOI,
  getLPInfo,
  settleTraderPnL,
  settleLiquidation,
  increaseOI,
  decreaseOI,
  collectTradingFee,
  getPerpVaultMetrics,
};
