/**
 * 永续合约状态管理 Store
 * 管理仓位、订单、账户余额等状态
 */

import { create } from "zustand";
import { persist } from "zustand/middleware";

// ========== 类型定义 ==========

// 仓位方向
export type PositionSide = "long" | "short";

// 保证金模式
export type MarginMode = "cross" | "isolated";

// 订单状态
export type OrderStatus =
  | "pending"
  | "open"
  | "partial_filled"
  | "filled"
  | "cancelled"
  | "rejected";

// 订单类型
export type OrderType = "market" | "limit" | "stop_limit" | "stop_market";

// 订单方向
export type OrderSide = "open_long" | "open_short" | "close_long" | "close_short";

// 仓位数据
export interface Position {
  posId: string;
  instId: string; // 交易对ID，如 "PEPE-PERP"
  side: PositionSide;
  size: string; // 仓位大小
  entryPrice: string; // 开仓均价
  markPrice: string; // 标记价格
  liquidationPrice: string; // 强平价格
  margin: string; // 保证金
  leverage: number; // 杠杆倍数
  marginMode: MarginMode;
  unrealizedPnl: string; // 未实现盈亏
  unrealizedPnlPercent: string; // 未实现盈亏百分比
  maintenanceMargin: string; // 维持保证金
  marginRatio: string; // 保证金率
  createdAt: number;
  updatedAt: number;
}

// 订单数据
export interface Order {
  orderId: string;
  instId: string;
  side: OrderSide;
  orderType: OrderType;
  price: string; // 委托价格
  stopPrice?: string; // 触发价格 (止损单)
  size: string; // 委托数量
  filled: string; // 已成交数量
  avgFillPrice?: string; // 成交均价
  status: OrderStatus;
  reduceOnly: boolean;
  postOnly: boolean;
  takeProfitPrice?: string;
  stopLossPrice?: string;
  leverage: number;
  marginMode: MarginMode;
  fee?: string; // 手续费
  createdAt: number;
  updatedAt: number;
}

// 成交记录
export interface Trade {
  tradeId: string;
  orderId: string;
  instId: string;
  side: OrderSide;
  price: string;
  size: string;
  fee: string;
  feeCcy: string;
  realizedPnl?: string;
  timestamp: number;
}

// 账户余额
export interface AccountBalance {
  available: string; // 可用余额
  locked: string; // 锁定余额（保证金）
  total: string; // 总余额
  unrealizedPnl: string; // 未实现盈亏
  equity: string; // 权益 = total + unrealizedPnl
  marginUsed: string; // 已用保证金
  marginRatio: string; // 账户保证金率
  updatedAt: number;
}

// 市场数据
export interface MarketData {
  instId: string;
  lastPrice: string;
  markPrice: string;
  indexPrice: string;
  fundingRate: string;
  nextFundingTime: number;
  openInterest: string;
  volume24h: string;
  high24h: string;
  low24h: string;
  change24h: string;
  changePercent24h: string;
  updatedAt: number;
}

// 杠杆设置
export interface LeverageSettings {
  instId: string;
  leverage: number;
  marginMode: MarginMode;
}

// ========== Store 状态 ==========

export interface PerpetualState {
  // 账户余额
  accountBalance: AccountBalance | null;

  // 当前仓位列表
  positions: Position[];

  // 当前委托订单
  openOrders: Order[];

  // 历史订单
  orderHistory: Order[];

  // 成交记录
  trades: Trade[];

  // 市场数据缓存
  marketData: Record<string, MarketData>;

  // 杠杆设置
  leverageSettings: Record<string, LeverageSettings>;

  // 选中的交易对
  selectedInstId: string;

  // 订单表单状态
  orderForm: {
    side: PositionSide;
    orderType: OrderType;
    price: string;
    stopPrice: string;
    size: string;
    leverage: number;
    marginMode: MarginMode;
    takeProfitPrice: string;
    stopLossPrice: string;
    reduceOnly: boolean;
    postOnly: boolean;
  };

  // 加载状态
  isLoading: {
    positions: boolean;
    orders: boolean;
    balance: boolean;
    market: boolean;
  };

  // 错误状态
  errors: {
    positions: string | null;
    orders: string | null;
    balance: string | null;
    market: string | null;
  };

  // ========== Actions ==========

  // 账户余额
  setAccountBalance: (balance: AccountBalance) => void;
  updateAccountBalance: (updates: Partial<AccountBalance>) => void;

  // 仓位管理
  setPositions: (positions: Position[]) => void;
  updatePosition: (posId: string, updates: Partial<Position>) => void;
  removePosition: (posId: string) => void;
  clearPositions: () => void;

