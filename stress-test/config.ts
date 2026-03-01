/**
 * Stress Test Configuration
 *
 * All contract addresses, RPC settings, rate limits, and wallet groupings.
 * Based on empirical RPC rate limit testing (90% of observed maximums).
 */
import type { Address } from "viem";

// ── RPC Endpoints ──────────────────────────────────────────────
export const RPC = {
  http: "https://base-sepolia-rpc.publicnode.com",
  wss: "wss://base-sepolia-rpc.publicnode.com",
  httpBackup: "https://base-sepolia.g.alchemy.com/v2/Dr8sMe-1MYIF7jBYuZZj8PMOPAAeJ16d",
} as const;

// ── Rate Limits (90% of empirically tested maximums) ───────────
export const RATE_LIMITS = {
  httpReqPerSec: 45,       // Tested: ≥50 req/s sustained
  wssReqPerSec: 18,        // Tested: ≥20 req/s sustained
  wssMaxConnections: 135,  // Tested: ~150-170 before 429
  maxRetries: 3,
  retryBaseDelayMs: 1000,  // Exponential backoff base
  batchSize: 30,           // JSON-RPC batch size per request
} as const;

// ── Chain Config ───────────────────────────────────────────────
export const CHAIN = {
  id: 84532,
  name: "Base Sepolia",
} as const;

// ── Contract Addresses (Base Sepolia - Redeployed 2026-02-28) ──
// Settlement must match matching engine's EIP-712 verifyingContract
export const CONTRACTS = {
  settlement: "0x1660b3571fB04f16F70aea40ac0E908607061DBE" as Address,       // Settlement V1
  settlementV2: "0x733EccCf612F70621c772D63334Cf5606d7a7C75" as Address,     // SettlementV2 (dYdX-style Merkle)
  tokenFactory: "0x757eF02C2233b8cE2161EE65Fb7D626776b8CB73" as Address,      // Spot trading (TokenFactory)
  perpTokenFactory: "0x757eF02C2233b8cE2161EE65Fb7D626776b8CB73" as Address,  // Same as tokenFactory (unified)
  positionManager: "0x7611a924622B5f6bc4c2ECAAdB6DE078E741AcF6" as Address,
  priceFeed: "0xfB347BC4Cc61C7FdCD862ED212A0e3866d205112" as Address,
  liquidation: "0x6Fb6325094B24AE5f458f7a34C63BE30Da9aAECA" as Address,
  insuranceFund: "0x93F63c2EEc4bF77FF301Cd14Ef4A392E58e33C69" as Address,
  fundingRate: "0xD6DD3947F8d80A031b69eBd825Be2384E787dC46" as Address,
  vault: "0xcc4Fa8Df0686824F92d392Cb650057EA7D2EF46E" as Address,
  lendingPool: "0x98a7665301C0dB32ceff957e1A2c505dF8384CA4" as Address,
  perpVault: "0x586FB78b8dB39d8D89C1Fd2Aa0c756C828e5251F" as Address,
} as const;

// ── Matching Engine ────────────────────────────────────────────
export const MATCHING_ENGINE = {
  url: "http://localhost:8081",
  submitEndpoint: "/api/order/submit",
} as const;

// ── EIP-712 Signing ────────────────────────────────────────────
export const EIP712_DOMAIN = {
  name: "MemePerp",
  version: "1",
  chainId: CHAIN.id,
  verifyingContract: CONTRACTS.settlement,
} as const;

export const ORDER_TYPES = {
  Order: [
    { name: "trader", type: "address" },
    { name: "token", type: "address" },
    { name: "isLong", type: "bool" },
    { name: "size", type: "uint256" },
    { name: "leverage", type: "uint256" },
    { name: "price", type: "uint256" },
    { name: "deadline", type: "uint256" },
    { name: "nonce", type: "uint256" },
    { name: "orderType", type: "uint8" },
  ],
} as const;

// ── Wallet Grouping ────────────────────────────────────────────
export const WALLET_GROUPS = {
  spot: { start: 0, count: 200 },   // Indices 0-199 for spot trading
  perp: { start: 200, count: 100 }, // Indices 200-299 for perp trading
} as const;

