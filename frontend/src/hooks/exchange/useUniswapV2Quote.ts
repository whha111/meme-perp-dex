"use client";

/**
 * useUniswapV2Quote - Get swap quotes from Uniswap V2 Router
 *
 * This hook provides real-time price quotes by calling the router's
 * getAmountsOut function.
 */

import { useMemo } from "react";
import { useReadContract } from "wagmi";
import { type Address, formatUnits } from "viem";
import {
  UNISWAP_V2_ADDRESSES,
  UNISWAP_V2_ROUTER_ABI,
  UNISWAP_V2_PAIR_ABI,
  UNISWAP_V2_FACTORY_ABI,
  isETH,
  getTokenForPath,
  calculateMinAmountOut,
} from "@/lib/uniswapV2";

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

/**
 * Calculate price impact based on reserves
 */
function calculatePriceImpact(
  amountIn: bigint,
  amountOut: bigint,
  reserveIn: bigint,
  reserveOut: bigint
): number {
  if (reserveIn === 0n || reserveOut === 0n || amountIn === 0n) {
    return 0;
  }

  // Ideal output without price impact: amountIn * reserveOut / reserveIn
  const idealOutput = (amountIn * reserveOut) / reserveIn;

  if (idealOutput === 0n) return 0;

  // Price impact = (idealOutput - actualOutput) / idealOutput * 100
  const impact = Number(((idealOutput - amountOut) * 10000n) / idealOutput);
  return impact / 100;
}

/**
 * useUniswapV2Quote - Get swap quote from Uniswap V2
 *
 * @example
 * ```tsx
 * const { amountOut, priceImpact, isLoading } = useUniswapV2Quote({
 *   tokenIn: "0x...",
 *   tokenOut: "0x...",
 *   amountIn: parseUnits("1", 18),
 *   slippageBps: 50, // 0.5%
 * });
 * ```
 */
export function useUniswapV2Quote({
  tokenIn,
  tokenOut,
  amountIn,
  slippageBps = 50,
  enabled = true,
}: QuoteParams): QuoteResult {
  // Build swap path
  const path = useMemo<Address[]>(() => {
    if (!tokenIn || !tokenOut) return [];

    const pathTokenIn = getTokenForPath(tokenIn);
    const pathTokenOut = getTokenForPath(tokenOut);

    // Direct path if tokens are different
    if (pathTokenIn !== pathTokenOut) {
      return [pathTokenIn, pathTokenOut];
    }

    return [];
  }, [tokenIn, tokenOut]);

  // Get amounts out from router
  const {
    data: amountsOut,
    isLoading: isQuoteLoading,
    isError: isQuoteError,
    error: quoteError,
    refetch,
  } = useReadContract({
    address: UNISWAP_V2_ADDRESSES.ROUTER,
    abi: UNISWAP_V2_ROUTER_ABI,
    functionName: "getAmountsOut",
    args: amountIn && path.length >= 2 ? [amountIn, path] : undefined,
    query: {
      enabled: enabled && !!amountIn && amountIn > 0n && path.length >= 2,
      refetchInterval: 5000, // Refresh every 5 seconds
      staleTime: 2000,
    },
  });

  // Get pair address for reserve info
  const { data: pairAddress } = useReadContract({
    address: UNISWAP_V2_ADDRESSES.FACTORY,
    abi: UNISWAP_V2_FACTORY_ABI,
    functionName: "getPair",
    args: path.length >= 2 ? [path[0], path[1]] : undefined,
    query: {
      enabled: enabled && path.length >= 2,
    },
  });

  // Get reserves for price impact calculation
  const { data: reserves } = useReadContract({
    address: pairAddress as Address,
    abi: UNISWAP_V2_PAIR_ABI,
    functionName: "getReserves",
    query: {
      enabled:
        enabled &&
        !!pairAddress &&
        pairAddress !== "0x0000000000000000000000000000000000000000",
      refetchInterval: 5000,
    },
  });

  // Get token0 to determine reserve order
  const { data: token0 } = useReadContract({
    address: pairAddress as Address,
    abi: UNISWAP_V2_PAIR_ABI,
    functionName: "token0",
    query: {
      enabled:
        enabled &&
        !!pairAddress &&
        pairAddress !== "0x0000000000000000000000000000000000000000",
    },
  });

  // Process results
  const result = useMemo((): QuoteResult => {
    const defaultResult: QuoteResult = {
      amountOut: 0n,
      minimumReceived: 0n,
      executionPrice: "0",
      priceImpact: 0,
      path,
      isLoading: isQuoteLoading,
      isError: isQuoteError,
      error: quoteError as Error | null,
      refetch,
    };

    if (!amountsOut || !amountIn || amountIn === 0n) {
      return defaultResult;
    }

    const amounts = amountsOut as bigint[];
    const amountOut = amounts[amounts.length - 1];

    // Calculate minimum received with slippage
    const minimumReceived = calculateMinAmountOut(amountOut, slippageBps);

    // Calculate execution price (tokenOut per tokenIn)
    let executionPrice = "0";
    if (amountOut > 0n) {
      // Price = amountOut / amountIn (normalized)
      executionPrice = (Number(amountOut) / Number(amountIn)).toFixed(6);
    }

    // Calculate price impact using reserves
    let priceImpact = 0;
    if (reserves && token0 && path.length >= 2) {
      const [reserve0, reserve1] = reserves as [bigint, bigint, number];
      const isToken0In =
        path[0].toLowerCase() === (token0 as Address).toLowerCase();
      const reserveIn = isToken0In ? reserve0 : reserve1;
      const reserveOut = isToken0In ? reserve1 : reserve0;
      priceImpact = calculatePriceImpact(
        amountIn,
        amountOut,
        reserveIn,
        reserveOut
      );
    }

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
  }, [
    amountsOut,
    amountIn,
    slippageBps,
    reserves,
    token0,
    path,
    isQuoteLoading,
    isQuoteError,
    quoteError,
    refetch,
  ]);

  return result;
}

/**
 * useTokenBalance - Get token balance for an address
 */
export function useTokenBalance(
  tokenAddress: Address | null,
  userAddress: Address | null
) {
  const isNativeETH = tokenAddress && isETH(tokenAddress);

  const { data, isLoading, refetch } = useReadContract({
    address: tokenAddress as Address,
    abi: [
      {
        type: "function",
        name: "balanceOf",
        inputs: [{ name: "account", type: "address" }],
        outputs: [{ name: "", type: "uint256" }],
        stateMutability: "view",
      },
    ],
    functionName: "balanceOf",
    args: userAddress ? [userAddress] : undefined,
    query: {
      enabled: !!tokenAddress && !!userAddress && !isNativeETH,
      refetchInterval: 10000,
    },
  });

  return {
    balance: (data as bigint) || 0n,
    isLoading,
    refetch,
  };
}

export default useUniswapV2Quote;
