/**
 * 风控模块 (ETH 本位)
 *
 * 100ms 风险检查循环:
 * 1. 更新所有仓位风险指标
 * 2. 检测强平候选
 * 3. 更新 ADL 队列
 * 4. 广播风控数据
 *
 * ETH 本位精度:
 * - 所有价格: ETH/Token (1e18)
 * - 所有金额: ETH (1e18)
 */

import type { Address } from "viem";
import { SUPPORTED_TOKENS, RISK_ENGINE_INTERVAL_MS, REDIS_SYNC_CYCLES, TRADING } from "../config";
import { PositionRepo } from "../database/redis";
import { logger } from "../utils/logger";
import { calculatePnL, calculateMarginRatio, calculateADLScore as calcADL } from "../utils/precision";
// ✅ 修复：engine 现在在 server.ts 中定义
import { engine } from "../server";
import { detectLiquidations, updateLiquidationQueue, processLiquidations, updateADLQueues, calculateADLRanking } from "./liquidation";
// ❌ Mode 2: settlement 模块已删除，健康状态改为链下计算
// import { getHealthStatus as getSettlementHealth } from "./settlement";
import { getStatus as getInsuranceStatus, type InsuranceFundStatus } from "./insurance";

// Mode 2: 链下健康状态（不再读取链上 Settlement 合约）
async function getSettlementHealth() {
  // TODO: 从 Redis 或内存中计算系统健康状态
  return {
    totalBalance: 0n,
    totalLocked: 0n,
    pendingFunding: 0n,
    healthScore: 100n,
    utilizationRate: 0n,
  };
}
// updateVolatility removed - 固定资金费率，不再需要波动率追踪
import type { Position, RiskData, RiskLevel, LiquidationCandidate } from "../types";

// ============================================================
// State
// ============================================================

let riskEngineInterval: NodeJS.Timeout | null = null;
let systemHealthInterval: NodeJS.Timeout | null = null;
let riskEngineCycleCount = 0;
let onRiskUpdate: ((data: RiskData[]) => void) | null = null;
let onLiquidationWarning: ((position: Position) => void) | null = null;
let onMarginWarning: ((position: Position, marginRatio: number) => void) | null = null;
let onSystemHealthWarning: ((report: SystemHealthReport) => void) | null = null;

// System health types
export interface SystemHealthReport {
  timestamp: number;
  overallHealth: "healthy" | "warning" | "critical";
  settlement: {
    totalBalance: bigint;
    totalLocked: bigint;
    utilizationRate: bigint;
    healthScore: bigint;
    status: "healthy" | "warning" | "critical";
  };
  insurance: {
    balance: bigint;
    healthLevel: InsuranceFundStatus["healthLevel"];
    netIncome: bigint;
  };
  positions: {
    totalOpen: number;
    liquidatable: number;
    highRisk: number;
    totalMargin: bigint;
    totalUnrealizedPnL: bigint;
  };
  recommendation: string;
}

// ============================================================
// Risk Engine
// ============================================================

/**
 * 启动风险引擎
 */
export function startRiskEngine(): void {
  if (riskEngineInterval) return;

  logger.info("Risk", `Starting 100ms risk engine...`);

  riskEngineInterval = setInterval(() => {
    runRiskCheck();
  }, RISK_ENGINE_INTERVAL_MS);
}

/**
 * 停止风险引擎
 */
export function stopRiskEngine(): void {
  if (riskEngineInterval) {
    clearInterval(riskEngineInterval);
    riskEngineInterval = null;
  }
}

/**
 * 设置风控回调
 */
export function setRiskCallbacks(callbacks: {
  onRiskUpdate?: (data: RiskData[]) => void;
  onLiquidationWarning?: (position: Position) => void;
  onMarginWarning?: (position: Position, marginRatio: number) => void;
  onSystemHealthWarning?: (report: SystemHealthReport) => void;
}): void {
  if (callbacks.onRiskUpdate) onRiskUpdate = callbacks.onRiskUpdate;
  if (callbacks.onLiquidationWarning) onLiquidationWarning = callbacks.onLiquidationWarning;
  if (callbacks.onMarginWarning) onMarginWarning = callbacks.onMarginWarning;
  if (callbacks.onSystemHealthWarning) onSystemHealthWarning = callbacks.onSystemHealthWarning;
}

/**
 * 风险检查主循环
 */
