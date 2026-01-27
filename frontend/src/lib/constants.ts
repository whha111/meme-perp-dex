/**
 * DNS Verification Constants (Single Source of Truth)
 * 
 * 这些常量用于域名所有权验证流程。
 * 前后端必须使用相同的格式以确保验证成功。
 * 
 * TXT 记录格式: _domainfi.example.com TXT "domainfi-verify=0x1234...abcd"
 */

/**
 * DNS TXT 记录的主机名前缀
 * 用户需要在 DNS 中添加: _domainfi.{domain} 作为 TXT 记录
 */
export const VERIFICATION_HOST = "_domainfi";

/**
 * TXT 记录值的前缀
 * 完整格式: domainfi-verify={walletAddress}
 */
export const VERIFICATION_PREFIX = "domainfi-verify=";

/**
 * 生成完整的 TXT 记录值
 * @param walletAddress - 用户的钱包地址 (0x...)
 * @returns 格式化的 TXT 记录值
 * 
 * @example
 * generateTXTRecordValue("0x1234...abcd")
 * // => "domainfi-verify=0x1234...abcd"
 */
export function generateTXTRecordValue(walletAddress: string): string {
  if (!walletAddress || !walletAddress.startsWith("0x")) {
    throw new Error("Invalid wallet address format");
  }
  return `${VERIFICATION_PREFIX}${walletAddress.toLowerCase()}`;
}

/**
 * 生成完整的 DNS 主机名
 * @param domain - 用户的域名 (example.com)
 * @returns 完整的 DNS 查询主机名
 * 
 * @example
 * generateDNSHost("example.com")
 * // => "_domainfi.example.com"
 */
export function generateDNSHost(domain: string): string {
  if (!domain || domain.length < 3) {
    throw new Error("Invalid domain format");
  }
  // 移除前导点和尾部点
  const cleanDomain = domain.replace(/^\.+|\.+$/g, "");
  return `${VERIFICATION_HOST}.${cleanDomain}`;
}

/**
 * 从 TXT 记录值中提取钱包地址
 * @param txtValue - TXT 记录的值
 * @returns 钱包地址或 null
 * 
 * @example
 * extractWalletFromTXT("domainfi-verify=0x1234...abcd")
 * // => "0x1234...abcd"
 */
import { validateAndExtractWalletFromTXT } from "./validators";

export function extractWalletFromTXT(txtValue: string): string | null {
  return validateAndExtractWalletFromTXT(txtValue, VERIFICATION_PREFIX);
}

/**
 * 验证 TXT 记录是否匹配预期的钱包地址
 * @param txtValue - DNS TXT 记录的值
 * @param expectedWallet - 预期的钱包地址
 * @returns 是否匹配
 */
export function verifyTXTRecord(txtValue: string, expectedWallet: string): boolean {
  const extractedWallet = extractWalletFromTXT(txtValue);
  if (!extractedWallet) return false;
  return extractedWallet.toLowerCase() === expectedWallet.toLowerCase();
}

/**
 * WebSocket 端点配置
 */
export const WEBSOCKET_ENDPOINTS = {
  DEVELOPMENT: process.env.NEXT_PUBLIC_WEBSOCKET_URL || "ws://localhost:8080/ws",
  PRODUCTION: "wss://api.domainfi.com/ws",
} as const;

/**
 * 验证状态枚举
 */
export enum VerificationStatus {
  PENDING = "pending",        // 等待用户添加 DNS 记录
  VERIFYING = "verifying",    // 正在验证中
  SUCCESS = "success",        // 验证成功
  FAILED = "failed",          // 验证失败
  ERROR = "error",            // 发生错误
}

/**
 * 验证结果接口
 */
export interface VerificationResult {
  success: boolean;
  status: VerificationStatus;
  domain: string;
  walletAddress: string;
  message: string;
  signature?: string;         // 验证通过后的签名，用于合约调用
  timestamp?: number;
  dnsRecordFound?: string;    // 实际找到的 DNS 记录
  expectedRecord?: string;    // 期望的 DNS 记录格式
}

/**
 * DNS 提供商配置
 * 
 * 注意: 使用 IP 地址作为备选，以防 DNS 解析失败
 */
export const DOH_PROVIDERS = {
  google: {
    name: "Google",
    url: "https://dns.google/resolve",
    // 备选: 直接使用 IP（需要忽略 SSL 证书警告）
    ipUrl: "https://8.8.8.8/resolve",
  },
  cloudflare: {
    name: "Cloudflare", 
    url: "https://cloudflare-dns.com/dns-query",
    // Cloudflare 的 IP
    ipUrl: "https://1.1.1.1/dns-query",
  },
  // 阿里云 DNS (中国用户备选)
  alidns: {
    name: "AliDNS",
    url: "https://dns.alidns.com/resolve",
    ipUrl: "https://223.5.5.5/resolve",
  },
} as const;

export type DOHProviderType = keyof typeof DOH_PROVIDERS;

/**
 * 获取 DoH 提供商的 URL（优先使用域名，失败时使用 IP）
 */
export function getDOHUrl(provider: DOHProviderType, useIpFallback = false): string {
  const config = DOH_PROVIDERS[provider];
  return useIpFallback && config.ipUrl ? config.ipUrl : config.url;
}