  // 订单管理
  setOpenOrders: (orders: Order[]) => void;
  addOrder: (order: Order) => void;
  updateOrder: (orderId: string, updates: Partial<Order>) => void;
  removeOrder: (orderId: string) => void;
  moveOrderToHistory: (orderId: string) => void;

  // 历史订单
  setOrderHistory: (orders: Order[]) => void;
  addToOrderHistory: (order: Order) => void;

  // 成交记录
  setTrades: (trades: Trade[]) => void;
  addTrade: (trade: Trade) => void;

  // 市场数据
  setMarketData: (instId: string, data: MarketData) => void;
  updateMarketPrice: (
    instId: string,
    lastPrice: string,
    markPrice: string
  ) => void;

  // 杠杆设置
  setLeverageSettings: (instId: string, settings: LeverageSettings) => void;
  updateLeverage: (instId: string, leverage: number) => void;
  updateMarginMode: (instId: string, mode: MarginMode) => void;

  // 选中交易对
  setSelectedInstId: (instId: string) => void;

  // 订单表单
  updateOrderForm: (updates: Partial<PerpetualState["orderForm"]>) => void;
  resetOrderForm: () => void;

  // 加载状态
  setLoading: (key: keyof PerpetualState["isLoading"], value: boolean) => void;

  // 错误状态
  setError: (key: keyof PerpetualState["errors"], error: string | null) => void;
  clearErrors: () => void;

  // 工具方法
  getPositionByInstId: (instId: string) => Position | undefined;
  getOpenOrdersByInstId: (instId: string) => Order[];
  getMarketData: (instId: string) => MarketData | undefined;
  getLeverageSettings: (instId: string) => LeverageSettings | undefined;
  calculatePositionPnl: (position: Position, markPrice: string) => {
    unrealizedPnl: string;
    unrealizedPnlPercent: string;
    roe: string;
  };
}

// 默认订单表单状态
const DEFAULT_ORDER_FORM: PerpetualState["orderForm"] = {
  side: "long",
  orderType: "market",
  price: "",
  stopPrice: "",
  size: "",
  leverage: 10,
  marginMode: "cross",
  takeProfitPrice: "",
  stopLossPrice: "",
  reduceOnly: false,
  postOnly: false,
};

// 默认加载状态
const DEFAULT_LOADING: PerpetualState["isLoading"] = {
  positions: false,
  orders: false,
  balance: false,
  market: false,
};

// 默认错误状态
const DEFAULT_ERRORS: PerpetualState["errors"] = {
  positions: null,
  orders: null,
  balance: null,
  market: null,
};

// ========== 创建 Store ==========

