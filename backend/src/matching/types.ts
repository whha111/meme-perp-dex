/**
 * 类型定义 - 统一接口 (ETH 本位)
 *
 * ETH 本位精度约定:
 * - 价格 (ETH/Token): 1e18
 * - Token 数量: 1e18
 * - 保证金/PnL/手续费 (ETH): 1e18
 * - 杠杆倍数: 1e4 (10x = 100000)
 * - 费率/比率: 1e4 (100% = 10000)
 */

import type { Address, Hex } from "viem";

// ============================================================
// 订单类型
// ============================================================

export enum OrderType {
  MARKET = 0,
  LIMIT = 1,
  STOP_LOSS = 2,
  TAKE_PROFIT = 3,
  TRAILING_STOP = 4,
}

// 保证金模式 (与合约 IPositionManager.MarginMode 对应)
export enum MarginMode {
  ISOLATED = 0,  // 逐仓模式 - 每个仓位独立保证金
  CROSS = 1,     // 全仓模式 - 所有仓位共享保证金
}

export enum OrderStatus {
  PENDING = 0,
  PARTIALLY_FILLED = 1,
  FILLED = 2,
  CANCELLED = 3,
  EXPIRED = 4,
  REJECTED = 5,
  TRIGGERED = 6,
}

export enum TimeInForce {
  GTC = "GTC",     // Good Till Cancel
  IOC = "IOC",     // Immediate Or Cancel
  FOK = "FOK",     // Fill Or Kill
  GTD = "GTD",     // Good Till Date
}

export enum OrderSource {
  API = "API",
  WEB = "WEB",
  APP = "APP",
}

export interface Order {
  // 基本标识
  id: string;
  orderId: string;              // 链上订单ID
  clientOrderId?: string;       // 用户自定义ID
  trader: Address;
  token: Address;

  // 订单参数 (ETH 本位)
  isLong: boolean;
  size: bigint;                 // Token 数量 (1e18 精度)
  price: bigint;                // ETH/Token (1e18 精度), 0=市价单
  leverage: bigint;             // 杠杆倍数 (1e4 精度, 10x = 100000)
  margin: bigint;               // 保证金 ETH (1e18 精度)
  fee: bigint;                  // 手续费 ETH (1e18 精度)

  // 订单类型
  orderType: OrderType;
  timeInForce: TimeInForce;
  reduceOnly: boolean;
  postOnly: boolean;

  // 成交信息
  filledSize: bigint;           // 已成交数量
  avgFillPrice: bigint;         // 平均成交价
  totalFillValue: bigint;       // 累计成交金额

  // 止盈止损
  takeProfitPrice?: bigint;
  stopLossPrice?: bigint;
  triggerPrice?: bigint;

  // 状态
  status: OrderStatus;
  source: OrderSource;

  // 签名
  signature: Hex;
  deadline: bigint;
  nonce: bigint;

  // 时间戳
  createdAt: number;
  updatedAt: number;
  lastFillTime?: number;
}

// ============================================================
// 仓位类型
// ============================================================

export enum PositionStatus {
  OPEN = 0,
  CLOSED = 1,
  LIQUIDATED = 2,
}

export type RiskLevel = "low" | "medium" | "high" | "critical";

export interface Position {
  // 基本标识
  id: string;
  pairId: string;               // 链上配对ID
  trader: Address;
  token: Address;
  counterparty: Address;

  // 仓位参数 (ETH 本位)
  isLong: boolean;
  size: bigint;                 // Token 数量 (1e18 精度)
  entryPrice: bigint;           // ETH/Token (1e18 精度)
  averageEntryPrice: bigint;    // 加仓后平均价 (1e18 精度)
  leverage: bigint;             // 杠杆倍数 (1e4 精度)
  marginMode: MarginMode;       // 保证金模式 (逐仓/全仓)

  // 价格信息 (ETH 本位)
  markPrice: bigint;            // 标记价格 ETH/Token (1e18)
  liquidationPrice: bigint;     // 强平价格 (1e18)
  bankruptcyPrice: bigint;      // 穿仓价格 (1e18)
  breakEvenPrice: bigint;       // 盈亏平衡价 (1e18)

  // 保证金信息 (ETH 本位)
  collateral: bigint;           // 初始保证金 ETH (1e18)
  margin: bigint;               // 当前保证金 = 初始 + UPNL (ETH 1e18)
  marginRatio: bigint;          // 保证金率 (基点, 10000 = 100%)
  mmr: bigint;                  // 维持保证金率 (基点)
  maintenanceMargin: bigint;    // 维持保证金金额 ETH (1e18)

  // 盈亏信息 (ETH 本位)
  unrealizedPnL: bigint;        // 未实现盈亏 ETH (1e18)
  realizedPnL: bigint;          // 已实现盈亏 ETH (1e18)
  roe: bigint;                  // 收益率 (基点)
  accumulatedFunding: bigint;   // 累计资金费 ETH (1e18)

