"use client";

import React, { useState, useEffect, useMemo, useCallback } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { PriceBoard } from "./PriceBoard";
import { SwapPanelOKX } from "./SwapPanelOKX";
import { TradeHistory, Trade } from "./TradeHistory";
import { SecurityStatus } from "./SecurityStatusBanner";
import { TopHolders } from "./TopHolders";
import { formatUnits, keccak256, toBytes } from "viem";
import { useInstrumentTradeStream, TradeEvent } from "@/hooks/streaming/useTradeStream";
import dynamic from 'next/dynamic';
import {
  getWebSocketServices,
  InstrumentAssetData,
  adaptInstrumentAssetResponse,
} from "@/lib/websocket";
import { useAppStore } from "@/lib/stores/appStore";
import { useETHPrice } from "@/hooks/useETHPrice";
import { useTokenMetadata } from "@/hooks/useTokenMetadata";
import { useTokenInfo, getTokenDisplayName } from "@/hooks/useTokenInfo";
import { usePoolState, calculatePriceUsd, calculateMarketCapUsd } from "@/hooks/usePoolState";
import { useOnChainTrades, OnChainTrade } from "@/hooks/useOnChainTrades";
import { tradeEventEmitter } from "@/lib/tradeEvents";

// 格式化非常小的价格，使用下标表示法 (e.g., $0.0₅62087)
function formatSmallPrice(priceUsd: number): string {
  if (priceUsd <= 0) return "$0.00";
  if (priceUsd >= 0.01) return "$" + priceUsd.toFixed(4);
  if (priceUsd >= 0.0001) return "$" + priceUsd.toFixed(6);

  // 对于非常小的价格，使用下标表示法
  const priceStr = priceUsd.toFixed(18);
  const match = priceStr.match(/^0\.(0*)([1-9]\d*)/);
  if (match) {
    const zeroCount = match[1].length;
    const significantDigits = match[2].slice(0, 5); // 保留5位有效数字
    const subscripts = ['₀', '₁', '₂', '₃', '₄', '₅', '₆', '₇', '₈', '₉'];
    const subscriptNum = zeroCount.toString().split('').map(d => subscripts[parseInt(d)]).join('');
    return `$0.0${subscriptNum}${significantDigits}`;
  }

  return "$" + priceUsd.toFixed(8);
}

// 动态导入图表组件以避免 SSR 问题并减小初始包体积
const TokenPriceChart = dynamic(
  () => import('./TokenPriceChart').then((mod) => mod.TokenPriceChart),
  {
    ssr: false,
    loading: () => <div className="w-full h-full bg-[#131722] animate-pulse" />
  }
);

interface TradingTerminalProps {
  symbol: string; // 交易对符号，如 "PEPE"
  className?: string;
}

