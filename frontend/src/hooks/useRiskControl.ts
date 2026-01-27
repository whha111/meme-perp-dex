"use client";

/**
 * 风控数据 Hook (WebSocket 实时推送版本)
 *
 * 通过 WebSocket 实时接收以下风控数据：
 * 1. 仓位风险 (position_risks)
 * 2. 全局风控数据 (risk_data): 强平队列、保险基金、资金费率
 * 3. 强平热力图 (liquidation_map)
 * 4. 风险预警 (risk_alert)
 *
 * 所有数据都是服务器主动推送，无需 HTTP 轮询
 */

import { useState, useCallback, useEffect, useRef } from "react";
import { type Address } from "viem";

// ============================================================
// 配置
// ============================================================

const MATCHING_ENGINE_URL = process.env.NEXT_PUBLIC_MATCHING_ENGINE_URL || "http://localhost:8081";
const WS_RECONNECT_DELAY = 3000;
const MAX_RECONNECT_ATTEMPTS = 5;

// ============================================================
// 类型定义
// ============================================================

/**
 * 仓位风险信息
 */
export interface PositionRisk {
  pairId: string;
  trader: Address;
  token: Address;
  isLong: boolean;
  size: string;
  entryPrice: string;
  leverage: number;

  // 风险指标
  marginRatio: number;        // 保证金率 (基点, 10000 = 100%)
  mmr: number;                // 维持保证金率 (基点)
  liquidationPrice: string;   // 强平价格
  markPrice: string;          // 标记价格

  // 盈亏
  unrealizedPnL: string;
  collateral: string;

  // ADL 风险
  adlScore: number;
  adlRanking: number;         // 1-5, 5 = 最危险

  // 风险等级
  riskLevel: "low" | "medium" | "high" | "critical";
}

/**
 * 强平热力图数据
 */
export interface LiquidationMapData {
  token: Address;
  currentPrice: string;
  longs: LiquidationLevel[];
  shorts: LiquidationLevel[];
  totalLongSize: string;
  totalShortSize: string;
  totalLongAccounts: number;
  totalShortAccounts: number;
}

export interface LiquidationLevel {
  price: string;
  size: string;
  accounts: number;
  percentage: number;
}

/**
 * 保险基金状态
 */
export interface InsuranceFund {
  balance: string;
  totalContributions: string;
  totalPayouts: string;
  lastUpdated: number;
  display: {
    balance: string;
    totalContributions: string;
    totalPayouts: string;
  };
}

/**
 * 资金费率信息
 */
export interface FundingRateInfo {
  token: Address;
  currentRate: number;        // 当前费率 (基点)
  nextSettlement: number;     // 下次结算时间 (timestamp)
  lastSettlement: number;     // 上次结算时间
  longSize: string;
  shortSize: string;
  imbalance: number;          // 多空失衡度
}

/**
 * 强平队列项
 */
export interface LiquidationQueueItem {
  pairId: string;
  trader: Address;
  token: Address;
  isLong: boolean;
  size: string;
  marginRatio: number;
  urgency: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
}

/**
 * 风险预警
 */
export interface RiskAlert {
  type: "margin_warning" | "liquidation_warning" | "adl_warning" | "funding_warning";
  severity: "info" | "warning" | "danger";
  pairId?: string;
  message: string;
  timestamp: number;
}

// ============================================================
// 计算函数 (本地计算备用)
// ============================================================

/**
 * 计算强平价格 (Bybit 标准)
 */
export function calculateLiquidationPrice(
  entryPrice: bigint,
  leverage: number,
  isLong: boolean,
  mmr: number = 200 // 2% 默认 MMR
): bigint {
  const mmrDecimal = BigInt(mmr);
  const leverageBigInt = BigInt(leverage);

  if (isLong) {
    // 多头: liqPrice = entryPrice * (1 - 1/leverage + MMR/10000)
    const factor = 10000n - (10000n / leverageBigInt) + mmrDecimal;
    return (entryPrice * factor) / 10000n;
  } else {
    // 空头: liqPrice = entryPrice * (1 + 1/leverage - MMR/10000)
    const factor = 10000n + (10000n / leverageBigInt) - mmrDecimal;
    return (entryPrice * factor) / 10000n;
  }
}