  // 止盈止损
  takeProfitPrice: bigint | null;
  stopLossPrice: bigint | null;

  // 风险指标
  adlRanking: number;           // ADL排名 1-5
  adlScore: bigint;             // ADL评分
  riskLevel: RiskLevel;
  isLiquidatable: boolean;
  isAdlCandidate: boolean;

  // 状态
  status: PositionStatus;
  fundingIndex: bigint;         // 开仓时的资金费索引
  isLiquidating: boolean;

  // 时间戳
  createdAt: number;
  updatedAt: number;
}

// ============================================================
// 用户余额
// ============================================================

export interface UserBalance {
  trader: Address;
  walletBalance: bigint;        // 派生钱包 ETH 余额 (1e18)
  frozenMargin: bigint;         // 挂单冻结 ETH (1e18)
  usedMargin: bigint;           // 仓位占用 ETH (1e18)
  unrealizedPnL: bigint;        // 未实现盈亏 ETH (1e18)
  availableBalance: bigint;     // 可用 ETH = wallet - frozen - used (1e18)
  equity: bigint;               // 权益 ETH = available + used + upnl (1e18)
  lastSyncBlock: bigint;
  lastSyncTime: number;
}

// ============================================================
// 交易授权 (Session Key)
// ============================================================

export interface TradingSession {
  trader: Address;
  sessionId: string;
  sessionKey: Address;
  encryptedSigningKey: string;
  expiresAt: number;
  deviceId: string;
  ipAddress: string;
  failedAttempts: number;
  permissions: SessionPermissions;
  limits: SessionLimits;
}

export interface SessionPermissions {
  canDeposit: boolean;
  canTrade: boolean;
  canWithdraw: boolean;
}

export interface SessionLimits {
  maxSingleAmount: bigint;      // 单次最大金额
  dailyLimit: bigint;           // 每日限额
  dailyUsed: bigint;            // 当日已用
}

// ============================================================
// 撮合结果
// ============================================================

export interface Match {
  id: string;
  longOrder: Order;
  shortOrder: Order;
  matchPrice: bigint;
  matchSize: bigint;
  timestamp: number;
}

export interface Trade {
  id: string;
  token: Address;
  price: bigint;
  size: bigint;
  side: "buy" | "sell";
  timestamp: number;
  longTrader: Address;
  shortTrader: Address;
  longOrderId: string;
  shortOrderId: string;
}

// 用户交易记录 (包含强平、ADL等类型)
export type TradeType = "normal" | "liquidation" | "adl" | "close";

export interface TradeRecord {
  id: string;
  orderId: string;
  pairId: string;
  token: string;
  trader: string;
  isLong: boolean;
  isMaker: boolean;
  size: string;                // bigint as string
  price: string;               // bigint as string
  fee: string;                 // bigint as string
  realizedPnL: string;         // bigint as string
  timestamp: number;
  type: TradeType;
}

// ============================================================
// 订单簿
// ============================================================

export interface OrderBookLevel {
  price: bigint;
  totalSize: bigint;
  orderCount: number;
}

export interface OrderBookSnapshot {
  token: Address;
  bids: OrderBookLevel[];       // 买单 (多头)
  asks: OrderBookLevel[];       // 卖单 (空头)
  lastPrice: bigint;
  timestamp: number;
}

// ============================================================
// 资金费
// ============================================================

export interface FundingRate {
  token: Address;
  rate: bigint;                 // 费率 (基点)
  markPrice: bigint;
  indexPrice: bigint;
  nextSettlementTime: number;
  timestamp: number;
}

export interface FundingPayment {
  id: string;
  trader: Address;
  token: Address;
  positionId: string;
  isLong: boolean;
  positionSize: bigint;
  fundingRate: bigint;
  fundingAmount: bigint;        // 正=付款, 负=收款
  timestamp: number;
}

// ============================================================
// 保险基金
// ============================================================

export interface InsuranceFund {
  token: Address | null;        // null=全局基金
  balance: bigint;
  totalContributions: bigint;
  totalPayouts: bigint;
  lastUpdated: number;
}

// ============================================================
// 市场统计
// ============================================================

export interface MarketStats {
  token: Address;
  symbol: string;
  lastPrice: bigint;
  markPrice: bigint;
  indexPrice: bigint;
  high24h: bigint;
  low24h: bigint;
  volume24h: bigint;
  openInterestLong: bigint;
  openInterestShort: bigint;
  fundingRate: bigint;
  nextFundingTime: number;
  updatedAt: number;
}

// ============================================================
// K线数据
// ============================================================

export interface Kline {
  token: Address;
  interval: string;             // "1m", "5m", "1h", etc.
  timestamp: number;
  open: bigint;
  high: bigint;
  low: bigint;
  close: bigint;
  volume: bigint;
  trades: number;
}

