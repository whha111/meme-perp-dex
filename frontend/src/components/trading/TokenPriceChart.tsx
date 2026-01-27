"use client";

/**
 * TradingView Lightweight Charts™ - 实时 K 线图
 *
 * 特性：
 * - 首次加载从后端获取历史 K 线数据
 * - 实时交易流更新最新 K 线
 * - 毫秒级响应，类似 pump.fun 的实时体验
 * - 支持多时间周期切换
 * - 支持明暗主题切换
 */

import React, { useEffect, useRef, useState, useCallback, useMemo } from "react";
import {
  createChart,
  ColorType,
  IChartApi,
  ISeriesApi,
  CandlestickData,
  HistogramData,
  Time,
  MouseEventParams,
} from "lightweight-charts";
import { TradeEvent, useInstrumentTradeStream } from "@/hooks/streaming/useTradeStream";
import { getWebSocketServices, KlineBar as WSKlineBar } from "@/lib/websocket";
import { useOnChainTrades, useOnChainTradeStream, type OnChainTrade, type KlineBar as OnChainKlineBar } from "@/hooks/useOnChainTrades";
import { useAppStore } from "@/lib/stores/appStore";
import { useTranslations } from "next-intl";

interface TokenPriceChartProps {
  symbol: string;  // 交易对符号或合约地址
  displaySymbol?: string;  // 显示用的代币符号
  className?: string;
  latestTrade?: TradeEvent | null;
}

type Resolution = "1m" | "5m" | "15m" | "1h" | "4h" | "1d";

const RESOLUTION_SECONDS: Record<Resolution, number> = {
  "1m": 60,
  "5m": 300,
  "15m": 900,
  "1h": 3600,
  "4h": 14400,
  "1d": 86400,
};

const RESOLUTION_KEYS: Record<Resolution, string> = {
  "1m": "1min",
  "5m": "5min",
  "15m": "15min",
  "1h": "1hour",
  "4h": "4hour",
  "1d": "1day",
};

// ETH 价格使用 useETHPrice hook 获取实时价格
import { useETHPrice, ETH_PRICE_FALLBACK } from "@/hooks/useETHPrice";

// 主题配色 - 参考 TradingView 专业风格
const CHART_THEMES = {
  dark: {
    upColor: '#26a69a',
    downColor: '#ef5350',
    background: '#131722',
    textColor: '#9CA3AF',
    gridColor: 'rgba(42, 46, 57, 0.5)',
    borderColor: '#2A2E39',
    toolbarBg: '#131722',
    hoverBg: '#2A2E39',
    accentColor: '#2962FF',
    volumeUpColor: 'rgba(38, 166, 154, 0.5)',
    volumeDownColor: 'rgba(239, 83, 80, 0.5)',
  },
  light: {
    upColor: '#089981',
    downColor: '#F23645',
    background: '#FFFFFF',
    textColor: '#131722',
    gridColor: 'rgba(42, 46, 57, 0.06)',
    borderColor: '#E0E3EB',
    toolbarBg: '#F8FAFD',
    hoverBg: '#F0F3F8',
    accentColor: '#2962FF',
    volumeUpColor: 'rgba(8, 153, 129, 0.3)',
    volumeDownColor: 'rgba(242, 54, 69, 0.3)',
  },
};

// Helper to get chart colors based on theme
const getChartColors = (theme: 'light' | 'dark' | 'system') => {
  if (theme === 'system') {
    const prefersDark = typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: dark)').matches;
    return prefersDark ? CHART_THEMES.dark : CHART_THEMES.light;
  }
  return theme === 'light' ? CHART_THEMES.light : CHART_THEMES.dark;
};

interface OHLCDisplay {
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  change: number;
  changePercent: number;
  isUp: boolean;
}

// K 线数据结构
interface KlineBar {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

// 客户端 K 线聚合器
class KlineAggregator {
  private bars: Map<number, KlineBar> = new Map();
  private resolution: number;

  constructor(resolutionSeconds: number) {
    this.resolution = resolutionSeconds;
  }

