"use client";

/**
 * TokenDetailPage - OKX Web3 DEX 风格交易页面
 * 精确复刻 OKX Web3 代币详情页 UI
 */

import React, { useState } from "react";

// ========== Icon Components ==========
const StarIcon = ({ filled = false, className = "" }: { filled?: boolean; className?: string }) => (
  <svg className={className} fill={filled ? "currentColor" : "none"} stroke="currentColor" viewBox="0 0 24 24" width="14" height="14">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z" />
  </svg>
);

const CopyIcon = ({ className = "" }: { className?: string }) => (
  <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24" width="14" height="14">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
  </svg>
);

const ChevronDownIcon = ({ className = "" }: { className?: string }) => (
  <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24" width="16" height="16">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
  </svg>
);

const ExternalLinkIcon = ({ className = "" }: { className?: string }) => (
  <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24" width="14" height="14">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
  </svg>
);

const SettingsIcon = ({ className = "" }: { className?: string }) => (
  <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24" width="16" height="16">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
  </svg>
);

const FilterIcon = ({ className = "" }: { className?: string }) => (
  <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24" width="12" height="12">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z" />
  </svg>
);

const EyeIcon = ({ className = "" }: { className?: string }) => (
  <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24" width="12" height="12">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
  </svg>
);

const ChartIcon = ({ className = "" }: { className?: string }) => (
  <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24" width="16" height="16">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
  </svg>
);

const InfoIcon = ({ className = "" }: { className?: string }) => (
  <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24" width="12" height="12">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
  </svg>
);

const MoreIcon = ({ className = "" }: { className?: string }) => (
  <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24" width="16" height="16">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 12h.01M12 12h.01M19 12h.01M6 12a1 1 0 11-2 0 1 1 0 012 0zm7 0a1 1 0 11-2 0 1 1 0 012 0zm7 0a1 1 0 11-2 0 1 1 0 012 0z" />
  </svg>
);

// ========== Types ==========
interface TokenInfo {
  name: string;
  symbol: string;
  address: string;
  chain: string;
  price: number;
  priceChange24h: number;
  marketCap: number;
  liquidity: number;
  holders: number;
  riskScore: number;
  description?: string;
}

interface TradeRecord {
  id: string;
  timestamp: number;
  type: "buy" | "sell" | "add" | "remove";
  totalValue: number;
  price: number;
  tokenAmount: number;
  ethAmount: number;
  address: string;
  poolIcon?: string;
  label?: string;
}

interface LiquidityRecord {
  id: string;
  timestamp: number;
  type: "add" | "remove";
  totalValue: number;
  wethAmount: number;
  tokenAmount: number;
  address: string;
}

interface HolderInfo {
  rank: number;
  address: string;
  tokenAmount: number;
  percentage: number;
  totalProfit: number;
  profitPercent: number;
  ethBalance: number;
  holdTime: string;
  source?: string;
  netFlow: number;
  buyTotal: number;
  sellTotal: number;
  tags?: string[];
}

// ========== Mock Data ==========
const mockToken: TokenInfo = {
  name: "REPPO",
  symbol: "REPPO",
  address: "0xff8104251e7761163fac3211ef5583fb3f8583d6",
  chain: "BASE",
  price: 0.037858,
  priceChange24h: -8.6,
  marketCap: 37850000,
  liquidity: 1610000,
  holders: 15420,
  riskScore: 58.3,
  description: "Reppo is building a network for AI training data...",
};

const mockTrades: TradeRecord[] = [
  { id: "1", timestamp: Date.now() - 60000, type: "buy", totalValue: 0.00000027, price: 0.037878, tokenAmount: 0.02254, ethAmount: 0.000854, address: "0x287a...294a", label: "" },
  { id: "2", timestamp: Date.now() - 120000, type: "buy", totalValue: 0.003693, price: 0.037882, tokenAmount: 302.3413, ethAmount: 11.684753, address: "0xd056...dac1", label: "" },
  { id: "3", timestamp: Date.now() - 180000, type: "buy", totalValue: 0.00001, price: 0.037858, tokenAmount: 0.82783, ethAmount: 0.031348, address: "0x287a...294a", label: "" },
  { id: "4", timestamp: Date.now() - 240000, type: "sell", totalValue: 0.00000087, price: 0.037673, tokenAmount: 0.007218, ethAmount: 0.000272, address: "0x287a...294a", label: "" },
  { id: "5", timestamp: Date.now() - 300000, type: "sell", totalValue: 0.00112, price: 0.037689, tokenAmount: 92.233609, ethAmount: 3.543195, address: "0xe716...e985", label: "" },
  { id: "6", timestamp: Date.now() - 360000, type: "buy", totalValue: 0.00001, price: 0.037853, tokenAmount: 0.826865, ethAmount: 0.031308, address: "0x287a...294a", label: "" },
  { id: "7", timestamp: Date.now() - 420000, type: "buy", totalValue: 0.000199, price: 0.03782, tokenAmount: 16.339369, ethAmount: 0.61814, address: "0xfc36...8ad8", label: "" },
  { id: "8", timestamp: Date.now() - 480000, type: "buy", totalValue: 0.00000098, price: 0.0378, tokenAmount: 0.008039, ethAmount: 0.000304, address: "0x287a...294a", label: "" },
];

const mockLiquidity: LiquidityRecord[] = [
  { id: "1", timestamp: Date.now() - 60000, type: "add", totalValue: 0.067505, wethAmount: 0.000011, tokenAmount: 0.822185, address: "0x287a...294a" },
  { id: "2", timestamp: Date.now() - 120000, type: "add", totalValue: 0.0013425, wethAmount: 0.000484, tokenAmount: 0.022784, address: "0x287a...294a" },
  { id: "3", timestamp: Date.now() - 180000, type: "add", totalValue: 0.067633, wethAmount: 0.000011, tokenAmount: 0.822186, address: "0x287a...294a" },
  { id: "4", timestamp: Date.now() - 240000, type: "add", totalValue: 0.00188, wethAmount: 0.00000046, tokenAmount: 0.011464, address: "0x287a...294a" },
  { id: "5", timestamp: Date.now() - 300000, type: "add", totalValue: 0.067667, wethAmount: 0.000011, tokenAmount: 0.822985, address: "0x287a...294a" },
];