/**
 * 计算保证金率
 */
export function calculateMarginRatio(
  equity: bigint,
  positionValue: bigint
): number {
  if (positionValue === 0n) return 10000;
  return Number((equity * 10000n) / positionValue);
}

/**
 * 计算风险等级
 */
export function calculateRiskLevel(
  marginRatio: number,
  mmr: number
): "low" | "medium" | "high" | "critical" {
  const ratio = marginRatio / mmr;
  if (ratio < 1) return "critical";
  if (ratio < 1.2) return "high";
  if (ratio < 1.5) return "medium";
  return "low";
}

/**
 * 计算 ADL 评分
 */
export function calculateADLScore(
  unrealizedPnL: bigint,
  margin: bigint,
  leverage: number
): number {
  if (margin === 0n || unrealizedPnL <= 0n) return 0;
  return Number((unrealizedPnL * BigInt(leverage) * 10000n) / margin) / 10000;
}

// ============================================================
// Hook: useRiskControl (WebSocket 版本)
// ============================================================

interface UseRiskControlOptions {
  trader?: Address;
  token?: Address;
  autoConnect?: boolean;
}

interface UseRiskControlReturn {
  // 数据
  positionRisks: PositionRisk[];
  liquidationMap: LiquidationMapData | null;
  insuranceFund: InsuranceFund | null;
  fundingRates: FundingRateInfo[];
  liquidationQueue: LiquidationQueueItem[];
  alerts: RiskAlert[];

  // 连接状态
  isConnected: boolean;
  error: string | null;
  lastUpdated: number | null;

  // 操作
  clearAlerts: () => void;
  reconnect: () => void;
}

