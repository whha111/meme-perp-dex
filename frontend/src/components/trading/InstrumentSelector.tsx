"use client";

import React, { useState, useRef, useEffect, useMemo } from "react";
import { useMarketList, MarketData } from "@/hooks/useMarketData";
import { useAppStore } from "@/lib/stores/appStore";
import { ChevronDown, Search, Star, X } from "lucide-react";

interface InstrumentSelectorProps {
  currentInstId: string;
  onSelect: (instId: string) => void;
  className?: string;
}

type FilterCategory = "favorites" | "all" | "hot" | "new" | "ai" | "meme";

// 简化的代币数据类型（用于模拟数据）
interface SimpleTokenData {
  instrument: {
    instId: string;
    baseCcy: string;
    quoteCcy: string;
    instType: string;
  };
  price: string;
  priceChange24h: number;
  volume24h: string;
}

// 模拟数据 - 当后端没有数据时使用
const MOCK_TOKENS: SimpleTokenData[] = [
  {
    instrument: { instId: "BTC-ETH", baseCcy: "BTC", quoteCcy: "ETH", instType: "PERP" },
    price: "90940.40",
    priceChange24h: -2.13,
    volume24h: "1250000000",
  },
  {
    instrument: { instId: "ETH-USD", baseCcy: "ETH", quoteCcy: "USD", instType: "PERP" },
    price: "3092.56",
    priceChange24h: -3.51,
    volume24h: "890000000",
  },
  {
    instrument: { instId: "SOL-ETH", baseCcy: "SOL", quoteCcy: "ETH", instType: "PERP" },
    price: "128.60",
    priceChange24h: -3.73,
    volume24h: "456000000",
  },
  {
    instrument: { instId: "DOGE-ETH", baseCcy: "DOGE", quoteCcy: "ETH", instType: "PERP" },
    price: "0.12558",
    priceChange24h: -1.55,
    volume24h: "320000000",
  },
  {
    instrument: { instId: "PEPE-ETH", baseCcy: "PEPE", quoteCcy: "ETH", instType: "PERP" },
    price: "0.00002580",
    priceChange24h: 2.42,
    volume24h: "180000000",
  },
  {
    instrument: { instId: "SHIB-ETH", baseCcy: "SHIB", quoteCcy: "ETH", instType: "PERP" },
    price: "0.00001234",
    priceChange24h: 1.25,
    volume24h: "150000000",
  },
  {
    instrument: { instId: "WIF-ETH", baseCcy: "WIF", quoteCcy: "ETH", instType: "PERP" },
    price: "1.85",
    priceChange24h: -4.21,
    volume24h: "95000000",
  },
  {
    instrument: { instId: "BONK-ETH", baseCcy: "BONK", quoteCcy: "ETH", instType: "PERP" },
    price: "0.00001856",
    priceChange24h: 5.67,
    volume24h: "78000000",
  },
  {
    instrument: { instId: "FLOKI-ETH", baseCcy: "FLOKI", quoteCcy: "ETH", instType: "PERP" },
    price: "0.000156",
    priceChange24h: -2.34,
    volume24h: "65000000",
  },
  {
    instrument: { instId: "MEME-ETH", baseCcy: "MEME", quoteCcy: "ETH", instType: "PERP" },
    price: "0.0234",
    priceChange24h: 3.45,
    volume24h: "45000000",
  },
  {
    instrument: { instId: "WOJAK-ETH", baseCcy: "WOJAK", quoteCcy: "ETH", instType: "PERP" },
    price: "0.00045",
    priceChange24h: -1.23,
    volume24h: "32000000",
  },
  {
    instrument: { instId: "TURBO-ETH", baseCcy: "TURBO", quoteCcy: "ETH", instType: "PERP" },
    price: "0.0067",
    priceChange24h: 8.92,
    volume24h: "28000000",
  },
  {
    instrument: { instId: "AI16Z-ETH", baseCcy: "AI16Z", quoteCcy: "ETH", instType: "PERP" },
    price: "0.89",
    priceChange24h: 12.34,
    volume24h: "42000000",
  },
  {
    instrument: { instId: "GOAT-ETH", baseCcy: "GOAT", quoteCcy: "ETH", instType: "PERP" },
    price: "0.45",
    priceChange24h: -5.67,
    volume24h: "38000000",
  },
  {
    instrument: { instId: "FARTCOIN-ETH", baseCcy: "FARTCOIN", quoteCcy: "ETH", instType: "PERP" },
    price: "0.78",
    priceChange24h: 15.23,
    volume24h: "55000000",
  },
];

/**
 * 代币选择器组件 - OKX 风格下拉选择器
 */
