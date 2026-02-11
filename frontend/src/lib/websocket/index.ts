/**
 * WebSocket 模块主入口 (未对接版本)
 *
 * 接口保留，返回空数据
 * TODO: 对接真实后端服务
 */

export * from "./types";
export * from "./client";
export * from "./hooks";

// 核心类型
export {
  MessageType,
  ConnectionStatus,
  type Message,
  type WebSocketMessage,
  type QuoteReq,
  type QuoteResp,
  type TradeReq,
  type TradeResp,
  type TradeEvent,
  type PriceUpdate,
  // 工具函数
  nowUnix,
  generateRequestId,
  createMessage,
  createTokenTopic,
  createPriceTopic,
} from "./types";

export { WebSocketClient, getWebSocketClient } from "./client";

export {
  useWebSocketStatus,
  useWebSocketMessage,
  useWebSocketRequest,
  useWebSocketConnection,
  useWebSocketSubscription,
  useAutoConnectWebSocket,
} from "./hooks";

// ============================================================
// 交易对资产数据类型 (保留所有类型定义)
// ============================================================

import { Ticker } from "../api/client";
import { MATCHING_ENGINE_URL } from "@/config/api";

/** 交易对资产数据 */
export interface InstrumentAssetData {
  instId: string;
  symbol?: string;
  tokenAddress?: string;
  poolAddress?: string;
  creatorAddress?: string;
  currentPrice: string;
  fdv: string;
  volume24h?: string;
  priceChange24h?: number;
  soldSupply?: string;
  totalSupply?: string;
  isGraduated?: boolean;
  securityStatus?: string;
  createdAt?: number;
  uniqueTraders?: number;
  logo?: string;
  imageUrl?: string;
}

/** 交易对资产更新事件 */
export interface InstrumentAssetUpdate {
  inst_id: string;
  current_price: string;
  fdv: string;
  total_supply?: string;
  sold_supply?: string;
}

/** 持仓者信息 */
export interface HolderInfo {
  rank: number;
  address: string;
  balance: string;
  percentage: number;
  is_creator: boolean;
  is_dev: boolean;
  label?: string;
  pnl_percentage?: number;
}

/** 持仓分布响应 */
export interface TopHoldersResp {
  success: boolean;
  inst_id?: string;
  holders: HolderInfo[];
  total_holders: number;
  top10_percentage: number;
  creator_address?: string;
  creator_holding?: number;
  concentration_risk: "HIGH" | "MEDIUM" | "LOW";
  // Pool info (bonding curve)
  pool_address?: string;
  pool_holding?: number;        // Pool's percentage of total supply
  sold_percentage?: number;     // Percentage of tokens sold (graduation progress)
  is_graduated?: boolean;
}

/** 交易对交易事件 */
export interface InstrumentTradeEvent {
  inst_id: string;
  tx_hash: string;
  trade_type: "BUY" | "SELL";
  trader_address: string;
  token_amount: string;
  eth_amount: string;
  new_price: string;
  timestamp: number;
  block_number?: number;
}

/** K 线数据 */
export interface KlineBar {
  time: number;
  open: string;
  high: string;
  low: string;
  close: string;
  volume: string;
}

/** 代币列表请求参数 */
export interface TokenListParams {
  page_size?: number;
  sort_by?: string;
  sort_order?: "asc" | "desc";
  filter_by?: string;
}

/** 代币列表响应 */
export interface TokenListResponse {
  success: boolean;
  tokens?: Array<{
    inst_id: string;
    symbol?: string;
    token_address?: string;
    pool_address?: string;
    creator_address?: string;
    current_price: string;
    fdv: string;
    volume_24h?: string;
    price_change_24h?: number;
    sold_supply?: string;
    total_supply?: string;
    is_graduated?: boolean;
    security_status?: string;
    created_at?: number;
    unique_traders?: number;
  }>;
  message?: string;
}

// ============================================================
// WebSocket 服务封装类 (未对接 - 返回空数据)
// ============================================================

