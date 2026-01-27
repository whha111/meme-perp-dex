/**
 * Redis 数据库层
 *
 * 架构: Escrow on-chain + Position off-chain
 * - 资金锁在链上 Settlement 合约
 * - 仓位/订单/余额镜像存在 Redis
 *
 * 4 张核心表:
 * 1. positions - 仓位风控表
 * 2. orders - 订单撮合表
 * 3. user_vaults - 链上资金镜像
 * 4. settlement_logs - 结算审计表
 *
 * Redis 高频缓存:
 * - trigger:long:{symbol} - 多头触发价 ZSet
 * - trigger:short:{symbol} - 空头触发价 ZSet
 * - market:{symbol}:funding_index - 全局资金费索引
 */

import Redis from "ioredis";
import { v4 as uuidv4 } from "uuid";
import type { Address } from "viem";

// ============================================================
// Configuration
// ============================================================

const REDIS_URL = process.env.REDIS_URL || "redis://localhost:6379";
const REDIS_KEY_PREFIX = "memeperp:";

// ============================================================
// Types - 4 Core Tables
// ============================================================

/**
 * 仓位表 (核心风控表)
 */
export interface Position {
  id: string;                    // UUID
  userAddress: Address;          // 用户派生钱包地址
  symbol: string;                // 交易对 (如 PEPE-USDT)
  side: "LONG" | "SHORT";        // 方向
  size: string;                  // 持仓数量 (string for precision)
  entryPrice: string;            // 开仓均价
  leverage: number;              // 杠杆倍数
  marginType: "CROSS" | "ISOLATED"; // 保证金类型
  initialMargin: string;         // 初始保证金
  maintMargin: string;           // 维持保证金
  fundingIndex: string;          // 开仓时的全局资金费索引
  isLiquidating: boolean;        // 是否正在清算
  createdAt: number;             // 创建时间
  updatedAt: number;             // 更新时间

  // 实时计算字段 (由 Risk Engine 更新)
  markPrice?: string;            // 标记价格
  unrealizedPnL?: string;        // 未实现盈亏
  marginRatio?: string;          // 保证金率
  liquidationPrice?: string;     // 强平价格
  riskLevel?: "low" | "medium" | "high" | "critical";
  adlScore?: string;             // ADL 评分
  adlRanking?: number;           // ADL 排名
}

/**
 * 订单表 (撮合引擎表)
 */
export interface Order {
  id: string;                    // 订单 ID
  userAddress: Address;          // 用户地址
  symbol: string;                // 交易对
  token: Address;                // 代币地址
  orderType: "LIMIT" | "MARKET" | "STOP_LOSS" | "TAKE_PROFIT" | "TRAILING_STOP";
  side: "LONG" | "SHORT";        // 方向
  price: string;                 // 委托价格
  size: string;                  // 委托数量
  filledSize: string;            // 已成交数量
  avgFillPrice: string;          // 成交均价
  status: "PENDING" | "PARTIALLY_FILLED" | "FILLED" | "CANCELED" | "REJECTED" | "TRIGGERED";
  reduceOnly: boolean;           // 是否只减仓
  postOnly: boolean;             // 是否只做 Maker
  triggerPrice: string | null;   // 条件单触发价
  leverage: number;              // 杠杆
  margin: string;                // 保证金
  fee: string;                   // 手续费
  signature: string;             // EIP-712 签名 (链上结算用)
  deadline: number;              // 签名过期时间
  nonce: string;                 // 用户 nonce
  createdAt: number;
  updatedAt: number;
}

/**
 * 用户金库表 (链上资金镜像)
 */
export interface UserVault {
  userAddress: Address;          // 用户派生钱包地址 (PK)
  availableBalance: string;      // 可用余额
  lockedMargin: string;          // 已锁定保证金
  pendingWithdraw: string;       // 提现冻结中
  lastSyncBlock: string;         // 最后同步区块高度
  lastSyncTime: number;          // 最后对账时间
}

/**
 * 结算流水表 (审计表)
 */