export function InstrumentSelector({
  currentInstId,
  onSelect,
  className = "",
}: InstrumentSelectorProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [activeCategory, setActiveCategory] = useState<FilterCategory>("all");
  const dropdownRef = useRef<HTMLDivElement>(null);

  const { marketList: realMarketList, isLoading } = useMarketList();
  const favoriteInstruments = useAppStore((state) => state.favoriteInstruments);
  const toggleFavorite = useAppStore((state) => state.toggleFavoriteInstrument);

  // 如果没有真实数据，使用模拟数据
  const marketList: SimpleTokenData[] = useMemo(() => {
    if (realMarketList && realMarketList.length > 0) {
      // 将 MarketData 转换为 SimpleTokenData
      return realMarketList.map((item) => ({
        instrument: {
          instId: item.instrument.instId,
          baseCcy: item.instrument.baseCcy,
          quoteCcy: item.instrument.quoteCcy,
          instType: item.instrument.instType,
        },
        price: item.price,
        priceChange24h: item.priceChange24h,
        volume24h: item.volume24h,
      }));
    }
    return MOCK_TOKENS;
  }, [realMarketList]);

  // 当前选中的代币信息
  const currentInstrument = useMemo(() => {
    return marketList.find((item) => item.instrument.instId === currentInstId);
  }, [marketList, currentInstId]);

  // 提取代币符号
  const tokenSymbol = currentInstId.split("-")[0].toUpperCase();

  // Meme 币列表
  const memeCoins = ["PEPE", "SHIB", "DOGE", "WIF", "BONK", "FLOKI", "MEME", "WOJAK", "TURBO", "FARTCOIN", "GOAT"];
  // AI 币列表
  const aiCoins = ["AI16Z", "GOAT", "TURBO"];
  // 热门币列表
  const hotCoins = ["BTC", "ETH", "SOL", "DOGE", "PEPE"];
  // 新币列表 (模拟最近上线的)
  const newCoins = ["AI16Z", "FARTCOIN", "TURBO", "GOAT"];

  // 过滤和分类
  const filteredList = useMemo(() => {
    let list = [...marketList];

    // 按分类过滤
    switch (activeCategory) {
      case "favorites":
        list = list.filter((item) => favoriteInstruments.has(item.instrument.instId));
        break;
      case "meme":
        list = list.filter((item) => memeCoins.includes(item.instrument.baseCcy));
        break;
      case "ai":
        list = list.filter((item) => aiCoins.includes(item.instrument.baseCcy));
        break;
      case "hot":
        list = list.filter((item) => hotCoins.includes(item.instrument.baseCcy));
        break;
      case "new":
        list = list.filter((item) => newCoins.includes(item.instrument.baseCcy));
        break;
      case "all":
      default:
        // 显示全部
        break;
    }

    // 搜索过滤
    if (searchTerm) {
      const term = searchTerm.toLowerCase();
      list = list.filter(
        (item) =>
          item.instrument.instId.toLowerCase().includes(term) ||
          item.instrument.baseCcy.toLowerCase().includes(term)
      );
    }

    // 按24h成交量排序
    list.sort((a, b) => {
      const aVol = parseFloat(a.volume24h) || 0;
      const bVol = parseFloat(b.volume24h) || 0;
      return bVol - aVol;
    });

    return list;
  }, [marketList, searchTerm, activeCategory, favoriteInstruments]);

  // 点击外部关闭下拉框
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };

    if (isOpen) {
      document.addEventListener("mousedown", handleClickOutside);
    }

    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [isOpen]);

  // 格式化价格
  const formatPrice = (p: string) => {
    const num = parseFloat(p);
    if (num === 0) return "0";
    if (num < 0.0001) return num.toExponential(4);
    if (num < 1) return num.toFixed(6);
    if (num < 100) return num.toFixed(4);
    return num.toFixed(2);
  };

  // 处理选择
  const handleSelect = (instId: string) => {
    onSelect(instId);
    setIsOpen(false);
    setSearchTerm("");
  };

  // 分类标签
  const categories: { key: FilterCategory; label: string }[] = [
    { key: "favorites", label: "自选" },
    { key: "all", label: "全部" },
    { key: "hot", label: "热门" },
    { key: "new", label: "新币" },
    { key: "meme", label: "Meme" },
    { key: "ai", label: "AI" },
  ];

  return (
    <div ref={dropdownRef} className={`relative ${className}`}>
      {/* 触发按钮 */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-2 px-3 py-1.5 rounded-lg hover:bg-okx-bg-hover transition-colors"
      >
        <div className="w-6 h-6 rounded-full overflow-hidden bg-okx-bg-hover flex items-center justify-center">
          <span className="text-xs font-bold text-okx-up">
            {tokenSymbol.charAt(0)}
          </span>
        </div>
        <span className="text-okx-text-primary font-bold text-[15px]">
          {tokenSymbol}
        </span>
        <span className="text-okx-text-tertiary text-[12px]">永续</span>
        <ChevronDown
          className={`w-4 h-4 text-okx-text-tertiary transition-transform ${
            isOpen ? "rotate-180" : ""
          }`}
        />
      </button>

      {/* 下拉面板 */}
      {isOpen && (
        <div className="absolute top-full left-0 mt-1 w-[420px] bg-okx-bg-card border border-okx-border-primary rounded-xl shadow-xl z-50 overflow-hidden">
          {/* 搜索框 */}
          <div className="p-3 border-b border-okx-border-primary">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-okx-text-tertiary" />
              <input
                type="text"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                placeholder="搜索币对"
                className="w-full bg-okx-bg-hover border border-okx-border-primary rounded-lg pl-10 pr-10 py-2 text-sm text-okx-text-primary placeholder:text-okx-text-tertiary focus:outline-none focus:border-okx-up"
                autoFocus
              />
              {searchTerm && (
                <button
                  onClick={() => setSearchTerm("")}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-okx-text-tertiary hover:text-okx-text-primary"
                >
                  <X className="w-4 h-4" />
                </button>
              )}
            </div>
          </div>

          {/* 分类标签 */}
          <div className="flex items-center gap-1 px-3 py-2 border-b border-okx-border-primary overflow-x-auto">
            {categories.map((cat) => (
              <button
                key={cat.key}
                onClick={() => setActiveCategory(cat.key)}
                className={`px-3 py-1 text-[12px] rounded-md whitespace-nowrap transition-colors ${
                  activeCategory === cat.key
                    ? "bg-okx-bg-hover text-okx-text-primary font-medium"
                    : "text-okx-text-tertiary hover:text-okx-text-secondary"
                }`}
              >
                {cat.label}
              </button>
            ))}
          </div>

          {/* 表头 */}
          <div className="grid grid-cols-12 gap-2 px-3 py-2 text-[11px] text-okx-text-tertiary border-b border-okx-border-primary">
            <div className="col-span-5">名称</div>
            <div className="col-span-4 text-right">最新价</div>
            <div className="col-span-3 text-right">24h涨跌</div>
          </div>

          {/* 代币列表 */}
          <div className="max-h-[400px] overflow-y-auto">
            {isLoading ? (
              <div className="flex items-center justify-center py-8">
                <div className="w-6 h-6 border-2 border-okx-up border-t-transparent rounded-full animate-spin" />
              </div>
            ) : filteredList.length > 0 ? (
              filteredList.map((item) => (
                <InstrumentRow
                  key={item.instrument.instId}
                  data={item}
                  isSelected={item.instrument.instId === currentInstId}
                  isFavorite={favoriteInstruments.has(item.instrument.instId)}
                  onSelect={() => handleSelect(item.instrument.instId)}
                  onToggleFavorite={() => toggleFavorite(item.instrument.instId)}
                  formatPrice={formatPrice}
                />
              ))
            ) : (
              <div className="text-center py-8 text-okx-text-tertiary">
                <p>未找到匹配的交易对</p>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * 单行代币数据
 */
function InstrumentRow({
  data,
  isSelected,
  isFavorite,
  onSelect,
  onToggleFavorite,
  formatPrice,
}: {
  data: SimpleTokenData;
  isSelected: boolean;
  isFavorite: boolean;
  onSelect: () => void;
  onToggleFavorite: () => void;
  formatPrice: (p: string) => string;
}) {
  const { instrument, price, priceChange24h } = data;
  const isPositive = priceChange24h >= 0;

  return (
    <div
      className={`grid grid-cols-12 gap-2 px-3 py-2.5 items-center cursor-pointer transition-colors ${
        isSelected ? "bg-okx-bg-hover" : "hover:bg-okx-bg-hover"
      }`}
      onClick={onSelect}
    >
      {/* 名称 */}
      <div className="col-span-5 flex items-center gap-2">
        <button
          onClick={(e) => {
            e.stopPropagation();
            onToggleFavorite();
          }}
          className="flex-shrink-0"
        >
          <Star
            className={`w-4 h-4 transition-colors ${
              isFavorite ? "text-[#FFB800] fill-[#FFB800]" : "text-okx-text-tertiary hover:text-[#FFB800]"
            }`}
          />
        </button>
        <div className="w-6 h-6 rounded-full bg-okx-up/20 flex items-center justify-center text-okx-up text-xs font-bold flex-shrink-0">
          {instrument.baseCcy.charAt(0)}
        </div>
        <div className="min-w-0">
          <p className="text-[13px] font-medium text-okx-text-primary truncate">
            {instrument.baseCcy}
          </p>
          <p className="text-[10px] text-okx-text-tertiary">{instrument.instType}</p>
        </div>
      </div>

      {/* 价格 */}
      <div className="col-span-4 text-right">
        <p className="text-[13px] text-okx-text-primary font-mono">
          ${formatPrice(price)}
        </p>
      </div>

      {/* 涨跌幅 */}
      <div className="col-span-3 text-right">
        <span
          className={`text-[12px] font-medium ${
            isPositive ? "text-okx-up" : "text-okx-down"
          }`}
        >
          {isPositive ? "+" : ""}
          {priceChange24h.toFixed(2)}%
        </span>
      </div>
    </div>
  );
}

export default InstrumentSelector;
