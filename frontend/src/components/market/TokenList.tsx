"use client";

import React, { useState, useMemo } from "react";
import Link from "next/link";
import { useMarketList, MarketData } from "@/hooks/useMarketData";

interface TokenListProps {
  className?: string;
}

type SortKey = "volume" | "price" | "change";
type SortOrder = "asc" | "desc";

/**
 * 可交易代币列表组件
 */
export function TokenList({ className = "" }: TokenListProps) {
  const { marketList, isLoading, error } = useMarketList();
  const [searchTerm, setSearchTerm] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("volume");
  const [sortOrder, setSortOrder] = useState<SortOrder>("desc");

  // 过滤和排序
  const filteredList = useMemo(() => {
    let list = [...marketList];

    // 搜索过滤
    if (searchTerm) {
      const term = searchTerm.toLowerCase();
      list = list.filter(
        (item) =>
          item.instrument.instId.toLowerCase().includes(term) ||
          item.instrument.baseCcy.toLowerCase().includes(term)
      );
    }

    // 排序
    list.sort((a, b) => {
      let aVal = 0;
      let bVal = 0;

      switch (sortKey) {
        case "volume":
          aVal = parseFloat(a.volume24h) || 0;
          bVal = parseFloat(b.volume24h) || 0;
          break;
        case "price":
          aVal = parseFloat(a.price) || 0;
          bVal = parseFloat(b.price) || 0;
          break;
        case "change":
          aVal = a.priceChange24h || 0;
          bVal = b.priceChange24h || 0;
          break;
      }

      return sortOrder === "desc" ? bVal - aVal : aVal - bVal;
    });

    return list;
  }, [marketList, searchTerm, sortKey, sortOrder]);

  const handleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortOrder(sortOrder === "asc" ? "desc" : "asc");
    } else {
      setSortKey(key);
      setSortOrder("desc");
    }
  };

  const SortIcon = ({ active, order }: { active: boolean; order: SortOrder }) => (
    <span className={`ml-1 ${active ? "text-okx-up" : "text-okx-text-tertiary"}`}>
      {active ? (order === "desc" ? "↓" : "↑") : "↕"}
    </span>
  );

  if (error) {
    return (
      <div className={`bg-okx-bg-card border border-okx-border-primary rounded-xl p-8 text-center ${className}`}>
        <p className="text-okx-down mb-4">加载失败: {error}</p>
        <p className="text-okx-text-tertiary text-sm">请检查后端服务是否正常运行</p>
      </div>
    );
  }

  return (
    <div className={`bg-okx-bg-card border border-okx-border-primary rounded-xl overflow-hidden ${className}`}>
      {/* Header */}
      <div className="p-4 border-b border-okx-border-primary">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-bold">可交易代币</h2>
          <span className="text-okx-text-tertiary text-sm">
            {filteredList.length} 个交易对
          </span>
        </div>

        {/* 搜索框 */}
        <input
          type="text"
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          placeholder="搜索交易对..."
          className="w-full bg-okx-bg-hover border border-okx-border-primary rounded-lg px-4 py-2 text-sm focus:outline-none focus:border-okx-up"
        />
      </div>

      {/* 表头 */}
      <div className="grid grid-cols-12 gap-2 px-4 py-3 bg-okx-bg-hover text-okx-text-tertiary text-xs font-medium">
        <div className="col-span-4">交易对</div>
        <div
          className="col-span-3 text-right cursor-pointer hover:text-okx-text-primary"
          onClick={() => handleSort("price")}
        >
          最新价格
          <SortIcon active={sortKey === "price"} order={sortOrder} />
        </div>
        <div
          className="col-span-2 text-right cursor-pointer hover:text-okx-text-primary"
          onClick={() => handleSort("change")}
        >
          24h 涨跌
          <SortIcon active={sortKey === "change"} order={sortOrder} />
        </div>
        <div
          className="col-span-3 text-right cursor-pointer hover:text-okx-text-primary"
          onClick={() => handleSort("volume")}
        >
          24h 成交额
          <SortIcon active={sortKey === "volume"} order={sortOrder} />
        </div>
      </div>

      {/* 列表 */}
      <div className="max-h-[600px] overflow-y-auto">
        {isLoading ? (
          <div className="flex items-center justify-center py-16">
            <div className="w-8 h-8 border-4 border-okx-up border-t-transparent rounded-full animate-spin" />
          </div>
        ) : filteredList.length > 0 ? (
          filteredList.map((item) => (
            <TokenListItem key={item.instrument.instId} data={item} />
          ))
        ) : (
          <div className="text-center py-16">
            <p className="text-4xl mb-4">🔍</p>
            <p className="text-okx-text-secondary">
              {searchTerm ? "未找到匹配的交易对" : "暂无可交易代币"}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * 单行代币数据
 */
function TokenListItem({ data }: { data: MarketData }) {
  const { instrument, price, priceChange24h, volume24h, high24h, low24h } = data;

  const isPositive = priceChange24h >= 0;
  const changeColor = isPositive ? "text-okx-up" : "text-okx-down";

  // 格式化价格
  const formatPrice = (p: string) => {
    const num = parseFloat(p);
    if (num === 0) return "0";
    if (num < 0.0001) return num.toExponential(4);
    if (num < 1) return num.toFixed(6);
    if (num < 100) return num.toFixed(4);
    return num.toFixed(2);
  };

  // 格式化成交额
  const formatVolume = (v: string) => {
    const num = parseFloat(v);
    if (num === 0) return "0";
    if (num >= 1000000) return `${(num / 1000000).toFixed(2)}M`;
    if (num >= 1000) return `${(num / 1000).toFixed(2)}K`;
    return num.toFixed(2);
  };

  return (
    <Link href={`/trade/${instrument.instId}`}>
      <div className="grid grid-cols-12 gap-2 px-4 py-3 border-b border-okx-border-primary hover:bg-okx-bg-hover transition-colors cursor-pointer">
        {/* 交易对 */}
        <div className="col-span-4 flex items-center gap-3">
          <div className="w-8 h-8 rounded-full bg-okx-up/20 flex items-center justify-center text-okx-up font-bold text-sm">
            {instrument.baseCcy.charAt(0)}
          </div>
          <div>
            <p className="font-medium">{instrument.baseCcy}/{instrument.quoteCcy}</p>
            <p className="text-okx-text-tertiary text-xs">{instrument.instType}</p>
          </div>
        </div>

        {/* 价格 */}
        <div className="col-span-3 text-right">
          <p className={`font-medium ${changeColor}`}>{formatPrice(price)}</p>
          <p className="text-okx-text-tertiary text-xs">
            H: {formatPrice(high24h)} L: {formatPrice(low24h)}
          </p>
        </div>

        {/* 涨跌幅 */}
        <div className="col-span-2 flex items-center justify-end">
          <span
            className={`px-2 py-1 rounded text-xs font-medium ${
              isPositive
                ? "bg-okx-up/20 text-okx-up"
                : "bg-okx-down/20 text-okx-down"
            }`}
          >
            {isPositive ? "+" : ""}
            {priceChange24h.toFixed(2)}%
          </span>
        </div>

        {/* 成交额 */}
        <div className="col-span-3 text-right">
          <p className="font-medium">${formatVolume(volume24h)}</p>
          <p className="text-okx-text-tertiary text-xs">{instrument.settleCcy}</p>
        </div>
      </div>
    </Link>
  );
}

export default TokenList;
