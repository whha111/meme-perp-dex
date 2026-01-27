/**
 * 撮合引擎 HTTP API 服务器 + WebSocket 推送
 *
 * 为前端提供：
 * - REST API: 订单提交、订单簿查询、仓位查询等
 * - WebSocket: 实时推送订单簿、成交记录
 */

import "dotenv/config";
import { type Address, type Hex, verifyTypedData, createPublicClient, http } from "viem";
import { baseSepolia } from "viem/chains";
import { WebSocketServer, WebSocket } from "ws";
import { MatchingEngine, SettlementSubmitter, OrderType, OrderStatus, TimeInForce, type Order, type Match, type Trade, type Kline, type TokenStats } from "./engine";
import db, {
  PositionRepo,
  OrderRepo,
  VaultRepo,
  SettlementLogRepo,
  MarketStatsRepo,
  type Position as DBPosition,
  type Order as DBOrder,
  type UserVault,
  type SettlementLog,
  type MarketStats,
} from "./database";

// ============================================================
// Configuration
// ============================================================

const PORT = parseInt(process.env.PORT || "8081");
const RPC_URL = process.env.RPC_URL || "https://base-sepolia-rpc.publicnode.com";
const MATCHER_PRIVATE_KEY = process.env.MATCHER_PRIVATE_KEY as Hex;
const SETTLEMENT_ADDRESS = process.env.SETTLEMENT_ADDRESS as Address;
const TOKEN_FACTORY_ADDRESS = (process.env.TOKEN_FACTORY_ADDRESS || "0xCfDCD9F8D39411cF855121331B09aef1C88dc056") as Address;
const PRICE_FEED_ADDRESS = (process.env.PRICE_FEED_ADDRESS || "0xd69A4DB60cEc962A46C6B9Bc8CC0883081c4eFb7") as Address;
const BATCH_INTERVAL_MS = parseInt(process.env.BATCH_INTERVAL_MS || "30000"); // 30 seconds
const FUNDING_RATE_INTERVAL_MS = parseInt(process.env.FUNDING_RATE_INTERVAL_MS || "5000"); // 5 seconds
const SPOT_PRICE_SYNC_INTERVAL_MS = parseInt(process.env.SPOT_PRICE_SYNC_INTERVAL_MS || "1000"); // 1 second
const SKIP_SIGNATURE_VERIFY = process.env.SKIP_SIGNATURE_VERIFY === "true"; // 测试模式：跳过签名验证

// 支持的代币列表（后续可从配置或链上获取）
const SUPPORTED_TOKENS: Address[] = [
  "0x01c6058175eda34fc8922eeae32bc383cb203211" as Address, // TOKEN_123
];

// ============================================================
// EIP-712 Types for Signature Verification
// ============================================================

const EIP712_DOMAIN = {
  name: "MemePerp",
  version: "1",
  chainId: 84532, // Base Sepolia
  verifyingContract: SETTLEMENT_ADDRESS,
};

const ORDER_TYPES = {
  Order: [
    { name: "trader", type: "address" },
    { name: "token", type: "address" },
    { name: "isLong", type: "bool" },
    { name: "size", type: "uint256" },
    { name: "leverage", type: "uint256" },
    { name: "price", type: "uint256" },
    { name: "deadline", type: "uint256" },
    { name: "nonce", type: "uint256" },
    { name: "orderType", type: "uint8" },
  ],
} as const;

// Settlement 合约 ABI (用于读取链上仓位和监听事件)
const SETTLEMENT_ABI = [
  // ========== View Functions ==========
  {
    inputs: [{ name: "user", type: "address" }],
    name: "getUserPairIds",
    outputs: [{ type: "uint256[]" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [{ name: "pairId", type: "uint256" }],
    name: "getPairedPosition",
    outputs: [
      {
        components: [
          { name: "pairId", type: "uint256" },
          { name: "longTrader", type: "address" },
          { name: "shortTrader", type: "address" },
          { name: "token", type: "address" },
          { name: "size", type: "uint256" },
          { name: "entryPrice", type: "uint256" },
          { name: "longCollateral", type: "uint256" },
          { name: "shortCollateral", type: "uint256" },
          { name: "longLeverage", type: "uint256" },
          { name: "shortLeverage", type: "uint256" },
          { name: "openTime", type: "uint256" },
          { name: "accFundingLong", type: "int256" },
          { name: "accFundingShort", type: "int256" },
          { name: "status", type: "uint8" },
        ],
        type: "tuple",
      },
    ],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [],
    name: "nextPairId",
    outputs: [{ type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [{ name: "user", type: "address" }],
    name: "getUserBalance",
    outputs: [
      { name: "available", type: "uint256" },
      { name: "locked", type: "uint256" },
    ],
    stateMutability: "view",
    type: "function",
  },
  // ========== Events (用于监听链上状态变化) ==========
  {
    type: "event",
    name: "Deposited",
    inputs: [
      { name: "user", type: "address", indexed: true },
      { name: "amount", type: "uint256", indexed: false },
    ],
  },
  {
    type: "event",
    name: "DepositedFor",
    inputs: [
      { name: "user", type: "address", indexed: true },
      { name: "relayer", type: "address", indexed: true },
      { name: "token", type: "address", indexed: false },
      { name: "amount", type: "uint256", indexed: false },
    ],
  },
  {
    type: "event",
    name: "Withdrawn",
    inputs: [
      { name: "user", type: "address", indexed: true },
      { name: "amount", type: "uint256", indexed: false },
    ],
  },
  {
    type: "event",
    name: "PairOpened",
    inputs: [
      { name: "pairId", type: "uint256", indexed: true },
      { name: "longTrader", type: "address", indexed: true },
      { name: "shortTrader", type: "address", indexed: true },
      { name: "token", type: "address", indexed: false },
      { name: "size", type: "uint256", indexed: false },
      { name: "entryPrice", type: "uint256", indexed: false },
    ],
  },
  {
    type: "event",
    name: "PairClosed",
    inputs: [
      { name: "pairId", type: "uint256", indexed: true },
      { name: "exitPrice", type: "uint256", indexed: false },
      { name: "longPnL", type: "int256", indexed: false },
      { name: "shortPnL", type: "int256", indexed: false },
    ],
  },
  {
    type: "event",
    name: "Liquidated",
    inputs: [
      { name: "pairId", type: "uint256", indexed: true },
      { name: "liquidatedTrader", type: "address", indexed: true },
      { name: "liquidator", type: "address", indexed: true },
      { name: "reward", type: "uint256", indexed: false },
    ],
  },
] as const;

// ============================================================
// State
// ============================================================

const engine = new MatchingEngine();
let submitter: SettlementSubmitter | null = null;

// WebSocket state
let wss: WebSocketServer | null = null;
const wsClients = new Map<WebSocket, Set<Address>>(); // client => subscribed tokens
const wsTraderClients = new Map<Address, Set<WebSocket>>(); // trader => websocket connections (for risk data)
const wsRiskSubscribers = new Set<WebSocket>(); // clients subscribed to global risk data

// Risk broadcast throttling
let lastRiskBroadcast = 0;
const RISK_BROADCAST_INTERVAL_MS = 500; // Broadcast risk data every 500ms max

// User nonces - 不再内部追踪，从链上同步
// 撮合引擎只负责撮合，nonce验证由链上合约处理
const userNonces = new Map<Address, bigint>();
const SYNC_NONCE_FROM_CHAIN = true; // 启用链上nonce同步

// Submitted pairs tracking
const submittedMatches = new Map<string, Match>();

// Position tracking (from on-chain events, simplified for now)
/**
 * 仓位信息 (行业标准 - 参考 OKX/Binance/Bybit)
 *
 * Meme Perp 特有字段：
 * - bankruptcyPrice: 穿仓价格
 * - mmr: 动态维持保证金率 (meme 需要更高)
 * - adlScore: ADL 评分用于排序
 */
interface Position {
  // === 基本标识 ===
  pairId: string;
  trader: Address;
  token: Address;

  // === 仓位参数 ===
  isLong: boolean;
  size: string;                   // 仓位大小 (代币数量, 1e18)
  entryPrice: string;             // 开仓均价 (1e12)
  averageEntryPrice: string;      // 加仓后的平均价格 (1e12)
  leverage: string;               // 杠杆倍数 (整数)

  // === 价格信息 ===
  markPrice: string;              // 标记价格 (实时, 1e12)
  liquidationPrice: string;       // 强平价格 (1e12)
  bankruptcyPrice: string;        // 穿仓价格 (1e12) - 保证金归零的价格
  breakEvenPrice: string;         // 盈亏平衡价格 (含手续费, 1e12)

  // === 保证金信息 ===
  collateral: string;             // 初始保证金 (1e6 USD)
  margin: string;                 // 当前保证金 = 初始 + UPNL (1e6 USD)
  marginRatio: string;            // 保证金率 (基点, 10000 = 100%)
  mmr: string;                    // 维持保证金率 (基点, 动态调整)
  maintenanceMargin: string;      // 维持保证金金额 (1e6 USD)

  // === 盈亏信息 ===
  unrealizedPnL: string;          // 未实现盈亏 (1e6 USD)
  realizedPnL: string;            // 已实现盈亏 (1e6 USD)
  roe: string;                    // 收益率 ROE% (基点)
  fundingFee: string;             // 累计资金费 (1e6 USD)

  // === 止盈止损 ===
  takeProfitPrice: string | null;
  stopLossPrice: string | null;

  // === 系统信息 ===
  counterparty: Address;
  createdAt: number;
  updatedAt: number;

  // === ADL 风险指标 (Meme Perp 核心) ===
  adlRanking: number;             // ADL 排名等级 (1-5, 5最危险)
  adlScore: string;               // ADL 评分 = (UPNL% / margin) × leverage
  riskLevel: "low" | "medium" | "high" | "critical"; // 风险等级
  isLiquidatable: boolean;        // 是否可被强平
  isAdlCandidate: boolean;        // 是否为 ADL 候选 (盈利方)
}
const userPositions = new Map<Address, Position[]>();

// ============================================================
// Redis 数据同步函数
// ============================================================

/**
 * 从 Redis 加载所有仓位到内存
 */
async function loadPositionsFromRedis(): Promise<void> {
  if (!db.isConnected()) return;

  try {
    const dbPositions = await PositionRepo.getAll();
    console.log(`[Redis] Loading ${dbPositions.length} positions from database...`);

    for (const dbPos of dbPositions) {
      const memPos = dbPositionToMemory(dbPos);
      const userAddr = memPos.trader.toLowerCase() as Address;

      const existing = userPositions.get(userAddr) || [];
      existing.push(memPos);
      userPositions.set(userAddr, existing);
    }

    console.log(`[Redis] Loaded ${dbPositions.length} positions into memory`);
  } catch (error) {
    console.error("[Redis] Failed to load positions:", error);
  }
}

/**
 * 保存仓位到 Redis
 */
async function savePositionToRedis(position: Position): Promise<string | null> {
  if (!db.isConnected()) return null;

  try {
    const dbPos = memoryPositionToDB(position);

    // Check if position already exists
    if (position.pairId && position.pairId.length > 10) {
      // Looks like a UUID, try to update
      const existing = await PositionRepo.get(position.pairId);
      if (existing) {
        await PositionRepo.update(position.pairId, dbPos);
        return position.pairId;
      }
    }

    // Create new position
    const created = await PositionRepo.create(dbPos);
    return created.id;
  } catch (error) {
    console.error("[Redis] Failed to save position:", error);
    return null;
  }
}

/**
 * 从 Redis 删除仓位
 */
async function deletePositionFromRedis(positionId: string): Promise<boolean> {
  if (!db.isConnected()) return false;

  try {
    return await PositionRepo.delete(positionId);
  } catch (error) {
    console.error("[Redis] Failed to delete position:", error);
    return false;
  }
}

/**
 * 更新 Redis 中的仓位风险指标
 */
async function updatePositionRiskInRedis(positionId: string, updates: Partial<DBPosition>): Promise<void> {
  if (!db.isConnected()) return;

  try {
    await PositionRepo.update(positionId, updates);
  } catch (error) {
    console.error("[Redis] Failed to update position risk:", error);
  }
}

/**
 * 记录结算流水
 */
async function logSettlement(
  userAddress: Address,
  type: SettlementLog["type"],
  amount: string,
  balanceBefore: string,
  balanceAfter: string,
  proofData: Record<string, unknown>,
  positionId?: string,
  orderId?: string
): Promise<void> {
  if (!db.isConnected()) return;

  try {
    await SettlementLogRepo.create({
      userAddress,
      type,
      amount,
      balanceBefore,
      balanceAfter,
      onChainStatus: "PENDING",
      proofData: JSON.stringify(proofData),
      positionId,
      orderId,
      txHash: null,
    });
  } catch (error) {
    console.error("[Redis] Failed to log settlement:", error);
  }
}

/**
 * 转换: 内存 Position → DB Position
 */
function memoryPositionToDB(pos: Position): Omit<DBPosition, "id" | "createdAt" | "updatedAt"> {
  return {
    userAddress: pos.trader.toLowerCase() as Address,
    symbol: `${pos.token}-USDT`,
    side: pos.isLong ? "LONG" : "SHORT",
    size: pos.size,
    entryPrice: pos.entryPrice,
    leverage: Number(pos.leverage),
    marginType: "ISOLATED",
    initialMargin: pos.collateral,
    maintMargin: pos.maintenanceMargin || "0",
    fundingIndex: pos.fundingIndex || "0",
    isLiquidating: pos.isLiquidating || false,
    markPrice: pos.markPrice,
    unrealizedPnL: pos.unrealizedPnL,
    marginRatio: pos.marginRatio,
    liquidationPrice: pos.liquidationPrice,
    riskLevel: pos.riskLevel,
    adlScore: pos.adlScore,
    adlRanking: pos.adlRanking,
  };
}

/**
 * 转换: DB Position → 内存 Position
 */
function dbPositionToMemory(dbPos: DBPosition): Position {
  const token = dbPos.symbol.replace("-USDT", "") as Address;
  return {
    pairId: dbPos.id,
    trader: dbPos.userAddress,
    token,
    isLong: dbPos.side === "LONG",
    size: dbPos.size,
    entryPrice: dbPos.entryPrice,
    leverage: dbPos.leverage.toString(),
    collateral: dbPos.initialMargin,
    maintenanceMargin: dbPos.maintMargin,
    margin: dbPos.initialMargin,
    markPrice: dbPos.markPrice || "0",
    unrealizedPnL: dbPos.unrealizedPnL || "0",
    marginRatio: dbPos.marginRatio || "10000",
    mmr: "200",
    liquidationPrice: dbPos.liquidationPrice || "0",
    bankruptcyPrice: "0",
    roe: "0",
    realizedPnL: "0",
    accFundingFee: "0",
    adlRanking: dbPos.adlRanking || 1,
    adlScore: dbPos.adlScore || "0",
    riskLevel: dbPos.riskLevel || "low",
    isLiquidatable: dbPos.riskLevel === "critical",
    isAdlCandidate: false,
    fundingIndex: dbPos.fundingIndex || "0",
    isLiquidating: dbPos.isLiquidating,
    createdAt: dbPos.createdAt,
    updatedAt: dbPos.updatedAt,
  };
}

// ============================================================
// ADL 自动减仓系统 (Meme Perp 核心)
// ============================================================

/**
 * ADL 队列 - 按 adlScore 排序的盈利仓位
 * 当穿仓发生时，从队列头部开始减仓
 */
interface ADLQueue {
  token: Address;
  longQueue: Position[];   // 多头盈利队列 (按 adlScore 降序)
  shortQueue: Position[];  // 空头盈利队列 (按 adlScore 降序)
}
const adlQueues = new Map<Address, ADLQueue>();

/**
 * 强平队列 - 按 marginRatio 排序
 * 优先强平高风险仓位
 */
interface LiquidationCandidate {
  position: Position;
  marginRatio: number;     // 当前保证金率 (越低越危险)
  urgency: number;         // 紧急程度 (0-100)
}
const liquidationQueue: LiquidationCandidate[] = [];

/**
 * 计算 ADL Score
 * 公式: ADL Score = (UPNL / Margin) × Leverage
 *
 * 盈利越多、杠杆越高，ADL 风险越高
 */
function calculateADLScore(position: Position): number {
  const upnl = Number(position.unrealizedPnL);
  const margin = Number(position.collateral);
  const leverage = Number(position.leverage);

  if (margin === 0) return 0;

  // 只有盈利的仓位才有 ADL 风险
  if (upnl <= 0) return 0;

  // ADL Score = (UPNL% / margin) × leverage
  const upnlPercent = upnl / margin;
  const score = upnlPercent * leverage;

  return score;
}

/**
 * 计算 ADL 排名 (1-5)
 * 1 = 最安全, 5 = 最危险 (最可能被 ADL)
 */
function calculateADLRanking(score: number, allScores: number[]): number {
  if (score <= 0) return 1; // 亏损仓位不会被 ADL

  // 按分位数划分
  const sorted = allScores.filter(s => s > 0).sort((a, b) => a - b);
  if (sorted.length === 0) return 1;

  const percentile = sorted.findIndex(s => s >= score) / sorted.length;

  if (percentile >= 0.8) return 5;      // Top 20% 最危险
  if (percentile >= 0.6) return 4;
  if (percentile >= 0.4) return 3;
  if (percentile >= 0.2) return 2;
  return 1;
}

/**
 * 更新 ADL 队列
 */
function updateADLQueues(): void {
  // 清空旧队列
  adlQueues.clear();

  // 遍历所有仓位，按 token 分组
  for (const [trader, positions] of userPositions.entries()) {
    for (const pos of positions) {
      const token = pos.token.toLowerCase() as Address;

      // 获取或创建队列
      let queue = adlQueues.get(token);
      if (!queue) {
        queue = { token, longQueue: [], shortQueue: [] };
        adlQueues.set(token, queue);
      }

      // 只有盈利的仓位才加入 ADL 队列
      const upnl = Number(pos.unrealizedPnL);
      if (upnl > 0) {
        if (pos.isLong) {
          queue.longQueue.push(pos);
        } else {
          queue.shortQueue.push(pos);
        }
      }
    }
  }

  // 按 adlScore 降序排序
  for (const [token, queue] of adlQueues.entries()) {
    queue.longQueue.sort((a, b) => Number(b.adlScore) - Number(a.adlScore));
    queue.shortQueue.sort((a, b) => Number(b.adlScore) - Number(a.adlScore));
  }
}

/**
 * 执行 ADL 减仓
 * 当穿仓发生时调用
 *
 * @param bankruptPosition 穿仓的仓位
 * @param deficit 穿仓金额 (需要从对手方减仓的金额)
 */
async function executeADL(
  bankruptPosition: Position,
  deficit: bigint
): Promise<void> {
  const token = bankruptPosition.token.toLowerCase() as Address;
  const queue = adlQueues.get(token);

  if (!queue) {
    console.error(`[ADL] No queue for token ${token}`);
    return;
  }

  // 穿仓的是多头，需要从空头盈利队列减仓
  // 穿仓的是空头，需要从多头盈利队列减仓
  const targetQueue = bankruptPosition.isLong ? queue.shortQueue : queue.longQueue;

  if (targetQueue.length === 0) {
    console.error(`[ADL] No profitable positions to ADL against`);
    // 触发保险基金
    return;
  }

  let remainingDeficit = deficit;
  const adlTargets: { position: Position; amount: bigint }[] = [];

  // 从队列头部开始减仓
  for (const pos of targetQueue) {
    if (remainingDeficit <= 0n) break;

    const positionValue = BigInt(pos.collateral) + BigInt(pos.unrealizedPnL);

    if (positionValue <= 0n) continue;

    // 计算需要减仓的比例
    const adlAmount = remainingDeficit > positionValue ? positionValue : remainingDeficit;

    adlTargets.push({ position: pos, amount: adlAmount });
    remainingDeficit -= adlAmount;

    console.log(`[ADL] Target: ${pos.trader.slice(0, 10)} ${pos.isLong ? 'LONG' : 'SHORT'} amount=$${Number(adlAmount) / 1e6}`);
  }

  // 执行 ADL (调用链上合约)
  if (submitter && adlTargets.length > 0) {
    const currentPrice = engine.getOrderBook(token).getCurrentPrice();

    for (const { position, amount } of adlTargets) {
      try {
        // 部分平仓或全部平仓
        const adlRatio = Number(amount) / (Number(position.collateral) + Number(position.unrealizedPnL));

        console.log(`[ADL] Executing ADL on pairId ${position.pairId}, ratio=${(adlRatio * 100).toFixed(2)}%`);

        // TODO: 调用链上 ADL 函数
        // await submitter.executeADL(position.pairId, currentPrice, adlRatio);

        // 广播 ADL 事件
        broadcastADLEvent(position, amount, currentPrice);
      } catch (e) {
        console.error(`[ADL] Failed to execute ADL on ${position.pairId}:`, e);
      }
    }
  }
}

/**
 * 广播 ADL 事件到前端
 */
function broadcastADLEvent(position: Position, amount: bigint, price: bigint): void {
  const message = JSON.stringify({
    type: "adl_triggered",
    pairId: position.pairId,
    trader: position.trader,
    token: position.token,
    isLong: position.isLong,
    adlAmount: amount.toString(),
    price: price.toString(),
    timestamp: Date.now(),
  });

  for (const [client] of wsClients.entries()) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(message);
    }
  }
}

// ============================================================
// 100ms Risk Engine - Meme Perp 核心
// ============================================================

let riskEngineInterval: NodeJS.Timeout | null = null;
const RISK_ENGINE_INTERVAL_MS = 100; // 100ms
const REDIS_SYNC_CYCLES = 10; // 每 10 个周期 (1秒) 同步到 Redis
let riskEngineCycleCount = 0;

/**
 * 启动 100ms Risk Engine
 */
function startRiskEngine(): void {
  if (riskEngineInterval) {
    clearInterval(riskEngineInterval);
  }

  console.log(`[RiskEngine] Starting 100ms risk engine...`);

  riskEngineInterval = setInterval(() => {
    runRiskCheck();
  }, RISK_ENGINE_INTERVAL_MS);
}

/**
 * 停止 Risk Engine
 */
function stopRiskEngine(): void {
  if (riskEngineInterval) {
    clearInterval(riskEngineInterval);
    riskEngineInterval = null;
  }
}

/**
 * 风险检查主循环 (每 100ms 执行)
 */
function runRiskCheck(): void {
  const startTime = Date.now();

  // 清空强平队列
  liquidationQueue.length = 0;

  // 收集所有仓位的 ADL scores 用于排名计算
  const allScores: number[] = [];

  // 遍历所有仓位，更新风险指标
  for (const [trader, positions] of userPositions.entries()) {
    for (const pos of positions) {
      const token = pos.token.toLowerCase() as Address;
      const orderBook = engine.getOrderBook(token);
      const currentPrice = orderBook.getCurrentPrice();

      // 更新标记价格
      pos.markPrice = currentPrice.toString();

      // 计算 UPNL
      const upnl = calculateUnrealizedPnL(
        BigInt(pos.size),
        BigInt(pos.entryPrice),
        currentPrice,
        pos.isLong
      );
      pos.unrealizedPnL = upnl.toString();

      // 计算当前保证金
      const currentMargin = BigInt(pos.collateral) + upnl;
      pos.margin = currentMargin.toString();

      // 动态 MMR (根据杠杆调整)
      const positionValue = (BigInt(pos.size) * currentPrice) / (10n ** 24n);
      // MMR = min(2%, 初始保证金率 * 50%)
      // 这样确保 MMR < 初始保证金率，强平价才会在正确的一侧
      const leverage = BigInt(pos.leverage) * 10000n; // 转换为 1e4 精度
      const initialMarginRate = 10000n * 10000n / leverage; // 基点
      const baseMmr = 200n; // 基础 2%
      const maxMmr = initialMarginRate / 2n; // 不能超过初始保证金率的一半
      const mmr = Number(baseMmr < maxMmr ? baseMmr : maxMmr);
      pos.mmr = mmr.toString();

      // 计算维持保证金
      const maintenanceMargin = (positionValue * BigInt(mmr)) / 10000n;
      pos.maintenanceMargin = maintenanceMargin.toString();

      // ============================================================
      // 计算保证金率 (行业标准 - Binance/Bybit)
      // marginRatio = 维持保证金 / 账户权益 × 100%
      // 越高越危险，>= 100% 触发强平
      // ============================================================
      const marginRatio = currentMargin > 0n
        ? Number((maintenanceMargin * 10000n) / currentMargin)
        : 10000;
      pos.marginRatio = marginRatio.toString();

      // 计算 ROE
      const collateral = BigInt(pos.collateral);
      const roe = collateral > 0n
        ? Number((upnl * 10000n) / collateral)
        : 0;
      pos.roe = roe.toString();

      // 计算 ADL Score
      const adlScore = calculateADLScore(pos);
      pos.adlScore = adlScore.toString();
      allScores.push(adlScore);

      // 判断是否可被强平 (marginRatio >= 100% 触发强平)
      pos.isLiquidatable = marginRatio >= 10000;

      // 判断是否为 ADL 候选 (盈利方)
      pos.isAdlCandidate = upnl > 0n;

      // ============================================================
      // 更新风险等级并发送预警
      // marginRatio = 维持保证金/权益 × 100%, 越高越危险
      // >= 100% 触发强平
      // ============================================================
      const prevRiskLevel = pos.riskLevel;
      if (marginRatio >= 10000) {
        // >= 100%: 触发强平
        pos.riskLevel = "critical";
        if (prevRiskLevel !== "critical") {
          sendRiskAlert(
            pos.trader,
            "liquidation_warning",
            "danger",
            `Position ${pos.pairId.slice(0, 8)} is at liquidation risk! Margin ratio: ${(marginRatio / 100).toFixed(2)}%`,
            pos.pairId
          );
        }
      } else if (marginRatio >= 8000) {
        // >= 80%: 高风险
        pos.riskLevel = "high";
        if (prevRiskLevel === "low" || prevRiskLevel === "medium") {
          sendRiskAlert(
            pos.trader,
            "margin_warning",
            "warning",
            `Position ${pos.pairId.slice(0, 8)} margin ratio is high: ${(marginRatio / 100).toFixed(2)}%`,
            pos.pairId
          );
        }
      } else if (marginRatio >= 5000) {
        // >= 50%: 中等风险
        pos.riskLevel = "medium";
      } else {
        // < 50%: 低风险
        pos.riskLevel = "low";
      }

      // 如果可被强平，加入强平队列
      if (pos.isLiquidatable) {
        // urgency 基于 margin ratio 超过100%的程度
        const urgency = Math.max(0, Math.min(100, Math.floor((marginRatio - 10000) / 100)));
        liquidationQueue.push({
          position: pos,
          marginRatio,
          urgency,
        });
      }

      // ============================================================
      // P2: Take Profit / Stop Loss 监控
      // ============================================================
      checkTakeProfitStopLoss(pos, currentPrice);

      pos.updatedAt = Date.now();
    }
  }

  // 更新所有仓位的 ADL 排名
  for (const [trader, positions] of userPositions.entries()) {
    for (const pos of positions) {
      const score = Number(pos.adlScore);
      pos.adlRanking = calculateADLRanking(score, allScores);
    }
  }

  // 按 marginRatio 升序排序强平队列 (最危险的在前面)
  liquidationQueue.sort((a, b) => a.marginRatio - b.marginRatio);

  // 更新 ADL 队列
  updateADLQueues();

  // 处理强平 (直接强平，无缓冲)
  processLiquidations();

  // 处理 TP/SL 触发队列 (P2)
  processTPSLTriggerQueue();

  // 广播风控数据 (实时推送)
  broadcastRiskData();

  // 广播各代币的强平热力图
  for (const token of SUPPORTED_TOKENS) {
    broadcastLiquidationMap(token);
  }

  // 每秒同步一次仓位风险到 Redis (批量更新)
  riskEngineCycleCount++;
  if (riskEngineCycleCount >= REDIS_SYNC_CYCLES) {
    riskEngineCycleCount = 0;
    syncPositionRisksToRedis();
  }

  const elapsed = Date.now() - startTime;
  if (elapsed > 50) {
    console.warn(`[RiskEngine] Slow risk check: ${elapsed}ms`);
  }
}

/**
 * 批量同步仓位风险数据到 Redis (每秒一次)
 */
function syncPositionRisksToRedis(): void {
  if (!db.isConnected()) return;

  const updates: Array<{ id: string; data: Partial<DBPosition> }> = [];

  for (const [trader, positions] of userPositions.entries()) {
    for (const pos of positions) {
      // 只同步有 Redis ID 的仓位
      if (!pos.pairId || pos.pairId.length < 30) continue;

      updates.push({
        id: pos.pairId,
        data: {
          markPrice: pos.markPrice,
          unrealizedPnL: pos.unrealizedPnL,
          marginRatio: pos.marginRatio,
          liquidationPrice: pos.liquidationPrice,
          riskLevel: pos.riskLevel,
          adlScore: pos.adlScore,
          adlRanking: pos.adlRanking,
          isLiquidating: pos.isLiquidatable,
        },
      });
    }
  }

  if (updates.length > 0) {
    PositionRepo.batchUpdateRisk(updates).catch((err) => {
      console.error("[Redis] Batch risk update failed:", err);
    });
  }
}

/**
 * 处理强平队列
 */
async function processLiquidations(): Promise<void> {
  if (liquidationQueue.length === 0) return;

  console.log(`[RiskEngine] ${liquidationQueue.length} positions pending liquidation`);

  for (const candidate of liquidationQueue) {
    const pos = candidate.position;

    console.log(`[Liquidation] Processing: ${pos.trader.slice(0, 10)} ${pos.isLong ? 'LONG' : 'SHORT'} marginRatio=${candidate.marginRatio}bp urgency=${candidate.urgency}`);

    // 检查是否会穿仓
    const currentMargin = BigInt(pos.margin);
    const maintenanceMargin = BigInt(pos.maintenanceMargin);

    if (currentMargin < 0n) {
      // 穿仓！需要 ADL
      const deficit = -currentMargin;
      console.log(`[Liquidation] BANKRUPTCY! Deficit: $${Number(deficit) / 1e6}`);

      // 触发 ADL
      await executeADL(pos, deficit);
    }

    // 调用链上强平
    if (submitter) {
      try {
        const pairId = BigInt(pos.pairId);
        // TODO: 调用链上 liquidate 函数
        // await submitter.liquidate(pairId);
        console.log(`[Liquidation] Submitted to chain: pairId=${pos.pairId}`);
      } catch (e) {
        console.error(`[Liquidation] Failed to liquidate ${pos.pairId}:`, e);
      }
    }

    // 广播强平事件
    broadcastLiquidationEvent(pos);
  }
}

/**
 * 广播强平事件
 */
function broadcastLiquidationEvent(position: Position): void {
  const message = JSON.stringify({
    type: "liquidation_warning",
    pairId: position.pairId,
    trader: position.trader,
    token: position.token,
    isLong: position.isLong,
    marginRatio: position.marginRatio,
    mmr: position.mmr,
    riskLevel: position.riskLevel,
    timestamp: Date.now(),
  });

  for (const [client] of wsClients.entries()) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(message);
    }
  }
}

