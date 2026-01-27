/**
 * 标准错误码系统
 *
 * 提供统一的错误码定义和用户友好的错误消息
 * 与后端 internal/errors/errors.go 保持一致
 */

// 错误码枚举
export enum ErrorCode {
  // 通用错误
  INVALID_ARGUMENT = "INVALID_ARGUMENT",
  NOT_FOUND = "NOT_FOUND",
  UNAVAILABLE = "UNAVAILABLE",
  INTERNAL = "INTERNAL",
  PERMISSION_DENIED = "PERMISSION_DENIED",
  RESOURCE_EXHAUSTED = "RESOURCE_EXHAUSTED",
  DEADLINE_EXCEEDED = "DEADLINE_EXCEEDED",

  // DNS 验证相关
  DNS_QUERY_FAILED = "DNS_QUERY_FAILED",
  DNS_VERIFICATION_FAILED = "DNS_VERIFICATION_FAILED",
  INVALID_DOMAIN = "INVALID_DOMAIN",

  // 钱包相关
  WALLET_NOT_CONNECTED = "WALLET_NOT_CONNECTED",
  WALLET_WRONG_NETWORK = "WALLET_WRONG_NETWORK",
  WALLET_INSUFFICIENT_BALANCE = "WALLET_INSUFFICIENT_BALANCE",
  INVALID_WALLET_ADDRESS = "INVALID_WALLET_ADDRESS",

  // 交易相关
  TRANSACTION_FAILED = "TRANSACTION_FAILED",
  TRANSACTION_REJECTED = "TRANSACTION_REJECTED",
  SLIPPAGE_EXCEEDED = "SLIPPAGE_EXCEEDED",
  PRICE_IMPACT_TOO_HIGH = "PRICE_IMPACT_TOO_HIGH",
  INSUFFICIENT_LIQUIDITY = "INSUFFICIENT_LIQUIDITY",

  // 合约相关
  CONTRACT_ERROR = "CONTRACT_ERROR",
  APPROVAL_FAILED = "APPROVAL_FAILED",

  // 网络相关
  NETWORK_ERROR = "NETWORK_ERROR",
  WEBSOCKET_DISCONNECTED = "WEBSOCKET_DISCONNECTED",
  API_ERROR = "API_ERROR",

  // 未知错误
  UNKNOWN = "UNKNOWN",
}

// 错误消息映射 (多语言键)
export const ERROR_MESSAGES: Record<ErrorCode, string> = {
  [ErrorCode.INVALID_ARGUMENT]: "errors.invalidArgument",
  [ErrorCode.NOT_FOUND]: "errors.notFound",
  [ErrorCode.UNAVAILABLE]: "errors.unavailable",
  [ErrorCode.INTERNAL]: "errors.internal",
  [ErrorCode.PERMISSION_DENIED]: "errors.permissionDenied",
  [ErrorCode.RESOURCE_EXHAUSTED]: "errors.resourceExhausted",
  [ErrorCode.DEADLINE_EXCEEDED]: "errors.deadlineExceeded",
  [ErrorCode.DNS_QUERY_FAILED]: "errors.dnsQueryFailed",
  [ErrorCode.DNS_VERIFICATION_FAILED]: "errors.dnsVerificationFailed",
  [ErrorCode.INVALID_DOMAIN]: "errors.invalidDomain",
  [ErrorCode.WALLET_NOT_CONNECTED]: "errors.walletNotConnected",
  [ErrorCode.WALLET_WRONG_NETWORK]: "errors.walletWrongNetwork",
  [ErrorCode.WALLET_INSUFFICIENT_BALANCE]: "errors.walletInsufficientBalance",
  [ErrorCode.INVALID_WALLET_ADDRESS]: "errors.invalidWalletAddress",
  [ErrorCode.TRANSACTION_FAILED]: "errors.transactionFailed",
  [ErrorCode.TRANSACTION_REJECTED]: "errors.transactionRejected",
  [ErrorCode.SLIPPAGE_EXCEEDED]: "errors.slippageExceeded",
  [ErrorCode.PRICE_IMPACT_TOO_HIGH]: "errors.priceImpactTooHigh",
  [ErrorCode.INSUFFICIENT_LIQUIDITY]: "errors.insufficientLiquidity",
  [ErrorCode.CONTRACT_ERROR]: "errors.contractError",
  [ErrorCode.APPROVAL_FAILED]: "errors.approvalFailed",
  [ErrorCode.NETWORK_ERROR]: "errors.networkError",
  [ErrorCode.WEBSOCKET_DISCONNECTED]: "errors.websocketDisconnected",
  [ErrorCode.API_ERROR]: "errors.apiError",
  [ErrorCode.UNKNOWN]: "errors.unknown",
};

