"use client";

/**
 * useTokenFactory - TokenFactory 合约交互 hooks
 *
 * 新架构：使用 tokenAddress 直接作为标识符，不再使用 instHash
 *
 * TokenFactory 合约函数:
 * - createToken(name, symbol, metadataURI, minTokensOut) -> address
 * - buy(tokenAddress, minTokensOut) payable
 * - sell(tokenAddress, tokenAmount, minETHOut)
 * - getPoolState(tokenAddress) -> PoolState
 * - getCurrentPrice(tokenAddress) -> uint256
 * - previewBuy(tokenAddress, ethIn) -> uint256
 * - previewSell(tokenAddress, tokensIn) -> uint256
 */

import React, { useMemo, useState } from "react";
import { useReadContract, useReadContracts, useWriteContract, useWaitForTransactionReceipt, useAccount } from "wagmi";
import { formatUnits, type Address } from "viem";
import { CONTRACTS, TOKEN_FACTORY_ABI } from "@/lib/contracts";
import { useToast } from "@/components/shared/Toast";
import { useMutation, useQueryClient } from "@tanstack/react-query";

// 基点常量
const BPS_DENOMINATOR = 10000;

/**
 * Pool State 结构
 */
export interface PoolState {
  realETHReserve: bigint;
  realTokenReserve: bigint;
  soldTokens: bigint;
  isGraduated: boolean;
  isActive: boolean;
  creator: Address;
  createdAt: bigint;
  metadataURI: string;
}

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

interface UseTokenFactoryQuoteParams {
  tokenAddress: Address | null;
  amountIn: bigint | null;
  isBuy: boolean;
  slippageBps?: number;
  enabled?: boolean;
}

/**
 * 计算价格影响
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

  let executionPrice: bigint;
  if (isBuy) {
    executionPrice = (amountIn * 10n ** 18n) / amountOut;
  } else {
    executionPrice = (amountOut * 10n ** 18n) / amountIn;
  }

  const priceDiff = executionPrice > currentPrice
    ? executionPrice - currentPrice
    : currentPrice - executionPrice;

  const impactBps = Number((priceDiff * 10000n) / currentPrice);
  return impactBps / 100;
}

/**
 * useTokenFactoryQuote - 从 TokenFactory 获取报价
 *
 * @example
 * ```tsx
 * const { amountOut, priceImpact, isLoading } = useTokenFactoryQuote({
 *   tokenAddress: "0x...",
 *   amountIn: parseUnits("0.1", 18),
 *   isBuy: true,
 *   slippageBps: 100, // 1%
 * });
 * ```
 */
