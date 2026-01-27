"use client";

/**
 * useUniswapV2Swap - Execute swaps on Uniswap V2
 *
 * Handles ETH <-> Token and Token <-> Token swaps with proper
 * approval handling and transaction monitoring.
 */

import { useState, useCallback } from "react";
import {
  useAccount,
  useWriteContract,
  useWaitForTransactionReceipt,
  useReadContract,
} from "wagmi";
import { type Address, parseUnits, maxUint256 } from "viem";
import {
  UNISWAP_V2_ADDRESSES,
  UNISWAP_V2_ROUTER_ABI,
  ERC20_ABI,
  isETH,
  getTokenForPath,
  getDeadline,
} from "@/lib/uniswapV2";

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
 * useUniswapV2Swap - Hook for executing Uniswap V2 swaps
 *
 * @example
 * ```tsx
 * const { executeSwap, status, needsApproval, approve } = useUniswapV2Swap();
 *
 * // Check if approval is needed
 * const needsApprove = await checkApproval(tokenIn, amountIn);
 * if (needsApprove) {
 *   await approve(tokenIn);
 * }
 *
 * // Execute swap
 * await executeSwap({
 *   tokenIn: "0x...",
 *   tokenOut: "0x...",
 *   amountIn: parseUnits("1", 18),
 *   amountOutMin: parseUnits("0.99", 18),
 * });
 * ```
 */
