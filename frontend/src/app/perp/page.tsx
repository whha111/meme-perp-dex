"use client";

import React, { useState, useEffect, Suspense, useMemo } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { Navbar } from "@/components/layout/Navbar";
import { PerpetualTradingTerminal } from "@/components/trading/PerpetualTradingTerminal";
import { useOnChainTokenList, OnChainToken } from "@/hooks/useTokenList";
import { getWebSocketServices } from "@/lib/websocket";
import { useTranslations } from "next-intl";
import { formatTimeAgo } from "@/utils/formatters";

// 榜单分类类型
type RankingCategory = "hot" | "new" | "gainers" | "losers" | "marketCap" | "volume";

// ETH 价格常量（TODO: 从 hook 获取实时价格）
const ETH_PRICE_USD = 2000;

// 格式化数值显示
function formatValue(value: number, prefix: string = "$"): string {
  if (value >= 1000000) {
    return prefix + (value / 1000000).toFixed(2) + "M";
  } else if (value >= 1000) {
    return prefix + (value / 1000).toFixed(2) + "K";
  } else if (value > 0) {
    return prefix + value.toFixed(2);
  }
  return prefix + "0";
}

// 榜单分类配置
const RANKING_CATEGORIES: { key: RankingCategory; labelKey: string }[] = [
  { key: "hot", labelKey: "hot" },
  { key: "new", labelKey: "new" },
  { key: "gainers", labelKey: "gainers" },
  { key: "losers", labelKey: "losers" },
  { key: "marketCap", labelKey: "marketCap" },
  { key: "volume", labelKey: "volume" },
];

function PerpContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const [mounted, setMounted] = useState(false);
  const t = useTranslations();
  const tPerp = useTranslations("perp");

  // 从链上获取代币列表
  const { tokens: onChainTokens, isLoading: isLoadingOnChain } = useOnChainTokenList();

  // 从后端获取代币列表
  const { data: backendTokens, isLoading: isLoadingBackend } = useQuery({
    queryKey: ["perpTokenAssets"],
    queryFn: async () => {
      try {
        const services = getWebSocketServices();
        const response = await services.getTokenList({
          page_size: 50,
          sort_by: 'created_at',
          sort_order: 'desc',
          filter_by: 'all',
        });

        if (response.success && response.tokens) {
          // 将后端tokens转换为OnChainToken格式
          return response.tokens.map((t: any) => ({
            address: t.address as `0x${string}`,
            name: t.name || "Unknown",
            symbol: t.symbol || "???",
            creator: (t.creator_address || "0x0") as `0x${string}`,
            createdAt: t.created_at ? Math.floor(new Date(t.created_at).getTime() / 1000) : 0,
            isGraduated: t.is_graduated || false,
            isActive: true,
            price: t.current_price || "0",
            marketCap: t.fdv || "0",
            soldSupply: t.sold_supply || "0",
            metadataURI: t.image_url || t.metadata_uri || "",
            perpEnabled: false, // 后端tokens默认不支持合约交易（需要链上确认）
            realETHReserve: "0",
            isOnChain: false, // 标记为非链上token
          }));
        }
        return [];
      } catch (err) {
        console.warn("Failed to fetch backend tokens:", err);
        return [];
      }
    },
    staleTime: 30000,
    retry: 3,
  });

  // 合并链上和后端数据：链上数据优先（有perpEnabled状态）
  const tokens = useMemo(() => {
    const merged: (OnChainToken & { isOnChain?: boolean })[] = onChainTokens.map(t => ({ ...t, isOnChain: true }));
    const onChainAddrs = new Set(onChainTokens.map(t => t.address.toLowerCase()));

    // 添加后端中不在链上的tokens
    if (backendTokens) {
      for (const bt of backendTokens) {
        if (!onChainAddrs.has(bt.address.toLowerCase())) {
          merged.push(bt);
        }
      }
    }

    // 按创建时间排序
    return merged.sort((a, b) => b.createdAt - a.createdAt);
  }, [onChainTokens, backendTokens]);

  const isLoading = isLoadingOnChain && isLoadingBackend;

  // 从 URL 参数获取交易对符号
  const urlSymbol = searchParams.get("symbol");

  useEffect(() => {
    setMounted(true);
  }, []);

  // 为每个代币生成模拟的交易数据 - hooks 必须在所有条件返回之前
  const tokensWithStats = useMemo(() => {
    return tokens.map((token) => {
      const marketCapFloat = parseFloat(token.marketCap) || 0;
      const marketCapUsd = marketCapFloat * ETH_PRICE_USD;
      const priceChange24h = (Math.random() - 0.5) * 40;
      const volume24h = Math.random() * 100000;
      const hotScore = marketCapUsd * 0.5 + volume24h * 0.3 + (token.isGraduated ? 1000 : 0);

      return {
        ...token,
        marketCapUsd,
        priceChange24h,
        volume24h,
        hotScore,
      };
    });
  }, [tokens]);

  // 根据分类获取排序后的代币
  const getTokensByCategory = (category: RankingCategory) => {
    if (!tokensWithStats.length) return [];

    switch (category) {
      case "hot":
        return [...tokensWithStats].sort((a, b) => b.hotScore - a.hotScore).slice(0, 10);
      case "new":
        return [...tokensWithStats].sort((a, b) => b.createdAt - a.createdAt).slice(0, 10);
      case "gainers":
        return [...tokensWithStats].sort((a, b) => b.priceChange24h - a.priceChange24h).slice(0, 10);
      case "losers":
        return [...tokensWithStats].sort((a, b) => a.priceChange24h - b.priceChange24h).slice(0, 10);
      case "marketCap":
        return [...tokensWithStats].sort((a, b) => b.marketCapUsd - a.marketCapUsd).slice(0, 10);
      case "volume":
        return [...tokensWithStats].sort((a, b) => b.volume24h - a.volume24h).slice(0, 10);
      default:
        return tokensWithStats.slice(0, 10);
    }
  };

  if (!mounted || isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[calc(100vh-64px)]">
        <div className="w-8 h-8 border-4 border-okx-up border-t-transparent rounded-full animate-spin"></div>
      </div>
    );
  }

  // 如果指定了 symbol，显示永续合约交易终端
  // symbol 可以是代币地址 (0x...) 或代币符号
  if (urlSymbol) {
    const isTokenAddress = urlSymbol.startsWith("0x") && urlSymbol.length === 42;
    return (
      <PerpetualTradingTerminal
        symbol={urlSymbol}
        tokenAddress={isTokenAddress ? (urlSymbol as `0x${string}`) : undefined}
      />
    );
  }

  // 如果没有代币，提示用户创建
  if (tokens.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[calc(100vh-64px)] gap-4">
        <p className="text-okx-text-secondary text-lg">{t("market.noTokens")}</p>
        <button
          onClick={() => router.push("/create")}
          className="bg-okx-up text-black px-6 py-2 rounded-lg font-bold hover:opacity-90 transition-opacity"
        >
          {t("nav.createToken")}
        </button>
      </div>
    );
  }

  // 显示6列榜单
  return (
    <div className="max-w-[1600px] mx-auto px-4 py-4">
      {/* 6列榜单并排 */}
      <div className="grid grid-cols-6 gap-3">
        {RANKING_CATEGORIES.map((category) => {
          const categoryTokens = getTokensByCategory(category.key);
          const showChange = category.key === "gainers" || category.key === "losers";

          return (
            <div key={category.key}>
              {/* 榜单标题 */}
              <div className="py-2 px-3 bg-okx-bg-hover border border-okx-border-primary rounded-lg mb-2">
                <span className="text-[14px] font-bold text-okx-text-primary">
                  {tPerp(`ranking.${category.labelKey}`)}
                </span>
              </div>

              {/* 代币列表 */}
              <div className="bg-okx-bg-card border border-okx-border-primary rounded-lg divide-y divide-okx-border-primary">
                {categoryTokens.map((token, index) => {
                  const isOnChain = (token as any).isOnChain !== false;
                  const canTrade = isOnChain && token.perpEnabled;
                  const statusTitle = !isOnChain
                    ? tPerp("notOnChain")
                    : !token.perpEnabled
                    ? tPerp("perpNotEnabled")
                    : tPerp("perpEnabled");

                  return (
                    <div
                      key={token.address}
                      onClick={() => isOnChain ? router.push(`/perp?symbol=${token.address}`) : null}
                      className={`flex items-center gap-2 py-2.5 px-3 hover:bg-okx-bg-hover ${isOnChain ? 'cursor-pointer' : 'cursor-not-allowed'} ${!canTrade ? 'opacity-60' : ''}`}
                      title={statusTitle}
                    >
                      {/* 排名 */}
                      <span className={`w-5 text-[12px] font-bold text-center ${index < 3 ? 'text-okx-up' : 'text-okx-text-tertiary'}`}>
                        {index + 1}
                      </span>

                      {/* 图标 */}
                      <div className="w-6 h-6 rounded overflow-hidden flex-shrink-0 relative">
                        <img
                          src={`https://api.dicebear.com/7.x/identicon/svg?seed=${token.address}`}
                          alt={token.symbol}
                          className="w-full h-full"
                        />
                        {/* 状态指示：绿色=可交易，黄色=链上但未启用，灰色=不在链上 */}
                        <div
                          className={`absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full border border-okx-bg-card ${
                            canTrade ? 'bg-green-500' : isOnChain ? 'bg-yellow-500' : 'bg-gray-500'
                          }`}
                          title={statusTitle}
                        />
                      </div>

                      {/* 名称 */}
                      <span className="flex-1 text-[13px] text-okx-text-primary font-medium truncate">
                        {token.symbol}
                        {!isOnChain && <span className="ml-1 text-[10px] text-gray-500">(Off-chain)</span>}
                      </span>

                      {/* 涨跌幅或市值 */}
                      {showChange ? (
                        <span className={`text-[12px] font-medium ${token.priceChange24h >= 0 ? 'text-okx-up' : 'text-okx-down'}`}>
                          {token.priceChange24h >= 0 ? '+' : ''}{token.priceChange24h.toFixed(2)}%
                        </span>
                      ) : (
                        <span className="text-[12px] text-okx-text-secondary">
                          {formatValue(token.marketCapUsd)}
                        </span>
                      )}
                    </div>
                  );
                })}

                {categoryTokens.length === 0 && (
                  <div className="py-6 text-center text-[12px] text-okx-text-tertiary">
                    {t("market.noTokens")}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/**
 * 永续合约交易页面
 * - 无 symbol 参数时显示代币列表
 * - 有 symbol 参数时显示永续合约交易终端
 */
export default function PerpetualTradingPage() {
  return (
    <main className="min-h-screen bg-okx-bg-primary text-okx-text-primary">
      <Navbar />
      <Suspense
        fallback={
          <div className="flex items-center justify-center min-h-[calc(100vh-64px)]">
            <div className="w-8 h-8 border-4 border-okx-up border-t-transparent rounded-full animate-spin"></div>
          </div>
        }
      >
        <PerpContent />
      </Suspense>
    </main>
  );
}
