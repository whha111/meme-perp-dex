/**
 * API 路由定义
 */

import type { Server, IncomingMessage, ServerResponse } from "http";
import { parse as parseUrl } from "url";
import type { Address, Hex } from "viem";
import { logger } from "../utils/logger";
import * as handlers from "./handlers";
import { SUPPORTED_TOKENS } from "../config";
import { MarginMode, type Position } from "../types";

// 将 Position 转换为前端期望的格式
function serializePositionForFrontend(pos: Position) {
  return {
    pairId: pos.pairId,
    token: pos.token,
    isLong: pos.isLong,
    size: pos.size.toString(),
    entryPrice: pos.entryPrice.toString(),
    collateral: pos.collateral.toString(),
    leverage: (Number(pos.leverage) / 10000).toString(), // 1e4 -> 人类可读
    marginMode: pos.marginMode === MarginMode.CROSS ? "cross" : "isolated",
    counterparty: pos.counterparty,
    unrealizedPnL: pos.unrealizedPnL.toString(),
    markPrice: pos.markPrice.toString(),
    liquidationPrice: pos.liquidationPrice.toString(),
    breakEvenPrice: pos.breakEvenPrice.toString(),
    margin: pos.margin.toString(),
    marginRatio: pos.marginRatio.toString(),
    maintenanceMargin: pos.maintenanceMargin.toString(),
    mmr: pos.mmr.toString(),
    roe: pos.roe.toString(),
    realizedPnL: pos.realizedPnL.toString(),
    fundingFee: pos.accumulatedFunding.toString(),
    riskLevel: pos.riskLevel,
    isLiquidatable: pos.isLiquidatable,
    adlRanking: pos.adlRanking,
  };
}
import { engine } from "../modules/matching";
// Note: PositionRepo.getByToken may return empty due to key mismatch with server.ts storage
// Real OI data is pushed via WebSocket broadcastMarketData → in-memory calculateOpenInterest()

// ============================================================
// Types
// ============================================================

type RouteHandler = (req: IncomingMessage, res: ServerResponse, params: Record<string, string>, body: any) => Promise<void>;

interface Route {
  method: string;
  pattern: RegExp;
  paramNames: string[];
  handler: RouteHandler;
}

// ============================================================
// Router
// ============================================================

const routes: Route[] = [];

function addRoute(method: string, path: string, handler: RouteHandler): void {
  // Convert path pattern to regex
  const paramNames: string[] = [];
  const pattern = path.replace(/:(\w+)/g, (_, name) => {
    paramNames.push(name);
    return "([^/]+)";
  });

  routes.push({
    method,
    pattern: new RegExp(`^${pattern}$`),
    paramNames,
    handler,
  });
}

function matchRoute(method: string, path: string): { route: Route; params: Record<string, string> } | null {
  for (const route of routes) {
    if (route.method !== method) continue;

    const match = path.match(route.pattern);
    if (match) {
      const params: Record<string, string> = {};
      route.paramNames.forEach((name, i) => {
        params[name] = match[i + 1];
      });
      return { route, params };
    }
  }
  return null;
}

// ============================================================
// Request Handling
// ============================================================

async function parseBody(req: IncomingMessage): Promise<any> {
  return new Promise((resolve) => {
    let body = "";
    req.on("data", chunk => body += chunk);
    req.on("end", () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch {
        resolve({});
      }
    });
  });
}

// Custom JSON stringifier that handles bigint
function jsonStringify(data: any): string {
  return JSON.stringify(data, (_, value) =>
    typeof value === "bigint" ? value.toString() : value
  );
}

function sendJson(res: ServerResponse, data: any, statusCode = 200): void {
  res.writeHead(statusCode, {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
  });
  res.end(jsonStringify(data));
}

export async function handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const { pathname } = parseUrl(req.url || "", true);
  const method = req.method || "GET";

  // CORS preflight
  if (method === "OPTIONS") {
    res.writeHead(204, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
    });
    res.end();
    return;
  }

  const match = matchRoute(method, pathname || "/");

  if (!match) {
    sendJson(res, { success: false, error: "Not found" }, 404);
    return;
  }

  try {
    const body = await parseBody(req);
    await match.route.handler(req, res, match.params, body);
  } catch (error: any) {
    logger.error("Router", "Request error:", error);
    if (!res.headersSent) {
      sendJson(res, { success: false, error: error.message }, 500);
    }
  }
}