export interface SettlementLog {
  id: string;                    // 流水 ID
  txHash: string | null;         // 链上交易哈希
  userAddress: Address;          // 用户地址
  type: "DEPOSIT" | "WITHDRAW" | "SETTLE_PNL" | "FUNDING_FEE" | "LIQUIDATION" | "MARGIN_ADD" | "MARGIN_REMOVE";
  amount: string;                // 变动金额 (正/负)
  balanceBefore: string;         // 变动前余额
  balanceAfter: string;          // 变动后余额
  onChainStatus: "PENDING" | "SUCCESS" | "FAILED";
  proofData: string;             // JSON: PnL Proof / Funding Index 快照
  positionId?: string;           // 关联仓位 ID
  orderId?: string;              // 关联订单 ID
  createdAt: number;
}

/**
 * 市场统计 (全局资金费索引等)
 */
export interface MarketStats {
  symbol: string;
  fundingIndex: string;          // 全局资金费索引
  fundingRate: string;           // 当前资金费率
  lastFundingTime: number;       // 上次结算时间
  nextFundingTime: number;       // 下次结算时间
  longOpenInterest: string;      // 多头持仓量
  shortOpenInterest: string;     // 空头持仓量
  lastPrice: string;             // 最新价格
  markPrice: string;             // 标记价格
  indexPrice: string;            // 指数价格 (现货)
  updatedAt: number;
}

// ============================================================
// Redis Client
// ============================================================

let redis: Redis | null = null;
let isConnected = false;

export function getRedisClient(): Redis {
  if (!redis) {
    redis = new Redis(REDIS_URL, {
      keyPrefix: REDIS_KEY_PREFIX,
      retryDelayOnFailover: 100,
      maxRetriesPerRequest: 3,
      lazyConnect: true,
    });

    redis.on("connect", () => {
      console.log("[Redis] Connected to", REDIS_URL);
      isConnected = true;
    });

    redis.on("error", (err) => {
      console.error("[Redis] Connection error:", err.message);
      isConnected = false;
    });

    redis.on("close", () => {
      console.log("[Redis] Connection closed");
      isConnected = false;
    });
  }
  return redis;
}

export async function connectRedis(): Promise<boolean> {
  try {
    const client = getRedisClient();
    await client.connect();
    await client.ping();
    console.log("[Redis] Connection verified");
    return true;
  } catch (error) {
    console.error("[Redis] Failed to connect:", error);
    return false;
  }
}

export async function disconnectRedis(): Promise<void> {
  if (redis) {
    await redis.quit();
    redis = null;
    isConnected = false;
  }
}

export function isRedisConnected(): boolean {
  return isConnected;
}

// ============================================================
// Key Generators
// ============================================================

const Keys = {
  // Position keys
  position: (id: string) => `position:${id}`,
  userPositions: (user: Address) => `user:${user.toLowerCase()}:positions`,
  symbolPositions: (symbol: string) => `symbol:${symbol}:positions`,
  allPositions: () => "positions:all",

  // Order keys
  order: (id: string) => `order:${id}`,
  userOrders: (user: Address) => `user:${user.toLowerCase()}:orders`,
  symbolOrders: (symbol: string) => `symbol:${symbol}:orders`,
  pendingOrders: (symbol: string) => `symbol:${symbol}:orders:pending`,

  // User vault keys
  userVault: (user: Address) => `vault:${user.toLowerCase()}`,

  // Settlement log keys
  settlementLog: (id: string) => `settlement:${id}`,
  userSettlements: (user: Address) => `user:${user.toLowerCase()}:settlements`,

  // Market stats keys
  marketStats: (symbol: string) => `market:${symbol}:stats`,
  fundingIndex: (symbol: string) => `market:${symbol}:funding_index`,

  // Trigger price keys (for TP/SL/Liquidation)
  triggerLong: (symbol: string) => `trigger:long:${symbol}`,
  triggerShort: (symbol: string) => `trigger:short:${symbol}`,
  liquidationLong: (symbol: string) => `liquidation:long:${symbol}`,
  liquidationShort: (symbol: string) => `liquidation:short:${symbol}`,
};

// ============================================================
// Position Repository
// ============================================================

