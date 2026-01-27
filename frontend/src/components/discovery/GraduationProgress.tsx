"use client";

import React from "react";
import { formatUnits } from "viem";
import { useTranslations } from "next-intl";

interface GraduationProgressProps {
  currentETH: bigint;
  graduationThreshold: bigint;
  progress: number; // 0-100
}

/**
 * GraduationProgress - OKX style Bonding Curve progress bar
 * 100% replicates OKX progress bar style
 */
export function GraduationProgress({
  currentETH,
  graduationThreshold,
  progress,
}: GraduationProgressProps) {
  const t = useTranslations("graduation");
  
  // Convert bigint to float for display
  const currentETHFloat = Number(formatUnits(currentETH, 18));
  const thresholdFloat = Number(formatUnits(graduationThreshold, 18));
  
  const isGraduated = progress >= 100;

  return (
    <div className="space-y-2">
      {/* Progress bar label */}
      <div className="flex items-center justify-between text-xs">
        <span className="text-okx-text-secondary">{t("progress")}</span>
        <span className="text-okx-text-primary font-medium">
          {currentETHFloat.toFixed(4)} / {thresholdFloat.toFixed(2)} ETH
        </span>
      </div>

      {/* OKX style progress bar */}
      <div className="relative w-full h-2 bg-okx-bg-secondary rounded-full overflow-hidden">
        {/* Progress bar fill */}
        <div
          className={`absolute left-0 top-0 h-full transition-all duration-500 ${
            isGraduated
              ? "bg-gradient-to-r from-okx-up to-okx-up"
              : "bg-gradient-to-r from-okx-accent to-okx-accent"
          }`}
          style={{ width: `${Math.min(progress, 100)}%` }}
        >
          {/* Progress bar glossy effect */}
          <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/20 to-transparent animate-pulse-slow" />
        </div>

        {/* Progress percentage indicator */}
        {progress > 0 && progress < 100 && (
          <div
            className="absolute top-0 h-full w-0.5 bg-okx-text-primary opacity-50"
            style={{ left: `${Math.min(progress, 100)}%` }}
          />
        )}
      </div>

      {/* Status text */}
      <div className="flex items-center justify-between text-xs">
        <span
          className={
            isGraduated
              ? "text-okx-up font-medium"
              : "text-okx-text-tertiary"
          }
        >
          {isGraduated
            ? `✓ ${t("graduated")}`
            : `${progress.toFixed(1)}% ${t("complete")}`}
        </span>
        {!isGraduated && (
          <span className="text-okx-text-tertiary">
            {t("toGraduation")} {(thresholdFloat - currentETHFloat).toFixed(4)} ETH
          </span>
        )}
      </div>
    </div>
  );
}

