/**
 * 代币生命周期管理模块
 *
 * Meme币特性：
 * - 大多数活不过8小时
 * - 每天有成百上千个新币发行
 * - 需要根据热度动态调整参数
 */

import type { Address } from "viem";
import { logger } from "../utils/logger";

// ============================================================
// 代币状态枚举
// ============================================================

export enum TokenState {
  DORMANT = "DORMANT",       // 冷淡期 - 极低活跃度
  ACTIVE = "ACTIVE",         // 活跃期 - 正常交易
  HOT = "HOT",               // 热门期 - 高交易量
  DEAD = "DEAD",             // 死亡期 - 已放弃/无流动性
  GRADUATED = "GRADUATED",   // 已毕业 - 上外盘
}

// ============================================================
// 代币生命周期信息
// ============================================================

export interface TokenLifecycleInfo {
  token: Address;
  state: TokenState;

  // 活跃度指标
  volume24h: bigint;           // 24小时交易量
  volume1h: bigint;            // 1小时交易量
  tradeCount24h: number;       // 24小时交易次数
  tradeCount1h: number;        // 1小时交易次数

  // 未平仓合约
  openInterestLong: bigint;    // 多头未平仓
  openInterestShort: bigint;   // 空头未平仓
  positionCount: number;       // 仓位数量

  // 价格信息
  currentPrice: bigint;
  priceChange24h: bigint;      // 24小时价格变化（基点）
  lastTradeTime: number;

  // 流动性
  bondingCurveReserveETH: bigint;
  bondingCurveReserveToken: bigint;

  // 时间戳
  createdAt: number;
  stateChangedAt: number;
  lastActivityTime: number;
}

// ============================================================
// 状态阈值配置
// ============================================================

interface StateThresholds {
  // DORMANT -> ACTIVE 阈值
  dormantToActiveVolume: bigint;      // 1小时交易量
  dormantToActiveTrades: number;       // 1小时交易次数

  // ACTIVE -> HOT 阈值
  activeToHotVolume: bigint;          // 1小时交易量
  activeToHotTrades: number;           // 1小时交易次数

  // -> DEAD 阈值
  deadInactivityMinutes: number;       // 无活动分钟数
  deadVolumeThreshold: bigint;         // 低于此交易量视为死亡

  // HOT -> ACTIVE 冷却阈值
  hotCooldownVolume: bigint;          // 低于此恢复为ACTIVE
}

const DEFAULT_THRESHOLDS: StateThresholds = {
  // 从冷淡到活跃
  dormantToActiveVolume: BigInt(1e17),      // 0.1 ETH
  dormantToActiveTrades: 3,

  // 从活跃到热门
  activeToHotVolume: BigInt(1e18),          // 1 ETH
  activeToHotTrades: 20,

  // 死亡判定
  deadInactivityMinutes: 120,                // 2小时无活动
  deadVolumeThreshold: BigInt(1e15),         // 0.001 ETH

  // 热门冷却
  hotCooldownVolume: BigInt(5e17),           // 0.5 ETH
};

// ============================================================
// 状态对应的参数
// ============================================================

export interface StateParameters {
  maxLeverage: bigint;           // 最大杠杆 (1e4精度)
  minMargin: bigint;             // 最小保证金
  makerFee: bigint;              // maker手续费 (基点)
  takerFee: bigint;              // taker手续费 (基点)
  maxPositionSize: bigint;       // 最大仓位
  tradingEnabled: boolean;       // 是否允许交易
}

