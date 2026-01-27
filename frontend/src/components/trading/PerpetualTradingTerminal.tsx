"use client";

import React, { useState, useMemo, useEffect } from "react";
import { useTranslations } from "next-intl";
import { useAccount, useWriteContract, useWaitForTransactionReceipt } from "wagmi";
import { formatEther, type Address } from "viem";
import dynamic from "next/dynamic";
// V2 架构：使用 Settlement 合约 + 撮合引擎的用户对赌模式
import { PerpetualOrderPanelV2 } from "./PerpetualOrderPanelV2";
import { usePerpetualV2 } from "@/hooks/usePerpetualV2";
import { AccountBalance } from "./AccountBalance";
import { useMatchingEngineWS } from "@/hooks/useMatchingEngineWS";
import { OrderBook } from "./OrderBook";
import { LiquidationMap } from "./LiquidationMap";
import { AllPositions } from "./AllPositions";
import { HunterLeaderboard } from "./HunterLeaderboard";
import { RiskPanel } from "./RiskPanel";
import {
  usePerpetualStore,
  usePositions,
  useOpenOrders,
  useOrderHistory,
  useTrades,
  useMarketData,
  Position,
  Order,
  Trade,
} from "@/lib/stores/perpetualStore";
import { useTokenInfo, getTokenDisplayName } from "@/hooks/useTokenInfo";
import { usePoolState } from "@/hooks/usePoolState";
import { useToast } from "@/components/shared/Toast";
import { useTokenStats } from "@/hooks/useTokenStats";
import { useFundingRate } from "@/hooks/useFundingRate";
import { useTradingWallet } from "@/hooks/useTradingWallet";
import { cancelOrder } from "@/utils/orderSigning";
import { useRiskControl } from "@/hooks/useRiskControl";

// P003 修复: 统一使用 V2 架构（Settlement 合约 + 撮合引擎）
// 移除旧的 PositionManager 合约依赖，仓位数据统一从撮合引擎获取

// Dynamically import chart to avoid SSR issues
// 永续合约使用专用图表组件（从撮合引擎获取数据）
const PerpetualPriceChart = dynamic(
  () => import("./PerpetualPriceChart").then((mod) => mod.PerpetualPriceChart),
  {
    ssr: false,
    loading: () => <div className="w-full h-full bg-[#131722] animate-pulse" />,
  }
);

interface PerpetualTradingTerminalProps {
  symbol: string;
  className?: string;
  tokenAddress?: Address; // Token contract address for multi-token support
}

