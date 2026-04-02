/**
 * 精度转换工具 (ETH 本位)
 *
 * ETH 本位系统精度:
 * - Token 数量: 1e18
 * - 价格 (ETH/Token): 1e18
 * - 保证金/PnL/手续费: 1e18 (ETH)
 */

import { PRECISION, PRECISION_MULTIPLIER } from "../config";

// 将数值转换为指定精度的 bigint
export function toBigInt(value: number | string, decimals: bigint): bigint {
  const multiplier = 10n ** decimals;
  if (typeof value === "number") {
    // 处理小数
    const str = value.toFixed(Number(decimals));
    const [integer, decimal = ""] = str.split(".");
    const paddedDecimal = decimal.padEnd(Number(decimals), "0").slice(0, Number(decimals));
    return BigInt(integer + paddedDecimal);
  }
  // string
  if (value.includes(".")) {
    const [integer, decimal = ""] = value.split(".");
    const paddedDecimal = decimal.padEnd(Number(decimals), "0").slice(0, Number(decimals));
    return BigInt(integer + paddedDecimal);
  }
  return BigInt(value) * multiplier;
}

// 将 bigint 转换为数值
export function fromBigInt(value: bigint, decimals: bigint): number {
  const multiplier = 10n ** decimals;
  const integer = value / multiplier;
  const decimal = value % multiplier;
  const decimalStr = decimal.toString().padStart(Number(decimals), "0");
  return parseFloat(`${integer}.${decimalStr}`);
}

// 格式化为字符串
export function formatBigInt(value: bigint, decimals: bigint, displayDecimals = 6): string {
  const num = fromBigInt(value, decimals);
  return num.toFixed(displayDecimals);
}

// 快捷函数 (ETH 本位)
export const toSize = (value: number | string) => toBigInt(value, PRECISION.SIZE);
export const toPrice = (value: number | string) => toBigInt(value, PRECISION.PRICE);
export const toETH = (value: number | string) => toBigInt(value, PRECISION.ETH);
export const toLeverage = (value: number | string) => toBigInt(value, PRECISION.LEVERAGE);
export const toRate = (value: number | string) => toBigInt(value, PRECISION.RATE);

export const fromSize = (value: bigint) => fromBigInt(value, PRECISION.SIZE);
export const fromPrice = (value: bigint) => fromBigInt(value, PRECISION.PRICE);
export const fromETH = (value: bigint) => fromBigInt(value, PRECISION.ETH);
export const fromLeverage = (value: bigint) => fromBigInt(value, PRECISION.LEVERAGE);
export const fromRate = (value: bigint) => fromBigInt(value, PRECISION.RATE);

/**
 * 计算保证金 (ETH 本位)
 *
 * @param size - Token 数量 (1e18)
 * @param price - ETH/Token 价格 (1e18)
 * @param leverage - 杠杆倍数 (1e4 精度, 10x = 100000)
 * @returns 保证金 (ETH, 1e18 精度)
 */
export function calculateMargin(size: bigint, price: bigint, leverage: bigint): bigint {
  // notionalETH = size * price / 1e18 (ETH 名义价值)
  // margin = notionalETH * 10000 / leverage (ETH 保证金)
  const notionalETH = (size * price) / PRECISION_MULTIPLIER.SIZE;  // 1e18 ETH
  const margin = (notionalETH * PRECISION_MULTIPLIER.LEVERAGE) / leverage;  // 1e18 ETH
  return margin;
}

/**
 * 计算手续费 (ETH 本位)
 *
 * @param size - Token 数量 (1e18)
 * @param price - ETH/Token 价格 (1e18)
 * @param feeRate - 手续费率 (基点, 5 = 0.05%)
 * @returns 手续费 (ETH, 1e18 精度)
 */
export function calculateFee(size: bigint, price: bigint, feeRate: bigint): bigint {
  // notionalETH = size * price / 1e18
  // fee = notionalETH * feeRate / 10000
  const notionalETH = (size * price) / PRECISION_MULTIPLIER.SIZE;
  const fee = (notionalETH * feeRate) / PRECISION_MULTIPLIER.RATE;
  return fee;
}

/**
 * 计算未实现盈亏 (ETH 本位 - GMX 标准)
 *
 * @param size - Token 数量 (1e18)
 * @param entryPrice - 开仓价格 (ETH/Token, 1e18)
 * @param currentPrice - 当前价格 (ETH/Token, 1e18)
 * @param isLong - 是否多头
 * @returns PnL (ETH, 1e18 精度)
 */