const mockHolders: HolderInfo[] = [
  { rank: 1, address: "0x4259...6164", tokenAmount: 5276800.07, percentage: 43.07, totalProfit: 0, profitPercent: 0, ethBalance: 0, holdTime: "1个月", netFlow: 0, buyTotal: 0, sellTotal: 0, tags: ["Top10"] },
  { rank: 2, address: "0x0efb...9009", tokenAmount: 1463714.868, percentage: 11.95, totalProfit: 0, profitPercent: 0, ethBalance: 0, holdTime: "1个月", netFlow: 0, buyTotal: 0, sellTotal: 0, tags: [] },
  { rank: 3, address: "0xe289...ee8a", tokenAmount: 1294633.737, percentage: 10.57, totalProfit: 0, profitPercent: 0, ethBalance: 0.516566, holdTime: "2个月", source: "Binance", netFlow: 0, buyTotal: 0, sellTotal: 0, tags: [] },
  { rank: 4, address: "0xfcdb...e268", tokenAmount: 450440.348, percentage: 3.69, totalProfit: 11.919139, profitPercent: 20.89, ethBalance: 0, holdTime: "1个月", netFlow: 0, buyTotal: 0, sellTotal: 0, tags: [] },
  { rank: 5, address: "Uniswap V2", tokenAmount: 170420.423, percentage: 1.39, totalProfit: 23.7963, profitPercent: 2168.33, ethBalance: 0, holdTime: "1个月", netFlow: 0, buyTotal: 0, sellTotal: 0, tags: [] },
  { rank: 6, address: "0xf8dd...809e", tokenAmount: 162652.434, percentage: 1.33, totalProfit: 0, profitPercent: 0, ethBalance: 0, holdTime: "2个月", netFlow: 0, buyTotal: 0, sellTotal: 0, tags: [] },
  { rank: 7, address: "Uniswap V3", tokenAmount: 140431.627, percentage: 1.15, totalProfit: -0.00422, profitPercent: -3.11, ethBalance: 0, holdTime: "7日", netFlow: 0, buyTotal: 0, sellTotal: 0, tags: [] },
];

// ========== Utility Functions ==========
function formatNumber(num: number, decimals = 2): string {
  if (num >= 1000000000) return (num / 1000000000).toFixed(decimals) + "B";
  if (num >= 1000000) return (num / 1000000).toFixed(decimals) + "M";
  if (num >= 1000) return (num / 1000).toFixed(decimals) + "K";
  return num.toFixed(decimals);
}

function formatPrice(price: number): string {
  if (price < 0.000001) return price.toFixed(10);
  if (price < 0.0001) return price.toFixed(8);
  if (price < 0.01) return price.toFixed(6);
  if (price < 1) return price.toFixed(4);
  return price.toFixed(2);
}

function formatTime(timestamp: number): string {
  const date = new Date(timestamp);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  const seconds = String(date.getSeconds()).padStart(2, "0");
  return `${year}/${month}/${day} ${hours}:${minutes}:${seconds}`;
}

function cn(...classes: (string | boolean | undefined)[]): string {
  return classes.filter(Boolean).join(" ");
}

// ========== Sub Components ==========

