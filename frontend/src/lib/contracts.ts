/**
 * Smart Contract Addresses and ABIs for MEME Perp DEX
 */

import { type Address } from "viem";
import TOKEN_FACTORY_ABI_IMPORT from "../abis/TokenFactory.json";

// Export TokenFactory ABI (extract .abi from Foundry JSON format)
export const TOKEN_FACTORY_ABI = TOKEN_FACTORY_ABI_IMPORT.abi;

/**
 * Deployed Contract Addresses (Base Sepolia - Redeployed 2026-02-04)
 */
export const CONTRACTS = {
  // TokenFactory - Pump.fun 风格 Bonding Curve 代币工厂 (Redeployed 2026-02-08: 修复毕业 lockMinting bug)
  TOKEN_FACTORY: (process.env.NEXT_PUBLIC_TOKEN_FACTORY_ADDRESS || "0x583d35e9d407Ea03dE5A2139e792841353CB67b1") as Address,

  // Platform tokens
  MEME_TOKEN: (process.env.NEXT_PUBLIC_MEME_TOKEN_ADDRESS || "0x01eA557E2B17f65604568791Edda8dE1Ae702BE8") as Address,
  LP_TOKEN_AMM: (process.env.NEXT_PUBLIC_AMM_LP_TOKEN_ADDRESS || "0xDCDE3A93366951ECEa17D4926cf184DEaBcde446") as Address,
  LP_TOKEN_LENDING: (process.env.NEXT_PUBLIC_LP_TOKEN_ADDRESS || "0x3b6E307b15dD9d3940B640041d8E1668f24D224a") as Address,

  // Perpetual trading contracts (2026-02-04)
  SETTLEMENT: (process.env.NEXT_PUBLIC_SETTLEMENT_ADDRESS || "0x027131BbC5EF6427826F64D12BACAAb447Ee1B13") as Address,
  VAULT: (process.env.NEXT_PUBLIC_VAULT_ADDRESS || "0x780E415Ffd8104Ee2EECD7418A9227Bb92ebE294") as Address,
  PRICE_FEED: (process.env.NEXT_PUBLIC_PRICE_FEED_ADDRESS || "0xa97a1E55cFfF5C1e45Ac2c1D882717cDD4F44e01") as Address,
  RISK_MANAGER: (process.env.NEXT_PUBLIC_RISK_MANAGER_ADDRESS || "0x28D70e5911fB6F196a15e0Da256BdAf8eB8199a8") as Address,
  POSITION_MANAGER: (process.env.NEXT_PUBLIC_POSITION_MANAGER_ADDRESS || "0xbff432BfBc3505712BB727D3F61E869769DB5724") as Address,
  INSURANCE_FUND: (process.env.NEXT_PUBLIC_INSURANCE_FUND_ADDRESS || "0xFC4dbEDb15717707f9087C8694C36B5c0797479a") as Address,
  CONTRACT_REGISTRY: (process.env.NEXT_PUBLIC_CONTRACT_REGISTRY_ADDRESS || "0x51014b1135820949b4d903f6E144ceA825E6Ac2F") as Address,

  // Stablecoins (MockUSDT/USDC - 可铸造测试币)
  USDT: (process.env.NEXT_PUBLIC_USDT_ADDRESS || "0xAa2a6b49C37E0241f9b5385dc4637eDF51026519") as Address,
  USDC: (process.env.NEXT_PUBLIC_USDC_ADDRESS || "0xb9dD696A78637A1A5237A4e69b95c3f6D8DDC4cD") as Address,
  USD1: (process.env.NEXT_PUBLIC_USD1_ADDRESS || "0xE5Cc3d23f446A000B903624f6a439DEe617dD6F3") as Address,
  WETH: (process.env.NEXT_PUBLIC_WETH_ADDRESS || "0x4200000000000000000000000000000000000006") as Address,

  // Other contracts
  AMM: (process.env.NEXT_PUBLIC_AMM_ADDRESS || "0xfCaf1a4E6840D60C9551C05F9940AE5de9c07976") as Address,
  LENDING_POOL: (process.env.NEXT_PUBLIC_LENDING_POOL_ADDRESS || "0x7Ddb15B5E680D8a74FE44958d18387Bb3999C633") as Address,
  FUNDING_RATE: (process.env.NEXT_PUBLIC_FUNDING_RATE_ADDRESS || "0x82D72703a089fE245763f365876d5445EDc8BA9e") as Address,
  LIQUIDATION: (process.env.NEXT_PUBLIC_LIQUIDATION_ADDRESS || "0x80c720F87cd061B5952d1d84Ce900aa91CBB167B") as Address,
  CONTRACT_SPEC: (process.env.NEXT_PUBLIC_CONTRACT_SPEC_ADDRESS || "0x52Db6E0824d233DEc90C69601B21Fe27AC00d152") as Address,
  ROUTER: (process.env.NEXT_PUBLIC_ROUTER_ADDRESS || "0x185B351132DA84d7d397e1270A9322F4ADf2d665") as Address,

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