export const PositionRepo = {
  /**
   * 创建仓位
   */
  async create(data: Omit<Position, "id" | "createdAt" | "updatedAt">): Promise<Position> {
    const client = getRedisClient();
    const id = uuidv4();
    const now = Date.now();

    const position: Position = {
      ...data,
      id,
      createdAt: now,
      updatedAt: now,
    };

    const key = Keys.position(id);
    await client.hset(key, position as Record<string, any>);

    // Add to indexes
    await client.sadd(Keys.userPositions(data.userAddress), id);
    await client.sadd(Keys.symbolPositions(data.symbol), id);
    await client.sadd(Keys.allPositions(), id);

    // Add to liquidation trigger ZSet (score = liquidation price)
    if (position.liquidationPrice) {
      const liqPrice = parseFloat(position.liquidationPrice);
      const triggerKey = position.side === "LONG"
        ? Keys.liquidationLong(data.symbol)
        : Keys.liquidationShort(data.symbol);
      await client.zadd(triggerKey, liqPrice, id);
    }

    console.log(`[DB] Position created: ${id} ${data.symbol} ${data.side} ${data.size}`);
    return position;
  },

  /**
   * 获取仓位
   */
  async get(id: string): Promise<Position | null> {
    const client = getRedisClient();
    const data = await client.hgetall(Keys.position(id));
    if (!data || Object.keys(data).length === 0) return null;
    return deserializePosition(data);
  },

  /**
   * 更新仓位
   */
  async update(id: string, updates: Partial<Position>): Promise<Position | null> {
    const client = getRedisClient();
    const key = Keys.position(id);

    const exists = await client.exists(key);
    if (!exists) return null;

    updates.updatedAt = Date.now();
    await client.hset(key, updates as Record<string, any>);

    // Update liquidation trigger if price changed
    if (updates.liquidationPrice !== undefined) {
      const position = await this.get(id);
      if (position) {
        const liqPrice = parseFloat(updates.liquidationPrice);
        const triggerKey = position.side === "LONG"
          ? Keys.liquidationLong(position.symbol)
          : Keys.liquidationShort(position.symbol);
        await client.zadd(triggerKey, liqPrice, id);
      }
    }

    return this.get(id);
  },

  /**
   * 删除仓位 (平仓/爆仓后)
   */
  async delete(id: string): Promise<boolean> {
    const client = getRedisClient();
    const position = await this.get(id);
    if (!position) return false;

    // Remove from indexes
    await client.srem(Keys.userPositions(position.userAddress), id);
    await client.srem(Keys.symbolPositions(position.symbol), id);
    await client.srem(Keys.allPositions(), id);

    // Remove from liquidation triggers
    await client.zrem(Keys.liquidationLong(position.symbol), id);
    await client.zrem(Keys.liquidationShort(position.symbol), id);

    // Delete position data
    await client.del(Keys.position(id));

    console.log(`[DB] Position deleted: ${id}`);
    return true;
  },

  /**
   * 获取用户所有仓位
   */
  async getByUser(userAddress: Address): Promise<Position[]> {
    const client = getRedisClient();
    const ids = await client.smembers(Keys.userPositions(userAddress));
    if (ids.length === 0) return [];

    const positions = await Promise.all(ids.map(id => this.get(id)));
    return positions.filter((p): p is Position => p !== null);
  },

  /**
   * 获取交易对所有仓位
   */
  async getBySymbol(symbol: string): Promise<Position[]> {
    const client = getRedisClient();
    const ids = await client.smembers(Keys.symbolPositions(symbol));
    if (ids.length === 0) return [];

    const positions = await Promise.all(ids.map(id => this.get(id)));
    return positions.filter((p): p is Position => p !== null);
  },

  /**
   * 获取所有仓位 (风控引擎用)
   */
  async getAll(): Promise<Position[]> {
    const client = getRedisClient();
    const ids = await client.smembers(Keys.allPositions());
    if (ids.length === 0) return [];

    const positions = await Promise.all(ids.map(id => this.get(id)));
    return positions.filter((p): p is Position => p !== null);
  },

  /**
   * 获取需要强平的仓位 (按强平价格排序)
   */
  async getLiquidationCandidates(symbol: string, currentPrice: number): Promise<Position[]> {
    const client = getRedisClient();

    // 多头: 当前价 <= 强平价 时被强平 (获取强平价 >= 当前价的)
    const longIds = await client.zrangebyscore(
      Keys.liquidationLong(symbol),
      currentPrice,
      "+inf"
    );

    // 空头: 当前价 >= 强平价 时被强平 (获取强平价 <= 当前价的)
    const shortIds = await client.zrangebyscore(
      Keys.liquidationShort(symbol),
      "-inf",
      currentPrice
    );

    const allIds = [...longIds, ...shortIds];
    if (allIds.length === 0) return [];

    const positions = await Promise.all(allIds.map(id => this.get(id)));
    return positions.filter((p): p is Position => p !== null && !p.isLiquidating);
  },

  /**
   * 批量更新仓位风险指标 (Risk Engine 用)
   */
  async batchUpdateRisk(updates: Array<{ id: string; data: Partial<Position> }>): Promise<void> {
    const client = getRedisClient();
    const pipeline = client.pipeline();

    for (const { id, data } of updates) {
      data.updatedAt = Date.now();
      pipeline.hset(Keys.position(id), data as Record<string, any>);

      // Update liquidation trigger
      if (data.liquidationPrice) {
        // Need to get position side first - skip for now in pipeline
      }
    }

    await pipeline.exec();
  },
};

