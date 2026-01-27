"use client";

import React, { useState, useMemo } from "react";
import { useAccount } from "wagmi";
import { formatEther, parseEther } from "viem";
import { usePerpetual } from "@/hooks/usePerpetual";
import { useConnectModal } from "@rainbow-me/rainbowkit";

interface PerpTradingPanelProps {
  className?: string;
}

/**
 * 永续合约交易面板组件
 */
export function PerpTradingPanel({ className = "" }: PerpTradingPanelProps) {
  const { address, isConnected } = useAccount();
  const { openConnectModal } = useConnectModal();

  const {
    position,
    hasPosition,
    unrealizedPnL,
    marginRatio,
    liquidationPrice,
    vaultBalance,
    availableBalance,
    walletBalance,
    markPrice,
    openFeeRate,
    openLong,
    openShort,
    closePosition,
    closePositionPartial,
    deposit,
    withdraw,
    isPending,
    isConfirming,
    error,
  } = usePerpetual();

  // UI 状态
  const [side, setSide] = useState<"long" | "short">("long");
  const [orderType, setOrderType] = useState<"market" | "limit">("market");
  const [leverage, setLeverage] = useState(10);
  const [amount, setAmount] = useState("");
  const [price, setPrice] = useState("");
  const [showDepositModal, setShowDepositModal] = useState(false);
  const [depositAmount, setDepositAmount] = useState("");

  // 格式化价格
  const formatPrice = (p: bigint | null) => {
    if (!p) return "--";
    const num = parseFloat(formatEther(p));
    if (num === 0) return "0";
    if (num < 0.0001) return num.toExponential(4);
    if (num < 1) return num.toFixed(6);
    return num.toFixed(4);
  };

  // 计算保证金
  const margin = useMemo(() => {
    if (!amount || isNaN(parseFloat(amount))) return "0";
    const size = parseFloat(amount);
    return (size / leverage).toFixed(6);
  }, [amount, leverage]);

  // 计算开仓费
  const openFee = useMemo(() => {
    if (!amount || !openFeeRate) return "0";
    const size = parseFloat(amount);
    const feeRate = Number(openFeeRate) / 10000;
    return (size * feeRate).toFixed(6);
  }, [amount, openFeeRate]);

  // 处理开仓
  const handleOpenPosition = async () => {
    if (!amount) return;
    try {
      if (side === "long") {
        await openLong(amount, leverage);
      } else {
        await openShort(amount, leverage);
      }
      setAmount("");
    } catch (err) {
      console.error("Failed to open position:", err);
    }
  };

  // 处理平仓
  const handleClosePosition = async () => {
    try {
      await closePosition();
    } catch (err) {
      console.error("Failed to close position:", err);
    }
  };

  // 处理存款
  const handleDeposit = async () => {
    if (!depositAmount) return;
    try {
      await deposit(depositAmount);
      setDepositAmount("");
      setShowDepositModal(false);
    } catch (err) {
      console.error("Failed to deposit:", err);
    }
  };

  const isProcessing = isPending || isConfirming;

  return (
    <div className={`bg-okx-bg-card border border-okx-border-primary rounded-xl overflow-hidden ${className}`}>
      {/* 做多/做空切换 */}
      <div className="flex border-b border-okx-border-primary">
        <button
          onClick={() => setSide("long")}
          className={`flex-1 py-3 text-sm font-bold transition-colors ${
            side === "long" ? "bg-okx-up text-black" : "text-okx-text-secondary hover:text-okx-text-primary"
          }`}
        >
          做多
        </button>
        <button
          onClick={() => setSide("short")}
          className={`flex-1 py-3 text-sm font-bold transition-colors ${
            side === "short" ? "bg-okx-down text-white" : "text-okx-text-secondary hover:text-okx-text-primary"
          }`}
        >
          做空
        </button>
      </div>

      <div className="p-4 space-y-4">
        {/* 账户余额 */}
        <div className="bg-okx-bg-hover rounded-lg p-3 space-y-2">
          <div className="flex justify-between text-sm">
            <span className="text-okx-text-tertiary">钱包余额</span>
            <span>{walletBalance ? parseFloat(formatEther(walletBalance)).toFixed(4) : "0"} ETH</span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-okx-text-tertiary">合约账户</span>
            <span>{vaultBalance ? parseFloat(formatEther(vaultBalance)).toFixed(4) : "0"} ETH</span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-okx-text-tertiary">可用余额</span>
            <span className="text-okx-up">
              {availableBalance ? parseFloat(formatEther(availableBalance)).toFixed(4) : "0"} ETH
            </span>
          </div>
          <button
            onClick={() => setShowDepositModal(true)}
            className="w-full py-2 mt-2 text-sm bg-okx-bg-primary border border-okx-border-primary rounded-lg hover:border-okx-up transition-colors"
          >
            存入/提取
          </button>
        </div>

        {/* 订单类型 */}
        <div className="flex gap-2">
          <button
            onClick={() => setOrderType("market")}
            className={`flex-1 py-2 text-sm rounded-lg border transition-colors ${
              orderType === "market"
                ? "border-okx-up text-okx-up"
                : "border-okx-border-primary text-okx-text-secondary"
            }`}
          >
            市价
          </button>
          <button
            onClick={() => setOrderType("limit")}
            className={`flex-1 py-2 text-sm rounded-lg border transition-colors ${
              orderType === "limit"
                ? "border-okx-up text-okx-up"
                : "border-okx-border-primary text-okx-text-secondary"
            }`}
          >
            限价
          </button>
        </div>

        {/* 杠杆选择 */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <span className="text-okx-text-secondary text-sm">杠杆</span>
            <span className="text-okx-text-primary font-bold">{leverage}x</span>
          </div>
          <input
            type="range"
            min="1"
            max="100"
            value={leverage}
            onChange={(e) => setLeverage(parseInt(e.target.value))}
            className="w-full accent-okx-up"
          />
          <div className="flex justify-between text-xs text-okx-text-tertiary mt-1">
            <span>1x</span>
            <span>25x</span>
            <span>50x</span>
            <span>75x</span>
            <span>100x</span>
          </div>
        </div>

        {/* 限价输入 */}
        {orderType === "limit" && (
          <div>
            <label className="block text-okx-text-secondary text-sm mb-2">价格</label>
            <input
              type="number"
              value={price}
              onChange={(e) => setPrice(e.target.value)}
              placeholder={formatPrice(markPrice)}
              className="w-full bg-okx-bg-primary border border-okx-border-primary rounded-lg px-4 py-3 text-okx-text-primary focus:outline-none focus:border-okx-up"
            />
          </div>
        )}

        {/* 数量输入 */}
        <div>
          <label className="block text-okx-text-secondary text-sm mb-2">仓位大小 (ETH)</label>
          <input
            type="number"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="0.00"
            className="w-full bg-okx-bg-primary border border-okx-border-primary rounded-lg px-4 py-3 text-okx-text-primary focus:outline-none focus:border-okx-up"
          />
        </div>

        {/* 快捷金额 */}
        <div className="flex gap-2">
          {["25%", "50%", "75%", "100%"].map((pct) => (
            <button
              key={pct}
              onClick={() => {
                if (availableBalance) {
                  const percent = parseInt(pct) / 100;
                  const available = parseFloat(formatEther(availableBalance));
                  const maxSize = available * leverage * percent;
                  setAmount(maxSize.toFixed(4));
                }
              }}
              className="flex-1 py-1.5 text-xs bg-okx-bg-hover border border-okx-border-primary rounded hover:border-okx-up transition-colors"
            >
              {pct}
            </button>
          ))}
        </div>

        {/* 订单信息 */}
        <div className="bg-okx-bg-hover rounded-lg p-3 text-sm space-y-2">
          <div className="flex justify-between">
            <span className="text-okx-text-tertiary">保证金</span>
            <span>{margin} ETH</span>
          </div>
          <div className="flex justify-between">
            <span className="text-okx-text-tertiary">开仓费</span>
            <span>{openFee} ETH</span>
          </div>
          <div className="flex justify-between">
            <span className="text-okx-text-tertiary">标记价格</span>
            <span>{formatPrice(markPrice)} ETH</span>
          </div>
        </div>

        {/* 下单按钮 */}
        {!isConnected ? (
          <button
            onClick={openConnectModal}
            className="w-full py-4 rounded-lg font-bold text-lg bg-okx-up text-black hover:opacity-90 transition-opacity"
          >
            连接钱包
          </button>
        ) : hasPosition ? (
          <div className="space-y-2">
            <div className="bg-okx-bg-hover rounded-lg p-3 text-sm">
              <div className="flex items-center justify-between mb-2">
                <span className="font-bold">{position?.isLong ? "多头" : "空头"} 仓位</span>
                <span className={position?.isLong ? "text-okx-up" : "text-okx-down"}>
                  {position ? parseFloat(formatEther(position.size)).toFixed(4) : "0"} ETH
                </span>
              </div>
              <div className="flex justify-between text-okx-text-tertiary">
                <span>未实现盈亏</span>
                <span className={unrealizedPnL && unrealizedPnL > 0n ? "text-okx-up" : "text-okx-down"}>
                  {unrealizedPnL ? parseFloat(formatEther(unrealizedPnL)).toFixed(4) : "0"} ETH
                </span>
              </div>
              <div className="flex justify-between text-okx-text-tertiary">
                <span>强平价格</span>
                <span>{formatPrice(liquidationPrice)}</span>
              </div>
            </div>
            <button
              onClick={handleClosePosition}
              disabled={isProcessing}
              className="w-full py-3 rounded-lg font-bold bg-okx-down text-white hover:opacity-90 transition-opacity disabled:opacity-50"
            >
              {isProcessing ? "处理中..." : "平仓"}
            </button>
          </div>
        ) : (
          <button
            onClick={handleOpenPosition}
            disabled={isProcessing || !amount}
            className={`w-full py-4 rounded-lg font-bold text-lg transition-opacity hover:opacity-90 disabled:opacity-50 ${
              side === "long" ? "bg-okx-up text-black" : "bg-okx-down text-white"
            }`}
          >
            {isProcessing ? "处理中..." : side === "long" ? "开多" : "开空"}
          </button>
        )}

        {/* 错误提示 */}
        {error && <p className="text-okx-down text-sm text-center">{error.message}</p>}

        {/* 风险提示 */}
        <p className="text-okx-text-tertiary text-xs text-center">杠杆交易风险极高，请谨慎操作</p>
      </div>

      {/* 存款/提款模态框 */}
      {showDepositModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-okx-bg-card border border-okx-border-primary rounded-xl p-6 w-96">
            <h3 className="text-lg font-bold mb-4">存入保证金</h3>
            <div className="space-y-4">
              <div>
                <label className="block text-okx-text-secondary text-sm mb-2">金额 (ETH)</label>
                <input
                  type="number"
                  value={depositAmount}
                  onChange={(e) => setDepositAmount(e.target.value)}
                  placeholder="0.00"
                  className="w-full bg-okx-bg-primary border border-okx-border-primary rounded-lg px-4 py-3 text-okx-text-primary focus:outline-none focus:border-okx-up"
                />
                <p className="text-okx-text-tertiary text-xs mt-1">
                  钱包余额: {walletBalance ? parseFloat(formatEther(walletBalance)).toFixed(4) : "0"} ETH
                </p>
              </div>
              <div className="flex gap-2">
                <button
                  onClick={() => setShowDepositModal(false)}
                  className="flex-1 py-3 rounded-lg font-bold border border-okx-border-primary hover:border-okx-text-primary transition-colors"
                >
                  取消
                </button>
                <button
                  onClick={handleDeposit}
                  disabled={isProcessing || !depositAmount}
                  className="flex-1 py-3 rounded-lg font-bold bg-okx-up text-black hover:opacity-90 transition-opacity disabled:opacity-50"
                >
                  {isProcessing ? "处理中..." : "存入"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default PerpTradingPanel;