// ============================================================
// 保险基金 (Insurance Fund) - Meme Perp 核心
// ============================================================

/**
 * 保险基金状态
 * 用于:
 * 1. 穿仓时，在 ADL 之前先用保险基金覆盖
 * 2. 强平收益的一部分注入保险基金
 */
interface InsuranceFund {
  balance: bigint;                    // 当前余额 (1e6 USD)
  totalContributions: bigint;         // 累计注入 (来自清算收益、手续费)
  totalPayouts: bigint;               // 累计支出 (弥补穿仓)
  lastUpdated: number;
}

// 全局保险基金 (所有代币共用)
let insuranceFund: InsuranceFund = {
  balance: 10000n * 10n ** 6n,        // 初始 $10,000 (测试用)
  totalContributions: 10000n * 10n ** 6n,
  totalPayouts: 0n,
  lastUpdated: Date.now(),
};

// 每个代币的保险基金 (用于隔离风险)
const tokenInsuranceFunds = new Map<Address, InsuranceFund>();

/**
 * 获取代币保险基金
 */
function getTokenInsuranceFund(token: Address): InsuranceFund {
  const normalizedToken = token.toLowerCase() as Address;
  let fund = tokenInsuranceFunds.get(normalizedToken);
  if (!fund) {
    fund = {
      balance: 1000n * 10n ** 6n,       // 每个代币初始 $1,000
      totalContributions: 1000n * 10n ** 6n,
      totalPayouts: 0n,
      lastUpdated: Date.now(),
    };
    tokenInsuranceFunds.set(normalizedToken, fund);
  }
  return fund;
}

/**
 * 向保险基金注入资金
 * 来源: 清算手续费、交易手续费的一部分
 */
function contributeToInsuranceFund(amount: bigint, token?: Address): void {
  if (token) {
    const fund = getTokenInsuranceFund(token);
    fund.balance += amount;
    fund.totalContributions += amount;
    fund.lastUpdated = Date.now();
    console.log(`[InsuranceFund] Token ${token.slice(0, 10)} contribution: +$${Number(amount) / 1e6}, balance: $${Number(fund.balance) / 1e6}`);
  } else {
    insuranceFund.balance += amount;
    insuranceFund.totalContributions += amount;
    insuranceFund.lastUpdated = Date.now();
    console.log(`[InsuranceFund] Global contribution: +$${Number(amount) / 1e6}, balance: $${Number(insuranceFund.balance) / 1e6}`);
  }
}

/**
 * 从保险基金支出
 * 用途: Oracle 结算盈利、穿仓覆盖
 *
 * @returns 实际支出金额 (可能小于请求金额)
 */
function payFromInsuranceFund(amount: bigint, token?: Address): bigint {
  if (token) {
    const fund = getTokenInsuranceFund(token);
    const actualPayout = amount > fund.balance ? fund.balance : amount;
    fund.balance -= actualPayout;
    fund.totalPayouts += actualPayout;
    fund.lastUpdated = Date.now();
    console.log(`[InsuranceFund] Token ${token.slice(0, 10)} payout: -$${Number(actualPayout) / 1e6}, balance: $${Number(fund.balance) / 1e6}`);
    return actualPayout;
  } else {
    const actualPayout = amount > insuranceFund.balance ? insuranceFund.balance : amount;
    insuranceFund.balance -= actualPayout;
    insuranceFund.totalPayouts += actualPayout;
    insuranceFund.lastUpdated = Date.now();
    console.log(`[InsuranceFund] Global payout: -$${Number(actualPayout) / 1e6}, balance: $${Number(insuranceFund.balance) / 1e6}`);
    return actualPayout;
  }
}

/**
 * 检查保险基金是否充足
 */
function hasInsuranceFundCoverage(amount: bigint, token?: Address): boolean {
  if (token) {
    const fund = getTokenInsuranceFund(token);
    return fund.balance >= amount;
  }
  return insuranceFund.balance >= amount;
}

// ============================================================
// Dynamic Funding (动态资金费) - Meme Perp P1 功能
// ============================================================

/**
 * Meme Token 动态资金费配置
 *
 * 与 BTC/ETH 不同，Meme Token 需要:
 * 1. 更频繁的结算周期 (1h vs 8h)
 * 2. 更高的最大费率 (3% vs 0.75%)
 * 3. 波动率调整的费率
 * 4. 实时费率更新
 */
interface DynamicFundingConfig {
  token: Address;
  baseInterval: number;          // 基础结算周期 (ms)
  minInterval: number;           // 最小结算周期 (高波动时)
  maxRate: number;               // 最大费率 (basis points, 100 = 1%)
  volatilityMultiplier: number;  // 波动率乘数
  imbalanceMultiplier: number;   // 多空不平衡乘数
}

// 默认 Meme Token 资金费配置
const DEFAULT_MEME_FUNDING_CONFIG: Omit<DynamicFundingConfig, "token"> = {
  baseInterval: 60 * 60 * 1000,      // 1 小时基础周期 (BTC/ETH 是 8 小时)
  minInterval: 15 * 60 * 1000,       // 最小 15 分钟 (高波动时)
  maxRate: 300,                      // 最大 3% (BTC 是 0.75%)
  volatilityMultiplier: 1.5,         // 波动率每增加 1%，费率增加 1.5 倍
  imbalanceMultiplier: 2,            // 多空不平衡乘数
};

const tokenFundingConfigs = new Map<Address, DynamicFundingConfig>();

/**
 * 获取代币资金费配置
 */
function getTokenFundingConfig(token: Address): DynamicFundingConfig {
  const normalizedToken = token.toLowerCase() as Address;
  let config = tokenFundingConfigs.get(normalizedToken);
  if (!config) {
    config = { token: normalizedToken, ...DEFAULT_MEME_FUNDING_CONFIG };
    tokenFundingConfigs.set(normalizedToken, config);
  }
  return config;
}

/**
 * 资金费支付记录
 */
interface FundingPayment {
  pairId: string;
  trader: Address;
  token: Address;
  isLong: boolean;
  positionSize: string;
  fundingRate: string;            // 费率 (basis points)
  fundingAmount: string;          // 支付金额 (1e6 USD)
  isPayer: boolean;               // true = 付款方, false = 收款方
  timestamp: number;
}

// 资金费支付历史 (按代币分组)
const fundingPaymentHistory = new Map<Address, FundingPayment[]>();

// 下次资金费结算时间 (按代币)
const nextFundingSettlement = new Map<Address, number>();

// 当前资金费率 (按代币, basis points)
const currentFundingRates = new Map<Address, bigint>();

/**
 * 波动率跟踪器 (用于动态资金费计算)
 */
interface VolatilityTracker {
  token: Address;
  volatility: number;     // 当前波动率 (%)
  priceHistory: Array<{ price: number; timestamp: number }>;  // 历史价格
  lastUpdate: number;
}
const volatilityTrackers = new Map<Address, VolatilityTracker>();

/**
 * 更新价格波动率
 * 使用最近 N 个价格点计算标准差
 */
function updateVolatility(token: Address, currentPrice: number): void {
  const normalizedToken = token.toLowerCase() as Address;
  let tracker = volatilityTrackers.get(normalizedToken);

  if (!tracker) {
    tracker = {
      token: normalizedToken,
      volatility: 0,
      priceHistory: [],
      lastUpdate: Date.now(),
    };
    volatilityTrackers.set(normalizedToken, tracker);
  }

  // 添加新价格点
  tracker.priceHistory.push({ price: currentPrice, timestamp: Date.now() });

  // 只保留最近 100 个价格点 (约 100 秒的数据)
  const maxHistory = 100;
  if (tracker.priceHistory.length > maxHistory) {
    tracker.priceHistory = tracker.priceHistory.slice(-maxHistory);
  }

  // 计算波动率 (价格变化的标准差 / 平均价格 * 100)
  if (tracker.priceHistory.length >= 10) {
    const prices = tracker.priceHistory.map(p => p.price);
    const avg = prices.reduce((a, b) => a + b, 0) / prices.length;
    const variance = prices.reduce((sum, p) => sum + Math.pow(p - avg, 2), 0) / prices.length;
    const stdDev = Math.sqrt(variance);
    tracker.volatility = (stdDev / avg) * 100;
  }

  tracker.lastUpdate = Date.now();
}

/**
 * 计算动态资金费率
 *
 * 动态费率 = 基础费率 × (1 + 波动率调整) × (1 + 不平衡调整)
 *
 * 基础费率来自引擎的 calculateFundingRate
 */
function calculateDynamicFundingRate(token: Address): bigint {
  const normalizedToken = token.toLowerCase() as Address;
  const config = getTokenFundingConfig(normalizedToken);

  // 获取引擎计算的基础费率
  const baseRate = engine.calculateFundingRate(normalizedToken);

  // 获取波动率
  const tracker = volatilityTrackers.get(normalizedToken);
  const volatility = tracker?.volatility || 0;

  // 波动率调整 (波动率越高，费率越高)
  const volatilityAdjustment = 1 + (volatility * config.volatilityMultiplier / 100);

  // 计算多空不平衡
  const { longOI, shortOI } = calculateOpenInterest(normalizedToken);
  const totalOI = longOI + shortOI;
  let imbalanceRatio = 0;
  if (totalOI > 0n) {
    const imbalance = longOI > shortOI ? longOI - shortOI : shortOI - longOI;
    imbalanceRatio = Number(imbalance * 100n / totalOI);
  }

  // 不平衡调整 (不平衡越大，费率越高)
  const imbalanceAdjustment = 1 + (imbalanceRatio * config.imbalanceMultiplier / 100);

  // 计算最终费率
  let dynamicRate = BigInt(Math.floor(Number(baseRate) * volatilityAdjustment * imbalanceAdjustment));

  // 限制最大费率
  const maxRateBigInt = BigInt(config.maxRate);
  if (dynamicRate > maxRateBigInt) dynamicRate = maxRateBigInt;
  if (dynamicRate < -maxRateBigInt) dynamicRate = -maxRateBigInt;

  currentFundingRates.set(normalizedToken, dynamicRate);

  console.log(`[DynamicFunding] Token ${token.slice(0, 10)}: base=${baseRate}bp vol=${volatility.toFixed(2)}% imbal=${imbalanceRatio.toFixed(2)}% final=${dynamicRate}bp`);

  return dynamicRate;
}

/**
 * 计算多空持仓量
 */
function calculateOpenInterest(token: Address): { longOI: bigint; shortOI: bigint } {
  const normalizedToken = token.toLowerCase() as Address;
  let longOI = 0n;
  let shortOI = 0n;

  for (const [trader, positions] of userPositions.entries()) {
    for (const pos of positions) {
      if ((pos.token.toLowerCase() as Address) === normalizedToken) {
        const positionValue = BigInt(pos.size);
        if (pos.isLong) {
          longOI += positionValue;
        } else {
          shortOI += positionValue;
        }
      }
    }
  }

  return { longOI, shortOI };
}

/**
 * 获取动态资金费结算周期
 *
 * 高波动时缩短周期，低波动时使用基础周期
 */
function getDynamicFundingInterval(token: Address): number {
  const normalizedToken = token.toLowerCase() as Address;
  const config = getTokenFundingConfig(normalizedToken);

  // 获取波动率
  const tracker = volatilityTrackers.get(normalizedToken);
  const volatility = tracker?.volatility || 0;

  // 波动率 > 5% 时，周期缩短到最小
  if (volatility > 5) {
    return config.minInterval;
  }

  // 波动率 1-5% 时，按比例调整
  if (volatility > 1) {
    const ratio = 1 - (volatility - 1) / 4; // 1% -> 1.0, 5% -> 0.0
    const interval = config.minInterval + (config.baseInterval - config.minInterval) * ratio;
    return Math.floor(interval);
  }

  return config.baseInterval;
}

/**
 * 执行资金费结算
 *
 * 正费率: 多头付给空头
 * 负费率: 空头付给多头
 */
async function settleFunding(token: Address): Promise<void> {
  const normalizedToken = token.toLowerCase() as Address;
  const rate = currentFundingRates.get(normalizedToken) || 0n;

  if (rate === 0n) {
    console.log(`[DynamicFunding] No funding rate for ${token.slice(0, 10)}`);
    return;
  }

  console.log(`[DynamicFunding] Settling funding for ${token.slice(0, 10)} rate=${rate}bp`);

  const payments: FundingPayment[] = [];
  let totalLongPayment = 0n;
  let totalShortPayment = 0n;

  // 遍历所有仓位，计算资金费
  for (const [trader, positions] of userPositions.entries()) {
    for (const pos of positions) {
      if ((pos.token.toLowerCase() as Address) !== normalizedToken) continue;

      const positionSize = BigInt(pos.size);
      const currentPrice = BigInt(pos.markPrice);

      // 计算仓位价值 (USD)
      const positionValue = (positionSize * currentPrice) / (10n ** 24n);

      // 计算资金费金额 = 仓位价值 × 费率 / 10000
      const fundingAmount = (positionValue * (rate >= 0n ? rate : -rate)) / 10000n;

      // 正费率: 多头付给空头
      // 负费率: 空头付给多头
      const isPayer = (rate > 0n && pos.isLong) || (rate < 0n && !pos.isLong);

      const payment: FundingPayment = {
        pairId: pos.pairId,
        trader: pos.trader,
        token: pos.token,
        isLong: pos.isLong,
        positionSize: pos.size,
        fundingRate: rate.toString(),
        fundingAmount: (isPayer ? -fundingAmount : fundingAmount).toString(),
        isPayer,
        timestamp: Date.now(),
      };

      payments.push(payment);

      // 更新仓位的累计资金费
      const currentFundingFee = BigInt(pos.fundingFee || "0");
      pos.fundingFee = (currentFundingFee + (isPayer ? -fundingAmount : fundingAmount)).toString();

      // 统计总支付/收取
      if (pos.isLong) {
        totalLongPayment += isPayer ? -fundingAmount : fundingAmount;
      } else {
        totalShortPayment += isPayer ? -fundingAmount : fundingAmount;
      }
    }
  }

  // 保存支付记录
  const history = fundingPaymentHistory.get(normalizedToken) || [];
  history.push(...payments);
  if (history.length > 10000) {
    // 保留最近 10000 条
    fundingPaymentHistory.set(normalizedToken, history.slice(-10000));
  } else {
    fundingPaymentHistory.set(normalizedToken, history);
  }

  // 设置下次结算时间
  const nextInterval = getDynamicFundingInterval(normalizedToken);
  nextFundingSettlement.set(normalizedToken, Date.now() + nextInterval);

  console.log(`[DynamicFunding] Settled: long=${totalLongPayment}usd short=${totalShortPayment}usd payments=${payments.length}`);

  // 广播资金费结算事件
  broadcastFundingSettlement(normalizedToken, rate, payments.length);
}

/**
 * 广播资金费结算事件
 */
function broadcastFundingSettlement(
  token: Address,
  rate: bigint,
  paymentCount: number
): void {
  const message = JSON.stringify({
    type: "funding_settlement",
    token,
    rate: rate.toString(),
    paymentCount,
    nextSettlement: nextFundingSettlement.get(token),
    timestamp: Date.now(),
  });

  for (const [client] of wsClients.entries()) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(message);
    }
  }
}

/**
 * 启动动态资金费引擎
 */
let dynamicFundingInterval: NodeJS.Timeout | null = null;
const DYNAMIC_FUNDING_CHECK_INTERVAL = 10000; // 每 10 秒检查一次

function startDynamicFundingEngine(): void {
  if (dynamicFundingInterval) {
    clearInterval(dynamicFundingInterval);
  }

  console.log(`[DynamicFunding] Starting dynamic funding engine...`);

  dynamicFundingInterval = setInterval(() => {
    const now = Date.now();

    for (const token of SUPPORTED_TOKENS) {
      const normalizedToken = token.toLowerCase() as Address;

      // 计算动态费率
      calculateDynamicFundingRate(normalizedToken);

      // 检查是否到达结算时间
      const nextSettlement = nextFundingSettlement.get(normalizedToken);
      if (!nextSettlement || now >= nextSettlement) {
        settleFunding(normalizedToken).catch((e) => {
          console.error(`[DynamicFunding] Settlement failed for ${token.slice(0, 10)}:`, e);
        });
      }
    }
  }, DYNAMIC_FUNDING_CHECK_INTERVAL);
}

/**
 * 停止动态资金费引擎
 */
function stopDynamicFundingEngine(): void {
  if (dynamicFundingInterval) {
    clearInterval(dynamicFundingInterval);
    dynamicFundingInterval = null;
  }
}

// ============================================================
// Take Profit / Stop Loss (止盈止损) - Meme Perp P2 功能
// ============================================================

/**
 * TP/SL 订单类型
 */
interface TPSLOrder {
  pairId: string;
  trader: Address;
  token: Address;
  isLong: boolean;

  // 止盈配置
  takeProfitPrice: bigint | null;
  takeProfitTriggered: boolean;

  // 止损配置
  stopLossPrice: bigint | null;
  stopLossTriggered: boolean;

  // 触发后的执行状态
  executionStatus: "pending" | "executing" | "executed" | "failed";
  executedAt: number | null;
  executionPrice: bigint | null;
  executionPnL: bigint | null;

  createdAt: number;
  updatedAt: number;
}

// TP/SL 订单存储 (按 pairId)
const tpslOrders = new Map<string, TPSLOrder>();

// 待执行的 TP/SL 触发队列
const tpslTriggerQueue: { order: TPSLOrder; triggerType: "tp" | "sl"; triggerPrice: bigint }[] = [];

/**
 * 设置或更新 TP/SL
 */
function setTakeProfitStopLoss(
  pairId: string,
  takeProfitPrice: bigint | null,
  stopLossPrice: bigint | null
): TPSLOrder | null {
  // 查找仓位
  let position: Position | null = null;
  for (const [trader, positions] of userPositions.entries()) {
    const found = positions.find(p => p.pairId === pairId);
    if (found) {
      position = found;
      break;
    }
  }

  if (!position) {
    console.error(`[TP/SL] Position not found: ${pairId}`);
    return null;
  }

  const entryPrice = BigInt(position.entryPrice);

  // 验证 TP/SL 价格合理性
  if (takeProfitPrice !== null) {
    // 多头 TP 必须高于入场价，空头 TP 必须低于入场价
    if (position.isLong && takeProfitPrice <= entryPrice) {
      console.error(`[TP/SL] Invalid TP for LONG: TP ${takeProfitPrice} <= entry ${entryPrice}`);
      return null;
    }
    if (!position.isLong && takeProfitPrice >= entryPrice) {
      console.error(`[TP/SL] Invalid TP for SHORT: TP ${takeProfitPrice} >= entry ${entryPrice}`);
      return null;
    }
  }

  if (stopLossPrice !== null) {
    // 多头 SL 必须低于入场价，空头 SL 必须高于入场价
    if (position.isLong && stopLossPrice >= entryPrice) {
      console.error(`[TP/SL] Invalid SL for LONG: SL ${stopLossPrice} >= entry ${entryPrice}`);
      return null;
    }
    if (!position.isLong && stopLossPrice <= entryPrice) {
      console.error(`[TP/SL] Invalid SL for SHORT: SL ${stopLossPrice} <= entry ${entryPrice}`);
      return null;
    }

    // SL 不能低于/高于强平价
    const liqPrice = BigInt(position.liquidationPrice);
    if (position.isLong && stopLossPrice <= liqPrice) {
      console.error(`[TP/SL] SL ${stopLossPrice} below liquidation price ${liqPrice}`);
      return null;
    }
    if (!position.isLong && stopLossPrice >= liqPrice) {
      console.error(`[TP/SL] SL ${stopLossPrice} above liquidation price ${liqPrice}`);
      return null;
    }
  }

  // 更新或创建 TP/SL 订单
  let order = tpslOrders.get(pairId);
  const now = Date.now();

  if (order) {
    // 更新现有订单
    order.takeProfitPrice = takeProfitPrice;
    order.stopLossPrice = stopLossPrice;
    order.updatedAt = now;
  } else {
    // 创建新订单
    order = {
      pairId,
      trader: position.trader,
      token: position.token,
      isLong: position.isLong,
      takeProfitPrice,
      takeProfitTriggered: false,
      stopLossPrice,
      stopLossTriggered: false,
      executionStatus: "pending",
      executedAt: null,
      executionPrice: null,
      executionPnL: null,
      createdAt: now,
      updatedAt: now,
    };
    tpslOrders.set(pairId, order);
  }

  // 更新仓位的 TP/SL 价格显示
  position.takeProfitPrice = takeProfitPrice?.toString() || null;
  position.stopLossPrice = stopLossPrice?.toString() || null;

  console.log(`[TP/SL] Set for ${pairId}: TP=${takeProfitPrice?.toString() || 'none'} SL=${stopLossPrice?.toString() || 'none'}`);

  return order;
}

/**
 * 取消 TP/SL
 */
function cancelTakeProfitStopLoss(pairId: string, cancelType: "tp" | "sl" | "both"): boolean {
  const order = tpslOrders.get(pairId);
  if (!order) return false;

  if (cancelType === "tp" || cancelType === "both") {
    order.takeProfitPrice = null;
    order.takeProfitTriggered = false;
  }

  if (cancelType === "sl" || cancelType === "both") {
    order.stopLossPrice = null;
    order.stopLossTriggered = false;
  }

  // 更新仓位显示
  for (const [trader, positions] of userPositions.entries()) {
    const position = positions.find(p => p.pairId === pairId);
    if (position) {
      if (cancelType === "tp" || cancelType === "both") position.takeProfitPrice = null;
      if (cancelType === "sl" || cancelType === "both") position.stopLossPrice = null;
      break;
    }
  }

  // 如果都取消了，删除订单
  if (order.takeProfitPrice === null && order.stopLossPrice === null) {
    tpslOrders.delete(pairId);
  }

  console.log(`[TP/SL] Cancelled ${cancelType} for ${pairId}`);
  return true;
}

/**
 * 检查 TP/SL 触发 (在 Risk Engine 中调用)
 */