// ============================================================
// Order Repository
// ============================================================

export const OrderRepo = {
  /**
   * 创建订单
   */
  async create(data: Omit<Order, "createdAt" | "updatedAt">): Promise<Order> {
    const client = getRedisClient();
    const now = Date.now();

    const order: Order = {
      ...data,
      createdAt: now,
      updatedAt: now,
    };

    const key = Keys.order(data.id);
    await client.hset(key, order as Record<string, any>);

    // Add to indexes
    await client.sadd(Keys.userOrders(data.userAddress), data.id);
    await client.sadd(Keys.symbolOrders(data.symbol), data.id);

    if (data.status === "PENDING" || data.status === "PARTIALLY_FILLED") {
      await client.sadd(Keys.pendingOrders(data.symbol), data.id);
    }

    // Add to trigger ZSet for conditional orders
    if (data.triggerPrice && ["STOP_LOSS", "TAKE_PROFIT", "TRAILING_STOP"].includes(data.orderType)) {
      const triggerKey = data.side === "LONG"
        ? Keys.triggerLong(data.symbol)
        : Keys.triggerShort(data.symbol);
      await client.zadd(triggerKey, parseFloat(data.triggerPrice), data.id);
    }

    console.log(`[DB] Order created: ${data.id} ${data.orderType} ${data.side}`);
    return order;
  },

  /**
   * 获取订单
   */
  async get(id: string): Promise<Order | null> {
    const client = getRedisClient();
    const data = await client.hgetall(Keys.order(id));
    if (!data || Object.keys(data).length === 0) return null;
    return deserializeOrder(data);
  },

  /**
   * 更新订单
   */
  async update(id: string, updates: Partial<Order>): Promise<Order | null> {
    const client = getRedisClient();
    const key = Keys.order(id);

    const exists = await client.exists(key);
    if (!exists) return null;

    const oldOrder = await this.get(id);
    updates.updatedAt = Date.now();
    await client.hset(key, updates as Record<string, any>);

    // Update pending orders index
    if (updates.status && oldOrder) {
      const isPending = updates.status === "PENDING" || updates.status === "PARTIALLY_FILLED";
      const wasPending = oldOrder.status === "PENDING" || oldOrder.status === "PARTIALLY_FILLED";

      if (isPending && !wasPending) {
        await client.sadd(Keys.pendingOrders(oldOrder.symbol), id);
      } else if (!isPending && wasPending) {
        await client.srem(Keys.pendingOrders(oldOrder.symbol), id);
      }
    }

    return this.get(id);
  },

  /**
   * 获取用户所有订单
   */
  async getByUser(userAddress: Address, status?: Order["status"]): Promise<Order[]> {
    const client = getRedisClient();
    const ids = await client.smembers(Keys.userOrders(userAddress));
    if (ids.length === 0) return [];

    const orders = await Promise.all(ids.map(id => this.get(id)));
    const filtered = orders.filter((o): o is Order => o !== null);

    if (status) {
      return filtered.filter(o => o.status === status);
    }
    return filtered;
  },

  /**
   * 获取交易对待处理订单
   */
  async getPendingBySymbol(symbol: string): Promise<Order[]> {
    const client = getRedisClient();
    const ids = await client.smembers(Keys.pendingOrders(symbol));
    if (ids.length === 0) return [];

    const orders = await Promise.all(ids.map(id => this.get(id)));
    return orders.filter((o): o is Order => o !== null);
  },

  /**
   * 获取触发的条件单
   */
  async getTriggeredOrders(symbol: string, currentPrice: number): Promise<Order[]> {
    const client = getRedisClient();

    // 多头止损/空头止盈: 当前价 <= 触发价
    const longIds = await client.zrangebyscore(
      Keys.triggerLong(symbol),
      currentPrice,
      "+inf"
    );

    // 空头止损/多头止盈: 当前价 >= 触发价
    const shortIds = await client.zrangebyscore(
      Keys.triggerShort(symbol),
      "-inf",
      currentPrice
    );

    const allIds = [...longIds, ...shortIds];
    if (allIds.length === 0) return [];

    const orders = await Promise.all(allIds.map(id => this.get(id)));
    return orders.filter((o): o is Order =>
      o !== null && (o.status === "PENDING" || o.status === "PARTIALLY_FILLED")
    );
  },

  /**
   * 从触发列表移除订单
   */
  async removeFromTrigger(order: Order): Promise<void> {
    const client = getRedisClient();
    const triggerKey = order.side === "LONG"
      ? Keys.triggerLong(order.symbol)
      : Keys.triggerShort(order.symbol);
    await client.zrem(triggerKey, order.id);
  },
};