// 默认英文消息 (作为后备)
export const DEFAULT_ERROR_MESSAGES: Record<ErrorCode, string> = {
  [ErrorCode.INVALID_ARGUMENT]: "Invalid input provided",
  [ErrorCode.NOT_FOUND]: "Resource not found",
  [ErrorCode.UNAVAILABLE]: "Service temporarily unavailable",
  [ErrorCode.INTERNAL]: "An unexpected error occurred",
  [ErrorCode.PERMISSION_DENIED]: "Permission denied",
  [ErrorCode.RESOURCE_EXHAUSTED]: "Too many requests, please try again later",
  [ErrorCode.DEADLINE_EXCEEDED]: "Request timed out",
  [ErrorCode.DNS_QUERY_FAILED]: "Failed to verify domain DNS",
  [ErrorCode.DNS_VERIFICATION_FAILED]: "Domain verification failed",
  [ErrorCode.INVALID_DOMAIN]: "Invalid domain name",
  [ErrorCode.WALLET_NOT_CONNECTED]: "Please connect your wallet",
  [ErrorCode.WALLET_WRONG_NETWORK]: "Please switch to the correct network",
  [ErrorCode.WALLET_INSUFFICIENT_BALANCE]: "Insufficient balance",
  [ErrorCode.INVALID_WALLET_ADDRESS]: "Invalid wallet address",
  [ErrorCode.TRANSACTION_FAILED]: "Transaction failed",
  [ErrorCode.TRANSACTION_REJECTED]: "Transaction was rejected",
  [ErrorCode.SLIPPAGE_EXCEEDED]: "Slippage tolerance exceeded",
  [ErrorCode.PRICE_IMPACT_TOO_HIGH]: "Price impact is too high",
  [ErrorCode.INSUFFICIENT_LIQUIDITY]: "Insufficient liquidity for this trade",
  [ErrorCode.CONTRACT_ERROR]: "Contract interaction failed",
  [ErrorCode.APPROVAL_FAILED]: "Token approval failed",
  [ErrorCode.NETWORK_ERROR]: "Network connection error",
  [ErrorCode.WEBSOCKET_DISCONNECTED]: "Real-time connection lost",
  [ErrorCode.API_ERROR]: "API request failed",
  [ErrorCode.UNKNOWN]: "An unknown error occurred",
};

/**
 * AppError - 应用统一错误类
 */
export class AppError extends Error {
  public readonly code: ErrorCode;
  public readonly details?: Record<string, unknown>;
  public readonly originalError?: Error;

  constructor(
    code: ErrorCode,
    message?: string,
    details?: Record<string, unknown>,
    originalError?: Error
  ) {
    super(message || DEFAULT_ERROR_MESSAGES[code]);
    this.name = "AppError";
    this.code = code;
    this.details = details;
    this.originalError = originalError;

    // 维护原型链
    Object.setPrototypeOf(this, AppError.prototype);
  }

  /**
   * 获取用户友好的错误消息
   */
  getUserMessage(): string {
    return this.message;
  }

  /**
   * 转换为 JSON (用于日志)
   */
  toJSON(): Record<string, unknown> {
    return {
      name: this.name,
      code: this.code,
      message: this.message,
      details: this.details,
      stack: this.stack,
    };
  }
}

/**
 * 从后端响应解析错误码
 */