// ============================================================
// Route Definitions
// ============================================================

// Health check
addRoute("GET", "/health", async (req, res) => {
  const result = handlers.handleHealthCheck();
  sendJson(res, result);
});

// Wallet routes
addRoute("POST", "/api/wallet/create", async (req, res, params, body) => {
  const result = await handlers.handleCreateWallet(body.userAddress, body.tradingPassword);
  sendJson(res, result, result.success ? 200 : 400);
});

addRoute("GET", "/api/wallet/:address", async (req, res, params) => {
  const result = await handlers.handleGetWallet(params.address as Address);
  sendJson(res, result);
});

addRoute("POST", "/api/wallet/authorize", async (req, res, params, body) => {
  const result = await handlers.handleAuthorize(
    body.userAddress,
    body.tradingPassword,
    body.expiresInSeconds || 3600,
    body.permissions || { canDeposit: true, canTrade: true, canWithdraw: false },
    body.limits || { maxSingleAmount: "1000000000", dailyLimit: "10000000000" },
    body.deviceId || "unknown",
    req.socket.remoteAddress || "unknown"
  );
  sendJson(res, result, result.success ? 200 : 401);
});

addRoute("POST", "/api/wallet/export", async (req, res, params, body) => {
  const result = await handlers.handleExportPrivateKey(body.userAddress, body.tradingPassword);
  sendJson(res, result, result.success ? 200 : 401);
});

// Order routes (submit order now handled in server.ts /api/order/submit)

// 兼容前端: /api/order/:id/cancel
addRoute("POST", "/api/order/:id/cancel", async (req, res, params, body) => {
  const result = await handlers.handleCancelOrder(params.id, body.trader);
  sendJson(res, result, result.success ? 200 : 400);
});

addRoute("POST", "/api/order/cancel", async (req, res, params, body) => {
  const result = await handlers.handleCancelOrder(body.orderId, body.trader);
  sendJson(res, result, result.success ? 200 : 400);
});

addRoute("GET", "/api/order/:id", async (req, res, params) => {
  const result = await handlers.handleGetOrder(params.id);
  sendJson(res, result);
});

// 兼容前端: /api/user/:trader/orders
addRoute("GET", "/api/user/:trader/orders", async (req, res, params) => {
  const result = await handlers.handleGetUserOrders(params.trader as Address);
  // 前端期望直接返回数组
  sendJson(res, result.success ? result.data : []);
});

addRoute("GET", "/api/orders/:trader", async (req, res, params) => {
  const result = await handlers.handleGetUserOrders(params.trader as Address);
  sendJson(res, result);
});

// Order history (completed/cancelled orders)
addRoute("GET", "/api/orders/:trader/history", async (req, res, params) => {
  const { query } = parseUrl(req.url || "", true);
  const limit = parseInt(query.limit as string) || 50;
  const result = await handlers.handleGetOrderHistory(params.trader as Address, limit);
  sendJson(res, result.success ? result.data : []);
});

// Trade history (perpetual trades)
addRoute("GET", "/api/trades/:trader/history", async (req, res, params) => {
  const { query } = parseUrl(req.url || "", true);
  const limit = parseInt(query.limit as string) || 50;
  const result = await handlers.handleGetTradeHistory(params.trader as Address, limit);
  sendJson(res, result.success ? result.data : []);
});

// Settlement history (bills)
addRoute("GET", "/api/user/:trader/bills", async (req, res, params) => {
  const { query } = parseUrl(req.url || "", true);
  const result = await handlers.handleGetSettlementHistory(
    params.trader as Address,
    {
      type: query.type as string | undefined,
      limit: parseInt(query.limit as string) || 50,
      before: query.before ? parseInt(query.before as string) : undefined,
    }
  );
  sendJson(res, result.success ? result.data : []);
});

// 兼容前端: /api/user/:trader/nonce
// 前端期望: { nonce: "0" } 直接返回，不要包装
addRoute("GET", "/api/user/:trader/nonce", async (req, res, params) => {
  const result = await handlers.handleGetUserNonce(params.trader as Address);
  // 前端直接读取 data.nonce
  sendJson(res, result.success ? result.data : { nonce: "0" });
});

