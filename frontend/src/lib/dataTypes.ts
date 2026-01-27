/**
 * 数据类型工具函数 - 解决前后端数据类型不匹配问题
 */

// 类型定义
export type Amount = string;

// ==================== 基础工具函数 ====================

export function bigIntToString(value: bigint): Amount {
  return value.toString();
}

export function stringToBigInt(value: Amount): bigint {
  return BigInt(value);
}

export function isValidAmount(value: string | null | undefined): boolean {
  if (!value) return false;
  try {
    BigInt(value);
    return true;
  } catch {
    return false;
  }
}

export function formatAmount(value: Amount, decimals: number = 18): string {
  const bigValue = BigInt(value);
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

export function parseAmount(value: string, decimals: number = 18): Amount {
  const [integerPart, fractionalPart = ''] = value.split('.');
  const paddedFractional = fractionalPart.padEnd(decimals, '0').slice(0, decimals);
  const combined = integerPart + paddedFractional;
  return BigInt(combined).toString();
}

// ==================== 金额转换工具 ====================

/**
 * 安全地将BigInt转换为字符串金额
 */
export function safeBigIntToString(value: bigint | null | undefined): Amount {
  if (value === null || value === undefined) {
    return "0";
  }
  return bigIntToString(value);
}

/**
 * 安全地将字符串金额转换为BigInt
 */
export function safeStringToBigInt(value: Amount | null | undefined): bigint {
  if (!value || !isValidAmount(value)) {
    return 0n;
  }
  return stringToBigInt(value);
}

/**
 * [FIX SECURITY] 科学计数法正则表达式
 */
const SCIENTIFIC_NOTATION_REGEX = /[eE]/;

/**
 * [FIX SECURITY] 有效金额正则表达式
 * 只允许数字和一个小数点
 */
const VALID_USER_AMOUNT_REGEX = /^[0-9]+(\.[0-9]+)?$/;

/**
 * [FIX SECURITY] 解析用户输入金额
 * 严格验证避免科学计数法和其他潜在攻击向量
 */
export function parseUserAmount(
  input: string,
  decimals: number = 18
): { valid: boolean; amount?: Amount; error?: string } {
  // 1. 基本类型检查
  if (typeof input !== 'string') {
    return { valid: false, error: 'Invalid input type' };
  }

  // 2. 空值检查
  const trimmed = input.trim();
  if (!trimmed || trimmed === '0' || trimmed === '0.0') {
    return { valid: false, error: 'Amount must be greater than 0' };
  }

  // 3. [SECURITY] 检测科学计数法
  if (SCIENTIFIC_NOTATION_REGEX.test(trimmed)) {
    return { valid: false, error: 'Scientific notation not allowed' };
  }

  // 4. [SECURITY] 严格格式验证
  if (!VALID_USER_AMOUNT_REGEX.test(trimmed)) {
    return { valid: false, error: 'Invalid amount format' };
  }

  // 5. 小数位数检查
  const parts = trimmed.split('.');
  if (parts.length === 2 && parts[1].length > decimals) {
    return { valid: false, error: `Maximum ${decimals} decimal places allowed` };
  }

  try {
    // 6. 解析为 Amount
    const amount = parseAmount(trimmed, decimals);

    // 7. 验证为正数
    if (BigInt(amount) <= 0n) {
      return { valid: false, error: 'Amount must be greater than 0' };
    }

    return { valid: true, amount };
  } catch (e) {
    return { valid: false, error: 'Failed to parse amount' };
  }
}

// ==================== 幂等性工具 ====================

/**
 * 生成幂等性 ID
 */
export function generateIdempotencyId(): string {
  return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

/**
 * 验证幂等性 ID 格式
 */
export function isValidIdempotencyId(id: string): boolean {
  return typeof id === 'string' && id.length > 0 && id.length <= 64;
}

// ==================== 错误类 ====================

export class AmountFormatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AmountFormatError';
  }
}

export class ConcurrentRequestError extends Error {
  constructor(message: string = 'Request already in progress') {
    super(message);
    this.name = 'ConcurrentRequestError';
  }
}

export class IdempotencyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'IdempotencyError';
  }
}
