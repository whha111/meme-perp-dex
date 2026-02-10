"use client";

/**
 * WebSocket 实时市场数据 Hooks
 *
 * ⚠️ H-09 WARNING: 本文件中的 hooks 各自创建独立的 WebSocket 连接。
 * 如果在同一页面同时使用多个 hooks，会创建多个冗余连接。
 *
 * 推荐迁移方案：使用 useUnifiedWebSocket（hooks/common/useUnifiedWebSocket.ts）
 * 它共享单一连接，支持多频道订阅，并包含自动重连逻辑。
 *
 * @deprecated 优先使用 useUnifiedWebSocket 代替这些独立 hooks
 */

import { useState, useEffect, useCallback, useRef } from "react";
import { getWebSocketClient } from "@/lib/websocket/client";

const MATCHING_ENGINE_WS_URL = process.env.NEXT_PUBLIC_MATCHING_ENGINE_WS_URL || "ws://localhost:8081";

// ============================================================
// Types (兼容后端消息格式)
// ============================================================

export interface MarketDataMessage {
  token: string;
  lastPrice: string;
  markPrice: string;
  indexPrice: string;
  high24h: string;
  low24h: string;
  volume24h: string;
  open24h: string;
  priceChange24h: string;
  priceChangePercent24h: string;
  askPrice: string;
  askSize: string;
  bidPrice: string;
  bidSize: string;
  timestamp: number;
}

export interface TradeMessage {
  id: string;
  token: string;
  price: string;
  size: string;
  side: "long" | "short";
  timestamp: number;
}

// ============================================================
// useWebSocketTicker - 实时 Ticker 数据
// ============================================================

export function useWebSocketTicker(token?: string) {
  const [ticker, setTicker] = useState<MarketDataMessage | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const wsRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    if (!token) {
      setLoading(false);
      return;
    }

    const normalizedToken = token.toLowerCase();

    try {
      // 直接连接到撮合引擎 WebSocket
      const ws = new WebSocket(MATCHING_ENGINE_WS_URL);
      wsRef.current = ws;

      ws.onopen = () => {
        console.log(`[useWebSocketTicker] 已连接到 WebSocket`);
        // 订阅代币市场数据
        ws.send(JSON.stringify({
          type: "subscribe_token",
          token: normalizedToken,
        }));
        setError(null);
      };

      ws.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data);

          // 处理市场数据推送
          if (message.type === "market_data" && message.data) {
            const data = message.data as MarketDataMessage;
            if (data.token.toLowerCase() === normalizedToken) {
              setTicker(data);
              setLoading(false);
            }
          }
        } catch (err) {
          console.error("[useWebSocketTicker] 解析消息失败:", err);
        }
      };

      ws.onerror = (error) => {
        console.error("[useWebSocketTicker] WebSocket 错误:", error);
        setError("WebSocket 连接错误");
        setLoading(false);
      };

      ws.onclose = () => {
        console.log(`[useWebSocketTicker] WebSocket 已断开`);
      };

    } catch (err) {
      console.error("[useWebSocketTicker] 连接失败:", err);
      setError(err instanceof Error ? err.message : "连接失败");
      setLoading(false);
    }

    // 清理函数
    return () => {
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
    };
  }, [token]);

  // 格式化为兼容旧接口的数据
  const formattedTicker = ticker ? {
    instId: ticker.token,
    last: ticker.lastPrice,
    lastSz: "0",
    askPx: ticker.askPrice,
    askSz: ticker.askSize,
    bidPx: ticker.bidPrice,
    bidSz: ticker.bidSize,
    open24h: ticker.open24h,
    high24h: ticker.high24h,
    low24h: ticker.low24h,
    volCcy24h: ticker.volume24h,
    vol24h: ticker.volume24h,
    ts: ticker.timestamp,
  } : null;

  return {
    ticker: formattedTicker,
    loading,
    error,
    rawData: ticker,
  };
}

// ============================================================
// useWebSocketTrades - 实时成交记录
// ============================================================

export function useWebSocketTrades(token?: string, limit: number = 50) {
  const [trades, setTrades] = useState<TradeMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const wsRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    if (!token) {
      setLoading(false);
      return;
    }

    const normalizedToken = token.toLowerCase();

    try {
      const ws = new WebSocket(MATCHING_ENGINE_WS_URL);
      wsRef.current = ws;

      ws.onopen = () => {
        console.log(`[useWebSocketTrades] 已连接到 WebSocket`);
        ws.send(JSON.stringify({
          type: "subscribe_token",
          token: normalizedToken,
        }));
        setError(null);
      };

      ws.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data);

          // 处理成交推送
          if (message.type === "trade" && message.data) {
            const trade = message.data as TradeMessage;
            if (trade.token.toLowerCase() === normalizedToken) {
              setTrades(prev => {
                // 添加新成交到列表开头，限制总数
                const newTrades = [trade, ...prev];
                return newTrades.slice(0, limit);
              });
              setLoading(false);
            }
          }
        } catch (err) {
          console.error("[useWebSocketTrades] 解析消息失败:", err);
        }
      };

      ws.onerror = (error) => {
        console.error("[useWebSocketTrades] WebSocket 错误:", error);
        setError("WebSocket 连接错误");
        setLoading(false);
      };

      ws.onclose = () => {
        console.log(`[useWebSocketTrades] WebSocket 已断开`);
      };

    } catch (err) {
      console.error("[useWebSocketTrades] 连接失败:", err);
      setError(err instanceof Error ? err.message : "连接失败");
      setLoading(false);
    }

    return () => {
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
    };
  }, [token, limit]);

  // 格式化为兼容旧接口的数据
  const formattedTrades = trades.map(trade => ({
    instId: trade.token,
    tradeId: trade.id,
    px: trade.price,
    sz: trade.size,
    side: trade.side,
    ts: trade.timestamp,
  }));

  return {
    trades: formattedTrades,
    loading,
    error,
    rawData: trades,
  };
}