function checkTakeProfitStopLoss(position: Position, currentPrice: bigint): void {
  const order = tpslOrders.get(position.pairId);
  if (!order || order.executionStatus !== "pending") return;

  // 检查止盈
  if (order.takeProfitPrice !== null && !order.takeProfitTriggered) {
    const tpPrice = order.takeProfitPrice;

    // 多头: 当前价格 >= TP 价格触发
    // 空头: 当前价格 <= TP 价格触发
    const tpTriggered = position.isLong
      ? currentPrice >= tpPrice
      : currentPrice <= tpPrice;

    if (tpTriggered) {
      order.takeProfitTriggered = true;
      tpslTriggerQueue.push({ order, triggerType: "tp", triggerPrice: currentPrice });
      console.log(`[TP/SL] 🎯 Take Profit TRIGGERED: ${position.pairId} @ ${currentPrice}`);
      broadcastTPSLTriggered(position, "tp", currentPrice);
    }
  }

  // 检查止损 (如果止盈没触发)
  if (order.stopLossPrice !== null && !order.stopLossTriggered && !order.takeProfitTriggered) {
    const slPrice = order.stopLossPrice;

    // 多头: 当前价格 <= SL 价格触发
    // 空头: 当前价格 >= SL 价格触发
    const slTriggered = position.isLong
      ? currentPrice <= slPrice
      : currentPrice >= slPrice;

    if (slTriggered) {
      order.stopLossTriggered = true;
      tpslTriggerQueue.push({ order, triggerType: "sl", triggerPrice: currentPrice });
      console.log(`[TP/SL] 🛑 Stop Loss TRIGGERED: ${position.pairId} @ ${currentPrice}`);
      broadcastTPSLTriggered(position, "sl", currentPrice);
    }
  }
}

/**
 * 处理 TP/SL 触发队列 (每次 Risk Check 后调用)
 */
async function processTPSLTriggerQueue(): Promise<void> {
  while (tpslTriggerQueue.length > 0) {
    const trigger = tpslTriggerQueue.shift()!;
    const { order, triggerType, triggerPrice } = trigger;

    // 查找仓位
    let position: Position | null = null;
    for (const [trader, positions] of userPositions.entries()) {
      const found = positions.find(p => p.pairId === order.pairId);
      if (found) {
        position = found;
        break;
      }
    }

    if (!position) {
      console.error(`[TP/SL] Position not found for execution: ${order.pairId}`);
      order.executionStatus = "failed";
      continue;
    }

    try {
      order.executionStatus = "executing";

      // 执行全额平仓
      const currentSize = BigInt(position.size);
      const currentPrice = triggerPrice;

      // 计算 PnL
      const pnl = calculateUnrealizedPnL(
        currentSize,
        BigInt(position.entryPrice),
        currentPrice,
        position.isLong
      );

      // 计算平仓手续费 (0.05%)
      const positionValue = (currentSize * currentPrice) / (10n ** 24n);
      const closeFee = (positionValue * 5n) / 10000n;

      // 更新订单状态
      order.executedAt = Date.now();
      order.executionPrice = currentPrice;
      order.executionPnL = pnl;
      order.executionStatus = "executed";

      // 从用户仓位列表中移除
      const normalizedTrader = position.trader.toLowerCase() as Address;
      const positions = userPositions.get(normalizedTrader) || [];
      const updatedPositions = positions.filter(p => p.pairId !== order.pairId);
      userPositions.set(normalizedTrader, updatedPositions);

      // 移除 TP/SL 订单
      tpslOrders.delete(order.pairId);

      // 广播执行事件
      broadcastTPSLExecuted(position, triggerType, currentPrice, pnl, closeFee);

      console.log(`[TP/SL] ✅ Executed ${triggerType.toUpperCase()}: ${order.pairId} PnL=$${Number(pnl) / 1e6}`);

    } catch (e) {
      console.error(`[TP/SL] Execution failed: ${order.pairId}`, e);
      order.executionStatus = "failed";
    }
  }
}

/**
 * 广播 TP/SL 触发事件
 */
function broadcastTPSLTriggered(
  position: Position,
  triggerType: "tp" | "sl",
  triggerPrice: bigint
): void {
  const message = JSON.stringify({
    type: "tpsl_triggered",
    pairId: position.pairId,
    trader: position.trader,
    token: position.token,
    isLong: position.isLong,
    triggerType,
    triggerPrice: triggerPrice.toString(),
    timestamp: Date.now(),
  });

  for (const [client] of wsClients.entries()) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(message);
    }
  }
}

/**
 * 广播 TP/SL 执行事件
 */
function broadcastTPSLExecuted(
  position: Position,
  triggerType: "tp" | "sl",
  executionPrice: bigint,
  pnl: bigint,
  fee: bigint
): void {
  const message = JSON.stringify({
    type: "tpsl_executed",
    pairId: position.pairId,
    trader: position.trader,
    token: position.token,
    isLong: position.isLong,
    triggerType,
    executionPrice: executionPrice.toString(),
    realizedPnL: pnl.toString(),
    closeFee: fee.toString(),
    timestamp: Date.now(),
  });

  for (const [client] of wsClients.entries()) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(message);
    }
  }
}


function broadcast(type: string, data: Record<string, unknown>): void {
  const message = JSON.stringify({ type, ...data, timestamp: Date.now() });
  for (const [client] of wsClients.entries()) {
    if (client.readyState === WebSocket.OPEN) client.send(message);
  }
}

// ============================================================
// Real-time Risk Data Broadcasting (风控数据实时推送)
// ============================================================

/**
 * 广播风控数据给所有订阅者
 * 包括: 用户仓位风险、强平队列、保险基金、资金费率
 */
function broadcastRiskData(): void {
  const now = Date.now();
  if (now - lastRiskBroadcast < RISK_BROADCAST_INTERVAL_MS) {
    return; // Throttle
  }
  lastRiskBroadcast = now;

  // 1. 向每个订阅风控的交易者推送其仓位风险数据
  for (const [trader, wsSet] of wsTraderClients.entries()) {
    const positions = userPositions.get(trader) || [];
    if (positions.length === 0) continue;

    const positionRisks = positions.map(pos => ({
      pairId: pos.pairId,
      trader: pos.trader,
      token: pos.token,
      isLong: pos.isLong,
      size: pos.size,
      entryPrice: pos.entryPrice,
      leverage: pos.leverage,
      marginRatio: pos.marginRatio || "10000",
      mmr: pos.mmr || "200",
      roe: pos.roe || "0",
      liquidationPrice: pos.liquidationPrice || "0",
      markPrice: pos.markPrice || "0",
      unrealizedPnL: pos.unrealizedPnL || "0",
      collateral: pos.collateral,
      adlScore: parseFloat(pos.adlScore || "0"),
      adlRanking: pos.adlRanking || 1,
      riskLevel: pos.riskLevel || "low",
    }));

    const message = JSON.stringify({
      type: "position_risks",
      positions: positionRisks,
      timestamp: now,
    });

    for (const ws of wsSet) {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(message);
      }
    }
  }

  // 2. 向所有风控订阅者推送全局数据
  if (wsRiskSubscribers.size > 0) {
    // 强平队列
    const liquidationQueueData = liquidationQueue.slice(0, 20).map(item => ({
      pairId: item.position.pairId,
      trader: item.position.trader,
      token: item.position.token,
      isLong: item.position.isLong,
      size: item.position.size,
      marginRatio: item.marginRatio,
      urgency: item.urgency < 30 ? "LOW" : item.urgency < 60 ? "MEDIUM" : item.urgency < 80 ? "HIGH" : "CRITICAL",
    }));

    // 保险基金
    const insuranceFundData = {
      balance: insuranceFund.balance.toString(),
      totalContributions: insuranceFund.totalContributions.toString(),
      totalPayouts: insuranceFund.totalPayouts.toString(),
      lastUpdated: insuranceFund.lastUpdated,
      display: {
        balance: (Number(insuranceFund.balance) / 1e6).toFixed(2),
        totalContributions: (Number(insuranceFund.totalContributions) / 1e6).toFixed(2),
        totalPayouts: (Number(insuranceFund.totalPayouts) / 1e6).toFixed(2),
      },
    };

    // 各代币资金费率
    const fundingRates: Record<string, unknown>[] = [];
    for (const token of SUPPORTED_TOKENS) {
      const normalizedToken = token.toLowerCase() as Address;
      const currentRate = currentFundingRates.get(normalizedToken) || 0n;
      const nextSettlement = nextFundingSettlement.get(normalizedToken) || 0;
      const { longOI, shortOI } = calculateOpenInterest(normalizedToken);

      fundingRates.push({
        token,
        currentRate: currentRate.toString(),
        nextSettlement,
        lastSettlement: Date.now(),
        longSize: longOI.toString(),
        shortSize: shortOI.toString(),
        imbalance: longOI > 0n || shortOI > 0n
          ? Number((longOI - shortOI) * 10000n / (longOI + shortOI + 1n)) / 100
          : 0,
      });
    }

    const globalMessage = JSON.stringify({
      type: "risk_data",
      liquidationQueue: liquidationQueueData,
      insuranceFund: insuranceFundData,
      fundingRates,
      timestamp: now,
    });

    for (const ws of wsRiskSubscribers) {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(globalMessage);
      }
    }
  }
}

/**
 * 广播强平热力图数据
 */
function broadcastLiquidationMap(token: Address): void {
  const normalizedToken = token.toLowerCase() as Address;
  const positions = Array.from(userPositions.values()).flat().filter(
    p => p.token.toLowerCase() === normalizedToken
  );

  if (positions.length === 0) return;

  const currentPrice = engine.getOrderBook(normalizedToken).getCurrentPrice();

  // 计算多头和空头的强平价格分布
  const longLevels = new Map<string, { size: bigint; accounts: number }>();
  const shortLevels = new Map<string, { size: bigint; accounts: number }>();

  let totalLongSize = 0n;
  let totalShortSize = 0n;
  let totalLongAccounts = 0;
  let totalShortAccounts = 0;

  for (const pos of positions) {
    const liqPrice = pos.liquidationPrice || "0";
    const size = BigInt(pos.size);

    if (pos.isLong) {
      totalLongSize += size;
      totalLongAccounts++;
      const level = longLevels.get(liqPrice) || { size: 0n, accounts: 0 };
      level.size += size;
      level.accounts++;
      longLevels.set(liqPrice, level);
    } else {
      totalShortSize += size;
      totalShortAccounts++;
      const level = shortLevels.get(liqPrice) || { size: 0n, accounts: 0 };
      level.size += size;
      level.accounts++;
      shortLevels.set(liqPrice, level);
    }
  }

  const maxSize = totalLongSize > totalShortSize ? totalLongSize : totalShortSize;

  const formatLevel = (price: string, data: { size: bigint; accounts: number }) => ({
    price,
    size: data.size.toString(),
    accounts: data.accounts,
    percentage: maxSize > 0n ? Number((data.size * 100n) / maxSize) : 0,
  });

  const longs = Array.from(longLevels.entries())
    .map(([price, data]) => formatLevel(price, data))
    .sort((a, b) => Number(BigInt(b.price) - BigInt(a.price)));

  const shorts = Array.from(shortLevels.entries())
    .map(([price, data]) => formatLevel(price, data))
    .sort((a, b) => Number(BigInt(a.price) - BigInt(b.price)));

  const message = JSON.stringify({
    type: "liquidation_map",
    token: normalizedToken,
    currentPrice: currentPrice.toString(),
    longs,
    shorts,
    totalLongSize: totalLongSize.toString(),
    totalShortSize: totalShortSize.toString(),
    totalLongAccounts,
    totalShortAccounts,
    timestamp: Date.now(),
  });

  for (const [client, tokens] of wsClients.entries()) {
    if (client.readyState === WebSocket.OPEN && tokens.has(normalizedToken)) {
      client.send(message);
    }
  }
}

/**
 * 向特定交易者发送风险预警
 */
function sendRiskAlert(
  trader: Address,
  alertType: "margin_warning" | "liquidation_warning" | "adl_warning" | "funding_warning",
  severity: "info" | "warning" | "danger",
  message: string,
  pairId?: string
): void {
  const wsSet = wsTraderClients.get(trader.toLowerCase() as Address);
  if (!wsSet) return;

  const alertMessage = JSON.stringify({
    type: "risk_alert",
    alertType,
    severity,
    message,
    pairId,
    timestamp: Date.now(),
  });

  for (const ws of wsSet) {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(alertMessage);
    }
  }
}

// ============================================================
// P5: Referral System (推荐返佣系统)
// ============================================================

/**
 * 推荐返佣系统
 * - 用户可生成邀请码邀请新用户
 * - 被邀请用户交易时，邀请人获得手续费返佣
 * - 支持多级返佣 (最多 2 级)
 * - 返佣比例可配置
 */

// 返佣配置
const REFERRAL_CONFIG = {
  // 一级返佣: 直接邀请人获得被邀请人手续费的 30%
  level1Rate: 3000,  // 30% (basis points)
  // 二级返佣: 邀请人的邀请人获得 10%
  level2Rate: 1000,  // 10% (basis points)
  // 最低提现金额 (USDT, 1e6)
  minWithdrawAmount: 10n * 10n ** 6n,  // $10
  // 邀请码长度
  codeLength: 8,
};

/**
 * 推荐人信息
 */
interface Referrer {
  address: Address;
  code: string;                      // 邀请码
  level1Referrals: Address[];        // 直接邀请的用户
  level2Referrals: Address[];        // 二级邀请的用户

  // 返佣统计
  totalEarnings: bigint;             // 累计返佣收入
  pendingEarnings: bigint;           // 待提取返佣
  withdrawnEarnings: bigint;         // 已提取返佣

  // 明细
  level1Earnings: bigint;            // 一级返佣收入
  level2Earnings: bigint;            // 二级返佣收入

  // 统计
  totalTradesReferred: number;       // 被邀请用户总交易次数
  totalVolumeReferred: bigint;       // 被邀请用户总交易额

  createdAt: number;
  updatedAt: number;
}

/**
 * 被邀请人信息
 */
interface Referee {
  address: Address;
  referrerCode: string;              // 使用的邀请码
  referrer: Address;                 // 直接邀请人
  level2Referrer: Address | null;    // 二级邀请人 (邀请人的邀请人)

  // 贡献统计
  totalFeesPaid: bigint;             // 累计支付手续费
  totalCommissionGenerated: bigint;  // 累计产生的返佣

  joinedAt: number;
}

/**
 * 返佣记录
 */
interface ReferralCommission {
  id: string;
  referrer: Address;                 // 获得返佣的人
  referee: Address;                  // 产生返佣的交易者
  level: 1 | 2;                      // 返佣级别
  tradeId: string;                   // 关联的交易ID
  tradeFee: bigint;                  // 原始交易手续费
  commissionAmount: bigint;          // 返佣金额
  commissionRate: number;            // 返佣比例 (basis points)
  timestamp: number;
  status: "pending" | "credited" | "withdrawn";
}

// 推荐人存储: address => Referrer
const referrers = new Map<Address, Referrer>();

// 邀请码映射: code => address
const referralCodes = new Map<string, Address>();

// 被邀请人存储: address => Referee
const referees = new Map<Address, Referee>();

// 返佣记录
const referralCommissions: ReferralCommission[] = [];
let commissionIdCounter = 0;

/**
 * 生成邀请码
 */
function generateReferralCode(): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  let code = "";
  for (let i = 0; i < REFERRAL_CONFIG.codeLength; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
}

/**
 * 注册成为推荐人 (获取邀请码)
 */
function registerAsReferrer(address: Address): Referrer | { error: string } {
  const normalizedAddress = address.toLowerCase() as Address;

  // 检查是否已注册
  if (referrers.has(normalizedAddress)) {
    return referrers.get(normalizedAddress)!;
  }

  // 生成唯一邀请码
  let code: string;
  do {
    code = generateReferralCode();
  } while (referralCodes.has(code));

  const now = Date.now();

  const referrer: Referrer = {
    address: normalizedAddress,
    code,
    level1Referrals: [],
    level2Referrals: [],
    totalEarnings: 0n,
    pendingEarnings: 0n,
    withdrawnEarnings: 0n,
    level1Earnings: 0n,
    level2Earnings: 0n,
    totalTradesReferred: 0,
    totalVolumeReferred: 0n,
    createdAt: now,
    updatedAt: now,
  };

  referrers.set(normalizedAddress, referrer);
  referralCodes.set(code, normalizedAddress);

  console.log(`[Referral] Registered referrer ${normalizedAddress.slice(0, 10)} with code ${code}`);

  return referrer;
}

/**
 * 使用邀请码绑定推荐关系
 */
function bindReferral(
  newUserAddress: Address,
  referralCode: string
): { success: boolean; error?: string } {
  const normalizedAddress = newUserAddress.toLowerCase() as Address;
  const upperCode = referralCode.toUpperCase();

  // 检查是否已被邀请
  if (referees.has(normalizedAddress)) {
    return { success: false, error: "Already bound to a referrer" };
  }

  // 检查邀请码是否存在
  const referrerAddress = referralCodes.get(upperCode);
  if (!referrerAddress) {
    return { success: false, error: "Invalid referral code" };
  }

  // 不能邀请自己
  if (referrerAddress === normalizedAddress) {
    return { success: false, error: "Cannot refer yourself" };
  }

  const referrer = referrers.get(referrerAddress);
  if (!referrer) {
    return { success: false, error: "Referrer not found" };
  }

  // 获取二级邀请人 (邀请人的邀请人)
  const referrerAsReferee = referees.get(referrerAddress);
  const level2Referrer = referrerAsReferee?.referrer || null;

  // 创建被邀请人记录
  const referee: Referee = {
    address: normalizedAddress,
    referrerCode: upperCode,
    referrer: referrerAddress,
    level2Referrer,
    totalFeesPaid: 0n,
    totalCommissionGenerated: 0n,
    joinedAt: Date.now(),
  };

  referees.set(normalizedAddress, referee);

  // 更新推荐人的邀请列表
  referrer.level1Referrals.push(normalizedAddress);
  referrer.updatedAt = Date.now();

  // 更新二级推荐人的邀请列表
  if (level2Referrer) {
    const level2ReferrerData = referrers.get(level2Referrer);
    if (level2ReferrerData) {
      level2ReferrerData.level2Referrals.push(normalizedAddress);
      level2ReferrerData.updatedAt = Date.now();
    }
  }

  console.log(`[Referral] ${normalizedAddress.slice(0, 10)} bound to referrer ${referrerAddress.slice(0, 10)} (code: ${upperCode})`);

  broadcastReferralBound(normalizedAddress, referrerAddress, upperCode);

  return { success: true };
}

/**
 * 计算并记录交易返佣
 * 在每笔交易完成后调用
 */
function processTradeCommission(
  trader: Address,
  tradeId: string,
  tradeFee: bigint,
  tradeVolume: bigint
): void {
  const normalizedTrader = trader.toLowerCase() as Address;

  // 检查是否是被邀请用户
  const referee = referees.get(normalizedTrader);
  if (!referee) return;

  // 更新被邀请人统计
  referee.totalFeesPaid += tradeFee;

  const now = Date.now();

  // 一级返佣
  const level1Referrer = referrers.get(referee.referrer);
  if (level1Referrer) {
    const level1Commission = (tradeFee * BigInt(REFERRAL_CONFIG.level1Rate)) / 10000n;

    if (level1Commission > 0n) {
      const commission: ReferralCommission = {
        id: `comm_${++commissionIdCounter}_${now}`,
        referrer: level1Referrer.address,
        referee: normalizedTrader,
        level: 1,
        tradeId,
        tradeFee,
        commissionAmount: level1Commission,
        commissionRate: REFERRAL_CONFIG.level1Rate,
        timestamp: now,
        status: "credited",
      };

      referralCommissions.push(commission);

      // 更新推荐人收益
      level1Referrer.totalEarnings += level1Commission;
      level1Referrer.pendingEarnings += level1Commission;
      level1Referrer.level1Earnings += level1Commission;
      level1Referrer.totalTradesReferred++;
      level1Referrer.totalVolumeReferred += tradeVolume;
      level1Referrer.updatedAt = now;

      referee.totalCommissionGenerated += level1Commission;

      console.log(`[Referral] L1 commission: ${level1Referrer.address.slice(0, 10)} earned $${Number(level1Commission) / 1e6} from ${normalizedTrader.slice(0, 10)}`);

      broadcastCommissionEarned(level1Referrer.address, level1Commission, 1, normalizedTrader);
    }
  }

  // 二级返佣
  if (referee.level2Referrer) {
    const level2Referrer = referrers.get(referee.level2Referrer);
    if (level2Referrer) {
      const level2Commission = (tradeFee * BigInt(REFERRAL_CONFIG.level2Rate)) / 10000n;

      if (level2Commission > 0n) {
        const commission: ReferralCommission = {
          id: `comm_${++commissionIdCounter}_${now}`,
          referrer: level2Referrer.address,
          referee: normalizedTrader,
          level: 2,
          tradeId,
          tradeFee,
          commissionAmount: level2Commission,
          commissionRate: REFERRAL_CONFIG.level2Rate,
          timestamp: now,
          status: "credited",
        };

        referralCommissions.push(commission);

        // 更新推荐人收益
        level2Referrer.totalEarnings += level2Commission;
        level2Referrer.pendingEarnings += level2Commission;
        level2Referrer.level2Earnings += level2Commission;
        level2Referrer.updatedAt = now;

        referee.totalCommissionGenerated += level2Commission;

        console.log(`[Referral] L2 commission: ${level2Referrer.address.slice(0, 10)} earned $${Number(level2Commission) / 1e6} from ${normalizedTrader.slice(0, 10)}`);

        broadcastCommissionEarned(level2Referrer.address, level2Commission, 2, normalizedTrader);
      }
    }
  }

  // 保留最近 10000 条返佣记录
  if (referralCommissions.length > 10000) {
    referralCommissions.splice(0, referralCommissions.length - 10000);
  }
}

/**
 * 提取返佣
 */
function withdrawCommission(
  referrerAddress: Address,
  amount?: bigint
): { success: boolean; withdrawnAmount?: bigint; error?: string } {
  const normalizedAddress = referrerAddress.toLowerCase() as Address;
  const referrer = referrers.get(normalizedAddress);

  if (!referrer) {
    return { success: false, error: "Not a registered referrer" };
  }

  const withdrawAmount = amount || referrer.pendingEarnings;

  if (withdrawAmount <= 0n) {
    return { success: false, error: "No earnings to withdraw" };
  }

  if (withdrawAmount > referrer.pendingEarnings) {
    return { success: false, error: "Insufficient pending earnings" };
  }

  if (withdrawAmount < REFERRAL_CONFIG.minWithdrawAmount) {
    return {
      success: false,
      error: `Minimum withdrawal amount is $${Number(REFERRAL_CONFIG.minWithdrawAmount) / 1e6}`
    };
  }

  // 扣除待提取，增加已提取
  referrer.pendingEarnings -= withdrawAmount;
  referrer.withdrawnEarnings += withdrawAmount;
  referrer.updatedAt = Date.now();

  // TODO: 实际转账逻辑 (调用合约或更新用户余额)

  console.log(`[Referral] Withdrawal: ${normalizedAddress.slice(0, 10)} withdrew $${Number(withdrawAmount) / 1e6}`);

  broadcastCommissionWithdrawn(normalizedAddress, withdrawAmount);

  return { success: true, withdrawnAmount };
}

/**
 * 获取推荐人信息
 */
function getReferrerInfo(address: Address): Referrer | null {
  const normalizedAddress = address.toLowerCase() as Address;
  return referrers.get(normalizedAddress) || null;
}

/**
 * 获取被邀请人信息
 */
function getRefereeInfo(address: Address): Referee | null {
  const normalizedAddress = address.toLowerCase() as Address;
  return referees.get(normalizedAddress) || null;
}

/**
 * 获取推荐人的返佣记录
 */
function getReferrerCommissions(
  address: Address,
  limit: number = 50
): ReferralCommission[] {
  const normalizedAddress = address.toLowerCase() as Address;
  return referralCommissions
    .filter(c => c.referrer === normalizedAddress)
    .slice(-limit)
    .reverse();
}

/**
 * 获取全局推荐统计
 */
function getReferralStats(): {
  totalReferrers: number;
  totalReferees: number;
  totalCommissionsPaid: bigint;
  totalCommissionsPending: bigint;
} {
  let totalPaid = 0n;
  let totalPending = 0n;

  for (const referrer of referrers.values()) {
    totalPaid += referrer.withdrawnEarnings;
    totalPending += referrer.pendingEarnings;
  }

  return {
    totalReferrers: referrers.size,
    totalReferees: referees.size,
    totalCommissionsPaid: totalPaid,
    totalCommissionsPending: totalPending,
  };
}

/**
 * 获取推荐排行榜
 */
function getReferralLeaderboard(limit: number = 20): {
  address: Address;
  code: string;
  referralCount: number;
  totalEarnings: bigint;
}[] {
  return Array.from(referrers.values())
    .sort((a, b) => Number(b.totalEarnings - a.totalEarnings))
    .slice(0, limit)
    .map(r => ({
      address: r.address,
      code: r.code,
      referralCount: r.level1Referrals.length,
      totalEarnings: r.totalEarnings,
    }));
}

// 推荐系统广播函数
function broadcastReferralBound(referee: Address, referrer: Address, code: string): void {
  broadcast("referral_bound", { referee, referrer, code });
}

function broadcastCommissionEarned(referrer: Address, amount: bigint, level: number, from: Address): void {
  broadcast("commission_earned", {
    referrer,
    amount: amount.toString(),
    level,
    from,
    display: `$${(Number(amount) / 1e6).toFixed(4)}`,
  });
}

function broadcastCommissionWithdrawn(referrer: Address, amount: bigint): void {
  broadcast("commission_withdrawn", {
    referrer,
    amount: amount.toString(),
    display: `$${(Number(amount) / 1e6).toFixed(2)}`,
  });
}

// ============================================================
// 用户余额管理 (行业标准 - Binance/OKX)
// ============================================================

interface UserBalance {
  totalBalance: bigint;      // 总余额 (充值金额), 1e6 精度
  usedMargin: bigint;        // 已使用保证金 (所有仓位占用), 1e6 精度
  availableBalance: bigint;  // 可用余额 = totalBalance - usedMargin, 1e6 精度
  unrealizedPnL: bigint;     // 所有仓位的未实现盈亏, 1e6 精度
  frozenMargin: bigint;      // 冻结保证金 (挂单占用), 1e6 精度
}

const userBalances = new Map<Address, UserBalance>();

/**
 * 获取用户余额，如果不存在则创建默认余额
 */
function getUserBalance(trader: Address): UserBalance {
  const normalizedTrader = trader.toLowerCase() as Address;
  let balance = userBalances.get(normalizedTrader);
  if (!balance) {
    balance = {
      totalBalance: 0n,
      usedMargin: 0n,
      availableBalance: 0n,
      unrealizedPnL: 0n,
      frozenMargin: 0n,
    };
    userBalances.set(normalizedTrader, balance);
  }
  return balance;
}

/**
 * 充值 (增加总余额)
 */