// Position routes
addRoute("GET", "/api/position/:id", async (req, res, params) => {
  const result = await handlers.handleGetPosition(params.id);
  sendJson(res, result);
});

// 兼容前端: /api/user/:trader/positions
addRoute("GET", "/api/user/:trader/positions", async (req, res, params) => {
  const result = await handlers.handleGetUserPositions(params.trader as Address);
  // 前端期望直接返回数组，且需要转换格式
  if (result.success && result.data) {
    sendJson(res, result.data.map(serializePositionForFrontend));
  } else {
    sendJson(res, []);
  }
});

addRoute("GET", "/api/positions/:trader", async (req, res, params) => {
  const result = await handlers.handleGetUserPositions(params.trader as Address);
  sendJson(res, result);
});

// 平仓请求
addRoute("POST", "/api/position/:pairId/close", async (req, res, params, body) => {
  // TODO: 实现平仓逻辑
  sendJson(res, { success: true, message: "Close request received", pairId: params.pairId });
});

// Balance routes
// 兼容前端: /api/user/:trader/balance
// 前端期望直接返回: { totalBalance, availableBalance, usedMargin, unrealizedPnL, positions }
addRoute("GET", "/api/user/:trader/balance", async (req, res, params) => {
  // 每次都从链上同步最新余额
  try {
    const syncResult = await handlers.handleSyncBalance(params.trader as Address);
    if (syncResult.success && syncResult.data) {
      const balance = syncResult.data;
      // 可用余额 = 派生钱包余额 + 合约可用余额 - 冻结保证金
      // 用户的钱可能在派生钱包中（未存入合约）或在 Settlement 合约中
      const available = balance.walletBalance + balance.availableBalance - balance.frozenMargin;
      sendJson(res, {
        totalBalance: balance.walletBalance.toString(),
        availableBalance: available.toString(),
        usedMargin: balance.usedMargin.toString(),
        unrealizedPnL: balance.unrealizedPnL.toString(),
        positions: [],
      });
      return;
    }
  } catch (e) {
    // 同步失败，返回默认值
  }

  sendJson(res, {
    totalBalance: "0",
    availableBalance: "0",
    usedMargin: "0",
    unrealizedPnL: "0",
    positions: [],
  });
});

addRoute("GET", "/api/balance/:trader", async (req, res, params) => {
  const result = await handlers.handleGetBalance(params.trader as Address);
  sendJson(res, result);
});

addRoute("POST", "/api/balance/sync", async (req, res, params, body) => {
  const result = await handlers.handleSyncBalance(body.trader);
  sendJson(res, result);
});

// Market data routes
addRoute("GET", "/api/orderbook/:token", async (req, res, params) => {
  const { query } = parseUrl(req.url || "", true);
  const levels = parseInt(query.levels as string) || 20;
  const result = await handlers.handleGetOrderbook(params.token as Address, levels);
  // 前端期望: { longs: [], shorts: [], lastPrice: "0" }
  if (result.success && result.data) {
    const data = result.data as any;
    sendJson(res, {
      longs: data.bids || [],
      shorts: data.asks || [],
      lastPrice: data.lastPrice || "0",
    });
  } else {
    sendJson(res, { longs: [], shorts: [], lastPrice: "0" });
  }
});

addRoute("GET", "/api/trades/:token", async (req, res, params) => {
  const { query } = parseUrl(req.url || "", true);
  const limit = parseInt(query.limit as string) || 100;
  const result = await handlers.handleGetTrades(params.token as Address, limit);
  // 前端期望: { trades: [...] }
  sendJson(res, { trades: result.success ? result.data : [] });
});

