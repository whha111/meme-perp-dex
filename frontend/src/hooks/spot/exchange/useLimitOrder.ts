"use client";

/**
 * useLimitOrder - 限价单 Hooks (Mock 版本)
 *
 * 接口保留，返回模拟数据
 * TODO: 对接 LimitOrderBook 合约
 */

import { useState, useCallback } from "react";
import { type Address } from "viem";

// Re-export types for compatibility
export enum OrderType {
  LIMIT_BUY = 0,
  LIMIT_SELL = 1,
}

export enum OrderStatus {
  Active = 0,
  Executed = 1,
  Cancelled = 2,
}

export interface LimitOrder {
  id: bigint;
  orderType: OrderType;
  owner: Address;
  tokenIn: Address;
  tokenOut: Address;
  amountIn: bigint;
  amountOutMin: bigint;
  deadline: bigint;
  status: OrderStatus;
  createdAt: bigint;
}

/**
 * useUserOrders (Mock)
 */
export function useUserOrders() {
  const refetch = useCallback(() => {
    console.log("[useUserOrders Mock] refetch called");
  }, []);

  // Mock: 返回空订单列表
  return {
    orders: [] as LimitOrder[],
    orderIds: [] as bigint[],
    refetch,
  };
}

/**
 * usePairOrders (Mock)
 */
export function usePairOrders(tokenIn: Address | null, tokenOut: Address | null) {
  // Mock: 返回空活跃订单列表
  return {
    orders: [] as LimitOrder[],
    orderIds: [] as bigint[],
  };
}

/**
 * useOrderExecutable (Mock)
 */
export function useOrderExecutable(orderId: bigint | null) {
  return {
    executable: false,
    expectedOut: 0n,
  };
}

/**
 * useCreateLimitOrder (Mock)
 */
export function useCreateLimitOrder() {
  const [status, setStatus] = useState<"idle" | "approving" | "creating" | "confirming" | "success" | "error">("idle");
  const [error, setError] = useState<Error | null>(null);

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
      console.log("[useCreateLimitOrder Mock] createOrder called:", {
        orderType,
        tokenIn,
        tokenOut,
        amountIn: amountIn.toString(),
        amountOutMin: amountOutMin.toString(),
      });

      setStatus("creating");

      // Mock: 返回假的交易哈希
      const mockHash = ("0x" + "d".repeat(64)) as `0x${string}`;

      setTimeout(() => setStatus("success"), 500);

      return mockHash;
    },
    []
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

/**
 * useCancelOrder (Mock)
 */
export function useCancelOrder() {
  const [status, setStatus] = useState<"idle" | "cancelling" | "confirming" | "success" | "error">("idle");
  const [error, setError] = useState<Error | null>(null);

  const cancelOrder = useCallback(async (orderId: bigint) => {
    console.log("[useCancelOrder Mock] cancelOrder called:", { orderId: orderId.toString() });

    setStatus("cancelling");

    const mockHash = ("0x" + "e".repeat(64)) as `0x${string}`;

    setTimeout(() => setStatus("success"), 500);

    return mockHash;
  }, []);

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

/**
 * useExecuteOrder (Mock)
 */
export function useExecuteOrder() {
  const [status, setStatus] = useState<"idle" | "executing" | "confirming" | "success" | "error">("idle");
  const [error, setError] = useState<Error | null>(null);

  const executeOrder = useCallback(async (orderId: bigint) => {
    console.log("[useExecuteOrder Mock] executeOrder called:", { orderId: orderId.toString() });

    setStatus("executing");

    const mockHash = ("0x" + "f".repeat(64)) as `0x${string}`;

    setTimeout(() => setStatus("success"), 500);

    return mockHash;
  }, []);

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
