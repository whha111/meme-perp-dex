/**
 * WebSocket 协议测试
 * 测试 WebSocket 消息格式、连接生命周期、ping/pong
 * 不依赖撮合引擎模块，独立测试协议层
 */

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { createServer, type Server as HttpServer } from "http";
import { WebSocket, WebSocketServer } from "ws";

// ============================================================
// Standalone WS server for protocol testing
// ============================================================

let httpServer: HttpServer;
let wss: WebSocketServer;
let serverPort: number;

// Client state tracking (mirrors handlers.ts pattern)
const clients = new Map<WebSocket, { tokens: Set<string>; risk: boolean }>();

function setupTestServer(): Promise<void> {
  return new Promise((resolve) => {
    httpServer = createServer();
    wss = new WebSocketServer({ server: httpServer });

    wss.on("connection", (ws) => {
      clients.set(ws, { tokens: new Set(), risk: false });

      ws.send(JSON.stringify({
        type: "connected",
        data: { message: "Connected to MemePerp Matching Engine" },
        timestamp: Date.now(),
      }));

      ws.on("message", (raw: Buffer) => {
        try {
          const msg = JSON.parse(raw.toString());
          switch (msg.type) {
            case "ping":
              ws.send(JSON.stringify({ type: "pong", timestamp: Date.now() }));
              break;
            case "subscribe":
            case "subscribe_token":
            case "subscribe_orderbook":
              if (msg.token) clients.get(ws)!.tokens.add(msg.token);
              ws.send(JSON.stringify({ type: "subscribed", token: msg.token, timestamp: Date.now() }));
              break;
            case "unsubscribe":
            case "unsubscribe_token":
            case "unsubscribe_orderbook":
              if (msg.token) clients.get(ws)!.tokens.delete(msg.token);
              ws.send(JSON.stringify({ type: "unsubscribed", token: msg.token, timestamp: Date.now() }));
              break;
            case "subscribe_risk":
            case "subscribe_global_risk":
              clients.get(ws)!.risk = true;
              ws.send(JSON.stringify({ type: "subscribed_risk", timestamp: Date.now() }));
              break;
            case "unsubscribe_risk":
              clients.get(ws)!.risk = false;
              ws.send(JSON.stringify({ type: "unsubscribed_risk", timestamp: Date.now() }));
              break;
            default:
              ws.send(JSON.stringify({ type: "error", message: `Unknown type: ${msg.type}`, timestamp: Date.now() }));
          }
        } catch {
          ws.send(JSON.stringify({ type: "error", message: "Invalid JSON", timestamp: Date.now() }));
        }
      });

      ws.on("close", () => clients.delete(ws));
    });

    httpServer.listen(0, () => {
      const addr = httpServer.address();
      serverPort = typeof addr === "object" && addr ? addr.port : 0;
      resolve();
    });
  });
}

function connectClient(): Promise<{ ws: WebSocket; messages: any[] }> {
  return new Promise((resolve) => {
    const ws = new WebSocket(`ws://localhost:${serverPort}`);
    const messages: any[] = [];
    ws.on("message", (data) => {
      messages.push(JSON.parse(data.toString()));
    });
    ws.on("open", () => {
      // Wait for "connected" message
      setTimeout(() => resolve({ ws, messages }), 50);
    });
  });
}

function sendAndWait(ws: WebSocket, msg: object, messages: any[], expectedType: string): Promise<any> {
  const countBefore = messages.length;
  ws.send(JSON.stringify(msg));
  return new Promise((resolve) => {
    const check = () => {
      const newMsg = messages.slice(countBefore).find((m) => m.type === expectedType);
      if (newMsg) return resolve(newMsg);
      setTimeout(check, 10);
    };
    check();
  });
}

// ============================================================
// Tests
// ============================================================

beforeAll(async () => {
  await setupTestServer();
});

afterAll((done) => {
  wss.close(() => httpServer.close(() => done()));
});