// 代币统计数据 - 返回真实的 24h 统计
addRoute("GET", "/api/stats/:token", async (req, res, params) => {
  // 获取现货价格和 24h 统计
  const spotResult = await handlers.handleGetSpotPrice(params.token as Address);
  const orderbookResult = await handlers.handleGetOrderbook(params.token as Address, 1);
  const obData = orderbookResult.success ? orderbookResult.data as any : null;

  // Note: Real OI data is computed from in-memory userPositions and pushed via WebSocket.
  // HTTP stats provides initial values; WebSocket broadcastMarketData takes over with real OI.
  // We use the engine's orderbook price as a fallback for spot price.
  const normalizedToken = (params.token as string).toLowerCase() as Address;
  const orderBook = engine.getOrderBook(normalizedToken);
  const obPrice = orderBook.getCurrentPrice();
  const obPriceStr = obPrice > 0n ? obPrice.toString() : "0";

  if (spotResult.success && spotResult.data) {
    const data = spotResult.data;
    // 注意字段映射: SpotStatsRepo 返回 change24h，前端期望 priceChange24h
    const changePercent = parseFloat(data.change24h || "0");
    // 价格回退链: spotStats价格 → 订单簿价格(由syncSpotPrices设置) → 0
    const lastPrice = data.price || obPriceStr || "0";
    sendJson(res, {
      lastPrice,
      volume24h: data.volume24h || "0",
      high24h: data.high24h || "0",
      low24h: data.low24h || "0",
      priceChange24h: (changePercent * 100).toString(),
      priceChangePercent24h: changePercent.toFixed(2),
      trades24h: data.trades24h || 0,
      openInterest: "0", // Real OI pushed via WebSocket from in-memory data
    });
  } else {
    // 回退到订单簿价格 (由 syncSpotPrices 每秒同步)
    sendJson(res, {
      lastPrice: obPriceStr,
      volume24h: "0",
      high24h: obPriceStr,
      low24h: obPriceStr,
      priceChange24h: "0",
      priceChangePercent24h: "0",
      trades24h: 0,
      openInterest: "0", // Real OI pushed via WebSocket from in-memory data
    });
  }
});

// K线数据 (从现货交易历史生成)
addRoute("GET", "/api/kline/:token", async (req, res, params) => {
  const { query } = parseUrl(req.url || "", true);
  const interval = (query.interval as string) || "1m";
  const limit = parseInt(query.limit as string) || 200;

  // 使用现货 K 线数据
  const result = await handlers.handleGetLatestKlines(params.token as Address, interval, limit);

  if (result.success && result.data) {
    // 转换为前端期望的格式
    const klines = result.data.map((k: any) => ({
      timestamp: k.time * 1000, // 转换为毫秒
      open: k.open,
      high: k.high,
      low: k.low,
      close: k.close,
      volume: k.volume,
    }));
    sendJson(res, { klines });
  } else {
    sendJson(res, { klines: [] });
  }
});

addRoute("GET", "/api/funding/:token", async (req, res, params) => {
  const result = await handlers.handleGetFundingRate(params.token as Address);
  // 前端期望: { rate: "0", nextFundingTime: number, interval: "8h" }
  if (result.success && result.data) {
    sendJson(res, {
      rate: result.data.currentRate?.toString() || "0",
      nextFundingTime: result.data.nextFundingTime || Date.now() + 8 * 60 * 60 * 1000,
      interval: "1h",
    });
  } else {
    sendJson(res, {
      rate: "0",
      nextFundingTime: Date.now() + 8 * 60 * 60 * 1000,
      interval: "1h",
    });
  }
});

// Risk routes
addRoute("GET", "/api/risk/user/:trader", async (req, res, params) => {
  const result = await handlers.handleGetUserRisk(params.trader as Address);
  sendJson(res, result);
});

addRoute("GET", "/api/risk/market/:token", async (req, res, params) => {
  const result = await handlers.handleGetMarketRisk(params.token as Address);
  sendJson(res, result);
});

// ============================================================
// Liquidation Heatmap & All Positions Routes (Hunting Arena)
// ============================================================

// 清算热力图 API (新的2D热力图)
addRoute("GET", "/api/liquidation-heatmap/:token", async (req, res, params) => {
  const { query } = parseUrl(req.url || "", true);
  const timeRange = (query.timeRange as string) || "1d";
  const result = await handlers.handleGetLiquidationHeatmap(params.token as Address, timeRange);
  if (result.success && result.data) {
    sendJson(res, result.data);
  } else {
    sendJson(res, { error: result.error || "Failed to get heatmap" }, 500);
  }
});