// ============================================================
// User Vault Repository
// ============================================================

export const VaultRepo = {
  /**
   * 获取或创建用户金库
   */
  async getOrCreate(userAddress: Address): Promise<UserVault> {
    const client = getRedisClient();
    const key = Keys.userVault(userAddress);
    const data = await client.hgetall(key);

    if (data && Object.keys(data).length > 0) {
      return deserializeVault(data, userAddress);
    }

    // Create new vault
    const vault: UserVault = {
      userAddress: userAddress.toLowerCase() as Address,
      availableBalance: "0",
      lockedMargin: "0",
      pendingWithdraw: "0",
      lastSyncBlock: "0",
      lastSyncTime: Date.now(),
    };

    await client.hset(key, vault as Record<string, any>);
    return vault;
  },

  /**
   * 更新金库
   */
  async update(userAddress: Address, updates: Partial<UserVault>): Promise<UserVault> {
    const client = getRedisClient();
    const key = Keys.userVault(userAddress);
    await client.hset(key, updates as Record<string, any>);
    return this.getOrCreate(userAddress);
  },

  /**
   * 锁定保证金
   */
  async lockMargin(userAddress: Address, amount: string): Promise<boolean> {
    const vault = await this.getOrCreate(userAddress);
    const available = BigInt(vault.availableBalance);
    const toLock = BigInt(amount);

    if (available < toLock) {
      return false; // Insufficient balance
    }

    await this.update(userAddress, {
      availableBalance: (available - toLock).toString(),
      lockedMargin: (BigInt(vault.lockedMargin) + toLock).toString(),
    });

    return true;
  },

  /**
   * 解锁保证金
   */
  async unlockMargin(userAddress: Address, amount: string): Promise<void> {
    const vault = await this.getOrCreate(userAddress);
    const locked = BigInt(vault.lockedMargin);
    const toUnlock = BigInt(amount);

    const newLocked = locked >= toUnlock ? locked - toUnlock : 0n;
    const released = locked >= toUnlock ? toUnlock : locked;

    await this.update(userAddress, {
      availableBalance: (BigInt(vault.availableBalance) + released).toString(),
      lockedMargin: newLocked.toString(),
    });
  },

  /**
   * 从链上同步余额
   */
  async syncFromChain(userAddress: Address, balance: string, blockNumber: string): Promise<void> {
    await this.update(userAddress, {
      availableBalance: balance,
      lastSyncBlock: blockNumber,
      lastSyncTime: Date.now(),
    });
  },
};

