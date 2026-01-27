"use client";

import { useState, useEffect, useMemo, useCallback } from "react";

const MATCHING_ENGINE_URL = process.env.NEXT_PUBLIC_MATCHING_ENGINE_URL || "http://localhost:8081";

interface FundingRateData {
  rate: string;
  nextFundingTime: number;
  interval: string;
}

export function useFundingRate(token?: string) {
  const [data, setData] = useState<FundingRateData | null>(null);
  const [countdown, setCountdown] = useState<string>("--:--:--");
  const [error, setError] = useState<string | null>(null);

  // Default token (TOKEN_123)
  const tokenAddress = token || "0x01c6058175eda34fc8922eeae32bc383cb203211";

  // Fetch funding rate from matching engine
  const fetchFundingRate = useCallback(async () => {
    try {
      const res = await fetch(`${MATCHING_ENGINE_URL}/api/funding/${tokenAddress}`);
      if (!res.ok) throw new Error("Failed to fetch funding rate");
      const json = await res.json();
      setData(json);
      setError(null);
    } catch (e) {
      console.error("Failed to fetch funding rate:", e);
      setError(e instanceof Error ? e.message : "Unknown error");
    }
  }, [tokenAddress]);

  // Fetch on mount and every 30 seconds
  useEffect(() => {
    fetchFundingRate();
    const interval = setInterval(fetchFundingRate, 30000);
    return () => clearInterval(interval);
  }, [fetchFundingRate]);

  // Format funding rate as percentage
  const formattedRate = useMemo(() => {
    if (!data?.rate) return "0.0000%";
    // Rate is in basis points (100 = 1%)
    const rate = Number(data.rate) / 100;
    const sign = rate >= 0 ? "+" : "";
    return `${sign}${rate.toFixed(4)}%`;
  }, [data?.rate]);

  // Is positive rate (longs pay shorts)
  const isPositive = useMemo(() => {
    if (!data?.rate) return true;
    return Number(data.rate) >= 0;
  }, [data?.rate]);

  // Update countdown timer
  useEffect(() => {
    const updateCountdown = () => {
      const now = Date.now();
      const nextTime = data?.nextFundingTime || (now + 8 * 60 * 60 * 1000);
      const diff = nextTime - now;

      if (diff <= 0) {
        setCountdown("00:00:00");
        return;
      }

      const hours = Math.floor(diff / (1000 * 60 * 60));
      const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
      const seconds = Math.floor((diff % (1000 * 60)) / 1000);

      setCountdown(
        `${hours.toString().padStart(2, "0")}:${minutes.toString().padStart(2, "0")}:${seconds.toString().padStart(2, "0")}`
      );
    };

    updateCountdown();
    const interval = setInterval(updateCountdown, 1000);
    return () => clearInterval(interval);
  }, [data?.nextFundingTime]);

  return {
    fundingRate: data?.rate ? BigInt(data.rate) : 0n,
    formattedRate,
    isPositive,
    nextFundingTime: data?.nextFundingTime ?? 0,
    countdown,
    fundingInterval: 8 * 60 * 60, // 8 hours
    error,
  };
}