export function TradingTerminal({ symbol, className }: TradingTerminalProps) {
  // 最早的调试日志 - 如果这个都看不到，说明组件根本没有渲染
  console.log("========== [TradingTerminal] COMPONENT MOUNTED ==========");
  console.log("[TradingTerminal] Props received:", { symbol, className });

  const t = useTranslations();
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState("tradeActivity");
  const [realtimeTrades, setRealtimeTrades] = useState<Trade[]>([]);

  // 构造 instId (用于API调用)
  const instId = symbol;

  // 从链上获取代币名称和符号
  const tokenInfo = useTokenInfo(symbol);
  const displaySymbol = getTokenDisplayName(symbol, tokenInfo);

  // 获取实时 ETH 价格
  const { price: ethPriceUsd } = useETHPrice();

  // 从 TokenFactory 合约直接获取池子状态和价格
  const isTokenAddress = symbol?.startsWith("0x") && symbol.length === 42;
  const poolData = usePoolState(isTokenAddress ? symbol : undefined);

  // 获取链上交易记录
  console.log(`[TradingTerminal] isTokenAddress: ${isTokenAddress}, symbol: ${symbol}`);
  const {
    trades: onChainTrades,
    refetch: refetchOnChainTrades,
  } = useOnChainTrades(isTokenAddress ? symbol : null, {
    enabled: isTokenAddress,
    resolutionSeconds: 60,
  });
  console.log(`[TradingTerminal] onChainTrades count: ${onChainTrades?.length || 0}`);

  // 订阅交易事件，实现交易活动的实时更新
  useEffect(() => {
    if (!symbol) return;

    console.log(`[TradingTerminal] Subscribing to trade events for symbol: ${symbol}`);
    const unsubscribe = tradeEventEmitter.subscribe((tradedToken, txHash) => {
      console.log(`[TradingTerminal] Trade event received: tradedToken=${tradedToken}, symbol=${symbol}`);
      if (tradedToken.toLowerCase() === symbol.toLowerCase()) {
        console.log(`[TradingTerminal] Token match! Refreshing trade data...`);
        // 刷新链上交易记录
        refetchOnChainTrades();
        // 刷新后端交易历史
        queryClient.invalidateQueries({ queryKey: ["tradeHistory", instId] });
      } else {
        console.log(`[TradingTerminal] Token mismatch: ${tradedToken.toLowerCase()} !== ${symbol.toLowerCase()}`);
      }
    });

    return unsubscribe;
  }, [symbol, instId, refetchOnChainTrades, queryClient]);

  // 获取 IPFS 内容的网关 URL
  const getIPFSGatewayUrl = (uri: string): string => {
    if (uri.startsWith('ipfs://')) {
      const hash = uri.replace('ipfs://', '');
      return `https://gateway.pinata.cloud/ipfs/${hash}`;
    }
    return uri;
  };

  // 从 metadataURI 获取图片 URL
  // metadataURI 可能是：1. 直接的图片 URL/IPFS  2. JSON 元数据文件  3. base64 编码的 JSON
  const [tokenLogoUrl, setTokenLogoUrl] = useState<string | undefined>(undefined);

  useEffect(() => {
    const fetchMetadataImage = async (uri: string | undefined) => {
      if (!uri) {
        setTokenLogoUrl(undefined);
        return;
      }

      try {
        // 如果是 data URI (base64 JSON)，直接解析
        if (uri.startsWith('data:application/json;base64,')) {
          const base64Data = uri.replace('data:application/json;base64,', '');
          const jsonStr = atob(base64Data);
          const metadata = JSON.parse(jsonStr);
          const imageUrl = metadata.image || metadata.logo;
          if (imageUrl) {
            setTokenLogoUrl(getIPFSGatewayUrl(imageUrl));
          }
          return;
        }

        // 如果是 IPFS 或 HTTP URL
        if (uri.startsWith('ipfs://') || uri.startsWith('http')) {
          const fetchUrl = getIPFSGatewayUrl(uri);

          // 先尝试 HEAD 请求检查内容类型
          try {
            const headResponse = await fetch(fetchUrl, { method: 'HEAD' });
            const contentType = headResponse.headers.get('content-type') || '';

            // 如果是图片，直接使用这个 URL
            if (contentType.startsWith('image/')) {
              setTokenLogoUrl(fetchUrl);
              return;
            }

            // 如果是 JSON，解析并提取 image 字段
            if (contentType.includes('json')) {
              const response = await fetch(fetchUrl);
              if (response.ok) {
                const metadata = await response.json();
                const imageUrl = metadata.image || metadata.logo;
                if (imageUrl) {
                  setTokenLogoUrl(getIPFSGatewayUrl(imageUrl));
                  return;
                }
              }
            }
          } catch {
            // HEAD 请求失败，尝试直接 GET
          }

          // 如果 HEAD 请求失败或无法判断类型，尝试 GET 并检测内容
          const response = await fetch(fetchUrl);
          if (response.ok) {
            const contentType = response.headers.get('content-type') || '';

            // 如果是图片
            if (contentType.startsWith('image/')) {
              setTokenLogoUrl(fetchUrl);
              return;
            }

            // 尝试作为 JSON 解析
            try {
              const text = await response.text();
              const metadata = JSON.parse(text);
              const imageUrl = metadata.image || metadata.logo;
              if (imageUrl) {
                setTokenLogoUrl(getIPFSGatewayUrl(imageUrl));
                return;
              }
            } catch {
              // 不是 JSON，可能是图片但 content-type 不正确，直接使用 URL
              setTokenLogoUrl(fetchUrl);
            }
          }
        }
      } catch (e) {
        console.warn('Failed to fetch metadata:', e);
        // 即使出错也尝试直接使用 URI 作为图片
        if (uri.startsWith('ipfs://') || uri.startsWith('http')) {
          setTokenLogoUrl(getIPFSGatewayUrl(uri));
        }
      }
    };

    fetchMetadataImage(poolData.poolState?.metadataURI);
  }, [poolData.poolState?.metadataURI]);

  // [DEBUG] 暂时移除 fetchMetadata
  // useEffect(() => {
  //   if (instId) {
  //     fetchMetadata(instId);
  //   }
  // }, [instId, fetchMetadata]);

  // 计算 instHash
  const instHash = useMemo(() => {
    if (!instId) return undefined;
    return keccak256(toBytes(instId));
  }, [instId]);

  // [DEBUG] 暂时移除 addRecentInstrument
  // const addRecentInstrument = useAppStore((state) => state.addRecentInstrument);
  // useEffect(() => {
  //   if (instId) {
  //     addRecentInstrument(instId);
  //   }
  // }, [instId, addRecentInstrument]);

  // [DEBUG] 使用 ref 来存储 displaySymbol 和 ethPriceUsd，避免 callback 重建
  const displaySymbolRef = React.useRef(displaySymbol);
  const ethPriceUsdRef = React.useRef(ethPriceUsd);

  React.useEffect(() => {
    displaySymbolRef.current = displaySymbol;
    ethPriceUsdRef.current = ethPriceUsd;
  }, [displaySymbol, ethPriceUsd]);

  // 实时交易流处理（带去重逻辑）- 使用 ref 避免重建
  const handleRealtimeTrade = useCallback((trade: TradeEvent) => {
    const currentEthPrice = ethPriceUsdRef.current;
    const currentDisplaySymbol = displaySymbolRef.current;

    const priceEth = parseFloat(trade.newPrice) / 1e18;
    const priceUsd = priceEth * currentEthPrice;

    const newTrade: Trade = {
      timestamp: trade.timestamp * 1000,
      type: trade.tradeType.toLowerCase() as "buy" | "sell",
      totalValue: "$" + (parseFloat(trade.ethAmount) * currentEthPrice / 1e18).toFixed(2),
      price: formatSmallPrice(priceUsd),
      quantity: (trade.tradeType === "BUY" ? "+" : "-") + (parseFloat(trade.tokenAmount) / 1e18).toFixed(2) + "M " + currentDisplaySymbol,
      quantitySol: (trade.tradeType === "BUY" ? "-" : "+") + (parseFloat(trade.ethAmount) / 1e18).toFixed(5) + " ETH",
      address: trade.traderAddress.slice(0, 6) + "..." + trade.traderAddress.slice(-4),
      txHash: trade.txHash,
      isNew: true,
    };

    setRealtimeTrades(prev => {
      if (prev.some(t => t.txHash === newTrade.txHash)) {
        return prev;
      }
      const updatedPrev = prev.map(t => ({ ...t, isNew: false }));
      return [newTrade, ...updatedPrev].slice(0, 50);
    });
  }, []); // 空依赖，使用 ref 获取最新值

  // [DEBUG] 暂时移除 WebSocket 资产更新订阅
  // useEffect(() => { ... }, [instId]);

  // [DEBUG] 暂时移除 useInstrumentTradeStream
  // const { latestTrade } = useInstrumentTradeStream(instId, { ... });
  const latestTrade = null;

  // 从 WebSocket 获取资产信息
  const { data: assetData, isLoading: isAssetLoading, isError: isAssetError } = useQuery({
    queryKey: ["instrumentAsset", instId],
    queryFn: async () => {
      const wsServices = getWebSocketServices();
      const response = await wsServices.getInstrumentAsset({
        inst_id: instId,
      });

      const adapted = adaptInstrumentAssetResponse(response);
      return {
        ...adapted,
        instId: adapted.instId || instId,
        createdAt: adapted.createdAt || 0,
      };
    },
    enabled: !!instId,
    retry: 2,
    retryDelay: 1000,
    staleTime: 10000,
    refetchInterval: false, // [DEBUG] 暂时禁用轮询
  });

  // [DEBUG] 暂时移除 liveAssetData 同步
  // useEffect(() => { ... }, [assetData]);

  // Fetch Trade History
  const { data: tradesData, isLoading: isTradesLoading, error: tradesError } = useQuery({
    queryKey: ["tradeHistory", instId],
    queryFn: async () => {
      const wsServices = getWebSocketServices();
      const response = await wsServices.getTradeHistory({
        inst_id: instId,
        page_size: 50,
      });

      if (!response.transactions) {
        return [];
      }

      return response.transactions.map((tx) => {
        const isBuy = tx.transaction_type === "BUY";
        const trader = isBuy ? tx.buyer_wallet : tx.seller_wallet;
        const priceEth = parseFloat(tx.price) / 1e18;
        const priceUsd = priceEth * ethPriceUsd;
        const tokenAmount = parseFloat(tx.token_amount) / 1e18;

        return {
          timestamp: Number(tx.transaction_timestamp) * 1000,
          type: isBuy ? "buy" : "sell",
          totalValue: "$" + (priceEth * tokenAmount * ethPriceUsd).toFixed(2),
          price: formatSmallPrice(priceUsd),
          quantity: (isBuy ? "+" : "-") + (tokenAmount / 1e6).toFixed(2) + "M " + displaySymbol,
          quantitySol: (isBuy ? "-" : "+") + (priceEth * tokenAmount).toFixed(5) + " ETH",
          address: (trader || "0x0000...0000").slice(0, 6) + "..." + (trader || "0x0000").slice(-4),
          txHash: tx.tx_hash,
        };
      }) as Trade[];
    },
    enabled: !!instId,
    staleTime: 5000,
    refetchOnWindowFocus: false, // [DEBUG] 禁用
    retry: 2,
  });

  // 安全地解析 securityStatus
  const securityStatus = useMemo(() => {
    const status = assetData?.securityStatus;
    if (typeof status === 'string' && ['UNKNOWN', 'AUTHENTIC', 'MISMATCH', 'MISSING', 'TRANSFERRED', 'GRADUATED'].includes(status)) {
      return status as SecurityStatus;
    }
    return 'AUTHENTIC' as SecurityStatus;
  }, [assetData?.securityStatus]);

  // 从合约数据获取供应量和状态（使用稳定的引用）
  const poolSoldSupply = poolData.poolState?.soldTokens?.toString();
  const poolCreator = poolData.poolState?.creator;
  const poolIsGraduated = poolData.poolState?.isGraduated;
  const poolIsActive = poolData.poolState?.isActive;

  // 构建 metadata 对象传给 PriceBoard
  const tokenMetadata = useMemo(() => {
    if (!tokenLogoUrl) return undefined;
    return {
      logoUrl: tokenLogoUrl,
    };
  }, [tokenLogoUrl]);

  // 从 assetData 或合约数据获取池子状态
  const isPoolGraduated = poolIsGraduated ?? assetData?.isGraduated ?? false;
  const isPoolActive = poolIsActive ?? true;
  const poolTotalSupply = "1000000000000000000000000000"; // 1B tokens in wei

  // [DEBUG] 简化 displayData - 直接使用 assetData
  const displayData = useMemo(() => {
    const tokenAddressFromSymbol = isTokenAddress ? symbol : undefined;

    if (assetData) {
      return {
        ...assetData,
        tokenAddress: tokenAddressFromSymbol || assetData.tokenAddress,
        creatorAddress: poolCreator || assetData.creatorAddress,
        soldSupply: poolSoldSupply || assetData.soldSupply,
        totalSupply: poolTotalSupply || assetData.totalSupply,
      };
    }
    return {
      instId,
      currentPrice: "0",
      fdv: "0",
      volume24h: "0",
      securityStatus: 'AUTHENTIC' as SecurityStatus,
      tokenAddress: tokenAddressFromSymbol,
      creatorAddress: poolCreator,
      soldSupply: poolSoldSupply,
      totalSupply: poolTotalSupply,
    } as InstrumentAssetData;
  }, [assetData, instId, isTokenAddress, symbol, poolSoldSupply, poolCreator]);

  // 安全地将字符串转换为 BigInt
  const safeBigInt = (value: string | undefined): bigint => {
    if (!value || value === "") return 0n;
    const intPart = value.split('.')[0];
    try {
      return BigInt(intPart || "0");
    } catch {
      return 0n;
    }
  };

  // 优先使用 TokenFactory 合约数据，如果后端返回 0 或无数据
  const backendPrice = safeBigInt(displayData?.currentPrice);
  const backendMarketCap = safeBigInt(displayData?.fdv);
  const backendVolume = safeBigInt(displayData?.volume24h);

  // 如果后端数据为 0 且有合约数据，使用合约数据
  const currentPrice = backendPrice === 0n && poolData.currentPrice > 0n
    ? poolData.currentPrice
    : backendPrice;
  const marketCap = backendMarketCap === 0n && poolData.marketCap > 0n
    ? poolData.marketCap
    : backendMarketCap;
  const volume24h = backendVolume; // Volume 只能从后端获取

  return (
    <div className={`flex flex-col bg-okx-bg-primary min-h-screen text-okx-text-primary ${className}`}>
      {/* 顶部面包屑与标题栏 */}
      <div className="h-8 bg-okx-bg-primary border-b border-okx-border-primary flex items-center px-4 gap-2 text-[11px] text-okx-text-secondary">
         <span>★</span>
         <span className="text-okx-text-primary font-bold">{displaySymbol}</span>
         <span className="mx-1">——</span>
         <span>
           ${(Number(formatUnits(marketCap, 18)) * ethPriceUsd).toLocaleString('en-US', { maximumFractionDigits: 2 })}
         </span>
      </div>

      {/* 核心指标头 */}
      <PriceBoard
        symbol={symbol}
        displaySymbol={displaySymbol}
        tokenAddress={(displayData as any)?.tokenAddress}
        currentPrice={currentPrice}
        price24hChange={displayData.priceChange24h || 0}
        marketCap={marketCap}
        volume24h={volume24h}
        securityStatus={securityStatus}
        metadata={tokenMetadata}
      />

      <div className="flex flex-1 overflow-hidden">
        {/* 中间图表 + 底部列表 (75%) */}
        <div className="flex-[3] border-r border-okx-border-primary flex flex-col overflow-hidden">
           {/* K线图本体 - TradingView 官方 Lightweight Charts */}
           <div className="h-[400px] bg-[#131722]">
              <TokenPriceChart symbol={symbol} displaySymbol={displaySymbol} latestTrade={latestTrade} />
           </div>

           {/* 底部详情选项卡 */}
           <div className="h-[400px] border-t border-okx-border-primary flex flex-col bg-okx-bg-primary">
              <div className="flex border-b border-okx-border-primary px-4">
                 {[
                   { key: "tradeActivity", label: t('trading.tradeActivity') },
                   { key: "about", label: t('trading.about') || "About" },
                   { key: "profitAddresses", label: t('trading.profitAddresses') },
                   { key: "holdingAddresses", label: t('trading.holdingAddresses') },
                   { key: "watchedAddresses", label: t('trading.watchedAddresses') },
                   { key: "liquidity", label: t('trading.liquidity') },
                   { key: "myPosition", label: t('trading.myPosition') }
                 ].map(tab => (
                    <button
                      key={tab.key}
                      onClick={() => setActiveTab(tab.key)}
                      className={`py-2 px-4 text-[12px] transition-colors relative ${activeTab === tab.key ? 'text-okx-text-primary font-bold' : 'text-okx-text-secondary'}`}
                    >
                      {tab.label}
                      {activeTab === tab.key && <div className="absolute bottom-0 left-0 right-0 h-[2px] bg-[#A3E635]"></div>}
                    </button>
                 ))}
              </div>
              <div className="flex-1 overflow-y-auto">
                 {activeTab === "tradeActivity" && (
                   <>
                     <div className="p-3 flex gap-3 text-[11px] border-b border-okx-border-primary">
                        <span className="bg-okx-bg-hover text-okx-text-primary px-2 py-0.5 rounded cursor-pointer">{t('common.all')}</span>
                        {[
                          { key: "kol", label: t('holders.kol') },
                          { key: "ratHole", label: t('holders.ratHole') },
                          { key: "whale", label: t('holders.whale') },
                          { key: "sniper", label: t('holders.sniper') },
                          { key: "smartMoney", label: t('holders.smartMoney') },
                          { key: "dev", label: t('holders.dev') }
                        ].map(f => (
                           <span key={f.key} className="text-okx-text-tertiary hover:text-okx-text-secondary cursor-pointer">{f.label}</span>
                        ))}
                     </div>
                     {/* 合并链上交易、实时交易和历史交易，按 txHash 去重 */}
                     <TradeHistory trades={(() => {
                       const seenTxHashes = new Set<string>();
                       const merged: Trade[] = [];

                       console.log(`[TradingTerminal] Building trade list - onChainTrades: ${onChainTrades?.length || 0}, realtimeTrades: ${realtimeTrades.length}, historyTrades: ${tradesData?.length || 0}`);

                       // 首先添加链上交易（最准确的数据源）
                       if (Array.isArray(onChainTrades) && onChainTrades.length > 0) {
                         console.log(`[TradingTerminal] Processing ${onChainTrades.length} on-chain trades`);
                         // 按时间倒序排列
                         const sortedOnChain = [...onChainTrades].sort((a, b) => b.timestamp - a.timestamp);
                         for (const trade of sortedOnChain) {
                           if (trade.transactionHash && !seenTxHashes.has(trade.transactionHash)) {
                             seenTxHashes.add(trade.transactionHash);
                             const priceUsd = trade.price * ethPriceUsd;
                             const ethAmount = Number(trade.ethAmount) / 1e18;
                             const tokenAmount = Number(trade.tokenAmount) / 1e18;
                             merged.push({
                               timestamp: trade.timestamp * 1000,
                               type: trade.isBuy ? "buy" : "sell",
                               totalValue: "$" + (ethAmount * ethPriceUsd).toFixed(2),
                               price: formatSmallPrice(priceUsd),
                               quantity: (trade.isBuy ? "+" : "-") + (tokenAmount / 1e6).toFixed(2) + "M " + displaySymbol,
                               quantitySol: (trade.isBuy ? "-" : "+") + ethAmount.toFixed(5) + " ETH",
                               address: trade.trader.slice(0, 6) + "..." + trade.trader.slice(-4),
                               txHash: trade.transactionHash,
                               isNew: Date.now() - trade.timestamp * 1000 < 30000, // 30秒内的交易标记为新
                             });
                           }
                         }
                       }

                       // 添加实时交易
                       for (const trade of realtimeTrades) {
                         if (trade.txHash && !seenTxHashes.has(trade.txHash)) {
                           seenTxHashes.add(trade.txHash);
                           merged.push(trade);
                         }
                       }

                       // 添加后端历史交易
                       const historyTrades = Array.isArray(tradesData) ? tradesData : [];
                       for (const trade of historyTrades) {
                         if (trade.txHash && !seenTxHashes.has(trade.txHash)) {
                           seenTxHashes.add(trade.txHash);
                           merged.push(trade);
                         }
                       }

                       console.log(`[TradingTerminal] Final merged trades: ${merged.length}`);
                       // 按时间排序并限制数量
                       return merged.sort((a, b) => b.timestamp - a.timestamp).slice(0, 100);
                     })()} />
                   </>
                 )}
                 {activeTab === "about" && (
                   <div className="p-4">
                     <div className="text-center text-okx-text-tertiary">
                       <p>{t('trading.noDescription') || "No description available for this token."}</p>
                     </div>
                   </div>
                 )}
                 {activeTab === "holdingAddresses" && (
                   <TopHolders
                     instId={instId}
                     creatorAddress={(displayData as any)?.creatorAddress}
                   />
                 )}
                 {activeTab === "profitAddresses" && (
                   <div className="p-4 text-center text-okx-text-tertiary">
                     <p>{t('trading.featureInDev')}</p>
                   </div>
                 )}
                 {activeTab === "watchedAddresses" && (
                   <div className="p-4 text-center text-okx-text-tertiary">
                     <p>{t('trading.featureInDev')}</p>
                   </div>
                 )}
                 {activeTab === "liquidity" && (
                   <div className="p-4 text-center text-okx-text-tertiary">
                     <p>{t('trading.featureInDev')}</p>
                   </div>
                 )}
                 {activeTab === "myPosition" && (
                   <div className="p-4 text-center text-okx-text-tertiary">
                     <p>{t('trading.connectWalletToView')}</p>
                   </div>
                 )}
              </div>
           </div>
        </div>

        {/* 右侧交易面板 (25%) */}
        <div className="flex-1 bg-okx-bg-primary p-2 overflow-y-auto">
           <SwapPanelOKX
             symbol={symbol}
             securityStatus={securityStatus}
             tokenAddress={(displayData as any)?.tokenAddress as `0x${string}` | undefined}
             soldSupply={displayData?.soldSupply}
             totalSupply={displayData?.totalSupply}
             isGraduated={isPoolGraduated}
             isPoolActive={isPoolActive}
           />
        </div>
      </div>

    </div>
  );
}
