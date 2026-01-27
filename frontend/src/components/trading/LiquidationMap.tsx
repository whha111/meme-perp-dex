"use client";

/**
 * 清算地图组件
 *
 * 显示各价格点的清算量分布，帮助用户发现猎杀机会
 */

import { useState, useEffect, useMemo } from "react";
import { formatUnits } from "viem";

interface LiquidationLevel {
  price: string;
  size: string;
  accounts: number;
}

interface LiquidationMapData {
  token: string;
  currentPrice: string;
  longs: LiquidationLevel[];
  shorts: LiquidationLevel[];
  totalLongSize: string;
  totalShortSize: string;
  totalLongAccounts: number;
  totalShortAccounts: number;
}

interface Props {
  token: string;
  apiUrl?: string;
}

export function LiquidationMap({ token, apiUrl = "http://localhost:8081" }: Props) {
  const [data, setData] = useState<LiquidationMapData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // 获取清算地图数据
  useEffect(() => {
    const fetchData = async () => {
      try {
        const res = await fetch(`${apiUrl}/api/liquidation-map/${token}`);
        const json = await res.json();
        setData(json);
        setError(null);
      } catch (err) {
        setError("Failed to load liquidation map");
        console.error(err);
      } finally {
        setLoading(false);
      }
    };

    fetchData();
    const interval = setInterval(fetchData, 5000); // 每5秒刷新
    return () => clearInterval(interval);
  }, [token, apiUrl]);

  // 计算最大值用于归一化柱状图
  const maxSize = useMemo(() => {
    if (!data) return 1n;
    const allSizes = [
      ...data.longs.map(l => BigInt(l.size)),
      ...data.shorts.map(s => BigInt(s.size)),
    ];
    return allSizes.length > 0 ? allSizes.reduce((a, b) => a > b ? a : b, 1n) : 1n;
  }, [data]);

  // 格式化价格
  const formatPrice = (price: string) => {
    const p = Number(price) / 1e12;
    if (p < 0.0001) return p.toExponential(4);
    return p.toFixed(8);
  };

  // 格式化大小
  const formatSize = (size: string) => {
    const s = Number(size) / 1e12;
    if (s >= 1000000) return `${(s / 1000000).toFixed(2)}M`;
    if (s >= 1000) return `${(s / 1000).toFixed(2)}K`;
    return s.toFixed(2);
  };

  if (loading) {
    return (
      <div className="bg-gray-900 rounded-lg p-4">
        <h3 className="text-lg font-bold text-white mb-4">Liquidation Map</h3>
        <div className="animate-pulse space-y-2">
          {[...Array(5)].map((_, i) => (
            <div key={i} className="h-6 bg-gray-800 rounded" />
          ))}
        </div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="bg-gray-900 rounded-lg p-4">
        <h3 className="text-lg font-bold text-white mb-4">Liquidation Map</h3>
        <p className="text-red-400">{error || "No data"}</p>
      </div>
    );
  }

  const currentPrice = Number(data.currentPrice) / 1e12;

  return (
    <div className="bg-gray-900 rounded-lg p-4">
      <div className="flex justify-between items-center mb-4">
        <h3 className="text-lg font-bold text-white">Liquidation Map</h3>
        <div className="text-sm text-gray-400">
          Current: <span className="text-white font-mono">${formatPrice(data.currentPrice)}</span>
        </div>
      </div>

      {/* 统计摘要 */}
      <div className="grid grid-cols-2 gap-4 mb-4">
        <div className="bg-red-900/30 rounded p-3">
          <div className="text-red-400 text-sm">Longs at Risk</div>
          <div className="text-white font-bold">{data.totalLongAccounts} accounts</div>
          <div className="text-red-300 text-sm">${formatSize(data.totalLongSize)}</div>
        </div>
        <div className="bg-green-900/30 rounded p-3">
          <div className="text-green-400 text-sm">Shorts at Risk</div>
          <div className="text-white font-bold">{data.totalShortAccounts} accounts</div>
          <div className="text-green-300 text-sm">${formatSize(data.totalShortSize)}</div>
        </div>
      </div>

      {/* 清算地图可视化 */}
      <div className="space-y-1">
        {/* 空头清算点（价格高于当前价）*/}
        {data.shorts.slice(0, 10).reverse().map((level, i) => {
          const width = Number((BigInt(level.size) * 100n) / maxSize);
          const priceNum = Number(level.price) / 1e12;
          const distance = ((priceNum - currentPrice) / currentPrice * 100).toFixed(1);

          return (
            <div key={`short-${i}`} className="flex items-center gap-2 text-sm">
              <div className="w-24 text-right text-gray-400 font-mono">
                ${formatPrice(level.price)}
              </div>
              <div className="flex-1 h-5 bg-gray-800 rounded overflow-hidden relative">
                <div
                  className="h-full bg-green-600 transition-all duration-300"
                  style={{ width: `${width}%` }}
                />
                <span className="absolute inset-0 flex items-center px-2 text-xs text-white">
                  {level.accounts} accounts · ${formatSize(level.size)}
                </span>
              </div>
              <div className="w-16 text-green-400 text-xs">+{distance}%</div>
            </div>
          );
        })}

        {/* 当前价格线 */}
        <div className="flex items-center gap-2 py-2 border-y border-yellow-500">
          <div className="w-24 text-right text-yellow-400 font-mono font-bold">
            ${formatPrice(data.currentPrice)}
          </div>
          <div className="flex-1 text-center text-yellow-400 text-sm font-bold">
            ← CURRENT PRICE →
          </div>
          <div className="w-16" />
        </div>

        {/* 多头清算点（价格低于当前价）*/}
        {data.longs.slice(0, 10).map((level, i) => {
          const width = Number((BigInt(level.size) * 100n) / maxSize);
          const priceNum = Number(level.price) / 1e12;
          const distance = ((currentPrice - priceNum) / currentPrice * 100).toFixed(1);

          return (
            <div key={`long-${i}`} className="flex items-center gap-2 text-sm">
              <div className="w-24 text-right text-gray-400 font-mono">
                ${formatPrice(level.price)}
              </div>
              <div className="flex-1 h-5 bg-gray-800 rounded overflow-hidden relative">
                <div
                  className="h-full bg-red-600 transition-all duration-300"
                  style={{ width: `${width}%` }}
                />
                <span className="absolute inset-0 flex items-center px-2 text-xs text-white">
                  {level.accounts} accounts · ${formatSize(level.size)}
                </span>
              </div>
              <div className="w-16 text-red-400 text-xs">-{distance}%</div>
            </div>
          );
        })}
      </div>

      {/* 空数据提示 */}
      {data.longs.length === 0 && data.shorts.length === 0 && (
        <div className="text-center text-gray-500 py-8">
          <p>No positions to liquidate</p>
          <p className="text-sm mt-2">Positions will appear here when traders open leveraged positions</p>
        </div>
      )}

      {/* 图例 */}
      <div className="flex justify-center gap-6 mt-4 text-xs text-gray-400">
        <div className="flex items-center gap-1">
          <div className="w-3 h-3 bg-red-600 rounded" />
          <span>Longs (liquidated if price drops)</span>
        </div>
        <div className="flex items-center gap-1">
          <div className="w-3 h-3 bg-green-600 rounded" />
          <span>Shorts (liquidated if price rises)</span>
        </div>
      </div>
    </div>
  );
}

export default LiquidationMap;
