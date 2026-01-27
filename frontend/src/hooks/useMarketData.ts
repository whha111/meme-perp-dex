"use client";

import { useState, useEffect, useCallback } from "react";
import { apiClient, Instrument, Ticker, Trade, MarkPrice } from "@/lib/api/client";

/**
 * 合并后的市场数据类型
 */
export interface MarketData {
  instrument: Instrument;
  ticker?: Ticker;
  markPrice?: MarkPrice;
  // 计算属性
  price: string;
  priceChange24h: number;
  volume24h: string;
  high24h: string;
  low24h: string;
}

/**
 * useInstruments - 获取所有可交易合约
 */
export function useInstruments() {
  const [instruments, setInstruments] = useState<Instrument[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchInstruments = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const data = await apiClient.getInstruments();
      setInstruments(data || []);
    } catch (err) {
      const message = err instanceof Error ? err.message : "获取合约列表失败";
      setError(message);
      console.error("[useInstruments]", err);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchInstruments();
  }, [fetchInstruments]);

  return { instruments, isLoading, error, refetch: fetchInstruments };
}

/**
 * useTickers - 获取所有行情
 */
export function useTickers(autoRefresh: boolean = true, interval: number = 5000) {
  const [tickers, setTickers] = useState<Ticker[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchTickers = useCallback(async () => {
    try {
      const data = await apiClient.getTickers();
      setTickers(data || []);
      setError(null);
    } catch (err) {
      const message = err instanceof Error ? err.message : "获取行情失败";
      setError(message);
      console.error("[useTickers]", err);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchTickers();

    if (autoRefresh) {
      const timer = setInterval(fetchTickers, interval);
      return () => clearInterval(timer);
    }
  }, [fetchTickers, autoRefresh, interval]);

  return { tickers, isLoading, error, refetch: fetchTickers };
}

/**
 * useMarketList - 获取合并的市场列表数据
 */
export function useMarketList() {
  const { instruments, isLoading: loadingInst, error: instError } = useInstruments();
  const { tickers, isLoading: loadingTickers, error: tickerError } = useTickers();

  const isLoading = loadingInst || loadingTickers;
  const error = instError || tickerError;

  // 合并数据
  const marketList: MarketData[] = instruments.map((inst) => {
    const ticker = tickers.find((t) => t.instId === inst.instId);

    // 计算 24h 涨跌幅
    let priceChange24h = 0;
    if (ticker && ticker.open24h && ticker.last) {
      const open = parseFloat(ticker.open24h);
      const last = parseFloat(ticker.last);
      if (open > 0) {
        priceChange24h = ((last - open) / open) * 100;
      }
    }

    return {
      instrument: inst,
      ticker,
      price: ticker?.last || "0",
      priceChange24h,
      volume24h: ticker?.volCcy24h || "0",
      high24h: ticker?.high24h || "0",
      low24h: ticker?.low24h || "0",
    };
  });

  return { marketList, isLoading, error };
}

/**
 * useTicker - 获取单个合约行情
 */
export function useTicker(instId: string | null, autoRefresh: boolean = true) {
  const [ticker, setTicker] = useState<Ticker | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchTicker = useCallback(async () => {
    if (!instId) return;

    setIsLoading(true);
    try {
      const data = await apiClient.getTicker(instId);
      if (data && data.length > 0) {
        setTicker(data[0]);
      }
      setError(null);
    } catch (err) {
      const message = err instanceof Error ? err.message : "获取行情失败";
      setError(message);
      console.error("[useTicker]", err);
    } finally {
      setIsLoading(false);
    }
  }, [instId]);

  useEffect(() => {
    fetchTicker();

    if (autoRefresh && instId) {
      const timer = setInterval(fetchTicker, 3000);
      return () => clearInterval(timer);
    }
  }, [fetchTicker, autoRefresh, instId]);

  return { ticker, isLoading, error, refetch: fetchTicker };
}

/**
 * useTrades - 获取最新成交
 */
export function useTrades(instId: string | null, limit: number = 50) {
  const [trades, setTrades] = useState<Trade[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchTrades = useCallback(async () => {
    if (!instId) return;

    setIsLoading(true);
    try {
      const data = await apiClient.getTrades(instId, limit);
      setTrades(data || []);
      setError(null);
    } catch (err) {
      const message = err instanceof Error ? err.message : "获取成交失败";
      setError(message);
      console.error("[useTrades]", err);
    } finally {
      setIsLoading(false);
    }
  }, [instId, limit]);

  useEffect(() => {
    fetchTrades();

    // 自动刷新
    const timer = setInterval(fetchTrades, 5000);
    return () => clearInterval(timer);
  }, [fetchTrades]);

  return { trades, isLoading, error, refetch: fetchTrades };
}

/**
 * useMarkPrice - 获取标记价格
 */
export function useMarkPrice(instId: string | null) {
  const [markPrice, setMarkPrice] = useState<MarkPrice | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchMarkPrice = useCallback(async () => {
    if (!instId) return;

    setIsLoading(true);
    try {
      const data = await apiClient.getMarkPrice(instId);
      if (data && data.length > 0) {
        setMarkPrice(data[0]);
      }
      setError(null);
    } catch (err) {
      const message = err instanceof Error ? err.message : "获取标记价格失败";
      setError(message);
      console.error("[useMarkPrice]", err);
    } finally {
      setIsLoading(false);
    }
  }, [instId]);

  useEffect(() => {
    fetchMarkPrice();

    const timer = setInterval(fetchMarkPrice, 5000);
    return () => clearInterval(timer);
  }, [fetchMarkPrice]);

  return { markPrice, isLoading, error, refetch: fetchMarkPrice };
}

export default useMarketList;