/** 代币头部信息 */
function TokenHeader({ token }: { token: TokenInfo }) {
  const [isStarred, setIsStarred] = useState(false);

  const copyAddress = () => {
    navigator.clipboard.writeText(token.address);
  };

  return (
    <div className="bg-black border-b border-[#1f1f1f]">
      {/* 顶部简要信息栏 */}
      <div className="h-8 px-4 flex items-center gap-2 text-xs text-[#8e8e93] border-b border-[#1f1f1f]">
        <button onClick={() => setIsStarred(!isStarred)} className="hover:text-white">
          <StarIcon filled={isStarred} className={isStarred ? "text-[#ffd700]" : ""} />
        </button>
        <span className="text-white font-bold">{token.symbol}</span>
        <span className="mx-1">—</span>
        <span>${formatNumber(token.marketCap)}</span>
        <span className={cn("ml-2", token.priceChange24h >= 0 ? "text-[#00c076]" : "text-[#ff5050]")}>
          {token.priceChange24h >= 0 ? "+" : ""}{token.priceChange24h.toFixed(2)}%
        </span>
      </div>

      {/* 主信息区 */}
      <div className="px-4 py-3 flex items-center justify-between">
        {/* 左侧: Token Identity */}
        <div className="flex items-center gap-3">
          {/* Token Logo */}
          <div className="relative">
            <div className="w-10 h-10 rounded-full bg-gradient-to-br from-purple-500 to-blue-500 flex items-center justify-center overflow-hidden border-2 border-[#333]">
              <img
                src={`https://api.dicebear.com/7.x/identicon/svg?seed=${token.symbol}`}
                alt={token.symbol}
                className="w-full h-full"
              />
            </div>
            {/* Chain Badge */}
            <div className="absolute -bottom-0.5 -right-0.5 bg-[#0052ff] rounded-full w-4 h-4 flex items-center justify-center text-[8px] font-bold text-white border border-black">
              B
            </div>
          </div>

          {/* Token Name & Address */}
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-white font-bold text-lg">{token.name}</h1>
              <span className="text-[#8e8e93] text-sm">{token.symbol}</span>
              <span className="text-[#00c076]">✓</span>
              <button onClick={copyAddress} className="text-[#636366] hover:text-white transition-colors">
                <CopyIcon />
              </button>
              <button className="bg-[#00c076]/20 text-[#00c076] px-2 py-0.5 rounded text-[10px] font-bold flex items-center gap-1">
                ⚡ AI 洞察
              </button>
            </div>
            <div className="flex items-center gap-2 mt-0.5 text-xs">
              <span className="text-[#8e8e93]">{token.address.slice(0, 6)}...{token.address.slice(-4)}</span>
              <button onClick={copyAddress} className="text-[#636366] hover:text-white">
                <CopyIcon className="w-3 h-3" />
              </button>
            </div>
          </div>
        </div>

        {/* 右侧: Price & Stats */}
        <div className="flex items-center gap-6">
          {/* Price */}
          <div className="text-right">
            <div className="text-white font-bold text-2xl font-mono">${formatPrice(token.price)}</div>
            <div className={cn("text-sm font-medium", token.priceChange24h >= 0 ? "text-[#00c076]" : "text-[#ff5050]")}>
              {token.priceChange24h >= 0 ? "+" : ""}{token.priceChange24h.toFixed(2)}%
            </div>
          </div>

          {/* Stats */}
          <div className="flex items-center gap-4 text-xs">
            <div className="text-center">
              <div className="text-[#8e8e93]">市值</div>
              <div className="text-white font-bold">${formatNumber(token.marketCap)}</div>
            </div>
            <div className="text-center">
              <div className="text-[#8e8e93]">流动性</div>
              <div className="text-white font-bold">${formatNumber(token.liquidity)}</div>
            </div>
            <div className="text-center">
              <div className="text-[#8e8e93]">持币地址</div>
              <div className="text-white font-bold">{formatNumber(token.holders, 0)}</div>
            </div>
            <div className="text-center">
              <div className="text-[#8e8e93]">风险</div>
              <div className="flex items-center gap-1">
                <span className="text-[#ffd700] font-bold">{token.riskScore}</span>
                <span className="text-[#ffd700]">🔥3</span>
              </div>
            </div>
          </div>

          {/* 热度评分 */}
          <div className="flex items-center gap-2 px-3 py-1.5 bg-[#1a1a1a] rounded-lg border border-[#333]">
            <span className="text-[#8e8e93] text-xs">𝕏 热度评分</span>
            <span className="text-[#00c076] font-bold">{token.riskScore}</span>
            <span className="text-[#ffd700]">🔥</span>
          </div>

          {/* Action Buttons */}
          <div className="flex items-center gap-2 text-[#8e8e93]">
            <button className="hover:text-white transition-colors p-1.5 hover:bg-[#1f1f1f] rounded">🔔</button>
            <button className="hover:text-white transition-colors p-1.5 hover:bg-[#1f1f1f] rounded">📤</button>
            <button className="hover:text-white transition-colors p-1.5 hover:bg-[#1f1f1f] rounded">
              <SettingsIcon />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/** K线图表区域 */
function TradingChart({ token }: { token: TokenInfo }) {
  const [timeframe, setTimeframe] = useState("1小时");
  const timeframes = ["1秒", "30秒", "1分", "1小时", "4小时", "1日"];

  return (
    <div className="flex-1 flex flex-col bg-[#131722] min-h-0">
      {/* 图表工具栏 */}
      <div className="h-10 px-3 flex items-center justify-between border-b border-[#2a2e39]">
        <div className="flex items-center gap-1">
          {/* 图表/社媒热度 切换 */}
          <div className="flex bg-[#1e222d] rounded p-0.5 mr-3">
            <button className="px-3 py-1 text-xs font-medium text-white bg-[#2a2e39] rounded">图表</button>
            <button className="px-3 py-1 text-xs font-medium text-[#787b86] hover:text-white">社媒热度</button>
          </div>

          {/* 时间周期 */}
          {timeframes.map((tf) => (
            <button
              key={tf}
              onClick={() => setTimeframe(tf)}
              className={cn(
                "px-2 py-1 text-xs rounded transition-all",
                timeframe === tf ? "text-white bg-[#2962ff]" : "text-[#787b86] hover:text-white hover:bg-[#2a2e39]"
              )}
            >
              {tf}
            </button>
          ))}
          <ChevronDownIcon className="text-[#787b86] ml-1" />
        </div>

        <div className="flex items-center gap-2 text-xs text-[#787b86]">
          <button className="flex items-center gap-1 hover:text-white">
            <ChartIcon className="w-3.5 h-3.5" />
            技术指标
          </button>
          <button className="flex items-center gap-1 hover:text-white">
            <SettingsIcon className="w-3.5 h-3.5" />
            显示设置
          </button>
          <div className="flex items-center gap-1 px-2 py-1 bg-[#1e222d] rounded">
            <input type="checkbox" className="w-3 h-3" />
            <span>多图表</span>
          </div>
          <button className="px-2 py-1 bg-white text-black font-bold rounded text-xs">价格</button>
          <button className="px-2 py-1 text-[#787b86] hover:text-white">市值</button>
        </div>
      </div>

      {/* OHLC Info Bar */}
      <div className="h-8 px-3 flex items-center gap-4 text-xs border-b border-[#2a2e39]">
        <span className="text-white font-bold">⚡ {token.symbol} · 1小时 · BASE</span>
        <span className="text-[#787b86]">开=<span className="text-white">0.037819</span></span>
        <span className="text-[#787b86]">高=<span className="text-[#26a69a]">0.038417</span></span>
        <span className="text-[#787b86]">低=<span className="text-[#ef5350]">0.037626</span></span>
        <span className="text-[#787b86]">收=<span className="text-white">0.037858</span></span>
        <span className={cn("px-1.5 py-0.5 rounded", token.priceChange24h >= 0 ? "text-[#26a69a] bg-[#26a69a]/10" : "text-[#ef5350] bg-[#ef5350]/10")}>
          {token.priceChange24h >= 0 ? "+" : ""}{token.priceChange24h.toFixed(2)}%
        </span>
        <span className="text-[#787b86]">成交量(Volume) <span className="text-[#26a69a]">36.18K</span></span>
      </div>

      {/* 图表占位区 - TradingView 集成 */}
      <div className="flex-1 relative bg-[#131722] min-h-[400px]">
        {/* TODO: Integrate TradingView Lightweight Charts */}
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="text-center">
            <ChartIcon className="w-16 h-16 text-[#2a2e39] mx-auto mb-3" />
            <p className="text-[#787b86] text-sm">K线图表加载中...</p>
            <p className="text-[#4a4a4a] text-xs mt-1">TODO: Integrate TradingView Lightweight Charts</p>
          </div>
        </div>

        {/* 右侧价格刻度 */}
        <div className="absolute right-0 top-0 bottom-0 w-16 flex flex-col justify-between py-4 text-right pr-2 text-xs text-[#787b86]">
          <span>0.05</span>
          <span>0.045</span>
          <span>0.04</span>
          <span className="text-white bg-[#2962ff] px-1 py-0.5 rounded">{formatPrice(token.price)}</span>
          <span>0.035</span>
        </div>

        {/* 底部时间刻度 */}
        <div className="absolute bottom-0 left-0 right-16 h-6 flex items-center justify-between px-8 text-xs text-[#787b86]">
          <span>7</span>
          <span>8</span>
          <span>9</span>
          <span>10</span>
          <span>11</span>
          <span>12</span>
          <span>13</span>
        </div>

        {/* Volume Bar Placeholder */}
        <div className="absolute bottom-6 left-0 right-16 h-12 flex items-end justify-around px-4 gap-1">
          {Array.from({ length: 30 }).map((_, i) => (
            <div
              key={i}
              className={cn(
                "w-2 rounded-t",
                i % 3 === 0 ? "bg-[#26a69a]/50" : "bg-[#ef5350]/50"
              )}
              style={{ height: `${20 + Math.random() * 80}%` }}
            />
          ))}
        </div>
      </div>

      {/* 底部时间信息 */}
      <div className="h-6 px-3 flex items-center justify-between text-xs text-[#787b86] border-t border-[#2a2e39]">
        <div className="flex items-center gap-4">
          <span>1日</span>
          <span>5日</span>
          <span>1月</span>
          <span>3月</span>
          <span>6月</span>
          <span>1年</span>
        </div>
        <div className="flex items-center gap-2">
          <span>10:13:34 UTC+8</span>
          <span>%</span>
          <span>log</span>
          <button className="text-white">自动</button>
        </div>
      </div>
    </div>
  );
}

/** 交易面板 - 买入/卖出 */
function SwapPanel({ token }: { token: TokenInfo }) {
  const [mode, setMode] = useState<"buy" | "sell">("buy");
  const [orderType, setOrderType] = useState<"market" | "limit">("market");
  const [amount, setAmount] = useState("");
  const [autoSell, setAutoSell] = useState(false);
  const balance = 0.000681;

  const quickAmounts = ["0.5", "1", "2", "3"];

  return (
    <div className="w-80 bg-black border-l border-[#1f1f1f] flex flex-col">
      {/* Buy/Sell Stats Header */}
      <div className="px-3 py-2 border-b border-[#1f1f1f] flex items-center justify-between text-xs">
        <div className="flex items-center gap-2">
          <span className="text-[#00c076]">买 <span className="font-bold">124/$3.38K</span></span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[#ff5050]">卖 <span className="font-bold">75/$4.60K</span></span>
        </div>
      </div>

      {/* Buy/Sell Toggle */}
      <div className="p-2">
        <div className="flex bg-[#131313] rounded-lg p-0.5">
          <button
            onClick={() => setMode("buy")}
            className={cn(
              "flex-1 py-2 text-sm font-bold rounded-md transition-all",
              mode === "buy" ? "bg-[#00c076] text-white" : "text-[#636366] hover:text-white"
            )}
          >
            买入
          </button>
          <button
            onClick={() => setMode("sell")}
            className={cn(
              "flex-1 py-2 text-sm font-bold rounded-md transition-all",
              mode === "sell" ? "bg-[#ff5050] text-white" : "text-[#636366] hover:text-white"
            )}
          >
            卖出
          </button>
        </div>
      </div>

      {/* Order Type Tabs */}
      <div className="px-3 flex gap-4 border-b border-[#1f1f1f]">
        <button
          onClick={() => setOrderType("market")}
          className={cn(
            "pb-2 text-sm font-medium relative",
            orderType === "market" ? "text-white" : "text-[#636366]"
          )}
        >
          市价
          {orderType === "market" && <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-white" />}
        </button>
        <button
          onClick={() => setOrderType("limit")}
          className={cn(
            "pb-2 text-sm font-medium relative flex items-center gap-1",
            orderType === "limit" ? "text-white" : "text-[#636366]"
          )}
        >
          限价 <InfoIcon />
          {orderType === "limit" && <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-white" />}
        </button>
      </div>

      {/* Amount Input */}
      <div className="p-3 space-y-3">
        {/* Balance */}
        <div className="flex justify-between text-xs">
          <span className="text-[#8e8e93]">余额:</span>
          <span className="text-white font-mono">{balance.toFixed(6)} ⚪</span>
        </div>

        {/* Input Field */}
        <div className="bg-[#131313] border border-[#1f1f1f] rounded-lg p-3 focus-within:border-[#00c076] transition-colors">
          <div className="flex items-center gap-2 mb-2">
            <span className="text-[#8e8e93] text-xs">数量</span>
            <InfoIcon className="text-[#636366]" />
          </div>
          <div className="flex items-center">
            <input
              type="text"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="请输入数量"
              className="flex-1 bg-transparent text-white text-lg font-bold outline-none placeholder:text-[#4a4a4a]"
            />
            <div className="flex items-center gap-1">
              <span className="text-white font-bold">ETH</span>
              <ChevronDownIcon className="text-[#8e8e93]" />
            </div>
          </div>
        </div>

        {/* Quick Amount Buttons */}
        <div className="flex gap-2">
          {quickAmounts.map((amt) => (
            <button
              key={amt}
              onClick={() => setAmount(amt)}
              className={cn(
                "flex-1 py-2 text-sm font-bold rounded-lg border transition-all",
                amount === amt
                  ? "bg-[#00c076]/20 border-[#00c076] text-[#00c076]"
                  : "bg-[#1a1a1a] border-[#1f1f1f] text-white hover:border-[#333]"
              )}
            >
              {amt}
            </button>
          ))}
          <button className="w-10 py-2 text-sm rounded-lg border border-[#1f1f1f] bg-[#1a1a1a] text-[#8e8e93] hover:border-[#333]">
            ✏️
          </button>
        </div>

        {/* Auto Sell Toggle */}
        <div className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={autoSell}
            onChange={(e) => setAutoSell(e.target.checked)}
            className="w-4 h-4 rounded bg-[#1f1f1f] border-[#333]"
          />
          <span className="text-[#8e8e93] text-xs">自动卖出</span>
        </div>

        {/* Submit Button */}
        <button className={cn(
          "w-full py-3 rounded-lg font-bold text-white transition-all",
          mode === "buy"
            ? "bg-[#00c076] hover:bg-[#00c076]/90"
            : "bg-[#ff5050] hover:bg-[#ff5050]/90"
        )}>
          买入 {token.symbol}
        </button>
      </div>

      {/* Presets */}
      <div className="px-3 pb-3 flex gap-2 text-xs">
        <button className="px-3 py-1.5 bg-[#1f1f1f] text-white rounded font-medium">默认</button>
        <button className="px-3 py-1.5 text-[#8e8e93] hover:text-white rounded flex items-center gap-1">
          🔥 Meme
        </button>
        <button className="px-3 py-1.5 text-[#8e8e93] hover:text-white rounded">Preset1</button>
        <button className="px-3 py-1.5 text-[#8e8e93] hover:text-white rounded">Preset2</button>
      </div>

      {/* Stats Footer */}
      <div className="mt-auto border-t border-[#1f1f1f] p-3 space-y-2 text-xs">
        <div className="flex items-center gap-2">
          <span className="text-[#8e8e93]">📊 动态</span>
          <span className="ml-auto text-[#8e8e93]">💱 市价</span>
        </div>

        <div className="grid grid-cols-4 gap-2 text-center">
          <div>
            <div className="text-[#8e8e93]">总买入</div>
            <div className="text-white font-bold">$0.00</div>
          </div>
          <div>
            <div className="text-[#8e8e93]">总卖出</div>
            <div className="text-white font-bold">$0.00</div>
          </div>
          <div>
            <div className="text-[#8e8e93]">余额</div>
            <div className="text-white font-bold">$0.00</div>
          </div>
          <div>
            <div className="text-[#8e8e93]">总收益</div>
            <div className="text-[#8e8e93]">$0.00(--)</div>
          </div>
        </div>

        <div className="flex justify-between items-center pt-2 border-t border-[#1f1f1f]">
          <div className="text-[#8e8e93]">
            1小时 总交额 <span className="text-white font-bold">$7.98K</span>
          </div>
          <div className="text-[#ff5050]">
            净交额 <span className="font-bold">-$1.23K</span>
          </div>
        </div>
      </div>

      {/* Detail & Similar Tabs */}
      <div className="border-t border-[#1f1f1f] p-3">
        <div className="flex gap-4 text-sm">
          <button className="text-white font-bold">详情</button>
          <button className="text-[#8e8e93]">相似代币</button>
        </div>
        <div className="mt-3 text-xs text-[#8e8e93]">
          <p className="mb-2">描述</p>
          <p className="text-[#636366] line-clamp-2">{token.description}</p>
        </div>

        <div className="mt-4 grid grid-cols-2 gap-3 text-xs">
          <div className="flex justify-between">
            <span className="text-[#8e8e93]">Top 10</span>
            <span className="text-[#ff5050] font-bold">74.22%</span>
          </div>
          <div className="flex justify-between">
            <span className="text-[#8e8e93]">老鼠仓</span>
            <span className="text-[#8e8e93]">--</span>
          </div>
          <div className="flex justify-between">
            <span className="text-[#8e8e93]">捆绑交易者</span>
            <span className="text-white">0.00%</span>
          </div>
          <div className="flex justify-between">
            <span className="text-[#8e8e93]">狙击手</span>
            <span className="text-[#8e8e93]">--</span>
          </div>
          <div className="flex justify-between">
            <span className="text-[#8e8e93]">流通供应量</span>
            <span className="text-white">999.99M</span>
          </div>
          <div className="flex justify-between">
            <span className="text-[#8e8e93]">烧池子</span>
            <span className="text-[#8e8e93]">--</span>
          </div>
          <div className="flex justify-between">
            <span className="text-[#8e8e93]">最大供应量</span>
            <span className="text-white">1B</span>
          </div>
          <div className="flex justify-between">
            <span className="text-[#8e8e93]">完全稀释估值</span>
            <span className="text-white">${formatNumber(token.marketCap)}</span>
          </div>
          <div className="flex justify-between col-span-2">
            <span className="text-[#8e8e93]">创建者</span>
            <span className="text-white font-mono text-[10px]">0x5996...f39e 📋</span>
          </div>
        </div>
      </div>
    </div>
  );
}

/** 交易活动表格 */
function TradeHistoryTable({ trades }: { trades: TradeRecord[] }) {
  const filters = ["全部", "关注地址", "KOL", "老鼠仓", "巨鲸", "狙击手", "疑似钓鱼地址", "聪明钱", "开发者", "Top 10 持币地址", "新钱包", "捆绑交易者"];
  const [activeFilter, setActiveFilter] = useState("全部");

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Filter Pills */}
      <div className="px-3 py-2 flex gap-2 overflow-x-auto border-b border-[#1f1f1f] scrollbar-hide">
        {filters.map((filter) => (
          <button
            key={filter}
            onClick={() => setActiveFilter(filter)}
            className={cn(
              "px-3 py-1 text-xs rounded-full whitespace-nowrap transition-all",
              activeFilter === filter
                ? "bg-white text-black font-bold"
                : "text-[#8e8e93] hover:text-white hover:bg-[#1f1f1f]"
            )}
          >
            {filter}
          </button>
        ))}
      </div>

      {/* Table */}
      <div className="flex-1 overflow-auto">
        <table className="w-full text-xs">
          <thead className="sticky top-0 bg-black">
            <tr className="text-[#636366] border-b border-[#1f1f1f]">
              <th className="py-2 px-3 text-left font-normal">时长 / 时间 ⇅ ▽</th>
              <th className="py-2 px-3 text-left font-normal">类型 ▽</th>
              <th className="py-2 px-3 text-right font-normal">总价值 ⇅ ▽</th>
              <th className="py-2 px-3 text-right font-normal">价格 ⇅ ▽</th>
              <th className="py-2 px-3 text-right font-normal">数量 ▽</th>
              <th className="py-2 px-3 text-left font-normal">地址 ▽</th>
              <th className="py-2 px-3 text-center font-normal">资金池</th>
              <th className="py-2 px-3 text-center font-normal">详情</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[#1f1f1f]/50">
            {trades.map((trade) => {
              const isBuy = trade.type === "buy";
              return (
                <tr key={trade.id} className="hover:bg-[#0f0f0f] transition-colors group">
                  <td className="py-2.5 px-3 text-[#8e8e93] whitespace-nowrap">
                    {formatTime(trade.timestamp)}
                  </td>
                  <td className="py-2.5 px-3">
                    <span className={cn(
                      "px-2 py-0.5 rounded text-[10px] font-bold",
                      isBuy ? "bg-[#00c076]/15 text-[#00c076]" : "bg-[#ff5050]/15 text-[#ff5050]"
                    )}>
                      {isBuy ? "买入" : "卖出"}
                    </span>
                  </td>
                  <td className={cn("py-2.5 px-3 text-right font-bold font-mono", isBuy ? "text-[#00c076]" : "text-[#ff5050]")}>
                    ${trade.totalValue.toFixed(6)}
                  </td>
                  <td className="py-2.5 px-3 text-right text-white font-mono">
                    ${formatPrice(trade.price)}
                  </td>
                  <td className="py-2.5 px-3 text-right">
                    <div className={cn("font-bold font-mono", isBuy ? "text-[#00c076]" : "text-[#ff5050]")}>
                      {isBuy ? "+" : "-"}{trade.tokenAmount.toFixed(4)} {mockToken.symbol}
                    </div>
                    <div className="text-[#636366] text-[10px] font-mono">
                      {isBuy ? "-" : "+"}{trade.ethAmount.toFixed(6)} USDC
                    </div>
                  </td>
                  <td className="py-2.5 px-3">
                    <div className="flex items-center gap-1.5">
                      <span className="text-white font-mono">{trade.address}</span>
                      <div className="flex gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                        <CopyIcon className="text-[#636366] cursor-pointer hover:text-white" />
                        <FilterIcon className="text-[#636366] cursor-pointer hover:text-white" />
                        <EyeIcon className="text-[#636366] cursor-pointer hover:text-white" />
                      </div>
                    </div>
                    {trade.label && (
                      <span className="text-[9px] text-[#ff9500] bg-[#ff9500]/10 px-1 py-0.5 rounded mt-0.5 inline-block">
                        {trade.label}
                      </span>
                    )}
                  </td>
                  <td className="py-2.5 px-3 text-center">
                    <div className="w-5 h-5 rounded-full bg-[#26a69a] mx-auto flex items-center justify-center text-[10px]">
                      🦄
                    </div>
                  </td>
                  <td className="py-2.5 px-3 text-center">
                    <a href="#" className="text-[#636366] hover:text-white">
                      <ExternalLinkIcon className="mx-auto" />
                    </a>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/** 流动性变化表格 */
function LiquidityTable({ records }: { records: LiquidityRecord[] }) {
  const [tab, setTab] = useState<"changes" | "pools">("changes");

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Sub Tabs */}
      <div className="px-3 py-2 flex gap-2 border-b border-[#1f1f1f]">
        <button
          onClick={() => setTab("changes")}
          className={cn(
            "px-3 py-1 text-xs rounded-full transition-all",
            tab === "changes" ? "bg-white text-black font-bold" : "text-[#8e8e93] hover:text-white"
          )}
        >
          流动性变化
        </button>
        <button
          onClick={() => setTab("pools")}
          className={cn(
            "px-3 py-1 text-xs rounded-full transition-all",
            tab === "pools" ? "bg-white text-black font-bold" : "text-[#8e8e93] hover:text-white"
          )}
        >
          流动性池
        </button>
        <div className="ml-auto flex items-center gap-2 text-xs text-[#8e8e93]">
          <span>总流动性: <span className="text-white font-bold">${formatNumber(mockToken.liquidity)}</span></span>
          <ChartIcon className="w-4 h-4" />
          <span>图表</span>
        </div>
      </div>

      {/* Table */}
      <div className="flex-1 overflow-auto">
        <table className="w-full text-xs">
          <thead className="sticky top-0 bg-black">
            <tr className="text-[#636366] border-b border-[#1f1f1f]">
              <th className="py-2 px-3 text-left font-normal">时长 / 时间 ⇅ ▽</th>
              <th className="py-2 px-3 text-left font-normal">类型 ▽</th>
              <th className="py-2 px-3 text-left font-normal">资金池 ▽</th>
              <th className="py-2 px-3 text-right font-normal">总价值 ▽</th>
              <th className="py-2 px-3 text-right font-normal">数量 ▽</th>
              <th className="py-2 px-3 text-left font-normal">地址 ▽</th>
              <th className="py-2 px-3 text-center font-normal">详情</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[#1f1f1f]/50">
            {records.map((record) => (
              <tr key={record.id} className="hover:bg-[#0f0f0f] transition-colors">
                <td className="py-2.5 px-3 text-[#8e8e93] whitespace-nowrap">
                  {formatTime(record.timestamp)}
                </td>
                <td className="py-2.5 px-3">
                  <span className={cn(
                    "px-2 py-0.5 rounded text-[10px] font-bold",
                    record.type === "add" ? "bg-[#00c076]/15 text-[#00c076]" : "bg-[#ff5050]/15 text-[#ff5050]"
                  )}>
                    添加
                  </span>
                </td>
                <td className="py-2.5 px-3">
                  <div className="w-5 h-5 rounded-full bg-[#26a69a] flex items-center justify-center text-[10px]">
                    🦄
                  </div>
                </td>
                <td className="py-2.5 px-3 text-right text-white font-mono font-bold">
                  ${record.totalValue.toFixed(6)}
                </td>
                <td className="py-2.5 px-3 text-right">
                  <div className="text-[#00c076] font-mono">+{record.wethAmount.toFixed(6)} WETH</div>
                  <div className="text-[#00c076] font-mono">+{record.tokenAmount.toFixed(6)} {mockToken.symbol}</div>
                </td>
                <td className="py-2.5 px-3">
                  <div className="flex items-center gap-1.5">
                    <span className="text-white font-mono">{record.address}</span>
                    <CopyIcon className="text-[#636366] cursor-pointer hover:text-white" />
                  </div>
                </td>
                <td className="py-2.5 px-3 text-center">
                  <ExternalLinkIcon className="mx-auto text-[#636366] hover:text-white cursor-pointer" />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/** 持币地址表格 */
function HoldersTable({ holders }: { holders: HolderInfo[] }) {
  const filters = ["全部", "关注地址", "KOL", "开发者", "聪明钱", "巨鲸", "新钱包", "老鼠仓", "狙击手", "疑似钓鱼地址", "捆绑交易者"];
  const [activeFilter, setActiveFilter] = useState("全部");

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Stats Bar */}
      <div className="px-3 py-2 flex items-center gap-6 border-b border-[#1f1f1f] text-xs">
        <div>
          <span className="text-[#8e8e93]">持币地址数 &gt;</span>
          <span className="text-white font-bold ml-2">{formatNumber(mockToken.holders, 0)}</span>
        </div>
        <div>
          <span className="text-[#8e8e93]">Top 100</span>
          <span className="text-white font-bold ml-2">88.03%</span>
        </div>
        <div>
          <span className="text-[#8e8e93]">平均持币金额</span>
          <span className="text-white font-bold ml-2">$2.45K</span>
        </div>
        <div>
          <span className="text-[#8e8e93]">持币金额 &gt; $10</span>
          <span className="text-white font-bold ml-2">2.98K(19.33%)</span>
        </div>
        <div>
          <span className="text-[#8e8e93]">开发者持仓占比</span>
          <span className="text-white font-bold ml-2">0%</span>
        </div>
      </div>

      {/* Filter Pills */}
      <div className="px-3 py-2 flex gap-2 overflow-x-auto border-b border-[#1f1f1f] scrollbar-hide">
        {filters.map((filter) => (
          <button
            key={filter}
            onClick={() => setActiveFilter(filter)}
            className={cn(
              "px-3 py-1 text-xs rounded-full whitespace-nowrap transition-all",
              activeFilter === filter
                ? "bg-white text-black font-bold"
                : "text-[#8e8e93] hover:text-white hover:bg-[#1f1f1f]"
            )}
          >
            {filter}
          </button>
        ))}
      </div>

      {/* Top 100 Stats */}
      <div className="px-3 py-2 flex items-center gap-4 text-xs border-b border-[#1f1f1f]">
        <span className="text-white font-bold">Top 100 88.03%</span>
        <span className="text-[#8e8e93]">前 100 持仓均价 <span className="text-[#00c076]">$0.0050768 (+646.19%)</span></span>
        <span className="text-[#8e8e93]">前 100 卖出均价 <span className="text-[#00c076]">$0.02097 (+80.65%)</span></span>
      </div>

      {/* Table */}
      <div className="flex-1 overflow-auto">
        <table className="w-full text-xs">
          <thead className="sticky top-0 bg-black">
            <tr className="text-[#636366] border-b border-[#1f1f1f]">
              <th className="py-2 px-3 text-left font-normal">排名</th>
              <th className="py-2 px-3 text-left font-normal">地址 ▽</th>
              <th className="py-2 px-3 text-right font-normal">持币金额 ▽</th>
              <th className="py-2 px-3 text-right font-normal">总收益 ▽</th>
              <th className="py-2 px-3 text-right font-normal">ETH 余额/创建时间</th>
              <th className="py-2 px-3 text-left font-normal">来源/时间</th>
              <th className="py-2 px-3 text-right font-normal">净流入 ▽</th>
              <th className="py-2 px-3 text-right font-normal">买入</th>
              <th className="py-2 px-3 text-right font-normal">卖出</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[#1f1f1f]/50">
            {holders.map((holder) => (
              <tr key={holder.rank} className="hover:bg-[#0f0f0f] transition-colors">
                <td className="py-2.5 px-3 text-white font-bold">{holder.rank}</td>
                <td className="py-2.5 px-3">
                  <div className="flex items-center gap-2">
                    <div className="w-6 h-6 rounded-full bg-gradient-to-br from-purple-500 to-pink-500" />
                    <div>
                      <div className="flex items-center gap-1">
                        <span className="text-white font-mono">{holder.address}</span>
                        <CopyIcon className="text-[#636366] cursor-pointer hover:text-white" />
                      </div>
                      <div className="flex gap-1 mt-0.5">
                        {holder.tags?.map((tag) => (
                          <span key={tag} className="text-[9px] text-[#ff5050] bg-[#ff5050]/10 px-1 py-0.5 rounded">
                            {tag}
                          </span>
                        ))}
                      </div>
                    </div>
                  </div>
                </td>
                <td className="py-2.5 px-3 text-right">
                  <div className="text-white font-bold font-mono">{formatNumber(holder.tokenAmount)}</div>
                  <div className="text-[#8e8e93]">{holder.percentage.toFixed(2)}%</div>
                </td>
                <td className="py-2.5 px-3 text-right">
                  {holder.totalProfit !== 0 ? (
                    <>
                      <div className={cn("font-bold", holder.profitPercent >= 0 ? "text-[#00c076]" : "text-[#ff5050]")}>
                        {holder.profitPercent >= 0 ? "+" : ""}{holder.totalProfit.toFixed(4)} ↗
                      </div>
                      <div className={cn(holder.profitPercent >= 0 ? "text-[#00c076]" : "text-[#ff5050]")}>
                        {holder.profitPercent >= 0 ? "+" : ""}{holder.profitPercent.toFixed(2)}%
                      </div>
                    </>
                  ) : (
                    <span className="text-[#636366]">--</span>
                  )}
                </td>
                <td className="py-2.5 px-3 text-right text-white font-mono">
                  {holder.ethBalance > 0 ? holder.ethBalance.toFixed(6) : "0"}
                  <div className="text-[#8e8e93]">{holder.holdTime}</div>
                </td>
                <td className="py-2.5 px-3">
                  {holder.source ? (
                    <div className="flex items-center gap-1">
                      <span className="text-[#ffd700]">⚪</span>
                      <span className="text-white">{holder.source}</span>
                    </div>
                  ) : (
                    <span className="text-[#636366]">--</span>
                  )}
                </td>
                <td className="py-2.5 px-3 text-right text-white font-mono">
                  {holder.netFlow !== 0 ? `$${formatNumber(holder.netFlow)}` : "$0.00"}
                  <div className="text-[#8e8e93]">0</div>
                </td>
                <td className="py-2.5 px-3 text-right text-white font-mono">
                  ${formatNumber(holder.buyTotal)}
                  <div className="text-[#8e8e93]">0笔交易</div>
                </td>
                <td className="py-2.5 px-3 text-right text-[#ff5050] font-mono">
                  ${formatNumber(holder.sellTotal)}
                  <div className="text-[#8e8e93]">0笔</div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ========== Main Component ==========
export function TokenDetailPage() {
  const [activeTab, setActiveTab] = useState("交易活动");
  const tabs = ["交易活动", "盈利地址", "持币地址", "关注地址", "流动性", "我的持仓", "我的订单"];

  return (
    <div className="min-h-screen bg-black text-white flex flex-col">
      {/* Token Header */}
      <TokenHeader token={mockToken} />

      {/* Main Content Area */}
      <div className="flex-1 flex overflow-hidden">
        {/* Left: Chart + Bottom Tabs */}
        <div className="flex-1 flex flex-col min-w-0">
          {/* Trading Chart */}
          <TradingChart token={mockToken} />

          {/* Bottom Tabs Section */}
          <div className="h-[350px] border-t border-[#1f1f1f] flex flex-col bg-black">
            {/* Tab Headers */}
            <div className="flex border-b border-[#1f1f1f] px-4">
              {tabs.map((tab) => (
                <button
                  key={tab}
                  onClick={() => setActiveTab(tab)}
                  className={cn(
                    "py-2.5 px-4 text-xs font-medium relative transition-colors",
                    activeTab === tab ? "text-white" : "text-[#636366] hover:text-[#8e8e93]"
                  )}
                >
                  {tab}
                  {tab === "持币地址" && (
                    <span className="ml-1 text-[#8e8e93]">({formatNumber(mockToken.holders, 0)})</span>
                  )}
                  {activeTab === tab && (
                    <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-[#00c076]" />
                  )}
                </button>
              ))}

              {/* Right Side Controls */}
              <div className="ml-auto flex items-center gap-2 text-xs">
                <span className="text-[#8e8e93]">USD / 币种</span>
                <button className="p-1.5 hover:bg-[#1f1f1f] rounded">
                  <MoreIcon className="text-[#8e8e93]" />
                </button>
                <button className="bg-[#00c076] text-white px-3 py-1.5 rounded font-bold flex items-center gap-1">
                  ⚡ 一键买卖
                </button>
              </div>
            </div>

            {/* Tab Content */}
            {activeTab === "交易活动" && <TradeHistoryTable trades={mockTrades} />}
            {activeTab === "流动性" && <LiquidityTable records={mockLiquidity} />}
            {activeTab === "持币地址" && <HoldersTable holders={mockHolders} />}
            {activeTab === "盈利地址" && (
              <div className="flex-1 flex items-center justify-center text-[#636366]">
                <div className="text-center">
                  <span className="text-5xl mb-2 block opacity-30">📈</span>
                  <p>盈利地址功能开发中...</p>
                </div>
              </div>
            )}
            {activeTab === "关注地址" && (
              <div className="flex-1 flex items-center justify-center text-[#636366]">
                <div className="text-center">
                  <span className="text-5xl mb-2 block opacity-30">👀</span>
                  <p>关注地址功能开发中...</p>
                </div>
              </div>
            )}
            {activeTab === "我的持仓" && (
              <div className="flex-1 flex items-center justify-center text-[#636366]">
                <div className="text-center">
                  <span className="text-5xl mb-2 block opacity-30">💼</span>
                  <p>请连接钱包查看持仓</p>
                </div>
              </div>
            )}
            {activeTab === "我的订单" && (
              <div className="flex-1 flex items-center justify-center text-[#636366]">
                <div className="text-center">
                  <span className="text-5xl mb-2 block opacity-30">📋</span>
                  <p>请连接钱包查看订单</p>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Right: Swap Panel */}
        <SwapPanel token={mockToken} />
      </div>

      {/* Bottom Status Bar */}
      <div className="h-9 border-t border-[#1f1f1f] bg-[#0a0a0a] flex items-center justify-between px-4 text-xs text-[#636366]">
        <div className="flex items-center gap-4">
          <button className="flex items-center gap-1 hover:text-white transition-colors">
            ⭐ 关注代币
          </button>
          <button className="flex items-center gap-1 hover:text-white transition-colors">
            𝕏 动态
          </button>
          <button className="flex items-center gap-1 hover:text-white transition-colors">
            🔥 热门
          </button>
          <button className="flex items-center gap-1 hover:text-white transition-colors">
            💼 持仓
          </button>
          <button className="flex items-center gap-1 hover:text-white transition-colors">
            👀 钱包追踪
          </button>
          <button className="flex items-center gap-1 hover:text-white transition-colors">
            📶 信号
          </button>
          <button className="flex items-center gap-1 hover:text-white transition-colors">
            📈 收益
          </button>
        </div>
        <div className="flex items-center gap-4">
          <span className="text-[#00d4ff]">🟢 $138.55</span>
          <span className="text-[#ff5050]">🔴 $110.63</span>
          <span className="text-[#00c076]">🟢 $3.09K</span>
          <span className="text-[#ffd700]">🟡 $902.15</span>
          <button className="flex items-center gap-1 hover:text-white transition-colors">
            🔊 声音设置
          </button>
          <button className="flex items-center gap-1 hover:text-white transition-colors">
            ❓ 常见问题
          </button>
          <span className="flex items-center gap-1 text-[#00c076]">
            <span className="w-1.5 h-1.5 rounded-full bg-[#00c076] animate-pulse" />
            网络稳定
          </span>
        </div>
      </div>
    </div>
  );
}

export default TokenDetailPage;
