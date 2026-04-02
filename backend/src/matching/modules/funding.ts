/**
 * 资金费率模块（Skew-Based 动态版）
 *
 * 新经济模型:
 * - 动态费率：基于多空 OI 偏斜
 * - skew = (longOI - shortOI) / (longOI + shortOI)
 * - fundingRate = skew × 0.01%，上限 ±0.05%/期
 * - 周期：8 分钟
 * - 资金流向：多空互转（平台不抽成）
 *   多头多 → 多头付空头
 *   空头多 → 空头付多头
 *
 * ETH 本位:
 * - 所有金额以 ETH 计价 (1e18 精度)
 */

import type { Address } from "viem";
import { PositionRepo, SettlementLogRepo } from "../database/redis";
import { FUNDING, PRECISION_MULTIPLIER } from "../config";
import { logger } from "../utils/logger";
import { calculateLiquidationPriceWithCollateral } from "../utils/precision";
import type { Position, FundingRate, FundingPayment } from "../types";

// ============================================================
// Constants (from config.ts — single source of truth)
// ============================================================

const BASE_RATE_MULTIPLIER = FUNDING.SKEW_BASE_RATE_MULTIPLIER;
const SKEW_DIVISOR = FUNDING.SKEW_DIVISOR;
const MAX_FUNDING_RATE = FUNDING.MAX_RATE;
const FUNDING_INTERVAL_MS = FUNDING.BASE_INTERVAL_MS;

// 精度
const RATE_PRECISION = PRECISION_MULTIPLIER.RATE;

// ============================================================
// State
// ============================================================

// 每个代币的下次结算时间
const nextFundingSettlement = new Map<Address, number>();

// 资金费支付历史
const fundingPaymentHistory = new Map<Address, FundingPayment[]>();

// 每个代币当前资金费率 (缓存)
const currentFundingRates = new Map<Address, bigint>();

// 定时器
let fundingInterval: NodeJS.Timeout | null = null;

// 支持的代币列表（从外部设置）
let supportedTokens: Address[] = [];

// ============================================================
// Configuration
// ============================================================

export function setSupportedTokens(tokens: Address[]): void {
  supportedTokens = tokens.map(t => t.toLowerCase() as Address);
}

/**
 * 计算当前资金费率 (基于 OI skew)
 * 返回值: 正数 = 多头付空头, 负数 = 空头付多头 (基点)
 */
export function calculateFundingRate(longOI: bigint, shortOI: bigint): bigint {
  const totalOI = longOI + shortOI;
  if (totalOI === 0n) return 0n;

  // skew in basis points: (longOI - shortOI) * 10000 / totalOI
  const skewBps = ((longOI - shortOI) * RATE_PRECISION) / totalOI;

  // fundingRate = skew * BASE_RATE / SKEW_DIVISOR
  let rate = (skewBps * BASE_RATE_MULTIPLIER) / SKEW_DIVISOR;

  // Clamp to ±MAX_FUNDING_RATE
  if (rate > MAX_FUNDING_RATE) rate = MAX_FUNDING_RATE;
  if (rate < -MAX_FUNDING_RATE) rate = -MAX_FUNDING_RATE;

  return rate;
}

export function getFundingRate(token?: Address): bigint {
  if (token) {
    return currentFundingRates.get(token.toLowerCase() as Address) || 0n;
  }
  return 0n;
}

export function getFundingInterval(): number {
  return FUNDING_INTERVAL_MS;
}

// ============================================================
// Funding Settlement
// ============================================================

/**
 * 执行资金费结算（Skew-Based 动态版）
 *
 * 正费率 → 多头付空头
 * 负费率 → 空头付多头
 */
