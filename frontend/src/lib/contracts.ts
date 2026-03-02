/**
 * Smart Contract Addresses and ABIs for MEME Perp DEX
 */

import { type Address } from "viem";
import TOKEN_FACTORY_ABI_IMPORT from "../abis/TokenFactory.json";

// Export TokenFactory ABI (extract .abi from Foundry JSON format)
export const TOKEN_FACTORY_ABI = TOKEN_FACTORY_ABI_IMPORT.abi;

/**
 * Deployed Contract Addresses (Base Sepolia - Redeployed 2026-02-28)
 */
export const CONTRACTS = {
  // TokenFactory - Pump.fun 风格 Bonding Curve 代币工厂
  TOKEN_FACTORY: (process.env.NEXT_PUBLIC_TOKEN_FACTORY_ADDRESS || "0xd05A38E6C2a39762De453D90a670ED0Af65ff2f8") as Address,

  // Platform tokens
  MEME_TOKEN: (process.env.NEXT_PUBLIC_MEME_TOKEN_ADDRESS || "0xB3D475Bf9c7427Fd1dC6494227803fE163320d69") as Address,
  LP_TOKEN_AMM: (process.env.NEXT_PUBLIC_AMM_LP_TOKEN_ADDRESS || "0xef54701cab1B76701Aa8B607Bd561E14BD14Db24") as Address,
  LP_TOKEN_LENDING: (process.env.NEXT_PUBLIC_LP_TOKEN_ADDRESS || "0x0e422348A737D9ee57D3B8f17f750dA5743D51eB") as Address,

  // Perpetual trading contracts (2026-02-28)
  SETTLEMENT: (process.env.NEXT_PUBLIC_SETTLEMENT_ADDRESS || "0x1660b3571fB04f16F70aea40ac0E908607061DBE") as Address,
  VAULT: (process.env.NEXT_PUBLIC_VAULT_ADDRESS || "0xcc4Fa8Df0686824F92d392Cb650057EA7D2EF46E") as Address,
  PRICE_FEED: (process.env.NEXT_PUBLIC_PRICE_FEED_ADDRESS || "0x8A57904F9b9392dAB4163a6c372Df1c4Cdd1eb36") as Address,
  RISK_MANAGER: (process.env.NEXT_PUBLIC_RISK_MANAGER_ADDRESS || "0x7fC37B0bD2c8c2646C9087A21e33e2A404AD7A39") as Address,
  POSITION_MANAGER: (process.env.NEXT_PUBLIC_POSITION_MANAGER_ADDRESS || "0x7611a924622B5f6bc4c2ECAAdB6DE078E741AcF6") as Address,
  INSURANCE_FUND: (process.env.NEXT_PUBLIC_INSURANCE_FUND_ADDRESS || "0x93F63c2EEc4bF77FF301Cd14Ef4A392E58e33C69") as Address,
  CONTRACT_REGISTRY: (process.env.NEXT_PUBLIC_CONTRACT_REGISTRY_ADDRESS || "0x218A135F119AcAf00141b979cdFEf432f563437F") as Address,

  // Stablecoins (MockUSDT/USDC - 可铸造测试币)
  USDT: (process.env.NEXT_PUBLIC_USDT_ADDRESS || "0x050C988477F818b19a2f44Feee87a147D8f04DfF") as Address,
  USDC: (process.env.NEXT_PUBLIC_USDC_ADDRESS || "0xC9067996aF0b55414EF025002121Bf289D28c32B") as Address,
  USD1: (process.env.NEXT_PUBLIC_USD1_ADDRESS || "0x0A0FbEac39BeF8258795a742A82d170E8a255025") as Address,
  WETH: (process.env.NEXT_PUBLIC_WETH_ADDRESS || "0x4200000000000000000000000000000000000006") as Address,

  // SettlementV2 (dYdX-style Merkle Withdrawal System - Redeployed 2026-02-28)
  SETTLEMENT_V2: (process.env.NEXT_PUBLIC_SETTLEMENT_V2_ADDRESS || "0x733EccCf612F70621c772D63334Cf5606d7a7C75") as Address,

  // PerpVault (GMX-style LP pool - Deployed 2026-02-28)
  PERP_VAULT: (process.env.NEXT_PUBLIC_PERP_VAULT_ADDRESS || "0x586FB78b8dB39d8D89C1Fd2Aa0c756C828e5251F") as Address,

  // Other contracts
  AMM: (process.env.NEXT_PUBLIC_AMM_ADDRESS || "0x2c23046DC1595754528a10b8340F2AD8fdE05112") as Address,
  LENDING_POOL: (process.env.NEXT_PUBLIC_LENDING_POOL_ADDRESS || "0x98a7665301C0dB32ceff957e1A2c505dF8384CA4") as Address,
  FUNDING_RATE: (process.env.NEXT_PUBLIC_FUNDING_RATE_ADDRESS || "0xD6DD3947F8d80A031b69eBd825Be2384E787dC46") as Address,
  LIQUIDATION: (process.env.NEXT_PUBLIC_LIQUIDATION_ADDRESS || "0x53a5A82C95F3816179F9268002b1a2e4B5455CF4") as Address,
  CONTRACT_SPEC: (process.env.NEXT_PUBLIC_CONTRACT_SPEC_ADDRESS || "0x6AB576624d66e3E60385851ab6Fc65262CEAFafA") as Address,
  ROUTER: (process.env.NEXT_PUBLIC_ROUTER_ADDRESS || "0xF15197BA411b578dafC7936C241bE9DD725c22BE") as Address,

} as const;

/**
 * Network Configuration
 */
export const NETWORK_CONFIG = {
  CHAIN_ID: parseInt(process.env.NEXT_PUBLIC_CHAIN_ID || "84532"),
  CHAIN_NAME: "Base Sepolia",
  BLOCK_EXPLORER: process.env.NEXT_PUBLIC_BLOCK_EXPLORER_URL || "https://sepolia.basescan.org",
  RPC_URL: process.env.NEXT_PUBLIC_RPC_URL || "https://base-sepolia-rpc.publicnode.com",
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
  // TWAP functions removed - 内盘合约100%硬锚现货价格，不需要TWAP
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
 * SettlementV2 ABI (Merkle Withdrawal System)
 */
export const SETTLEMENT_V2_ABI = [
  {
    inputs: [{ name: "amount", type: "uint256" }],
    name: "deposit",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [
      { name: "to", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    name: "depositFor",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [
      { name: "amount", type: "uint256" },
      { name: "userEquity", type: "uint256" },
      { name: "merkleProof", type: "bytes32[]" },
      { name: "deadline", type: "uint256" },
      { name: "signature", type: "bytes" },
    ],
    name: "withdraw",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [{ name: "account", type: "address" }],
    name: "userDeposits",
    outputs: [{ type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [],
    name: "collateralToken",
    outputs: [{ type: "address" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [],
    name: "currentStateRoot",
    outputs: [{ type: "bytes32" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [],
    name: "platformSigner",
    outputs: [{ type: "address" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [{ name: "account", type: "address" }],
    name: "withdrawalNonces",
    outputs: [{ type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
  // Events
  {
    anonymous: false,
    inputs: [
      { indexed: true, name: "user", type: "address" },
      { indexed: false, name: "amount", type: "uint256" },
    ],
    name: "Deposited",
    type: "event",
  },
  {
    anonymous: false,
    inputs: [
      { indexed: true, name: "user", type: "address" },
      { indexed: false, name: "amount", type: "uint256" },
      { indexed: false, name: "nonce", type: "uint256" },
    ],
    name: "Withdrawn",
    type: "event",
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
