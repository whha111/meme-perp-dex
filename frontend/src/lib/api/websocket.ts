/**
 * WebSocket 客户端 (未对接版本)
 *
 * 接口保留，未建立真实连接
 * TODO: 对接真实 WebSocket 服务
 */

// ============================================================
// Types (保留所有类型定义)
// ============================================================

// 操作类型
export const WsOp = {
  SUBSCRIBE: "subscribe",
  UNSUBSCRIBE: "unsubscribe",
  LOGIN: "login",
  PING: "ping",
  PONG: "pong",
} as const;

// 频道类型
export const WsChannel = {
  TICKERS: "tickers",
  CANDLE: "candle",
  TRADES: "trades",
  BOOKS: "books",
  MARK_PRICE: "mark-price",
  FUNDING_RATE: "funding-rate",
  ACCOUNT: "account",
  POSITIONS: "positions",
  ORDERS: "orders",
  LIQUIDATION: "liquidation-warning",
} as const;

export type WsOpType = (typeof WsOp)[keyof typeof WsOp];
export type WsChannelType = (typeof WsChannel)[keyof typeof WsChannel];

// 订阅参数
export interface SubscribeArg {
  channel: WsChannelType;
  instId?: string;
}

// WebSocket 消息
export interface WsMessage {
  op: WsOpType;
  args?: SubscribeArg[];
  data?: unknown;
}

// 推送消息
export interface PushMessage<T = unknown> {
  arg: SubscribeArg;
  data: T;
}

// 事件响应
export interface WsResponse {
  event: string;
  args?: SubscribeArg[];
  msg?: string;
}

// Ticker 数据
export interface WsTicker {
  instId: string;
  last: string;
  lastSz: string;
  askPx: string;
  askSz: string;
  bidPx: string;
  bidSz: string;
  open24h: string;
  high24h: string;
  low24h: string;
  vol24h: string;
  volCcy24h: string;
  ts: number;
}

// Trade 数据
export interface WsTrade {
  instId: string;
  tradeId: string;
  px: string;
  sz: string;
  side: "buy" | "sell";
  ts: number;
}

// OrderBook 数据
export interface WsOrderBook {
  asks: [string, string, string, string][];
  bids: [string, string, string, string][];
  ts: number;
  checksum?: number;
}

// Candle 数据
export interface WsCandle {
  ts: number;
  o: string;
  h: string;
  l: string;
  c: string;
  vol: string;
  volCcy: string;
  confirm: boolean;
}

// Position 数据
export interface WsPosition {
  instId: string;
  posSide: "long" | "short";
  pos: string;
  avgPx: string;
  upl: string;
  uplRatio: string;
  lever: string;
  liqPx: string;
  markPx: string;
  margin: string;
  mgnRatio: string;
  uTime: number;
}

// Order 数据
export interface WsOrder {
  instId: string;
  ordId: string;
  clOrdId?: string;
  px: string;
  sz: string;
  ordType: string;
  side: string;
  posSide: string;
  state: string;
  fillSz: string;
  avgPx: string;
  lever: string;
  fee: string;
  pnl: string;
  uTime: number;
}

// 事件监听器类型
type MessageHandler<T> = (data: T) => void;
type ErrorHandler = (error: Event | Error) => void;
type ConnectionHandler = () => void;

// ============================================================
// WebSocketClient (未对接 - 不建立连接)
// ============================================================

export class WebSocketClient {
  private onOpenHandlers: ConnectionHandler[] = [];
  private onCloseHandlers: ConnectionHandler[] = [];
  private onErrorHandlers: ErrorHandler[] = [];

  constructor(_url?: string) {
    // TODO: 对接真实 WebSocket 服务
  }

  // 连接 (未对接 - 返回失败)
  connect(): Promise<void> {
    return Promise.reject(new Error("WebSocket 未对接"));
  }

  // 断开连接
  disconnect(): void {
    // 未对接 - 不执行任何操作
  }

  // 订阅频道 (未对接)
  subscribe<T>(
    _channel: WsChannelType,
    _handler: MessageHandler<T>,
    _instId?: string
  ): () => void {
    // 未对接 - 返回空的取消函数
    return () => {};
  }

  // 取消订阅
  unsubscribe<T>(
    _channel: WsChannelType,
    _handler: MessageHandler<T>,
    _instId?: string
  ): void {
    // 未对接 - 不执行任何操作
  }

  // 登录
  login(_apiKey: string, _timestamp: string, _sign: string): void {
    // 未对接 - 不执行任何操作
  }

  // 事件监听
  onOpen(handler: ConnectionHandler): void {
    this.onOpenHandlers.push(handler);
  }

  onClose(handler: ConnectionHandler): void {
    this.onCloseHandlers.push(handler);
  }

  onError(handler: ErrorHandler): void {
    this.onErrorHandlers.push(handler);
  }

  // 获取连接状态 (未对接 - 始终返回 false)
  get isConnected(): boolean {
    return false;
  }
}

// 单例实例
export const wsClient = new WebSocketClient();

export default wsClient;
