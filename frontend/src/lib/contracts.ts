/**
 * Smart Contract Addresses and ABIs for MEME Perp DEX
 */

import { type Address } from "viem";
import TOKEN_FACTORY_ABI_IMPORT from "../abis/TokenFactory.json";

// Export TokenFactory ABI
export const TOKEN_FACTORY_ABI = TOKEN_FACTORY_ABI_IMPORT;

/**
 * Deployed Contract Addresses (Base Sepolia)
 */
export const CONTRACTS = {
  // TokenFactory - Pump.fun 风格 Bonding Curve 代币工厂
  // New deployed (2026-01-25): 0xCfDCD9F8D39411cF855121331B09aef1C88dc056
  TOKEN_FACTORY: (process.env.NEXT_PUBLIC_TOKEN_FACTORY_ADDRESS || "0xCfDCD9F8D39411cF855121331B09aef1C88dc056") as Address,

  // Legacy contracts (may be deprecated)
  MEME_TOKEN: (process.env.NEXT_PUBLIC_MEME_TOKEN_ADDRESS || "0xb6957a1B03DB60EaF3315293AbA44857cb339d33") as Address,
  LP_TOKEN_AMM: (process.env.NEXT_PUBLIC_LP_TOKEN_AMM_ADDRESS || "0x63AC06Fb9dE1EDD666B5ce2fAfFBB1a560CAAF34") as Address,
  LP_TOKEN_LENDING: (process.env.NEXT_PUBLIC_LP_TOKEN_LENDING_ADDRESS || "0xF99000E00ecE4B709BF75849CA729F032924bba2") as Address,
  // Updated perpetual trading contracts (2026-01-25)
  VAULT: (process.env.NEXT_PUBLIC_VAULT_ADDRESS || "0x088ACA5fD043fFf33F4AC6E7F60A23a549C9c9f1") as Address,
  PRICE_FEED: (process.env.NEXT_PUBLIC_PRICE_FEED_ADDRESS || "0x70dAC8f7338fFF15CAB9cE01e896e56a6C2FcF0A") as Address,
  RISK_MANAGER: (process.env.NEXT_PUBLIC_RISK_MANAGER_ADDRESS || "0xeb0a57ad3CC59dc2D7CfaA0EF24EfC07f7f8c2AC") as Address,
  POSITION_MANAGER: (process.env.NEXT_PUBLIC_POSITION_MANAGER_ADDRESS || "0xA61536C0D7B603D32F9e9D33Ad4C90fAA8315bb4") as Address,
  INSURANCE_FUND: (process.env.NEXT_PUBLIC_INSURANCE_FUND_ADDRESS || "0x5AF11d4784c3739cf2FD51Fdc272ae4957ADf7fE") as Address,
  // Other contracts
  AMM: (process.env.NEXT_PUBLIC_AMM_ADDRESS || "0x9ba6958811cf887536E34316Ea732fB40c3fc06c") as Address,
  LENDING_POOL: (process.env.NEXT_PUBLIC_LENDING_POOL_ADDRESS || "0xA488d58915967cfE62bc5f55336972c3FBD6aF01") as Address,
  FUNDING_RATE: (process.env.NEXT_PUBLIC_FUNDING_RATE_ADDRESS || "0x9Abe85f3bBee0f06330E8703e29B327CE551Ba10") as Address,
  LIQUIDATION: (process.env.NEXT_PUBLIC_LIQUIDATION_ADDRESS || "0x468B589c68dBe29b2BC2b765108D63B61805e982") as Address,
  PRESALE: (process.env.NEXT_PUBLIC_PRESALE_ADDRESS || "0x24b5B08971Bbd1C4C90C4980D908364283Ae51DD") as Address,
  ROUTER: (process.env.NEXT_PUBLIC_ROUTER_ADDRESS || "0x98e48863d5c80092211811503AC0532cF7b80f49") as Address,
  // Reader - Batch read contract for optimized data fetching
  READER: (process.env.NEXT_PUBLIC_READER_ADDRESS || "0xD107aB399645ab54869D53e9301850763E890D4F") as Address,
  // Bonding Curve Hook - placeholder for future deployment
  BONDING_CURVE_HOOK: (process.env.NEXT_PUBLIC_BONDING_CURVE_HOOK_ADDRESS || "0x0000000000000000000000000000000000000000") as Address,
} as const;

/**
 * Network Configuration
 */
