"use client";

import { useQuery } from "@tanstack/react-query";
import type { Address } from "viem";
import { MATCHING_ENGINE_URL } from "@/config/api";

/**
 * Token Parameters Hook
 * 从匹配引擎获取代币的热度参数（最大杠杆、手续费等）
 */

// 默认参数（用于 API 不可用时）
const DEFAULT_PARAMS = {
  state: "DORMANT",
  maxLeverage: 5,      // DORMANT 状态下 5x
  minMargin: "0.01",
  makerFee: 5,         // 0.05%
  takerFee: 10,        // 0.1%
  tradingEnabled: true,
};

// 状态对应的最大杠杆（前端显示用）
export const STATE_MAX_LEVERAGE: Record<string, number> = {
  DORMANT: 5,
  ACTIVE: 10,
  HOT: 20,
  DEAD: 0,
  GRADUATED: 0,
};

// 状态描述
export const STATE_DESCRIPTIONS: Record<string, string> = {
  DORMANT: "Low activity - Max 5x leverage",
  ACTIVE: "Normal activity - Max 10x leverage",
  HOT: "High activity - Max 20x leverage",
  DEAD: "No trading",
  GRADUATED: "Listed on external DEX",
};

export interface TokenParams {
  state: string;
  maxLeverage: number;
  minMargin: string;
  makerFee: number;
  takerFee: number;
  tradingEnabled: boolean;
}

interface UseTokenParamsReturn {
  params: TokenParams;
  isLoading: boolean;
  isError: boolean;
  refetch: () => void;
}

/**
 * 获取代币参数（基于热度的杠杆限制等）
 * @param tokenAddress 代币地址
 */
export function useTokenParams(tokenAddress?: Address): UseTokenParamsReturn {
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ["tokenParams", tokenAddress],
    queryFn: async (): Promise<TokenParams> => {
      if (!tokenAddress) {
        return DEFAULT_PARAMS;
      }

      try {
        const response = await fetch(`${MATCHING_ENGINE_URL}/api/token/${tokenAddress}/params`);
        if (!response.ok) {
          throw new Error("Failed to fetch token params");
        }

        const result = await response.json();
        if (!result.success) {
          throw new Error(result.error || "Failed to fetch token params");
        }

        const data = result.data;
        return {
          state: data.state,
          maxLeverage: Number(data.maxLeverage) / 10000, // 从 1e4 精度转换
          minMargin: data.minMargin,
          makerFee: Number(data.makerFee),
          takerFee: Number(data.takerFee),
          tradingEnabled: data.tradingEnabled,
        };
      } catch (error) {
        console.warn("Failed to fetch token params, using defaults:", error);
        return DEFAULT_PARAMS;
      }
    },
    staleTime: 30 * 1000, // 30 秒缓存
    refetchInterval: 60 * 1000, // 60 秒刷新
    enabled: typeof window !== "undefined",
    retry: 1,
  });

  return {
    params: data || DEFAULT_PARAMS,
    isLoading,
    isError,
    refetch,
  };
}

/**
 * 获取杠杆选项（基于代币状态）
 */
export function getLeverageOptions(maxLeverage: number): number[] {
  const options: number[] = [];
  const standardOptions = [1, 2, 3, 5, 10, 20, 50, 75, 100];

  for (const opt of standardOptions) {
    if (opt <= maxLeverage) {
      options.push(opt);
    }
  }

  // 确保最大杠杆在选项中
  if (options[options.length - 1] !== maxLeverage && maxLeverage > 0) {
    options.push(maxLeverage);
  }

  return options;
}
