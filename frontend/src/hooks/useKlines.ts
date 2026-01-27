"use client";

import { useState, useEffect, useCallback } from "react";

const MATCHING_ENGINE_URL = process.env.NEXT_PUBLIC_MATCHING_ENGINE_URL || "http://localhost:8081";

export interface Kline {
  timestamp: number;
  open: string;
  high: string;
  low: string;
  close: string;
  volume: string;
  trades: number;
}

export type KlineInterval = "1m" | "5m" | "15m" | "1h" | "4h" | "1d";

export function useKlines(token?: string, interval: KlineInterval = "1m", limit: number = 100) {
  const [klines, setKlines] = useState<Kline[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Default token (TOKEN_123)
  const tokenAddress = token || "0x01c6058175eda34fc8922eeae32bc383cb203211";

  const fetchKlines = useCallback(async () => {
    try {
      const url = `${MATCHING_ENGINE_URL}/api/kline/${tokenAddress}?interval=${interval}&limit=${limit}`;
      const res = await fetch(url);
      if (!res.ok) throw new Error("Failed to fetch klines");
      const json = await res.json();
      setKlines(json.klines || []);
      setError(null);
    } catch (e) {
      console.error("Failed to fetch klines:", e);
      setError(e instanceof Error ? e.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }, [tokenAddress, interval, limit]);

  // Fetch on mount and based on interval
  useEffect(() => {
    fetchKlines();

    // Refresh more frequently for shorter intervals
    const refreshMs = interval === "1m" ? 5000 : interval === "5m" ? 15000 : 30000;
    const timer = setInterval(fetchKlines, refreshMs);

    return () => clearInterval(timer);
  }, [fetchKlines, interval]);

  // Format klines for chart libraries (e.g., lightweight-charts)
  const chartData = klines.map(k => ({
    time: k.timestamp / 1000, // Convert to seconds for most chart libs
    open: Number(k.open) / 1e12,
    high: Number(k.high) / 1e12,
    low: Number(k.low) / 1e12,
    close: Number(k.close) / 1e12,
    volume: Number(k.volume) / 1e6,
  }));

  // Get latest price from klines
  const latestPrice = klines.length > 0
    ? Number(klines[klines.length - 1].close) / 1e12
    : 0;

  return {
    klines,
    chartData,
    latestPrice,
    loading,
    error,
    refresh: fetchKlines,
  };
}
