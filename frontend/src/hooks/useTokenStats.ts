"use client";

import { useState, useEffect, useCallback } from "react";

const MATCHING_ENGINE_URL = process.env.NEXT_PUBLIC_MATCHING_ENGINE_URL || "http://localhost:8081";

export interface TokenStats {
  price: string;
  priceChange24h: string;
  high24h: string;
  low24h: string;
  volume24h: string;
  trades24h: number;
  openInterest: string;
  fundingRate: string;
  nextFundingTime: number;
}

export function useTokenStats(token?: string) {
  const [stats, setStats] = useState<TokenStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Default token (TOKEN_123)
  const tokenAddress = token || "0x01c6058175eda34fc8922eeae32bc383cb203211";

  const fetchStats = useCallback(async () => {
    try {
      const res = await fetch(`${MATCHING_ENGINE_URL}/api/stats/${tokenAddress}`);
      if (!res.ok) throw new Error("Failed to fetch stats");
      const json = await res.json();
      setStats(json);
      setError(null);
    } catch (e) {
      console.error("Failed to fetch token stats:", e);
      setError(e instanceof Error ? e.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }, [tokenAddress]);

  // Fetch on mount and every 5 seconds
  useEffect(() => {
    fetchStats();
    const interval = setInterval(fetchStats, 5000);
    return () => clearInterval(interval);
  }, [fetchStats]);

  // Formatted values (meme 币价格需要更多小数位)
  const formatMemePrice = (priceStr: string | undefined) => {
    if (!priceStr) return "0.0000000000";
    const price = Number(priceStr) / 1e12;
    if (price === 0) return "0.0000000000";
    if (price < 0.000001) return price.toFixed(10);
    if (price < 0.0001) return price.toFixed(8);
    if (price < 0.01) return price.toFixed(6);
    return price.toFixed(4);
  };

  const formattedPrice = formatMemePrice(stats?.price);

  const formattedPriceChange = stats?.priceChange24h
    ? (Number(stats.priceChange24h) / 100).toFixed(2) + "%"
    : "0.00%";

  const isPriceUp = stats?.priceChange24h
    ? Number(stats.priceChange24h) >= 0
    : true;

  const formattedHigh24h = formatMemePrice(stats?.high24h);
  const formattedLow24h = formatMemePrice(stats?.low24h);

  const formattedVolume24h = stats?.volume24h
    ? (Number(stats.volume24h) / 1e6).toFixed(2)
    : "0.00";

  const formattedOpenInterest = stats?.openInterest
    ? (Number(stats.openInterest) / 1e6).toFixed(2)
    : "0.00";

  return {
    stats,
    loading,
    error,
    formattedPrice,
    formattedPriceChange,
    isPriceUp,
    formattedHigh24h,
    formattedLow24h,
    formattedVolume24h,
    formattedOpenInterest,
    trades24h: stats?.trades24h ?? 0,
    refresh: fetchStats,
  };
}
