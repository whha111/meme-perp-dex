"use client";

/**
 * 永续合约专用 K 线图 - 使用撮合引擎数据
 *
 * 特性：
 * - 从撮合引擎 API 获取 K 线数据
 * - 实时刷新（每秒更新最新 K 线）
 * - 支持多时间周期切换
 * - 显示当前价格、涨跌幅、24h 高低
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
import { useAppStore } from "@/lib/stores/appStore";
import { useTranslations } from "next-intl";

const MATCHING_ENGINE_URL = process.env.NEXT_PUBLIC_MATCHING_ENGINE_URL || "http://localhost:8081";

interface PerpetualPriceChartProps {
  tokenAddress: string;
  displaySymbol?: string;
  className?: string;
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

interface KlineData {
  timestamp: number;
  open: string;
  high: string;
  low: string;
  close: string;
  volume: string;
  trades: number;
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
  if (vol >= 1000000) return (vol / 1000000).toFixed(2) + "M";
  if (vol >= 1000) return (vol / 1000).toFixed(2) + "K";
  return vol.toFixed(2);
}

export function PerpetualPriceChart({ tokenAddress, displaySymbol, className }: PerpetualPriceChartProps) {
  const chartContainerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candleSeriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const volumeSeriesRef = useRef<ISeriesApi<"Histogram"> | null>(null);

  const [resolution, setResolution] = useState<Resolution>("1m");
  const [ohlcDisplay, setOhlcDisplay] = useState<OHLCDisplay | null>(null);
  const [isHovering, setIsHovering] = useState(false);
  const [isLogScale, setIsLogScale] = useState(false);
  const [currentTime, setCurrentTime] = useState("");
  const [klineCount, setKlineCount] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [latestOHLC, setLatestOHLC] = useState<OHLCDisplay | null>(null);

  // Get theme from store
  const theme = useAppStore((state) => state.preferences.theme);
  const chartColors = getChartColors(theme);

  // i18n
  const t = useTranslations("trading");
  const tc = useTranslations("chart");

  // 获取 K 线数据
  const fetchKlines = useCallback(async () => {
    try {
      const url = `${MATCHING_ENGINE_URL}/api/kline/${tokenAddress}?interval=${resolution}&limit=200`;
      const res = await fetch(url);
      if (!res.ok) throw new Error("Failed to fetch klines");
      const json = await res.json();

      const klines: KlineData[] = json.klines || [];

      if (klines.length === 0) {
        setKlineCount(0);
        return;
      }

      // 转换数据格式 (价格精度 1e12，数量精度 1e6)
      const candles: CandlestickData<Time>[] = [];
      const volumes: HistogramData<Time>[] = [];

      klines.forEach((k) => {
        const open = Number(k.open) / 1e12;
        const high = Number(k.high) / 1e12;
        const low = Number(k.low) / 1e12;
        const close = Number(k.close) / 1e12;
        const volume = Number(k.volume) / 1e6;
        const time = Math.floor(k.timestamp / 1000) as Time;
        const isUp = close >= open;

        candles.push({ time, open, high, low, close });
        volumes.push({
          time,
          value: volume,
          color: isUp ? 'rgba(38, 166, 154, 0.5)' : 'rgba(239, 83, 80, 0.5)',
        });
      });

      // 更新图表
      if (candleSeriesRef.current && volumeSeriesRef.current) {
        candleSeriesRef.current.setData(candles);
        volumeSeriesRef.current.setData(volumes);

        // 滚动到最新
        chartRef.current?.timeScale().scrollToRealTime();
      }

      // 更新最新 OHLC
      const latest = klines[klines.length - 1];
      if (latest) {
        const open = Number(latest.open) / 1e12;
        const close = Number(latest.close) / 1e12;
        const change = close - open;
        const changePercent = open > 0 ? (change / open) * 100 : 0;

        setLatestOHLC({
          open,
          high: Number(latest.high) / 1e12,
          low: Number(latest.low) / 1e12,
          close,
          volume: Number(latest.volume) / 1e6,
          change,
          changePercent,
          isUp: change >= 0,
        });
      }

      setKlineCount(klines.length);
      setError(null);
    } catch (e) {
      console.error("Failed to fetch klines:", e);
      setError(e instanceof Error ? e.message : "Unknown error");
    } finally {
      setIsLoading(false);
    }
  }, [tokenAddress, resolution]);

  // 初始加载和定时刷新
  useEffect(() => {
    fetchKlines();

    // 根据时间周期设置刷新间隔
    const refreshMs = resolution === "1m" ? 1000 : resolution === "5m" ? 5000 : 10000;
    const timer = setInterval(fetchKlines, refreshMs);

    return () => clearInterval(timer);
  }, [fetchKlines, resolution]);

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
        rightOffset: 5,
        shiftVisibleRangeOnNewBar: true,
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
      priceFormat: { type: 'price', precision: 10, minMove: 0.0000000001 },
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
  const tokenSymbol = displaySymbol || `${tokenAddress.slice(0, 6)}...${tokenAddress.slice(-4)}`;

  return (
    <div className={`flex flex-col w-full h-full ${className}`} style={{ backgroundColor: chartColors.background }}>
      {/* 顶部价格信息栏 */}
      <div className="h-[48px] flex items-center px-4" style={{ backgroundColor: chartColors.background, borderBottom: `1px solid ${chartColors.borderColor}` }}>
        {/* 左侧：交易对 */}
        <div className="flex items-center gap-2">
          <span className="text-okx-text-primary font-bold text-[16px]">{tokenSymbol}</span>
          <span className="text-[#787B86] text-[12px]">/USDT Perp</span>
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
                <span className="text-[#9CA3AF]">{formatVolume(displayOHLC.volume)} USDT</span>
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
            {klineCount > 0 ? (
              <>
                <span className="w-1.5 h-1.5 rounded-full bg-[#26a69a] animate-pulse" />
                <span className="text-[#26a69a]">Live ({klineCount})</span>
              </>
            ) : isLoading ? (
              <>
                <span className="w-1.5 h-1.5 rounded-full bg-yellow-500 animate-pulse" />
                <span className="text-yellow-500">{t("connecting")}</span>
              </>
            ) : (
              <>
                <span className="w-1.5 h-1.5 rounded-full bg-red-500" />
                <span className="text-red-500">No data</span>
              </>
            )}
          </div>
        </div>
      </div>

      {/* 图表区域 */}
      <div className="relative flex-1 w-full min-h-0" style={{ backgroundColor: chartColors.background }}>
        <div ref={chartContainerRef} className="w-full h-full" />

        {/* 空数据/加载状态 */}
        {(klineCount === 0 || isLoading) && (
          <div className="absolute inset-0 flex items-center justify-center" style={{ backgroundColor: chartColors.background }}>
            <div className="flex flex-col items-center gap-3 text-center">
              <div className="w-12 h-12 rounded-full flex items-center justify-center" style={{ backgroundColor: chartColors.hoverBg }}>
                {isLoading ? (
                  <div className="w-6 h-6 border-2 border-[#2962FF] border-t-transparent rounded-full animate-spin" />
                ) : error ? (
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
                  {isLoading
                    ? t("loadingKline")
                    : error
                      ? error
                      : t("noTradeData")}
                </p>
                {error && (
                  <button
                    onClick={fetchKlines}
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