export function useRiskControl(options: UseRiskControlOptions = {}): UseRiskControlReturn {
  const {
    trader,
    token,
    autoConnect = true,
  } = options;

  // 状态
  const [positionRisks, setPositionRisks] = useState<PositionRisk[]>([]);
  const [liquidationMap, setLiquidationMap] = useState<LiquidationMapData | null>(null);
  const [insuranceFund, setInsuranceFund] = useState<InsuranceFund | null>(null);
  const [fundingRates, setFundingRates] = useState<FundingRateInfo[]>([]);
  const [liquidationQueue, setLiquidationQueue] = useState<LiquidationQueueItem[]>([]);
  const [alerts, setAlerts] = useState<RiskAlert[]>([]);
  const [isConnected, setIsConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<number | null>(null);

  // WebSocket 引用
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const reconnectAttemptsRef = useRef(0);
  const isConnectingRef = useRef(false);

  // 清除预警
  const clearAlerts = useCallback(() => {
    setAlerts([]);
  }, []);

  // WebSocket 连接
  const connect = useCallback(() => {
    if (isConnectingRef.current || wsRef.current?.readyState === WebSocket.OPEN) {
      return;
    }

    isConnectingRef.current = true;
    setError(null);

    try {
      const wsUrl = MATCHING_ENGINE_URL.replace(/^http/, "ws");
      const ws = new WebSocket(wsUrl);

      ws.onopen = () => {
        console.log("[RiskControl] WebSocket connected");
        setIsConnected(true);
        setError(null);
        reconnectAttemptsRef.current = 0;
        isConnectingRef.current = false;

        // 订阅用户仓位风险数据
        if (trader) {
          ws.send(JSON.stringify({
            type: "subscribe_risk",
            trader,
          }));
        }

        // 订阅全局风控数据
        ws.send(JSON.stringify({
          type: "subscribe_global_risk",
        }));

        // 订阅代币数据 (订单簿和强平热力图)
        if (token) {
          ws.send(JSON.stringify({
            type: "subscribe",
            token,
          }));
        }
      };

      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          setLastUpdated(Date.now());

          switch (data.type) {
            // 用户仓位风险数据
            case "position_risks":
              setPositionRisks(data.positions || []);
              break;

            // 全局风控数据
            case "risk_data":
              if (data.liquidationQueue) {
                setLiquidationQueue(data.liquidationQueue);
              }
              if (data.insuranceFund) {
                setInsuranceFund(data.insuranceFund);
              }
              if (data.fundingRates) {
                setFundingRates(data.fundingRates);
              }
              break;

            // 强平热力图
            case "liquidation_map":
              setLiquidationMap({
                token: data.token,
                currentPrice: data.currentPrice,
                longs: data.longs || [],
                shorts: data.shorts || [],
                totalLongSize: data.totalLongSize,
                totalShortSize: data.totalShortSize,
                totalLongAccounts: data.totalLongAccounts,
                totalShortAccounts: data.totalShortAccounts,
              });
              break;

            // 风险预警
            case "risk_alert":
              const newAlert: RiskAlert = {
                type: data.alertType,
                severity: data.severity,
                pairId: data.pairId,
                message: data.message,
                timestamp: data.timestamp || Date.now(),
              };
              setAlerts(prev => [newAlert, ...prev].slice(0, 50));
              break;

            // 强平事件
            case "liquidation":
              setAlerts(prev => [{
                type: "liquidation_warning" as const,
                severity: "danger" as const,
                pairId: data.pairId,
                message: `Position ${data.pairId?.slice(0, 8)} was liquidated`,
                timestamp: Date.now(),
              }, ...prev].slice(0, 50));
              break;

            // ADL 事件
            case "adl_execution":
              setAlerts(prev => [{
                type: "adl_warning" as const,
                severity: "danger" as const,
                pairId: data.pairId,
                message: `ADL executed on position ${data.pairId?.slice(0, 8)}`,
                timestamp: Date.now(),
              }, ...prev].slice(0, 50));
              break;

            // 资金费结算
            case "funding_settlement":
              setAlerts(prev => [{
                type: "funding_warning" as const,
                severity: "info" as const,
                message: `Funding fee settled: ${data.totalPayments || 0} positions`,
                timestamp: Date.now(),
              }, ...prev].slice(0, 50));
              break;
          }
        } catch (err) {
          console.error("[RiskControl] Failed to parse WebSocket message:", err);
        }
      };

      ws.onerror = () => {
        // 只在开发模式下输出简洁日志，避免刷屏
        if (process.env.NODE_ENV === "development" && reconnectAttemptsRef.current === 0) {
          console.warn("[RiskControl] WebSocket connection failed, will retry...");
        }
        setError("WebSocket connection error");
        isConnectingRef.current = false;
      };

      ws.onclose = () => {
        console.log("[RiskControl] WebSocket disconnected");
        setIsConnected(false);
        wsRef.current = null;
        isConnectingRef.current = false;

        // 自动重连
        if (autoConnect && reconnectAttemptsRef.current < MAX_RECONNECT_ATTEMPTS) {
          reconnectAttemptsRef.current++;
          console.log(`[RiskControl] Reconnecting in ${WS_RECONNECT_DELAY}ms (attempt ${reconnectAttemptsRef.current}/${MAX_RECONNECT_ATTEMPTS})`);
          reconnectTimeoutRef.current = setTimeout(connect, WS_RECONNECT_DELAY);
        } else if (reconnectAttemptsRef.current >= MAX_RECONNECT_ATTEMPTS) {
          setError("Failed to connect after multiple attempts");
        }
      };

      wsRef.current = ws;
    } catch (err) {
      console.error("[RiskControl] Failed to create WebSocket:", err);
      setError("Failed to create WebSocket connection");
      isConnectingRef.current = false;
    }
  }, [trader, token, autoConnect]);

  // 手动重连
  const reconnect = useCallback(() => {
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
    reconnectAttemptsRef.current = 0;
    connect();
  }, [connect]);

  // 初始化连接
  useEffect(() => {
    if (autoConnect) {
      connect();
    }

    return () => {
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }
      if (wsRef.current) {
        // 取消订阅
        if (wsRef.current.readyState === WebSocket.OPEN) {
          if (trader) {
            wsRef.current.send(JSON.stringify({
              type: "unsubscribe_risk",
              trader,
            }));
          }
          wsRef.current.send(JSON.stringify({
            type: "unsubscribe_global_risk",
          }));
        }
        wsRef.current.close();
        wsRef.current = null;
      }
    };
  }, [autoConnect, connect, trader]);

  // 当 trader 变化时重新订阅
  useEffect(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN && trader) {
      wsRef.current.send(JSON.stringify({
        type: "subscribe_risk",
        trader,
      }));
    }
  }, [trader]);

  // 当 token 变化时重新订阅
  useEffect(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN && token) {
      wsRef.current.send(JSON.stringify({
        type: "subscribe",
        token,
      }));
    }
  }, [token]);

  return {
    positionRisks,
    liquidationMap,
    insuranceFund,
    fundingRates,
    liquidationQueue,
    alerts,
    isConnected,
    error,
    lastUpdated,
    clearAlerts,
    reconnect,
  };
}