  // 设置历史 K 线数据（从后端加载）
  setBar(bar: KlineBar): void {
    this.bars.set(bar.time, bar);
  }

  // 根据交易更新 K 线 (价格转换为 USD)
  addTrade(trade: TradeEvent, ethPrice: number = ETH_PRICE_FALLBACK): KlineBar {
    const priceEth = parseFloat(trade.newPrice) / 1e18;
    const price = priceEth * ethPrice; // 转换为 USD
    const volume = parseFloat(trade.ethAmount) / 1e18;
    const timestamp = trade.timestamp;

    // 计算该交易所属的 K 线时间桶
    const bucketTime = Math.floor(timestamp / this.resolution) * this.resolution;

    let bar = this.bars.get(bucketTime);

    if (!bar) {
      // 创建新 K 线，但需要继承上一根的收盘价作为开盘价
      const prevBar = this.getLatestBar();
      const openPrice = prevBar ? prevBar.close : price;

      bar = {
        time: bucketTime,
        open: openPrice,
        high: Math.max(openPrice, price),
        low: Math.min(openPrice, price),
        close: price,
        volume: volume,
      };
    } else {
      // 更新现有 K 线
      bar.high = Math.max(bar.high, price);
      bar.low = Math.min(bar.low, price);
      bar.close = price;
      bar.volume += volume;
    }

    this.bars.set(bucketTime, bar);
    return bar;
  }

  // 获取最新的 K 线
  getLatestBar(): KlineBar | null {
    if (this.bars.size === 0) return null;
    const times = Array.from(this.bars.keys()).sort((a, b) => b - a);
    return this.bars.get(times[0]) || null;
  }

  // 获取所有 K 线（按时间排序）
  getBars(): KlineBar[] {
    return Array.from(this.bars.values()).sort((a, b) => a.time - b.time);
  }

  // 清空数据
  clear(): void {
    this.bars.clear();
  }