export function calculatePnL(
  size: bigint,
  entryPrice: bigint,
  currentPrice: bigint,
  isLong: boolean
): bigint {
  if (entryPrice <= 0n) return 0n;

  // delta = size * |currentPrice - entryPrice| / entryPrice
  // 精度: (1e18 * 1e18) / 1e18 = 1e18 (ETH)
  const priceDelta = currentPrice > entryPrice
    ? currentPrice - entryPrice
    : entryPrice - currentPrice;

  const delta = (size * priceDelta) / entryPrice;  // 1e18 ETH

  const hasProfit = isLong
    ? currentPrice > entryPrice
    : entryPrice > currentPrice;

  return hasProfit ? delta : -delta;
}

/**
 * 计算强平价格 (ETH 本位 - Bybit 标准)
 *
 * @param entryPrice - 开仓价格 (ETH/Token, 1e18)
 * @param leverage - 杠杆倍数 (1e4 精度)
 * @param mmr - 维持保证金率 (基点, 200 = 2%)
 * @param isLong - 是否多头
 * @returns 强平价格 (ETH/Token, 1e18)
 */
export function calculateLiquidationPrice(
  entryPrice: bigint,
  leverage: bigint,   // 1e4 精度, 如 25000n = 2.5x
  mmr: bigint,        // 维持保证金率 (基点, 如 200n = 2%)
  isLong: boolean
): bigint {
  // 多头: liqPrice = entryPrice * (1 - 1/leverage + MMR/10000)
  // 空头: liqPrice = entryPrice * (1 + 1/leverage - MMR/10000)
  //
  // 纯 BigInt 实现 (消除 Number() 精度丢失):
  //   1/leverage 在 1e4 精度下 = 10000*10000/leverage
  //   公分母 10000n:
  //     long factor  = 10000 - inverseLev + mmr
  //     short factor = 10000 + inverseLev - mmr

  if (leverage === 0n) return 0n;

  const inverseLev = (10000n * 10000n) / leverage; // 1/leverage in basis points

  if (isLong) {
    const factor = 10000n - inverseLev + mmr;
    if (factor <= 0n) return 0n;
    return (entryPrice * factor) / 10000n;
  } else {
    const factor = 10000n + inverseLev - mmr;
    return (entryPrice * factor) / 10000n;
  }
}

/**
 * 计算强平价格 - 基于当前保证金 (ETH 本位)
 *
 * 当保证金因资金费减少后，有效杠杆增加，爆仓价格会更接近当前价格
 *
 * @param entryPrice - 开仓价格 (ETH/Token, 1e18 精度)
 * @param size - Token 数量 (1e18 精度)
 * @param currentCollateral - 当前保证金 (ETH, 1e18 精度)
 * @param mmr - 维持保证金率 (基点，如 200 = 2%)
 * @param isLong - 是否多头
 * @returns 强平价格 (ETH/Token, 1e18)
 */
export function calculateLiquidationPriceWithCollateral(
  entryPrice: bigint,
  size: bigint,
  currentCollateral: bigint,
  mmr: bigint,
  isLong: boolean
): bigint {
  if (currentCollateral === 0n) return entryPrice;

  const notionalETH = (size * entryPrice) / (10n ** 18n);
  if (notionalETH === 0n) return 0n;

  // effectiveLeverage in 1e4 精度
  const effectiveLeverage = (notionalETH * 10000n) / currentCollateral;
  if (effectiveLeverage === 0n) return 0n;

  // 复用纯 BigInt 的 calculateLiquidationPrice
  return calculateLiquidationPrice(entryPrice, effectiveLeverage, mmr, isLong);
}

// 计算保证金率
export function calculateMarginRatio(
  margin: bigint,
  maintenanceMargin: bigint
): bigint {
  if (margin <= 0n) return 10000n;  // 100% = 强平
  return (maintenanceMargin * 10000n) / margin;
}

// 计算 ADL 评分
export function calculateADLScore(
  unrealizedPnL: bigint,
  collateral: bigint,
  leverage: bigint
): bigint {
  if (collateral <= 0n || unrealizedPnL <= 0n) return 0n;
  // ADL Score = (UPNL / Collateral) * Leverage
  return (unrealizedPnL * leverage) / collateral;
}
