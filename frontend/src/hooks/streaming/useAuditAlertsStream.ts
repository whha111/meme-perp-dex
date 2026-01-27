"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import { useToast } from "@/components/shared/Toast";

/**
 * Audit Alert from WatcherService.StreamAuditAlerts
 */
export interface AuditAlert {
  alertId: string;
  domainName: string;
  alertType: number; // AlertType enum value
  severity: number; // AlertSeverity enum value
  message: string;
  auditLogId: string;
  timestamp: bigint;
  metadata?: Record<string, string>;
}

/**
 * Hook return type
 */
export interface UseAuditAlertsStreamReturn {
  alerts: AuditAlert[];
  isConnected: boolean;
  isReconnecting: boolean;
  error: Error | null;
  reconnectCount: number;
  lastAlertTime: number | null;
}

/**
 * Exponential backoff configuration
 */
const BACKOFF_DELAYS = [1000, 2000, 4000, 8000, 16000]; // 1s, 2s, 4s, 8s, 16s
const MAX_RETRIES = 5;

/**
 * Alert severity levels (from proto)
 */
export const AlertSeverity = {
  UNSPECIFIED: 0,
  INFO: 1,
  WARNING: 2,
  CRITICAL: 3,
} as const;

/**
 * Security status values (from proto)
 */
export const SecurityStatus = {
  UNSPECIFIED: 0,
  AUTHENTIC: 1,
  MISMATCH: 2,
  MISSING: 3,
  TRANSFERRED: 4,
} as const;

/**
 * Hook to stream audit alerts from WatcherService
 * 
 * Features:
 * - Automatic reconnection with exponential backoff
 * - Lifecycle management with AbortController
 * - Automatic Toast notifications for critical alerts
 * - Performance optimization to prevent over-rendering
 * 
 * @example
 * ```tsx
 * const { alerts, isConnected } = useAuditAlertsStream({
 *   domainNames: ["example.com"],
 *   severityFilter: [AlertSeverity.CRITICAL, AlertSeverity.WARNING]
 * });
 * ```
 */
