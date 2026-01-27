/**
 * 业务配置常量
 * 所有硬编码的业务数值都应在此定义，支持环境变量覆盖
 */

import { parseUnits } from "viem";

// ==================== 环境变量配置 ====================
export const ENV_CONFIG = {
  // 链配置
  TARGET_CHAIN_ID: parseInt(process.env.NEXT_PUBLIC_TARGET_CHAIN_ID || "84532"),
  DEFAULT_BUY_AMOUNT: process.env.NEXT_PUBLIC_DEFAULT_BUY_AMOUNT || "0.01",
  DEFAULT_SERVICE_FEE: process.env.NEXT_PUBLIC_DEFAULT_SERVICE_FEE || "0.001",
  ERROR_THRESHOLD: parseFloat(process.env.NEXT_PUBLIC_ERROR_THRESHOLD || "0.1"),
  
  // 合约地址（通过 contracts.ts 管理）
  
  // API 配置
  API_BASE_URL: process.env.NEXT_PUBLIC_API_BASE_URL || "https://api.domainfi.io",
} as const;

// ==================== 价格配置 ====================
export const PRICE_CONFIG = {
  // @deprecated - 请使用 useETHPrice hook 获取实时 ETH 价格
  // import { useETHPrice } from "@/hooks/useETHPrice";
  // const { price } = useETHPrice();
  ETH_PRICE_USD: parseFloat(process.env.NEXT_PUBLIC_ETH_PRICE_USD || "3300"),

  // 价格显示精度
  USD_DECIMALS: 2,
  ETH_DECIMALS: 6,
} as const;

// ==================== 超时配置 ====================
export const TIMEOUT_CONFIG = {
  // DNS 验证相关
  DNS_MAX_ATTEMPTS: 60, // 最多等待 60 秒
  DNS_WARNING_THRESHOLD: 30, // 30 秒后显示警告
  DNS_PROPAGATION_TIMEOUT: 180, // DNS 传播超时（秒）
  
  // 交易相关
  TRANSACTION_DEADLINE_MINUTES: 20, // 交易截止时间（分钟）
  TRANSACTION_MAX_ATTEMPTS: 60, // 交易最大重试次数
  
  // 连接相关
  STREAM_RECONNECT_ATTEMPTS: 30, // 流重连次数
  WEBSOCKET_HEARTBEAT_INTERVAL: 30000, // WebSocket 心跳间隔（毫秒）
} as const;

// ==================== 业务阈值配置 ====================
// 注意：毕业阈值已从 @namespace/protocol 导入，此处不再重复定义
// 请使用 import { GRADUATION_THRESHOLD } from "@namespace/protocol";

export const THRESHOLD_CONFIG = {
  // 毕业阈值 - 仅用于显示目的（ETH 近似值）
  // ⚠️ 计算请使用 @namespace/protocol 的 GRADUATION_THRESHOLD (727M tokens)
  GRADUATION_THRESHOLD_ETH_DISPLAY: "~22.55", // 约 22.55 ETH（仅供参考）
  
  // 交易阈值
  BUY_PER_TRANSACTION_ETH: "0.1", // 每笔交易购买量（ETH）
  BUY_PER_TRANSACTION: parseUnits("0.1", 18), // BigInt 格式
  
  // 滑点配置
  DEFAULT_SLIPPAGE_PERCENT: 5, // 默认滑点百分比
  DEFAULT_SLIPPAGE_BPS: 500, // 默认滑点基点（5% = 500 bps）
  SLIPPAGE_FOR_FRONTEND_CALC: 100, // 前端计算的滑点（1% = 100 bps）
  
  // 价格影响阈值
  PRICE_IMPACT_WARNING: 5, // 价格影响警告阈值（%）
  PRICE_IMPACT_ERROR: 10, // 价格影响错误阈值（%）
} as const;

