"use client";

import React, { useEffect, useState, useRef, useMemo } from "react";
import { useTranslations } from "next-intl";
import { TokenCard } from "./TokenCard";
import { Navbar } from "@/components/layout/Navbar";
import { SOLD_TOKENS_TARGET } from "@/lib/protocol-constants";
import { InstrumentAssetData } from "@/lib/websocket";
import { formatTimeAgo } from "@/utils/formatters";
import { FilterPanel, FilterState, defaultFilterState } from "./FilterPanel";
import { FAQPanel } from "./FAQPanel";
import { useOnChainTokenList, OnChainToken } from "@/hooks/common/useTokenList";
import { useETHPrice } from "@/hooks/common/useETHPrice";
import { trackRender } from "@/lib/debug-render";
import { useTradingDataStore, type TokenStats } from "@/lib/stores/tradingDataStore";
import { useUnifiedWebSocket, getWebSocketManager } from "@/hooks/common/useUnifiedWebSocket";
import { type Address } from "viem";
import { apiClient, type Ticker } from "@/lib/api/client";


function Column({ title, assets, noTokensText, ethPrice }: { title: string; assets: any[]; noTokensText: string; ethPrice: number }) {
  return (
    <div className="flex-1 min-w-[320px] bg-okx-bg-primary">
      <div className="flex items-center justify-between mb-4 sticky top-[64px] bg-okx-bg-primary py-2 z-10">
        <h2 className="text-okx-text-primary font-bold text-[16px]">{title}</h2>
        <div className="flex items-center gap-2">
          <div className="relative">
            <input type="text" placeholder="..." className="bg-okx-bg-hover border border-okx-border-primary rounded px-2 py-1 text-[11px] text-okx-text-primary w-24 focus:outline-none" />
          </div>
          <button className="text-okx-text-secondary text-[11px]">10</button>
        </div>
      </div>
      <div className="overflow-y-auto">
        {assets.map((asset) => {
          // Format InstrumentAsset into TokenCardProps
          const instId = asset.instId || 'unknown';
          const ticker = asset.symbol || instId.toUpperCase();

          // 计算内盘进度 (已售出/目标销售量)
          // 毕业需要卖出 793M 代币 (1B总量 - 207M剩余阈值)
          const soldBigInt = BigInt(asset.soldSupply || "0");
          const progressPercent = Number((soldBigInt * 10000n) / SOLD_TOKENS_TARGET) / 100;

          // 市值计算: FDV 是 wei 单位，需要转换为 USD
          // FDV = 价格 * 总供应量 (10亿)，单位是 wei
          const fdvWei = parseFloat(asset.fdv || "0");
          const fdvEth = fdvWei / 1e18;
          const fdvUsd = fdvEth * ethPrice;

          // 格式化市值显示
          let marketCapDisplay = "$0";
          if (fdvUsd >= 1000000) {
            marketCapDisplay = "$" + (fdvUsd / 1000000).toFixed(2) + "M";
          } else if (fdvUsd >= 1000) {
            marketCapDisplay = "$" + (fdvUsd / 1000).toFixed(2) + "K";
          } else if (fdvUsd > 0) {
            marketCapDisplay = "$" + fdvUsd.toFixed(2);
          }

          // 24h成交量 (转换为 USD)
          const volumeWei = parseFloat(asset.volume24h || "0");
          const volumeEth = volumeWei / 1e18;
          const volumeUsd = volumeEth * ethPrice;

          // 格式化成交量显示 (USD)
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
              key={instId}
              id={instId}
              name={ticker}
              ticker={ticker}
              symbol={instId}
              logo={asset.logo || asset.imageUrl}
              timeAgo={formatTimeAgo(asset.createdAt)}
              address={asset.creatorAddress ? (asset.creatorAddress.slice(0, 4) + "..." + asset.creatorAddress.slice(-4)) : ""}
              marketCap={marketCapDisplay}
              volume={volumeDisplay}
              traders={asset.uniqueTraders || 0}
              progress={progressPercent}
              priceChange24h={asset.priceChange24h || 0}
            />
          );
        })}
        {assets.length === 0 && (
          <div className="text-[#636366] text-sm text-center py-10">{noTokensText}</div>
        )}
      </div>
    </div>
  );
}

