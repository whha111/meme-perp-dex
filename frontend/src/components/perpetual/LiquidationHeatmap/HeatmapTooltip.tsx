"use client";

/**
 * 热力图悬停提示框
 */

import { useTranslations } from "next-intl";
import type { HeatmapTooltipData } from "./types";
import { formatUsdAmount } from "./heatmapUtils";

interface Props {
  data: HeatmapTooltipData | null;
  visible: boolean;
}

export function HeatmapTooltip({ data, visible }: Props) {
  const t = useTranslations("perp");

  if (!visible || !data) return null;

  return (
    <div
      className="fixed z-50 bg-gray-900 border border-gray-700 rounded-lg shadow-xl p-3 text-xs pointer-events-none"
      style={{
        left: data.x + 10,
        top: data.y - 10,
        transform: "translateY(-100%)",
      }}
    >
      {/* 价格和时间 */}
      <div className="flex items-center justify-between gap-4 mb-2 border-b border-gray-700 pb-2">
        <span className="text-gray-400">{t("price")}:</span>
        <span className="text-white font-mono">{data.price}</span>
      </div>

      <div className="flex items-center justify-between gap-4 mb-3">
        <span className="text-gray-400">{t("time") || "Time"}:</span>
        <span className="text-white">{data.time}</span>
      </div>

      {/* 多头清算 */}
      <div className="flex items-center justify-between gap-4 mb-1">
        <div className="flex items-center gap-1">
          <div className="w-2 h-2 bg-red-500 rounded-full" />
          <span className="text-red-400">{t("longs")}</span>
        </div>
        <span className="text-white">
          {formatUsdAmount(data.longSize)} ({data.longCount} {t("accounts")})
        </span>
      </div>

      {/* 空头清算 */}
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-1">
          <div className="w-2 h-2 bg-green-500 rounded-full" />
          <span className="text-green-400">{t("shorts")}</span>
        </div>
        <span className="text-white">
          {formatUsdAmount(data.shortSize)} ({data.shortCount} {t("accounts")})
        </span>
      </div>
    </div>
  );
}