// ============================================================
// 结算日志
// ============================================================

export enum SettlementType {
  DEPOSIT = "DEPOSIT",
  WITHDRAW = "WITHDRAW",
  SETTLE_PNL = "SETTLE_PNL",
  FUNDING_FEE = "FUNDING_FEE",
  LIQUIDATION = "LIQUIDATION",
  MARGIN_ADD = "MARGIN_ADD",
  MARGIN_REMOVE = "MARGIN_REMOVE",
  DAILY_SETTLEMENT = "DAILY_SETTLEMENT",
  INSURANCE_INJECTION = "INSURANCE_INJECTION",
}

export enum OnChainStatus {
  PENDING = "PENDING",
  SUBMITTED = "SUBMITTED",
  SUCCESS = "SUCCESS",
  FAILED = "FAILED",
}

export interface SettlementLog {
  id: string;
  txHash: Hex | null;
  userAddress: Address;
  type: SettlementType;
  amount: bigint;
  balanceBefore: bigint;
  balanceAfter: bigint;
  onChainStatus: OnChainStatus;
  proofData: string;            // JSON
  positionId?: string;
  orderId?: string;
  createdAt: number;
}

// ============================================================
// WebSocket 消息类型
// ============================================================

export type WSMessageType =
  | "orderbook"
  | "trade"
  | "order"
  | "position"
  | "balance"
  | "liquidation"
  | "funding"
  | "risk"
  | "adl_triggered"
  | "liquidation_warning"
  | "margin_warning"
  | "kline";

export interface WSMessage<T = unknown> {
  type: WSMessageType;
  data: T;
  timestamp: number;
}

// ============================================================
// API 响应
// ============================================================

export interface APIResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
  code?: number;
}

// ============================================================
// 风险数据
// ============================================================

export interface RiskData {
  trader: Address;
  positions: Position[];
  totalMargin: bigint;
  totalUnrealizedPnL: bigint;
  totalEquity: bigint;
  accountMarginRatio: bigint;
  riskLevel: RiskLevel;
}

export interface LiquidationCandidate {
  position: Position;
  marginRatio: number;
  urgency: number;
}

// ============================================================
// ADL 队列
// ============================================================

export interface ADLQueue {
  token: Address;
  longQueue: Position[];        // 多头盈利队列 (按 adlScore 降序)
  shortQueue: Position[];       // 空头盈利队列 (按 adlScore 降序)
}

// ============================================================
// 代币生命周期
// ============================================================

export enum TokenState {
  DORMANT = "DORMANT",       // 冷淡期 - 极低活跃度
  ACTIVE = "ACTIVE",         // 活跃期 - 正常交易
  HOT = "HOT",               // 热门期 - 高交易量
  DEAD = "DEAD",             // 死亡期 - 已放弃/无流动性
  GRADUATED = "GRADUATED",   // 已毕业 - 上外盘
}

export interface TokenLifecycleInfo {
  token: Address;
  state: TokenState;
  volume24h: bigint;
  volume1h: bigint;
  tradeCount24h: number;
  tradeCount1h: number;
  openInterestLong: bigint;
  openInterestShort: bigint;
  positionCount: number;
  currentPrice: bigint;
  lastTradeTime: number;
  createdAt: number;
  stateChangedAt: number;
}

// ============================================================
// 清算热力图类型
// ============================================================

export interface HeatmapCell {
  priceLevel: number;          // Y轴价格档位索引
  timeSlot: number;            // X轴时间槽索引
  longLiquidationSize: bigint; // 多头清算金额 (ETH 1e18)
  shortLiquidationSize: bigint;// 空头清算金额 (ETH 1e18)
  longAccountCount: number;    // 多头账户数
  shortAccountCount: number;   // 空头账户数
  intensity: number;           // 热度强度 0-100
}

export interface LiquidationHeatmapResponse {
  token: Address;
  currentPrice: string;        // 当前价格 ETH/Token (1e18 精度)
  priceMin: string;            // Y轴最小价格 (1e18)
  priceMax: string;            // Y轴最大价格 (1e18)
  priceStep: string;           // 价格步长 (1e18)
  priceLevels: number;         // 价格档位数量
  timeStart: number;           // X轴起始时间戳 (ms)
  timeEnd: number;             // X轴结束时间戳 (ms)
  timeSlots: number;           // 时间槽数量
  resolution: string;          // 时间分辨率 (1h, 4h, etc.)
  heatmap: HeatmapCell[];      // 热力图数据 (扁平化)
  longTotal: string;           // 多头总清算量 (ETH 1e18)
  shortTotal: string;          // 空头总清算量 (ETH 1e18)
  longAccountTotal: number;    // 多头总账户数
  shortAccountTotal: number;   // 空头总账户数
  timestamp: number;           // 生成时间
}