// ============================================================
// Hook: usePositionRisk (单仓位风险 - 本地计算)
// ============================================================

interface UsePositionRiskReturn {
  marginRatio: number;
  riskLevel: "low" | "medium" | "high" | "critical";
  liquidationPrice: string;
  adlRanking: number;
  distanceToLiquidation: number;  // 距离强平的百分比
  isAtRisk: boolean;
}

export function usePositionRisk(
  position: {
    entryPrice: string;
    markPrice: string;
    leverage: number;
    isLong: boolean;
    collateral: string;
    size: string;
    unrealizedPnL: string;
  } | null
): UsePositionRiskReturn {
  if (!position) {
    return {
      marginRatio: 10000,
      riskLevel: "low",
      liquidationPrice: "0",
      adlRanking: 1,
      distanceToLiquidation: 100,
      isAtRisk: false,
    };
  }

  const mmr = 200; // 2% 固定 MMR
  const entryPrice = BigInt(position.entryPrice || "0");
  const markPrice = BigInt(position.markPrice || "0");
  const collateral = BigInt(position.collateral || "0");
  const size = BigInt(position.size || "0");
  const unrealizedPnL = BigInt(position.unrealizedPnL || "0");

  // 计算仓位价值
  const positionValue = size > 0n && markPrice > 0n
    ? (size * markPrice) / (10n ** 24n)
    : 0n;

  // 计算权益
  const equity = collateral + unrealizedPnL;

  // 计算保证金率
  const marginRatio = calculateMarginRatio(equity, positionValue);

  // 计算风险等级
  const riskLevel = calculateRiskLevel(marginRatio, mmr);

  // 计算强平价格
  const liquidationPrice = calculateLiquidationPrice(
    entryPrice,
    position.leverage,
    position.isLong,
    mmr
  );

  // 计算 ADL 评分和排名
  const adlScore = calculateADLScore(
    unrealizedPnL,
    collateral,
    position.leverage
  );
  const adlRanking = Math.min(5, Math.max(1, Math.ceil(adlScore)));

  // 计算距离强平的百分比
  const distanceToLiquidation = markPrice > 0n
    ? position.isLong
      ? Number(((markPrice - liquidationPrice) * 10000n) / markPrice) / 100
      : Number(((liquidationPrice - markPrice) * 10000n) / markPrice) / 100
    : 100;

  return {
    marginRatio,
    riskLevel,
    liquidationPrice: liquidationPrice.toString(),
    adlRanking,
    distanceToLiquidation: Math.max(0, distanceToLiquidation),
    isAtRisk: riskLevel === "high" || riskLevel === "critical",
  };
}

export default useRiskControl;