export async function settleFunding(token: Address): Promise<FundingPayment[]> {
  const normalizedToken = token.toLowerCase() as Address;
  const positions = await PositionRepo.getByToken(normalizedToken);
  const payments: FundingPayment[] = [];
  const timestamp = Date.now();

  // 计算 OI
  let longOI = 0n;
  let shortOI = 0n;
  const activePositions: Position[] = [];

  for (const pos of positions) {
    if (pos.status !== 0) continue;
    activePositions.push(pos);
    if (pos.isLong) {
      longOI += pos.size;
    } else {
      shortOI += pos.size;
    }
  }

  if (activePositions.length === 0) {
    nextFundingSettlement.set(normalizedToken, Date.now() + FUNDING_INTERVAL_MS);
    return payments;
  }

  // 计算费率
  const fundingRate = calculateFundingRate(longOI, shortOI);
  currentFundingRates.set(normalizedToken, fundingRate);

  if (fundingRate === 0n) {
    nextFundingSettlement.set(normalizedToken, Date.now() + FUNDING_INTERVAL_MS);
    return payments;
  }

  // 正费率: 多头付，空头收
  // 负费率: 空头付，多头收
  const longPays = fundingRate > 0n;
  const absRate = fundingRate > 0n ? fundingRate : -fundingRate;

  // 第一遍: 收取付费方的资金
  let totalCollected = 0n;
  const payerUpdates: { position: Position; amount: bigint }[] = [];
  const receiverPositions: Position[] = [];

  for (const pos of activePositions) {
    const isPayer = (pos.isLong && longPays) || (!pos.isLong && !longPays);

    if (isPayer) {
      // 付费方: 按保证金计算资金费
      const fundingAmount = (pos.collateral * absRate) / RATE_PRECISION;
      if (fundingAmount === 0n) continue;

      payerUpdates.push({ position: pos, amount: fundingAmount });
      totalCollected += fundingAmount;
    } else {
      receiverPositions.push(pos);
    }
  }

  // 第二遍: 按比例分配给收款方
  let totalReceiverCollateral = 0n;
  for (const pos of receiverPositions) {
    totalReceiverCollateral += pos.collateral;
  }

  // 执行扣款 (付费方)
  for (const { position: pos, amount } of payerUpdates) {
    const newCollateral = pos.collateral - amount;
    const newLiquidationPrice = calculateLiquidationPriceWithCollateral(
      pos.entryPrice, pos.size, newCollateral, pos.mmr, pos.isLong
    );

    await PositionRepo.update(pos.id, {
      collateral: newCollateral,
      margin: newCollateral,
      accumulatedFunding: pos.accumulatedFunding + amount,
      liquidationPrice: newLiquidationPrice,
    });

    payments.push({
      id: `${pos.id}-${timestamp}`,
      trader: pos.trader,
      token: normalizedToken,
      positionId: pos.id,
      isLong: pos.isLong,
      positionSize: pos.size,
      fundingRate: fundingRate,
      fundingAmount: amount, // 正值 = 支出
      timestamp,
    });

    await SettlementLogRepo.create({
      txHash: null,
      userAddress: pos.trader,
      type: "FUNDING_FEE",
      amount: -amount,
      balanceBefore: pos.collateral,
      balanceAfter: newCollateral,
      onChainStatus: "SUCCESS",
      proofData: JSON.stringify({
        positionId: pos.id,
        fundingRate: fundingRate.toString(),
        fundingAmount: amount.toString(),
        direction: "PAY",
      }),
      positionId: pos.id,
    });
  }

  // 执行收款 (收款方) — 按保证金比例分配
  if (totalReceiverCollateral > 0n && totalCollected > 0n) {
    for (const pos of receiverPositions) {
      const receiveAmount = (totalCollected * pos.collateral) / totalReceiverCollateral;
      if (receiveAmount === 0n) continue;

      const newCollateral = pos.collateral + receiveAmount;
      const newLiquidationPrice = calculateLiquidationPriceWithCollateral(
        pos.entryPrice, pos.size, newCollateral, pos.mmr, pos.isLong
      );

      await PositionRepo.update(pos.id, {
        collateral: newCollateral,
        margin: newCollateral,
        accumulatedFunding: pos.accumulatedFunding - receiveAmount,
        liquidationPrice: newLiquidationPrice,
      });

      payments.push({
        id: `${pos.id}-${timestamp}-recv`,
        trader: pos.trader,
        token: normalizedToken,
        positionId: pos.id,
        isLong: pos.isLong,
        positionSize: pos.size,
        fundingRate: fundingRate,
        fundingAmount: -receiveAmount, // 负值 = 收入
        timestamp,
      });

      await SettlementLogRepo.create({
        txHash: null,
        userAddress: pos.trader,
        type: "FUNDING_FEE",
        amount: receiveAmount,
        balanceBefore: pos.collateral,
        balanceAfter: newCollateral,
        onChainStatus: "SUCCESS",
        proofData: JSON.stringify({
          positionId: pos.id,
          fundingRate: fundingRate.toString(),
          fundingAmount: receiveAmount.toString(),
          direction: "RECEIVE",
        }),
        positionId: pos.id,
      });
    }
  }

  // 更新历史
  if (payments.length > 0) {
    let history = fundingPaymentHistory.get(normalizedToken) || [];
    history.unshift(...payments);
    if (history.length > 1000) history = history.slice(0, 1000);
    fundingPaymentHistory.set(normalizedToken, history);
  }

  nextFundingSettlement.set(normalizedToken, Date.now() + FUNDING_INTERVAL_MS);

  if (payments.length > 0) {
    logger.info("Funding", `Settled ${token.slice(0, 10)}: rate=${fundingRate}bp, ${payerUpdates.length} payers, ${receiverPositions.length} receivers, total=${totalCollected}`);
  }

  return payments;
}