export const usePerpetualStore = create<PerpetualState>()(
  persist(
    (set, get) => ({
      // 初始状态
      accountBalance: null,
      positions: [],
      openOrders: [],
      orderHistory: [],
      trades: [],
      marketData: {},
      leverageSettings: {},
      selectedInstId: "PEPE-PERP",
      orderForm: DEFAULT_ORDER_FORM,
      isLoading: DEFAULT_LOADING,
      errors: DEFAULT_ERRORS,

      // 账户余额
      setAccountBalance: (balance) =>
        set({ accountBalance: { ...balance, updatedAt: Date.now() } }),

      updateAccountBalance: (updates) =>
        set((state) => ({
          accountBalance: state.accountBalance
            ? { ...state.accountBalance, ...updates, updatedAt: Date.now() }
            : null,
        })),

      // 仓位管理
      setPositions: (positions) => set({ positions }),

      updatePosition: (posId, updates) =>
        set((state) => ({
          positions: state.positions.map((pos) =>
            pos.posId === posId
              ? { ...pos, ...updates, updatedAt: Date.now() }
              : pos
          ),
        })),

      removePosition: (posId) =>
        set((state) => ({
          positions: state.positions.filter((pos) => pos.posId !== posId),
        })),

      clearPositions: () => set({ positions: [] }),

      // 订单管理
      setOpenOrders: (orders) => set({ openOrders: orders }),

      addOrder: (order) =>
        set((state) => ({
          openOrders: [order, ...state.openOrders],
        })),

      updateOrder: (orderId, updates) =>
        set((state) => ({
          openOrders: state.openOrders.map((order) =>
            order.orderId === orderId
              ? { ...order, ...updates, updatedAt: Date.now() }
              : order
          ),
        })),

      removeOrder: (orderId) =>
        set((state) => ({
          openOrders: state.openOrders.filter(
            (order) => order.orderId !== orderId
          ),
        })),

      moveOrderToHistory: (orderId) =>
        set((state) => {
          const order = state.openOrders.find((o) => o.orderId === orderId);
          if (!order) return state;

          return {
            openOrders: state.openOrders.filter((o) => o.orderId !== orderId),
            orderHistory: [order, ...state.orderHistory].slice(0, 500),
          };
        }),

      // 历史订单
      setOrderHistory: (orders) => set({ orderHistory: orders }),

      addToOrderHistory: (order) =>
        set((state) => ({
          orderHistory: [order, ...state.orderHistory].slice(0, 500),
        })),

      // 成交记录
      setTrades: (trades) => set({ trades }),

      addTrade: (trade) =>
        set((state) => ({
          trades: [trade, ...state.trades].slice(0, 500),
        })),

      // 市场数据
      setMarketData: (instId, data) =>
        set((state) => ({
          marketData: {
            ...state.marketData,
            [instId]: { ...data, updatedAt: Date.now() },
          },
        })),

      updateMarketPrice: (instId, lastPrice, markPrice) =>
        set((state) => ({
          marketData: {
            ...state.marketData,
            [instId]: state.marketData[instId]
              ? {
                  ...state.marketData[instId],
                  lastPrice,
                  markPrice,
                  updatedAt: Date.now(),
                }
              : {
                  instId,
                  lastPrice,
                  markPrice,
                  indexPrice: markPrice,
                  fundingRate: "0",
                  nextFundingTime: 0,
                  openInterest: "0",
                  volume24h: "0",
                  high24h: "0",
                  low24h: "0",
                  change24h: "0",
                  changePercent24h: "0",
                  updatedAt: Date.now(),
                },
          },
        })),

      // 杠杆设置
      setLeverageSettings: (instId, settings) =>
        set((state) => ({
          leverageSettings: {
            ...state.leverageSettings,
            [instId]: settings,
          },
        })),

      updateLeverage: (instId, leverage) =>
        set((state) => ({
          leverageSettings: {
            ...state.leverageSettings,
            [instId]: {
              ...(state.leverageSettings[instId] || {
                instId,
                marginMode: "cross" as MarginMode,
              }),
              leverage,
            },
          },
          orderForm: {
            ...state.orderForm,
            leverage,
          },
        })),

      updateMarginMode: (instId, mode) =>
        set((state) => ({
          leverageSettings: {
            ...state.leverageSettings,
            [instId]: {
              ...(state.leverageSettings[instId] || { instId, leverage: 10 }),
              marginMode: mode,
            },
          },
          orderForm: {
            ...state.orderForm,
            marginMode: mode,
          },
        })),

      // 选中交易对
      setSelectedInstId: (instId) => set({ selectedInstId: instId }),

      // 订单表单
      updateOrderForm: (updates) =>
        set((state) => ({
          orderForm: { ...state.orderForm, ...updates },
        })),

      resetOrderForm: () =>
        set((state) => ({
          orderForm: {
            ...DEFAULT_ORDER_FORM,
            leverage:
              state.leverageSettings[state.selectedInstId]?.leverage || 10,
            marginMode:
              state.leverageSettings[state.selectedInstId]?.marginMode ||
              "cross",
          },
        })),

      // 加载状态
      setLoading: (key, value) =>
        set((state) => ({
          isLoading: { ...state.isLoading, [key]: value },
        })),

      // 错误状态
      setError: (key, error) =>
        set((state) => ({
          errors: { ...state.errors, [key]: error },
        })),

      clearErrors: () => set({ errors: DEFAULT_ERRORS }),

      // 工具方法
      getPositionByInstId: (instId) => {
        return get().positions.find((pos) => pos.instId === instId);
      },

      getOpenOrdersByInstId: (instId) => {
        return get().openOrders.filter((order) => order.instId === instId);
      },

      getMarketData: (instId) => {
        return get().marketData[instId];
      },

      getLeverageSettings: (instId) => {
        return get().leverageSettings[instId];
      },

      calculatePositionPnl: (position, markPrice) => {
        const size = parseFloat(position.size);
        const entryPrice = parseFloat(position.entryPrice);
        const mark = parseFloat(markPrice);
        const margin = parseFloat(position.margin);

        if (isNaN(size) || isNaN(entryPrice) || isNaN(mark) || isNaN(margin)) {
          return {
            unrealizedPnl: "0",
            unrealizedPnlPercent: "0",
            roe: "0",
          };
        }

        let pnl: number;
        if (position.side === "long") {
          pnl = size * (mark - entryPrice);
        } else {
          pnl = size * (entryPrice - mark);
        }

        const pnlPercent = (pnl / (size * entryPrice)) * 100;
        const roe = margin > 0 ? (pnl / margin) * 100 : 0;

        return {
          unrealizedPnl: pnl.toFixed(4),
          unrealizedPnlPercent: pnlPercent.toFixed(2),
          roe: roe.toFixed(2),
        };
      },
    }),
    {
      name: "meme-perp-perpetual-storage",
      partialize: (state) => ({
        leverageSettings: state.leverageSettings,
        selectedInstId: state.selectedInstId,
      }),
    }
  )
);

