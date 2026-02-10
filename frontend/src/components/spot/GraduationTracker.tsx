"use client";

import React from "react";
import { formatUnits } from "viem";
import { GRADUATION_THRESHOLD, REAL_TOKEN_SUPPLY } from "@/lib/protocol-constants";

// Helper function to convert wei to tokens
function weiToTokens(wei: bigint): number {
  return Number(wei / 1_000_000_000_000_000_000n);
}
import { useTranslations } from "next-intl";

/**
 * GraduationTracker - Graduation Progress Tracker
 *
 * ⚠️ 重要：合约的毕业逻辑是基于"剩余代币量"：
 * - GRADUATION_THRESHOLD = 207M tokens (剩余代币阈值)
 * - 毕业发生在 realTokenReserve <= GRADUATION_THRESHOLD 时
 * - 因此需要卖出 REAL_TOKEN_SUPPLY - GRADUATION_THRESHOLD = 1B - 207M = 793M 代币
 *
 * 所以我们计算已卖出代币的进度条时，目标是 793M，不是 207M！
 */
interface GraduationTrackerProps {
  soldSupply: bigint; // Current sold token amount (wei)
  graduationThreshold?: bigint; // 已卖出代币的毕业目标 (默认 793M)
  className?: string;
}

// 毕业需要卖出的代币数量 = 总供应量 - 剩余代币阈值 = 1B - 207M = 793M
const SOLD_TOKENS_TARGET = REAL_TOKEN_SUPPLY - GRADUATION_THRESHOLD;

export function GraduationTracker({
  soldSupply,
  graduationThreshold = SOLD_TOKENS_TARGET,
  className,
}: GraduationTrackerProps) {
  const t = useTranslations("graduation");
  
  // Calculate graduation progress (based on token amount)
  const progress = Number((soldSupply * 10000n) / graduationThreshold) / 100;
  const isGraduated = soldSupply >= graduationThreshold;

  // Convert to readable format (in millions)
  const soldSupplyM = weiToTokens(soldSupply) / 1_000_000;
  const thresholdM = weiToTokens(graduationThreshold) / 1_000_000;
  const remainingM = thresholdM - soldSupplyM;

  return (
    <div className={`okx-card p-4 ${className}`}>
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-sm font-semibold text-okx-text-primary">{t("progress")}</h3>
        <span className="text-sm text-okx-text-secondary">
          {soldSupplyM.toFixed(2)}M / {thresholdM.toFixed(2)}M
        </span>
      </div>
      
      {/* OKX style progress bar */}
      <div className="w-full bg-okx-bg-secondary rounded-full h-3 mb-2 overflow-hidden">
        <div
          className={`h-full transition-all duration-500 ${
            isGraduated ? "bg-okx-up" : "bg-okx-accent"
          }`}
          style={{ width: `${Math.min(progress, 100)}%` }}
        >
          {/* Glossy effect */}
          <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/20 to-transparent animate-pulse-slow" />
        </div>
      </div>

      {/* Status text */}
      <div className="flex items-center justify-between text-xs">
        <span className={isGraduated ? "text-okx-up" : "text-okx-text-tertiary"}>
          {isGraduated ? `✓ ${t("graduated")}` : `${progress.toFixed(1)}% ${t("complete")}`}
        </span>
        {!isGraduated && (
          <span className="text-okx-text-tertiary">
            {t("needMore", { amount: remainingM.toFixed(2) })}
          </span>
        )}
      </div>
    </div>
  );
}

