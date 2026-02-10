/**
 * 撮合引擎 HTTP API 服务器 + WebSocket 推送
 *
 * 为前端提供：
 * - REST API: 订单提交、订单簿查询、仓位查询等
 * - WebSocket: 实时推送订单簿、成交记录
 */

import "dotenv/config";
import { type Address, type Hex, verifyTypedData, createPublicClient, http, webSocket } from "viem";
import { baseSepolia } from "viem/chains";
import { WebSocketServer, WebSocket } from "ws";
import { MatchingEngine, OrderType, OrderStatus, TimeInForce, OrderSource, registerPriceChangeCallback, type Order, type Match, type Trade, type Kline, type TokenStats } from "./engine";
// ❌ Mode 2: SettlementSubmitter 已从导入中移除
import type { TradeRecord } from "./types";
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
import { connectRedis as connectNewRedis, TradeRepo, OrderMarginRepo, Mode2AdjustmentRepo, SettlementLogRepo as RedisSettlementLogRepo, withLock, safeBigInt, cleanupStaleOrders, cleanupClosedPositions, type PerpTrade } from "./database/redis";
import { verifyOrderSignature } from "./utils/crypto";
import { createWalletClient } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { getSigningKey, getActiveSessionForDerived, registerTradingSession } from "./modules/wallet";
import { getTokenHolders } from "./modules/tokenHolders";
// ============================================================
// Mode 2 Modules (Off-chain Execution + On-chain Attestation)
// ============================================================
import { initializeSnapshotModule, startSnapshotJob, getUserProof, getSnapshotJobStatus } from "./modules/snapshot";
import { initializeWithdrawModule, requestWithdrawal, getWithdrawModuleStatus } from "./modules/withdraw";
import {
  initLendingLiquidation,
  detectLendingLiquidations,
  updateLendingLiquidationQueue,
  processLendingLiquidations,
  getActiveBorrows,
  getLendingLiquidationMetrics,
  trackBorrow,
  trackRepay,
} from "./modules/lendingLiquidation";
import {
  initPerpVault,
  isPerpVaultEnabled,
  getPoolStats as getPerpVaultPoolStats,
  getTokenOI as getPerpVaultTokenOI,
  getLPInfo as getPerpVaultLPInfo,
  getPerpVaultMetrics,
} from "./modules/perpVault";

// ============================================================
// Configuration
// ============================================================

const PORT = parseInt(process.env.PORT || "8081");
const RPC_URL = process.env.RPC_URL || "https://base-sepolia-rpc.publicnode.com";
const WSS_URL = process.env.WSS_URL || "wss://base-sepolia-rpc.publicnode.com";
const MATCHER_PRIVATE_KEY = process.env.MATCHER_PRIVATE_KEY as Hex;
const SETTLEMENT_ADDRESS = process.env.SETTLEMENT_ADDRESS as Address;
const TOKEN_FACTORY_ADDRESS = (process.env.TOKEN_FACTORY_ADDRESS || "0x8de2Ce2a0f974b4CB00EC5B56BD89382690b5523") as Address;
const PRICE_FEED_ADDRESS = (process.env.PRICE_FEED_ADDRESS || "0xa97a1E55cFfF5C1e45Ac2c1D882717cDD4F44e01") as Address;
const LENDING_POOL_ADDRESS_LOCAL = (process.env.LENDING_POOL_ADDRESS || "0x7Ddb15B5E680D8a74FE44958d18387Bb3999C633") as Address;
const LIQUIDATION_ADDRESS_LOCAL = (process.env.LIQUIDATION_ADDRESS || "0x80c720F87cd061B5952d1d84Ce900aa91CBB167B") as Address;
const PERP_VAULT_ADDRESS_LOCAL = (process.env.PERP_VAULT_ADDRESS || "") as Address;
const BATCH_INTERVAL_MS = parseInt(process.env.BATCH_INTERVAL_MS || "30000"); // 30 seconds
const FUNDING_RATE_INTERVAL_MS = parseInt(process.env.FUNDING_RATE_INTERVAL_MS || "5000"); // 5 seconds
const SPOT_PRICE_SYNC_INTERVAL_MS = parseInt(process.env.SPOT_PRICE_SYNC_INTERVAL_MS || "1000"); // 1 second
const SKIP_SIGNATURE_VERIFY = process.env.SKIP_SIGNATURE_VERIFY === "true"; // 测试模式：跳过签名验证
const FEE_RECEIVER_ADDRESS = (process.env.FEE_RECEIVER_ADDRESS || "0x5AF11d4784c3739cf2FD51Fdc272ae4957ADf7fE").toLowerCase() as Address; // 平台手续费接收钱包

// ETH/USD 价格 - 仅用于 UI 参考显示，不影响 ETH 本位交易逻辑
// TODO: 可后续接入价格预言机 (如 Chainlink) 获取实时价格
let currentEthPriceUsd = 2500;

// 支持的代币列表（动态从 TokenFactory 获取）
const SUPPORTED_TOKENS: Address[] = [
  // 不再硬编码，从链上 TokenFactory.getAllTokens() 获取
];

// ============================================================
// 毕业代币追踪 (Uniswap V2 价格源切换)
// ============================================================
// 当代币从 bonding curve 毕业到 Uniswap V2 后，价格源需要切换
// token address (lowercase) => { pairAddress, isWethToken0 }

const WETH_ADDRESS = "0x4200000000000000000000000000000000000006" as Address;
const UNISWAP_V2_FACTORY_ADDRESS = "0x02a84c1b3BBD7401a5f7fa98a384EBC70bB5749E" as Address;

interface GraduatedTokenInfo {
  pairAddress: Address;    // Uniswap V2 Pair 地址
  isWethToken0: boolean;   // WETH 是否为 token0 (影响 reserve 顺序)
}

const graduatedTokens = new Map<string, GraduatedTokenInfo>();

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

