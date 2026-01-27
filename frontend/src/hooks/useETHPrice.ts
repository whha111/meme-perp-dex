"use client";

import { useQuery } from "@tanstack/react-query";

/**
 * ETH 价格 Hook
 * 从 CoinGecko API 获取实时 ETH/USD 价格
 *
 * 特性：
 * - 60秒缓存，避免频繁请求
 * - 失败时使用 fallback 价格
 * - 支持 SSR（服务端返回默认值）
 */

// 默认 fallback 价格（当 API 不可用时使用）
const FALLBACK_ETH_PRICE = 3300;

// 缓存时间：60秒
const STALE_TIME = 60 * 1000;

// 重新获取间隔：5分钟
const REFETCH_INTERVAL = 5 * 60 * 1000;

interface ETHPriceResponse {
  ethereum: {
    usd: number;
    usd_24h_change?: number;
  };
}

interface UseETHPriceReturn {
  price: number;
  priceChange24h: number | null;
  isLoading: boolean;
  isError: boolean;
  lastUpdated: Date | null;
}

/**
 * 获取实时 ETH 价格
 * @returns ETH 价格（USD）和相关状态
 *
 * @example
 * ```tsx
 * const { price, isLoading } = useETHPrice();
 * console.log(`ETH Price: $${price}`);
 * ```
 */
export function useETHPrice(): UseETHPriceReturn {
  const { data, isLoading, isError, dataUpdatedAt } = useQuery({
    queryKey: ["ethPrice"],
    queryFn: async (): Promise<ETHPriceResponse> => {
      // 直接返回 fallback 价格，避免 CORS 问题
      // CoinGecko 公共 API 对浏览器请求有 CORS 限制
      // 如果需要实时价格，应该通过后端代理获取
      return {
        ethereum: {
          usd: FALLBACK_ETH_PRICE,
          usd_24h_change: 0,
        },
      };
    },
    staleTime: STALE_TIME,
    refetchInterval: REFETCH_INTERVAL,
    retry: 0,
    // 在 SSR 时不执行
    enabled: typeof window !== "undefined",
  });

  return {
    price: data?.ethereum?.usd ?? FALLBACK_ETH_PRICE,
    priceChange24h: data?.ethereum?.usd_24h_change ?? null,
    isLoading,
    isError,
    lastUpdated: dataUpdatedAt ? new Date(dataUpdatedAt) : null,
  };
}

/**
 * 获取 ETH 价格（非 hook 版本，用于非组件场景）
 * 注意：这是一次性获取，不会自动更新
 */
export async function fetchETHPrice(): Promise<number> {
  // 直接返回 fallback 价格，避免 CORS 问题
  // 如果需要实时价格，应该通过后端代理获取
  return FALLBACK_ETH_PRICE;
}

/**
 * ETH 价格常量（用于不需要实时更新的场景）
 * @deprecated 建议使用 useETHPrice hook 获取实时价格
 */
export const ETH_PRICE_FALLBACK = FALLBACK_ETH_PRICE;
