/**
 * WebSocket 模块主入口
 * 整合 REST API 和 WebSocket 实时订阅
 */

export * from './types';
export * from './client';
export * from './hooks';

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
} from './types';

export {
  WebSocketClient,
  getWebSocketClient,
} from './client';

export {
  useWebSocketStatus,
  useWebSocketMessage,
  useWebSocketRequest,
  useWebSocketConnection,
  useWebSocketSubscription,
  useAutoConnectWebSocket,
} from './hooks';

// ============================================================================
// 交易对资产数据类型 (Instrument Asset Data)
// ============================================================================

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
  logo?: string; // Token logo URL (IPFS or HTTP)
  imageUrl?: string; // Alternative field for image URL
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
  concentration_risk: 'HIGH' | 'MEDIUM' | 'LOW';
}

/** 交易对交易事件 */
export interface InstrumentTradeEvent {
  inst_id: string;
  tx_hash: string;
  trade_type: 'BUY' | 'SELL';
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

// ============================================================================
// WebSocket 服务封装
// ============================================================================

import { getWebSocketClient } from './client';
import { apiClient, Ticker, Trade } from '../api/client';
import { MessageType } from './types';

/** 代币列表请求参数 */
export interface TokenListParams {
  page_size?: number;
  sort_by?: string;
  sort_order?: 'asc' | 'desc';
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

/**
 * WebSocket 服务封装类
 * 提供高级业务 API - 整合 REST API 和 WebSocket
 */
class WebSocketServices {
  private client = getWebSocketClient();
  private tradeEventCallbacks: Array<(event: InstrumentTradeEvent) => void> = [];
  private assetUpdateCallbacks: Array<(update: InstrumentAssetUpdate) => void> = [];
  private tickerCallbacks: Map<string, Array<(ticker: Ticker) => void>> = new Map();

  constructor() {
    // 监听 WebSocket 消息
    this.setupMessageHandlers();
  }

  private setupMessageHandlers() {
    // 监听 ticker 更新
    this.client.on(MessageType.TICKER, (message) => {
      const data = message.data as { arg?: { instId?: string }; data?: Ticker } | undefined;
      if (data?.arg?.instId && data?.data) {
        const callbacks = this.tickerCallbacks.get(data.arg.instId);
        callbacks?.forEach(cb => cb(data.data as Ticker));
      }
    });

    // 监听交易更新
    this.client.on(MessageType.TRADE, (message) => {
      const data = message.data as {
        instId?: string;
        inst_id?: string;
        tradeId?: string;
        tx_hash?: string;
        side?: string;
        trader?: string;
        sz?: string;
        px?: string;
        ts?: number;
      } | undefined;
      if (data) {
        const tradeEvent: InstrumentTradeEvent = {
          inst_id: data.instId || data.inst_id || '',
          tx_hash: data.tradeId || data.tx_hash || '',
          trade_type: data.side === 'buy' ? 'BUY' : 'SELL',
          trader_address: data.trader || '',
          token_amount: data.sz || '0',
          eth_amount: data.px || '0',
          new_price: data.px || '0',
          timestamp: data.ts || Date.now(),
        };
        this.tradeEventCallbacks.forEach(cb => cb(tradeEvent));
      }
    });
  }

  /**
   * 获取交易对资产信息 (通过 REST API)
   */
  async getInstrumentAsset(params: { inst_id: string }): Promise<InstrumentAssetData> {
    try {
      const tickers = await apiClient.getTicker(params.inst_id);
      if (tickers.length > 0) {
        const ticker = tickers[0];
        return {
          instId: ticker.instId,
          symbol: ticker.instId.split('-')[0],
          currentPrice: ticker.last,
          fdv: ticker.volCcy24h,
          volume24h: ticker.vol24h,
          priceChange24h: parseFloat(ticker.last) > parseFloat(ticker.open24h)
            ? ((parseFloat(ticker.last) - parseFloat(ticker.open24h)) / parseFloat(ticker.open24h)) * 100
            : -((parseFloat(ticker.open24h) - parseFloat(ticker.last)) / parseFloat(ticker.open24h)) * 100,
        };
      }
    } catch (error) {
      console.warn('获取交易对资产失败:', error);
    }

    return {
      instId: params.inst_id,
      symbol: params.inst_id.split('-')[0],
      currentPrice: '0',
      fdv: '0',
      volume24h: '0',
      priceChange24h: 0,
    };
  }