// ============================================================
// Settlement 合约 ABI (Mode 2 精简版 - 仅资金托管)
// ============================================================
// Mode 2: 移除所有仓位相关函数 (getPairedPosition, settleBatch, closePair, liquidate)
// 仅保留: 余额查询、存款、提款、资金事件监听
const SETTLEMENT_ABI = [
  // ========== View Functions (资金托管) ==========
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
  // ========== Write Functions (资金托管) ==========
  {
    inputs: [
      { name: "token", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    name: "deposit",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    // depositETH: 存入原生 ETH → 自动包装为 WETH → 计入用户 available 余额
    // 调用者 (msg.sender) 的 ETH 被发送到合约，合约内部 wrap 为 WETH
    inputs: [],
    name: "depositETH",
    outputs: [],
    stateMutability: "payable",
    type: "function",
  },
  {
    inputs: [
      { name: "token", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    name: "withdraw",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
  // ========== Events (资金变动监听) ==========
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
] as const;

// TokenFactory ABI (用于监听现货交易事件)
const TOKEN_FACTORY_ABI = [
  {
    type: "event",
    name: "TokenCreated",
    inputs: [
      { name: "tokenAddress", type: "address", indexed: true },
      { name: "creator", type: "address", indexed: true },
      { name: "name", type: "string", indexed: false },
      { name: "symbol", type: "string", indexed: false },
      { name: "uri", type: "string", indexed: false },
      { name: "totalSupply", type: "uint256", indexed: false },
    ],
  },
  {
    type: "event",
    name: "Trade",
    inputs: [
      { name: "token", type: "address", indexed: true },
      { name: "trader", type: "address", indexed: true },
      { name: "isBuy", type: "bool", indexed: false },
      { name: "ethAmount", type: "uint256", indexed: false },
      { name: "tokenAmount", type: "uint256", indexed: false },
      { name: "virtualEth", type: "uint256", indexed: false },
      { name: "virtualToken", type: "uint256", indexed: false },
      { name: "timestamp", type: "uint256", indexed: false },
    ],
  },
  {
    inputs: [{ name: "tokenAddress", type: "address" }],
    name: "getCurrentPrice",
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [],
    name: "getAllTokens",
    outputs: [{ name: "", type: "address[]" }],
    stateMutability: "view",
    type: "function",
  },
  // getPoolState - 用于检测代币毕业状态
  {
    inputs: [{ name: "tokenAddress", type: "address" }],
    name: "getPoolState",
    outputs: [{
      name: "",
      type: "tuple",
      components: [
        { name: "realETHReserve", type: "uint256" },
        { name: "realTokenReserve", type: "uint256" },
        { name: "soldTokens", type: "uint256" },
        { name: "isGraduated", type: "bool" },
        { name: "isActive", type: "bool" },
        { name: "creator", type: "address" },
        { name: "createdAt", type: "uint64" },
        { name: "metadataURI", type: "string" },
        { name: "graduationFailed", type: "bool" },
        { name: "graduationAttempts", type: "uint8" },
        { name: "perpEnabled", type: "bool" },
      ],
    }],
    stateMutability: "view",
    type: "function",
  },
  // LiquidityMigrated 事件 - 代币毕业到 Uniswap V2
  {
    type: "event",
    name: "LiquidityMigrated",
    inputs: [
      { name: "tokenAddress", type: "address", indexed: true },
      { name: "pairAddress", type: "address", indexed: true },
      { name: "ethLiquidity", type: "uint256", indexed: false },
      { name: "tokenLiquidity", type: "uint256", indexed: false },
      { name: "timestamp", type: "uint256", indexed: false },
    ],
  },
] as const;

// Uniswap V2 Pair ABI (用于毕业后从 DEX 读取价格)
const UNISWAP_V2_PAIR_ABI = [
  {
    inputs: [],
    name: "getReserves",
    outputs: [
      { name: "reserve0", type: "uint112" },
      { name: "reserve1", type: "uint112" },
      { name: "blockTimestampLast", type: "uint32" },
    ],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [],
    name: "token0",
    outputs: [{ name: "", type: "address" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [],
    name: "token1",
    outputs: [{ name: "", type: "address" }],
    stateMutability: "view",
    type: "function",
  },
] as const;

// Uniswap V2 Factory ABI (用于查找 Pair 地址)
const UNISWAP_V2_FACTORY_ABI = [
  {
    inputs: [
      { name: "tokenA", type: "address" },
      { name: "tokenB", type: "address" },
    ],
    name: "getPair",
    outputs: [{ name: "pair", type: "address" }],
    stateMutability: "view",
    type: "function",
  },
] as const;

// ============================================================
// State
// ============================================================

const engine = new MatchingEngine();
// ❌ Mode 2: submitter 已移除，不再提交到链上
// let submitter: SettlementSubmitter | null = null;

// ============================================================
// ETH 本位系统: 不再需要 ETH/USD 价格
// ============================================================
// 所有计算直接使用 Token/ETH 价格 (1e18)
// 用户 PnL 只受 Token/ETH 波动影响，与 ETH/USD 无关

// WebSocket state
let wss: WebSocketServer | null = null;
const wsClients = new Map<WebSocket, Set<Address>>(); // client => subscribed tokens
const wsTraderClients = new Map<Address, Set<WebSocket>>(); // trader => websocket connections (for risk data)
const wsRiskSubscribers = new Set<WebSocket>(); // clients subscribed to global risk data

// Risk broadcast throttling
let lastRiskBroadcast = 0;
const RISK_BROADCAST_INTERVAL_MS = 500; // Broadcast risk data every 500ms max

// Liquidation map broadcast throttling (per token)
const lastLiquidationMapBroadcast = new Map<Address, number>();
const LIQUIDATION_MAP_BROADCAST_INTERVAL_MS = 2000; // 2 seconds between broadcasts per token

// User nonces - 不再内部追踪，从链上同步
// 撮合引擎只负责撮合，nonce验证由链上合约处理
const userNonces = new Map<Address, bigint>();
const SYNC_NONCE_FROM_CHAIN = true; // 启用链上nonce同步

// Submitted pairs tracking
const submittedMatches = new Map<string, Match>();

// Position tracking (from on-chain events, simplified for now)
/**
 * 仓位信息 (ETH 本位 - 参考 OKX/Binance/Bybit)
 *
 * Meme Perp 特有字段：
 * - bankruptcyPrice: 穿仓价格
 * - mmr: 动态维持保证金率 (meme 需要更高)
 * - adlScore: ADL 评分用于排序
 *
 * ETH 本位: 所有价格/保证金/盈亏都以 ETH 计价 (1e18 精度)
 */
interface Position {
  // === 基本标识 ===
  pairId: string;
  trader: Address;
  token: Address;

  // === 仓位参数 ===
  isLong: boolean;
  size: string;                   // 仓位大小 (代币数量, 1e18)
  entryPrice: string;             // 开仓均价 (ETH/Token, 1e18)
  averageEntryPrice: string;      // 加仓后的平均价格 (ETH/Token, 1e18)
  leverage: string;               // 杠杆倍数 (整数)

  // === 价格信息 ===
  markPrice: string;              // 标记价格 (ETH/Token, 1e18)
  liquidationPrice: string;       // 强平价格 (ETH/Token, 1e18)
  bankruptcyPrice: string;        // 穿仓价格 (ETH/Token, 1e18)
  breakEvenPrice: string;         // 盈亏平衡价格 (含手续费, 1e18)

  // === 保证金信息 (ETH 本位) ===
  collateral: string;             // 初始保证金 (1e18 ETH)
  margin: string;                 // 当前保证金 = 初始 + UPNL (1e18 ETH)
  marginRatio: string;            // 保证金率 (基点, 10000 = 100%)
  mmr: string;                    // 维持保证金率 (基点, 动态调整)
  maintenanceMargin: string;      // 维持保证金金额 (1e18 ETH)

  // === 盈亏信息 (ETH 本位) ===
  unrealizedPnL: string;          // 未实现盈亏 (1e18 ETH)
  realizedPnL: string;            // 已实现盈亏 (1e18 ETH)
  roe: string;                    // 收益率 ROE% (基点)
  fundingFee: string;             // 累计资金费 (1e18 ETH)

  // === 止盈止损 ===
  takeProfitPrice: string | null;
  stopLossPrice: string | null;

  // === 关联订单 ===
  orderId: string;                // 创建此仓位的订单ID (排查用)
  orderIds: string[];             // 所有关联订单ID (加仓时追加)

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

// 用户交易历史 (强平、ADL、正常平仓等)
const userTrades = new Map<Address, TradeRecord[]>();

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

    let loaded = 0;
    let skippedLiquidating = 0;

    for (const dbPos of dbPositions) {
      try {
        // deserializePosition 已兼容旧格式 (userAddress→trader, symbol→token, side→isLong, initialMargin→collateral)
        // 跳过正在被强平的仓位 (上次重启前未完成的强平)
        if (dbPos.isLiquidating) {
          skippedLiquidating++;
          console.log(`[Redis] Skipping liquidating position: ${dbPos.id} (${dbPos.trader?.slice(0, 10) || '?'})`);
          // 从 Redis 中删除已标记为强平的仓位 (清理过期数据)
          PositionRepo.delete(dbPos.id).catch(e => console.error(`[Redis] Failed to delete liquidating position: ${e}`));
          continue;
        }

        // ✅ 清理僵尸仓位: collateral=0 且 size>0 说明已被强平但未从 Redis 清理
        const posCollateral = BigInt(dbPos.collateral?.toString() || "0");
        const posSize = BigInt(dbPos.size?.toString() || "0");
        if (posCollateral <= 0n && posSize > 0n) {
          skippedLiquidating++;
          console.log(`[Redis] Cleaning zombie position (collateral=0): ${dbPos.id} (${dbPos.trader?.slice(0, 10) || '?'} size=${dbPos.size})`);
          PositionRepo.delete(dbPos.id).catch(e => console.error(`[Redis] Failed to delete zombie position: ${e}`));
          continue;
        }

        // 验证必要字段
        // dbPos.trader 来自 deserializePosition，已兼容旧格式 (data.trader || data.userAddress)
        const traderRaw = dbPos.trader || (dbPos as any).userAddress || "";
        const userAddr = traderRaw.toLowerCase() as Address;
        if (!userAddr || userAddr.length < 10) {
          console.warn(`[Redis] Skipping position with empty trader: ${dbPos.id} (raw trader='${traderRaw}', keys=${Object.keys(dbPos).slice(0, 5).join(",")})`);
          continue;
        }

        // token 也需要兼容旧格式
        const tokenRaw = dbPos.token || ((dbPos as any).symbol ? (dbPos as any).symbol.replace("-ETH", "") : "");
        const tokenAddr = tokenRaw.toLowerCase() as Address;
        if (!tokenAddr || tokenAddr.length < 10) {
          console.warn(`[Redis] Skipping position with empty token: ${dbPos.id} (raw token='${tokenRaw}')`);
          continue;
        }

        // 直接使用 deserializePosition 返回的数据 (已经是正确的 Position 格式)
        // 补充 dbPositionToMemory 中的额外处理
        const memPos: Position = {
          ...dbPos,
          pairId: dbPos.pairId || dbPos.id,
          trader: userAddr,
          token: tokenAddr,
          leverage: dbPos.leverage?.toString() || "1",
          collateral: dbPos.collateral?.toString() || dbPos.margin?.toString() || "0",
          margin: dbPos.margin?.toString() || dbPos.collateral?.toString() || "0",
          maintenanceMargin: dbPos.maintenanceMargin?.toString() || "0",
          markPrice: dbPos.markPrice?.toString() || "0",
          unrealizedPnL: dbPos.unrealizedPnL?.toString() || "0",
          marginRatio: dbPos.marginRatio?.toString() || "10000",
          mmr: dbPos.mmr?.toString() || "200",
          liquidationPrice: dbPos.liquidationPrice?.toString() || "0",
          bankruptcyPrice: dbPos.bankruptcyPrice?.toString() || "0",
          roe: dbPos.roe?.toString() || "0",
          realizedPnL: dbPos.realizedPnL?.toString() || "0",
          accFundingFee: "0",
          adlRanking: dbPos.adlRanking || 1,
          adlScore: dbPos.adlScore?.toString() || "0",
          riskLevel: dbPos.riskLevel || "low",
          isLiquidatable: dbPos.riskLevel === "critical",
          isAdlCandidate: false,
          fundingIndex: dbPos.fundingIndex?.toString() || "0",
          size: dbPos.size?.toString() || "0",
          entryPrice: dbPos.entryPrice?.toString() || "0",
        };

        const existing = userPositions.get(userAddr) || [];

        // ✅ 修复: 去重 — 同一 (token, isLong) 只保留最新的仓位 (最大 size)
        // 防止旧 bug 导致的重复 Redis 记录全部加载到内存
        const dupeIndex = existing.findIndex(
          (p) => p.token === tokenAddr && p.isLong === memPos.isLong
        );
        if (dupeIndex >= 0) {
          const dupePos = existing[dupeIndex];
          // 保留 size 更大的那个 (最终合并后的仓位)
          if (BigInt(memPos.size) > BigInt(dupePos.size)) {
            console.log(`[Redis] Dedup: replacing ${dupePos.pairId.slice(0, 12)} (size=${dupePos.size}) with ${memPos.pairId.slice(0, 12)} (size=${memPos.size})`);
            // 删除旧的重复记录
            PositionRepo.delete(dupePos.pairId).catch(e =>
              console.error(`[Redis] Failed to delete duplicate position:`, e));
            existing[dupeIndex] = memPos;
          } else {
            // 当前记录 size 更小，说明它是旧的部分成交记录，删除它
            PositionRepo.delete(memPos.pairId).catch(e =>
              console.error(`[Redis] Failed to delete duplicate position:`, e));
          }
        } else {
          existing.push(memPos);
        }

        userPositions.set(userAddr, existing);
        loaded++;
      } catch (posError) {
        console.error(`[Redis] Failed to load position ${dbPos.id}:`, posError);
      }
    }

    console.log(`[Redis] Loaded ${loaded} positions into memory (skipped ${skippedLiquidating} liquidating)`);
  } catch (error) {
    console.error("[Redis] Failed to load positions:", error);
  }
}

/**
 * 从 Redis 加载所有待处理订单到撮合引擎
 */
async function loadOrdersFromRedis(): Promise<void> {
  if (!db.isConnected()) return;

  try {
    let totalOrders = 0;
    const symbols = new Set<string>();

    // 获取所有支持的代币
    for (const token of SUPPORTED_TOKENS) {
      const symbol = `${token.slice(0, 10).toUpperCase()}-ETH`;
      symbols.add(symbol);
    }

    console.log(`[Redis] Loading orders from ${symbols.size} symbols...`);

    // 从数据库加载每个交易对的待处理订单
    for (const symbol of symbols) {
      const dbOrders = await OrderRepo.getPendingBySymbol(symbol);

      for (const dbOrder of dbOrders) {
        // 将数据库订单转换为引擎订单格式
        const engineOrder: Order = {
          id: dbOrder.id,
          clientOrderId: undefined,
          trader: dbOrder.userAddress,
          token: dbOrder.token,
          isLong: dbOrder.side === "LONG",
          size: BigInt(dbOrder.size),
          leverage: BigInt(Math.floor(dbOrder.leverage * 10000)), // 5x -> 50000
          price: BigInt(dbOrder.price),
          orderType: dbOrder.orderType === "MARKET" ? OrderType.MARKET : OrderType.LIMIT,
          timeInForce: TimeInForce.GTC,
          reduceOnly: dbOrder.reduceOnly,
          postOnly: dbOrder.postOnly,
          status: OrderStatus.PENDING,
          filledSize: BigInt(dbOrder.filledSize),
          avgFillPrice: BigInt(dbOrder.avgFillPrice),
          totalFillValue: 0n,
          fee: BigInt(dbOrder.fee),
          feeCurrency: "ETH",
          margin: BigInt(dbOrder.margin),
          collateral: BigInt(dbOrder.margin),
          takeProfitPrice: dbOrder.triggerPrice ? BigInt(dbOrder.triggerPrice) : undefined,
          stopLossPrice: undefined,
          createdAt: dbOrder.createdAt,
          updatedAt: dbOrder.updatedAt,
          deadline: BigInt(dbOrder.deadline),
          nonce: BigInt(dbOrder.nonce),
          signature: dbOrder.signature as Hex,
          source: OrderSource.API,
        };

        // 添加到引擎的 allOrders Map
        engine.allOrders.set(engineOrder.id, engineOrder);

        // 添加到订单簿
        const orderBook = engine.getOrderBook(dbOrder.token);
        orderBook.addOrder(engineOrder);

        totalOrders++;
      }
    }

    console.log(`[Redis] ✅ Loaded ${totalOrders} pending orders into orderbook`);
  } catch (error) {
    console.error("[Redis] ❌ Failed to load orders:", error);
  }
}

/**
 * 保存仓位到 Redis
 *
 * ✅ 修复 1：用 token + trader + isLong 查找已有仓位，避免重复创建
 * ✅ 修复 2：per-user 锁防止并发写入创建重复记录 (partial fill 批量成交场景)
 *
 * 原理：当同一用户的多笔部分成交在同一个撮合批次中完成时，
 * 多次异步 savePositionToRedis 可能并行执行。
 * 没有锁时，第2-N次调用会在第1次创建完成前查询 Redis，找不到已有记录，
 * 从而各自创建新记录，导致同一仓位出现多条 Redis 记录（僵尸仓位）。
 */
const positionSaveLocks = new Map<string, Promise<string | null>>();

async function savePositionToRedis(position: Position): Promise<string | null> {
  if (!db.isConnected()) return null;

  // 构建锁 key: trader + token + side
  const lockKey = `${position.trader}_${position.token}_${position.isLong}`.toLowerCase();

  // 等待同一仓位的前一次保存完成 (串行化)
  const prevLock = positionSaveLocks.get(lockKey);
  if (prevLock) {
    await prevLock.catch(() => {}); // 忽略前一次的错误
  }

  // 创建新的锁 promise
  const savePromise = _doSavePositionToRedis(position);
  positionSaveLocks.set(lockKey, savePromise);

  try {
    return await savePromise;
  } finally {
    // 只有当前 promise 仍是最新的锁时才清理
    if (positionSaveLocks.get(lockKey) === savePromise) {
      positionSaveLocks.delete(lockKey);
    }
  }
}

async function _doSavePositionToRedis(position: Position): Promise<string | null> {
  try {
    const dbPos = memoryPositionToDB(position);

    // 先按 token + trader + side 查找已有仓位
    const existingPositions = await PositionRepo.getByUser(position.trader);
    const existing = existingPositions.find(
      (p) => p.token === position.token &&
             p.side === (position.isLong ? "LONG" : "SHORT")
    );

    if (existing) {
      // 更新已有仓位
      await PositionRepo.update(existing.id, dbPos);
      return existing.id;
    }

    // 创建新仓位
    const created = await PositionRepo.create(dbPos);
    console.log(`[Redis] Position created: ${created.id} (trader=${position.trader.slice(0, 10)})`);
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
 * ETH 本位: 所有金额字段都是 ETH (1e18 精度)
 */
function memoryPositionToDB(pos: Position): Omit<DBPosition, "id" | "createdAt" | "updatedAt"> {
  return {
    userAddress: pos.trader.toLowerCase() as Address,
    symbol: `${pos.token}-ETH`,  // ETH 本位交易对
    side: pos.isLong ? "LONG" : "SHORT",
    size: pos.size,
    entryPrice: pos.entryPrice,
    leverage: Number(pos.leverage),
    marginType: "ISOLATED",
    initialMargin: pos.collateral,  // 1e18 ETH
    maintMargin: pos.maintenanceMargin || "0",  // 1e18 ETH
    fundingIndex: pos.fundingIndex || "0",
    isLiquidating: pos.isLiquidating || false,
    markPrice: pos.markPrice,
    unrealizedPnL: pos.unrealizedPnL,  // 1e18 ETH
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
  const token = dbPos.symbol.replace("-ETH", "") as Address;
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

  // ADL 诊断日志
  console.log(`[ADL] Executing for bankrupt ${bankruptPosition.isLong ? 'LONG' : 'SHORT'} position: token=${token.slice(0, 10)}, deficit=Ξ${Number(deficit) / 1e18}`);
  console.log(`[ADL] ADL queues available: ${adlQueues.size} tokens`);
  for (const [qToken, q] of adlQueues) {
    console.log(`[ADL]   ${qToken.slice(0, 10)}: longs=${q.longQueue.length}, shorts=${q.shortQueue.length}`);
  }

  let queue = adlQueues.get(token);

  if (!queue) {
    // 尝试刷新 ADL 队列 (可能仓位加载后 PnL 未更新)
    console.log(`[ADL] No queue for token ${token.slice(0, 10)}, refreshing ADL queues...`);
    updateADLQueues();
    queue = adlQueues.get(token);
  }

  if (!queue) {
    console.log(`[ADL] Still no queue after refresh, socializing loss`);
    socializeLoss(token, deficit);
    return;
  }

  // 穿仓的是多头，需要从空头盈利队列减仓
  // 穿仓的是空头，需要从多头盈利队列减仓
  const targetQueue = bankruptPosition.isLong ? queue.shortQueue : queue.longQueue;
  const queueType = bankruptPosition.isLong ? "SHORT (profit)" : "LONG (profit)";

  if (targetQueue.length === 0) {
    console.log(`[ADL] No ${queueType} positions to ADL against, socializing loss: Ξ${Number(deficit) / 1e18}`);
    socializeLoss(token, deficit);
    return;
  }

  console.log(`[ADL] Found ${targetQueue.length} ${queueType} positions for ADL`);

  let remainingDeficit = deficit;
  const adlTargets: { position: Position; amount: bigint }[] = [];

  // 从队列头部开始减仓 (盈利最多的先被减仓)
  for (const pos of targetQueue) {
    if (remainingDeficit <= 0n) break;

    const positionValue = BigInt(pos.collateral) + BigInt(pos.unrealizedPnL);

    if (positionValue <= 0n) continue;

    // 计算需要减仓的金额 (取对方盈利和剩余亏损的较小值)
    const adlAmount = remainingDeficit > positionValue ? positionValue : remainingDeficit;

    adlTargets.push({ position: pos, amount: adlAmount });
    remainingDeficit -= adlAmount;

    console.log(`[ADL] Target: ${pos.trader.slice(0, 10)} ${pos.isLong ? 'LONG' : 'SHORT'} deduct=$${Number(adlAmount) / 1e18}`);
  }

  // 执行 ADL: 从对手方仓位中扣除金额
  const currentPrice = engine.getOrderBook(token).getCurrentPrice();

  for (const { position, amount } of adlTargets) {
    try {
      const normalizedTrader = position.trader.toLowerCase() as Address;

      // 计算减仓比例
      const positionValue = BigInt(position.collateral) + BigInt(position.unrealizedPnL);
      const adlRatio = Number(amount) / Number(positionValue);

      console.log(`[ADL] Executing ADL on pairId ${position.pairId}, ratio=${(adlRatio * 100).toFixed(2)}%`);

      if (adlRatio >= 0.99) {
        // 全部平仓
        const positions = userPositions.get(normalizedTrader) || [];
        const updatedPositions = positions.filter(p => p.pairId !== position.pairId);
        userPositions.set(normalizedTrader, updatedPositions);

        // 退还剩余抵押品 (扣除 ADL 金额后)
        const refund = positionValue - amount;
        if (refund > 0n) {
          adjustUserBalance(normalizedTrader, refund, "ADL_CLOSE_REFUND");
        }
        // Mode 2: ADL 的链下调整 = 退款 - 原始保证金 (损失部分)
        const adlAdjustment = refund - BigInt(position.collateral);
        addMode2Adjustment(normalizedTrader, adlAdjustment, "ADL_CLOSE");

        console.log(`[ADL] Position ${position.pairId} fully closed, refund: $${Number(refund) / 1e18}`);
      } else {
        // 部分平仓 - 减少仓位大小和抵押品
        const ratioMultiplier = BigInt(Math.floor((1 - adlRatio) * 1e6));
        const newCollateral = (BigInt(position.collateral) * ratioMultiplier) / 1000000n;
        const newSize = (BigInt(position.size) * ratioMultiplier) / 1000000n;

        position.collateral = newCollateral.toString();
        position.size = newSize.toString();
        position.margin = newCollateral.toString();

        console.log(`[ADL] Position ${position.pairId} reduced by ${(adlRatio * 100).toFixed(2)}%`);
      }

      // ✅ 记录 ADL 成交到 userTrades
      const adlTrade: TradeRecord = {
        id: `adl-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        orderId: `adl-${position.pairId}`,
        pairId: position.pairId,
        token: position.token,
        trader: position.trader,
        isLong: position.isLong,
        isMaker: false,
        size: (adlRatio >= 0.99 ? BigInt(position.size) : (BigInt(position.size) * BigInt(Math.floor(adlRatio * 1e6)) / 1000000n)).toString(),
        price: currentPrice.toString(),
        fee: "0",
        realizedPnL: (-amount).toString(),
        timestamp: Date.now(),
        type: "adl",
      };
      const adlTraderTrades = userTrades.get(normalizedTrader) || [];
      adlTraderTrades.push(adlTrade);
      userTrades.set(normalizedTrader, adlTraderTrades);
      TradeRepo.create({
        orderId: adlTrade.orderId, pairId: adlTrade.pairId,
        token: token, trader: normalizedTrader,
        isLong: adlTrade.isLong, isMaker: false,
        size: adlTrade.size, price: adlTrade.price,
        fee: "0", realizedPnL: adlTrade.realizedPnL,
        timestamp: adlTrade.timestamp, type: "adl",
      }).catch(e => console.error("[DB] Failed to save ADL trade:", e));

      // ✅ 记录 ADL 账单 (穿仓补偿)
      RedisSettlementLogRepo.create({
        userAddress: normalizedTrader,
        type: "SETTLE_PNL",
        amount: (-amount).toString(),
        balanceBefore: "0", balanceAfter: "0",
        onChainStatus: "CONFIRMED",
        proofData: JSON.stringify({
          token: position.token, pairId: position.pairId,
          isLong: position.isLong, adlRatio: adlRatio.toFixed(4),
          deductAmount: amount.toString(), closeType: "adl",
        }),
        positionId: position.pairId, orderId: adlTrade.orderId, txHash: null,
      }).catch(e => console.error("[ADL] Failed to log ADL bill:", e));

      // 广播 ADL 事件
      broadcastADLEvent(position, amount, currentPrice);
    } catch (e) {
      console.error(`[ADL] Failed to execute ADL on ${position.pairId}:`, e);
    }
  }

  // ============================================================
  // 链上 ADL 同步 (best-effort, 不阻塞链下流程)
  // ============================================================
  if (adlTargets.length > 0 && MATCHER_PRIVATE_KEY && LIQUIDATION_ADDRESS_LOCAL) {
    (async () => {
      try {
        const sortedUsers = adlTargets.map(t => t.position.trader as Address);
        // targetSide: true=减少多头, false=减少空头
        // 穿仓的是多头 → 减仓空头盈利方 → targetSide=false
        // 穿仓的是空头 → 减仓多头盈利方 → targetSide=true
        const targetSide = !bankruptPosition.isLong;

        const adlAccount = privateKeyToAccount(MATCHER_PRIVATE_KEY);
        const adlWalletClient = createWalletClient({
          account: adlAccount,
          chain: baseSepolia,
          transport: http(RPC_URL),
        });

        const tx = await adlWalletClient.writeContract({
          address: LIQUIDATION_ADDRESS_LOCAL,
          abi: [{
            name: "executeADLWithSortedUsers",
            type: "function",
            stateMutability: "nonpayable",
            inputs: [
              { name: "sortedUsers", type: "address[]" },
              { name: "targetSide", type: "bool" },
              { name: "targetAmount", type: "uint256" },
            ],
            outputs: [],
          }] as const,
          functionName: "executeADLWithSortedUsers",
          args: [sortedUsers, targetSide, deficit],
        });
        console.log(`[ADL] On-chain ADL sync submitted: ${tx}`);
      } catch (e: any) {
        const msg = e?.shortMessage || e?.message || String(e);
        console.error(`[ADL] On-chain ADL sync failed (off-chain already executed): ${msg.slice(0, 100)}`);
        // Non-fatal: off-chain state is already correct
      }
    })();
  }

  // 如果还有剩余亏损无法通过 ADL 覆盖，则社会化损失
  if (remainingDeficit > 0n) {
    console.log(`[ADL] Remaining deficit after ADL: $${Number(remainingDeficit) / 1e18}, socializing`);
    socializeLoss(token, remainingDeficit);
  }
}

/**
 * 社会化损失 - 当保险基金和 ADL 都无法覆盖穿仓时
 * 将损失分摊到所有同代币的盈利仓位
 */
function socializeLoss(token: Address, deficit: bigint): void {
  const normalizedToken = token.toLowerCase() as Address;

  // 找出所有该代币的盈利仓位
  const profitablePositions: Position[] = [];
  let totalProfit = 0n;

  for (const [, positions] of userPositions) {
    for (const pos of positions) {
      if (pos.token.toLowerCase() === normalizedToken) {
        const pnl = BigInt(pos.unrealizedPnL || "0");
        if (pnl > 0n) {
          profitablePositions.push(pos);
          totalProfit += pnl;
        }
      }
    }
  }

  if (profitablePositions.length === 0 || totalProfit <= 0n) {
    console.log(`[SocializeLoss] No profitable positions, loss absorbed: $${Number(deficit) / 1e18}`);
    // 无法分摊，系统承担损失
    return;
  }

  // 按盈利比例分摊损失
  for (const pos of profitablePositions) {
    const pnl = BigInt(pos.unrealizedPnL || "0");
    const share = (deficit * pnl) / totalProfit;

    // 从未实现盈亏中扣除
    const newPnL = pnl - share;
    pos.unrealizedPnL = newPnL.toString();

    console.log(`[SocializeLoss] ${pos.trader.slice(0, 10)} share: -$${Number(share) / 1e18}`);
  }

  console.log(`[SocializeLoss] Deficit $${Number(deficit) / 1e18} socialized across ${profitablePositions.length} positions`);
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
// Event-Driven Risk Engine - Meme Perp 核心
// 架构参考: Hyperliquid / dYdX / Binance
//
// 核心原则:
// 1. 价格变化时立即检查受影响仓位 (事件驱动, <10ms)
// 2. 1s 周期兜底检查防止遗漏 (安全网)
// ============================================================

let riskEngineInterval: NodeJS.Timeout | null = null;
const RISK_ENGINE_INTERVAL_MS = 1000; // 改为 1秒兜底检查
const REDIS_SYNC_CYCLES = 1; // 每个周期同步到 Redis
let riskEngineCycleCount = 0;
let lendingLiqCheckCounter = 0; // 借贷清算检查计数器 (每50个风控周期 ≈ 5秒)

// 事件驱动强平统计
let eventDrivenLiquidations = 0;
let lastEventDrivenCheck = 0;

/**
 * 事件驱动强平检查 (价格变化时触发)
 *
 * 当任意 token 价格变化超过 0.1% 时，立即检查该 token 的所有仓位
 * 延迟: <10ms (vs 原100ms轮询)
 *
 * 参考 Hyperliquid: "When the mark price changes, check positions in real-time"
 */
function onPriceChange(token: Address, oldPrice: bigint, newPrice: bigint): void {
  const startTime = Date.now();
  const normalizedToken = token.toLowerCase() as Address;

  // 计算价格变化幅度
  const priceDelta = oldPrice > 0n
    ? Number((newPrice > oldPrice ? newPrice - oldPrice : oldPrice - newPrice) * 10000n / oldPrice)
    : 0;

  let checkedCount = 0;
  let liquidatedCount = 0;
  const urgentLiquidations: Array<{
    position: Position;
    marginRatio: number;
    urgency: number;
  }> = [];

  // 只检查该 token 的仓位
  for (const [trader, positions] of userPositions.entries()) {
    for (const pos of positions) {
      if (pos.token.toLowerCase() !== normalizedToken) continue;
      checkedCount++;

      const entryPrice = BigInt(pos.entryPrice);
      if (entryPrice <= 0n) continue;

      // 计算 UPNL
      const upnl = calculateUnrealizedPnL(
        BigInt(pos.size),
        entryPrice,
        newPrice,
        pos.isLong
      );

      // 计算当前保证金
      const currentMargin = BigInt(pos.collateral) + upnl;

      // 动态 MMR
      // ⚠️ size 是 ETH 名义价值 (1e18 精度)，直接就是 positionValue
      const positionValue = BigInt(pos.size);
      const leverage = BigInt(pos.leverage) * 10000n;
      const initialMarginRate = 10000n * 10000n / leverage;
      const baseMmr = 200n;
      const maxMmr = initialMarginRate / 2n;
      const mmr = Number(baseMmr < maxMmr ? baseMmr : maxMmr);

      // 计算维持保证金
      const maintenanceMargin = (positionValue * BigInt(mmr)) / 10000n;

      // 计算保证金率
      const marginRatio = currentMargin > 0n
        ? Number((maintenanceMargin * 10000n) / currentMargin)
        : 10000;

      // 检测是否需要立即强平
      if (marginRatio >= 10000) {
        const urgency = Math.max(0, Math.min(100, Math.floor((marginRatio - 10000) / 100)));

        // 更新仓位状态
        pos.markPrice = newPrice.toString();
        pos.unrealizedPnL = upnl.toString();
        pos.margin = currentMargin.toString();
        pos.marginRatio = marginRatio.toString();
        pos.isLiquidatable = true;

        if (pos.riskLevel !== "critical") {
          pos.riskLevel = "critical";
          sendRiskAlert(
            pos.trader,
            "liquidation_warning",
            "danger",
            `⚡ 实时强平预警: Position ${pos.pairId.slice(0, 8)} marginRatio=${(marginRatio / 100).toFixed(2)}%`,
            pos.pairId
          );
        }

        urgentLiquidations.push({ position: pos, marginRatio, urgency });
        liquidatedCount++;
      }
    }
  }

  // 立即处理紧急强平
  if (urgentLiquidations.length > 0) {
    urgentLiquidations.sort((a, b) => b.marginRatio - a.marginRatio);

    // 同步添加到全局队列并处理
    for (const item of urgentLiquidations) {
      liquidationQueue.push(item);
    }

    // 异步执行强平 (不阻塞价格更新)
    setImmediate(() => {
      processLiquidations();
    });
  }

  const elapsed = Date.now() - startTime;
  lastEventDrivenCheck = startTime;
  eventDrivenLiquidations += liquidatedCount;

  // 只在有强平或检查时间过长时打印日志
  if (liquidatedCount > 0 || elapsed > 10) {
    console.log(
      `[EventDriven] Token ${normalizedToken.slice(0, 8)} price ${priceDelta}bp: ` +
      `checked=${checkedCount} liquidated=${liquidatedCount} elapsed=${elapsed}ms`
    );
  }
}

/**
 * 启动 Risk Engine
 * - 注册事件驱动回调 (实时强平)
 * - 启动 1s 兜底检查 (安全网)
 */
function startRiskEngine(): void {
  if (riskEngineInterval) {
    clearInterval(riskEngineInterval);
  }

  // 注册事件驱动强平回调
  registerPriceChangeCallback(onPriceChange);
  console.log(`[RiskEngine] 🚀 Event-driven liquidation enabled (Hyperliquid-style)`);

  // 启动 1s 兜底检查 (安全网)
  console.log(`[RiskEngine] Starting ${RISK_ENGINE_INTERVAL_MS}ms safety-net check...`);

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

      // ========== 安全检查: 价格有效性 ==========
      if (currentPrice <= 0n) {
        // 没有有效价格，跳过此仓位的风险计算
        continue;
      }

      const entryPrice = BigInt(pos.entryPrice);

      // ========== 安全检查: 价格精度验证 ==========
      // 入场价格和当前价格应该在合理范围内 (10x)
      if (entryPrice > 0n) {
        const priceRatio = entryPrice > currentPrice
          ? Number(entryPrice / currentPrice)
          : Number(currentPrice / entryPrice);

        if (priceRatio > 10) {
          console.warn(`[RiskEngine] Position ${pos.pairId.slice(0, 8)} has suspicious price ratio: ${priceRatio.toFixed(2)}x (entry=${entryPrice}, current=${currentPrice})`);
          // 不将此仓位标记为可强平，可能是精度问题
          pos.isLiquidatable = false;
          continue;
        }
      }

      // 更新标记价格
      pos.markPrice = currentPrice.toString();

      // 计算 UPNL
      const upnl = calculateUnrealizedPnL(
        BigInt(pos.size),
        entryPrice,
        currentPrice,
        pos.isLong
      );
      pos.unrealizedPnL = upnl.toString();

      // 计算当前保证金
      const currentMargin = BigInt(pos.collateral) + upnl;
      pos.margin = currentMargin.toString();

      // 动态 MMR (根据杠杆调整)
      // ⚠️ size 是 ETH 名义价值 (1e18 精度)
      const positionValue = BigInt(pos.size);
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

  // 借贷清算检测 (每 50 个风控周期 = ~5秒检查一次)
  lendingLiqCheckCounter++;
  if (lendingLiqCheckCounter >= 50) {
    lendingLiqCheckCounter = 0;
    // 异步检测，不阻塞风控循环
    (async () => {
      try {
        for (const token of SUPPORTED_TOKENS) {
          const candidates = await detectLendingLiquidations(token);
          if (candidates.length > 0) {
            updateLendingLiquidationQueue(candidates);
            const processed = await processLendingLiquidations();
            if (processed > 0) {
              // 广播借贷清算事件
              broadcast("lending_liquidation", {
                token,
                liquidationsProcessed: processed,
              });
            }
          }
        }
      } catch (e) {
        console.error("[LendingLiq] Detection error:", e);
      }
    })();
  }

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
      // 只同步有 Redis UUID 的仓位 (UUID 格式: 8-4-4-4-12，总长 36)
      // 排除初始 pairId 格式 "${token}_${trader}_${timestamp}" (含 0x 和下划线)
      if (!pos.pairId || pos.pairId.includes("0x") || pos.pairId.length < 30) continue;

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
    const normalizedTrader = pos.trader.toLowerCase() as Address;
    const normalizedToken = pos.token.toLowerCase() as Address;

    console.log(`[Liquidation] Processing: ${pos.trader.slice(0, 10)} ${pos.isLong ? 'LONG' : 'SHORT'} marginRatio=${candidate.marginRatio}bp urgency=${candidate.urgency}`);

    // 获取当前价格
    const orderBook = engine.getOrderBook(normalizedToken);
    const currentPrice = orderBook.getCurrentPrice();

    // ========== 安全检查 1: 价格有效性 ==========
    if (currentPrice <= 0n) {
      console.log(`[Liquidation] SKIPPED: No valid market price for ${normalizedToken.slice(0, 10)}`);
      continue;
    }

    // 计算当前保证金（含 PnL）
    const collateral = BigInt(pos.collateral);
    const size = BigInt(pos.size);
    const entryPrice = BigInt(pos.entryPrice);

    // ========== 安全检查 2: 入场价格有效性 ==========
    // 入场价格应该在当前价格的 10x 范围内 (防止精度错误)
    if (entryPrice > 0n && currentPrice > 0n) {
      const priceRatio = entryPrice > currentPrice
        ? Number(entryPrice / currentPrice)
        : Number(currentPrice / entryPrice);

      if (priceRatio > 10) {
        console.log(`[Liquidation] SKIPPED: Entry/current price ratio too high (${priceRatio.toFixed(2)}x), possible precision error`);
        console.log(`[Liquidation]   entryPrice=${entryPrice}, currentPrice=${currentPrice}`);
        continue;
      }
    }

    // 使用标准 PnL 计算函数 (ETH 本位精度: 1e18 * 1e18 / 1e18 = 1e18)
    const pnl = calculateUnrealizedPnL(size, entryPrice, currentPrice, pos.isLong);

    const currentMargin = collateral + pnl;

    // ========== 安全检查 3: PnL 合理性 ==========
    // PnL 不应该超过仓位价值的 10 倍 (防止计算错误)
    // size 已经是 ETH 名义价值 (1e18 精度)，不需要再乘价格
    const positionValue = size;
    const maxReasonablePnL = positionValue * 10n;
    const absPnl = pnl < 0n ? -pnl : pnl;

    if (absPnl > maxReasonablePnL && maxReasonablePnL > 0n) {
      console.log(`[Liquidation] SKIPPED: PnL unreasonably large ($${Number(pnl) / 1e18}), max expected: $${Number(maxReasonablePnL) / 1e18}`);
      console.log(`[Liquidation]   size=${size}, entryPrice=${entryPrice}, currentPrice=${currentPrice}`);
      continue;
    }

    console.log(`[Liquidation] Position details: collateral=$${Number(collateral) / 1e18}, pnl=$${Number(pnl) / 1e18}, currentMargin=$${Number(currentMargin) / 1e18}`);

    let liquidationPenalty = 0n;
    let insuranceFundPayout = 0n;
    let refundToTrader = 0n;

    if (currentMargin < 0n) {
      // ========== 穿仓处理 (Bankruptcy) ==========
      const deficit = -currentMargin;
      console.log(`[Liquidation] BANKRUPTCY! Deficit: $${Number(deficit) / 1e18}`);

      // 1. 先尝试用保险基金覆盖
      const tokenFund = getTokenInsuranceFund(normalizedToken);
      const globalFundAvailable = insuranceFund.balance;

      if (tokenFund.balance >= deficit) {
        // 代币保险基金足够
        insuranceFundPayout = payFromInsuranceFund(deficit, normalizedToken);
        console.log(`[Liquidation] Deficit covered by token insurance fund: $${Number(insuranceFundPayout) / 1e18}`);
      } else if (tokenFund.balance + globalFundAvailable >= deficit) {
        // 代币 + 全局保险基金
        const fromToken = payFromInsuranceFund(tokenFund.balance, normalizedToken);
        const fromGlobal = payFromInsuranceFund(deficit - fromToken);
        insuranceFundPayout = fromToken + fromGlobal;
        console.log(`[Liquidation] Deficit covered by insurance funds: token=$${Number(fromToken) / 1e18}, global=$${Number(fromGlobal) / 1e18}`);
      } else {
        // 2. 保险基金不足，触发 ADL
        const partialCoverage = payFromInsuranceFund(tokenFund.balance, normalizedToken) + payFromInsuranceFund(globalFundAvailable);
        const remainingDeficit = deficit - partialCoverage;
        console.log(`[Liquidation] Insurance fund insufficient! Covered: $${Number(partialCoverage) / 1e18}, remaining deficit: $${Number(remainingDeficit) / 1e18}`);

        // 执行 ADL (自动减仓)
        await executeADL(pos, remainingDeficit);
        insuranceFundPayout = partialCoverage;
      }
    } else {
      // ========== 正常强平处理 ==========
      // 爆仓剩余保证金 100% 进保险基金，不退还交易者
      // 这是平台收入来源之一，激励用户控制风险
      liquidationPenalty = currentMargin;  // 100% 给保险基金
      refundToTrader = 0n;  // 不退还

      // 注入保险基金
      contributeToInsuranceFund(liquidationPenalty, normalizedToken);
      console.log(`[Liquidation] All remaining margin to insurance: $${Number(liquidationPenalty) / 1e18}`);
    }

    // ========== 关闭仓位 ==========
    // Mode 2: 强平链下调整 = -(保证金) 即交易者损失全部保证金
    // (保证金已经在开仓时从 chainAvailable 中扣除了，但仓位关闭后 positionMargin 减少
    //  所以需要对应减少 adjustment，否则 effective 会虚高)
    addMode2Adjustment(normalizedTrader, -collateral, "LIQUIDATION_LOSS");

    // 1. 从用户仓位列表中移除
    const positions = userPositions.get(normalizedTrader) || [];
    const updatedPositions = positions.filter(p => p.pairId !== pos.pairId);
    userPositions.set(normalizedTrader, updatedPositions);
    console.log(`[Liquidation] Position closed: ${pos.pairId}, remaining positions: ${updatedPositions.length}`);

    // 2. 移除相关的 TP/SL 订单
    tpslOrders.delete(pos.pairId);

    // 3. 同步删除 Redis 中的仓位 (Bug fix: 强平后必须清理 Redis)
    deletePositionFromRedis(pos.pairId).catch(e =>
      console.error("[Redis] Failed to delete liquidated position:", e));

    // 4. 记录强平到交易历史
    const liquidationTrade: TradeRecord = {
      id: `liq-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      orderId: `liquidation-${pos.pairId}`,
      pairId: pos.pairId,
      token: pos.token,
      trader: pos.trader,
      isLong: pos.isLong,
      isMaker: false,
      size: pos.size,
      price: currentPrice.toString(),
      fee: liquidationPenalty.toString(),
      realizedPnL: pnl.toString(),
      timestamp: Date.now(),
      type: "liquidation",
    };

    const traderTrades = userTrades.get(normalizedTrader) || [];
    traderTrades.push(liquidationTrade);
    userTrades.set(normalizedTrader, traderTrades);

    // Save liquidation trade to Redis
    TradeRepo.create({
      orderId: liquidationTrade.orderId,
      pairId: liquidationTrade.pairId,
      token: normalizedToken,
      trader: normalizedTrader,
      isLong: liquidationTrade.isLong,
      isMaker: false,
      size: liquidationTrade.size,
      price: liquidationTrade.price,
      fee: liquidationTrade.fee,
      realizedPnL: liquidationTrade.realizedPnL,
      timestamp: liquidationTrade.timestamp,
      type: "liquidation",
    }).catch(e => console.error(`[DB] Failed to save liquidation trade:`, e));

    // ✅ 记录 LIQUIDATION 账单
    try {
      const liqLoss = -(collateral + pnl < 0n ? collateral : collateral + pnl);
      await RedisSettlementLogRepo.create({
        userAddress: normalizedTrader,
        type: "LIQUIDATION",
        amount: pnl.toString(),
        balanceBefore: collateral.toString(),
        balanceAfter: "0",
        onChainStatus: "CONFIRMED",
        proofData: JSON.stringify({
          token: pos.token, pairId: pos.pairId, isLong: pos.isLong,
          entryPrice: pos.entryPrice, liquidationPrice: currentPrice.toString(),
          size: pos.size, penalty: liquidationPenalty.toString(),
        }),
        positionId: pos.pairId, orderId: liquidationTrade.orderId, txHash: null,
      });
    } catch (billErr) {
      console.error("[Liquidation] Failed to log liquidation bill:", billErr);
    }

    // 5. 调用链上强平 (TODO: 实际合约调用 - 目前仅链下执行)
    // 链上强平功能待实现，当前版本在链下完成强平处理

    // 6. 广播强平事件
    broadcastLiquidationEvent(pos);

    // 7. 广播仓位和余额更新 (确保前端即时反映强平后状态)
    broadcastPositionUpdate(normalizedTrader, normalizedToken);
    broadcastBalanceUpdate(normalizedTrader);

    console.log(`[Liquidation] SUCCESS: ${pos.trader.slice(0, 10)} ${pos.isLong ? 'LONG' : 'SHORT'} position liquidated at price $${Number(currentPrice) / 1e18}`);
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
  balance: bigint;                    // 当前余额 (1e18 ETH)
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
    console.log(`[InsuranceFund] Token ${token.slice(0, 10)} contribution: +$${Number(amount) / 1e18}, balance: $${Number(fund.balance) / 1e18}`);
  } else {
    insuranceFund.balance += amount;
    insuranceFund.totalContributions += amount;
    insuranceFund.lastUpdated = Date.now();
    console.log(`[InsuranceFund] Global contribution: +$${Number(amount) / 1e18}, balance: $${Number(insuranceFund.balance) / 1e18}`);
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
    console.log(`[InsuranceFund] Token ${token.slice(0, 10)} payout: -$${Number(actualPayout) / 1e18}, balance: $${Number(fund.balance) / 1e18}`);
    return actualPayout;
  } else {
    const actualPayout = amount > insuranceFund.balance ? insuranceFund.balance : amount;
    insuranceFund.balance -= actualPayout;
    insuranceFund.totalPayouts += actualPayout;
    insuranceFund.lastUpdated = Date.now();
    console.log(`[InsuranceFund] Global payout: -$${Number(actualPayout) / 1e18}, balance: $${Number(insuranceFund.balance) / 1e18}`);
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
  baseInterval: 5 * 60 * 1000,       // 5 分钟基础周期 (Meme 高波动)
  minInterval: 1 * 60 * 1000,        // 最小 1 分钟 (极端波动时)
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
  fundingAmount: string;          // 支付金额 (1e18 ETH)
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
 * 使用 EWMA 平滑避免费率频繁跳动
 *
 * 基础费率来自引擎的 calculateFundingRate
 */

// EWMA 平滑因子: 0.1 = 新值占 10%, 旧值占 90% (防止跳动)
const FUNDING_RATE_EWMA_ALPHA = 0.1;
// 存储上一次平滑后的费率 (Number 精度, 用于 EWMA 计算)
const smoothedFundingRates = new Map<Address, number>();

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

  // 计算原始费率
  let rawRate = Math.floor(Number(baseRate) * volatilityAdjustment * imbalanceAdjustment);

  // 限制最大费率
  const maxRate = config.maxRate;
  if (rawRate > maxRate) rawRate = maxRate;
  if (rawRate < -maxRate) rawRate = -maxRate;

  // EWMA 平滑: smoothed = alpha * newValue + (1 - alpha) * oldSmoothed
  // 这样每次更新只变化 10%, 前端显示不会频繁跳动
  const prevSmoothed = smoothedFundingRates.get(normalizedToken);
  let smoothed: number;
  if (prevSmoothed === undefined) {
    // 首次计算，直接使用原始值
    smoothed = rawRate;
  } else {
    smoothed = FUNDING_RATE_EWMA_ALPHA * rawRate + (1 - FUNDING_RATE_EWMA_ALPHA) * prevSmoothed;
  }
  smoothedFundingRates.set(normalizedToken, smoothed);

  // 转为整数 bigint 存储
  const dynamicRate = BigInt(Math.round(smoothed));
  currentFundingRates.set(normalizedToken, dynamicRate);

  console.log(`[DynamicFunding] Token ${token.slice(0, 10)}: base=${baseRate}bp vol=${volatility.toFixed(2)}% imbal=${imbalanceRatio.toFixed(2)}% raw=${rawRate}bp smoothed=${smoothed.toFixed(2)}bp`);

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
 * 平台模式: 所有持仓者按费率缴纳资金费，全部收归保险基金
 * 正费率: 多头缴纳
 * 负费率: 空头缴纳
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
  let totalCollected = 0n; // 保险基金收取的总资金费

  // 遍历所有仓位，计算资金费
  for (const [trader, positions] of userPositions.entries()) {
    for (const pos of positions) {
      if ((pos.token.toLowerCase() as Address) !== normalizedToken) continue;

      const positionSize = BigInt(pos.size);
      const currentPrice = BigInt(pos.markPrice);

      // 计算仓位价值 (USD)
      // positionSize 已经是 ETH 名义价值 (1e18 精度)
      const positionValue = positionSize;

      // 计算资金费金额 = 仓位价值 × |费率| / 10000
      const fundingAmount = (positionValue * (rate >= 0n ? rate : -rate)) / 10000n;

      // 平台模式: 正费率多头缴纳，负费率空头缴纳
      // 非缴纳方不收不付
      const isPayer = (rate > 0n && pos.isLong) || (rate < 0n && !pos.isLong);

      // 非缴纳方跳过 — 不给对手方返还
      if (!isPayer) continue;

      const payment: FundingPayment = {
        pairId: pos.pairId,
        trader: pos.trader,
        token: pos.token,
        isLong: pos.isLong,
        positionSize: pos.size,
        fundingRate: rate.toString(),
        fundingAmount: (-fundingAmount).toString(), // 缴纳方始终为负
        isPayer: true,
        timestamp: Date.now(),
      };

      payments.push(payment);

      // 更新仓位的累计资金费（始终为负，因为只有缴纳方）
      const currentFundingFee = BigInt(pos.fundingFee || "0");
      pos.fundingFee = (currentFundingFee - fundingAmount).toString();

      // ✅ 写入账单记录 (Redis)，让前端"账单"Tab能显示资金费收支
      const traderAddr = pos.trader.toLowerCase() as Address;
      const balance = getUserBalance(traderAddr);
      const signedAmount = -fundingAmount; // 缴纳方始终扣除
      const balanceBefore = balance.totalBalance;
      // 资金费直接从余额中扣除
      balance.totalBalance += signedAmount;
      balance.availableBalance += signedAmount;
      // Mode 2: 资金费链下调整
      addMode2Adjustment(traderAddr, signedAmount, "FUNDING_FEE");
      const balanceAfter = balance.totalBalance;
      try {
        await RedisSettlementLogRepo.create({
          userAddress: traderAddr,
          type: "FUNDING_FEE",
          amount: signedAmount.toString(),
          balanceBefore: balanceBefore.toString(),
          balanceAfter: balanceAfter.toString(),
          onChainStatus: "CONFIRMED",
          proofData: JSON.stringify({
            token: pos.token,
            rate: rate.toString(),
            isLong: pos.isLong,
            positionSize: pos.size,
            pairId: pos.pairId,
          }),
          positionId: pos.pairId,
          orderId: null,
          txHash: null,
        });
      } catch (billErr) {
        console.error("[DynamicFunding] Failed to log funding bill:", billErr);
      }

      // 统计
      totalCollected += fundingAmount;
      if (pos.isLong) {
        totalLongPayment -= fundingAmount;
      } else {
        totalShortPayment -= fundingAmount;
      }
    }
  }

  // ✅ 资金费全部注入保险基金
  if (totalCollected > 0n) {
    contributeToInsuranceFund(totalCollected, normalizedToken);
    console.log(`[DynamicFunding] Insurance fund received: Ξ${Number(totalCollected) / 1e18} from funding fees`);
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

  // 初始化所有代币的下次结算时间
  const now = Date.now();
  for (const token of SUPPORTED_TOKENS) {
    const normalizedToken = token.toLowerCase() as Address;
    const config = getTokenFundingConfig(normalizedToken);
    // 设置下次结算时间为当前时间 + 基础周期
    if (!nextFundingSettlement.has(normalizedToken)) {
      nextFundingSettlement.set(normalizedToken, now + config.baseInterval);
      console.log(`[DynamicFunding] Initialized ${normalizedToken.slice(0, 10)}: next settlement in ${config.baseInterval / 1000}s`);
    }
  }

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
      // currentSize 已经是 ETH 名义价值 (1e18 精度)
      const positionValue = currentSize;
      const closeFee = (positionValue * 5n) / 10000n;

      // 更新订单状态
      order.executedAt = Date.now();
      order.executionPrice = currentPrice;
      order.executionPnL = pnl;
      order.executionStatus = "executed";

      // 从用户仓位列表中移除
      const normalizedTrader = position.trader.toLowerCase() as Address;
      const normalizedToken = position.token.toLowerCase() as Address;
      const positions = userPositions.get(normalizedTrader) || [];
      const updatedPositions = positions.filter(p => p.pairId !== order.pairId);
      userPositions.set(normalizedTrader, updatedPositions);

      // 移除 TP/SL 订单
      tpslOrders.delete(order.pairId);

      // ✅ 模式 2: 平仓收益加入用户余额
      const returnAmount = BigInt(position.collateral) + pnl - closeFee;
      if (returnAmount > 0n) {
        adjustUserBalance(normalizedTrader, returnAmount, "TPSL_CLOSE");
      }
      // Mode 2: TP/SL 链下调整 = PnL - 手续费
      const tpslPnlMinusFee = pnl - closeFee;
      addMode2Adjustment(normalizedTrader, tpslPnlMinusFee, "TPSL_CLOSE");
      // ✅ TP/SL 手续费转入平台钱包
      if (closeFee > 0n) {
        addMode2Adjustment(FEE_RECEIVER_ADDRESS, closeFee, "PLATFORM_FEE");
        console.log(`[Fee] TP/SL close fee Ξ${Number(closeFee) / 1e18} → platform wallet`);
      }
      broadcastBalanceUpdate(normalizedTrader);

      // ✅ 记录 TP/SL 平仓成交到 userTrades
      const tpslTrade: TradeRecord = {
        id: `tpsl-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        orderId: `tpsl-${order.pairId}`,
        pairId: order.pairId,
        token: position.token,
        trader: position.trader,
        isLong: position.isLong,
        isMaker: false,
        size: position.size,
        price: currentPrice.toString(),
        fee: closeFee.toString(),
        realizedPnL: pnl.toString(),
        timestamp: Date.now(),
        type: "close",
      };
      const tpslTraderTrades = userTrades.get(normalizedTrader) || [];
      tpslTraderTrades.push(tpslTrade);
      userTrades.set(normalizedTrader, tpslTraderTrades);
      TradeRepo.create({
        orderId: tpslTrade.orderId, pairId: tpslTrade.pairId,
        token: normalizedToken, trader: normalizedTrader,
        isLong: tpslTrade.isLong, isMaker: false,
        size: tpslTrade.size, price: tpslTrade.price,
        fee: tpslTrade.fee, realizedPnL: tpslTrade.realizedPnL,
        timestamp: tpslTrade.timestamp, type: "close",
      }).catch(e => console.error("[DB] Failed to save TP/SL trade:", e));

      // ✅ 记录 SETTLE_PNL 账单
      RedisSettlementLogRepo.create({
        userAddress: normalizedTrader,
        type: "SETTLE_PNL",
        amount: pnl.toString(),
        balanceBefore: "0", balanceAfter: returnAmount.toString(),
        onChainStatus: "CONFIRMED",
        proofData: JSON.stringify({
          token: position.token, pairId: order.pairId,
          isLong: position.isLong, triggerType,
          entryPrice: position.entryPrice, exitPrice: currentPrice.toString(),
          size: position.size, closeFee: closeFee.toString(),
          closeType: triggerType === "tp" ? "take_profit" : "stop_loss",
        }),
        positionId: order.pairId, orderId: tpslTrade.orderId, txHash: null,
      }).catch(e => console.error("[TP/SL] Failed to log settle PnL bill:", e));

      // 同步删除 Redis 中的仓位
      deletePositionFromRedis(order.pairId).catch(e =>
        console.error("[Redis] Failed to delete TP/SL closed position:", e));

      // 广播执行事件
      broadcastTPSLExecuted(position, triggerType, currentPrice, pnl, closeFee);
      broadcastPositionUpdate(normalizedTrader, normalizedToken);

      console.log(`[TP/SL] ✅ Executed ${triggerType.toUpperCase()}: ${order.pairId} PnL=$${Number(pnl) / 1e18}`);

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
        balance: (Number(insuranceFund.balance) / 1e18).toFixed(2),
        totalContributions: (Number(insuranceFund.totalContributions) / 1e18).toFixed(2),
        totalPayouts: (Number(insuranceFund.totalPayouts) / 1e18).toFixed(2),
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
 * 广播强平热力图数据 (节流: 每 2 秒一次)
 */
function broadcastLiquidationMap(token: Address): void {
  const normalizedToken = token.toLowerCase() as Address;

  // Throttle: only broadcast every 2 seconds per token
  const now = Date.now();
  const lastBroadcast = lastLiquidationMapBroadcast.get(normalizedToken) || 0;
  if (now - lastBroadcast < LIQUIDATION_MAP_BROADCAST_INTERVAL_MS) {
    return;
  }
  lastLiquidationMapBroadcast.set(normalizedToken, now);

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
  // 最低提现金额 (ETH, 1e18)
  minWithdrawAmount: 10n ** 16n,  // 0.01 ETH (~$25)
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

      console.log(`[Referral] L1 commission: ${level1Referrer.address.slice(0, 10)} earned $${Number(level1Commission) / 1e18} from ${normalizedTrader.slice(0, 10)}`);

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

        console.log(`[Referral] L2 commission: ${level2Referrer.address.slice(0, 10)} earned $${Number(level2Commission) / 1e18} from ${normalizedTrader.slice(0, 10)}`);

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
      error: `Minimum withdrawal amount is $${Number(REFERRAL_CONFIG.minWithdrawAmount) / 1e18}`
    };
  }

  // 扣除待提取，增加已提取
  referrer.pendingEarnings -= withdrawAmount;
  referrer.withdrawnEarnings += withdrawAmount;
  referrer.updatedAt = Date.now();

  // TODO: 实际转账逻辑 (调用合约或更新用户余额)

  console.log(`[Referral] Withdrawal: ${normalizedAddress.slice(0, 10)} withdrew $${Number(withdrawAmount) / 1e18}`);

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
    display: `$${(Number(amount) / 1e18).toFixed(4)}`,
  });
}

async function handleGetTicker(instId: string): Promise<Response> {
  const token = instId.split("-")[0] as Address;
  const orderBook = engine.getOrderBook(token);
  const depth = orderBook.getDepth(1);
  const currentPrice = orderBook.getCurrentPrice();

  const trades = engine.getRecentTrades(token, 1);
  const lastTrade = trades[0];

  const bestBid = depth.longs.length > 0 ? depth.longs[0].price : currentPrice;
  const bestAsk = depth.shorts.length > 0 ? depth.shorts[0].price : currentPrice;
  const bestBidSz = depth.longs.length > 0 ? depth.longs[0].totalSize : 0n;
  const bestAskSz = depth.shorts.length > 0 ? depth.shorts[0].totalSize : 0n;

  return new Response(JSON.stringify({
    code: "0",
    msg: "success",
    data: [{
      instId,
      last: currentPrice.toString(),
      lastSz: lastTrade?.size?.toString() || "0",
      askPx: bestAsk.toString(),
      askSz: bestAskSz.toString(),
      bidPx: bestBid.toString(),
      bidSz: bestBidSz.toString(),
      open24h: currentPrice.toString(),
      high24h: currentPrice.toString(),
      low24h: currentPrice.toString(),
      volCcy24h: "0",
      vol24h: "0",
      ts: Date.now(),
    }],
  }), {
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
    },
  });
}

async function handleGetMarketTrades(instId: string, limit: number): Promise<Response> {
  const token = instId.split("-")[0] as Address;
  const trades = engine.getRecentTrades(token, limit);

  return new Response(JSON.stringify({
    code: "0",
    msg: "success",
    data: trades.map((trade) => ({
      instId,
      tradeId: trade.id,
      px: trade.price.toString(),
      sz: trade.size.toString(),
      side: trade.side,
      ts: trade.timestamp,
    })),
  }), {
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
    },
  });
}

function broadcastCommissionWithdrawn(referrer: Address, amount: bigint): void {
  broadcast("commission_withdrawn", {
    referrer,
    amount: amount.toString(),
    display: `$${(Number(amount) / 1e18).toFixed(2)}`,
  });
}

// ============================================================
// 用户余额管理 (行业标准 - Binance/OKX)
// ============================================================

interface UserBalance {
  totalBalance: bigint;          // 总余额 = wallet + settlement + positionMargin, 1e18 精度
  usedMargin: bigint;            // 已使用保证金 (活跃仓位占用), 1e18 精度
  availableBalance: bigint;      // 可用余额 = settlementAvailable - pendingLocked - usedMargin (不含钱包!), 1e18 精度
  unrealizedPnL: bigint;         // 所有仓位的未实现盈亏, 1e18 精度
  frozenMargin: bigint;          // 冻结保证金 (挂单占用), 1e18 精度
  walletBalance: bigint;         // 派生钱包总余额 (native + WETH), 1e18 精度
  nativeEthBalance: bigint;      // 派生钱包 native ETH 余额 (用于 depositETH), 1e18 精度
  wethBalance: bigint;           // 派生钱包 WETH 余额 (用于 approve+deposit), 1e18 精度
  settlementAvailable: bigint;   // Settlement 合约 available 余额, 1e18 精度
  settlementLocked: bigint;      // Settlement 合约仓位锁定 (Mode2: 由后端管理), 1e18 精度
}

const userBalances = new Map<Address, UserBalance>();

/**
 * Mode 2: 累计链下盈亏调整 (PnL from closes, funding fees, ADL, etc.)
 *
 * 因为 Mode 2 不在链上执行平仓/结算，链上 Settlement 余额不会变化。
 * 此 Map 记录每个用户的累计链下调整金额，在读取余额时加到 chainAvailable 上。
 *
 * 增加场景：平仓盈利、ADL 退款
 * 减少场景：平仓亏损、资金费扣除
 * 重置场景：提现时（提现会先从链上扣，此时链下调整也需要相应减少）
 */
const mode2PnLAdjustments = new Map<Address, bigint>();

function getMode2Adjustment(trader: Address): bigint {
  return mode2PnLAdjustments.get(trader.toLowerCase() as Address) || 0n;
}

function addMode2Adjustment(trader: Address, amount: bigint, reason: string): void {
  const normalized = trader.toLowerCase() as Address;
  const current = mode2PnLAdjustments.get(normalized) || 0n;
  const updated = current + amount;
  mode2PnLAdjustments.set(normalized, updated);
  const sign = amount >= 0n ? "+" : "";
  console.log(`[Mode2Adj] ${reason}: ${normalized.slice(0, 10)} ${sign}Ξ${Number(amount) / 1e18}, cumulative=Ξ${Number(updated) / 1e18}`);
  // 持久化到 Redis (异步，不阻塞)
  Mode2AdjustmentRepo.save(normalized, updated).catch(e =>
    console.error(`[Mode2Adj] Failed to persist: ${e}`)
  );
}

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
      walletBalance: 0n,
      nativeEthBalance: 0n,
      wethBalance: 0n,
      settlementAvailable: 0n,
      settlementLocked: 0n,
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
  console.log(`[Balance] Deposit: ${trader.slice(0, 10)} +$${Number(amount) / 1e18}, total: $${Number(balance.totalBalance) / 1e18}`);
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
  console.log(`[Balance] Withdraw: ${trader.slice(0, 10)} -$${Number(amount) / 1e18}, total: $${Number(balance.totalBalance) / 1e18}`);
  return true;
}

/**
 * 调整用户余额 (用于强平退款、ADL 等)
 * @param amount 正数增加，负数减少
 * @param reason 调整原因 (用于日志)
 */
function adjustUserBalance(trader: Address, amount: bigint, reason: string): void {
  const balance = getUserBalance(trader);
  balance.totalBalance += amount;
  balance.availableBalance += amount;

  // 确保余额不为负
  if (balance.totalBalance < 0n) balance.totalBalance = 0n;
  if (balance.availableBalance < 0n) balance.availableBalance = 0n;

  const sign = amount >= 0n ? "+" : "";
  console.log(`[Balance] Adjust (${reason}): ${trader.slice(0, 10)} ${sign}$${Number(amount) / 1e18}, total: $${Number(balance.totalBalance) / 1e18}`);
}

/**
 * 开仓时锁定保证金
 */
function lockMargin(trader: Address, margin: bigint): boolean {
  const balance = getUserBalance(trader);
  if (balance.availableBalance < margin) {
    console.log(`[Balance] Lock margin failed: ${trader.slice(0, 10)} needs $${Number(margin) / 1e18}, available: $${Number(balance.availableBalance) / 1e18}`);
    return false;
  }
  balance.usedMargin += margin;
  balance.availableBalance -= margin;
  console.log(`[Balance] Locked margin: ${trader.slice(0, 10)} $${Number(margin) / 1e18}, used: $${Number(balance.usedMargin) / 1e18}, available: $${Number(balance.availableBalance) / 1e18}`);
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
  console.log(`[Balance] Released margin: ${trader.slice(0, 10)} $${Number(margin) / 1e18}, PnL: $${Number(realizedPnL) / 1e18}, available: $${Number(balance.availableBalance) / 1e18}`);
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
 *
 * ✅ 修复：size 现在是 ETH 名义价值 (1e18 精度)，与合约保持一致
 * 合约计算: collateral = size * LEVERAGE_PRECISION / leverage
 *
 * @param size ETH 名义价值 (1e18 精度, 如 $500 = 500_000_000)
 * @param _price 价格 (不再使用，保留参数兼容性)
 * @param leverage 杠杆 (1e4 精度, 如 10x = 100000)
 * @returns { margin, fee, total } 都是 1e18 ETH 精度
 */
function calculateOrderCost(size: bigint, _price: bigint, leverage: bigint): { margin: bigint; fee: bigint; total: bigint } {
  // size 已经是 ETH 名义价值 (1e18 精度)
  // 与合约 Settlement.sol 第 524 行保持一致:
  // collateral = (matchSize * LEVERAGE_PRECISION) / leverage

  // 保证金 = size * 10000 / leverage
  const margin = (size * 10000n) / leverage;

  // 手续费 = size * 0.05% (ORDER_FEE_RATE = 5)
  const fee = (size * ORDER_FEE_RATE) / 10000n;

  // 总计 = 保证金 + 手续费
  const total = margin + fee;

  return { margin, fee, total };
}

/**
 * [Mode 2] 同步用户余额
 *
 * Mode 2 变更:
 * - 仍读取 Settlement 合约的 available 余额 (资金托管)
 * - 忽略 chainLocked (Mode 2 无链上仓位)
 * - 仓位保证金从后端内存计算
 * - 挂单预留从 orderMarginInfos 计算
 *
 * 公式:
 *   availableBalance = walletWETH + settlementAvailable - pendingOrdersLocked - positionMargin
 *   totalBalance     = walletWETH + settlementAvailable + positionMargin
 */
async function syncUserBalanceFromChain(trader: Address): Promise<void> {
  const normalizedTrader = trader.toLowerCase() as Address;
  const balance = getUserBalance(normalizedTrader);

  try {
    const publicClient = createPublicClient({
      chain: baseSepolia,
      transport: http(RPC_URL),
    });

    // 1. 读取派生钱包余额 (ETH 本位: native ETH + WETH)
    let walletEthBalance = 0n;

    // 1a. 读取 native ETH 余额
    const nativeEthBalance = await publicClient.getBalance({
      address: normalizedTrader,
    });

    // 1b. 读取 WETH 余额
    let wethBalance = 0n;
    const WETH_ADDRESS = process.env.WETH_ADDRESS as Address;
    if (WETH_ADDRESS) {
      wethBalance = await publicClient.readContract({
        address: WETH_ADDRESS,
        abi: ERC20_ABI,
        functionName: "balanceOf",
        args: [normalizedTrader],
      }) as bigint;
    }

    // 合并: native ETH + WETH（预留少量 native ETH 作为 gas）
    const gasReserve = 500000000000000n; // 0.0005 ETH gas 预留
    const usableNativeEth = nativeEthBalance > gasReserve ? nativeEthBalance - gasReserve : 0n;
    walletEthBalance = usableNativeEth + wethBalance;

    // 2. 读取 Settlement 合约可用余额 (资金托管)
    //
    // ⚠️ 精度转换: Settlement 合约内部使用 STANDARD_DECIMALS=6 (USDT 精度)
    //    getUserBalance 返回的是 6 位精度值
    //    后端统一使用 18 位精度 (ETH)，需要乘以 10^12 转换
    //
    const SETTLEMENT_TO_ETH_FACTOR = 10n ** 12n; // 6位精度 → 18位精度
    let chainAvailable = 0n;
    if (SETTLEMENT_ADDRESS) {
      try {
        const [available] = await publicClient.readContract({
          address: SETTLEMENT_ADDRESS,
          abi: SETTLEMENT_ABI,
          functionName: "getUserBalance",
          args: [normalizedTrader],
        }) as [bigint, bigint];
        // 从 6 位精度转换为 18 位精度
        chainAvailable = available * SETTLEMENT_TO_ETH_FACTOR;
      } catch {
        // Settlement 读取失败，忽略
      }
    }

    // 3. 计算仓位保证金 (从后端内存，Mode 2 核心变更)
    const positions = userPositions.get(normalizedTrader) || [];
    let positionMargin = 0n;
    for (const pos of positions) {
      positionMargin += BigInt(pos.collateral || "0");
    }

    // 4. 计算挂单预留 (从 orderMarginInfos)
    const pendingLocked = getPendingOrdersLocked(normalizedTrader);

    // 5. 余额计算 (ETH 本位)
    //
    // ⚠️ 安全关键: availableBalance 只计算 Settlement 中的可用金额
    //    walletBalance 是"可以存入"的金额，但不能直接用于交易
    //    只有存入 Settlement 合约后才算真正可用
    //
    // Mode 2: 加入链下盈亏调整
    const mode2Adj = getMode2Adjustment(normalizedTrader);
    const effectiveAvailable = chainAvailable + mode2Adj;

    balance.walletBalance = walletEthBalance;  // 派生钱包总余额 (native + WETH)
    balance.nativeEthBalance = nativeEthBalance;  // 分开记录 native ETH
    balance.wethBalance = wethBalance;            // 分开记录 WETH
    balance.settlementAvailable = chainAvailable;  // Settlement 合约 available (链上原始值)
    balance.settlementLocked = 0n; // Mode 2: 链上锁仓由后端管理
    balance.usedMargin = positionMargin; // 从后端内存计算

    // totalBalance = 所有资产 (钱包 + 有效可用(链上+链下调整) + 仓位保证金)
    balance.totalBalance = walletEthBalance + effectiveAvailable + positionMargin;

    // availableBalance = 有效可用(链上+链下调整) - 挂单预留 - 仓位保证金
    // ★ 不再包含 walletBalance，因为钱包里的钱没有存入合约，用户可以随时转走
    // ★ autoDepositIfNeeded 会在下单时自动将钱包 ETH 存入 Settlement
    let available = effectiveAvailable - pendingLocked - positionMargin;
    if (available < 0n) available = 0n;
    balance.availableBalance = available;

    console.log(`[Balance] ${normalizedTrader.slice(0, 10)} wallet=Ξ${Number(walletEthBalance) / 1e18}, settlement=Ξ${Number(chainAvailable) / 1e18}, mode2Adj=Ξ${Number(mode2Adj) / 1e18}, effective=Ξ${Number(effectiveAvailable) / 1e18}, positionMargin=Ξ${Number(positionMargin) / 1e18}, pendingOrders=Ξ${Number(pendingLocked) / 1e18}, available=Ξ${Number(available) / 1e18}`);
  } catch (e) {
    console.warn(`[Balance] Failed to sync balance: ${e}`);
  }
}

/**
 * 计算用户挂单锁定总额 (内存中的 orderMarginInfos)
 * 用于从链上 Settlement available 中扣除已被挂单预留的金额
 */
function getPendingOrdersLocked(trader: Address): bigint {
  const normalizedTrader = trader.toLowerCase() as Address;
  let locked = 0n;
  const userOrders = engine.getUserOrders(normalizedTrader);
  for (const order of userOrders) {
    if (order.status === "PENDING" || order.status === "PARTIALLY_FILLED") {
      const marginInfo = orderMarginInfos.get(order.id);
      if (marginInfo) {
        const unfilledRatio = marginInfo.totalSize > 0n
          ? ((marginInfo.totalSize - marginInfo.settledSize) * 10000n) / marginInfo.totalSize
          : 10000n;
        locked += (marginInfo.totalDeducted * unfilledRatio) / 10000n;
      }
    }
  }
  return locked;
}

/**
 * 下单时扣除保证金和手续费 (内存记账)
 *
 * 调用前: autoDepositIfNeeded 已确保 Settlement 有足够资金
 * 此函数: 1) sync 链上余额  2) 检查 availableBalance  3) 记录 orderMarginInfos
 *
 * availableBalance 的本地扣减是防止连续下单之间的双花（下次 sync 会从链上+orderMarginInfos 重新算）
 * totalBalance 不变 — 资金只是从"可用"变"预留"，没有消失
 */
async function deductOrderAmount(trader: Address, orderId: string, size: bigint, price: bigint, leverage: bigint): Promise<boolean> {
  // ⚠️ 注意: autoDepositIfNeeded 已经在调用此函数前同步了链上余额
  // 这里只做内存余额检查，不再重复同步 (避免两次链上读取)
  // 如果直接调用此函数 (绕过 autoDepositIfNeeded)，需要先手动调用 syncUserBalanceFromChain

  const balance = getUserBalance(trader);
  const { margin, fee, total } = calculateOrderCost(size, price, leverage);

  if (balance.availableBalance < total) {
    console.log(`[Balance] Deduct failed: ${trader.slice(0, 10)} available $${Number(balance.availableBalance) / 1e18} < required $${Number(total) / 1e18} (margin=$${Number(margin) / 1e18} + fee=$${Number(fee) / 1e18})`);
    return false;
  }

  // 本地扣减 (防止连续下单双花，下次 sync 会重新算)
  balance.availableBalance -= total;
  // 注意: 不改 totalBalance — 资金从可用→预留，总资产不变

  // 记录订单保证金信息 (getPendingOrdersLocked 会读取这个)
  orderMarginInfos.set(orderId, {
    margin,
    fee,
    totalDeducted: total,
    totalSize: size,
    settledSize: 0n,
  });

  // 持久化到 Redis (重启后可恢复)
  OrderMarginRepo.save(orderId, {
    margin: margin.toString(),
    fee: fee.toString(),
    totalDeducted: total.toString(),
    totalSize: size.toString(),
    settledSize: "0",
    trader: trader.toLowerCase(),
  }).catch(e => console.error(`[Balance] Failed to persist margin info for ${orderId}:`, e));

  console.log(`[Balance] Deducted: ${trader.slice(0, 10)} -$${Number(total) / 1e18} (margin=$${Number(margin) / 1e18} + fee=$${Number(fee) / 1e18}), remaining: $${Number(balance.availableBalance) / 1e18}`);
  return true;
}

// ============================================================
// ERC20 最小 ABI (用于 approve + balanceOf)
// ============================================================

const ERC20_ABI = [
  {
    inputs: [{ name: "account", type: "address" }],
    name: "balanceOf",
    outputs: [{ type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [
      { name: "spender", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    name: "approve",
    outputs: [{ type: "bool" }],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [
      { name: "to", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    name: "transfer",
    outputs: [{ type: "bool" }],
    stateMutability: "nonpayable",
    type: "function",
  },
] as const;

/**
 * 检查用户余额是否足够下单，不足时自动从派生钱包存入 Settlement
 *
 * 安全模型:
 * - 只有 Settlement 合约中的 available 余额才能用于交易
 * - 派生钱包中的 ETH 必须先存入 Settlement 才算可用
 * - 存入后 Settlement 合约持有真实资产，用户无法随意提走
 *
 * 流程:
 * 1. 同步链上余额 (Settlement.available + 派生钱包 ETH)
 * 2. 检查 Settlement available - 已锁定 >= 所需金额
 * 3. 如果不够，从派生钱包自动存入差额到 Settlement (链上交易)
 * 4. 存入成功后重新同步余额
 */
async function autoDepositIfNeeded(trader: Address, requiredAmount: bigint): Promise<void> {
  // 1. 先从链上同步最新余额 (包含 mode2 PnL 调整)
  await syncUserBalanceFromChain(trader);

  const balance = getUserBalance(trader);
  const mode2Adj = getMode2Adjustment(trader);

  // 2. 计算可用于下单的金额
  //    syncUserBalanceFromChain 已经将 availableBalance 设为:
  //    (chainAvailable + mode2Adj) - pendingLocked - positionMargin
  //    直接使用 availableBalance 即可
  const settlementUsable = balance.availableBalance;

  if (settlementUsable >= requiredAmount) {
    console.log(`[Deposit] ${trader.slice(0, 10)} 余额充足: Ξ${Number(settlementUsable) / 1e18} >= 需要 Ξ${Number(requiredAmount) / 1e18} (mode2Adj=Ξ${Number(mode2Adj) / 1e18})`);
    return;
  }

  // 3. Settlement (+mode2调整) 不够，需要从派生钱包补充
  const shortfall = requiredAmount - settlementUsable;

  // gas 预留: depositETH() 大约消耗 50000-80000 gas
  // Base Sepolia gas price ~0.01 gwei, 保守估计 0.002 ETH
  const gasReserve = 2000000000000000n; // 0.002 ETH gas 预留

  // 钱包可存入金额 = 钱包余额 - gas 预留
  const walletAvailable = balance.walletBalance > gasReserve
    ? balance.walletBalance - gasReserve
    : 0n;

  if (walletAvailable < shortfall) {
    // 钱包余额也不够
    const totalAvailable = settlementUsable + walletAvailable;
    const pendingLocked = getPendingOrdersLocked(trader);
    const details = `钱包: Ξ${Number(balance.walletBalance) / 1e18}, Settlement+调整 可用: Ξ${Number(settlementUsable) / 1e18}, mode2Adj: Ξ${Number(mode2Adj) / 1e18}, 仓位占用: Ξ${Number(balance.usedMargin) / 1e18}, 挂单占用: Ξ${Number(pendingLocked) / 1e18}`;
    throw new Error(`余额不足: 需要 Ξ${Number(requiredAmount) / 1e18}，可用 Ξ${Number(totalAvailable) / 1e18}。[${details}] 请先存入资金。`);
  }

  // 4. 计算存入策略: 优先用 WETH (approve+deposit)，不够再用 native ETH (depositETH)
  //
  // 为什么 WETH 优先?
  // - depositETH() 需要发送 native ETH 作为 msg.value，同时还需要 native ETH 支付 gas
  // - 如果 native ETH 不多，value + gas 容易超出余额
  // - WETH 是 ERC20，approve+deposit 只需要 gas (native ETH)，value 从 WETH 余额出
  //
  const WETH_ADDRESS = (process.env.WETH_ADDRESS || "0x4200000000000000000000000000000000000006") as Address;

  console.log(`[Deposit] ${trader.slice(0, 10)} 需要存入 Ξ${Number(shortfall) / 1e18} 到 Settlement (native=Ξ${Number(balance.nativeEthBalance) / 1e18}, weth=Ξ${Number(balance.wethBalance) / 1e18})`);

  if (!SETTLEMENT_ADDRESS) {
    throw new Error("Settlement 合约地址未配置");
  }

  try {
    // 获取派生钱包的 session 私钥
    const sessionId = await getActiveSessionForDerived(trader);
    if (!sessionId) {
      throw new Error("无法获取交易授权，请重新登录");
    }

    const signingKey = await getSigningKey(sessionId);
    if (!signingKey) {
      throw new Error("交易授权已过期，请重新登录");
    }

    // 创建钱包客户端
    const account = privateKeyToAccount(signingKey);
    const walletClient = createWalletClient({
      account,
      chain: baseSepolia,
      transport: http(RPC_URL),
    });

    const publicClient = createPublicClient({
      chain: baseSepolia,
      transport: http(RPC_URL),
    });

    // 策略: WETH 够就全用 WETH，不够再混合使用
    const wethAvailable = balance.wethBalance;
    const nativeAvailable = balance.nativeEthBalance > gasReserve
      ? balance.nativeEthBalance - gasReserve
      : 0n;

    let wethDepositAmount = 0n;
    let nativeDepositAmount = 0n;

    if (wethAvailable >= shortfall) {
      // WETH 够用，全部用 WETH
      wethDepositAmount = shortfall;
    } else if (wethAvailable > 0n) {
      // WETH 不够，混合: WETH 全部 + native ETH 补差
      wethDepositAmount = wethAvailable;
      nativeDepositAmount = shortfall - wethAvailable;
    } else {
      // 没有 WETH，全部用 native ETH
      nativeDepositAmount = shortfall;
    }

    // === Step A: 用 WETH 存入 (approve + deposit) ===
    if (wethDepositAmount > 0n) {
      console.log(`[Deposit] ${trader.slice(0, 10)} 用 WETH 存入 Ξ${Number(wethDepositAmount) / 1e18}`);

      // A1. Approve Settlement 使用 WETH
      const approveTx = await walletClient.writeContract({
        address: WETH_ADDRESS,
        abi: ERC20_ABI,
        functionName: "approve",
        args: [SETTLEMENT_ADDRESS, wethDepositAmount],
      });
      console.log(`[Deposit] approve tx: ${approveTx}`);

      const approveReceipt = await publicClient.waitForTransactionReceipt({
        hash: approveTx,
        confirmations: 1,
        timeout: 30_000,
      });
      if (approveReceipt.status === "reverted") {
        throw new Error(`WETH approve 失败, tx: ${approveTx}`);
      }

      // A2. 调用 Settlement.deposit(weth, amount)
      const depositTx = await walletClient.writeContract({
        address: SETTLEMENT_ADDRESS,
        abi: SETTLEMENT_ABI,
        functionName: "deposit",
        args: [WETH_ADDRESS, wethDepositAmount],
      });
      console.log(`[Deposit] deposit(WETH) tx: ${depositTx}`);

      const depositReceipt = await publicClient.waitForTransactionReceipt({
        hash: depositTx,
        confirmations: 1,
        timeout: 30_000,
      });
      if (depositReceipt.status === "reverted") {
        throw new Error(`WETH deposit 失败, tx: ${depositTx}`);
      }

      console.log(`[Deposit] ✅ WETH 存入成功: Ξ${Number(wethDepositAmount) / 1e18}, gas: ${depositReceipt.gasUsed}`);
    }

    // === Step B: 用 native ETH 存入 (depositETH) ===
    if (nativeDepositAmount > 0n) {
      console.log(`[Deposit] ${trader.slice(0, 10)} 用 native ETH 存入 Ξ${Number(nativeDepositAmount) / 1e18}`);

      const txHash = await walletClient.writeContract({
        address: SETTLEMENT_ADDRESS,
        abi: SETTLEMENT_ABI as any,
        functionName: "depositETH",
        args: [],
        value: nativeDepositAmount,
      } as any);

      console.log(`[Deposit] depositETH tx: ${txHash}`);

      const receipt = await publicClient.waitForTransactionReceipt({
        hash: txHash,
        confirmations: 1,
        timeout: 30_000,
      });

      if (receipt.status === "reverted") {
        throw new Error(`depositETH 失败, tx: ${txHash}`);
      }

      console.log(`[Deposit] ✅ native ETH 存入成功: Ξ${Number(nativeDepositAmount) / 1e18}, gas: ${receipt.gasUsed}`);
    }

    console.log(`[Deposit] ✅ ${trader.slice(0, 10)} 总共存入 Ξ${Number(wethDepositAmount + nativeDepositAmount) / 1e18} (WETH: Ξ${Number(wethDepositAmount) / 1e18}, ETH: Ξ${Number(nativeDepositAmount) / 1e18})`);

    // 5. 存入成功，重新同步余额
    await syncUserBalanceFromChain(trader);

  } catch (e: any) {
    console.error(`[Deposit] ❌ ${trader.slice(0, 10)} 存入失败:`, e.message || e);
    throw new Error(`保证金存入 Settlement 失败: ${e.message || "未知错误"}。请确保派生钱包有足够的 ETH/WETH。`);
  }
}

/**
 * 撤单时退还保证金和手续费 (仅退还未成交部分)
 * @returns 退还金额 (1e18 ETHT 精度), 0n 表示无需退款
 */
function refundOrderAmount(trader: Address, orderId: string): bigint {
  const balance = getUserBalance(trader);
  const marginInfo = orderMarginInfos.get(orderId);

  if (!marginInfo) {
    console.log(`[Balance] Refund skipped: no margin info for order ${orderId}`);
    return 0n;
  }

  // 计算未结算比例
  const unfilledRatio = marginInfo.totalSize > 0n
    ? ((marginInfo.totalSize - marginInfo.settledSize) * 10000n) / marginInfo.totalSize
    : 10000n;

  // 按未成交比例退还 (保证金 + 手续费)
  const refundMargin = (marginInfo.margin * unfilledRatio) / 10000n;
  const refundFee = (marginInfo.fee * unfilledRatio) / 10000n;
  const refundTotal = refundMargin + refundFee;

  // 本地退还 (下次 sync 会从链上+orderMarginInfos 重新算)
  balance.availableBalance += refundTotal;
  // 注意: 不改 totalBalance — 资金从预留→可用，总资产不变

  // 删除记录 (getPendingOrdersLocked 不再计入此订单)
  orderMarginInfos.delete(orderId);
  OrderMarginRepo.delete(orderId).catch(e => console.error(`[Balance] Failed to delete margin info from Redis for ${orderId}:`, e));

  console.log(`[Balance] Refunded: ${trader.slice(0, 10)} +$${Number(refundTotal) / 1e18} (unfilled ${Number(unfilledRatio) / 100}%), balance: $${Number(balance.availableBalance) / 1e18}`);
  return refundTotal;
}

/**
 * [Mode 2] 撤单时更新内存余额
 *
 * Mode 2 变更:
 * - 不再调用链上 Settlement.withdraw()
 * - 直接更新内存余额 (refundOrderAmount 已经做了)
 * - 用户提现时通过 Merkle 证明从 SettlementV2 提取
 */
async function withdrawFromSettlement(trader: Address, amount: bigint): Promise<void> {
  if (amount <= 0n) return;

  // Mode 2: 只记录日志，不做链上操作
  // 余额已在 refundOrderAmount 中更新到内存
  console.log(`[Mode2] ${trader.slice(0, 10)} refund $${Number(amount) / 1e18} (off-chain only)`);
}

/**
 * 订单成交时处理保证金 (支持部分成交)
 * - 按成交比例将保证金转为仓位保证金 (usedMargin)
 * - 手续费按 Maker/Taker 角色收取 (Maker 0.02%, Taker 0.05%)
 * @param filledSize 本次成交大小
 * @param isMaker true = 挂单方 (Maker, 费率更低)
 */
function settleOrderMargin(trader: Address, orderId: string, filledSize: bigint, isMaker: boolean = false): void {
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
  // 预扣的手续费 (按 Taker 费率 0.05%)
  const preDeductedFee = (marginInfo.fee * fillRatio) / 10000n;

  // 实际手续费: Maker 0.02%, Taker 0.05%
  const TAKER_FEE_RATE = 5n;
  const MAKER_FEE_RATE = 2n;
  const actualFeeRate = isMaker ? MAKER_FEE_RATE : TAKER_FEE_RATE;
  const actualFee = (filledSize * actualFeeRate) / 10000n;

  balance.usedMargin += settleMargin;

  // Mode 2: 开仓手续费是消耗品 — 从 chainAvailable 中"扣除"
  // 当 orderMarginInfos 删除后，pendingOrdersLocked 减少了 margin+fee，
  // 但 positionMargin 只增加 margin，所以 fee 部分会虚增 available
  // 需要通过 mode2Adj -= fee 来抵消
  if (actualFee > 0n) {
    addMode2Adjustment(trader, -actualFee, "OPEN_FEE");
    // ✅ 手续费转入平台钱包
    addMode2Adjustment(FEE_RECEIVER_ADDRESS, actualFee, "PLATFORM_FEE");
    console.log(`[Fee] Open fee Ξ${Number(actualFee) / 1e18} (${isMaker ? "Maker 0.02%" : "Taker 0.05%"}) → platform wallet`);
  }

  // Maker 退还多扣的手续费差额 (预扣 Taker 0.05% - 实际 Maker 0.02% = 0.03%)
  if (isMaker && preDeductedFee > actualFee) {
    const refund = preDeductedFee - actualFee;
    balance.availableBalance += refund;
    // mode2Adj 只扣了 actualFee，而预扣里包含了 preDeductedFee
    // 差额 refund 需要补回 mode2Adj (因为 pendingOrdersLocked 仍按原额释放)
    addMode2Adjustment(trader, refund, "MAKER_FEE_REFUND");
    console.log(`[Fee] Maker fee refund Ξ${Number(refund) / 1e18} → ${trader.slice(0, 10)}`);
  }

  // 更新已结算大小
  marginInfo.settledSize += filledSize;

  // 如果完全成交，删除记录
  if (marginInfo.settledSize >= marginInfo.totalSize) {
    orderMarginInfos.delete(orderId);
    OrderMarginRepo.delete(orderId).catch(e => console.error(`[Balance] Failed to delete settled margin from Redis:`, e));
    console.log(`[Balance] Fully settled: ${trader.slice(0, 10)} margin=$${Number(marginInfo.margin) / 1e18} → usedMargin`);
  } else {
    OrderMarginRepo.updateSettledSize(orderId, marginInfo.settledSize).catch(e => console.error(`[Balance] Failed to update settledSize in Redis:`, e));
    console.log(`[Balance] Partial settle: ${trader.slice(0, 10)} +$${Number(settleMargin) / 1e18} (${Number(marginInfo.settledSize)}/${Number(marginInfo.totalSize)} filled)`);
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
 * 从 TokenFactory 获取所有支持的代币
 * 用于资金费计算
 */
async function syncSupportedTokens(): Promise<void> {
  if (!TOKEN_FACTORY_ADDRESS) {
    console.log("[Sync] No TokenFactory address configured");
    return;
  }

  try {
    const publicClient = createPublicClient({
      chain: baseSepolia,
      transport: http(RPC_URL),
    });

    const tokens = await publicClient.readContract({
      address: TOKEN_FACTORY_ADDRESS,
      abi: TOKEN_FACTORY_ABI,
      functionName: "getAllTokens",
    }) as Address[];

    // 清空并重新填充
    SUPPORTED_TOKENS.length = 0;
    for (const token of tokens) {
      const normalizedToken = token.toLowerCase() as Address;
      if (!SUPPORTED_TOKENS.includes(normalizedToken)) {
        SUPPORTED_TOKENS.push(normalizedToken);
      }
    }

    console.log(`[Sync] Loaded ${SUPPORTED_TOKENS.length} supported tokens from TokenFactory`);
    if (SUPPORTED_TOKENS.length > 0) {
      console.log(`[Sync] Tokens: ${SUPPORTED_TOKENS.map(t => t.slice(0, 10)).join(", ")}`);
    }

    // 检测已毕业的代币，注册其 Uniswap V2 Pair 地址
    await detectGraduatedTokens();
  } catch (e) {
    console.error("[Sync] Failed to load supported tokens:", e);
  }
}

/**
 * 添加代币到支持列表（当检测到新代币时）
 */
function addSupportedToken(token: Address): void {
  const normalizedToken = token.toLowerCase() as Address;
  if (!SUPPORTED_TOKENS.includes(normalizedToken)) {
    SUPPORTED_TOKENS.push(normalizedToken);
    console.log(`[Sync] Added new supported token: ${normalizedToken.slice(0, 10)}`);
  }
}

/**
 * 注册毕业代币 - 记录其 Uniswap V2 Pair 地址用于价格读取
 *
 * 当代币从 bonding curve 毕业到 Uniswap V2 后:
 * 1. TokenFactory.getCurrentPrice() 返回冻结的旧价格 (因为 reserve 没有归零)
 * 2. 真实市场价格在 Uniswap V2 Pair 上
 * 3. 需要从 Pair.getReserves() 读取真实价格
 *
 * @param token - 代币地址
 * @param pairAddress - Uniswap V2 Pair 地址
 */
async function registerGraduatedToken(token: Address, pairAddress: Address): Promise<void> {
  const normalizedToken = token.toLowerCase();
  const normalizedPair = pairAddress.toLowerCase() as Address;

  // 判断 WETH 是 token0 还是 token1
  // Uniswap V2 中 token0 < token1 (按地址排序)
  const isWethToken0 = WETH_ADDRESS.toLowerCase() < normalizedToken;

  graduatedTokens.set(normalizedToken, {
    pairAddress: normalizedPair,
    isWethToken0,
  });

  console.log(`[Graduation] ✅ Registered graduated token: ${normalizedToken.slice(0, 10)}`);
  console.log(`[Graduation]    Pair: ${normalizedPair.slice(0, 10)}, WETH is token${isWethToken0 ? '0' : '1'}`);
}

/**
 * 检测已毕业的代币并注册其 Pair 地址
 * 在启动时调用，处理服务器重启期间发生的毕业事件
 */
async function detectGraduatedTokens(): Promise<void> {
  if (SUPPORTED_TOKENS.length === 0) return;

  const publicClient = createPublicClient({
    chain: baseSepolia,
    transport: http(RPC_URL),
  });

  console.log(`[Graduation] Checking ${SUPPORTED_TOKENS.length} tokens for graduation status...`);

  for (const token of SUPPORTED_TOKENS) {
    try {
      // 读取 PoolState 检查 isGraduated
      const poolState = await publicClient.readContract({
        address: TOKEN_FACTORY_ADDRESS,
        abi: TOKEN_FACTORY_ABI,
        functionName: "getPoolState",
        args: [token],
      }) as {
        realETHReserve: bigint;
        realTokenReserve: bigint;
        soldTokens: bigint;
        isGraduated: boolean;
        isActive: boolean;
        creator: string;
        createdAt: bigint;
        metadataURI: string;
        graduationFailed: boolean;
        graduationAttempts: number;
        perpEnabled: boolean;
      };

      if (poolState.isGraduated) {
        // 通过 Uniswap V2 Factory 查找 Pair 地址
        const pairAddress = await publicClient.readContract({
          address: UNISWAP_V2_FACTORY_ADDRESS,
          abi: UNISWAP_V2_FACTORY_ABI,
          functionName: "getPair",
          args: [token, WETH_ADDRESS],
        }) as Address;

        const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
        if (pairAddress && pairAddress.toLowerCase() !== ZERO_ADDRESS) {
          await registerGraduatedToken(token, pairAddress);
        } else {
          console.warn(`[Graduation] ⚠️ Token ${token.slice(0, 10)} is graduated but no Pair found!`);
        }
      }
    } catch (e: any) {
      console.warn(`[Graduation] Error checking ${token.slice(0, 10)}:`, e?.message?.slice(0, 80));
    }
  }

  console.log(`[Graduation] Found ${graduatedTokens.size} graduated tokens`);
}

/**
 * [模式 2] 仓位只存后端 Redis，不再从链上同步
 *
 * 旧模式: 从链上 Settlement 同步所有 PairedPosition
 * 新模式: 仓位 = Redis 唯一真理源，链上只做资金托管 + 快照存证
 */
async function syncPositionsFromChain(): Promise<void> {
  console.log("[Mode2] Position sync from chain is DISABLED");
  console.log("[Mode2] Positions are stored in Redis only, chain is for fund custody + snapshot attestation");
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
  console.log("[Events] Using WebSocket endpoint:", WSS_URL);

  const publicClient = createPublicClient({
    chain: baseSepolia,
    transport: webSocket(WSS_URL),
  });

  // 监听 Deposited 事件 (用户直接充值)
  publicClient.watchContractEvent({
    address: SETTLEMENT_ADDRESS,
    abi: SETTLEMENT_ABI,
    eventName: "Deposited",
    onLogs: (logs) => {
      for (const log of logs) {
        const { user, amount } = log.args as { user: Address; amount: bigint };
        console.log(`[Events] Deposited: ${user.slice(0, 10)} +$${Number(amount) / 1e18}`);
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
        console.log(`[Events] DepositedFor: ${relayer.slice(0, 10)} → ${user.slice(0, 10)} +$${Number(amount) / 1e18}`);
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
        console.log(`[Events] Withdrawn: ${user.slice(0, 10)} -$${Number(amount) / 1e18}`);
        broadcastBalanceUpdate(user);
      }
    },
  });

  // ============================================================
  // 🔄 模式 2: 以下事件监听器已禁用
  // - PairOpened, PairClosed, Liquidated 不再需要
  // - 仓位只存后端 Redis，不从链上同步
  // - 链上只做资金托管 + Merkle Root 快照存证
  // ============================================================
  console.log("[Events] Mode 2: PairOpened/PairClosed/Liquidated listeners DISABLED");
  console.log("[Events] Mode 2: Positions are stored in Redis only");

  // 监听 TokenFactory LiquidityMigrated 事件 (代币毕业到 Uniswap V2)
  console.log("[Events] Starting TokenFactory LiquidityMigrated event watching:", TOKEN_FACTORY_ADDRESS);
  publicClient.watchContractEvent({
    address: TOKEN_FACTORY_ADDRESS,
    abi: TOKEN_FACTORY_ABI,
    eventName: "LiquidityMigrated",
    onLogs: async (logs) => {
      for (const log of logs) {
        const { tokenAddress, pairAddress, ethLiquidity, tokenLiquidity } = log.args as {
          tokenAddress: Address;
          pairAddress: Address;
          ethLiquidity: bigint;
          tokenLiquidity: bigint;
          timestamp: bigint;
        };

        console.log(`[Events] 🎓 LiquidityMigrated: ${tokenAddress.slice(0, 10)} → Pair ${pairAddress.slice(0, 10)}`);
        console.log(`[Events]    ETH: ${Number(ethLiquidity) / 1e18}, Tokens: ${Number(tokenLiquidity) / 1e18}`);

        // 注册毕业代币，切换价格源到 Uniswap V2 Pair
        await registerGraduatedToken(tokenAddress, pairAddress);

        console.log(`[Events] ✅ Price source switched to Uniswap V2 for ${tokenAddress.slice(0, 10)}`);
        console.log(`[Events]    Perpetual trading will continue with DEX market price`);
      }
    },
  });

  // 监听 TokenFactory TokenCreated 事件 (新代币创建)
  console.log("[Events] Starting TokenFactory TokenCreated event watching:", TOKEN_FACTORY_ADDRESS);
  publicClient.watchContractEvent({
    address: TOKEN_FACTORY_ADDRESS,
    abi: TOKEN_FACTORY_ABI,
    eventName: "TokenCreated",
    onLogs: async (logs) => {
      for (const log of logs) {
        const { tokenAddress, creator, name, symbol } = log.args as {
          tokenAddress: Address;
          creator: Address;
          name: string;
          symbol: string;
          uri: string;
          totalSupply: bigint;
        };

        console.log(`[Events] TokenCreated: ${symbol} (${name}) at ${tokenAddress.slice(0, 10)} by ${creator.slice(0, 10)}`);

        // 添加到支持的代币列表
        addSupportedToken(tokenAddress);

        // ✅ 创建初始 K 线数据 (Pump.fun 模式)
        // 直接从合约读取价格，避免浮点数精度差异导致的虚假下跌
        try {
          const { initializeTokenKline } = await import("../spot/spotHistory");

          // 从合约读取当前价格 (与 syncSpotPrices 使用相同的方式)
          const getCurrentPriceAbi = [{
            inputs: [{ name: "token", type: "address" }],
            name: "getCurrentPrice",
            outputs: [{ type: "uint256" }],
            stateMutability: "view",
            type: "function",
          }] as const;

          const priceWei = await publicClient.readContract({
            address: TOKEN_FACTORY_ADDRESS,
            abi: getCurrentPriceAbi,
            functionName: "getCurrentPrice",
            args: [tokenAddress],
          });

          // 转换为 ETH (与 syncSpotPrices 完全一致的计算方式)
          const initialPriceEth = Number(priceWei) / 1e18;
          const ethPriceUsd = currentEthPriceUsd || 2500;
          const initialPriceUsd = initialPriceEth * ethPriceUsd;

          await initializeTokenKline(
            tokenAddress,
            initialPriceEth.toString(),
            initialPriceUsd.toString(),
            Number(log.blockNumber || 0n)
          );
          console.log(`[Events] Initialized K-line for ${symbol}: ${initialPriceEth.toExponential(4)} ETH ($${initialPriceUsd.toExponential(4)})`);
        } catch (initErr) {
          console.warn("[Events] Failed to initialize K-line:", initErr);
        }
      }
    },
  });

  // 监听 TokenFactory Trade 事件 (现货交易)
  console.log("[Events] Starting TokenFactory Trade event watching:", TOKEN_FACTORY_ADDRESS);
  publicClient.watchContractEvent({
    address: TOKEN_FACTORY_ADDRESS,
    abi: TOKEN_FACTORY_ABI,
    eventName: "Trade",
    onLogs: async (logs) => {
      for (const log of logs) {
        const { token, trader, isBuy, ethAmount, tokenAmount, virtualEth, virtualToken, timestamp } = log.args as {
          token: Address;
          trader: Address;
          isBuy: boolean;
          ethAmount: bigint;
          tokenAmount: bigint;
          virtualEth: bigint;
          virtualToken: bigint;
          timestamp: bigint;
        };

        console.log(`[Events] TokenFactory Trade: ${isBuy ? "BUY" : "SELL"} ${token.slice(0, 10)} by ${trader.slice(0, 10)}`);

        // 确保代币在支持列表中（用于资金费计算）
        addSupportedToken(token);

        // 获取当前 ETH 价格 (从内存缓存)
        const ethPriceUsd = currentEthPriceUsd || 2500;

        // 处理交易事件并存储
        try {
          const { processTradeEvent } = await import("../spot/spotHistory");
          await processTradeEvent(
            token,
            trader,
            isBuy,
            ethAmount,
            tokenAmount,
            virtualEth,
            virtualToken,
            timestamp,
            log.transactionHash as Hex,
            log.blockNumber ?? 0n,
            ethPriceUsd
          );

          // 计算交易后的正确价格 (合约发出的是交易前状态!)
          // 买入: ETH进入池子，Token离开池子
          // 卖出: Token进入池子，ETH离开池子
          let afterVirtualEth: bigint;
          let afterVirtualToken: bigint;

          if (isBuy) {
            afterVirtualEth = virtualEth + ethAmount;
            afterVirtualToken = virtualToken - tokenAmount;
          } else {
            // 卖出时 ethAmount 是扣除手续费后的净值
            const FEE_MULTIPLIER = 0.99;
            const ethOutTotal = BigInt(Math.ceil(Number(ethAmount) / FEE_MULTIPLIER));
            afterVirtualEth = virtualEth - ethOutTotal;
            afterVirtualToken = virtualToken + tokenAmount;
          }

          const afterPrice = afterVirtualToken > 0n
            ? Number(afterVirtualEth) / Number(afterVirtualToken)
            : Number(virtualEth) / Number(virtualToken);

          // 广播给订阅了该代币的 WebSocket 客户端
          broadcastSpotTrade(token, {
            token,
            trader,
            isBuy,
            ethAmount: ethAmount.toString(),
            tokenAmount: tokenAmount.toString(),
            price: afterPrice.toString(),
            txHash: log.transactionHash,
            timestamp: Number(timestamp),
          });

          // ✅ 广播 K线更新 (关键修复：让前端 K线实时更新)
          try {
            const { KlineRepo } = await import("../spot/spotHistory");
            // 获取最新的 1m K线 (当前时间桶)
            const currentMinute = Math.floor(Number(timestamp) / 60) * 60;
            const klines = await KlineRepo.get(token, "1m", currentMinute, currentMinute);

            if (klines.length > 0) {
              const kline = klines[0];
              broadcastKline(token, {
                timestamp: kline.time * 1000, // 转换为毫秒
                open: kline.open,
                high: kline.high,
                low: kline.low,
                close: kline.close,
                volume: kline.volume,
              });
              console.log(`[Events] Broadcasted kline update for ${token.slice(0, 10)}`);
            }
          } catch (klineErr) {
            console.warn("[Events] Failed to broadcast kline:", klineErr);
          }
        } catch (e) {
          console.error("[Events] Failed to process trade event:", e);
        }
      }
    },
  });

  // 监听 WETH ERC20 Transfer 事件 (用户转 WETH 到/从派生钱包)
  const WETH_ADDRESS = process.env.WETH_ADDRESS as Address;
  if (WETH_ADDRESS) {
    console.log("[Events] Starting WETH Transfer event watching:", WETH_ADDRESS);
    publicClient.watchContractEvent({
      address: WETH_ADDRESS,
      abi: [{
        type: "event",
        name: "Transfer",
        inputs: [
          { name: "from", type: "address", indexed: true },
          { name: "to", type: "address", indexed: true },
          { name: "value", type: "uint256", indexed: false },
        ],
      }],
      eventName: "Transfer",
      onLogs: async (logs) => {
        for (const log of logs) {
          const { from, to, value } = log.args as { from: Address; to: Address; value: bigint };
          const normalizedTo = to.toLowerCase() as Address;
          const normalizedFrom = from.toLowerCase() as Address;

          // 转入派生钱包 → 同步余额 + 推送
          if (getUserBalance(normalizedTo).totalBalance !== undefined) {
            console.log(`[Events] WETH Transfer IN: ${from.slice(0, 10)} → ${to.slice(0, 10)}, +Ξ${Number(value) / 1e18}`);
            await syncUserBalanceFromChain(normalizedTo);
            broadcastBalanceUpdate(normalizedTo);
          }

          // 从派生钱包转出 → 同步余额 + 推送
          if (getUserBalance(normalizedFrom).totalBalance !== undefined) {
            console.log(`[Events] WETH Transfer OUT: ${from.slice(0, 10)} → ${to.slice(0, 10)}, -Ξ${Number(value) / 1e18}`);
            await syncUserBalanceFromChain(normalizedFrom);
            broadcastBalanceUpdate(normalizedFrom);
          }
        }
      },
    });
  } else {
    console.warn("[Events] WETH_ADDRESS not configured, skipping Transfer event watching");
  }

  console.log("[Events] Event watching started successfully");

  // ========================================
  // 启动 HTTP 轮询式 Trade 事件监听 (WebSocket 的可靠备份)
  // WebSocket watchContractEvent 可能会静默断开，轮询作为兜底
  // ========================================
  startTradeEventPoller().catch((e) => {
    console.error("[TradePoller] Failed to start:", e);
  });
}

/**
 * 基于 HTTP 轮询的 Trade 事件监听
 *
 * WebSocket 事件订阅容易静默断开（尤其是免费公共节点），
 * 此轮询器使用 HTTP getLogs 定期扫描新区块，确保不漏掉任何交易。
 *
 * 工作方式:
 * 1. 启动时从当前区块开始记录 lastScannedBlock
 * 2. 每 15 秒轮询一次，获取 lastScannedBlock+1 到 latest 之间的 Trade 事件
 * 3. 调用 processTradeEvent 存储（内部会自动去重）
 */
let lastScannedBlock = 0n;
const TRADE_POLL_INTERVAL_MS = 15_000; // 15 秒轮询一次

async function startTradeEventPoller(): Promise<void> {
  const { createPublicClient, http, parseAbiItem } = await import("viem");
  const { baseSepolia } = await import("viem/chains");

  // 使用 publicnode.com 的 HTTP RPC（无 getLogs 区块范围限制）
  const POLL_RPC_URL = "https://base-sepolia-rpc.publicnode.com";

  const pollClient = createPublicClient({
    chain: baseSepolia,
    transport: http(POLL_RPC_URL),
  });

  const TRADE_EVENT_ABI = parseAbiItem(
    "event Trade(address indexed token, address indexed trader, bool isBuy, uint256 ethAmount, uint256 tokenAmount, uint256 virtualEth, uint256 virtualToken, uint256 timestamp)"
  );

  // 获取当前区块作为起始点
  const currentBlock = await pollClient.getBlockNumber();
  lastScannedBlock = currentBlock;
  console.log(`[TradePoller] Started at block ${currentBlock}, polling every ${TRADE_POLL_INTERVAL_MS / 1000}s`);

  // 启动前先回填：扫描最近 1000 个区块以捕获启动期间遗漏的事件
  try {
    const backfillFrom = currentBlock > 1000n ? currentBlock - 1000n : 0n;
    console.log(`[TradePoller] Backfilling from block ${backfillFrom} to ${currentBlock}...`);
    await pollTradeEvents(pollClient, TRADE_EVENT_ABI, backfillFrom, currentBlock);
  } catch (e: any) {
    console.error(`[TradePoller] Backfill failed:`, e.message);
  }

  // 定期轮询新事件
  setInterval(async () => {
    try {
      const latestBlock = await pollClient.getBlockNumber();
      if (latestBlock <= lastScannedBlock) return; // 没有新区块

      const fromBlock = lastScannedBlock + 1n;
      const toBlock = latestBlock;

      await pollTradeEvents(pollClient, TRADE_EVENT_ABI, fromBlock, toBlock);
      lastScannedBlock = toBlock;
    } catch (e: any) {
      console.error(`[TradePoller] Poll error:`, e.message);
      // 不更新 lastScannedBlock，下次重试
    }
  }, TRADE_POLL_INTERVAL_MS);
}

/**
 * 轮询指定区块范围内的 Trade 事件并处理
 */
async function pollTradeEvents(
  client: any,
  eventAbi: any,
  fromBlock: bigint,
  toBlock: bigint
): Promise<void> {
  const BATCH_SIZE = 2000n;
  let totalProcessed = 0;

  for (let start = fromBlock; start <= toBlock; start += BATCH_SIZE) {
    const end = start + BATCH_SIZE > toBlock ? toBlock : start + BATCH_SIZE;

    const logs = await client.getLogs({
      address: TOKEN_FACTORY_ADDRESS,
      event: eventAbi,
      fromBlock: start,
      toBlock: end,
    });

    if (logs.length === 0) continue;

    for (const log of logs) {
      const args = log.args as {
        token: Address;
        trader: Address;
        isBuy: boolean;
        ethAmount: bigint;
        tokenAmount: bigint;
        virtualEth: bigint;
        virtualToken: bigint;
        timestamp: bigint;
      };

      try {
        const { processTradeEvent } = await import("../spot/spotHistory");
        const ethPriceUsd = currentEthPriceUsd || 2500;

        // processTradeEvent 内部会检查 exists() 自动去重
        await processTradeEvent(
          args.token,
          args.trader,
          args.isBuy,
          args.ethAmount,
          args.tokenAmount,
          args.virtualEth,
          args.virtualToken,
          args.timestamp,
          log.transactionHash as Hex,
          log.blockNumber ?? 0n,
          ethPriceUsd
        );
        totalProcessed++;

        // 确保代币在支持列表中
        addSupportedToken(args.token);

        // 广播给 WebSocket 客户端
        let afterVirtualEth: bigint;
        let afterVirtualToken: bigint;
        if (args.isBuy) {
          afterVirtualEth = args.virtualEth + args.ethAmount;
          afterVirtualToken = args.virtualToken - args.tokenAmount;
        } else {
          const FEE_MULTIPLIER = 0.99;
          const ethOutTotal = BigInt(Math.ceil(Number(args.ethAmount) / FEE_MULTIPLIER));
          afterVirtualEth = args.virtualEth - ethOutTotal;
          afterVirtualToken = args.virtualToken + args.tokenAmount;
        }
        const afterPrice = afterVirtualToken > 0n
          ? Number(afterVirtualEth) / Number(afterVirtualToken)
          : Number(args.virtualEth) / Number(args.virtualToken);

        broadcastSpotTrade(args.token, {
          token: args.token,
          trader: args.trader,
          isBuy: args.isBuy,
          ethAmount: args.ethAmount.toString(),
          tokenAmount: args.tokenAmount.toString(),
          price: afterPrice.toString(),
          txHash: log.transactionHash,
          timestamp: Number(args.timestamp),
        });
      } catch (tradeErr: any) {
        console.error(`[TradePoller] Failed to process trade ${log.transactionHash?.slice(0, 10)}:`, tradeErr.message);
      }
    }
  }

  if (totalProcessed > 0) {
    console.log(`[TradePoller] Processed ${totalProcessed} trades from blocks ${fromBlock}-${toBlock}`);
  }
}

/**
 * [模式 2] 此函数已弃用
 *
 * 旧模式: 从链上 PairOpened 事件同步仓位
 * 新模式: 仓位完全在后端管理，由 addPositionToUser() 在撮合时创建
 */
// function syncPositionFromChainData() - DEPRECATED in Mode 2

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
  const normalizedUser = user.toLowerCase();
  const balance = getUserBalance(normalizedUser as Address);
  const message = JSON.stringify({
    type: "balance",
    data: {
      trader: normalizedUser,
      totalBalance: balance.totalBalance.toString(),
      availableBalance: balance.availableBalance.toString(),
      usedMargin: (balance.usedMargin || 0n).toString(),
      unrealizedPnL: (balance.unrealizedPnL || 0n).toString(),
      walletBalance: (balance.walletBalance || 0n).toString(),
      settlementAvailable: (balance.settlementAvailable || 0n).toString(),
      settlementLocked: (balance.settlementLocked || 0n).toString(),
    },
    timestamp: Math.floor(Date.now() / 1000),
  });

  for (const [client, subscriptions] of wsClients.entries()) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(message);
    }
  }
}

/**
 * 广播仓位更新到前端
 * 1. 发送 "positions" 通知 (触发前端 HTTP refetch, 兼容旧逻辑)
 * 2. 立即推送 "position_risks" 完整仓位数据 (实时更新, 无需等 500ms 周期)
 */
function broadcastPositionUpdate(user: Address, token: Address): void {
  const normalizedToken = token.toLowerCase() as Address;
  const normalizedUser = user.toLowerCase() as Address;

  // 1. 通知所有订阅该 token 的客户端 (触发 HTTP refetch)
  const notification = JSON.stringify({
    type: "positions",
    user: normalizedUser,
    token: normalizedToken,
    timestamp: Date.now(),
  });

  for (const [client, subscriptions] of wsClients.entries()) {
    if (client.readyState === WebSocket.OPEN && subscriptions.has(normalizedToken)) {
      client.send(notification);
    }
  }

  // 2. 立即推送该用户的完整仓位数据 (position_risks)
  // 不等待 broadcastRiskData 的 500ms 周期，确保仓位变更即时反映
  broadcastUserPositionRisks(normalizedUser);
}

/**
 * 向指定用户推送其完整仓位风险数据
 * 通过 wsTraderClients (subscribe_risk 订阅) 发送
 */
function broadcastUserPositionRisks(trader: Address): void {
  const wsSet = wsTraderClients.get(trader);
  if (!wsSet || wsSet.size === 0) return;

  const positions = userPositions.get(trader) || [];
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
    timestamp: Date.now(),
  });

  for (const ws of wsSet) {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(message);
    }
  }
}

/**
 * 广播现货交易事件到前端
 */
function broadcastSpotTrade(token: Address, trade: {
  token: Address;
  trader: Address;
  isBuy: boolean;
  ethAmount: string;
  tokenAmount: string;
  price: string;
  txHash: Hex | null;
  timestamp: number;
}): void {
  const normalizedToken = token.toLowerCase() as Address;
  const message = JSON.stringify({
    type: "spot_trade",
    token: normalizedToken,
    ...trade,
  });

  for (const [client, subscriptions] of wsClients.entries()) {
    if (client.readyState === WebSocket.OPEN && subscriptions.has(normalizedToken)) {
      client.send(message);
    }
  }
}

/**
 * 广播 K线更新到前端
 */
function broadcastKline(token: Address, kline: {
  timestamp: number;
  open: string;
  high: string;
  low: string;
  close: string;
  volume: string;
}): void {
  const normalizedToken = token.toLowerCase() as Address;
  // 统一消息格式: 与 handlers.ts 的 broadcastKline 保持一致
  // 前端 useWebSocketKlines 读取 message.data.xxx
  const message = JSON.stringify({
    type: "kline",
    data: { token: normalizedToken, ...kline },
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
  counterparty: Address,
  orderId: string
): void {
  const normalizedTrader = trader.toLowerCase() as Address;
  const normalizedToken = token.toLowerCase() as Address;
  const now = Date.now();

  // 调试：打印输入参数
  console.log(`[Position] Input: size=${size}, entryPrice=${entryPrice}, leverage=${leverage}`);

  // 计算保证金 (参考 GMX/Binance)
  // 精度说明:
  //   - size: 1e18 精度 (ETH 名义价值)
  //   - entryPrice: 1e18 精度 (ETH/token 价格，来自 Bonding Curve)
  //   - leverage: 1e4 精度 (10x = 100000)
  //   - collateral 输出: 1e18 精度 (ETH)
  //
  // ⚠️ 重要：前端传的 size 已经是 ETH 名义价值 (1e18 精度)
  // 例如：0.2 ETH 仓位 → size = 200000000000000000 (0.2 * 1e18)
  const positionValue = size; // size 本身就是 ETH 名义价值 (1e18 精度)
  console.log(`[Position] positionValue (1e18 ETH) = ${positionValue} ($${Number(positionValue) / 1e18})`);

  // 保证金 = 仓位价值 / 杠杆倍数
  // 因为 leverage 是 1e4 精度, 所以: collateral = positionValue * 1e4 / leverage
  const collateral = (positionValue * 10000n) / leverage; // USD, 1e18 精度
  console.log(`[Position] collateral (1e18 ETH) = ${collateral}, in USD = $${Number(collateral) / 1e18}`)

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
  const openFee = (positionValue * feeRate) / 10000n; // USD, 1e18 精度

  // 盈亏平衡价格 = 开仓价 ± 手续费对应的价格变动
  const breakEvenPrice = isLong
    ? entryPrice + (entryPrice * feeRate) / 10000n
    : entryPrice - (entryPrice * feeRate) / 10000n;

  // 计算维持保证金 (使用动态 MMR)
  const maintenanceMargin = (positionValue * effectiveMmr) / 10000n; // USD, 1e18 精度

  console.log(`[Position] leverage=${Number(leverage)/10000}x, initialMarginRate=${Number(initialMarginRateBp)/100}%, effectiveMmr=${Number(effectiveMmr)/100}%`);

  // 初始未实现盈亏 = -开仓手续费 (刚开仓价格没变就是亏手续费)
  const initialPnL = -openFee;

  // 初始保证金率 = 维持保证金 / (保证金 + PnL)
  // 行业标准 (Binance): marginRatio = MM / Equity, 越大越危险
  const equity = collateral + initialPnL;
  const initialMarginRatio = equity > 0n
    ? (maintenanceMargin * 10000n) / equity
    : 10000n;

  console.log(`[Position] openFee: $${Number(openFee) / 1e18}, initialPnL: $${Number(initialPnL) / 1e18}`);
  console.log(`[Position] equity: $${Number(equity) / 1e18}, marginRatio: ${Number(initialMarginRatio) / 100}%`);

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
    roe: collateral > 0n ? ((initialPnL * 10000n) / collateral).toString() : "0", // ROE% = PnL / 保证金 * 100
    fundingFee: "0",

    // 止盈止损
    takeProfitPrice: null,
    stopLossPrice: null,

    // 关联订单
    orderId,
    orderIds: [orderId],

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
      orderIds: [...(existing.orderIds || []), orderId],
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

    // ✅ 广播仓位更新到前端
    broadcastPositionUpdate(normalizedTrader, normalizedToken);
  } else {
    // 新开仓位 - 使用 addPositionToUser 来同步保存到 Redis
    addPositionToUser(position);
    console.log(`[Position] ${isLong ? "Long" : "Short"} opened: ${trader.slice(0, 10)} size=${size} liq=${liquidationPrice}`);

    // ✅ 广播仓位更新到前端
    broadcastPositionUpdate(normalizedTrader, normalizedToken);
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

// ============================================================
// 签名验证已移至 utils/crypto.ts
// ============================================================

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
    // 对于市价单，使用当前价格计算并加 2% 缓冲（防止价格波动导致保证金不足）
    // ✅ 修复：size 现在是 ETH 名义价值，不再需要 price 计算保证金
    // 但仍需要 price 用于撮合和存储订单
    const orderBook = engine.getOrderBook(token as Address);
    let priceForCalc = priceBigInt > 0n ? priceBigInt : orderBook.getCurrentPrice();

    // 如果订单簿没有价格，尝试从现货价格获取
    if (priceForCalc === 0n) {
      try {
        const spotPrice = await engine.fetchSpotPrice(token as Address);
        if (spotPrice && spotPrice > 0n) {
          priceForCalc = spotPrice;
          console.log(`[API] Using spot price for margin calculation: ${spotPrice}`);
        }
      } catch (e) {
        console.warn("[API] Failed to fetch spot price:", e);
      }
    }

    if (priceForCalc === 0n) {
      return errorResponse("Cannot determine order price for margin calculation. No price data available.");
    }

    // ============================================================
    // 保证金存入 Settlement + 内部扣款 (加锁防竞争)
    // ============================================================
    //
    // 架构: 下单时必须把 margin+fee 存入 Settlement 合约 (链上托管)
    //   1. autoDepositIfNeeded: 从派生钱包 → Settlement (链上)
    //   2. deductOrderAmount: 内存记账 (防连续下单双花)
    // 如果链上存入失败 → 拒单，不进撮合引擎
    //
    // ★ 分布式锁: 防止同一用户并发下单导致双花
    //
    const { total: requiredAmount } = calculateOrderCost(sizeBigInt, priceForCalc, leverageBigInt);
    const normalizedTraderForLock = (trader as string).toLowerCase();

    // 生成临时订单ID (在锁外生成，确保时间戳唯一)
    const traderSuffix = (trader as string).slice(-2).toUpperCase();
    const now = new Date();
    const tempOrderId = `${traderSuffix}${now.getFullYear()}${(now.getMonth()+1).toString().padStart(2,"0")}${now.getDate().toString().padStart(2,"0")}${now.getHours().toString().padStart(2,"0")}${now.getMinutes().toString().padStart(2,"0")}${now.getSeconds().toString().padStart(2,"0")}TMP`;

    // 使用分布式锁保护 autoDeposit + deduct 原子操作
    // TTL 30秒 (足够完成链上交易)，失败重试3次
    let depositAndDeductResult: { success: boolean; error?: string };
    try {
      depositAndDeductResult = await withLock(
        `balance:${normalizedTraderForLock}`,
        30000,
        async () => {
          // 1. 链上存入保证金
          try {
            await autoDepositIfNeeded(trader as Address, requiredAmount);
          } catch (e: any) {
            console.error(`[API] Auto-deposit failed for ${(trader as string).slice(0, 10)}: ${e.message}`);
            return { success: false, error: `保证金存入失败: ${e.message}` };
          }

          // 2. 内部账本扣款
          const deductSuccess = await deductOrderAmount(
            trader as Address,
            tempOrderId,
            sizeBigInt,
            priceForCalc,
            leverageBigInt
          );

          if (!deductSuccess) {
            return { success: false, error: "余额不足，请确保派生钱包有足够的 ETH/WETH" };
          }

          return { success: true };
        },
        3,
        200
      );
    } catch (lockError: any) {
      console.error(`[API] Lock acquisition failed for ${(trader as string).slice(0, 10)}: ${lockError.message}`);
      return errorResponse("系统繁忙，请稍后重试");
    }

    if (!depositAndDeductResult.success) {
      return errorResponse(depositAndDeductResult.error || "保证金处理失败");
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

    // 市价单没有对手方时保持 PENDING 状态，加入订单簿，让用户在"当前委托"中看到
    // 用户可以自己决定是否撤销，撤销时会退还保证金

    // Update nonce - 基于提交的nonce更新
    if (nonceBigInt >= getUserNonce(trader)) {
      userNonces.set(trader.toLowerCase() as Address, nonceBigInt + 1n);
    }

    console.log(`[API] Order submitted: ${order.id} (${matches.length} matches, postOnly=${postOnly}, timeInForce=${tif})`);

    // ============================================================
    // 💾 保存订单到数据库 (Redis)
    // ============================================================
    try {
      // 生成交易对符号 (格式: TOKEN-ETH)
      const tokenSymbol = token.slice(0, 10).toUpperCase(); // 简化处理
      const symbol = `${tokenSymbol}-ETH`;

      // 映射 OrderType 枚举到字符串
      let orderTypeStr: "LIMIT" | "MARKET" | "STOP_LOSS" | "TAKE_PROFIT" | "TRAILING_STOP";
      switch (order.orderType) {
        case OrderType.MARKET:
          orderTypeStr = "MARKET";
          break;
        case OrderType.LIMIT:
          orderTypeStr = "LIMIT";
          break;
        default:
          orderTypeStr = "LIMIT";
      }

      // 映射 OrderStatus 枚举到数据库格式
      let statusStr: "PENDING" | "PARTIALLY_FILLED" | "FILLED" | "CANCELED" | "REJECTED" | "TRIGGERED";
      switch (order.status) {
        case OrderStatus.PENDING:
          statusStr = "PENDING";
          break;
        case OrderStatus.PARTIALLY_FILLED:
          statusStr = "PARTIALLY_FILLED";
          break;
        case OrderStatus.FILLED:
          statusStr = "FILLED";
          break;
        case OrderStatus.CANCELLED:
          statusStr = "CANCELED";
          break;
        default:
          statusStr = "PENDING";
      }

      await OrderRepo.create({
        id: order.id,
        userAddress: order.trader,
        symbol,
        token: order.token,
        orderType: orderTypeStr,
        side: order.isLong ? "LONG" : "SHORT",
        price: order.price.toString(),
        size: order.size.toString(),
        filledSize: order.filledSize.toString(),
        avgFillPrice: order.avgFillPrice.toString(),
        status: statusStr,
        reduceOnly: order.reduceOnly,
        postOnly: order.postOnly,
        triggerPrice: order.takeProfitPrice?.toString() || order.stopLossPrice?.toString() || null,
        leverage: Number(order.leverage) / 10000, // 转换回实际倍数 (如 50000 -> 5x)
        margin: order.margin.toString(),
        fee: order.fee.toString(),
        signature: order.signature,
        deadline: Number(order.deadline),
        nonce: order.nonce.toString(),
      });
      console.log(`[DB] ✅ Order saved to database: ${order.id}`);
    } catch (dbError) {
      console.error(`[DB] ❌ Failed to save order ${order.id}:`, dbError);
      // 不阻塞订单提交，继续执行
    }

    // Broadcast orderbook update via WebSocket
    broadcastOrderBook(token.toLowerCase() as Address);

    // 推送订单状态更新给交易者
    broadcastOrderUpdate(order);

    // ============================================================
    // 🔄 模式 2: 链下执行，仓位只存后端
    // - 不再实时上链结算
    // - 仓位存 Redis，定时快照上链 Merkle Root
    // - 提现时验证 Merkle 证明
    // ============================================================
    if (matches.length > 0) {
      // 从引擎中移除已匹配的订单
      engine.removePendingMatches(matches);

      // 记录匹配 (用于后续快照)
      for (const match of matches) {
        const matchId = `${match.longOrder.id}_${match.shortOrder.id}`;
        submittedMatches.set(matchId, match);
      }

      console.log(`[Match] ✅ ${matches.length} matches processed (off-chain mode)`);
    }

    // Broadcast trades via WebSocket and create positions (只有链上结算成功后才执行)
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

      // 创建/更新持仓记录 (关联订单号便于排查)
      createOrUpdatePosition(
        match.longOrder.trader,
        token as Address,
        true, // isLong
        match.matchSize,
        match.matchPrice,
        match.longOrder.leverage,
        match.shortOrder.trader,
        match.longOrder.id
      );
      createOrUpdatePosition(
        match.shortOrder.trader,
        token as Address,
        false, // isShort
        match.matchSize,
        match.matchPrice,
        match.shortOrder.leverage,
        match.longOrder.trader,
        match.shortOrder.id
      );

      // ============================================================
      // 成交后结算保证金 (从已扣除 → 已用保证金)
      // ============================================================
      // 结算多头订单的保证金 (按成交大小比例, 区分 Maker/Taker)
      // Maker/Taker 判定: 先进入订单簿的 = Maker
      const longIsMakerSettle = match.longOrder.createdAt < match.shortOrder.createdAt;
      settleOrderMargin(match.longOrder.trader, match.longOrder.id, match.matchSize, longIsMakerSettle);
      // 结算空头订单的保证金 (按成交大小比例)
      settleOrderMargin(match.shortOrder.trader, match.shortOrder.id, match.matchSize, !longIsMakerSettle);

      // ============================================================
      // P5: 处理推荐返佣 + Maker/Taker 差异费率
      // ============================================================
      // matchSize 已经是 ETH 名义价值 (1e18 精度)
      const tradeValue = match.matchSize;
      // Maker/Taker 判定: incoming order = Taker, 订单簿中的 = Maker
      // incoming order 就是当前提交的 order，另一方是订单簿中已有的
      const longIsMaker = match.longOrder.createdAt < match.shortOrder.createdAt;
      const TAKER_FEE_RATE = 5n; // 0.05%
      const MAKER_FEE_RATE = 2n; // 0.02%
      const longFeeRate = longIsMaker ? MAKER_FEE_RATE : TAKER_FEE_RATE;
      const shortFeeRate = longIsMaker ? TAKER_FEE_RATE : MAKER_FEE_RATE;
      const longFee = (tradeValue * longFeeRate) / 10000n;
      const shortFee = (tradeValue * shortFeeRate) / 10000n;

      // 处理多头交易者的返佣
      processTradeCommission(
        match.longOrder.trader,
        trade.id,
        longFee,
        tradeValue
      );

      // 处理空头交易者的返佣
      processTradeCommission(
        match.shortOrder.trader,
        trade.id,
        shortFee,
        tradeValue
      );

      // ============================================================
      // 保存用户成交记录 (双边: 多头 + 空头，含各自手续费)
      // ============================================================
      const pairId = `pair_${trade.id}`;
      const saveTradeRecord = (trader: Address, orderId: string, isLong: boolean, isMaker: boolean, fee: bigint) => {
        const record: TradeRecord = {
          id: `${trade.id}_${isLong ? "long" : "short"}`,
          orderId,
          pairId,
          token: token as string,
          trader: trader as string,
          isLong,
          isMaker,
          size: match.matchSize.toString(),
          price: match.matchPrice.toString(),
          fee: fee.toString(),
          realizedPnL: "0",
          timestamp: match.timestamp,
          type: "open",
        };
        // Save to in-memory map
        const normalizedTrader = trader.toLowerCase() as Address;
        const traderTrades = userTrades.get(normalizedTrader) || [];
        traderTrades.push(record);
        userTrades.set(normalizedTrader, traderTrades);
        // Save to Redis (fire-and-forget)
        TradeRepo.create({
          orderId: record.orderId,
          pairId: record.pairId,
          token: token.toLowerCase() as Address,
          trader: normalizedTrader,
          isLong: record.isLong,
          isMaker: record.isMaker,
          size: record.size,
          price: record.price,
          fee: record.fee,
          realizedPnL: record.realizedPnL,
          timestamp: record.timestamp,
          type: "open",
        }).catch(e => console.error(`[DB] Failed to save trade record:`, e));
      };
      saveTradeRecord(match.longOrder.trader, match.longOrder.id, true, longIsMaker, longFee);
      saveTradeRecord(match.shortOrder.trader, match.shortOrder.id, false, !longIsMaker, shortFee);
    }

    // ============================================================
    // 推送余额更新到前端 (下单扣款后实时通知)
    // ============================================================
    const normalizedTraderAddr = (trader as string).toLowerCase() as Address;
    await syncUserBalanceFromChain(normalizedTraderAddr);
    broadcastBalanceUpdate(normalizedTraderAddr);

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
  const normalizedTrader = trader.toLowerCase() as Address;

  // 从链上读取 nonce (source of truth)
  if (SETTLEMENT_ADDRESS) {
    try {
      const publicClient = createPublicClient({
        chain: baseSepolia,
        transport: http(RPC_URL),
      });
      const chainNonce = await publicClient.readContract({
        address: SETTLEMENT_ADDRESS,
        abi: [{ inputs: [{ name: "", type: "address" }], name: "nonces", outputs: [{ type: "uint256" }], stateMutability: "view", type: "function" }],
        functionName: "nonces",
        args: [normalizedTrader],
      }) as bigint;

      // 取链上 nonce 和内存 nonce 的较大值
      // (内存 nonce 可能因为刚提交的订单而更高，但链上还没确认)
      const memoryNonce = getUserNonce(normalizedTrader);
      const effectiveNonce = chainNonce > memoryNonce ? chainNonce : memoryNonce;

      // 同步内存
      if (effectiveNonce > memoryNonce) {
        userNonces.set(normalizedTrader, effectiveNonce);
      }

      return jsonResponse({ nonce: effectiveNonce.toString() });
    } catch (e) {
      console.warn(`[Nonce] Failed to read chain nonce for ${normalizedTrader}:`, e);
    }
  }

  // fallback: 内存 nonce
  const nonce = getUserNonce(normalizedTrader);
  return jsonResponse({ nonce: nonce.toString() });
}

async function handleGetOrderBook(token: string): Promise<Response> {
  const orderBook = engine.getOrderBook(token as Address);
  const depth = orderBook.getDepth(20);
  let currentPrice = orderBook.getCurrentPrice();

  // 如果订单簿没有价格，使用现货价格
  if (currentPrice === 0n) {
    try {
      const spotPrice = await engine.fetchSpotPrice(token as Address);
      if (spotPrice && spotPrice > 0n) {
        currentPrice = spotPrice;
      }
    } catch (e) {
      // 忽略错误，使用0
    }
  }

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

// ============================================================
// Authentication Handlers (P2)
// ============================================================

/**
 * Get nonce for wallet login
 * POST /api/v1/auth/nonce
 */
async function handleGetAuthNonce(req: Request): Promise<Response> {
  try {
    const body = await req.json();
    const { address } = body;

    if (!address || typeof address !== "string") {
      return jsonResponse({
        code: "1",
        msg: "Invalid request: address required",
      });
    }

    // Validate address format
    if (!/^0x[a-fA-F0-9]{40}$/.test(address)) {
      return jsonResponse({
        code: "1",
        msg: "Invalid address format",
      });
    }

    const { generateLoginNonce } = await import("./modules/auth");
    const { nonce, message } = await generateLoginNonce(address as Address);

    return jsonResponse({
      code: "0",
      msg: "success",
      data: { nonce, message },
    });
  } catch (error) {
    console.error("[Auth] Get nonce error:", error);
    return jsonResponse({
      code: "1",
      msg: error instanceof Error ? error.message : "Internal server error",
    });
  }
}

/**
 * Login with wallet signature
 * POST /api/v1/auth/login
 */
async function handleAuthLogin(req: Request): Promise<Response> {
  try {
    const body = await req.json();
    const { address, signature, nonce } = body;

    if (!address || !signature || !nonce) {
      return jsonResponse({
        code: "1",
        msg: "Invalid request: address, signature, and nonce required",
      });
    }

    // Validate address format
    if (!/^0x[a-fA-F0-9]{40}$/.test(address)) {
      return jsonResponse({
        code: "1",
        msg: "Invalid address format",
      });
    }

    // Validate signature format
    if (!/^0x[a-fA-F0-9]{130}$/.test(signature)) {
      return jsonResponse({
        code: "1",
        msg: "Invalid signature format",
      });
    }

    const { verifySignatureAndLogin } = await import("./modules/auth");
    const credentials = await verifySignatureAndLogin(
      address as Address,
      signature as Hex,
      nonce
    );

    if (!credentials) {
      return jsonResponse({
        code: "1",
        msg: "Authentication failed: invalid signature or expired nonce",
      });
    }

    return jsonResponse({
      code: "0",
      msg: "success",
      data: {
        apiKey: credentials.apiKey,
        apiSecret: credentials.apiSecret,
        address: credentials.address,
        expiresAt: credentials.expiresAt,
      },
    });
  } catch (error) {
    console.error("[Auth] Login error:", error);
    return jsonResponse({
      code: "1",
      msg: error instanceof Error ? error.message : "Internal server error",
    });
  }
}

// ============================================================
// Token Metadata Handlers (P2)
// ============================================================

/**
 * Save or update token metadata
 * POST /api/v1/token/metadata
 */
async function handleSaveTokenMetadata(req: Request): Promise<Response> {
  try {
    const body = await req.json();

    const { saveTokenMetadata } = await import("./modules/tokenMetadata");
    const metadata = await saveTokenMetadata(body);

    return jsonResponse({
      code: "0",
      msg: "success",
      data: metadata,
    });
  } catch (error) {
    console.error("[TokenMetadata] Save error:", error);
    return jsonResponse({
      code: "1",
      msg: error instanceof Error ? error.message : "Internal server error",
    });
  }
}

/**
 * Get token metadata by instId
 * GET /api/v1/token/metadata?instId={instId}
 */
async function handleGetTokenMetadata(instId: string): Promise<Response> {
  try {
    const { getTokenMetadata } = await import("./modules/tokenMetadata");
    const metadata = await getTokenMetadata(instId);

    if (!metadata) {
      return jsonResponse({
        code: "1",
        msg: "Token metadata not found",
      }, 404);
    }

    return jsonResponse({
      code: "0",
      msg: "success",
      data: metadata,
    });
  } catch (error) {
    console.error("[TokenMetadata] Get error:", error);
    return jsonResponse({
      code: "1",
      msg: error instanceof Error ? error.message : "Internal server error",
    });
  }
}

/**
 * Get all token metadata
 * GET /api/v1/token/metadata/all
 */
async function handleGetAllTokenMetadata(): Promise<Response> {
  try {
    const { getAllTokenMetadata } = await import("./modules/tokenMetadata");
    const metadata = await getAllTokenMetadata();

    return jsonResponse({
      code: "0",
      msg: "success",
      data: metadata,
    });
  } catch (error) {
    console.error("[TokenMetadata] Get all error:", error);
    return jsonResponse({
      code: "1",
      msg: error instanceof Error ? error.message : "Internal server error",
    });
  }
}

// ============================================================
// FOMO Events & Leaderboard Handlers
// ============================================================

/**
 * Get recent FOMO events
 * GET /api/fomo/events?limit={limit}
 */
async function handleGetFomoEvents(limit: number): Promise<Response> {
  try {
    const { getRecentFomoEvents } = await import("./modules/fomo");
    const events = getRecentFomoEvents(limit);

    // Convert bigint to string for JSON serialization
    const serializedEvents = events.map((event) => ({
      id: event.id,
      type: event.type,
      trader: event.trader,
      token: event.token,
      tokenSymbol: event.tokenSymbol,
      isLong: event.isLong,
      size: event.size.toString(),
      price: event.price.toString(),
      pnl: event.pnl?.toString(),
      leverage: event.leverage?.toString(),
      timestamp: event.timestamp,
      message: event.message,
    }));

    return jsonResponse({
      code: "0",
      msg: "success",
      data: serializedEvents,
    });
  } catch (error) {
    console.error("[FOMO] Get events error:", error);
    return jsonResponse({
      code: "1",
      msg: error instanceof Error ? error.message : "Internal server error",
    });
  }
}

/**
 * Get global leaderboard
 * GET /api/leaderboard/global?sortBy={pnl|volume|wins}&limit={limit}
 */
async function handleGetGlobalLeaderboard(
  sortBy: "pnl" | "volume" | "wins",
  limit: number
): Promise<Response> {
  try {
    const { getGlobalLeaderboard } = await import("./modules/fomo");
    const entries = getGlobalLeaderboard(sortBy, limit);

    // Convert bigint to string for JSON serialization
    const serializedEntries = entries.map((entry, index) => ({
      trader: entry.trader,
      displayName: entry.displayName || formatTraderAddress(entry.trader),
      totalPnL: entry.totalPnL.toString(),
      totalVolume: entry.totalVolume.toString(),
      tradeCount: entry.tradeCount,
      winRate: entry.winRate,
      biggestWin: entry.biggestWin.toString(),
      biggestLoss: entry.biggestLoss.toString(),
      rank: index + 1,
    }));

    return jsonResponse({
      code: "0",
      msg: "success",
      data: serializedEntries,
    });
  } catch (error) {
    console.error("[FOMO] Get global leaderboard error:", error);
    return jsonResponse({
      code: "1",
      msg: error instanceof Error ? error.message : "Internal server error",
    });
  }
}

/**
 * Get token-specific leaderboard
 * GET /api/leaderboard/token/{token}?sortBy={pnl|volume|wins}&limit={limit}
 */
async function handleGetTokenLeaderboard(
  token: Address,
  sortBy: "pnl" | "volume" | "wins",
  limit: number
): Promise<Response> {
  try {
    const { getTokenLeaderboard } = await import("./modules/fomo");
    const entries = getTokenLeaderboard(token, sortBy, limit);

    // Convert bigint to string for JSON serialization
    const serializedEntries = entries.map((entry, index) => ({
      trader: entry.trader,
      displayName: entry.displayName || formatTraderAddress(entry.trader),
      totalPnL: entry.totalPnL.toString(),
      totalVolume: entry.totalVolume.toString(),
      tradeCount: entry.tradeCount,
      winRate: entry.winRate,
      biggestWin: entry.biggestWin.toString(),
      biggestLoss: entry.biggestLoss.toString(),
      rank: index + 1,
    }));

    return jsonResponse({
      code: "0",
      msg: "success",
      data: serializedEntries,
    });
  } catch (error) {
    console.error("[FOMO] Get token leaderboard error:", error);
    return jsonResponse({
      code: "1",
      msg: error instanceof Error ? error.message : "Internal server error",
    });
  }
}

/**
 * Get trader statistics
 * GET /api/trader/{trader}/stats
 */
async function handleGetTraderStats(trader: Address): Promise<Response> {
  try {
    const { getTraderStats } = await import("./modules/fomo");
    const stats = getTraderStats(trader);

    if (!stats) {
      return jsonResponse({
        code: "1",
        msg: "Trader stats not found",
      }, 404);
    }

    // Convert bigint to string for JSON serialization
    const serializedStats = {
      trader: stats.trader,
      displayName: stats.displayName || formatTraderAddress(stats.trader),
      totalPnL: stats.totalPnL.toString(),
      totalVolume: stats.totalVolume.toString(),
      tradeCount: stats.tradeCount,
      winRate: stats.winRate,
      biggestWin: stats.biggestWin.toString(),
      biggestLoss: stats.biggestLoss.toString(),
    };

    return jsonResponse({
      code: "0",
      msg: "success",
      data: serializedStats,
    });
  } catch (error) {
    console.error("[FOMO] Get trader stats error:", error);
    return jsonResponse({
      code: "1",
      msg: error instanceof Error ? error.message : "Internal server error",
    });
  }
}

/**
 * Helper: Format trader address for display
 */
function formatTraderAddress(address: Address): string {
  return `${address.substring(0, 6)}...${address.substring(38)}`;
}

// ============================================================
// Relay Service Handlers (P2)
// ============================================================

/**
 * Get relay service status
 * GET /api/v1/relay/status
 */
async function handleGetRelayStatus(): Promise<Response> {
  try {
    const { getRelayerStatus } = await import("./modules/relay");
    const status = await getRelayerStatus();

    return jsonResponse({
      code: "0",
      msg: "success",
      data: status,
    });
  } catch (error) {
    console.error("[Relay] Get status error:", error);
    return jsonResponse({
      code: "1",
      msg: error instanceof Error ? error.message : "Internal server error",
    });
  }
}

/**
 * Get user's meta-tx nonce
 * GET /api/v1/relay/nonce/:address
 */
async function handleGetMetaTxNonce(user: Address): Promise<Response> {
  try {
    const { getMetaTxNonce } = await import("./modules/relay");
    const nonce = await getMetaTxNonce(user);

    return jsonResponse({
      code: "0",
      msg: "success",
      data: {
        user,
        nonce: nonce.toString(),
      },
    });
  } catch (error) {
    console.error("[Relay] Get nonce error:", error);
    return jsonResponse({
      code: "1",
      msg: error instanceof Error ? error.message : "Internal server error",
    });
  }
}

/**
 * Get user's Settlement balance (Relay API)
 * GET /api/v1/relay/balance/:address
 */
async function handleGetRelayUserBalance(user: Address): Promise<Response> {
  try {
    const { getUserBalance } = await import("./modules/relay");
    const balance = await getUserBalance(user);

    return jsonResponse({
      code: "0",
      msg: "success",
      data: {
        user,
        available: balance.available.toString(),
        reserved: balance.reserved.toString(),
      },
    });
  } catch (error) {
    console.error("[Relay] Get balance error:", error);
    return jsonResponse({
      code: "1",
      msg: error instanceof Error ? error.message : "Internal server error",
    });
  }
}

/**
 * Relay depositFor meta-transaction
 * POST /api/v1/relay/deposit
 */
async function handleRelayDeposit(req: Request): Promise<Response> {
  try {
    const body = await req.json();
    const { user, token, amount, deadline, signature } = body;

    if (!user || !token || !amount || !deadline || !signature) {
      return jsonResponse({
        code: "1",
        msg: "Missing required fields: user, token, amount, deadline, signature",
      });
    }

    const { relayDeposit } = await import("./modules/relay");
    const result = await relayDeposit({
      user: user as Address,
      token: token as Address,
      amount,
      deadline,
      signature: signature as Hex,
    });

    if (result.success) {
      return jsonResponse({
        code: "0",
        msg: "success",
        data: {
          txHash: result.txHash,
        },
      });
    } else {
      return jsonResponse({
        code: "1",
        msg: result.error || "Relay deposit failed",
      });
    }
  } catch (error) {
    console.error("[Relay] Deposit error:", error);
    return jsonResponse({
      code: "1",
      msg: error instanceof Error ? error.message : "Internal server error",
    });
  }
}

/**
 * Relay depositETHFor meta-transaction
 * POST /api/v1/relay/deposit-eth
 */
async function handleRelayDepositETH(req: Request): Promise<Response> {
  try {
    const body = await req.json();
    const { user, amount, deadline, signature } = body;

    if (!user || !amount || !deadline || !signature) {
      return jsonResponse({
        code: "1",
        msg: "Missing required fields: user, amount, deadline, signature",
      });
    }

    const { relayDepositETH } = await import("./modules/relay");
    const result = await relayDepositETH({
      user: user as Address,
      amount,
      deadline,
      signature: signature as Hex,
    });

    if (result.success) {
      return jsonResponse({
        code: "0",
        msg: "success",
        data: {
          txHash: result.txHash,
        },
      });
    } else {
      return jsonResponse({
        code: "1",
        msg: result.error || "Relay deposit ETH failed",
      });
    }
  } catch (error) {
    console.error("[Relay] Deposit ETH error:", error);
    return jsonResponse({
      code: "1",
      msg: error instanceof Error ? error.message : "Internal server error",
    });
  }
}

/**
 * Relay withdrawFor meta-transaction
 * POST /api/v1/relay/withdraw
 */
async function handleRelayWithdraw(req: Request): Promise<Response> {
  try {
    const body = await req.json();
    const { user, token, amount, deadline, signature } = body;

    if (!user || !token || !amount || !deadline || !signature) {
      return jsonResponse({
        code: "1",
        msg: "Missing required fields: user, token, amount, deadline, signature",
      });
    }

    const { relayWithdraw } = await import("./modules/relay");
    const result = await relayWithdraw({
      user: user as Address,
      token: token as Address,
      amount,
      deadline,
      signature: signature as Hex,
    });

    if (result.success) {
      return jsonResponse({
        code: "0",
        msg: "success",
        data: {
          txHash: result.txHash,
        },
      });
    } else {
      return jsonResponse({
        code: "1",
        msg: result.error || "Relay withdraw failed",
      });
    }
  } catch (error) {
    console.error("[Relay] Withdraw error:", error);
    return jsonResponse({
      code: "1",
      msg: error instanceof Error ? error.message : "Internal server error",
    });
  }
}

// ============================================================
// Market Data Handlers
// ============================================================

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
          volCcy24h += (trade.price * trade.size) / BigInt(1e18);
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
        instId: `${token}-ETH`,
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
  const normalizedTrader = trader.toLowerCase() as Address;
  const orders = engine.getUserOrders(trader as Address);

  // Map engine orders to response format
  const orderList = orders.map((o) => ({
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
    feeCurrency: o.feeCurrency || "ETH",

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
  }));

  // Append liquidation/close events as synthetic orders in order history
  const trades = userTrades.get(normalizedTrader) || [];
  for (const t of trades) {
    if (t.type === "liquidation" || t.type === "adl" || t.type === "close") {
      orderList.push({
        id: t.id,
        clientOrderId: null,
        token: t.token as Address,
        isLong: t.isLong,
        size: t.size,
        leverage: "0",
        price: t.price,
        orderType: "MARKET",
        timeInForce: "GTC",
        reduceOnly: true,
        status: t.type === "liquidation" ? "LIQUIDATED" : t.type === "adl" ? "ADL" : "CLOSED",
        filledSize: t.size,
        avgFillPrice: t.price,
        totalFillValue: "0",
        fee: t.fee,
        feeCurrency: "ETH",
        margin: "0",
        collateral: "0",
        takeProfitPrice: null,
        stopLossPrice: null,
        createdAt: t.timestamp,
        updatedAt: t.timestamp,
        lastFillTime: t.timestamp,
        source: "API",
        lastFillPrice: t.price,
        lastFillSize: t.size,
        tradeId: t.id,
      });
    }
  }

  // Sort by time descending (most recent first)
  orderList.sort((a, b) => b.updatedAt - a.updatedAt);

  return jsonResponse(orderList);
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

    // ★ 分布式锁: 防止撤单与成交竞争 (使用订单锁而非用户锁)
    const normalizedTrader = (trader as string).toLowerCase();
    let cancelResult: { success: boolean; refundTotal: bigint };
    try {
      cancelResult = await withLock(
        `order:${orderId}`,
        5000,
        async () => {
          // 在锁内重新检查订单状态
          const currentOrder = engine.getOrder(orderId);
          if (!currentOrder || currentOrder.status === OrderStatus.CANCELLED || currentOrder.status === OrderStatus.FILLED) {
            return { success: false, refundTotal: 0n };
          }

          // TODO: Verify cancel signature
          const success = engine.cancelOrder(orderId, trader as Address);
          if (!success) {
            return { success: false, refundTotal: 0n };
          }

          // 退款
          const refundTotal = refundOrderAmount(trader as Address, orderId);
          return { success: true, refundTotal };
        },
        3,
        100
      );
    } catch (lockError: any) {
      console.error(`[API] Cancel lock failed for ${orderId}: ${lockError.message}`);
      return errorResponse("系统繁忙，请稍后重试");
    }

    if (!cancelResult.success) {
      return errorResponse("Order not found or cannot be cancelled");
    }

    const refundTotal = cancelResult.refundTotal;

    console.log(`[API] Order cancelled: ${orderId}, refund: $${Number(refundTotal) / 1e18}`);

    // 广播订单簿更新
    broadcastOrderBook(order.token.toLowerCase() as Address);

    // 推送订单状态更新 (设置状态为已取消)
    order.status = OrderStatus.CANCELLED;
    order.updatedAt = Date.now();
    broadcastOrderUpdate(order);

    // 持久化取消状态到 Redis（重启后不会复活已取消的订单）
    OrderRepo.update(orderId, { status: OrderStatus.CANCELLED } as any)
      .catch(e => console.error(`[CancelOrder] Failed to update Redis status for ${orderId}:`, e));

    // 链上退款: 从 Settlement 提取保证金回派生钱包（异步，不阻塞响应）
    if (refundTotal > 0n) {
      withdrawFromSettlement(trader as Address, refundTotal)
        .then(() => syncUserBalanceFromChain(trader as Address))
        .then(() => broadcastBalanceUpdate(trader as Address))
        .catch((e) => console.error(`[CancelOrder] Post-cancel settlement withdraw error:`, e));
    }

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
 * 获取用户交易历史 (强平、ADL、平仓等)
 * GET /api/user/:trader/trades
 */
async function handleGetUserTradesHistory(trader: string, limit: number = 100): Promise<Response> {
  const normalizedTrader = trader.toLowerCase() as Address;

  // Try in-memory first, then fall back to Redis
  let trades: TradeRecord[] = userTrades.get(normalizedTrader) || [];

  if (trades.length === 0) {
    try {
      const redisTrades = await TradeRepo.getByUser(normalizedTrader, limit);
      if (redisTrades.length > 0) {
        // Map PerpTrade → TradeRecord format
        trades = redisTrades.map(t => ({
          id: t.id,
          orderId: t.orderId,
          pairId: t.pairId,
          token: t.token as string,
          trader: t.trader as string,
          isLong: t.isLong,
          isMaker: t.isMaker,
          size: t.size,
          price: t.price,
          fee: t.fee,
          realizedPnL: t.realizedPnL,
          timestamp: t.timestamp,
          type: t.type as TradeRecord["type"],
        }));
      }
    } catch (e) {
      console.error("[API] Failed to read trades from Redis:", e);
    }
  }

  // 按时间倒序，最新的在前
  const sortedTrades = [...trades].sort((a, b) => b.timestamp - a.timestamp);
  const limitedTrades = sortedTrades.slice(0, limit);

  return jsonResponse({
    success: true,
    trades: limitedTrades,
    total: trades.length,
  });
}

/**
 * 获取用户余额 (Mode 2: 链上资金托管 + 后端仓位)
 * GET /api/user/:trader/balance
 *
 * 数据来源：
 * - available: 从链上 Settlement 合约读取 (资金托管)
 * - usedMargin: 从后端内存计算 (仓位保证金)
 * - unrealizedPnL: 后端实时计算 (基于当前价格)
 *
 * ⚠️ Mode 2: Settlement.locked 已废弃，仓位保证金从后端内存计算
 */
async function handleGetUserBalance(trader: string): Promise<Response> {
  const normalizedTrader = trader.toLowerCase() as Address;

  // ========================================
  // 1. 从链上读取资金托管余额 (ETH 本位)
  // ========================================
  let chainAvailable = 0n;
  let walletEthBalance = 0n;

  const publicClient = createPublicClient({
    chain: baseSepolia,
    transport: http(RPC_URL),
  });

  // ⚠️ Settlement 合约内部使用 6 位精度 (STANDARD_DECIMALS=6)
  //    getUserBalance 返回 6 位精度值，需要转换为 18 位精度
  const SETTLEMENT_TO_ETH_FACTOR = 10n ** 12n;
  try {
    if (SETTLEMENT_ADDRESS) {
      const [available, _locked] = await publicClient.readContract({
        address: SETTLEMENT_ADDRESS,
        abi: SETTLEMENT_ABI,
        functionName: "getUserBalance",
        args: [normalizedTrader],
      }) as [bigint, bigint];
      chainAvailable = available * SETTLEMENT_TO_ETH_FACTOR;
      // Mode 2: _locked 被忽略，链上不再追踪仓位
    }
  } catch (e) {
    console.error(`[Balance] Failed to fetch Settlement balance for ${normalizedTrader}:`, e);
  }

  // 读取原生 ETH 余额
  let nativeEthBalance = 0n;
  try {
    nativeEthBalance = await publicClient.getBalance({ address: normalizedTrader });
  } catch (e) {
    console.warn(`[Balance] Failed to fetch native ETH balance for ${normalizedTrader}:`, e);
  }

  // 读取 WETH 余额
  let wethBalance = 0n;
  try {
    const WETH_ADDRESS = process.env.WETH_ADDRESS as Address;
    if (WETH_ADDRESS) {
      wethBalance = await publicClient.readContract({
        address: WETH_ADDRESS,
        abi: ERC20_ABI,
        functionName: "balanceOf",
        args: [normalizedTrader],
      }) as bigint;
    }
  } catch (e) {
    console.warn(`[Balance] Failed to fetch wallet WETH balance for ${normalizedTrader}:`, e);
  }

  // 钱包 ETH 余额 = 原生 ETH + WETH
  walletEthBalance = nativeEthBalance + wethBalance;

  // ========================================
  // 2. 计算挂单锁定金额 (内存中的 orderMarginInfos)
  // ========================================
  let pendingOrdersLocked = 0n;
  const userOrders = engine.getUserOrders(normalizedTrader);
  for (const order of userOrders) {
    if (order.status === "PENDING" || order.status === "PARTIALLY_FILLED") {
      const marginInfo = orderMarginInfos.get(order.id);
      if (marginInfo) {
        const unfilledRatio = marginInfo.totalSize > 0n
          ? ((marginInfo.totalSize - marginInfo.settledSize) * 10000n) / marginInfo.totalSize
          : 10000n;
        pendingOrdersLocked += (marginInfo.totalDeducted * unfilledRatio) / 10000n;
      }
    }
  }

  // ========================================
  // 2.5 Mode 2: 从后端内存计算仓位保证金
  // ========================================
  const positions = userPositions.get(normalizedTrader) || [];
  let positionMargin = 0n;
  for (const pos of positions) {
    positionMargin += BigInt(pos.collateral || "0");
  }

  // ========================================
  // 2.6 Mode 2: 加入链下盈亏调整
  // ========================================
  // Mode 2 平仓盈亏不上链，需要从内存补充
  const mode2Adj = getMode2Adjustment(normalizedTrader);

  // 有效可用 = 链上 available + 链下盈亏调整 - 挂单锁定 - 仓位保证金
  // ⚠️ 安全: 不含 walletBalance，钱包里的钱必须存入 Settlement 才能交易
  // walletBalance 单独展示为"可存入金额"
  const effectiveAvailable = chainAvailable + mode2Adj;
  let availableBalance = effectiveAvailable - pendingOrdersLocked - positionMargin;
  if (availableBalance < 0n) availableBalance = 0n;
  let usedMargin = positionMargin;
  let totalBalance = effectiveAvailable + walletEthBalance + positionMargin;

  // ========================================
  // 3. 后端计算未实现盈亏 (基于实时价格)
  // ========================================
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
    // 分项余额 (ETH 本位)
    walletBalance: walletEthBalance.toString(),
    settlementAvailable: chainAvailable.toString(),
    settlementLocked: "0",  // Mode 2: 链上不再追踪仓位锁定
    positionMargin: positionMargin.toString(),  // Mode 2: 从后端内存计算
    pendingOrdersLocked: pendingOrdersLocked.toString(),
    // 后端计算数据
    unrealizedPnL: totalPnL.toString(),
    equity: equity.toString(),
    positionCount: positions.length,
    // 链上原始数据 (用于调试)
    chainData: {
      available: chainAvailable.toString(),
      locked: "0",  // Mode 2: 链上 locked 已废弃
      nativeEth: nativeEthBalance.toString(),
      weth: wethBalance.toString(),
      walletTotal: walletEthBalance.toString(),
      mode2Adjustment: mode2Adj.toString(),
      effectiveAvailable: effectiveAvailable.toString(),
    },
    // 数据来源标记
    source: chainAvailable > 0n || walletEthBalance > 0n ? "chain+backend" : "backend",
    mode: "mode2",  // 标记当前运行模式
    // 人类可读格式
    display: {
      totalBalance: `Ξ${(Number(totalBalance) / 1e18).toFixed(6)}`,
      availableBalance: `Ξ${(Number(availableBalance) / 1e18).toFixed(6)}`,
      walletBalance: `Ξ${(Number(walletEthBalance) / 1e18).toFixed(6)}`,
      settlementAvailable: `Ξ${(Number(chainAvailable) / 1e18).toFixed(6)}`,
      mode2Adjustment: `Ξ${(Number(mode2Adj) / 1e18).toFixed(6)}`,
      effectiveAvailable: `Ξ${(Number(effectiveAvailable) / 1e18).toFixed(6)}`,
      positionMargin: `Ξ${(Number(positionMargin) / 1e18).toFixed(6)}`,
      pendingOrdersLocked: `Ξ${(Number(pendingOrdersLocked) / 1e18).toFixed(6)}`,
      usedMargin: `Ξ${(Number(usedMargin) / 1e18).toFixed(6)}`,
      unrealizedPnL: `Ξ${(Number(totalPnL) / 1e18).toFixed(6)}`,
      equity: `Ξ${(Number(equity) / 1e18).toFixed(6)}`,
    }
  });
}

/**
 * 充值 (测试用)
 * POST /api/user/:trader/deposit
 * Body: { amount: "1000000000000000000" } // 1e18 精度, 1 ETH
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
      message: `Deposited $${Number(amountBigInt) / 1e18}`,
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
 * Body: { amount: "1000000000000000000" } // 1e18 精度, 1 ETH
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
      message: `Withdrew $${Number(amountBigInt) / 1e18}`,
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
    // sizeToClose 已经是 ETH 名义价值 (1e18 精度)
    const positionValue = sizeToClose;
    const closeFee = (positionValue * 5n) / 10000n;

    // 实际返还金额 = 释放保证金 + PnL - 手续费
    const returnAmount = releasedCollateral + closePnL - closeFee;

    console.log(`[Close] PnL=$${Number(closePnL) / 1e18} collateral=$${Number(releasedCollateral) / 1e18} fee=$${Number(closeFee) / 1e18} return=$${Number(returnAmount) / 1e18}`);

    if (isFullClose) {
      // ============================================================
      // 🔄 模式 2: 全部平仓 - 纯链下执行
      // - 不调用链上 closePair
      // - 直接更新后端余额 (returnAmount 加入 available)
      // - 用户后续可通过 Merkle 证明提取资金
      // ============================================================

      // 从用户仓位列表中移除
      const updatedPositions = positions.filter(p => p.pairId !== pairId);
      userPositions.set(normalizedTrader, updatedPositions);

      // 同步删除 Redis 中的仓位
      deletePositionFromRedis(pairId).catch((err) => {
        console.error("[Redis] Failed to delete closed position:", err);
      });

      // ✅ 模式 2: 平仓收益记入链下调整 (HTTP API 读取时会加上)
      // returnAmount = releasedCollateral + closePnL - closeFee
      // 链下调整 = closePnL - closeFee (保证金部分是从仓位释放，不属于链下增量)
      const pnlMinusFee = closePnL - closeFee;
      addMode2Adjustment(normalizedTrader, pnlMinusFee, "CLOSE_PNL");
      // ✅ 平仓手续费转入平台钱包
      if (closeFee > 0n) {
        addMode2Adjustment(FEE_RECEIVER_ADDRESS, closeFee, "PLATFORM_FEE");
        console.log(`[Fee] Close fee Ξ${Number(closeFee) / 1e18} → platform wallet`);
      }

      // 同步更新内存余额 (用于 WS 广播)
      if (returnAmount > 0n) {
        const balance = getUserBalance(normalizedTrader);
        balance.availableBalance += returnAmount;
        balance.totalBalance = balance.availableBalance + (balance.usedMargin || 0n);
        console.log(`[Close] Mode 2: Added Ξ${Number(returnAmount) / 1e18} to ${normalizedTrader.slice(0, 10)} available balance`);
      } else if (returnAmount < 0n) {
        // 亏损情况: 从 available 中扣除
        const balance = getUserBalance(normalizedTrader);
        const loss = -returnAmount;
        if (balance.availableBalance >= loss) {
          balance.availableBalance -= loss;
          balance.totalBalance = balance.availableBalance + (balance.usedMargin || 0n);
          console.log(`[Close] Mode 2: Deducted Ξ${Number(loss) / 1e18} loss from ${normalizedTrader.slice(0, 10)}`);
        }
      }

      // 广播余额更新
      broadcastBalanceUpdate(normalizedTrader);

      // 广播平仓事件
      broadcastPositionClosed(position, currentPrice, closePnL);
      // ✅ 修复：也发送 positions 消息触发前端刷新仓位列表
      broadcastPositionUpdate(normalizedTrader, token);

      // ✅ 记录平仓成交到 userTrades (用于成交记录 + 历史委托)
      const closeTrade: TradeRecord = {
        id: `close-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        orderId: `close-${pairId}`,
        pairId,
        token: position.token,
        trader: position.trader,
        isLong: position.isLong,
        isMaker: false,
        size: sizeToClose.toString(),
        price: currentPrice.toString(),
        fee: closeFee.toString(),
        realizedPnL: closePnL.toString(),
        timestamp: Date.now(),
        type: "close",
      };
      const traderTrades = userTrades.get(normalizedTrader) || [];
      traderTrades.push(closeTrade);
      userTrades.set(normalizedTrader, traderTrades);
      // 持久化到 Redis
      TradeRepo.create({
        orderId: closeTrade.orderId, pairId: closeTrade.pairId,
        token: token, trader: normalizedTrader,
        isLong: closeTrade.isLong, isMaker: false,
        size: closeTrade.size, price: closeTrade.price,
        fee: closeTrade.fee, realizedPnL: closeTrade.realizedPnL,
        timestamp: closeTrade.timestamp, type: "close",
      }).catch(e => console.error("[DB] Failed to save close trade:", e));

      // ✅ 记录 SETTLE_PNL 账单
      const balance = getUserBalance(normalizedTrader);
      try {
        await RedisSettlementLogRepo.create({
          userAddress: normalizedTrader,
          type: "SETTLE_PNL",
          amount: closePnL.toString(),
          balanceBefore: (balance.totalBalance - returnAmount).toString(),
          balanceAfter: balance.totalBalance.toString(),
          onChainStatus: "CONFIRMED",
          proofData: JSON.stringify({
            token: position.token, pairId, isLong: position.isLong,
            entryPrice: position.entryPrice, exitPrice: currentPrice.toString(),
            size: sizeToClose.toString(), closeFee: closeFee.toString(),
            closeType: "manual",
          }),
          positionId: pairId, orderId: closeTrade.orderId, txHash: null,
        });
      } catch (billErr) {
        console.error("[Close] Failed to log settle PnL bill:", billErr);
      }

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

      // ✅ 记录部分平仓成交到 userTrades
      const partialCloseTrade: TradeRecord = {
        id: `close-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        orderId: `close-${pairId}`,
        pairId,
        token: position.token,
        trader: position.trader,
        isLong: position.isLong,
        isMaker: false,
        size: sizeToClose.toString(),
        price: currentPrice.toString(),
        fee: closeFee.toString(),
        realizedPnL: closePnL.toString(),
        timestamp: Date.now(),
        type: "close",
      };
      const partialTrades = userTrades.get(normalizedTrader) || [];
      partialTrades.push(partialCloseTrade);
      userTrades.set(normalizedTrader, partialTrades);
      TradeRepo.create({
        orderId: partialCloseTrade.orderId, pairId: partialCloseTrade.pairId,
        token: token, trader: normalizedTrader,
        isLong: partialCloseTrade.isLong, isMaker: false,
        size: partialCloseTrade.size, price: partialCloseTrade.price,
        fee: partialCloseTrade.fee, realizedPnL: partialCloseTrade.realizedPnL,
        timestamp: partialCloseTrade.timestamp, type: "close",
      }).catch(e => console.error("[DB] Failed to save partial close trade:", e));

      // ✅ 记录部分平仓 SETTLE_PNL 账单
      try {
        const bal = getUserBalance(normalizedTrader);
        await RedisSettlementLogRepo.create({
          userAddress: normalizedTrader,
          type: "SETTLE_PNL",
          amount: closePnL.toString(),
          balanceBefore: "0", balanceAfter: "0",
          onChainStatus: "CONFIRMED",
          proofData: JSON.stringify({
            token: position.token, pairId, isLong: position.isLong,
            entryPrice: position.entryPrice, exitPrice: currentPrice.toString(),
            size: sizeToClose.toString(), closeFee: closeFee.toString(),
            closeType: "partial",
          }),
          positionId: pairId, orderId: partialCloseTrade.orderId, txHash: null,
        });
      } catch (billErr) {
        console.error("[Close] Failed to log partial settle PnL bill:", billErr);
      }

      // ✅ 模式 2: 部分平仓收益记入链下调整 + 更新内存余额
      const partialPnlMinusFee = closePnL - closeFee;
      addMode2Adjustment(normalizedTrader, partialPnlMinusFee, "PARTIAL_CLOSE_PNL");
      // ✅ 部分平仓手续费转入平台钱包
      if (closeFee > 0n) {
        addMode2Adjustment(FEE_RECEIVER_ADDRESS, closeFee, "PLATFORM_FEE");
        console.log(`[Fee] Partial close fee Ξ${Number(closeFee) / 1e18} → platform wallet`);
      }

      if (returnAmount > 0n) {
        const balance = getUserBalance(normalizedTrader);
        balance.availableBalance += returnAmount;
        balance.usedMargin -= releasedCollateral;
        if (balance.usedMargin < 0n) balance.usedMargin = 0n;
        balance.totalBalance = balance.availableBalance + (balance.usedMargin || 0n);
      } else if (returnAmount < 0n) {
        const balance = getUserBalance(normalizedTrader);
        const loss = -returnAmount;
        if (balance.availableBalance >= loss) {
          balance.availableBalance -= loss;
        }
        balance.usedMargin -= releasedCollateral;
        if (balance.usedMargin < 0n) balance.usedMargin = 0n;
        balance.totalBalance = balance.availableBalance + (balance.usedMargin || 0n);
      }
      broadcastBalanceUpdate(normalizedTrader);

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

    // ❌ Mode 2: 不再更新链上价格，永续交易使用后端价格
    // 现货交易价格由 TokenFactory AMM 自动计算
    console.log(`[API] Price updated in engine: ${token.slice(0, 10)} = ${priceBigInt}`);

    return jsonResponse({ success: true, price: priceBigInt.toString() });
  } catch (e) {
    return errorResponse(e instanceof Error ? e.message : "Unknown error", 500);
  }
}

/**
 * Get K-line (candlestick) data
 * 优先使用现货交易历史生成的 K 线（存储在 Redis），如果没有则回退到撮合引擎内存数据
 */
async function handleGetKlines(token: string, url: URL): Promise<Response> {
  const interval = url.searchParams.get("interval") || "1m";
  const limit = parseInt(url.searchParams.get("limit") || "100");

  // 首先尝试从 Redis 获取现货交易历史生成的 K 线
  try {
    const { handleGetLatestKlines } = await import("./api/handlers");
    const result = await handleGetLatestKlines(token as Address, interval, limit);
    if (result.success && result.data && result.data.length > 0) {
      // 格式化极小数字，避免科学计数法
      const formatSmallNumber = (val: string | number): string => {
        const num = typeof val === 'string' ? parseFloat(val) : val;
        if (num === 0) return "0";
        if (num < 1e-10) return num.toFixed(15);
        if (num < 1e-8) return num.toFixed(12);
        if (num < 1e-6) return num.toFixed(10);
        if (num < 1e-4) return num.toFixed(8);
        return num.toString();
      };

      return jsonResponse({
        klines: result.data.map((k: any) => ({
          timestamp: k.time * 1000, // 转换为毫秒
          open: formatSmallNumber(k.open),
          high: formatSmallNumber(k.high),
          low: formatSmallNumber(k.low),
          close: formatSmallNumber(k.close),
          volume: k.volume,
          trades: k.trades,
        })),
      });
    }
  } catch (e) {
    console.warn("[Server] Failed to get spot klines from Redis:", e);
  }

  // 回退到撮合引擎内存数据
  // ETH 本位: 撮合引擎存的是 ETH/Token 价格 (1e18 精度)
  const klines = engine.getKlines(token as Address, interval, limit);

  return jsonResponse({
    klines: klines.map(k => ({
      timestamp: k.timestamp * 1000, // 统一转为毫秒
      // ETH 本位: 直接输出 ETH 价格 (1e18 精度 → 小数)
      open: (Number(k.open) / 1e18).toString(),
      high: (Number(k.high) / 1e18).toString(),
      low: (Number(k.low) / 1e18).toString(),
      close: (Number(k.close) / 1e18).toString(),
      // 交易量: Token 数量 (1e18 精度 → 小数)
      volume: (Number(k.volume) / 1e18).toString(),
      trades: k.trades,
    })),
  });
}

/**
 * Get token statistics
 * 优先使用现货交易历史的 24h 统计（存储在 Redis），如果没有则回退到撮合引擎数据
 */
async function handleGetStats(token: string): Promise<Response> {
  const normalizedToken = token.toLowerCase() as Address;

  // ✅ 价格回退链: Redis现货统计 → 订单簿价格(由syncSpotPrices设置) → 撮合引擎
  const orderBook = engine.getOrderBook(normalizedToken);
  let markPrice = orderBook.getCurrentPrice();
  if (markPrice <= 0n) {
    markPrice = engine.getSpotPrice(normalizedToken);
  }

  // ✅ 计算真实未平仓合约 (from in-memory userPositions)
  const { longOI, shortOI } = calculateOpenInterest(normalizedToken);
  const totalOI = longOI + shortOI;

  // ✅ 使用动态资金费率
  const currentRate = currentFundingRates.get(normalizedToken) || 0n;
  const nextSettlement = nextFundingSettlement.get(normalizedToken) || (Date.now() + 5 * 60 * 1000);


  // 首先尝试从 Redis 获取现货交易的 24h 统计
  try {
    const { handleGetSpotPrice } = await import("./api/handlers");
    const spotResult = await handleGetSpotPrice(token as Address);
    if (spotResult.success && spotResult.data) {
      const data = spotResult.data;
      const changePercent = parseFloat(data.change24h || "0");
      // 使用 spot 价格，如果没有则使用订单簿价格
      const priceStr = data.price || (markPrice > 0n ? (Number(markPrice) / 1e18).toString() : "0");
      return jsonResponse({
        price: priceStr,
        priceChange24h: (changePercent * 100).toString(),
        priceChangePercent24h: changePercent.toFixed(2),
        high24h: data.high24h || "0",
        low24h: data.low24h || "0",
        volume24h: data.volume24h || "0",
        trades24h: data.trades24h || 0,
        openInterest: totalOI.toString(),
        longOI: longOI.toString(),
        shortOI: shortOI.toString(),
        fundingRate: currentRate.toString(),
        nextFundingTime: nextSettlement,
      });
    }
  } catch (e) {
    console.warn("[Server] Failed to get spot stats from Redis:", e);
  }

  // 回退到撮合引擎数据 + 订单簿价格
  const stats = engine.getStats(token as Address);
  const fallbackPrice = markPrice > 0n ? markPrice : stats.price;

  return jsonResponse({
    price: fallbackPrice.toString(),
    priceChange24h: stats.priceChange24h.toString(),
    high24h: stats.high24h.toString(),
    low24h: stats.low24h.toString(),
    volume24h: stats.volume24h.toString(),
    trades24h: stats.trades24h,
    openInterest: totalOI.toString(),
    longOI: longOI.toString(),
    shortOI: shortOI.toString(),
    fundingRate: currentRate.toString(),
    nextFundingTime: nextSettlement,
  });
}

/**
 * Get funding rate (使用动态资金费配置)
 */
async function handleGetFundingRate(token: string): Promise<Response> {
  const normalizedToken = token.toLowerCase() as Address;

  // 使用动态资金费率
  const currentRate = currentFundingRates.get(normalizedToken) || 0n;
  const nextSettlement = nextFundingSettlement.get(normalizedToken) || Date.now() + 5 * 60 * 1000;
  const config = getTokenFundingConfig(normalizedToken);
  const dynamicInterval = getDynamicFundingInterval(normalizedToken);

  return jsonResponse({
    rate: currentRate.toString(),
    nextFundingTime: nextSettlement,
    interval: `${Math.floor(dynamicInterval / 60000)}m`,  // 5m for 5 minutes
  });
}

// ============================================================
// 猎杀场 API
// ============================================================

/**
 * 计算清算价格 (ETH 本位 - Bybit 行业标准)
 * 多头: liqPrice = entryPrice * (1 - 1/leverage + MMR)
 * 空头: liqPrice = entryPrice * (1 + 1/leverage - MMR)
 *
 * ETH 本位:
 * - entryPrice: ETH/Token (1e18 精度)
 * - 返回值: ETH/Token (1e18 精度)
 * - leverage 是 1e4 精度 (10x = 100000)
 */
function calculateLiquidationPrice(
  entryPrice: bigint,   // ETH/Token (1e18 精度)
  leverage: bigint,     // 1e4 精度 (10x = 100000)
  isLong: boolean,
  mmr: bigint = 200n    // 基础 MMR，会根据杠杆动态调整
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
 * 计算穿仓价格 (Bankruptcy Price) - ETH 本位
 *
 * 穿仓价格 = 保证金完全亏损的价格 (MMR = 0)
 *
 * 多头: bankruptcyPrice = entryPrice * (1 - 1/leverage)
 * 空头: bankruptcyPrice = entryPrice * (1 + 1/leverage)
 *
 * ETH 本位: 所有价格都是 ETH/Token (1e18 精度)
 */
function calculateBankruptcyPrice(
  entryPrice: bigint,   // ETH/Token (1e18 精度)
  leverage: bigint,     // 1e4 精度
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
 * 计算未实现盈亏 (ETH 本位 - GMX 标准)
 * 公式: PnL = Size × (MarkPrice - EntryPrice) / EntryPrice × Direction
 *
 * ETH 本位说明:
 * - size: Token 数量 (1e18)
 * - entryPrice/currentPrice: ETH/Token (1e18)
 * - 返回值: ETH 盈亏 (1e18 精度)
 *
 * 计算步骤:
 * 1. priceDelta = |currentPrice - entryPrice|
 * 2. delta = size * priceDelta / entryPrice (ETH 盈亏)
 * 3. 多头价格上涨盈利，空头价格下跌盈利
 */
function calculateUnrealizedPnL(
  size: bigint,         // Token 数量 (1e18 精度)
  entryPrice: bigint,   // ETH/Token (1e18 精度)
  currentPrice: bigint, // ETH/Token (1e18 精度)
  isLong: boolean
): bigint {
  if (entryPrice <= 0n) return 0n;

  // GMX 标准 PnL 计算
  const priceDelta = currentPrice > entryPrice
    ? currentPrice - entryPrice
    : entryPrice - currentPrice;

  // delta = size * priceDelta / entryPrice
  // 精度: (1e18 * 1e18) / 1e18 = 1e18 (ETH)
  const delta = (size * priceDelta) / entryPrice;

  const hasProfit = isLong
    ? currentPrice > entryPrice
    : entryPrice > currentPrice;

  return hasProfit ? delta : -delta;
}

/**
 * 计算保证金率 (ETH 本位 - Binance/OKX 标准)
 * 公式: 保证金率 = 维持保证金 / 账户权益
 *
 * 触发条件: 保证金率 >= 100% 时触发强平
 * 越小越安全，越大越危险
 *
 * ETH 本位精度:
 * - collateral: 1e18 (ETH)
 * - size: 1e18 (Token 数量)
 * - entryPrice/currentPrice: 1e18 (ETH/Token)
 * - 返回值: 1e4 精度 (10000 = 100%)
 */
function calculateMarginRatio(
  collateral: bigint,   // 1e18 精度 (ETH) - 初始保证金
  size: bigint,         // 1e18 精度 (Token 数量)
  entryPrice: bigint,   // 1e18 精度 (ETH/Token)
  currentPrice: bigint, // 1e18 精度 (ETH/Token)
  isLong: boolean,
  mmr: bigint = 50n     // 维持保证金率 0.5% (1e4 精度, 50 = 0.5%)
): bigint {
  if (size === 0n || currentPrice === 0n) return 0n; // 无仓位，0%风险

  // 计算仓位的 ETH 价值
  // positionValue = size * currentPrice / 1e18 (ETH)
  const positionValue = (size * currentPrice) / (10n ** 18n);
  if (positionValue === 0n) return 0n;

  // 计算维持保证金 = 仓位价值 * MMR
  // maintenanceMargin = positionValue * mmr / 10000 (ETH)
  const maintenanceMargin = (positionValue * mmr) / 10000n;

  // 计算未实现盈亏 (ETH 本位)
  const pnl = calculateUnrealizedPnL(size, entryPrice, currentPrice, isLong);

  // 账户权益 = 初始保证金 + 未实现盈亏 (ETH)
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
      balance: `$${(Number(insuranceFund.balance) / 1e18).toFixed(2)}`,
      totalContributions: `$${(Number(insuranceFund.totalContributions) / 1e18).toFixed(2)}`,
      totalPayouts: `$${(Number(insuranceFund.totalPayouts) / 1e18).toFixed(2)}`,
    },
    tokenFunds: Array.from(tokenInsuranceFunds.entries()).map(([token, fund]) => ({
      token,
      balance: fund.balance.toString(),
      display: `$${(Number(fund.balance) / 1e18).toFixed(2)}`,
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
      balance: `$${(Number(fund.balance) / 1e18).toFixed(2)}`,
      totalContributions: `$${(Number(fund.totalContributions) / 1e18).toFixed(2)}`,
      totalPayouts: `$${(Number(fund.totalPayouts) / 1e18).toFixed(2)}`,
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
        fundingAmount: `$${(Number(p.fundingAmount) / 1e18).toFixed(2)}`,
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
      executionPnL: order.executionPnL ? `$${(Number(order.executionPnL) / 1e18).toFixed(2)}` : null,
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
 * @param amount 追加金额 (1e18 ETH)
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
  // position.size 已经是 ETH 名义价值 (1e18 精度)
  const positionValue = BigInt(position.size);
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

  console.log(`[Margin] Added $${Number(amount) / 1e18} to ${pairId}. New collateral: $${Number(newCollateral) / 1e18}, leverage: ${newLeverage.toFixed(2)}x`);

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
 * @param amount 减少金额 (1e18 ETH)
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
  // position.size 已经是 ETH 名义价值 (1e18 精度)
  const positionValue = BigInt(position.size);
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
      reason: `Amount exceeds maximum removable. Max: $${Number(maxRemovable) / 1e18}`,
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

  console.log(`[Margin] Removed $${Number(amount) / 1e18} from ${pairId}. New collateral: $${Number(newCollateral) / 1e18}, leverage: ${newLeverage.toFixed(2)}x`);

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
  // position.size 已经是 ETH 名义价值 (1e18 精度)
  const positionValue = BigInt(position.size);
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
        totalEarnings: `$${(Number(referrer.totalEarnings) / 1e18).toFixed(2)}`,
        pendingEarnings: `$${(Number(referrer.pendingEarnings) / 1e18).toFixed(2)}`,
        withdrawnEarnings: `$${(Number(referrer.withdrawnEarnings) / 1e18).toFixed(2)}`,
        level1Earnings: `$${(Number(referrer.level1Earnings) / 1e18).toFixed(2)}`,
        level2Earnings: `$${(Number(referrer.level2Earnings) / 1e18).toFixed(2)}`,
        totalVolumeReferred: `$${(Number(referrer.totalVolumeReferred) / 1e18).toFixed(2)}`,
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
        totalFeesPaid: `$${(Number(referee.totalFeesPaid) / 1e18).toFixed(2)}`,
        totalCommissionGenerated: `$${(Number(referee.totalCommissionGenerated) / 1e18).toFixed(2)}`,
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
        tradeFee: `$${(Number(c.tradeFee) / 1e18).toFixed(4)}`,
        commissionAmount: `$${(Number(c.commissionAmount) / 1e18).toFixed(4)}`,
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
        withdrawnAmount: `$${(Number(result.withdrawnAmount || 0n) / 1e18).toFixed(2)}`,
        remainingPending: referrer ? `$${(Number(referrer.pendingEarnings) / 1e18).toFixed(2)}` : "$0.00",
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
        totalEarnings: `$${(Number(entry.totalEarnings) / 1e18).toFixed(2)}`,
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
      totalCommissionsPaid: `$${(Number(stats.totalCommissionsPaid) / 1e18).toFixed(2)}`,
      totalCommissionsPending: `$${(Number(stats.totalCommissionsPending) / 1e18).toFixed(2)}`,
      level1Rate: `${REFERRAL_CONFIG.level1Rate / 100}%`,
      level2Rate: `${REFERRAL_CONFIG.level2Rate / 100}%`,
      minWithdrawAmount: `$${Number(REFERRAL_CONFIG.minWithdrawAmount) / 1e18}`,
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
// [模式 2] Batch Submission Loop - DISABLED
// ============================================================
// 旧模式: 定期将未结算的 matches 批量提交到链上
// 新模式: 不提交到链上，matches 存 submittedMatches 用于 Merkle 快照

async function runBatchSubmissionLoop(): Promise<void> {
  console.log("[Batch] Mode 2: On-chain batch submission DISABLED");
  console.log("[Batch] Mode 2: Matches are tracked in memory for Merkle snapshots");
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

  // 查询毕业代币信息 (价格源切换状态)
  if (path === "/api/graduated-tokens" && method === "GET") {
    const result: Record<string, { pairAddress: string; priceSource: string }> = {};
    for (const [token, info] of graduatedTokens.entries()) {
      result[token] = {
        pairAddress: info.pairAddress,
        priceSource: "uniswap_v2",
      };
    }
    return jsonResponse({
      success: true,
      graduatedCount: graduatedTokens.size,
      totalTokens: SUPPORTED_TOKENS.length,
      tokens: result,
    });
  }

  // ============================================================
  // Mode 2 APIs (Merkle Snapshots + Withdrawal Authorization)
  // ============================================================

  // Get snapshot status
  if (path === "/api/v2/snapshot/status" && method === "GET") {
    const status = getSnapshotJobStatus();
    return jsonResponse({
      success: true,
      ...status,
    });
  }

  // Get Merkle proof for a user
  if (path === "/api/v2/snapshot/proof" && method === "GET") {
    const user = url.searchParams.get("user") as Address;
    if (!user) {
      return errorResponse("Missing user parameter");
    }
    const proof = getUserProof(user);
    if (!proof) {
      return errorResponse("No proof available for user");
    }
    return jsonResponse({
      success: true,
      proof: {
        user: proof.user,
        equity: proof.equity.toString(),
        merkleProof: proof.proof,
        leaf: proof.leaf,
        root: proof.root,
      },
    });
  }

  // Request withdrawal authorization
  if (path === "/api/v2/withdraw/request" && method === "POST") {
    try {
      const body = await req.json();
      const { user, amount } = body;
      if (!user || !amount) {
        return errorResponse("Missing user or amount");
      }
      const result = await requestWithdrawal(user as Address, BigInt(amount));
      if (!result.success) {
        return errorResponse(result.error || "Withdrawal request failed");
      }
      return jsonResponse({
        success: true,
        authorization: {
          user: result.authorization!.user,
          amount: result.authorization!.amount.toString(),
          nonce: result.authorization!.nonce.toString(),
          deadline: result.authorization!.deadline,
          merkleRoot: result.authorization!.merkleRoot,
          merkleProof: result.authorization!.merkleProof,
          signature: result.authorization!.signature,
        },
      });
    } catch (e) {
      return errorResponse(e instanceof Error ? e.message : "Unknown error");
    }
  }

  // Get withdraw module status
  if (path === "/api/v2/withdraw/status" && method === "GET") {
    const status = getWithdrawModuleStatus();
    return jsonResponse({
      success: true,
      ...status,
    });
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
        symbol: "TEST-ETH",
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

  // ============================================================
  // Authentication API (P2)
  // ============================================================

  // Get nonce for login
  if (path === "/api/v1/auth/nonce" && method === "POST") {
    return handleGetAuthNonce(req);
  }

  // Login with wallet signature
  if (path === "/api/v1/auth/login" && method === "POST") {
    return handleAuthLogin(req);
  }

  // ============================================================
  // Token Metadata API (P2)
  // ============================================================

  // Create or update token metadata
  if (path === "/api/v1/token/metadata" && method === "POST") {
    return handleSaveTokenMetadata(req);
  }

  // Get single token metadata
  if (path === "/api/v1/token/metadata" && method === "GET") {
    const instId = url.searchParams.get("instId");
    if (!instId) {
      return errorResponse("Missing instId parameter", 400);
    }
    return handleGetTokenMetadata(instId);
  }

  // Get all token metadata
  if (path === "/api/v1/token/metadata/all" && method === "GET") {
    return handleGetAllTokenMetadata();
  }

  // ============================================================
  // Token Holders API
  // ============================================================

  // Get token holders distribution
  if (path.startsWith("/api/v1/spot/holders/") && method === "GET") {
    const token = path.split("/").pop();
    if (!token || !token.startsWith("0x")) {
      return errorResponse("Invalid token address", 400);
    }
    const limit = parseInt(url.searchParams.get("limit") || "10");
    const includePnl = url.searchParams.get("includePnl") === "true";
    try {
      const result = await getTokenHolders(token as Address, limit, includePnl);
      return jsonResponse(result);
    } catch (error: any) {
      console.error("[Holders API] Error:", error);
      return jsonResponse({
        success: false,
        holders: [],
        total_holders: 0,
        top10_percentage: 0,
        concentration_risk: "LOW",
        error: error.message,
      });
    }
  }

  // ============================================================
  // FOMO Events & Leaderboard API (P2)
  // ============================================================

  // Get recent FOMO events
  if (path === "/api/fomo/events" && method === "GET") {
    const limit = parseInt(url.searchParams.get("limit") || "20");
    return handleGetFomoEvents(limit);
  }

  // Get global leaderboard
  if (path === "/api/leaderboard/global" && method === "GET") {
    const sortBy = (url.searchParams.get("sortBy") || "pnl") as "pnl" | "volume" | "wins";
    const limit = parseInt(url.searchParams.get("limit") || "10");
    return handleGetGlobalLeaderboard(sortBy, limit);
  }

  // Get token-specific leaderboard
  if (path.match(/^\/api\/leaderboard\/token\/0x[a-fA-F0-9]+$/) && method === "GET") {
    const token = path.split("/")[4] as Address;
    const sortBy = (url.searchParams.get("sortBy") || "pnl") as "pnl" | "volume" | "wins";
    const limit = parseInt(url.searchParams.get("limit") || "10");
    return handleGetTokenLeaderboard(token, sortBy, limit);
  }

  // Get trader stats
  if (path.match(/^\/api\/trader\/0x[a-fA-F0-9]+\/stats$/) && method === "GET") {
    const trader = path.split("/")[3] as Address;
    return handleGetTraderStats(trader);
  }

  // ============================================================
  // Relay Service API (P2)
  // ============================================================

  // Get relay service status
  if (path === "/api/v1/relay/status" && method === "GET") {
    return handleGetRelayStatus();
  }

  // Get user's meta-tx nonce
  if (path.match(/^\/api\/v1\/relay\/nonce\/0x[a-fA-F0-9]+$/) && method === "GET") {
    const user = path.split("/")[5] as Address;
    return handleGetMetaTxNonce(user);
  }

  // Get user's Settlement balance (Relay API)
  if (path.match(/^\/api\/v1\/relay\/balance\/0x[a-fA-F0-9]+$/) && method === "GET") {
    const user = path.split("/")[5] as Address;
    return handleGetRelayUserBalance(user);
  }

  // Relay depositFor (ERC20 token)
  if (path === "/api/v1/relay/deposit" && method === "POST") {
    return handleRelayDeposit(req);
  }

  // Relay depositETHFor
  if (path === "/api/v1/relay/deposit-eth" && method === "POST") {
    return handleRelayDepositETH(req);
  }

  // Relay withdrawFor
  if (path === "/api/v1/relay/withdraw" && method === "POST") {
    return handleRelayWithdraw(req);
  }

  // Market data endpoints (OKX format)
  if (path === "/api/v1/market/tickers" && method === "GET") {
    return handleGetTickers();
  }

  if (path === "/api/v1/market/ticker" && method === "GET") {
    const instId = url.searchParams.get("instId");
    if (!instId) {
      return jsonResponse({ code: "1", msg: "instId required" }, 400);
    }
    return handleGetTicker(instId);
  }

  if (path === "/api/v1/market/trades" && method === "GET") {
    const instId = url.searchParams.get("instId");
    const limit = parseInt(url.searchParams.get("limit") || "100");
    if (!instId) {
      return jsonResponse({ code: "1", msg: "instId required" }, 400);
    }
    return handleGetMarketTrades(instId, limit);
  }

  // Order Book (OKX format) - /api/v1/market/books
  if (path === "/api/v1/market/books" && method === "GET") {
    const instId = url.searchParams.get("instId");
    if (!instId) {
      return jsonResponse({ code: "1", msg: "instId required" }, 400);
    }
    const token = instId.split("-")[0] as Address;
    return handleGetOrderBook(token);
  }

  // Mark Price (OKX format) - /api/v1/market/mark-price
  if (path === "/api/v1/market/mark-price" && method === "GET") {
    const instId = url.searchParams.get("instId");
    // 如果没有指定 instId，返回所有代币的标记价格
    const tokens = instId ? [instId.split("-")[0] as Address] : Array.from(engine.getOrderBooks().keys());
    const markPrices = tokens.map(token => {
      const ob = engine.getOrderBook(token);
      const depth = ob.getDepth(1);
      return {
        instId: `${token}-ETH`,
        markPx: depth.lastPrice.toString(),
        ts: Date.now(),
      };
    });
    return jsonResponse({ code: "0", msg: "success", data: markPrices });
  }

  // Funding Rate (OKX format) - /api/v1/market/funding-rate
  if (path === "/api/v1/market/funding-rate" && method === "GET") {
    const instId = url.searchParams.get("instId");
    if (!instId) {
      return jsonResponse({ code: "1", msg: "instId required" }, 400);
    }
    const token = instId.split("-")[0] as Address;
    return handleGetFundingRate(token);
  }

  // 前端充值/提现后同步链上余额
  if (path === "/api/balance/sync" && method === "POST") {
    try {
      const { trader } = await req.json();
      if (!trader) return errorResponse("Missing trader");
      const normalizedTrader = (trader as string).toLowerCase() as Address;
      await syncUserBalanceFromChain(normalizedTrader);
      broadcastBalanceUpdate(normalizedTrader);
      return jsonResponse({ success: true });
    } catch (e: any) {
      return errorResponse(e.message || "Failed to sync balance");
    }
  }

  // 后端辅助提现: 用 session key 签名 Settlement.withdraw + ERC20 transfer 回主钱包
  if (path === "/api/wallet/withdraw" && method === "POST") {
    try {
      const { tradingWallet, mainWallet, amount, token } = await req.json();
      if (!tradingWallet || !mainWallet || !amount) {
        return errorResponse("Missing required fields: tradingWallet, mainWallet, amount");
      }
      const normalizedTrader = (tradingWallet as string).toLowerCase() as Address;
      const tokenAddr = (token || process.env.WETH_ADDRESS) as Address;
      if (!tokenAddr) return errorResponse("Token address not configured");

      // 检查挂单锁定金额，确保不提取被挂单占用的资金
      let pendingOrdersLocked = 0n;
      const userOrders = engine.getUserOrders(normalizedTrader);
      for (const order of userOrders) {
        if (order.status === "PENDING" || order.status === "PARTIALLY_FILLED") {
          const marginInfo = orderMarginInfos.get(order.id);
          if (marginInfo) {
            const unfilledRatio = marginInfo.totalSize > 0n
              ? ((marginInfo.totalSize - marginInfo.settledSize) * 10000n) / marginInfo.totalSize
              : 10000n;
            pendingOrdersLocked += (marginInfo.totalDeducted * unfilledRatio) / 10000n;
          }
        }
      }

      const sessionId = await getActiveSessionForDerived(normalizedTrader);
      if (!sessionId) return errorResponse("No active session for this trading wallet");

      const signingKey = await getSigningKey(sessionId);
      if (!signingKey) return errorResponse("Signing key unavailable");

      const account = privateKeyToAccount(signingKey);
      const walletClient = createWalletClient({
        account,
        chain: baseSepolia,
        transport: http(RPC_URL),
      });
      const pubClient = createPublicClient({
        chain: baseSepolia,
        transport: http(RPC_URL),
      });

      const withdrawAmount = BigInt(amount);

      // 0. 获取链上钱包余额 + Settlement 可用余额，检查是否超出可提取上限 (ETH 本位)
      const walletEthBal = await pubClient.readContract({
        address: tokenAddr,
        abi: ERC20_ABI,
        functionName: "balanceOf",
        args: [normalizedTrader],
      }) as bigint;

      const [settlementAvailableCheck] = await pubClient.readContract({
        address: SETTLEMENT_ADDRESS!,
        abi: SETTLEMENT_ABI,
        functionName: "getUserBalance",
        args: [normalizedTrader],
      }) as [bigint, bigint];

      // 实际可提取 = 链上可用 + 链下盈亏调整 + 钱包余额 - 挂单锁定 - 仓位保证金
      // ⚠️ 注意：链下盈利无法直接从链上提取，需要先通过 Merkle 证明结算
      const mode2Adj = getMode2Adjustment(normalizedTrader);
      const posMargin = (userPositions.get(normalizedTrader) || []).reduce(
        (sum, p) => sum + BigInt(p.collateral || "0"), 0n
      );
      const maxWithdrawable = walletEthBal + settlementAvailableCheck + mode2Adj - pendingOrdersLocked - posMargin;
      if (withdrawAmount > maxWithdrawable) {
        return errorResponse(`提取金额超出可用余额。可提取: $${Number(maxWithdrawable > 0n ? maxWithdrawable : 0n) / 1e18}, 挂单锁定: $${Number(pendingOrdersLocked) / 1e18}`);
      }

      // 1. 从 Settlement 提取 (复用上面已读取的可用余额)
      const settlementAvailable = settlementAvailableCheck;

      let settlementWithdrawTx: string | null = null;
      if (settlementAvailable > 0n) {
        // 从 Settlement 提取 (取 min(可用余额, 请求金额))
        const settlementWithdrawAmount = settlementAvailable > withdrawAmount ? withdrawAmount : settlementAvailable;
        const swHash = await walletClient.writeContract({
          address: SETTLEMENT_ADDRESS!,
          abi: SETTLEMENT_ABI,
          functionName: "withdraw",
          args: [tokenAddr, settlementWithdrawAmount],
        });
        await pubClient.waitForTransactionReceipt({ hash: swHash });
        settlementWithdrawTx = swHash;
        console.log(`[Withdraw] ${normalizedTrader.slice(0, 10)} withdrew $${Number(settlementWithdrawAmount) / 1e18} from Settlement: ${swHash}`);
      }

      // 2. 从派生钱包 ERC20 转到主钱包
      const walletErc20Balance = await pubClient.readContract({
        address: tokenAddr,
        abi: ERC20_ABI,
        functionName: "balanceOf",
        args: [normalizedTrader],
      }) as bigint;

      const transferAmount = walletErc20Balance > withdrawAmount ? withdrawAmount : walletErc20Balance;
      let transferTx: string | null = null;
      if (transferAmount > 0n) {
        const tHash = await walletClient.writeContract({
          address: tokenAddr,
          abi: ERC20_ABI,
          functionName: "transfer",
          args: [mainWallet as Address, transferAmount],
        });
        await pubClient.waitForTransactionReceipt({ hash: tHash });
        transferTx = tHash;
        console.log(`[Withdraw] ${normalizedTrader.slice(0, 10)} transferred $${Number(transferAmount) / 1e18} to main wallet: ${tHash}`);
      }

      await syncUserBalanceFromChain(normalizedTrader);
      broadcastBalanceUpdate(normalizedTrader);
      return jsonResponse({ success: true, settlementWithdrawTx, transferTx, amount: transferAmount.toString() });
    } catch (e: any) {
      return errorResponse(e.message || "Withdraw failed");
    }
  }

  // 注册前端交易钱包 session (用于自动 approve+deposit)
  if (path === "/api/wallet/register-session" && method === "POST") {
    try {
      const body = await req.json();
      const { signature, expiresInSeconds } = body;
      if (!signature) {
        return errorResponse("Missing signature");
      }
      const result = await registerTradingSession(signature, expiresInSeconds || 86400);
      return jsonResponse({ success: true, data: result });
    } catch (e: any) {
      return errorResponse(e.message || "Failed to register session");
    }
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

  if (path.match(/^\/api\/user\/0x[a-fA-F0-9]+\/trades$/) && method === "GET") {
    const trader = path.split("/")[3];
    const limit = parseInt(url.searchParams.get("limit") || "100");
    return handleGetUserTradesHistory(trader, limit);
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
  // 借贷清算 API
  // ============================================================

  // 获取代币的活跃借贷
  if (path.match(/^\/api\/lending\/borrows\/0x[a-fA-F0-9]+$/) && method === "GET") {
    const token = path.split("/")[4] as Address;
    const borrows = getActiveBorrows(token);
    return new Response(JSON.stringify({
      ok: true,
      data: {
        token,
        borrows: borrows.map(b => ({
          borrower: b.borrower,
          amount: b.amount.toString(),
          trackedAt: b.trackedAt,
          lastChecked: b.lastChecked,
        })),
        count: borrows.length,
      },
    }), { headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" } });
  }

  // 获取借贷清算模块状态
  if (path === "/api/lending/metrics" && method === "GET") {
    const metrics = getLendingLiquidationMetrics();
    return new Response(JSON.stringify({
      ok: true,
      data: metrics,
    }), { headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" } });
  }

  // ============================================================
  // PerpVault API
  // ============================================================

  // 获取 PerpVault 池子状态
  if (path === "/api/vault/info" && method === "GET") {
    const stats = await getPerpVaultPoolStats();
    const metrics = getPerpVaultMetrics();
    return new Response(JSON.stringify({
      ok: true,
      data: {
        enabled: metrics.enabled,
        ...(stats ? {
          poolValue: stats.poolValue.toString(),
          sharePrice: stats.sharePrice.toString(),
          totalShares: stats.totalShares.toString(),
          totalOI: stats.totalOI.toString(),
          maxOI: stats.maxOI.toString(),
          utilization: stats.utilization.toString(),
          totalFeesCollected: stats.totalFeesCollected.toString(),
          totalProfitsPaid: stats.totalProfitsPaid.toString(),
          totalLossesReceived: stats.totalLossesReceived.toString(),
          totalLiquidationReceived: stats.totalLiquidationReceived.toString(),
        } : {}),
        metrics,
      },
    }), { headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" } });
  }

  // 获取 LP 信息
  if (path.match(/^\/api\/vault\/lp\/0x[a-fA-F0-9]+$/) && method === "GET") {
    const lpAddress = path.split("/")[4] as Address;
    const lpInfo = await getPerpVaultLPInfo(lpAddress);
    return new Response(JSON.stringify({
      ok: true,
      data: lpInfo ? {
        shares: lpInfo.shares.toString(),
        value: lpInfo.value.toString(),
        pendingWithdrawalShares: lpInfo.pendingWithdrawalShares.toString(),
        withdrawalRequestTime: lpInfo.withdrawalRequestTime.toString(),
        withdrawalExecuteAfter: lpInfo.withdrawalExecuteAfter.toString(),
        withdrawalEstimatedETH: lpInfo.withdrawalEstimatedETH.toString(),
      } : null,
    }), { headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" } });
  }

  // 获取代币 OI 信息
  if (path.match(/^\/api\/vault\/oi\/0x[a-fA-F0-9]+$/) && method === "GET") {
    const token = path.split("/")[4] as Address;
    const oi = await getPerpVaultTokenOI(token);
    return new Response(JSON.stringify({
      ok: true,
      data: {
        token,
        longOI: oi.longOI.toString(),
        shortOI: oi.shortOI.toString(),
        totalOI: (oi.longOI + oi.shortOI).toString(),
      },
    }), { headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" } });
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
  // 现货交易历史 & K 线 API
  // ============================================================

  // 获取现货交易历史
  if (path.match(/^\/api\/v1\/spot\/trades\/0x[a-fA-F0-9]+$/) && method === "GET") {
    const token = path.split("/")[5] as Address;
    const limit = parseInt(url.searchParams.get("limit") || "100");
    const before = url.searchParams.get("before") ? parseInt(url.searchParams.get("before")!) : undefined;
    const { handleGetSpotTrades } = await import("./api/handlers");
    const result = await handleGetSpotTrades(token, limit, before);
    return jsonResponse(result);
  }

  // 获取现货 K 线数据
  if (path.match(/^\/api\/v1\/spot\/klines\/0x[a-fA-F0-9]+$/) && method === "GET") {
    const token = path.split("/")[5] as Address;
    const resolution = url.searchParams.get("resolution") || "1m";
    const from = parseInt(url.searchParams.get("from") || "0");
    const to = parseInt(url.searchParams.get("to") || Math.floor(Date.now() / 1000).toString());
    const { handleGetKlines: handleGetSpotKlines } = await import("./api/handlers");
    const result = await handleGetSpotKlines(token, resolution, from, to);
    return jsonResponse(result);
  }

  // 获取最新 K 线数据 (简化接口)
  if (path.match(/^\/api\/v1\/spot\/klines\/latest\/0x[a-fA-F0-9]+$/) && method === "GET") {
    const token = path.split("/")[6] as Address;
    const resolution = url.searchParams.get("resolution") || "1m";
    const limit = parseInt(url.searchParams.get("limit") || "100");
    const { handleGetLatestKlines } = await import("./api/handlers");
    const result = await handleGetLatestKlines(token, resolution, limit);
    return jsonResponse(result);
  }

  // 获取现货价格和 24h 统计
  if (path.match(/^\/api\/v1\/spot\/price\/0x[a-fA-F0-9]+$/) && method === "GET") {
    const token = path.split("/")[5] as Address;
    const { handleGetSpotPrice } = await import("./api/handlers");
    const result = await handleGetSpotPrice(token);
    return jsonResponse(result);
  }

  // 回填历史交易数据 (管理员)
  if (path.match(/^\/api\/v1\/spot\/backfill\/0x[a-fA-F0-9]+$/) && method === "POST") {
    const token = path.split("/")[5] as Address;
    const body = await req.json().catch(() => ({}));
    const fromBlock = BigInt(body.fromBlock || 0);
    const toBlock = body.toBlock ? BigInt(body.toBlock) : undefined;

    try {
      const publicClient = createPublicClient({
        chain: baseSepolia,
        transport: http(RPC_URL),
      });
      const currentBlock = toBlock || await publicClient.getBlockNumber();
      const startBlock = fromBlock > 0n ? fromBlock : currentBlock - 50000n; // 默认回填最近 50000 个区块

      const { backfillHistoricalTrades } = await import("../spot/spotHistory");
      const count = await backfillHistoricalTrades(token, startBlock, currentBlock, currentEthPriceUsd);

      return jsonResponse({
        success: true,
        data: {
          token,
          fromBlock: startBlock.toString(),
          toBlock: currentBlock.toString(),
          tradesProcessed: count,
        },
      });
    } catch (e: any) {
      return jsonResponse({ success: false, error: e.message });
    }
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

  // ✅ 账单 API: GET /api/user/:trader/bills
  const billsMatch = path.match(/^\/api\/user\/(0x[a-fA-F0-9]+)\/bills$/);
  if (billsMatch && method === "GET") {
    const trader = billsMatch[1].toLowerCase() as Address;
    const type = url.searchParams.get("type") || undefined;
    const limit = parseInt(url.searchParams.get("limit") || "50");
    const before = url.searchParams.get("before") ? parseInt(url.searchParams.get("before")!) : undefined;

    try {
      const logs = await RedisSettlementLogRepo.getByUser(trader, limit);
      let filtered = logs;
      if (type) filtered = filtered.filter(l => l.type === type);
      if (before) filtered = filtered.filter(l => l.createdAt < before);

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
      return jsonResponse(serialized);
    } catch (e) {
      console.error("[Bills] Error fetching bills:", e);
      return jsonResponse([]);
    }
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

/**
 * 推送市场数据给订阅该代币的所有客户端
 * 前端期望格式: { type: "market_data", token: "0x...", data: { lastPrice, high24h, ... } }
 */
function broadcastMarketData(token: Address): void {
  if (!wss) return;

  const normalizedToken = token.toLowerCase() as Address;
  const orderBook = engine.getOrderBook(normalizedToken);
  const depth = orderBook.getDepth(20);
  const trades = engine.getRecentTrades(normalizedToken, 100);

  // ✅ 价格回退链: 永续成交价 → 现货价格 (TokenFactory AMM)
  // 当永续订单簿没有成交时，使用现货价格作为标记价格
  let currentPrice = orderBook.getCurrentPrice();
  if (currentPrice <= 0n) {
    currentPrice = engine.getSpotPrice(normalizedToken);
  }

  // 计算24小时统计
  const now = Date.now();
  const oneDayAgo = now - 24 * 60 * 60 * 1000;
  const trades24h = trades.filter(t => t.timestamp >= oneDayAgo);

  let high24h = currentPrice;
  let low24h = currentPrice;
  let volume24h = 0n;
  let open24h = currentPrice;

  if (trades24h.length > 0) {
    open24h = trades24h[trades24h.length - 1].price;
    for (const t of trades24h) {
      if (t.price > high24h) high24h = t.price;
      if (t.price < low24h) low24h = t.price;
      // 计算 ETH 成交量: size (1e18) * price (1e18) / 1e18 = ETH (1e18 精度)
      volume24h += (t.size * t.price) / (10n ** 18n);
    }
  }

  const priceChange = currentPrice - open24h;
  const priceChangePercent = open24h > 0n ? Number(priceChange * 10000n / open24h) / 100 : 0;

  // ✅ 计算真实未平仓合约 (Open Interest)
  const { longOI, shortOI } = calculateOpenInterest(normalizedToken);
  const totalOI = longOI + shortOI;

  // 构建市场数据 - 前端期望 token 在顶层
  const marketData = {
    lastPrice: currentPrice.toString(),
    markPrice: currentPrice.toString(),
    indexPrice: currentPrice.toString(),
    high24h: high24h.toString(),
    low24h: low24h.toString(),
    volume24h: volume24h.toString(),
    open24h: open24h.toString(),
    priceChange24h: priceChange.toString(),
    priceChangePercent24h: priceChangePercent.toFixed(2),
    trades24h: trades24h.length,
    openInterest: totalOI.toString(),
    longOI: longOI.toString(),
    shortOI: shortOI.toString(),
    timestamp: now,
  };

  const message = JSON.stringify({
    type: "market_data",
    token: normalizedToken,
    data: marketData,
    timestamp: now,
  });

  for (const [client, tokens] of wsClients) {
    if (client.readyState === WebSocket.OPEN && tokens.has(normalizedToken)) {
      client.send(message);
    }
  }
}

/**
 * 推送资金费率给订阅该代币的所有客户端
 * 前端期望格式: { type: "funding_rate", token: "0x...", rate: "...", nextFundingTime: ... }
 */
function broadcastFundingRateWS(token: Address): void {
  if (!wss) return;

  const normalizedToken = token.toLowerCase() as Address;

  // 从资金费率状态获取当前费率
  const rate = currentFundingRates.get(normalizedToken) || 0n;

  // ✅ 使用动态资金费引擎的实际下次结算时间
  // 而不是静态的5分钟周期，因为动态引擎会根据波动率调整周期
  const nextFundingTime = nextFundingSettlement.get(normalizedToken) || (Date.now() + 5 * 60 * 1000);
  const dynamicInterval = getDynamicFundingInterval(normalizedToken);
  const intervalLabel = dynamicInterval >= 60000 ? `${Math.round(dynamicInterval / 60000)}m` : `${Math.round(dynamicInterval / 1000)}s`;

  const message = JSON.stringify({
    type: "funding_rate",
    token: normalizedToken,
    rate: rate.toString(),
    nextFundingTime,
    interval: intervalLabel,
    timestamp: Date.now(),
  });

  for (const [client, tokens] of wsClients) {
    if (client.readyState === WebSocket.OPEN && tokens.has(normalizedToken)) {
      client.send(message);
    }
  }
}

// 市场数据推送间隔 (用于 setInterval)
let marketDataPushInterval: NodeJS.Timeout | null = null;

// 上一次推送的市场数据缓存 (用于变化检测，避免无变化时频繁推送导致前端抖动)
const lastBroadcastedMarketData = new Map<Address, string>();
const lastBroadcastedFundingRate = new Map<Address, string>();

/**
 * 启动市场数据定时推送
 *
 * 使用变化检测: 只有数据确实变化时才推送，避免前端因为频繁 re-render 导致 UI 抖动
 * - market_data: 每秒检查，但只有 lastPrice/OI/volume 等变化时才推送
 * - funding_rate: 每 10 秒推送一次 (与 DYNAMIC_FUNDING_CHECK_INTERVAL 同步)
 */
let fundingRatePushCounter = 0;

function startMarketDataPush(): void {
  if (marketDataPushInterval) return;

  console.log("[MarketData] Starting periodic market data push (1s check, change-detection)");

  marketDataPushInterval = setInterval(() => {
    // 获取所有被订阅的代币
    const subscribedTokens = new Set<Address>();
    for (const [, tokens] of wsClients) {
      for (const token of tokens) {
        subscribedTokens.add(token);
      }
    }

    fundingRatePushCounter++;

    for (const token of subscribedTokens) {
      // market_data: 只有数据变化时才推送
      broadcastMarketDataIfChanged(token);

      // funding_rate: 每 10 秒推送一次 (不需要每秒推送，费率变化很缓慢)
      if (fundingRatePushCounter % 10 === 0) {
        broadcastFundingRateWS(token);
      }
    }
  }, 1000);
}

/**
 * 只在市场数据变化时才广播 (避免前端无意义 re-render)
 */
function broadcastMarketDataIfChanged(token: Address): void {
  if (!wss) return;

  const normalizedToken = token.toLowerCase() as Address;
  const orderBook = engine.getOrderBook(normalizedToken);

  // 快速检查: 用 lastPrice + OI 组合作为变化指纹
  let currentPrice = orderBook.getCurrentPrice();
  if (currentPrice <= 0n) {
    currentPrice = engine.getSpotPrice(normalizedToken);
  }
  const { longOI, shortOI } = calculateOpenInterest(normalizedToken);
  const fingerprint = `${currentPrice}_${longOI}_${shortOI}`;

  const lastFingerprint = lastBroadcastedMarketData.get(normalizedToken);
  if (lastFingerprint === fingerprint) {
    return; // 数据未变化，跳过推送
  }
  lastBroadcastedMarketData.set(normalizedToken, fingerprint);

  // 数据有变化，执行完整推送
  broadcastMarketData(token);
}

/**
 * 推送订单更新给交易者
 */
function broadcastOrderUpdate(order: Order): void {
  if (!wss) return;

  const trader = order.trader.toLowerCase() as Address;
  const wsSet = wsTraderClients.get(trader);
  if (!wsSet || wsSet.size === 0) return;

  const message = JSON.stringify({
    type: "orders",
    order: {
      id: order.id,
      orderId: order.orderId,
      clientOrderId: order.clientOrderId,
      trader: order.trader,
      token: order.token,
      isLong: order.isLong,
      size: order.size.toString(),
      price: order.price.toString(),
      leverage: order.leverage.toString(),
      margin: order.margin.toString(),
      fee: order.fee.toString(),
      orderType: order.orderType,
      timeInForce: order.timeInForce,
      reduceOnly: order.reduceOnly,
      postOnly: order.postOnly,
      filledSize: order.filledSize.toString(),
      avgFillPrice: order.avgFillPrice.toString(),
      status: order.status,
      createdAt: order.createdAt,
      updatedAt: order.updatedAt,
    },
    timestamp: Date.now(),
  });

  for (const ws of wsSet) {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(message);
    }
  }
}

/**
 * 推送所有待处理订单给交易者
 */
function broadcastPendingOrders(trader: Address): void {
  if (!wss) return;

  const normalizedTrader = trader.toLowerCase() as Address;
  const wsSet = wsTraderClients.get(normalizedTrader);
  if (!wsSet || wsSet.size === 0) return;

  const orders = engine.getUserOrders(normalizedTrader);
  const pendingOrders = orders.filter(o =>
    o.status === OrderStatus.PENDING || o.status === OrderStatus.PARTIALLY_FILLED
  );

  const message = JSON.stringify({
    type: "orders",
    orders: pendingOrders.map(o => ({
      id: o.id,
      orderId: o.orderId,
      clientOrderId: o.clientOrderId,
      trader: o.trader,
      token: o.token,
      isLong: o.isLong,
      size: o.size.toString(),
      price: o.price.toString(),
      leverage: o.leverage.toString(),
      margin: o.margin.toString(),
      fee: o.fee.toString(),
      orderType: o.orderType,
      timeInForce: o.timeInForce,
      reduceOnly: o.reduceOnly,
      postOnly: o.postOnly,
      filledSize: o.filledSize.toString(),
      avgFillPrice: o.avgFillPrice.toString(),
      status: o.status,
      createdAt: o.createdAt,
      updatedAt: o.updatedAt,
    })),
    timestamp: Date.now(),
  });

  for (const ws of wsSet) {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(message);
    }
  }
}

function handleWSMessage(ws: WebSocket, message: string): void {
  // 处理 ping/pong 心跳
  if (message === "ping") {
    ws.send("pong");
    return;
  }

  try {
    const msg = JSON.parse(message) as WSMessage & { trader?: string; data?: any; request_id?: string };

    // ✅ 新增：处理带 request_id 的 subscribe 请求（新 API 格式）
    if (msg.type === "subscribe" && msg.data && Array.isArray(msg.data.topics)) {
      const tokens = wsClients.get(ws) || new Set();

      // 订阅所有 topics
      for (const topic of msg.data.topics) {
        // 提取 token 地址: "tickers:0x123" -> "0x123"
        const parts = topic.split(':');
        if (parts.length >= 2) {
          const token = parts[1].toLowerCase() as Address;
          tokens.add(token);
          console.log(`[WS] Client subscribed to topic: ${topic}`);
        }
      }

      wsClients.set(ws, tokens);

      // ✅ 发送确认响应（防止前端超时）
      if (msg.request_id) {
        ws.send(JSON.stringify({
          type: "subscribe",
          request_id: msg.request_id,
          data: { success: true, topics: msg.data.topics },
          timestamp: Date.now(),
        }));
      }
    }
    // ✅ 处理旧格式：subscribe with token field
    else if (msg.type === "subscribe" && msg.token) {
      const tokens = wsClients.get(ws) || new Set();
      tokens.add(msg.token.toLowerCase() as Address);
      wsClients.set(ws, tokens);

      // Send current orderbook immediately
      broadcastOrderBook(msg.token.toLowerCase() as Address);
      console.log(`[WS] Client subscribed to ${msg.token}`);

      // ✅ 发送确认响应
      if (msg.request_id) {
        ws.send(JSON.stringify({
          type: "subscribe",
          request_id: msg.request_id,
          data: { success: true, token: msg.token },
          timestamp: Date.now(),
        }));
      }
    }
    // ✅ 新增：处理 subscribe_token（直接格式）
    else if (msg.type === "subscribe_token" && msg.token) {
      const tokens = wsClients.get(ws) || new Set();
      tokens.add(msg.token.toLowerCase() as Address);
      wsClients.set(ws, tokens);
      console.log(`[WS] Client subscribed to token: ${msg.token}`);

      // 立即发送当前市场数据
      broadcastOrderBook(msg.token.toLowerCase() as Address);
    }
    // ✅ 新增：处理 unsubscribe 请求（新 API 格式）
    else if (msg.type === "unsubscribe" && msg.data && Array.isArray(msg.data.topics)) {
      const tokens = wsClients.get(ws);
      if (tokens) {
        for (const topic of msg.data.topics) {
          const parts = topic.split(':');
          if (parts.length >= 2) {
            const token = parts[1].toLowerCase() as Address;
            tokens.delete(token);
            console.log(`[WS] Client unsubscribed from topic: ${topic}`);
          }
        }
      }

      // ✅ 发送确认响应
      if (msg.request_id) {
        ws.send(JSON.stringify({
          type: "unsubscribe",
          request_id: msg.request_id,
          data: { success: true, topics: msg.data.topics },
          timestamp: Date.now(),
        }));
      }
    }
    // ✅ 处理旧格式：unsubscribe with token field
    else if (msg.type === "unsubscribe" && msg.token) {
      const tokens = wsClients.get(ws);
      if (tokens) {
        tokens.delete(msg.token.toLowerCase() as Address);
      }
      console.log(`[WS] Client unsubscribed from ${msg.token}`);

      // ✅ 发送确认响应
      if (msg.request_id) {
        ws.send(JSON.stringify({
          type: "unsubscribe",
          request_id: msg.request_id,
          data: { success: true, token: msg.token },
          timestamp: Date.now(),
        }));
      }
    }
    // ✅ 新增：处理 unsubscribe_token（直接格式）
    else if (msg.type === "unsubscribe_token" && msg.token) {
      const tokens = wsClients.get(ws);
      if (tokens) {
        tokens.delete(msg.token.toLowerCase() as Address);
      }
      console.log(`[WS] Client unsubscribed from token: ${msg.token}`);
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

      // 推送待处理订单
      broadcastPendingOrders(trader);

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
          balance: (Number(insuranceFund.balance) / 1e18).toFixed(2),
          totalContributions: (Number(insuranceFund.totalContributions) / 1e18).toFixed(2),
          totalPayouts: (Number(insuranceFund.totalPayouts) / 1e18).toFixed(2),
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
  // Also connect the new Redis module (used by spotHistory, balance, etc.)
  await connectNewRedis();
  if (redisConnected) {
    console.log("[Server] Redis connected successfully");

    // 从 Redis 加载已有仓位到内存 (兼容现有风控引擎)
    await loadPositionsFromRedis();

    // 从 Redis 恢复订单保证金记录 (重启后撤单退款依赖此数据)
    try {
      const savedMargins = await OrderMarginRepo.getAll();
      for (const [orderId, info] of savedMargins) {
        orderMarginInfos.set(orderId, {
          margin: info.margin,
          fee: info.fee,
          totalDeducted: info.totalDeducted,
          totalSize: info.totalSize,
          settledSize: info.settledSize,
        });
      }
      console.log(`[Server] Restored ${savedMargins.size} order margin records from Redis`);
    } catch (e) {
      console.error("[Server] Failed to restore order margin records:", e);
    }

    // 从 Redis 恢复 Mode 2 链下盈亏调整 (平仓盈亏、资金费等)
    try {
      const savedAdjustments = await Mode2AdjustmentRepo.getAll();
      for (const [user, adj] of savedAdjustments) {
        mode2PnLAdjustments.set(user.toLowerCase() as Address, adj);
      }
      console.log(`[Server] Restored ${savedAdjustments.size} Mode 2 PnL adjustments from Redis`);
    } catch (e) {
      console.error("[Server] Failed to restore Mode 2 adjustments:", e);
    }
  } else {
    console.warn("[Server] Redis connection failed, using in-memory storage only");
  }

  // ❌ Mode 2: submitter 已移除，不再提交仓位到链上
  // 链上只做资金托管，不做仓位结算
  console.log("[Server] Mode 2: On-chain position settlement DISABLED");

  // ============================================================
  // 初始化 Mode 2 模块 (Merkle 快照 + 提现签名)
  // ============================================================
  initializeSnapshotModule({
    getBalance: getUserBalance,
    getPositions: (trader: Address) => userPositions.get(trader.toLowerCase() as Address) || [],
    getAllTraders: () => Array.from(userBalances.keys()) as Address[],
  });
  console.log("[Server] Mode 2: Snapshot module initialized");

  // 提现模块需要签名私钥
  if (MATCHER_PRIVATE_KEY && SETTLEMENT_ADDRESS) {
    initializeWithdrawModule({
      signerPrivateKey: MATCHER_PRIVATE_KEY,
      contractAddress: SETTLEMENT_ADDRESS,
      chainId: 84532, // Base Sepolia
    });
    console.log("[Server] Mode 2: Withdraw module initialized");

    // 启动快照定时任务 (每小时生成 Merkle root)
    startSnapshotJob({
      intervalMs: 60 * 60 * 1000, // 1 hour
      submitToChain: false, // 暂时不提交到链上，等 SettlementV2 部署后启用
      pruneAfterHours: 24,
    });
    console.log("[Server] Mode 2: Snapshot job started (1 hour interval)");
  } else {
    console.warn("[Server] Mode 2: MATCHER_PRIVATE_KEY or SETTLEMENT_ADDRESS missing, withdraw module disabled");
  }

  // Initialize Relay Service (P2)
  const { logRelayStatus } = await import("./modules/relay");
  logRelayStatus();

  // ============================================================
  // 初始化借贷清算模块
  // ============================================================
  {
    const lendingPublicClient = createPublicClient({
      chain: baseSepolia,
      transport: http(RPC_URL),
    });

    let lendingWalletClient = null;
    if (MATCHER_PRIVATE_KEY) {
      const matcherAccount = privateKeyToAccount(MATCHER_PRIVATE_KEY);
      lendingWalletClient = createWalletClient({
        account: matcherAccount,
        chain: baseSepolia,
        transport: http(RPC_URL),
      });
    }

    initLendingLiquidation(
      lendingPublicClient,
      lendingWalletClient,
      LENDING_POOL_ADDRESS_LOCAL
    );
    console.log(`[Server] Lending liquidation module initialized (LendingPool: ${LENDING_POOL_ADDRESS_LOCAL})`);
  }

  // ============================================================
  // 初始化 PerpVault 模块 (GMX-style LP Pool)
  // ============================================================
  if (PERP_VAULT_ADDRESS_LOCAL) {
    const vaultPublicClient = createPublicClient({
      chain: baseSepolia,
      transport: http(RPC_URL),
    });

    let vaultWalletClient = null;
    if (MATCHER_PRIVATE_KEY) {
      const matcherAccount = privateKeyToAccount(MATCHER_PRIVATE_KEY);
      vaultWalletClient = createWalletClient({
        account: matcherAccount,
        chain: baseSepolia,
        transport: http(RPC_URL),
      });
    }

    initPerpVault(
      vaultPublicClient,
      vaultWalletClient,
      PERP_VAULT_ADDRESS_LOCAL
    );
    console.log(`[Server] PerpVault module initialized (PerpVault: ${PERP_VAULT_ADDRESS_LOCAL})`);
  } else {
    console.log("[Server] PerpVault: No PERP_VAULT_ADDRESS set, vault mode disabled");
  }

  // 配置价格数据源（TokenFactory 获取真实现货价格）
  engine.configurePriceSource(RPC_URL, TOKEN_FACTORY_ADDRESS, PRICE_FEED_ADDRESS);
  console.log(`[Server] TokenFactory: ${TOKEN_FACTORY_ADDRESS}`);
  console.log(`[Server] PriceFeed: ${PRICE_FEED_ADDRESS}`);

  // ❌ Mode 2: batch submission 已禁用
  // runBatchSubmissionLoop();

  // Start cleanup interval
  setInterval(() => {
    engine.cleanupExpired();
  }, 60000); // Clean up every minute

  // Start Redis data cleanup interval (daily)
  const runRedisCleanup = async () => {
    try {
      const ordersRemoved = await cleanupStaleOrders(7);
      const positionsRemoved = await cleanupClosedPositions(7);
      if (ordersRemoved > 0 || positionsRemoved > 0) {
        console.log(`[Redis Cleanup] Removed ${ordersRemoved} stale orders, ${positionsRemoved} closed positions`);
      }
    } catch (err) {
      console.error("[Redis Cleanup] Error:", err);
    }
  };
  // Run immediately on startup, then every 24 hours
  runRedisCleanup();
  setInterval(runRedisCleanup, 24 * 60 * 60 * 1000);

  // 定期从 TokenFactory / Uniswap V2 Pair 同步现货价格并更新 K 线
  // ✅ ETH 本位: 直接使用 Token/ETH 价格 (1e18 精度)，不做 USD 转换
  // ✅ 毕业代币: 自动从 Uniswap V2 Pair 读取真实市场价格
  const syncSpotPrices = async () => {
    const { updateKlineWithCurrentPrice } = await import("../spot/spotHistory");

    // 创建 publicClient 直接读取合约
    const publicClient = createPublicClient({
      chain: baseSepolia,
      transport: http(RPC_URL),
    });

    const LOCAL_TOKEN_FACTORY_ABI = [
      {
        inputs: [{ name: "token", type: "address" }],
        name: "getCurrentPrice",
        outputs: [{ type: "uint256" }],
        stateMutability: "view",
        type: "function",
      },
    ] as const;

    if (SUPPORTED_TOKENS.length === 0) {
      // 静默返回，等待代币列表加载
      return;
    }

    for (const token of SUPPORTED_TOKENS) {
      try {
        let spotPriceEthRaw: bigint | null = null;
        let priceSource = "bonding_curve";

        // 检查是否是毕业代币 → 从 Uniswap V2 Pair 读取价格
        const graduatedInfo = graduatedTokens.get(token.toLowerCase());
        if (graduatedInfo) {
          // ✅ 毕业代币: 从 Uniswap V2 Pair.getReserves() 读取真实价格
          try {
            const reserves = await publicClient.readContract({
              address: graduatedInfo.pairAddress,
              abi: UNISWAP_V2_PAIR_ABI,
              functionName: "getReserves",
            }) as [bigint, bigint, number];

            const [reserve0, reserve1] = reserves;

            if (reserve0 > 0n && reserve1 > 0n) {
              // 计算 Token/ETH 价格
              // 如果 WETH 是 token0: price = reserve0 / reserve1 (ETH per Token)
              // 如果 WETH 是 token1: price = reserve1 / reserve0 (ETH per Token)
              if (graduatedInfo.isWethToken0) {
                // WETH = token0, MemeToken = token1
                // price(ETH/Token) = reserve0 / reserve1
                // 转为 1e18 精度: price = reserve0 * 1e18 / reserve1
                spotPriceEthRaw = (reserve0 * (10n ** 18n)) / reserve1;
              } else {
                // MemeToken = token0, WETH = token1
                // price(ETH/Token) = reserve1 / reserve0
                spotPriceEthRaw = (reserve1 * (10n ** 18n)) / reserve0;
              }
              priceSource = "uniswap_v2";
            }
          } catch (pairErr: any) {
            console.warn(`[syncSpotPrices] Uniswap V2 Pair read failed for ${token.slice(0, 10)}:`, pairErr?.message?.slice(0, 80));
            // 回退到 TokenFactory (虽然可能是冻结价格，总比没有好)
          }
        }

        // 未毕业代币 或 Uniswap V2 读取失败 → 从 TokenFactory bonding curve 读取
        if (!spotPriceEthRaw) {
          spotPriceEthRaw = await publicClient.readContract({
            address: TOKEN_FACTORY_ADDRESS,
            abi: LOCAL_TOKEN_FACTORY_ABI,
            functionName: "getCurrentPrice",
            args: [token],
          });
          priceSource = "bonding_curve";
        }

        if (spotPriceEthRaw && spotPriceEthRaw > 0n) {
          // ETH 本位: 直接使用 Token/ETH 价格 (1e18 精度)
          const priceEth = Number(spotPriceEthRaw) / 1e18;

          // 更新 K 线 (ETH 本位，不需要 USD 转换)
          await updateKlineWithCurrentPrice(token, priceEth.toString(), priceEth.toString());

          // 更新波动率跟踪 (用于动态资金费计算，使用 ETH 价格)
          updateVolatility(token, priceEth);

          // ETH 本位: 同步现货价格到订单簿 (1e18 精度)
          engine.updatePrice(token, spotPriceEthRaw);
          engine.setSpotPrice(token, spotPriceEthRaw);

          // 广播订单簿更新到前端
          broadcastOrderBook(token);

          // 广播 K 线更新到前端
          try {
            const { KlineRepo } = await import("../spot/spotHistory");
            const now = Math.floor(Date.now() / 1000);
            const bucketTime = Math.floor(now / 60) * 60;
            const klines = await KlineRepo.get(token, "1m", bucketTime, bucketTime);
            if (klines.length > 0) {
              const kline = klines[0];
              broadcastKline(token, {
                timestamp: kline.time * 1000,
                open: kline.open,
                high: kline.high,
                low: kline.low,
                close: kline.close,
                volume: kline.volume,
              });
            }
          } catch (_klineErr) {
            // K线广播失败不影响主流程
          }

          const sourceTag = priceSource === "uniswap_v2" ? " [UniV2]" : "";
          console.log(`[syncSpotPrices] ${token.slice(0, 10)}: ${priceEth.toExponential(4)} ETH${sourceTag}`);
        }
      } catch (e: any) {
        // 只在首次或关键错误时输出日志
        const errMsg = e?.message || e?.shortMessage || String(e);
        if (!errMsg.includes("execution reverted")) {
          console.warn(`[syncSpotPrices] Error for ${token.slice(0, 10)}:`, errMsg.slice(0, 80));
        }
      }
    }
  };

  // 从 TokenFactory 同步支持的代币列表 (必须在 syncSpotPrices 之前)
  await syncSupportedTokens();

  // 初始同步 (在代币列表加载后)
  console.log("[Server] Starting initial spot price sync...");
  syncSpotPrices();

  // 从 Redis 加载待处理订单 (在代币列表同步后)
  await loadOrdersFromRedis();

  // ============================================================
  // 🧹 清理孤儿 orderMarginInfos (重启后 Redis 恢复的记录可能已过期)
  // ============================================================
  // orderMarginInfos 在 Redis 恢复时加载 (line ~9822)，但对应的订单可能已成交/取消
  // loadOrdersFromRedis 只恢复 PENDING/PARTIALLY_FILLED 订单到引擎
  // 对比: 如果 marginInfo 对应的 orderId 在引擎中不存在，说明是孤儿记录
  {
    let orphanCount = 0;
    const marginEntries = [...orderMarginInfos.entries()];
    for (const [orderId, _info] of marginEntries) {
      const engineOrder = engine.getOrder(orderId);
      if (!engineOrder || (engineOrder.status !== "PENDING" && engineOrder.status !== "PARTIALLY_FILLED")) {
        orderMarginInfos.delete(orderId);
        OrderMarginRepo.delete(orderId).catch(e =>
          console.error(`[Cleanup] Failed to delete orphaned margin from Redis: ${orderId}`, e)
        );
        orphanCount++;
      }
    }
    if (orphanCount > 0) {
      console.log(`[Server] Cleaned up ${orphanCount} orphaned orderMarginInfos (no matching active order in engine)`);
    } else {
      console.log(`[Server] No orphaned orderMarginInfos found (${marginEntries.length} records all valid)`);
    }
  }

  // ============================================================
  // 🛡️ 启动安全检查: 单边仓位检测 (防止无对手方的虚假盈利)
  // ============================================================
  // 永续合约是零和博弈: 多头盈利 = 空头亏损
  // 如果某个代币只有单边仓位 (没有对手方)，说明对手方已被强平但 ADL 未正确执行
  // 这种仓位的"盈利"是虚假的，系统中没有足够资金兑付
  // 处理: 以当前价格强制平仓，只返还保证金 (不支付虚假盈利)
  {
    const tokenPositionMap = new Map<string, { longs: Position[], shorts: Position[] }>();

    // 按 token 分组统计多空仓位
    for (const [, positions] of userPositions) {
      for (const pos of positions) {
        const tok = (pos.token || "").toLowerCase();
        if (!tok) continue;
        let group = tokenPositionMap.get(tok);
        if (!group) {
          group = { longs: [], shorts: [] };
          tokenPositionMap.set(tok, group);
        }
        if (pos.isLong) {
          group.longs.push(pos);
        } else {
          group.shorts.push(pos);
        }
      }
    }

    for (const [tok, group] of tokenPositionMap) {
      const hasLongs = group.longs.length > 0;
      const hasShorts = group.shorts.length > 0;

      if (hasLongs && !hasShorts) {
        // 只有多头，没有空头对手方
        console.log(`[SafetyCheck] Token ${tok.slice(0, 10)}: ${group.longs.length} LONG positions with NO SHORT counterparty`);
        for (const pos of group.longs) {
          const pnl = BigInt(pos.unrealizedPnL || "0");
          if (pnl > 0n) {
            console.log(`[SafetyCheck] ⚠️ Orphan profitable LONG: ${pos.trader.slice(0, 10)} pnl=Ξ${Number(pnl) / 1e18}, collateral=Ξ${Number(BigInt(pos.collateral)) / 1e18}`);
            console.log(`[SafetyCheck] Force-closing position ${pos.pairId} — returning collateral only, no profit payout`);

            // 从 userPositions 中移除
            const traderAddr = pos.trader.toLowerCase() as Address;
            const traderPositions = userPositions.get(traderAddr) || [];
            const filtered = traderPositions.filter(p => p.pairId !== pos.pairId);
            userPositions.set(traderAddr, filtered);

            // 退还保证金 (但不退盈利 — 因为没有对手方来支付)
            const collateral = BigInt(pos.collateral);
            adjustUserBalance(traderAddr, collateral, "ORPHAN_CLOSE_REFUND");
            // Mode 2 调整: 保证金退还 = 净零 (开仓扣了 collateral，现在退回)
            // 不需要 addMode2Adjustment，因为 adjustUserBalance 已经增加了 available

            // 从 Redis 删除仓位
            PositionRepo.delete(pos.pairId).catch(e =>
              console.error(`[SafetyCheck] Failed to delete position from Redis: ${e}`)
            );

            console.log(`[SafetyCheck] ✅ Force-closed orphan LONG, refunded Ξ${Number(collateral) / 1e18}`);
          }
        }
      } else if (hasShorts && !hasLongs) {
        // 只有空头，没有多头对手方
        console.log(`[SafetyCheck] Token ${tok.slice(0, 10)}: ${group.shorts.length} SHORT positions with NO LONG counterparty`);
        for (const pos of group.shorts) {
          const pnl = BigInt(pos.unrealizedPnL || "0");
          if (pnl > 0n) {
            console.log(`[SafetyCheck] ⚠️ Orphan profitable SHORT: ${pos.trader.slice(0, 10)} pnl=Ξ${Number(pnl) / 1e18}, collateral=Ξ${Number(BigInt(pos.collateral)) / 1e18}`);
            console.log(`[SafetyCheck] Force-closing position ${pos.pairId} — returning collateral only, no profit payout`);

            const traderAddr = pos.trader.toLowerCase() as Address;
            const traderPositions = userPositions.get(traderAddr) || [];
            const filtered = traderPositions.filter(p => p.pairId !== pos.pairId);
            userPositions.set(traderAddr, filtered);

            const collateral = BigInt(pos.collateral);
            adjustUserBalance(traderAddr, collateral, "ORPHAN_CLOSE_REFUND");

            PositionRepo.delete(pos.pairId).catch(e =>
              console.error(`[SafetyCheck] Failed to delete position from Redis: ${e}`)
            );

            console.log(`[SafetyCheck] ✅ Force-closed orphan SHORT, refunded Ξ${Number(collateral) / 1e18}`);
          }
        }
      }
    }
  }

  // ============================================================
  // 🔄 模式 2: 仓位存 Redis，不从链上同步
  // ============================================================
  // 启动时从 Redis 加载仓位 (而非从链上)
  console.log("[Server] Mode 2: Positions loaded from Redis, chain sync DISABLED");

  // 定时同步现货价格 (仍需要，供现货交易使用)
  setInterval(syncSpotPrices, SPOT_PRICE_SYNC_INTERVAL_MS);
  console.log(`[Server] Spot price sync interval: ${SPOT_PRICE_SYNC_INTERVAL_MS}ms`);

  // ========================================
  // 启动链上事件监听 (实时同步链上状态)
  // ========================================
  startEventWatching().catch((e) => {
    console.error("[Events] Failed to start event watching:", e);
  });

  // ========================================
  // 启动时回填现货交易数据 (异步，不阻塞启动)
  // 回填最近 50000 个区块 (~28 小时) 以捕获重启期间遗漏的交易
  // ========================================
  (async () => {
    try {
      const { createPublicClient, http } = await import("viem");
      const { baseSepolia } = await import("viem/chains");
      const backfillClient = createPublicClient({
        chain: baseSepolia,
        transport: http("https://base-sepolia-rpc.publicnode.com"),
      });
      const currentBlock = await backfillClient.getBlockNumber();
      const backfillFrom = currentBlock > 50000n ? currentBlock - 50000n : 0n;
      console.log(`[Startup] Backfilling spot trades from block ${backfillFrom} to ${currentBlock} for all supported tokens...`);
      const { backfillHistoricalTrades } = await import("../spot/spotHistory");
      for (const token of SUPPORTED_TOKENS) {
        try {
          const count = await backfillHistoricalTrades(token, backfillFrom, currentBlock, currentEthPriceUsd || 2500);
          if (count > 0) {
            console.log(`[Startup] Backfilled ${count} trades for ${token.slice(0, 10)}`);
          }
        } catch (e: any) {
          console.error(`[Startup] Backfill failed for ${token.slice(0, 10)}:`, e.message);
        }
      }
      console.log("[Startup] Spot trade backfill complete");
    } catch (e: any) {
      console.error("[Startup] Spot trade backfill failed:", e.message);
    }
  })();

  // ========================================
  // 启动 Event-Driven Risk Engine (Meme Perp 核心)
  // 架构: Hyperliquid-style 实时强平 + 1s 兜底检查
  // ========================================
  startRiskEngine();
  console.log(`[Server] Risk Engine started: Event-driven + ${RISK_ENGINE_INTERVAL_MS}ms safety-net`);

  // ========================================
  // 启动 Dynamic Funding Engine (P1)
  // ========================================
  startDynamicFundingEngine();
  console.log(`[Server] Dynamic Funding Engine started: ${DYNAMIC_FUNDING_CHECK_INTERVAL}ms check interval`);

  // 定期计算资金费率（基于现货价格锚定）
  // 注意：暂时禁用链上资金费率更新，避免 nonce 冲突影响订单结算
  setInterval(() => {
    for (const token of SUPPORTED_TOKENS) {
      const rate = engine.calculateFundingRate(token);
      // 资金费率仍在内存中计算，但不再推送到链上
      // 这样可以避免频繁的链上交易导致 nonce 不同步
      // TODO: 实现更好的 nonce 管理后再启用链上更新
    }
  }, FUNDING_RATE_INTERVAL_MS);
  console.log(`[Server] Funding rate interval: ${FUNDING_RATE_INTERVAL_MS}ms (on-chain update disabled)`);

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

      // 启动市场数据定时推送
      startMarketDataPush();
    });
  });
}

// Start if running directly
if (import.meta.main) {
  startServer();
}

export { startServer, engine };
