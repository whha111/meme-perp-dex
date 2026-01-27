"use client";

import React, { useState, useMemo } from "react";
import { TokenCard } from "./TokenCard";
import { SearchIcon, SortIcon } from "./Icons";
import { useTranslations } from "next-intl";
import { useETHPrice } from "@/hooks/useETHPrice";

type SortOption = "marketCap" | "time" | "progress" | "volume24h";
type SortOrder = "asc" | "desc";

interface Token {
  instId: string;  // 交易对ID，如 "PEPE"
  ticker: string;
  marketCap: bigint;
  price24hChange: number;
  volume24h: bigint;
  currentETH: bigint;
  graduationThreshold: bigint;
  createdAt: number; // Unix timestamp
  imageUrl?: string;
  uniqueTraders?: number; // 唯一交易地址数量
}

interface DiscoveryPageProps {
  tokens: Token[];
  onTokenClick?: (instId: string) => void;
}

/**
 * DiscoveryPage - OKX Meme Pump 风格的发现页面
 * 包含搜索框、排序过滤器、代币列表
 */
export function DiscoveryPage({ tokens, onTokenClick }: DiscoveryPageProps) {
  const t = useTranslations("discovery");
  const [searchQuery, setSearchQuery] = useState("");
  const [sortBy, setSortBy] = useState<SortOption>("marketCap");
  const [sortOrder, setSortOrder] = useState<SortOrder>("desc");
  const [showSortMenu, setShowSortMenu] = useState(false);

  // ✅ 获取实时 ETH 价格
  const { price: ethPriceUsd } = useETHPrice();

  // 过滤和排序
  const filteredAndSortedTokens = useMemo(() => {
    let filtered = tokens.filter((token) => {
      const query = searchQuery.toLowerCase();
      return (
        token.instId.toLowerCase().includes(query) ||
        token.ticker.toLowerCase().includes(query)
      );
    });

    // 排序
    filtered.sort((a, b) => {
      let comparison = 0;
      switch (sortBy) {
        case "marketCap":
          comparison = Number(a.marketCap - b.marketCap);
          break;
        case "time":
          comparison = a.createdAt - b.createdAt;
          break;
        case "progress":
          const progressA = Number((a.currentETH * BigInt(10000)) / a.graduationThreshold) / 100;
          const progressB = Number((b.currentETH * BigInt(10000)) / b.graduationThreshold) / 100;
          comparison = progressA - progressB;
          break;
        case "volume24h":
          comparison = Number(a.volume24h - b.volume24h);
          break;
      }
      return sortOrder === "asc" ? comparison : -comparison;
    });

    return filtered;
  }, [tokens, searchQuery, sortBy, sortOrder]);

  const sortOptions: { label: string; value: SortOption }[] = [
    { label: t("marketCap"), value: "marketCap" },
    { label: t("time"), value: "time" },
    { label: t("graduationProgress"), value: "progress" },
    { label: t("volume24h"), value: "volume24h" },
  ];

  return (
    <div className="min-h-screen bg-okx-bg-primary">
      {/* 顶部搜索和排序栏 */}
      <div className="sticky top-0 z-10 bg-okx-bg-primary border-b border-okx-border-primary">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
          <div className="flex flex-col sm:flex-row gap-4 items-center justify-between">
            {/* 搜索框 */}
            <div className="relative flex-1 w-full sm:max-w-md">
              <SearchIcon className="absolute left-3 top-1/2 transform -translate-y-1/2 w-5 h-5 text-okx-text-tertiary" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder={t("searchPlaceholder")}
                className="okx-input w-full pl-10 pr-4 py-2.5 text-sm"
              />
            </div>

            {/* 排序过滤器 */}
            <div className="relative">
              <button
                onClick={() => setShowSortMenu(!showSortMenu)}
                className="flex items-center gap-2 px-4 py-2.5 bg-okx-bg-card border border-okx-border-primary rounded-button text-okx-text-primary text-sm hover:bg-okx-bg-hover transition-colors"
              >
                <SortIcon className="w-4 h-4" />
                <span>
                  {sortOptions.find((opt) => opt.value === sortBy)?.label || t("sort")}
                </span>
                <span className="text-okx-text-tertiary">
                  {sortOrder === "asc" ? "↑" : "↓"}
                </span>
              </button>

              {/* 排序菜单 */}
              {showSortMenu && (
                <>
                  <div
                    className="fixed inset-0 z-10"
                    onClick={() => setShowSortMenu(false)}
                  />
                  <div className="absolute right-0 mt-2 w-48 bg-okx-bg-card border border-okx-border-primary rounded-button shadow-lg z-20">
                    <div className="p-2">
                      {sortOptions.map((option) => (
                        <button
                          key={option.value}
                          onClick={() => {
                            if (sortBy === option.value) {
                              setSortOrder(sortOrder === "asc" ? "desc" : "asc");
                            } else {
                              setSortBy(option.value);
                              setSortOrder("desc");
                            }
                            setShowSortMenu(false);
                          }}
                          className={`w-full text-left px-3 py-2 rounded text-sm transition-colors ${
                            sortBy === option.value
                              ? "bg-okx-bg-hover text-okx-text-primary"
                              : "text-okx-text-secondary hover:bg-okx-bg-hover"
                          }`}
                        >
                          {option.label}
                          {sortBy === option.value && (
                            <span className="ml-2 text-okx-text-tertiary">
                              {sortOrder === "asc" ? "↑" : "↓"}
                            </span>
                          )}
                        </button>
                      ))}
                    </div>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* 代币列表 */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
        {filteredAndSortedTokens.length === 0 ? (
          <div className="text-center py-20">
            <p className="text-okx-text-tertiary text-lg">
              {searchQuery ? t("noMatchingTokens") : t("noTokens")}
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {filteredAndSortedTokens.map((token) => {
              // Calculate progress percentage
              const progress = token.graduationThreshold > 0n
                ? Number((token.currentETH * BigInt(10000)) / token.graduationThreshold) / 100
                : 0;
              
              // Format time ago
              const timeAgo = new Date(token.createdAt * 1000).toLocaleDateString();
              
              // 成交量转换为 USD (使用实时 ETH 价格)
              const volumeUsd = (Number(token.volume24h) / 1e18) * ethPriceUsd;
              let volumeDisplay = "$0";
              if (volumeUsd >= 1000000) {
                volumeDisplay = "$" + (volumeUsd / 1000000).toFixed(2) + "M";
              } else if (volumeUsd >= 1000) {
                volumeDisplay = "$" + (volumeUsd / 1000).toFixed(2) + "K";
              } else if (volumeUsd > 0) {
                volumeDisplay = "$" + volumeUsd.toFixed(2);
              }

              return (
                <TokenCard
                  key={token.instId}
                  id={token.instId}
                  name={token.ticker}
                  ticker={token.ticker}
                  symbol={token.instId}
                  logo={token.imageUrl}
                  timeAgo={timeAgo}
                  address={token.instId.slice(0, 6) + "..." + token.instId.slice(-4)}
                  marketCap={`$${(Number(token.marketCap) / 1e18).toFixed(2)}`}
                  volume={volumeDisplay}
                  traders={token.uniqueTraders || 0}
                  progress={Math.min(progress, 100)}
                  priceChange24h={token.price24hChange}
                  onClick={() => onTokenClick?.(token.instId)}
                />
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

