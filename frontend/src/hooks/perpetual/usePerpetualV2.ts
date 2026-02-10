"use client";

/**
 * usePerpetualV2 - 永续合约交易 Hook (ETH 本位)
 *
 * 已对接后端 REST API:
 * - 余额: GET /api/user/{trader}/balance + WS 实时更新
 * - 下单: POST /api/order/submit (EIP-712 签名)
 * - 仓位: GET /api/user/{trader}/positions
 * - 订单: GET /api/user/{trader}/orders
 * - 取消: POST /api/order/{orderId}/cancel
 * - 平仓: POST /api/position/{pairId}/close
 *
 * ETH 本位精度约定:
 * - 价格: 1e18 (ETH/Token)
 * - 保证金/PnL: 1e18 (ETH)
 * - Token 数量: 1e18
 */

import { useState, useCallback, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { Address, Hex } from "viem";
import { createWalletClient, http, keccak256, parseEther } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { baseSepolia } from "viem/chains";
import { MATCHING_ENGINE_URL, SETTLEMENT_ADDRESS } from "@/config/api";
import { CONTRACTS } from "@/lib/contracts";
import { useWebSocketMessage } from "@/lib/websocket/hooks";
import { MessageType } from "@/lib/websocket/types";
import {
  signOrder,
  submitOrder,
  createMarketOrderParams,
  createLimitOrderParams,
  getUserNonce,
  getUserPositions,
  getUserOrders,
  cancelOrder as apiCancelOrder,
  requestClosePair,
  getClosePairMessage,
  type OrderDetails,
} from "@/utils/orderSigning";

// ============================================================
// Types (保留所有类型定义)
// ============================================================

export type MarginMode = "cross" | "isolated";
export type PositionStatus = "open" | "closed" | "liquidated";

export const PositionStatusValue = {
  OPEN: 0,
  CLOSED: 1,
  LIQUIDATED: 2,
} as const;

export interface PairedPosition {
  pairId: string;
  token: Address;
  isLong: boolean;
  size: string;
  entryPrice: string;
  leverage: string;
  marginMode: MarginMode;
  markPrice?: string;
  liquidationPrice?: string;
  breakEvenPrice?: string;
  collateral: string;
  margin?: string;
  marginRatio?: string;
  maintenanceMargin?: string;
  unrealizedPnL: string;
  realizedPnL?: string;
  roe?: string;
  fundingFee?: string;
  takeProfitPrice?: string;
  stopLossPrice?: string;
  counterparty: Address;
  openTime?: number;
  updatedAt?: number;
  status?: PositionStatus;
  isLiquidatable?: boolean;
  isLiquidating?: boolean;
  bankruptcyPrice?: string;
  adlRanking?: number;
  adlScore?: string;
  isAdlCandidate?: boolean;
  riskLevel?: "low" | "medium" | "high" | "critical";
}

export interface OrderBookLevel {
  price: string;
  size: string;
  count: number;
}

export type TimeInForce = "GTC" | "IOC" | "FOK" | "GTD";
export type OrderSource = "API" | "WEB" | "APP";
export type OrderTypeStr = "MARKET" | "LIMIT";

export interface OrderInfo {
  id: string;
  clientOrderId?: string | null;
  token: Address;
  isLong: boolean;
  size: string;
  leverage: string;
  price: string;
  orderType: OrderTypeStr;
  timeInForce: TimeInForce;
  reduceOnly: boolean;
  status: string;
  filledSize: string;
  avgFillPrice: string;
  totalFillValue: string;
  fee: string;
  margin: string;
  collateral: string;
  takeProfitPrice?: string;
  stopLossPrice?: string;
  createdAt: number;
  updatedAt: number;
  lastFillTime?: number;
  source: OrderSource;
  lastFillPrice?: string;
  lastFillSize?: string;
  tradeId?: string;
}

export interface UserBalance {
  available: bigint;                // 可用 ETH (1e18)
  locked: bigint;                   // 仓位占用 ETH (1e18)
  unrealizedPnL?: bigint;           // 未实现盈亏 ETH (1e18)
  equity?: bigint;                  // 权益 ETH (1e18)
  walletBalance?: bigint;           // 派生钱包 ETH 余额 (1e18)
  settlementAvailable?: bigint;     // Settlement 合约可用 ETH (1e18)
  settlementLocked?: bigint;        // Settlement 合约仓位锁定 ETH (1e18)
  pendingOrdersLocked?: bigint;     // 挂单锁定金额 ETH (1e18)
}

// ============================================================
// Hook Return Type
// ============================================================

export interface UsePerpetualV2Return {
  mainWalletAddress: Address | undefined;
  tradingWalletAddress: Address | undefined;
  balance: UserBalance | null;
  walletBalance: bigint | undefined;
  positions: PairedPosition[];
  hasPosition: boolean;
  pendingOrders: OrderInfo[];
  orderBook: { longs: OrderBookLevel[]; shorts: OrderBookLevel[]; lastPrice: string } | null;
  recentTrades: Array<{
    id: string;
    price: string;
    size: string;
    side: "buy" | "sell";
    timestamp: number;
  }>;
  submitMarketOrder: (token: Address, isLong: boolean, size: string, leverage: number) => Promise<{ success: boolean; orderId?: string; error?: string }>;
  submitLimitOrder: (token: Address, isLong: boolean, size: string, leverage: number, price: string) => Promise<{ success: boolean; orderId?: string; error?: string }>;
  cancelPendingOrder: (orderId: string) => Promise<{ success: boolean; error?: string }>;
  closePair: (pairId: string) => Promise<{ success: boolean; error?: string }>;
  approveToken: (token: Address, amount: string) => Promise<void>;
  approveTradingWallet: (token: Address, amount?: string) => Promise<`0x${string}`>;
  deposit: (token: Address, amount: string) => Promise<void>;
  withdraw: (token: Address, amount: string) => Promise<void>;
  refreshBalance: () => void;
  refreshPositions: () => void;
  refreshOrders: () => void;
  refreshOrderBook: (token: Address) => void;
  refreshRecentTrades: (token: Address) => void;
  isLoading: boolean;
  isSigningOrder: boolean;
  isSubmittingOrder: boolean;
  isPending: boolean;
  isConfirming: boolean;
  error: string | null;
}

export interface UsePerpetualV2Props {
  tradingWalletAddress?: Address;
  tradingWalletSignature?: Hex;
  mainWalletAddress?: Address;
}

// ============================================================
// Backend balance API response
// ============================================================

interface BalanceApiResponse {
  totalBalance: string;
  availableBalance: string;
  usedMargin: string;
  unrealizedPnL: string;
  walletBalance?: string;
  settlementAvailable?: string;
  settlementLocked?: string;
  pendingOrdersLocked?: string;
  positions?: unknown[];
}

// ============================================================
// Balance fetcher
// ============================================================

async function fetchBalance(tradingWalletAddress: string): Promise<UserBalance> {
  const res = await fetch(
    `${MATCHING_ENGINE_URL}/api/user/${tradingWalletAddress}/balance`
  );
  if (!res.ok) {
    throw new Error(`Balance API error: ${res.status}`);
  }
  const data: BalanceApiResponse = await res.json();

  // ETH 本位: Backend returns string values in 1e18 (ETH) precision
  const available = BigInt(data.availableBalance || "0");
  const locked = BigInt(data.usedMargin || "0");
  const unrealizedPnL = BigInt(data.unrealizedPnL || "0");
  const equity = available + locked + unrealizedPnL;

  // 新增分项余额字段
  const walletBalance = BigInt(data.walletBalance || "0");
  const settlementAvailable = BigInt(data.settlementAvailable || "0");
  const settlementLocked = BigInt(data.settlementLocked || "0");
  const pendingOrdersLocked = BigInt(data.pendingOrdersLocked || "0");

  return {
    available, locked, unrealizedPnL, equity,
    walletBalance, settlementAvailable, settlementLocked, pendingOrdersLocked,
  };
}

// ============================================================
// Pending order status values (backend uses numeric or string)
// ============================================================

const PENDING_STATUSES = new Set(["0", "PENDING", "1", "PARTIALLY_FILLED"]);

// ============================================================
// Map backend OrderDetails → frontend OrderInfo
// ============================================================

function toOrderInfo(o: OrderDetails): OrderInfo {
  return {
    id: o.id,
    clientOrderId: o.clientOrderId,
    token: o.token,
    isLong: o.isLong,
    size: o.size,
    leverage: o.leverage,
    price: o.price,
    orderType: o.orderType,
    timeInForce: o.timeInForce,
    reduceOnly: o.reduceOnly,
    status: o.status,
    filledSize: o.filledSize,
    avgFillPrice: o.avgFillPrice,
    totalFillValue: o.totalFillValue,
    fee: o.fee,
    margin: o.margin,
    collateral: o.collateral,
    takeProfitPrice: o.takeProfitPrice ?? undefined,
    stopLossPrice: o.stopLossPrice ?? undefined,
    createdAt: o.createdAt,
    updatedAt: o.updatedAt,
    lastFillTime: o.lastFillTime ?? undefined,
    source: o.source,
    lastFillPrice: o.lastFillPrice ?? undefined,
    lastFillSize: o.lastFillSize ?? undefined,
    tradeId: o.tradeId ?? undefined,
  };
}

// ============================================================
// Hook Implementation
// ============================================================

export function usePerpetualV2(props?: UsePerpetualV2Props): UsePerpetualV2Return {
  const { tradingWalletAddress, tradingWalletSignature, mainWalletAddress } = props || {};

  const queryClient = useQueryClient();

  // ── Signing / submitting state ─────────────────────────────
  const [isSigningOrder, setIsSigningOrder] = useState(false);
  const [isSubmittingOrder, setIsSubmittingOrder] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // ── Derive local WalletClient from trading wallet signature ─
  // keccak256(signature) → deterministic private key → local account
  const tradingWalletClient = useMemo(() => {
    if (!tradingWalletSignature) return null;
    try {
      const privateKey = keccak256(tradingWalletSignature);
      const account = privateKeyToAccount(privateKey);
      return createWalletClient({
        account,
        chain: baseSepolia,
        transport: http(),
      });
    } catch (e) {
      console.error("[usePerpetualV2] Failed to create trading wallet client:", e);
      return null;
    }
  }, [tradingWalletSignature]);

  // Resolve settlement address: env var → hardcoded from contracts.ts
  const settlementAddress = (SETTLEMENT_ADDRESS || CONTRACTS.SETTLEMENT) as Address;

  // ── Balance: HTTP for initial load, WS for real-time updates ──
  const {
    data: httpBalance,
    isLoading: isBalanceLoading,
  } = useQuery({
    queryKey: ["perpetual-balance", tradingWalletAddress],
    queryFn: () => fetchBalance(tradingWalletAddress!),
    enabled: !!tradingWalletAddress,
    retry: 2,
    staleTime: 30_000,
    refetchInterval: 30_000,
  });

  // WS balance kept in local state for instant updates
  const [wsBalance, setWsBalance] = useState<UserBalance | null>(null);

  // Listen for WS "balance" messages → use pushed data directly
  useWebSocketMessage<{ trader: string; availableBalance: string; usedMargin: string; unrealizedPnL: string; walletBalance?: string; settlementAvailable?: string; settlementLocked?: string }>(
    MessageType.BALANCE,
    useCallback((message: { data?: { trader?: string; availableBalance?: string; usedMargin?: string; unrealizedPnL?: string; walletBalance?: string; settlementAvailable?: string; settlementLocked?: string } }) => {
      const d = message.data;
      if (d && d.trader?.toLowerCase() === tradingWalletAddress?.toLowerCase()) {
        const available = BigInt(d.availableBalance || "0");
        const locked = BigInt(d.usedMargin || "0");
        const unrealizedPnL = BigInt(d.unrealizedPnL || "0");
        const walletBalance = BigInt(d.walletBalance || "0");
        const settlementAvailable = BigInt(d.settlementAvailable || "0");
        const settlementLocked = BigInt(d.settlementLocked || "0");
        setWsBalance({
          available,
          locked,
          unrealizedPnL,
          equity: available + locked + unrealizedPnL,
          walletBalance,
          settlementAvailable,
          settlementLocked,
        });
      }
    }, [tradingWalletAddress])
  );

  // WS takes priority, HTTP is fallback
  const balance = wsBalance ?? httpBalance ?? null;

  // ── Positions from backend API ─────────────────────────────
  const { data: positionsData } = useQuery({
    queryKey: ["perpetual-positions", tradingWalletAddress],
    queryFn: () => getUserPositions(tradingWalletAddress!),
    enabled: !!tradingWalletAddress,
    staleTime: 5_000,
  });

  const positions: PairedPosition[] = useMemo(() => {
    if (!positionsData) return [];
    return positionsData.map((p) => ({
      pairId: p.pairId,
      token: p.token,
      isLong: p.isLong,
      size: p.size,
      entryPrice: p.entryPrice,
      leverage: p.leverage,
      marginMode: p.marginMode,
      collateral: p.collateral,
      counterparty: p.counterparty,
      unrealizedPnL: p.unrealizedPnL,
      markPrice: p.markPrice,
      liquidationPrice: p.liquidationPrice,
      breakEvenPrice: p.breakEvenPrice,
      margin: p.margin,
      marginRatio: p.marginRatio,
      maintenanceMargin: p.maintenanceMargin,
      realizedPnL: p.realizedPnL,
      roe: p.roe,
      fundingFee: p.fundingFee,
      riskLevel: p.riskLevel,
      isLiquidatable: p.isLiquidatable,
      adlRanking: p.adlRanking,
    }));
  }, [positionsData]);

  // WS: refetch positions on position updates (实时刷新)
  useWebSocketMessage(MessageType.POSITIONS, useCallback(() => {
    if (tradingWalletAddress) {
      // 使用 refetchQueries 立即重新获取数据，而不是 invalidateQueries
      queryClient.refetchQueries({
        queryKey: ["perpetual-positions", tradingWalletAddress],
      });
    }
  }, [tradingWalletAddress, queryClient]));

  // ── Orders from backend API ────────────────────────────────
  const { data: ordersData } = useQuery({
    queryKey: ["perpetual-orders", tradingWalletAddress],
    queryFn: async () => {
      const raw = await getUserOrders(tradingWalletAddress!);
      return raw.map(toOrderInfo);
    },
    enabled: !!tradingWalletAddress,
    staleTime: 5_000,
  });

  const pendingOrders: OrderInfo[] = useMemo(() => {
    if (!ordersData) return [];
    return ordersData.filter((o) => PENDING_STATUSES.has(o.status));
  }, [ordersData]);

  // WS: refetch orders on order updates (实时刷新)
  useWebSocketMessage(MessageType.ORDERS, useCallback(() => {
    if (tradingWalletAddress) {
      queryClient.refetchQueries({
        queryKey: ["perpetual-orders", tradingWalletAddress],
      });
    }
  }, [tradingWalletAddress, queryClient]));

  // ── Refresh callbacks ──────────────────────────────────────
  const refreshBalance = useCallback(() => {
    if (tradingWalletAddress) {
      setWsBalance(null); // Clear WS cache so HTTP re-fetches
      queryClient.invalidateQueries({
        queryKey: ["perpetual-balance", tradingWalletAddress],
      });
    }
  }, [tradingWalletAddress, queryClient]);

  const refreshPositions = useCallback(() => {
    if (tradingWalletAddress) {
      queryClient.invalidateQueries({
        queryKey: ["perpetual-positions", tradingWalletAddress],
      });
    }
  }, [tradingWalletAddress, queryClient]);

  const refreshOrders = useCallback(() => {
    if (tradingWalletAddress) {
      queryClient.invalidateQueries({
        queryKey: ["perpetual-orders", tradingWalletAddress],
      });
    }
  }, [tradingWalletAddress, queryClient]);

  // ── Order book & recent trades (still placeholder, separate feature) ──
  const [orderBook] = useState<{ longs: OrderBookLevel[]; shorts: OrderBookLevel[]; lastPrice: string } | null>(null);
  const [recentTrades] = useState<Array<{
    id: string;
    price: string;
    size: string;
    side: "buy" | "sell";
    timestamp: number;
  }>>([]);
  const refreshOrderBook = useCallback((_token: Address) => {}, []);
  const refreshRecentTrades = useCallback((_token: Address) => {}, []);

  // ── Submit Market Order ────────────────────────────────────
  const submitMarketOrder = useCallback(
    async (token: Address, isLong: boolean, size: string, leverage: number) => {
      if (!tradingWalletClient || !tradingWalletAddress) {
        return { success: false, error: "交易钱包未连接" };
      }
      if (!settlementAddress) {
        return { success: false, error: "Settlement 合约地址未配置" };
      }

      setError(null);

      try {
        // 1. Get nonce
        setIsSigningOrder(true);
        const nonce = await getUserNonce(tradingWalletAddress);

        // 2. Create order params (size is token amount as string → number)
        const sizeNum = parseFloat(size);
        if (isNaN(sizeNum) || sizeNum <= 0) {
          return { success: false, error: "无效的下单数量" };
        }
        const params = createMarketOrderParams(token, isLong, sizeNum, leverage, nonce);

        // 3. EIP-712 sign locally (no MetaMask popup)
        const signedOrder = await signOrder(tradingWalletClient, settlementAddress, params);
        setIsSigningOrder(false);

        // 4. Submit to matching engine
        setIsSubmittingOrder(true);
        const result = await submitOrder(signedOrder);
        setIsSubmittingOrder(false);

        if (result.success) {
          // Refresh all data after successful submission
          refreshPositions();
          refreshOrders();
          refreshBalance();
        } else {
          setError(result.error || "下单失败");
        }

        return result;
      } catch (e) {
        const errMsg = e instanceof Error ? e.message : "下单失败";
        setError(errMsg);
        return { success: false, error: errMsg };
      } finally {
        setIsSigningOrder(false);
        setIsSubmittingOrder(false);
      }
    },
    [tradingWalletClient, tradingWalletAddress, settlementAddress, refreshPositions, refreshOrders, refreshBalance]
  );

  // ── Submit Limit Order ─────────────────────────────────────
  const submitLimitOrder = useCallback(
    async (token: Address, isLong: boolean, size: string, leverage: number, price: string) => {
      if (!tradingWalletClient || !tradingWalletAddress) {
        return { success: false, error: "交易钱包未连接" };
      }
      if (!settlementAddress) {
        return { success: false, error: "Settlement 合约地址未配置" };
      }

      setError(null);

      try {
        setIsSigningOrder(true);
        const nonce = await getUserNonce(tradingWalletAddress);

        const sizeNum = parseFloat(size);
        const priceNum = parseFloat(price);
        if (isNaN(sizeNum) || sizeNum <= 0) {
          return { success: false, error: "无效的下单数量" };
        }
        if (isNaN(priceNum) || priceNum <= 0) {
          return { success: false, error: "无效的限价价格" };
        }

        const params = createLimitOrderParams(token, isLong, sizeNum, leverage, priceNum, nonce);
        const signedOrder = await signOrder(tradingWalletClient, settlementAddress, params);
        setIsSigningOrder(false);

        setIsSubmittingOrder(true);
        const result = await submitOrder(signedOrder);
        setIsSubmittingOrder(false);

        if (result.success) {
          refreshOrders();
          refreshBalance();
        } else {
          setError(result.error || "限价单提交失败");
        }

        return result;
      } catch (e) {
        const errMsg = e instanceof Error ? e.message : "限价单提交失败";
        setError(errMsg);
        return { success: false, error: errMsg };
      } finally {
        setIsSigningOrder(false);
        setIsSubmittingOrder(false);
      }
    },
    [tradingWalletClient, tradingWalletAddress, settlementAddress, refreshOrders, refreshBalance]
  );

  // ── Cancel Pending Order ───────────────────────────────────
  const cancelPendingOrder = useCallback(
    async (orderId: string) => {
      if (!tradingWalletClient || !tradingWalletAddress) {
        return { success: false, error: "交易钱包未连接" };
      }

      setError(null);

      try {
        // Sign cancel message: "Cancel order {orderId}"
        const message = `Cancel order ${orderId}`;
        const signature = await tradingWalletClient.signMessage({
          account: tradingWalletClient.account!,
          message,
        });

        const result = await apiCancelOrder(orderId, tradingWalletAddress, signature);

        if (result.success) {
          refreshOrders();
          refreshBalance();
        } else {
          setError(result.error || "取消订单失败");
        }

        return result;
      } catch (e) {
        const errMsg = e instanceof Error ? e.message : "取消订单失败";
        setError(errMsg);
        return { success: false, error: errMsg };
      }
    },
    [tradingWalletClient, tradingWalletAddress, refreshOrders, refreshBalance]
  );

  // ── Close Pair (平仓) ──────────────────────────────────────
  // H-08 fix: 添加签名验证防止冒充平仓
  const closePair = useCallback(
    async (pairId: string) => {
      if (!tradingWalletClient || !tradingWalletAddress) {
        return { success: false, error: "交易钱包未连接" };
      }

      setError(null);

      try {
        // H-08: 签名平仓消息，后端验证签名后才执行
        const message = getClosePairMessage(pairId, tradingWalletAddress);
        const signature = await tradingWalletClient.signMessage({
          account: tradingWalletClient.account!,
          message,
        });

        const result = await requestClosePair(pairId, tradingWalletAddress, signature);

        if (result.success) {
          refreshPositions();
          refreshBalance();
        } else {
          setError(result.error || "平仓失败");
        }

        return result;
      } catch (e) {
        const errMsg = e instanceof Error ? e.message : "平仓失败";
        setError(errMsg);
        return { success: false, error: errMsg };
      }
    },
    [tradingWalletClient, tradingWalletAddress, refreshPositions, refreshBalance]
  );

  // ── Token approve / deposit / withdraw (not yet implemented) ──
  const approveToken = useCallback(async (_token: Address, _amount: string) => {
    throw new Error("Token 授权功能待实现");
  }, []);

  const approveTradingWallet = useCallback(async (_token: Address, _amount?: string) => {
    throw new Error("交易钱包授权功能待实现");
  }, []);

  const deposit = useCallback(async (_token: Address, _amount: string) => {
    throw new Error("充值功能待实现");
  }, []);

  const withdraw = useCallback(async (token: Address, amount: string) => {
    if (!tradingWalletAddress) throw new Error("交易钱包未连接");
    if (!mainWalletAddress) throw new Error("主钱包地址未提供");

    // C-04 fix: 使用 parseEther 做字符串到 bigint 的精确转换，避免 parseFloat*1e18 精度丢失
    const amountInWei = parseEther(amount);
    if (amountInWei <= 0n) throw new Error("无效的提现金额");

    const res = await fetch(`${MATCHING_ENGINE_URL}/api/wallet/withdraw`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        tradingWallet: tradingWalletAddress,
        mainWallet: mainWalletAddress,
        amount: amountInWei.toString(),
        token,
      }),
    });
    const data = await res.json();
    if (!data.success) throw new Error(data.error || "提现失败");
    refreshBalance();
  }, [tradingWalletAddress, mainWalletAddress, refreshBalance]);

  return {
    mainWalletAddress: mainWalletAddress,
    tradingWalletAddress,
    balance: balance ?? null,
    walletBalance: balance?.walletBalance,
    positions,
    hasPosition: positions.length > 0,
    pendingOrders,
    orderBook,
    recentTrades,
    submitMarketOrder,
    submitLimitOrder,
    cancelPendingOrder,
    closePair,
    approveToken,
    approveTradingWallet,
    deposit,
    withdraw,
    refreshBalance,
    refreshPositions,
    refreshOrders,
    refreshOrderBook,
    refreshRecentTrades,
    isLoading: isBalanceLoading,
    isSigningOrder,
    isSubmittingOrder,
    isPending: false,
    isConfirming: false,
    error,
  };
}

export default usePerpetualV2;
