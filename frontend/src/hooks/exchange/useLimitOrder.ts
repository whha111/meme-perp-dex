import { useState, useCallback } from "react";
import {
  useReadContract,
  useWriteContract,
  useWaitForTransactionReceipt,
  useAccount,
} from "wagmi";
import { type Address, parseUnits } from "viem";
import {
  LIMIT_ORDER_BOOK_ADDRESS,
  LIMIT_ORDER_BOOK_ABI,
  OrderType,
  OrderStatus,
  type LimitOrder,
} from "@/lib/limitOrderBook";

// Hook to get user's orders
export function useUserOrders() {
  const { address } = useAccount();

  const { data: orderIds, refetch: refetchOrderIds } = useReadContract({
    address: LIMIT_ORDER_BOOK_ADDRESS,
    abi: LIMIT_ORDER_BOOK_ABI,
    functionName: "getUserOrders",
    args: address ? [address] : undefined,
    query: {
      enabled: !!address,
      refetchInterval: 10000,
    },
  });

  const { data: orders, refetch: refetchOrders } = useReadContract({
    address: LIMIT_ORDER_BOOK_ADDRESS,
    abi: LIMIT_ORDER_BOOK_ABI,
    functionName: "getOrders",
    args: orderIds && orderIds.length > 0 ? [orderIds as bigint[]] : undefined,
    query: {
      enabled: !!orderIds && orderIds.length > 0,
      refetchInterval: 10000,
    },
  });

  const refetch = useCallback(() => {
    refetchOrderIds();
    setTimeout(() => refetchOrders(), 500);
  }, [refetchOrderIds, refetchOrders]);

  return {
    orders: (orders as LimitOrder[]) || [],
    orderIds: (orderIds as bigint[]) || [],
    refetch,
  };
}

// Hook to get pair orders (order book)
export function usePairOrders(tokenIn: Address | null, tokenOut: Address | null) {
  const { data: orderIds } = useReadContract({
    address: LIMIT_ORDER_BOOK_ADDRESS,
    abi: LIMIT_ORDER_BOOK_ABI,
    functionName: "getPairOrders",
    args: tokenIn && tokenOut ? [tokenIn, tokenOut] : undefined,
    query: {
      enabled: !!tokenIn && !!tokenOut,
      refetchInterval: 5000,
    },
  });

  const { data: orders } = useReadContract({
    address: LIMIT_ORDER_BOOK_ADDRESS,
    abi: LIMIT_ORDER_BOOK_ABI,
    functionName: "getOrders",
    args: orderIds && orderIds.length > 0 ? [orderIds as bigint[]] : undefined,
    query: {
      enabled: !!orderIds && orderIds.length > 0,
      refetchInterval: 5000,
    },
  });

  // Filter active orders only
  const activeOrders = (orders as LimitOrder[] || []).filter(
    (order) => order.status === OrderStatus.Active
  );

  return {
    orders: activeOrders,
    orderIds: (orderIds as bigint[]) || [],
  };
}

// Hook to check if order is executable
export function useOrderExecutable(orderId: bigint | null) {
  const { data } = useReadContract({
    address: LIMIT_ORDER_BOOK_ADDRESS,
    abi: LIMIT_ORDER_BOOK_ABI,
    functionName: "isOrderExecutable",
    args: orderId ? [orderId] : undefined,
    query: {
      enabled: !!orderId,
      refetchInterval: 10000,
    },
  });

  return {
    executable: data?.[0] || false,
    expectedOut: data?.[1] || 0n,
  };
}

// Hook to create limit order
export function useCreateLimitOrder() {
  const [status, setStatus] = useState<"idle" | "approving" | "creating" | "confirming" | "success" | "error">("idle");
  const [error, setError] = useState<Error | null>(null);

  const { writeContractAsync: writeContract } = useWriteContract();
  const { data: txHash, isPending: isWaiting } = useWaitForTransactionReceipt();

  const createOrder = useCallback(
    async ({
      orderType,
      tokenIn,
      tokenOut,
      amountIn,
      amountOutMin,
      deadline,
      isEthOrder,
    }: {
      orderType: OrderType;
      tokenIn: Address;
      tokenOut: Address;
      amountIn: bigint;
      amountOutMin: bigint;
      deadline: bigint;
      isEthOrder: boolean;
    }) => {
      try {
        setStatus("creating");
        setError(null);

        const hash = await writeContract({
          address: LIMIT_ORDER_BOOK_ADDRESS,
          abi: LIMIT_ORDER_BOOK_ABI,
          functionName: "createOrder",
          args: [orderType, tokenIn, tokenOut, amountIn, amountOutMin, deadline],
          value: isEthOrder ? amountIn : 0n,
        });

        setStatus("confirming");
        return hash;
      } catch (err) {
        setStatus("error");
        setError(err as Error);
        throw err;
      }
    },
    [writeContract]
  );

  const reset = useCallback(() => {
    setStatus("idle");
    setError(null);
  }, []);

  return {
    createOrder,
    status,
    error,
    isPending: status === "creating" || status === "confirming" || status === "approving",
    isSuccess: status === "success",
    isError: status === "error",
    reset,
  };
}

// Hook to cancel order
export function useCancelOrder() {
  const [status, setStatus] = useState<"idle" | "cancelling" | "confirming" | "success" | "error">("idle");
  const [error, setError] = useState<Error | null>(null);

  const { writeContractAsync: writeContract } = useWriteContract();

  const cancelOrder = useCallback(
    async (orderId: bigint) => {
      try {
        setStatus("cancelling");
        setError(null);

        const hash = await writeContract({
          address: LIMIT_ORDER_BOOK_ADDRESS,
          abi: LIMIT_ORDER_BOOK_ABI,
          functionName: "cancelOrder",
          args: [orderId],
        });

        setStatus("confirming");
        return hash;
      } catch (err) {
        setStatus("error");
        setError(err as Error);
        throw err;
      }
    },
    [writeContract]
  );

  const reset = useCallback(() => {
    setStatus("idle");
    setError(null);
  }, []);

  return {
    cancelOrder,
    status,
    error,
    isPending: status === "cancelling" || status === "confirming",
    isSuccess: status === "success",
    isError: status === "error",
    reset,
  };
}

// Hook to execute order (for keepers or anyone)
export function useExecuteOrder() {
  const [status, setStatus] = useState<"idle" | "executing" | "confirming" | "success" | "error">("idle");
  const [error, setError] = useState<Error | null>(null);

  const { writeContractAsync: writeContract } = useWriteContract();

  const executeOrder = useCallback(
    async (orderId: bigint) => {
      try {
        setStatus("executing");
        setError(null);

        const hash = await writeContract({
          address: LIMIT_ORDER_BOOK_ADDRESS,
          abi: LIMIT_ORDER_BOOK_ABI,
          functionName: "executeOrder",
          args: [orderId],
        });

        setStatus("confirming");
        return hash;
      } catch (err) {
        setStatus("error");
        setError(err as Error);
        throw err;
      }
    },
    [writeContract]
  );

  const reset = useCallback(() => {
    setStatus("idle");
    setError(null);
  }, []);

  return {
    executeOrder,
    status,
    error,
    isPending: status === "executing" || status === "confirming",
    isSuccess: status === "success",
    isError: status === "error",
    reset,
  };
}