async function runRiskCheck(): Promise<void> {
  const startTime = Date.now();

  try {
    const allPositions = await PositionRepo.getAll();
    const allScores: number[] = [];
    const liquidationCandidates: LiquidationCandidate[] = [];
    const riskDataByTrader = new Map<Address, RiskData>();
    const positionUpdates: Array<{ id: string; data: Partial<Position> }> = [];

    // 遍历所有仓位
    for (const position of allPositions) {
      if (position.status !== 0) continue; // 只处理开放仓位

      const orderBook = engine.getOrderBook(position.token);
      const currentPrice = orderBook.getCurrentPrice();
      if (currentPrice === 0n) continue;

      // 波动率追踪已移除 - 使用固定资金费率

      // 计算未实现盈亏
      const unrealizedPnL = calculatePnL(
        position.size,
        position.entryPrice,
        currentPrice,
        position.isLong
      );

      // 计算当前保证金
      const currentMargin = position.collateral + unrealizedPnL;

      // 计算动态 MMR
      const leverage = position.leverage;
      const initialMarginRate = 10000n * 10000n / leverage;
      const baseMmr = TRADING.BASE_MMR;
      const maxMmr = initialMarginRate / 2n;
      const mmr = baseMmr < maxMmr ? baseMmr : maxMmr;

      // 计算维持保证金 (ETH 本位)
      // positionValue = size * price / 1e18 (ETH)
      const positionValue = (position.size * currentPrice) / (10n ** 18n);
      const maintenanceMargin = (positionValue * mmr) / 10000n;

      // 计算保证金率
      const marginRatio = calculateMarginRatio(currentMargin, maintenanceMargin);
      const marginRatioNum = Number(marginRatio);

      // 计算 ROE
      const roe = position.collateral > 0n
        ? Number((unrealizedPnL * 10000n) / position.collateral)
        : 0;

      // 计算 ADL Score
      const adlScore = calcADL(unrealizedPnL, position.collateral, leverage);
      allScores.push(Number(adlScore));

      // 判断风险等级
      let riskLevel: RiskLevel;
      const prevRiskLevel = position.riskLevel;

      if (marginRatioNum >= 10000) {
        riskLevel = "critical";
        if (prevRiskLevel !== "critical" && onLiquidationWarning) {
          onLiquidationWarning(position);
        }
      } else if (marginRatioNum >= 8000) {
        riskLevel = "high";
        if ((prevRiskLevel === "low" || prevRiskLevel === "medium") && onMarginWarning) {
          onMarginWarning(position, marginRatioNum);
        }
      } else if (marginRatioNum >= 5000) {
        riskLevel = "medium";
      } else {
        riskLevel = "low";
      }

      // 加入强平队列
      if (marginRatioNum >= 10000) {
        const urgency = Math.min(100, Math.max(0, Math.floor((marginRatioNum - 10000) / 100)));
        liquidationCandidates.push({
          position: { ...position, marginRatio, riskLevel },
          marginRatio: marginRatioNum,
          urgency,
        });
      }

      // 收集更新
      positionUpdates.push({
        id: position.id,
        data: {
          markPrice: currentPrice,
          unrealizedPnL,
          margin: currentMargin,
          marginRatio,
          mmr,
          maintenanceMargin,
          roe: BigInt(roe),
          adlScore,
          riskLevel,
          isLiquidatable: marginRatioNum >= 10000,
          isAdlCandidate: unrealizedPnL > 0n,
          updatedAt: Date.now(),
        },
      });

      // 收集用户风控数据
      let traderRisk = riskDataByTrader.get(position.trader);
      if (!traderRisk) {
        traderRisk = {
          trader: position.trader,
          positions: [],
          totalMargin: 0n,
          totalUnrealizedPnL: 0n,
          totalEquity: 0n,
          accountMarginRatio: 0n,
          riskLevel: "low",
        };
        riskDataByTrader.set(position.trader, traderRisk);
      }
      traderRisk.positions.push({ ...position, marginRatio, riskLevel, unrealizedPnL, markPrice: currentPrice });
      traderRisk.totalMargin += position.collateral;
      traderRisk.totalUnrealizedPnL += unrealizedPnL;
    }

    // 更新 ADL 排名
    for (const update of positionUpdates) {
      const score = Number(update.data.adlScore || 0n);
      update.data.adlRanking = calculateADLRanking(score, allScores);
    }

    // 按 marginRatio 排序强平队列
    liquidationCandidates.sort((a, b) => b.marginRatio - a.marginRatio);
    updateLiquidationQueue(liquidationCandidates);

    // 更新 ADL 队列
    await updateADLQueues();

    // 处理强平
    await processLiquidations();

    // 计算用户级风控数据
    const riskDataList: RiskData[] = [];
    for (const [trader, data] of riskDataByTrader) {
      data.totalEquity = data.totalMargin + data.totalUnrealizedPnL;

      // 账户级风险等级
      if (data.positions.some(p => p.riskLevel === "critical")) {
        data.riskLevel = "critical";
      } else if (data.positions.some(p => p.riskLevel === "high")) {
        data.riskLevel = "high";
      } else if (data.positions.some(p => p.riskLevel === "medium")) {
        data.riskLevel = "medium";
      }

      riskDataList.push(data);
    }

    // 广播风控数据
    if (onRiskUpdate && riskDataList.length > 0) {
      onRiskUpdate(riskDataList);
    }

    // 每秒同步到 Redis
    riskEngineCycleCount++;
    if (riskEngineCycleCount >= REDIS_SYNC_CYCLES) {
      riskEngineCycleCount = 0;
      await PositionRepo.batchUpdateRisk(positionUpdates);
    }

    const elapsed = Date.now() - startTime;
    if (elapsed > 50) {
      logger.warn("Risk", `Slow risk check: ${elapsed}ms`);
    }
  } catch (error) {
    logger.error("Risk", "Risk check failed:", error);
  }
}