// ── Wallet Source Files ────────────────────────────────────────
export const WALLET_SOURCES = {
  main: new URL("../backend/src/matching/main-wallets.json", import.meta.url).pathname,
  extended: "/Users/qinlinqiu/Desktop/Namespace/scripts/market-maker/wallets.json",
} as const;

// ── Trading Parameters ─────────────────────────────────────────
export const SPOT_CONFIG = {
  walletsPerRound: [3, 5],           // Random 3-5 wallets per round
  roundIntervalMs: [1000, 3000],     // 1-3s between rounds
  buyProbability: 0.4,
  sellProbability: 0.3,
  createTokenProbability: 0.15,
  // remaining 0.15 = provide liquidity
  minBuyEth: 0.001,
  maxBuyEth: 0.01,
  sellPercentRange: [0.1, 0.5],      // Sell 10-50% of token holdings
} as const;

export const PERP_CONFIG = {
  walletsPerRound: [2, 4],           // Random 2-4 wallets per round
  roundIntervalMs: [1500, 4000],     // 1.5-4s between rounds
  openLongProbability: 0.30,
  openShortProbability: 0.30,
  closeProbability: 0.25,
  addMarginProbability: 0.10,
  highLeverageProbability: 0.05,     // 50x-100x for liquidation testing
  leverageRange: [2, 30],            // Normal leverage range
  highLeverageRange: [50, 100],
  minSizeEth: 0.001,
  maxSizeEth: 0.05,
  leveragePrecision: 10000n,         // Contract uses 1e4 for leverage
} as const;

// ── Monitor Intervals ──────────────────────────────────────────
export const MONITOR_INTERVALS = {
  fundAuditMs: 5 * 60 * 1000,         // Every 5 minutes
  pnlTrackMs: 2 * 60 * 1000,          // Every 2 minutes
  insuranceTrackMs: 2 * 60 * 1000,    // Every 2 minutes
  liquidationScanMs: 60 * 1000,       // Every 1 minute
  profitWithdrawalMs: 60 * 60 * 1000, // Every 1 hour
  checkpointMs: 10 * 60 * 1000,       // Every 10 minutes
  summaryMs: 5 * 60 * 1000,           // Every 5 minutes
} as const;

// ── Scenario Config ────────────────────────────────────────────
export const SCENARIO_CONFIG = {
  intervalHoursRange: [3, 6],        // 3-6 hours between scenarios
  minExecutionsPerScenario: 2,       // Each scenario runs at least 2x in 48h
  prePostAuditDelayMs: 30_000,       // 30s delay before/after for audit
} as const;

// ── Fund Audit Thresholds ──────────────────────────────────────
export const AUDIT_THRESHOLDS = {
  conservationToleranceEth: 0.5,    // ±0.5 ETH tolerance (300 wallets batch deposit drift)
  alertToleranceEth: 2.0,           // Alert if > 2 ETH deviation
  pauseToleranceEth: 10.0,          // Pause only on serious deviation (10+ ETH)
} as const;

// ── ABIs ───────────────────────────────────────────────────────
export const SETTLEMENT_ABI = [
  // depositETH: send native ETH → contract wraps to WETH → credits user available balance
  { inputs: [], name: "depositETH", outputs: [], stateMutability: "payable", type: "function" },
  // deposit: ERC20 deposit (approve first, then call with token address + amount)
  { inputs: [{ name: "token", type: "address" }, { name: "amount", type: "uint256" }], name: "deposit", outputs: [], stateMutability: "nonpayable", type: "function" },
  { inputs: [{ name: "user", type: "address" }], name: "getUserBalance", outputs: [{ name: "available", type: "uint256" }, { name: "locked", type: "uint256" }], stateMutability: "view", type: "function" },
  { inputs: [{ name: "user", type: "address" }], name: "balances", outputs: [{ name: "available", type: "uint256" }, { name: "locked", type: "uint256" }], stateMutability: "view", type: "function" },
  { inputs: [{ name: "user", type: "address" }], name: "nonces", outputs: [{ type: "uint256" }], stateMutability: "view", type: "function" },
  { inputs: [{ name: "token", type: "address" }, { name: "amount", type: "uint256" }], name: "withdraw", outputs: [], stateMutability: "nonpayable", type: "function" },
] as const;

