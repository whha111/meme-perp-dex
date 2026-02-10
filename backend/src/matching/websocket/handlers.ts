/**
 * WebSocket 消息处理
 */

import { WebSocket } from "ws";
import type { Address } from "viem";
import { logger } from "../utils/logger";
import { engine } from "../modules/matching";
import { getUserPositions } from "../modules/position";
import { getBalance } from "../modules/balance";
import { getFundingRateInfo } from "../modules/funding";
import { getUserRiskData } from "../modules/risk";
import type { WSMessage, WSMessageType, Position, Trade, OrderBookSnapshot, RiskData, Order, OrderStatus } from "../types";

// ============================================================
// Types
// ============================================================

interface ClientState {
  subscribedTokens: Set<Address>;
  subscribedTrader: Address | null;
  subscribedRisk: boolean;
}

// ============================================================
// Client Management
// ============================================================

export const wsClients = new Map<WebSocket, ClientState>();
export const traderClients = new Map<Address, Set<WebSocket>>();

export function initClient(ws: WebSocket): void {
  wsClients.set(ws, {
    subscribedTokens: new Set(),
    subscribedTrader: null,
    subscribedRisk: false,
  });
}

export function removeClient(ws: WebSocket): void {
  const state = wsClients.get(ws);
  if (state?.subscribedTrader) {
    const traders = traderClients.get(state.subscribedTrader);
    if (traders) {
      traders.delete(ws);
      if (traders.size === 0) {
        traderClients.delete(state.subscribedTrader);
      }
    }
  }
  wsClients.delete(ws);
}

// ============================================================
// Message Handling
// ============================================================

export async function handleMessage(ws: WebSocket, message: string): Promise<void> {
  try {
    const data = JSON.parse(message);
    const { type, ...params } = data;

    switch (type) {
      case "subscribe":
        // 兼容前端格式: { type: "subscribe", channel: "orderbook", token: "0x..." }
        handleSubscribeToken(ws, params.token as Address);
        break;

      case "unsubscribe":
        // 兼容前端格式: { type: "unsubscribe", channel: "orderbook", token: "0x..." }
        handleUnsubscribeToken(ws, params.token as Address);
        break;

      case "subscribe_token":
      case "subscribe_orderbook":
        handleSubscribeToken(ws, params.token as Address);
        break;

      case "unsubscribe_token":
      case "unsubscribe_orderbook":
        handleUnsubscribeToken(ws, params.token as Address);
        break;

      case "subscribe_trader":
        handleSubscribeTrader(ws, params.trader as Address);
        break;

      case "unsubscribe_trader":
        handleUnsubscribeTrader(ws);
        break;

      case "subscribe_risk":
        handleSubscribeRisk(ws);
        break;

      case "unsubscribe_risk":
        handleUnsubscribeRisk(ws);
        break;

      case "get_orderbook":
        await sendOrderbook(ws, params.token as Address);
        break;

      case "get_positions":
        await sendPositions(ws, params.trader as Address);
        break;

      case "get_balance":
        await sendBalance(ws, params.trader as Address);
        break;

      case "get_funding":
        await sendFunding(ws, params.token as Address);
        break;

      case "ping":
        sendMessage(ws, { type: "pong", data: { time: Date.now() }, timestamp: Date.now() });
        break;

      default:
        sendError(ws, `Unknown message type: ${type}`);
    }
  } catch (error) {
    logger.error("WSHandler", "Message handling error:", error);
    sendError(ws, "Invalid message format");
  }
}

// ============================================================
// Subscription Handlers
// ============================================================

function handleSubscribeToken(ws: WebSocket, token: Address): void {
  const state = wsClients.get(ws);
  if (state) {
    const normalizedToken = token.toLowerCase() as Address;
    state.subscribedTokens.add(normalizedToken);
    logger.debug("WSHandler", `Client subscribed to token: ${token}`);

    // 立即推送当前市场数据
    broadcastMarketDataToClient(ws, normalizedToken);
  }
}

function handleUnsubscribeToken(ws: WebSocket, token: Address): void {
  const state = wsClients.get(ws);
  if (state) {
    state.subscribedTokens.delete(token.toLowerCase() as Address);
  }
}

/**
 * 给单个客户端推送市场数据
 */