// 使用统一的 InstrumentAssetData 类型，不再重复定义

// 解析价格字符串为数字（支持 $1.5K, $2.3M 等格式）
function parseValueString(value: string): number {
  if (!value) return 0;
  const num = parseFloat(value);
  if (isNaN(num)) return 0;
  return num;
}

// 计算资产的数值用于筛选
function getAssetMetrics(asset: InstrumentAssetData, ethPrice: number) {
  const soldBigInt = BigInt(asset.soldSupply || "0");
  const progressPercent = Number((soldBigInt * 10000n) / SOLD_TOKENS_TARGET) / 100;

  const fdvWei = parseFloat(asset.fdv || "0");
  const fdvEth = fdvWei / 1e18;
  const fdvUsd = fdvEth * ethPrice;

  const volumeWei = parseFloat(asset.volume24h || "0");
  const volumeEth = volumeWei / 1e18;
  const volumeUsd = volumeEth * ethPrice;

  return {
    progress: progressPercent,
    marketCapUsd: fdvUsd,
    volume24hUsd: volumeUsd,
    priceChange24h: asset.priceChange24h || 0,
    traders: asset.uniqueTraders || 0,
  };
}

// 筛选资产
function filterAssets(assets: InstrumentAssetData[], filters: FilterState, ethPrice: number): InstrumentAssetData[] {
  return assets.filter(asset => {
    const metrics = getAssetMetrics(asset, ethPrice);

    // 关键词筛选
    if (filters.keyword) {
      const keyword = filters.keyword.toLowerCase();
      const assetInstId = asset.instId || '';
      const assetSymbol = asset.symbol || assetInstId;
      const instIdMatch = assetInstId.toLowerCase().includes(keyword);
      const symbolMatch = assetSymbol.toLowerCase().includes(keyword);
      if (!instIdMatch && !symbolMatch) return false;
    }

    // 市值筛选
    const marketCapMin = parseValueString(filters.marketCapMin);
    const marketCapMax = parseValueString(filters.marketCapMax);
    if (marketCapMin && metrics.marketCapUsd < marketCapMin) return false;
    if (marketCapMax && metrics.marketCapUsd > marketCapMax) return false;

    // 24h成交量筛选
    const volume24hMin = parseValueString(filters.volume24hMin);
    const volume24hMax = parseValueString(filters.volume24hMax);
    if (volume24hMin && metrics.volume24hUsd < volume24hMin) return false;
    if (volume24hMax && metrics.volume24hUsd > volume24hMax) return false;

    // 24h涨跌幅筛选
    const priceChangeMin = parseValueString(filters.priceChangeMin);
    const priceChangeMax = parseValueString(filters.priceChangeMax);
    if (filters.priceChangeMin && metrics.priceChange24h < priceChangeMin) return false;
    if (filters.priceChangeMax && metrics.priceChange24h > priceChangeMax) return false;

    // 交易人数筛选
    const tradersMin = parseValueString(filters.tradersMin);
    const tradersMax = parseValueString(filters.tradersMax);
    if (tradersMin && metrics.traders < tradersMin) return false;
    if (tradersMax && metrics.traders > tradersMax) return false;

    // 进度条筛选
    const progressMin = parseValueString(filters.progressMin);
    const progressMax = parseValueString(filters.progressMax);
    if (progressMin && metrics.progress < progressMin) return false;
    if (progressMax && metrics.progress > progressMax) return false;

    return true;
  });
}

// 检查是否有活跃筛选条件
function hasActiveFilters(filters: FilterState): boolean {
  return Object.values(filters).some(v => v !== '');
}

