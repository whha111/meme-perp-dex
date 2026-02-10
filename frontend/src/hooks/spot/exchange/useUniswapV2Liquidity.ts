"use client";

/**
 * useUniswapV2Liquidity - Uniswap V2 流动性 Hook (Mock 版本)
 *
 * 接口保留，返回模拟数据
 * TODO: 对接 Uniswap V2 Router 合约
 */

import { useState, useCallback } from "react";
import { type Address } from "viem";

export enum LiquidityStatus {
  IDLE = "idle",
  CHECKING_APPROVAL = "checking_approval",
  AWAITING_APPROVAL = "awaiting_approval",
  APPROVING = "approving",
  AWAITING_TRANSACTION = "awaiting_transaction",
  PROCESSING = "processing",
  CONFIRMING = "confirming",
  SUCCESS = "success",
  FAILED = "failed",
}

export interface AddLiquidityETHParams {
  token: Address;
  amountTokenDesired: bigint;
  amountTokenMin: bigint;
  amountETHMin: bigint;
  ethAmount: bigint;
  deadline?: bigint;
}

export interface RemoveLiquidityETHParams {
  token: Address;
  liquidity: bigint;
  amountTokenMin: bigint;
  amountETHMin: bigint;
  deadline?: bigint;
}

export interface UseUniswapV2LiquidityResult {
  addLiquidityETH: (params: AddLiquidityETHParams) => Promise<`0x${string}` | undefined>;
  removeLiquidityETH: (params: RemoveLiquidityETHParams) => Promise<`0x${string}` | undefined>;
  status: LiquidityStatus;
  isPending: boolean;
  isSuccess: boolean;
  isError: boolean;
  error: Error | null;
  transactionHash: `0x${string}` | null;
  reset: () => void;
  needsApproval: boolean;
  checkTokenApproval: (token: Address, amount: bigint) => Promise<boolean>;
  checkLPApproval: (pairAddress: Address, amount: bigint) => Promise<boolean>;
  approveToken: (token: Address) => Promise<`0x${string}` | undefined>;
  approveLPToken: (pairAddress: Address) => Promise<`0x${string}` | undefined>;
}

/**
 * useUniswapV2Liquidity (Mock)
 */