export function useUniswapV2Swap(): UseUniswapV2SwapResult {
  const { address, isConnected } = useAccount();

  const [status, setStatus] = useState<SwapStatus>(SwapStatus.IDLE);
  const [transactionHash, setTransactionHash] = useState<`0x${string}` | null>(
    null
  );
  const [error, setError] = useState<Error | null>(null);
  const [needsApproval, setNeedsApproval] = useState(false);

  // Contract write hooks
  const {
    writeContractAsync,
    isPending: isWritePending,
    error: writeError,
  } = useWriteContract();

  // Wait for transaction receipt
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
   * Check if token approval is needed
   */
  const checkApproval = useCallback(
    async (token: Address, amount: bigint): Promise<boolean> => {
      if (!address || isETH(token)) {
        setNeedsApproval(false);
        return false;
      }

      setStatus(SwapStatus.CHECKING_APPROVAL);

      try {
        // We'll check allowance using a direct contract read
        // For now, assume approval is needed for non-ETH tokens
        // In production, you'd want to check the actual allowance
        setNeedsApproval(true);
        return true;
      } catch (err) {
        console.error("Error checking approval:", err);
        setNeedsApproval(true);
        return true;
      }
    },
    [address]
  );

  /**
   * Approve token for router
   */
  const approve = useCallback(
    async (token: Address): Promise<`0x${string}` | undefined> => {
      if (!address || isETH(token)) {
        return undefined;
      }

      setStatus(SwapStatus.AWAITING_APPROVAL);
      setError(null);

      try {
        const hash = await writeContractAsync({
          address: token,
          abi: ERC20_ABI,
          functionName: "approve",
          args: [UNISWAP_V2_ADDRESSES.ROUTER, maxUint256],
        });

        setStatus(SwapStatus.APPROVING);
        setTransactionHash(hash);
        setNeedsApproval(false);

        return hash;
      } catch (err) {
        console.error("Approval failed:", err);
        setStatus(SwapStatus.FAILED);
        setError(err as Error);
        throw err;
      }
    },
    [address, writeContractAsync]
  );

  /**
   * Execute the swap
   */
  const executeSwap = useCallback(
    async (params: SwapParams): Promise<`0x${string}` | undefined> => {
      const { tokenIn, tokenOut, amountIn, amountOutMin, deadline } = params;

      if (!address || !isConnected) {
        setError(new Error("Please connect your wallet"));
        setStatus(SwapStatus.FAILED);
        return undefined;
      }

      if (amountIn <= 0n) {
        setError(new Error("Invalid amount"));
        setStatus(SwapStatus.FAILED);
        return undefined;
      }

      setStatus(SwapStatus.AWAITING_SWAP);
      setError(null);
      setTransactionHash(null);

      const swapDeadline = deadline || getDeadline(20);
      const path: Address[] = [
        getTokenForPath(tokenIn),
        getTokenForPath(tokenOut),
      ];

      try {
        let hash: `0x${string}`;

        if (isETH(tokenIn)) {
          // ETH -> Token: swapExactETHForTokens
          hash = await writeContractAsync({
            address: UNISWAP_V2_ADDRESSES.ROUTER,
            abi: UNISWAP_V2_ROUTER_ABI,
            functionName: "swapExactETHForTokens",
            args: [amountOutMin, path, address, swapDeadline],
            value: amountIn,
          });
        } else if (isETH(tokenOut)) {
          // Token -> ETH: swapExactTokensForETH
          hash = await writeContractAsync({
            address: UNISWAP_V2_ADDRESSES.ROUTER,
            abi: UNISWAP_V2_ROUTER_ABI,
            functionName: "swapExactTokensForETH",
            args: [amountIn, amountOutMin, path, address, swapDeadline],
          });
        } else {
          // Token -> Token: swapExactTokensForTokens
          hash = await writeContractAsync({
            address: UNISWAP_V2_ADDRESSES.ROUTER,
            abi: UNISWAP_V2_ROUTER_ABI,
            functionName: "swapExactTokensForTokens",
            args: [amountIn, amountOutMin, path, address, swapDeadline],
          });
        }

        setStatus(SwapStatus.SWAPPING);
        setTransactionHash(hash);

        return hash;
      } catch (err) {
        console.error("Swap failed:", err);
        setStatus(SwapStatus.FAILED);
        setError(err as Error);
        throw err;
      }
    },
    [address, isConnected, writeContractAsync]
  );

  /**
   * Reset state
   */
  const reset = useCallback(() => {
    setStatus(SwapStatus.IDLE);
    setTransactionHash(null);
    setError(null);
    setNeedsApproval(false);
  }, []);

  // Update status based on transaction confirmation
  if (isConfirming && status === SwapStatus.SWAPPING) {
    setStatus(SwapStatus.CONFIRMING);
  }
  if (isConfirmed && status === SwapStatus.CONFIRMING) {
    setStatus(SwapStatus.SUCCESS);
  }
  if (isReceiptError && status !== SwapStatus.FAILED) {
    setStatus(SwapStatus.FAILED);
  }

  return {
    executeSwap,
    status,
    isPending:
      isWritePending ||
      isConfirming ||
      status === SwapStatus.SWAPPING ||
      status === SwapStatus.APPROVING,
    isSuccess: status === SwapStatus.SUCCESS || isConfirmed,
    isError: status === SwapStatus.FAILED || !!writeError || isReceiptError,
    error: error || (writeError as Error) || null,
    transactionHash,
    reset,
    needsApproval,
    checkApproval,
    approve,
  };
}

/**
 * useTokenAllowance - Check token allowance for spender
 * @param tokenAddress - The ERC20 token address
 * @param ownerAddress - The owner address
 * @param spenderAddress - Optional spender address (defaults to Uniswap router)
 */
export function useTokenAllowance(
  tokenAddress: Address | null,
  ownerAddress: Address | null,
  spenderAddress: Address = UNISWAP_V2_ADDRESSES.ROUTER
) {
  const { data, isLoading, refetch } = useReadContract({
    address: tokenAddress as Address,
    abi: ERC20_ABI,
    functionName: "allowance",
    args:
      ownerAddress && tokenAddress
        ? [ownerAddress, spenderAddress]
        : undefined,
    query: {
      enabled:
        !!tokenAddress &&
        !!ownerAddress &&
        !isETH(tokenAddress as Address),
      refetchInterval: 10000,
    },
  });

  return {
    allowance: (data as bigint) || 0n,
    isLoading,
    refetch,
  };
}

export default useUniswapV2Swap;