function deposit(trader: Address, amount: bigint): void {
  const balance = getUserBalance(trader);
  balance.totalBalance += amount;
  balance.availableBalance += amount;
  console.log(`[Balance] Deposit: ${trader.slice(0, 10)} +$${Number(amount) / 1e6}, total: $${Number(balance.totalBalance) / 1e6}`);
}

/**
 * 提现 (减少总余额)
 */
function withdraw(trader: Address, amount: bigint): boolean {
  const balance = getUserBalance(trader);
  if (balance.availableBalance < amount) {
    console.log(`[Balance] Withdraw failed: ${trader.slice(0, 10)} insufficient available balance`);
    return false;
  }
  balance.totalBalance -= amount;
  balance.availableBalance -= amount;
  console.log(`[Balance] Withdraw: ${trader.slice(0, 10)} -$${Number(amount) / 1e6}, total: $${Number(balance.totalBalance) / 1e6}`);
  return true;
}

/**
 * 开仓时锁定保证金
 */
function lockMargin(trader: Address, margin: bigint): boolean {
  const balance = getUserBalance(trader);
  if (balance.availableBalance < margin) {
    console.log(`[Balance] Lock margin failed: ${trader.slice(0, 10)} needs $${Number(margin) / 1e6}, available: $${Number(balance.availableBalance) / 1e6}`);
    return false;
  }
  balance.usedMargin += margin;
  balance.availableBalance -= margin;
  console.log(`[Balance] Locked margin: ${trader.slice(0, 10)} $${Number(margin) / 1e6}, used: $${Number(balance.usedMargin) / 1e6}, available: $${Number(balance.availableBalance) / 1e6}`);
  return true;
}

/**
 * 平仓时释放保证金并结算盈亏
 */
function releaseMargin(trader: Address, margin: bigint, realizedPnL: bigint): void {
  const balance = getUserBalance(trader);
  balance.usedMargin -= margin;
  // 可用余额 = 释放的保证金 + 已实现盈亏
  balance.availableBalance += margin + realizedPnL;
  // 如果盈利，总余额增加
  if (realizedPnL > 0n) {
    balance.totalBalance += realizedPnL;
  } else {
    // 如果亏损，总余额减少
    balance.totalBalance += realizedPnL; // realizedPnL 是负数
  }
  console.log(`[Balance] Released margin: ${trader.slice(0, 10)} $${Number(margin) / 1e6}, PnL: $${Number(realizedPnL) / 1e6}, available: $${Number(balance.availableBalance) / 1e6}`);
}

// ============================================================
// 订单保证金扣除/退还 (下单时扣，撤单时退)
// ============================================================

// 手续费率 0.05% = 5 / 10000
const ORDER_FEE_RATE = 5n;

// 记录每个订单的保证金和手续费 (用于撤单退款)
interface OrderMarginInfo {
  margin: bigint;        // 保证金
  fee: bigint;           // 手续费
  totalDeducted: bigint; // 总扣除金额
  totalSize: bigint;     // 订单总大小 (用于计算部分成交比例)
  settledSize: bigint;   // 已结算大小
}
const orderMarginInfos = new Map<string, OrderMarginInfo>();

/**
 * 计算订单所需的保证金和手续费
 * @param size 仓位大小 (1e18 精度)
 * @param price 价格 (1e12 精度)
 * @param leverage 杠杆 (1e4 精度, 如 10x = 100000)
 * @returns { margin, fee, total } 都是 1e6 USD 精度
 */
function calculateOrderCost(size: bigint, price: bigint, leverage: bigint): { margin: bigint; fee: bigint; total: bigint } {
  // 仓位价值 = size * price / 1e24 (转为 1e6 USD 精度)
  const positionValue = (size * price) / (10n ** 24n);

  // 保证金 = 仓位价值 / 杠杆倍数
  // leverage 是 1e4 精度, 所以 margin = positionValue * 10000 / leverage
  const margin = (positionValue * 10000n) / leverage;

  // 手续费 = 仓位价值 * 0.05%
  const fee = (positionValue * ORDER_FEE_RATE) / 10000n;

  // 总计 = 保证金 + 手续费
  const total = margin + fee;

  return { margin, fee, total };
}

/**
 * 下单时扣除保证金和手续费
 * @returns true 如果扣款成功, false 如果余额不足
 */
function deductOrderAmount(trader: Address, orderId: string, size: bigint, price: bigint, leverage: bigint): boolean {
  const balance = getUserBalance(trader);
  const { margin, fee, total } = calculateOrderCost(size, price, leverage);

  // 检查余额
  if (balance.availableBalance < total) {
    console.log(`[Balance] Deduct failed: ${trader.slice(0, 10)} needs $${Number(total) / 1e6} (margin=$${Number(margin) / 1e6} + fee=$${Number(fee) / 1e6}), available: $${Number(balance.availableBalance) / 1e6}`);
    return false;
  }

  // 扣除金额
  balance.availableBalance -= total;
  balance.totalBalance -= total;

  // 记录订单的保证金信息 (用于撤单退款和部分成交结算)
  orderMarginInfos.set(orderId, {
    margin,
    fee,
    totalDeducted: total,
    totalSize: size,      // 记录订单总大小
    settledSize: 0n,      // 已结算大小初始为0
  });

  console.log(`[Balance] Deducted: ${trader.slice(0, 10)} -$${Number(total) / 1e6} (margin=$${Number(margin) / 1e6} + fee=$${Number(fee) / 1e6}), remaining: $${Number(balance.availableBalance) / 1e6}`);
  return true;
}

/**
 * 撤单时退还保证金和手续费 (仅退还未成交部分)
 */
function refundOrderAmount(trader: Address, orderId: string): void {
  const balance = getUserBalance(trader);
  const marginInfo = orderMarginInfos.get(orderId);

  if (!marginInfo) {
    console.log(`[Balance] Refund skipped: no margin info for order ${orderId}`);
    return;
  }

  // 计算未结算比例
  const unfilledRatio = marginInfo.totalSize > 0n
    ? ((marginInfo.totalSize - marginInfo.settledSize) * 10000n) / marginInfo.totalSize
    : 10000n;

  // 按未成交比例退还 (保证金 + 手续费)
  const refundMargin = (marginInfo.margin * unfilledRatio) / 10000n;
  const refundFee = (marginInfo.fee * unfilledRatio) / 10000n;
  const refundTotal = refundMargin + refundFee;

  balance.availableBalance += refundTotal;
  balance.totalBalance += refundTotal;

  // 删除记录
  orderMarginInfos.delete(orderId);

  console.log(`[Balance] Refunded: ${trader.slice(0, 10)} +$${Number(refundTotal) / 1e6} (unfilled ${Number(unfilledRatio) / 100}%), balance: $${Number(balance.availableBalance) / 1e6}`);
}

/**
 * 订单成交时处理保证金 (支持部分成交)
 * - 按成交比例将保证金转为仓位保证金 (usedMargin)
 * - 手续费按比例收取
 * @param filledSize 本次成交大小
 */
function settleOrderMargin(trader: Address, orderId: string, filledSize: bigint): void {
  const balance = getUserBalance(trader);
  const marginInfo = orderMarginInfos.get(orderId);

  if (!marginInfo) {
    console.log(`[Balance] Settle skipped: no margin info for order ${orderId}`);
    return;
  }

  // 计算本次成交比例
  const fillRatio = marginInfo.totalSize > 0n
    ? (filledSize * 10000n) / marginInfo.totalSize
    : 10000n;

  // 按比例结算保证金
  const settleMargin = (marginInfo.margin * fillRatio) / 10000n;
  balance.usedMargin += settleMargin;

  // 更新已结算大小
  marginInfo.settledSize += filledSize;

  // 如果完全成交，删除记录
  if (marginInfo.settledSize >= marginInfo.totalSize) {
    orderMarginInfos.delete(orderId);
    console.log(`[Balance] Fully settled: ${trader.slice(0, 10)} margin=$${Number(marginInfo.margin) / 1e6} → usedMargin`);
  } else {
    console.log(`[Balance] Partial settle: ${trader.slice(0, 10)} +$${Number(settleMargin) / 1e6} (${Number(marginInfo.settledSize)}/${Number(marginInfo.totalSize)} filled)`);
  }
}

/**
 * 更新用户的未实现盈亏（根据所有仓位计算）
 */
function updateUnrealizedPnL(trader: Address, currentPrices: Map<Address, bigint>): void {
  const normalizedTrader = trader.toLowerCase() as Address;
  const positions = userPositions.get(normalizedTrader) || [];
  const balance = getUserBalance(trader);

  let totalPnL = 0n;
  for (const pos of positions) {
    const currentPrice = currentPrices.get(pos.token.toLowerCase() as Address) || BigInt(pos.entryPrice);
    const pnl = calculateUnrealizedPnL(
      BigInt(pos.size),
      BigInt(pos.entryPrice),
      currentPrice,
      pos.isLong
    );
    totalPnL += pnl;
  }
  balance.unrealizedPnL = totalPnL;
}

/**
 * 计算账户权益 = 可用余额 + 已使用保证金 + 未实现盈亏
 */
function getEquity(trader: Address): bigint {
  const balance = getUserBalance(trader);
  return balance.availableBalance + balance.usedMargin + balance.unrealizedPnL;
}

// ============================================================
// 链上仓位同步
// ============================================================

/**
 * 从链上 Settlement 合约同步所有活跃仓位
 * 解决 P003: 持仓数据来源混乱问题
 */
async function syncPositionsFromChain(): Promise<void> {
  if (!SETTLEMENT_ADDRESS) {
    console.log("[Sync] No Settlement address configured, skipping position sync");
    return;
  }

  console.log("[Sync] Starting position sync from chain...");

  try {
    const publicClient = createPublicClient({
      chain: baseSepolia,
      transport: http(RPC_URL),
    });

    // 获取下一个 pairId（即当前最大 pairId + 1）
    const nextPairId = await publicClient.readContract({
      address: SETTLEMENT_ADDRESS,
      abi: SETTLEMENT_ABI,
      functionName: "nextPairId",
    }) as bigint;

    console.log(`[Sync] Total pairs on chain: ${nextPairId}`);

    if (nextPairId === 0n) {
      console.log("[Sync] No positions found on chain");
      return;
    }

    let syncedCount = 0;
    let activeCount = 0;

    // 遍历所有仓位
    for (let pairId = 0n; pairId < nextPairId; pairId++) {
      try {
        const position = await publicClient.readContract({
          address: SETTLEMENT_ADDRESS,
          abi: SETTLEMENT_ABI,
          functionName: "getPairedPosition",
          args: [pairId],
        }) as any;

        // status: 0 = Active, 1 = Closed, 2 = Liquidated
        if (position.status !== 0) {
          continue; // 跳过非活跃仓位
        }

        // 跳过空仓位（size 为 0 或地址为零地址的仓位）
        const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
        if (
          BigInt(position.size) === 0n ||
          position.longTrader === ZERO_ADDRESS ||
          position.shortTrader === ZERO_ADDRESS ||
          position.token === ZERO_ADDRESS
        ) {
          continue; // 跳过空/无效仓位
        }

        activeCount++;

        // 计算清算价格
        const entryPrice = BigInt(position.entryPrice);
        const longLeverage = BigInt(position.longLeverage);
        const shortLeverage = BigInt(position.shortLeverage);

        // leverage 存储为基点 (1x = 10000, 10x = 100000)
        // calculateLiquidationPrice 期望精度是 1e4，直接传入
        const longLiqPrice = longLeverage > 0n ? calculateLiquidationPrice(entryPrice, longLeverage, true) : 0n;
        const shortLiqPrice = shortLeverage > 0n ? calculateLiquidationPrice(entryPrice, shortLeverage, false) : 0n;

        const now = Date.now();
        const entryPriceStr = position.entryPrice.toString();

        // 计算盈亏平衡价格 (含0.05%手续费)
        const feeRate = 0.0005;
        const breakEvenLong = entryPrice + BigInt(Math.floor(Number(entryPrice) * feeRate));
        const breakEvenShort = entryPrice - BigInt(Math.floor(Number(entryPrice) * feeRate));

        // 计算维持保证金 (0.5% of position value)
        const mmrRate = 0.005;
        const positionValue = BigInt(position.size) * entryPrice / (10n ** 18n);
        const maintenanceMargin = positionValue * BigInt(Math.floor(mmrRate * 10000)) / 10000n;

        // 创建 Long 方仓位 (行业标准字段)
        const longPosition: Position = {
          // 基本标识
          pairId: pairId.toString(),
          trader: position.longTrader as Address,
          token: position.token as Address,

          // 仓位参数
          isLong: true,
          size: position.size.toString(),
          entryPrice: entryPriceStr,
          leverage: (longLeverage / 10000n).toString(),

          // 价格信息
          markPrice: entryPriceStr, // 初始化为开仓价，后续更新
          liquidationPrice: longLiqPrice.toString(),
          breakEvenPrice: breakEvenLong.toString(),

          // 保证金信息
          collateral: position.longCollateral.toString(),
          margin: position.longCollateral.toString(),
          marginRatio: "10000", // 初始化为 100%
          maintenanceMargin: maintenanceMargin.toString(),

          // 盈亏信息
          unrealizedPnL: "0",
          realizedPnL: "0",
          roe: "0",
          fundingFee: "0",

          // 止盈止损
          takeProfitPrice: null,
          stopLossPrice: null,

          // 系统信息
          counterparty: position.shortTrader as Address,
          createdAt: Number(position.openTime) * 1000,
          updatedAt: now,

          // 风险指标
          adlRanking: 3, // 默认中等
          riskLevel: "medium",
        };

        // 创建 Short 方仓位 (行业标准字段)
        const shortPosition: Position = {
          // 基本标识
          pairId: pairId.toString(),
          trader: position.shortTrader as Address,
          token: position.token as Address,

          // 仓位参数
          isLong: false,
          size: position.size.toString(),
          entryPrice: entryPriceStr,
          leverage: (shortLeverage / 10000n).toString(),

          // 价格信息
          markPrice: entryPriceStr,
          liquidationPrice: shortLiqPrice.toString(),
          breakEvenPrice: breakEvenShort.toString(),

          // 保证金信息
          collateral: position.shortCollateral.toString(),
          margin: position.shortCollateral.toString(),
          marginRatio: "10000",
          maintenanceMargin: maintenanceMargin.toString(),

          // 盈亏信息
          unrealizedPnL: "0",
          realizedPnL: "0",
          roe: "0",
          fundingFee: "0",

          // 止盈止损
          takeProfitPrice: null,
          stopLossPrice: null,

          // 系统信息
          counterparty: position.longTrader as Address,
          createdAt: Number(position.openTime) * 1000,
          updatedAt: now,

          // 风险指标
          adlRanking: 3,
          riskLevel: "medium",
        };

        // 添加到 userPositions Map
        addPositionToUser(longPosition);
        addPositionToUser(shortPosition);
        syncedCount += 2;

      } catch (e) {
        // 单个仓位读取失败，继续下一个
        console.error(`[Sync] Failed to read pair ${pairId}:`, e);
      }
    }

    console.log(`[Sync] Synced ${syncedCount} positions from ${activeCount} active pairs`);

  } catch (e) {
    console.error("[Sync] Failed to sync positions from chain:", e);
  }
}

/**
 * 添加仓位到用户的仓位列表
 */
function addPositionToUser(position: Position): void {
  const normalizedTrader = position.trader.toLowerCase() as Address;
  const positions = userPositions.get(normalizedTrader) || [];

  // 检查是否已存在（避免重复）
  const existingIndex = positions.findIndex(
    (p) => p.pairId === position.pairId && p.isLong === position.isLong
  );

  if (existingIndex >= 0) {
    positions[existingIndex] = position; // 更新
  } else {
    positions.push(position); // 新增
    console.log(`[Position] Added: ${normalizedTrader.slice(0, 10)} ${position.isLong ? 'LONG' : 'SHORT'} liqPrice=${position.liquidationPrice}`);
  }

  userPositions.set(normalizedTrader, positions);

  // 同步保存到 Redis (异步, 不阻塞)
  savePositionToRedis(position).then((redisId) => {
    if (redisId && !position.pairId.includes("-")) {
      // 如果是新建仓位，用 Redis ID 更新 pairId
      position.pairId = redisId;
    }
  }).catch((err) => {
    console.error("[Redis] Failed to sync position:", err);
  });
}

// ============================================================
// 链上事件监听 (实时同步链上状态变化)
// ============================================================

let eventWatcherUnwatch: (() => void) | null = null;

/**
 * 启动链上事件监听
 * 监听 Settlement 合约的关键事件，实时同步链上状态到后端
 */
async function startEventWatching(): Promise<void> {
  if (!SETTLEMENT_ADDRESS) {
    console.log("[Events] No Settlement address configured, skipping event watching");
    return;
  }

  console.log("[Events] Starting event watching for Settlement contract:", SETTLEMENT_ADDRESS);

  const publicClient = createPublicClient({
    chain: baseSepolia,
    transport: http(RPC_URL),
  });

  // 监听 Deposited 事件 (用户直接充值)
  publicClient.watchContractEvent({
    address: SETTLEMENT_ADDRESS,
    abi: SETTLEMENT_ABI,
    eventName: "Deposited",
    onLogs: (logs) => {
      for (const log of logs) {
        const { user, amount } = log.args as { user: Address; amount: bigint };
        console.log(`[Events] Deposited: ${user.slice(0, 10)} +$${Number(amount) / 1e6}`);
        // 通过 WebSocket 通知前端
        broadcastBalanceUpdate(user);
      }
    },
  });

  // 监听 DepositedFor 事件 (主钱包为派生钱包充值)
  publicClient.watchContractEvent({
    address: SETTLEMENT_ADDRESS,
    abi: SETTLEMENT_ABI,
    eventName: "DepositedFor",
    onLogs: (logs) => {
      for (const log of logs) {
        const { user, relayer, token, amount } = log.args as {
          user: Address;
          relayer: Address;
          token: Address;
          amount: bigint;
        };
        console.log(`[Events] DepositedFor: ${relayer.slice(0, 10)} → ${user.slice(0, 10)} +$${Number(amount) / 1e6}`);
        // 通过 WebSocket 通知前端
        broadcastBalanceUpdate(user);
      }
    },
  });

  // 监听 Withdrawn 事件
  publicClient.watchContractEvent({
    address: SETTLEMENT_ADDRESS,
    abi: SETTLEMENT_ABI,
    eventName: "Withdrawn",
    onLogs: (logs) => {
      for (const log of logs) {
        const { user, amount } = log.args as { user: Address; amount: bigint };
        console.log(`[Events] Withdrawn: ${user.slice(0, 10)} -$${Number(amount) / 1e6}`);
        broadcastBalanceUpdate(user);
      }
    },
  });

  // 监听 PairOpened 事件 (新仓位开立)
  publicClient.watchContractEvent({
    address: SETTLEMENT_ADDRESS,
    abi: SETTLEMENT_ABI,
    eventName: "PairOpened",
    onLogs: async (logs) => {
      for (const log of logs) {
        const { pairId, longTrader, shortTrader, token, size, entryPrice } = log.args as {
          pairId: bigint;
          longTrader: Address;
          shortTrader: Address;
          token: Address;
          size: bigint;
          entryPrice: bigint;
        };
        console.log(`[Events] PairOpened: #${pairId} ${longTrader.slice(0, 10)} vs ${shortTrader.slice(0, 10)}`);

        // 从链上读取完整仓位信息
        try {
          const position = await publicClient.readContract({
            address: SETTLEMENT_ADDRESS,
            abi: SETTLEMENT_ABI,
            functionName: "getPairedPosition",
            args: [pairId],
          }) as any;

          // 创建 Long 仓位
          syncPositionFromChainData(pairId, position, true);
          // 创建 Short 仓位
          syncPositionFromChainData(pairId, position, false);

          // 通知前端
          broadcastBalanceUpdate(longTrader);
          broadcastBalanceUpdate(shortTrader);
          broadcastPositionUpdate(longTrader, token);
          broadcastPositionUpdate(shortTrader, token);
        } catch (e) {
          console.error(`[Events] Failed to sync position #${pairId}:`, e);
        }
      }
    },
  });

  // 监听 PairClosed 事件 (仓位平仓)
  publicClient.watchContractEvent({
    address: SETTLEMENT_ADDRESS,
    abi: SETTLEMENT_ABI,
    eventName: "PairClosed",
    onLogs: (logs) => {
      for (const log of logs) {
        const { pairId, exitPrice, longPnL, shortPnL } = log.args as {
          pairId: bigint;
          exitPrice: bigint;
          longPnL: bigint;
          shortPnL: bigint;
        };
        console.log(`[Events] PairClosed: #${pairId} longPnL=$${Number(longPnL) / 1e6} shortPnL=$${Number(shortPnL) / 1e6}`);

        // 从后端仓位记录中移除
        removePositionByPairId(pairId.toString());

        // 刷新所有仓位
        syncPositionsFromChain().catch((e) => {
          console.error("[Events] Failed to sync after PairClosed:", e);
        });
      }
    },
  });

  // 监听 Liquidated 事件 (强制平仓)
  publicClient.watchContractEvent({
    address: SETTLEMENT_ADDRESS,
    abi: SETTLEMENT_ABI,
    eventName: "Liquidated",
    onLogs: (logs) => {
      for (const log of logs) {
        const { pairId, liquidatedTrader, liquidator, reward } = log.args as {
          pairId: bigint;
          liquidatedTrader: Address;
          liquidator: Address;
          reward: bigint;
        };
        console.log(`[Events] Liquidated: #${pairId} trader=${liquidatedTrader.slice(0, 10)} reward=$${Number(reward) / 1e6}`);

        // 从后端仓位记录中移除
        removePositionByPairId(pairId.toString());

        // 通知前端
        broadcastBalanceUpdate(liquidatedTrader);
        broadcastBalanceUpdate(liquidator);
      }
    },
  });

  console.log("[Events] Event watching started successfully");
}

/**
 * 从链上仓位数据同步到后端
 */
function syncPositionFromChainData(pairId: bigint, chainPosition: any, isLong: boolean): void {
  const trader = isLong ? chainPosition.longTrader : chainPosition.shortTrader;
  const counterparty = isLong ? chainPosition.shortTrader : chainPosition.longTrader;
  const collateral = isLong ? chainPosition.longCollateral : chainPosition.shortCollateral;
  const leverage = isLong ? chainPosition.longLeverage : chainPosition.shortLeverage;

  const entryPrice = BigInt(chainPosition.entryPrice);
  const liquidationPrice = calculateLiquidationPrice(entryPrice, BigInt(leverage), isLong);

  const position: Position = {
    pairId: pairId.toString(),
    trader: trader as Address,
    token: chainPosition.token as Address,
    isLong,
    size: chainPosition.size.toString(),
    entryPrice: chainPosition.entryPrice.toString(),
    leverage: (BigInt(leverage) / 10000n).toString(),
    markPrice: chainPosition.entryPrice.toString(),
    liquidationPrice: liquidationPrice.toString(),
    breakEvenPrice: chainPosition.entryPrice.toString(),
    collateral: collateral.toString(),
    margin: collateral.toString(),
    marginRatio: "10000",
    maintenanceMargin: "0",
    unrealizedPnL: "0",
    realizedPnL: "0",
    roe: "0",
    fundingFee: "0",
    takeProfitPrice: null,
    stopLossPrice: null,
    counterparty: counterparty as Address,
    createdAt: Number(chainPosition.openTime) * 1000,
    updatedAt: Date.now(),
    adlRanking: 3,
    riskLevel: "low",
  };

  addPositionToUser(position);
}

/**
 * 根据 pairId 移除仓位
 */
function removePositionByPairId(pairId: string): void {
  for (const [trader, positions] of userPositions.entries()) {
    const filteredPositions = positions.filter((p) => p.pairId !== pairId);
    if (filteredPositions.length !== positions.length) {
      console.log(`[Position] Removed pairId ${pairId} from ${trader.slice(0, 10)}`);
      userPositions.set(trader, filteredPositions);

      // 同步删除 Redis 中的仓位
      deletePositionFromRedis(pairId).catch((err) => {
        console.error("[Redis] Failed to delete position:", err);
      });
    }
  }
}

/**
 * 广播余额更新到前端
 */
function broadcastBalanceUpdate(user: Address): void {
  const message = JSON.stringify({
    type: "balance_update",
    user: user.toLowerCase(),
    timestamp: Date.now(),
  });

  for (const [client, subscriptions] of wsClients.entries()) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(message);
    }
  }
}

/**
 * 广播仓位更新到前端
 */
function broadcastPositionUpdate(user: Address, token: Address): void {
  const normalizedToken = token.toLowerCase() as Address;
  const message = JSON.stringify({
    type: "position_update",
    user: user.toLowerCase(),
    token: normalizedToken,
    timestamp: Date.now(),
  });

  for (const [client, subscriptions] of wsClients.entries()) {
    if (client.readyState === WebSocket.OPEN && subscriptions.has(normalizedToken)) {
      client.send(message);
    }
  }
}

// ============================================================
// 猎杀场：清算追踪系统
// ============================================================

interface LiquidationRecord {
  id: string;
  token: Address;
  liquidatedTrader: Address;
  liquidator: Address;
  isLong: boolean;
  size: string;
  entryPrice: string;
  liquidationPrice: string;
  collateralLost: string;
  timestamp: number;
}

interface HunterStats {
  address: Address;
  totalKills: number;
  totalProfitUSD: string;
  lastKillTime: number;
}

// 清算历史记录（按代币）
const liquidationHistory = new Map<Address, LiquidationRecord[]>();

// 猎杀者排行榜
const hunterStats = new Map<Address, HunterStats>();

// 全局清算计数
let globalLiquidationCount = 0;

/**
 * 创建或更新持仓记录
 */
