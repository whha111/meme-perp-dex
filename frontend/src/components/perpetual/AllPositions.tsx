"use client";

/**
 * 全局持仓列表组件 (重构版 - 紧凑表格)
 *
 * ETH 本位永续合约 - 所有金额以 ETH 计价
 *
 * 精度约定:
 * - 价格 (ETH/Token): 1e18 (直接用 Bonding Curve)
 * - Token 数量: 1e18
 * - 保证金/PnL (ETH): 1e18
 * - 杠杆倍数: 1e4 (10x = 100000)
 * - 费率/比率: 1e4 (基点)
 *
 * 数据更新策略：
 * - 首次加载时从 API 获取数据
 * - 后续更新由 WebSocket 推送（通过 tradingDataStore）
 * - 仅在 WebSocket 断开时启用备用轮询
 */

import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { useTranslations } from "next-intl";
import { RiskProgressBarCompact } from "./RiskProgressBar";
import { useTradingDataStore } from "@/lib/stores/tradingDataStore";

interface PositionData {
  trader: string;
  isLong: boolean;
  size: string;
  entryPrice: string;
  markPrice: string;
  collateral: string;
  leverage: string;
  liquidationPrice: string;
  marginRatio: string;
  unrealizedPnL: string;
  roe: string;
  riskLevel: "safe" | "warning" | "danger";
}

interface AllPositionsData {
  token: string;
  currentPrice: string;
  positions: PositionData[];
  totalPositions: number;
  dangerCount: number;
  warningCount: number;
}

interface Props {
  token: string;
  apiUrl?: string;
}

