/**
 * PostgreSQL 数据库层 (占位符 - 未实现)
 *
 * 当前状态: 未实现，所有数据使用 Redis 存储
 *
 * 计划用于存储:
 * - 派生钱包信息 (加密私钥)
 * - 交易历史
 * - 审计日志
 *
 * 注意: 如需实际使用，请先实现下方的 TODO 项目
 */

import { POSTGRES_URL } from "../config";
import { logger } from "../utils/logger";
import type { Address, Hex } from "viem";

// ============================================================
// Types
// ============================================================

export interface DerivedWallet {
  id: string;
  userAddress: Address;          // 主钱包地址
  derivedAddress: Address;       // 派生钱包地址
  encryptedPrivateKey: string;   // 加密后的私钥
  salt: string;                  // 加密盐值
  passwordHash: string;          // 密码哈希 (用于验证)
  createdAt: Date;
  updatedAt: Date;
}

export interface TradeHistory {
  id: string;
  txHash: Hex | null;
  token: Address;
  longTrader: Address;
  shortTrader: Address;
  price: string;
  size: string;
  longOrderId: string;
  shortOrderId: string;
  fee: string;
  timestamp: Date;
}

// ============================================================
// PostgreSQL Client (Placeholder - 使用 pg 或 prisma)
// ============================================================

let isConnected = false;

export async function connectPostgres(): Promise<boolean> {
  try {
    // TODO: 实现实际的 PostgreSQL 连接
    // 当前使用 Redis 存储所有数据
    logger.info("Postgres", "PostgreSQL connection skipped (using Redis only)");
    isConnected = true;
    return true;
  } catch (error) {
    logger.error("Postgres", "Failed to connect:", error);
    return false;
  }
}

export async function disconnectPostgres(): Promise<void> {
  isConnected = false;
}

export function isPostgresConnected(): boolean {
  return isConnected;
}

// ============================================================
// Wallet Repository
// ============================================================

export const WalletRepo = {
  async create(data: Omit<DerivedWallet, "id" | "createdAt" | "updatedAt">): Promise<DerivedWallet> {
    // TODO: 实现 PostgreSQL 存储
    // 当前使用 Redis
    throw new Error("PostgreSQL not implemented - use Redis");
  },

  async getByUser(userAddress: Address): Promise<DerivedWallet | null> {
    // TODO: 实现 PostgreSQL 查询
    throw new Error("PostgreSQL not implemented - use Redis");
  },

  async getByDerivedAddress(derivedAddress: Address): Promise<DerivedWallet | null> {
    // TODO: 实现 PostgreSQL 查询
    throw new Error("PostgreSQL not implemented - use Redis");
  },
};

// ============================================================
// Trade History Repository
// ============================================================

export const TradeHistoryRepo = {
  async create(data: Omit<TradeHistory, "id">): Promise<TradeHistory> {
    // TODO: 实现 PostgreSQL 存储
    throw new Error("PostgreSQL not implemented");
  },

  async getByToken(token: Address, limit = 100): Promise<TradeHistory[]> {
    // TODO: 实现 PostgreSQL 查询
    return [];
  },

  async getByTrader(trader: Address, limit = 100): Promise<TradeHistory[]> {
    // TODO: 实现 PostgreSQL 查询
    return [];
  },
};

export default {
  connect: connectPostgres,
  disconnect: disconnectPostgres,
  isConnected: isPostgresConnected,
  WalletRepo,
  TradeHistoryRepo,
};