class WebSocketServices {
  private tradeEventCallbacks: Array<(event: InstrumentTradeEvent) => void> =
    [];
  private assetUpdateCallbacks: Array<(update: InstrumentAssetUpdate) => void> =
    [];
  private tickerCallbacks: Map<string, Array<(ticker: Ticker) => void>> =
    new Map();

  constructor() {
    // TODO: 对接真实 WebSocket 服务
  }

  /**
   * 获取交易对资产信息
   * TODO: 对接真实后端 API
   */
  async getInstrumentAsset(params: {
    inst_id: string;
  }): Promise<InstrumentAssetData> {
    // 未对接 - 返回空数据结构
    return {
      instId: params.inst_id,
      currentPrice: "0",
      fdv: "0",
    };
  }

  /**
   * 获取代币列表 — 从后端 /api/v1/market/tickers 获取真实数据
   */
  async getTokenList(_params: TokenListParams): Promise<TokenListResponse> {
    try {
      const res = await fetch(`${MATCHING_ENGINE_URL}/api/v1/market/tickers`);
      if (!res.ok) {
        return { success: false, tokens: [], message: `HTTP ${res.status}` };
      }
      const json = await res.json();
      // Backend returns { code: "0", msg: "success", data: Ticker[] }
      if (json.code !== "0" || !Array.isArray(json.data)) {
        return { success: false, tokens: [], message: json.msg || "Unknown error" };
      }

      const tokens = json.data.map((t: any) => {
        // instId format: "0xABC...-ETH"
        const tokenAddress = t.instId.split("-")[0];
        // Calculate 24h price change percentage
        const last = parseFloat(t.last) || 0;
        const open24h = parseFloat(t.open24h) || 0;
        const priceChange24h = open24h > 0 ? ((last - open24h) / open24h) * 100 : 0;

        return {
          inst_id: t.instId,
          token_address: tokenAddress,
          current_price: t.last,
          fdv: "0", // Will be enriched by on-chain data
          volume_24h: t.vol24h, // ETH volume in wei
          price_change_24h: priceChange24h,
          is_graduated: false, // Will be enriched by on-chain data
        };
      });

      return { success: true, tokens };
    } catch (err: any) {
      return { success: false, tokens: [], message: err.message || "Fetch failed" };
    }
  }

  /**
   * 订阅交易事件
   */
  onTradeEvent(callback: (event: InstrumentTradeEvent) => void): () => void {
    this.tradeEventCallbacks.push(callback);
    return () => {
      const index = this.tradeEventCallbacks.indexOf(callback);
      if (index > -1) {
        this.tradeEventCallbacks.splice(index, 1);
      }
    };
  }

  /**
   * 订阅资产更新
   */
  onAssetUpdate(callback: (update: InstrumentAssetUpdate) => void): () => void {
    this.assetUpdateCallbacks.push(callback);
    return () => {
      const index = this.assetUpdateCallbacks.indexOf(callback);
      if (index > -1) {
        this.assetUpdateCallbacks.splice(index, 1);
      }
    };
  }

  /**
   * 订阅交易对实时更新
   * TODO: 对接真实 WebSocket
   */
  async subscribeInstrument(_instId: string): Promise<void> {
    // 未对接 - 不执行任何操作
  }

  /**
   * 取消订阅交易对
   * TODO: 对接真实 WebSocket
   */
  async unsubscribeInstrument(_instId: string): Promise<void> {
    // 未对接 - 不执行任何操作
  }

  /**
   * 订阅 ticker 更新
   */
  onTickerUpdate(
    instId: string,
    callback: (ticker: Ticker) => void
  ): () => void {
    if (!this.tickerCallbacks.has(instId)) {
      this.tickerCallbacks.set(instId, []);
    }
    this.tickerCallbacks.get(instId)!.push(callback);

    return () => {
      const callbacks = this.tickerCallbacks.get(instId);
      if (callbacks) {
        const index = callbacks.indexOf(callback);
        if (index > -1) {
          callbacks.splice(index, 1);
        }
      }
    };
  }

