"use client";

/**
 * @deprecated 使用 usePerpetualV2.ts 代替
 *
 * ⚠️ DEPRECATED: This hook uses the old PositionManager system
 *
 * 问题:
 * - 使用 PositionManager + Vault (旧架构)
 * - 与 Settlement 系统冲突
 * - 不支持链下撮合
 *
 * 新系统: usePerpetualV2.ts
 * - 使用 Settlement 合约 (新架构)
 * - EIP-712 订单签名 + 链下撮合
 * - 统一的配对仓位模型
 *
 * TODO: 迁移所有使用此 Hook 的组件到 usePerpetualV2
 */

import { useState, useCallback, useMemo, useEffect } from "react";
import {
  useAccount,
  useBalance,
  useReadContract,
  useWriteContract,
  useWaitForTransactionReceipt,
} from "wagmi";
import { parseEther, formatEther, type Address } from "viem";
import { CONTRACTS } from "@/lib/contracts";

/**
 * PositionManager ABI - Core functions for perpetual trading
 * F-01/F-02 Fix: 添加多代币支持函数
 */
export const POSITION_MANAGER_ABI = [
  // ============================================================
  // Legacy View Functions (for backward compatibility)
  // ============================================================
  {
    inputs: [{ name: "user", type: "address" }],
    name: "getPosition",
    outputs: [
      {
        components: [
          { name: "isLong", type: "bool" },
          { name: "size", type: "uint256" },
          { name: "collateral", type: "uint256" },
          { name: "entryPrice", type: "uint256" },
          { name: "leverage", type: "uint256" },
          { name: "lastFundingTime", type: "uint256" },
          { name: "accFundingFee", type: "int256" },
        ],
        type: "tuple",
      },
    ],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [{ name: "user", type: "address" }],
    name: "getUnrealizedPnL",
    outputs: [{ type: "int256" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [{ name: "user", type: "address" }],
    name: "getMarginRatio",
    outputs: [{ type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [{ name: "user", type: "address" }],
    name: "getLiquidationPrice",
    outputs: [{ type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
  // ============================================================
  // H-016: Multi-token View Functions (正确的多代币函数)
  // ============================================================
  {
    inputs: [
      { name: "user", type: "address" },
      { name: "token", type: "address" },
    ],
    name: "getPositionByToken",
    outputs: [
      {
        components: [
          { name: "token", type: "address" },
          { name: "isLong", type: "bool" },
          { name: "size", type: "uint256" },
          { name: "collateral", type: "uint256" },
          { name: "entryPrice", type: "uint256" },
          { name: "leverage", type: "uint256" },
          { name: "lastFundingTime", type: "uint256" },
          { name: "accFundingFee", type: "int256" },
          { name: "marginMode", type: "uint8" },
        ],
        type: "tuple",
      },
    ],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [
      { name: "user", type: "address" },
      { name: "token", type: "address" },
    ],
    name: "getTokenUnrealizedPnL",
    outputs: [{ type: "int256" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [
      { name: "user", type: "address" },
      { name: "token", type: "address" },
    ],
    name: "getTokenLiquidationPrice",
    outputs: [{ type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [
      { name: "user", type: "address" },
      { name: "token", type: "address" },
    ],
    name: "canLiquidateToken",
    outputs: [{ type: "bool" }],
    stateMutability: "view",
    type: "function",
  },
  // F-06: 保证金率
  {
    inputs: [
      { name: "user", type: "address" },
      { name: "token", type: "address" },
    ],
    name: "getTokenMarginRatio",
    outputs: [{ type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [{ name: "token", type: "address" }],
    name: "getTokenTotalLongSize",
    outputs: [{ type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [{ name: "token", type: "address" }],
    name: "getTokenTotalShortSize",
    outputs: [{ type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
  // ============================================================
  // Common View Functions
  // ============================================================
  {
    inputs: [
      { name: "user", type: "address" },
      { name: "isLong", type: "bool" },
      { name: "size", type: "uint256" },
      { name: "leverage", type: "uint256" },
    ],
    name: "canOpenPosition",
    outputs: [
      { name: "isValid", type: "bool" },
      { name: "reason", type: "string" },
    ],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [],
    name: "openFeeRate",
    outputs: [{ type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [],
    name: "closeFeeRate",
    outputs: [{ type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [],
    name: "totalLongSize",
    outputs: [{ type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [],
    name: "totalShortSize",
    outputs: [{ type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
  // ============================================================
  // Legacy Write Functions
  // ============================================================
  {
    inputs: [
      { name: "size", type: "uint256" },
      { name: "leverage", type: "uint256" },
    ],
    name: "openLong",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [
      { name: "size", type: "uint256" },
      { name: "leverage", type: "uint256" },
    ],
    name: "openShort",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [],
    name: "closePosition",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [{ name: "percentage", type: "uint256" }],
    name: "closePositionPartial",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
  // ============================================================
  // H-016: Multi-token Write Functions (正确的多代币函数)
  // ============================================================
  {
    inputs: [
      { name: "token", type: "address" },
      { name: "size", type: "uint256" },
      { name: "leverage", type: "uint256" },
      { name: "mode", type: "uint8" },
    ],
    name: "openLongToken",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [
      { name: "token", type: "address" },
      { name: "size", type: "uint256" },
      { name: "leverage", type: "uint256" },
      { name: "mode", type: "uint8" },
    ],
    name: "openShortToken",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [{ name: "token", type: "address" }],
    name: "closePositionToken",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [
      { name: "token", type: "address" },
      { name: "percentage", type: "uint256" },
    ],
    name: "closePositionTokenPartial",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
  // ============================================================
  // Collateral Functions
  // ============================================================
  {
    inputs: [{ name: "amount", type: "uint256" }],
    name: "addCollateral",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [{ name: "amount", type: "uint256" }],
    name: "removeCollateral",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
  // Note: adjustLeverage is NOT implemented in the contract
  // Users should close and reopen position with new leverage
  // Events
  {
    anonymous: false,
    inputs: [
      { indexed: true, name: "user", type: "address" },
      { indexed: false, name: "isLong", type: "bool" },
      { indexed: false, name: "size", type: "uint256" },
      { indexed: false, name: "collateral", type: "uint256" },
      { indexed: false, name: "leverage", type: "uint256" },
      { indexed: false, name: "entryPrice", type: "uint256" },
      { indexed: false, name: "fee", type: "uint256" },
    ],
    name: "PositionOpened",
    type: "event",
  },
  {
    anonymous: false,
    inputs: [
      { indexed: true, name: "user", type: "address" },
      { indexed: false, name: "isLong", type: "bool" },
      { indexed: false, name: "size", type: "uint256" },
      { indexed: false, name: "entryPrice", type: "uint256" },
      { indexed: false, name: "exitPrice", type: "uint256" },
      { indexed: false, name: "pnl", type: "int256" },
      { indexed: false, name: "fee", type: "uint256" },
    ],
    name: "PositionClosed",
    type: "event",
  },
] as const;

/**
 * Vault ABI - Deposit and Withdraw
 */
export const VAULT_ABI = [
  {
    inputs: [],
    name: "deposit",
    outputs: [],
    stateMutability: "payable",
    type: "function",
  },
  {
    inputs: [{ name: "amount", type: "uint256" }],
    name: "withdraw",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [{ name: "user", type: "address" }],
    name: "getBalance",
    outputs: [{ type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [{ name: "user", type: "address" }],
    name: "getTotalBalance",
    outputs: [{ type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [{ name: "user", type: "address" }],
    name: "getLockedBalance",
    outputs: [{ type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
] as const;

/**
 * PriceFeed ABI
 * H-016: 添加多代币价格支持
 */
export const PRICE_FEED_ABI = [
  // Legacy single-token functions
  {
    inputs: [],
    name: "getMarkPrice",
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
    inputs: [],
    name: "getTWAP",
    outputs: [{ type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
  // H-016: Multi-token price functions
  {
    inputs: [{ name: "token", type: "address" }],
    name: "getTokenMarkPrice",
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
] as const;

/**
 * Position data structure (Legacy)
 */
export interface Position {
  isLong: boolean;
  size: bigint;
  collateral: bigint;
  entryPrice: bigint;
  leverage: bigint;
  lastFundingTime: bigint;
  accFundingFee: bigint;
}

/**
 * H-016: Multi-token Position data structure
 */
export interface TokenPosition {
  token: Address;
  isLong: boolean;
  size: bigint;
  collateral: bigint;
  entryPrice: bigint;
  leverage: bigint;
  lastFundingTime: bigint;
  accFundingFee: bigint;
  marginMode: number; // 0 = ISOLATED, 1 = CROSS
}

/**
 * Hook return type
 */
export interface UsePerpetualReturn {
  // User position
  position: Position | null;
  hasPosition: boolean;
  unrealizedPnL: bigint | null;
  marginRatio: bigint | null;
  liquidationPrice: bigint | null;

  // Vault balances
  vaultBalance: bigint | null;
  availableBalance: bigint | null;
  lockedMargin: bigint | null;
  walletBalance: bigint | undefined;

  // Market data
  markPrice: bigint | null;
  openFeeRate: bigint | null;
  closeFeeRate: bigint | null;
  totalLongSize: bigint | null;
  totalShortSize: bigint | null;

  // Actions
  deposit: (amount: string) => Promise<void>;
  withdraw: (amount: string) => Promise<void>;
  openLong: (size: string, leverage: number) => Promise<void>;
  openShort: (size: string, leverage: number) => Promise<void>;
  closePosition: () => Promise<void>;
  closePositionPartial: (percentage: number) => Promise<void>;
  addCollateral: (amount: string) => Promise<void>;
  removeCollateral: (amount: string) => Promise<void>;
  adjustLeverage: (newLeverage: number) => Promise<void>;

  // Validation
  canOpenPosition: (isLong: boolean, size: string, leverage: number) => Promise<{ isValid: boolean; reason: string }>;

  // Status
  isLoading: boolean;
  isPending: boolean;
  isConfirming: boolean;
  error: Error | null;
  txHash: `0x${string}` | undefined;
}

const LEVERAGE_PRECISION = 10000n; // 杠杆精度

/**
 * Hook for perpetual contract trading
 */
export function usePerpetual(): UsePerpetualReturn {
  const { address, isConnected } = useAccount();
  const [error, setError] = useState<Error | null>(null);

  // Wallet ETH balance
  const { data: walletBalanceData } = useBalance({
    address: address,
  });

  // Vault balance
  const { data: vaultBalance, refetch: refetchVaultBalance } = useReadContract({
    address: CONTRACTS.VAULT,
    abi: VAULT_ABI,
    functionName: "getBalance",
    args: address ? [address] : undefined,
    query: {
      enabled: !!address,
    },
  });

  // Total balance (available + locked)
  const { data: totalBalance, refetch: refetchTotalBalance } = useReadContract({
    address: CONTRACTS.VAULT,
    abi: VAULT_ABI,
    functionName: "getTotalBalance",
    args: address ? [address] : undefined,
    query: {
      enabled: !!address,
    },
  });

  // Locked balance (margin)
  const { data: lockedMargin } = useReadContract({
    address: CONTRACTS.VAULT,
    abi: VAULT_ABI,
    functionName: "getLockedBalance",
    args: address ? [address] : undefined,
    query: {
      enabled: !!address,
    },
  });

  // Calculate available balance (total - locked)
  const availableBalance = useMemo(() => {
    if (totalBalance === undefined || totalBalance === null) return null;
    if (lockedMargin === undefined || lockedMargin === null) return totalBalance;
    return (totalBalance as bigint) - (lockedMargin as bigint);
  }, [totalBalance, lockedMargin]);

  // Position data
  const { data: positionData, refetch: refetchPosition } = useReadContract({
    address: CONTRACTS.POSITION_MANAGER,
    abi: POSITION_MANAGER_ABI,
    functionName: "getPosition",
    args: address ? [address] : undefined,
    query: {
      enabled: !!address,
    },
  });

  // Unrealized PnL
  const { data: unrealizedPnL, refetch: refetchPnL } = useReadContract({
    address: CONTRACTS.POSITION_MANAGER,
    abi: POSITION_MANAGER_ABI,
    functionName: "getUnrealizedPnL",
    args: address ? [address] : undefined,
    query: {
      enabled: !!address,
    },
  });

  // Margin ratio
  const { data: marginRatio } = useReadContract({
    address: CONTRACTS.POSITION_MANAGER,
    abi: POSITION_MANAGER_ABI,
    functionName: "getMarginRatio",
    args: address ? [address] : undefined,
    query: {
      enabled: !!address,
    },
  });

  // Liquidation price
  const { data: liquidationPrice } = useReadContract({
    address: CONTRACTS.POSITION_MANAGER,
    abi: POSITION_MANAGER_ABI,
    functionName: "getLiquidationPrice",
    args: address ? [address] : undefined,
    query: {
      enabled: !!address,
    },
  });

  // Mark price
  const { data: markPrice } = useReadContract({
    address: CONTRACTS.PRICE_FEED,
    abi: PRICE_FEED_ABI,
    functionName: "getMarkPrice",
  });

  // Fee rates
  const { data: openFeeRate } = useReadContract({
    address: CONTRACTS.POSITION_MANAGER,
    abi: POSITION_MANAGER_ABI,
    functionName: "openFeeRate",
  });

  const { data: closeFeeRate } = useReadContract({
    address: CONTRACTS.POSITION_MANAGER,
    abi: POSITION_MANAGER_ABI,
    functionName: "closeFeeRate",
  });

  // Total sizes
  const { data: totalLongSize } = useReadContract({
    address: CONTRACTS.POSITION_MANAGER,
    abi: POSITION_MANAGER_ABI,
    functionName: "totalLongSize",
  });

  const { data: totalShortSize } = useReadContract({
    address: CONTRACTS.POSITION_MANAGER,
    abi: POSITION_MANAGER_ABI,
    functionName: "totalShortSize",
  });

  // Contract writes
  const {
    writeContract,
    data: txHash,
    isPending,
    reset: resetWrite,
  } = useWriteContract();

  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({
    hash: txHash,
  });

  // Refetch data after successful transaction
  useEffect(() => {
    if (isSuccess) {
      refetchPosition();
      refetchVaultBalance();
      refetchTotalBalance();
      refetchPnL();
      resetWrite();
    }
  }, [isSuccess, refetchPosition, refetchVaultBalance, refetchTotalBalance, refetchPnL, resetWrite]);

  // Parse position data
  const position = useMemo(() => {
    if (!positionData || (positionData as any).size === 0n) return null;
    const p = positionData as any;
    return {
      isLong: p.isLong,
      size: p.size,
      collateral: p.collateral,
      entryPrice: p.entryPrice,
      leverage: p.leverage,
      lastFundingTime: p.lastFundingTime,
      accFundingFee: p.accFundingFee,
    };
  }, [positionData]);

  // Deposit to vault
  const deposit = useCallback(
    async (amount: string) => {
      if (!address) throw new Error("Wallet not connected");
      setError(null);
      try {
        writeContract({
          address: CONTRACTS.VAULT,
          abi: VAULT_ABI,
          functionName: "deposit",
          value: parseEther(amount),
        });
      } catch (err) {
        setError(err as Error);
        throw err;
      }
    },
    [address, writeContract]
  );

  // Withdraw from vault
  const withdraw = useCallback(
    async (amount: string) => {
      if (!address) throw new Error("Wallet not connected");
      setError(null);
      try {
        writeContract({
          address: CONTRACTS.VAULT,
          abi: VAULT_ABI,
          functionName: "withdraw",
          args: [parseEther(amount)],
        });
      } catch (err) {
        setError(err as Error);
        throw err;
      }
    },
    [address, writeContract]
  );

  // Open long position
  const openLong = useCallback(
    async (size: string, leverage: number) => {
      if (!address) throw new Error("Wallet not connected");
      setError(null);
      try {
        const sizeWei = parseEther(size);
        const leverageWei = BigInt(leverage) * LEVERAGE_PRECISION;
        writeContract({
          address: CONTRACTS.POSITION_MANAGER,
          abi: POSITION_MANAGER_ABI,
          functionName: "openLong",
          args: [sizeWei, leverageWei],
        });
      } catch (err) {
        setError(err as Error);
        throw err;
      }
    },
    [address, writeContract]
  );

  // Open short position
  const openShort = useCallback(
    async (size: string, leverage: number) => {
      if (!address) throw new Error("Wallet not connected");
      setError(null);
      try {
        const sizeWei = parseEther(size);
        const leverageWei = BigInt(leverage) * LEVERAGE_PRECISION;
        writeContract({
          address: CONTRACTS.POSITION_MANAGER,
          abi: POSITION_MANAGER_ABI,
          functionName: "openShort",
          args: [sizeWei, leverageWei],
        });
      } catch (err) {
        setError(err as Error);
        throw err;
      }
    },
    [address, writeContract]
  );

  // Close position
  const closePosition = useCallback(async () => {
    if (!address) throw new Error("Wallet not connected");
    setError(null);
    try {
      writeContract({
        address: CONTRACTS.POSITION_MANAGER,
        abi: POSITION_MANAGER_ABI,
        functionName: "closePosition",
      });
    } catch (err) {
      setError(err as Error);
      throw err;
    }
  }, [address, writeContract]);

  // Close position partial
  const closePositionPartial = useCallback(
    async (percentage: number) => {
      if (!address) throw new Error("Wallet not connected");
      if (percentage < 1 || percentage > 100) throw new Error("Invalid percentage");
      setError(null);
      try {
        writeContract({
          address: CONTRACTS.POSITION_MANAGER,
          abi: POSITION_MANAGER_ABI,
          functionName: "closePositionPartial",
          args: [BigInt(percentage)],
        });
      } catch (err) {
        setError(err as Error);
        throw err;
      }
    },
    [address, writeContract]
  );

  // Add collateral
  const addCollateral = useCallback(
    async (amount: string) => {
      if (!address) throw new Error("Wallet not connected");
      setError(null);
      try {
        writeContract({
          address: CONTRACTS.POSITION_MANAGER,
          abi: POSITION_MANAGER_ABI,
          functionName: "addCollateral",
          args: [parseEther(amount)],
        });
      } catch (err) {
        setError(err as Error);
        throw err;
      }
    },
    [address, writeContract]
  );

  // Remove collateral
  const removeCollateral = useCallback(
    async (amount: string) => {
      if (!address) throw new Error("Wallet not connected");
      setError(null);
      try {
        writeContract({
          address: CONTRACTS.POSITION_MANAGER,
          abi: POSITION_MANAGER_ABI,
          functionName: "removeCollateral",
          args: [parseEther(amount)],
        });
      } catch (err) {
        setError(err as Error);
        throw err;
      }
    },
    [address, writeContract]
  );

  // Adjust leverage - NOT IMPLEMENTED in contract
  // Users should close position and reopen with new leverage
  const adjustLeverage = useCallback(
    async (_newLeverage: number) => {
      const error = new Error(
        "Adjust leverage is not supported. Please close your position and open a new one with the desired leverage."
      );
      setError(error);
      throw error;
    },
    []
  );

  // Check if can open position
  const canOpenPosition = useCallback(
    async (isLong: boolean, size: string, leverage: number): Promise<{ isValid: boolean; reason: string }> => {
      if (!address) return { isValid: false, reason: "Wallet not connected" };
      try {
        // This would need to be a separate read call
        // For now, return basic validation
        const sizeNum = parseFloat(size);
        if (isNaN(sizeNum) || sizeNum <= 0) {
          return { isValid: false, reason: "Invalid size" };
        }
        if (leverage < 1 || leverage > 100) {
          return { isValid: false, reason: "Leverage must be 1-100x" };
        }
        return { isValid: true, reason: "" };
      } catch (err) {
        return { isValid: false, reason: (err as Error).message };
      }
    },
    [address]
  );

  return {
    // Position
    position,
    hasPosition: !!position,
    unrealizedPnL: unrealizedPnL ?? null,
    marginRatio: marginRatio ?? null,
    liquidationPrice: liquidationPrice ?? null,

    // Balances
    vaultBalance: vaultBalance ?? null,
    availableBalance: availableBalance ?? null,
    lockedMargin: lockedMargin ?? null,
    walletBalance: walletBalanceData?.value,

    // Market
    markPrice: markPrice ?? null,
    openFeeRate: openFeeRate ?? null,
    closeFeeRate: closeFeeRate ?? null,
    totalLongSize: totalLongSize ?? null,
    totalShortSize: totalShortSize ?? null,

    // Actions
    deposit,
    withdraw,
    openLong,
    openShort,
    closePosition,
    closePositionPartial,
    addCollateral,
    removeCollateral,
    adjustLeverage,
    canOpenPosition,

    // Status
    isLoading: false,
    isPending,
    isConfirming,
    error,
    txHash,
  };
}

// ============================================================
// H-016: Multi-token Perpetual Hook (F-01/F-02 Fix)
// ============================================================

/**
 * Hook return type for multi-token perpetual trading
 */
export interface UsePerpetualTokenReturn {
  // User position for specific token
  position: TokenPosition | null;
  hasPosition: boolean;
  unrealizedPnL: bigint | null;
  liquidationPrice: bigint | null;
  marginRatio: bigint | null; // F-06: 保证金率

  // Token price data
  markPrice: bigint | null;
  isTokenSupported: boolean;

  // Token market data
  tokenTotalLongSize: bigint | null;
  tokenTotalShortSize: bigint | null;

  // Actions
  openLongToken: (size: string, leverage: number, marginMode: number) => Promise<void>;
  openShortToken: (size: string, leverage: number, marginMode: number) => Promise<void>;
  closePositionToken: () => Promise<void>;
  closePositionTokenPartial: (percentage: number) => Promise<void>;

  // Status
  isLoading: boolean;
  isPending: boolean;
  isConfirming: boolean;
  error: Error | null;
  txHash: `0x${string}` | undefined;
  refetchPosition: () => void;
}

const LEVERAGE_PRECISION_TOKEN = 10000n;

/**
 * Hook for multi-token perpetual contract trading
 * @param tokenAddress The address of the token to trade
 */
export function usePerpetualToken(tokenAddress: Address | undefined): UsePerpetualTokenReturn {
  const { address, isConnected } = useAccount();
  const [error, setError] = useState<Error | null>(null);

  // Check if token is supported
  const { data: isTokenSupported } = useReadContract({
    address: CONTRACTS.PRICE_FEED,
    abi: PRICE_FEED_ABI,
    functionName: "isTokenSupported",
    args: tokenAddress ? [tokenAddress] : undefined,
    query: {
      enabled: !!tokenAddress,
    },
  });

  // Token mark price
  const { data: markPrice } = useReadContract({
    address: CONTRACTS.PRICE_FEED,
    abi: PRICE_FEED_ABI,
    functionName: "getTokenMarkPrice",
    args: tokenAddress ? [tokenAddress] : undefined,
    query: {
      enabled: !!tokenAddress && !!isTokenSupported,
    },
  });

  // Position data for specific token
  const { data: positionData, refetch: refetchPosition } = useReadContract({
    address: CONTRACTS.POSITION_MANAGER,
    abi: POSITION_MANAGER_ABI,
    functionName: "getPositionByToken",
    args: address && tokenAddress ? [address, tokenAddress] : undefined,
    query: {
      enabled: !!address && !!tokenAddress,
      refetchInterval: 5000,
    },
  });

  // Unrealized PnL for token position
  const { data: unrealizedPnL, refetch: refetchPnL } = useReadContract({
    address: CONTRACTS.POSITION_MANAGER,
    abi: POSITION_MANAGER_ABI,
    functionName: "getTokenUnrealizedPnL",
    args: address && tokenAddress ? [address, tokenAddress] : undefined,
    query: {
      enabled: !!address && !!tokenAddress,
      refetchInterval: 5000,
    },
  });

  // Liquidation price for token position
  const { data: liquidationPrice } = useReadContract({
    address: CONTRACTS.POSITION_MANAGER,
    abi: POSITION_MANAGER_ABI,
    functionName: "getTokenLiquidationPrice",
    args: address && tokenAddress ? [address, tokenAddress] : undefined,
    query: {
      enabled: !!address && !!tokenAddress,
    },
  });

  // F-06: Margin ratio for token position
  const { data: marginRatio } = useReadContract({
    address: CONTRACTS.POSITION_MANAGER,
    abi: POSITION_MANAGER_ABI,
    functionName: "getTokenMarginRatio",
    args: address && tokenAddress ? [address, tokenAddress] : undefined,
    query: {
      enabled: !!address && !!tokenAddress,
      refetchInterval: 5000,
    },
  });

  // Token total long/short sizes
  const { data: tokenTotalLongSize } = useReadContract({
    address: CONTRACTS.POSITION_MANAGER,
    abi: POSITION_MANAGER_ABI,
    functionName: "getTokenTotalLongSize",
    args: tokenAddress ? [tokenAddress] : undefined,
    query: {
      enabled: !!tokenAddress,
    },
  });

  const { data: tokenTotalShortSize } = useReadContract({
    address: CONTRACTS.POSITION_MANAGER,
    abi: POSITION_MANAGER_ABI,
    functionName: "getTokenTotalShortSize",
    args: tokenAddress ? [tokenAddress] : undefined,
    query: {
      enabled: !!tokenAddress,
    },
  });

  // Contract writes
  const {
    writeContract,
    data: txHash,
    isPending,
    reset: resetWrite,
  } = useWriteContract();

  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({
    hash: txHash,
  });

  // Refetch data after successful transaction
  useEffect(() => {
    if (isSuccess) {
      refetchPosition();
      refetchPnL();
      resetWrite();
    }
  }, [isSuccess, refetchPosition, refetchPnL, resetWrite]);

  // Parse position data
  const position = useMemo(() => {
    if (!positionData || (positionData as any).size === 0n) return null;
    const p = positionData as any;
    return {
      token: p.token,
      isLong: p.isLong,
      size: p.size,
      collateral: p.collateral,
      entryPrice: p.entryPrice,
      leverage: p.leverage,
      lastFundingTime: p.lastFundingTime,
      accFundingFee: p.accFundingFee,
      marginMode: p.marginMode,
    };
  }, [positionData]);

  // Open long position for token
  const openLongToken = useCallback(
    async (size: string, leverage: number, marginMode: number = 0) => {
      if (!address) throw new Error("Wallet not connected");
      if (!tokenAddress) throw new Error("Token address not provided");
      setError(null);
      try {
        const sizeWei = parseEther(size);
        const leverageWei = BigInt(leverage) * LEVERAGE_PRECISION_TOKEN;
        writeContract({
          address: CONTRACTS.POSITION_MANAGER,
          abi: POSITION_MANAGER_ABI,
          functionName: "openLongToken",
          args: [tokenAddress, sizeWei, leverageWei, marginMode],
        });
      } catch (err) {
        setError(err as Error);
        throw err;
      }
    },
    [address, tokenAddress, writeContract]
  );

  // Open short position for token
  const openShortToken = useCallback(
    async (size: string, leverage: number, marginMode: number = 0) => {
      if (!address) throw new Error("Wallet not connected");
      if (!tokenAddress) throw new Error("Token address not provided");
      setError(null);
      try {
        const sizeWei = parseEther(size);
        const leverageWei = BigInt(leverage) * LEVERAGE_PRECISION_TOKEN;
        writeContract({
          address: CONTRACTS.POSITION_MANAGER,
          abi: POSITION_MANAGER_ABI,
          functionName: "openShortToken",
          args: [tokenAddress, sizeWei, leverageWei, marginMode],
        });
      } catch (err) {
        setError(err as Error);
        throw err;
      }
    },
    [address, tokenAddress, writeContract]
  );

  // Close position for token
  const closePositionToken = useCallback(async () => {
    if (!address) throw new Error("Wallet not connected");
    if (!tokenAddress) throw new Error("Token address not provided");
    setError(null);
    try {
      writeContract({
        address: CONTRACTS.POSITION_MANAGER,
        abi: POSITION_MANAGER_ABI,
        functionName: "closePositionToken",
        args: [tokenAddress],
      });
    } catch (err) {
      setError(err as Error);
      throw err;
    }
  }, [address, tokenAddress, writeContract]);

  // Close position partial for token
  const closePositionTokenPartial = useCallback(
    async (percentage: number) => {
      if (!address) throw new Error("Wallet not connected");
      if (!tokenAddress) throw new Error("Token address not provided");
      if (percentage < 1 || percentage > 100) throw new Error("Invalid percentage");
      setError(null);
      try {
        writeContract({
          address: CONTRACTS.POSITION_MANAGER,
          abi: POSITION_MANAGER_ABI,
          functionName: "closePositionTokenPartial",
          args: [tokenAddress, BigInt(percentage)],
        });
      } catch (err) {
        setError(err as Error);
        throw err;
      }
    },
    [address, tokenAddress, writeContract]
  );

  return {
    // Position
    position,
    hasPosition: !!position,
    unrealizedPnL: unrealizedPnL ?? null,
    liquidationPrice: liquidationPrice ?? null,
    marginRatio: marginRatio ?? null, // F-06: 保证金率

    // Price & Support
    markPrice: markPrice ?? null,
    isTokenSupported: !!isTokenSupported,

    // Market data
    tokenTotalLongSize: tokenTotalLongSize ?? null,
    tokenTotalShortSize: tokenTotalShortSize ?? null,

    // Actions
    openLongToken,
    openShortToken,
    closePositionToken,
    closePositionTokenPartial,

    // Status
    isLoading: false,
    isPending,
    isConfirming,
    error,
    txHash,
    refetchPosition,
  };
}
