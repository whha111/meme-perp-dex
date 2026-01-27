"use client";

import React, { useState } from "react";
import { useSpotSwap } from "@/hooks/useSpotSwap";
import { getExplorerUrl } from "@/lib/contracts";

interface SpotSwapPanelProps {
  className?: string;
}

/**
 * 现货交易面板组件
 */
export function SpotSwapPanel({ className = "" }: SpotSwapPanelProps) {
  const {
    isBuy,
    amountIn,
    slippage,
    quote,
    error,
    ethBalance,
    memeBalance,
    isActive,
    spotPrice,
    isSwapping,
    isSuccess,
    txHash,
    needsApproval,
    setAmountIn,
    setSlippage,
    toggleDirection,
    approve,
    executeSwap,
    resetState,
  } = useSpotSwap();

  const [showSlippageSettings, setShowSlippageSettings] = useState(false);

  // 快捷百分比按钮
  const handlePercentage = (percent: number) => {
    const balance = isBuy ? ethBalance : memeBalance;
    const value = (parseFloat(balance) * percent / 100).toFixed(6);
    setAmountIn(value);
  };

  // 格式化价格
  const formatPrice = (price: string) => {
    const num = parseFloat(price);
    if (num === 0) return "0";
    if (num < 0.000001) return num.toExponential(4);
    if (num < 1) return num.toFixed(8);
    return num.toFixed(4);
  };

  return (
    <div className={`bg-okx-bg-card border border-okx-border-primary rounded-xl p-4 ${className}`}>
      {/* 头部 */}
      <div className="flex items-center justify-between mb-4">
        <h3 className="font-bold">现货交易</h3>
        <button
          onClick={() => setShowSlippageSettings(!showSlippageSettings)}
          className="p-2 hover:bg-okx-bg-hover rounded-lg transition-colors"
          title="滑点设置"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
          </svg>
        </button>
      </div>

      {/* 滑点设置 */}
      {showSlippageSettings && (
        <div className="mb-4 p-3 bg-okx-bg-hover rounded-lg">
          <p className="text-sm text-okx-text-secondary mb-2">滑点容忍度</p>
          <div className="flex gap-2">
            {[0.1, 0.5, 1.0, 3.0].map((value) => (
              <button
                key={value}
                onClick={() => setSlippage(value)}
                className={`flex-1 py-1.5 text-xs rounded-lg border transition-colors ${
                  slippage === value
                    ? "border-okx-up text-okx-up bg-okx-up/10"
                    : "border-okx-border-primary text-okx-text-secondary hover:border-okx-text-tertiary"
                }`}
              >
                {value}%
              </button>
            ))}
          </div>
        </div>
      )}

      {/* AMM 状态 */}
      {!isActive && (
        <div className="mb-4 p-3 bg-yellow-500/10 border border-yellow-500/30 rounded-lg">
          <p className="text-yellow-500 text-sm">AMM 尚未激活，请等待内盘完成</p>
        </div>
      )}

      {/* 输入区域 - 支付 */}
      <div className="mb-2">
        <div className="flex items-center justify-between mb-2">
          <span className="text-okx-text-secondary text-sm">支付</span>
          <span className="text-okx-text-tertiary text-xs">
            余额: {isBuy ? parseFloat(ethBalance).toFixed(4) : parseFloat(memeBalance).toFixed(4)} {isBuy ? "ETH" : "MEME"}
          </span>
        </div>
        <div className="bg-okx-bg-hover rounded-lg p-3">
          <div className="flex items-center gap-3">
            <input
              type="number"
              value={amountIn}
              onChange={(e) => setAmountIn(e.target.value)}
              placeholder="0.00"
              className="flex-1 bg-transparent text-2xl font-medium focus:outline-none"
              disabled={!isActive}
            />
            <div className="flex items-center gap-2 px-3 py-2 bg-okx-bg-card rounded-lg">
              <div className="w-6 h-6 rounded-full bg-okx-up/20 flex items-center justify-center text-okx-up text-xs font-bold">
                {isBuy ? "E" : "M"}
              </div>
              <span className="font-medium">{isBuy ? "ETH" : "MEME"}</span>
            </div>
          </div>
          {/* 快捷百分比 */}
          <div className="flex gap-2 mt-2">
            {[25, 50, 75, 100].map((pct) => (
              <button
                key={pct}
                onClick={() => handlePercentage(pct)}
                className="flex-1 py-1 text-xs bg-okx-bg-card border border-okx-border-primary rounded hover:border-okx-up transition-colors"
                disabled={!isActive}
              >
                {pct}%
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* 切换按钮 */}
      <div className="flex justify-center -my-1 relative z-10">
        <button
          onClick={toggleDirection}
          className="p-2 bg-okx-bg-card border border-okx-border-primary rounded-full hover:border-okx-up transition-colors"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16V4m0 0L3 8m4-4l4 4m6 0v12m0 0l4-4m-4 4l-4-4" />
          </svg>
        </button>
      </div>

      {/* 输出区域 - 获得 */}
      <div className="mb-4">
        <div className="flex items-center justify-between mb-2">
          <span className="text-okx-text-secondary text-sm">获得</span>
          <span className="text-okx-text-tertiary text-xs">
            余额: {isBuy ? parseFloat(memeBalance).toFixed(4) : parseFloat(ethBalance).toFixed(4)} {isBuy ? "MEME" : "ETH"}
          </span>
        </div>
        <div className="bg-okx-bg-hover rounded-lg p-3">
          <div className="flex items-center gap-3">
            <div className="flex-1 text-2xl font-medium text-okx-text-primary">
              {quote ? parseFloat(quote.amountOut).toFixed(6) : "0.00"}
            </div>
            <div className="flex items-center gap-2 px-3 py-2 bg-okx-bg-card rounded-lg">
              <div className="w-6 h-6 rounded-full bg-okx-up/20 flex items-center justify-center text-okx-up text-xs font-bold">
                {isBuy ? "M" : "E"}
              </div>
              <span className="font-medium">{isBuy ? "MEME" : "ETH"}</span>
            </div>
          </div>
        </div>
      </div>

      {/* 交易信息 */}
      {quote && (
        <div className="bg-okx-bg-hover rounded-lg p-3 mb-4 text-sm space-y-2">
          <div className="flex justify-between">
            <span className="text-okx-text-tertiary">汇率</span>
            <span>
              1 {isBuy ? "ETH" : "MEME"} = {quote.rate} {isBuy ? "MEME" : "ETH"}
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-okx-text-tertiary">价格影响</span>
            <span className={quote.priceImpact > 3 ? "text-okx-down" : quote.priceImpact > 1 ? "text-yellow-500" : "text-okx-up"}>
              {quote.priceImpact.toFixed(2)}%
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-okx-text-tertiary">手续费</span>
            <span>{quote.fee} {isBuy ? "ETH" : "MEME"}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-okx-text-tertiary">最小获得</span>
            <span>{parseFloat(quote.minAmountOut).toFixed(6)} {isBuy ? "MEME" : "ETH"}</span>
          </div>
        </div>
      )}

      {/* 当前价格 */}
      <div className="text-center text-xs text-okx-text-tertiary mb-4">
        当前价格: 1 MEME = {formatPrice(spotPrice)} ETH
      </div>

      {/* 错误提示 */}
      {error && (
        <div className="mb-4 p-3 bg-okx-down/10 border border-okx-down/30 rounded-lg">
          <p className="text-okx-down text-sm">{error}</p>
        </div>
      )}

      {/* 成功提示 */}
      {isSuccess && txHash && (
        <div className="mb-4 p-3 bg-okx-up/10 border border-okx-up/30 rounded-lg">
          <p className="text-okx-up text-sm">交易成功!</p>
          <a
            href={getExplorerUrl(txHash, "tx")}
            target="_blank"
            rel="noopener noreferrer"
            className="text-okx-up text-xs underline"
          >
            查看交易
          </a>
        </div>
      )}

      {/* 按钮 */}
      {needsApproval ? (
        <button
          onClick={approve}
          disabled={isSwapping || !isActive}
          className="w-full py-4 rounded-lg font-bold text-lg bg-okx-up text-black hover:opacity-90 disabled:opacity-50 transition-opacity"
        >
          {isSwapping ? "授权中..." : "授权 MEME"}
        </button>
      ) : (
        <button
          onClick={executeSwap}
          disabled={isSwapping || !quote || !isActive}
          className={`w-full py-4 rounded-lg font-bold text-lg transition-opacity ${
            isBuy
              ? "bg-okx-up text-black hover:opacity-90"
              : "bg-okx-down text-white hover:opacity-90"
          } disabled:opacity-50`}
        >
          {isSwapping
            ? "交易中..."
            : isBuy
            ? "买入 MEME"
            : "卖出 MEME"}
        </button>
      )}

      {/* 风险提示 */}
      <p className="text-okx-text-tertiary text-xs text-center mt-3">
        交易存在风险，请谨慎操作
      </p>
    </div>
  );
}

export default SpotSwapPanel;