// ============================================================
// Settlement Log Repository
// ============================================================

export const SettlementLogRepo = {
  /**
   * 创建结算记录
   */
  async create(data: Omit<SettlementLog, "id" | "createdAt">): Promise<SettlementLog> {
    const client = getRedisClient();
    const id = uuidv4();
    const now = Date.now();

    const log: SettlementLog = {
      ...data,
      id,
      createdAt: now,
    };

    const key = Keys.settlementLog(id);
    await client.hset(key, log as Record<string, any>);

    // Add to user index
    await client.lpush(Keys.userSettlements(data.userAddress), id);
    // Keep only last 1000 records per user
    await client.ltrim(Keys.userSettlements(data.userAddress), 0, 999);

    return log;
  },

  /**
   * 更新结算状态
   */
  async updateStatus(id: string, status: SettlementLog["onChainStatus"], txHash?: string): Promise<void> {
    const client = getRedisClient();
    const updates: Partial<SettlementLog> = { onChainStatus: status };
    if (txHash) updates.txHash = txHash;
    await client.hset(Keys.settlementLog(id), updates as Record<string, any>);
  },

  /**
   * 获取用户结算历史
   */
  async getByUser(userAddress: Address, limit = 100): Promise<SettlementLog[]> {
    const client = getRedisClient();
    const ids = await client.lrange(Keys.userSettlements(userAddress), 0, limit - 1);
    if (ids.length === 0) return [];

    const logs = await Promise.all(ids.map(async (id) => {
      const data = await client.hgetall(Keys.settlementLog(id));
      if (!data || Object.keys(data).length === 0) return null;
      return deserializeSettlementLog(data);
    }));

    return logs.filter((l): l is SettlementLog => l !== null);
  },
};

// ============================================================
// Market Stats Repository
// ============================================================

export const MarketStatsRepo = {
  /**
   * 获取或创建市场统计
   */
  async getOrCreate(symbol: string): Promise<MarketStats> {
    const client = getRedisClient();
    const key = Keys.marketStats(symbol);
    const data = await client.hgetall(key);

    if (data && Object.keys(data).length > 0) {
      return deserializeMarketStats(data, symbol);
    }

    const stats: MarketStats = {
      symbol,
      fundingIndex: "0",
      fundingRate: "0",
      lastFundingTime: Date.now(),
      nextFundingTime: Date.now() + 8 * 60 * 60 * 1000, // 8 hours
      longOpenInterest: "0",
      shortOpenInterest: "0",
      lastPrice: "0",
      markPrice: "0",
      indexPrice: "0",
      updatedAt: Date.now(),
    };

    await client.hset(key, stats as Record<string, any>);
    return stats;
  },

  /**
   * 更新市场统计
   */
  async update(symbol: string, updates: Partial<MarketStats>): Promise<void> {
    const client = getRedisClient();
    updates.updatedAt = Date.now();
    await client.hset(Keys.marketStats(symbol), updates as Record<string, any>);
  },

  /**
   * 更新全局资金费索引
   */
  async updateFundingIndex(symbol: string, newIndex: string, rate: string): Promise<void> {
    const client = getRedisClient();
    const now = Date.now();
    await client.hset(Keys.marketStats(symbol), {
      fundingIndex: newIndex,
      fundingRate: rate,
      lastFundingTime: now,
      nextFundingTime: now + 8 * 60 * 60 * 1000,
      updatedAt: now,
    });

    // Also store in dedicated key for quick access
    await client.set(Keys.fundingIndex(symbol), newIndex);
  },

  /**
   * 获取全局资金费索引
   */
  async getFundingIndex(symbol: string): Promise<string> {
    const client = getRedisClient();
    const index = await client.get(Keys.fundingIndex(symbol));
    return index || "0";
  },

  /**
   * 更新持仓量
   */
  async updateOpenInterest(symbol: string, longOI: string, shortOI: string): Promise<void> {
    const client = getRedisClient();
    await client.hset(Keys.marketStats(symbol), {
      longOpenInterest: longOI,
      shortOpenInterest: shortOI,
      updatedAt: Date.now(),
    });
  },
};