export const NETWORK_CONFIG = {
  CHAIN_ID: parseInt(process.env.NEXT_PUBLIC_CHAIN_ID || "84532"),
  CHAIN_NAME: "Base Sepolia",
  BLOCK_EXPLORER: process.env.NEXT_PUBLIC_BLOCK_EXPLORER_URL || "https://sepolia.basescan.org",
  RPC_URL: process.env.NEXT_PUBLIC_RPC_URL || "https://sepolia.base.org",
};

/**
 * AMM Contract ABI (Swap Functions)
 */
export const AMM_ABI = [
  // View Functions
  {
    inputs: [],
    name: "isActive",
    outputs: [{ type: "bool" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [],
    name: "getSpotPrice",
    outputs: [{ type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [],
    name: "getReserves",
    outputs: [
      { name: "bnb", type: "uint256" },
      { name: "meme", type: "uint256" },
    ],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [
      { name: "isBuy", type: "bool" },
      { name: "amountIn", type: "uint256" },
    ],
    name: "getAmountOut",
    outputs: [{ type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [
      { name: "isBuy", type: "bool" },
      { name: "amountIn", type: "uint256" },
    ],
    name: "getPriceImpact",
    outputs: [{ type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [],
    name: "swapFee",
    outputs: [{ type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
  // Write Functions
  {
    inputs: [{ name: "minAmountOut", type: "uint256" }],
    name: "swapBNBForMeme",
    outputs: [{ type: "uint256" }],
    stateMutability: "payable",
    type: "function",
  },
  {
    inputs: [
      { name: "memeAmount", type: "uint256" },
      { name: "minAmountOut", type: "uint256" },
    ],
    name: "swapMemeForBNB",
    outputs: [{ type: "uint256" }],
    stateMutability: "nonpayable",
    type: "function",
  },
  // Events
  {
    anonymous: false,
    inputs: [
      { indexed: true, name: "user", type: "address" },
      { indexed: false, name: "isBuy", type: "bool" },
      { indexed: false, name: "amountIn", type: "uint256" },
      { indexed: false, name: "amountOut", type: "uint256" },
      { indexed: false, name: "fee", type: "uint256" },
    ],
    name: "Swap",
    type: "event",
  },
] as const;

/**
 * PriceFeed ABI
 */
export const PRICE_FEED_ABI = [
  {
    inputs: [],
    name: "getMarkPrice",
    outputs: [{ type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [{ name: "token", type: "address" }],
    name: "getTokenMarkPrice",
    outputs: [{ type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [],
    name: "getSpotPrice",
    outputs: [{ type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [{ name: "token", type: "address" }],
    name: "getTokenSpotPrice",
    outputs: [{ type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [],
    name: "getTWAP",
    outputs: [{ type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [{ name: "token", type: "address" }],
    name: "getTokenTWAP",
    outputs: [{ type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [{ name: "token", type: "address" }],
    name: "isTokenSupported",
    outputs: [{ type: "bool" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [],
    name: "lastPrice",
    outputs: [{ type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [],
    name: "lastUpdateTime",
    outputs: [{ type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
] as const;

/**
 * ERC20 ABI (for Token Approval)
 */
export const ERC20_ABI = [
  {
    inputs: [],
    name: "name",
    outputs: [{ type: "string" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [],
    name: "symbol",
    outputs: [{ type: "string" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [],
    name: "decimals",
    outputs: [{ type: "uint8" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [{ name: "account", type: "address" }],
    name: "balanceOf",
    outputs: [{ type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [
      { name: "owner", type: "address" },
      { name: "spender", type: "address" },
    ],
    name: "allowance",
    outputs: [{ type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [
      { name: "spender", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    name: "approve",
    outputs: [{ type: "bool" }],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [
      { name: "to", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    name: "transfer",
    outputs: [{ type: "bool" }],
    stateMutability: "nonpayable",
    type: "function",
  },
] as const;

/**
 * Helper function to get block explorer URL
 */
export function getExplorerUrl(addressOrTx: string, type: "address" | "tx" = "address"): string {
  return `${NETWORK_CONFIG.BLOCK_EXPLORER}/${type}/${addressOrTx}`;
}

/**
 * Check if contracts are configured
 */
export function areContractsConfigured(): boolean {
  return CONTRACTS.AMM !== ("" as Address) && CONTRACTS.MEME_TOKEN !== ("" as Address);
}

/**
 * Get contract configuration for debugging
 */
export function getContractConfig() {
  return {
    contracts: CONTRACTS,
    network: NETWORK_CONFIG,
    configured: areContractsConfigured(),
  };
}
