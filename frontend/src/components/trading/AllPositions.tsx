"use client";

/**
 * 全局持仓列表组件
 *
 * 公开显示所有用户的持仓信息，用于猎杀场
 */

import { useState, useEffect } from "react";

interface PositionData {
  trader: string;
  isLong: boolean;
  size: string;
  entryPrice: string;
  collateral: string;
  leverage: string;
  liquidationPrice: string;
  marginRatio: string;
  unrealizedPnL: string;
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
  const [data, setData] = useState<AllPositionsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<"all" | "danger" | "warning" | "long" | "short">("all");

  // 获取持仓数据
  useEffect(() => {
    const fetchData = async () => {
      try {
        const res = await fetch(`${apiUrl}/api/positions/${token}`);
        const json = await res.json();
        setData(json);
      } catch (err) {
        console.error(err);
      } finally {
        setLoading(false);
      }
    };

    fetchData();
    const interval = setInterval(fetchData, 3000); // 每3秒刷新
    return () => clearInterval(interval);
  }, [token, apiUrl]);

  // 格式化价格 (1e12 精度，后端返回的价格)
  const formatPrice = (price: string) => {
    const p = Number(price) / 1e12;
    if (p < 0.0001) return p.toExponential(4);
    return p.toFixed(8);
  };

  // 格式化仓位大小 - size 是代币数量 (1e18 精度)
  const formatSize = (size: string) => {
    const s = Number(size) / 1e18;
    if (s >= 1000000) return `${(s / 1000000).toFixed(2)}M`;
    if (s >= 1000) return `${(s / 1000).toFixed(2)}K`;
    return s.toFixed(2);
  };

  // 格式化保证金/仓位价值 (1e6 精度, USD)
  const formatCollateral = (value: string) => {
    const v = Number(value) / 1e6;
    return `$${v.toFixed(2)}`;
  };

  // 格式化地址
  const formatAddress = (addr: string) => {
    return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
  };

  // 格式化 PnL (1e6 精度, USD)
  const formatPnL = (pnl: string) => {
    const p = Number(pnl) / 1e6;
    const sign = p >= 0 ? "+" : "";
    return `${sign}$${p.toFixed(2)}`;
  };

  // 格式化杠杆 (后端返回人类可读的数字，如 "75")
  const formatLeverage = (lev: string) => {
    return lev; // 直接返回，不需要转换
  };

  // 过滤持仓
  const filteredPositions = data?.positions.filter(pos => {
    if (filter === "all") return true;
    if (filter === "danger") return pos.riskLevel === "danger";
    if (filter === "warning") return pos.riskLevel === "warning";
    if (filter === "long") return pos.isLong;
    if (filter === "short") return !pos.isLong;
    return true;
  }) || [];

  if (loading) {
    return (
      <div className="bg-gray-900 rounded-lg p-4">
        <h3 className="text-lg font-bold text-white mb-4">All Positions</h3>
        <div className="animate-pulse space-y-2">
          {[...Array(5)].map((_, i) => (
            <div key={i} className="h-12 bg-gray-800 rounded" />
          ))}
        </div>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="bg-gray-900 rounded-lg p-4">
        <h3 className="text-lg font-bold text-white mb-4">All Positions</h3>
        <p className="text-gray-500">No data available</p>
      </div>
    );
  }