/**
 * 获取用户风控数据
 */
export async function getUserRiskData(trader: Address): Promise<RiskData | null> {
  const positions = await PositionRepo.getByUser(trader);
  if (positions.length === 0) return null;

  const riskData: RiskData = {
    trader,
    positions,
    totalMargin: 0n,
    totalUnrealizedPnL: 0n,
    totalEquity: 0n,
    accountMarginRatio: 0n,
    riskLevel: "low",
  };

  for (const pos of positions) {
    if (pos.status !== 0) continue;
    riskData.totalMargin += pos.collateral;
    riskData.totalUnrealizedPnL += pos.unrealizedPnL;

    if (pos.riskLevel === "critical") riskData.riskLevel = "critical";
    else if (pos.riskLevel === "high" && riskData.riskLevel !== "critical") riskData.riskLevel = "high";
    else if (pos.riskLevel === "medium" && riskData.riskLevel === "low") riskData.riskLevel = "medium";
  }

  riskData.totalEquity = riskData.totalMargin + riskData.totalUnrealizedPnL;

  return riskData;
}

/**
 * 获取市场风控概览
 */
export async function getMarketRiskOverview(token: Address): Promise<{
  totalLongOI: bigint;
  totalShortOI: bigint;
  totalMargin: bigint;
  avgLeverage: number;
  liquidationCount: number;
}> {
  const positions = await PositionRepo.getByToken(token);

  let totalLongOI = 0n;
  let totalShortOI = 0n;
  let totalMargin = 0n;
  let totalLeverage = 0n;
  let liquidationCount = 0;
  let positionCount = 0;

  for (const pos of positions) {
    if (pos.status !== 0) continue;

    if (pos.isLong) {
      totalLongOI += pos.size;
    } else {
      totalShortOI += pos.size;
    }

    totalMargin += pos.collateral;
    totalLeverage += pos.leverage;
    positionCount++;

    if (pos.isLiquidatable) liquidationCount++;
  }

  return {
    totalLongOI,
    totalShortOI,
    totalMargin,
    avgLeverage: positionCount > 0 ? Number(totalLeverage / BigInt(positionCount)) / 10000 : 0,
    liquidationCount,
  };
}

// ============================================================
// System Health Monitoring
// ============================================================

/**
 * 获取系统级风险概览
 */
