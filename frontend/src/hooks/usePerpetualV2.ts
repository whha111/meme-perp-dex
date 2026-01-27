"use client";

/**
 * 新版永续合约交易 Hook (V2)
 *
 * 流程：
 * 1. 用户使用派生交易钱包签名订单 (EIP-712)
 * 2. 提交到链下撮合引擎
 * 3. 撮合引擎配对后批量提交到链上 Settlement 合约
 * 4. 从 Settlement 合约查询仓位和余额
 *
 * 注意：订单签名使用交易钱包（派生钱包），而不是主钱包
 */

import { useState, useCallback, useMemo, useEffect } from "react";
import { useAccount, useBalance, useReadContract, useWriteContract, useWaitForTransactionReceipt, useWalletClient, usePublicClient, useChainId } from "wagmi";
import { parseEther, formatEther, type Address, type Hex, maxUint256, createWalletClient, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { baseSepolia, base } from "viem/chains";
import {
  signOrder,
  createMarketOrderParams,
  createLimitOrderParams,
  submitOrder,
  getUserNonce,
  getOrderBook,
  getRecentTrades,
  getUserOrders,
  cancelOrder,
  getUserPositions,
  requestClosePair,
  OrderType,
  SETTLEMENT_ABI,
  ERC20_ABI,
  type OrderParams,
  type SignedOrder,
} from "@/utils/orderSigning";

// ============================================================
// Configuration
// ============================================================

// Settlement contract address - should be loaded from env or config
const SETTLEMENT_ADDRESS = (process.env.NEXT_PUBLIC_SETTLEMENT_ADDRESS || "0x0000000000000000000000000000000000000000") as Address;

// 保证金代币地址 (USDT)
const COLLATERAL_TOKEN_ADDRESS = (process.env.NEXT_PUBLIC_USDT_ADDRESS || "0x83214d0a99eb664c3559d1619ef9b5f78a655c4e") as Address;

// ============================================================
// Types
// ============================================================

/**
 * 配对仓位信息 (行业标准 - 参考 OKX/Binance/Bybit)
 */
export interface PairedPosition {
  // === 基本标识 ===
  pairId: string;                 // 配对ID
  token: Address;                 // 代币地址

  // === 仓位参数 ===
  isLong: boolean;                // 多/空
  size: string;                   // 仓位大小
  entryPrice: string;             // 开仓均价
  leverage: string;               // 杠杆倍数

  // === 价格信息 ===
  markPrice?: string;             // 标记价格 (用于计算盈亏) - 1e12 精度
  liqPrice?: string;              // 强平价格 (别名, 兼容旧代码)
  liquidationPrice?: string;      // 强平价格 - 1e12 精度
  breakEvenPrice?: string;        // 盈亏平衡价格 - 1e12 精度

  // === 保证金信息 ===
  collateral: string;             // 抵押品/保证金
  margin?: string;                // 占用保证金
  marginRatio?: string;           // 保证金率 (%)
  maintenanceMargin?: string;     // 维持保证金

  // === 盈亏信息 ===
  unrealizedPnL: string;          // 未实现盈亏
  realizedPnL?: string;           // 已实现盈亏
  roe?: string;                   // 收益率 ROE%
  fundingFee?: string;            // 累计资金费

  // === 止盈止损 ===
  takeProfitPrice?: string;       // 止盈价
  stopLossPrice?: string;         // 止损价
  trailingStop?: string;          // 追踪止损

  // === 系统信息 ===
  counterparty: Address;          // 对手方地址
  openTime?: number;              // 开仓时间
  updatedAt?: number;             // 更新时间

  // === 风险指标 ===
  adlRanking?: number;            // ADL 排名 (1-5)
  riskLevel?: "low" | "medium" | "high"; // 风险等级
}

export interface OrderBookLevel {
  price: string;
  size: string;
  count: number;
}

// 订单有效期类型 (行业标准)
export type TimeInForce = "GTC" | "IOC" | "FOK" | "GTD";

// 订单来源
export type OrderSource = "API" | "WEB" | "APP";

// 订单类型
export type OrderTypeStr = "MARKET" | "LIMIT";

/**
 * 订单详细信息 (行业标准 - 参考 OKX/Binance)
 */
export interface OrderInfo {
  // === 基本标识 ===
  id: string;                     // 系统订单ID (orderId)
  clientOrderId?: string | null;  // 用户自定义订单ID (clOrdId)
  token: Address;                 // 交易代币地址 (instId/symbol)

  // === 订单参数 ===
  isLong: boolean;                // 多头/空头 (side + positionSide)
  size: string;                   // 原始订单数量 (origQty/sz)
  leverage: string;               // 杠杆倍数
  price: string;                  // 订单价格 (px/price)
  orderType: OrderTypeStr;        // 订单类型 (ordType/type)
  timeInForce: TimeInForce;       // 有效期类型 (GTC/IOC/FOK/GTD)
  reduceOnly: boolean;            // 是否只减仓

  // === 成交信息 ===
  status: string;                 // 订单状态 (state/status)
  filledSize: string;             // 已成交数量 (executedQty/accFillSz)
  avgFillPrice: string;           // 平均成交价格 (avgPrice/avgPx)
  totalFillValue: string;         // 累计成交金额 (cumQuote)

  // === 费用信息 ===
  fee: string;                    // 手续费金额
  feeCurrency: string;            // 手续费币种 (feeCcy)

  // === 保证金信息 ===
  margin: string;                 // 占用保证金
  collateral: string;             // 抵押品价值

  // === 止盈止损 ===
  takeProfitPrice?: string;       // 止盈触发价 (tpTriggerPx)
  stopLossPrice?: string;         // 止损触发价 (slTriggerPx)

  // === 时间戳 ===
  createdAt: number;              // 创建时间 (cTime/time)
  updatedAt: number;              // 更新时间 (uTime/updateTime)
  lastFillTime?: number;          // 最后成交时间 (fillTime)

  // === 来源 ===
  source: OrderSource;            // 订单来源 (API/WEB/APP)

  // === 最后成交明细 ===
  lastFillPrice?: string;         // 最后成交价格 (fillPx)
  lastFillSize?: string;          // 最后成交数量 (fillSz)
  tradeId?: string;               // 最后成交ID
}

export interface UserBalance {
  available: bigint;      // 可用余额
  locked: bigint;         // 已使用保证金
  unrealizedPnL?: bigint; // 未实现盈亏
  equity?: bigint;        // 账户权益
}

// ============================================================
// Hook Return Type
// ============================================================

export interface UsePerpetualV2Return {
  // Wallet addresses
  mainWalletAddress: Address | undefined;
  tradingWalletAddress: Address | undefined;

  // User balance on Settlement contract
  balance: UserBalance | null;
  walletBalance: bigint | undefined;

  // User positions (paired positions from Settlement)
  positions: PairedPosition[];
  hasPosition: boolean;

  // User pending orders (from matching engine)
  pendingOrders: OrderInfo[];

  // Order book for current token
  orderBook: { longs: OrderBookLevel[]; shorts: OrderBookLevel[]; lastPrice: string } | null;

  // Recent trades for current token
  recentTrades: Array<{
    id: string;
    price: string;
    size: string;
    side: "buy" | "sell";
    timestamp: number;
  }>;

  // Actions - Order submission
  submitMarketOrder: (token: Address, isLong: boolean, size: string, leverage: number) => Promise<{ success: boolean; orderId?: string; error?: string }>;
  submitLimitOrder: (token: Address, isLong: boolean, size: string, leverage: number, price: string) => Promise<{ success: boolean; orderId?: string; error?: string }>;
  cancelPendingOrder: (orderId: string) => Promise<{ success: boolean; error?: string }>;

  // Actions - Position management
  closePair: (pairId: string) => Promise<{ success: boolean; error?: string }>;

  // Actions - Balance management (direct contract calls)
  approveToken: (token: Address, amount: string) => Promise<void>;
  approveTradingWallet: (token: Address, amount?: string) => Promise<`0x${string}`>;
  deposit: (token: Address, amount: string) => Promise<void>;
  withdraw: (token: Address, amount: string) => Promise<void>;

  // Refresh functions
  refreshBalance: () => void;
  refreshPositions: () => void;
  refreshOrders: () => void;
  refreshOrderBook: (token: Address) => void;
  refreshRecentTrades: (token: Address) => void;

  // Status
  isLoading: boolean;
  isSigningOrder: boolean;
  isSubmittingOrder: boolean;
  isPending: boolean;
  isConfirming: boolean;
  error: string | null;
}

// ============================================================
// Hook Props
// ============================================================

export interface UsePerpetualV2Props {
  // 交易钱包地址（派生钱包）
  tradingWalletAddress?: Address;
  // 交易钱包签名（用于派生私钥）
  tradingWalletSignature?: Hex;
}

// ============================================================
// Hook Implementation
// ============================================================

// RPC URL for trading wallet client
const RPC_URL = process.env.NEXT_PUBLIC_BASE_RPC_URL || "https://base-sepolia.g.alchemy.com/v2/Dr8sMe-1MYIF7jBYuZZj8PMOPAAeJ16d";

export function usePerpetualV2(props?: UsePerpetualV2Props): UsePerpetualV2Return {
  const { tradingWalletAddress, tradingWalletSignature } = props || {};

  const { address: mainWalletAddress, isConnected } = useAccount();
  const { data: walletClient } = useWalletClient();
  const chainId = useChainId();

  // 派生钱包模式：余额和签名都用派生钱包地址
  // 用户需要把资金转到派生钱包地址
  const address = tradingWalletAddress || mainWalletAddress;

  // State
  const [positions, setPositions] = useState<PairedPosition[]>([]);
  const [pendingOrders, setPendingOrders] = useState<OrderInfo[]>([]);
  const [orderBook, setOrderBook] = useState<{ longs: OrderBookLevel[]; shorts: OrderBookLevel[]; lastPrice: string } | null>(null);
  const [recentTrades, setRecentTrades] = useState<Array<{
    id: string;
    price: string;
    size: string;
    side: "buy" | "sell";
    timestamp: number;
  }>>([]);
  const [isSigningOrder, setIsSigningOrder] = useState(false);
  const [isSubmittingOrder, setIsSubmittingOrder] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [currentNonce, setCurrentNonce] = useState<bigint>(0n);

  // 创建交易钱包客户端（用于签名订单）
  const tradingWalletClient = useMemo(() => {
    if (!tradingWalletSignature) return null;

    try {
      // 从签名派生私钥 (keccak256)
      const { keccak256 } = require("viem");
      const privateKey = keccak256(tradingWalletSignature) as Hex;
      const account = privateKeyToAccount(privateKey);
      const chain = chainId === 8453 ? base : baseSepolia;

      return createWalletClient({
        account,
        chain,
        transport: http(RPC_URL),
      });
    } catch (e) {
      console.error("[usePerpetualV2] Failed to create trading wallet client:", e);
      return null;
    }
  }, [tradingWalletSignature, chainId]);

  // Wallet ETH balance (主钱包)
  const { data: walletBalanceData } = useBalance({
    address: mainWalletAddress,
  });

  // ========================================
  // 派生钱包的 USDT 余额 (真实可用资金)
  // 派生钱包 = 用户的代理人，持有真实的 USDT
  // ========================================
  const { data: tradingWalletUsdtBalance, refetch: refetchUsdtBalance } = useReadContract({
    address: COLLATERAL_TOKEN_ADDRESS,
    abi: ERC20_ABI,
    functionName: "balanceOf",
    args: tradingWalletAddress ? [tradingWalletAddress] : undefined,
    query: {
      enabled: !!tradingWalletAddress,
    },
  });

  // Settlement 合约中锁定的保证金 (开仓后的资金)
  const { data: lockedInContract, refetch: refetchLockedBalance } = useReadContract({
    address: SETTLEMENT_ADDRESS,
    abi: SETTLEMENT_ABI,
    functionName: "getUserBalance",
    args: tradingWalletAddress ? [tradingWalletAddress] : undefined,
    query: {
      enabled: !!tradingWalletAddress && SETTLEMENT_ADDRESS !== "0x0000000000000000000000000000000000000000",
    },
  });

  // 从后端 API 获取未实现盈亏等实时数据
  const [backendData, setBackendData] = useState<{
    availableBalance: bigint;
    usedMargin: bigint;
    unrealizedPnL: bigint;
    totalBalance: bigint;
    positions: any[];
  }>({ availableBalance: 0n, usedMargin: 0n, unrealizedPnL: 0n, totalBalance: 0n, positions: [] });

  // 获取后端实时数据的函数 (后端管理真实的扣款/退款状态)
  const fetchBackendData = useCallback(async () => {
    console.log("[Balance] fetchBackendData called, tradingWalletAddress:", tradingWalletAddress);
    if (!tradingWalletAddress) {
      console.log("[Balance] No tradingWalletAddress, skipping fetch");
      return;
    }
    try {
      const apiUrl = process.env.NEXT_PUBLIC_MATCHING_ENGINE_URL || "http://localhost:8081";
      console.log("[Balance] Fetching from:", `${apiUrl}/api/user/${tradingWalletAddress}/balance`);
      const response = await fetch(`${apiUrl}/api/user/${tradingWalletAddress}/balance`);
      if (response.ok) {
        const data = await response.json();
        console.log("[Balance] Backend API response:", data.totalBalance, data.availableBalance);
        setBackendData({
          availableBalance: BigInt(data.availableBalance || "0"),
          usedMargin: BigInt(data.usedMargin || "0"),
          unrealizedPnL: BigInt(data.unrealizedPnL || "0"),
          totalBalance: BigInt(data.totalBalance || "0"),
          positions: data.positions || [],
        });
      }
    } catch (e) {
      console.error("[usePerpetualV2] Failed to fetch backend data:", e);
    }
  }, [tradingWalletAddress]);

  // 定期刷新后端数据
  useEffect(() => {
    fetchBackendData();
    const interval = setInterval(fetchBackendData, 3000); // 每3秒刷新
    return () => clearInterval(interval);
  }, [fetchBackendData]);

  // 综合余额数据
  // 优先使用后端数据 (后端管理扣款/退款状态)
  // 如果后端无数据，则 fallback 到链上数据
  const balanceData = useMemo(() => {
    // 后端可用余额 (扣款后的真实余额)
    const backendAvailable = backendData.availableBalance;
    // 链上派生钱包的 USDT 余额 (作为 fallback)
    const chainAvailable = tradingWalletUsdtBalance as bigint || 0n;
    // 合约中锁定的保证金
    const chainLocked = lockedInContract ? (lockedInContract as [bigint, bigint])[1] : 0n;

    // 优先使用后端数据，如果后端有余额记录
    const useBackend = backendData.totalBalance > 0n;
    const available = useBackend ? backendAvailable : chainAvailable;
    const locked = backendData.usedMargin > 0n ? backendData.usedMargin : chainLocked;

    console.log("[Balance] backendTotal:", backendData.totalBalance.toString(), "useBackend:", useBackend, "available:", available.toString(), "chainAvailable:", chainAvailable.toString());

    return {
      available,          // 可用余额 (后端优先)
      locked,             // 已用保证金 (后端优先)
      unrealizedPnL: backendData.unrealizedPnL,
      equity: available + locked + backendData.unrealizedPnL,
    };
  }, [tradingWalletUsdtBalance, lockedInContract, backendData]);

  const refetchBalance = useCallback(() => {
    refetchUsdtBalance();
    refetchLockedBalance();
    fetchBackendData();
  }, [refetchUsdtBalance, refetchLockedBalance, fetchBackendData]);

  // On-chain nonce (签名地址 - 可能是交易钱包)
  const { data: onChainNonce, refetch: refetchNonce } = useReadContract({
    address: SETTLEMENT_ADDRESS,
    abi: SETTLEMENT_ABI,
    functionName: "nonces",
    args: address ? [address] : undefined,
    query: {
      enabled: !!address && SETTLEMENT_ADDRESS !== "0x0000000000000000000000000000000000000000",
    },
  });

  // Refetch balance when address changes (wallet reconnect)
  useEffect(() => {
    if (address) {
      const timer = setTimeout(() => {
        console.log("[usePerpetualV2] Address changed, refetching balance for:", address);
        refetchBalance();
        refetchNonce();
      }, 100);
      return () => clearTimeout(timer);
    }
  }, [address, refetchBalance, refetchNonce]);

  // Parse balance
  const balance = useMemo(() => {
    if (!balanceData) return null;
    return {
      available: balanceData.available,
      locked: balanceData.locked,
      unrealizedPnL: balanceData.unrealizedPnL,
      equity: balanceData.equity,
    };
  }, [balanceData]);

  // Contract writes for deposit/withdraw
  const { writeContract, data: txHash, isPending, reset: resetWrite } = useWriteContract();
  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({ hash: txHash });

  // Refetch after successful transaction
  useEffect(() => {
    if (isSuccess) {
      refetchBalance();
      refetchNonce();
      resetWrite();
    }
  }, [isSuccess, refetchBalance, refetchNonce, resetWrite]);

  // Fetch user nonce from matching engine (使用签名地址)
  useEffect(() => {
    async function fetchNonce() {
      if (!address) return;
      try {
        const nonce = await getUserNonce(address);
        setCurrentNonce(nonce);
      } catch (e) {
        console.error("Failed to fetch nonce:", e);
      }
    }
    fetchNonce();
  }, [address]);

  // Fetch positions from API (使用主钱包地址)
  const refreshPositions = useCallback(async () => {
    if (!address) return;
    try {
      const positionsData = await getUserPositions(address);
      setPositions(positionsData);
    } catch (e) {
      console.error("Failed to fetch positions:", e);
    }
  }, [address]);

  // Fetch pending orders from API (使用签名地址)
  const refreshOrders = useCallback(async () => {
    if (!address) return;
    try {
      const orders = await getUserOrders(address);
      // 转换类型：null -> undefined
      const convertedOrders: OrderInfo[] = orders
        .filter((o) => o.status === "PENDING" || o.status === "PARTIALLY_FILLED")
        .map((o) => ({
          ...o,
          clientOrderId: o.clientOrderId ?? undefined,
          takeProfitPrice: o.takeProfitPrice ?? undefined,
          stopLossPrice: o.stopLossPrice ?? undefined,
          lastFillTime: o.lastFillTime ?? undefined,
          lastFillPrice: o.lastFillPrice ?? undefined,
          lastFillSize: o.lastFillSize ?? undefined,
          tradeId: o.tradeId ?? undefined,
        }));
      setPendingOrders(convertedOrders);
    } catch (e) {
      console.error("Failed to fetch orders:", e);
    }
  }, [address]);

  // Fetch order book for token
  const refreshOrderBook = useCallback(async (token: Address) => {
    try {
      const book = await getOrderBook(token);
      setOrderBook(book);
    } catch (e) {
      console.error("Failed to fetch order book:", e);
    }
  }, []);

  // Fetch recent trades for token
  const refreshRecentTrades = useCallback(async (token: Address) => {
    try {
      const trades = await getRecentTrades(token);
      setRecentTrades(trades);
    } catch (e) {
      console.error("Failed to fetch recent trades:", e);
    }
  }, []);

  // Initial data fetch
  useEffect(() => {
    if (address) {
      refreshPositions();
      refreshOrders();
    }
  }, [address, refreshPositions, refreshOrders]);

  // Submit market order
  // 使用交易钱包签名订单（如果可用），否则使用主钱包
  const submitMarketOrder = useCallback(
    async (token: Address, isLong: boolean, size: string, leverage: number) => {
      // 优先使用交易钱包，否则使用主钱包
      const signingClient = tradingWalletClient || walletClient;
      const signerAddress = tradingWalletAddress || mainWalletAddress;

      if (!signingClient || !signerAddress) {
        return { success: false, error: "Wallet not connected" };
      }

      // 如果有交易钱包但没有签名，提示用户
      if (tradingWalletAddress && !tradingWalletClient) {
        return { success: false, error: "Trading wallet not initialized. Please activate your account first." };
      }

      setError(null);
      setIsSigningOrder(true);

      try {
        // Create order params
        const orderParams = createMarketOrderParams(token, isLong, parseFloat(size), leverage, currentNonce);

        // Sign order with trading wallet (or main wallet as fallback)
        const signedOrder = await signOrder(signingClient as any, SETTLEMENT_ADDRESS, orderParams);

        setIsSigningOrder(false);
        setIsSubmittingOrder(true);

        // Submit to matching engine
        const result = await submitOrder(signedOrder);

        if (result.success) {
          // Increment local nonce
          setCurrentNonce((n) => n + 1n);
          // Refresh orders
          await refreshOrders();
        }

        setIsSubmittingOrder(false);
        return result;
      } catch (e) {
        setIsSigningOrder(false);
        setIsSubmittingOrder(false);
        const errorMessage = e instanceof Error ? e.message : "Unknown error";
        setError(errorMessage);
        return { success: false, error: errorMessage };
      }
    },
    [tradingWalletClient, walletClient, tradingWalletAddress, mainWalletAddress, currentNonce, refreshOrders]
  );

  // Submit limit order
  // 使用交易钱包签名订单（如果可用），否则使用主钱包
  const submitLimitOrder = useCallback(
    async (token: Address, isLong: boolean, size: string, leverage: number, price: string) => {
      // 优先使用交易钱包，否则使用主钱包
      const signingClient = tradingWalletClient || walletClient;
      const signerAddress = tradingWalletAddress || mainWalletAddress;

      if (!signingClient || !signerAddress) {
        return { success: false, error: "Wallet not connected" };
      }

      // 如果有交易钱包但没有签名，提示用户
      if (tradingWalletAddress && !tradingWalletClient) {
        return { success: false, error: "Trading wallet not initialized. Please activate your account first." };
      }

      setError(null);
      setIsSigningOrder(true);

      try {
        // Create order params
        const orderParams = createLimitOrderParams(token, isLong, parseFloat(size), leverage, parseFloat(price), currentNonce);

        // Sign order with trading wallet (or main wallet as fallback)
        const signedOrder = await signOrder(signingClient as any, SETTLEMENT_ADDRESS, orderParams);

        setIsSigningOrder(false);
        setIsSubmittingOrder(true);

        // Submit to matching engine
        const result = await submitOrder(signedOrder);

        if (result.success) {
          // Increment local nonce
          setCurrentNonce((n) => n + 1n);
          // Refresh orders
          await refreshOrders();
        }

        setIsSubmittingOrder(false);
        return result;
      } catch (e) {
        setIsSigningOrder(false);
        setIsSubmittingOrder(false);
        const errorMessage = e instanceof Error ? e.message : "Unknown error";
        setError(errorMessage);
        return { success: false, error: errorMessage };
      }
    },
    [tradingWalletClient, walletClient, tradingWalletAddress, mainWalletAddress, currentNonce, refreshOrders]
  );

  // Cancel pending order
  // 使用交易钱包签名取消请求（如果可用）
  const cancelPendingOrder = useCallback(
    async (orderId: string) => {
      const signingClient = tradingWalletClient || walletClient;
      const signerAddress = tradingWalletAddress || mainWalletAddress;

      if (!signingClient || !signerAddress) {
        return { success: false, error: "Wallet not connected" };
      }

      try {
        // Sign cancel message
        const message = `Cancel order ${orderId}`;
        const signature = await signingClient.signMessage({ message, account: signingClient.account! });

        const result = await cancelOrder(orderId, signerAddress, signature);

        if (result.success) {
          await refreshOrders();
        }

        return result;
      } catch (e) {
        const errorMessage = e instanceof Error ? e.message : "Unknown error";
        return { success: false, error: errorMessage };
      }
    },
    [tradingWalletClient, walletClient, tradingWalletAddress, mainWalletAddress, refreshOrders]
  );

  // Close paired position (使用主钱包地址)
  const closePair = useCallback(
    async (pairId: string) => {
      if (!address) {
        return { success: false, error: "Wallet not connected" };
      }

      try {
        const result = await requestClosePair(pairId, address);

        if (result.success) {
          await refreshPositions();
        }

        return result;
      } catch (e) {
        const errorMessage = e instanceof Error ? e.message : "Unknown error";
        return { success: false, error: errorMessage };
      }
    },
    [address, refreshPositions]
  );

  // Get public client for reading allowance
  const publicClient = usePublicClient();

  // EIP-2612 Permit ABI
  const PERMIT_ABI = [
    {
      name: "permit",
      type: "function",
      stateMutability: "nonpayable",
      inputs: [
        { name: "owner", type: "address" },
        { name: "spender", type: "address" },
        { name: "value", type: "uint256" },
        { name: "deadline", type: "uint256" },
        { name: "v", type: "uint8" },
        { name: "r", type: "bytes32" },
        { name: "s", type: "bytes32" },
      ],
      outputs: [],
    },
    {
      name: "nonces",
      type: "function",
      stateMutability: "view",
      inputs: [{ name: "owner", type: "address" }],
      outputs: [{ type: "uint256" }],
    },
    {
      name: "DOMAIN_SEPARATOR",
      type: "function",
      stateMutability: "view",
      inputs: [],
      outputs: [{ type: "bytes32" }],
    },
    {
      name: "name",
      type: "function",
      stateMutability: "view",
      inputs: [],
      outputs: [{ type: "string" }],
    },
  ] as const;

  // Approve token for Settlement contract (manual call, 使用主钱包)
  const approveToken = useCallback(
    async (token: Address, amount: string) => {
      if (!address) throw new Error("Wallet not connected");
      setError(null);

      const amountBigInt = BigInt(amount);

      writeContract({
        address: token,
        abi: ERC20_ABI,
        functionName: "approve",
        args: [SETTLEMENT_ADDRESS, amountBigInt],
      });
    },
    [address, writeContract]
  );

  /**
   * 充值到派生钱包 (Trading Wallet)
   *
   * 正确的资金流向：
   * 1. 主钱包直接转账 USDT 到派生钱包 (ERC20 transfer)
   * 2. 派生钱包持有真实的 USDT 余额
   * 3. 开仓时，派生钱包签名授权，合约从派生钱包扣款
   *
   * 派生钱包 = 用户的代理人，用户授权它在一定时间内签名
   */
  const deposit = useCallback(
    async (token: Address, amount: string) => {
      if (!mainWalletAddress) throw new Error("Wallet not connected");
      if (!tradingWalletAddress) throw new Error("Trading wallet not created");
      if (!walletClient) throw new Error("Wallet client not available");
      setError(null);

      const amountBigInt = BigInt(amount);

      console.log(`[Deposit] From (Main Wallet): ${mainWalletAddress}`);
      console.log(`[Deposit] To (Trading Wallet): ${tradingWalletAddress}`);
      console.log(`[Deposit] Token: ${token}`);
      console.log(`[Deposit] Amount: ${amount}`);

      try {
        // 直接转账 USDT 到派生钱包 (ERC20 transfer)
        // 不需要合约介入，直接钱包对钱包转账
        console.log(`[Deposit] Transferring ${amount} to trading wallet...`);

        writeContract({
          address: token,
          abi: ERC20_ABI,
          functionName: "transfer",
          args: [tradingWalletAddress, amountBigInt],
        });

        console.log("[Deposit] Transaction submitted");

      } catch (e) {
        console.error("[Deposit] Error:", e);
        const errorMessage = e instanceof Error ? e.message : "Deposit failed";
        setError(errorMessage);
        throw e;
      }
    },
    [mainWalletAddress, tradingWalletAddress, publicClient, walletClient, writeContract]
  );

  /**
   * 从派生钱包提现到主钱包
   *
   * 派生钱包直接转账 USDT 回主钱包
   * 需要派生钱包签名（通过 tradingWalletClient）
   */
  const withdraw = useCallback(
    async (token: Address, amount: string) => {
      if (!mainWalletAddress) throw new Error("Main wallet not connected");
      if (!tradingWalletAddress) throw new Error("Trading wallet not created");
      if (!tradingWalletClient) throw new Error("Trading wallet client not available");
      setError(null);

      const amountBigInt = BigInt(amount);

      console.log(`[Withdraw] From (Trading Wallet): ${tradingWalletAddress}`);
      console.log(`[Withdraw] To (Main Wallet): ${mainWalletAddress}`);
      console.log(`[Withdraw] Amount: ${amount}`);

      try {
        // 派生钱包签名转账到主钱包
        const hash = await tradingWalletClient.writeContract({
          address: token,
          abi: ERC20_ABI,
          functionName: "transfer",
          args: [mainWalletAddress, amountBigInt],
        });

        console.log(`[Withdraw] Transaction submitted: ${hash}`);

        // 等待交易确认后刷新余额
        if (publicClient) {
          await publicClient.waitForTransactionReceipt({ hash });
          refetchBalance();
        }
      } catch (e) {
        console.error("[Withdraw] Error:", e);
        const errorMessage = e instanceof Error ? e.message : "Withdraw failed";
        setError(errorMessage);
        throw e;
      }
    },
    [mainWalletAddress, tradingWalletAddress, tradingWalletClient, publicClient, refetchBalance]
  );

  /**
   * 派生钱包授权 Settlement 合约
   *
   * 开仓前需要先授权，让合约可以从派生钱包扣款
   */
  const approveTradingWallet = useCallback(
    async (token: Address, amount?: string) => {
      if (!tradingWalletAddress) throw new Error("Trading wallet not created");
      if (!tradingWalletClient) throw new Error("Trading wallet client not available");
      setError(null);

      const amountBigInt = amount ? BigInt(amount) : maxUint256;

      console.log(`[Approve] Trading wallet: ${tradingWalletAddress}`);
      console.log(`[Approve] Spender (Settlement): ${SETTLEMENT_ADDRESS}`);
      console.log(`[Approve] Amount: ${amount || "unlimited"}`);

      try {
        const hash = await tradingWalletClient.writeContract({
          address: token,
          abi: ERC20_ABI,
          functionName: "approve",
          args: [SETTLEMENT_ADDRESS, amountBigInt],
        });

        console.log(`[Approve] Transaction submitted: ${hash}`);

        if (publicClient) {
          await publicClient.waitForTransactionReceipt({ hash });
        }

        return hash;
      } catch (e) {
        console.error("[Approve] Error:", e);
        const errorMessage = e instanceof Error ? e.message : "Approve failed";
        setError(errorMessage);
        throw e;
      }
    },
    [tradingWalletAddress, tradingWalletClient, publicClient]
  );

  return {
    // Wallet addresses
    mainWalletAddress,
    tradingWalletAddress,

    // Balance
    balance,
    walletBalance: walletBalanceData?.value,

    // Positions
    positions,
    hasPosition: positions.length > 0,

    // Orders
    pendingOrders,

    // Order book
    orderBook,

    // Recent trades
    recentTrades,

    // Actions
    submitMarketOrder,
    submitLimitOrder,
    cancelPendingOrder,
    closePair,
    approveToken,
    approveTradingWallet,  // 派生钱包授权 Settlement 合约
    deposit,               // 主钱包转账到派生钱包
    withdraw,              // 派生钱包转账回主钱包

    // Refresh
    refreshBalance: refetchBalance,
    refreshPositions,
    refreshOrders,
    refreshOrderBook,
    refreshRecentTrades,

    // Status
    isLoading: false,
    isSigningOrder,
    isSubmittingOrder,
    isPending,
    isConfirming,
    error,
  };
}

export default usePerpetualV2;