describe("WebSocket Connection Lifecycle", () => {
  test("client receives 'connected' message on connect", async () => {
    const { ws, messages } = await connectClient();
    expect(messages.length).toBeGreaterThanOrEqual(1);
    expect(messages[0].type).toBe("connected");
    expect(messages[0].data.message).toContain("MemePerp");
    expect(messages[0].timestamp).toBeDefined();
    ws.close();
  });

  test("server cleans up client on disconnect", async () => {
    const { ws } = await connectClient();
    const countBefore = clients.size;
    ws.close();
    await new Promise((r) => setTimeout(r, 100));
    expect(clients.size).toBe(countBefore - 1);
  });
});

describe("Ping/Pong Heartbeat", () => {
  test("ping returns pong with timestamp", async () => {
    const { ws, messages } = await connectClient();
    const pong = await sendAndWait(ws, { type: "ping" }, messages, "pong");
    expect(pong.type).toBe("pong");
    expect(pong.timestamp).toBeDefined();
    expect(typeof pong.timestamp).toBe("number");
    ws.close();
  });
});

describe("Token Subscription", () => {
  const TOKEN = "0xcafecafecafecafecafecafecafecafecafecafe";

  test("subscribe_token adds subscription", async () => {
    const { ws, messages } = await connectClient();
    const resp = await sendAndWait(ws, { type: "subscribe_token", token: TOKEN }, messages, "subscribed");
    expect(resp.token).toBe(TOKEN);
    ws.close();
  });

  test("subscribe (compat) also works", async () => {
    const { ws, messages } = await connectClient();
    const resp = await sendAndWait(ws, { type: "subscribe", channel: "orderbook", token: TOKEN }, messages, "subscribed");
    expect(resp.token).toBe(TOKEN);
    ws.close();
  });

  test("unsubscribe_token removes subscription", async () => {
    const { ws, messages } = await connectClient();
    await sendAndWait(ws, { type: "subscribe_token", token: TOKEN }, messages, "subscribed");
    const resp = await sendAndWait(ws, { type: "unsubscribe_token", token: TOKEN }, messages, "unsubscribed");
    expect(resp.token).toBe(TOKEN);
    ws.close();
  });
});

describe("Risk Subscription", () => {
  test("subscribe_risk enables risk data", async () => {
    const { ws, messages } = await connectClient();
    const resp = await sendAndWait(ws, { type: "subscribe_risk" }, messages, "subscribed_risk");
    expect(resp.type).toBe("subscribed_risk");
    ws.close();
  });

  test("unsubscribe_risk disables risk data", async () => {
    const { ws, messages } = await connectClient();
    await sendAndWait(ws, { type: "subscribe_risk" }, messages, "subscribed_risk");
    const resp = await sendAndWait(ws, { type: "unsubscribe_risk" }, messages, "unsubscribed_risk");
    expect(resp.type).toBe("unsubscribed_risk");
    ws.close();
  });

  test("subscribe_global_risk alias works", async () => {
    const { ws, messages } = await connectClient();
    const resp = await sendAndWait(ws, { type: "subscribe_global_risk" }, messages, "subscribed_risk");
    expect(resp.type).toBe("subscribed_risk");
    ws.close();
  });
});

describe("Error Handling", () => {
  test("invalid JSON returns error", async () => {
    const { ws, messages } = await connectClient();
    const countBefore = messages.length;
    ws.send("not-json{{{");
    await new Promise((r) => setTimeout(r, 100));
    const errorMsg = messages.slice(countBefore).find((m) => m.type === "error");
    expect(errorMsg).toBeDefined();
    expect(errorMsg.message).toContain("Invalid JSON");
    ws.close();
  });

  test("unknown message type returns error", async () => {
    const { ws, messages } = await connectClient();
    const resp = await sendAndWait(ws, { type: "nonexistent_type" }, messages, "error");
    expect(resp.message).toContain("Unknown type");
    ws.close();
  });
});
