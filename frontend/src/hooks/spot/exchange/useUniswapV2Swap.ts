"use client";

/**
 * useUniswapV2Swap - Uniswap V2 Swap Hook (Mock 版本)
 *
 * 接口保留，返回模拟数据
 * TODO: 对接 Uniswap V2 Router 合约
 */

import { useState, useCallback } from "react";
import { type Address } from "viem";

export enum SwapStatus {
  IDLE = "idle",
  CHECKING_APPROVAL = "checking_approval",
  AWAITING_APPROVAL = "awaiting_approval",
  APPROVING = "approving",
  AWAITING_SWAP = "awaiting_swap",
  SWAPPING = "swapping",
  CONFIRMING = "confirming",
  SUCCESS = "success",
  FAILED = "failed",
}

export interface SwapParams {
  tokenIn: Address;
  tokenOut: Address;
  amountIn: bigint;
  amountOutMin: bigint;
  deadline?: bigint;
}

export interface UseUniswapV2SwapResult {
  executeSwap: (params: SwapParams) => Promise<`0x${string}` | undefined>;
  status: SwapStatus;
  isPending: boolean;
  isSuccess: boolean;
  isError: boolean;
  error: Error | null;
  transactionHash: `0x${string}` | null;
  reset: () => void;
  needsApproval: boolean;
  checkApproval: (token: Address, amount: bigint) => Promise<boolean>;
  approve: (token: Address) => Promise<`0x${string}` | undefined>;
}

/**
 * useUniswapV2Swap (Mock)
 */
export function useUniswapV2Swap(): UseUniswapV2SwapResult {
  const [status, setStatus] = useState<SwapStatus>(SwapStatus.IDLE);
  const [transactionHash, setTransactionHash] = useState<`0x${string}` | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [needsApproval, setNeedsApproval] = useState(false);

  /**
   * checkApproval (Mock)
   */
  const checkApproval = useCallback(
    async (token: Address, amount: bigint): Promise<boolean> => {
      console.log("[useUniswapV2Swap Mock] checkApproval called:", {
        token,
        amount: amount.toString(),
      });

      setStatus(SwapStatus.CHECKING_APPROVAL);

      // Mock: ETH 不需要授权，其他代币需要
      const isETH = token.toLowerCase() === "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee";
      setNeedsApproval(!isETH);

      return !isETH;
    },
    []
  );

  /**
   * approve (Mock)
   */
  const approve = useCallback(
    async (token: Address): Promise<`0x${string}` | undefined> => {
      console.log("[useUniswapV2Swap Mock] approve called:", { token });

      setStatus(SwapStatus.AWAITING_APPROVAL);
      setError(null);

      const mockHash = ("0x" + "1".repeat(64)) as `0x${string}`;

      setStatus(SwapStatus.APPROVING);
      setTransactionHash(mockHash);

      setTimeout(() => {
        setNeedsApproval(false);
      }, 500);

      return mockHash;
    },
    []
  );

  /**
   * executeSwap (Mock)
   */
  const executeSwap = useCallback(
    async (params: SwapParams): Promise<`0x${string}` | undefined> => {
      const { tokenIn, tokenOut, amountIn, amountOutMin, deadline } = params;

      console.log("[useUniswapV2Swap Mock] executeSwap called:", {
        tokenIn,
        tokenOut,
        amountIn: amountIn.toString(),
        amountOutMin: amountOutMin.toString(),
      });

      if (amountIn <= 0n) {
        setError(new Error("Invalid amount"));
        setStatus(SwapStatus.FAILED);
        return undefined;
      }

      setStatus(SwapStatus.AWAITING_SWAP);
      setError(null);
      setTransactionHash(null);

      const mockHash = ("0x" + "2".repeat(64)) as `0x${string}`;

      setStatus(SwapStatus.SWAPPING);
      setTransactionHash(mockHash);

      // Mock: 延迟后设置成功
      setTimeout(() => {
        setStatus(SwapStatus.SUCCESS);
      }, 1000);

      return mockHash;
    },
    []
  );

  /**
   * reset
   */
  const reset = useCallback(() => {
    setStatus(SwapStatus.IDLE);
    setTransactionHash(null);
    setError(null);
    setNeedsApproval(false);
  }, []);

  return {
    executeSwap,
    status,
    isPending:
      status === SwapStatus.SWAPPING ||
      status === SwapStatus.APPROVING ||
      status === SwapStatus.CONFIRMING,
    isSuccess: status === SwapStatus.SUCCESS,
    isError: status === SwapStatus.FAILED,
    error,
    transactionHash,
    reset,
    needsApproval,
    checkApproval,
    approve,
  };
}

/**
 * useTokenAllowance (Mock)
 */
export function useTokenAllowance(
  tokenAddress: Address | null,
  ownerAddress: Address | null,
  spenderAddress?: Address
) {
  const refetch = useCallback(() => {
    console.log("[useTokenAllowance Mock] refetch called");
  }, []);

  // Mock: 返回大额授权额度
  const allowance = tokenAddress && ownerAddress
    ? BigInt("0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff")
    : 0n;

  return {
    allowance,
    isLoading: false,
    refetch,
  };
}

export default useUniswapV2Swap;