// ============================================================
// Deserialization Helpers
// ============================================================

function deserializePosition(data: Record<string, string>): Position {
  return {
    id: data.id,
    userAddress: data.userAddress as Address,
    symbol: data.symbol,
    side: data.side as "LONG" | "SHORT",
    size: data.size,
    entryPrice: data.entryPrice,
    leverage: parseInt(data.leverage),
    marginType: data.marginType as "CROSS" | "ISOLATED",
    initialMargin: data.initialMargin,
    maintMargin: data.maintMargin,
    fundingIndex: data.fundingIndex,
    isLiquidating: data.isLiquidating === "true",
    createdAt: parseInt(data.createdAt),
    updatedAt: parseInt(data.updatedAt),
    markPrice: data.markPrice,
    unrealizedPnL: data.unrealizedPnL,
    marginRatio: data.marginRatio,
    liquidationPrice: data.liquidationPrice,
    riskLevel: data.riskLevel as Position["riskLevel"],
    adlScore: data.adlScore,
    adlRanking: data.adlRanking ? parseInt(data.adlRanking) : undefined,
  };
}

function deserializeOrder(data: Record<string, string>): Order {
  return {
    id: data.id,
    userAddress: data.userAddress as Address,
    symbol: data.symbol,
    token: data.token as Address,
    orderType: data.orderType as Order["orderType"],
    side: data.side as "LONG" | "SHORT",
    price: data.price,
    size: data.size,
    filledSize: data.filledSize,
    avgFillPrice: data.avgFillPrice,
    status: data.status as Order["status"],
    reduceOnly: data.reduceOnly === "true",
    postOnly: data.postOnly === "true",
    triggerPrice: data.triggerPrice || null,
    leverage: parseInt(data.leverage),
    margin: data.margin,
    fee: data.fee,
    signature: data.signature,
    deadline: parseInt(data.deadline),
    nonce: data.nonce,
    createdAt: parseInt(data.createdAt),
    updatedAt: parseInt(data.updatedAt),
  };
}

function deserializeVault(data: Record<string, string>, userAddress: Address): UserVault {
  return {
    userAddress: userAddress.toLowerCase() as Address,
    availableBalance: data.availableBalance || "0",
    lockedMargin: data.lockedMargin || "0",
    pendingWithdraw: data.pendingWithdraw || "0",
    lastSyncBlock: data.lastSyncBlock || "0",
    lastSyncTime: parseInt(data.lastSyncTime) || Date.now(),
  };
}

function deserializeSettlementLog(data: Record<string, string>): SettlementLog {
  return {
    id: data.id,
    txHash: data.txHash || null,
    userAddress: data.userAddress as Address,
    type: data.type as SettlementLog["type"],
    amount: data.amount,
    balanceBefore: data.balanceBefore,
    balanceAfter: data.balanceAfter,
    onChainStatus: data.onChainStatus as SettlementLog["onChainStatus"],
    proofData: data.proofData,
    positionId: data.positionId,
    orderId: data.orderId,
    createdAt: parseInt(data.createdAt),
  };
}

function deserializeMarketStats(data: Record<string, string>, symbol: string): MarketStats {
  return {
    symbol,
    fundingIndex: data.fundingIndex || "0",
    fundingRate: data.fundingRate || "0",
    lastFundingTime: parseInt(data.lastFundingTime) || Date.now(),
    nextFundingTime: parseInt(data.nextFundingTime) || Date.now(),
    longOpenInterest: data.longOpenInterest || "0",
    shortOpenInterest: data.shortOpenInterest || "0",
    lastPrice: data.lastPrice || "0",
    markPrice: data.markPrice || "0",
    indexPrice: data.indexPrice || "0",
    updatedAt: parseInt(data.updatedAt) || Date.now(),
  };
}

// ============================================================
// Export
// ============================================================

export default {
  connect: connectRedis,
  disconnect: disconnectRedis,
  isConnected: isRedisConnected,
  getClient: getRedisClient,
  Position: PositionRepo,
  Order: OrderRepo,
  Vault: VaultRepo,
  SettlementLog: SettlementLogRepo,
  MarketStats: MarketStatsRepo,
};
