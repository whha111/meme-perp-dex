/**
 * 链上事件监听模块
 *
 * 监控:
 * 1. USDT 转入交易钱包 → 推送余额更新
 * 2. 合约事件 (存款、提款等)
 */

import { createPublicClient, http, type Address, parseAbiItem } from "viem";
import { baseSepolia } from "viem/chains";
import { RPC_URL } from "../config";
import { logger } from "../utils/logger";
import { broadcastBalanceUpdate } from "../websocket/handlers";
import { WalletRepo } from "../database/redis";

// ============================================================
// Configuration
// ============================================================

// USDT 地址 (Base Sepolia)
const USDT_ADDRESS = (process.env.USDT_ADDRESS || "0x83214D0a99EB664c3559D1619Ef9B5f78A655C4e") as Address;

// ERC20 Transfer 事件 ABI
const TRANSFER_EVENT = parseAbiItem(
  "event Transfer(address indexed from, address indexed to, uint256 value)"
);

// ============================================================
// State
// ============================================================

const publicClient = createPublicClient({
  chain: baseSepolia,
  transport: http(RPC_URL),
});

let unwatch: (() => void) | null = null;
let isWatching = false;

// 缓存已知的交易钱包地址 (定期刷新)
const knownTradingWallets = new Set<string>();
let walletCacheUpdateInterval: NodeJS.Timeout | null = null;

// ============================================================
// Wallet Cache
// ============================================================

/**
 * 刷新已知交易钱包缓存
 */
async function refreshWalletCache(): Promise<void> {
  try {
    const wallets = await WalletRepo.getAllDerivedWallets();
    knownTradingWallets.clear();
    for (const wallet of wallets) {
      knownTradingWallets.add(wallet.toLowerCase());
    }
    logger.debug("Events", `Wallet cache refreshed: ${knownTradingWallets.size} wallets`);
  } catch (error) {
    // Redis 可能未连接，忽略错误
  }
}

/**
 * 添加钱包到缓存 (创建钱包时调用)
 */
export function addWalletToCache(wallet: Address): void {
  knownTradingWallets.add(wallet.toLowerCase());
}

/**
 * 检查是否是已知的交易钱包
 */
function isKnownTradingWallet(address: string): boolean {
  return knownTradingWallets.has(address.toLowerCase());
}

// ============================================================
// Event Watching
// ============================================================

/**
 * 启动 USDT Transfer 事件监听
 */
export async function startEventWatcher(): Promise<void> {
  if (isWatching) return;

  // 初始化钱包缓存
  await refreshWalletCache();

  // 定期刷新钱包缓存 (每30秒)
  walletCacheUpdateInterval = setInterval(() => {
    refreshWalletCache();
  }, 30000);

  try {
    // 监听 USDT Transfer 事件
    unwatch = publicClient.watchEvent({
      address: USDT_ADDRESS,
      event: TRANSFER_EVENT,
      onLogs: async (logs) => {
        for (const log of logs) {
          const { from, to, value } = log.args as { from: Address; to: Address; value: bigint };

          // 检查是否转入已知的交易钱包
          if (isKnownTradingWallet(to)) {
            logger.info("Events", `USDT transfer detected: ${from} -> ${to}, amount: ${value}`);

            // 推送余额更新给接收方
            try {
              await broadcastBalanceUpdate(to);
            } catch (error) {
              logger.error("Events", `Failed to broadcast balance update for ${to}:`, error);
            }
          }

          // 检查是否从已知的交易钱包转出
          if (isKnownTradingWallet(from)) {
            logger.info("Events", `USDT transfer out detected: ${from} -> ${to}, amount: ${value}`);

            // 推送余额更新给发送方
            try {
              await broadcastBalanceUpdate(from);
            } catch (error) {
              logger.error("Events", `Failed to broadcast balance update for ${from}:`, error);
            }
          }
        }
      },
      onError: (error) => {
        logger.error("Events", "Event watcher error:", error);
      },
    });

    isWatching = true;
    logger.info("Events", `Started watching USDT transfers at ${USDT_ADDRESS}`);
  } catch (error) {
    logger.error("Events", "Failed to start event watcher:", error);
  }
}

/**
 * 停止事件监听
 */
export function stopEventWatcher(): void {
  if (unwatch) {
    unwatch();
    unwatch = null;
  }

  if (walletCacheUpdateInterval) {
    clearInterval(walletCacheUpdateInterval);
    walletCacheUpdateInterval = null;
  }

  isWatching = false;
  logger.info("Events", "Event watcher stopped");
}

/**
 * 检查是否正在监听
 */
export function isEventWatcherRunning(): boolean {
  return isWatching;
}

export default {
  startEventWatcher,
  stopEventWatcher,
  isEventWatcherRunning,
  addWalletToCache,
};
