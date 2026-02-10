"use client";

/**
 * useFomo - FOMO 数据 Hook (未对接版本)
 *
 * 接口保留，返回空数据
 * TODO: 对接后端 API
 */

import type { Address } from "viem";

// FOMO 事件类型
export interface FomoEvent {
  id: string;
  type: "LARGE_OPEN" | "LARGE_CLOSE" | "LIQUIDATION" | "BIG_WIN" | "BIG_LOSS" | "WHALE_ENTRY" | "HOT_TOKEN";
  trader: Address;
  token: Address;
  tokenSymbol?: string;
  isLong: boolean;
  size: string;
  price: string;
  pnl?: string;
  leverage?: string;
  timestamp: number;
  message: string;
}

// 排行榜条目
export interface LeaderboardEntry {
  trader: Address;
  displayName: string;
  totalPnL: string;
  totalVolume: string;
  tradeCount: number;
  winRate: number;
  biggestWin: string;
  biggestLoss: string;
}

/**
 * useFomoEvents (未对接 - 返回空数据)
 */
export function useFomoEvents(_limit = 20) {
  return {
    // 未对接 - 空数组
    data: [] as FomoEvent[],
    isLoading: false,
    isError: false,
    error: null,
    refetch: () => {
      // 未对接 - 不执行任何操作
    },
  };
}

/**
 * useGlobalLeaderboard (未对接 - 返回空数据)
 */
export function useGlobalLeaderboard(_sortBy: "pnl" | "volume" | "wins" = "pnl", _limit = 10) {
  return {
    // 未对接 - 空数组
    data: [] as LeaderboardEntry[],
    isLoading: false,
    isError: false,
    error: null,
    refetch: () => {
      // 未对接 - 不执行任何操作
    },
  };
}

/**
 * useTokenLeaderboard (未对接 - 返回空数据)
 */
export function useTokenLeaderboard(_token: Address, _sortBy: "pnl" | "volume" | "wins" = "pnl", _limit = 10) {
  return {
    // 未对接 - 空数组
    data: [] as LeaderboardEntry[],
    isLoading: false,
    isError: false,
    error: null,
    refetch: () => {
      // 未对接 - 不执行任何操作
    },
  };
}

/**
 * useTraderStats (未对接 - 返回空数据)
 */
export function useTraderStats(_trader?: Address) {
  return {
    // 未对接 - 无数据
    data: null as LeaderboardEntry | null,
    isLoading: false,
    isError: false,
    error: null,
    refetch: () => {
      // 未对接 - 不执行任何操作
    },
  };
}

/**
 * 格式化FOMO事件类型显示
 */
export function getFomoEventEmoji(type: FomoEvent["type"]): string {
  switch (type) {
    case "LARGE_OPEN": return "🐋";
    case "LARGE_CLOSE": return "📈";
    case "LIQUIDATION": return "💀";
    case "BIG_WIN": return "🎉";
    case "BIG_LOSS": return "😢";
    case "WHALE_ENTRY": return "🐳";
    case "HOT_TOKEN": return "🔥";
    default: return "📊";
  }
}

/**
 * 格式化FOMO事件类型文字
 */
export function getFomoEventLabel(type: FomoEvent["type"]): string {
  switch (type) {
    case "LARGE_OPEN": return "Large Position";
    case "LARGE_CLOSE": return "Large Close";
    case "LIQUIDATION": return "Liquidation";
    case "BIG_WIN": return "Big Win";
    case "BIG_LOSS": return "Big Loss";
    case "WHALE_ENTRY": return "Whale Entry";
    case "HOT_TOKEN": return "Hot Token";
    default: return "Event";
  }
}
