"use client";

/**
 * TokenDetailPageV2 - 按照 DomainFi 截图 1:1 复刻
 */

import React, { useState } from "react";

// ========== 工具函数 ==========
function cn(...classes: (string | boolean | undefined | null)[]): string {
  return classes.filter(Boolean).join(" ");
}

// ========== Mock 数据 ==========
const mockTrades = [
  { time: "12:34:56", type: "buy", price: "0.00118", amount: "10,000", total: "$11.80", trader: "0x1234...5678" },
  { time: "12:33:21", type: "sell", price: "0.00116", amount: "5,000", total: "$5.80", trader: "0xabcd...efgh" },
  { time: "12:32:45", type: "buy", price: "0.00117", amount: "25,000", total: "$29.25", trader: "0x9876...4321" },
];

// ========== 主组件 ==========
export function TokenDetailPageV2() {
  const [activeTab, setActiveTab] = useState<"动态" | "交易" | "持仓" | "钱包追踪" | "信号">("交易");
  const [tradeMode, setTradeMode] = useState<"buy" | "sell">("buy");
  const [payAmount, setPayAmount] = useState("");
  const [sliderValue, setSliderValue] = useState(0);

  return (
    <div className="min-h-screen bg-white text-gray-900">
      {/* ===== 顶部导航栏 ===== */}
      <header className="h-14 border-b border-gray-200 flex items-center justify-between px-4">
        {/* 左侧 Logo */}
        <div className="flex items-center gap-8">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 bg-black rounded-lg flex items-center justify-center">
              <span className="text-white font-bold text-sm">D</span>
            </div>
            <span className="font-bold text-lg">FOMO</span>
          </div>

          {/* 导航菜单 */}
          <nav className="flex items-center gap-6 text-sm text-gray-600">
            <a href="#" className="hover:text-gray-900">マーケット</a>
            <a href="#" className="hover:text-gray-900">交換</a>
            <a href="#" className="hover:text-gray-900">資産</a>
            <a href="#" className="text-green-500 font-medium">トークン作成</a>
            <a href="#" className="hover:text-gray-900">招待プログラム</a>
          </nav>
        </div>

        {/* 中间搜索框 */}
        <div className="flex-1 max-w-md mx-8">
          <div className="relative">
            <input
              type="text"
              placeholder="通貨 / アドレス / DApp"
              className="w-full h-10 pl-10 pr-4 rounded-full border border-gray-200 bg-gray-50 text-sm focus:outline-none focus:border-gray-300"
            />
            <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
          </div>
        </div>

        {/* 右侧按钮 */}
        <div className="flex items-center gap-3">
          <button className="flex items-center gap-1 text-sm">
            <span className="w-2 h-2 bg-red-500 rounded-full"></span>
            JA
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          </button>
          <button className="p-2 hover:bg-gray-100 rounded-lg">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z" />
            </svg>
          </button>
          <button className="flex items-center gap-2 px-3 py-2 border border-gray-200 rounded-full text-sm">
            <div className="w-4 h-4 bg-green-500 rounded-full"></div>
            Base Sepolia
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          </button>
          <button className="px-3 py-2 bg-gray-100 rounded-full text-sm font-medium">
            0.482 ETH
          </button>
          <button className="px-3 py-2 border border-gray-200 rounded-full text-sm">
            0xCA...A2B7
            <svg className="w-4 h-4 inline ml-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          </button>
        </div>
      </header>

      {/* ===== 主内容区 ===== */}
      <div className="flex">
        {/* 左侧边栏 */}
        <aside className="w-14 border-r border-gray-200 flex flex-col items-center py-4 gap-4">
          <button className="flex flex-col items-center gap-1 text-gray-400 hover:text-gray-600">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
            </svg>
            <span className="text-[10px]">Watch</span>
          </button>
          <button className="flex flex-col items-center gap-1 text-orange-500">
            <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
              <path d="M13.5 22h-3c-.276 0-.5-.224-.5-.5v-3.086l-2.293 2.293a.5.5 0 01-.707 0l-2.121-2.121a.5.5 0 010-.707L7.086 15.5H4.5a.5.5 0 01-.5-.5v-3c0-.276.224-.5.5-.5h2.586L4.793 9.207a.5.5 0 010-.707l2.121-2.121a.5.5 0 01.707 0L10 8.586V6c0-.276.224-.5.5-.5h3c.276 0 .5.224.5.5v2.586l2.293-2.293a.5.5 0 01.707 0l2.121 2.121a.5.5 0 010 .707L16.914 11.5H19.5c.276 0 .5.224.5.5v3c0 .276-.224.5-.5.5h-2.586l2.293 2.293a.5.5 0 010 .707l-2.121 2.121a.5.5 0 01-.707 0L14 18.414V21.5c0 .276-.224.5-.5.5z"/>
            </svg>
            <span className="text-[10px]">Trend</span>
          </button>
          <button className="flex flex-col items-center gap-1 text-gray-400 hover:text-gray-600">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
            </svg>
            <span className="text-[10px]">Holdi</span>
          </button>
          <button className="flex flex-col items-center gap-1 text-gray-400 hover:text-gray-600">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
            </svg>
            <span className="text-[10px]">Follo</span>
          </button>
          <button className="flex flex-col items-center gap-1 text-gray-400 hover:text-gray-600">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
            </svg>
            <span className="text-[10px]">Signa</span>
          </button>
        </aside>

        {/* 中间内容区 */}
        <main className="flex-1 flex flex-col">
          {/* Token 信息头部 */}
          <div className="px-4 py-3 border-b border-gray-200">
            <div className="flex items-start justify-between">
              {/* 左侧: Token 基本信息 */}
              <div className="flex items-start gap-3">
                <div className="w-10 h-10 rounded-full bg-green-500 flex items-center justify-center text-white font-bold">
                  G
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-bold text-lg">GOAL</span>
                    <span className="text-gray-400 text-sm">GoallayCoin</span>
                    <button className="text-gray-400 hover:text-gray-600">
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z" />
                      </svg>
                    </button>
                    <button className="text-gray-400 hover:text-gray-600">
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
                      </svg>
                    </button>
                    <button className="text-gray-400 hover:text-gray-600">
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z" />
                      </svg>
                    </button>
                  </div>
                  <div className="flex items-center gap-2 text-sm text-gray-500 mt-1">
                    <span>0x7BDB...5532</span>
                    <span>•</span>
                    <span>Solana</span>
                  </div>
                </div>
              </div>

              {/* 右侧: 价格和统计 */}
              <div className="flex items-center gap-8">
                <div className="text-2xl font-bold">$0.001170</div>

                {/* 涨跌幅 */}
                <div className="flex items-center gap-4 text-sm">
                  <div>
                    <span className="text-gray-400">5m </span>
                    <span className="text-green-500">+0.23%</span>
                  </div>
                  <div>
                    <span className="text-gray-400">1h </span>
                    <span className="text-red-500">-11.39%</span>
                  </div>
                  <div>
                    <span className="text-gray-400">4h </span>
                    <span className="text-green-500">+13.38%</span>
                  </div>
                  <div>
                    <span className="text-gray-400">24h </span>
                    <span className="text-green-500">+181.30%</span>
                  </div>
                </div>

                {/* 统计数据 */}
                <div className="flex items-center gap-6 text-sm">
                  <div className="text-center">
                    <div className="text-gray-400">市值</div>
                    <div className="font-medium">$1.17M</div>
                  </div>
                  <div className="text-center">
                    <div className="text-gray-400">流动性</div>
                    <div className="font-medium">$194.5K</div>
                  </div>
                  <div className="text-center">
                    <div className="text-gray-400">持有者</div>
                    <div className="font-medium">2,651</div>
                  </div>
                </div>
              </div>
            </div>

            {/* 标签行 */}
            <div className="flex items-center gap-3 mt-3 text-sm">
              <span className="text-red-500">开发者已全部卖出</span>
              <span className="text-blue-500">聪明钱买入</span>
              <span className="px-2 py-0.5 bg-orange-100 text-orange-600 rounded text-xs">已付费推广</span>
            </div>
          </div>

          {/* 图表区域 */}
          <div className="flex-1 flex flex-col">
            {/* 图表头部 */}
            <div className="px-4 py-2 border-b border-gray-200 flex items-center justify-between">
              <div className="font-medium">WETH/GOAL</div>
              <div className="flex items-center gap-1">
                {["1m", "5m", "15m", "1h", "4h", "1d"].map((tf) => (
                  <button
                    key={tf}
                    className={cn(
                      "px-3 py-1 rounded text-sm",
                      tf === "1m" ? "bg-blue-500 text-white" : "text-gray-600 hover:bg-gray-100"
                    )}
                  >
                    {tf}
                  </button>
                ))}
              </div>
            </div>

            {/* K线图占位 */}
            <div className="flex-1 bg-[#131722] relative min-h-[400px]">
              {/* TradingView Logo */}
              <div className="absolute bottom-4 left-4 flex items-center gap-1">
                <span className="text-[#787b86] text-xl font-bold">T</span>
                <span className="text-[#787b86] text-xl font-bold">V</span>
              </div>

              {/* 价格标签 */}
              <div className="absolute right-2 top-1/3 bg-green-500 text-white text-xs px-2 py-1 rounded">
                0.00
              </div>

              {/* 成交量标签 */}
              <div className="absolute right-2 bottom-16 bg-green-500 text-white text-xs px-2 py-1 rounded">
                88.21
              </div>

              {/* 模拟K线图 */}
              <div className="absolute inset-0 flex items-center justify-center">
                <div className="flex items-end gap-1 h-48">
                  {Array.from({ length: 60 }).map((_, i) => {
                    const isGreen = Math.random() > 0.4;
                    const height = 20 + Math.random() * 100;
                    return (
                      <div
                        key={i}
                        className={cn(
                          "w-2",
                          isGreen ? "bg-[#26a69a]" : "bg-[#ef5350]"
                        )}
                        style={{ height: `${height}px` }}
                      />
                    );
                  })}
                </div>
              </div>
            </div>

            {/* 底部标签页 */}
            <div className="border-t border-gray-200">
              {/* 标签头 */}
              <div className="flex items-center gap-6 px-4 py-2 border-b border-gray-200">
                {(["动态", "交易", "持仓", "钱包追踪", "信号"] as const).map((tab) => (
                  <button
                    key={tab}
                    onClick={() => setActiveTab(tab)}
                    className={cn(
                      "py-2 text-sm relative",
                      activeTab === tab ? "text-gray-900 font-medium" : "text-gray-500"
                    )}
                  >
                    {tab}
                    {activeTab === tab && (
                      <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-yellow-400" />
                    )}
                  </button>
                ))}
              </div>

              {/* 交易表格 */}
              {activeTab === "交易" && (
                <div className="max-h-48 overflow-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-gray-50 sticky top-0">
                      <tr className="text-gray-500 text-left">
                        <th className="px-4 py-2 font-normal">时间</th>
                        <th className="px-4 py-2 font-normal">类型</th>
                        <th className="px-4 py-2 font-normal text-right">价格</th>
                        <th className="px-4 py-2 font-normal text-right">数量</th>
                        <th className="px-4 py-2 font-normal text-right">总额</th>
                        <th className="px-4 py-2 font-normal text-right">交易者</th>
                      </tr>
                    </thead>
                    <tbody>
                      {mockTrades.map((trade, i) => (
                        <tr key={i} className="border-t border-gray-100 hover:bg-gray-50">
                          <td className="px-4 py-2 text-gray-600">{trade.time}</td>
                          <td className="px-4 py-2">
                            <span className={trade.type === "buy" ? "text-green-500" : "text-red-500"}>
                              {trade.type === "buy" ? "买入" : "卖出"}
                            </span>
                          </td>
                          <td className="px-4 py-2 text-right">{trade.price}</td>
                          <td className="px-4 py-2 text-right">{trade.amount}</td>
                          <td className="px-4 py-2 text-right">{trade.total}</td>
                          <td className="px-4 py-2 text-right text-gray-500">{trade.trader}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        </main>

        {/* 右侧交易面板 */}
        <aside className="w-80 border-l border-gray-200 flex flex-col">
          {/* 买卖切换 */}
          <div className="p-4">
            <div className="flex rounded-lg overflow-hidden border border-gray-200">
              <button
                onClick={() => setTradeMode("buy")}
                className={cn(
                  "flex-1 py-3 text-sm font-medium transition-all",
                  tradeMode === "buy"
                    ? "bg-green-500 text-white"
                    : "bg-white text-gray-600 hover:bg-gray-50"
                )}
              >
                buy
              </button>
              <button
                onClick={() => setTradeMode("sell")}
                className={cn(
                  "flex-1 py-3 text-sm font-medium transition-all",
                  tradeMode === "sell"
                    ? "bg-red-500 text-white"
                    : "bg-white text-gray-600 hover:bg-gray-50"
                )}
              >
                sell
              </button>
            </div>
          </div>

          {/* 支付输入 */}
          <div className="px-4 pb-4">
            <div className="flex items-center justify-between mb-2">
              <span className="text-gray-500 text-sm">支付</span>
              <span className="text-gray-500 text-sm">余额: 0.4823 ETH</span>
            </div>
            <div className="border border-gray-200 rounded-lg p-3">
              <div className="flex items-center justify-between">
                <input
                  type="text"
                  value={payAmount}
                  onChange={(e) => setPayAmount(e.target.value)}
                  placeholder="0.00"
                  className="text-2xl font-medium w-32 outline-none bg-transparent"
                />
                <div className="w-8 h-8 bg-blue-500 rounded-full flex items-center justify-center text-white text-sm font-bold">
                  E
                </div>
              </div>
            </div>
          </div>

          {/* 百分比滑块 */}
          <div className="px-4 pb-4">
            <input
              type="range"
              min="0"
              max="100"
              value={sliderValue}
              onChange={(e) => setSliderValue(Number(e.target.value))}
              className="w-full h-1 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-blue-500"
            />
            <div className="flex justify-between mt-2">
              {["25%", "50%", "75%", "100%"].map((pct) => (
                <button
                  key={pct}
                  onClick={() => setSliderValue(parseInt(pct))}
                  className="px-3 py-1 border border-gray-200 rounded text-sm text-gray-600 hover:bg-gray-50"
                >
                  {pct}
                </button>
              ))}
            </div>
          </div>

          {/* 获得输出 */}
          <div className="px-4 pb-4">
            <div className="flex items-center justify-between mb-2">
              <span className="text-gray-500 text-sm">获得</span>
            </div>
            <div className="border border-gray-200 rounded-lg p-3">
              <div className="flex items-center justify-between">
                <span className="text-2xl font-medium text-gray-400">~0.00</span>
                <div className="flex items-center gap-2">
                  <div className="w-6 h-6 bg-green-500 rounded-full flex items-center justify-center text-white text-xs font-bold">
                    G
                  </div>
                  <span className="font-medium">GOAL</span>
                </div>
              </div>
            </div>
          </div>

          {/* 交易详情 */}
          <div className="px-4 pb-4 text-sm space-y-2">
            <div className="flex justify-between">
              <span className="text-gray-500">预估价格</span>
              <span>--</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-500">价格影响</span>
              <span className="text-green-500">&lt;0.01%</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-500">最小获得</span>
              <span>--</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-500">网络费用</span>
              <span>~$0.01</span>
            </div>
          </div>

          {/* 交易按钮 */}
          <div className="px-4 pb-4 mt-auto">
            <button className="w-full py-4 bg-gray-100 text-gray-400 rounded-xl text-sm font-medium">
              金額を入力
            </button>
          </div>

          {/* 底部信息 */}
          <div className="px-4 pb-4 text-center">
            <span className="text-xs text-gray-400">
              交易由 FOMO DEX 提供支持
            </span>
            <button className="ml-2 text-blue-500">
              <svg className="w-4 h-4 inline" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              </svg>
            </button>
          </div>
        </aside>
      </div>
    </div>
  );
}

export default TokenDetailPageV2;