export function PerpetualTradingTerminal({
  symbol,
  className,
  tokenAddress: propTokenAddress,
}: PerpetualTradingTerminalProps) {
  const t = useTranslations("perp");
  const tc = useTranslations("common");
  const { address, isConnected } = useAccount();
  const { showToast } = useToast();

  // 获取交易钱包（派生钱包）信息
  const {
    address: tradingWalletAddress,
    getSignature,
    isInitialized: isTradingWalletInitialized,
  } = useTradingWallet();

  // 获取交易钱包签名（用于派生私钥）
  const tradingWalletSignature = getSignature();

  // Get token address - use prop if provided, otherwise try to parse from symbol
  const tokenAddress = useMemo(() => {
    if (propTokenAddress) return propTokenAddress;
    if (symbol.startsWith("0x") && symbol.length === 42) return symbol as Address;
    return undefined;
  }, [propTokenAddress, symbol]);

  // Get pool state to check if perpetual trading is enabled
  const { poolState, isLoading: isPoolLoading } = usePoolState(tokenAddress);
  const isPerpEnabled = poolState?.perpEnabled ?? false;

  // V2: 使用 Settlement 合约获取仓位和订单
  // 传递交易钱包地址和签名，确保查询正确的订单
  const {
    positions: v2Positions,
    pendingOrders: v2PendingOrders,
    balance: accountBalance,
    closePair,
    refreshPositions,
    refreshOrders,
    refreshBalance,
  } = usePerpetualV2({
    tradingWalletAddress: tradingWalletAddress || undefined,
    tradingWalletSignature: tradingWalletSignature || undefined,
  });

  // 格式化账户余额
  const formattedAccountBalance = useMemo(() => {
    if (!accountBalance) return "$0.00";
    const available = Number(accountBalance.available) / 1e6;
    return `$${available.toFixed(2)}`;
  }, [accountBalance]);

  // WebSocket 实时订单簿和成交数据
  const {
    orderBook: wsOrderBook,
    recentTrades: wsRecentTrades,
    isConnected: wsConnected,
  } = useMatchingEngineWS(tokenAddress);

  // 从撮合引擎获取实时统计数据
  const {
    formattedPrice,
    formattedPriceChange,
    isPriceUp,
    formattedHigh24h,
    formattedLow24h,
    formattedVolume24h,
    formattedOpenInterest,
    trades24h,
  } = useTokenStats(tokenAddress);

  // 从撮合引擎获取资金费率
  const {
    formattedRate: fundingRateFormatted,
    isPositive: isFundingPositive,
    countdown: fundingCountdown,
  } = useFundingRate(tokenAddress);

  // 自动轮询仓位和订单 (每5秒刷新一次)
  // 使用交易钱包地址来查询订单（如果已初始化），否则使用主钱包地址
  useEffect(() => {
    const effectiveAddress = tradingWalletAddress || address;
    if (!effectiveAddress) return;

    const interval = setInterval(() => {
      refreshPositions();
      refreshOrders();
    }, 5000);

    return () => clearInterval(interval);
  }, [tradingWalletAddress, address, refreshPositions, refreshOrders]);

  // 当前代币的 V2 仓位 (HTTP 轮询的数据 - 用于平仓等操作)
  const currentV2Positions = useMemo(() => {
    if (!tokenAddress) return [];
    return v2Positions.filter(
      (p) => p.token.toLowerCase() === tokenAddress.toLowerCase()
    );
  }, [v2Positions, tokenAddress]);

  // Contract write for closing position
  const { writeContract, data: txHash, isPending: isWritePending } = useWriteContract();
  const { isLoading: isConfirming, isSuccess: isConfirmed } = useWaitForTransactionReceipt({
    hash: txHash,
  });

  // P003 修复: 移除旧的 PositionManager 合约调用
  // V2 架构使用 Settlement 合约 + 撮合引擎，仓位数据统一从 usePerpetualV2 获取

  // Handle close position success
  useEffect(() => {
    if (isConfirmed && txHash) {
      showToast(t("orderPlaced"), "success");
      refreshPositions(); // 使用 V2 的 refreshPositions
    }
  }, [isConfirmed, txHash, showToast, t, refreshPositions]);

  // 从链上获取代币名称和符号
  const tokenInfo = useTokenInfo(symbol);
  const displaySymbol = getTokenDisplayName(symbol, tokenInfo);

  const instId = `${displaySymbol.toUpperCase()}-PERP`;

  const [activeBottomTab, setActiveBottomTab] = useState<
    "positions" | "openOrders" | "orderHistory" | "tradeHistory" | "hunting" | "risk"
  >("positions");

  // 风控数据
  const {
    alerts: riskAlerts,
    insuranceFund,
    positionRisks,
    clearAlerts: clearRiskAlerts,
  } = useRiskControl({
    trader: tradingWalletAddress || address,
    token: tokenAddress,
  });

  // 计算整体风险等级
  const overallRisk = positionRisks.reduce((worst, pos) => {
    const levels = ["low", "medium", "high", "critical"];
    return levels.indexOf(pos.riskLevel) > levels.indexOf(worst) ? pos.riskLevel : worst;
  }, "low" as "low" | "medium" | "high" | "critical");

  // ============================================================
  // 使用 useRiskControl 的实时推送仓位数据来渲染
  // 后端每100ms计算一次，通过 WebSocket 实时推送
  // ============================================================
  const currentPositionsForDisplay = useMemo(() => {
    if (!tokenAddress) return [];
    // 优先使用 WebSocket 推送的 positionRisks 数据
    // 这些数据包含了后端实时计算的 markPrice, unrealizedPnL, marginRatio, roe 等
    const wsPositions = positionRisks.filter(
      (p) => p.token.toLowerCase() === tokenAddress.toLowerCase()
    );
    if (wsPositions.length > 0) {
      return wsPositions;
    }
    // 如果 WebSocket 没有数据，回退到 HTTP 轮询数据
    return currentV2Positions;
  }, [tokenAddress, positionRisks, currentV2Positions]);

  // 账户余额面板状态
  const [showAccountPanel, setShowAccountPanel] = useState(false);

  // 撤单状态
  const [cancellingOrderId, setCancellingOrderId] = useState<string | null>(null);

  // 撤单处理函数
  const handleCancelOrder = async (orderId: string) => {
    if (!tradingWalletAddress || !tradingWalletSignature) {
      showToast("请先创建交易钱包", "error");
      return;
    }

    setCancellingOrderId(orderId);
    try {
      const result = await cancelOrder(
        orderId,
        tradingWalletAddress,
        tradingWalletSignature
      );

      if (result.success) {
        showToast("撤单成功", "success");
        // 刷新订单列表
        refreshOrders();
      } else {
        showToast(result.error || "撤单失败", "error");
      }
    } catch (error) {
      console.error("Cancel order error:", error);
      showToast("撤单失败", "error");
    } finally {
      setCancellingOrderId(null);
    }
  };

  // Store state
  const positions = usePositions();
  const openOrders = useOpenOrders();
  const orderHistory = useOrderHistory();
  const trades = useTrades();
  const marketData = useMarketData(instId);

  // Set selected instrument on mount - use getState() to avoid subscribing to entire store
  useEffect(() => {
    usePerpetualStore.getState().setSelectedInstId(instId);
  }, [instId]);

  // P003 修复: 移除旧的链上仓位同步逻辑
  // V2 架构使用 Settlement 合约 + 撮合引擎，仓位数据从 usePerpetualV2 获取
  // currentV2Positions 已经包含了所有需要的仓位数据

  // Filter data for current instrument
  const filteredPositions = useMemo(
    () => positions.filter((p) => p.instId === instId),
    [positions, instId]
  );

  const filteredOpenOrders = useMemo(
    () => openOrders.filter((o) => o.instId === instId),
    [openOrders, instId]
  );

  const filteredOrderHistory = useMemo(
    () => orderHistory.filter((o) => o.instId === instId),
    [orderHistory, instId]
  );

  const filteredTrades = useMemo(
    () => trades.filter((t) => t.instId === instId),
    [trades, instId]
  );

  // Market info - 优先使用撮合引擎数据
  const marketInfo = useMemo(
    () => ({
      fundingRate: fundingRateFormatted,
      nextFunding: fundingCountdown,
      openInterest: `$${formattedOpenInterest}`,
      volume24h: `$${formattedVolume24h}`,
      high24h: `$${formattedHigh24h}`,
      low24h: `$${formattedLow24h}`,
      currentPrice: `$${formattedPrice}`,
      priceChange: formattedPriceChange,
      isPriceUp,
      trades24h,
    }),
    [fundingRateFormatted, fundingCountdown, formattedOpenInterest, formattedVolume24h, formattedHigh24h, formattedLow24h, formattedPrice, formattedPriceChange, isPriceUp, trades24h]
  );

  return (
    <div
      className={`flex flex-col bg-okx-bg-primary min-h-screen text-okx-text-primary ${className}`}
    >
      {/* Perpetual Not Enabled Warning */}
      {!isPoolLoading && tokenAddress && !isPerpEnabled && (
        <div className="bg-yellow-900/30 border-b border-yellow-500/50 px-4 py-2">
          <div className="flex items-center gap-2 text-yellow-400 text-sm">
            <svg className="w-5 h-5 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
            </svg>
            <span>{t("perpNotEnabled")}</span>
          </div>
        </div>
      )}

      {/* Top Bar - Symbol Info */}
      <div className="h-14 bg-okx-bg-secondary border-b border-okx-border-primary flex items-center px-4 gap-6">
        {/* Symbol */}
        <div className="flex items-center gap-2">
          <span className="text-[18px] font-bold text-okx-text-primary">
            {displaySymbol.toUpperCase()}-PERP
          </span>
          <span className={`text-[12px] px-2 py-0.5 rounded ${isPerpEnabled ? 'text-okx-up bg-okx-up/10' : 'text-yellow-400 bg-yellow-900/30'}`}>
            {isPerpEnabled ? 'Perpetual' : t("perpNotEnabled")}
          </span>
        </div>

        {/* Market Stats */}
        <div className="flex items-center gap-6 text-[12px]">
          {/* 当前价格和涨跌幅 */}
          <div className="flex items-center gap-2">
            <span className={`text-[16px] font-bold ${marketInfo.isPriceUp ? "text-okx-up" : "text-okx-down"}`}>
              {marketInfo.currentPrice}
            </span>
            <span className={`text-[12px] ${marketInfo.isPriceUp ? "text-okx-up" : "text-okx-down"}`}>
              {marketInfo.isPriceUp ? "+" : ""}{marketInfo.priceChange}
            </span>
          </div>
          <div className="h-4 w-px bg-okx-border-primary" />
          <div>
            <span className="text-okx-text-tertiary mr-2">
              {t("fundingRate")}
            </span>
            <span className={isFundingPositive ? "text-okx-up" : "text-okx-down"}>{marketInfo.fundingRate}</span>
            <span className="text-okx-text-tertiary ml-1">/ {marketInfo.nextFunding}</span>
          </div>
          <div>
            <span className="text-okx-text-tertiary mr-2">
              {t("openInterest")}
            </span>
            <span className="text-okx-text-primary">
              {marketInfo.openInterest}
            </span>
          </div>
          <div>
            <span className="text-okx-text-tertiary mr-2">
              {t("volume24h")}
            </span>
            <span className="text-okx-text-primary">
              {marketInfo.volume24h}
            </span>
          </div>
          <div>
            <span className="text-okx-text-tertiary mr-2">{t("high24h")}</span>
            <span className="text-okx-up">{marketInfo.high24h}</span>
          </div>
          <div>
            <span className="text-okx-text-tertiary mr-2">{t("low24h")}</span>
            <span className="text-okx-down">{marketInfo.low24h}</span>
          </div>
          <div>
            <span className="text-okx-text-tertiary mr-2">24h Trades</span>
            <span className="text-okx-text-primary">{marketInfo.trades24h}</span>
          </div>
        </div>

        {/* Account Balance & Risk Indicator */}
        <div className="ml-auto flex items-center gap-3">
          {/* Risk Alert Badge */}
          {riskAlerts.length > 0 && (
            <div className="relative">
              <button
                onClick={() => setActiveBottomTab("risk")}
                className="p-2 rounded-lg bg-red-900/30 text-red-400 hover:bg-red-900/50 transition-colors"
                title={`${riskAlerts.length} risk alerts`}
              >
                <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                  <path d="M10 2a6 6 0 00-6 6v3.586l-.707.707A1 1 0 004 14h12a1 1 0 00.707-1.707L16 11.586V8a6 6 0 00-6-6zM10 18a3 3 0 01-3-3h6a3 3 0 01-3 3z" />
                </svg>
              </button>
              <span className="absolute -top-1 -right-1 bg-red-500 text-white text-[10px] rounded-full w-4 h-4 flex items-center justify-center animate-pulse">
                {riskAlerts.length > 9 ? "9+" : riskAlerts.length}
              </span>
            </div>
          )}

          {/* Risk Level Indicator */}
          {positionRisks.length > 0 && (
            <div className={`px-2 py-1 rounded text-[10px] font-medium ${
              overallRisk === "critical" ? "bg-red-900/50 text-red-400 animate-pulse" :
              overallRisk === "high" ? "bg-orange-900/50 text-orange-400" :
              overallRisk === "medium" ? "bg-yellow-900/50 text-yellow-400" :
              "bg-green-900/50 text-green-400"
            }`}>
              Risk: {overallRisk.toUpperCase()}
            </div>
          )}

          {/* Insurance Fund Mini Display */}
          {insuranceFund && (
            <div className="flex items-center gap-1 text-xs text-okx-text-tertiary">
              <svg className="w-3 h-3 text-green-400" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M2.166 4.999A11.954 11.954 0 0010 1.944 11.954 11.954 0 0017.834 5c.11.65.166 1.32.166 2.001 0 5.225-3.34 9.67-8 11.317C5.34 16.67 2 12.225 2 7c0-.682.057-1.35.166-2.001zm11.541 3.708a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
              </svg>
              <span className="text-green-400 font-medium">
                {insuranceFund.display?.balance || "$0"}
              </span>
              <span>IF</span>
            </div>
          )}

          {/* Account Balance Button */}
          <button
            onClick={() => setShowAccountPanel(true)}
            className="flex items-center gap-2 px-4 py-2 bg-okx-brand/10 hover:bg-okx-brand/20 border border-okx-brand/30 rounded-lg transition-colors"
          >
            <svg className="w-4 h-4 text-okx-brand" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z" />
            </svg>
            <span className="text-okx-brand font-medium">{formattedAccountBalance}</span>
          </button>
        </div>
      </div>

      {/* Main Content - 三列布局 */}
      <div className="flex flex-1 overflow-hidden">
        {/* Left: Order Book - 使用新的 OrderBook 组件 */}
        <div className="w-[240px] border-r border-okx-border-primary">
          <OrderBook
            data={wsOrderBook ? { ...wsOrderBook, recentTrades: wsRecentTrades } : undefined}
            onPriceClick={(price) => {
              // 点击价格可以填入下单面板
              console.log("Price clicked:", price);
            }}
            maxRows={10}
          />
        </div>

        {/* Center: Chart + Bottom Panel */}
        <div className="flex-1 border-r border-okx-border-primary flex flex-col overflow-hidden">
          {/* Chart Area - 使用撮合引擎 K 线数据 */}
          <div className="h-[400px] bg-[#131722]">
            <PerpetualPriceChart
              tokenAddress={tokenAddress || "0x01c6058175eda34fc8922eeae32bc383cb203211"}
              displaySymbol={displaySymbol}
            />
          </div>

          {/* Bottom Panel - Positions, Orders, History */}
          <div className="h-[400px] border-t border-okx-border-primary flex flex-col bg-okx-bg-primary">
            {/* Tabs */}
            <div className="flex border-b border-okx-border-primary px-4">
              {[
                { key: "positions", label: t("positions") },
                { key: "openOrders", label: t("openOrders") },
                { key: "orderHistory", label: t("orderHistory") },
                { key: "tradeHistory", label: t("tradeHistory") },
                { key: "hunting", label: "Hunting Arena" },
                { key: "risk", label: "Risk Control", badge: riskAlerts.length > 0 ? riskAlerts.length : undefined },
              ].map((tab) => (
                <button
                  key={tab.key}
                  onClick={() => setActiveBottomTab(tab.key as typeof activeBottomTab)}
                  className={`py-2 px-4 text-[12px] transition-colors relative flex items-center gap-1 ${
                    activeBottomTab === tab.key
                      ? "text-okx-text-primary font-bold"
                      : "text-okx-text-secondary"
                  }`}
                >
                  {tab.label}
                  {"badge" in tab && tab.badge && (
                    <span className="bg-red-500 text-white text-[10px] rounded-full px-1.5 min-w-[16px] h-4 flex items-center justify-center">
                      {tab.badge > 9 ? "9+" : tab.badge}
                    </span>
                  )}
                  {activeBottomTab === tab.key && (
                    <div className="absolute bottom-0 left-0 right-0 h-[2px] bg-[#A3E635]" />
                  )}
                </button>
              ))}
            </div>

            {/* Tab Content */}
            <div className="flex-1 overflow-y-auto">
              {/* Positions - 使用 WebSocket 实时推送数据 (行业标准 UI - 参考 OKX/Binance) */}
              {activeBottomTab === "positions" && (
                <div className="p-2 overflow-x-auto">
                  {!isConnected ? (
                    <div className="text-center text-okx-text-tertiary py-8">
                      {tc("connectWalletFirst")}
                    </div>
                  ) : currentPositionsForDisplay.length === 0 ? (
                    <div className="text-center text-okx-text-tertiary py-8">
                      {t("noPosition")}
                    </div>
                  ) : (
                    <table className="w-full text-[11px] min-w-[1000px]">
                      <thead>
                        <tr className="text-okx-text-tertiary border-b border-okx-border-primary">
                          <th className="text-left py-2 px-2">交易对</th>
                          <th className="text-center py-2 px-1">方向</th>
                          <th className="text-right py-2 px-1">杠杆</th>
                          <th className="text-right py-2 px-1">仓位大小</th>
                          <th className="text-right py-2 px-1">开仓均价</th>
                          <th className="text-right py-2 px-1">标记价格</th>
                          <th className="text-right py-2 px-1">强平价格</th>
                          <th className="text-right py-2 px-1">保证金</th>
                          <th className="text-right py-2 px-1">保证金率</th>
                          <th className="text-right py-2 px-1">未实现盈亏</th>
                          <th className="text-right py-2 px-1">ROE%</th>
                          <th className="text-center py-2 px-1">止盈/止损</th>
                          <th className="text-right py-2 px-2">操作</th>
                        </tr>
                      </thead>
                      <tbody>
                        {currentPositionsForDisplay.map((pos: any) => {
                          // ============================================================
                          // 直接使用后端推送的数据，不再前端计算！
                          // 后端精度: size=1e18, price=1e12, USD=1e6, ratio/roe=基点
                          // ============================================================
                          const size = parseFloat(pos.size) / 1e18;  // 代币数量
                          const entryPrice = parseFloat(pos.entryPrice) / 1e12;  // 1e12 精度
                          const markPrice = parseFloat(pos.markPrice || pos.entryPrice) / 1e12;  // 后端推送的标记价
                          const liqPrice = parseFloat(pos.liquidationPrice || "0") / 1e12;  // 后端推送的强平价
                          const margin = parseFloat(pos.collateral) / 1e6;  // 保证金 (USD)
                          const leverage = parseFloat(pos.leverage);  // 人类可读
                          const unrealizedPnl = parseFloat(pos.unrealizedPnL) / 1e6;  // 后端推送的盈亏 (USD)
                          const marginRatio = parseFloat(pos.marginRatio || "0") / 100;  // 基点转百分比
                          const roe = parseFloat(pos.roe || "0") / 100;  // 基点转百分比
                          const mmr = parseFloat(pos.mmr || "200") / 100;  // 基点转百分比
                          const positionValue = size * markPrice;

                          // 风险等级颜色 (使用后端计算的 riskLevel)
                          const riskLevel = pos.riskLevel || "low";
                          const riskColor = riskLevel === "critical" ? "text-red-500 animate-pulse" :
                                           riskLevel === "high" ? "text-red-400" :
                                           riskLevel === "medium" ? "text-yellow-400" : "text-green-400";

                          return (
                            <tr key={pos.pairId} className="border-b border-okx-border-primary hover:bg-okx-bg-hover">
                              {/* 交易对 */}
                              <td className="py-3 px-2">
                                <div className="flex items-center gap-2">
                                  <span className="font-medium text-okx-text-primary">{instId}</span>
                                  <span className="text-[9px] text-purple-400 bg-purple-900/30 px-1.5 py-0.5 rounded">
                                    #{pos.pairId?.slice(0, 8) || "?"}
                                  </span>
                                </div>
                              </td>

                              {/* 方向 */}
                              <td className="py-3 px-1 text-center">
                                <span className={`px-2 py-1 rounded text-[10px] font-bold ${
                                  pos.isLong
                                    ? "bg-green-900/50 text-green-400"
                                    : "bg-red-900/50 text-red-400"
                                }`}>
                                  {pos.isLong ? "多" : "空"}
                                </span>
                              </td>

                              {/* 杠杆 */}
                              <td className="py-3 px-1 text-right">
                                <span className="text-yellow-400 font-medium">{leverage}x</span>
                              </td>

                              {/* 仓位大小 - 智能格式化 */}
                              <td className="py-3 px-1 text-right">
                                <div className="text-okx-text-primary font-medium">
                                  {size >= 1000000000 ? `${(size/1000000000).toFixed(2)}B` :
                                   size >= 1000000 ? `${(size/1000000).toFixed(2)}M` :
                                   size >= 1000 ? `${(size/1000).toFixed(2)}K` : size.toFixed(2)}
                                </div>
                                <div className="text-[9px] text-okx-text-tertiary">
                                  ${positionValue >= 1000 ? positionValue.toLocaleString('en-US', {maximumFractionDigits: 2}) : positionValue.toFixed(2)}
                                </div>
                              </td>

                              {/* 开仓均价 - 智能格式化小数位 */}
                              <td className="py-3 px-1 text-right font-mono text-okx-text-primary">
                                ${entryPrice < 0.000001 ? entryPrice.toFixed(12) :
                                  entryPrice < 0.0001 ? entryPrice.toFixed(10) :
                                  entryPrice < 0.01 ? entryPrice.toFixed(8) :
                                  entryPrice < 1 ? entryPrice.toFixed(6) : entryPrice.toFixed(4)}
                              </td>

                              {/* 标记价格 - 后端实时推送 */}
                              <td className="py-3 px-1 text-right font-mono text-okx-text-secondary">
                                ${markPrice < 0.000001 ? markPrice.toFixed(12) :
                                  markPrice < 0.0001 ? markPrice.toFixed(10) :
                                  markPrice < 0.01 ? markPrice.toFixed(8) :
                                  markPrice < 1 ? markPrice.toFixed(6) : markPrice.toFixed(4)}
                              </td>

                              {/* 强平价格 - 后端实时推送 */}
                              <td className={`py-3 px-1 text-right font-mono ${pos.isLong ? "text-red-400" : "text-green-400"}`}>
                                ${liqPrice < 0.000001 ? liqPrice.toFixed(12) :
                                  liqPrice < 0.0001 ? liqPrice.toFixed(10) :
                                  liqPrice < 0.01 ? liqPrice.toFixed(8) :
                                  liqPrice < 1 ? liqPrice.toFixed(6) : liqPrice.toFixed(4)}
                              </td>

                              {/* 保证金 */}
                              <td className="py-3 px-1 text-right">
                                <span className="text-okx-text-primary">${margin.toFixed(2)}</span>
                                <div className="text-[9px] text-okx-text-tertiary">MMR: {mmr.toFixed(2)}%</div>
                              </td>

                              {/* 保证金率 - 后端实时推送 */}
                              <td className={`py-3 px-1 text-right font-medium ${riskColor}`}>
                                {marginRatio.toFixed(2)}%
                              </td>

                              {/* 未实现盈亏 - 后端实时推送 */}
                              <td className={`py-3 px-1 text-right font-bold ${unrealizedPnl >= 0 ? "text-green-400" : "text-red-400"}`}>
                                {unrealizedPnl >= 0 ? "+" : ""}${Math.abs(unrealizedPnl).toFixed(2)}
                              </td>

                              {/* ROE% - 后端实时推送 */}
                              <td className={`py-3 px-1 text-right font-bold ${roe >= 0 ? "text-green-400" : "text-red-400"}`}>
                                {roe >= 0 ? "+" : ""}{roe.toFixed(2)}%
                              </td>

                              {/* 止盈/止损 */}
                              <td className="py-3 px-1 text-center">
                                <button className="text-[10px] text-okx-text-tertiary hover:text-okx-brand-primary">
                                  设置
                                </button>
                              </td>

                              {/* 操作 */}
                              <td className="py-3 px-2 text-right">
                                <div className="flex items-center justify-end gap-2">
                                  <button
                                    onClick={async () => {
                                      showToast(t("closingPosition") || "Closing position...", "info");
                                      const result = await closePair(pos.pairId);
                                      if (result.success) {
                                        showToast("Position closed!", "success");
                                        refreshPositions();
                                      } else {
                                        showToast(result.error || "Failed to close", "error");
                                      }
                                    }}
                                    className="px-2 py-1 bg-red-900/50 text-red-400 text-[10px] font-medium rounded hover:bg-red-800"
                                  >
                                    平仓
                                  </button>
                                  <button className="px-2 py-1 bg-okx-bg-tertiary text-okx-text-secondary text-[10px] rounded hover:bg-okx-bg-hover">
                                    调整
                                  </button>
                                </div>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  )}
                </div>
              )}

              {/* Open Orders Table - V2 待处理订单 (行业标准 UI) */}
              {activeBottomTab === "openOrders" && (
                <div className="p-4 overflow-x-auto">
                  {!isConnected ? (
                    <div className="text-center text-okx-text-tertiary py-8">
                      {tc("connectWalletFirst")}
                    </div>
                  ) : v2PendingOrders.length === 0 ? (
                    <div className="text-center text-okx-text-tertiary py-8">
                      {t("noOrders")}
                    </div>
                  ) : (
                    <table className="w-full text-[11px] min-w-[900px]">
                      <thead>
                        <tr className="text-okx-text-tertiary border-b border-okx-border-primary">
                          <th className="text-left py-2 px-1">时间</th>
                          <th className="text-left py-2 px-1">交易对</th>
                          <th className="text-left py-2 px-1">类型</th>
                          <th className="text-left py-2 px-1">方向</th>
                          <th className="text-right py-2 px-1">杠杆</th>
                          <th className="text-right py-2 px-1">委托价</th>
                          <th className="text-right py-2 px-1">委托量</th>
                          <th className="text-right py-2 px-1">成交均价</th>
                          <th className="text-right py-2 px-1">已成交/总量</th>
                          <th className="text-right py-2 px-1">保证金</th>
                          <th className="text-right py-2 px-1">手续费</th>
                          <th className="text-center py-2 px-1">状态</th>
                          <th className="text-right py-2 px-1">操作</th>
                        </tr>
                      </thead>
                      <tbody>
                        {v2PendingOrders.map((order) => {
                          // 格式化显示数据
                          // size 是 Meme 代币数量 (1e18 精度)
                          const sizeTokenRaw = Number(order.size) / 1e18;
                          const sizeDisplay = sizeTokenRaw >= 1000000
                            ? `${(sizeTokenRaw / 1000000).toFixed(2)}M`
                            : sizeTokenRaw >= 1000
                            ? `${(sizeTokenRaw / 1000).toFixed(2)}K`
                            : sizeTokenRaw.toFixed(2);
                          const filledTokenRaw = Number(order.filledSize) / 1e18;
                          const filledDisplay = filledTokenRaw >= 1000000
                            ? `${(filledTokenRaw / 1000000).toFixed(2)}M`
                            : filledTokenRaw >= 1000
                            ? `${(filledTokenRaw / 1000).toFixed(2)}K`
                            : filledTokenRaw.toFixed(2);
                          // price 是 1e12 精度
                          const priceDisplay = order.price === "0" ? "市价" : `$${(Number(order.price) / 1e12).toFixed(10)}`;
                          const avgPriceDisplay = order.avgFillPrice && order.avgFillPrice !== "0"
                            ? `$${(Number(order.avgFillPrice) / 1e12).toFixed(10)}`
                            : "--";
                          const leverageDisplay = order.leverage ? `${Number(order.leverage) / 10000}x` : "--";
                          // margin 是 USD 值 (1e6 精度)
                          const marginUSD = order.margin ? Number(order.margin) / 1e6 : 0;
                          const marginDisplay = order.margin
                            ? `$${marginUSD.toFixed(2)}`
                            : "--";
                          const feeDisplay = order.fee && order.fee !== "0"
                            ? `$${(Number(order.fee) / 1e6).toFixed(4)}`
                            : "--";
                          const orderTypeDisplay = order.orderType === "MARKET" ? "市价" : "限价";
                          const fillPercent = Number(order.size) > 0
                            ? ((Number(order.filledSize) / Number(order.size)) * 100).toFixed(1)
                            : "0";
                          const timeDisplay = new Date(order.createdAt).toLocaleTimeString("zh-CN", {
                            hour: "2-digit",
                            minute: "2-digit",
                            second: "2-digit",
                          });

                          return (
                            <tr key={order.id} className="border-b border-okx-border-primary hover:bg-okx-bg-hover">
                              {/* 时间 */}
                              <td className="py-2 px-1 text-okx-text-secondary">{timeDisplay}</td>

                              {/* 交易对 */}
                              <td className="py-2 px-1 font-medium">
                                {instId}
                              </td>

                              {/* 订单类型 */}
                              <td className="py-2 px-1">
                                <span className="bg-okx-bg-secondary px-1.5 py-0.5 rounded text-[10px]">
                                  {orderTypeDisplay}
                                </span>
                              </td>

                              {/* 方向 */}
                              <td className={`py-2 px-1 font-medium ${order.isLong ? "text-okx-up" : "text-okx-down"}`}>
                                {order.isLong ? "多" : "空"}
                              </td>

                              {/* 杠杆 */}
                              <td className="py-2 px-1 text-right text-yellow-400">{leverageDisplay}</td>

                              {/* 委托价 */}
                              <td className="py-2 px-1 text-right font-mono">{priceDisplay}</td>

                              {/* 委托量 (代币数量) */}
                              <td className="py-2 px-1 text-right">{sizeDisplay}</td>

                              {/* 成交均价 */}
                              <td className="py-2 px-1 text-right font-mono">{avgPriceDisplay}</td>

                              {/* 已成交/总量 + 进度 */}
                              <td className="py-2 px-1 text-right">
                                <div className="flex flex-col items-end">
                                  <span>{filledDisplay}/{sizeDisplay}</span>
                                  <span className="text-[9px] text-okx-text-tertiary">{fillPercent}%</span>
                                </div>
                              </td>

                              {/* 保证金 */}
                              <td className="py-2 px-1 text-right">{marginDisplay}</td>

                              {/* 手续费 */}
                              <td className="py-2 px-1 text-right text-okx-text-secondary">{feeDisplay}</td>

                              {/* 状态 */}
                              <td className="py-2 px-1 text-center">
                                <span className={`px-2 py-0.5 rounded text-[10px] ${
                                  order.status === "PARTIALLY_FILLED"
                                    ? "text-blue-400 bg-blue-900/30"
                                    : "text-yellow-400 bg-yellow-900/30"
                                }`}>
                                  {order.status === "PARTIALLY_FILLED" ? "部分成交" : "等待中"}
                                </span>
                              </td>

                              {/* 操作 */}
                              <td className="py-2 px-1 text-right">
                                <button
                                  className={`text-[11px] ${
                                    cancellingOrderId === order.id
                                      ? "text-okx-text-tertiary cursor-not-allowed"
                                      : "text-okx-down hover:underline"
                                  }`}
                                  disabled={cancellingOrderId === order.id}
                                  onClick={() => handleCancelOrder(order.id)}
                                >
                                  {cancellingOrderId === order.id ? "撤销中..." : "撤单"}
                                </button>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  )}
                </div>
              )}

              {/* Order History */}
              {activeBottomTab === "orderHistory" && (
                <div className="p-4">
                  {!isConnected ? (
                    <div className="text-center text-okx-text-tertiary py-8">
                      {tc("connectWalletFirst")}
                    </div>
                  ) : filteredOrderHistory.length === 0 ? (
                    <div className="text-center text-okx-text-tertiary py-8">
                      {t("noOrders")}
                    </div>
                  ) : (
                    <table className="w-full text-[12px]">
                      <thead>
                        <tr className="text-okx-text-tertiary border-b border-okx-border-primary">
                          <th className="text-left py-2">Symbol</th>
                          <th className="text-left py-2">Type</th>
                          <th className="text-left py-2">{t("side")}</th>
                          <th className="text-left py-2">{t("price")}</th>
                          <th className="text-left py-2">{t("filled")}</th>
                          <th className="text-left py-2">Status</th>
                          <th className="text-left py-2">Time</th>
                        </tr>
                      </thead>
                      <tbody>
                        {filteredOrderHistory.map((order) => {
                          const isLong = order.side === "open_long" || order.side === "close_short";
                          return (
                            <tr key={order.orderId} className="border-b border-okx-border-primary">
                              <td className="py-2">{order.instId}</td>
                              <td className="py-2 capitalize">{order.orderType.replace("_", " ")}</td>
                              <td className={`py-2 ${isLong ? "text-okx-up" : "text-okx-down"}`}>
                                {order.side.replace("_", " ").replace(/\b\w/g, c => c.toUpperCase())}
                              </td>
                              <td className="py-2">${order.avgFillPrice || order.price}</td>
                              <td className="py-2">{order.filled}/{order.size}</td>
                              <td className="py-2 capitalize">{order.status.replace("_", " ")}</td>
                              <td className="py-2 text-okx-text-tertiary">
                                {new Date(order.createdAt).toLocaleString()}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  )}
                </div>
              )}

              {/* Trade History */}
              {activeBottomTab === "tradeHistory" && (
                <div className="p-4">
                  {!isConnected ? (
                    <div className="text-center text-okx-text-tertiary py-8">
                      {tc("connectWalletFirst")}
                    </div>
                  ) : filteredTrades.length === 0 ? (
                    <div className="text-center text-okx-text-tertiary py-8">
                      {t("noOrders")}
                    </div>
                  ) : (
                    <table className="w-full text-[12px]">
                      <thead>
                        <tr className="text-okx-text-tertiary border-b border-okx-border-primary">
                          <th className="text-left py-2">Symbol</th>
                          <th className="text-left py-2">{t("side")}</th>
                          <th className="text-left py-2">{t("price")}</th>
                          <th className="text-left py-2">{t("size")}</th>
                          <th className="text-left py-2">{t("fee")}</th>
                          <th className="text-left py-2">{t("pnl")}</th>
                          <th className="text-left py-2">Time</th>
                        </tr>
                      </thead>
                      <tbody>
                        {filteredTrades.map((trade) => {
                          const isLong = trade.side === "open_long" || trade.side === "close_short";
                          return (
                            <tr key={trade.tradeId} className="border-b border-okx-border-primary">
                              <td className="py-2">{trade.instId}</td>
                              <td className={`py-2 ${isLong ? "text-okx-up" : "text-okx-down"}`}>
                                {trade.side.replace("_", " ").replace(/\b\w/g, c => c.toUpperCase())}
                              </td>
                              <td className="py-2">${trade.price}</td>
                              <td className="py-2">{trade.size}</td>
                              <td className="py-2">{trade.fee} {trade.feeCcy}</td>
                              <td className={`py-2 ${trade.realizedPnl && parseFloat(trade.realizedPnl) >= 0 ? "text-okx-up" : "text-okx-down"}`}>
                                {trade.realizedPnl ? `${parseFloat(trade.realizedPnl) >= 0 ? "+" : ""}${trade.realizedPnl}` : "-"}
                              </td>
                              <td className="py-2 text-okx-text-tertiary">
                                {new Date(trade.timestamp).toLocaleString()}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  )}
                </div>
              )}

              {/* Hunting Arena - 猎杀场 */}
              {activeBottomTab === "hunting" && (
                <div className="p-4 h-full overflow-y-auto">
                  <div className="grid grid-cols-3 gap-4 h-full">
                    {/* 清算地图 */}
                    <div className="col-span-1">
                      <LiquidationMap token={symbol} />
                    </div>
                    {/* 全局持仓 */}
                    <div className="col-span-1">
                      <AllPositions token={symbol} />
                    </div>
                    {/* 猎杀排行榜 */}
                    <div className="col-span-1">
                      <HunterLeaderboard token={symbol} />
                    </div>
                  </div>
                </div>
              )}

              {/* Risk Control Panel - 风险控制 */}
              {activeBottomTab === "risk" && (
                <div className="p-4 h-full overflow-y-auto">
                  <RiskPanel
                    trader={tradingWalletAddress || address}
                    token={tokenAddress}
                  />
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Right: Order Panel (固定宽度) */}
        <div className="w-[320px] bg-okx-bg-primary overflow-y-auto">
          {/* V2: 使用 Settlement 合约 + 撮合引擎 */}
          <PerpetualOrderPanelV2
            symbol={symbol}
            displaySymbol={displaySymbol}
            tokenAddress={symbol.startsWith("0x") ? symbol as Address : undefined}
            isPerpEnabled={isPerpEnabled}
          />
        </div>
      </div>

      {/* Account Balance Modal */}
      {showAccountPanel && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          {/* Backdrop */}
          <div
            className="absolute inset-0 bg-black/60"
            onClick={() => setShowAccountPanel(false)}
          />
          {/* Modal */}
          <div className="relative z-10 w-full max-w-md mx-4">
            <AccountBalance onClose={() => setShowAccountPanel(false)} />
          </div>
        </div>
      )}
    </div>
  );
}