function broadcastMarketDataToClient(ws: WebSocket, token: Address): void {
  if (ws.readyState !== WebSocket.OPEN) return;

  const orderBook = engine.getOrderBook(token);
  const depth = orderBook.getDepth(20);
  const trades = orderBook.getTrades(100);

  // 计算24小时统计
  const now = Date.now();
  const oneDayAgo = now - 24 * 60 * 60 * 1000;
  const trades24h = trades.filter(t => t.timestamp >= oneDayAgo);

  let high24h = depth.lastPrice;
  let low24h = depth.lastPrice;
  let volume24h = 0n;
  let open24h = depth.lastPrice;

  if (trades24h.length > 0) {
    open24h = trades24h[trades24h.length - 1].price;
    for (const t of trades24h) {
      if (t.price > high24h) high24h = t.price;
      if (t.price < low24h) low24h = t.price;
      // 计算 USD 成交量: size (1e18) * price (1e12) / 1e18 = USD (1e12)
      // 转换为 1e6 精度 (标准 USDT 精度): / 1e6
      volume24h += (t.size * t.price) / (10n ** 18n) / (10n ** 6n);
    }
  }

  const priceChange = depth.lastPrice - open24h;
  const priceChangePercent = open24h > 0n ? Number(priceChange * 10000n / open24h) / 100 : 0;

  // 推送市场数据
  const marketData = {
    token,
    lastPrice: depth.lastPrice.toString(),
    markPrice: depth.lastPrice.toString(),
    indexPrice: depth.lastPrice.toString(),
    high24h: high24h.toString(),
    low24h: low24h.toString(),
    volume24h: volume24h.toString(),
    open24h: open24h.toString(),
    priceChange24h: priceChange.toString(),
    priceChangePercent24h: priceChangePercent.toFixed(2),
    askPrice: depth.asks[0]?.price?.toString() || "0",
    askSize: depth.asks[0]?.totalSize?.toString() || "0",
    bidPrice: depth.bids[0]?.price?.toString() || "0",
    bidSize: depth.bids[0]?.totalSize?.toString() || "0",
    timestamp: now,
  };

  // 前端期望 token 在顶层，data 包含具体数据
  ws.send(JSON.stringify({ type: "market_data", token, data: marketData, timestamp: now }));

  // 推送订单簿
  ws.send(JSON.stringify({ type: "orderbook", data: serializeOrderbook(depth), timestamp: now }));
}

function handleSubscribeTrader(ws: WebSocket, trader: Address): void {
  const state = wsClients.get(ws);
  if (!state) return;

  const normalizedTrader = trader.toLowerCase() as Address;

  // 移除旧的订阅
  if (state.subscribedTrader) {
    const oldTraders = traderClients.get(state.subscribedTrader);
    if (oldTraders) {
      oldTraders.delete(ws);
    }
  }

  // 添加新订阅
  state.subscribedTrader = normalizedTrader;
  if (!traderClients.has(normalizedTrader)) {
    traderClients.set(normalizedTrader, new Set());
  }
  traderClients.get(normalizedTrader)!.add(ws);

  logger.debug("WSHandler", `Client subscribed to trader: ${trader}`);
}

function handleUnsubscribeTrader(ws: WebSocket): void {
  const state = wsClients.get(ws);
  if (state?.subscribedTrader) {
    const traders = traderClients.get(state.subscribedTrader);
    if (traders) {
      traders.delete(ws);
    }
    state.subscribedTrader = null;
  }
}

function handleSubscribeRisk(ws: WebSocket): void {
  const state = wsClients.get(ws);
  if (state) {
    state.subscribedRisk = true;
  }
}

function handleUnsubscribeRisk(ws: WebSocket): void {
  const state = wsClients.get(ws);
  if (state) {
    state.subscribedRisk = false;
  }
}

// ============================================================
// Data Senders
// ============================================================

async function sendOrderbook(ws: WebSocket, token: Address): Promise<void> {
  const orderBook = engine.getOrderBook(token);
  const snapshot = orderBook.getDepth(20);
  sendMessage(ws, { type: "orderbook", data: serializeOrderbook(snapshot), timestamp: Date.now() });
}

async function sendPositions(ws: WebSocket, trader: Address): Promise<void> {
  const positions = await getUserPositions(trader);
  sendMessage(ws, { type: "position", data: serializePositions(positions), timestamp: Date.now() });
}

