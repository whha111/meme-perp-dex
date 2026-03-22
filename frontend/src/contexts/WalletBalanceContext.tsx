"use client";

/**
 * 全局钱包余额 Context (BNB 本位)
 *
 * 混合数据源架构:
 * - 主数据源: WS 推送的撮合引擎余额 (available + locked)
 *   → 包含 mode2Adj 修正，平仓盈亏即时反映
 * - 兜底数据源: 链上读取 (派生钱包 BNB + PerpVault.traderMargin)
 *   → 覆盖 WS 未连接或首次加载的场景
 *
 * 为什么不能只读链上?
 *   链上结算是异步批量的 (10-30s flush)，平仓后 PerpVault 不会立即释放资金。
 *   WS 推送的引擎余额已包含 mode2Adj 修正，是唯一即时正确的数据源。
 */

import React, {
  createContext,
  useContext,
  useMemo,
  useCallback,
  useEffect,
  useRef,
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
  // 30s 兜底轮询: 覆盖用户直接向派生钱包转 BNB 的场景 (WS 无法感知)
  // WS balance 消息会额外触发 refreshBalance() 实现即时更新
  const {
    data: nativeBalanceData,
    refetch: refetchNative,
    isLoading: isLoadingNative,
    dataUpdatedAt,
  } = useBalance({
    address: tradingWallet ?? undefined,
    query: {
      refetchInterval: 30_000,
    },
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
      refetchInterval: 30_000,
    },
  });

  const lockedMargin = (lockedMarginRaw as bigint) ?? 0n;

  // Wallet-only balance: native BNB minus gas reserve
  const walletOnlyBalance = useMemo(() => {
    return nativeEthBalance > GAS_RESERVE ? nativeEthBalance - GAS_RESERVE : 0n;
  }, [nativeEthBalance]);

  // ── WS 引擎余额 (主数据源) ────────────────────────────
  // 引擎余额包含 mode2Adj 修正，平仓盈亏即时反映
  const storeBalance = useTradingDataStore(state => state.balance);

  // 使用 ref 跟踪 WS 余额是否已接收 (避免闪烁)
  const hasWsBalance = useRef(false);
  useEffect(() => {
    if (storeBalance && (storeBalance.available > 0n || storeBalance.locked > 0n)) {
      hasWsBalance.current = true;
    }
  }, [storeBalance]);

  // Total balance: 优先使用 WS 引擎余额，兜底用链上余额
  const totalBalance = useMemo(() => {
    if (storeBalance && hasWsBalance.current) {
      // WS 引擎余额: available(可用) + locked(已锁定保证金)
      // 这是撮合引擎计算的真实余额，包含 mode2Adj 修正
      const wsTotal = storeBalance.available + storeBalance.locked;
      // 取 WS 余额和链上余额的较大值
      // 因为链上结算有延迟，WS 值通常更大（包含未结算的盈利）
      const onChainTotal = walletOnlyBalance + lockedMargin;
      return wsTotal > onChainTotal ? wsTotal : onChainTotal;
    }
    // 兜底: WS 未连接时用链上余额
    return walletOnlyBalance + lockedMargin;
  }, [storeBalance, walletOnlyBalance, lockedMargin]);

  // Refresh all balances
  const refreshBalance = useCallback(() => {
    refetchNative();
    refetchMargin();
  }, [refetchNative, refetchMargin]);

  // WS balance 更新时也触发链上刷新 (最终一致性)
  useEffect(() => {
    if (storeBalance) {
      // 延迟刷新链上余额: 等链上批量结算完成后同步
      const timer = setTimeout(() => {
        refreshBalance();
      }, 15_000); // 15 秒后链上应该已结算
      return () => clearTimeout(timer);
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

  // 导出的可用余额和锁定保证金也优先使用 WS 数据
  const effectiveAvailable = useMemo(() => {
    if (storeBalance && hasWsBalance.current) {
      return storeBalance.available > walletOnlyBalance ? storeBalance.available : walletOnlyBalance;
    }
    return walletOnlyBalance;
  }, [storeBalance, walletOnlyBalance]);

  const effectiveLockedMargin = useMemo(() => {
    if (storeBalance && hasWsBalance.current) {
      return storeBalance.locked > lockedMargin ? storeBalance.locked : lockedMargin;
    }
    return lockedMargin;
  }, [storeBalance, lockedMargin]);

  const value: WalletBalanceContextType = {
    tradingWallet: tradingWallet ?? null,
    nativeEthBalance: effectiveAvailable,
    lockedMargin: effectiveLockedMargin,
    totalBalance,
    walletOnlyBalance: effectiveAvailable,
    formattedWethBalance,
    refreshBalance,
    isLoading: isLoadingNative || isLoadingMargin,
    lastUpdated,
    // Legacy compatibility
    wethBalance: 0n,
    settlementBalance: effectiveLockedMargin,
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
