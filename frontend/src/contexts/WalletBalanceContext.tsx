"use client";

/**
 * 全局钱包余额 Context (BNB 本位)
 *
 * 派生钱包余额架构 (简化版):
 * - 可用余额 = 派生钱包 Native BNB (直接链上读取)
 * - 锁定保证金 = PerpVault.traderMargin (链上读取)
 * - 总计 = 可用 + 锁定
 *
 * 不再需要:
 * - WBNB 余额 (不再 wrap)
 * - Settlement 合约余额 (已废弃)
 * - Backend balance API 轮询 (余额即链上值)
 */

import React, {
  createContext,
  useContext,
  useMemo,
  useCallback,
  useEffect,
} from "react";
import { formatEther, parseEther, type Address } from "viem";
import { useBalance, useReadContract } from "wagmi";
import { useTradingWallet } from "@/hooks/perpetual/useTradingWallet";
import { useTradingDataStore } from "@/lib/stores/tradingDataStore";
import { CONTRACTS } from "@/lib/contracts";

// ============================================================
// PerpVault ABI (traderMargin read)
// ============================================================

const PERP_VAULT_MARGIN_ABI = [
  {
    name: "getTraderMargin",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "trader", type: "address" }],
    outputs: [{ type: "uint256" }],
  },
] as const;

// ============================================================
// Types
// ============================================================

interface WalletBalanceContextType {
  tradingWallet: Address | null;
  /** Native BNB on the trading wallet (available for trading) */
  nativeEthBalance: bigint;
  /** Margin locked in PerpVault contract */
  lockedMargin: bigint;
  /** Total balance = native BNB + locked margin */
  totalBalance: bigint;
  /** Available for deposit/new orders (= native BNB minus gas reserve) */
  walletOnlyBalance: bigint;
  /** Formatted total balance string */
  formattedWethBalance: string;
  refreshBalance: () => void;
  isLoading: boolean;
  lastUpdated: number;

  // Legacy compatibility fields (kept for components that still reference them)
  /** @deprecated Use nativeEthBalance instead */
  wethBalance: bigint;
  /** @deprecated Use lockedMargin instead */
  settlementBalance: bigint;
}

// ============================================================
// Context
// ============================================================

const WalletBalanceContext = createContext<WalletBalanceContextType | null>(
  null
);

// Gas reserve: 0.0005 BNB
const GAS_RESERVE = parseEther("0.0005");

export function WalletBalanceProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const { address: tradingWallet } = useTradingWallet();

  // Native BNB balance on derived wallet
  const {
    data: nativeBalanceData,
    refetch: refetchNative,
    isLoading: isLoadingNative,
    dataUpdatedAt,
  } = useBalance({
    address: tradingWallet ?? undefined,
  });

  const nativeEthBalance = nativeBalanceData?.value ?? 0n;

  // Locked margin in PerpVault
  const perpVaultAddress = (process.env.NEXT_PUBLIC_PERP_VAULT_ADDRESS || CONTRACTS.PERP_VAULT) as Address;
  const {
    data: lockedMarginRaw,
    refetch: refetchMargin,
    isLoading: isLoadingMargin,
  } = useReadContract({
    address: perpVaultAddress,
    abi: PERP_VAULT_MARGIN_ABI,
    functionName: "getTraderMargin",
    args: tradingWallet ? [tradingWallet] : undefined,
    query: {
      enabled: !!tradingWallet && !!perpVaultAddress,
    },
  });

  const lockedMargin = (lockedMarginRaw as bigint) ?? 0n;

  // Wallet-only balance: native BNB minus gas reserve
  const walletOnlyBalance = useMemo(() => {
    return nativeEthBalance > GAS_RESERVE ? nativeEthBalance - GAS_RESERVE : 0n;
  }, [nativeEthBalance]);

  // Total balance = available + locked
  const totalBalance = useMemo(() => {
    return walletOnlyBalance + lockedMargin;
  }, [walletOnlyBalance, lockedMargin]);

  // Refresh all balances
  const refreshBalance = useCallback(() => {
    refetchNative();
    refetchMargin();
  }, [refetchNative, refetchMargin]);

  // WS balance updates trigger refresh
  const storeBalance = useTradingDataStore(state => state.balance);
  useEffect(() => {
    if (storeBalance) {
      refreshBalance();
    }
  }, [storeBalance, refreshBalance]);

  // Formatted total balance (18 decimals for BNB)
  const formattedWethBalance = useMemo(() => {
    const balance = Number(totalBalance) / 1e18;
    if (balance >= 1) {
      return balance.toLocaleString("en-US", {
        minimumFractionDigits: 4,
        maximumFractionDigits: 4,
      });
    }
    return balance.toLocaleString("en-US", {
      minimumFractionDigits: 6,
      maximumFractionDigits: 6,
    });
  }, [totalBalance]);

  const lastUpdated = dataUpdatedAt || 0;

  const value: WalletBalanceContextType = {
    tradingWallet: tradingWallet ?? null,
    nativeEthBalance,
    lockedMargin,
    totalBalance,
    walletOnlyBalance,
    formattedWethBalance,
    refreshBalance,
    isLoading: isLoadingNative || isLoadingMargin,
    lastUpdated,
    // Legacy compatibility
    wethBalance: 0n,
    settlementBalance: lockedMargin,
  };

  return (
    <WalletBalanceContext.Provider value={value}>
      {children}
    </WalletBalanceContext.Provider>
  );
}

export function useWalletBalance() {
  const context = useContext(WalletBalanceContext);
  if (!context) {
    throw new Error(
      "useWalletBalance must be used within WalletBalanceProvider"
    );
  }
  return context;
}

export default WalletBalanceContext;
