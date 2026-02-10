/**
 * FOMO 引擎模块
 *
 * 功能：
 * 1. 大额开仓事件跟踪
 * 2. 爆仓事件广播
 * 3. 大盈利平仓事件
 * 4. 排行榜（盈利、交易量）
 *
 * 目的：增加平台的刺激感和参与度
 */

import type { Address } from "viem";
import { logger } from "../utils/logger";

// ============================================================
// FOMO 事件类型
// ============================================================

export enum FomoEventType {
  LARGE_OPEN = "LARGE_OPEN",       // 大额开仓
  LARGE_CLOSE = "LARGE_CLOSE",     // 大额平仓
  LIQUIDATION = "LIQUIDATION",     // 爆仓
  BIG_WIN = "BIG_WIN",             // 大盈利
  BIG_LOSS = "BIG_LOSS",           // 大亏损
  WHALE_ENTRY = "WHALE_ENTRY",     // 大户入场
  HOT_TOKEN = "HOT_TOKEN",         // 代币变热门
}

export interface FomoEvent {
  id: string;
  type: FomoEventType;
  trader: Address;
  token: Address;
  tokenSymbol?: string;
  isLong: boolean;
  size: bigint;
  price: bigint;
  pnl?: bigint;           // 盈亏（平仓时）
  leverage?: bigint;
  timestamp: number;
  message: string;        // 展示消息
}

// ============================================================
// 排行榜类型
// ============================================================

export interface LeaderboardEntry {
  trader: Address;
  displayName?: string;   // 缩短的地址或ENS
  totalPnL: bigint;       // 总盈亏
  totalVolume: bigint;    // 总交易量
  tradeCount: number;     // 交易次数
  winRate: number;        // 胜率 (0-100)
  biggestWin: bigint;     // 最大盈利
  biggestLoss: bigint;    // 最大亏损
  lastUpdated: number;
}

export interface TokenLeaderboard {
  token: Address;
  entries: LeaderboardEntry[];
}

// ============================================================
// 阈值配置
// ============================================================

interface FomoThresholds {
  largePositionSizeETH: bigint;    // 大额仓位阈值（ETH）
  bigWinPnLETH: bigint;            // 大盈利阈值（ETH）
  bigLossPnLETH: bigint;           // 大亏损阈值（ETH）
  whaleVolume24hETH: bigint;       // 大户24h交易量阈值
}

const DEFAULT_THRESHOLDS: FomoThresholds = {
  largePositionSizeETH: BigInt(1e18),      // 1 ETH
  bigWinPnLETH: BigInt(1e17),              // 0.1 ETH
  bigLossPnLETH: BigInt(1e17),             // 0.1 ETH
  whaleVolume24hETH: BigInt(10e18),        // 10 ETH
};

// ============================================================
// 存储
// ============================================================

// FOMO 事件列表（最近100条）
const fomoEvents: FomoEvent[] = [];
const MAX_FOMO_EVENTS = 100;

// 全局排行榜
const globalLeaderboard = new Map<Address, LeaderboardEntry>();

// 代币排行榜
const tokenLeaderboards = new Map<Address, Map<Address, LeaderboardEntry>>();

// 事件回调
let onFomoEvent: ((event: FomoEvent) => void) | null = null;

// ============================================================
// 核心函数
// ============================================================

/**
 * 设置FOMO事件回调（用于WebSocket广播）
 */
export function setFomoCallback(callback: (event: FomoEvent) => void): void {
  onFomoEvent = callback;
}

/**
 * 记录开仓事件
 */
export function recordOpenPosition(
  trader: Address,
  token: Address,
  tokenSymbol: string,
  isLong: boolean,
  size: bigint,
  price: bigint,
  leverage: bigint
): FomoEvent | null {
  const thresholds = DEFAULT_THRESHOLDS;

  // 检查是否为大额开仓
  if (size < thresholds.largePositionSizeETH) {
    // 不是大额，只更新排行榜
    updateLeaderboardVolume(trader, token, size);
    return null;
  }

  const event: FomoEvent = {
    id: `${Date.now()}-${trader.slice(0, 8)}`,
    type: FomoEventType.LARGE_OPEN,
    trader,
    token,
    tokenSymbol,
    isLong,
    size,
    price,
    leverage,
    timestamp: Date.now(),
    message: generateOpenMessage(trader, tokenSymbol, isLong, size, leverage),
  };

  addFomoEvent(event);
  updateLeaderboardVolume(trader, token, size);

  logger.info("FOMO", `Large position opened: ${event.message}`);

  return event;
}

/**
 * 记录平仓事件
 */