// 清算地图 API (旧的条形图格式，用于向后兼容)
addRoute("GET", "/api/liquidation-map/:token", async (req, res, params) => {
  const result = await handlers.handleGetLiquidationMap(params.token as Address);
  if (result.success && result.data) {
    sendJson(res, result.data);
  } else {
    sendJson(res, { longs: [], shorts: [], currentPrice: "0", totalLongSize: "0", totalShortSize: "0" });
  }
});

// 全部持仓 API (带风险信息) - 用于猎杀场
// 注意: 使用 /api/hunting/positions/:token 避免与 /api/positions/:trader 冲突
addRoute("GET", "/api/hunting/positions/:token", async (req, res, params) => {
  const result = await handlers.handleGetAllPositions(params.token as Address);
  if (result.success && result.data) {
    sendJson(res, result.data);
  } else {
    sendJson(res, { positions: [], totalPositions: 0, dangerCount: 0, warningCount: 0 });
  }
});

// 调试端点: 获取所有仓位 (不分 token)
addRoute("GET", "/api/debug/all-positions", async (req, res) => {
  const result = await handlers.handleDebugAllPositions();
  sendJson(res, result);
});

// ============================================================
// OKX-style API Endpoints (for frontend compatibility)
// ============================================================

// OKX response wrapper
function sendOkxJson(res: ServerResponse, data: any, statusCode = 200): void {
  res.writeHead(statusCode, {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
  });
  res.end(jsonStringify({ code: "0", msg: "", data }));
}

function sendOkxError(res: ServerResponse, msg: string, code = "1", statusCode = 400): void {
  res.writeHead(statusCode, {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
  });
  res.end(jsonStringify({ code, msg, data: null }));
}

// Server time
addRoute("GET", "/api/v1/public/time", async (req, res) => {
  sendOkxJson(res, { ts: Date.now() });
});

// Instruments list
addRoute("GET", "/api/v1/public/instruments", async (req, res) => {
  const instruments = SUPPORTED_TOKENS.map(token => ({
    instId: `${token}-USDT`,
    baseCcy: token,
    quoteCcy: "USDT",
    settleCcy: "USDT",
    instType: "SWAP",
    state: "live",
    ctVal: "1",
    ctMult: "1",
    lever: "100",
    minSz: "1",
    lotSz: "1",
    tickSz: "0.000001",
    maxLever: 100,
    maxLimitSz: "1000000",
    maxMktSz: "1000000",
  }));
  sendOkxJson(res, instruments);
});

// All tickers
addRoute("GET", "/api/v1/market/tickers", async (req, res) => {
  const tickers = [];
  for (const token of SUPPORTED_TOKENS) {
    const orderBook = engine.getOrderBook(token);
    const depth = orderBook.getDepth(1);
    const trades = orderBook.getTrades(1);
    const lastTrade = trades[0];

    tickers.push({
      instId: `${token}-USDT`,
      last: depth.lastPrice.toString(),
      lastSz: lastTrade?.size?.toString() || "0",
      askPx: depth.asks[0]?.price?.toString() || "0",
      askSz: depth.asks[0]?.totalSize?.toString() || "0",
      bidPx: depth.bids[0]?.price?.toString() || "0",
      bidSz: depth.bids[0]?.totalSize?.toString() || "0",
      open24h: depth.lastPrice.toString(),
      high24h: depth.lastPrice.toString(),
      low24h: depth.lastPrice.toString(),
      volCcy24h: "0",
      vol24h: "0",
      ts: Date.now(),
    });
  }
  sendOkxJson(res, tickers);
});

// Single ticker
addRoute("GET", "/api/v1/market/ticker", async (req, res) => {
  const { query } = parseUrl(req.url || "", true);
  const instId = query.instId as string;
  if (!instId) {
    sendOkxError(res, "instId required");
    return;
  }

  const token = instId.split("-")[0] as Address;
  const orderBook = engine.getOrderBook(token);
  const depth = orderBook.getDepth(1);
  const trades = orderBook.getTrades(1);
  const lastTrade = trades[0];

  sendOkxJson(res, [{
    instId,
    last: depth.lastPrice.toString(),
    lastSz: lastTrade?.size?.toString() || "0",
    askPx: depth.asks[0]?.price?.toString() || "0",
    askSz: depth.asks[0]?.totalSize?.toString() || "0",
    bidPx: depth.bids[0]?.price?.toString() || "0",
    bidSz: depth.bids[0]?.totalSize?.toString() || "0",
    open24h: depth.lastPrice.toString(),
    high24h: depth.lastPrice.toString(),
    low24h: depth.lastPrice.toString(),
    volCcy24h: "0",
    vol24h: "0",
    ts: Date.now(),
  }]);
});

