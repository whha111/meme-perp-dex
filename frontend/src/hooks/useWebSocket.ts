/**
 * WebSocket Hook - 实时数据订阅
 */

import { useEffect, useRef, useState, useCallback } from 'react';
import {
  wsClient,
  WsChannel,
  WsTicker,
  WsTrade,
  WsOrderBook,
  WsCandle,
  WsPosition,
  WsOrder,
  WsChannelType,
} from '@/lib/api/websocket';

// 连接状态
export type ConnectionStatus = 'connecting' | 'connected' | 'disconnected' | 'error';

/**
 * WebSocket 连接管理 Hook
 */
export function useWebSocketConnection() {
  const [status, setStatus] = useState<ConnectionStatus>('disconnected');
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    setStatus('connecting');

    wsClient.onOpen(() => {
      setStatus('connected');
      setError(null);
    });

    wsClient.onClose(() => {
      setStatus('disconnected');
    });

    wsClient.onError((err) => {
      setStatus('error');
      setError(err instanceof Error ? err : new Error('WebSocket error'));
    });

    wsClient.connect().catch((err) => {
      setStatus('error');
      setError(err);
    });

    return () => {
      wsClient.disconnect();
    };
  }, []);

  const reconnect = useCallback(() => {
    setStatus('connecting');
    wsClient.connect().catch((err) => {
      setStatus('error');
      setError(err);
    });
  }, []);

  return { status, error, reconnect, isConnected: status === 'connected' };
}

/**
 * 通用订阅 Hook
 */
function useSubscription<T>(
  channel: WsChannelType,
  instId?: string,
  enabled: boolean = true
) {
  const [data, setData] = useState<T | null>(null);
  const [lastUpdate, setLastUpdate] = useState<number>(0);

  useEffect(() => {
    if (!enabled) return;

    const handler = (newData: T) => {
      setData(newData);
      setLastUpdate(Date.now());
    };

    const unsubscribe = wsClient.subscribe<T>(channel, handler, instId);

    return () => {
      unsubscribe();
    };
  }, [channel, instId, enabled]);

  return { data, lastUpdate };
}

/**
 * Ticker 实时数据 Hook
 */
export function useTicker(instId: string, enabled: boolean = true) {
  const { data, lastUpdate } = useSubscription<WsTicker[]>(
    WsChannel.TICKERS,
    instId,
    enabled
  );

  return {
    ticker: data?.[0] ?? null,
    lastUpdate,
  };
}

/**
 * 所有 Tickers Hook
 */
export function useTickers(enabled: boolean = true) {
  const { data, lastUpdate } = useSubscription<WsTicker[]>(
    WsChannel.TICKERS,
    undefined,
    enabled
  );

  return {
    tickers: data ?? [],
    lastUpdate,
  };
}

/**
 * 实时交易数据 Hook
 */
export function useRealtimeTrades(instId: string, enabled: boolean = true) {
  const [trades, setTrades] = useState<WsTrade[]>([]);
  const maxTrades = 100;

  useEffect(() => {
    if (!enabled) return;

    const handler = (newTrades: WsTrade[]) => {
      setTrades((prev) => {
        const combined = [...newTrades, ...prev];
        return combined.slice(0, maxTrades);
      });
    };

    const unsubscribe = wsClient.subscribe<WsTrade[]>(
      WsChannel.TRADES,
      handler,
      instId
    );

    return () => {
      unsubscribe();
      setTrades([]);
    };
  }, [instId, enabled]);

  return { trades };
}

/**
 * Order Book Hook
 */
export function useOrderBook(instId: string, enabled: boolean = true) {
  const { data, lastUpdate } = useSubscription<WsOrderBook>(
    WsChannel.BOOKS,
    instId,
    enabled
  );

  return {
    orderBook: data,
    asks: data?.asks ?? [],
    bids: data?.bids ?? [],
    lastUpdate,
  };
}

/**
 * K线数据 Hook
 */
export function useRealtimeCandles(
  instId: string,
  bar: string = '1m',
  enabled: boolean = true
) {
  const [candle, setCandle] = useState<WsCandle | null>(null);
  const channelInstId = `${instId}:${bar}`;

  useEffect(() => {
    if (!enabled) return;

    const handler = (data: WsCandle[]) => {
      if (data.length > 0) {
        setCandle(data[0]);
      }
    };

    const unsubscribe = wsClient.subscribe<WsCandle[]>(
      WsChannel.CANDLE,
      handler,
      channelInstId
    );

    return () => {
      unsubscribe();
    };
  }, [channelInstId, enabled]);

  return { candle };
}

/**
 * Mark Price Hook
 */
export function useMarkPrice(instId: string, enabled: boolean = true) {
  const { data, lastUpdate } = useSubscription<{ instId: string; markPx: string; ts: number }[]>(
    WsChannel.MARK_PRICE,
    instId,
    enabled
  );

  return {
    markPrice: data?.[0]?.markPx ?? null,
    lastUpdate,
  };
}

/**
 * Funding Rate Hook
 */
export function useRealtimeFundingRate(instId: string, enabled: boolean = true) {
  const { data, lastUpdate } = useSubscription<{
    instId: string;
    fundingRate: string;
    nextFundingRate: string;
    fundingTime: number;
  }[]>(WsChannel.FUNDING_RATE, instId, enabled);

  return {
    fundingRate: data?.[0] ?? null,
    lastUpdate,
  };
}

/**
 * 私有频道 - 持仓 Hook
 */
export function useRealtimePositions(enabled: boolean = true) {
  const [positions, setPositions] = useState<WsPosition[]>([]);

  useEffect(() => {
    if (!enabled) return;

    const handler = (data: WsPosition[]) => {
      setPositions(data);
    };

    const unsubscribe = wsClient.subscribe<WsPosition[]>(
      WsChannel.POSITIONS,
      handler
    );

    return () => {
      unsubscribe();
    };
  }, [enabled]);

  return { positions };
}

/**
 * 私有频道 - 订单 Hook
 */
export function useRealtimeOrders(enabled: boolean = true) {
  const [orders, setOrders] = useState<WsOrder[]>([]);
  const ordersRef = useRef<Map<string, WsOrder>>(new Map());

  useEffect(() => {
    if (!enabled) return;

    const handler = (data: WsOrder[]) => {
      data.forEach((order) => {
        ordersRef.current.set(order.ordId, order);
      });
      setOrders(Array.from(ordersRef.current.values()));
    };

    const unsubscribe = wsClient.subscribe<WsOrder[]>(
      WsChannel.ORDERS,
      handler
    );

    return () => {
      unsubscribe();
      ordersRef.current.clear();
    };
  }, [enabled]);

  return { orders };
}

/**
 * 清算预警 Hook
 */
export function useLiquidationWarning(enabled: boolean = true) {
  const [warning, setWarning] = useState<{
    instId: string;
    posSide: string;
    mgnRatio: string;
    liqPx: string;
  } | null>(null);

  useEffect(() => {
    if (!enabled) return;

    const handler = (data: typeof warning) => {
      setWarning(data);
    };

    const unsubscribe = wsClient.subscribe(WsChannel.LIQUIDATION, handler);

    return () => {
      unsubscribe();
    };
  }, [enabled]);

  return { warning };
}
