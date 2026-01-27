"use client";

import React from "react";
import { useTradeHistory, TradeRecord } from "@/hooks/useTradeHistory";

interface TradeHistoryTableProps {
  instId?: string;
  maxRows?: number;
  className?: string;
}

export function TradeHistoryTable({ instId, maxRows = 10, className = "" }: TradeHistoryTableProps) {
  const { trades, isLoading, error } = useTradeHistory({ instId, limit: maxRows });

  const formatTime = (timestamp: number) => {
    const date = new Date(timestamp);
    return date.toLocaleString("zh-CN", {
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  const formatNumber = (value: string, decimals: number = 4) => {
    const num = parseFloat(value);
    if (isNaN(num)) return "0";
    if (num < 0.0001) return num.toExponential(2);
    return num.toFixed(decimals);
  };

  const shortenTxHash = (hash: string) => {
    if (hash.length <= 13) return hash;
    return `${hash.slice(0, 6)}...${hash.slice(-4)}`;
  };

  if (isLoading) {
    return (
      <div className={`bg-okx-bg-card border border-okx-border-primary rounded-xl p-4 ${className}`}>
        <h3 className="font-bold mb-4">交易历史</h3>
        <div className="flex items-center justify-center py-8">
          <div className="w-6 h-6 border-2 border-okx-up border-t-transparent rounded-full animate-spin" />
        </div>
      </div>
    );
  }

  return (
    <div className={`bg-okx-bg-card border border-okx-border-primary rounded-xl p-4 ${className}`}>
      <h3 className="font-bold mb-4">交易历史</h3>

      {trades.length === 0 ? (
        <div className="text-center py-8 text-okx-text-tertiary">
          暂无交易记录
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-okx-text-tertiary border-b border-okx-border-primary">
                <th className="text-left py-2">时间</th>
                <th className="text-left py-2">交易对</th>
                <th className="text-left py-2">方向</th>
                <th className="text-right py-2">数量</th>
                <th className="text-right py-2">价格</th>
                <th className="text-right py-2">总额</th>
                <th className="text-right py-2">交易哈希</th>
              </tr>
            </thead>
            <tbody>
              {trades.map((trade) => (
                <tr key={trade.id} className="border-b border-okx-border-secondary hover:bg-okx-bg-hover">
                  <td className="py-3 text-okx-text-secondary">{formatTime(trade.timestamp)}</td>
                  <td className="py-3">{trade.instId}</td>
                  <td className={`py-3 font-medium ${trade.tradeType === "BUY" ? "text-okx-up" : "text-okx-down"}`}>
                    {trade.tradeType === "BUY" ? "买入" : "卖出"}
                  </td>
                  <td className="py-3 text-right">{formatNumber(trade.tokenAmount, 2)}</td>
                  <td className="py-3 text-right">{formatNumber(trade.price, 6)}</td>
                  <td className="py-3 text-right">{formatNumber(trade.ethAmount)} ETH</td>
                  <td className="py-3 text-right">
                    <a
                      href={`https://sepolia.basescan.org/tx/${trade.txHash}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-okx-accent hover:underline font-mono"
                    >
                      {shortenTxHash(trade.txHash)}
                    </a>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {error && (
        <p className="text-xs text-okx-text-tertiary mt-2 text-center">
          使用模拟数据 (API 暂未连接)
        </p>
      )}
    </div>
  );
}

export default TradeHistoryTable;