// ==================== 计算参数 ====================
export const CALCULATION_CONFIG = {
  // Gas 估算
  EXPECTED_GAS_DEFAULT: 0n, // 默认 Gas 估算
  
  // 精度
  ETH_DECIMALS: 18, // ETH 精度
  PERCENTAGE_DECIMALS: 2, // 百分比精度
  
  // 数学常数
  ONE_HUNDRED_PERCENT: 10000n, // 100% in basis points
  NINETY_NINE_PERCENT: 9900n, // 99% in basis points
  NINETY_FIVE_PERCENT: 9500n, // 95% in basis points
} as const;

// ==================== 验证配置 ====================
export const VALIDATION_CONFIG = {
  // 域名验证
  DNS_TXT_PREFIX: "domainfi-verify=",
  DNS_HOST_PREFIX: "_domainfi",
  
  // 钱包验证
  MIN_WALLET_BALANCE_ETH: "0.01", // 最小钱包余额（ETH）
  
  // 输入验证
  MIN_DOMAIN_LENGTH: 3, // 最小域名长度
  MAX_DOMAIN_LENGTH: 253, // 最大域名长度
} as const;

// ==================== 工具函数 ====================
export function getDeadlineTimestamp(minutes: number = TIMEOUT_CONFIG.TRANSACTION_DEADLINE_MINUTES): bigint {
  return BigInt(Math.floor(Date.now() / 1000) + minutes * 60);
}

export function calculateMinAmountWithSlippage(
  amount: bigint,
  slippageBps: number = THRESHOLD_CONFIG.DEFAULT_SLIPPAGE_BPS
): bigint {
  if (slippageBps < 0 || slippageBps > 10000) {
    throw new Error("滑点必须在 0-10000 基点之间");
  }
  return (amount * (CALCULATION_CONFIG.ONE_HUNDRED_PERCENT - BigInt(slippageBps))) / CALCULATION_CONFIG.ONE_HUNDRED_PERCENT;
}

export function calculateMinAmountWithPercentSlippage(
  amount: bigint,
  slippagePercent: number = THRESHOLD_CONFIG.DEFAULT_SLIPPAGE_PERCENT
): bigint {
  if (slippagePercent < 0 || slippagePercent > 100) {
    throw new Error("滑点必须在 0-100% 之间");
  }
  const slippageBps = slippagePercent * 100;
  return calculateMinAmountWithSlippage(amount, slippageBps);
}

// ==================== 配置验证 ====================
export function validateBusinessConfig(): string[] {
  const errors: string[] = [];
  
  // 验证超时配置
  if (TIMEOUT_CONFIG.DNS_MAX_ATTEMPTS <= 0) {
    errors.push("DNS_MAX_ATTEMPTS 必须大于 0");
  }
  
  if (TIMEOUT_CONFIG.TRANSACTION_DEADLINE_MINUTES < 1) {
    errors.push("TRANSACTION_DEADLINE_MINUTES 必须至少 1 分钟");
  }
  
  // 验证阈值配置
  if (THRESHOLD_CONFIG.DEFAULT_SLIPPAGE_PERCENT < 0 || THRESHOLD_CONFIG.DEFAULT_SLIPPAGE_PERCENT > 100) {
    errors.push("DEFAULT_SLIPPAGE_PERCENT 必须在 0-100% 之间");
  }
  
  // 注意：GRADUATION_THRESHOLD 已移至 @namespace/protocol
  // 此处不再验证
  
  return errors;
}

// 启动时验证配置
const configErrors = validateBusinessConfig();
if (configErrors.length > 0 && typeof window !== 'undefined') {
  console.warn("业务配置验证警告:", configErrors);
}

// ==================== 默认导出 ====================
const BusinessConfig = {
  env: ENV_CONFIG,
  timeout: TIMEOUT_CONFIG,
  threshold: THRESHOLD_CONFIG,
  calculation: CALCULATION_CONFIG,
  validation: VALIDATION_CONFIG,

  // 工具函数
  getDeadlineTimestamp,
  calculateMinAmountWithSlippage,
  calculateMinAmountWithPercentSlippage,
  validateBusinessConfig,
};

export default BusinessConfig;