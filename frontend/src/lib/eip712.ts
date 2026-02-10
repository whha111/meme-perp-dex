/**
 * EIP-712 链 ID 配置
 */

// 支持的链 ID
export const CHAIN_ID_BASE_SEPOLIA = parseInt(process.env.NEXT_PUBLIC_CHAIN_ID_BASE_SEPOLIA || "84532");
export const CHAIN_ID_BASE_MAINNET = parseInt(process.env.NEXT_PUBLIC_CHAIN_ID_BASE_MAINNET || "8453");

/**
 * 验证链 ID 是否在白名单中
 */
export function isValidChainId(chainId: number): boolean {
  return chainId === CHAIN_ID_BASE_SEPOLIA || chainId === CHAIN_ID_BASE_MAINNET;
}

/**
 * 获取链名称用于显示
 */
export function getChainName(chainId: number): string {
  switch (chainId) {
    case CHAIN_ID_BASE_SEPOLIA:
      return "Base Sepolia";
    case CHAIN_ID_BASE_MAINNET:
      return "Base Mainnet";
    default:
      return "Unknown";
  }
}
