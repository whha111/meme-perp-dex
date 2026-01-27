"use client";

/**
 * useOnChainQuote - 直接从链上获取交易报价
 *
 * Phase 2 重构：使用 TokenFactory 合约，通过 tokenAddress 查询
 *
 * 优势：
 * 1. 报价永远是最新的（实时链上数据）
 * 2. 消除后端数据库延迟问题
 * 3. 与 Uniswap/OKX DEX 架构一致
 */

import { useReadContract, useReadContracts } from "wagmi";
import { parseUnits, formatUnits, type Address } from "viem";
import { useMemo } from "react";
import { CONTRACTS } from "@/lib/contracts";

// 合约常量（与链上合约保持一致）
const VIRTUAL_ETH_RESERVE = 1820000000000000000n; // 1.82 ETH (TokenFactory)
const VIRTUAL_TOKEN_RESERVE = 1073000000n * 10n ** 18n; // 1.073B tokens
const FEE_BPS = 100n; // 1% fee
const BPS_DENOMINATOR = 10000n;

// TokenFactory ABI 定义
const TOKEN_FACTORY_ABI = [
  {
    type: "function",
    name: "previewBuy",
    inputs: [
      { name: "tokenAddress", type: "address" },
      { name: "ethIn", type: "uint256" },
    ],
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "previewSell",
    inputs: [
      { name: "tokenAddress", type: "address" },
      { name: "tokensIn", type: "uint256" },
    ],
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "getCurrentPrice",
    inputs: [{ name: "tokenAddress", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "getPoolState",
    inputs: [{ name: "tokenAddress", type: "address" }],
    outputs: [
      {
        name: "",
        type: "tuple",
        components: [
          { name: "realETHReserve", type: "uint256" },
          { name: "realTokenReserve", type: "uint256" },
          { name: "soldTokens", type: "uint256" },
          { name: "isGraduated", type: "bool" },
          { name: "isActive", type: "bool" },
          { name: "creator", type: "address" },
          { name: "createdAt", type: "uint64" },
          { name: "metadataURI", type: "string" },
          { name: "graduationFailed", type: "bool" },
          { name: "graduationAttempts", type: "uint8" },
        ],
      },
    ],
    stateMutability: "view",
  },
] as const;

interface QuoteResult {
  amountOut: bigint;
  minimumReceived: bigint;
  executionPrice: bigint;
  priceImpact: number;
  currentPrice: bigint;
  isLoading: boolean;
  isError: boolean;
  error: Error | null;
  refetch: () => void;
}

interface UseOnChainQuoteParams {
  instId?: string | null; // 交易对ID，如 "MEME-BNB" (deprecated, use tokenAddress)
  domainName?: string | null; // 域名，如 "pepe.meme" (deprecated, use tokenAddress)
  tokenAddress?: Address | null; // 代币地址（推荐）
  amountIn: bigint | null;
  isBuy: boolean;
  slippageBps?: number;
  enabled?: boolean;
}

/**
 * 计算价格影响
 * Price Impact = |执行价格 - 当前价格| / 当前价格 * 100
 */
function calculatePriceImpact(
  amountIn: bigint,
  amountOut: bigint,
  currentPrice: bigint,
  isBuy: boolean
): number {
  if (currentPrice === 0n || amountIn === 0n || amountOut === 0n) {
    return 0;
  }

  // 执行价格 = amountIn / amountOut (对于买入) 或 amountOut / amountIn (对于卖出)
  // 需要用 ETH/Token 来比较
  let executionPrice: bigint;

  if (isBuy) {
    // 买入：ethIn / tokensOut = ETH per token
    // 乘以 1e18 保持精度
    executionPrice = (amountIn * 10n ** 18n) / amountOut;
  } else {
    // 卖出：ethOut / tokensIn = ETH per token
    executionPrice = (amountOut * 10n ** 18n) / amountIn;
  }

  // 价格影响百分比
  const priceDiff = executionPrice > currentPrice
    ? executionPrice - currentPrice
    : currentPrice - executionPrice;

  // 转换为百分比 (保留2位小数)
  const impactBps = Number((priceDiff * 10000n) / currentPrice);
  return impactBps / 100; // 转为百分比
}

/**
 * useOnChainQuote - 直接从 TokenFactory 智能合约获取报价
 *
 * @example
 * ```tsx
 * const { amountOut, priceImpact, isLoading } = useOnChainQuote({
 *   tokenAddress: "0x1234...",
 *   amountIn: parseUnits("0.1", 18),
 *   isBuy: true,
 *   slippageBps: 100, // 1%
 * });
 * ```
 */
export function useOnChainQuote({
  instId,
  domainName,
  tokenAddress,
  amountIn,
  isBuy,
  slippageBps = 500, // 默认 5%
  enabled = true,
}: UseOnChainQuoteParams): QuoteResult {
  // 优先使用 tokenAddress，fallback 到 instId/domainName (向后兼容)
  // 注意：如果只传 instId/domainName 而没有 tokenAddress，将无法正确查询
  const effectiveTokenAddress = tokenAddress;

  const contractAddress = CONTRACTS.TOKEN_FACTORY;

  // 批量读取：previewBuy/Sell + getCurrentPrice + getPoolState
  const { data, isLoading, isError, error, refetch } = useReadContracts({
    contracts: [
      // 1. 预览交易结果
      {
        address: contractAddress,
        abi: TOKEN_FACTORY_ABI,
        functionName: isBuy ? "previewBuy" : "previewSell",
        args: effectiveTokenAddress && amountIn ? [effectiveTokenAddress, amountIn] : undefined,
      },
      // 2. 当前价格
      {
        address: contractAddress,
        abi: TOKEN_FACTORY_ABI,
        functionName: "getCurrentPrice",
        args: effectiveTokenAddress ? [effectiveTokenAddress] : undefined,
      },
      // 3. 池子状态（用于额外信息）
      {
        address: contractAddress,
        abi: TOKEN_FACTORY_ABI,
        functionName: "getPoolState",
        args: effectiveTokenAddress ? [effectiveTokenAddress] : undefined,
      },
    ],
    query: {
      enabled: enabled && !!effectiveTokenAddress && !!amountIn && amountIn > 0n,
      refetchInterval: 3000, // 每3秒刷新一次
      staleTime: 1000, // 1秒内不重复请求
    },
  });

  // 处理结果
  const result = useMemo((): QuoteResult => {
    const defaultResult: QuoteResult = {
      amountOut: 0n,
      minimumReceived: 0n,
      executionPrice: 0n,
      priceImpact: 0,
      currentPrice: 0n,
      isLoading,
      isError,
      error: error as Error | null,
      refetch,
    };

    if (!data || !amountIn) {
      return defaultResult;
    }

    const [previewResult, priceResult, poolStateResult] = data;

    // 检查是否有错误
    if (previewResult.status === "failure" || priceResult.status === "failure") {
      return {
        ...defaultResult,
        isError: true,
        error: new Error(
          previewResult.status === "failure"
            ? "无法获取报价，池子可能未激活"
            : "无法获取当前价格"
        ),
      };
    }

    const amountOut = previewResult.result as bigint;
    const currentPrice = priceResult.result as bigint;

    // 计算最小接收数量（考虑滑点）
    const slippageFactor = BigInt(10000 - slippageBps);
    const minimumReceived = (amountOut * slippageFactor) / 10000n;

    // 计算执行价格
    let executionPrice = 0n;
    if (amountOut > 0n) {
      if (isBuy) {
        executionPrice = (amountIn * 10n ** 18n) / amountOut;
      } else {
        executionPrice = (amountOut * 10n ** 18n) / amountIn;
      }
    }

    // 计算价格影响
    const priceImpact = calculatePriceImpact(amountIn, amountOut, currentPrice, isBuy);

    return {
      amountOut,
      minimumReceived,
      executionPrice,
      priceImpact,
      currentPrice,
      isLoading: false,
      isError: false,
      error: null,
      refetch,
    };
  }, [data, amountIn, isBuy, slippageBps, isLoading, isError, error, refetch]);

  return result;
}

/**
 * usePoolState - 获取池子状态
 * @param tokenAddress 代币地址
 */
export function usePoolState(tokenAddress: Address | null) {
  const { data, isLoading, isError, refetch } = useReadContract({
    address: CONTRACTS.TOKEN_FACTORY,
    abi: TOKEN_FACTORY_ABI,
    functionName: "getPoolState",
    args: tokenAddress ? [tokenAddress] : undefined,
    query: {
      enabled: !!tokenAddress,
      refetchInterval: 5000, // 每5秒刷新
    },
  });

  return {
    poolState: data as {
      realETHReserve: bigint;
      realTokenReserve: bigint;
      soldTokens: bigint;
      isGraduated: boolean;
      isActive: boolean;
      creator: `0x${string}`;
      createdAt: bigint;
      metadataURI: string;
      graduationFailed: boolean;
      graduationAttempts: number;
    } | undefined,
    isLoading,
    isError,
    refetch,
  };
}

/**
 * useCurrentPrice - 获取当前价格
 * @param tokenAddress 代币地址
 */
export function useCurrentPrice(tokenAddress: Address | null) {
  const { data, isLoading, isError, refetch } = useReadContract({
    address: CONTRACTS.TOKEN_FACTORY,
    abi: TOKEN_FACTORY_ABI,
    functionName: "getCurrentPrice",
    args: tokenAddress ? [tokenAddress] : undefined,
    query: {
      enabled: !!tokenAddress,
      refetchInterval: 2000, // 每2秒刷新
    },
  });

  return {
    currentPrice: data as bigint | undefined,
    isLoading,
    isError,
    refetch,
  };
}

export default useOnChainQuote;