// Order book (OKX format)
addRoute("GET", "/api/v1/market/books", async (req, res) => {
  const { query } = parseUrl(req.url || "", true);
  const instId = query.instId as string;
  if (!instId) {
    sendOkxError(res, "instId required");
    return;
  }

  const token = instId.split("-")[0] as Address;
  const orderBook = engine.getOrderBook(token);
  const depth = orderBook.getDepth(20);

  // OKX format: [price, size, deprecated, numOrders]
  sendOkxJson(res, {
    asks: depth.asks.map(l => [l.price.toString(), l.totalSize.toString(), "0", l.orderCount.toString()]),
    bids: depth.bids.map(l => [l.price.toString(), l.totalSize.toString(), "0", l.orderCount.toString()]),
    ts: Date.now(),
  });
});

// Trades (OKX format)
addRoute("GET", "/api/v1/market/trades", async (req, res) => {
  const { query } = parseUrl(req.url || "", true);
  const instId = query.instId as string;
  const limit = parseInt(query.limit as string) || 100;

  if (!instId) {
    sendOkxError(res, "instId required");
    return;
  }

  const token = instId.split("-")[0] as Address;
  const orderBook = engine.getOrderBook(token);
  const trades = orderBook.getTrades(limit);

  sendOkxJson(res, trades.map(t => ({
    instId,
    tradeId: t.id,
    px: t.price.toString(),
    sz: t.size.toString(),
    side: t.side,
    ts: t.timestamp,
  })));
});

// Candles/K-lines (OKX format)
addRoute("GET", "/api/v1/market/candles", async (req, res) => {
  const { query } = parseUrl(req.url || "", true);
  const instId = query.instId as string;
  const bar = (query.bar as string) || "1m";
  const limit = parseInt(query.limit as string) || 200;

  if (!instId) {
    sendOkxError(res, "instId required");
    return;
  }

  const token = instId.split("-")[0] as Address;
  const result = await handlers.handleGetPerpKlines(token, bar, limit);

  // OKX format: [ts, open, high, low, close, vol, volCcy, volCcyQuote, confirm]
  sendOkxJson(res, result.klines.map(k => [
    k.timestamp.toString(),
    k.open,
    k.high,
    k.low,
    k.close,
    k.volume,
    "0", // volCcy
    "0", // volCcyQuote
    "1", // confirm
  ]));
});

// Mark price
addRoute("GET", "/api/v1/market/mark-price", async (req, res) => {
  const { query } = parseUrl(req.url || "", true);
  const instId = query.instId as string;

  const tokens = instId ? [instId.split("-")[0] as Address] : SUPPORTED_TOKENS;
  const markPrices = [];

  for (const token of tokens) {
    const orderBook = engine.getOrderBook(token);
    const depth = orderBook.getDepth(1);
    markPrices.push({
      instId: `${token}-USDT`,
      instType: "SWAP",
      markPx: depth.lastPrice.toString(),
      ts: Date.now(),
    });
  }

  sendOkxJson(res, markPrices);
});

// Funding rate
addRoute("GET", "/api/v1/market/funding-rate", async (req, res) => {
  const { query } = parseUrl(req.url || "", true);
  const instId = query.instId as string;

  if (!instId) {
    sendOkxError(res, "instId required");
    return;
  }

  const token = instId.split("-")[0] as Address;
  const result = await handlers.handleGetFundingRate(token);

  if (result.success && result.data) {
    sendOkxJson(res, [{
      instId,
      instType: "SWAP",
      fundingRate: result.data.currentRate?.toString() || "0",
      nextFundingRate: result.data.predictedRate?.toString() || "0",
      fundingTime: (result.data.nextFundingTime || Date.now() + 3600000).toString(),
      ts: Date.now(),
    }]);
  } else {
    sendOkxJson(res, [{
      instId,
      instType: "SWAP",
      fundingRate: "0",
      nextFundingRate: "0",
      fundingTime: (Date.now() + 3600000).toString(),
      ts: Date.now(),
    }]);
  }
});