  // 获取 K 线数量
  get size(): number {
    return this.bars.size;
  }
}

function formatPrice(price: number): string {
  if (price === 0) return "$0";
  if (price < 0.000001) return "$" + price.toFixed(10);
  if (price < 0.0001) return "$" + price.toFixed(8);
  if (price < 0.01) return "$" + price.toFixed(6);
  if (price < 1) return "$" + price.toFixed(4);
  if (price < 100) return "$" + price.toFixed(2);
  return "$" + price.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatVolume(vol: number): string {
  if (vol >= 1000000) return (vol / 1000000).toFixed(2) + "M ETH";
  if (vol >= 1000) return (vol / 1000).toFixed(2) + "K ETH";
  if (vol >= 1) return vol.toFixed(2) + " ETH";
  return vol.toFixed(4) + " ETH";
}

export function TokenPriceChart({ symbol, displaySymbol, className, latestTrade }: TokenPriceChartProps) {
  // 使用 symbol 作为 instId
  const instId = symbol;
  const chartContainerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candleSeriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const volumeSeriesRef = useRef<ISeriesApi<"Histogram"> | null>(null);
  const aggregatorRef = useRef<KlineAggregator | null>(null);

  const [resolution, setResolution] = useState<Resolution>("1m");
  const [ohlcDisplay, setOhlcDisplay] = useState<OHLCDisplay | null>(null);
  const [isHovering, setIsHovering] = useState(false);
  const [isLogScale, setIsLogScale] = useState(false);
  const [currentTime, setCurrentTime] = useState("");
  const [tradeCount, setTradeCount] = useState(0);
  const [isLoadingHistory, setIsLoadingHistory] = useState(true);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const historicalDataLoadedRef = useRef(false);

  // Get theme from store
  const theme = useAppStore((state) => state.preferences.theme);

  // ✅ 获取实时 ETH 价格
  const { price: ethPriceUsd } = useETHPrice();

  // i18n
  const t = useTranslations("trading");
  const tc = useTranslations("chart");
  const chartColors = getChartColors(theme);

  // ✅ On-chain data fallback when WebSocket isn't available
  const isTokenAddress = instId.startsWith("0x");
  const {
    trades: onChainTrades,
    klines: onChainKlines,
    isLoading: isLoadingOnChain,
    refetch: refetchOnChain
  } = useOnChainTrades(isTokenAddress ? instId : null, {
    enabled: isTokenAddress,
    resolutionSeconds: RESOLUTION_SECONDS[resolution],
  });

  // Watch for new on-chain trades
  const { latestTrade: onChainLatestTrade, isConnected: isOnChainConnected } = useOnChainTradeStream(
    isTokenAddress ? instId : null,
    {
      enabled: isTokenAddress,
      onTrade: (trade) => {
        // Update K-line with new trade
        if (aggregatorRef.current && candleSeriesRef.current && volumeSeriesRef.current && chartRef.current) {
          const priceUsd = trade.price * ethPriceUsd;
          const volume = Number(trade.ethAmount) / 1e18;
          const bucketTime = Math.floor(trade.timestamp / RESOLUTION_SECONDS[resolution]) * RESOLUTION_SECONDS[resolution];

          // Get or create bar
          let bar = aggregatorRef.current.getLatestBar();
          if (!bar || bar.time !== bucketTime) {
            const prevClose = bar ? bar.close : priceUsd;
            bar = {
              time: bucketTime,
              open: prevClose,
              high: Math.max(prevClose, priceUsd),
              low: Math.min(prevClose, priceUsd),
              close: priceUsd,
              volume: volume,
            };
          } else {
            bar.high = Math.max(bar.high, priceUsd);
            bar.low = Math.min(bar.low, priceUsd);
            bar.close = priceUsd;
            bar.volume += volume;
          }

          aggregatorRef.current.setBar(bar);
          setTradeCount(aggregatorRef.current.size);

          // Update chart
          candleSeriesRef.current.update({
            time: bar.time as Time,
            open: bar.open,
            high: bar.high,
            low: bar.low,
            close: bar.close,
          });

          volumeSeriesRef.current.update({
            time: bar.time as Time,
            value: bar.volume,
            color: bar.close >= bar.open ? 'rgba(38, 166, 154, 0.5)' : 'rgba(239, 83, 80, 0.5)',
          });

          if (autoScrollRef.current) {
            chartRef.current.timeScale().scrollToRealTime();
          }
        }
      },
    }
  );

  // 加载历史 K 线数据
  const loadHistoricalKlines = useCallback(async () => {
    if (!instId || !candleSeriesRef.current || !volumeSeriesRef.current) {
      return;
    }

    setIsLoadingHistory(true);
    setHistoryError(null);

    try {
      const wsServices = getWebSocketServices();
      const now = Math.floor(Date.now() / 1000);
      const resolutionSeconds = RESOLUTION_SECONDS[resolution];
      // 获取足够长的历史数据（最多7天或500根K线，取较大者）
      const minBars = 500;
      const maxDays = 7;
      const from = now - Math.max(resolutionSeconds * minBars, maxDays * 86400);

      const response = await wsServices.getKlineHistory({
        inst_id: instId,
        resolution: resolution,
        from,
        to: now,
      });

      if (response.success && response.bars && response.bars.length > 0) {
        // 创建新的聚合器（使用当前分辨率）
        const newAggregator = new KlineAggregator(resolutionSeconds);
        aggregatorRef.current = newAggregator;

        // 将历史 K 线转换为图表格式，同时同步到聚合器
        const candles: CandlestickData<Time>[] = [];
        const volumes: HistogramData<Time>[] = [];

        response.bars.forEach((bar: WSKlineBar) => {
          // 价格从 ETH 转换为 USD
          const open = (parseFloat(bar.open) / 1e18) * ethPriceUsd;
          const high = (parseFloat(bar.high) / 1e18) * ethPriceUsd;
          const low = (parseFloat(bar.low) / 1e18) * ethPriceUsd;
          const close = (parseFloat(bar.close) / 1e18) * ethPriceUsd;
          const volume = parseFloat(bar.volume) / 1e18;
          const isUp = close >= open;

          candles.push({
            time: bar.time as Time,
            open,
            high,
            low,
            close,
          });

          volumes.push({
            time: bar.time as Time,
            value: volume,
            color: isUp ? 'rgba(38, 166, 154, 0.5)' : 'rgba(239, 83, 80, 0.5)',
          });

          // 同步到聚合器，确保实时更新时数据连续
          newAggregator.setBar({
            time: bar.time,
            open,
            high,
            low,
            close,
            volume,
          });
        });

        candleSeriesRef.current.setData(candles);
        volumeSeriesRef.current.setData(volumes);
        // 先适应内容，然后滚动到最新位置
        chartRef.current?.timeScale().fitContent();
        // 延迟滚动到最新，确保渲染完成
        setTimeout(() => {
          chartRef.current?.timeScale().scrollToRealTime();
        }, 50);
        setTradeCount(candles.length);
        historicalDataLoadedRef.current = true;
      } else if (response.success && (!response.bars || response.bars.length === 0)) {
        // 没有数据，但请求成功
        setTradeCount(0);
        historicalDataLoadedRef.current = true;
      } else if (response.message) {
        setHistoryError(response.message);
      }
    } catch (err) {
      console.error("Failed to load kline history:", err);
      setHistoryError(err instanceof Error ? err.message : "加载K线历史失败");
    } finally {
      setIsLoadingHistory(false);
    }
  }, [instId, resolution]);

  // 是否自动滚动到最新K线
  const autoScrollRef = useRef(true);

  // 订阅实时交易流
  const { trades, latestTrade: streamLatestTrade, isConnected } = useInstrumentTradeStream(instId, {
    enabled: !!instId,
    onTrade: (trade) => {
      // 实时更新 K 线
      if (aggregatorRef.current && candleSeriesRef.current && volumeSeriesRef.current && chartRef.current) {
        const bar = aggregatorRef.current.addTrade(trade, ethPriceUsd);
        setTradeCount(aggregatorRef.current.size);

        // 更新图表
        const candleData: CandlestickData<Time> = {
          time: bar.time as Time,
          open: bar.open,
          high: bar.high,
          low: bar.low,
          close: bar.close,
        };

        const isUp = bar.close >= bar.open;
        const volumeData: HistogramData<Time> = {
          time: bar.time as Time,
          value: bar.volume,
          color: isUp ? 'rgba(38, 166, 154, 0.5)' : 'rgba(239, 83, 80, 0.5)',
        };

        candleSeriesRef.current.update(candleData);
        volumeSeriesRef.current.update(volumeData);

        // 自动滚动到最新K线（如果用户没有手动滚动过）
        if (autoScrollRef.current) {
          chartRef.current.timeScale().scrollToRealTime();
        }
      }
    },
  });

  // 计算最新 OHLC
  const latestOHLC = useMemo<OHLCDisplay | null>(() => {
    if (!aggregatorRef.current) return null;
    const bars = aggregatorRef.current.getBars();
    if (bars.length === 0) return null;

    const latest = bars[bars.length - 1];
    // 涨跌幅：当前K线收盘价相对于开盘价的变化
    const change = latest.close - latest.open;
    const changePercent = latest.open > 0 ? (change / latest.open) * 100 : 0;

    return {
      open: latest.open,
      high: latest.high,
      low: latest.low,
      close: latest.close,
      volume: latest.volume,
      change,
      changePercent,
      isUp: change >= 0,
    };
  }, [tradeCount]);

  // 当分辨率变化时，重新加载历史数据
  useEffect(() => {
    // 重置聚合器
    aggregatorRef.current = new KlineAggregator(RESOLUTION_SECONDS[resolution]);
    setTradeCount(0);
    historicalDataLoadedRef.current = false;

    // 清空图表数据
    if (candleSeriesRef.current && volumeSeriesRef.current) {
      candleSeriesRef.current.setData([]);
      volumeSeriesRef.current.setData([]);
    }

    // 如果图表已经初始化，加载历史数据
    if (chartRef.current && candleSeriesRef.current && volumeSeriesRef.current) {
      loadHistoricalKlines();
    }
  }, [resolution, loadHistoricalKlines]);

  // 当 WebSocket 连接且图表就绪时，加载历史数据
  // 添加重试机制确保数据加载成功
  useEffect(() => {
    if (!isConnected || !chartRef.current || !candleSeriesRef.current) {
      return;
    }

    // 如果已加载过且有数据，不再重复加载
    if (historicalDataLoadedRef.current && tradeCount > 0) {
      return;
    }

    // 立即加载
    loadHistoricalKlines();

    // 设置备用重试（防止首次加载失败）
    const retryTimer = setTimeout(() => {
      if (!historicalDataLoadedRef.current || tradeCount === 0) {
        loadHistoricalKlines();
      }
    }, 2000);

    return () => clearTimeout(retryTimer);
  }, [isConnected, loadHistoricalKlines, tradeCount]);

  // ✅ Load on-chain K-line data for token addresses (primary data source for meme tokens)
  useEffect(() => {
    // For token addresses, always prefer on-chain data
    if (!isTokenAddress) {
      return;
    }

    if (!chartRef.current || !candleSeriesRef.current || !volumeSeriesRef.current) {
      return;
    }

    if (isLoadingOnChain || onChainKlines.length === 0) {
      return;
    }

    // Create new aggregator
    const newAggregator = new KlineAggregator(RESOLUTION_SECONDS[resolution]);
    aggregatorRef.current = newAggregator;

    // Convert on-chain klines to chart format
    const candles: CandlestickData<Time>[] = [];
    const volumes: HistogramData<Time>[] = [];

    onChainKlines.forEach((bar) => {
      // Convert ETH price to USD
      const open = bar.open * ethPriceUsd;
      const high = bar.high * ethPriceUsd;
      const low = bar.low * ethPriceUsd;
      const close = bar.close * ethPriceUsd;
      const isUp = close >= open;

      candles.push({
        time: bar.time as Time,
        open,
        high,
        low,
        close,
      });

      volumes.push({
        time: bar.time as Time,
        value: bar.volume,
        color: isUp ? 'rgba(38, 166, 154, 0.5)' : 'rgba(239, 83, 80, 0.5)',
      });

      // Sync to aggregator
      newAggregator.setBar({
        time: bar.time,
        open,
        high,
        low,
        close,
        volume: bar.volume,
      });
    });

    candleSeriesRef.current.setData(candles);
    volumeSeriesRef.current.setData(volumes);
    chartRef.current?.timeScale().fitContent();
    setTimeout(() => {
      chartRef.current?.timeScale().scrollToRealTime();
    }, 50);
    setTradeCount(candles.length);
    historicalDataLoadedRef.current = true;
    setIsLoadingHistory(false);
  }, [isConnected, isTokenAddress, isLoadingOnChain, onChainKlines, ethPriceUsd, resolution]);

  // UTC 时间更新
  useEffect(() => {
    const updateTime = () => {
      const now = new Date();
      const hours = now.getUTCHours().toString().padStart(2, '0');
      const minutes = now.getUTCMinutes().toString().padStart(2, '0');
      const seconds = now.getUTCSeconds().toString().padStart(2, '0');
      setCurrentTime(`${hours}:${minutes}:${seconds}`);
    };
    updateTime();
    const timer = setInterval(updateTime, 1000);
    return () => clearInterval(timer);
  }, []);

  // 初始化图表
  useEffect(() => {
    if (!chartContainerRef.current) return;

    // 初始化聚合器
    aggregatorRef.current = new KlineAggregator(RESOLUTION_SECONDS[resolution]);

    // Get initial colors
    const colors = getChartColors(useAppStore.getState().preferences.theme);

    const chartOptions = {
      layout: {
        textColor: colors.textColor,
        background: {
          type: ColorType.Solid,
          color: colors.background,
        },
        fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
      },
      width: chartContainerRef.current.clientWidth,
      height: chartContainerRef.current.clientHeight || 160,
      grid: {
        vertLines: { color: colors.gridColor, style: 0 },
        horzLines: { color: colors.gridColor, style: 0 },
      },
      rightPriceScale: { borderVisible: false, borderColor: 'transparent' },
      leftPriceScale: { visible: false, borderVisible: false },
      timeScale: {
        borderVisible: false,
        borderColor: 'transparent',
        rightOffset: 5, // 右侧留出空间显示最新K线
        shiftVisibleRangeOnNewBar: true, // 新K线时自动滚动
      },
      crosshair: {
        vertLine: { color: 'rgba(128, 128, 128, 0.3)', style: 2, labelBackgroundColor: colors.background },
        horzLine: { color: 'rgba(128, 128, 128, 0.3)', style: 2, labelBackgroundColor: colors.background },
      },
    };

    const chart = createChart(chartContainerRef.current, chartOptions);

    const candlestickSeries = chart.addCandlestickSeries({
      upColor: colors.upColor,
      downColor: colors.downColor,
      borderVisible: false,
      wickUpColor: colors.upColor,
      wickDownColor: colors.downColor,
      priceFormat: { type: 'price', precision: 8, minMove: 0.00000001 }, // USD 价格精度
    });

    const histogramSeries = chart.addHistogramSeries({
      color: colors.upColor,
      priceFormat: { type: 'volume' },
      priceScaleId: '',
    });

    histogramSeries.priceScale().applyOptions({
      scaleMargins: { top: 0.8, bottom: 0 },
    });

    chartRef.current = chart;
    candleSeriesRef.current = candlestickSeries;
    volumeSeriesRef.current = histogramSeries;

    // 图表就绪后，如果 WebSocket 已连接则加载历史数据
    // 使用 setTimeout 确保 refs 已更新
    setTimeout(() => {
      if (isConnected && !historicalDataLoadedRef.current) {
        loadHistoricalKlines();
      }
    }, 100);

    // 监听时间轴滚动 - 检测用户是否手动滚动
    chart.timeScale().subscribeVisibleTimeRangeChange(() => {
      // 检查是否滚动到了最右边（最新数据）
      const timeScale = chart.timeScale();
      const visibleRange = timeScale.getVisibleLogicalRange();
      if (visibleRange) {
        // 如果可见范围的右边界接近最新数据，启用自动滚动
        // scrollToRealTime 会将视图滚动到最右边
        const scrolledToEnd = visibleRange.to >= timeScale.scrollPosition() + (visibleRange.to - visibleRange.from) * 0.9;
        autoScrollRef.current = scrolledToEnd;
      }
    });

    // 十字光标事件
    chart.subscribeCrosshairMove((param: MouseEventParams<Time>) => {
      if (!param.time || param.point === undefined || !param.seriesData.size) {
        setIsHovering(false);
        return;
      }

      setIsHovering(true);

      const candleData = param.seriesData.get(candlestickSeries) as CandlestickData<Time> | undefined;
      const volumeData = param.seriesData.get(histogramSeries) as HistogramData<Time> | undefined;

      if (candleData && typeof candleData.open === 'number') {
        const change = candleData.close - candleData.open;
        const changePercent = candleData.open > 0 ? (change / candleData.open) * 100 : 0;

        setOhlcDisplay({
          open: candleData.open,
          high: candleData.high,
          low: candleData.low,
          close: candleData.close,
          volume: volumeData?.value || 0,
          change,
          changePercent,
          isUp: change >= 0,
        });
      }
    });

    const handleResize = () => {
      if (chartContainerRef.current && chart) {
        chart.applyOptions({
          width: chartContainerRef.current.clientWidth,
          height: chartContainerRef.current.clientHeight,
        });
      }
    };

    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('resize', handleResize);
      chart.remove();
      chartRef.current = null;
      candleSeriesRef.current = null;
      volumeSeriesRef.current = null;
    };
  }, []);

  // Update chart colors when theme changes
  useEffect(() => {
    if (!chartRef.current) return;

    chartRef.current.applyOptions({
      layout: {
        textColor: chartColors.textColor,
        background: {
          type: ColorType.Solid,
          color: chartColors.background,
        },
      },
      grid: {
        vertLines: { color: chartColors.gridColor },
        horzLines: { color: chartColors.gridColor },
      },
      crosshair: {
        vertLine: { labelBackgroundColor: chartColors.background },
        horzLine: { labelBackgroundColor: chartColors.background },
      },
    });
  }, [theme, chartColors]);

  // 切换对数刻度
  const toggleLogScale = () => {
    if (chartRef.current) {
      const newMode = !isLogScale;
      setIsLogScale(newMode);
      chartRef.current.priceScale('right').applyOptions({
        mode: newMode ? 1 : 0,
      });
    }
  };

  // 自动缩放
  const handleAutoScale = () => {
    if (chartRef.current) {
      chartRef.current.timeScale().fitContent();
    }
  };

  const displayOHLC = isHovering && ohlcDisplay ? ohlcDisplay : latestOHLC;
  // 使用 displaySymbol 或从 instId 提取 token symbol
  const tokenSymbol = displaySymbol || (
    instId.startsWith('0x')
      ? `${instId.slice(0, 6)}...${instId.slice(-4)}`
      : instId.split('-')[0].toUpperCase()
  );

  return (
    <div className={`flex flex-col w-full h-full ${className}`} style={{ backgroundColor: chartColors.background }}>
      {/* 顶部价格信息栏 */}
      <div className="h-[48px] flex items-center px-4" style={{ backgroundColor: chartColors.background, borderBottom: `1px solid ${chartColors.borderColor}` }}>
        {/* 左侧：交易对 */}
        <div className="flex items-center gap-2">
          <span className="text-okx-text-primary font-bold text-[16px]">{tokenSymbol}</span>
          <span className="text-[#787B86] text-[12px]">/USD</span>
        </div>

        {displayOHLC && (
          <>
            {/* 当前价格 - 大字显示 */}
            <div className="ml-6">
              <span className={`font-bold text-[20px] ${displayOHLC.isUp ? 'text-[#26a69a]' : 'text-[#ef5350]'}`}>
                {formatPrice(displayOHLC.close)}
              </span>
            </div>

            {/* 涨跌幅 */}
            <div className={`ml-3 px-2 py-1 rounded text-[13px] font-medium ${
              displayOHLC.isUp
                ? 'text-[#26a69a] bg-[#26a69a]/15'
                : 'text-[#ef5350] bg-[#ef5350]/15'
            }`}>
              {displayOHLC.isUp ? '+' : ''}{displayOHLC.changePercent.toFixed(2)}%
            </div>

            {/* 分隔线 */}
            <div className="mx-4 h-6 w-px bg-[#2A2E39]" />

            {/* High/Low */}
            <div className="flex items-center gap-4 text-[12px]">
              <div className="flex items-center gap-1.5">
                <span className="text-[#787B86]">{t("high")}</span>
                <span className="text-[#26a69a]">{formatPrice(displayOHLC.high)}</span>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="text-[#787B86]">{t("low")}</span>
                <span className="text-[#ef5350]">{formatPrice(displayOHLC.low)}</span>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="text-[#787B86]">{t("vol")}</span>
                <span className="text-[#9CA3AF]">{formatVolume(displayOHLC.volume)}</span>
              </div>
            </div>
          </>
        )}
      </div>

      {/* Toolbar */}
      <div className="h-[32px] flex items-center px-3 gap-2" style={{ backgroundColor: chartColors.toolbarBg }}>
        <div className="flex items-center gap-0.5">
          {(Object.keys(RESOLUTION_KEYS) as Resolution[]).map((key) => (
            <button
              key={key}
              onClick={() => setResolution(key)}
              className={`px-2 py-0.5 text-[11px] font-medium rounded transition-all ${
                resolution === key
                  ? 'text-okx-text-primary bg-[#2962FF]'
                  : 'text-[#787B86] hover:text-okx-text-primary hover:bg-[#2A2E39]'
              }`}
            >
              {tc(RESOLUTION_KEYS[key])}
            </button>
          ))}
        </div>

        <div className="flex-1" />

        <div className="flex items-center gap-3 text-[12px]">
          <span className="text-[#787B86]">{currentTime} UTC</span>
          <span className="text-[#363A45]">|</span>

          <button
            onClick={toggleLogScale}
            className={`px-2 py-1 rounded transition-all ${
              isLogScale
                ? 'text-okx-text-primary bg-[#2962FF]'
                : 'text-[#787B86] hover:text-okx-text-primary hover:bg-[#2A2E39]'
            }`}
          >
            log
          </button>

          <button
            onClick={handleAutoScale}
            className="px-2 py-1 rounded text-[#26a69a] hover:bg-[#2A2E39] transition-all"
          >
            {t("auto")}
          </button>

          <span className="text-[#363A45]">|</span>

          {/* Connection status */}
          <div className="flex items-center gap-1.5">
            {isConnected ? (
              <>
                <span className="w-1.5 h-1.5 rounded-full bg-[#26a69a] animate-pulse" />
                <span className="text-[#26a69a]">{t("realtime")} ({tradeCount})</span>
              </>
            ) : isOnChainConnected ? (
              <>
                <span className="w-1.5 h-1.5 rounded-full bg-[#26a69a] animate-pulse" />
                <span className="text-[#26a69a]">On-chain ({tradeCount})</span>
              </>
            ) : isTokenAddress && onChainTrades.length > 0 ? (
              <>
                <span className="w-1.5 h-1.5 rounded-full bg-blue-500" />
                <span className="text-blue-500">Historical ({tradeCount})</span>
              </>
            ) : (
              <>
                <span className="w-1.5 h-1.5 rounded-full bg-yellow-500 animate-pulse" />
                <span className="text-yellow-500">{t("connecting")}</span>
              </>
            )}
          </div>
        </div>
      </div>

      {/* 图表区域 */}
      <div className="relative flex-1 w-full min-h-0" style={{ backgroundColor: chartColors.background }}>
        <div ref={chartContainerRef} className="w-full h-full" />

        {/* 空数据/加载状态 */}
        {(tradeCount === 0 || isLoadingHistory || isLoadingOnChain) && (
          <div className="absolute inset-0 flex items-center justify-center" style={{ backgroundColor: chartColors.background }}>
            <div className="flex flex-col items-center gap-3 text-center">
              <div className="w-12 h-12 rounded-full flex items-center justify-center" style={{ backgroundColor: chartColors.hoverBg }}>
                {isLoadingHistory || isLoadingOnChain || (!isConnected && !isOnChainConnected && isTokenAddress) ? (
                  <div className="w-6 h-6 border-2 border-[#2962FF] border-t-transparent rounded-full animate-spin" />
                ) : historyError ? (
                  <svg className="w-6 h-6 text-[#ef5350]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                  </svg>
                ) : (
                  <svg className="w-6 h-6 text-[#787B86]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
                  </svg>
                )}
              </div>
              <div>
                <p className="text-[#787B86] text-[13px]">
                  {isLoadingOnChain
                    ? "Loading on-chain data..."
                    : !isConnected && !isOnChainConnected && isTokenAddress
                      ? "Loading blockchain data..."
                      : isLoadingHistory
                        ? t("loadingKline")
                        : historyError
                          ? historyError
                          : t("noTradeData")}
                </p>
                {historyError && (
                  <button
                    onClick={() => isTokenAddress ? refetchOnChain() : loadHistoricalKlines()}
                    className="mt-2 px-3 py-1 text-xs text-[#2962FF] hover:bg-[#2962FF]/10 rounded"
                  >
                    {t("retry")}
                  </button>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