// ========== 选择器 Hooks ==========

// 账户相关
export const useAccountBalance = () =>
  usePerpetualStore((state) => state.accountBalance);

// 仓位相关
export const usePositions = () =>
  usePerpetualStore((state) => state.positions);
export const usePositionByInstId = (instId: string) =>
  usePerpetualStore((state) =>
    state.positions.find((pos) => pos.instId === instId)
  );
export const useHasOpenPosition = (instId: string) =>
  usePerpetualStore((state) =>
    state.positions.some((pos) => pos.instId === instId)
  );

// 订单相关
export const useOpenOrders = () =>
  usePerpetualStore((state) => state.openOrders);
export const useOpenOrdersByInstId = (instId: string) =>
  usePerpetualStore((state) =>
    state.openOrders.filter((order) => order.instId === instId)
  );
export const useOrderHistory = () =>
  usePerpetualStore((state) => state.orderHistory);

// 成交记录
export const useTrades = () => usePerpetualStore((state) => state.trades);
export const useTradesByInstId = (instId: string) =>
  usePerpetualStore((state) =>
    state.trades.filter((trade) => trade.instId === instId)
  );

// 市场数据
export const useMarketData = (instId: string) =>
  usePerpetualStore((state) => state.marketData[instId]);
export const useAllMarketData = () =>
  usePerpetualStore((state) => state.marketData);

// 杠杆设置 - 默认值放在组件外部避免每次渲染创建新对象
const DEFAULT_LEVERAGE_SETTINGS: LeverageSettings = {
  instId: "",
  leverage: 10,
  marginMode: "cross" as MarginMode,
};

export const useLeverageSettings = (instId: string) =>
  usePerpetualStore(
    (state) => state.leverageSettings[instId] ?? DEFAULT_LEVERAGE_SETTINGS
  );

// 选中交易对
export const useSelectedInstId = () =>
  usePerpetualStore((state) => state.selectedInstId);

// 订单表单
export const useOrderForm = () =>
  usePerpetualStore((state) => state.orderForm);

// 加载状态
export const useIsLoading = () =>
  usePerpetualStore((state) => state.isLoading);

// 错误状态
export const useErrors = () => usePerpetualStore((state) => state.errors);

// ========== 工具函数 ==========

export const perpetualStoreUtils = {
  // 计算总权益
  calculateTotalEquity: (): string => {
    const state = usePerpetualStore.getState();
    if (!state.accountBalance) return "0";

    const total = parseFloat(state.accountBalance.total);
    const unrealizedPnl = state.positions.reduce((sum, pos) => {
      return sum + parseFloat(pos.unrealizedPnl || "0");
    }, 0);

    return (total + unrealizedPnl).toFixed(4);
  },

  // 计算可用保证金
  calculateAvailableMargin: (): string => {
    const state = usePerpetualStore.getState();
    if (!state.accountBalance) return "0";

    return state.accountBalance.available;
  },

  // 计算总未实现盈亏
  calculateTotalUnrealizedPnl: (): string => {
    const state = usePerpetualStore.getState();
    const total = state.positions.reduce((sum, pos) => {
      return sum + parseFloat(pos.unrealizedPnl || "0");
    }, 0);
    return total.toFixed(4);
  },

  // 获取仓位风险等级
  getPositionRiskLevel: (
    position: Position
  ): "safe" | "warning" | "danger" => {
    const marginRatio = parseFloat(position.marginRatio);
    if (marginRatio >= 50) return "safe";
    if (marginRatio >= 20) return "warning";
    return "danger";
  },

  // 重置所有状态
  resetAll: () => {
    usePerpetualStore.setState({
      accountBalance: null,
      positions: [],
      openOrders: [],
      orderHistory: [],
      trades: [],
      marketData: {},
      orderForm: DEFAULT_ORDER_FORM,
      isLoading: DEFAULT_LOADING,
      errors: DEFAULT_ERRORS,
    });
  },
};