export function parseBackendError(error: unknown): AppError {
  if (error instanceof AppError) {
    return error;
  }

  if (error instanceof Error) {
    // 尝试从消息中提取错误码
    const codeMatch = error.message.match(/\[([A-Z_]+)\]/);
    if (codeMatch && codeMatch[1] in ErrorCode) {
      const code = codeMatch[1] as ErrorCode;
      const message = error.message.replace(/\[[A-Z_]+\]\s*/, "");
      return new AppError(code, message, undefined, error);
    }

    // 检查常见的 Web3 错误
    if (error.message.includes("user rejected") || error.message.includes("User rejected")) {
      return new AppError(ErrorCode.TRANSACTION_REJECTED, undefined, undefined, error);
    }
    if (error.message.includes("insufficient funds") || error.message.includes("insufficient balance")) {
      return new AppError(ErrorCode.WALLET_INSUFFICIENT_BALANCE, undefined, undefined, error);
    }
    if (error.message.includes("nonce too low") || error.message.includes("replacement underpriced")) {
      return new AppError(ErrorCode.TRANSACTION_FAILED, "Transaction conflict, please try again", undefined, error);
    }

    return new AppError(ErrorCode.UNKNOWN, error.message, undefined, error);
  }

  // 处理 string 类型的错误
  if (typeof error === "string") {
    return new AppError(ErrorCode.UNKNOWN, error);
  }

  return new AppError(ErrorCode.UNKNOWN);
}

/**
 * 创建具体类型的错误
 */
export const Errors = {
  invalidArgument: (message?: string) =>
    new AppError(ErrorCode.INVALID_ARGUMENT, message),
  notFound: (resource?: string) =>
    new AppError(ErrorCode.NOT_FOUND, resource ? `${resource} not found` : undefined),
  unavailable: (service?: string) =>
    new AppError(ErrorCode.UNAVAILABLE, service ? `${service} is temporarily unavailable` : undefined),
  internal: (message?: string) =>
    new AppError(ErrorCode.INTERNAL, message),
  permissionDenied: (message?: string) =>
    new AppError(ErrorCode.PERMISSION_DENIED, message),
  resourceExhausted: () =>
    new AppError(ErrorCode.RESOURCE_EXHAUSTED),
  timeout: () =>
    new AppError(ErrorCode.DEADLINE_EXCEEDED),
  walletNotConnected: () =>
    new AppError(ErrorCode.WALLET_NOT_CONNECTED),
  wrongNetwork: (expected?: string) =>
    new AppError(ErrorCode.WALLET_WRONG_NETWORK, expected ? `Please switch to ${expected}` : undefined),
  insufficientBalance: (required?: string) =>
    new AppError(ErrorCode.WALLET_INSUFFICIENT_BALANCE, required ? `Required: ${required}` : undefined),
  transactionFailed: (reason?: string) =>
    new AppError(ErrorCode.TRANSACTION_FAILED, reason),
  transactionRejected: () =>
    new AppError(ErrorCode.TRANSACTION_REJECTED),
  slippageExceeded: () =>
    new AppError(ErrorCode.SLIPPAGE_EXCEEDED),
  priceImpactTooHigh: (impact?: string) =>
    new AppError(ErrorCode.PRICE_IMPACT_TOO_HIGH, impact ? `Price impact: ${impact}%` : undefined),
  insufficientLiquidity: () =>
    new AppError(ErrorCode.INSUFFICIENT_LIQUIDITY),
  contractError: (message?: string) =>
    new AppError(ErrorCode.CONTRACT_ERROR, message),
  approvalFailed: () =>
    new AppError(ErrorCode.APPROVAL_FAILED),
  networkError: () =>
    new AppError(ErrorCode.NETWORK_ERROR),
  websocketDisconnected: () =>
    new AppError(ErrorCode.WEBSOCKET_DISCONNECTED),
  apiError: (message?: string) =>
    new AppError(ErrorCode.API_ERROR, message),
  dnsQueryFailed: (domain?: string) =>
    new AppError(ErrorCode.DNS_QUERY_FAILED, domain ? `DNS query failed for ${domain}` : undefined),
  dnsVerificationFailed: (reason?: string) =>
    new AppError(ErrorCode.DNS_VERIFICATION_FAILED, reason),
  invalidDomain: (domain?: string) =>
    new AppError(ErrorCode.INVALID_DOMAIN, domain ? `Invalid domain: ${domain}` : undefined),
};

export default Errors;
