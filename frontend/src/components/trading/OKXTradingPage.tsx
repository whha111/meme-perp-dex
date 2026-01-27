"use client";

import React, { useState, useEffect, useMemo, useCallback } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { formatUnits, type Address } from "viem";
import dynamic from 'next/dynamic';
import {
  Star,
  Copy,
  ExternalLink,
  ChevronDown,
  Settings,
  LayoutGrid,
  TrendingUp,
  TrendingDown,
  AlertTriangle,
  Zap,
  Wallet,
  BarChart3,
  Users,
  Activity,
  Eye,
  Droplets,
  Briefcase,
  FileText,
  Volume2,
  HelpCircle,
  MessageSquare,
  Twitter,
  Flame,
  RefreshCw,
  Search,
  Filter,
  ChevronRight,
  MoreHorizontal,
} from "lucide-react";
import { useAccount, useBalance } from "wagmi";
import { useConnectModal } from "@rainbow-me/rainbowkit";
import { useETHPrice, ETH_PRICE_FALLBACK } from "@/hooks/useETHPrice";

// 动态导入图表组件
const TokenPriceChart = dynamic(
  () => import('./TokenPriceChart').then((mod) => mod.TokenPriceChart),
  {
    ssr: false,
    loading: () => (
      <div className="w-full h-full bg-[#131722] flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-[#A3E635] border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }
);

// ============================================
// Types
// ============================================
interface TokenInfo {
  name: string;
  symbol: string;
  address: string;
  price: number;
  priceChange24h: number;
  marketCap: number;
  liquidity: number;
  holders: number;
  riskLevel: number;
  aiScore: number;
  volume24h: number;
  creatorAddress?: string;
  isGraduated?: boolean;
  soldSupply?: string;
  totalSupply?: string;
}

interface Trade {
  timestamp: number;
  type: "buy" | "sell";
  totalValue: string;
  price: string;
  tokenAmount: string;
  ethAmount: string;
  address: string;
  addressFull: string;
  pool: string;
  txHash: string;
  isNew?: boolean;
  tags?: string[];
}

interface Holder {
  rank: number;
  address: string;
  addressFull: string;
  balance: number;
  balanceFormatted: string;
  percentage: number;
  pnl?: number;
  pnlPercent?: number;
  ethBalance?: number;
  createdTime?: string;
  source?: string;
  netFlow?: number;
  buyAmount?: number;
  sellAmount?: number;
  tags?: string[];
}

interface LiquidityEvent {
  timestamp: number;
  type: "add" | "remove" | "single_remove";
  pool: string;
  totalValue: string;
  tokenAmount: string;
  ethAmount: string;
  address: string;
  txHash: string;
}

// ============================================
// Mock Data Generator
// ============================================
const generateMockTrades = (symbol: string, ethPrice: number = ETH_PRICE_FALLBACK): Trade[] => {
  const trades: Trade[] = [];
  const now = Date.now();

  for (let i = 0; i < 50; i++) {
    const isBuy = Math.random() > 0.4;
    const ethAmount = (Math.random() * 0.001).toFixed(8);
    const tokenAmount = (Math.random() * 5).toFixed(6);
    const price = (Math.random() * 0.0001 + 0.039).toFixed(6);

    trades.push({
      timestamp: now - i * 2000,
      type: isBuy ? "buy" : "sell",
      totalValue: `$${(parseFloat(ethAmount) * ethPrice).toFixed(2)}`,
      price: `$${price}`,
      tokenAmount: `${isBuy ? "+" : "-"}${tokenAmount} ${symbol}`,
      ethAmount: `${isBuy ? "-" : "+"}${ethAmount} WETH`,
      address: `0x${Math.random().toString(16).slice(2, 6)}...${Math.random().toString(16).slice(2, 6)}`,
      addressFull: `0x${Math.random().toString(16).slice(2, 42)}`,
      pool: Math.random() > 0.5 ? "VIRTUAL" : "WETH",
      txHash: `0x${Math.random().toString(16).slice(2, 66)}`,
      isNew: i === 0,
      tags: Math.random() > 0.8 ? ["🐋"] : Math.random() > 0.9 ? ["🎯"] : [],
    });
  }
  
  return trades;
};

const generateMockHolders = (): Holder[] => {
  const holders: Holder[] = [];
  let remaining = 100;
  
  for (let i = 0; i < 20; i++) {
    const percentage = i === 0 ? 43 : i === 1 ? 12 : i === 2 ? 10 : Math.random() * remaining / (20 - i);
    remaining -= percentage;
    
    holders.push({
      rank: i + 1,
      address: `0x${Math.random().toString(16).slice(2, 6)}...${Math.random().toString(16).slice(2, 6)}`,
      addressFull: `0x${Math.random().toString(16).slice(2, 42)}`,
      balance: Math.random() * 5000000,
      balanceFormatted: `${(Math.random() * 5000).toFixed(2)}M`,
      percentage: percentage,
      pnl: Math.random() > 0.5 ? Math.random() * 20 : -Math.random() * 15,
      pnlPercent: Math.random() > 0.5 ? Math.random() * 2000 : -Math.random() * 50,
      ethBalance: Math.random() * 2,
      createdTime: `${Math.floor(Math.random() * 3) + 1}个月`,
      source: Math.random() > 0.7 ? "Binance" : undefined,
      netFlow: 0,
      buyAmount: 0,
      sellAmount: 0,
      tags: i === 2 ? ["Binance"] : i < 3 ? [] : Math.random() > 0.8 ? ["🐋"] : [],
    });
  }
  
  return holders;
};

// ============================================
// Sub Components
// ============================================

// Token Header Component
function TokenHeader({ token, onCopyAddress }: { token: TokenInfo; onCopyAddress: () => void }) {
  const t = useTranslations();
  const isPositive = token.priceChange24h >= 0;
  
  return (
    <div className="flex items-center justify-between px-4 py-3 border-b border-[#1E1E1E] bg-[#0B0B0B]">
      {/* Left: Token Info */}
      <div className="flex items-center gap-4">
        {/* Token Icon & Name */}
        <div className="flex items-center gap-3">
          <Star className="w-4 h-4 text-[#636366] hover:text-[#FFD700] cursor-pointer transition-colors" />
          <div className="w-10 h-10 rounded-full bg-gradient-to-br from-purple-500 to-blue-500 flex items-center justify-center text-white font-bold">
            {token.symbol.charAt(0)}
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="text-white font-bold text-lg">{token.name}</span>
              <span className="text-[#636366] text-sm">{token.symbol}</span>
              <button className="text-[#636366] hover:text-white" onClick={onCopyAddress}>
                <Copy className="w-3.5 h-3.5" />
              </button>
              <ExternalLink className="w-3.5 h-3.5 text-[#636366] hover:text-white cursor-pointer" />
            </div>
            <div className="flex items-center gap-2 text-xs text-[#636366]">
              <span>55日</span>
              <span>{token.address.slice(0, 6)}...{token.address.slice(-4)}</span>
              <button 
                className="bg-[#A3E635]/10 text-[#A3E635] px-2 py-0.5 rounded text-[10px] font-medium flex items-center gap-1"
              >
                <Zap className="w-3 h-3" />
                AI洞察
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Center: Price & Change */}
      <div className="flex items-center gap-8">
        <div className="text-right">
          <div className="text-white text-2xl font-bold font-mono">${token.price.toFixed(6)}</div>
          <div className={`text-sm font-medium ${isPositive ? 'text-[#00D26A]' : 'text-[#FF3B30]'}`}>
            {isPositive ? '+' : ''}{token.priceChange24h.toFixed(2)}%
          </div>
        </div>
      </div>

      {/* Right: Stats */}
      <div className="flex items-center gap-6 text-sm">
        <div className="text-center">
          <div className="text-[#636366] text-xs mb-1">市值</div>
          <div className="text-white font-medium">${(token.marketCap / 1e6).toFixed(2)}M</div>
        </div>
        <div className="text-center">
          <div className="text-[#636366] text-xs mb-1">流动性</div>
          <div className="text-white font-medium">${(token.liquidity / 1e6).toFixed(2)}M</div>
        </div>
        <div className="text-center">
          <div className="text-[#636366] text-xs mb-1">持币地址</div>
          <div className="text-white font-medium">{(token.holders / 1000).toFixed(2)}K</div>
        </div>
        <div className="text-center">
          <div className="text-[#636366] text-xs mb-1">风险</div>
          <div className="flex items-center gap-1">
            <span className="text-[#FF9500]">🔶</span>
            <span className="text-[#FF9500] font-medium">{token.riskLevel}</span>
          </div>
        </div>
        
        {/* Action Buttons */}
        <div className="flex items-center gap-2 ml-4">
          <button className="p-2 hover:bg-[#1E1E1E] rounded-lg transition-colors">
            <Star className="w-4 h-4 text-[#636366]" />
          </button>
          <button className="p-2 hover:bg-[#1E1E1E] rounded-lg transition-colors">
            <ExternalLink className="w-4 h-4 text-[#636366]" />
          </button>
          <button className="p-2 hover:bg-[#1E1E1E] rounded-lg transition-colors">
            <MoreHorizontal className="w-4 h-4 text-[#636366]" />
          </button>
        </div>
      </div>
    </div>
  );
}

// AI Score Badge
function AIScoreBadge({ score }: { score: number }) {
  return (
    <div className="bg-[#1E1E1E] rounded-lg p-3">
      <div className="flex items-center gap-2 mb-2">
        <Zap className="w-4 h-4 text-[#A3E635]" />
        <span className="text-[#636366] text-xs">热度评分</span>
      </div>
      <div className="flex items-center gap-2">
        <span className="text-white text-xl font-bold">{score.toFixed(2)}</span>
        <span className="text-[#FFB800]">🔥</span>
      </div>
    </div>
  );
}

// Swap Panel Component (Right Side)
function SwapPanel({ 
  token, 
  isConnected, 
  onConnect 
}: { 
  token: TokenInfo;
  isConnected: boolean;
  onConnect: () => void;
}) {
  const [mode, setMode] = useState<"buy" | "sell">("buy");
  const [amount, setAmount] = useState("");
  const [ethBalance, setEthBalance] = useState(0.000681);
  const [slippage, setSlippage] = useState(1);
  const [showSlippageSettings, setShowSlippageSettings] = useState(false);
  const [autoSell, setAutoSell] = useState(false);
  const [preset, setPreset] = useState<"default" | "meme" | "preset1" | "preset2">("default");

  const presetAmounts = [0.5, 1, 2, 3];

  return (
    <div className="bg-[#0B0B0B] rounded-xl border border-[#1E1E1E] overflow-hidden">
      {/* AI Score */}
      <AIScoreBadge score={47.30} />
      
      {/* Buy/Sell Toggle */}
      <div className="flex p-1 mx-3 mt-3 bg-[#1E1E1E] rounded-lg">
        <button
          onClick={() => setMode("buy")}
          className={`flex-1 py-2 text-sm font-bold rounded-md transition-all ${
            mode === "buy" 
              ? "bg-[#00D26A] text-black" 
              : "text-[#636366] hover:text-white"
          }`}
        >
          买入
        </button>
        <button
          onClick={() => setMode("sell")}
          className={`flex-1 py-2 text-sm font-bold rounded-md transition-all ${
            mode === "sell" 
              ? "bg-[#FF3B30] text-white" 
              : "text-[#636366] hover:text-white"
          }`}
        >
          卖出
        </button>
      </div>

      {/* Price Type Toggle */}
      <div className="flex items-center gap-4 px-3 mt-4 text-sm">
        <button className="text-white font-medium border-b-2 border-[#A3E635] pb-1">市价</button>
        <button className="text-[#636366] hover:text-white pb-1">限价</button>
        <div className="flex-1" />
        <div className="flex items-center gap-1 text-[#636366] text-xs">
          <span>余额:</span>
          <span className="text-white font-mono">{ethBalance.toFixed(6)}</span>
          <div className="w-4 h-4 rounded-full bg-[#627EEA] flex items-center justify-center">
            <span className="text-[8px] text-white">Ξ</span>
          </div>
        </div>
      </div>

      {/* Amount Input */}
      <div className="px-3 mt-3">
        <div className="bg-[#1E1E1E] rounded-lg p-3">
          <div className="flex items-center justify-between mb-2">
            <span className="text-[#636366] text-xs">数量</span>
            <div className="flex items-center gap-1">
              <span className="text-[#636366] text-xs">请输入数量</span>
              <button className="bg-[#2A2A2A] text-[#636366] px-2 py-0.5 rounded text-xs flex items-center gap-1">
                ETH
                <ChevronDown className="w-3 h-3" />
              </button>
            </div>
          </div>
          <input
            type="text"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="0"
            className="w-full bg-transparent text-white text-xl font-mono outline-none"
          />
        </div>

        {/* Preset Amounts */}
        <div className="flex gap-2 mt-2">
          {presetAmounts.map((preset) => (
            <button
              key={preset}
              onClick={() => setAmount(preset.toString())}
              className="flex-1 py-2 bg-[#1E1E1E] hover:bg-[#2A2A2A] text-white text-sm rounded-lg transition-colors"
            >
              {preset}
            </button>
          ))}
          <button className="px-3 py-2 bg-[#1E1E1E] hover:bg-[#2A2A2A] text-[#636366] rounded-lg">
            <Settings className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Auto Sell Toggle */}
      <div className="px-3 mt-3 flex items-center gap-2">
        <input
          type="checkbox"
          id="autoSell"
          checked={autoSell}
          onChange={(e) => setAutoSell(e.target.checked)}
          className="w-4 h-4 rounded border-[#333] bg-[#1E1E1E] accent-[#A3E635]"
        />
        <label htmlFor="autoSell" className="text-[#636366] text-sm">自动卖出</label>
        <div className="text-[#636366] text-xs">- - - - - - -</div>
      </div>

      {/* Submit Button */}
      <div className="px-3 mt-4">
        {isConnected ? (
          <button
            className={`w-full py-3 rounded-lg font-bold text-sm transition-colors ${
              mode === "buy"
                ? "bg-[#00D26A]/20 text-[#00D26A] hover:bg-[#00D26A]/30"
                : "bg-[#FF3B30]/20 text-[#FF3B30] hover:bg-[#FF3B30]/30"
            }`}
          >
            {mode === "buy" ? `买入 ${token.symbol}` : `卖出 ${token.symbol}`}
          </button>
        ) : (
          <button
            onClick={onConnect}
            className="w-full py-3 bg-[#A3E635] text-black rounded-lg font-bold text-sm hover:bg-[#8BC926] transition-colors"
          >
            连接钱包
          </button>
        )}
      </div>

      {/* Presets */}
      <div className="flex gap-1 px-3 mt-4 text-xs">
        {["默认", "Meme", "Preset1", "Preset2", "P..."].map((p, i) => (
          <button
            key={p}
            className={`px-3 py-1.5 rounded transition-colors ${
              i === 0 ? "bg-[#A3E635] text-black font-bold" : "bg-[#1E1E1E] text-[#636366] hover:text-white"
            }`}
          >
            {p}
          </button>
        ))}
        <button className="px-2 py-1.5 text-[#636366]">
          <ChevronRight className="w-4 h-4" />
        </button>
      </div>

      {/* Quick Actions */}
      <div className="flex items-center gap-4 px-3 mt-4 text-xs text-[#636366]">
        <button className="flex items-center gap-1 hover:text-white">
          <Activity className="w-3 h-3" />
          动态
        </button>
        <button className="flex items-center gap-1 hover:text-white">
          <TrendingUp className="w-3 h-3" />
          市价
        </button>
        <ChevronRight className="w-3 h-3" />
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-4 gap-2 px-3 mt-4 text-xs">
        <div className="text-center">
          <div className="text-[#636366]">总买入</div>
          <div className="text-white font-mono">$0.00</div>
        </div>
        <div className="text-center">
          <div className="text-[#636366]">总卖出</div>
          <div className="text-white font-mono">$0.00</div>
        </div>
        <div className="text-center">
          <div className="text-[#636366]">余额</div>
          <div className="text-white font-mono">$0.00</div>
        </div>
        <div className="text-center">
          <div className="text-[#636366]">总收益</div>
          <div className="text-white font-mono">$0.00(--)</div>
        </div>
      </div>

      {/* Trade Stats */}
      <div className="px-3 mt-4 py-3 border-t border-[#1E1E1E]">
        <div className="flex items-center justify-between text-xs mb-2">
          <span className="text-[#636366]">1小时 总成交额</span>
          <span className="text-white font-mono">$9.52K</span>
        </div>
        <div className="flex items-center justify-between text-xs">
          <span className="text-[#636366]">净成交额</span>
          <span className="text-[#00D26A] font-mono">+$2.80K</span>
        </div>
      </div>

      {/* Buy/Sell Summary */}
      <div className="flex items-center justify-between px-3 py-3 bg-[#1E1E1E] mx-3 rounded-lg mb-3">
        <div className="flex items-center gap-2">
          <span className="text-[#00D26A] text-xs">买</span>
          <span className="text-white text-sm font-mono">272/$6.16K</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[#FF3B30] text-sm font-mono">76/$3.36K</span>
          <span className="text-[#FF3B30] text-xs">卖</span>
        </div>
      </div>

      {/* Details Section */}
      <div className="px-3 pb-4">
        <div className="flex items-center gap-4 text-sm border-b border-[#1E1E1E] pb-2 mb-3">
          <button className="text-white font-medium">详情</button>
          <button className="text-[#636366] hover:text-white">相似代币</button>
        </div>
        
        <div className="text-[#636366] text-xs mb-4">
          {token.name} is building a network for AI training data collection and verification...
        </div>

        {/* Holder Distribution */}
        <div className="grid grid-cols-3 gap-2 text-center text-xs">
          <div className="bg-[#1E1E1E] rounded-lg p-2">
            <div className="text-[#636366] mb-1">Top 10</div>
            <div className="text-[#FF3B30] font-bold">🔻 73.54%</div>
          </div>
          <div className="bg-[#1E1E1E] rounded-lg p-2">
            <div className="text-[#636366] mb-1">老鼠仓</div>
            <div className="text-[#00D26A]">🟢 --</div>
          </div>
          <div className="bg-[#1E1E1E] rounded-lg p-2">
            <div className="text-[#636366] mb-1">开发者</div>
            <div className="text-[#00D26A]">🟢 --</div>
          </div>
        </div>

        <div className="grid grid-cols-3 gap-2 text-center text-xs mt-2">
          <div className="bg-[#1E1E1E] rounded-lg p-2">
            <div className="text-[#636366] mb-1">捆绑交易者</div>
            <div className="text-[#00D26A]">🟢 0.00%</div>
          </div>
          <div className="bg-[#1E1E1E] rounded-lg p-2">
            <div className="text-[#636366] mb-1">狙击手</div>
            <div className="text-white">🟢 --</div>
          </div>
          <div className="bg-[#1E1E1E] rounded-lg p-2">
            <div className="text-[#636366] mb-1">烧池子</div>
            <div className="text-white">🟢 --</div>
          </div>
        </div>

        {/* Supply Info */}
        <div className="mt-4 space-y-2 text-xs">
          <div className="flex justify-between">
            <span className="text-[#636366]">流通供应量</span>
            <span className="text-white font-mono">999.99M</span>
          </div>
          <div className="flex justify-between">
            <span className="text-[#636366]">最大供应量</span>
            <span className="text-white font-mono">1B</span>
          </div>
          <div className="flex justify-between">
            <span className="text-[#636366]">完全稀释估值</span>
            <span className="text-white font-mono">${(token.marketCap / 1e6).toFixed(2)}M</span>
          </div>
          <div className="flex justify-between">
            <span className="text-[#636366]">创建者</span>
            <span className="text-white font-mono flex items-center gap-1">
              {token.creatorAddress?.slice(0, 6)}...{token.creatorAddress?.slice(-4)}
              <Copy className="w-3 h-3 text-[#636366] cursor-pointer hover:text-white" />
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

// Trade Activity Tab Component
function TradeActivityTab({ trades, symbol }: { trades: Trade[]; symbol: string }) {
  const [filter, setFilter] = useState("all");
  
  const filters = [
    { key: "all", label: "全部" },
    { key: "watched", label: "关注地址" },
    { key: "kol", label: "KOL" },
    { key: "rathole", label: "老鼠仓" },
    { key: "whale", label: "巨鲸" },
    { key: "sniper", label: "狙击手" },
    { key: "phishing", label: "疑似钓鱼地址" },
    { key: "smart", label: "聪明钱" },
    { key: "dev", label: "开发者" },
    { key: "top10", label: "Top 10 持币地址" },
    { key: "newWallet", label: "新钱包" },
    { key: "bundler", label: "捆绑交易者" },
  ];

  return (
    <div className="flex flex-col h-full">
      {/* Filters */}
      <div className="flex flex-wrap gap-2 p-3 border-b border-[#1E1E1E]">
        {filters.map((f) => (
          <button
            key={f.key}
            onClick={() => setFilter(f.key)}
            className={`px-3 py-1 rounded text-xs transition-colors ${
              filter === f.key
                ? "bg-[#2A2A2A] text-white"
                : "text-[#636366] hover:text-white hover:bg-[#1E1E1E]"
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {/* Table Header */}
      <div className="grid grid-cols-8 gap-2 px-4 py-2 text-xs text-[#636366] border-b border-[#1E1E1E] bg-[#0B0B0B] sticky top-0">
        <div className="flex items-center gap-1">
          时长 / 时间
          <ChevronDown className="w-3 h-3" />
        </div>
        <div className="flex items-center gap-1">
          类型
          <ChevronDown className="w-3 h-3" />
        </div>
        <div className="flex items-center gap-1">
          总价值
          <ChevronDown className="w-3 h-3" />
        </div>
        <div className="flex items-center gap-1">
          价格
          <ChevronDown className="w-3 h-3" />
        </div>
        <div className="flex items-center gap-1">
          数量
          <ChevronDown className="w-3 h-3" />
        </div>
        <div className="flex items-center gap-1">
          地址
          <ChevronDown className="w-3 h-3" />
        </div>
        <div>资金池</div>
        <div>详情</div>
      </div>

      {/* Table Body */}
      <div className="flex-1 overflow-y-auto">
        {trades.map((trade, index) => {
          const timeAgo = Math.floor((Date.now() - trade.timestamp) / 1000);
          const timeStr = timeAgo < 60 
            ? `${timeAgo}秒` 
            : timeAgo < 3600 
              ? `${Math.floor(timeAgo / 60)}分` 
              : `${Math.floor(timeAgo / 3600)}时`;
          
          return (
            <div
              key={index}
              className={`grid grid-cols-8 gap-2 px-4 py-2.5 text-xs border-b border-[#1E1E1E] hover:bg-[#1E1E1E] transition-colors ${
                trade.isNew ? "bg-[#00D26A]/5 animate-pulse" : ""
              }`}
            >
              <div className="text-[#636366] font-mono">
                {new Date(trade.timestamp).toLocaleTimeString("zh-CN", {
                  hour: "2-digit",
                  minute: "2-digit",
                  second: "2-digit",
                })}
              </div>
              <div>
                <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                  trade.type === "buy" 
                    ? "bg-[#00D26A]/20 text-[#00D26A]" 
                    : "bg-[#FF3B30]/20 text-[#FF3B30]"
                }`}>
                  {trade.type === "buy" ? "买入" : "卖出"}
                </span>
              </div>
              <div className="text-white font-mono flex items-center gap-1">
                <span className={trade.type === "buy" ? "text-[#00D26A]" : "text-[#FF3B30]"}>●</span>
                {trade.totalValue}
              </div>
              <div className="text-white font-mono">{trade.price}</div>
              <div>
                <div className={`font-mono ${trade.type === "buy" ? "text-[#00D26A]" : "text-[#FF3B30]"}`}>
                  {trade.tokenAmount}
                </div>
                <div className="text-[#636366] font-mono text-[10px]">{trade.ethAmount}</div>
              </div>
              <div className="flex items-center gap-1">
                <span className="text-white font-mono">{trade.address}</span>
                {trade.tags?.map((tag, i) => (
                  <span key={i} className="text-[10px]">{tag}</span>
                ))}
                <Copy className="w-3 h-3 text-[#636366] hover:text-white cursor-pointer" />
                <Eye className="w-3 h-3 text-[#636366] hover:text-white cursor-pointer" />
                <Filter className="w-3 h-3 text-[#636366] hover:text-white cursor-pointer" />
              </div>
              <div className="flex items-center gap-1">
                <div className={`w-4 h-4 rounded-full flex items-center justify-center text-[8px] ${
                  trade.pool === "VIRTUAL" ? "bg-pink-500" : "bg-[#627EEA]"
                }`}>
                  {trade.pool === "VIRTUAL" ? "V" : "Ξ"}
                </div>
              </div>
              <div>
                <ExternalLink className="w-3.5 h-3.5 text-[#636366] hover:text-white cursor-pointer" />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// Holders Tab Component
function HoldersTab({ holders, symbol }: { holders: Holder[]; symbol: string }) {
  const [filter, setFilter] = useState("all");
  
  const filters = [
    { key: "all", label: "全部" },
    { key: "watched", label: "关注地址" },
    { key: "kol", label: "KOL" },
    { key: "dev", label: "开发者" },
    { key: "newWallet", label: "新钱包" },
    { key: "whale", label: "巨鲸" },
    { key: "rathole", label: "老鼠仓" },
    { key: "sniper", label: "狙击手" },
    { key: "phishing", label: "疑似钓鱼地址" },
    { key: "smart", label: "聪明钱" },
    { key: "top10", label: "Top 10 持币地址" },
    { key: "bundler", label: "捆绑交易者" },
  ];

  // Stats
  const stats = {
    totalHolders: 15390,
    top100Percent: 87.35,
    avgHolding: 2570,
    holdersAbove10: 3010,
    holdersAbove10Percent: 19.6,
    devHoldingPercent: 0,
  };

  return (
    <div className="flex flex-col h-full">
      {/* Stats Row */}
      <div className="flex items-center gap-8 px-4 py-3 border-b border-[#1E1E1E] text-xs">
        <div>
          <span className="text-[#636366]">持币地址数</span>
          <div className="text-white font-bold text-lg mt-1 flex items-center gap-2">
            {(stats.totalHolders / 1000).toFixed(2)}K
            <span className="text-[#00D26A] text-xs">↗</span>
          </div>
        </div>
        <div>
          <span className="text-[#636366]">Top 100</span>
          <div className="text-white font-bold text-lg mt-1">{stats.top100Percent}%</div>
        </div>
        <div>
          <span className="text-[#636366]">平均持币金额</span>
          <div className="text-white font-bold text-lg mt-1">${stats.avgHolding.toLocaleString()}</div>
        </div>
        <div>
          <span className="text-[#636366]">持币金额 &gt; $10</span>
          <div className="text-white font-bold text-lg mt-1 flex items-center gap-1">
            {(stats.holdersAbove10 / 1000).toFixed(2)}K
            <span className="text-[#636366] text-xs">({stats.holdersAbove10Percent}%)</span>
            <span className="text-[#636366]">^</span>
          </div>
        </div>
        <div>
          <span className="text-[#636366]">开发者持仓占比</span>
          <div className="text-white font-bold text-lg mt-1">{stats.devHoldingPercent}%</div>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-2 p-3 border-b border-[#1E1E1E]">
        {filters.map((f) => (
          <button
            key={f.key}
            onClick={() => setFilter(f.key)}
            className={`px-3 py-1 rounded text-xs transition-colors ${
              filter === f.key
                ? "bg-[#2A2A2A] text-white"
                : "text-[#636366] hover:text-white hover:bg-[#1E1E1E]"
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {/* Summary Stats */}
      <div className="flex items-center gap-4 px-4 py-2 text-xs border-b border-[#1E1E1E] bg-[#0B0B0B]">
        <span className="text-[#636366]">Top 100 <span className="text-white">87.35%</span></span>
        <span className="text-[#636366]">前 100 持仓均价 <span className="text-[#00D26A]">$0.0050729 (+680.83%)</span></span>
        <span className="text-[#636366]">前 100 卖出均价 <span className="text-[#00D26A]">$0.020923 (+89.31%)</span></span>
      </div>

      {/* Table Header */}
      <div className="grid grid-cols-10 gap-2 px-4 py-2 text-xs text-[#636366] border-b border-[#1E1E1E] bg-[#0B0B0B] sticky top-0">
        <div>排名</div>
        <div className="flex items-center gap-1">地址 <ChevronDown className="w-3 h-3" /></div>
        <div className="flex items-center gap-1">持币金额 <ChevronDown className="w-3 h-3" /></div>
        <div className="flex items-center gap-1">总收益 <ChevronDown className="w-3 h-3" /></div>
        <div>ETH 余额/创建时间</div>
        <div>来源/时间</div>
        <div className="flex items-center gap-1">净流入 <ChevronDown className="w-3 h-3" /></div>
        <div>买入</div>
        <div>卖</div>
        <div></div>
      </div>

      {/* Table Body */}
      <div className="flex-1 overflow-y-auto">
        {holders.map((holder, index) => (
          <div
            key={index}
            className="grid grid-cols-10 gap-2 px-4 py-2.5 text-xs border-b border-[#1E1E1E] hover:bg-[#1E1E1E] transition-colors"
          >
            <div className="text-[#636366] font-bold">{holder.rank}</div>
            <div className="flex items-center gap-1">
              <div className="w-6 h-6 rounded bg-gradient-to-br from-purple-500 to-pink-500" />
              <span className="text-white font-mono">{holder.address}</span>
              {holder.tags?.map((tag, i) => (
                <span key={i} className="text-[10px] bg-[#FFB800]/20 text-[#FFB800] px-1 rounded">{tag}</span>
              ))}
              <Copy className="w-3 h-3 text-[#636366] hover:text-white cursor-pointer" />
              <Eye className="w-3 h-3 text-[#636366] hover:text-white cursor-pointer" />
            </div>
            <div>
              <div className="flex items-center gap-1">
                <span className="text-[#627EEA] text-[10px]">●</span>
                <span className="text-white font-mono">{holder.balanceFormatted}</span>
              </div>
              <div className="text-[#636366]">{holder.percentage.toFixed(2)}%</div>
            </div>
            <div>
              {holder.pnl !== undefined && (
                <>
                  <div className={`font-mono ${holder.pnl >= 0 ? "text-[#00D26A]" : "text-[#FF3B30]"}`}>
                    {holder.pnl >= 0 ? "+" : ""}{holder.pnl.toFixed(2)}
                  </div>
                  <div className={`text-[10px] ${holder.pnlPercent && holder.pnlPercent >= 0 ? "text-[#00D26A]" : "text-[#FF3B30]"}`}>
                    {holder.pnlPercent && holder.pnlPercent >= 0 ? "+" : ""}{holder.pnlPercent?.toFixed(2)}%
                  </div>
                </>
              )}
              {holder.pnl === undefined && <span className="text-[#636366]">--</span>}
            </div>
            <div className="text-[#636366]">
              <div>{holder.ethBalance?.toFixed(2) || 0}</div>
              <div>{holder.createdTime}</div>
            </div>
            <div className="text-[#636366]">
              {holder.source ? (
                <span className="flex items-center gap-1">
                  <span className="text-[#FFB800]">●</span> {holder.source}
                </span>
              ) : "--"}
            </div>
            <div className="text-[#636366]">
              {holder.netFlow || 0}
            </div>
            <div className="text-[#00D26A] font-mono">
              ${holder.buyAmount?.toFixed(2) || "0.00"}
              <div className="text-[#636366] text-[10px]">0 笔交易</div>
            </div>
            <div className="text-[#FF3B30] font-mono">
              ${holder.sellAmount?.toFixed(2) || "0.00"}
              <div className="text-[#636366] text-[10px]">0 笔</div>
            </div>
            <div>
              <ExternalLink className="w-3.5 h-3.5 text-[#636366] hover:text-white cursor-pointer" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// Liquidity Tab Component
function LiquidityTab({ events }: { events: LiquidityEvent[] }) {
  const [view, setView] = useState<"changes" | "pools">("changes");
  const totalLiquidity = 1890000; // $1.89M

  // Generate mock liquidity events
  const mockEvents: LiquidityEvent[] = Array(20).fill(null).map((_, i) => ({
    timestamp: Date.now() - i * 60000,
    type: Math.random() > 0.9 ? "single_remove" : "add",
    pool: Math.random() > 0.5 ? "VIRTUAL" : "WETH",
    totalValue: `$${(Math.random() * 1).toFixed(5)}`,
    tokenAmount: `+${(Math.random() * 4).toFixed(6)} REPPO`,
    ethAmount: `+${(Math.random() * 0.001).toFixed(6)} WETH`,
    address: `0x${Math.random().toString(16).slice(2, 6)}...${Math.random().toString(16).slice(2, 6)}`,
    txHash: `0x${Math.random().toString(16).slice(2, 66)}`,
  }));

  return (
    <div className="flex flex-col h-full">
      {/* View Toggle & Stats */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-[#1E1E1E]">
        <div className="flex gap-2">
          <button
            onClick={() => setView("changes")}
            className={`px-4 py-1.5 rounded text-xs font-medium transition-colors ${
              view === "changes"
                ? "bg-[#2A2A2A] text-white"
                : "text-[#636366] hover:text-white"
            }`}
          >
            流动性变化
          </button>
          <button
            onClick={() => setView("pools")}
            className={`px-4 py-1.5 rounded text-xs font-medium transition-colors ${
              view === "pools"
                ? "bg-[#2A2A2A] text-white"
                : "text-[#636366] hover:text-white"
            }`}
          >
            流动性池
          </button>
        </div>
        <div className="flex items-center gap-4 text-xs">
          <span className="text-[#636366]">总流动性:</span>
          <span className="text-white font-bold">${(totalLiquidity / 1e6).toFixed(2)}M</span>
          <button className="flex items-center gap-1 text-[#636366] hover:text-white">
            <BarChart3 className="w-4 h-4" />
            图表
          </button>
        </div>
      </div>

      {/* Table Header */}
      <div className="grid grid-cols-7 gap-2 px-4 py-2 text-xs text-[#636366] border-b border-[#1E1E1E] bg-[#0B0B0B] sticky top-0">
        <div className="flex items-center gap-1">
          时长 / 时间
          <ChevronDown className="w-3 h-3" />
        </div>
        <div className="flex items-center gap-1">
          类型
          <ChevronDown className="w-3 h-3" />
        </div>
        <div>资金池</div>
        <div className="flex items-center gap-1">
          总价值
          <ChevronDown className="w-3 h-3" />
        </div>
        <div>数量</div>
        <div className="flex items-center gap-1">
          地址
          <ChevronDown className="w-3 h-3" />
        </div>
        <div>详情</div>
      </div>

      {/* Table Body */}
      <div className="flex-1 overflow-y-auto">
        {mockEvents.map((event, index) => (
          <div
            key={index}
            className="grid grid-cols-7 gap-2 px-4 py-2.5 text-xs border-b border-[#1E1E1E] hover:bg-[#1E1E1E] transition-colors"
          >
            <div className="text-[#636366] font-mono">
              {new Date(event.timestamp).toLocaleTimeString("zh-CN", {
                hour: "2-digit",
                minute: "2-digit",
                second: "2-digit",
              })}
            </div>
            <div>
              <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                event.type === "add" 
                  ? "bg-[#00D26A]/20 text-[#00D26A]" 
                  : event.type === "single_remove"
                    ? "bg-[#FF9500]/20 text-[#FF9500]"
                    : "bg-[#FF3B30]/20 text-[#FF3B30]"
              }`}>
                {event.type === "add" ? "添加" : event.type === "single_remove" ? "单边移除" : "移除"}
              </span>
            </div>
            <div className="flex items-center gap-1">
              <div className={`w-4 h-4 rounded-full flex items-center justify-center text-[8px] ${
                event.pool === "VIRTUAL" ? "bg-pink-500" : "bg-[#627EEA]"
              }`}>
                {event.pool === "VIRTUAL" ? "V" : "Ξ"}
              </div>
            </div>
            <div className="text-white font-mono">{event.totalValue}</div>
            <div>
              <div className={`font-mono ${event.type === "add" ? "text-[#00D26A]" : "text-[#FF3B30]"}`}>
                {event.tokenAmount}
              </div>
              <div className={`font-mono text-[10px] ${event.type === "add" ? "text-[#00D26A]" : "text-[#FF3B30]"}`}>
                {event.ethAmount}
              </div>
            </div>
            <div className="flex items-center gap-1">
              <span className="text-white font-mono">{event.address}</span>
              <Copy className="w-3 h-3 text-[#636366] hover:text-white cursor-pointer" />
              <Eye className="w-3 h-3 text-[#636366] hover:text-white cursor-pointer" />
            </div>
            <div>
              <ExternalLink className="w-3.5 h-3.5 text-[#636366] hover:text-white cursor-pointer" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// Chart Toolbar Component
function ChartToolbar() {
  const [interval, setInterval] = useState("1H");
  const intervals = ["1秒", "30秒", "1分", "1小时", "4小时", "1日"];

  return (
    <div className="flex items-center justify-between px-4 py-2 border-b border-[#1E1E1E] bg-[#131722]">
      {/* Left: Interval Selector */}
      <div className="flex items-center gap-1">
        {intervals.map((int) => (
          <button
            key={int}
            onClick={() => setInterval(int)}
            className={`px-3 py-1 text-xs rounded transition-colors ${
              interval === int
                ? "bg-[#2962FF] text-white"
                : "text-[#636366] hover:text-white hover:bg-[#1E1E1E]"
            }`}
          >
            {int}
          </button>
        ))}
        <button className="px-2 py-1 text-[#636366] hover:text-white">
          <ChevronDown className="w-4 h-4" />
        </button>
        <div className="h-4 w-px bg-[#333] mx-2" />
        <button className="flex items-center gap-1 px-2 py-1 text-xs text-[#636366] hover:text-white">
          <BarChart3 className="w-4 h-4" />
          技术指标
        </button>
        <button className="flex items-center gap-1 px-2 py-1 text-xs text-[#636366] hover:text-white">
          <LayoutGrid className="w-4 h-4" />
          显示设置
        </button>
      </div>

      {/* Right: Tools */}
      <div className="flex items-center gap-2">
        <button className="p-1.5 text-[#636366] hover:text-white hover:bg-[#1E1E1E] rounded">
          <RefreshCw className="w-4 h-4" />
        </button>
        <button className="flex items-center gap-1 px-2 py-1 text-xs text-[#636366] hover:text-white">
          □ 多图表
        </button>
        <button className="flex items-center gap-1 px-2 py-1 text-xs text-[#636366] hover:text-white">
          价格
        </button>
        <button className="flex items-center gap-1 px-2 py-1 text-xs text-[#636366] hover:text-white">
          市值
        </button>
      </div>
    </div>
  );
}

// Bottom Status Bar
function BottomStatusBar({ isConnected }: { isConnected: boolean }) {
  return (
    <div className="h-10 border-t border-[#1E1E1E] bg-[#0B0B0B] flex items-center justify-between px-4 text-[11px]">
      {/* Left: Quick Actions */}
      <div className="flex items-center gap-4">
        <button className="flex items-center gap-1 text-[#636366] hover:text-white">
          <Star className="w-3.5 h-3.5" /> 关注代币
        </button>
        <button className="flex items-center gap-1 text-[#636366] hover:text-white">
          <Twitter className="w-3.5 h-3.5" /> 动态
        </button>
        <button className="flex items-center gap-1 text-[#636366] hover:text-white">
          <Flame className="w-3.5 h-3.5" /> 热门
        </button>
        <button className="flex items-center gap-1 text-[#636366] hover:text-white">
          <Briefcase className="w-3.5 h-3.5" /> 持仓
        </button>
        <button className="flex items-center gap-1 text-[#636366] hover:text-white">
          <Eye className="w-3.5 h-3.5" /> 钱包追踪
        </button>
        <button className="flex items-center gap-1 text-[#636366] hover:text-white">
          <Activity className="w-3.5 h-3.5" /> 信号
        </button>
        <button className="flex items-center gap-1 text-[#636366] hover:text-white">
          <TrendingUp className="w-3.5 h-3.5" /> 收益
        </button>
      </div>

      {/* Right: Stats & Settings */}
      <div className="flex items-center gap-4">
        <span className="text-[#28D1FF] font-mono">$140.98</span>
        <span className="text-[#FF3B30] font-mono">$111.02</span>
        <span className="text-[#00D26A] font-mono">$3.10K</span>
        <span className="text-[#FF9500] font-mono">$906.49</span>
        <button className="flex items-center gap-1 text-[#636366] hover:text-white">
          <Volume2 className="w-3.5 h-3.5" /> 声音设置
        </button>
        <button className="flex items-center gap-1 text-[#636366] hover:text-white">
          <HelpCircle className="w-3.5 h-3.5" /> 常见问题
        </button>
        <div className={`flex items-center gap-1 ${isConnected ? 'text-[#00D26A]' : 'text-[#FF9500]'}`}>
          <div className={`w-2 h-2 rounded-full ${isConnected ? 'bg-[#00D26A]' : 'bg-[#FF9500]'}`} />
          {isConnected ? '网络稳定' : '连接中...'}
        </div>
      </div>
    </div>
  );
}

// ============================================
// Main Page Component
// ============================================
interface OKXTradingPageProps {
  symbol: string;
  className?: string;
}

export function OKXTradingPage({ symbol, className }: OKXTradingPageProps) {
  const { address, isConnected } = useAccount();
  const { openConnectModal } = useConnectModal();
  const t = useTranslations();
  const { price: ethPriceUsd } = useETHPrice();

  const [activeTab, setActiveTab] = useState("tradeActivity");
  const [copied, setCopied] = useState(false);

  // Use symbol directly (already uppercase)
  const instId = symbol.toUpperCase();

  // Mock token data
  const token: TokenInfo = useMemo(() => ({
    name: symbol,
    symbol: symbol,
    address: "0xff8104251e7761163fac3211ef5583fb3f8583d6",
    price: 0.039611,
    priceChange24h: -15.78,
    marketCap: 39610000,
    liquidity: 1890000,
    holders: 15380,
    riskLevel: 3,
    aiScore: 47.30,
    volume24h: 1200000,
    creatorAddress: "0x5996...f39e",
    isGraduated: false,
    soldSupply: "727000000000000000000000000",
    totalSupply: "1000000000000000000000000000",
  }), [symbol]);

  // Mock data
  const trades = useMemo(() => generateMockTrades(symbol, ethPriceUsd), [symbol, ethPriceUsd]);
  const holders = useMemo(() => generateMockHolders(), []);

  const handleCopyAddress = () => {
    navigator.clipboard.writeText(token.address);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const tabs = [
    { key: "tradeActivity", label: "交易活动", icon: Activity },
    { key: "profitAddresses", label: "盈利地址", icon: TrendingUp },
    { key: "holders", label: `持币地址 (${(token.holders / 1000).toFixed(2)}K)`, icon: Users },
    { key: "watchedAddresses", label: "关注地址", icon: Eye },
    { key: "liquidity", label: "流动性", icon: Droplets },
    { key: "myPosition", label: "我的持仓", icon: Briefcase },
    { key: "myOrders", label: "我的订单", icon: FileText },
  ];

  return (
    <div className={`flex flex-col h-screen bg-[#0B0B0B] text-white ${className}`}>
      {/* Token Header */}
      <TokenHeader token={token} onCopyAddress={handleCopyAddress} />

      {/* Main Content */}
      <div className="flex flex-1 overflow-hidden">
        {/* Left: Chart + Tabs (75%) */}
        <div className="flex-[3] flex flex-col border-r border-[#1E1E1E] overflow-hidden">
          {/* Chart Toolbar */}
          <ChartToolbar />
          
          {/* Chart Area */}
          <div className="h-[400px] bg-[#131722] relative">
            <TokenPriceChart symbol={symbol} />
            
            {/* Chart Overlay Info */}
            <div className="absolute top-2 left-4 text-xs font-mono z-10">
              <div className="text-[#636366]">
                <span className="text-white">{symbol}</span> · 1小时 · BASE
              </div>
              <div className="flex items-center gap-4 mt-1">
                <span>开: <span className="text-white">0.039882</span></span>
                <span>高: <span className="text-white">0.039882</span></span>
                <span>低: <span className="text-white">0.039611</span></span>
                <span>收: <span className="text-white">0.039611</span></span>
                <span className="text-[#FF3B30]">-0.00027089 (-0.68%)</span>
              </div>
              <div className="mt-1">
                <span className="text-[#636366]">成交量(Volume)</span>
                <span className="text-[#00D26A] ml-2">3.8975</span>
              </div>
            </div>
          </div>

          {/* Bottom Tabs Panel */}
          <div className="h-[400px] border-t border-[#1E1E1E] flex flex-col bg-[#0B0B0B]">
            {/* Tab Navigation */}
            <div className="flex items-center border-b border-[#1E1E1E] px-2">
              {tabs.map((tab) => (
                <button
                  key={tab.key}
                  onClick={() => setActiveTab(tab.key)}
                  className={`flex items-center gap-1 px-4 py-3 text-xs transition-colors relative ${
                    activeTab === tab.key
                      ? "text-white font-medium"
                      : "text-[#636366] hover:text-white"
                  }`}
                >
                  {tab.label}
                  {activeTab === tab.key && (
                    <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-[#A3E635]" />
                  )}
                </button>
              ))}
              
              {/* Right side controls */}
              <div className="flex-1" />
              <div className="flex items-center gap-2 text-xs text-[#636366]">
                <span className="flex items-center gap-1">
                  <span className="w-2 h-2 rounded-full bg-[#FF9500]" />
                  已暂停
                </span>
                <button className="px-2 py-1 hover:bg-[#1E1E1E] rounded">USD / 币种</button>
                <button className="p-1 hover:bg-[#1E1E1E] rounded">
                  <LayoutGrid className="w-4 h-4" />
                </button>
                <button className="p-1 hover:bg-[#1E1E1E] rounded">
                  <Settings className="w-4 h-4" />
                </button>
                <button className="flex items-center gap-1 px-3 py-1 bg-[#00D26A] text-black rounded font-bold">
                  <Zap className="w-3.5 h-3.5" />
                  一键买卖
                </button>
              </div>
            </div>

            {/* Tab Content */}
            <div className="flex-1 overflow-hidden">
              {activeTab === "tradeActivity" && (
                <TradeActivityTab trades={trades} symbol={symbol} />
              )}
              {activeTab === "holders" && (
                <HoldersTab holders={holders} symbol={symbol} />
              )}
              {activeTab === "liquidity" && (
                <LiquidityTab events={[]} />
              )}
              {activeTab === "profitAddresses" && (
                <div className="flex items-center justify-center h-full text-[#636366]">
                  功能开发中...
                </div>
              )}
              {activeTab === "watchedAddresses" && (
                <div className="flex items-center justify-center h-full text-[#636366]">
                  功能开发中...
                </div>
              )}
              {activeTab === "myPosition" && (
                <div className="flex items-center justify-center h-full text-[#636366]">
                  {isConnected ? "暂无持仓" : "请连接钱包查看持仓"}
                </div>
              )}
              {activeTab === "myOrders" && (
                <div className="flex items-center justify-center h-full text-[#636366]">
                  {isConnected ? "暂无订单" : "请连接钱包查看订单"}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Right: Swap Panel (25%) */}
        <div className="w-[380px] overflow-y-auto bg-[#0B0B0B]">
          <SwapPanel
            token={token}
            isConnected={isConnected}
            onConnect={() => openConnectModal?.()}
          />
        </div>
      </div>

      {/* Bottom Status Bar */}
      <BottomStatusBar isConnected={true} />

      {/* Copy Toast */}
      {copied && (
        <div className="fixed bottom-16 left-1/2 -translate-x-1/2 bg-[#00D26A] text-black px-4 py-2 rounded-lg text-sm font-medium z-50">
          地址已复制
        </div>
      )}
    </div>
  );
}

export default OKXTradingPage;