async function sendBalance(ws: WebSocket, trader: Address): Promise<void> {
  const balance = await getBalance(trader);
  sendMessage(ws, {
    type: "balance",
    data: {
      trader: balance.trader,
      walletBalance: balance.walletBalance.toString(),
      frozenMargin: balance.frozenMargin.toString(),
      usedMargin: balance.usedMargin.toString(),
      unrealizedPnL: balance.unrealizedPnL.toString(),
      availableBalance: balance.availableBalance.toString(),
      equity: balance.equity.toString(),
    },
    timestamp: Date.now(),
  });
}

async function sendFunding(ws: WebSocket, token: Address): Promise<void> {
  const funding = await getFundingRateInfo(token);
  sendMessage(ws, {
    type: "funding",
    data: {
      token: funding.token,
      rate: funding.rate.toString(),
      markPrice: funding.markPrice.toString(),
      indexPrice: funding.indexPrice.toString(),
      nextSettlementTime: funding.nextSettlementTime,
    },
    timestamp: Date.now(),
  });
}

// ============================================================
// Broadcast Functions
// ============================================================

export function broadcastOrderbook(token: Address): void {
  const normalizedToken = token.toLowerCase() as Address;
  const orderBook = engine.getOrderBook(normalizedToken);
  const snapshot = orderBook.getDepth(20);
  const message: WSMessage = { type: "orderbook", data: serializeOrderbook(snapshot), timestamp: Date.now() };

  for (const [client, state] of wsClients) {
    if (state.subscribedTokens.has(normalizedToken) && client.readyState === WebSocket.OPEN) {
      client.send(JSON.stringify(message));
    }
  }
}

export function broadcastTrade(trade: Trade): void {
  const normalizedToken = trade.token.toLowerCase() as Address;
  const message: WSMessage = {
    type: "trade",
    data: {
      id: trade.id,
      token: trade.token,
      price: trade.price.toString(),
      size: trade.size.toString(),
      side: trade.side,
      timestamp: trade.timestamp,
    },
    timestamp: Date.now(),
  };

  for (const [client, state] of wsClients) {
    if (state.subscribedTokens.has(normalizedToken) && client.readyState === WebSocket.OPEN) {
      client.send(JSON.stringify(message));
    }
  }
}

export function broadcastPosition(position: Position): void {
  const clients = traderClients.get(position.trader.toLowerCase() as Address);
  if (!clients) return;

  const message: WSMessage = { type: "position", data: serializePosition(position), timestamp: Date.now() };
  const messageStr = JSON.stringify(message);

  for (const client of clients) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(messageStr);
    }
  }
}

export function broadcastRiskData(riskDataList: RiskData[]): void {
  const message: WSMessage = {
    type: "risk",
    data: riskDataList.map(serializeRiskData),
    timestamp: Date.now(),
  };
  const messageStr = JSON.stringify(message);

  for (const [client, state] of wsClients) {
    if (state.subscribedRisk && client.readyState === WebSocket.OPEN) {
      client.send(messageStr);
    }
  }
}

export function broadcastToTrader(trader: Address, type: WSMessageType, data: unknown): void {
  const clients = traderClients.get(trader.toLowerCase() as Address);
  if (!clients) return;

  const message: WSMessage = { type, data, timestamp: Date.now() };
  const messageStr = JSON.stringify(message);

  for (const client of clients) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(messageStr);
    }
  }
}

/**
 * 推送余额更新给指定交易者
 */
export async function broadcastBalanceUpdate(trader: Address): Promise<void> {
  const { syncBalanceFromChain } = await import("../modules/balance");

  try {
    // 从链上同步最新余额
    const balance = await syncBalanceFromChain(trader);

    // 推送给订阅该交易者的所有客户端
    broadcastToTrader(trader, "balance" as WSMessageType, {
      trader: balance.trader,
      totalBalance: balance.walletBalance.toString(),
      availableBalance: balance.availableBalance.toString(),
      usedMargin: balance.usedMargin.toString(),
      unrealizedPnL: balance.unrealizedPnL.toString(),
      equity: balance.equity.toString(),
    });

    logger.info("WSHandler", `Balance update pushed to ${trader}: ${balance.walletBalance}`);
  } catch (error) {
    logger.error("WSHandler", `Failed to push balance update for ${trader}:`, error);
  }
}

