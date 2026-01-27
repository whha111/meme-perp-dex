"use client";

import { useState, useEffect, useCallback } from "react";
import { useAccount } from "wagmi";

export interface TradeRecord {
  id: string;
  instId: string;
  tradeType: "BUY" | "SELL";
  tokenAmount: string;
  ethAmount: string;
  price: string;
  txHash: string;
  timestamp: number;
}

interface UseTradeHistoryOptions {
  instId?: string;
  limit?: number;
}

export function useTradeHistory(options: UseTradeHistoryOptions = {}) {
  const { instId, limit = 50 } = options;
  const { address } = useAccount();
  const [trades, setTrades] = useState<TradeRecord[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchTrades = useCallback(async () => {
    if (!address) {
      setTrades([]);
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const params = new URLSearchParams({
        address,
        limit: limit.toString(),
      });

      if (instId) {
        params.append("instId", instId);
      }

      const response = await fetch(`/api/account/trades?${params}`);

      if (!response.ok) {
        throw new Error("Failed to fetch trade history");
      }

      const data = await response.json();
      setTrades(data.trades || []);
    } catch (err) {
      console.error("Failed to fetch trades:", err);
      setError(err instanceof Error ? err.message : "Unknown error");
      // Use mock data when API is not available
      setTrades([
        {
          id: "1",
          instId: "MEME-ETH",
          tradeType: "BUY",
          tokenAmount: "1000",
          ethAmount: "0.1",
          price: "0.0001",
          txHash: "0x123...abc",
          timestamp: Date.now() - 3600000,
        },
        {
          id: "2",
          instId: "MEME-ETH",
          tradeType: "SELL",
          tokenAmount: "500",
          ethAmount: "0.06",
          price: "0.00012",
          txHash: "0x456...def",
          timestamp: Date.now() - 7200000,
        },
      ]);
    } finally {
      setIsLoading(false);
    }
  }, [address, instId, limit]);

  useEffect(() => {
    fetchTrades();
  }, [fetchTrades]);

  return {
    trades,
    isLoading,
    error,
    refetch: fetchTrades,
  };
}