export function recordClosePosition(
  trader: Address,
  token: Address,
  tokenSymbol: string,
  isLong: boolean,
  size: bigint,
  price: bigint,
  pnl: bigint
): FomoEvent | null {
  const thresholds = DEFAULT_THRESHOLDS;
  const pnlAbs = pnl < 0n ? -pnl : pnl;
  const isProfitable = pnl > 0n;

  // 更新排行榜
  updateLeaderboardPnL(trader, token, pnl, isProfitable);

  // 检查是否为大盈利/大亏损
  if (isProfitable && pnlAbs >= thresholds.bigWinPnLETH) {
    const event: FomoEvent = {
      id: `${Date.now()}-${trader.slice(0, 8)}`,
      type: FomoEventType.BIG_WIN,
      trader,
      token,
      tokenSymbol,
      isLong,
      size,
      price,
      pnl,
      timestamp: Date.now(),
      message: generateWinMessage(trader, tokenSymbol, pnl),
    };

    addFomoEvent(event);
    logger.info("FOMO", `Big win: ${event.message}`);
    return event;
  }

  if (!isProfitable && pnlAbs >= thresholds.bigLossPnLETH) {
    const event: FomoEvent = {
      id: `${Date.now()}-${trader.slice(0, 8)}`,
      type: FomoEventType.BIG_LOSS,
      trader,
      token,
      tokenSymbol,
      isLong,
      size,
      price,
      pnl,
      timestamp: Date.now(),
      message: generateLossMessage(trader, tokenSymbol, pnl),
    };

    addFomoEvent(event);
    logger.info("FOMO", `Big loss: ${event.message}`);
    return event;
  }

  return null;
}

/**
 * 记录爆仓事件
 */
export function recordLiquidation(
  trader: Address,
  token: Address,
  tokenSymbol: string,
  isLong: boolean,
  size: bigint,
  price: bigint,
  pnl: bigint
): FomoEvent {
  const event: FomoEvent = {
    id: `${Date.now()}-${trader.slice(0, 8)}`,
    type: FomoEventType.LIQUIDATION,
    trader,
    token,
    tokenSymbol,
    isLong,
    size,
    price,
    pnl,
    timestamp: Date.now(),
    message: generateLiquidationMessage(trader, tokenSymbol, isLong, size),
  };

  addFomoEvent(event);
  updateLeaderboardPnL(trader, token, pnl, false);

  logger.info("FOMO", `Liquidation: ${event.message}`);

  return event;
}

/**
 * 记录代币变热门事件
 */
export function recordHotToken(
  token: Address,
  tokenSymbol: string,
  volume1h: bigint
): FomoEvent {
  const event: FomoEvent = {
    id: `${Date.now()}-hot-${token.slice(0, 8)}`,
    type: FomoEventType.HOT_TOKEN,
    trader: "0x0" as Address,
    token,
    tokenSymbol,
    isLong: true,
    size: volume1h,
    price: 0n,
    timestamp: Date.now(),
    message: `${tokenSymbol} is now HOT! Volume: ${formatETH(volume1h)} ETH`,
  };

  addFomoEvent(event);
  logger.info("FOMO", `Hot token: ${event.message}`);

  return event;
}

// ============================================================
// 排行榜函数
// ============================================================

/**
 * 更新排行榜交易量
 */
function updateLeaderboardVolume(trader: Address, token: Address, volume: bigint): void {
  // 全局排行榜
  const globalEntry = getOrCreateLeaderboardEntry(trader, globalLeaderboard);
  globalEntry.totalVolume += volume;
  globalEntry.tradeCount++;
  globalEntry.lastUpdated = Date.now();

  // 代币排行榜
  if (!tokenLeaderboards.has(token)) {
    tokenLeaderboards.set(token, new Map());
  }
  const tokenBoard = tokenLeaderboards.get(token)!;
  const tokenEntry = getOrCreateLeaderboardEntry(trader, tokenBoard);
  tokenEntry.totalVolume += volume;
  tokenEntry.tradeCount++;
  tokenEntry.lastUpdated = Date.now();
}

/**
 * 更新排行榜盈亏
 */
function updateLeaderboardPnL(
  trader: Address,
  token: Address,
  pnl: bigint,
  isWin: boolean
): void {
  // 全局排行榜
  const globalEntry = getOrCreateLeaderboardEntry(trader, globalLeaderboard);
  globalEntry.totalPnL += pnl;
  if (isWin) {
    if (pnl > globalEntry.biggestWin) {
      globalEntry.biggestWin = pnl;
    }
  } else {
    const loss = pnl < 0n ? -pnl : 0n;
    if (loss > globalEntry.biggestLoss) {
      globalEntry.biggestLoss = loss;
    }
  }
  // 更新胜率
  const wins = isWin ? 1 : 0;
  const totalTrades = globalEntry.tradeCount || 1;
  globalEntry.winRate = Math.round((globalEntry.winRate * (totalTrades - 1) + wins * 100) / totalTrades);
  globalEntry.lastUpdated = Date.now();

  // 代币排行榜
  if (!tokenLeaderboards.has(token)) {
    tokenLeaderboards.set(token, new Map());
  }
  const tokenBoard = tokenLeaderboards.get(token)!;
  const tokenEntry = getOrCreateLeaderboardEntry(trader, tokenBoard);
  tokenEntry.totalPnL += pnl;
  if (isWin) {
    if (pnl > tokenEntry.biggestWin) {
      tokenEntry.biggestWin = pnl;
    }
  } else {
    const loss = pnl < 0n ? -pnl : 0n;
    if (loss > tokenEntry.biggestLoss) {
      tokenEntry.biggestLoss = loss;
    }
  }
  tokenEntry.lastUpdated = Date.now();
}

