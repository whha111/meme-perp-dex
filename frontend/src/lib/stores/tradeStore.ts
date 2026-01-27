/**
 * 交易状态管理 Store
 * 管理交易相关的全局状态
 */

import { create } from 'zustand';

// 交易报价
export interface TradeQuote {
  instId?: string; // 交易对ID，如 "MEME-BNB"
  domain?: string; // 域名，如 "pepe.meme" (alias for instId)
  amountIn: string;
  amountOut: string;
  minimumReceived: string;
  priceImpact: number; // 价格影响百分比
  slippage: number; // 滑点百分比
  timestamp: number;
}

// 交易表单状态
export interface TradeFormState {
  instId: string; // 交易对ID
  amount: string;
  isBuy: boolean;
  slippage: number;
  deadline: number;
}

// 交易历史记录
export interface TradeHistoryItem {
  id: string;
  instId: string; // 交易对ID
  type: 'buy' | 'sell';
  amountIn: string;
  amountOut: string;
  price: string;
  timestamp: number;
  txHash: string;
  status: 'pending' | 'confirmed' | 'failed';
}

// 交易状态
export interface TradeState {
  // 当前交易表单
  form: TradeFormState;
  
  // 当前报价
  currentQuote: TradeQuote | null;
  
  // 报价历史
  quoteHistory: TradeQuote[];
  
  // 交易历史
  tradeHistory: TradeHistoryItem[];
  
  // 正在进行的交易
  pendingTrades: Set<string>;
  
  // 更新方法
  updateForm: (updates: Partial<TradeFormState>) => void;
  resetForm: () => void;
  
  setCurrentQuote: (quote: TradeQuote | null) => void;
  addToQuoteHistory: (quote: TradeQuote) => void;
  clearQuoteHistory: () => void;
  
  addTradeToHistory: (trade: Omit<TradeHistoryItem, 'id' | 'timestamp'>) => void;
  updateTradeStatus: (txHash: string, status: TradeHistoryItem['status']) => void;
  clearTradeHistory: () => void;
  
  addPendingTrade: (txHash: string) => void;
  removePendingTrade: (txHash: string) => void;
  clearPendingTrades: () => void;
  
  // 工具方法
  getLastQuoteForInstrument: (instId: string) => TradeQuote | null;
  getTradeHistoryForInstrument: (instId: string) => TradeHistoryItem[];
  getPendingTradesForInstrument: (instId: string) => string[];
}

// 默认表单状态
const DEFAULT_FORM_STATE: TradeFormState = {
  instId: '',
  amount: '',
  isBuy: true,
  slippage: 0.5, // 0.5%
  deadline: 20, // 20分钟
};