const STATE_PARAMETERS: Record<TokenState, StateParameters> = {
  [TokenState.DORMANT]: {
    maxLeverage: 50000n,         // 5x
    minMargin: BigInt(1e16),     // 0.01 ETH
    makerFee: 5n,                // 0.05%
    takerFee: 10n,               // 0.1%
    maxPositionSize: BigInt(1e19), // 10 ETH
    tradingEnabled: true,
  },
  [TokenState.ACTIVE]: {
    maxLeverage: 100000n,        // 10x
    minMargin: BigInt(1e15),     // 0.001 ETH
    makerFee: 3n,                // 0.03%
    takerFee: 8n,                // 0.08%
    maxPositionSize: BigInt(1e20), // 100 ETH
    tradingEnabled: true,
  },
  [TokenState.HOT]: {
    maxLeverage: 200000n,        // 20x
    minMargin: BigInt(1e14),     // 0.0001 ETH
    makerFee: 2n,                // 0.02%
    takerFee: 5n,                // 0.05%
    maxPositionSize: BigInt(1e21), // 1000 ETH (无限制)
    tradingEnabled: true,
  },
  [TokenState.DEAD]: {
    maxLeverage: 0n,
    minMargin: 0n,
    makerFee: 0n,
    takerFee: 0n,
    maxPositionSize: 0n,
    tradingEnabled: false,        // 禁止新开仓
  },
  [TokenState.GRADUATED]: {
    maxLeverage: 0n,
    minMargin: 0n,
    makerFee: 0n,
    takerFee: 0n,
    maxPositionSize: 0n,
    tradingEnabled: false,        // 已毕业，不在内盘交易
  },
};

// ============================================================
// 存储
// ============================================================

// 代币生命周期数据
const tokenLifecycles = new Map<Address, TokenLifecycleInfo>();

// 1小时交易记录（用于计算volume1h）
const hourlyTrades = new Map<Address, { timestamp: number; volume: bigint }[]>();

// ============================================================
// 核心函数
// ============================================================

/**
 * 初始化代币生命周期
 */
export function initializeTokenLifecycle(
  token: Address,
  initialPrice: bigint,
  bondingCurveReserveETH: bigint = 0n,
  bondingCurveReserveToken: bigint = 0n
): TokenLifecycleInfo {
  const now = Date.now();

  const info: TokenLifecycleInfo = {
    token,
    state: TokenState.DORMANT,
    volume24h: 0n,
    volume1h: 0n,
    tradeCount24h: 0,
    tradeCount1h: 0,
    openInterestLong: 0n,
    openInterestShort: 0n,
    positionCount: 0,
    currentPrice: initialPrice,
    priceChange24h: 0n,
    lastTradeTime: 0,
    bondingCurveReserveETH,
    bondingCurveReserveToken,
    createdAt: now,
    stateChangedAt: now,
    lastActivityTime: now,
  };

  tokenLifecycles.set(token, info);
  hourlyTrades.set(token, []);

  logger.info("Lifecycle", `Initialized token ${token} with state DORMANT`);

  return info;
}

/**
 * 获取代币生命周期信息
 */
export function getTokenLifecycle(token: Address): TokenLifecycleInfo | null {
  return tokenLifecycles.get(token) || null;
}

/**
 * 获取代币状态
 */
export function getTokenState(token: Address): TokenState {
  const info = tokenLifecycles.get(token);
  return info?.state || TokenState.DORMANT;
}

/**
 * 获取代币参数
 */
export function getTokenParameters(token: Address): StateParameters {
  const state = getTokenState(token);
  return STATE_PARAMETERS[state];
}

/**
 * 记录交易并更新指标
 */
export function recordTrade(
  token: Address,
  volume: bigint,
  price: bigint
): void {
  const info = tokenLifecycles.get(token);
  if (!info) {
    logger.warn("Lifecycle", `Token ${token} not initialized`);
    return;
  }

  const now = Date.now();

  // 更新交易记录
  const trades = hourlyTrades.get(token) || [];
  trades.push({ timestamp: now, volume });

  // 清理超过24小时的记录
  const cutoff24h = now - 24 * 60 * 60 * 1000;
  const cutoff1h = now - 60 * 60 * 1000;
  const filtered = trades.filter(t => t.timestamp > cutoff24h);
  hourlyTrades.set(token, filtered);

  // 计算新的统计
  let volume24h = 0n;
  let volume1h = 0n;
  let tradeCount24h = 0;
  let tradeCount1h = 0;

  for (const trade of filtered) {
    volume24h += trade.volume;
    tradeCount24h++;
    if (trade.timestamp > cutoff1h) {
      volume1h += trade.volume;
      tradeCount1h++;
    }
  }

  // 更新信息
  info.volume24h = volume24h;
  info.volume1h = volume1h;
  info.tradeCount24h = tradeCount24h;
  info.tradeCount1h = tradeCount1h;
  info.currentPrice = price;
  info.lastTradeTime = now;
  info.lastActivityTime = now;

  // 检查状态转换
  updateTokenState(token);
}