function getOrCreateLeaderboardEntry(
  trader: Address,
  board: Map<Address, LeaderboardEntry>
): LeaderboardEntry {
  if (!board.has(trader)) {
    board.set(trader, {
      trader,
      displayName: shortenAddress(trader),
      totalPnL: 0n,
      totalVolume: 0n,
      tradeCount: 0,
      winRate: 0,
      biggestWin: 0n,
      biggestLoss: 0n,
      lastUpdated: Date.now(),
    });
  }
  return board.get(trader)!;
}

// ============================================================
// 查询函数
// ============================================================

/**
 * 获取最近FOMO事件
 */
export function getRecentFomoEvents(limit = 20): FomoEvent[] {
  return fomoEvents.slice(0, limit);
}

/**
 * 获取全局排行榜
 */
export function getGlobalLeaderboard(
  sortBy: "pnl" | "volume" | "wins" = "pnl",
  limit = 10
): LeaderboardEntry[] {
  const entries = Array.from(globalLeaderboard.values());

  switch (sortBy) {
    case "pnl":
      entries.sort((a, b) => Number(b.totalPnL - a.totalPnL));
      break;
    case "volume":
      entries.sort((a, b) => Number(b.totalVolume - a.totalVolume));
      break;
    case "wins":
      entries.sort((a, b) => b.winRate - a.winRate);
      break;
  }

  return entries.slice(0, limit);
}

/**
 * 获取代币排行榜
 */
export function getTokenLeaderboard(
  token: Address,
  sortBy: "pnl" | "volume" | "wins" = "pnl",
  limit = 10
): LeaderboardEntry[] {
  const board = tokenLeaderboards.get(token);
  if (!board) return [];

  const entries = Array.from(board.values());

  switch (sortBy) {
    case "pnl":
      entries.sort((a, b) => Number(b.totalPnL - a.totalPnL));
      break;
    case "volume":
      entries.sort((a, b) => Number(b.totalVolume - a.totalVolume));
      break;
    case "wins":
      entries.sort((a, b) => b.winRate - a.winRate);
      break;
  }

  return entries.slice(0, limit);
}

/**
 * 获取交易者统计
 */
export function getTraderStats(trader: Address): LeaderboardEntry | null {
  return globalLeaderboard.get(trader) || null;
}

// ============================================================
// 辅助函数
// ============================================================

function addFomoEvent(event: FomoEvent): void {
  fomoEvents.unshift(event);
  if (fomoEvents.length > MAX_FOMO_EVENTS) {
    fomoEvents.pop();
  }

  // 触发回调（用于WebSocket广播）
  if (onFomoEvent) {
    onFomoEvent(event);
  }
}

function shortenAddress(address: Address): string {
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

function formatETH(wei: bigint): string {
  const eth = Number(wei) / 1e18;
  if (eth >= 1000) {
    return `${(eth / 1000).toFixed(1)}k`;
  }
  if (eth >= 1) {
    return eth.toFixed(2);
  }
  return eth.toFixed(4);
}

function generateOpenMessage(
  trader: Address,
  symbol: string,
  isLong: boolean,
  size: bigint,
  leverage: bigint
): string {
  const side = isLong ? "LONG" : "SHORT";
  const levNum = Number(leverage) / 10000;
  return `${shortenAddress(trader)} opened ${formatETH(size)} ETH ${side} on ${symbol} @ ${levNum}x`;
}

function generateWinMessage(trader: Address, symbol: string, pnl: bigint): string {
  return `${shortenAddress(trader)} made +${formatETH(pnl)} ETH profit on ${symbol}!`;
}

function generateLossMessage(trader: Address, symbol: string, pnl: bigint): string {
  const loss = pnl < 0n ? -pnl : pnl;
  return `${shortenAddress(trader)} lost -${formatETH(loss)} ETH on ${symbol}`;
}

function generateLiquidationMessage(
  trader: Address,
  symbol: string,
  isLong: boolean,
  size: bigint
): string {
  const side = isLong ? "LONG" : "SHORT";
  return `${shortenAddress(trader)}'s ${side} position on ${symbol} (${formatETH(size)} ETH) was liquidated!`;
}

// ============================================================
// 导出
// ============================================================

export {
  DEFAULT_THRESHOLDS,
};
