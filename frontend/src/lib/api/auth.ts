/**
 * Authentication utilities (未对接版本)
 *
 * 接口保留，未对接真实认证
 * TODO: 对接真实钱包认证
 */

// ============================================================
// Types (保留所有类型定义)
// ============================================================

export interface APICredentials {
  apiKey: string;
  apiSecret: string;
  address: string;
  expiresAt: number;
}

export interface LoginResult {
  success: boolean;
  credentials?: APICredentials;
  error?: string;
}

// ============================================================
// 未对接的函数实现
// ============================================================

/**
 * Get stored API credentials
 * TODO: 对接真实认证
 */
export function getStoredCredentials(): APICredentials | null {
  // 未对接 - 返回 null
  return null;
}

/**
 * Store API credentials
 * TODO: 对接真实认证
 */
export function storeCredentials(_credentials: APICredentials): void {
  // 未对接 - 不执行任何操作
}

/**
 * Clear stored credentials
 * TODO: 对接真实认证
 */
export function clearCredentials(): void {
  // 未对接 - 不执行任何操作
}

/**
 * Check if user is authenticated
 * TODO: 对接真实认证
 */
export function isAuthenticated(): boolean {
  // 未对接 - 返回 false
  return false;
}

/**
 * Generate HMAC-SHA256 signature for API request
 * TODO: 对接真实签名
 */
export function generateSignature(
  _secret: string,
  _timestamp: string,
  _method: string,
  _path: string,
  _body: string = ""
): string {
  // 未对接 - 返回空字符串
  return "";
}

/**
 * Create authentication headers for API request
 * TODO: 对接真实认证
 */
export function createAuthHeaders(
  _method: string,
  _path: string,
  _body?: string
): Record<string, string> {
  // 未对接 - 返回空对象
  return {};
}

/**
 * Perform login with wallet signature
 * TODO: 对接真实钱包认证
 */
export async function loginWithWallet(
  _address: string,
  _signMessage: (message: string) => Promise<string>,
  _apiBaseUrl: string
): Promise<LoginResult> {
  // 未对接 - 返回失败
  return {
    success: false,
    error: "认证服务未对接",
  };
}

/**
 * Logout - clear stored credentials
 * TODO: 对接真实认证
 */
export function logout(): void {
  // 未对接 - 不执行任何操作
}
