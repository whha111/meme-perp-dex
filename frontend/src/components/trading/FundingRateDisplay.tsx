"use client";

import React from "react";
import { useFundingRate } from "@/hooks/useFundingRate";

interface FundingRateDisplayProps {
  compact?: boolean;
  className?: string;
}

export function FundingRateDisplay({ compact = false, className = "" }: FundingRateDisplayProps) {
  const { formattedRate, isPositive, countdown } = useFundingRate();

  if (compact) {
    return (
      <div className={`flex items-center gap-2 ${className}`}>
        <span className="text-okx-text-tertiary">资金费率:</span>
        <span className={isPositive ? "text-okx-up" : "text-okx-down"}>
          {formattedRate}
        </span>
        <span className="text-okx-text-tertiary text-xs">({countdown})</span>
      </div>
    );
  }

  return (
    <div className={`bg-okx-bg-card border border-okx-border-primary rounded-lg p-4 ${className}`}>
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm text-okx-text-tertiary mb-1">资金费率</p>
          <p className={`text-xl font-bold ${isPositive ? "text-okx-up" : "text-okx-down"}`}>
            {formattedRate}
          </p>
        </div>
        <div className="text-right">
          <p className="text-sm text-okx-text-tertiary mb-1">下次结算</p>
          <p className="text-xl font-mono">{countdown}</p>
        </div>
      </div>
      <div className="mt-3 pt-3 border-t border-okx-border-primary">
        <p className="text-xs text-okx-text-tertiary">
          {isPositive
            ? "多头向空头支付资金费"
            : "空头向多头支付资金费"}
        </p>
      </div>
    </div>
  );
}

export default FundingRateDisplay;