/**
 * 更新未平仓合约
 */
export function updateOpenInterest(
  token: Address,
  longDelta: bigint,
  shortDelta: bigint,
  positionCountDelta: number
): void {
  const info = tokenLifecycles.get(token);
  if (!info) return;

  info.openInterestLong += longDelta;
  info.openInterestShort += shortDelta;
  info.positionCount += positionCountDelta;

  // 确保不为负
  if (info.openInterestLong < 0n) info.openInterestLong = 0n;
  if (info.openInterestShort < 0n) info.openInterestShort = 0n;
  if (info.positionCount < 0) info.positionCount = 0;

  info.lastActivityTime = Date.now();
}

/**
 * 更新Bonding Curve储备
 */
export function updateBondingCurveReserves(
  token: Address,
  reserveETH: bigint,
  reserveToken: bigint
): void {
  const info = tokenLifecycles.get(token);
  if (!info) return;

  info.bondingCurveReserveETH = reserveETH;
  info.bondingCurveReserveToken = reserveToken;
}

/**
 * 标记代币已毕业
 */
export function markTokenGraduated(token: Address): void {
  const info = tokenLifecycles.get(token);
  if (!info) return;

  const oldState = info.state;
  info.state = TokenState.GRADUATED;
  info.stateChangedAt = Date.now();

  logger.info("Lifecycle", `Token ${token} graduated: ${oldState} -> GRADUATED`);
}

/**
 * 强制设置代币状态（管理员操作）
 */
export function forceSetTokenState(token: Address, state: TokenState): void {
  const info = tokenLifecycles.get(token);
  if (!info) return;

  const oldState = info.state;
  info.state = state;
  info.stateChangedAt = Date.now();

  logger.info("Lifecycle", `Token ${token} state forced: ${oldState} -> ${state}`);
}

// ============================================================
// 状态转换逻辑
// ============================================================

/**
 * 检查并更新代币状态
 */
