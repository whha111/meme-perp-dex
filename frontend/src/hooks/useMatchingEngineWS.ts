"use client";

/**
 * 撮合引擎 WebSocket Hook
 *
 * 实时接收订单簿和成交数据
 */

import { useState, useEffect, useCallback, useRef } from "react";
import { type Address } from "viem";

// ============================================================
// Types
// ============================================================

export interface OrderBookLevel {
  price: string;
  size: string;
  count: number;
}

export interface OrderBookData {
  longs: OrderBookLevel[];
  shorts: OrderBookLevel[];
  lastPrice: string;
}

export interface TradeData {
  id: string;
  price: string;
  size: string;
  side: "buy" | "sell";
  timestamp: number;
}

interface WSMessage {
  type: "orderbook" | "trade";
  token: Address;
  data: OrderBookData | TradeData;
}

// ============================================================
// Hook
// ============================================================

const getWsUrl = (): string => {
  const url = process.env.NEXT_PUBLIC_MATCHING_ENGINE_URL || "http://localhost:8081";
  return url.replace("http://", "ws://").replace("https://", "wss://");
};

export function useMatchingEngineWS(token: Address | undefined) {
  const [orderBook, setOrderBook] = useState<OrderBookData | null>(null);
  const [recentTrades, setRecentTrades] = useState<TradeData[]>([]);
  const [isConnected, setIsConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const currentTokenRef = useRef<Address | undefined>(token);

  // Update current token ref
  useEffect(() => {
    currentTokenRef.current = token;
  }, [token]);

  // Connect to WebSocket
  const connect = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      return;
    }

    const wsUrl = getWsUrl();
    console.log("[WS] Connecting to:", wsUrl);

    try {
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        console.log("[WS] Connected");
        setIsConnected(true);
        setError(null);

        // Subscribe to current token
        if (currentTokenRef.current) {
          ws.send(JSON.stringify({
            type: "subscribe",
            channel: "orderbook",
            token: currentTokenRef.current,
          }));
        }
      };

      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data) as WSMessage;

          if (msg.type === "orderbook") {
            setOrderBook(msg.data as OrderBookData);
          } else if (msg.type === "trade") {
            setRecentTrades((prev) => {
              const trade = msg.data as TradeData;
              const updated = [trade, ...prev.slice(0, 99)]; // Keep last 100
              return updated;
            });
          }
        } catch (e) {
          console.error("[WS] Parse error:", e);
        }
      };

      ws.onclose = () => {
        console.log("[WS] Disconnected");
        setIsConnected(false);
        wsRef.current = null;

        // Reconnect after 3 seconds
        reconnectTimeoutRef.current = setTimeout(() => {
          connect();
        }, 3000);
      };

      ws.onerror = (e) => {
        console.error("[WS] Error:", e);
        setError("WebSocket connection failed");
      };
    } catch (e) {
      console.error("[WS] Failed to connect:", e);
      setError("Failed to connect to WebSocket");
    }
  }, []);

  // Subscribe to token
  const subscribe = useCallback((newToken: Address) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      // Unsubscribe from previous token
      if (currentTokenRef.current && currentTokenRef.current !== newToken) {
        wsRef.current.send(JSON.stringify({
          type: "unsubscribe",
          channel: "orderbook",
          token: currentTokenRef.current,
        }));
      }

      // Subscribe to new token
      wsRef.current.send(JSON.stringify({
        type: "subscribe",
        channel: "orderbook",
        token: newToken,
      }));
    }
  }, []);

  // Connect on mount
  useEffect(() => {
    connect();

    return () => {
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
    };
  }, [connect]);

  // Subscribe when token changes
  useEffect(() => {
    if (token && isConnected) {
      subscribe(token);
    }
  }, [token, isConnected, subscribe]);

  return {
    orderBook,
    recentTrades,
    isConnected,
    error,
  };
}

export default useMatchingEngineWS;
