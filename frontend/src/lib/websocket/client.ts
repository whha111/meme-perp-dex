/**
 * WebSocket 客户端
 * 提供连接管理、消息发送、事件订阅等功能
 */

import {
  WebSocketConfig,
  DEFAULT_CONFIG,
  ConnectionStatus,
  WebSocketMessage,
  MessageType,
  SubscribeRequestData,
  UnsubscribeRequestData,
} from './types';

type MessageHandler = (message: WebSocketMessage) => void;
type ConnectionHandler = (status: ConnectionStatus) => void;

export class WebSocketClient {
  private ws: WebSocket | null = null;
  private config: WebSocketConfig;
  private status: ConnectionStatus = ConnectionStatus.DISCONNECTED;
  private reconnectAttempts = 0;
  private heartbeatInterval: NodeJS.Timeout | null = null;
  private messageHandlers = new Map<MessageType, Set<MessageHandler>>();
  private connectionHandlers = new Set<ConnectionHandler>();
  private pendingRequests = new Map<string, {
    resolve: (value: WebSocketMessage) => void;
    reject: (reason: any) => void;
    timeout: NodeJS.Timeout;
  }>();
  // [FIX F-H-03] 追踪已订阅的主题，用于重连后恢复订阅
  private subscribedTopics = new Set<string>();

  constructor(config?: Partial<WebSocketConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.log('WebSocket 客户端初始化', { url: this.config.url });
  }

  /**
   * 连接到 WebSocket 服务器
   */
  connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (this.status === ConnectionStatus.CONNECTED || this.status === ConnectionStatus.CONNECTING) {
        resolve();
        return;
      }

      this.setStatus(ConnectionStatus.CONNECTING);
      this.log('正在连接到 WebSocket 服务器...');