// ============================================================
// Helpers
// ============================================================

function sendMessage(ws: WebSocket, message: WSMessage): void {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(message));
  }
}

function sendError(ws: WebSocket, error: string): void {
  sendMessage(ws, { type: "error" as WSMessageType, data: { error }, timestamp: Date.now() });
}

function serializeOrderbook(snapshot: OrderBookSnapshot): unknown {
  return {
    token: snapshot.token,
    // 前端兼容: longs = bids, shorts = asks
    longs: snapshot.bids.map(l => ({
      price: l.price.toString(),
      size: l.totalSize.toString(),
      count: l.orderCount,
    })),
    shorts: snapshot.asks.map(l => ({
      price: l.price.toString(),
      size: l.totalSize.toString(),
      count: l.orderCount,
    })),
    // 同时保留 bids/asks 以兼容其他客户端
    bids: snapshot.bids.map(l => ({
      price: l.price.toString(),
      size: l.totalSize.toString(),
      count: l.orderCount,
    })),
    asks: snapshot.asks.map(l => ({
      price: l.price.toString(),
      size: l.totalSize.toString(),
      count: l.orderCount,
    })),
    lastPrice: snapshot.lastPrice.toString(),
    timestamp: snapshot.timestamp,
  };
}

function serializePosition(pos: Position): unknown {
  return {
    id: pos.id,
    pairId: pos.pairId,
    trader: pos.trader,
    token: pos.token,
    isLong: pos.isLong,
    size: pos.size.toString(),
    entryPrice: pos.entryPrice.toString(),
    leverage: (Number(pos.leverage) / 10000).toString(),
    markPrice: pos.markPrice.toString(),
    liquidationPrice: pos.liquidationPrice.toString(),
    collateral: pos.collateral.toString(),
    margin: pos.margin.toString(),
    marginRatio: (Number(pos.marginRatio) / 100).toFixed(2) + "%",
    unrealizedPnL: pos.unrealizedPnL.toString(),
    roe: (Number(pos.roe) / 100).toFixed(2) + "%",
    riskLevel: pos.riskLevel,
    adlRanking: pos.adlRanking,
  };
}

function serializePositions(positions: Position[]): unknown {
  return positions.map(serializePosition);
}

function serializeRiskData(data: RiskData): unknown {
  return {
    trader: data.trader,
    positions: data.positions.map(serializePosition),
    totalMargin: data.totalMargin.toString(),
    totalUnrealizedPnL: data.totalUnrealizedPnL.toString(),
    totalEquity: data.totalEquity.toString(),
    riskLevel: data.riskLevel,
  };
}

// ============================================================
// Market Data Push (实时推送)
// ============================================================

let marketDataInterval: NodeJS.Timeout | null = null;

/**
 * 推送市场数据给订阅该代币的所有客户端
 */
export function broadcastMarketData(token: Address): void {
  const normalizedToken = token.toLowerCase() as Address;
  const orderBook = engine.getOrderBook(normalizedToken);
  const depth = orderBook.getDepth(20);
  const trades = orderBook.getTrades(100);
  const lastTrade = trades[0];

  // 计算24小时统计
  const now = Date.now();
  const oneDayAgo = now - 24 * 60 * 60 * 1000;
  const trades24h = trades.filter(t => t.timestamp >= oneDayAgo);

  let high24h = depth.lastPrice;
  let low24h = depth.lastPrice;
  let volume24h = 0n;
  let open24h = depth.lastPrice;

  if (trades24h.length > 0) {
    open24h = trades24h[trades24h.length - 1].price;
    for (const t of trades24h) {
      if (t.price > high24h) high24h = t.price;
      if (t.price < low24h) low24h = t.price;
      // 计算 USD 成交量: size (1e18) * price (1e12) / 1e18 = USD (1e12)
      // 转换为 1e6 精度 (标准 USDT 精度): / 1e6
      volume24h += (t.size * t.price) / (10n ** 18n) / (10n ** 6n);
    }
  }

  const priceChange = depth.lastPrice - open24h;
  const priceChangePercent = open24h > 0n ? Number(priceChange * 10000n / open24h) / 100 : 0;

  // 构建市场数据消息
  const marketData = {
    token: normalizedToken,
    lastPrice: depth.lastPrice.toString(),
    markPrice: depth.lastPrice.toString(),
    indexPrice: depth.lastPrice.toString(),
    high24h: high24h.toString(),
    low24h: low24h.toString(),
    volume24h: volume24h.toString(),
    open24h: open24h.toString(),
    priceChange24h: priceChange.toString(),
    priceChangePercent24h: priceChangePercent.toFixed(2),
    askPrice: depth.asks[0]?.price?.toString() || "0",
    askSize: depth.asks[0]?.totalSize?.toString() || "0",
    bidPrice: depth.bids[0]?.price?.toString() || "0",
    bidSize: depth.bids[0]?.totalSize?.toString() || "0",
    timestamp: now,
  };

  // 前端期望 token 在顶层，data 包含具体数据
  const message: WSMessage = { type: "market_data" as WSMessageType, token: normalizedToken, data: marketData, timestamp: now };
  const messageStr = JSON.stringify(message);

  for (const [client, state] of wsClients) {
    if (state.subscribedTokens.has(normalizedToken) && client.readyState === WebSocket.OPEN) {
      client.send(messageStr);
    }
  }
}