export function MarketOverview() {
  // 调试：追踪渲染次数 (仅 console 警告，不 throw)
  trackRender("MarketOverview");

  const [minLoadingDone, setMinLoadingDone] = useState(false);
  const [filterPanelOpen, setFilterPanelOpen] = useState(false);
  const [faqPanelOpen, setFaqPanelOpen] = useState(false);
  const [filters, setFilters] = useState<FilterState>(defaultFilterState);

  // 获取实时 ETH 价格
  const { price: ethPrice } = useETHPrice();

  // 确保骨架屏至少显示 500ms，避免闪烁
  useEffect(() => {
    const timer = setTimeout(() => {
      setMinLoadingDone(true);
    }, 500);
    return () => clearTimeout(timer);
  }, []);

  // 通过 useUnifiedWebSocket 建立 WSS 连接（不订阅特定 token，仅建立连接）
  const { isConnected: wsConnected } = useUnifiedWebSocket({ enabled: true });

  // 直接从链上获取代币列表
  const { tokens: onChainTokens, isLoading: isLoadingOnChain } = useOnChainTokenList();

  // 当链上 token 列表就绪后，通过 WSS 批量订阅所有 token 获取实时数据
  useEffect(() => {
    if (onChainTokens.length > 0 && wsConnected) {
      const manager = getWebSocketManager();
      if (manager) {
        manager.subscribeAll(onChainTokens.map(t => t.address as Address));
      }
    }
  }, [onChainTokens, wsConnected]);

  // 从 tradingDataStore 读取 WSS 推送的实时市场数据
  const tokenStatsMap = useTradingDataStore(state => state.tokenStats);

  // HTTP fallback: 当 WS 没有返回 tokenStats 数据时，从 HTTP API 获取 ticker
  const [httpTickers, setHttpTickers] = useState<Ticker[]>([]);
  const httpFallbackEnabled = tokenStatsMap.size === 0;

  useEffect(() => {
    if (!httpFallbackEnabled) return;

    const fetchTickers = async () => {
      try {
        const tickers = await apiClient.getTickers();
        if (tickers.length > 0) {
          setHttpTickers(tickers);
        }
      } catch (e) {
        console.warn("[MarketOverview] HTTP ticker fallback failed:", e);
      }
    };

    fetchTickers();
    const interval = setInterval(fetchTickers, 30000);
    return () => clearInterval(interval);
  }, [httpFallbackEnabled]);

  // 解析 metadataURI 获取 logo
  // metadataURI 格式可能是：
  // 1. ipfs://<hash> - 直接是图片的 IPFS 链接
  // 2. data:application/json;base64,... - base64 编码的 JSON，包含 image 字段
  // 3. https://... - 直接的 HTTP URL
  const parseMetadataURI = (uri: string): string | undefined => {
    if (!uri) return undefined;

    // 如果是 IPFS 链接，直接转换为 HTTP 网关 URL（这是图片本身）
    if (uri.startsWith('ipfs://')) {
      const hash = uri.replace('ipfs://', '');
      return `https://gateway.pinata.cloud/ipfs/${hash}`;
    }

    // 如果是 data URI (base64 JSON)，解析出 image 字段
    if (uri.startsWith('data:application/json;base64,')) {
      try {
        const base64Data = uri.replace('data:application/json;base64,', '');
        const jsonStr = atob(base64Data);
        const metadata = JSON.parse(jsonStr);
        // 优先使用 image 字段，其次是 logo
        const imageUrl = metadata.image || metadata.logo;
        if (imageUrl) {
          // 如果 image 也是 IPFS 链接，转换
          if (imageUrl.startsWith('ipfs://')) {
            return `https://gateway.pinata.cloud/ipfs/${imageUrl.replace('ipfs://', '')}`;
          }
          // 如果是 HTTP URL，直接返回
          if (imageUrl.startsWith('http')) {
            return imageUrl;
          }
        }
      } catch (e) {
        console.warn('Failed to parse metadataURI:', e);
      }
    }

    // 如果是直接的 HTTP URL，返回它
    if (uri.startsWith('http')) {
      return uri;
    }

    // 有效的 IPFS CID hash
    if ((uri.startsWith('Qm') && uri.length === 46) || uri.startsWith('bafy')) {
      return `https://gateway.pinata.cloud/ipfs/${uri}`;
    }

    // 未知格式（如 "test-pepe-metadata"），不尝试请求
    return undefined;
  };

  // 将链上代币转换为 InstrumentAssetData 格式
  const onChainAssetsConverted: InstrumentAssetData[] = useMemo(() => {
    return onChainTokens.map((token: OnChainToken) => {
      const priceFloat = parseFloat(token.price) || 0;
      const marketCapFloat = parseFloat(token.marketCap) || 0;
      const logoUrl = parseMetadataURI(token.metadataURI);

      return {
        instId: token.address,
        symbol: token.symbol,
        name: token.name,
        creatorAddress: token.creator,
        createdAt: token.createdAt * 1000, // Convert to milliseconds
        isGraduated: token.isGraduated,
        currentPrice: token.price,
        fdv: (marketCapFloat * 1e18).toString(), // FDV in wei
        // soldSupply is already in wei from useTokenList
        soldSupply: token.soldSupply,
        volume24h: "0",
        priceChange24h: 0,
        uniqueTraders: 0,
        logo: logoUrl,
        imageUrl: logoUrl,
      };
    });
  }, [onChainTokens]);

  // 合并链上数据 + WSS 实时市场数据 + HTTP fallback：
  // 优先级: WS 实时数据 > HTTP ticker 数据 > 链上默认值
  const assets = useMemo(() => {
    const merged: InstrumentAssetData[] = onChainAssetsConverted.map(onChain => {
      const addr = (onChain.instId || "").toLowerCase() as Address;

      // 1. 优先: WS 实时数据 (来自 Matching Engine 的 market_data)
      const stats = tokenStatsMap.get(addr);
      if (stats && (stats.volume24h !== "0" || stats.lastPrice !== "0")) {
        return {
          ...onChain,
          volume24h: stats.volume24h || onChain.volume24h,
          priceChange24h: parseFloat(stats.priceChangePercent24h || "0") || onChain.priceChange24h,
          uniqueTraders: stats.trades24h || onChain.uniqueTraders, // trades24h 作为交易笔数近似值
        };
      }

      // 2. Fallback: HTTP ticker 数据 (来自 Go 后端 /api/v1/market/tickers)
      const ticker = httpTickers.find(t => t.instId?.toLowerCase() === addr);
      if (ticker) {
        let change24h = 0;
        if (ticker.open24h && ticker.last) {
          const openVal = parseFloat(ticker.open24h);
          const lastVal = parseFloat(ticker.last);
          if (openVal > 0) {
            change24h = ((lastVal - openVal) / openVal) * 100;
          }
        }
        return {
          ...onChain,
          volume24h: ticker.volCcy24h || ticker.vol24h || onChain.volume24h,
          priceChange24h: change24h || onChain.priceChange24h,
        };
      }

      return onChain;
    });

    // 按创建时间排序（最新的在前）
    return merged.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  }, [onChainAssetsConverted, tokenStatsMap, httpTickers]);

  const isLoading = isLoadingOnChain;

  // 应用筛选
  const filteredAssets = useMemo(() => {
    return filterAssets(assets, filters, ethPrice);
  }, [assets, filters, ethPrice]);

  // Categorize assets (使用筛选后的数据)
  const categorized = useMemo(() => ({
    new: filteredAssets.filter(a => !a.isGraduated).slice(0, 10),
    migrating: filteredAssets.filter(a => !a.isGraduated && parseFloat(a.fdv || "0") > 0.05).slice(0, 10),
    migrated: filteredAssets.filter(a => a.isGraduated).slice(0, 10),
  }), [filteredAssets]);

  // 计算各分类的数量（用于筛选面板显示）
  const counts = useMemo(() => ({
    new: filteredAssets.filter(a => !a.isGraduated).length,
    migrating: filteredAssets.filter(a => !a.isGraduated && parseFloat(a.fdv || "0") > 0.05).length,
    migrated: filteredAssets.filter(a => a.isGraduated).length,
  }), [filteredAssets]);

  const t = useTranslations('market');
  const tFooter = useTranslations('footer');
  const isFilterActive = hasActiveFilters(filters);

  return (
    <div className="min-h-screen bg-okx-bg-primary">
      {/* 顶部导航 */}
      <Navbar />

      <div className="max-w-[1440px] mx-auto px-4 py-4">
        {/* 工具栏 */}
        <div className="flex items-center gap-4 mb-4 text-[12px]">
          <span className="bg-okx-bg-hover text-okx-up px-2 py-1 rounded border border-okx-up flex items-center gap-1">
            <span className="w-2 h-2 bg-okx-up rounded-full"></span> {t('classicMode')}
          </span>
          <div className="flex-1"></div>
          <div className="flex items-center gap-3">
             <span className="text-okx-text-secondary">{t('show')}: 10</span>
             {/* 筛选按钮 */}
             <button
               onClick={() => setFilterPanelOpen(true)}
               className={`flex items-center gap-1 px-3 py-1.5 rounded border transition-colors ${
                 isFilterActive
                   ? 'bg-okx-up/10 border-okx-up text-okx-up'
                   : 'bg-okx-bg-hover border-okx-border-primary text-okx-text-secondary hover:border-okx-border-secondary'
               }`}
             >
               <span>⚙</span>
               <span>{t('filter')}</span>
               {isFilterActive && <span className="w-1.5 h-1.5 bg-okx-up rounded-full"></span>}
             </button>
          </div>
        </div>

        {/* 三栏列表 */}
        {/* [FIX F-H-01] 使用骨架屏代替阻塞式加载，立即渲染页面结构 */}
        {/* 优化：骨架屏至少显示 500ms，避免闪烁 */}
        <div className="flex flex-col lg:flex-row gap-6">
          {(isLoading || !minLoadingDone) ? (
            <>
              {/* 骨架屏列 - 立即显示，无阻塞 */}
              {[t('new'), t('migrating'), t('migrated')].map((title) => (
                <div key={title} className="flex-1 min-w-[320px] bg-okx-bg-primary">
                  <div className="flex items-center justify-between mb-4 sticky top-[64px] bg-okx-bg-primary py-2 z-10">
                    <h2 className="text-okx-text-primary font-bold text-[16px]">{title}</h2>
                  </div>
                  <div className="space-y-3">
                    {[1, 2, 3, 4, 5].map((i) => (
                      <div key={i} className="bg-okx-bg-hover rounded-lg p-3 animate-pulse">
                        <div className="flex items-center gap-3">
                          <div className="w-10 h-10 bg-okx-border-secondary rounded-full"></div>
                          <div className="flex-1">
                            <div className="h-4 bg-okx-border-secondary rounded w-24 mb-2"></div>
                            <div className="h-3 bg-okx-border-secondary rounded w-16"></div>
                          </div>
                          <div className="text-right">
                            <div className="h-4 bg-okx-border-secondary rounded w-16 mb-2"></div>
                            <div className="h-3 bg-okx-border-secondary rounded w-12"></div>
                          </div>
                        </div>
                        <div className="mt-3 h-2 bg-okx-border-secondary rounded-full"></div>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </>
          ) : (
            <>
              <Column title={t('new')} assets={categorized.new} noTokensText={t('noTokens')} ethPrice={ethPrice} />
              <Column title={t('migrating')} assets={categorized.migrating} noTokensText={t('noTokens')} ethPrice={ethPrice} />
              <Column title={t('migrated')} assets={categorized.migrated} noTokensText={t('noTokens')} ethPrice={ethPrice} />
            </>
          )}
        </div>
      </div>

      {/* 底部悬浮栏 */}
      <div className="fixed bottom-0 left-0 right-0 h-10 bg-okx-bg-secondary border-t border-okx-border-primary z-40 px-4 flex items-center justify-end text-[11px] text-okx-text-secondary">
        <div className="flex gap-4 items-center">
          <button
            onClick={() => setFaqPanelOpen(true)}
            className="flex items-center gap-1 hover:text-okx-text-primary transition-colors"
          >
            ❓ {tFooter('faq')}
          </button>
          <span className={`flex items-center gap-1 ${wsConnected ? 'text-okx-up' : 'text-okx-warning'}`}>
            {wsConnected ? `🟢 ${tFooter('liveUpdates')}` : `🟡 ${tFooter('connecting')}`}
          </span>
        </div>
      </div>

      {/* 筛选面板 */}
      <FilterPanel
        isOpen={filterPanelOpen}
        onClose={() => setFilterPanelOpen(false)}
        filters={filters}
        onFiltersChange={setFilters}
        counts={counts}
      />

      {/* FAQ面板 */}
      <FAQPanel
        isOpen={faqPanelOpen}
        onClose={() => setFaqPanelOpen(false)}
      />
    </div>
  );
}