  return (
    <div className="bg-gray-900 rounded-lg p-4">
      <div className="flex justify-between items-center mb-4">
        <h3 className="text-lg font-bold text-white">
          All Positions
          <span className="text-sm font-normal text-gray-400 ml-2">
            ({data.totalPositions} total)
          </span>
        </h3>

        {/* 风险统计 */}
        <div className="flex gap-2">
          {data.dangerCount > 0 && (
            <span className="px-2 py-1 bg-red-900/50 text-red-400 rounded text-xs font-bold animate-pulse">
              {data.dangerCount} DANGER
            </span>
          )}
          {data.warningCount > 0 && (
            <span className="px-2 py-1 bg-yellow-900/50 text-yellow-400 rounded text-xs">
              {data.warningCount} WARNING
            </span>
          )}
        </div>
      </div>

      {/* 过滤器 */}
      <div className="flex gap-2 mb-4 overflow-x-auto">
        {[
          { key: "all", label: "All" },
          { key: "danger", label: "Danger", color: "text-red-400" },
          { key: "warning", label: "Warning", color: "text-yellow-400" },
          { key: "long", label: "Longs", color: "text-green-400" },
          { key: "short", label: "Shorts", color: "text-red-400" },
        ].map(f => (
          <button
            key={f.key}
            onClick={() => setFilter(f.key as typeof filter)}
            className={`px-3 py-1 rounded text-sm whitespace-nowrap transition-colors ${
              filter === f.key
                ? "bg-blue-600 text-white"
                : `bg-gray-800 ${f.color || "text-gray-400"} hover:bg-gray-700`
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {/* 持仓列表 */}
      <div className="space-y-2 max-h-96 overflow-y-auto">
        {filteredPositions.length === 0 ? (
          <div className="text-center text-gray-500 py-8">
            <p>No positions found</p>
            <p className="text-sm mt-2">Positions will appear here when traders open leveraged positions</p>
          </div>
        ) : (
          filteredPositions.map((pos, i) => (
            <div
              key={i}
              className={`p-3 rounded-lg border transition-colors ${
                pos.riskLevel === "danger"
                  ? "bg-red-900/20 border-red-500/50 animate-pulse"
                  : pos.riskLevel === "warning"
                  ? "bg-yellow-900/20 border-yellow-500/50"
                  : "bg-gray-800 border-gray-700"
              }`}
            >
              <div className="flex justify-between items-start">
                {/* 左侧：交易者信息 */}
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-white">
                      {formatAddress(pos.trader)}
                    </span>
                    <span
                      className={`px-2 py-0.5 rounded text-xs font-bold ${
                        pos.isLong
                          ? "bg-green-900/50 text-green-400"
                          : "bg-red-900/50 text-red-400"
                      }`}
                    >
                      {pos.isLong ? "LONG" : "SHORT"} {formatLeverage(pos.leverage)}x
                    </span>
                    {pos.riskLevel === "danger" && (
                      <span className="text-red-500 text-xs font-bold">LIQUIDATABLE</span>
                    )}
                  </div>
                  <div className="text-sm text-gray-400 mt-1">
                    Size: <span className="text-white">{formatSize(pos.size)}</span>
                    {" · "}
                    Entry: <span className="text-white">${formatPrice(pos.entryPrice)}</span>
                  </div>
                </div>

                {/* 右侧：PnL */}
                <div className="text-right">
                  <div
                    className={`font-bold ${
                      Number(pos.unrealizedPnL) >= 0 ? "text-green-400" : "text-red-400"
                    }`}
                  >
                    {formatPnL(pos.unrealizedPnL)}
                  </div>
                  <div className="text-xs text-gray-400">
                    Margin Ratio: {(Number(pos.marginRatio) / 100).toFixed(2)}%
                    {Number(pos.marginRatio) >= 8000 && <span className="text-red-400 ml-1">(High Risk)</span>}
                  </div>
                </div>
              </div>

              {/* 清算价格 */}
              <div className="mt-2 pt-2 border-t border-gray-700 flex justify-between text-sm">
                <span className="text-gray-400">Liquidation Price:</span>
                <span
                  className={`font-mono ${
                    pos.riskLevel === "danger"
                      ? "text-red-400 font-bold"
                      : pos.riskLevel === "warning"
                      ? "text-yellow-400"
                      : "text-gray-300"
                  }`}
                >
                  ${formatPrice(pos.liquidationPrice)}
                </span>
              </div>
            </div>
          ))
        )}
      </div>

      {/* 当前价格提示 */}
      <div className="mt-4 pt-4 border-t border-gray-700 text-center text-sm text-gray-400">
        Current Price: <span className="text-white font-mono">${formatPrice(data.currentPrice)}</span>
      </div>
    </div>
  );
}

export default AllPositions;