export function AllPositions({ token, apiUrl = "http://localhost:8081" }: Props) {
  const t = useTranslations("perp");
  const [data, setData] = useState<AllPositionsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<"all" | "danger" | "warning" | "long" | "short">("all");

  // WebSocket 连接状态 - 直接订阅单个字段避免对象引用变化
  const wsConnected = useTradingDataStore((state) => state.wsConnected);
  const fallbackIntervalRef = useRef<NodeJS.Timeout | null>(null);

  // 获取持仓数据
  const fetchData = useCallback(async () => {
    try {
      const res = await fetch(`${apiUrl}/api/positions/${token}`);

      // 检查响应状态
      if (!res.ok) {
        console.warn(`[AllPositions] API returned ${res.status}, using empty data`);
        setData({ token, currentPrice: "0", positions: [], totalPositions: 0, dangerCount: 0, warningCount: 0 });
        setLoading(false);
        return;
      }

      const json = await res.json();
      setData(json);
    } catch (err) {
      console.error("[AllPositions] Failed to fetch:", err);
      // 设置空数据而不是让组件处于错误状态
      setData({ token, currentPrice: "0", positions: [], totalPositions: 0, dangerCount: 0, warningCount: 0 });
    } finally {
      setLoading(false);
    }
  }, [token, apiUrl]);

  // 初始加载 - 只依赖 token，不依赖 fetchData
  useEffect(() => {
    fetchData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]); // 只在 token 变化时重新获取

  // 备用轮询：仅在 WebSocket 断开时启用
  useEffect(() => {
    // 清除现有的轮询
    if (fallbackIntervalRef.current) {
      clearInterval(fallbackIntervalRef.current);
      fallbackIntervalRef.current = null;
    }

    // 如果 WebSocket 断开，启用备用轮询（每30秒）
    if (!wsConnected) {
      console.log("[AllPositions] WebSocket disconnected, enabling fallback polling");
      fallbackIntervalRef.current = setInterval(() => fetchData(), 30000); // 增加到30秒
    }

    return () => {
      if (fallbackIntervalRef.current) {
        clearInterval(fallbackIntervalRef.current);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wsConnected]); // 只依赖 wsConnected，不依赖 fetchData

  // 格式化价格 (Token/ETH, 1e18 精度) — 使用下标格式显示极小数
  const formatPrice = (price: string) => {
    const p = Number(price) / 1e18;
    if (p <= 0) return "0";
    if (p >= 1000) return p.toLocaleString("en-US", { maximumFractionDigits: 2 });
    if (p >= 1) return p.toFixed(4);
    if (p >= 0.01) return p.toFixed(6);
    if (p >= 0.0001) return p.toFixed(8);

    // 极小数使用下标格式: 0.0₈2359
    const priceStr = p.toFixed(18);
    const match = priceStr.match(/^0\.(0*)([1-9]\d*)/);
    if (match) {
      const zeroCount = match[1].length;
      const significantDigits = match[2].slice(0, 4);
      const subscripts = ["₀", "₁", "₂", "₃", "₄", "₅", "₆", "₇", "₈", "₉"];
      const subscriptNum = zeroCount.toString().split("").map((d) => subscripts[parseInt(d)]).join("");
      return `0.0${subscriptNum}${significantDigits}`;
    }
    return p.toFixed(10);
  };

  // 格式化仓位大小 (1e18 精度)
  const formatSize = (size: string) => {
    const s = Number(size) / 1e18;
    if (s >= 1000000000) return `${(s / 1000000000).toFixed(1)}B`;
    if (s >= 1000000) return `${(s / 1000000).toFixed(1)}M`;
    if (s >= 1000) return `${(s / 1000).toFixed(1)}K`;
    return s.toFixed(0);
  };

  // 格式化 ETH 金额 (1e18 精度)
  const formatETH = (value: string) => {
    const v = Number(value) / 1e18;
    if (v >= 1000) return `${(v / 1000).toFixed(2)}K Ξ`;
    if (v >= 1) return `${v.toFixed(3)} Ξ`;
    if (v >= 0.001) return `${v.toFixed(4)} Ξ`;
    return `${v.toFixed(6)} Ξ`;
  };

  // 格式化地址
  const formatAddress = (addr: string) => `${addr.slice(0, 4)}...${addr.slice(-3)}`;

  // 格式化 PnL (ETH, 1e18 精度)
  const formatPnL = (pnl: string) => {
    const p = Number(pnl) / 1e18;
    const sign = p >= 0 ? "+" : "";
    if (Math.abs(p) >= 100) return `${sign}${(p / 1000).toFixed(2)}K Ξ`;
    if (Math.abs(p) >= 1) return `${sign}${p.toFixed(3)} Ξ`;
    if (Math.abs(p) >= 0.001) return `${sign}${p.toFixed(4)} Ξ`;
    return `${sign}${p.toFixed(6)} Ξ`;
  };

  // 格式化百分比 (基点 -> %)
  const formatPercent = (bps: string) => {
    const p = Number(bps) / 100;
    const sign = p >= 0 ? "+" : "";
    return `${sign}${p.toFixed(1)}%`;
  };

  // 过滤持仓
  const filteredPositions = useMemo(() => {
    if (!data?.positions) return [];
    return data.positions.filter(pos => {
      if (filter === "all") return true;
      if (filter === "danger") return pos.riskLevel === "danger";
      if (filter === "warning") return pos.riskLevel === "warning";
      if (filter === "long") return pos.isLong;
      if (filter === "short") return !pos.isLong;
      return true;
    });
  }, [data?.positions, filter]);

  if (loading) {
    return (
      <div className="bg-gray-900 rounded-lg p-3 h-full">
        <h3 className="text-sm font-bold text-white mb-2">{t("allPositions")}</h3>
        <div className="animate-pulse space-y-1">
          {[...Array(8)].map((_, i) => (
            <div key={i} className="h-8 bg-gray-800 rounded" />
          ))}
        </div>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="bg-gray-900 rounded-lg p-3 h-full">
        <h3 className="text-sm font-bold text-white mb-2">{t("allPositions")}</h3>
        <p className="text-gray-500 text-sm">{t("noDataAvailable")}</p>
      </div>
    );
  }

  return (
    <div className="bg-gray-900 rounded-lg p-3 h-full flex flex-col">
      {/* 头部 */}
      <div className="flex justify-between items-center mb-2 flex-shrink-0">
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-bold text-white">{t("allPositions")}</h3>
          <span className="text-xs text-gray-400">({data.totalPositions})</span>
        </div>

        {/* 风险统计 */}
        <div className="flex gap-1">
          {data.dangerCount > 0 && (
            <span className="px-1.5 py-0.5 bg-red-900/50 text-red-400 rounded text-[10px] font-bold animate-pulse">
              {data.dangerCount} ⚠
            </span>
          )}
          {data.warningCount > 0 && (
            <span className="px-1.5 py-0.5 bg-yellow-900/50 text-yellow-400 rounded text-[10px]">
              {data.warningCount} !
            </span>
          )}
        </div>
      </div>

      {/* 过滤器 */}
      <div className="flex gap-1 mb-2 flex-shrink-0 overflow-x-auto">
        {[
          { key: "all", label: t("all") },
          { key: "danger", label: "🔴", color: "text-red-400" },
          { key: "warning", label: "🟡", color: "text-yellow-400" },
          { key: "long", label: t("longs"), color: "text-green-400" },
          { key: "short", label: t("shorts"), color: "text-red-400" },
        ].map(f => (
          <button
            key={f.key}
            onClick={() => setFilter(f.key as typeof filter)}
            className={`px-2 py-0.5 rounded text-[10px] whitespace-nowrap transition-colors ${
              filter === f.key
                ? "bg-blue-600 text-white"
                : `bg-gray-800 ${f.color || "text-gray-400"} hover:bg-gray-700`
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {/* 表格 */}
      <div className="flex-1 overflow-auto min-h-0">
        {filteredPositions.length === 0 ? (
          <div className="text-center text-gray-500 py-8 text-xs">
            <p>{t("noPositionsFound")}</p>
          </div>
        ) : (
          <table className="w-full text-[10px]">
            <thead className="sticky top-0 bg-gray-900">
              <tr className="text-gray-500 border-b border-gray-700">
                <th className="text-left py-1 px-1 font-normal">Trader</th>
                <th className="text-center py-1 px-1 font-normal">Side</th>
                <th className="text-right py-1 px-1 font-normal">Size</th>
                <th className="text-right py-1 px-1 font-normal">Entry</th>
                <th className="text-right py-1 px-1 font-normal">Liq</th>
                <th className="text-right py-1 px-1 font-normal">PnL</th>
                <th className="text-center py-1 px-1 font-normal w-20">Risk</th>
              </tr>
            </thead>
            <tbody>
              {filteredPositions.map((pos, i) => {
                // ETH 本位: 价格精度 1e18
                const entryPriceNum = Number(pos.entryPrice) / 1e18;
                const markPriceNum = Number(pos.markPrice || pos.entryPrice) / 1e18;
                const liqPriceNum = Number(pos.liquidationPrice) / 1e18;
                // ETH 本位: PnL 精度 1e18
                const pnlValue = Number(pos.unrealizedPnL) / 1e18;

                return (
                  <tr
                    key={i}
                    className={`border-b border-gray-800 hover:bg-gray-800/50 ${
                      pos.riskLevel === "danger" ? "bg-red-900/10" :
                      pos.riskLevel === "warning" ? "bg-yellow-900/10" : ""
                    }`}
                  >
                    {/* Trader */}
                    <td className="py-1.5 px-1">
                      <span className="font-mono text-white">{formatAddress(pos.trader)}</span>
                    </td>

                    {/* Side */}
                    <td className="py-1.5 px-1 text-center">
                      <span className={`px-1 py-0.5 rounded text-[9px] font-bold ${
                        pos.isLong ? "bg-green-900/50 text-green-400" : "bg-red-900/50 text-red-400"
                      }`}>
                        {pos.isLong ? "L" : "S"}{pos.leverage}x
                      </span>
                    </td>

                    {/* Size */}
                    <td className="py-1.5 px-1 text-right">
                      <div className="text-white">{formatSize(pos.size)}</div>
                      <div className="text-gray-500 text-[9px]">{formatETH(pos.collateral)}</div>
                    </td>

                    {/* Entry Price */}
                    <td className="py-1.5 px-1 text-right font-mono text-white">
                      {formatPrice(pos.entryPrice)}
                    </td>

                    {/* Liquidation Price */}
                    <td className={`py-1.5 px-1 text-right font-mono ${
                      pos.isLong ? "text-red-400" : "text-green-400"
                    }`}>
                      {formatPrice(pos.liquidationPrice)}
                    </td>

                    {/* PnL */}
                    <td className={`py-1.5 px-1 text-right font-medium ${
                      pnlValue >= 0 ? "text-green-400" : "text-red-400"
                    }`}>
                      <div>{formatPnL(pos.unrealizedPnL)}</div>
                      <div className="text-[9px]">{formatPercent(pos.roe)}</div>
                    </td>

                    {/* Risk Progress */}
                    <td className="py-1.5 px-1">
                      <RiskProgressBarCompact
                        isLong={pos.isLong}
                        entryPrice={entryPriceNum}
                        markPrice={markPriceNum}
                        liquidationPrice={liqPriceNum}
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* 当前价格 */}
      <div className="pt-2 border-t border-gray-700 text-center text-[10px] text-gray-400 flex-shrink-0">
        {t("currentPrice")}: <span className="text-white font-mono">{formatPrice(data.currentPrice)}</span>
      </div>
    </div>
  );
}

export default AllPositions;
