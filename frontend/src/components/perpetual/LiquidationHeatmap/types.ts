/**
 * 清算热力图类型定义
 */

export interface HeatmapCell {
  priceLevel: number;
  timeSlot: number;
  longLiquidationSize: string;
  shortLiquidationSize: string;
  longAccountCount: number;
  shortAccountCount: number;
  intensity: number;
}

export interface LiquidationHeatmapData {
  token: string;
  currentPrice: string;
  priceMin: string;
  priceMax: string;
  priceStep: string;
  priceLevels: number;
  timeStart: number;
  timeEnd: number;
  timeSlots: number;
  resolution: string;
  heatmap: HeatmapCell[];
  longTotal: string;
  shortTotal: string;
  longAccountTotal: number;
  shortAccountTotal: number;
  timestamp: number;
}

export type TimeRange = "12h" | "1d" | "3d" | "7d" | "1m";

export interface HeatmapTooltipData {
  priceLevel: number;
  timeSlot: number;
  price: string;
  time: string;
  longSize: string;
  shortSize: string;
  longCount: number;
  shortCount: number;
  x: number;
  y: number;
}