/**
 * 检查仓位是否需要因资金费而被清算
 */
export async function checkFundingLiquidations(token: Address, maintenanceMarginRate: bigint = 3000n): Promise<Position[]> {
  const normalizedToken = token.toLowerCase() as Address;
  const positions = await PositionRepo.getByToken(normalizedToken);
  const needsLiquidation: Position[] = [];

  for (const position of positions) {
    if (position.status !== 0) continue;

    // Calculate notional value in ETH to determine maintenance margin requirement
    // position.size = token quantity (1e18), position.entryPrice = ETH/Token (1e18)
    const notionalETH = position.entryPrice > 0n
      ? (position.size * position.entryPrice) / (10n ** 18n)
      : position.size;

    // Maintenance margin = notional × MMR / 10000
    const maintenanceMargin = (notionalETH * maintenanceMarginRate) / RATE_PRECISION;

    // Compare actual collateral (already reduced by settleFunding) against maintenance margin
    if (position.collateral <= maintenanceMargin) {
      needsLiquidation.push(position);
      logger.warn("Funding", `Position ${position.id} needs liquidation after funding: collateral=${position.collateral}, maintenanceMargin=${maintenanceMargin}`);
    }
  }

  return needsLiquidation;
}

// ============================================================
// Query Functions
// ============================================================

export function getFundingPaymentHistory(token: Address, limit = 100): FundingPayment[] {
  const history = fundingPaymentHistory.get(token.toLowerCase() as Address) || [];
  return history.slice(0, limit);
}

export function getNextFundingTime(token: Address): number {
  return nextFundingSettlement.get(token.toLowerCase() as Address) || 0;
}

export function getTimeUntilNextFunding(token: Address): number {
  const nextTime = getNextFundingTime(token);
  if (nextTime === 0) return FUNDING_INTERVAL_MS;
  const remaining = nextTime - Date.now();
  return remaining > 0 ? remaining : 0;
}

export function getFundingRateInfo(token: Address, currentPrice: bigint): FundingRate {
  const normalizedToken = token.toLowerCase() as Address;
  const rate = currentFundingRates.get(normalizedToken) || 0n;

  return {
    token: normalizedToken,
    rate,
    markPrice: currentPrice,
    indexPrice: currentPrice,
    nextSettlementTime: nextFundingSettlement.get(normalizedToken) || Date.now() + FUNDING_INTERVAL_MS,
    timestamp: Date.now(),
  };
}

// ============================================================
// Timer Management
// ============================================================

export function startFundingTimer(): void {
  if (fundingInterval) return;

  const now = Date.now();
  for (const token of supportedTokens) {
    if (!nextFundingSettlement.has(token)) {
      nextFundingSettlement.set(token, now + FUNDING_INTERVAL_MS);
    }
  }

  fundingInterval = setInterval(async () => {
    const now = Date.now();

    for (const token of supportedTokens) {
      const nextTime = nextFundingSettlement.get(token);
      if (!nextTime || now >= nextTime) {
        try {
          await settleFunding(token);
        } catch (error) {
          logger.error("Funding", `Failed to settle funding for ${token}: ${error}`);
        }
      }
    }
  }, 10000); // 每 10 秒检查一次

  logger.info("Funding", `Started funding timer: skew-based ±${MAX_FUNDING_RATE}bp max, every ${FUNDING_INTERVAL_MS / 1000}s`);
}

export function stopFundingTimer(): void {
  if (fundingInterval) {
    clearInterval(fundingInterval);
    fundingInterval = null;
    logger.info("Funding", "Stopped funding timer");
  }
}

export async function triggerFundingSettlement(token: Address): Promise<FundingPayment[]> {
  return settleFunding(token);
}

// ============================================================
// Export
// ============================================================

export default {
  setSupportedTokens,
  calculateFundingRate,
  getFundingRate,
  getFundingInterval,
  settleFunding,
  checkFundingLiquidations,
  getFundingPaymentHistory,
  getNextFundingTime,
  getTimeUntilNextFunding,
  getFundingRateInfo,
  startFundingTimer,
  stopFundingTimer,
  triggerFundingSettlement,
};
