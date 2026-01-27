"use client";

/**
 * 猎杀排行榜组件
 *
 * 显示清算排行榜和实时清算通知
 */

import { useState, useEffect, useCallback } from "react";

interface Hunter {
  rank: number;
  address: string;
  kills: number;
  profit: string;
  lastKill: number;
}

interface LeaderboardData {
  period: string;
  hunters: Hunter[];
  totalHunters: number;
  totalLiquidations: number;
}

interface LiquidationEvent {
  id: string;
  token: string;
  liquidatedTrader: string;
  liquidator: string;
  isLong: boolean;
  size: string;
  liquidationPrice: string;
  collateralLost: string;
  timestamp: number;
}

interface Props {
  token?: string;
  apiUrl?: string;
  wsUrl?: string;
}

export function HunterLeaderboard({
  token,
  apiUrl = "http://localhost:8081",
  wsUrl = "ws://localhost:8081",
}: Props) {
  const [leaderboard, setLeaderboard] = useState<LeaderboardData | null>(null);
  const [recentLiquidations, setRecentLiquidations] = useState<LiquidationEvent[]>([]);
  const [period, setPeriod] = useState<"24h" | "7d" | "all">("all");
  const [loading, setLoading] = useState(true);

  // 获取排行榜数据
  useEffect(() => {
    const fetchLeaderboard = async () => {
      try {
        const res = await fetch(`${apiUrl}/api/hunters?period=${period}`);
        const json = await res.json();
        setLeaderboard(json);
      } catch (err) {
        console.error(err);
      } finally {
        setLoading(false);
      }
    };

    fetchLeaderboard();
    const interval = setInterval(fetchLeaderboard, 10000); // 每10秒刷新
    return () => clearInterval(interval);
  }, [apiUrl, period]);

  // WebSocket 连接接收实时清算事件
  useEffect(() => {
    if (!token) return;

    const ws = new WebSocket(wsUrl);

    ws.onopen = () => {
      // 订阅清算频道
      ws.send(JSON.stringify({
        type: "subscribe",
        channel: "liquidation",
        token,
      }));
    };

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        if (msg.type === "liquidation") {
          const liquidation = msg.data as LiquidationEvent;
          setRecentLiquidations(prev => [liquidation, ...prev.slice(0, 9)]);

          // 显示通知
          showLiquidationNotification(liquidation);
        }
      } catch (err) {
        console.error(err);
      }
    };

    return () => ws.close();
  }, [token, wsUrl]);

  // 显示清算通知
  const showLiquidationNotification = useCallback((liq: LiquidationEvent) => {
    // 可以集成 toast 通知库
    console.log(`[LIQUIDATION] ${liq.liquidatedTrader.slice(0, 10)} was hunted!`);
  }, []);

  // 格式化地址
  const formatAddress = (addr: string) => `${addr.slice(0, 6)}...${addr.slice(-4)}`;

  // 格式化利润
  const formatProfit = (profit: string) => {
    const p = Number(profit) / 1e12;
    return `$${p.toFixed(2)}`;
  };

  // 格式化时间
  const formatTime = (timestamp: number) => {
    const diff = Date.now() - timestamp;
    if (diff < 60000) return "just now";
    if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
    if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
    return `${Math.floor(diff / 86400000)}d ago`;
  };

  // 获取排名图标
  const getRankIcon = (rank: number) => {
    if (rank === 1) return "🥇";
    if (rank === 2) return "🥈";
    if (rank === 3) return "🥉";
    return `#${rank}`;
  };

  return (
    <div className="bg-gray-900 rounded-lg p-4">
      {/* 标题和统计 */}
      <div className="flex justify-between items-center mb-4">
        <h3 className="text-lg font-bold text-white flex items-center gap-2">
          <span>Hunter Leaderboard</span>
        </h3>
        <div className="text-sm text-gray-400">
          Total Liquidations: <span className="text-red-400 font-bold">{leaderboard?.totalLiquidations || 0}</span>
        </div>
      </div>

      {/* 时间段选择器 */}
      <div className="flex gap-2 mb-4">
        {(["24h", "7d", "all"] as const).map(p => (
          <button
            key={p}
            onClick={() => setPeriod(p)}
            className={`px-3 py-1 rounded text-sm ${
              period === p
                ? "bg-red-600 text-white"
                : "bg-gray-800 text-gray-400 hover:bg-gray-700"
            }`}
          >
            {p === "all" ? "All Time" : p.toUpperCase()}
          </button>
        ))}
      </div>

      {/* 排行榜 */}
      <div className="space-y-2 mb-6">
        {loading ? (
          <div className="animate-pulse space-y-2">
            {[...Array(5)].map((_, i) => (
              <div key={i} className="h-12 bg-gray-800 rounded" />
            ))}
          </div>
        ) : leaderboard?.hunters.length === 0 ? (
          <div className="text-center text-gray-500 py-8">
            <p className="text-2xl mb-2">No hunters yet</p>
            <p className="text-sm">Be the first to liquidate a position!</p>
          </div>
        ) : (
          leaderboard?.hunters.map((hunter, i) => (
            <div
              key={i}
              className={`flex items-center gap-3 p-3 rounded-lg ${
                hunter.rank <= 3
                  ? "bg-gradient-to-r from-yellow-900/30 to-transparent border border-yellow-600/30"
                  : "bg-gray-800"
              }`}
            >
              {/* 排名 */}
              <div className="w-10 text-center text-xl">
                {getRankIcon(hunter.rank)}
              </div>

              {/* 地址 */}
              <div className="flex-1">
                <div className="font-mono text-white">
                  {formatAddress(hunter.address)}
                </div>
                <div className="text-xs text-gray-400">
                  Last kill: {formatTime(hunter.lastKill)}
                </div>
              </div>

              {/* 统计 */}
              <div className="text-right">
                <div className="text-red-400 font-bold">
                  {hunter.kills} kills
                </div>
                <div className="text-green-400 text-sm">
                  {formatProfit(hunter.profit)}
                </div>
              </div>
            </div>
          ))
        )}
      </div>

      {/* 实时清算通知 */}
      {recentLiquidations.length > 0 && (
        <div className="border-t border-gray-700 pt-4">
          <h4 className="text-sm font-bold text-gray-400 mb-2">Recent Liquidations</h4>
          <div className="space-y-2 max-h-48 overflow-y-auto">
            {recentLiquidations.map((liq, i) => (
              <div
                key={liq.id}
                className={`p-2 rounded bg-red-900/20 border border-red-500/30 text-sm ${
                  i === 0 ? "animate-pulse" : ""
                }`}
              >
                <div className="flex justify-between">
                  <span className="text-red-400">
                    {formatAddress(liq.liquidatedTrader)} was liquidated
                  </span>
                  <span className="text-gray-400 text-xs">
                    {formatTime(liq.timestamp)}
                  </span>
                </div>
                <div className="text-xs text-gray-400 mt-1">
                  {liq.isLong ? "Long" : "Short"} · Lost: ${(Number(liq.collateralLost) / 1e12).toFixed(4)}
                  {" · "}
                  Hunter: {formatAddress(liq.liquidator)}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 提示信息 */}
      <div className="mt-4 p-3 bg-gray-800 rounded text-sm text-gray-400">
        <p className="font-bold text-white mb-1">How to Hunt</p>
        <ol className="list-decimal list-inside space-y-1">
          <li>Monitor the Liquidation Map for at-risk positions</li>
          <li>Push the price to trigger liquidations</li>
          <li>Earn rewards from liquidated collateral</li>
        </ol>
      </div>
    </div>
  );
}

export default HunterLeaderboard;
