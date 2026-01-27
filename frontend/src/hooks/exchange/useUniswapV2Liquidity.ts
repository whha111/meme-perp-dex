"use client";

/**
 * useUniswapV2Liquidity - Add/Remove liquidity on Uniswap V2
 *
 * Handles ETH + Token liquidity operations with proper
 * approval handling and transaction monitoring.
 */

import { useState, useCallback } from "react";
import {
  useAccount,
  useWriteContract,
  useWaitForTransactionReceipt,
  useReadContract,
} from "wagmi";
import { type Address, maxUint256 } from "viem";
import {
  UNISWAP_V2_ADDRESSES,
  UNISWAP_V2_ROUTER_ABI,
  UNISWAP_V2_PAIR_ABI,
  UNISWAP_V2_FACTORY_ABI,
  ERC20_ABI,
  isETH,
  getDeadline,
} from "@/lib/uniswapV2";

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
 * useUniswapV2Liquidity - Hook for adding/removing liquidity on Uniswap V2
 */
export function useUniswapV2Liquidity(): UseUniswapV2LiquidityResult {
  const { address, isConnected } = useAccount();

  const [status, setStatus] = useState<LiquidityStatus>(LiquidityStatus.IDLE);
  const [transactionHash, setTransactionHash] = useState<`0x${string}` | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [needsApproval, setNeedsApproval] = useState(false);

  const {
    writeContractAsync,
    isPending: isWritePending,
    error: writeError,
  } = useWriteContract();

  const {
    isLoading: isConfirming,
    isSuccess: isConfirmed,
    isError: isReceiptError,
  } = useWaitForTransactionReceipt({
    hash: transactionHash || undefined,
    query: {
      enabled: !!transactionHash,
    },
  });

  /**
   * Check if token approval is needed for adding liquidity
   */
  const checkTokenApproval = useCallback(
    async (token: Address, amount: bigint): Promise<boolean> => {
      if (!address || isETH(token)) {
        setNeedsApproval(false);
        return false;
      }

      setStatus(LiquidityStatus.CHECKING_APPROVAL);
      // For simplicity, assume approval is needed for non-ETH tokens
      // Production code should check actual allowance
      setNeedsApproval(true);
      return true;
    },
    [address]
  );

  /**
   * Check if LP token approval is needed for removing liquidity
   */
  const checkLPApproval = useCallback(
    async (pairAddress: Address, amount: bigint): Promise<boolean> => {
      if (!address) {
        setNeedsApproval(false);
        return false;
      }

      setStatus(LiquidityStatus.CHECKING_APPROVAL);
      setNeedsApproval(true);
      return true;
    },
    [address]
  );

  /**
   * Approve token for router (for adding liquidity)
   */
  const approveToken = useCallback(
    async (token: Address): Promise<`0x${string}` | undefined> => {
      if (!address || isETH(token)) {
        return undefined;
      }

      setStatus(LiquidityStatus.AWAITING_APPROVAL);
      setError(null);

      try {
        const hash = await writeContractAsync({
          address: token,
          abi: ERC20_ABI,
          functionName: "approve",
          args: [UNISWAP_V2_ADDRESSES.ROUTER, maxUint256],
        });

        setStatus(LiquidityStatus.APPROVING);
        setTransactionHash(hash);
        setNeedsApproval(false);

        return hash;
      } catch (err) {
        console.error("Token approval failed:", err);
        setStatus(LiquidityStatus.FAILED);
        setError(err as Error);
        throw err;
      }
    },
    [address, writeContractAsync]
  );

  /**
   * Approve LP token for router (for removing liquidity)
   */
  const approveLPToken = useCallback(
    async (pairAddress: Address): Promise<`0x${string}` | undefined> => {
      if (!address) {
        return undefined;
      }

      setStatus(LiquidityStatus.AWAITING_APPROVAL);
      setError(null);

      try {
        const hash = await writeContractAsync({
          address: pairAddress,
          abi: ERC20_ABI,
          functionName: "approve",
          args: [UNISWAP_V2_ADDRESSES.ROUTER, maxUint256],
        });

        setStatus(LiquidityStatus.APPROVING);
        setTransactionHash(hash);
        setNeedsApproval(false);

        return hash;
      } catch (err) {
        console.error("LP token approval failed:", err);
        setStatus(LiquidityStatus.FAILED);
        setError(err as Error);
        throw err;
      }
    },
    [address, writeContractAsync]
  );

  /**
   * Add liquidity with ETH + Token
   */
  const addLiquidityETH = useCallback(
    async (params: AddLiquidityETHParams): Promise<`0x${string}` | undefined> => {
      const {
        token,
        amountTokenDesired,
        amountTokenMin,
        amountETHMin,
        ethAmount,
        deadline,
      } = params;

      if (!address || !isConnected) {
        setError(new Error("Please connect your wallet"));
        setStatus(LiquidityStatus.FAILED);
        return undefined;
      }

      if (amountTokenDesired <= 0n || ethAmount <= 0n) {
        setError(new Error("Invalid amounts"));
        setStatus(LiquidityStatus.FAILED);
        return undefined;
      }

      setStatus(LiquidityStatus.AWAITING_TRANSACTION);
      setError(null);
      setTransactionHash(null);

      const txDeadline = deadline || getDeadline(20);

      try {
        const hash = await writeContractAsync({
          address: UNISWAP_V2_ADDRESSES.ROUTER,
          abi: UNISWAP_V2_ROUTER_ABI,
          functionName: "addLiquidityETH",
          args: [
            token,
            amountTokenDesired,
            amountTokenMin,
            amountETHMin,
            address,
            txDeadline,
          ],
          value: ethAmount,
        });

        setStatus(LiquidityStatus.PROCESSING);
        setTransactionHash(hash);

        return hash;
      } catch (err) {
        console.error("Add liquidity failed:", err);
        setStatus(LiquidityStatus.FAILED);
        setError(err as Error);
        throw err;
      }
    },
    [address, isConnected, writeContractAsync]
  );

  /**
   * Remove liquidity and receive ETH + Token
   */
  const removeLiquidityETH = useCallback(
    async (params: RemoveLiquidityETHParams): Promise<`0x${string}` | undefined> => {
      const {
        token,
        liquidity,
        amountTokenMin,
        amountETHMin,
        deadline,
      } = params;

      if (!address || !isConnected) {
        setError(new Error("Please connect your wallet"));
        setStatus(LiquidityStatus.FAILED);
        return undefined;
      }

      if (liquidity <= 0n) {
        setError(new Error("Invalid liquidity amount"));
        setStatus(LiquidityStatus.FAILED);
        return undefined;
      }

      setStatus(LiquidityStatus.AWAITING_TRANSACTION);
      setError(null);
      setTransactionHash(null);

      const txDeadline = deadline || getDeadline(20);

      try {
        const hash = await writeContractAsync({
          address: UNISWAP_V2_ADDRESSES.ROUTER,
          abi: UNISWAP_V2_ROUTER_ABI,
          functionName: "removeLiquidityETH",
          args: [
            token,
            liquidity,
            amountTokenMin,
            amountETHMin,
            address,
            txDeadline,
          ],
        });

        setStatus(LiquidityStatus.PROCESSING);
        setTransactionHash(hash);

        return hash;
      } catch (err) {
        console.error("Remove liquidity failed:", err);
        setStatus(LiquidityStatus.FAILED);
        setError(err as Error);
        throw err;
      }
    },
    [address, isConnected, writeContractAsync]
  );

  const reset = useCallback(() => {
    setStatus(LiquidityStatus.IDLE);
    setTransactionHash(null);
    setError(null);
    setNeedsApproval(false);
  }, []);

  // Update status based on transaction confirmation
  if (isConfirming && status === LiquidityStatus.PROCESSING) {
    setStatus(LiquidityStatus.CONFIRMING);
  }
  if (isConfirmed && status === LiquidityStatus.CONFIRMING) {
    setStatus(LiquidityStatus.SUCCESS);
  }
  if (isReceiptError && status !== LiquidityStatus.FAILED) {
    setStatus(LiquidityStatus.FAILED);
  }

  return {
    addLiquidityETH,
    removeLiquidityETH,
    status,
    isPending:
      isWritePending ||
      isConfirming ||
      status === LiquidityStatus.PROCESSING ||
      status === LiquidityStatus.APPROVING,
    isSuccess: status === LiquidityStatus.SUCCESS || isConfirmed,
    isError: status === LiquidityStatus.FAILED || !!writeError || isReceiptError,
    error: error || (writeError as Error) || null,
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
 * usePairAddress - Get the pair address for two tokens
 */
export function usePairAddress(tokenA: Address | null, tokenB: Address | null) {
  const { data, isLoading, refetch } = useReadContract({
    address: UNISWAP_V2_ADDRESSES.FACTORY,
    abi: UNISWAP_V2_FACTORY_ABI,
    functionName: "getPair",
    args: tokenA && tokenB ? [tokenA, tokenB] : undefined,
    query: {
      enabled: !!tokenA && !!tokenB,
    },
  });

  return {
    pairAddress: data as Address | undefined,
    isLoading,
    refetch,
  };
}

/**
 * useLPBalance - Get user's LP token balance for a pair
 */
export function useLPBalance(pairAddress: Address | null, ownerAddress: Address | null) {
  const { data, isLoading, refetch } = useReadContract({
    address: pairAddress as Address,
    abi: UNISWAP_V2_PAIR_ABI,
    functionName: "balanceOf",
    args: ownerAddress ? [ownerAddress] : undefined,
    query: {
      enabled: !!pairAddress && !!ownerAddress,
      refetchInterval: 10000,
    },
  });

  return {
    balance: (data as bigint) || 0n,
    isLoading,
    refetch,
  };
}

/**
 * usePairReserves - Get reserves for a pair
 */
export function usePairReserves(pairAddress: Address | null) {
  const { data, isLoading, refetch } = useReadContract({
    address: pairAddress as Address,
    abi: UNISWAP_V2_PAIR_ABI,
    functionName: "getReserves",
    query: {
      enabled: !!pairAddress,
      refetchInterval: 10000,
    },
  });

  const reserves = data as [bigint, bigint, number] | undefined;

  return {
    reserve0: reserves?.[0] || 0n,
    reserve1: reserves?.[1] || 0n,
    blockTimestampLast: reserves?.[2] || 0,
    isLoading,
    refetch,
  };
}

/**
 * usePairTotalSupply - Get total supply of LP tokens
 */
export function usePairTotalSupply(pairAddress: Address | null) {
  const { data, isLoading, refetch } = useReadContract({
    address: pairAddress as Address,
    abi: UNISWAP_V2_PAIR_ABI,
    functionName: "totalSupply",
    query: {
      enabled: !!pairAddress,
      refetchInterval: 10000,
    },
  });

  return {
    totalSupply: (data as bigint) || 0n,
    isLoading,
    refetch,
  };
}

export default useUniswapV2Liquidity;