/**
 * 推送K线数据
 */
export function broadcastKline(token: Address, kline: {
  timestamp: number;
  open: string;
  high: string;
  low: string;
  close: string;
  volume: string;
}): void {
  const normalizedToken = token.toLowerCase() as Address;
  const message: WSMessage = {
    type: "kline" as WSMessageType,
    data: { token: normalizedToken, ...kline },
    timestamp: Date.now(),
  };
  const messageStr = JSON.stringify(message);

  for (const [client, state] of wsClients) {
    if (state.subscribedTokens.has(normalizedToken) && client.readyState === WebSocket.OPEN) {
      client.send(messageStr);
    }
  }
}

/**
 * 推送资金费率
 */
export async function broadcastFundingRate(token: Address): Promise<void> {
  const normalizedToken = token.toLowerCase() as Address;

  try {
    const funding = await getFundingRateInfo(normalizedToken);
    // 前端期望字段在顶层: token, rate, nextFundingTime 等
    const message = {
      type: "funding_rate",
      token: normalizedToken,
      rate: funding.rate.toString(),
      markPrice: funding.markPrice.toString(),
      indexPrice: funding.indexPrice.toString(),
      nextFundingTime: funding.nextSettlementTime, // 前端期望 nextFundingTime
      interval: "5m",
      timestamp: Date.now(),
    };
    const messageStr = JSON.stringify(message);

    for (const [client, state] of wsClients) {
      if (state.subscribedTokens.has(normalizedToken) && client.readyState === WebSocket.OPEN) {
        client.send(messageStr);
      }
    }
  } catch (error) {
    // 忽略错误
  }
}

/**
 * 启动市场数据定时推送
 */