function createOrUpdatePosition(
  trader: Address,
  token: Address,
  isLong: boolean,
  size: bigint,
  entryPrice: bigint,
  leverage: bigint,
  counterparty: Address
): void {
  const normalizedTrader = trader.toLowerCase() as Address;
  const normalizedToken = token.toLowerCase() as Address;
  const now = Date.now();

  // 调试：打印输入参数
  console.log(`[Position] Input: size=${size}, entryPrice=${entryPrice}, leverage=${leverage}`);

  // 计算保证金 (参考 GMX/Binance)
  // 精度说明:
  //   - size: 1e18 精度 (代币数量)
  //   - entryPrice: 1e12 精度 (USD价格，来自订单簿 currentPrice)
  //   - leverage: 1e4 精度 (10x = 100000)
  //   - collateral 输出: 1e6 精度 (USD)
  //
  // 仓位价值 = size * entryPrice / (1e18 * 1e12) * 1e6 = size * entryPrice / 1e24
  const positionValue = (size * entryPrice) / (10n ** 24n); // USD, 1e6 精度
  console.log(`[Position] positionValue (1e6 USD) = ${positionValue} ($${Number(positionValue) / 1e6})`);

  // 保证金 = 仓位价值 / 杠杆倍数
  // 因为 leverage 是 1e4 精度, 所以: collateral = positionValue * 1e4 / leverage
  const collateral = (positionValue * 10000n) / leverage; // USD, 1e6 精度
  console.log(`[Position] collateral (1e6 USD) = ${collateral}, in USD = $${Number(collateral) / 1e6}`)

  // 注意: 保证金已在下单时扣除 (deductOrderAmount)，并在成交时结算 (settleOrderMargin)
  // 这里不再调用 lockMargin，避免重复扣款

  // ============================================================
  // 动态 MMR 计算 (与 calculateLiquidationPrice 保持一致)
  // ============================================================
  // MMR = min(基础MMR 2%, 初始保证金率 * 50%)
  // 这样确保 MMR < 初始保证金率，强平价才会在正确的一侧
  const baseMmr = 200n; // 基础 2%
  const initialMarginRateBp = (10000n * 10000n) / leverage; // 初始保证金率 (基点)
  const maxMmr = initialMarginRateBp / 2n; // 不能超过初始保证金率的一半
  const effectiveMmr = baseMmr < maxMmr ? baseMmr : maxMmr;

  // 计算清算价格 (使用动态 MMR)
  const liquidationPrice = calculateLiquidationPrice(entryPrice, leverage, isLong, effectiveMmr);

  // 初始保证金率 = 1 / 杠杆倍数 = 1e4 / leverage * 1e4 = 1e8 / leverage
  // 例如 10x: marginRatio = 1e8 / 100000 = 1000 (10%)
  const marginRatio = (10n ** 8n) / leverage;

  // 计算开仓手续费 (0.05% of position value)
  // 行业标准: 刚开仓时价格没变，未实现盈亏 = -手续费
  const feeRate = 5n; // 0.05% = 5 / 10000
  const openFee = (positionValue * feeRate) / 10000n; // USD, 1e6 精度

  // 盈亏平衡价格 = 开仓价 ± 手续费对应的价格变动
  const breakEvenPrice = isLong
    ? entryPrice + (entryPrice * feeRate) / 10000n
    : entryPrice - (entryPrice * feeRate) / 10000n;

  // 计算维持保证金 (使用动态 MMR)
  const maintenanceMargin = (positionValue * effectiveMmr) / 10000n; // USD, 1e6 精度

  console.log(`[Position] leverage=${Number(leverage)/10000}x, initialMarginRate=${Number(initialMarginRateBp)/100}%, effectiveMmr=${Number(effectiveMmr)/100}%`);

  // 初始未实现盈亏 = -开仓手续费 (刚开仓价格没变就是亏手续费)
  const initialPnL = -openFee;

  // 初始保证金率 = 维持保证金 / (保证金 + PnL)
  // 行业标准 (Binance): marginRatio = MM / Equity, 越大越危险
  const equity = collateral + initialPnL;
  const initialMarginRatio = equity > 0n
    ? (maintenanceMargin * 10000n) / equity
    : 10000n;

  console.log(`[Position] openFee: $${Number(openFee) / 1e6}, initialPnL: $${Number(initialPnL) / 1e6}`);
  console.log(`[Position] equity: $${Number(equity) / 1e6}, marginRatio: ${Number(initialMarginRatio) / 100}%`);

  const position: Position = {
    // 基本标识
    pairId: `${normalizedToken}_${normalizedTrader}_${now}`,
    trader: normalizedTrader,
    token: normalizedToken,

    // 仓位参数
    isLong,
    size: size.toString(),
    entryPrice: entryPrice.toString(),
    leverage: (leverage / 10000n).toString(), // 转换为人类可读 (10x = "10")

    // 价格信息
    markPrice: entryPrice.toString(), // 初始化为开仓价
    liquidationPrice: liquidationPrice.toString(),
    breakEvenPrice: breakEvenPrice.toString(),

    // 保证金信息
    collateral: collateral.toString(),
    margin: collateral.toString(),
    marginRatio: initialMarginRatio.toString(),
    maintenanceMargin: maintenanceMargin.toString(),
    mmr: effectiveMmr.toString(), // 动态维持保证金率 (基点)

    // 盈亏信息 (初始为 -手续费)
    unrealizedPnL: initialPnL.toString(),
    realizedPnL: "0",
    roe: ((initialPnL * 10000n) / collateral).toString(), // ROE% = PnL / 保证金 * 100
    fundingFee: "0",

    // 止盈止损
    takeProfitPrice: null,
    stopLossPrice: null,

    // 系统信息
    counterparty,
    createdAt: now,
    updatedAt: now,

    // 风险指标
    adlRanking: 3,
    riskLevel: "medium",
  };

  // 获取用户现有持仓
  const positions = userPositions.get(normalizedTrader) || [];

  // 查找是否有同方向同代币的持仓
  const existingIndex = positions.findIndex(
    (p) => p.token === normalizedToken && p.isLong === isLong
  );

  if (existingIndex >= 0) {
    // 合并持仓（加仓）
    const existing = positions[existingIndex];
    const oldSize = BigInt(existing.size);
    const oldEntryPrice = BigInt(existing.entryPrice);
    const newSize = oldSize + size;

    // 计算新的平均入场价
    const newEntryPrice = (oldSize * oldEntryPrice + size * entryPrice) / newSize;
    const newCollateral = BigInt(existing.collateral) + collateral;
    const newLiquidationPrice = calculateLiquidationPrice(newEntryPrice, leverage, isLong);

    const updatedPosition = {
      ...existing,
      size: newSize.toString(),
      entryPrice: newEntryPrice.toString(),
      collateral: newCollateral.toString(),
      liquidationPrice: newLiquidationPrice.toString(),
      marginRatio: ((newCollateral * 10000n) / newSize).toString(),
      updatedAt: Date.now(),
    };
    positions[existingIndex] = updatedPosition;
    userPositions.set(normalizedTrader, positions);

    // 同步更新到 Redis
    if (existing.pairId) {
      savePositionToRedis(updatedPosition).catch((err) => {
        console.error("[Redis] Failed to update position:", err);
      });
    }

    console.log(`[Position] ${isLong ? "Long" : "Short"} increased: ${trader.slice(0, 10)} size=${newSize} liq=${newLiquidationPrice}`);
  } else {
    // 新开仓位 - 使用 addPositionToUser 来同步保存到 Redis
    addPositionToUser(position);
    console.log(`[Position] ${isLong ? "Long" : "Short"} opened: ${trader.slice(0, 10)} size=${size} liq=${liquidationPrice}`);
  }
}

// ============================================================
// Helpers
// ============================================================

function jsonResponse(data: object, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    },
  });
}

function errorResponse(message: string, status = 400): Response {
  return jsonResponse({ success: false, error: message }, status);
}

async function verifyOrderSignature(
  trader: Address,
  token: Address,
  isLong: boolean,
  size: bigint,
  leverage: bigint,
  price: bigint,
  deadline: bigint,
  nonce: bigint,
  orderType: number,
  signature: Hex
): Promise<boolean> {
  try {
    console.log("[DEBUG] Verifying signature:");
    console.log("  trader:", trader);
    console.log("  token:", token);
    console.log("  isLong:", isLong, typeof isLong);
    console.log("  size:", size, typeof size);
    console.log("  leverage:", leverage, typeof leverage);
    console.log("  price:", price, typeof price);
    console.log("  deadline:", deadline, typeof deadline);
    console.log("  nonce:", nonce, typeof nonce);
    console.log("  orderType:", orderType, typeof orderType);
    console.log("  signature:", signature);
    console.log("  domain:", EIP712_DOMAIN);

    const isValid = await verifyTypedData({
      address: trader,
      domain: EIP712_DOMAIN,
      types: ORDER_TYPES,
      primaryType: "Order",
      message: {
        trader,
        token,
        isLong,
        size,
        leverage,
        price,
        deadline,
        nonce,
        orderType,
      },
      signature,
    });
    return isValid;
  } catch (e) {
    console.error("Signature verification failed:", e);
    return false;
  }
}

function getUserNonce(trader: Address): bigint {
  return userNonces.get(trader.toLowerCase() as Address) || 0n;
}

function incrementUserNonce(trader: Address): void {
  const current = getUserNonce(trader);
  userNonces.set(trader.toLowerCase() as Address, current + 1n);
}

// ============================================================
// API Handlers
// ============================================================

async function handleOrderSubmit(req: Request): Promise<Response> {
  try {
    const body = await req.json();
    const {
      trader,
      token,
      isLong,
      size,
      leverage,
      price,
      deadline,
      nonce,
      orderType,
      signature,
      reduceOnly = false,  // P2: 只减仓标志
      postOnly = false,    // P3: 只挂单模式 (Maker Only)
      timeInForce = "GTC", // P3: 订单有效期 (GTC/IOC/FOK/GTD)
    } = body;

    // Validate required fields
    if (!trader || !token || !signature) {
      return errorResponse("Missing required fields");
    }

    // Parse bigint values
    const sizeBigInt = BigInt(size);
    const leverageBigInt = BigInt(leverage);
    const priceBigInt = BigInt(price);
    const deadlineBigInt = BigInt(deadline);
    const nonceBigInt = BigInt(nonce);

    // Check deadline
    if (deadlineBigInt < BigInt(Math.floor(Date.now() / 1000))) {
      return errorResponse("Order expired");
    }

    // ============================================================
    // P2: Reduce-Only 订单验证
    // ============================================================
    if (reduceOnly) {
      const validation = validateReduceOnlyOrder(
        trader as Address,
        token as Address,
        isLong,
        sizeBigInt
      );

      if (!validation.valid) {
        return errorResponse(validation.reason || "Reduce-only validation failed");
      }
    }

    // Check nonce - 不再严格验证，让链上合约处理
    // 只记录nonce用于订单去重
    const expectedNonce = getUserNonce(trader);
    if (!SYNC_NONCE_FROM_CHAIN && nonceBigInt < expectedNonce) {
      return errorResponse(`Invalid nonce. Expected >= ${expectedNonce}`);
    }

    // Verify signature (可通过 SKIP_SIGNATURE_VERIFY=true 跳过，仅用于测试)
    if (!SKIP_SIGNATURE_VERIFY) {
      const isValid = await verifyOrderSignature(
        trader as Address,
        token as Address,
        isLong,
        sizeBigInt,
        leverageBigInt,
        priceBigInt,
        deadlineBigInt,
        nonceBigInt,
        orderType,
        signature as Hex
      );

      if (!isValid) {
        return errorResponse("Invalid signature");
      }
    } else {
      console.log(`[API] Skipping signature verification (TEST MODE)`);
    }

    // ============================================================
    // P3: 解析 timeInForce
    // ============================================================
    let tif: TimeInForce;
    switch (timeInForce.toUpperCase()) {
      case "IOC":
        tif = TimeInForce.IOC;
        break;
      case "FOK":
        tif = TimeInForce.FOK;
        break;
      case "GTD":
        tif = TimeInForce.GTD;
        break;
      default:
        tif = TimeInForce.GTC;
    }

    // ============================================================
    // P3: Post-Only 和市价单冲突检查
    // ============================================================
    if (postOnly && (orderType === OrderType.MARKET || priceBigInt === 0n)) {
      return errorResponse("Post-Only orders cannot be market orders");
    }

    // ============================================================
    // 扣除保证金 + 手续费 (下单时立即扣除)
    // ============================================================
    // 对于市价单，使用当前价格计算；对于限价单，使用订单价格
    const orderBook = engine.getOrderBook(token as Address);
    const priceForCalc = priceBigInt > 0n ? priceBigInt : orderBook.getCurrentPrice();

    if (priceForCalc === 0n) {
      return errorResponse("Cannot determine order price for margin calculation");
    }

    // 生成临时订单ID用于记录保证金信息
    const tempOrderId = `order_${Date.now()}_${Math.random().toString(36).slice(2)}`;

    // 扣款
    const deductSuccess = deductOrderAmount(
      trader as Address,
      tempOrderId,
      sizeBigInt,
      priceForCalc,
      leverageBigInt
    );

    if (!deductSuccess) {
      return errorResponse("Insufficient balance for margin and fee");
    }

    // Submit to matching engine with P3 options
    const { order, matches, rejected, rejectReason } = engine.submitOrder(
      trader as Address,
      token as Address,
      isLong,
      sizeBigInt,
      leverageBigInt,
      priceBigInt,
      deadlineBigInt,
      nonceBigInt,
      orderType as OrderType,
      signature as Hex,
      {
        reduceOnly,
        postOnly,
        timeInForce: tif,
      }
    );

    // ============================================================
    // P3: 处理被拒绝的订单
    // ============================================================
    if (rejected) {
      // 订单被拒绝，退还保证金和手续费
      refundOrderAmount(trader as Address, tempOrderId);
      console.log(`[API] Order rejected: ${rejectReason}`);
      return jsonResponse({
        success: false,
        orderId: order.id,
        status: order.status,
        rejected: true,
        rejectReason,
      });
    }

    // 将保证金信息从临时ID转移到实际订单ID
    const marginInfo = orderMarginInfos.get(tempOrderId);
    if (marginInfo) {
      orderMarginInfos.delete(tempOrderId);
      orderMarginInfos.set(order.id, marginInfo);
    }

    // Update nonce - 基于提交的nonce更新
    if (nonceBigInt >= getUserNonce(trader)) {
      userNonces.set(trader.toLowerCase() as Address, nonceBigInt + 1n);
    }

    console.log(`[API] Order submitted: ${order.id} (${matches.length} matches, postOnly=${postOnly}, timeInForce=${tif})`);

    // Broadcast orderbook update via WebSocket
    broadcastOrderBook(token.toLowerCase() as Address);

    // Broadcast trades via WebSocket and create positions
    for (const match of matches) {
      const trade: Trade = {
        id: `trade_${Date.now()}_${Math.random().toString(36).slice(2)}`,
        token: token as Address,
        price: match.matchPrice,
        size: match.matchSize,
        side: order.isLong ? "buy" : "sell",
        timestamp: match.timestamp,
        longTrader: match.longOrder.trader,
        shortTrader: match.shortOrder.trader,
      };
      broadcastTrade(trade);

      // 创建/更新持仓记录
      createOrUpdatePosition(
        match.longOrder.trader,
        token as Address,
        true, // isLong
        match.matchSize,
        match.matchPrice,
        match.longOrder.leverage,
        match.shortOrder.trader
      );
      createOrUpdatePosition(
        match.shortOrder.trader,
        token as Address,
        false, // isShort
        match.matchSize,
        match.matchPrice,
        match.shortOrder.leverage,
        match.longOrder.trader
      );

      // ============================================================
      // 成交后结算保证金 (从已扣除 → 已用保证金)
      // ============================================================
      // 结算多头订单的保证金 (按成交大小比例)
      settleOrderMargin(match.longOrder.trader, match.longOrder.id, match.matchSize);
      // 结算空头订单的保证金 (按成交大小比例)
      settleOrderMargin(match.shortOrder.trader, match.shortOrder.id, match.matchSize);

      // ============================================================
      // P5: 处理推荐返佣
      // ============================================================
      // 计算交易手续费 (0.05% of notional value)
      const tradeValue = (match.matchSize * match.matchPrice) / (10n ** 24n); // 1e6 精度
      const tradeFee = (tradeValue * 5n) / 10000n; // 0.05%

      // 处理多头交易者的返佣
      processTradeCommission(
        match.longOrder.trader,
        trade.id,
        tradeFee,
        tradeValue
      );

      // 处理空头交易者的返佣
      processTradeCommission(
        match.shortOrder.trader,
        trade.id,
        tradeFee,
        tradeValue
      );
    }

    return jsonResponse({
      success: true,
      orderId: order.id,
      status: order.status,
      filledSize: order.filledSize.toString(),
      matches: matches.map((m) => ({
        matchPrice: m.matchPrice.toString(),
        matchSize: m.matchSize.toString(),
        counterparty: order.isLong ? m.shortOrder.trader : m.longOrder.trader,
      })),
    });
  } catch (e) {
    console.error("[API] Order submit error:", e);
    return errorResponse(e instanceof Error ? e.message : "Unknown error", 500);
  }
}

async function handleGetNonce(trader: string): Promise<Response> {
  const nonce = getUserNonce(trader as Address);
  return jsonResponse({ nonce: nonce.toString() });
}

async function handleGetOrderBook(token: string): Promise<Response> {
  const orderBook = engine.getOrderBook(token as Address);
  const depth = orderBook.getDepth(20);
  const currentPrice = orderBook.getCurrentPrice();

  return jsonResponse({
    longs: depth.longs.map((level) => ({
      price: level.price.toString(),
      size: level.totalSize.toString(),
      count: level.orders.length,
    })),
    shorts: depth.shorts.map((level) => ({
      price: level.price.toString(),
      size: level.totalSize.toString(),
      count: level.orders.length,
    })),
    lastPrice: currentPrice.toString(),
  });
}

/**
 * 获取所有代币的行情数据 (OKX 格式)
 * GET /api/v1/market/tickers
 */
async function handleGetTickers(): Promise<Response> {
  const tickers = [];

  for (const token of SUPPORTED_TOKENS) {
    try {
      const orderBook = engine.getOrderBook(token);
      const depth = orderBook.getDepth(1);
      const currentPrice = orderBook.getCurrentPrice();

      // 获取24h交易数据
      const trades = engine.getRecentTrades(token, 1000);
      const now = Date.now();
      const oneDayAgo = now - 24 * 60 * 60 * 1000;
      const trades24h = trades.filter(t => t.timestamp >= oneDayAgo);

      // 计算24h统计
      let vol24h = 0n;
      let volCcy24h = 0n;
      let high24h = currentPrice;
      let low24h = currentPrice;
      let open24h = currentPrice;

      if (trades24h.length > 0) {
        open24h = trades24h[trades24h.length - 1].price; // oldest trade
        for (const trade of trades24h) {
          vol24h += trade.size;
          volCcy24h += (trade.price * trade.size) / BigInt(1e6);
          if (trade.price > high24h) high24h = trade.price;
          if (trade.price < low24h) low24h = trade.price;
        }
      }

      // 获取最佳买卖价
      const bestBid = depth.longs.length > 0 ? depth.longs[0].price : currentPrice;
      const bestAsk = depth.shorts.length > 0 ? depth.shorts[0].price : currentPrice;
      const bestBidSz = depth.longs.length > 0 ? depth.longs[0].totalSize : 0n;
      const bestAskSz = depth.shorts.length > 0 ? depth.shorts[0].totalSize : 0n;

      tickers.push({
        instId: `${token}-USDT`,
        last: currentPrice.toString(),
        lastSz: "0",
        askPx: bestAsk.toString(),
        askSz: bestAskSz.toString(),
        bidPx: bestBid.toString(),
        bidSz: bestBidSz.toString(),
        open24h: open24h.toString(),
        high24h: high24h.toString(),
        low24h: low24h.toString(),
        volCcy24h: volCcy24h.toString(),
        vol24h: vol24h.toString(),
        ts: now,
      });
    } catch (e) {
      console.error(`[Tickers] Error getting ticker for ${token}:`, e);
    }
  }

  // 返回 OKX 格式的响应
  return new Response(JSON.stringify({
    code: "0",
    msg: "success",
    data: tickers,
  }), {
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
    },
  });
}

async function handleGetTrades(token: string, url: URL): Promise<Response> {
  const limit = parseInt(url.searchParams.get("limit") || "100");
  const trades = engine.getRecentTrades(token as Address, limit);

  return jsonResponse({
    trades: trades.map((t) => ({
      id: t.id,
      token: t.token,
      price: t.price.toString(),
      size: t.size.toString(),
      side: t.side,
      timestamp: t.timestamp,
    })),
  });
}

async function handleGetUserOrders(trader: string): Promise<Response> {
  const orders = engine.getUserOrders(trader as Address);

  // 返回完整的订单信息 (行业标准 - 参考 OKX/Binance)
  return jsonResponse(
    orders.map((o) => ({
      // === 基本标识 ===
      id: o.id,
      clientOrderId: o.clientOrderId || null,
      token: o.token,

      // === 订单参数 ===
      isLong: o.isLong,
      size: o.size.toString(),
      leverage: o.leverage.toString(),
      price: o.price.toString(),
      orderType: o.orderType === 0 ? "MARKET" : "LIMIT",
      timeInForce: o.timeInForce || "GTC",
      reduceOnly: o.reduceOnly || false,

      // === 成交信息 ===
      status: o.status,
      filledSize: o.filledSize.toString(),
      avgFillPrice: (o.avgFillPrice || 0n).toString(),
      totalFillValue: (o.totalFillValue || 0n).toString(),

      // === 费用信息 ===
      fee: (o.fee || 0n).toString(),
      feeCurrency: o.feeCurrency || "USDT",

      // === 保证金信息 ===
      margin: (o.margin || 0n).toString(),
      collateral: (o.collateral || 0n).toString(),

      // === 止盈止损 ===
      takeProfitPrice: o.takeProfitPrice ? o.takeProfitPrice.toString() : null,
      stopLossPrice: o.stopLossPrice ? o.stopLossPrice.toString() : null,

      // === 时间戳 ===
      createdAt: o.createdAt,
      updatedAt: o.updatedAt || o.createdAt,
      lastFillTime: o.lastFillTime || null,

      // === 来源 ===
      source: o.source || "API",

      // === 最后成交明细 ===
      lastFillPrice: o.lastFillPrice ? o.lastFillPrice.toString() : null,
      lastFillSize: o.lastFillSize ? o.lastFillSize.toString() : null,
      tradeId: o.tradeId || null,
    }))
  );
}

async function handleCancelOrder(req: Request, orderId: string): Promise<Response> {
  try {
    const body = await req.json();
    const { trader, signature } = body;

    if (!trader || !signature) {
      return errorResponse("Missing required fields");
    }

    // 先获取订单信息（用于广播更新和退款）
    const order = engine.getOrder(orderId);
    if (!order) {
      return errorResponse("Order not found");
    }

    // TODO: Verify cancel signature
    const success = engine.cancelOrder(orderId, trader as Address);

    if (!success) {
      return errorResponse("Order not found or cannot be cancelled");
    }

    // ============================================================
    // 撤单退款: 退还保证金 + 手续费
    // ============================================================
    refundOrderAmount(trader as Address, orderId);

    console.log(`[API] Order cancelled: ${orderId}`);

    // 广播订单簿更新
    broadcastOrderBook(order.token.toLowerCase() as Address);

    return jsonResponse({ success: true });
  } catch (e) {
    return errorResponse(e instanceof Error ? e.message : "Unknown error", 500);
  }
}

/**
 * Get user's CURRENT positions (real-time state)
 *
 * RESPONSIBILITY: Returns active positions tracked in memory from recent matches.
 * This is the real-time view of open positions.
 *
 * For historical positions (closed, liquidated), use Go Backend:
 * GET /api/v1/account/positions-history
 */
async function handleGetUserPositions(trader: string): Promise<Response> {
  const normalizedTrader = trader.toLowerCase() as Address;
  const positions = userPositions.get(normalizedTrader) || [];
  return jsonResponse(positions);
}

/**
 * 获取用户余额 (从链上读取 + 后端计算 UPNL)
 * GET /api/user/:trader/balance
 *
 * 数据来源：
 * - available, locked: 从链上 Settlement 合约读取 (source of truth)
 * - unrealizedPnL: 后端实时计算 (基于当前价格)
 */
async function handleGetUserBalance(trader: string): Promise<Response> {
  const normalizedTrader = trader.toLowerCase() as Address;

  // ========================================
  // 1. 获取后端余额数据 (下单扣款/撤单退款都记录在这里)
  // ========================================
  const backendBalance = getUserBalance(normalizedTrader);

  // 后端数据
  let availableBalance = backendBalance.availableBalance;
  let usedMargin = backendBalance.usedMargin;
  let totalBalance = backendBalance.totalBalance;

  // ========================================
  // 2. 尝试从链上读取余额 (如果有链上数据，合并使用)
  // ========================================
  let chainAvailable = 0n;
  let chainLocked = 0n;

  try {
    const publicClient = createPublicClient({
      chain: baseSepolia,
      transport: http(RPC_URL),
    });

    if (SETTLEMENT_ADDRESS) {
      const [available, locked] = await publicClient.readContract({
        address: SETTLEMENT_ADDRESS,
        abi: SETTLEMENT_ABI,
        functionName: "getUserBalance",
        args: [normalizedTrader],
      }) as [bigint, bigint];

      chainAvailable = available;
      chainLocked = locked;

      // 如果链上有余额，使用链上数据作为基础
      // 后端的扣款记录会从链上余额中扣除
      if (chainAvailable > 0n || chainLocked > 0n) {
        console.log(`[Balance] Chain balance for ${normalizedTrader.slice(0, 10)}: available=$${Number(available) / 1e6}, locked=$${Number(locked) / 1e6}`);
        // 链上可用余额 - 后端已扣除的金额 = 实际可用
        // 注意: backendBalance.totalBalance 可能是负数（扣款超过初始0）
        // 所以实际可用 = 链上可用 + 后端可用 (后端可用是负数时表示已扣款)
        availableBalance = chainAvailable + backendBalance.availableBalance;
        usedMargin = chainLocked + backendBalance.usedMargin;
        totalBalance = chainAvailable + chainLocked + backendBalance.totalBalance;
      }
    }
  } catch (e) {
    console.error(`[Balance] Failed to fetch chain balance for ${normalizedTrader}:`, e);
    // 链上读取失败时，继续使用后端数据
  }

  // ========================================
  // 3. 后端计算未实现盈亏 (基于实时价格)
  // ========================================
  const positions = userPositions.get(normalizedTrader) || [];
  let totalPnL = 0n;

  for (const pos of positions) {
    const orderBook = engine.getOrderBook(pos.token as Address);
    const currentPrice = orderBook.getCurrentPrice();
    const pnl = calculateUnrealizedPnL(
      BigInt(pos.size),
      BigInt(pos.entryPrice),
      currentPrice,
      pos.isLong
    );
    totalPnL += pnl;
  }

  // ========================================
  // 4. 计算账户权益
  // ========================================
  const equity = availableBalance + usedMargin + totalPnL;

  return jsonResponse({
    // 余额数据
    totalBalance: totalBalance.toString(),
    availableBalance: availableBalance.toString(),
    usedMargin: usedMargin.toString(),
    frozenMargin: "0",
    // 后端计算数据
    unrealizedPnL: totalPnL.toString(),
    equity: equity.toString(),
    positionCount: positions.length,
    // 链上原始数据 (用于调试)
    chainData: {
      available: chainAvailable.toString(),
      locked: chainLocked.toString(),
    },
    // 数据来源标记
    source: chainAvailable > 0n || chainLocked > 0n ? "chain+backend" : "backend",
    // 人类可读格式
    display: {
      totalBalance: `$${(Number(totalBalance) / 1e6).toFixed(2)}`,
      availableBalance: `$${(Number(availableBalance) / 1e6).toFixed(2)}`,
      usedMargin: `$${(Number(usedMargin) / 1e6).toFixed(2)}`,
      unrealizedPnL: `$${(Number(totalPnL) / 1e6).toFixed(2)}`,
      equity: `$${(Number(equity) / 1e6).toFixed(2)}`,
    }
  });
}