      try {
        this.ws = new WebSocket(this.config.url);

        this.ws.onopen = () => {
          this.log('WebSocket 连接已建立');
          this.setStatus(ConnectionStatus.CONNECTED);
          this.reconnectAttempts = 0;
          this.startHeartbeat();

          // [FIX F-H-03] 重连后恢复订阅
          if (this.subscribedTopics.size > 0) {
            this.resubscribeAll().catch(err => {
              this.log('重连后恢复订阅失败', { error: err });
            });
          }

          resolve();
        };

        this.ws.onclose = (event) => {
          this.log('WebSocket 连接已关闭', { code: event.code, reason: event.reason });
          this.setStatus(ConnectionStatus.DISCONNECTED);
          this.stopHeartbeat();
          this.handleReconnect();
        };

        this.ws.onerror = (error) => {
          this.log('WebSocket 连接错误', { error });
          this.setStatus(ConnectionStatus.ERROR);
          this.stopHeartbeat();
          reject(new Error('WebSocket 连接失败'));
        };

        this.ws.onmessage = (event) => {
          try {
            const message = JSON.parse(event.data) as WebSocketMessage;
            this.handleMessage(message);
          } catch (error) {
            this.log('解析消息失败', { error, data: event.data });
          }
        };
      } catch (error) {
        this.log('创建 WebSocket 连接失败', { error });
        this.setStatus(ConnectionStatus.ERROR);
        reject(error);
      }
    });
  }

  /**
   * 断开 WebSocket 连接
   */
  disconnect(): void {
    this.log('正在断开 WebSocket 连接...');
    this.stopHeartbeat();
    
    if (this.ws) {
      this.ws.close(1000, '客户端主动断开');
      this.ws = null;
    }
    
    this.setStatus(ConnectionStatus.DISCONNECTED);
    this.reconnectAttempts = 0;
    
    // 清理所有待处理的请求
    this.pendingRequests.forEach(({ reject, timeout }) => {
      clearTimeout(timeout);
      reject(new Error('连接已断开'));
    });
    this.pendingRequests.clear();
  }

  /**
   * 等待 WebSocket 连接建立
   */
  private waitForConnection(timeout: number = 5000): Promise<void> {
    return new Promise((resolve, reject) => {
      if (this.status === ConnectionStatus.CONNECTED && this.ws) {
        resolve();
        return;
      }

      const startTime = Date.now();

      const checkConnection = () => {
        if (this.status === ConnectionStatus.CONNECTED && this.ws) {
          resolve();
          return;
        }

        if (Date.now() - startTime >= timeout) {
          reject(new Error('等待 WebSocket 连接超时'));
          return;
        }

        // 每 100ms 检查一次
        setTimeout(checkConnection, 100);
      };

      checkConnection();
    });
  }

  /**
   * 发送消息
   */
  async send<T = any>(type: MessageType, data?: any, requestId?: string): Promise<WebSocketMessage<T>> {
    // 等待连接建立（最多 5 秒）
    await this.waitForConnection(5000);

    return new Promise((resolve, reject) => {
      if (this.status !== ConnectionStatus.CONNECTED || !this.ws) {
        reject(new Error('WebSocket 未连接'));
        return;
      }

      const message: WebSocketMessage = {
        type,
        request_id: requestId || this.generateRequestId(),
        data,
        timestamp: Math.floor(Date.now() / 1000), // Unix 秒（符合三大铁律）
      };

      // 设置请求超时（10秒）
      const timeout = setTimeout(() => {
        this.pendingRequests.delete(message.request_id!);
        reject(new Error('请求超时'));
      }, 10000);

      // 保存请求回调
      this.pendingRequests.set(message.request_id!, {
        resolve: resolve as (value: WebSocketMessage) => void,
        reject,
        timeout,
      });

      try {
        this.ws.send(JSON.stringify(message));
        this.log('发送消息', { type, request_id: message.request_id });
      } catch (error) {
        this.pendingRequests.delete(message.request_id!);
        clearTimeout(timeout);
        reject(error);
      }
    });
  }

  /**
   * 发送请求并等待响应
   */
  async request<T = any>(type: MessageType, data?: any): Promise<T> {
    const response = await this.send(type, data);
    
    if (response.error) {
      throw new Error(response.error);
    }
    
    return response.data;
  }

  /**
   * 订阅消息
   */
  on(type: MessageType, handler: MessageHandler): () => void {
    if (!this.messageHandlers.has(type)) {
      this.messageHandlers.set(type, new Set());
    }
    
    this.messageHandlers.get(type)!.add(handler);
    
    // 返回取消订阅函数
    return () => {
      const handlers = this.messageHandlers.get(type);
      if (handlers) {
        handlers.delete(handler);
        if (handlers.size === 0) {
          this.messageHandlers.delete(type);
        }
      }
    };
  }

  /**
   * 订阅连接状态变化
   */
  onConnectionChange(handler: ConnectionHandler): () => void {
    this.connectionHandlers.add(handler);
    
    // 立即调用一次当前状态
    handler(this.status);
    
    // 返回取消订阅函数
    return () => {
      this.connectionHandlers.delete(handler);
    };
  }

  /**
   * 订阅主题
   * [FIX F-H-03] 追踪订阅的主题，用于重连后恢复
   */
  async subscribe(topics: string[]): Promise<void> {
    await this.request(MessageType.SUBSCRIBE, { topics } as SubscribeRequestData);
    // 记录已订阅的主题
    topics.forEach(topic => this.subscribedTopics.add(topic));
    this.log('订阅主题', { topics, total: this.subscribedTopics.size });
  }

  /**
   * 取消订阅主题
   * [FIX F-H-03] 从追踪列表中移除
   */
  async unsubscribe(topics: string[]): Promise<void> {
    await this.request(MessageType.UNSUBSCRIBE, { topics } as UnsubscribeRequestData);
    // 移除已取消订阅的主题
    topics.forEach(topic => this.subscribedTopics.delete(topic));
    this.log('取消订阅主题', { topics, remaining: this.subscribedTopics.size });
  }

  /**
   * [FIX F-H-03] 获取当前订阅的主题列表
   */
  getSubscribedTopics(): string[] {
    return Array.from(this.subscribedTopics);
  }

  /**
   * [FIX F-H-03] 重新订阅所有主题（用于重连后）
   */
  private async resubscribeAll(): Promise<void> {
    if (this.subscribedTopics.size === 0) {
      return;
    }

    const topics = Array.from(this.subscribedTopics);
    this.log('重新订阅所有主题', { count: topics.length, topics });

    try {
      await this.request(MessageType.SUBSCRIBE, { topics } as SubscribeRequestData);
      this.log('重新订阅成功', { count: topics.length });
    } catch (error) {
      this.log('重新订阅失败', { error });
      // 不抛出错误，让连接继续工作
    }
  }

  /**
   * 获取当前连接状态
   */
  getStatus(): ConnectionStatus {
    return this.status;
  }

  /**
   * 是否已连接
   */
  isConnected(): boolean {
    return this.status === ConnectionStatus.CONNECTED;
  }

  // 私有方法

  private setStatus(status: ConnectionStatus): void {
    if (this.status !== status) {
      this.status = status;
      this.log('连接状态变化', { status });
      
      // 通知所有连接状态监听器
      this.connectionHandlers.forEach(handler => {
        try {
          handler(status);
        } catch (error) {
          this.log('连接状态处理器错误', { error });
        }
      });
    }
  }

  private handleMessage(message: WebSocketMessage): void {
    this.log('收到消息', { type: message.type, request_id: message.request_id });

    // 处理待处理的请求
    if (message.request_id && this.pendingRequests.has(message.request_id)) {
      const { resolve, timeout } = this.pendingRequests.get(message.request_id)!;
      clearTimeout(timeout);
      this.pendingRequests.delete(message.request_id);
      resolve(message);
      return;
    }

    // 调用消息处理器
    const handlers = this.messageHandlers.get(message.type as MessageType);
    if (handlers) {
      handlers.forEach(handler => {
        try {
          handler(message);
        } catch (error) {
          this.log('消息处理器错误', { error, type: message.type });
        }
      });
    }

    // 默认处理心跳
    if (message.type === MessageType.HEARTBEAT) {
      this.log('收到心跳响应');
    }
  }

  private handleReconnect(): void {
    if (this.reconnectAttempts >= this.config.reconnectAttempts!) {
      this.log('重连次数已达上限，停止重连');
      return;
    }

    this.reconnectAttempts++;
    const delay = this.config.reconnectDelay! * Math.pow(2, this.reconnectAttempts - 1);
    
    this.log(`将在 ${delay}ms 后尝试重连 (第 ${this.reconnectAttempts} 次)`);
    this.setStatus(ConnectionStatus.RECONNECTING);

    setTimeout(() => {
      if (this.status === ConnectionStatus.DISCONNECTED || this.status === ConnectionStatus.RECONNECTING) {
        this.connect().catch(error => {
          this.log('重连失败', { error });
        });
      }
    }, delay);
  }

  private startHeartbeat(): void {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
    }

    this.heartbeatInterval = setInterval(() => {
      if (this.isConnected()) {
        this.send(MessageType.HEARTBEAT).catch(error => {
          this.log('发送心跳失败', { error });
        });
      }
    }, this.config.heartbeatInterval);
  }

  private stopHeartbeat(): void {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }
  }

  private generateRequestId(): string {
    return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }

  private log(message: string, data?: any): void {
    if (this.config.debug) {
      console.log(`[WebSocket] ${message}`, data || '');
    }
  }
}

// 创建全局单例实例
let globalInstance: WebSocketClient | null = null;

export function getWebSocketClient(config?: Partial<WebSocketConfig>): WebSocketClient {
  if (!globalInstance) {
    globalInstance = new WebSocketClient(config);
  }
  return globalInstance;
}

export default WebSocketClient;