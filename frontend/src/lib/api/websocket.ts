/**
 * WebSocket 客户端 - 实时数据推送
 */

const WS_BASE_URL = process.env.NEXT_PUBLIC_WS_URL || 'ws://localhost:8080/ws';

// 操作类型
export const WsOp = {
  SUBSCRIBE: 'subscribe',
  UNSUBSCRIBE: 'unsubscribe',
  LOGIN: 'login',
  PING: 'ping',
  PONG: 'pong',
} as const;

// 频道类型
export const WsChannel = {
  TICKERS: 'tickers',
  CANDLE: 'candle',
  TRADES: 'trades',
  BOOKS: 'books',
  MARK_PRICE: 'mark-price',
  FUNDING_RATE: 'funding-rate',
  ACCOUNT: 'account',
  POSITIONS: 'positions',
  ORDERS: 'orders',
  LIQUIDATION: 'liquidation-warning',
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
  side: 'buy' | 'sell';
  ts: number;
}

// OrderBook 数据
export interface WsOrderBook {
  asks: [string, string, string, string][]; // [price, size, deprecated, numOrders]
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
  posSide: 'long' | 'short';
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

interface Subscription {
  channel: WsChannelType;
  instId?: string;
  handler: MessageHandler<unknown>;
}

export class WebSocketClient {
  private ws: WebSocket | null = null;
  private url: string;
  private subscriptions: Map<string, Subscription[]> = new Map();
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 5;
  private reconnectDelay = 1000;
  private pingInterval: NodeJS.Timeout | null = null;
  private isConnecting = false;
  private isAuthenticated = false;

  private onOpenHandlers: ConnectionHandler[] = [];
  private onCloseHandlers: ConnectionHandler[] = [];
  private onErrorHandlers: ErrorHandler[] = [];

  constructor(url: string = WS_BASE_URL) {
    this.url = url;
  }

  // 连接
  connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (this.ws?.readyState === WebSocket.OPEN) {
        resolve();
        return;
      }

      if (this.isConnecting) {
        reject(new Error('Connection already in progress'));
        return;
      }

      this.isConnecting = true;

      try {
        this.ws = new WebSocket(this.url);

        this.ws.onopen = () => {
          this.isConnecting = false;
          this.reconnectAttempts = 0;
          this.startPing();
          this.resubscribeAll();
          this.onOpenHandlers.forEach((handler) => handler());
          resolve();
        };

        this.ws.onclose = () => {
          this.isConnecting = false;
          this.stopPing();
          this.isAuthenticated = false;
          this.onCloseHandlers.forEach((handler) => handler());
          this.attemptReconnect();
        };

        this.ws.onerror = (error) => {
          this.isConnecting = false;
          this.onErrorHandlers.forEach((handler) => handler(error));
          reject(error);
        };

        this.ws.onmessage = (event) => {
          this.handleMessage(event.data);
        };
      } catch (error) {
        this.isConnecting = false;
        reject(error);
      }
    });
  }

  // 断开连接
  disconnect(): void {
    this.stopPing();
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.subscriptions.clear();
    this.isAuthenticated = false;
  }

  // 发送消息
  private send(message: WsMessage): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(message));
    }
  }

  // 订阅频道
  subscribe<T>(
    channel: WsChannelType,
    handler: MessageHandler<T>,
    instId?: string
  ): () => void {
    const key = this.buildChannelKey(channel, instId);
    const subscription: Subscription = {
      channel,
      instId,
      handler: handler as MessageHandler<unknown>,
    };

    if (!this.subscriptions.has(key)) {
      this.subscriptions.set(key, []);
    }
    this.subscriptions.get(key)!.push(subscription);

    // 发送订阅请求
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.send({
        op: WsOp.SUBSCRIBE,
        args: [{ channel, instId }],
      });
    }

    // 返回取消订阅函数
    return () => this.unsubscribe(channel, handler, instId);
  }

  // 取消订阅
  unsubscribe<T>(
    channel: WsChannelType,
    handler: MessageHandler<T>,
    instId?: string
  ): void {
    const key = this.buildChannelKey(channel, instId);
    const subs = this.subscriptions.get(key);

    if (subs) {
      const index = subs.findIndex((s) => s.handler === handler);
      if (index !== -1) {
        subs.splice(index, 1);
      }

      // 如果没有订阅者了，发送取消订阅请求
      if (subs.length === 0) {
        this.subscriptions.delete(key);
        if (this.ws?.readyState === WebSocket.OPEN) {
          this.send({
            op: WsOp.UNSUBSCRIBE,
            args: [{ channel, instId }],
          });
        }
      }
    }
  }

  // 登录（私有频道需要）
  login(apiKey: string, timestamp: string, sign: string): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.send({
        op: WsOp.LOGIN,
        args: [
          {
            channel: 'login' as WsChannelType,
            instId: undefined,
          },
        ],
        data: { apiKey, timestamp, sign },
      });
    }
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

  // 获取连接状态
  get isConnected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  // 处理消息
  private handleMessage(data: string): void {
    // 处理简单 pong 响应
    if (data === 'pong' || data === '"pong"') {
      return;
    }

    try {
      const message = JSON.parse(data);

      // 处理事件响应（subscribe/unsubscribe/login 确认）
      if (message.event) {
        if (message.event === 'login') {
          this.isAuthenticated = true;
        }
        return;
      }

      // 处理推送数据
      if (message.arg && message.data) {
        const pushMessage = message as PushMessage;
        const key = this.buildChannelKey(
          pushMessage.arg.channel,
          pushMessage.arg.instId
        );
        const subs = this.subscriptions.get(key);

        if (subs) {
          subs.forEach((sub) => sub.handler(pushMessage.data));
        }
      }
    } catch {
      console.error('Failed to parse WebSocket message:', data);
    }
  }

  // 构建频道键
  private buildChannelKey(channel: WsChannelType, instId?: string): string {
    return instId ? `${channel}:${instId}` : channel;
  }

  // 开始心跳
  private startPing(): void {
    this.stopPing();
    this.pingInterval = setInterval(() => {
      if (this.ws?.readyState === WebSocket.OPEN) {
        this.ws.send('ping');
      }
    }, 30000);
  }

  // 停止心跳
  private stopPing(): void {
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
      this.pingInterval = null;
    }
  }

  // 重连
  private attemptReconnect(): void {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.error('Max reconnect attempts reached');
      return;
    }

    this.reconnectAttempts++;
    const delay = this.reconnectDelay * Math.pow(2, this.reconnectAttempts - 1);

    setTimeout(() => {
      console.log(
        `Attempting to reconnect (${this.reconnectAttempts}/${this.maxReconnectAttempts})...`
      );
      this.connect().catch((error) => {
        console.error('Reconnect failed:', error);
      });
    }, delay);
  }

  // 重新订阅所有频道
  private resubscribeAll(): void {
    const args: SubscribeArg[] = [];

    this.subscriptions.forEach((subs, key) => {
      if (subs.length > 0) {
        const [channel, instId] = key.split(':');
        args.push({
          channel: channel as WsChannelType,
          instId: instId || undefined,
        });
      }
    });

    if (args.length > 0) {
      this.send({
        op: WsOp.SUBSCRIBE,
        args,
      });
    }
  }
}

// 单例实例
export const wsClient = new WebSocketClient();

export default wsClient;
