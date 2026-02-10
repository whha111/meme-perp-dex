/**
 * 保险基金管理模块
 *
 * 功能:
 * 1. 读取 InsuranceFund 合约状态
 * 2. 追踪资金费收入
 * 3. 追踪清算罚金收入
 * 4. 追踪向 Settlement 的注入
 * 5. 提供健康状态报告
 *
 * 资金流入:
 * - 每日从 Settlement 合约转入的资金费
 * - 每日从 Settlement 合约转入的清算罚金
 *
 * 资金流出:
 * - 当 Settlement 合约资金不足时注入
 */

import { createPublicClient, http, type Address } from "viem";
import { baseSepolia } from "viem/chains";
import { RPC_URL, INSURANCE_FUND_ADDRESS, SETTLEMENT_ADDRESS, PRECISION_MULTIPLIER } from "../config";
import { logger } from "../utils/logger";

// ============================================================
// Viem Client
// ============================================================

const publicClient = createPublicClient({
  chain: baseSepolia,
  transport: http(RPC_URL),
});

// InsuranceFund Contract ABI
const INSURANCE_FUND_ABI = [
  {
    inputs: [],
    name: "getBalance",
    outputs: [{ type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [],
    name: "totalFundingReceived",
    outputs: [{ type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [],
    name: "totalLiquidationReceived",
    outputs: [{ type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [],
    name: "totalInjected",
    outputs: [{ type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [{ name: "to", type: "address" }, { name: "amount", type: "uint256" }],
    name: "injectTo",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
] as const;

// ERC20 ABI for collateral token
const ERC20_ABI = [
  {
    inputs: [{ name: "account", type: "address" }],
    name: "balanceOf",
    outputs: [{ type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
] as const;

// ============================================================
// Types
// ============================================================

export interface InsuranceFundStatus {
  balance: bigint;                    // 当前余额
  totalFundingReceived: bigint;       // 累计收到的资金费
  totalLiquidationReceived: bigint;   // 累计收到的清算罚金
  totalInjected: bigint;              // 累计注入 Settlement 的金额
  netIncome: bigint;                  // 净收入 = 收入 - 支出
  healthLevel: "healthy" | "warning" | "critical";
  timestamp: number;
}

export interface InsuranceFundHistory {
  date: string;
  fundingReceived: bigint;
  liquidationReceived: bigint;
  injected: bigint;
  balanceStart: bigint;
  balanceEnd: bigint;
}

// ============================================================
// State
// ============================================================

// 内存中缓存的状态
let cachedStatus: InsuranceFundStatus | null = null;
let lastStatusUpdate = 0;
const STATUS_CACHE_TTL = 30000; // 30 seconds

// 健康阈值 (ETH 本位)
const HEALTHY_THRESHOLD = 20n * PRECISION_MULTIPLIER.ETH;  // 20 ETH (~$50,000)
const WARNING_THRESHOLD = 4n * PRECISION_MULTIPLIER.ETH;   // 4 ETH (~$10,000)

// 定时器
let statusUpdateInterval: NodeJS.Timeout | null = null;

// ============================================================
// Status Functions
// ============================================================

/**
 * 获取保险基金状态
 */
export async function getStatus(forceRefresh = false): Promise<InsuranceFundStatus> {
  const now = Date.now();

  // 如果缓存有效，返回缓存
  if (!forceRefresh && cachedStatus && now - lastStatusUpdate < STATUS_CACHE_TTL) {
    return cachedStatus;
  }

  try {
    // 并行读取所有状态
    const [balance, totalFunding, totalLiquidation, totalInjected] = await Promise.all([
      publicClient.readContract({
        address: INSURANCE_FUND_ADDRESS,
        abi: INSURANCE_FUND_ABI,
        functionName: "getBalance",
      }),
      publicClient.readContract({
        address: INSURANCE_FUND_ADDRESS,
        abi: INSURANCE_FUND_ABI,
        functionName: "totalFundingReceived",
      }),
      publicClient.readContract({
        address: INSURANCE_FUND_ADDRESS,
        abi: INSURANCE_FUND_ABI,
        functionName: "totalLiquidationReceived",
      }),
      publicClient.readContract({
        address: INSURANCE_FUND_ADDRESS,
        abi: INSURANCE_FUND_ABI,
        functionName: "totalInjected",
      }),
    ]);

    const netIncome = (totalFunding + totalLiquidation) - totalInjected;

    // 计算健康等级
    let healthLevel: InsuranceFundStatus["healthLevel"] = "healthy";
    if (balance < WARNING_THRESHOLD) {
      healthLevel = "critical";
    } else if (balance < HEALTHY_THRESHOLD) {
      healthLevel = "warning";
    }

    cachedStatus = {
      balance,
      totalFundingReceived: totalFunding,
      totalLiquidationReceived: totalLiquidation,
      totalInjected,
      netIncome,
      healthLevel,
      timestamp: now,
    };

    lastStatusUpdate = now;

    logger.debug("Insurance", `Status: balance=${balance}, health=${healthLevel}`);

    return cachedStatus;
  } catch (error) {
    logger.error("Insurance", "Failed to get status:", error);

    // 如果有缓存，返回过期缓存
    if (cachedStatus) {
      return cachedStatus;
    }

    // 返回默认状态
    return {
      balance: 0n,
      totalFundingReceived: 0n,
      totalLiquidationReceived: 0n,
      totalInjected: 0n,
      netIncome: 0n,
      healthLevel: "critical",
      timestamp: now,
    };
  }
}

/**
 * 获取当前余额
 */
export async function getBalance(): Promise<bigint> {
  const status = await getStatus();
  return status.balance;
}

/**
 * 检查是否有足够余额用于注入
 */
export async function hasEnoughForInjection(amount: bigint): Promise<boolean> {
  const balance = await getBalance();
  // 保留 10% 作为安全边际
  const safeBalance = balance * 90n / 100n;
  return safeBalance >= amount;
}

/**
 * 获取可用于注入的最大金额
 */
export async function getMaxInjectionAmount(): Promise<bigint> {
  const balance = await getBalance();
  // 最多使用 80% 的余额
  return balance * 80n / 100n;
}

// ============================================================
// Monitoring Functions
// ============================================================

/**
 * 检查保险基金健康状态
 */
export async function checkHealth(): Promise<{
  isHealthy: boolean;
  level: InsuranceFundStatus["healthLevel"];
  balance: bigint;
  recommendation: string;
}> {
  const status = await getStatus(true);

  let recommendation = "";
  if (status.healthLevel === "critical") {
    recommendation = "URGENT: Insurance fund balance is critically low. Consider adding funds immediately.";
  } else if (status.healthLevel === "warning") {
    recommendation = "WARNING: Insurance fund balance is below optimal level. Consider adding funds soon.";
  } else {
    recommendation = "Insurance fund is healthy.";
  }

  return {
    isHealthy: status.healthLevel === "healthy",
    level: status.healthLevel,
    balance: status.balance,
    recommendation,
  };
}

/**
 * 获取保险基金收支统计
 */
export async function getStatistics(): Promise<{
  totalIncome: bigint;
  totalOutcome: bigint;
  netIncome: bigint;
  fundingPercentage: number;
  liquidationPercentage: number;
}> {
  const status = await getStatus();

  const totalIncome = status.totalFundingReceived + status.totalLiquidationReceived;
  const totalOutcome = status.totalInjected;

  let fundingPercentage = 0;
  let liquidationPercentage = 0;

  if (totalIncome > 0n) {
    fundingPercentage = Number((status.totalFundingReceived * 10000n) / totalIncome) / 100;
    liquidationPercentage = Number((status.totalLiquidationReceived * 10000n) / totalIncome) / 100;
  }

  return {
    totalIncome,
    totalOutcome,
    netIncome: totalIncome - totalOutcome,
    fundingPercentage,
    liquidationPercentage,
  };
}

// ============================================================
// Timer Management
// ============================================================

/**
 * 启动状态更新定时器
 */
export function startStatusUpdateTimer(): void {
  if (statusUpdateInterval) return;

  statusUpdateInterval = setInterval(async () => {
    try {
      const status = await getStatus(true);

      if (status.healthLevel === "critical") {
        logger.warn("Insurance", `CRITICAL: Balance=${status.balance}, immediate action required!`);
      } else if (status.healthLevel === "warning") {
        logger.warn("Insurance", `WARNING: Balance=${status.balance}, monitor closely.`);
      }
    } catch (error) {
      logger.error("Insurance", "Status update failed:", error);
    }
  }, 5 * 60 * 1000); // 5 minutes

  logger.info("Insurance", "Started status update timer (every 5 minutes)");
}

/**
 * 停止状态更新定时器
 */
export function stopStatusUpdateTimer(): void {
  if (statusUpdateInterval) {
    clearInterval(statusUpdateInterval);
    statusUpdateInterval = null;
    logger.info("Insurance", "Stopped status update timer");
  }
}

// ============================================================
// Utility Functions
// ============================================================

/**
 * 格式化余额为人类可读格式 (ETH 本位)
 */
export function formatBalance(amount: bigint): string {
  const eth = Number(amount) / Number(PRECISION_MULTIPLIER.ETH);
  return `Ξ${eth.toLocaleString("en-US", { minimumFractionDigits: 4, maximumFractionDigits: 4 })}`;
}

/**
 * 获取保险基金报告（用于日志或 API）
 */
export async function getReport(): Promise<string> {
  const status = await getStatus();
  const stats = await getStatistics();

  return `
Insurance Fund Report
=====================
Balance: ${formatBalance(status.balance)}
Health: ${status.healthLevel.toUpperCase()}

Income:
  - Funding Fees: ${formatBalance(status.totalFundingReceived)} (${stats.fundingPercentage.toFixed(1)}%)
  - Liquidation Penalties: ${formatBalance(status.totalLiquidationReceived)} (${stats.liquidationPercentage.toFixed(1)}%)
  - Total: ${formatBalance(stats.totalIncome)}

Outflow:
  - Injections: ${formatBalance(status.totalInjected)}

Net Income: ${formatBalance(stats.netIncome)}
Last Updated: ${new Date(status.timestamp).toISOString()}
  `.trim();
}

// ============================================================
// Export
// ============================================================

export default {
  getStatus,
  getBalance,
  hasEnoughForInjection,
  getMaxInjectionAmount,
  checkHealth,
  getStatistics,
  startStatusUpdateTimer,
  stopStatusUpdateTimer,
  formatBalance,
  getReport,
};
