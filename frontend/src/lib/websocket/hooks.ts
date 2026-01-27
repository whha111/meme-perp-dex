/**
 * WebSocket React Hooks
 */

import { useEffect, useState, useCallback, useRef } from 'react';
import { WebSocketClient, getWebSocketClient } from './client';
import { ConnectionStatus, MessageType, WebSocketMessage } from './types';

/**
 * 使用 WebSocket 连接状态
 */
export function useWebSocketStatus(client?: WebSocketClient): ConnectionStatus {
  const wsClient = client || getWebSocketClient();
  const [status, setStatus] = useState<ConnectionStatus>(wsClient.getStatus());

  useEffect(() => {
    const unsubscribe = wsClient.onConnectionChange(setStatus);
    return unsubscribe;
  }, [wsClient]);

  return status;
}

/**
 * 使用 WebSocket 消息订阅
 */
export function useWebSocketMessage<T = any>(
  type: MessageType,
  handler: (message: WebSocketMessage<T>) => void,
  client?: WebSocketClient
): void {
  const wsClient = client || getWebSocketClient();
  const handlerRef = useRef(handler);

  // 更新 handler 引用
  useEffect(() => {
    handlerRef.current = handler;
  }, [handler]);

  useEffect(() => {
    const messageHandler = (message: WebSocketMessage<unknown>) => {
      handlerRef.current(message as WebSocketMessage<T>);
    };

    const unsubscribe = wsClient.on(type, messageHandler);
    return unsubscribe;
  }, [type, wsClient]);
}

/**
 * 使用 WebSocket 请求
 */
export function useWebSocketRequest() {
  const wsClient = getWebSocketClient();
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const request = useCallback(async <T = any>(
    type: MessageType,
    data?: any
  ): Promise<T> => {
    setIsLoading(true);
    setError(null);

    try {
      const result = await wsClient.request<T>(type, data);
      return result;
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      setError(error);
      throw error;
    } finally {
      setIsLoading(false);
    }
  }, [wsClient]);

  return {
    request,
    isLoading,
    error,
  };
}

/**
 * 使用 WebSocket 连接管理
 */
export function useWebSocketConnection() {
  const wsClient = getWebSocketClient();
  const status = useWebSocketStatus(wsClient);
  const [isConnecting, setIsConnecting] = useState(false);
  const [connectionError, setConnectionError] = useState<Error | null>(null);

  const connect = useCallback(async (): Promise<void> => {
    setIsConnecting(true);
    setConnectionError(null);

    try {
      await wsClient.connect();
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      setConnectionError(error);
      throw error;
    } finally {
      setIsConnecting(false);
    }
  }, [wsClient]);

  const disconnect = useCallback((): void => {
    wsClient.disconnect();
  }, [wsClient]);

  return {
    connect,
    disconnect,
    status,
    isConnected: status === ConnectionStatus.CONNECTED,
    isConnecting,
    connectionError,
  };
}

/**
 * 使用 WebSocket 主题订阅
 */
export function useWebSocketSubscription() {
  const wsClient = getWebSocketClient();
  const [subscribedTopics, setSubscribedTopics] = useState<Set<string>>(new Set());
  const [isSubscribing, setIsSubscribing] = useState(false);
  const [subscriptionError, setSubscriptionError] = useState<Error | null>(null);

  const subscribe = useCallback(async (topics: string | string[]): Promise<void> => {
    const topicArray = Array.isArray(topics) ? topics : [topics];
    
    setIsSubscribing(true);
    setSubscriptionError(null);

    try {
      await wsClient.subscribe(topicArray);
      
      // 更新已订阅的主题
      setSubscribedTopics(prev => {
        const newSet = new Set(prev);
        topicArray.forEach(topic => newSet.add(topic));
        return newSet;
      });
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      setSubscriptionError(error);
      throw error;
    } finally {
      setIsSubscribing(false);
    }
  }, [wsClient]);

  const unsubscribe = useCallback(async (topics: string | string[]): Promise<void> => {
    const topicArray = Array.isArray(topics) ? topics : [topics];
    
    setIsSubscribing(true);
    setSubscriptionError(null);

    try {
      await wsClient.unsubscribe(topicArray);
      
      // 更新已订阅的主题
      setSubscribedTopics(prev => {
        const newSet = new Set(prev);
        topicArray.forEach(topic => newSet.delete(topic));
        return newSet;
      });
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      setSubscriptionError(error);
      throw error;
    } finally {
      setIsSubscribing(false);
    }
  }, [wsClient]);

  const isSubscribed = useCallback((topic: string): boolean => {
    return subscribedTopics.has(topic);
  }, [subscribedTopics]);

  return {
    subscribe,
    unsubscribe,
    isSubscribed,
    subscribedTopics: Array.from(subscribedTopics),
    isSubscribing,
    subscriptionError,
  };
}

/**
 * 自动连接 WebSocket 的 Hook
 * 在组件挂载时自动连接，卸载时自动断开
 */
export function useAutoConnectWebSocket(autoConnect = true) {
  const { connect, disconnect, status, isConnected, isConnecting, connectionError } = useWebSocketConnection();

  // 使用 ref 存储最新的状态，避免在 useEffect 中依赖它们导致无限循环
  const statusRef = useRef(status);
  const isConnectedRef = useRef(isConnected);

  useEffect(() => {
    statusRef.current = status;
    isConnectedRef.current = isConnected;
  }, [status, isConnected]);

  // 只在组件挂载时连接，卸载时断开
  useEffect(() => {
    if (autoConnect && statusRef.current === ConnectionStatus.DISCONNECTED) {
      connect().catch(() => {
        // 错误已经在 connectionError 中
      });
    }

    return () => {
      // 注意：这里不主动断开，因为其他组件可能还在使用 WebSocket
      // 如果需要断开，可以显式调用 disconnect()
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoConnect]); // 只依赖 autoConnect，不依赖 status 和 isConnected

  return {
    connect,
    disconnect,
    status,
    isConnected,
    isConnecting,
    connectionError,
  };
}