export function useUniswapV2Liquidity(): UseUniswapV2LiquidityResult {
  const [status, setStatus] = useState<LiquidityStatus>(LiquidityStatus.IDLE);
  const [transactionHash, setTransactionHash] = useState<`0x${string}` | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [needsApproval, setNeedsApproval] = useState(false);

  /**
   * checkTokenApproval (Mock)
   */
  const checkTokenApproval = useCallback(
    async (token: Address, amount: bigint): Promise<boolean> => {
      console.log("[useUniswapV2Liquidity Mock] checkTokenApproval called:", {
        token,
        amount: amount.toString(),
      });

      setStatus(LiquidityStatus.CHECKING_APPROVAL);
      setNeedsApproval(true);
      return true;
    },
    []
  );

  /**
   * checkLPApproval (Mock)
   */
  const checkLPApproval = useCallback(
    async (pairAddress: Address, amount: bigint): Promise<boolean> => {
      console.log("[useUniswapV2Liquidity Mock] checkLPApproval called:", {
        pairAddress,
        amount: amount.toString(),
      });

      setStatus(LiquidityStatus.CHECKING_APPROVAL);
      setNeedsApproval(true);
      return true;
    },
    []
  );

  /**
   * approveToken (Mock)
   */
  const approveToken = useCallback(
    async (token: Address): Promise<`0x${string}` | undefined> => {
      console.log("[useUniswapV2Liquidity Mock] approveToken called:", { token });

      setStatus(LiquidityStatus.AWAITING_APPROVAL);
      setError(null);

      const mockHash = ("0x" + "3".repeat(64)) as `0x${string}`;

      setStatus(LiquidityStatus.APPROVING);
      setTransactionHash(mockHash);

      setTimeout(() => {
        setNeedsApproval(false);
      }, 500);

      return mockHash;
    },
    []
  );

  /**
   * approveLPToken (Mock)
   */
  const approveLPToken = useCallback(
    async (pairAddress: Address): Promise<`0x${string}` | undefined> => {
      console.log("[useUniswapV2Liquidity Mock] approveLPToken called:", { pairAddress });

      setStatus(LiquidityStatus.AWAITING_APPROVAL);
      setError(null);

      const mockHash = ("0x" + "4".repeat(64)) as `0x${string}`;

      setStatus(LiquidityStatus.APPROVING);
      setTransactionHash(mockHash);

      setTimeout(() => {
        setNeedsApproval(false);
      }, 500);

      return mockHash;
    },
    []
  );

  /**
   * addLiquidityETH (Mock)
   */
  const addLiquidityETH = useCallback(
    async (params: AddLiquidityETHParams): Promise<`0x${string}` | undefined> => {
      const { token, amountTokenDesired, amountTokenMin, amountETHMin, ethAmount } = params;

      console.log("[useUniswapV2Liquidity Mock] addLiquidityETH called:", {
        token,
        amountTokenDesired: amountTokenDesired.toString(),
        ethAmount: ethAmount.toString(),
      });

      if (amountTokenDesired <= 0n || ethAmount <= 0n) {
        setError(new Error("Invalid amounts"));
        setStatus(LiquidityStatus.FAILED);
        return undefined;
      }

      setStatus(LiquidityStatus.AWAITING_TRANSACTION);
      setError(null);
      setTransactionHash(null);

      const mockHash = ("0x" + "5".repeat(64)) as `0x${string}`;

      setStatus(LiquidityStatus.PROCESSING);
      setTransactionHash(mockHash);

      setTimeout(() => {
        setStatus(LiquidityStatus.SUCCESS);
      }, 1000);

      return mockHash;
    },
    []
  );

  /**
   * removeLiquidityETH (Mock)
   */
  const removeLiquidityETH = useCallback(
    async (params: RemoveLiquidityETHParams): Promise<`0x${string}` | undefined> => {
      const { token, liquidity, amountTokenMin, amountETHMin } = params;

      console.log("[useUniswapV2Liquidity Mock] removeLiquidityETH called:", {
        token,
        liquidity: liquidity.toString(),
      });

      if (liquidity <= 0n) {
        setError(new Error("Invalid liquidity amount"));
        setStatus(LiquidityStatus.FAILED);
        return undefined;
      }

      setStatus(LiquidityStatus.AWAITING_TRANSACTION);
      setError(null);
      setTransactionHash(null);

      const mockHash = ("0x" + "6".repeat(64)) as `0x${string}`;

      setStatus(LiquidityStatus.PROCESSING);
      setTransactionHash(mockHash);

      setTimeout(() => {
        setStatus(LiquidityStatus.SUCCESS);
      }, 1000);

      return mockHash;
    },
    []
  );

  /**
   * reset
   */
  const reset = useCallback(() => {
    setStatus(LiquidityStatus.IDLE);
    setTransactionHash(null);
    setError(null);
    setNeedsApproval(false);
  }, []);

  return {
    addLiquidityETH,
    removeLiquidityETH,
    status,
    isPending:
      status === LiquidityStatus.PROCESSING ||
      status === LiquidityStatus.APPROVING ||
      status === LiquidityStatus.CONFIRMING,
    isSuccess: status === LiquidityStatus.SUCCESS,
    isError: status === LiquidityStatus.FAILED,
    error,
    transactionHash,
    reset,
    needsApproval,
    checkTokenApproval,
    checkLPApproval,
    approveToken,
    approveLPToken,
  };
}

/**
 * usePairAddress (Mock)
 */
export function usePairAddress(tokenA: Address | null, tokenB: Address | null) {
  const refetch = useCallback(() => {
    console.log("[usePairAddress Mock] refetch called");
  }, []);

  // Mock: 返回固定的配对地址
  const pairAddress = tokenA && tokenB
    ? ("0x" + "ab".repeat(20)) as Address
    : undefined;

  return {
    pairAddress,
    isLoading: false,
    refetch,
  };
}

/**
 * useLPBalance (Mock)
 */
export function useLPBalance(pairAddress: Address | null, ownerAddress: Address | null) {
  const refetch = useCallback(() => {
    console.log("[useLPBalance Mock] refetch called");
  }, []);

  // Mock: 返回固定的 LP 余额
  const balance = pairAddress && ownerAddress ? 100n * 10n ** 18n : 0n;

  return {
    balance,
    isLoading: false,
    refetch,
  };
}

/**
 * usePairReserves (Mock)
 */
export function usePairReserves(pairAddress: Address | null) {
  const refetch = useCallback(() => {
    console.log("[usePairReserves Mock] refetch called");
  }, []);

  // Mock: 返回固定的储备量
  return {
    reserve0: pairAddress ? 1000n * 10n ** 18n : 0n,
    reserve1: pairAddress ? 500n * 10n ** 18n : 0n,
    blockTimestampLast: pairAddress ? Math.floor(Date.now() / 1000) : 0,
    isLoading: false,
    refetch,
  };
}

/**
 * usePairTotalSupply (Mock)
 */
export function usePairTotalSupply(pairAddress: Address | null) {
  const refetch = useCallback(() => {
    console.log("[usePairTotalSupply Mock] refetch called");
  }, []);

  // Mock: 返回固定的总供应量
  const totalSupply = pairAddress ? 10000n * 10n ** 18n : 0n;

  return {
    totalSupply,
    isLoading: false,
    refetch,
  };
}

export default useUniswapV2Liquidity;