export function startMarketDataPush(tokens: Address[], intervalMs = 1000): void {
  if (marketDataInterval) return;

  // K线状态追踪
  const klineState = new Map<string, { lastMinute: number; open: bigint; high: bigint; low: bigint; close: bigint; volume: bigint }>();

  marketDataInterval = setInterval(async () => {
    const now = Date.now();
    const currentMinute = Math.floor(now / 60000) * 60000;

    for (const token of tokens) {
      const normalizedToken = token.toLowerCase() as Address;

      // 检查是否有订阅者
      let hasSubscribers = false;
      for (const [, state] of wsClients) {
        if (state.subscribedTokens.has(normalizedToken)) {
          hasSubscribers = true;
          break;
        }
      }
      if (!hasSubscribers) continue;

      // 推送市场数据
      broadcastMarketData(normalizedToken);

      // 推送订单簿
      broadcastOrderbook(normalizedToken);

      // 更新和推送K线
      const orderBook = engine.getOrderBook(normalizedToken);
      const depth = orderBook.getDepth(1);
      const price = depth.lastPrice;

      const stateKey = normalizedToken;
      let kline = klineState.get(stateKey);

      if (!kline || kline.lastMinute !== currentMinute) {
        // 新的一分钟，推送上一根K线并创建新K线
        if (kline && kline.lastMinute !== currentMinute) {
          // 价格: 1e12 精度 bigint → 小数字符串
          // 交易量: 1e18 精度 bigint → 小数字符串
          broadcastKline(normalizedToken, {
            timestamp: kline.lastMinute,
            open: (Number(kline.open) / 1e12).toString(),
            high: (Number(kline.high) / 1e12).toString(),
            low: (Number(kline.low) / 1e12).toString(),
            close: (Number(kline.close) / 1e12).toString(),
            volume: (Number(kline.volume) / 1e18).toString(),
          });
        }

        kline = {
          lastMinute: currentMinute,
          open: price,
          high: price,
          low: price,
          close: price,
          volume: 0n,
        };
        klineState.set(stateKey, kline);
      } else {
        // 更新当前K线
        kline.close = price;
        if (price > kline.high) kline.high = price;
        if (price < kline.low) kline.low = price;
      }

      // 推送当前K线 (价格: 1e12 → 小数, 交易量: 1e18 → 小数)
      broadcastKline(normalizedToken, {
        timestamp: kline.lastMinute,
        open: (Number(kline.open) / 1e12).toString(),
        high: (Number(kline.high) / 1e12).toString(),
        low: (Number(kline.low) / 1e12).toString(),
        close: (Number(kline.close) / 1e12).toString(),
        volume: (Number(kline.volume) / 1e18).toString(),
      });
    }

    // 每5秒推送一次资金费率
    if (now % 5000 < intervalMs) {
      for (const token of tokens) {
        await broadcastFundingRate(token);
      }
    }
  }, intervalMs);

  logger.info("WSHandler", `Started market data push, interval: ${intervalMs}ms`);
}

/**
 * 停止市场数据推送
 */
export function stopMarketDataPush(): void {
  if (marketDataInterval) {
    clearInterval(marketDataInterval);
    marketDataInterval = null;
    logger.info("WSHandler", "Stopped market data push");
  }
}

// ============================================================
// Order Broadcasts
// ============================================================

/**
 * 序列化订单数据供 WebSocket 推送
 */
function serializeOrder(order: Order): Record<string, unknown> {
  return {
    id: order.id,
    orderId: order.orderId,
    clientOrderId: order.clientOrderId,
    trader: order.trader,
    token: order.token,
    isLong: order.isLong,
    size: order.size.toString(),
    price: order.price.toString(),
    leverage: order.leverage.toString(),
    margin: order.margin.toString(),
    fee: order.fee.toString(),
    orderType: order.orderType,
    timeInForce: order.timeInForce,
    reduceOnly: order.reduceOnly,
    postOnly: order.postOnly,
    filledSize: order.filledSize.toString(),
    avgFillPrice: order.avgFillPrice.toString(),
    status: order.status,
    createdAt: order.createdAt,
    updatedAt: order.updatedAt,
  };
}

/**
 * 推送单个订单更新给交易者
 */
export function broadcastOrderUpdate(order: Order): void {
  const trader = order.trader.toLowerCase() as Address;
  const clients = traderClients.get(trader);
  if (!clients || clients.size === 0) return;

  const message: WSMessage = {
    type: "orders" as WSMessageType,
    order: serializeOrder(order),
    timestamp: Date.now(),
  };
  const messageStr = JSON.stringify(message);

  for (const client of clients) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(messageStr);
    }
  }

  logger.debug("WSHandler", `Order update pushed to ${trader}: ${order.id} (${order.status})`);
}

/**
 * 推送所有待处理订单给交易者
 */
export function broadcastPendingOrders(trader: Address): void {
  const normalizedTrader = trader.toLowerCase() as Address;
  const clients = traderClients.get(normalizedTrader);
  if (!clients || clients.size === 0) return;

  // 从引擎获取用户的待处理订单
  const orders = engine.getUserOrders(normalizedTrader);
  const pendingOrders = orders.filter(o =>
    o.status === 0 || o.status === 1 // PENDING or PARTIALLY_FILLED
  );

  const message: WSMessage = {
    type: "orders" as WSMessageType,
    orders: pendingOrders.map(serializeOrder),
    timestamp: Date.now(),
  };
  const messageStr = JSON.stringify(message);

  for (const client of clients) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(messageStr);
    }
  }

  logger.debug("WSHandler", `Pending orders pushed to ${trader}: ${pendingOrders.length} orders`);
}