export function useAuditAlertsStream(params?: {
  domainNames?: string[];
  severityFilter?: number[]; // AlertSeverity enum values
  enabled?: boolean;
  showToasts?: boolean; // Whether to show toast notifications
}): UseAuditAlertsStreamReturn {
  const [alerts, setAlerts] = useState<AuditAlert[]>([]);
  const [isConnected, setIsConnected] = useState(false);
  const [isReconnecting, setIsReconnecting] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [reconnectCount, setReconnectCount] = useState(0);
  const [lastAlertTime, setLastAlertTime] = useState<number | null>(null);

  const { showToast } = useToast();

  // Use refs to prevent unnecessary re-renders
  const abortControllerRef = useRef<AbortController | null>(null);
  const isMountedRef = useRef(true);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const pendingAlertsRef = useRef<AuditAlert[]>([]);
  const rafRef = useRef<number | null>(null);
  const shownAlertIdsRef = useRef<Set<string>>(new Set()); // Track shown alerts to prevent duplicates

  // Batch state updates using requestAnimationFrame to prevent over-rendering
  const flushPendingAlerts = useCallback(() => {
    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current);
    }

    rafRef.current = requestAnimationFrame(() => {
      if (pendingAlertsRef.current.length > 0 && isMountedRef.current) {
        setAlerts((prev) => {
          // Keep only last 100 alerts to prevent memory issues
          const newAlerts = [...prev, ...pendingAlertsRef.current];
          return newAlerts.slice(-100);
        });
        pendingAlertsRef.current = [];
      }
    });
  }, []);

  // Show toast notification for critical alerts
  const handleAlertNotification = useCallback(
    (alert: AuditAlert) => {
      if (!params?.showToasts) {
        return;
      }

      // Prevent duplicate notifications
      if (shownAlertIdsRef.current.has(alert.alertId)) {
        return;
      }
      shownAlertIdsRef.current.add(alert.alertId);

      // Determine toast severity based on alert severity
      let toastSeverity: "info" | "warning" | "error" | "success" = "info";
      if (alert.severity === AlertSeverity.CRITICAL) {
        toastSeverity = "error";
      } else if (alert.severity === AlertSeverity.WARNING) {
        toastSeverity = "warning";
      }

      // Show toast for MISSING or MISMATCH status
      const isCriticalStatus =
        alert.message.includes("MISSING") ||
        alert.message.includes("MISMATCH") ||
        alert.severity === AlertSeverity.CRITICAL;

      if (isCriticalStatus) {
        const message = `[${alert.domainName}] ${alert.message}`;
        showToast(message, toastSeverity, 10000); // Show for 10 seconds for critical alerts
      }
    },
    [params?.showToasts, showToast]
  );

  // Stream connection function
  const connectStream = useCallback(async () => {
    // TODO: 实现 WebSocket 流式订阅
    console.warn("[AuditAlertsStream] WebSocket stream not yet implemented");
    setError(new Error("Audit alerts stream not yet implemented, migrating to WebSocket"));
    return;

    // Clean up previous connection
    abortControllerRef.current?.abort();

    /* 
    // Legacy gRPC implementation - waiting for WebSocket migration
    const controller = new AbortController();
    abortControllerRef.current = controller;
    const signal = controller.signal;

    try {
      setIsReconnecting(false);
      setIsConnected(false);
      setError(null);

      // Prepare request
      const request = {
        domainNames: params?.domainNames || [],
        severityFilter: params?.severityFilter || [],
      };

      // Start stream
      // const stream = watcherStreamClient.streamAuditAlerts(request, { signal });

      setIsConnected(true);
      setReconnectCount(0);

      // Consume stream with for await...of
      // for await (const alert of stream) {
      //   // Check if component is still mounted and not aborted
      //   if (signal.aborted || !isMountedRef.current) {
      //     break;
      //   }

      //   // Transform alert to our interface
      //   const auditAlert: AuditAlert = {
      //     alertId: alert.alertId || "",
      //     domainName: alert.domainName || "",
      //     alertType: alert.alertType || 0,
      //     severity: alert.severity || 0,
      //     message: alert.message || "",
      //     auditLogId: alert.auditLogId || "",
      //     timestamp: alert.timestamp || BigInt(0),
      //     metadata: alert.metadata ? Object.fromEntries(alert.metadata) : undefined,
      //   };

      //   // Add to pending alerts (batched update)
      //   pendingAlertsRef.current.push(auditAlert);
      //   setLastAlertTime(Date.now());
      //   flushPendingAlerts();

      //   // Show toast notification
      //   handleAlertNotification(auditAlert);
      // }

      // Stream ended normally
      if (isMountedRef.current && !signal.aborted) {
        setIsConnected(false);
      }
    } catch (err) {
      // Don't set error if aborted (normal cleanup)
      if (signal.aborted || !isMountedRef.current) {
        return;
      }

      const connectError = err instanceof Error ? err : new Error(String(err));

      // Don't retry on certain errors
      // if (
      //   false && // TODO: 移除 ConnectError 检查
      //   (connectError.code === Code.InvalidArgument ||
      //     connectError.code === Code.PermissionDenied ||
      //     connectError.code === Code.Unauthenticated)
      // ) {
      //   setError(connectError);
      //   setIsConnected(false);
      //   return;
      // }

      // Attempt reconnection with exponential backoff
      const currentRetry = reconnectCount;
      if (currentRetry < MAX_RETRIES) {
        const delay = BACKOFF_DELAYS[currentRetry] || BACKOFF_DELAYS[BACKOFF_DELAYS.length - 1];
        setIsReconnecting(true);
        setReconnectCount(currentRetry + 1);

        reconnectTimeoutRef.current = setTimeout(() => {
          if (isMountedRef.current && !signal.aborted) {
            connectStream();
          }
        }, delay);
      } else {
        // Max retries reached
        setError(
          new Error(
            `Connection failed after ${MAX_RETRIES} retries. Last error: ${connectError.message}`
          )
        );
        setIsConnected(false);
        setIsReconnecting(false);
      }
    }
    */
  }, [
    params?.domainNames,
    params?.severityFilter,
    reconnectCount,
    flushPendingAlerts,
    handleAlertNotification,
  ]);

  // Main effect: start stream when enabled
  useEffect(() => {
    if (params?.enabled === false) {
      return;
    }

    isMountedRef.current = true;
    connectStream();

    // Cleanup on unmount
    return () => {
      isMountedRef.current = false;

      // Cancel pending animation frame
      if (rafRef.current) {
        cancelAnimationFrame(rafRef.current);
      }

      // Clear reconnect timeout
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }

      // Abort stream
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
        abortControllerRef.current = null;
      }

      // Clear shown alerts tracking
      shownAlertIdsRef.current.clear();
    };
  }, [connectStream, params?.enabled]);

  return {
    alerts,
    isConnected,
    isReconnecting,
    error,
    reconnectCount,
    lastAlertTime,
  };
}