// ============================================================
// useWebSocketMarkPrice - 实时标记价格
// ============================================================

export function useWebSocketMarkPrice(token?: string) {
  const [markPrice, setMarkPrice] = useState<string | null>(null);
  const [indexPrice, setIndexPrice] = useState<string | null>(null);
  const [timestamp, setTimestamp] = useState<number>(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const wsRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    if (!token) {
      setLoading(false);
      return;
    }

    const normalizedToken = token.toLowerCase();

    try {
      const ws = new WebSocket(MATCHING_ENGINE_WS_URL);
      wsRef.current = ws;

      ws.onopen = () => {
        console.log(`[useWebSocketMarkPrice] 已连接到 WebSocket`);
        ws.send(JSON.stringify({
          type: "subscribe_token",
          token: normalizedToken,
        }));
        setError(null);
      };

      ws.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data);

          // 处理市场数据推送（包含 markPrice 和 indexPrice）
          if (message.type === "market_data" && message.data) {
            const data = message.data as MarketDataMessage;
            if (data.token.toLowerCase() === normalizedToken) {
              setMarkPrice(data.markPrice);
              setIndexPrice(data.indexPrice);
              setTimestamp(data.timestamp);
              setLoading(false);
            }
          }
        } catch (err) {
          console.error("[useWebSocketMarkPrice] 解析消息失败:", err);
        }
      };

      ws.onerror = (error) => {
        console.error("[useWebSocketMarkPrice] WebSocket 错误:", error);
        setError("WebSocket 连接错误");
        setLoading(false);
      };

      ws.onclose = () => {
        console.log(`[useWebSocketMarkPrice] WebSocket 已断开`);
      };

    } catch (err) {
      console.error("[useWebSocketMarkPrice] 连接失败:", err);
      setError(err instanceof Error ? err.message : "连接失败");
      setLoading(false);
    }

    return () => {
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
    };
  }, [token]);

  // 格式化为兼容旧接口的数据
  const formattedMarkPrice = markPrice ? {
    instId: token || "",
    markPx: markPrice,
    ts: timestamp,
  } : null;

  return {
    markPrice: formattedMarkPrice,
    loading,
    error,
    rawMarkPrice: markPrice,
    rawIndexPrice: indexPrice,
  };
}

// ============================================================
// useWebSocketOrderBook - 实时订单簿
// ============================================================

export interface OrderBookLevel {
  price: string;
  size: string;
  count: number;
}

export interface OrderBookData {
  token: string;
  bids: OrderBookLevel[];
  asks: OrderBookLevel[];
  longs: OrderBookLevel[];
  shorts: OrderBookLevel[];
  lastPrice: string;
  timestamp: number;
}

export function useWebSocketOrderBook(token?: string) {
  const [orderBook, setOrderBook] = useState<OrderBookData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const wsRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    if (!token) {
      setLoading(false);
      return;
    }

    const normalizedToken = token.toLowerCase();

    try {
      const ws = new WebSocket(MATCHING_ENGINE_WS_URL);
      wsRef.current = ws;

      ws.onopen = () => {
        console.log(`[useWebSocketOrderBook] 已连接到 WebSocket`);
        ws.send(JSON.stringify({
          type: "subscribe_token",
          token: normalizedToken,
        }));
        setError(null);
      };

      ws.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data);

          // 处理订单簿推送
          if (message.type === "orderbook" && message.data) {
            const data = message.data as OrderBookData;
            if (data.token.toLowerCase() === normalizedToken) {
              setOrderBook(data);
              setLoading(false);
            }
          }
        } catch (err) {
          console.error("[useWebSocketOrderBook] 解析消息失败:", err);
        }
      };

      ws.onerror = (error) => {
        console.error("[useWebSocketOrderBook] WebSocket 错误:", error);
        setError("WebSocket 连接错误");
        setLoading(false);
      };

      ws.onclose = () => {
        console.log(`[useWebSocketOrderBook] WebSocket 已断开`);
      };

    } catch (err) {
      console.error("[useWebSocketOrderBook] 连接失败:", err);
      setError(err instanceof Error ? err.message : "连接失败");
      setLoading(false);
    }

    return () => {
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
    };
  }, [token]);

  return {
    orderBook,
    loading,
    error,
  };
}