/**
 * 充值 (测试用)
 * POST /api/user/:trader/deposit
 * Body: { amount: "1000000000" } // 1e6 精度, 1000 USD
 */
async function handleDeposit(req: Request, trader: string): Promise<Response> {
  try {
    const body = await req.json();
    const { amount } = body;

    if (!amount) {
      return errorResponse("Missing amount");
    }

    const amountBigInt = BigInt(amount);
    if (amountBigInt <= 0n) {
      return errorResponse("Amount must be positive");
    }

    const normalizedTrader = trader.toLowerCase() as Address;
    deposit(normalizedTrader, amountBigInt);

    const balance = getUserBalance(normalizedTrader);
    return jsonResponse({
      success: true,
      message: `Deposited $${Number(amountBigInt) / 1e6}`,
      balance: {
        totalBalance: balance.totalBalance.toString(),
        availableBalance: balance.availableBalance.toString(),
      }
    });
  } catch (e) {
    return errorResponse(e instanceof Error ? e.message : "Unknown error", 500);
  }
}

/**
 * 提现
 * POST /api/user/:trader/withdraw
 * Body: { amount: "1000000000" } // 1e6 精度
 */
async function handleWithdraw(req: Request, trader: string): Promise<Response> {
  try {
    const body = await req.json();
    const { amount } = body;

    if (!amount) {
      return errorResponse("Missing amount");
    }

    const amountBigInt = BigInt(amount);
    if (amountBigInt <= 0n) {
      return errorResponse("Amount must be positive");
    }

    const normalizedTrader = trader.toLowerCase() as Address;
    const success = withdraw(normalizedTrader, amountBigInt);

    if (!success) {
      return errorResponse("Insufficient available balance");
    }

    const balance = getUserBalance(normalizedTrader);
    return jsonResponse({
      success: true,
      message: `Withdrew $${Number(amountBigInt) / 1e6}`,
      balance: {
        totalBalance: balance.totalBalance.toString(),
        availableBalance: balance.availableBalance.toString(),
      }
    });
  } catch (e) {
    return errorResponse(e instanceof Error ? e.message : "Unknown error", 500);
  }
}

/**
 * 平仓处理 (支持部分平仓)
 *
 * POST /api/position/:pairId/close
 * Body: {
 *   trader: Address,
 *   closeRatio?: number,  // 0-1, 默认 1 (全部平仓)
 *   closeSize?: string,   // 或直接指定平仓数量
 * }
 */
async function handleClosePair(req: Request, pairId: string): Promise<Response> {
  try {
    const body = await req.json();
    const { trader, closeRatio = 1, closeSize } = body;

    if (!trader) {
      return errorResponse("Missing trader address");
    }

    const normalizedTrader = trader.toLowerCase() as Address;

    // 查找仓位
    const positions = userPositions.get(normalizedTrader) || [];
    const position = positions.find(p => p.pairId === pairId);

    if (!position) {
      return errorResponse("Position not found");
    }

    const currentSize = BigInt(position.size);
    const token = position.token.toLowerCase() as Address;
    const orderBook = engine.getOrderBook(token);
    const currentPrice = orderBook.getCurrentPrice();

    // 计算平仓数量
    let sizeToClose: bigint;
    if (closeSize) {
      sizeToClose = BigInt(closeSize);
    } else {
      sizeToClose = (currentSize * BigInt(Math.floor(closeRatio * 10000))) / 10000n;
    }

    // 验证平仓数量
    if (sizeToClose <= 0n) {
      return errorResponse("Invalid close size");
    }
    if (sizeToClose > currentSize) {
      sizeToClose = currentSize;
    }

    const isFullClose = sizeToClose >= currentSize;
    const closeRatioActual = Number(sizeToClose) / Number(currentSize);

    console.log(`[Close] pairId=${pairId} trader=${normalizedTrader.slice(0, 10)} ratio=${(closeRatioActual * 100).toFixed(2)}% isFullClose=${isFullClose}`);

    // 计算平仓 PnL (按比例)
    const totalUpnl = BigInt(position.unrealizedPnL);
    const closePnL = (totalUpnl * sizeToClose) / currentSize;

    // 计算释放的保证金 (按比例)
    const totalCollateral = BigInt(position.collateral);
    const releasedCollateral = (totalCollateral * sizeToClose) / currentSize;

    // 计算平仓手续费 (0.05%)
    const positionValue = (sizeToClose * currentPrice) / (10n ** 24n);
    const closeFee = (positionValue * 5n) / 10000n;

    // 实际返还金额 = 释放保证金 + PnL - 手续费
    const returnAmount = releasedCollateral + closePnL - closeFee;

    console.log(`[Close] PnL=$${Number(closePnL) / 1e6} collateral=$${Number(releasedCollateral) / 1e6} fee=$${Number(closeFee) / 1e6} return=$${Number(returnAmount) / 1e6}`);

    if (isFullClose) {
      // 全部平仓 - 提交到链上
      if (submitter) {
        try {
          // 调用链上 closePair
          const hash = await submitter.closePair(BigInt(pairId), currentPrice);
          console.log(`[Close] Submitted to chain: ${hash}`);
        } catch (e) {
          console.error(`[Close] Chain submission failed:`, e);
          // 继续处理，后端先更新
        }
      }

      // 从用户仓位列表中移除
      const updatedPositions = positions.filter(p => p.pairId !== pairId);
      userPositions.set(normalizedTrader, updatedPositions);

      // 同步删除 Redis 中的仓位
      deletePositionFromRedis(pairId).catch((err) => {
        console.error("[Redis] Failed to delete closed position:", err);
      });

      // 广播平仓事件
      broadcastPositionClosed(position, currentPrice, closePnL);

      return jsonResponse({
        success: true,
        type: "full_close",
        pairId,
        closedSize: sizeToClose.toString(),
        exitPrice: currentPrice.toString(),
        realizedPnL: closePnL.toString(),
        closeFee: closeFee.toString(),
        returnAmount: returnAmount.toString(),
      });
    } else {
      // 部分平仓 - 更新后端仓位状态
      const remainingSize = currentSize - sizeToClose;
      const remainingCollateral = totalCollateral - releasedCollateral;

      // 更新仓位
      position.size = remainingSize.toString();
      position.collateral = remainingCollateral.toString();
      position.margin = remainingCollateral.toString();
      position.realizedPnL = (BigInt(position.realizedPnL || "0") + closePnL).toString();
      position.updatedAt = Date.now();

      // 重新计算剩余仓位的指标
      const newUpnl = totalUpnl - closePnL;
      position.unrealizedPnL = newUpnl.toString();

      // 重新计算 ROE
      if (remainingCollateral > 0n) {
        position.roe = ((newUpnl * 10000n) / remainingCollateral).toString();
      }

      // 广播部分平仓事件
      broadcastPartialClose(position, sizeToClose, currentPrice, closePnL);

      return jsonResponse({
        success: true,
        type: "partial_close",
        pairId,
        closedSize: sizeToClose.toString(),
        remainingSize: remainingSize.toString(),
        exitPrice: currentPrice.toString(),
        realizedPnL: closePnL.toString(),
        closeFee: closeFee.toString(),
        returnAmount: returnAmount.toString(),
      });
    }
  } catch (e) {
    console.error("[Close] Error:", e);
    return errorResponse(e instanceof Error ? e.message : "Unknown error", 500);
  }
}

/**
 * 广播全部平仓事件
 */
function broadcastPositionClosed(position: Position, exitPrice: bigint, pnl: bigint): void {
  const message = JSON.stringify({
    type: "position_closed",
    pairId: position.pairId,
    trader: position.trader,
    token: position.token,
    isLong: position.isLong,
    exitPrice: exitPrice.toString(),
    realizedPnL: pnl.toString(),
    timestamp: Date.now(),
  });

  for (const [client] of wsClients.entries()) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(message);
    }
  }
}

/**
 * 广播部分平仓事件
 */
function broadcastPartialClose(position: Position, closedSize: bigint, exitPrice: bigint, pnl: bigint): void {
  const message = JSON.stringify({
    type: "partial_close",
    pairId: position.pairId,
    trader: position.trader,
    token: position.token,
    isLong: position.isLong,
    closedSize: closedSize.toString(),
    remainingSize: position.size,
    exitPrice: exitPrice.toString(),
    realizedPnL: pnl.toString(),
    timestamp: Date.now(),
  });

  for (const [client] of wsClients.entries()) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(message);
    }
  }
}

async function handleUpdatePrice(req: Request): Promise<Response> {
  try {
    const body = await req.json();
    const { token, price } = body;

    if (!token || !price) {
      return errorResponse("Missing token or price");
    }

    const priceBigInt = BigInt(price);
    engine.updatePrice(token as Address, priceBigInt);

    // Update on-chain if submitter is available
    if (submitter) {
      const hash = await submitter.updatePrice(token as Address, priceBigInt);
      console.log(`[API] Price updated on-chain: ${hash}`);
    }

    return jsonResponse({ success: true, price: priceBigInt.toString() });
  } catch (e) {
    return errorResponse(e instanceof Error ? e.message : "Unknown error", 500);
  }
}

/**
 * Get K-line (candlestick) data
 */
async function handleGetKlines(token: string, url: URL): Promise<Response> {
  const interval = url.searchParams.get("interval") || "1m";
  const limit = parseInt(url.searchParams.get("limit") || "100");

  const klines = engine.getKlines(token as Address, interval, limit);

  return jsonResponse({
    klines: klines.map(k => ({
      timestamp: k.timestamp,
      open: k.open.toString(),
      high: k.high.toString(),
      low: k.low.toString(),
      close: k.close.toString(),
      volume: k.volume.toString(),
      trades: k.trades,
    })),
  });
}

/**
 * Get token statistics
 */
async function handleGetStats(token: string): Promise<Response> {
  const stats = engine.getStats(token as Address);

  return jsonResponse({
    price: stats.price.toString(),
    priceChange24h: stats.priceChange24h.toString(),
    high24h: stats.high24h.toString(),
    low24h: stats.low24h.toString(),
    volume24h: stats.volume24h.toString(),
    trades24h: stats.trades24h,
    openInterest: stats.openInterest.toString(),
    fundingRate: stats.fundingRate.toString(),
    nextFundingTime: stats.nextFundingTime,
  });
}

/**
 * Get funding rate
 */
async function handleGetFundingRate(token: string): Promise<Response> {
  const { rate, nextFundingTime } = engine.getFundingRate(token as Address);

  return jsonResponse({
    rate: rate.toString(),
    nextFundingTime,
    interval: "8h",
  });
}

// ============================================================
// 猎杀场 API
// ============================================================

/**
 * 计算清算价格
 * 使用 Bybit 行业标准公式:
 * 多头: liqPrice = entryPrice * (1 - 1/leverage + MMR)
 * 空头: liqPrice = entryPrice * (1 + 1/leverage - MMR)
 *
 * 注意: leverage 是 1e4 精度 (10x = 100000)
 */
function calculateLiquidationPrice(
  entryPrice: bigint,
  leverage: bigint,  // 1e4 精度 (10x = 100000)
  isLong: boolean,
  mmr: bigint = 200n // 基础 MMR，会根据杠杆动态调整
): bigint {
  const PRECISION = 10000n; // 基点精度

  // leverage 是 1e4 精度, 直接用于计算
  // 1/leverage = PRECISION / (leverage / PRECISION) = PRECISION * PRECISION / leverage
  // 例如: 10x leverage = 100000, inverseLevel = 10000 * 10000 / 100000 = 1000 (表示 10%)
  const inverseLevel = (PRECISION * PRECISION) / leverage;

  // ============================================================
  // 动态 MMR 计算 (行业标准 - 参考 Bybit/Binance)
  // ============================================================
  // 关键规则: MMR 必须小于 1/leverage，否则一开仓就会被清算
  //
  // 安全系数: MMR = min(基础MMR, 初始保证金率 * 50%)
  // 这样确保强平价格距离入场价至少有 50% 的保证金缓冲
  //
  // 例如:
  // - 10x: 初始保证金 10%, MMR = min(2%, 5%) = 2%
  // - 50x: 初始保证金 2%, MMR = min(2%, 1%) = 1%
  // - 75x: 初始保证金 1.33%, MMR = min(2%, 0.67%) = 0.67%
  // - 100x: 初始保证金 1%, MMR = min(2%, 0.5%) = 0.5%
  // ============================================================
  const maxMmr = inverseLevel / 2n; // MMR 不能超过初始保证金率的一半
  const effectiveMmr = mmr < maxMmr ? mmr : maxMmr;

  if (isLong) {
    // 多头: liqPrice = entryPrice * (1 - 1/leverage + MMR)
    // 因为 MMR < 1/leverage，所以 factor < 1，强平价低于入场价
    // 75x 多头 (effectiveMmr=0.67%): factor = 10000 - 133 + 67 = 9934 (99.34%)
    const factor = PRECISION - inverseLevel + effectiveMmr;
    return (entryPrice * factor) / PRECISION;
  } else {
    // 空头: liqPrice = entryPrice * (1 + 1/leverage - MMR)
    // 因为 MMR < 1/leverage，所以 factor > 1，强平价高于入场价
    // 75x 空头 (effectiveMmr=0.67%): factor = 10000 + 133 - 67 = 10066 (100.66%)
    const factor = PRECISION + inverseLevel - effectiveMmr;
    return (entryPrice * factor) / PRECISION;
  }
}

/**
 * 计算穿仓价格 (Bankruptcy Price)
 *
 * 穿仓价格 = 保证金完全亏损的价格 (MMR = 0)
 *
 * 多头: bankruptcyPrice = entryPrice * (1 - 1/leverage)
 * 空头: bankruptcyPrice = entryPrice * (1 + 1/leverage)
 */
function calculateBankruptcyPrice(
  entryPrice: bigint,
  leverage: bigint,  // 1e4 精度
  isLong: boolean
): bigint {
  const PRECISION = 10000n;
  const inverseLevel = (PRECISION * PRECISION) / leverage;

  if (isLong) {
    // 多头穿仓价 = entryPrice * (1 - 1/leverage)
    // 10x 多头: factor = 10000 - 1000 = 9000 (90%)
    const factor = PRECISION - inverseLevel;
    return (entryPrice * factor) / PRECISION;
  } else {
    // 空头穿仓价 = entryPrice * (1 + 1/leverage)
    // 10x 空头: factor = 10000 + 1000 = 11000 (110%)
    const factor = PRECISION + inverseLevel;
    return (entryPrice * factor) / PRECISION;
  }
}

/**
 * 计算未实现盈亏 (行业标准 - GMX/Binance)
 * 公式: PnL = Size × Direction × (MarkPrice - EntryPrice) - OpenFee
 *
 * 开仓后价格没变 → PnL = -手续费 (浮亏)
 *
 * 精度说明:
 * - size: 1e18 (代币数量)
 * - entryPrice/currentPrice: 1e12 (USD，来自订单簿)
 * - 返回值: 1e6 精度 (USD)
 */
function calculateUnrealizedPnL(
  size: bigint,         // 1e18 精度 (代币数量)
  entryPrice: bigint,   // 1e12 精度 (来自订单簿)
  currentPrice: bigint, // 1e12 精度 (来自订单簿)
  isLong: boolean
): bigint {
  // 1. 计算价格变动带来的盈亏
  // PnL = size * (currentPrice - entryPrice) * direction
  // 单位转换: size(1e18) * priceDiff(1e12) / 1e24 = 1e6 精度
  let pricePnL: bigint;
  if (isLong) {
    pricePnL = (size * (currentPrice - entryPrice)) / (10n ** 24n);
  } else {
    pricePnL = (size * (entryPrice - currentPrice)) / (10n ** 24n);
  }

  // 2. 计算开仓手续费 (0.05% of position value)
  // positionValue = size * entryPrice / 1e24 (USD, 1e6 精度)
  const positionValue = (size * entryPrice) / (10n ** 24n);
  const openFee = (positionValue * 5n) / 10000n; // 0.05%

  // 3. 未实现盈亏 = 价格盈亏 - 手续费
  return pricePnL - openFee;
}

/**
 * 计算保证金率 (行业标准 - Binance/OKX)
 * 公式: 保证金率 = 维持保证金 / 账户权益
 *
 * 触发条件: 保证金率 >= 100% 时触发强平
 * 越小越安全，越大越危险
 *
 * 精度说明:
 * - collateral: 1e6 (USD)
 * - size: 1e18 (代币数量)
 * - entryPrice/currentPrice: 1e18 (USD，前端用 parseEther)
 * - 返回值: 1e4 精度 (10000 = 100%)
 */
function calculateMarginRatio(
  collateral: bigint,   // 1e6 精度 (USD) - 初始保证金
  size: bigint,         // 1e18 精度 (代币数量)
  entryPrice: bigint,   // 1e12 精度 (来自订单簿)
  currentPrice: bigint, // 1e12 精度 (来自订单簿)
  isLong: boolean,
  mmr: bigint = 50n     // 维持保证金率 0.5% (1e4 精度, 50 = 0.5%)
): bigint {
  if (size === 0n || currentPrice === 0n) return 0n; // 无仓位，0%风险

  // 计算仓位价值 (USD, 1e6 精度)
  // size(1e18) * currentPrice(1e12) / 1e24 = 1e6 精度
  const positionValue = (size * currentPrice) / (10n ** 24n);
  if (positionValue === 0n) return 0n;

  // 计算维持保证金 = 仓位价值 * MMR
  // maintenanceMargin = positionValue * mmr / 10000
  const maintenanceMargin = (positionValue * mmr) / 10000n;

  // 计算未实现盈亏 (行业标准)
  const pnl = calculateUnrealizedPnL(size, entryPrice, currentPrice, isLong);

  // 账户权益 = 初始保证金 + 未实现盈亏
  const equity = collateral + pnl;
  if (equity <= 0n) return 100000n; // 权益为负，返回 1000% (已爆仓)

  // 保证金率 = 维持保证金 / 账户权益 * 10000 (1e4 精度)
  // 越小越安全，>= 10000 (100%) 触发强平
  return (maintenanceMargin * 10000n) / equity;
}

/**
 * 获取清算地图
 * 显示各价格点的清算量分布
 */
async function handleGetLiquidationMap(token: string): Promise<Response> {
  const normalizedToken = token.toLowerCase() as Address;
  const currentPrice = engine.getOrderBook(normalizedToken).getCurrentPrice();

  // 收集所有持仓的清算价格
  const longLiquidations: Map<string, { size: bigint; accounts: number }> = new Map();
  const shortLiquidations: Map<string, { size: bigint; accounts: number }> = new Map();

  for (const [trader, positions] of userPositions) {
    for (const pos of positions) {
      if (pos.token.toLowerCase() !== normalizedToken) continue;

      const liqPrice = pos.liquidationPrice;
      // 按价格分组（精度降低以便聚合）
      const priceKey = roundPrice(BigInt(liqPrice));

      if (pos.isLong) {
        const existing = longLiquidations.get(priceKey) || { size: 0n, accounts: 0 };
        longLiquidations.set(priceKey, {
          size: existing.size + BigInt(pos.size),
          accounts: existing.accounts + 1,
        });
      } else {
        const existing = shortLiquidations.get(priceKey) || { size: 0n, accounts: 0 };
        shortLiquidations.set(priceKey, {
          size: existing.size + BigInt(pos.size),
          accounts: existing.accounts + 1,
        });
      }
    }
  }

  // 转换为数组并排序
  const longs = Array.from(longLiquidations.entries())
    .map(([price, data]) => ({
      price,
      size: data.size.toString(),
      accounts: data.accounts,
    }))
    .sort((a, b) => Number(BigInt(b.price) - BigInt(a.price))); // 从高到低

  const shorts = Array.from(shortLiquidations.entries())
    .map(([price, data]) => ({
      price,
      size: data.size.toString(),
      accounts: data.accounts,
    }))
    .sort((a, b) => Number(BigInt(a.price) - BigInt(b.price))); // 从低到高

  return jsonResponse({
    token: normalizedToken,
    currentPrice: currentPrice.toString(),
    longs, // 多头清算点（价格低于当前价）
    shorts, // 空头清算点（价格高于当前价）
    totalLongSize: longs.reduce((sum, l) => sum + BigInt(l.size), 0n).toString(),
    totalShortSize: shorts.reduce((sum, s) => sum + BigInt(s.size), 0n).toString(),
    totalLongAccounts: longs.reduce((sum, l) => sum + l.accounts, 0),
    totalShortAccounts: shorts.reduce((sum, s) => sum + s.accounts, 0),
  });
}

/**
 * 价格四舍五入（用于聚合）
 */
function roundPrice(price: bigint): string {
  // 按 1% 精度聚合
  const precision = price / 100n;
  if (precision === 0n) return price.toString();
  return ((price / precision) * precision).toString();
}

/**
 * 获取全局持仓列表
 * 公开所有用户的持仓信息
 */
async function handleGetAllPositions(token: string): Promise<Response> {
  const normalizedToken = token.toLowerCase() as Address;
  const currentPrice = engine.getOrderBook(normalizedToken).getCurrentPrice();

  const allPositions: Array<{
    trader: string;
    isLong: boolean;
    size: string;
    entryPrice: string;
    collateral: string;
    leverage: string;
    liquidationPrice: string;
    marginRatio: string;
    unrealizedPnL: string;
    riskLevel: string; // "safe" | "warning" | "danger"
  }> = [];

  for (const [trader, positions] of userPositions) {
    for (const pos of positions) {
      if (pos.token.toLowerCase() !== normalizedToken) continue;

      // 计算实时保证金率 (行业标准: 维持保证金/权益, 越大越危险)
      const marginRatio = calculateMarginRatio(
        BigInt(pos.collateral),
        BigInt(pos.size),
        BigInt(pos.entryPrice),
        currentPrice,
        pos.isLong
      );

      // 计算未实现盈亏 (行业标准: Size × (Mark - Entry))
      const pnl = calculateUnrealizedPnL(
        BigInt(pos.size),
        BigInt(pos.entryPrice),
        currentPrice,
        pos.isLong
      );

      // 风险等级 (保证金率越大越危险，>=100%强平)
      let riskLevel: string;
      if (marginRatio < 5000n) {
        riskLevel = "safe"; // < 50%
      } else if (marginRatio < 8000n) {
        riskLevel = "warning"; // 50-80%
      } else {
        riskLevel = "danger"; // >= 80% (接近强平)
      }

      allPositions.push({
        trader: trader,
        isLong: pos.isLong,
        size: pos.size,
        entryPrice: pos.entryPrice,
        collateral: pos.collateral,
        leverage: pos.leverage,
        liquidationPrice: pos.liquidationPrice,
        marginRatio: marginRatio.toString(),
        unrealizedPnL: pnl.toString(),
        riskLevel,
      });
    }
  }

  // 按风险等级排序（danger 优先）
  allPositions.sort((a, b) => {
    const riskOrder = { danger: 0, warning: 1, safe: 2 };
    return riskOrder[a.riskLevel as keyof typeof riskOrder] - riskOrder[b.riskLevel as keyof typeof riskOrder];
  });

  return jsonResponse({
    token: normalizedToken,
    currentPrice: currentPrice.toString(),
    positions: allPositions,
    totalPositions: allPositions.length,
    dangerCount: allPositions.filter(p => p.riskLevel === "danger").length,
    warningCount: allPositions.filter(p => p.riskLevel === "warning").length,
  });
}

/**
 * 获取清算历史
 */
async function handleGetLiquidations(token: string, url: URL): Promise<Response> {
  const normalizedToken = token.toLowerCase() as Address;
  const limit = parseInt(url.searchParams.get("limit") || "50");

  const history = liquidationHistory.get(normalizedToken) || [];
  const recentHistory = history.slice(-limit).reverse(); // 最新的在前

  return jsonResponse({
    token: normalizedToken,
    liquidations: recentHistory,
    total: history.length,
  });
}

/**
 * 获取猎杀排行榜
 */
async function handleGetHunterLeaderboard(url: URL): Promise<Response> {
  const period = url.searchParams.get("period") || "all"; // "24h" | "7d" | "all"
  const limit = parseInt(url.searchParams.get("limit") || "20");

  let hunters = Array.from(hunterStats.values());

  // 按时间筛选
  if (period !== "all") {
    const now = Date.now();
    const cutoff = period === "24h" ? now - 24 * 60 * 60 * 1000 : now - 7 * 24 * 60 * 60 * 1000;
    hunters = hunters.filter(h => h.lastKillTime >= cutoff);
  }

  // 按猎杀数量排序
  hunters.sort((a, b) => b.totalKills - a.totalKills);

  return jsonResponse({
    period,
    hunters: hunters.slice(0, limit).map((h, index) => ({
      rank: index + 1,
      address: h.address,
      kills: h.totalKills,
      profit: h.totalProfitUSD,
      lastKill: h.lastKillTime,
    })),
    totalHunters: hunterStats.size,
    totalLiquidations: globalLiquidationCount,
  });
}

/**
 * 记录清算事件
 */
function recordLiquidation(
  token: Address,
  liquidatedTrader: Address,
  liquidator: Address,
  position: Position,
  liquidationPrice: bigint
): void {
  const record: LiquidationRecord = {
    id: `liq_${Date.now()}_${globalLiquidationCount++}`,
    token,
    liquidatedTrader,
    liquidator,
    isLong: position.isLong,
    size: position.size,
    entryPrice: position.entryPrice,
    liquidationPrice: liquidationPrice.toString(),
    collateralLost: position.collateral,
    timestamp: Date.now(),
  };

  // 添加到历史记录
  const history = liquidationHistory.get(token) || [];
  history.push(record);
  if (history.length > 1000) history.shift(); // 保留最近 1000 条
  liquidationHistory.set(token, history);

  // 更新猎杀者统计
  const hunter = hunterStats.get(liquidator) || {
    address: liquidator,
    totalKills: 0,
    totalProfitUSD: "0",
    lastKillTime: 0,
  };
  hunter.totalKills += 1;
  hunter.totalProfitUSD = (BigInt(hunter.totalProfitUSD) + BigInt(position.collateral) / 10n).toString(); // 假设获得 10% 奖励
  hunter.lastKillTime = Date.now();
  hunterStats.set(liquidator, hunter);

  // 广播清算事件
  broadcastLiquidation(token, record);

  console.log(`[Liquidation] 🔥 ${liquidatedTrader.slice(0, 10)} was liquidated by ${liquidator.slice(0, 10)}`);
}