export const TOKEN_FACTORY_ABI = [
  { inputs: [{ name: "tokenAddress", type: "address" }, { name: "minTokensOut", type: "uint256" }], name: "buy", outputs: [], stateMutability: "payable", type: "function" },
  { inputs: [{ name: "tokenAddress", type: "address" }, { name: "tokenAmount", type: "uint256" }, { name: "minETHOut", type: "uint256" }], name: "sell", outputs: [], stateMutability: "nonpayable", type: "function" },
  { inputs: [{ name: "tokenAddress", type: "address" }], name: "getPoolState", outputs: [{ components: [{ name: "realETHReserve", type: "uint256" }, { name: "realTokenReserve", type: "uint256" }, { name: "soldTokens", type: "uint256" }, { name: "isGraduated", type: "bool" }, { name: "isActive", type: "bool" }, { name: "creator", type: "address" }, { name: "createdAt", type: "uint64" }, { name: "metadataURI", type: "string" }], type: "tuple" }], stateMutability: "view", type: "function" },
  { inputs: [{ name: "tokenAddress", type: "address" }], name: "getCurrentPrice", outputs: [{ type: "uint256" }], stateMutability: "view", type: "function" },
  { inputs: [{ name: "name", type: "string" }, { name: "symbol", type: "string" }, { name: "metadataURI", type: "string" }, { name: "minTokensOut", type: "uint256" }], name: "createToken", outputs: [{ type: "address" }], stateMutability: "payable", type: "function" },
  { inputs: [], name: "getAllTokens", outputs: [{ type: "address[]" }], stateMutability: "view", type: "function" },
] as const;

export const PRICE_FEED_ABI = [
  { inputs: [{ name: "token", type: "address" }], name: "getPrice", outputs: [{ type: "uint256" }], stateMutability: "view", type: "function" },
  { inputs: [{ name: "token", type: "address" }, { name: "price", type: "uint256" }], name: "updateTokenPrice", outputs: [], stateMutability: "nonpayable", type: "function" },
] as const;

export const POSITION_MANAGER_ABI = [
  { inputs: [{ name: "user", type: "address" }, { name: "token", type: "address" }], name: "getPositionByToken", outputs: [{ components: [{ name: "size", type: "uint256" }, { name: "collateral", type: "uint256" }, { name: "avgPrice", type: "uint256" }, { name: "isLong", type: "bool" }, { name: "lastFundingIndex", type: "uint256" }, { name: "openTimestamp", type: "uint256" }], type: "tuple" }], stateMutability: "view", type: "function" },
  { inputs: [{ name: "user", type: "address" }, { name: "token", type: "address" }], name: "getLiquidationPrice", outputs: [{ type: "uint256" }], stateMutability: "view", type: "function" },
  { inputs: [{ name: "user", type: "address" }, { name: "token", type: "address" }], name: "getUnrealizedPnl", outputs: [{ name: "pnl", type: "int256" }, { name: "hasProfit", type: "bool" }], stateMutability: "view", type: "function" },
] as const;

export const LIQUIDATION_ABI = [
  { inputs: [{ name: "user", type: "address" }, { name: "token", type: "address" }], name: "liquidate", outputs: [], stateMutability: "nonpayable", type: "function" },
  { inputs: [{ name: "user", type: "address" }, { name: "token", type: "address" }], name: "isLiquidatable", outputs: [{ type: "bool" }], stateMutability: "view", type: "function" },
] as const;

export const FUNDING_RATE_ABI = [
  { inputs: [{ name: "token", type: "address" }], name: "getCurrentFundingRate", outputs: [{ type: "int256" }], stateMutability: "view", type: "function" },
  { inputs: [{ name: "token", type: "address" }], name: "accumulatedFundingRate", outputs: [{ type: "int256" }], stateMutability: "view", type: "function" },
] as const;

export const INSURANCE_FUND_ABI = [
  { inputs: [], name: "getBalance", outputs: [{ type: "uint256" }], stateMutability: "view", type: "function" },
] as const;