export function useTokenFactoryQuote({
  tokenAddress,
  amountIn,
  isBuy,
  slippageBps = 500, // 默认 5%
  enabled = true,
}: UseTokenFactoryQuoteParams): QuoteResult {
  const contractAddress = CONTRACTS.TOKEN_FACTORY;

  // 批量读取：previewBuy/Sell + getCurrentPrice + getPoolState
  const { data, isLoading, isError, error, refetch } = useReadContracts({
    contracts: [
      // 1. 预览交易结果
      {
        address: contractAddress,
        abi: TOKEN_FACTORY_ABI,
        functionName: isBuy ? "previewBuy" : "previewSell",
        args: tokenAddress && amountIn ? [tokenAddress, amountIn] : undefined,
      },
      // 2. 当前价格
      {
        address: contractAddress,
        abi: TOKEN_FACTORY_ABI,
        functionName: "getCurrentPrice",
        args: tokenAddress ? [tokenAddress] : undefined,
      },
      // 3. 池子状态
      {
        address: contractAddress,
        abi: TOKEN_FACTORY_ABI,
        functionName: "getPoolState",
        args: tokenAddress ? [tokenAddress] : undefined,
      },
    ],
    query: {
      enabled: enabled && !!tokenAddress && !!amountIn && amountIn > 0n,
      refetchInterval: 3000,
      staleTime: 1000,
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

    const [previewResult, priceResult] = data;

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

    // 计算最小接收数量
    const slippageFactor = BigInt(BPS_DENOMINATOR - slippageBps);
    const minimumReceived = (amountOut * slippageFactor) / BigInt(BPS_DENOMINATOR);

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
 * useTokenFactoryPoolState - 获取池子状态
 */
export function useTokenFactoryPoolState(tokenAddress: Address | null) {
  const { data, isLoading, isError, refetch } = useReadContract({
    address: CONTRACTS.TOKEN_FACTORY,
    abi: TOKEN_FACTORY_ABI,
    functionName: "getPoolState",
    args: tokenAddress ? [tokenAddress] : undefined,
    query: {
      enabled: !!tokenAddress,
      refetchInterval: 5000,
    },
  });

  return {
    poolState: data as PoolState | undefined,
    isLoading,
    isError,
    refetch,
  };
}

/**
 * useTokenFactoryPrice - 获取当前价格
 */
export function useTokenFactoryPrice(tokenAddress: Address | null) {
  const { data, isLoading, isError, refetch } = useReadContract({
    address: CONTRACTS.TOKEN_FACTORY,
    abi: TOKEN_FACTORY_ABI,
    functionName: "getCurrentPrice",
    args: tokenAddress ? [tokenAddress] : undefined,
    query: {
      enabled: !!tokenAddress,
      refetchInterval: 2000,
    },
  });

  return {
    currentPrice: data as bigint | undefined,
    isLoading,
    isError,
    refetch,
  };
}

/**
 * useTokenFactoryBuy - 买入代币
 */
export function useTokenFactoryBuy() {
  const { address, isConnected } = useAccount();
  const { showToast } = useToast();
  const queryClient = useQueryClient();

  const [txHash, setTxHash] = useState<`0x${string}` | null>(null);

  const {
    writeContractAsync,
    isPending: isWriting,
    error: writeError,
  } = useWriteContract();

  const {
    isLoading: isConfirming,
    isSuccess: isReceiptReceived,
    data: receipt,
    isError: isReceiptError,
  } = useWaitForTransactionReceipt({
    hash: txHash ?? undefined,
    query: {
      enabled: !!txHash,
    },
  });

  const isTransactionSuccess = isReceiptReceived && receipt?.status === "success";
  const isTransactionFailed = isReceiptReceived && receipt?.status === "reverted";

  // 处理交易成功/失败
  React.useEffect(() => {
    if (isTransactionSuccess) {
      showToast("买入成功！", "success");
      queryClient.invalidateQueries({ queryKey: ["tokenBalance"] });
      queryClient.invalidateQueries({ queryKey: ["poolState"] });
    } else if (isTransactionFailed) {
      showToast("交易执行失败", "error");
    }
  }, [isTransactionSuccess, isTransactionFailed, showToast, queryClient]);

  const buy = async (
    tokenAddress: Address,
    ethAmount: bigint,
    minTokensOut: bigint = 0n
  ) => {
    if (!address || !isConnected) {
      throw new Error("请先连接钱包");
    }

    const hash = await writeContractAsync({
      address: CONTRACTS.TOKEN_FACTORY,
      abi: TOKEN_FACTORY_ABI,
      functionName: "buy",
      args: [tokenAddress, minTokensOut],
      value: ethAmount,
    });

    setTxHash(hash);
    showToast("交易已提交", "info");
    return hash;
  };

  const reset = () => {
    setTxHash(null);
  };

  return {
    buy,
    isPending: isWriting || isConfirming,
    isSuccess: isTransactionSuccess,
    isError: isReceiptError || isTransactionFailed,
    txHash,
    receipt,
    error: writeError,
    reset,
  };
}

/**
 * useTokenFactorySell - 卖出代币
 */
export function useTokenFactorySell() {
  const { address, isConnected } = useAccount();
  const { showToast } = useToast();
  const queryClient = useQueryClient();

  const [txHash, setTxHash] = useState<`0x${string}` | null>(null);

  const {
    writeContractAsync,
    isPending: isWriting,
    error: writeError,
  } = useWriteContract();

  const {
    isLoading: isConfirming,
    isSuccess: isReceiptReceived,
    data: receipt,
    isError: isReceiptError,
  } = useWaitForTransactionReceipt({
    hash: txHash ?? undefined,
    query: {
      enabled: !!txHash,
    },
  });

  const isTransactionSuccess = isReceiptReceived && receipt?.status === "success";
  const isTransactionFailed = isReceiptReceived && receipt?.status === "reverted";

  // 处理交易成功/失败
  React.useEffect(() => {
    if (isTransactionSuccess) {
      showToast("卖出成功！", "success");
      queryClient.invalidateQueries({ queryKey: ["tokenBalance"] });
      queryClient.invalidateQueries({ queryKey: ["poolState"] });
    } else if (isTransactionFailed) {
      showToast("交易执行失败", "error");
    }
  }, [isTransactionSuccess, isTransactionFailed, showToast, queryClient]);

  const sell = async (
    tokenAddress: Address,
    tokenAmount: bigint,
    minETHOut: bigint = 0n
  ) => {
    if (!address || !isConnected) {
      throw new Error("请先连接钱包");
    }

    const hash = await writeContractAsync({
      address: CONTRACTS.TOKEN_FACTORY,
      abi: TOKEN_FACTORY_ABI,
      functionName: "sell",
      args: [tokenAddress, tokenAmount, minETHOut],
    });

    setTxHash(hash);
    showToast("交易已提交", "info");
    return hash;
  };

  const reset = () => {
    setTxHash(null);
  };

  return {
    sell,
    isPending: isWriting || isConfirming,
    isSuccess: isTransactionSuccess,
    isError: isReceiptError || isTransactionFailed,
    txHash,
    receipt,
    error: writeError,
    reset,
  };
}

/**
 * useAllTokens - 获取所有代币列表
 */
export function useAllTokens() {
  const { data, isLoading, error, refetch } = useReadContract({
    address: CONTRACTS.TOKEN_FACTORY,
    abi: TOKEN_FACTORY_ABI,
    functionName: "getAllTokens",
  });

  return {
    tokens: data as Address[] | undefined,
    isLoading,
    error,
    refetch,
  };
}

/**
 * useServiceFee - 获取服务费
 */
export function useServiceFee() {
  const { data, isLoading, error } = useReadContract({
    address: CONTRACTS.TOKEN_FACTORY,
    abi: TOKEN_FACTORY_ABI,
    functionName: "serviceFee",
  });

  return {
    serviceFee: data as bigint | undefined,
    isLoading,
    error,
  };
}

export default {
  useTokenFactoryQuote,
  useTokenFactoryPoolState,
  useTokenFactoryPrice,
  useTokenFactoryBuy,
  useTokenFactorySell,
  useAllTokens,
  useServiceFee,
};