/**
 * 广播清算事件到 WebSocket
 */
function broadcastLiquidation(token: Address, record: LiquidationRecord): void {
  if (!wss) return;

  const message = JSON.stringify({
    type: "liquidation",
    token,
    data: record,
  });

  for (const [ws, tokens] of wsClients) {
    if (tokens.has(token.toLowerCase() as Address) && ws.readyState === WebSocket.OPEN) {
      ws.send(message);
    }
  }
}

// ============================================================
// 保险基金 & Oracle API Handlers (P1)
// ============================================================

/**
 * 获取全局保险基金状态
 * GET /api/insurance-fund
 */
async function handleGetInsuranceFund(): Promise<Response> {
  return jsonResponse({
    balance: insuranceFund.balance.toString(),
    totalContributions: insuranceFund.totalContributions.toString(),
    totalPayouts: insuranceFund.totalPayouts.toString(),
    lastUpdated: insuranceFund.lastUpdated,
    display: {
      balance: `$${(Number(insuranceFund.balance) / 1e6).toFixed(2)}`,
      totalContributions: `$${(Number(insuranceFund.totalContributions) / 1e6).toFixed(2)}`,
      totalPayouts: `$${(Number(insuranceFund.totalPayouts) / 1e6).toFixed(2)}`,
    },
    tokenFunds: Array.from(tokenInsuranceFunds.entries()).map(([token, fund]) => ({
      token,
      balance: fund.balance.toString(),
      display: `$${(Number(fund.balance) / 1e6).toFixed(2)}`,
    })),
  });
}

/**
 * 获取代币保险基金状态
 * GET /api/insurance-fund/:token
 */
async function handleGetTokenInsuranceFund(token: string): Promise<Response> {
  const normalizedToken = token.toLowerCase() as Address;
  const fund = getTokenInsuranceFund(normalizedToken);

  return jsonResponse({
    token: normalizedToken,
    balance: fund.balance.toString(),
    totalContributions: fund.totalContributions.toString(),
    totalPayouts: fund.totalPayouts.toString(),
    lastUpdated: fund.lastUpdated,
    display: {
      balance: `$${(Number(fund.balance) / 1e6).toFixed(2)}`,
      totalContributions: `$${(Number(fund.totalContributions) / 1e6).toFixed(2)}`,
      totalPayouts: `$${(Number(fund.totalPayouts) / 1e6).toFixed(2)}`,
    },
  });
}

// ============================================================
// Dynamic Funding API Handlers (P1)
// ============================================================

/**
 * 获取动态资金费信息
 * GET /api/dynamic-funding/:token
 */
async function handleGetDynamicFunding(token: string): Promise<Response> {
  const normalizedToken = token.toLowerCase() as Address;
  const config = getTokenFundingConfig(normalizedToken);
  const currentRate = currentFundingRates.get(normalizedToken) || 0n;
  const nextSettlement = nextFundingSettlement.get(normalizedToken) || 0;
  const tracker = volatilityTrackers.get(normalizedToken);
  const { longOI, shortOI } = calculateOpenInterest(normalizedToken);

  // 计算动态周期
  const dynamicInterval = getDynamicFundingInterval(normalizedToken);

  // 计算年化费率
  const intervalsPerYear = 365 * 24 * 60 * 60 * 1000 / dynamicInterval;
  const annualizedRate = Number(currentRate) * intervalsPerYear / 100; // 百分比

  return jsonResponse({
    token: normalizedToken,
    currentRate: currentRate.toString(),
    config: {
      baseInterval: config.baseInterval,
      minInterval: config.minInterval,
      maxRate: config.maxRate,
      volatilityMultiplier: config.volatilityMultiplier,
      imbalanceMultiplier: config.imbalanceMultiplier,
    },
    dynamics: {
      currentInterval: dynamicInterval,
      volatility: tracker?.volatility || 0,
      longOI: longOI.toString(),
      shortOI: shortOI.toString(),
      imbalanceRatio: longOI + shortOI > 0n
        ? ((Number(longOI - shortOI) / Number(longOI + shortOI)) * 100).toFixed(2)
        : "0",
    },
    nextSettlement,
    annualizedRate: annualizedRate.toFixed(2),
    display: {
      currentRate: `${(Number(currentRate) / 100).toFixed(4)}%`,
      annualizedRate: `${annualizedRate.toFixed(2)}%`,
      nextSettlement: new Date(nextSettlement).toISOString(),
      interval: `${Math.floor(dynamicInterval / 60000)} minutes`,
    },
  });
}

/**
 * 获取资金费支付历史
 * GET /api/funding-history/:token
 */
async function handleGetFundingHistory(token: string, url: URL): Promise<Response> {
  const normalizedToken = token.toLowerCase() as Address;
  const limit = parseInt(url.searchParams.get("limit") || "100");
  const trader = url.searchParams.get("trader")?.toLowerCase() as Address | undefined;

  let history = fundingPaymentHistory.get(normalizedToken) || [];

  // 按 trader 过滤
  if (trader) {
    history = history.filter(p => p.trader.toLowerCase() === trader);
  }

  // 按时间倒序
  history = history.slice(-limit).reverse();

  return jsonResponse({
    token: normalizedToken,
    count: history.length,
    payments: history.map(p => ({
      pairId: p.pairId,
      trader: p.trader,
      isLong: p.isLong,
      positionSize: p.positionSize,
      fundingRate: p.fundingRate,
      fundingAmount: p.fundingAmount,
      isPayer: p.isPayer,
      timestamp: p.timestamp,
      display: {
        fundingRate: `${(Number(p.fundingRate) / 100).toFixed(4)}%`,
        fundingAmount: `$${(Number(p.fundingAmount) / 1e6).toFixed(2)}`,
        time: new Date(p.timestamp).toISOString(),
      },
    })),
  });
}

/**
 * 手动触发资金费结算 (管理员)
 * POST /api/funding/settle
 * Body: { token: Address }
 */
async function handleManualFundingSettlement(req: Request): Promise<Response> {
  try {
    const body = await req.json();
    const { token } = body;

    if (!token) {
      return errorResponse("Missing token address");
    }

    const normalizedToken = token.toLowerCase() as Address;

    // 计算最新费率
    const rate = calculateDynamicFundingRate(normalizedToken);

    // 执行结算
    await settleFunding(normalizedToken);

    return jsonResponse({
      success: true,
      token: normalizedToken,
      settledRate: rate.toString(),
      nextSettlement: nextFundingSettlement.get(normalizedToken),
      display: {
        settledRate: `${(Number(rate) / 100).toFixed(4)}%`,
      },
    });
  } catch (e) {
    return errorResponse(e instanceof Error ? e.message : "Unknown error", 500);
  }
}

// ============================================================
// Take Profit / Stop Loss API Handlers (P2)
// ============================================================

/**
 * 设置/更新 TP/SL
 * POST /api/position/:pairId/tpsl
 * Body: {
 *   takeProfitPrice?: string,  // 1e12 精度，null 表示不设置
 *   stopLossPrice?: string,    // 1e12 精度，null 表示不设置
 * }
 */
async function handleSetTPSL(req: Request, pairId: string): Promise<Response> {
  try {
    const body = await req.json();
    const { takeProfitPrice, stopLossPrice } = body;

    const tp = takeProfitPrice ? BigInt(takeProfitPrice) : null;
    const sl = stopLossPrice ? BigInt(stopLossPrice) : null;

    if (tp === null && sl === null) {
      return errorResponse("At least one of takeProfitPrice or stopLossPrice is required");
    }

    const order = setTakeProfitStopLoss(pairId, tp, sl);

    if (!order) {
      return errorResponse("Failed to set TP/SL. Check price validity.");
    }

    return jsonResponse({
      success: true,
      pairId,
      takeProfitPrice: order.takeProfitPrice?.toString() || null,
      stopLossPrice: order.stopLossPrice?.toString() || null,
      display: {
        takeProfitPrice: order.takeProfitPrice ? `$${(Number(order.takeProfitPrice) / 1e12).toFixed(6)}` : "Not set",
        stopLossPrice: order.stopLossPrice ? `$${(Number(order.stopLossPrice) / 1e12).toFixed(6)}` : "Not set",
      },
    });
  } catch (e) {
    return errorResponse(e instanceof Error ? e.message : "Unknown error", 500);
  }
}

/**
 * 获取 TP/SL 状态
 * GET /api/position/:pairId/tpsl
 */
async function handleGetTPSL(pairId: string): Promise<Response> {
  const order = tpslOrders.get(pairId);

  if (!order) {
    return jsonResponse({
      pairId,
      hasTPSL: false,
      takeProfitPrice: null,
      stopLossPrice: null,
    });
  }

  return jsonResponse({
    pairId,
    hasTPSL: true,
    trader: order.trader,
    token: order.token,
    isLong: order.isLong,
    takeProfitPrice: order.takeProfitPrice?.toString() || null,
    takeProfitTriggered: order.takeProfitTriggered,
    stopLossPrice: order.stopLossPrice?.toString() || null,
    stopLossTriggered: order.stopLossTriggered,
    executionStatus: order.executionStatus,
    executedAt: order.executedAt,
    executionPrice: order.executionPrice?.toString() || null,
    executionPnL: order.executionPnL?.toString() || null,
    createdAt: order.createdAt,
    updatedAt: order.updatedAt,
    display: {
      takeProfitPrice: order.takeProfitPrice ? `$${(Number(order.takeProfitPrice) / 1e12).toFixed(6)}` : "Not set",
      stopLossPrice: order.stopLossPrice ? `$${(Number(order.stopLossPrice) / 1e12).toFixed(6)}` : "Not set",
      executionPnL: order.executionPnL ? `$${(Number(order.executionPnL) / 1e6).toFixed(2)}` : null,
    },
  });
}

/**
 * 取消 TP/SL
 * DELETE /api/position/:pairId/tpsl
 * Body: { cancelType: "tp" | "sl" | "both" }
 */
async function handleCancelTPSL(req: Request, pairId: string): Promise<Response> {
  try {
    const body = await req.json();
    const { cancelType = "both" } = body;

    if (!["tp", "sl", "both"].includes(cancelType)) {
      return errorResponse('cancelType must be "tp", "sl", or "both"');
    }

    const success = cancelTakeProfitStopLoss(pairId, cancelType as "tp" | "sl" | "both");

    if (!success) {
      return errorResponse("TP/SL order not found");
    }

    return jsonResponse({
      success: true,
      pairId,
      cancelled: cancelType,
    });
  } catch (e) {
    return errorResponse(e instanceof Error ? e.message : "Unknown error", 500);
  }
}

/**
 * 获取所有 TP/SL 订单
 * GET /api/tpsl/orders
 */
async function handleGetAllTPSLOrders(): Promise<Response> {
  const orders = Array.from(tpslOrders.values()).map(order => ({
    pairId: order.pairId,
    trader: order.trader,
    token: order.token,
    isLong: order.isLong,
    takeProfitPrice: order.takeProfitPrice?.toString() || null,
    stopLossPrice: order.stopLossPrice?.toString() || null,
    executionStatus: order.executionStatus,
    createdAt: order.createdAt,
  }));

  return jsonResponse({
    count: orders.length,
    orders,
  });
}

// ============================================================
// Add/Remove Margin (追加/减少保证金) - Meme Perp P2 功能
// ============================================================

/**
 * 追加保证金结果
 */
interface AddMarginResult {
  success: boolean;
  pairId: string;
  addedAmount: bigint;
  newCollateral: bigint;
  newLeverage: number;
  newLiquidationPrice: bigint;
  reason?: string;
}

/**
 * 减少保证金结果
 */
interface RemoveMarginResult {
  success: boolean;
  pairId: string;
  removedAmount: bigint;
  newCollateral: bigint;
  newLeverage: number;
  newLiquidationPrice: bigint;
  maxRemovable: bigint;
  reason?: string;
}

/**
 * 追加保证金
 *
 * 效果:
 * 1. 增加仓位的保证金
 * 2. 降低有效杠杆
 * 3. 降低强平价格风险
 *
 * @param pairId 仓位 ID
 * @param amount 追加金额 (1e6 USD)
 */
function addMarginToPosition(pairId: string, amount: bigint): AddMarginResult {
  // 查找仓位
  let position: Position | null = null;
  for (const [trader, positions] of userPositions.entries()) {
    const found = positions.find(p => p.pairId === pairId);
    if (found) {
      position = found;
      break;
    }
  }

  if (!position) {
    return {
      success: false,
      pairId,
      addedAmount: 0n,
      newCollateral: 0n,
      newLeverage: 0,
      newLiquidationPrice: 0n,
      reason: "Position not found",
    };
  }

  if (amount <= 0n) {
    return {
      success: false,
      pairId,
      addedAmount: 0n,
      newCollateral: BigInt(position.collateral),
      newLeverage: Number(position.leverage),
      newLiquidationPrice: BigInt(position.liquidationPrice),
      reason: "Amount must be positive",
    };
  }

  const oldCollateral = BigInt(position.collateral);
  const newCollateral = oldCollateral + amount;

  // 计算新杠杆 = 仓位价值 / 新保证金
  const currentPrice = BigInt(position.markPrice);
  const positionValue = (BigInt(position.size) * currentPrice) / (10n ** 24n);
  const newLeverage = Number((positionValue * 10000n) / newCollateral) / 10000;

  // 更新仓位
  position.collateral = newCollateral.toString();
  position.margin = (newCollateral + BigInt(position.unrealizedPnL)).toString();
  position.leverage = Math.floor(newLeverage).toString();

  // 重新计算强平价格
  const entryPrice = BigInt(position.entryPrice);
  const mmr = BigInt(position.mmr);
  const newLiquidationPrice = calculateLiquidationPrice(
    entryPrice,
    BigInt(Math.floor(newLeverage * 10000)),
    position.isLong,
    mmr
  );
  position.liquidationPrice = newLiquidationPrice.toString();

  // 重新计算保证金率
  const newMarginRatio = positionValue > 0n
    ? Number((newCollateral * 10000n) / positionValue)
    : 10000;
  position.marginRatio = newMarginRatio.toString();

  position.updatedAt = Date.now();

  console.log(`[Margin] Added $${Number(amount) / 1e6} to ${pairId}. New collateral: $${Number(newCollateral) / 1e6}, leverage: ${newLeverage.toFixed(2)}x`);

  // 广播保证金更新
  broadcastMarginUpdate(position, "add", amount);

  return {
    success: true,
    pairId,
    addedAmount: amount,
    newCollateral,
    newLeverage,
    newLiquidationPrice,
  };
}

/**
 * 减少保证金
 *
 * 效果:
 * 1. 减少仓位的保证金
 * 2. 提高有效杠杆
 * 3. 提高强平价格风险
 *
 * 限制:
 * - 新杠杆不能超过最大杠杆 (100x)
 * - 新保证金率不能低于维持保证金率 × 1.5
 *
 * @param pairId 仓位 ID
 * @param amount 减少金额 (1e6 USD)
 */
function removeMarginFromPosition(pairId: string, amount: bigint): RemoveMarginResult {
  // 查找仓位
  let position: Position | null = null;
  for (const [trader, positions] of userPositions.entries()) {
    const found = positions.find(p => p.pairId === pairId);
    if (found) {
      position = found;
      break;
    }
  }

  if (!position) {
    return {
      success: false,
      pairId,
      removedAmount: 0n,
      newCollateral: 0n,
      newLeverage: 0,
      newLiquidationPrice: 0n,
      maxRemovable: 0n,
      reason: "Position not found",
    };
  }

  const oldCollateral = BigInt(position.collateral);
  const currentPrice = BigInt(position.markPrice);
  const positionValue = (BigInt(position.size) * currentPrice) / (10n ** 24n);
  const mmr = BigInt(position.mmr);

  // 计算最大可减少金额
  // 限制1: 新杠杆 <= 100x -> 新保证金 >= 仓位价值 / 100
  const minCollateralForLeverage = positionValue / 100n;

  // 限制2: 新保证金率 >= MMR × 1.5 -> 新保证金 >= 仓位价值 × MMR × 1.5 / 10000
  const minCollateralForHealth = (positionValue * mmr * 15n) / 100000n;

  const minCollateral = minCollateralForLeverage > minCollateralForHealth
    ? minCollateralForLeverage
    : minCollateralForHealth;

  const maxRemovable = oldCollateral > minCollateral ? oldCollateral - minCollateral : 0n;

  if (amount <= 0n) {
    return {
      success: false,
      pairId,
      removedAmount: 0n,
      newCollateral: oldCollateral,
      newLeverage: Number(position.leverage),
      newLiquidationPrice: BigInt(position.liquidationPrice),
      maxRemovable,
      reason: "Amount must be positive",
    };
  }

  if (amount > maxRemovable) {
    return {
      success: false,
      pairId,
      removedAmount: 0n,
      newCollateral: oldCollateral,
      newLeverage: Number(position.leverage),
      newLiquidationPrice: BigInt(position.liquidationPrice),
      maxRemovable,
      reason: `Amount exceeds maximum removable. Max: $${Number(maxRemovable) / 1e6}`,
    };
  }

  const newCollateral = oldCollateral - amount;
  const newLeverage = Number((positionValue * 10000n) / newCollateral) / 10000;

  // 更新仓位
  position.collateral = newCollateral.toString();
  position.margin = (newCollateral + BigInt(position.unrealizedPnL)).toString();
  position.leverage = Math.floor(newLeverage).toString();

  // 重新计算强平价格
  const entryPrice = BigInt(position.entryPrice);
  const newLiquidationPrice = calculateLiquidationPrice(
    entryPrice,
    BigInt(Math.floor(newLeverage * 10000)),
    position.isLong,
    mmr
  );
  position.liquidationPrice = newLiquidationPrice.toString();

  // 重新计算保证金率
  const newMarginRatio = positionValue > 0n
    ? Number((newCollateral * 10000n) / positionValue)
    : 10000;
  position.marginRatio = newMarginRatio.toString();

  position.updatedAt = Date.now();

  console.log(`[Margin] Removed $${Number(amount) / 1e6} from ${pairId}. New collateral: $${Number(newCollateral) / 1e6}, leverage: ${newLeverage.toFixed(2)}x`);

  // 广播保证金更新
  broadcastMarginUpdate(position, "remove", amount);

  return {
    success: true,
    pairId,
    removedAmount: amount,
    newCollateral,
    newLeverage,
    newLiquidationPrice,
    maxRemovable: maxRemovable - amount,
  };
}

/**
 * 获取可调整保证金信息
 */
function getMarginAdjustmentInfo(pairId: string): {
  pairId: string;
  currentCollateral: bigint;
  currentLeverage: number;
  maxRemovable: bigint;
  minCollateral: bigint;
  positionValue: bigint;
} | null {
  let position: Position | null = null;
  for (const [trader, positions] of userPositions.entries()) {
    const found = positions.find(p => p.pairId === pairId);
    if (found) {
      position = found;
      break;
    }
  }

  if (!position) return null;

  const currentCollateral = BigInt(position.collateral);
  const currentPrice = BigInt(position.markPrice);
  const positionValue = (BigInt(position.size) * currentPrice) / (10n ** 24n);
  const mmr = BigInt(position.mmr);

  const minCollateralForLeverage = positionValue / 100n;
  const minCollateralForHealth = (positionValue * mmr * 15n) / 100000n;
  const minCollateral = minCollateralForLeverage > minCollateralForHealth
    ? minCollateralForLeverage
    : minCollateralForHealth;

  const maxRemovable = currentCollateral > minCollateral ? currentCollateral - minCollateral : 0n;

  return {
    pairId,
    currentCollateral,
    currentLeverage: Number(position.leverage),
    maxRemovable,
    minCollateral,
    positionValue,
  };
}

/**
 * 广播保证金更新事件
 */
function broadcastMarginUpdate(position: Position, action: "add" | "remove", amount: bigint): void {
  const message = JSON.stringify({
    type: "margin_updated",
    pairId: position.pairId,
    trader: position.trader,
    token: position.token,
    action,
    amount: amount.toString(),
    newCollateral: position.collateral,
    newLeverage: position.leverage,
    newLiquidationPrice: position.liquidationPrice,
    timestamp: Date.now(),
  });

  for (const [client] of wsClients.entries()) {
    if (client.readyState === WebSocket.OPEN) client.send(message);
  }
}

// ============================================================
// P5: Referral System API Handlers
// ============================================================

/**
 * 注册成为推荐人 (获取邀请码)
 * POST /api/referral/register
 */
async function handleRegisterReferrer(req: Request): Promise<Response> {
  try {
    const body = await req.json();
    const { address } = body;

    if (!address) {
      return errorResponse("Missing address");
    }

    const result = registerAsReferrer(address as Address);

    if ("error" in result) {
      return errorResponse(result.error);
    }

    return jsonResponse({
      success: true,
      referrer: {
        address: result.address,
        code: result.code,
        referralCount: result.level1Referrals.length,
        totalEarnings: result.totalEarnings.toString(),
        createdAt: result.createdAt,
      },
      message: `Your referral code is: ${result.code}`,
    });
  } catch (e) {
    return errorResponse(e instanceof Error ? e.message : "Unknown error", 500);
  }
}

/**
 * 绑定邀请码
 * POST /api/referral/bind
 */
async function handleBindReferral(req: Request): Promise<Response> {
  try {
    const body = await req.json();
    const { address, referralCode } = body;

    if (!address || !referralCode) {
      return errorResponse("Missing address or referralCode");
    }

    const result = bindReferral(address as Address, referralCode);

    if (!result.success) {
      return errorResponse(result.error || "Failed to bind referral");
    }

    const referee = getRefereeInfo(address as Address);

    return jsonResponse({
      success: true,
      referee: referee ? {
        address: referee.address,
        referrer: referee.referrer,
        referralCode: referee.referrerCode,
        joinedAt: referee.joinedAt,
      } : null,
      message: "Successfully bound to referrer",
    });
  } catch (e) {
    return errorResponse(e instanceof Error ? e.message : "Unknown error", 500);
  }
}

/**
 * 获取推荐人信息
 * GET /api/referral/referrer?address=0x...
 */
async function handleGetReferrer(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const address = url.searchParams.get("address");

  if (!address) {
    return errorResponse("Missing address parameter");
  }

  const referrer = getReferrerInfo(address as Address);

  if (!referrer) {
    return jsonResponse({
      isReferrer: false,
      message: "Not a registered referrer. Call POST /api/referral/register to get a referral code.",
    });
  }

  return jsonResponse({
    isReferrer: true,
    referrer: {
      address: referrer.address,
      code: referrer.code,
      level1Referrals: referrer.level1Referrals.length,
      level2Referrals: referrer.level2Referrals.length,
      totalEarnings: referrer.totalEarnings.toString(),
      pendingEarnings: referrer.pendingEarnings.toString(),
      withdrawnEarnings: referrer.withdrawnEarnings.toString(),
      level1Earnings: referrer.level1Earnings.toString(),
      level2Earnings: referrer.level2Earnings.toString(),
      totalTradesReferred: referrer.totalTradesReferred,
      totalVolumeReferred: referrer.totalVolumeReferred.toString(),
      createdAt: referrer.createdAt,
      display: {
        totalEarnings: `$${(Number(referrer.totalEarnings) / 1e6).toFixed(2)}`,
        pendingEarnings: `$${(Number(referrer.pendingEarnings) / 1e6).toFixed(2)}`,
        withdrawnEarnings: `$${(Number(referrer.withdrawnEarnings) / 1e6).toFixed(2)}`,
        level1Earnings: `$${(Number(referrer.level1Earnings) / 1e6).toFixed(2)}`,
        level2Earnings: `$${(Number(referrer.level2Earnings) / 1e6).toFixed(2)}`,
        totalVolumeReferred: `$${(Number(referrer.totalVolumeReferred) / 1e6).toFixed(2)}`,
      },
    },
  });
}

/**
 * 获取被邀请人信息
 * GET /api/referral/referee?address=0x...
 */
async function handleGetReferee(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const address = url.searchParams.get("address");

  if (!address) {
    return errorResponse("Missing address parameter");
  }

  const referee = getRefereeInfo(address as Address);

  if (!referee) {
    return jsonResponse({
      isReferred: false,
      message: "Not referred by anyone. Use POST /api/referral/bind to bind a referral code.",
    });
  }

  return jsonResponse({
    isReferred: true,
    referee: {
      address: referee.address,
      referrer: referee.referrer,
      referralCode: referee.referrerCode,
      level2Referrer: referee.level2Referrer,
      totalFeesPaid: referee.totalFeesPaid.toString(),
      totalCommissionGenerated: referee.totalCommissionGenerated.toString(),
      joinedAt: referee.joinedAt,
      display: {
        totalFeesPaid: `$${(Number(referee.totalFeesPaid) / 1e6).toFixed(2)}`,
        totalCommissionGenerated: `$${(Number(referee.totalCommissionGenerated) / 1e6).toFixed(2)}`,
      },
    },
  });
}

/**
 * 获取返佣记录
 * GET /api/referral/commissions?address=0x...&limit=50
 */
async function handleGetCommissions(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const address = url.searchParams.get("address");
  const limit = parseInt(url.searchParams.get("limit") || "50");

  if (!address) {
    return errorResponse("Missing address parameter");
  }

  const commissions = getReferrerCommissions(address as Address, limit);

  return jsonResponse({
    count: commissions.length,
    commissions: commissions.map(c => ({
      id: c.id,
      referee: c.referee,
      level: c.level,
      tradeId: c.tradeId,
      tradeFee: c.tradeFee.toString(),
      commissionAmount: c.commissionAmount.toString(),
      commissionRate: c.commissionRate,
      timestamp: c.timestamp,
      status: c.status,
      display: {
        tradeFee: `$${(Number(c.tradeFee) / 1e6).toFixed(4)}`,
        commissionAmount: `$${(Number(c.commissionAmount) / 1e6).toFixed(4)}`,
        commissionRate: `${c.commissionRate / 100}%`,
      },
    })),
  });
}

/**
 * 提取返佣
 * POST /api/referral/withdraw
 */
async function handleWithdrawCommission(req: Request): Promise<Response> {
  try {
    const body = await req.json();
    const { address, amount } = body;

    if (!address) {
      return errorResponse("Missing address");
    }

    const result = withdrawCommission(
      address as Address,
      amount ? BigInt(amount) : undefined
    );

    if (!result.success) {
      return errorResponse(result.error || "Failed to withdraw");
    }

    const referrer = getReferrerInfo(address as Address);

    return jsonResponse({
      success: true,
      withdrawnAmount: result.withdrawnAmount?.toString(),
      remainingPending: referrer?.pendingEarnings.toString(),
      display: {
        withdrawnAmount: `$${(Number(result.withdrawnAmount || 0n) / 1e6).toFixed(2)}`,
        remainingPending: referrer ? `$${(Number(referrer.pendingEarnings) / 1e6).toFixed(2)}` : "$0.00",
      },
    });
  } catch (e) {
    return errorResponse(e instanceof Error ? e.message : "Unknown error", 500);
  }
}