// ============================================================
// Token Lifecycle Routes
// ============================================================

// Get token parameters (max leverage, fees based on heat)
addRoute("GET", "/api/token/:token/params", async (req, res, params) => {
  const result = handlers.handleGetTokenParams(params.token as Address);
  sendJson(res, result);
});

// Get token lifecycle info
addRoute("GET", "/api/token/:token/lifecycle", async (req, res, params) => {
  const result = handlers.handleGetTokenLifecycle(params.token as Address);
  sendJson(res, result);
});

// Get all token lifecycles
addRoute("GET", "/api/tokens/lifecycles", async (req, res) => {
  const result = handlers.handleGetAllTokenLifecycles();
  sendJson(res, result);
});

// Get lifecycle stats
addRoute("GET", "/api/tokens/lifecycle-stats", async (req, res) => {
  const result = handlers.handleGetLifecycleStats();
  sendJson(res, result);
});

// ============================================================
// FOMO Routes
// ============================================================

// Get recent FOMO events (large trades, liquidations, big wins)
addRoute("GET", "/api/fomo/events", async (req, res) => {
  const { query } = parseUrl(req.url || "", true);
  const limit = parseInt(query.limit as string) || 20;
  const result = handlers.handleGetFomoEvents(limit);
  sendJson(res, result);
});

// Get global leaderboard
addRoute("GET", "/api/leaderboard/global", async (req, res) => {
  const { query } = parseUrl(req.url || "", true);
  const sortBy = (query.sortBy as "pnl" | "volume" | "wins") || "pnl";
  const limit = parseInt(query.limit as string) || 10;
  const result = handlers.handleGetGlobalLeaderboard(sortBy, limit);
  sendJson(res, result);
});

// Get token leaderboard
addRoute("GET", "/api/leaderboard/token/:token", async (req, res, params) => {
  const { query } = parseUrl(req.url || "", true);
  const sortBy = (query.sortBy as "pnl" | "volume" | "wins") || "pnl";
  const limit = parseInt(query.limit as string) || 10;
  const result = handlers.handleGetTokenLeaderboard(params.token as Address, sortBy, limit);
  sendJson(res, result);
});

// Get trader stats
addRoute("GET", "/api/trader/:trader/stats", async (req, res, params) => {
  const result = handlers.handleGetTraderStats(params.trader as Address);
  sendJson(res, result);
});

// ============================================================
// Spot Trading API (for TokenPriceChart compatibility)
// ============================================================

// 获取现货交易历史
addRoute("GET", "/api/v1/spot/trades/:token", async (req, res, params) => {
  const { query } = parseUrl(req.url || "", true);
  const limit = parseInt(query.limit as string) || 100;
  const result = await handlers.handleGetSpotTrades(params.token as Address, limit);
  sendJson(res, result);
});

// 获取现货 K 线数据
addRoute("GET", "/api/v1/spot/klines/latest/:token", async (req, res, params) => {
  const { query } = parseUrl(req.url || "", true);
  const resolution = (query.resolution as string) || "1m";
  const limit = parseInt(query.limit as string) || 200;
  const result = await handlers.handleGetLatestKlines(params.token as Address, resolution, limit);
  sendJson(res, result);
});

// 获取现货最新价格
addRoute("GET", "/api/v1/spot/price/:token", async (req, res, params) => {
  const result = await handlers.handleGetSpotPrice(params.token as Address);
  sendJson(res, result);
});

// ============================================================
// Token Holders Routes
// ============================================================

// 获取代币持仓分布
addRoute("GET", "/api/v1/spot/holders/:token", async (req, res, params) => {
  const { query } = parseUrl(req.url || "", true);
  const limit = parseInt(query.limit as string) || 10;
  const includePnl = query.includePnl === "true";
  const result = await handlers.handleGetTokenHolders(params.token as Address, limit, includePnl);
  if (result.success && result.data) {
    sendJson(res, result.data);
  } else {
    sendJson(res, {
      success: false,
      holders: [],
      total_holders: 0,
      top10_percentage: 0,
      concentration_risk: "LOW",
      error: result.error,
    });
  }
});

export default { handleRequest };