  /**
   * 获取交易历史
   * TODO: 对接真实后端 API
   */
  async getTradeHistory(_params: {
    inst_id: string;
    page_size?: number;
  }): Promise<{
    transactions: Array<{
      transaction_type: "BUY" | "SELL";
      buyer_wallet?: string;
      seller_wallet?: string;
      price: string;
      token_amount: string;
      transaction_timestamp: string;
      tx_hash: string;
    }>;
  }> {
    // 未对接 - 返回空数组
    return {
      transactions: [],
    };
  }

  /**
   * 获取持仓分布 — calls REST API
   */
  async getTopHolders(params: {
    inst_id: string;
    limit?: number;
  }): Promise<TopHoldersResp> {
    try {
      // inst_id may be "0xABC..." or "0xABC...-USDT"; extract token address
      const token = params.inst_id.split("-")[0];
      if (!token.startsWith("0x")) {
        return { success: false, holders: [], total_holders: 0, top10_percentage: 0, concentration_risk: "LOW" };
      }
      const url = `${MATCHING_ENGINE_URL}/api/v1/spot/holders/${token}?limit=${params.limit ?? 10}`;
      const res = await fetch(url);
      if (!res.ok) {
        return { success: false, holders: [], total_holders: 0, top10_percentage: 0, concentration_risk: "LOW" };
      }
      return await res.json();
    } catch {
      return { success: false, holders: [], total_holders: 0, top10_percentage: 0, concentration_risk: "LOW" };
    }
  }

  /**
   * 订阅交易对资产更新
   */
  onInstrumentAssetUpdate(
    callback: (update: InstrumentAssetUpdate) => void
  ): () => void {
    return this.onAssetUpdate(callback);
  }

  /**
   * 获取K线历史数据
   * TODO: 对接真实后端 API
   */
  async getKlineHistory(_params: {
    inst_id: string;
    resolution: string;
    from: number;
    to: number;
  }): Promise<{ success: boolean; bars: KlineBar[]; message?: string }> {
    // 未对接 - 返回空数组
    return {
      success: false,
      bars: [],
      message: "服务未对接",
    };
  }

  /**
   * 获取实时 ETH 价格
   * TODO: 对接真实价格源
   */
  async getETHPrice(): Promise<number> {
    // 未对接 - 返回 0
    return 0;
  }
}

// 全局单例
let servicesInstance: WebSocketServices | null = null;

/**
 * 获取 WebSocket 服务实例
 */
export function getWebSocketServices(): WebSocketServices {
  if (!servicesInstance) {
    servicesInstance = new WebSocketServices();
  }
  return servicesInstance;
}

/**
 * 适配交易对资产响应
 * 支持 snake_case 和 camelCase 两种格式
 */
export function adaptInstrumentAssetResponse(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  response: any
): InstrumentAssetData {
  return {
    instId: response.inst_id || response.instId || "",
    symbol:
      response.symbol ||
      (response.inst_id || response.instId || "").split("-")[0],
    tokenAddress: response.token_address || response.tokenAddress,
    poolAddress: response.pool_address || response.poolAddress,
    creatorAddress: response.creator_address || response.creatorAddress,
    currentPrice: response.current_price || response.currentPrice || "0",
    fdv: response.fdv || "0",
    volume24h: response.volume_24h || response.volume24h || "0",
    priceChange24h: response.price_change_24h || response.priceChange24h || 0,
    soldSupply: response.sold_supply || response.soldSupply,
    totalSupply: response.total_supply || response.totalSupply,
    isGraduated: response.is_graduated || response.isGraduated || false,
    securityStatus: response.security_status || response.securityStatus,
    createdAt: response.created_at || response.createdAt,
    uniqueTraders: response.unique_traders || response.uniqueTraders || 0,
    logo: response.logo_url || response.logoUrl || response.logo,
    imageUrl: response.image_url || response.imageUrl,
  };
}

/** 适配代币资产列表 */
export function adaptTokenAssetList(
  tokens: TokenListResponse["tokens"]
): InstrumentAssetData[] {
  if (!tokens) return [];
  return tokens.map((t) =>
    adaptInstrumentAssetResponse(t as unknown as Record<string, unknown>)
  );
}