function updateTokenState(token: Address): void {
  const info = tokenLifecycles.get(token);
  if (!info) return;

  const oldState = info.state;
  const thresholds = DEFAULT_THRESHOLDS;
  const now = Date.now();

  // 如果已毕业，不再变化
  if (info.state === TokenState.GRADUATED) return;

  // 检查死亡
  const inactivityMinutes = (now - info.lastActivityTime) / (60 * 1000);
  if (
    inactivityMinutes > thresholds.deadInactivityMinutes &&
    info.volume24h < thresholds.deadVolumeThreshold
  ) {
    info.state = TokenState.DEAD;
    info.stateChangedAt = now;
    if (oldState !== TokenState.DEAD) {
      logger.info("Lifecycle", `Token ${token} died: ${oldState} -> DEAD (inactive ${inactivityMinutes.toFixed(0)}min)`);
    }
    return;
  }

  // 基于活跃度的状态转换
  switch (info.state) {
    case TokenState.DEAD:
      // 复活：有新的活跃度
      if (info.volume1h > thresholds.dormantToActiveVolume) {
        info.state = TokenState.ACTIVE;
        info.stateChangedAt = now;
        logger.info("Lifecycle", `Token ${token} revived: DEAD -> ACTIVE`);
      } else if (info.volume1h > 0n) {
        info.state = TokenState.DORMANT;
        info.stateChangedAt = now;
        logger.info("Lifecycle", `Token ${token} revived: DEAD -> DORMANT`);
      }
      break;

    case TokenState.DORMANT:
      // 升级到活跃
      if (
        info.volume1h >= thresholds.dormantToActiveVolume &&
        info.tradeCount1h >= thresholds.dormantToActiveTrades
      ) {
        info.state = TokenState.ACTIVE;
        info.stateChangedAt = now;
        logger.info("Lifecycle", `Token ${token}: DORMANT -> ACTIVE`);
      }
      break;

    case TokenState.ACTIVE:
      // 升级到热门
      if (
        info.volume1h >= thresholds.activeToHotVolume &&
        info.tradeCount1h >= thresholds.activeToHotTrades
      ) {
        info.state = TokenState.HOT;
        info.stateChangedAt = now;
        logger.info("Lifecycle", `Token ${token}: ACTIVE -> HOT`);
      }
      // 降级到冷淡
      else if (info.volume1h < thresholds.dormantToActiveVolume) {
        info.state = TokenState.DORMANT;
        info.stateChangedAt = now;
        logger.info("Lifecycle", `Token ${token}: ACTIVE -> DORMANT`);
      }
      break;

    case TokenState.HOT:
      // 冷却到活跃
      if (info.volume1h < thresholds.hotCooldownVolume) {
        info.state = TokenState.ACTIVE;
        info.stateChangedAt = now;
        logger.info("Lifecycle", `Token ${token}: HOT -> ACTIVE (cooldown)`);
      }
      break;
  }
}

// ============================================================
// 定时检查
// ============================================================

let checkInterval: ReturnType<typeof setInterval> | null = null;

/**
 * 启动定时状态检查
 */
export function startLifecycleChecker(intervalMs: number = 60000): void {
  if (checkInterval) return;

  checkInterval = setInterval(() => {
    const tokens = Array.from(tokenLifecycles.keys());
    for (const token of tokens) {
      updateTokenState(token);
    }
  }, intervalMs);

  logger.info("Lifecycle", `Started lifecycle checker (interval: ${intervalMs}ms)`);
}

/**
 * 停止定时检查
 */
export function stopLifecycleChecker(): void {
  if (checkInterval) {
    clearInterval(checkInterval);
    checkInterval = null;
    logger.info("Lifecycle", "Stopped lifecycle checker");
  }
}

// ============================================================
// 统计查询
// ============================================================

/**
 * 获取所有活跃代币
 */
export function getActiveTokens(): TokenLifecycleInfo[] {
  return Array.from(tokenLifecycles.values()).filter(
    info => info.state === TokenState.ACTIVE || info.state === TokenState.HOT
  );
}

/**
 * 获取热门代币
 */
export function getHotTokens(): TokenLifecycleInfo[] {
  return Array.from(tokenLifecycles.values()).filter(
    info => info.state === TokenState.HOT
  );
}

/**
 * 获取死亡代币
 */
export function getDeadTokens(): TokenLifecycleInfo[] {
  return Array.from(tokenLifecycles.values()).filter(
    info => info.state === TokenState.DEAD
  );
}

/**
 * 获取所有代币列表
 */
export function getAllTokenLifecycles(): TokenLifecycleInfo[] {
  return Array.from(tokenLifecycles.values());
}

/**
 * 获取状态统计
 */
export function getLifecycleStats(): Record<TokenState, number> {
  const stats: Record<TokenState, number> = {
    [TokenState.DORMANT]: 0,
    [TokenState.ACTIVE]: 0,
    [TokenState.HOT]: 0,
    [TokenState.DEAD]: 0,
    [TokenState.GRADUATED]: 0,
  };

  for (const info of tokenLifecycles.values()) {
    stats[info.state]++;
  }

  return stats;
}

// ============================================================
// 导出
// ============================================================

export {
  DEFAULT_THRESHOLDS,
  STATE_PARAMETERS,
};