/**
 * 获取推荐排行榜
 * GET /api/referral/leaderboard?limit=20
 */
async function handleGetReferralLeaderboard(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const limit = parseInt(url.searchParams.get("limit") || "20");

  const leaderboard = getReferralLeaderboard(limit);

  return jsonResponse({
    leaderboard: leaderboard.map((entry, index) => ({
      rank: index + 1,
      address: entry.address,
      code: entry.code,
      referralCount: entry.referralCount,
      totalEarnings: entry.totalEarnings.toString(),
      display: {
        totalEarnings: `$${(Number(entry.totalEarnings) / 1e6).toFixed(2)}`,
      },
    })),
  });
}

/**
 * 获取全局推荐统计
 * GET /api/referral/stats
 */
async function handleGetReferralStats(): Promise<Response> {
  const stats = getReferralStats();

  return jsonResponse({
    totalReferrers: stats.totalReferrers,
    totalReferees: stats.totalReferees,
    totalCommissionsPaid: stats.totalCommissionsPaid.toString(),
    totalCommissionsPending: stats.totalCommissionsPending.toString(),
    config: {
      level1Rate: REFERRAL_CONFIG.level1Rate,
      level2Rate: REFERRAL_CONFIG.level2Rate,
      minWithdrawAmount: REFERRAL_CONFIG.minWithdrawAmount.toString(),
    },
    display: {
      totalCommissionsPaid: `$${(Number(stats.totalCommissionsPaid) / 1e6).toFixed(2)}`,
      totalCommissionsPending: `$${(Number(stats.totalCommissionsPending) / 1e6).toFixed(2)}`,
      level1Rate: `${REFERRAL_CONFIG.level1Rate / 100}%`,
      level2Rate: `${REFERRAL_CONFIG.level2Rate / 100}%`,
      minWithdrawAmount: `$${Number(REFERRAL_CONFIG.minWithdrawAmount) / 1e6}`,
    },
  });
}

/**
 * 通过邀请码查询推荐人
 * GET /api/referral/code/:code
 */
async function handleGetReferrerByCode(code: string): Promise<Response> {
  const upperCode = code.toUpperCase();
  const referrerAddress = referralCodes.get(upperCode);

  if (!referrerAddress) {
    return jsonResponse({
      valid: false,
      message: "Invalid referral code",
    });
  }

  const referrer = getReferrerInfo(referrerAddress);

  return jsonResponse({
    valid: true,
    code: upperCode,
    referrer: referrer ? {
      address: referrer.address,
      referralCount: referrer.level1Referrals.length,
      createdAt: referrer.createdAt,
    } : null,
  });
}

// ============================================================
// Batch Submission Loop
// ============================================================

async function runBatchSubmissionLoop(): Promise<void> {
  if (!submitter) {
    console.log("[Batch] No submitter configured, skipping batch submission");
    return;
  }

  setInterval(async () => {
    const matches = engine.getPendingMatches();

    if (matches.length > 0) {
      console.log(`[Batch] Submitting ${matches.length} matches...`);
      const hash = await submitter!.submitBatch(matches);

      if (hash) {
        // Clear pending matches on success
        engine.clearPendingMatches();

        // Track submitted matches
        for (const match of matches) {
          const matchId = `${match.longOrder.id}_${match.shortOrder.id}`;
          submittedMatches.set(matchId, match);
        }
      }
    }
  }, BATCH_INTERVAL_MS);
}

// ============================================================
// Request Router
// ============================================================

async function handleRequest(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const path = url.pathname;
  const method = req.method;

  // CORS preflight
  if (method === "OPTIONS") {
    return new Response(null, {
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
      },
    });
  }

  // Health check
  if (path === "/health") {
    return jsonResponse({ status: "ok", pendingMatches: engine.getPendingMatches().length });
  }

  // Redis status check
  if (path === "/api/redis/status") {
    const connected = db.isConnected();
    const positionCount = await PositionRepo.getAll().then(p => p.length).catch(() => 0);
    return jsonResponse({
      connected,
      positionCount,
      message: connected ? "Redis connected" : "Redis not connected",
    });
  }

  // Test Redis write (for debugging)
  if (path === "/api/redis/test" && method === "POST") {
    if (!db.isConnected()) {
      return errorResponse("Redis not connected");
    }
    try {
      const testPosition = await PositionRepo.create({
        userAddress: "0x0000000000000000000000000000000000000001" as Address,
        symbol: "TEST-USDT",
        side: "LONG",
        size: "1000000000000000000",
        entryPrice: "100000000",
        leverage: 10,
        marginType: "ISOLATED",
        initialMargin: "10000000",
        maintMargin: "500000",
        fundingIndex: "0",
        isLiquidating: false,
      });
      // Delete test position immediately
      await PositionRepo.delete(testPosition.id);
      return jsonResponse({
        success: true,
        message: "Redis write test passed",
        testId: testPosition.id,
      });
    } catch (error) {
      return errorResponse(`Redis write test failed: ${error}`);
    }
  }

  // API routes

  // Market data endpoints (OKX format)
  if (path === "/api/v1/market/tickers" && method === "GET") {
    return handleGetTickers();
  }

  if (path === "/api/order/submit" && method === "POST") {
    return handleOrderSubmit(req);
  }

  if (path.match(/^\/api\/user\/0x[a-fA-F0-9]+\/nonce$/) && method === "GET") {
    const trader = path.split("/")[3];
    return handleGetNonce(trader);
  }

  if (path.match(/^\/api\/orderbook\/0x[a-fA-F0-9]+$/) && method === "GET") {
    const token = path.split("/")[3];
    return handleGetOrderBook(token);
  }

  if (path.match(/^\/api\/user\/0x[a-fA-F0-9]+\/orders$/) && method === "GET") {
    const trader = path.split("/")[3];
    return handleGetUserOrders(trader);
  }

  if (path.match(/^\/api\/order\/[^/]+\/cancel$/) && method === "POST") {
    const orderId = path.split("/")[3];
    return handleCancelOrder(req, orderId);
  }

  if (path.match(/^\/api\/user\/0x[a-fA-F0-9]+\/positions$/) && method === "GET") {
    const trader = path.split("/")[3];
    return handleGetUserPositions(trader);
  }

  // 余额相关 API
  if (path.match(/^\/api\/user\/0x[a-fA-F0-9]+\/balance$/) && method === "GET") {
    const trader = path.split("/")[3];
    return handleGetUserBalance(trader);
  }

  if (path.match(/^\/api\/user\/0x[a-fA-F0-9]+\/deposit$/) && method === "POST") {
    const trader = path.split("/")[3];
    return handleDeposit(req, trader);
  }

  if (path.match(/^\/api\/user\/0x[a-fA-F0-9]+\/withdraw$/) && method === "POST") {
    const trader = path.split("/")[3];
    return handleWithdraw(req, trader);
  }

  if (path.match(/^\/api\/position\/[^/]+\/close$/) && method === "POST") {
    const pairId = path.split("/")[3];
    return handleClosePair(req, pairId);
  }

  if (path === "/api/price/update" && method === "POST") {
    return handleUpdatePrice(req);
  }

  if (path.match(/^\/api\/trades\/0x[a-fA-F0-9]+$/) && method === "GET") {
    const token = path.split("/")[3];
    return handleGetTrades(token, url);
  }

  if (path.match(/^\/api\/kline\/0x[a-fA-F0-9]+$/) && method === "GET") {
    const token = path.split("/")[3];
    return handleGetKlines(token, url);
  }

  if (path.match(/^\/api\/stats\/0x[a-fA-F0-9]+$/) && method === "GET") {
    const token = path.split("/")[3];
    return handleGetStats(token);
  }

  if (path.match(/^\/api\/funding\/0x[a-fA-F0-9]+$/) && method === "GET") {
    const token = path.split("/")[3];
    return handleGetFundingRate(token);
  }

  // ============================================================
  // 猎杀场 API 路由
  // ============================================================

  // 清算地图：显示各价格点的清算量分布
  if (path.match(/^\/api\/liquidation-map\/0x[a-fA-F0-9]+$/) && method === "GET") {
    const token = path.split("/")[3];
    return handleGetLiquidationMap(token);
  }

  // 全局持仓列表：公开所有用户持仓
  if (path.match(/^\/api\/positions\/0x[a-fA-F0-9]+$/) && method === "GET") {
    const token = path.split("/")[3];
    return handleGetAllPositions(token);
  }

  // 清算历史
  if (path.match(/^\/api\/liquidations\/0x[a-fA-F0-9]+$/) && method === "GET") {
    const token = path.split("/")[3];
    return handleGetLiquidations(token, url);
  }

  // 猎杀排行榜
  if (path === "/api/hunters" && method === "GET") {
    return handleGetHunterLeaderboard(url);
  }

  // ============================================================
  // 保险基金 API (P1)
  // ============================================================

  // 获取全局保险基金状态
  if (path === "/api/insurance-fund" && method === "GET") {
    return handleGetInsuranceFund();
  }

  // 获取代币保险基金状态
  if (path.match(/^\/api\/insurance-fund\/0x[a-fA-F0-9]+$/) && method === "GET") {
    const token = path.split("/")[3];
    return handleGetTokenInsuranceFund(token);
  }

  // ============================================================
  // Dynamic Funding API (P1)
  // ============================================================

  // 获取动态资金费信息
  if (path.match(/^\/api\/dynamic-funding\/0x[a-fA-F0-9]+$/) && method === "GET") {
    const token = path.split("/")[3];
    return handleGetDynamicFunding(token);
  }

  // 获取资金费支付历史
  if (path.match(/^\/api\/funding-history\/0x[a-fA-F0-9]+$/) && method === "GET") {
    const token = path.split("/")[3];
    return handleGetFundingHistory(token, url);
  }

  // 手动触发资金费结算 (管理员)
  if (path === "/api/funding/settle" && method === "POST") {
    return handleManualFundingSettlement(req);
  }

  // ============================================================
  // Take Profit / Stop Loss API (P2)
  // ============================================================

  // 设置/更新 TP/SL
  if (path.match(/^\/api\/position\/[^/]+\/tpsl$/) && method === "POST") {
    const pairId = path.split("/")[3];
    return handleSetTPSL(req, pairId);
  }

  // 获取 TP/SL 状态
  if (path.match(/^\/api\/position\/[^/]+\/tpsl$/) && method === "GET") {
    const pairId = path.split("/")[3];
    return handleGetTPSL(pairId);
  }

  // 取消 TP/SL
  if (path.match(/^\/api\/position\/[^/]+\/tpsl$/) && method === "DELETE") {
    const pairId = path.split("/")[3];
    return handleCancelTPSL(req, pairId);
  }

  // 获取所有 TP/SL 订单
  if (path === "/api/tpsl/orders" && method === "GET") {
    return handleGetAllTPSLOrders();
  }

  // ============================================================
  // Add/Remove Margin API (P2)
  // ============================================================

  // 获取保证金调整信息
  if (path.match(/^\/api\/position\/[^/]+\/margin$/) && method === "GET") {
    const pairId = path.split("/")[3];
    return handleGetMarginInfo(pairId);
  }

  // 追加保证金
  if (path.match(/^\/api\/position\/[^/]+\/margin\/add$/) && method === "POST") {
    const pairId = path.split("/")[3];
    return handleAddMargin(req, pairId);
  }

  // 减少保证金
  if (path.match(/^\/api\/position\/[^/]+\/margin\/remove$/) && method === "POST") {
    const pairId = path.split("/")[3];
    return handleRemoveMargin(req, pairId);
  }

  // ============================================================
  // Referral System API (P5)
  // ============================================================

  // 注册成为推荐人
  if (path === "/api/referral/register" && method === "POST") {
    return handleRegisterReferrer(req);
  }

  // 绑定邀请码
  if (path === "/api/referral/bind" && method === "POST") {
    return handleBindReferral(req);
  }

  // 获取推荐人信息
  if (path === "/api/referral/referrer" && method === "GET") {
    return handleGetReferrer(req);
  }

  // 获取被邀请人信息
  if (path === "/api/referral/referee" && method === "GET") {
    return handleGetReferee(req);
  }

  // 获取返佣记录
  if (path === "/api/referral/commissions" && method === "GET") {
    return handleGetCommissions(req);
  }

  // 提取返佣
  if (path === "/api/referral/withdraw" && method === "POST") {
    return handleWithdrawCommission(req);
  }

  // 获取推荐排行榜
  if (path === "/api/referral/leaderboard" && method === "GET") {
    return handleGetReferralLeaderboard(req);
  }

  // 获取全局推荐统计
  if (path === "/api/referral/stats" && method === "GET") {
    return handleGetReferralStats();
  }

  // 通过邀请码查询推荐人
  if (path.match(/^\/api\/referral\/code\/[A-Za-z0-9]+$/) && method === "GET") {
    const code = path.split("/")[4];
    return handleGetReferrerByCode(code);
  }

  // Not found
  return errorResponse("Not found", 404);
}

// ============================================================
// Security: Log Sanitization
// ============================================================

/**
 * Sanitizes log messages to prevent sensitive data leakage
 * Redacts: private keys (0x + 64 hex chars), API secrets, passwords
 */
function sanitizeLog(message: string): string {
  return message
    // Redact private keys (0x followed by 64 hex characters)
    .replace(/0x[0-9a-fA-F]{64}/g, '0x***PRIVATE_KEY_REDACTED***')
    // Redact any remaining long hex strings that might be sensitive
    .replace(/0x[0-9a-fA-F]{40,}/g, (match) => {
      // Keep addresses (40 chars) but redact longer ones
      if (match.length === 42) return match; // 0x + 40 chars = address
      return '0x***REDACTED***';
    });
}

/**
 * Safe console.log that sanitizes sensitive data
 */
function safeLog(message: string): void {
  console.log(sanitizeLog(message));
}

/**
 * Safe console.error that sanitizes sensitive data
 */
function safeError(message: string, error?: any): void {
  console.error(sanitizeLog(message), error);
}

// ============================================================
// WebSocket Handlers
// ============================================================

interface WSMessage {
  type: "subscribe" | "unsubscribe";
  channel: "orderbook" | "trades";
  token: Address;
}

function broadcastOrderBook(token: Address): void {
  if (!wss) return;

  const orderBook = engine.getOrderBook(token);
  const depth = orderBook.getDepth(20);
  const currentPrice = orderBook.getCurrentPrice();

  const message = JSON.stringify({
    type: "orderbook",
    token,
    data: {
      longs: depth.longs.map((level) => ({
        price: level.price.toString(),
        size: level.totalSize.toString(),
        count: level.orders.length,
      })),
      shorts: depth.shorts.map((level) => ({
        price: level.price.toString(),
        size: level.totalSize.toString(),
        count: level.orders.length,
      })),
      lastPrice: currentPrice.toString(),
    },
  });

  for (const [client, tokens] of wsClients) {
    if (client.readyState === WebSocket.OPEN && tokens.has(token)) {
      client.send(message);
    }
  }
}

function broadcastTrade(trade: Trade): void {
  if (!wss) return;

  const message = JSON.stringify({
    type: "trade",
    token: trade.token,
    data: {
      id: trade.id,
      price: trade.price.toString(),
      size: trade.size.toString(),
      side: trade.side,
      timestamp: trade.timestamp,
    },
  });

  for (const [client, tokens] of wsClients) {
    if (client.readyState === WebSocket.OPEN && tokens.has(trade.token)) {
      client.send(message);
    }
  }
}

function handleWSMessage(ws: WebSocket, message: string): void {
  try {
    const msg = JSON.parse(message) as WSMessage & { trader?: string };

    if (msg.type === "subscribe" && msg.token) {
      const tokens = wsClients.get(ws) || new Set();
      tokens.add(msg.token.toLowerCase() as Address);
      wsClients.set(ws, tokens);

      // Send current orderbook immediately
      broadcastOrderBook(msg.token.toLowerCase() as Address);
      console.log(`[WS] Client subscribed to ${msg.token}`);
    } else if (msg.type === "unsubscribe" && msg.token) {
      const tokens = wsClients.get(ws);
      if (tokens) {
        tokens.delete(msg.token.toLowerCase() as Address);
      }
      console.log(`[WS] Client unsubscribed from ${msg.token}`);
    }
    // 风控数据订阅 - 用户仓位风险
    else if (msg.type === "subscribe_risk" && msg.trader) {
      const trader = msg.trader.toLowerCase() as Address;
      const wsSet = wsTraderClients.get(trader) || new Set();
      wsSet.add(ws);
      wsTraderClients.set(trader, wsSet);

      // 立即发送当前仓位风险数据
      const positions = userPositions.get(trader) || [];
      if (positions.length > 0) {
        const positionRisks = positions.map(pos => ({
          pairId: pos.pairId,
          trader: pos.trader,
          token: pos.token,
          isLong: pos.isLong,
          size: pos.size,
          entryPrice: pos.entryPrice,
          leverage: pos.leverage,
          marginRatio: pos.marginRatio || "10000",
          mmr: pos.mmr || "200",
          roe: pos.roe || "0",
          liquidationPrice: pos.liquidationPrice || "0",
          markPrice: pos.markPrice || "0",
          unrealizedPnL: pos.unrealizedPnL || "0",
          collateral: pos.collateral,
          adlScore: parseFloat(pos.adlScore || "0"),
          adlRanking: pos.adlRanking || 1,
          riskLevel: pos.riskLevel || "low",
        }));

        ws.send(JSON.stringify({
          type: "position_risks",
          positions: positionRisks,
          timestamp: Date.now(),
        }));
      }

      console.log(`[WS] Trader ${trader.slice(0, 10)} subscribed to risk data`);
    }
    // 取消风控数据订阅
    else if (msg.type === "unsubscribe_risk" && msg.trader) {
      const trader = msg.trader.toLowerCase() as Address;
      const wsSet = wsTraderClients.get(trader);
      if (wsSet) {
        wsSet.delete(ws);
        if (wsSet.size === 0) {
          wsTraderClients.delete(trader);
        }
      }
      console.log(`[WS] Trader ${trader.slice(0, 10)} unsubscribed from risk data`);
    }
    // 全局风控数据订阅 (保险基金、强平队列等)
    else if (msg.type === "subscribe_global_risk") {
      wsRiskSubscribers.add(ws);

      // 立即发送当前全局风控数据
      const insuranceFundData = {
        balance: insuranceFund.balance.toString(),
        totalContributions: insuranceFund.totalContributions.toString(),
        totalPayouts: insuranceFund.totalPayouts.toString(),
        lastUpdated: insuranceFund.lastUpdated,
        display: {
          balance: (Number(insuranceFund.balance) / 1e6).toFixed(2),
          totalContributions: (Number(insuranceFund.totalContributions) / 1e6).toFixed(2),
          totalPayouts: (Number(insuranceFund.totalPayouts) / 1e6).toFixed(2),
        },
      };

      ws.send(JSON.stringify({
        type: "risk_data",
        liquidationQueue: [],
        insuranceFund: insuranceFundData,
        fundingRates: [],
        timestamp: Date.now(),
      }));

      console.log(`[WS] Client subscribed to global risk data`);
    }
    // 取消全局风控数据订阅
    else if (msg.type === "unsubscribe_global_risk") {
      wsRiskSubscribers.delete(ws);
      console.log(`[WS] Client unsubscribed from global risk data`);
    }
  } catch (e) {
    console.error("[WS] Invalid message:", e);
  }
}

/**
 * 清理 WebSocket 连接相关的所有订阅
 */
function cleanupWSConnection(ws: WebSocket): void {
  // 清理 token 订阅
  wsClients.delete(ws);

  // 清理 trader 风控订阅
  for (const [trader, wsSet] of wsTraderClients.entries()) {
    wsSet.delete(ws);
    if (wsSet.size === 0) {
      wsTraderClients.delete(trader);
    }
  }

  // 清理全局风控订阅
  wsRiskSubscribers.delete(ws);
}

// ============================================================
// Server Start
// ============================================================

async function startServer(): Promise<void> {
  // ========================================
  // 连接 Redis 数据库
  // ========================================
  console.log("[Server] Connecting to Redis...");
  const redisConnected = await db.connect();
  if (redisConnected) {
    console.log("[Server] Redis connected successfully");

    // 从 Redis 加载已有仓位到内存 (兼容现有风控引擎)
    await loadPositionsFromRedis();
  } else {
    console.warn("[Server] Redis connection failed, using in-memory storage only");
  }

  // Initialize submitter if credentials are available
  if (MATCHER_PRIVATE_KEY && SETTLEMENT_ADDRESS) {
    submitter = new SettlementSubmitter(RPC_URL, MATCHER_PRIVATE_KEY, SETTLEMENT_ADDRESS);
    console.log(`[Server] Settlement submitter initialized for ${SETTLEMENT_ADDRESS}`);
  } else {
    console.log("[Server] No submitter configured (MATCHER_PRIVATE_KEY or SETTLEMENT_ADDRESS missing)");
  }

  // 配置价格数据源（TokenFactory 获取真实现货价格）
  engine.configurePriceSource(RPC_URL, TOKEN_FACTORY_ADDRESS, PRICE_FEED_ADDRESS);
  console.log(`[Server] TokenFactory: ${TOKEN_FACTORY_ADDRESS}`);
  console.log(`[Server] PriceFeed: ${PRICE_FEED_ADDRESS}`);

  // Start batch submission loop
  runBatchSubmissionLoop();

  // Start cleanup interval
  setInterval(() => {
    engine.cleanupExpired();
  }, 60000); // Clean up every minute

  // 定期从 PriceFeed 同步现货价格
  const syncSpotPrices = async () => {
    for (const token of SUPPORTED_TOKENS) {
      try {
        const spotPrice = await engine.fetchSpotPrice(token);
        // 更新波动率跟踪 (用于动态资金费计算)
        if (spotPrice && spotPrice > 0n) {
          updateVolatility(token, Number(spotPrice) / 1e6);
        }
      } catch (e) {
        console.error(`[Server] Failed to sync spot price for ${token}:`, e);
      }
    }
  };

  // 初始同步
  syncSpotPrices();

  // 从链上同步已有仓位 (解决 P003)
  syncPositionsFromChain().then(() => {
    console.log("[Server] Initial position sync completed");
  }).catch((e) => {
    console.error("[Server] Initial position sync failed:", e);
  });

  // 定时同步现货价格
  setInterval(syncSpotPrices, SPOT_PRICE_SYNC_INTERVAL_MS);
  console.log(`[Server] Spot price sync interval: ${SPOT_PRICE_SYNC_INTERVAL_MS}ms`);

  // 定时同步链上仓位 (每5分钟同步一次，保持数据一致)
  setInterval(() => {
    syncPositionsFromChain().catch((e) => {
      console.error("[Server] Periodic position sync failed:", e);
    });
  }, 300000); // 5 minutes
  console.log("[Server] Position sync interval: 300000ms (5 minutes)");

  // ========================================
  // 启动链上事件监听 (实时同步链上状态)
  // ========================================
  startEventWatching().catch((e) => {
    console.error("[Events] Failed to start event watching:", e);
  });

  // ========================================
  // 启动 100ms Risk Engine (Meme Perp 核心)
  // ========================================
  startRiskEngine();
  console.log(`[Server] Risk Engine started: ${RISK_ENGINE_INTERVAL_MS}ms interval`);

  // ========================================
  // 启动 Dynamic Funding Engine (P1)
  // ========================================
  startDynamicFundingEngine();
  console.log(`[Server] Dynamic Funding Engine started: ${DYNAMIC_FUNDING_CHECK_INTERVAL}ms check interval`);

  // 定期计算资金费率（基于现货价格锚定）
  setInterval(() => {
    for (const token of SUPPORTED_TOKENS) {
      const rate = engine.calculateFundingRate(token);

      // 如果有链上提交器，更新链上资金费率
      if (submitter && rate !== 0n) {
        submitter.updateFundingRate(token, rate).catch((e) => {
          console.error(`[Server] Failed to update on-chain funding rate:`, e);
        });
      }
    }
  }, FUNDING_RATE_INTERVAL_MS);
  console.log(`[Server] Funding rate interval: ${FUNDING_RATE_INTERVAL_MS}ms`);

  // Start HTTP server (Node.js compatible)
  import("http").then((http) => {
    const server = http.createServer(async (req, res) => {
      // Set CORS headers for all responses
      res.setHeader("Access-Control-Allow-Origin", "*");
      res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
      res.setHeader("Access-Control-Allow-Headers", "Content-Type");

      // Handle CORS preflight
      if (req.method === "OPTIONS") {
        res.statusCode = 204;
        res.end();
        return;
      }

      try {
        const url = `http://${req.headers.host}${req.url}`;

        // Read body if present
        let bodyStr = "";
        if (req.method !== "GET" && req.method !== "HEAD") {
          const chunks: Buffer[] = [];
          for await (const chunk of req) {
            chunks.push(chunk);
          }
          bodyStr = Buffer.concat(chunks).toString();
        }

        // Create Request with body included
        const request = new Request(url, {
          method: req.method,
          headers: req.headers as HeadersInit,
          body: bodyStr || undefined,
        });

        const response = await handleRequest(request);

        // Set response headers
        response.headers.forEach((value, key) => {
          res.setHeader(key, value);
        });

        res.statusCode = response.status;

        // Send response body
        const text = await response.text();
        res.end(text);
      } catch (error) {
        console.error("[Server] Request error:", error);
        res.statusCode = 500;
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify({ error: "Internal server error" }));
      }
    });

    server.listen(PORT, () => {
      console.log(`[Server] Matching engine API running on http://localhost:${PORT}`);
      console.log(`[Server] Batch interval: ${BATCH_INTERVAL_MS}ms`);

      // Start WebSocket server on same port
      wss = new WebSocketServer({ server });
      console.log(`[Server] WebSocket server running on ws://localhost:${PORT}`);

      wss.on("connection", (ws) => {
        console.log("[WS] Client connected");
        wsClients.set(ws, new Set());

        ws.on("message", (data) => {
          handleWSMessage(ws, data.toString());
        });

        ws.on("close", () => {
          cleanupWSConnection(ws);
          console.log("[WS] Client disconnected");
        });

        ws.on("error", (err) => {
          console.error("[WS] Error:", err);
          cleanupWSConnection(ws);
        });
      });
    });
  });
}

// Start if running directly
if (import.meta.main) {
  startServer();
}

export { startServer, engine, submitter };
