"use client";

import React, { useState, useEffect } from "react";
import { useAccount, useBalance } from "wagmi";
import { formatEther } from "viem";
import { Navbar } from "@/components/layout/Navbar";
import { usePerpetual } from "@/hooks/usePerpetual";
import { TradeHistoryTable } from "@/components/trading/TradeHistoryTable";
import { useConnectModal } from "@rainbow-me/rainbowkit";

export default function AccountPage() {
  const { address, isConnected } = useAccount();
  const { openConnectModal } = useConnectModal();
  const [mounted, setMounted] = useState(false);

  const { data: walletBalance } = useBalance({ address });
  const {
    position,
    hasPosition,
    unrealizedPnL,
    vaultBalance,
    availableBalance,
    lockedMargin,
  } = usePerpetual();

  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted) {
    return (
      <main className="min-h-screen bg-okx-bg-primary text-okx-text-primary">
        <div className="flex items-center justify-center min-h-screen">
          <div className="w-8 h-8 border-4 border-okx-up border-t-transparent rounded-full animate-spin" />
        </div>
      </main>
    );
  }

  const formatBalance = (balance: bigint | null | undefined) => {
    if (!balance) return "0.0000";
    return parseFloat(formatEther(balance)).toFixed(4);
  };

  const totalPnL = unrealizedPnL || 0n;

  return (
    <main className="min-h-screen bg-okx-bg-primary text-okx-text-primary">
      <Navbar />

      <div className="max-w-6xl mx-auto px-4 py-8">
        <h1 className="text-2xl font-bold mb-6">账户概览</h1>

        {!isConnected ? (
          <div className="bg-okx-bg-card border border-okx-border-primary rounded-xl p-8 text-center">
            <p className="text-6xl mb-4">🔒</p>
            <p className="text-okx-text-secondary mb-4">请连接钱包查看账户信息</p>
            <button
              onClick={openConnectModal}
              className="bg-okx-up text-black px-6 py-3 rounded-lg font-bold hover:opacity-90"
            >
              连接钱包
            </button>
          </div>
        ) : (
          <div className="space-y-6">
            {/* 资产概览卡片 */}
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
              <div className="bg-okx-bg-card border border-okx-border-primary rounded-xl p-4">
                <p className="text-okx-text-tertiary text-sm mb-1">钱包余额</p>
                <p className="text-xl font-bold">{formatBalance(walletBalance?.value)} ETH</p>
              </div>
              <div className="bg-okx-bg-card border border-okx-border-primary rounded-xl p-4">
                <p className="text-okx-text-tertiary text-sm mb-1">合约账户</p>
                <p className="text-xl font-bold">{formatBalance(vaultBalance)} ETH</p>
              </div>
              <div className="bg-okx-bg-card border border-okx-border-primary rounded-xl p-4">
                <p className="text-okx-text-tertiary text-sm mb-1">可用余额</p>
                <p className="text-xl font-bold text-okx-up">{formatBalance(availableBalance)} ETH</p>
              </div>
              <div className="bg-okx-bg-card border border-okx-border-primary rounded-xl p-4">
                <p className="text-okx-text-tertiary text-sm mb-1">已锁定保证金</p>
                <p className="text-xl font-bold">{formatBalance(lockedMargin)} ETH</p>
              </div>
            </div>

            {/* 当前持仓 */}
            <div className="bg-okx-bg-card border border-okx-border-primary rounded-xl p-4">
              <h2 className="font-bold mb-4">当前持仓</h2>
              {hasPosition && position ? (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-okx-text-tertiary border-b border-okx-border-primary">
                        <th className="text-left py-2">合约</th>
                        <th className="text-left py-2">方向</th>
                        <th className="text-right py-2">仓位大小</th>
                        <th className="text-right py-2">保证金</th>
                        <th className="text-right py-2">杠杆</th>
                        <th className="text-right py-2">开仓价</th>
                        <th className="text-right py-2">未实现盈亏</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr>
                        <td className="py-3">MEME/ETH 永续</td>
                        <td className={`py-3 ${position.isLong ? "text-okx-up" : "text-okx-down"}`}>
                          {position.isLong ? "多" : "空"}
                        </td>
                        <td className="text-right py-3">{formatBalance(position.size)} ETH</td>
                        <td className="text-right py-3">{formatBalance(position.collateral)} ETH</td>
                        <td className="text-right py-3">{Number(position.leverage) / 10000}x</td>
                        <td className="text-right py-3">{formatBalance(position.entryPrice)}</td>
                        <td className={`text-right py-3 ${totalPnL >= 0n ? "text-okx-up" : "text-okx-down"}`}>
                          {totalPnL >= 0n ? "+" : ""}{formatBalance(totalPnL)} ETH
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="text-center py-8 text-okx-text-tertiary">
                  暂无持仓
                </div>
              )}
            </div>

            {/* 交易历史 */}
            <TradeHistoryTable maxRows={20} />

            {/* 账户地址 */}
            <div className="bg-okx-bg-card border border-okx-border-primary rounded-xl p-4">
              <h2 className="font-bold mb-3">账户信息</h2>
              <div className="flex items-center justify-between">
                <span className="text-okx-text-tertiary text-sm">钱包地址</span>
                <span className="font-mono text-sm">{address}</span>
              </div>
            </div>
          </div>
        )}
      </div>
    </main>
  );
}
