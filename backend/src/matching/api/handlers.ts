/**
 * API 处理函数
 */

import type { Address, Hex } from "viem";
import { logger } from "../utils/logger";
import type { APIResponse, Order, Position, UserBalance, FundingRate, MarketStats, Trade } from "../types";
import { TradeRepo, SettlementLogRepo, type PerpTrade } from "../database/redis";

// Modules
import { createDerivedWallet, getDerivedWallet, authorizeTrading, validateSession, exportPrivateKey, revokeSession } from "../modules/wallet";
import { cancelOrder, getOrder, getUserOrders, getPendingOrders } from "../modules/order";
import { getPosition, getUserPositions, getTokenPositions, getAllPositions } from "../modules/position";
import { getBalance, syncBalanceFromChain } from "../modules/balance";
import { getFundingRateInfo, getFundingPaymentHistory } from "../modules/funding";
import { getUserRiskData, getMarketRiskOverview } from "../modules/risk";
// ✅ 修复：engine 现在在 server.ts 中定义，不再有单独的 matching 模块
import { engine } from "../server";
import { getTokenState, getTokenParameters, getTokenLifecycle, getAllTokenLifecycles, getLifecycleStats } from "../modules/lifecycle";
import { getRecentFomoEvents, getGlobalLeaderboard, getTokenLeaderboard, getTraderStats, type FomoEvent, type LeaderboardEntry } from "../modules/fomo";
import { generateLiquidationHeatmap, getLiquidationMapData } from "../modules/liquidation";
import { getTokenHolders, type TopHoldersResponse } from "../modules/tokenHolders";

// ============================================================
// Wallet Handlers
// ============================================================

export async function handleCreateWallet(
  userAddress: Address,
  tradingPassword: string
): Promise<APIResponse<{ derivedAddress: Address }>> {
  try {
    const result = await createDerivedWallet(userAddress, tradingPassword);
    return { success: true, data: result };
  } catch (error: any) {
    logger.error("API", "Create wallet failed:", error);
    return { success: false, error: error.message };
  }
}

