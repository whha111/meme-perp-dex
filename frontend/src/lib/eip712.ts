/**
 * EIP-712 Configuration for DomainFi (LEGACY)
 *
 * ⚠️ DEPRECATED: This file is for legacy DomainPump features only.
 *
 * ⚠️ FOR PERPETUAL TRADING: Use /utils/orderSigning.ts instead
 *    - Perpetual contracts use Domain Name: "MemePerp"
 *    - This file uses Domain Name: "DomainPump" (CONFLICT!)
 *
 * DO NOT USE THIS FILE FOR NEW FEATURES
 */

import { type Address } from "viem";

// =====================================================
// EIP-712 Domain Constants (LEGACY - DO NOT USE FOR PERPS)
// =====================================================

export const EIP712_DOMAIN_NAME = "DomainPump";  // ⚠️ NOT for perpetual trading!
export const EIP712_DOMAIN_VERSION = "1";
export const CHAIN_ID_BASE_SEPOLIA = parseInt(process.env.NEXT_PUBLIC_CHAIN_ID_BASE_SEPOLIA || "84532");
export const CHAIN_ID_BASE_MAINNET = parseInt(process.env.NEXT_PUBLIC_CHAIN_ID_BASE_MAINNET || "8453");

// Contract addresses loaded from environment variables
export const HOOK_PROXY_ADDRESS = (process.env.NEXT_PUBLIC_BONDING_CURVE_HOOK_ADDRESS || "") as Address;
export const REGISTRY_PROXY_ADDRESS = (process.env.NEXT_PUBLIC_DOMAIN_REGISTRY_ADDRESS || "") as Address;

/**
 * TradeOrder type for EIP-712 signing - PURGED
 */
export const TRADE_ORDER_TYPES = {} as const;

/**
 * EIP-712 Domain for signing
 */
export interface EIP712Domain {
  name: string;
  version: string;
  chainId: number;
  verifyingContract: Address;
}

/**
 * TradeOrder message for signing
 */
export interface TradeOrderMessage {
  domain: string;       // Domain name (e.g., "example.com")
  trader: Address;      // Trader wallet address
  amountIn: bigint;     // Input amount in wei
  minAmountOut: bigint; // Minimum output amount (after slippage)
  isBuy: boolean;       // true = buy tokens with ETH, false = sell tokens for ETH
  deadline: bigint;     // Unix timestamp deadline
  nonce: bigint;        // Unique nonce for the order
}

/**
 * Get the EIP-712 domain configuration for a given chain
 * 
 * @param chainId - The chain ID (must be Base Sepolia or Base Mainnet)
 * @param verifyingContract - The contract that will verify the signature (default: Hook Proxy)
 */
export function getEIP712Domain(
  chainId: number = CHAIN_ID_BASE_SEPOLIA,
  verifyingContract: Address = HOOK_PROXY_ADDRESS
): EIP712Domain {
  // Validate chain ID (whitelist check, matching backend)
  if (chainId !== CHAIN_ID_BASE_SEPOLIA && chainId !== CHAIN_ID_BASE_MAINNET) {
    console.error(
      `[EIP-712] Invalid Chain ID: ${chainId}. ` +
      `Only Base Sepolia (${CHAIN_ID_BASE_SEPOLIA}) or Base Mainnet (${CHAIN_ID_BASE_MAINNET}) are allowed.`
    );
    throw new Error(`Invalid Chain ID: ${chainId}`);
  }

  return {
    name: EIP712_DOMAIN_NAME,
    version: EIP712_DOMAIN_VERSION,
    chainId,
    verifyingContract,
  };
}

/**
 * Create typed data for signing a TradeOrder
 * Compatible with wagmi's useSignTypedData hook
 * 
 * @example
 * ```tsx
 * const { signTypedData } = useSignTypedData();
 * 
 * const typedData = createTradeOrderTypedData({
 *   domain: "example.com",
 *   trader: address,
 *   amountIn: parseUnits("0.1", 18),
 *   minAmountOut: parseUnits("100", 18),
 *   isBuy: true,
 *   deadline: BigInt(Date.now() / 1000 + 1200),
 *   nonce: 0n,
 * }, chainId);
 * 
 * await signTypedData(typedData);
 * ```
 */
export function createTradeOrderTypedData(
  message: TradeOrderMessage,
  chainId: number = CHAIN_ID_BASE_SEPOLIA,
  verifyingContract: Address = HOOK_PROXY_ADDRESS
) {
  const domain = getEIP712Domain(chainId, verifyingContract);

  return {
    domain,
    types: TRADE_ORDER_TYPES,
    primaryType: "TradeOrder" as const,
    message: {
      domain: message.domain,
      trader: message.trader,
      amountIn: message.amountIn,
      minAmountOut: message.minAmountOut,
      isBuy: message.isBuy,
      deadline: message.deadline,
      nonce: message.nonce,
    },
  };
}

/**
 * Validate that chain ID is in the allowed whitelist
 */
export function isValidChainId(chainId: number): boolean {
  return chainId === CHAIN_ID_BASE_SEPOLIA || chainId === CHAIN_ID_BASE_MAINNET;
}

/**
 * Get chain name for display
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

