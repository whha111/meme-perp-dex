"use client";

/**
 * API Error Handling Hook
 *
 * 统一的错误处理，支持 Toast 提示和重试机制
 */

import { useCallback } from "react";
import { useToast } from "@/components/shared/Toast";

export interface ApiError extends Error {
  code?: string;
  status?: number;
  details?: unknown;
}

export interface UseApiErrorReturn {
  handleError: (error: Error | unknown, context?: string) => void;
  withErrorHandling: <T>(
    fn: () => Promise<T>,
    context?: string,
    options?: {
      fallback?: T;
      showToast?: boolean;
      rethrow?: boolean;
    }
  ) => Promise<T | undefined>;
  formatError: (error: Error | unknown) => string;
}

/**
 * 常见错误消息映射
 */
const ERROR_MESSAGES: Record<string, string> = {
  INSUFFICIENT_BALANCE: "Insufficient balance",
  INSUFFICIENT_MARGIN: "Insufficient margin",
  ORDER_NOT_FOUND: "Order not found",
  POSITION_NOT_FOUND: "Position not found",
  INVALID_SIGNATURE: "Invalid signature",
  INVALID_ORDER: "Invalid order parameters",
  ORDER_EXPIRED: "Order has expired",
  MAX_LEVERAGE_EXCEEDED: "Maximum leverage exceeded",
  MIN_SIZE_NOT_MET: "Order size below minimum",
  RATE_LIMITED: "Too many requests, please try again later",
  NETWORK_ERROR: "Network error, please check your connection",
  TIMEOUT: "Request timed out",
  UNKNOWN_ERROR: "An unexpected error occurred",
};

/**
 * 格式化错误消息
 */
export function formatErrorMessage(error: Error | unknown): string {
  if (error instanceof Error) {
    // Check for known error codes
    const errorCode = (error as ApiError).code;
    if (errorCode && ERROR_MESSAGES[errorCode]) {
      return ERROR_MESSAGES[errorCode];
    }

    // Check for HTTP status errors
    const status = (error as ApiError).status;
    if (status) {
      if (status === 401) return "Unauthorized - Please connect your wallet";
      if (status === 403) return "Access denied";
      if (status === 404) return "Resource not found";
      if (status === 429) return ERROR_MESSAGES.RATE_LIMITED;
      if (status >= 500) return "Server error, please try again later";
    }

    // Use error message if it's readable
    const message = error.message;
    if (message && message.length > 0 && message.length < 200) {
      // Sanitize common error prefixes
      const cleanMessage = message
        .replace(/^Error:\s*/i, "")
        .replace(/^Fetch error:\s*/i, "")
        .replace(/^HTTP \d+:\s*/i, "");
      return cleanMessage;
    }
  }

  // Fallback
  return ERROR_MESSAGES.UNKNOWN_ERROR;
}

/**
 * API Error Hook
 */
export function useApiError(): UseApiErrorReturn {
  const { showToast } = useToast();

  /**
   * Handle an error with optional context
   */
  const handleError = useCallback(
    (error: Error | unknown, context?: string) => {
      const errorMessage = formatErrorMessage(error);
      const fullMessage = context ? `${context}: ${errorMessage}` : errorMessage;

      // Log to console in development
      if (process.env.NODE_ENV === "development") {
        console.error(`[API Error]${context ? ` ${context}:` : ""}`, error);
      }

      // Show toast notification
      showToast(fullMessage, "error");
    },
    [showToast]
  );

  /**
   * Wrap an async function with error handling
   */
  const withErrorHandling = useCallback(
    async <T>(
      fn: () => Promise<T>,
      context?: string,
      options: {
        fallback?: T;
        showToast?: boolean;
        rethrow?: boolean;
      } = {}
    ): Promise<T | undefined> => {
      const { fallback, showToast: shouldShowToast = true, rethrow = false } = options;

      try {
        return await fn();
      } catch (error) {
        if (shouldShowToast) {
          handleError(error, context);
        } else if (process.env.NODE_ENV === "development") {
          console.error(`[API Error]${context ? ` ${context}:` : ""}`, error);
        }

        if (rethrow) {
          throw error;
        }

        return fallback;
      }
    },
    [handleError]
  );

  /**
   * Format error without showing toast
   */
  const formatError = useCallback((error: Error | unknown): string => {
    return formatErrorMessage(error);
  }, []);

  return {
    handleError,
    withErrorHandling,
    formatError,
  };
}

/**
 * Create an ApiError
 */
export function createApiError(
  message: string,
  code?: string,
  status?: number,
  details?: unknown
): ApiError {
  const error = new Error(message) as ApiError;
  error.code = code;
  error.status = status;
  error.details = details;
  return error;
}

export default useApiError;
