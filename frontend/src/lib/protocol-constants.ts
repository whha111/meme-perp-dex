/**
 * Protocol Constants
 * 从 @namespace/protocol 迁移的常量定义
 */

// Token 供应量常量
export const REAL_TOKEN_SUPPLY = BigInt("1000000000000000000000000000"); // 1B tokens with 18 decimals
export const GRADUATION_THRESHOLD = BigInt("207000000000000000000000000"); // 207M tokens with 18 decimals

// 毕业需要卖出的代币数量 = 总供应量 - 剩余代币阈值 = 1B - 207M = 793M
export const SOLD_TOKENS_TARGET = REAL_TOKEN_SUPPLY - GRADUATION_THRESHOLD;

// Wei 相关工具函数
export function bigIntToWei(value: bigint): string {
  return value.toString();
}

export function weiToBigInt(value: string): bigint {
  return BigInt(value);
}

export function formatWei(value: string | bigint, decimals: number = 18): string {
  const bigValue = typeof value === 'string' ? BigInt(value) : value;
  const divisor = BigInt(10 ** decimals);
  const integerPart = bigValue / divisor;
  const fractionalPart = bigValue % divisor;

  if (fractionalPart === BigInt(0)) {
    return integerPart.toString();
  }

  const fractionalStr = fractionalPart.toString().padStart(decimals, '0');
  const trimmedFractional = fractionalStr.replace(/0+$/, '');

  return `${integerPart}.${trimmedFractional}`;
}

export function parseToWei(value: string, decimals: number = 18): string {
  const [integerPart, fractionalPart = ''] = value.split('.');
  const paddedFractional = fractionalPart.padEnd(decimals, '0').slice(0, decimals);
  const combined = integerPart + paddedFractional;
  return BigInt(combined).toString();
}

export function isValidWeiAmount(value: string): boolean {
  try {
    BigInt(value);
    return true;
  } catch {
    return false;
  }
}

// 时间相关
export function nowUnix(): number {
  return Math.floor(Date.now() / 1000);
}

// 请求 ID 生成
export function generateRequestId(): string {
  return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}
