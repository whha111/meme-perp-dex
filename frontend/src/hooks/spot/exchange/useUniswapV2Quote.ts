"use client";

/**
 * useUniswapV2Quote - Uniswap V2 报价 Hook (Mock 版本)
 *
 * 接口保留，返回模拟数据
 * TODO: 对接 Uniswap V2 Router 合约
 */

import { useMemo, useCallback } from "react";
import { type Address } from "viem";

export interface QuoteParams {
  tokenIn: Address | null;
  tokenOut: Address | null;
  amountIn: bigint | null;
  slippageBps?: number;
  enabled?: boolean;
}

export interface QuoteResult {
  amountOut: bigint;
  minimumReceived: bigint;
  executionPrice: string;
  priceImpact: number;
  path: Address[];
  isLoading: boolean;
  isError: boolean;
  error: Error | null;
  refetch: () => void;
}

const BPS_DENOMINATOR = 10000;

/**
 * Mock 价格计算
 */
function calculateMockAmountOut(amountIn: bigint): bigint {
  // Mock: 1 ETH = 20000 Token 的汇率
  return amountIn * 20000n;
}

/**
 * useUniswapV2Quote (Mock)
 */
export function useUniswapV2Quote({
  tokenIn,
  tokenOut,
  amountIn,
  slippageBps = 50,
  enabled = true,
}: QuoteParams): QuoteResult {
  const refetch = useCallback(() => {
    console.log("[useUniswapV2Quote Mock] refetch called");
  }, []);

  return useMemo((): QuoteResult => {
    const defaultResult: QuoteResult = {
      amountOut: 0n,
      minimumReceived: 0n,
      executionPrice: "0",
      priceImpact: 0,
      path: [],
      isLoading: false,
      isError: false,
      error: null,
      refetch,
    };

    if (!tokenIn || !tokenOut || !amountIn || amountIn <= 0n || !enabled) {
      return defaultResult;
    }

    // Mock path
    const path: Address[] = [tokenIn, tokenOut];

    // Mock 计算
    const amountOut = calculateMockAmountOut(amountIn);

    // Calculate minimum received with slippage
    const slippageFactor = BigInt(BPS_DENOMINATOR - slippageBps);
    const minimumReceived = (amountOut * slippageFactor) / BigInt(BPS_DENOMINATOR);

    // Mock execution price
    const executionPrice = (Number(amountOut) / Number(amountIn)).toFixed(6);

    // Mock price impact (small value)
    const priceImpact = 0.3;

    return {
      amountOut,
      minimumReceived,
      executionPrice,
      priceImpact,
      path,
      isLoading: false,
      isError: false,
      error: null,
      refetch,
    };
  }, [tokenIn, tokenOut, amountIn, slippageBps, enabled, refetch]);
}

/**
 * useTokenBalance (Mock)
 */
export function useTokenBalance(
  tokenAddress: Address | null,
  userAddress: Address | null
) {
  const refetch = useCallback(() => {
    console.log("[useTokenBalance Mock] refetch called");
  }, []);

  // Mock: 返回固定余额
  const balance = tokenAddress && userAddress ? 1000n * 10n ** 18n : 0n;

  return {
    balance,
    isLoading: false,
    refetch,
  };
}

export default useUniswapV2Quote;
