/**
 * WebSocket 服务器
 *
 * P1: TLS 由反向代理 (Nginx) 终止，不在应用层实现。
 * 生产部署必须配置 Nginx → wss:// 反向代理到此 ws:// 服务器。
 * 参考: deployment/nginx.conf
 */

import { WebSocketServer, WebSocket } from "ws";
import type { IncomingMessage } from "http";
import type { Server } from "http";
import { logger } from "../utils/logger";
import { initClient, removeClient, handleMessage, wsClients } from "./handlers";

let wss: WebSocketServer | null = null;

// P3-74: Connection limits
const MAX_CONNECTIONS = parseInt(process.env.WS_MAX_CONNECTIONS || "10000");
const MAX_CONNECTIONS_PER_IP = parseInt(process.env.WS_MAX_PER_IP || "50");
const ipConnectionCount = new Map<string, number>();

/**
 * 创建 WebSocket 服务器
 */
export function createWebSocketServer(server: Server): WebSocketServer {
  // P1: 生产环境提示 — 确保前端有 Nginx/TLS 反向代理
  if (process.env.NODE_ENV === "production") {
    logger.info("WebSocket", "Production mode: ensure Nginx TLS reverse proxy is configured for wss://");
  }

  wss = new WebSocketServer({ server });

  wss.on("connection", (ws: WebSocket, req: IncomingMessage) => {
    const clientIp = req.headers["x-forwarded-for"]?.toString().split(",")[0]?.trim() || req.socket.remoteAddress || "unknown";

    // P3-74: Enforce connection limits
    if (wss!.clients.size >= MAX_CONNECTIONS) {
      logger.warn("WebSocket", `Max connections (${MAX_CONNECTIONS}) reached, rejecting ${clientIp}`);
      ws.close(1013, "Max connections reached");
      return;
    }
    const ipCount = ipConnectionCount.get(clientIp) || 0;
    if (ipCount >= MAX_CONNECTIONS_PER_IP) {
      logger.warn("WebSocket", `IP ${clientIp} exceeded per-IP limit (${MAX_CONNECTIONS_PER_IP})`);
      ws.close(1013, "Too many connections from your IP");
      return;
    }
    ipConnectionCount.set(clientIp, ipCount + 1);

    logger.info("WebSocket", `Client connected from ${clientIp} (total: ${wss!.clients.size})`);

    initClient(ws);

    // P3-75: Simple message rate limiting (token bucket)
    let messageTokens = 20; // max burst
    const MESSAGE_RATE = 10; // messages per second
    const tokenRefill = setInterval(() => {
      messageTokens = Math.min(messageTokens + MESSAGE_RATE, 20);
    }, 1000);

    ws.on("message", (data: Buffer) => {
      if (messageTokens <= 0) {
        ws.send(JSON.stringify({ type: "error", data: { message: "Rate limited, slow down" } }));
        return;
      }
      messageTokens--;
      const message = data.toString();
      handleMessage(ws, message);
    });

    ws.on("close", () => {
      clearInterval(tokenRefill);
      logger.info("WebSocket", `Client disconnected from ${clientIp}`);
      removeClient(ws);
      // P3-74: Decrement IP connection count
      const count = ipConnectionCount.get(clientIp) || 1;
      if (count <= 1) {
        ipConnectionCount.delete(clientIp);
      } else {
        ipConnectionCount.set(clientIp, count - 1);
      }
    });

    ws.on("error", (error) => {
      logger.error("WebSocket", `Client error from ${clientIp}:`, error);
      removeClient(ws);
    });

    // 发送连接确认
    ws.send(JSON.stringify({
      type: "connected",
      data: { message: "Connected to MemePerp Matching Engine" },
      timestamp: Date.now(),
    }));
  });

  wss.on("error", (error) => {
    logger.error("WebSocket", "Server error:", error);
  });

  logger.info("WebSocket", "WebSocket server initialized");

  return wss;
}

/**
 * 获取 WebSocket 服务器实例
 */
export function getWebSocketServer(): WebSocketServer | null {
  return wss;
}

/**
 * 获取连接数
 */
export function getConnectionCount(): number {
  return wsClients.size;
}

/**
 * 广播消息给所有客户端
 */
export function broadcastAll(message: unknown): void {
  if (!wss) return;

  const messageStr = JSON.stringify(message);

  for (const client of wss.clients) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(messageStr);
    }
  }
}

/**
 * 关闭 WebSocket 服务器
 */
export function closeWebSocketServer(): Promise<void> {
  return new Promise((resolve) => {
    if (wss) {
      wss.close(() => {
        logger.info("WebSocket", "WebSocket server closed");
        wss = null;
        resolve();
      });
    } else {
      resolve();
    }
  });
}

export default {
  createWebSocketServer,
  getWebSocketServer,
  getConnectionCount,
  broadcastAll,
  closeWebSocketServer,
};