export async function getSystemRiskOverview(): Promise<SystemHealthReport> {
  const timestamp = Date.now();

  // 并行获取各系统状态
  const [settlementHealth, insuranceStatus, allPositions] = await Promise.all([
    getSettlementHealth().catch(() => ({
      totalBalance: 0n,
      totalLocked: 0n,
      pendingFunding: 0n,
      healthScore: 0n,
      utilizationRate: 0n,
    })),
    getInsuranceStatus().catch(() => ({
      balance: 0n,
      totalFundingReceived: 0n,
      totalLiquidationReceived: 0n,
      totalInjected: 0n,
      netIncome: 0n,
      healthLevel: "critical" as const,
      timestamp: Date.now(),
    })),
    PositionRepo.getAll(),
  ]);

  // 计算仓位统计
  let totalOpen = 0;
  let liquidatable = 0;
  let highRisk = 0;
  let totalMargin = 0n;
  let totalUnrealizedPnL = 0n;

  for (const pos of allPositions) {
    if (pos.status !== 0) continue;
    totalOpen++;
    totalMargin += pos.collateral;
    totalUnrealizedPnL += pos.unrealizedPnL;

    if (pos.isLiquidatable) liquidatable++;
    if (pos.riskLevel === "high" || pos.riskLevel === "critical") highRisk++;
  }

  // 确定 Settlement 状态
  let settlementStatus: "healthy" | "warning" | "critical" = "healthy";
  if (settlementHealth.utilizationRate >= 95n) {
    settlementStatus = "critical";
  } else if (settlementHealth.utilizationRate >= 80n) {
    settlementStatus = "warning";
  }

  // 确定整体健康状态
  let overallHealth: "healthy" | "warning" | "critical" = "healthy";
  let recommendation = "System is operating normally.";

  if (settlementStatus === "critical" || insuranceStatus.healthLevel === "critical") {
    overallHealth = "critical";
    recommendation = "CRITICAL: System requires immediate attention. ";

    if (settlementStatus === "critical") {
      recommendation += "Settlement contract utilization is dangerously high. ";
    }
    if (insuranceStatus.healthLevel === "critical") {
      recommendation += "Insurance fund balance is critically low. ";
    }
  } else if (settlementStatus === "warning" || insuranceStatus.healthLevel === "warning" || highRisk > 10) {
    overallHealth = "warning";
    recommendation = "WARNING: System health is degraded. ";

    if (settlementStatus === "warning") {
      recommendation += "Monitor Settlement contract utilization. ";
    }
    if (insuranceStatus.healthLevel === "warning") {
      recommendation += "Consider adding funds to insurance. ";
    }
    if (highRisk > 10) {
      recommendation += `${highRisk} positions at high risk. `;
    }
  }

  return {
    timestamp,
    overallHealth,
    settlement: {
      totalBalance: settlementHealth.totalBalance,
      totalLocked: settlementHealth.totalLocked,
      utilizationRate: settlementHealth.utilizationRate,
      healthScore: settlementHealth.healthScore,
      status: settlementStatus,
    },
    insurance: {
      balance: insuranceStatus.balance,
      healthLevel: insuranceStatus.healthLevel,
      netIncome: insuranceStatus.netIncome,
    },
    positions: {
      totalOpen,
      liquidatable,
      highRisk,
      totalMargin,
      totalUnrealizedPnL,
    },
    recommendation,
  };
}

/**
 * 启动系统健康检查定时器
 */
export function startSystemHealthCheck(): void {
  if (systemHealthInterval) return;

  // 每分钟检查一次系统健康
  systemHealthInterval = setInterval(async () => {
    try {
      const report = await getSystemRiskOverview();

      if (report.overallHealth !== "healthy" && onSystemHealthWarning) {
        onSystemHealthWarning(report);
      }

      if (report.overallHealth === "critical") {
        logger.error("Risk", `CRITICAL SYSTEM HEALTH: ${report.recommendation}`);
      } else if (report.overallHealth === "warning") {
        logger.warn("Risk", `System health warning: ${report.recommendation}`);
      }
    } catch (error) {
      logger.error("Risk", "System health check failed:", error);
    }
  }, 60000); // 1 minute

  logger.info("Risk", "Started system health check timer (every 1 minute)");
}

/**
 * 停止系统健康检查定时器
 */
export function stopSystemHealthCheck(): void {
  if (systemHealthInterval) {
    clearInterval(systemHealthInterval);
    systemHealthInterval = null;
    logger.info("Risk", "Stopped system health check timer");
  }
}

export default {
  startRiskEngine,
  stopRiskEngine,
  setRiskCallbacks,
  getUserRiskData,
  getMarketRiskOverview,
  getSystemRiskOverview,
  startSystemHealthCheck,
  stopSystemHealthCheck,
};