export async function handleGetWallet(
  userAddress: Address
): Promise<APIResponse<{ derivedAddress: Address | null }>> {
  try {
    const derivedAddress = await getDerivedWallet(userAddress);
    return { success: true, data: { derivedAddress } };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
}

export async function handleAuthorize(
  userAddress: Address,
  tradingPassword: string,
  expiresInSeconds: number,
  permissions: { canDeposit: boolean; canTrade: boolean; canWithdraw: boolean },
  limits: { maxSingleAmount: string; dailyLimit: string },
  deviceId: string,
  ipAddress: string
): Promise<APIResponse<{ sessionId: string; expiresAt: number }>> {
  try {
    const session = await authorizeTrading(
      userAddress,
      tradingPassword,
      expiresInSeconds,
      permissions,
      {
        maxSingleAmount: BigInt(limits.maxSingleAmount),
        dailyLimit: BigInt(limits.dailyLimit),
        dailyUsed: 0n,
      },
      deviceId,
      ipAddress
    );
    return { success: true, data: { sessionId: session.sessionId, expiresAt: session.expiresAt } };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
}

export async function handleExportPrivateKey(
  userAddress: Address,
  tradingPassword: string
): Promise<APIResponse<{ privateKey: Hex }>> {
  try {
    const privateKey = await exportPrivateKey(userAddress, tradingPassword);
    return { success: true, data: { privateKey } };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
}

// ============================================================
// Order Handlers
// ============================================================

// Note: handleSubmitOrder has been removed.
// Order submission is now handled directly by server.ts /api/order/submit endpoint.

export async function handleCancelOrder(
  orderId: string,
  trader: Address
): Promise<APIResponse<Order>> {
  try {
    const order = await cancelOrder(orderId, trader);
    engine.getOrderBook(order.token).removeOrder(orderId);
    return { success: true, data: order };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
}

export async function handleGetOrder(orderId: string): Promise<APIResponse<Order | null>> {
  try {
    const order = await getOrder(orderId);
    return { success: true, data: order };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
}

export async function handleGetUserOrders(trader: Address): Promise<APIResponse<Order[]>> {
  try {
    const orders = await getUserOrders(trader);
    return { success: true, data: orders };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
}

/**
 * Get user's completed/cancelled orders (order history)
 */
export async function handleGetOrderHistory(
  trader: Address,
  limit: number = 50
): Promise<APIResponse<Order[]>> {
  try {
    const allOrders = await getUserOrders(trader);
    // Filter for completed/cancelled/expired orders
    const historyOrders = allOrders
      .filter(o =>
        o.status === 2 || // FILLED
        o.status === 3 || // CANCELLED
        o.status === 4    // EXPIRED
      )
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, limit);
    return { success: true, data: historyOrders };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
}

/**
 * Get user's trade history (perpetual trades)
 */
export async function handleGetTradeHistory(
  trader: Address,
  limit: number = 50
): Promise<APIResponse<PerpTrade[]>> {
  try {
    const trades = await TradeRepo.getByUser(trader, limit);
    return { success: true, data: trades };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
}

// ============================================================
// Position Handlers
// ============================================================

export async function handleGetPosition(positionId: string): Promise<APIResponse<Position | null>> {
  try {
    const position = await getPosition(positionId);
    return { success: true, data: position };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
}

export async function handleGetUserPositions(trader: Address): Promise<APIResponse<Position[]>> {
  try {
    const positions = await getUserPositions(trader);
    return { success: true, data: positions };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
}

// ============================================================
// Balance Handlers
// ============================================================

export async function handleGetBalance(trader: Address): Promise<APIResponse<UserBalance>> {
  try {
    const balance = await getBalance(trader);
    return { success: true, data: balance };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
}

export async function handleSyncBalance(trader: Address): Promise<APIResponse<UserBalance>> {
  try {
    const balance = await syncBalanceFromChain(trader);
    return { success: true, data: balance };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
}

// ============================================================
// Market Data Handlers
// ============================================================

export async function handleGetOrderbook(token: Address, levels = 20): Promise<APIResponse<unknown>> {
  try {
    const orderBook = engine.getOrderBook(token);
    const depth = orderBook.getDepth(levels);
    return {
      success: true,
      data: {
        token: depth.token,
        bids: depth.bids.map(l => ({
          price: l.price.toString(),
          size: l.totalSize.toString(),
          count: l.orderCount,
        })),
        asks: depth.asks.map(l => ({
          price: l.price.toString(),
          size: l.totalSize.toString(),
          count: l.orderCount,
        })),
        lastPrice: depth.lastPrice.toString(),
        timestamp: depth.timestamp,
      },
    };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
}

export async function handleGetTrades(token: Address, limit = 100): Promise<APIResponse<Trade[]>> {
  try {
    const orderBook = engine.getOrderBook(token);
    const trades = orderBook.getTrades(limit);
    return { success: true, data: trades };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
}

// K线数据 - 基于trades生成或返回空数据 (永续引擎内存数据)
export async function handleGetPerpKlines(
  token: Address,
  interval: string,
  limit: number
): Promise<{ klines: Array<{ timestamp: number; open: string; high: string; low: string; close: string; volume: string }> }> {
  try {
    const orderBook = engine.getOrderBook(token);
    const trades = orderBook.getTrades(500);

    if (trades.length === 0) {
      return { klines: [] };
    }

    // 根据interval计算时间间隔(毫秒)
    const intervalMs: Record<string, number> = {
      "1m": 60 * 1000,
      "5m": 5 * 60 * 1000,
      "15m": 15 * 60 * 1000,
      "1h": 60 * 60 * 1000,
      "4h": 4 * 60 * 60 * 1000,
      "1d": 24 * 60 * 60 * 1000,
    };
    const ms = intervalMs[interval] || 60 * 1000;

    // 按时间窗口聚合trades为klines
    const klineMap = new Map<number, { open: bigint; high: bigint; low: bigint; close: bigint; volume: bigint }>();

    for (const trade of trades) {
      const bucket = Math.floor(trade.timestamp / ms) * ms;
      const existing = klineMap.get(bucket);
      const price = trade.price;
      const size = trade.size;

      if (existing) {
        if (price > existing.high) existing.high = price;
        if (price < existing.low) existing.low = price;
        existing.close = price;
        existing.volume += size;
      } else {
        klineMap.set(bucket, {
          open: price,
          high: price,
          low: price,
          close: price,
          volume: size,
        });
      }
    }

    // 转换为数组并排序
    const klines = Array.from(klineMap.entries())
      .sort((a, b) => a[0] - b[0])
      .slice(-limit)
      .map(([timestamp, k]) => ({
        timestamp,
        open: k.open.toString(),
        high: k.high.toString(),
        low: k.low.toString(),
        close: k.close.toString(),
        volume: k.volume.toString(),
      }));

    return { klines };
  } catch (error) {
    return { klines: [] };
  }
}

export async function handleGetFundingRate(token: Address): Promise<APIResponse<FundingRate>> {
  try {
    const funding = await getFundingRateInfo(token);
    return { success: true, data: funding };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
}

// ============================================================
// Risk Handlers
// ============================================================

export async function handleGetUserRisk(trader: Address): Promise<APIResponse<unknown>> {
  try {
    const riskData = await getUserRiskData(trader);
    return { success: true, data: riskData };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
}

export async function handleGetMarketRisk(token: Address): Promise<APIResponse<unknown>> {
  try {
    const overview = await getMarketRiskOverview(token);
    return { success: true, data: overview };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
}

// ============================================================
// Nonce Handler
// ============================================================

// 用户 nonce 追踪 (简化版本，生产环境应该从链上或数据库获取)
const userNonces = new Map<string, bigint>();

export async function handleGetUserNonce(trader: Address): Promise<APIResponse<{ nonce: string }>> {
  const normalizedTrader = trader.toLowerCase();
  const currentNonce = userNonces.get(normalizedTrader) || 0n;
  return { success: true, data: { nonce: currentNonce.toString() } };
}

export function incrementUserNonce(trader: Address): bigint {
  const normalizedTrader = trader.toLowerCase();
  const currentNonce = userNonces.get(normalizedTrader) || 0n;
  const newNonce = currentNonce + 1n;
  userNonces.set(normalizedTrader, newNonce);
  return newNonce;
}

// ============================================================
// Health Check
// ============================================================

export function handleHealthCheck(): APIResponse<{ status: string; timestamp: number }> {
  return {
    success: true,
    data: {
      status: "healthy",
      timestamp: Date.now(),
    },
  };
}

// ============================================================
// Token Lifecycle Handlers
// ============================================================

export function handleGetTokenParams(
  token: Address
): APIResponse<{
  state: string;
  maxLeverage: string;
  minMargin: string;
  makerFee: string;
  takerFee: string;
  tradingEnabled: boolean;
}> {
  try {
    const state = getTokenState(token);
    const params = getTokenParameters(token);

    return {
      success: true,
      data: {
        state,
        maxLeverage: params.maxLeverage.toString(),
        minMargin: params.minMargin.toString(),
        makerFee: params.makerFee.toString(),
        takerFee: params.takerFee.toString(),
        tradingEnabled: params.tradingEnabled,
      },
    };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
}

export function handleGetTokenLifecycle(
  token: Address
): APIResponse<any> {
  try {
    const lifecycle = getTokenLifecycle(token);
    if (!lifecycle) {
      return { success: false, error: "Token not found" };
    }

    return {
      success: true,
      data: {
        token: lifecycle.token,
        state: lifecycle.state,
        volume24h: lifecycle.volume24h.toString(),
        volume1h: lifecycle.volume1h.toString(),
        tradeCount24h: lifecycle.tradeCount24h,
        tradeCount1h: lifecycle.tradeCount1h,
        openInterestLong: lifecycle.openInterestLong.toString(),
        openInterestShort: lifecycle.openInterestShort.toString(),
        positionCount: lifecycle.positionCount,
        currentPrice: lifecycle.currentPrice.toString(),
        lastTradeTime: lifecycle.lastTradeTime,
        createdAt: lifecycle.createdAt,
        stateChangedAt: lifecycle.stateChangedAt,
      },
    };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
}

export function handleGetAllTokenLifecycles(): APIResponse<any[]> {
  try {
    const lifecycles = getAllTokenLifecycles();
    return {
      success: true,
      data: lifecycles.map(l => ({
        token: l.token,
        state: l.state,
        volume24h: l.volume24h.toString(),
        tradeCount24h: l.tradeCount24h,
        openInterestLong: l.openInterestLong.toString(),
        openInterestShort: l.openInterestShort.toString(),
        positionCount: l.positionCount,
      })),
    };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
}

export function handleGetLifecycleStats(): APIResponse<Record<string, number>> {
  try {
    const stats = getLifecycleStats();
    return { success: true, data: stats };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
}

// ============================================================
// FOMO Handlers
// ============================================================

export function handleGetFomoEvents(limit: number = 20): APIResponse<any[]> {
  try {
    const events = getRecentFomoEvents(limit);
    return {
      success: true,
      data: events.map(e => ({
        id: e.id,
        type: e.type,
        trader: e.trader,
        token: e.token,
        tokenSymbol: e.tokenSymbol,
        isLong: e.isLong,
        size: e.size.toString(),
        price: e.price.toString(),
        pnl: e.pnl?.toString(),
        leverage: e.leverage?.toString(),
        timestamp: e.timestamp,
        message: e.message,
      })),
    };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
}

export function handleGetGlobalLeaderboard(
  sortBy: "pnl" | "volume" | "wins" = "pnl",
  limit: number = 10
): APIResponse<any[]> {
  try {
    const entries = getGlobalLeaderboard(sortBy, limit);
    return {
      success: true,
      data: entries.map(e => ({
        trader: e.trader,
        displayName: e.displayName,
        totalPnL: e.totalPnL.toString(),
        totalVolume: e.totalVolume.toString(),
        tradeCount: e.tradeCount,
        winRate: e.winRate,
        biggestWin: e.biggestWin.toString(),
        biggestLoss: e.biggestLoss.toString(),
      })),
    };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
}

export function handleGetTokenLeaderboard(
  token: Address,
  sortBy: "pnl" | "volume" | "wins" = "pnl",
  limit: number = 10
): APIResponse<any[]> {
  try {
    const entries = getTokenLeaderboard(token, sortBy, limit);
    return {
      success: true,
      data: entries.map(e => ({
        trader: e.trader,
        displayName: e.displayName,
        totalPnL: e.totalPnL.toString(),
        totalVolume: e.totalVolume.toString(),
        tradeCount: e.tradeCount,
        winRate: e.winRate,
        biggestWin: e.biggestWin.toString(),
        biggestLoss: e.biggestLoss.toString(),
      })),
    };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
}

export function handleGetTraderStats(trader: Address): APIResponse<any> {
  try {
    const stats = getTraderStats(trader);
    if (!stats) {
      return { success: true, data: null };
    }
    return {
      success: true,
      data: {
        trader: stats.trader,
        displayName: stats.displayName,
        totalPnL: stats.totalPnL.toString(),
        totalVolume: stats.totalVolume.toString(),
        tradeCount: stats.tradeCount,
        winRate: stats.winRate,
        biggestWin: stats.biggestWin.toString(),
        biggestLoss: stats.biggestLoss.toString(),
      },
    };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
}

// ============================================================
// Settlement History (Bills) Handlers
// ============================================================

export async function handleGetSettlementHistory(
  trader: Address,
  options?: { type?: string; limit?: number; before?: number }
): Promise<APIResponse<any[]>> {
  try {
    const logs = await SettlementLogRepo.getByUser(trader, options?.limit || 100);

    let filtered = logs;
    if (options?.type) {
      filtered = filtered.filter(l => l.type === options.type);
    }
    if (options?.before) {
      filtered = filtered.filter(l => l.createdAt < options.before!);
    }

    const serialized = filtered.map(log => ({
      id: log.id,
      txHash: log.txHash,
      type: log.type,
      amount: log.amount.toString(),
      balanceBefore: log.balanceBefore.toString(),
      balanceAfter: log.balanceAfter.toString(),
      onChainStatus: log.onChainStatus,
      proofData: log.proofData,
      positionId: log.positionId,
      orderId: log.orderId,
      createdAt: log.createdAt,
    }));

    return { success: true, data: serialized };
  } catch (error: any) {
    logger.error("API", "Get settlement history failed:", error);
    return { success: false, error: error.message };
  }
}

// ============================================================
// Spot Trade History & K-line Handlers
// ============================================================

import { SpotTradeRepo, KlineRepo, SpotStatsRepo, KLINE_RESOLUTIONS, type KlineResolution } from "../../spot/spotHistory";

export async function handleGetSpotTrades(
  token: Address,
  limit: number = 100,
  before?: number
): Promise<APIResponse<any[]>> {
  try {
    const trades = await SpotTradeRepo.getByToken(token, limit, before);
    return {
      success: true,
      data: trades.map(t => ({
        id: t.id,
        token: t.token,
        trader: t.trader,
        isBuy: t.isBuy,
        ethAmount: t.ethAmount,
        tokenAmount: t.tokenAmount,
        virtualEth: t.virtualEth,
        virtualToken: t.virtualToken,
        price: t.price,
        priceUsd: t.priceUsd,
        txHash: t.txHash,
        blockNumber: t.blockNumber,
        timestamp: t.timestamp,
      })),
    };
  } catch (error: any) {
    logger.error("API", "Get spot trades failed:", error);
    return { success: false, error: error.message };
  }
}

export async function handleGetKlines(
  token: Address,
  resolution: string,
  from: number,
  to: number
): Promise<APIResponse<any[]>> {
  try {
    // Validate resolution
    if (!Object.keys(KLINE_RESOLUTIONS).includes(resolution)) {
      return { success: false, error: `Invalid resolution: ${resolution}. Valid: ${Object.keys(KLINE_RESOLUTIONS).join(", ")}` };
    }

    const klines = await KlineRepo.get(token, resolution as KlineResolution, from, to);
    return {
      success: true,
      data: klines,
    };
  } catch (error: any) {
    logger.error("API", "Get klines failed:", error);
    return { success: false, error: error.message };
  }
}

export async function handleGetLatestKlines(
  token: Address,
  resolution: string,
  limit: number = 100
): Promise<APIResponse<any[]>> {
  try {
    if (!Object.keys(KLINE_RESOLUTIONS).includes(resolution)) {
      return { success: false, error: `Invalid resolution: ${resolution}` };
    }

    const klines = await KlineRepo.getLatest(token, resolution as KlineResolution, limit);
    return {
      success: true,
      data: klines.reverse(), // Return oldest first
    };
  } catch (error: any) {
    logger.error("API", "Get latest klines failed:", error);
    return { success: false, error: error.message };
  }
}

export async function handleGetSpotPrice(token: Address): Promise<APIResponse<any>> {
  try {
    const price = await SpotStatsRepo.getPrice(token);
    const stats = await SpotStatsRepo.get24hStats(token);
    return {
      success: true,
      data: {
        price: price?.price || "0",
        priceUsd: price?.priceUsd || "0",
        ...stats,
      },
    };
  } catch (error: any) {
    logger.error("API", "Get spot price failed:", error);
    return { success: false, error: error.message };
  }
}

// ============================================================
// Liquidation Heatmap Handlers
// ============================================================

export async function handleGetLiquidationHeatmap(
  token: Address,
  timeRange: string = "1d"
): Promise<APIResponse<any>> {
  try {
    const heatmap = await generateLiquidationHeatmap(token, timeRange, 20);
    return {
      success: true,
      data: {
        token: heatmap.token,
        currentPrice: heatmap.currentPrice,
        priceMin: heatmap.priceMin,
        priceMax: heatmap.priceMax,
        priceStep: heatmap.priceStep,
        priceLevels: heatmap.priceLevels,
        timeStart: heatmap.timeStart,
        timeEnd: heatmap.timeEnd,
        timeSlots: heatmap.timeSlots,
        resolution: heatmap.resolution,
        heatmap: heatmap.heatmap.map(cell => ({
          priceLevel: cell.priceLevel,
          timeSlot: cell.timeSlot,
          longLiquidationSize: cell.longLiquidationSize.toString(),
          shortLiquidationSize: cell.shortLiquidationSize.toString(),
          longAccountCount: cell.longAccountCount,
          shortAccountCount: cell.shortAccountCount,
          intensity: cell.intensity,
        })),
        longTotal: heatmap.longTotal,
        shortTotal: heatmap.shortTotal,
        longAccountTotal: heatmap.longAccountTotal,
        shortAccountTotal: heatmap.shortAccountTotal,
        timestamp: heatmap.timestamp,
      },
    };
  } catch (error: any) {
    logger.error("API", "Get liquidation heatmap failed:", error);
    return { success: false, error: error.message };
  }
}

export async function handleGetLiquidationMap(token: Address): Promise<APIResponse<any>> {
  try {
    const mapData = await getLiquidationMapData(token);
    return { success: true, data: mapData };
  } catch (error: any) {
    logger.error("API", "Get liquidation map failed:", error);
    return { success: false, error: error.message };
  }
}

// 调试: 获取所有仓位
export async function handleDebugAllPositions(): Promise<any> {
  try {
    const allPositions = await getAllPositions();
    return {
      success: true,
      totalCount: allPositions.length,
      positions: allPositions.map(pos => ({
        id: pos.id,
        pairId: pos.pairId,
        trader: pos.trader,
        token: pos.token,
        isLong: pos.isLong,
        status: pos.status,
        size: pos.size.toString(),
        entryPrice: pos.entryPrice.toString(),
        markPrice: pos.markPrice.toString(),
        liquidationPrice: pos.liquidationPrice.toString(),
        collateral: pos.collateral.toString(),
        leverage: pos.leverage.toString(),
      })),
    };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
}

export async function handleGetAllPositions(token: Address): Promise<APIResponse<any>> {
  try {
    // 规范化 token 地址为小写
    const normalizedToken = token.toLowerCase() as Address;

    // 先尝试获取该 token 的仓位
    let positions = await getTokenPositions(normalizedToken);

    // 如果没有找到，尝试获取所有仓位并过滤
    if (positions.length === 0) {
      const allPositions = await getAllPositions();
      positions = allPositions.filter(
        p => p.token.toLowerCase() === normalizedToken
      );
    }

    const orderBook = engine.getOrderBook(normalizedToken);
    const currentPrice = orderBook.getCurrentPrice();

    // 格式化仓位数据
    const formattedPositions = positions
      .filter(p => p.status === 0) // 只返回开放仓位
      .map(pos => {
        // 计算风险等级
        const marginRatio = Number(pos.marginRatio) / 100; // 转为百分比
        let riskLevel: "safe" | "warning" | "danger" = "safe";
        if (marginRatio >= 80) riskLevel = "danger";
        else if (marginRatio >= 60) riskLevel = "warning";

        return {
          trader: pos.trader,
          isLong: pos.isLong,
          size: pos.size.toString(),
          entryPrice: pos.entryPrice.toString(),
          markPrice: pos.markPrice.toString(),
          collateral: pos.collateral.toString(),
          leverage: (Number(pos.leverage) / 10000).toString(),
          liquidationPrice: pos.liquidationPrice.toString(),
          marginRatio: pos.marginRatio.toString(),
          unrealizedPnL: pos.unrealizedPnL.toString(),
          roe: pos.roe.toString(),
          riskLevel,
        };
      });

    // 统计危险和警告仓位数量
    const dangerCount = formattedPositions.filter(p => p.riskLevel === "danger").length;
    const warningCount = formattedPositions.filter(p => p.riskLevel === "warning").length;

    return {
      success: true,
      data: {
        token: normalizedToken,
        currentPrice: currentPrice.toString(),
        positions: formattedPositions,
        totalPositions: formattedPositions.length,
        dangerCount,
        warningCount,
      },
    };
  } catch (error: any) {
    logger.error("API", "Get all positions failed:", error);
    return { success: false, error: error.message };
  }
}

// ============================================================
// Token Holders Handlers
// ============================================================

export async function handleGetTokenHolders(
  token: Address,
  limit: number = 10,
  includePnl: boolean = false
): Promise<APIResponse<TopHoldersResponse>> {
  try {
    const result = await getTokenHolders(token, limit, includePnl);
    return { success: true, data: result };
  } catch (error: any) {
    logger.error("API", "Get token holders failed:", error);
    return { success: false, error: error.message };
  }
}