// 创建交易 Store
export const useTradeStore = create<TradeState>((set, get) => ({
  // 初始状态
  form: DEFAULT_FORM_STATE,
  currentQuote: null,
  quoteHistory: [],
  tradeHistory: [],
  pendingTrades: new Set(),
  
  // 表单更新
  updateForm: (updates) =>
    set((state) => ({
      form: { ...state.form, ...updates },
    })),
  
  resetForm: () =>
    set({ form: DEFAULT_FORM_STATE }),
  
  // 报价管理
  setCurrentQuote: (quote) =>
    set({ currentQuote: quote }),
  
  addToQuoteHistory: (quote) =>
    set((state) => ({
      quoteHistory: [quote, ...state.quoteHistory].slice(0, 100), // 最多100条
    })),
  
  clearQuoteHistory: () =>
    set({ quoteHistory: [] }),
  
  // 交易历史管理
  addTradeToHistory: (trade) =>
    set((state) => ({
      tradeHistory: [
        {
          ...trade,
          id: `${trade.txHash}-${Date.now()}`,
          timestamp: Date.now(),
        },
        ...state.tradeHistory,
      ].slice(0, 200), // 最多200条
    })),
  
  updateTradeStatus: (txHash, status) =>
    set((state) => ({
      tradeHistory: state.tradeHistory.map((trade) =>
        trade.txHash === txHash ? { ...trade, status } : trade
      ),
    })),
  
  clearTradeHistory: () =>
    set({ tradeHistory: [] }),
  
  // 进行中交易管理
  addPendingTrade: (txHash) =>
    set((state) => {
      const newPendingTrades = new Set(state.pendingTrades);
      newPendingTrades.add(txHash);
      return { pendingTrades: newPendingTrades };
    }),
  
  removePendingTrade: (txHash) =>
    set((state) => {
      const newPendingTrades = new Set(state.pendingTrades);
      newPendingTrades.delete(txHash);
      return { pendingTrades: newPendingTrades };
    }),
  
  clearPendingTrades: () =>
    set({ pendingTrades: new Set() }),
  
  // 工具方法
  getLastQuoteForInstrument: (instId) => {
    const state = get();
    const normalized = instId.toUpperCase();
    return (
      state.quoteHistory.find((quote) => {
        const quoteId = quote.instId || quote.domain || '';
        return quoteId.toUpperCase() === normalized;
      }) || null
    );
  },

  getTradeHistoryForInstrument: (instId) => {
    const state = get();
    const normalized = instId.toUpperCase();
    return state.tradeHistory.filter(
      (trade) => trade.instId.toUpperCase() === normalized
    );
  },

  getPendingTradesForInstrument: (instId) => {
    const state = get();
    const normalized = instId.toUpperCase();
    const instrumentTrades = state.tradeHistory.filter(
      (trade) =>
        trade.instId.toUpperCase() === normalized && trade.status === 'pending'
    );
    return instrumentTrades.map((trade) => trade.txHash);
  },
}));

// 选择器 Hook
export const useTradeForm = () => useTradeStore((state) => state.form);
export const useCurrentQuote = () => useTradeStore((state) => state.currentQuote);
export const useQuoteHistory = () => useTradeStore((state) => state.quoteHistory);
export const useTradeHistory = () => useTradeStore((state) => state.tradeHistory);
export const usePendingTrades = () => useTradeStore((state) => state.pendingTrades);

// 特定交易对的选择器
export const useTradeHistoryForInstrument = (instId: string) =>
  useTradeStore((state) => state.getTradeHistoryForInstrument(instId));

export const usePendingTradesForInstrument = (instId: string) =>
  useTradeStore((state) => state.getPendingTradesForInstrument(instId));

export const useLastQuoteForInstrument = (instId: string) =>
  useTradeStore((state) => state.getLastQuoteForInstrument(instId));

// 交易状态工具
export const tradeStoreUtils = {
  // 创建新的报价
  createQuote: (params: {
    instId: string;
    amountIn: string;
    amountOut: string;
    minimumReceived: string;
    priceImpact: number;
    slippage: number;
  }): TradeQuote => {
    return {
      ...params,
      timestamp: Date.now(),
    };
  },

  // 创建新的交易记录
  createTradeHistoryItem: (params: {
    instId: string;
    type: 'buy' | 'sell';
    amountIn: string;
    amountOut: string;
    price: string;
    txHash: string;
    status?: TradeHistoryItem['status'];
  }): Omit<TradeHistoryItem, 'id' | 'timestamp'> => {
    return {
      ...params,
      status: params.status || 'pending',
    };
  },
  
  // 批量更新交易状态
  batchUpdateTradeStatus: (updates: Array<{ txHash: string; status: TradeHistoryItem['status'] }>) => {
    updates.forEach(({ txHash, status }) => {
      useTradeStore.getState().updateTradeStatus(txHash, status);
    });
  },
  
  // 清理旧数据
  cleanupOldData: (maxAgeHours: number = 24) => {
    const cutoffTime = Date.now() - maxAgeHours * 60 * 60 * 1000;
    const state = useTradeStore.getState();
    
    // 清理旧报价
    const filteredQuotes = state.quoteHistory.filter(
      (quote) => quote.timestamp > cutoffTime
    );
    
    // 清理旧交易历史
    const filteredTrades = state.tradeHistory.filter(
      (trade) => trade.timestamp > cutoffTime
    );
    
    useTradeStore.setState({
      quoteHistory: filteredQuotes,
      tradeHistory: filteredTrades,
    });
  },
};