  /**
   * 获取代币列表 (通过 REST API)
   */
  async getTokenList(params: TokenListParams): Promise<TokenListResponse> {
    try {
      const tickers = await apiClient.getTickers();
      const tokens = tickers.map(ticker => {
        // instId format: "{tokenAddress}-USDT"
        const tokenAddress = ticker.instId.split('-')[0];
        return {
          inst_id: ticker.instId,
          address: tokenAddress, // Token contract address
          symbol: tokenAddress.slice(0, 8).toUpperCase(), // Short symbol from address
          name: `Token ${tokenAddress.slice(0, 8)}`,
          current_price: ticker.last,
          fdv: ticker.volCcy24h,
          volume_24h: ticker.vol24h,
          price_change_24h: parseFloat(ticker.last) > parseFloat(ticker.open24h)
            ? ((parseFloat(ticker.last) - parseFloat(ticker.open24h)) / parseFloat(ticker.open24h)) * 100
            : -((parseFloat(ticker.open24h) - parseFloat(ticker.last)) / parseFloat(ticker.open24h)) * 100,
          created_at: ticker.ts,
          logo_url: ticker.logoUrl,
          image_url: ticker.imageUrl,
        };
      });

      // 排序
      if (params.sort_by) {
        tokens.sort((a, b) => {
          let valA: number, valB: number;
          switch (params.sort_by) {
            case 'volume':
              valA = parseFloat(a.volume_24h || '0');
              valB = parseFloat(b.volume_24h || '0');
              break;
            case 'price_change':
              valA = a.price_change_24h || 0;
              valB = b.price_change_24h || 0;
              break;
            case 'created_at':
              valA = a.created_at || 0;
              valB = b.created_at || 0;
              break;
            default:
              valA = parseFloat(a.fdv || '0');
              valB = parseFloat(b.fdv || '0');
          }
          return params.sort_order === 'asc' ? valA - valB : valB - valA;
        });
      }

      // 分页
      const limit = params.page_size || 50;
      const limitedTokens = tokens.slice(0, limit);

      return {
        success: true,
        tokens: limitedTokens,
      };
    } catch (error) {
      console.warn('获取代币列表失败:', error);
      return {
        success: false,
        tokens: [],
        message: error instanceof Error ? error.message : 'Unknown error',
      };
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
   * 订阅交易对实时更新 (通过 WebSocket)
   */
  async subscribeInstrument(instId: string): Promise<void> {
    // 确保连接已建立
    if (!this.client.isConnected()) {
      await this.client.connect();
    }

    // 订阅 ticker 和 trades 频道
    const topics = [
      `tickers:${instId}`,
      `trades:${instId}`,
    ];
    await this.client.subscribe(topics);
  }

  /**
   * 取消订阅交易对
   */
  async unsubscribeInstrument(instId: string): Promise<void> {
    const topics = [
      `tickers:${instId}`,
      `trades:${instId}`,
    ];
    await this.client.unsubscribe(topics);
  }

  /**
   * 订阅 ticker 更新
   */
  onTickerUpdate(instId: string, callback: (ticker: Ticker) => void): () => void {
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
   * 获取交易历史 (通过 REST API)
   */
  async getTradeHistory(params: { inst_id: string; page_size?: number }): Promise<{
    transactions: Array<{
      transaction_type: 'BUY' | 'SELL';
      buyer_wallet?: string;
      seller_wallet?: string;
      price: string;
      token_amount: string;
      transaction_timestamp: string;
      tx_hash: string;
    }>;
  }> {
    try {
      const trades = await apiClient.getTrades(params.inst_id, params.page_size || 100);
      const transactions = trades.map(trade => ({
        transaction_type: trade.side === 'buy' ? 'BUY' as const : 'SELL' as const,
        buyer_wallet: trade.side === 'buy' ? '' : undefined,
        seller_wallet: trade.side === 'sell' ? '' : undefined,
        price: trade.px,
        token_amount: trade.sz,
        transaction_timestamp: new Date(trade.ts).toISOString(),
        tx_hash: trade.tradeId,
      }));
      return { transactions };
    } catch (error) {
      console.warn('获取交易历史失败:', error);
      return { transactions: [] };
    }
  }

  /**
   * 获取持仓分布 (模拟数据 - 需要后端实现)
   */
  async getTopHolders(params: { inst_id: string; limit?: number }): Promise<TopHoldersResp> {
    // TODO: 后端需要实现此接口
    // 目前返回模拟数据
    return {
      success: true,
      inst_id: params.inst_id,
      holders: [],
      total_holders: 0,
      top10_percentage: 0,
      concentration_risk: 'LOW',
    };
  }

  /**
   * 订阅交易对资产更新
   */
  onInstrumentAssetUpdate(callback: (update: InstrumentAssetUpdate) => void): () => void {
    return this.onAssetUpdate(callback);
  }

  /**
   * 获取K线历史数据 (通过 REST API)
   */
  async getKlineHistory(params: {
    inst_id: string;
    resolution: string;
    from: number;
    to: number;
  }): Promise<{ success: boolean; bars: KlineBar[]; message?: string }> {
    try {
      // 转换分辨率格式: "1m" -> "1m", "5m" -> "5m", etc.
      const bar = params.resolution;
      const candles = await apiClient.getCandles(params.inst_id, bar, {
        after: params.from * 1000, // 转换为毫秒
        before: params.to * 1000,
        limit: 300,
      });

      // 后端返回格式: [timestamp, open, high, low, close, volume, volCcy, volCcyQuote, confirm]
      const bars: KlineBar[] = candles.map(candle => ({
        time: parseInt(candle[0]) / 1000, // 转换为秒
        open: candle[1],
        high: candle[2],
        low: candle[3],
        close: candle[4],
        volume: candle[5],
      }));

      // 按时间排序（升序）
      bars.sort((a, b) => a.time - b.time);

      return { success: true, bars };
    } catch (error) {
      console.warn('获取K线历史失败:', error);
      return {
        success: false,
        bars: [],
        message: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  /**
   * 获取实时 ETH 价格
   */
  async getETHPrice(): Promise<number> {
    try {
      const tickers = await apiClient.getTicker('ETH-USDT');
      if (tickers.length > 0) {
        return parseFloat(tickers[0].last);
      }
    } catch (error) {
      console.warn('获取 ETH 价格失败:', error);
    }
    return 3300; // 默认价格
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
 */
export function adaptInstrumentAssetResponse(response: any): InstrumentAssetData {
  return {
    instId: response.inst_id || response.instId || '',
    symbol: response.symbol || (response.inst_id || response.instId || '').split('-')[0],
    tokenAddress: response.token_address || response.tokenAddress,
    poolAddress: response.pool_address || response.poolAddress,
    creatorAddress: response.creator_address || response.creatorAddress,
    currentPrice: response.current_price || response.currentPrice || '0',
    fdv: response.fdv || '0',
    volume24h: response.volume_24h || response.volume24h || '0',
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
export function adaptTokenAssetList(tokens: TokenListResponse['tokens']): InstrumentAssetData[] {
  if (!tokens) return [];
  return tokens.map(t => adaptInstrumentAssetResponse(t));
}
