"use client";

import React, { useMemo } from "react";
import { InstrumentSelector } from "./InstrumentSelector";
import { useFundingRate } from "@/hooks/useFundingRate";
import { useETHPrice } from "@/hooks/useETHPrice";
import { AnimatedNumber } from "@/components/shared/AnimatedNumber";
import { useTranslations } from "next-intl";

// 格式化非常小的价格
function formatSmallPrice(priceUsd: number): string {
  if (priceUsd <= 0) return "0.00";
  if (priceUsd >= 1000) return priceUsd.toLocaleString("en-US", { maximumFractionDigits: 1 });
  if (priceUsd >= 0.01) return priceUsd.toFixed(4);
  if (priceUsd >= 0.0001) return priceUsd.toFixed(6);

  const priceStr = priceUsd.toFixed(18);
  const match = priceStr.match(/^0\.(0*)([1-9]\d*)/);
  if (match) {
    const zeroCount = match[1].length;
    const significantDigits = match[2].slice(0, 5);
    const subscripts = ["₀", "₁", "₂", "₃", "₄", "₅", "₆", "₇", "₈", "₉"];
    const subscriptNum = zeroCount
      .toString()
      .split("")
      .map((d) => subscripts[parseInt(d)])
      .join("");
    return `0.0${subscriptNum}${significantDigits}`;
  }

  return priceUsd.toFixed(8);
}

interface TradingHeaderProps {
  instId: string;
  currentPrice: bigint;
  priceChange24h: number;
  markPrice?: bigint;
  high24h?: bigint;
  low24h?: bigint;
  volume24h?: bigint;
  mode?: "spot" | "perp";
  onSelectInstrument: (instId: string) => void;
  className?: string;
}

/**
 * 交易页面顶部信息栏 - OKX 风格水平布局
 */
