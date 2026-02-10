/**
 * WebSocket 服务器
 */

import { WebSocketServer, WebSocket } from "ws";
import type { IncomingMessage } from "http";
import type { Server } from "http";
import { logger } from "../utils/logger";
import { initClient, removeClient, handleMessage, wsClients } from "./handlers";

let wss: WebSocketServer | null = null;

/**
 * 创建 WebSocket 服务器
 */
export function createWebSocketServer(server: Server): WebSocketServer {
  wss = new WebSocketServer({ server });

  wss.on("connection", (ws: WebSocket, req: IncomingMessage) => {
    const clientIp = req.socket.remoteAddress || "unknown";
    logger.info("WebSocket", `Client connected from ${clientIp}`);

    initClient(ws);

    ws.on("message", (data: Buffer) => {
      const message = data.toString();
      handleMessage(ws, message);
    });

    ws.on("close", () => {
      logger.info("WebSocket", `Client disconnected from ${clientIp}`);
      removeClient(ws);
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
