"use client";

/**
 * 清算地图组件
 *
 * 显示各价格点的清算量分布，帮助用户发现猎杀机会
 */

import { useState, useEffect, useMemo } from "react";
import { formatUnits } from "viem";
import { useTranslations } from "next-intl";

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
  const t = useTranslations("perp");
  const [data, setData] = useState<LiquidationMapData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // 获取清算地图数据
  useEffect(() => {
    const fetchData = async () => {
      try {
        const res = await fetch(`${apiUrl}/api/liquidation-map/${token}`);

        // 检查响应状态
        if (!res.ok) {
          console.warn(`[LiquidationMap] API returned ${res.status}, using empty data`);
          setData({
            token,
            currentPrice: "0",
            longs: [],
            shorts: [],
            totalLongSize: "0",
            totalShortSize: "0",
            totalLongAccounts: 0,
            totalShortAccounts: 0,
          });
          setError(null);
          setLoading(false);
          return;
        }

        const json = await res.json();
        setData(json);
        setError(null);
      } catch (err) {
        console.error("[LiquidationMap] Fetch error:", err);
        setError("Failed to load liquidation map");
        // 设置空数据
        setData({
          token,
          currentPrice: "0",
          longs: [],
          shorts: [],
          totalLongSize: "0",
          totalShortSize: "0",
          totalLongAccounts: 0,
          totalShortAccounts: 0,
        });
      } finally {
        setLoading(false);
      }
    };

    fetchData();
    const interval = setInterval(fetchData, 30000); // 30秒刷新，减少频率
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]); // 只依赖 token，apiUrl 是常量

  // 计算最大值用于归一化柱状图
  const maxSize = useMemo(() => {
    if (!data) return 1n;
    const allSizes = [
      ...data.longs.map(l => BigInt(l.size)),
      ...data.shorts.map(s => BigInt(s.size)),
    ];
    return allSizes.length > 0 ? allSizes.reduce((a, b) => a > b ? a : b, 1n) : 1n;
  }, [data]);

  // 格式化价格 - 使用下标格式，避免科学计数法
  const formatPrice = (price: string) => {
    // ETH 本位: 价格 1e18 精度
    const p = Number(price) / 1e18;
    if (p <= 0) return "0";
    if (p >= 0.0001) return p.toFixed(8);
    // 极小数使用下标格式
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

  // 格式化大小 (ETH 本位: 1e18 精度, ETH 值)
  const formatSize = (size: string) => {
    const s = Number(size) / 1e18;
    if (s >= 1) return `Ξ${s.toFixed(4)}`;
    return `Ξ${s.toFixed(6)}`;
  };

  if (loading) {
    return (
      <div className="bg-gray-900 rounded-lg p-4">
        <h3 className="text-lg font-bold text-white mb-4">{t("liquidationMap")}</h3>
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
        <h3 className="text-lg font-bold text-white mb-4">{t("liquidationMap")}</h3>
        <p className="text-red-400">{error || t("noData")}</p>
      </div>
    );
  }

  const currentPrice = Number(data.currentPrice) / 1e18;

  return (
    <div className="bg-gray-900 rounded-lg p-4">
      <div className="flex justify-between items-center mb-4">
        <h3 className="text-lg font-bold text-white">{t("liquidationMap")}</h3>
        <div className="text-sm text-gray-400">
          {t("currentPrice")}: <span className="text-white font-mono">${formatPrice(data.currentPrice)}</span>
        </div>
      </div>

      {/* 统计摘要 */}
      <div className="grid grid-cols-2 gap-4 mb-4">
        <div className="bg-red-900/30 rounded p-3">
          <div className="text-red-400 text-sm">{t("longsAtRisk")}</div>
          <div className="text-white font-bold">{data.totalLongAccounts} {t("accounts")}</div>
          <div className="text-red-300 text-sm">${formatSize(data.totalLongSize)}</div>
        </div>
        <div className="bg-green-900/30 rounded p-3">
          <div className="text-green-400 text-sm">{t("shortsAtRisk")}</div>
          <div className="text-white font-bold">{data.totalShortAccounts} {t("accounts")}</div>
          <div className="text-green-300 text-sm">${formatSize(data.totalShortSize)}</div>
        </div>
      </div>

      {/* 清算地图可视化 */}
      <div className="space-y-1">
        {/* 空头清算点（价格高于当前价）*/}
        {data.shorts.slice(0, 10).reverse().map((level, i) => {
          const width = Number((BigInt(level.size) * 100n) / maxSize);
          const priceNum = Number(level.price) / 1e18;
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
                  {level.accounts} {t("accounts")} · ${formatSize(level.size)}
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
            ← {t("currentPrice")} →
          </div>
          <div className="w-16" />
        </div>

        {/* 多头清算点（价格低于当前价）*/}
        {data.longs.slice(0, 10).map((level, i) => {
          const width = Number((BigInt(level.size) * 100n) / maxSize);
          const priceNum = Number(level.price) / 1e18;
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
                  {level.accounts} {t("accounts")} · ${formatSize(level.size)}
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
          <p>{t("noPositionsToLiquidate")}</p>
          <p className="text-sm mt-2">{t("positionsWillAppear")}</p>
        </div>
      )}

      {/* 图例 */}
      <div className="flex justify-center gap-6 mt-4 text-xs text-gray-400">
        <div className="flex items-center gap-1">
          <div className="w-3 h-3 bg-red-600 rounded" />
          <span>{t("longsLiquidated")}</span>
        </div>
        <div className="flex items-center gap-1">
          <div className="w-3 h-3 bg-green-600 rounded" />
          <span>{t("shortsLiquidated")}</span>
        </div>
      </div>
    </div>
  );
}

export default LiquidationMap;