export function TradingHeader({
  instId,
  currentPrice,
  priceChange24h,
  markPrice,
  high24h,
  low24h,
  volume24h,
  mode = "perp",
  onSelectInstrument,
  className = "",
}: TradingHeaderProps) {
  const t = useTranslations("common");
  const { price: ethPrice } = useETHPrice();
  const { formattedRate, isPositive: isFundingPositive, countdown } = useFundingRate();

  // 价格转换
  const currentPriceFloat = Number(currentPrice) / 1e18;
  const currentPriceUsd = currentPriceFloat * ethPrice;
  const markPriceFloat = markPrice ? Number(markPrice) / 1e18 : currentPriceFloat;
  const markPriceUsd = markPriceFloat * ethPrice;
  const high24hFloat = high24h ? Number(high24h) / 1e18 : 0;
  const high24hUsd = high24hFloat * ethPrice;
  const low24hFloat = low24h ? Number(low24h) / 1e18 : 0;
  const low24hUsd = low24hFloat * ethPrice;
  const volume24hFloat = volume24h ? Number(volume24h) / 1e18 : 0;
  const volume24hUsd = volume24hFloat * ethPrice;

  const isPositive = priceChange24h >= 0;

  // 计算基差 (现货价格 vs 标记价格)
  const basisInfo = useMemo(() => {
    if (!markPrice || currentPrice === 0n) {
      return { basis: 0, basisPercent: 0, status: "normal" as const };
    }

    const spotFloat = Number(currentPrice) / 1e18;
    const markFloat = Number(markPrice) / 1e18;

    if (spotFloat === 0) {
      return { basis: 0, basisPercent: 0, status: "normal" as const };
    }

    // 基差 = (标记价格 - 现货价格) / 现货价格 * 100
    const basisPercent = ((markFloat - spotFloat) / spotFloat) * 100;
    const absBasis = Math.abs(basisPercent);

    let status: "normal" | "warning" | "critical" = "normal";
    if (absBasis > 10) {
      status = "critical";
    } else if (absBasis > 5) {
      status = "warning";
    }

    return {
      basis: markFloat - spotFloat,
      basisPercent,
      status
    };
  }, [currentPrice, markPrice]);

  return (
    <div
      className={`bg-okx-bg-primary border-b border-okx-border-primary ${className}`}
    >
      {/* 主信息栏 */}
      <div className="flex items-center justify-between px-4 py-2">
        {/* 左侧：代币选择器 + 价格 */}
        <div className="flex items-center gap-6">
          {/* 代币选择器 */}
          <InstrumentSelector
            currentInstId={instId}
            onSelect={onSelectInstrument}
          />

          {/* 分隔线 */}
          <div className="h-8 w-px bg-okx-border-primary" />

          {/* 当前价格和涨跌幅 */}
          <div className="flex items-baseline gap-3">
            <span
              className={`text-[22px] font-bold ${
                isPositive ? "text-okx-up" : "text-okx-down"
              }`}
            >
              $
              <AnimatedNumber value={currentPriceUsd} format={formatSmallPrice} />
            </span>
            <span
              className={`text-[14px] font-medium ${
                isPositive ? "text-okx-up" : "text-okx-down"
              }`}
            >
              {isPositive ? "+" : ""}
              {priceChange24h.toFixed(2)}%
            </span>
          </div>
        </div>

        {/* 右侧：交易指标 */}
        <div className="flex items-center gap-6 text-[12px]">
          {/* 指数价格 */}
          <div className="flex flex-col">
            <span className="text-okx-text-tertiary">指数价格</span>
            <span className="text-okx-text-primary font-medium">
              ${currentPriceUsd >= 1000
                ? currentPriceUsd.toLocaleString("en-US", { maximumFractionDigits: 1 })
                : formatSmallPrice(currentPriceUsd)}
            </span>
          </div>

          {/* 标记价格 (仅永续) */}
          {mode === "perp" && (
            <div className="flex flex-col">
              <span className="text-okx-text-tertiary">标记价格</span>
              <span className="text-okx-text-primary font-medium">
                ${markPriceUsd >= 1000
                  ? markPriceUsd.toLocaleString("en-US", { maximumFractionDigits: 1 })
                  : formatSmallPrice(markPriceUsd)}
              </span>
            </div>
          )}

          {/* 基差 (仅永续) */}
          {mode === "perp" && (
            <div className="flex flex-col">
              <span className="text-okx-text-tertiary">基差</span>
              <span
                className={`font-medium ${
                  basisInfo.status === "critical"
                    ? "text-okx-warning"
                    : basisInfo.status === "warning"
                    ? "text-yellow-500"
                    : basisInfo.basisPercent >= 0
                    ? "text-okx-up"
                    : "text-okx-down"
                }`}
              >
                {basisInfo.basisPercent >= 0 ? "+" : ""}
                {basisInfo.basisPercent.toFixed(3)}%
                {basisInfo.status !== "normal" && (
                  <span className="ml-1 text-[10px]">
                    {basisInfo.status === "critical" ? "⚠️" : "⚡"}
                  </span>
                )}
              </span>
            </div>
          )}

          {/* 资金费率 (仅永续) */}
          {mode === "perp" && (
            <div className="flex flex-col">
              <span className="text-okx-text-tertiary">
                资金费率 / 倒计时
              </span>
              <div className="flex items-center gap-1">
                <span
                  className={`font-medium ${
                    isFundingPositive ? "text-okx-up" : "text-okx-down"
                  }`}
                >
                  {formattedRate}
                </span>
                <span className="text-okx-text-secondary">/</span>
                <span className="text-okx-text-primary font-mono">
                  {countdown}
                </span>
              </div>
            </div>
          )}

          {/* 24h 最低 */}
          <div className="flex flex-col">
            <span className="text-okx-text-tertiary">24h最低</span>
            <span className="text-okx-text-primary font-medium">
              ${low24hUsd >= 1000
                ? low24hUsd.toLocaleString("en-US", { maximumFractionDigits: 1 })
                : low24hUsd > 0 ? formatSmallPrice(low24hUsd) : "--"}
            </span>
          </div>

          {/* 24h 最高 */}
          <div className="flex flex-col">
            <span className="text-okx-text-tertiary">24h最高</span>
            <span className="text-okx-text-primary font-medium">
              ${high24hUsd >= 1000
                ? high24hUsd.toLocaleString("en-US", { maximumFractionDigits: 1 })
                : high24hUsd > 0 ? formatSmallPrice(high24hUsd) : "--"}
            </span>
          </div>

          {/* 24h 成交额 */}
          <div className="flex flex-col">
            <span className="text-okx-text-tertiary">24h成交额</span>
            <span className="text-okx-text-primary font-medium">
              $
              {volume24hUsd >= 1000000
                ? (volume24hUsd / 1000000).toFixed(2) + "M"
                : volume24hUsd >= 1000
                ? (volume24hUsd / 1000).toFixed(2) + "K"
                : volume24hUsd.toFixed(2)}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

export default TradingHeader;
