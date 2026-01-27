# MEME Perp DEX 后端对接文档

## 目录
1. [项目结构](#一项目结构)
2. [快速开始](#二快速开始)
3. [API 接口对接](#三api-接口对接)
4. [WebSocket 对接](#四websocket-对接)
5. [认证机制](#五认证机制)
6. [数据模型](#六数据模型)
7. [错误处理](#七错误处理)
8. [前端集成示例](#八前端集成示例)

---

## 一、项目结构

```
backend/
├── cmd/
│   ├── api/main.go          # API 服务入口
│   ├── indexer/main.go      # 链上索引服务入口
│   └── keeper/main.go       # Keeper 机器人入口
├── configs/
│   └── config.yaml          # 配置文件
├── internal/
│   ├── api/
│   │   ├── handler/         # HTTP 处理器
│   │   ├── middleware/      # 中间件（认证、限流、日志）
│   │   ├── response/        # 响应格式
│   │   └── router.go        # 路由配置
│   ├── service/             # 业务逻辑层
│   ├── repository/          # 数据访问层
│   ├── model/               # 数据模型
│   ├── indexer/             # 链上事件索引
│   ├── keeper/              # 自动化服务（清算、资金费率、订单）
│   ├── ws/                  # WebSocket 管理
│   └── pkg/                 # 公共包
│       ├── config/          # 配置管理
│       ├── database/        # 数据库连接
│       └── errors/          # 错误定义
└── go.mod
```

---

## 二、快速开始

### 2.1 环境要求

- Go 1.22+
- PostgreSQL 16+
- Redis 7+

### 2.2 配置

创建 `configs/config.yaml`：

```yaml
server:
  addr: ":8080"
  mode: "debug"

database:
  host: "localhost"
  port: 5432
  user: "postgres"
  password: "postgres"
  dbname: "memeperp"
  sslmode: "disable"

redis:
  addr: "localhost:6379"
  password: ""
  db: 0

blockchain:
  rpc_url: "https://data-seed-prebsc-1-s1.binance.org:8545/"
  chain_id: 97
  # 填入部署的合约地址
  router_address: ""
  vault_address: ""
  amm_address: ""
```

### 2.3 启动服务

```bash
# 启动 API 服务
cd backend
go run cmd/api/main.go

# 启动 Indexer（另一个终端）
go run cmd/indexer/main.go

# 启动 Keeper（另一个终端）
go run cmd/keeper/main.go
```

### 2.4 服务说明

| 服务 | 端口 | 说明 |
|------|------|------|
| API Server | 8080 | HTTP REST API + WebSocket |
| Indexer | - | 监听链上事件，同步到数据库 |
| Keeper | - | 清算、资金费率结算、止盈止损执行 |

---

## 三、API 接口对接

### 3.1 基础信息

| 项目 | 值 |
|------|-----|
| 基础 URL | `http://localhost:8080/api/v1` |
| 数据格式 | JSON |
| 时间格式 | Unix 毫秒时间戳 |

### 3.2 公共接口（无需认证）

#### 获取合约信息
```http
GET /api/v1/public/instruments?instType=PERP
```

响应：
```json
{
  "code": 0,
  "msg": "success",
  "data": [{
    "instId": "MEME-BNB-PERP",
    "instType": "PERP",
    "baseCcy": "MEME",
    "quoteCcy": "BNB",
    "maxLever": 100,
    "state": "live"
  }]
}
```

#### 获取 Ticker
```http
GET /api/v1/market/ticker?instId=MEME-BNB-PERP
```

#### 获取 K 线
```http
GET /api/v1/market/candles?instId=MEME-BNB-PERP&bar=1m&limit=100
```

参数：
- `instId`: 合约ID（必填）
- `bar`: 时间周期，可选值: 1m, 5m, 15m, 30m, 1H, 4H, 1D
- `limit`: 返回数量，默认 100，最大 500

#### 获取标记价格
```http
GET /api/v1/market/mark-price?instId=MEME-BNB-PERP
```

#### 获取资金费率
```http
GET /api/v1/market/funding-rate?instId=MEME-BNB-PERP
```

### 3.3 私有接口（需要认证）

#### 获取账户余额
```http
GET /api/v1/account/balance
Headers:
  X-MBX-APIKEY: {apiKey}
  X-MBX-SIGNATURE: {signature}
  X-MBX-TIMESTAMP: {timestamp}
```

响应：
```json
{
  "code": 0,
  "msg": "success",
  "data": {
    "totalEq": "10.5",
    "availBal": "9.5",
    "frozenBal": "1",
    "upl": "0.5",
    "details": [{
      "ccy": "BNB",
      "eq": "10.5",
      "availBal": "9.5"
    }]
  }
}
```

#### 获取持仓
```http
GET /api/v1/account/positions?instId=MEME-BNB-PERP
```

#### 设置杠杆
```http
POST /api/v1/account/set-leverage
Content-Type: application/json

{
  "instId": "MEME-BNB-PERP",
  "lever": "50",
  "mgnMode": "cross"
}
```

#### 下单
```http
POST /api/v1/trade/order
Content-Type: application/json

{
  "instId": "MEME-BNB-PERP",
  "tdMode": "cross",
  "side": "buy",
  "posSide": "long",
  "ordType": "market",
  "sz": "1000000",
  "lever": 50
}
```

参数说明：
| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| instId | string | 是 | 合约ID |
| tdMode | string | 是 | cross(全仓) / isolated(逐仓) |
| side | string | 是 | buy / sell |
| posSide | string | 是 | long / short |
| ordType | string | 是 | market / limit / post_only |
| sz | string | 是 | 数量 |
| px | string | 条件 | 限价单价格 |
| lever | int | 否 | 杠杆倍数 |
| reduceOnly | bool | 否 | 是否只减仓 |
| tpTriggerPx | string | 否 | 止盈触发价 |
| slTriggerPx | string | 否 | 止损触发价 |

响应：
```json
{
  "code": 0,
  "msg": "success",
  "data": {
    "ordId": "ORD1705651200000",
    "clOrdId": "",
    "sCode": "0",
    "sMsg": ""
  }
}
```

#### 撤单
```http
POST /api/v1/trade/cancel-order
Content-Type: application/json

{
  "instId": "MEME-BNB-PERP",
  "ordId": "ORD1705651200000"
}
```

#### 平仓
```http
POST /api/v1/trade/close-position
Content-Type: application/json

{
  "instId": "MEME-BNB-PERP",
  "posSide": "long",
  "mgnMode": "cross"
}
```

#### 设置止盈止损
```http
POST /api/v1/trade/order-algo
Content-Type: application/json

{
  "instId": "MEME-BNB-PERP",
  "tdMode": "cross",
  "side": "sell",
  "posSide": "long",
  "ordType": "conditional",
  "sz": "1000000",
  "tpTriggerPx": "0.00000006",
  "tpOrdPx": "-1",
  "slTriggerPx": "0.00000004",
  "slOrdPx": "-1"
}
```

---

## 四、WebSocket 对接

### 4.1 连接地址

| 类型 | URL |
|------|-----|
| 公共频道 | `ws://localhost:8080/ws/v1/public` |
| 私有频道 | `ws://localhost:8080/ws/v1/private` |

### 4.2 心跳

每 30 秒发送一次：
```
ping
```
服务端返回：
```
pong
```

### 4.3 订阅公共频道

#### 订阅 Ticker
```json
{
  "op": "subscribe",
  "args": [{"channel": "tickers", "instId": "MEME-BNB-PERP"}]
}
```

推送数据：
```json
{
  "arg": {"channel": "tickers", "instId": "MEME-BNB-PERP"},
  "data": [{
    "instId": "MEME-BNB-PERP",
    "last": "0.00000005",
    "open24h": "0.000000045",
    "high24h": "0.000000055",
    "low24h": "0.000000042",
    "vol24h": "1000000000",
    "ts": "1705651200000"
  }]
}
```

#### 订阅 K 线
```json
{
  "op": "subscribe",
  "args": [{"channel": "candle1m", "instId": "MEME-BNB-PERP"}]
}
```

可选频道：`candle1m`, `candle5m`, `candle15m`, `candle1H`, `candle4H`, `candle1D`

#### 订阅成交
```json
{
  "op": "subscribe",
  "args": [{"channel": "trades", "instId": "MEME-BNB-PERP"}]
}
```

#### 订阅标记价格
```json
{
  "op": "subscribe",
  "args": [{"channel": "mark-price", "instId": "MEME-BNB-PERP"}]
}
```

### 4.4 私有频道（需登录）

#### 登录认证
```json
{
  "op": "login",
  "args": [{
    "apiKey": "your-api-key",
    "timestamp": "1705651200",
    "sign": "calculated-signature"
  }]
}
```

#### 订阅账户变化
```json
{
  "op": "subscribe",
  "args": [{"channel": "account"}]
}
```

#### 订阅持仓变化
```json
{
  "op": "subscribe",
  "args": [{"channel": "positions", "instId": "MEME-BNB-PERP"}]
}
```

#### 订阅订单变化
```json
{
  "op": "subscribe",
  "args": [{"channel": "orders", "instId": "MEME-BNB-PERP"}]
}
```

---

## 五、认证机制

### 5.1 签名算法

```
签名 = HMAC-SHA256(timestamp + method + requestPath + body, secretKey)
签名结果 = Base64(签名)
```

### 5.2 请求头

| Header | 说明 |
|--------|------|
| X-MBX-APIKEY | API Key |
| X-MBX-SIGNATURE | 签名结果 |
| X-MBX-TIMESTAMP | 当前毫秒时间戳 |

### 5.3 前端签名示例 (TypeScript)

```typescript
import CryptoJS from 'crypto-js';

interface AuthHeaders {
  'X-MBX-APIKEY': string;
  'X-MBX-SIGNATURE': string;
  'X-MBX-TIMESTAMP': string;
}

function createSignature(
  apiKey: string,
  apiSecret: string,
  method: string,
  path: string,
  body: string = ''
): AuthHeaders {
  const timestamp = Date.now().toString();
  const message = timestamp + method + path + body;

  const signature = CryptoJS.enc.Base64.stringify(
    CryptoJS.HmacSHA256(message, apiSecret)
  );

  return {
    'X-MBX-APIKEY': apiKey,
    'X-MBX-SIGNATURE': signature,
    'X-MBX-TIMESTAMP': timestamp,
  };
}

// 使用示例
const headers = createSignature(
  'your-api-key',
  'your-api-secret',
  'POST',
  '/api/v1/trade/order',
  JSON.stringify({ instId: 'MEME-BNB-PERP', side: 'buy', sz: '1000' })
);
```

---

## 六、数据模型

### 6.1 订单状态

| 状态 | 说明 |
|------|------|
| live | 等待成交 |
| partially_filled | 部分成交 |
| filled | 完全成交 |
| canceled | 已撤销 |

### 6.2 订单类型

| 类型 | 说明 |
|------|------|
| market | 市价单 |
| limit | 限价单 |
| post_only | 只做 Maker |
| fok | 全部成交或取消 |
| ioc | 立即成交剩余取消 |

### 6.3 数值精度

| 类型 | 精度 | 格式 |
|------|------|------|
| 价格 | 18 位小数 | 字符串 |
| 数量 | 18 位小数 | 字符串 |
| 杠杆 | 整数 | 数字 |
| 时间戳 | 毫秒 | 数字 |

---

## 七、错误处理

### 7.1 响应格式

```json
{
  "code": 51007,
  "msg": "insufficient balance",
  "data": null
}
```

### 7.2 常用错误码

| 错误码 | 说明 |
|--------|------|
| 0 | 成功 |
| 50011 | 频率限制 |
| 50100 | API Key 无效 |
| 50102 | 签名错误 |
| 50103 | 时间戳无效 |
| 51000 | 合约不存在 |
| 51002 | 订单不存在 |
| 51007 | 余额不足 |
| 51010 | 杠杆无效 |
| 52001 | 保证金不足 |
| 53004 | 清算中 |

---

## 八、前端集成示例

### 8.1 API 客户端封装

```typescript
// api/client.ts
import axios, { AxiosInstance } from 'axios';
import CryptoJS from 'crypto-js';

class APIClient {
  private client: AxiosInstance;
  private apiKey: string = '';
  private apiSecret: string = '';

  constructor(baseURL: string) {
    this.client = axios.create({
      baseURL,
      headers: { 'Content-Type': 'application/json' },
    });

    this.client.interceptors.request.use((config) => {
      if (this.apiKey && this.apiSecret) {
        const timestamp = Date.now().toString();
        const method = config.method?.toUpperCase() || 'GET';
        const path = config.url || '';
        const body = config.data ? JSON.stringify(config.data) : '';

        const message = timestamp + method + path + body;
        const signature = CryptoJS.enc.Base64.stringify(
          CryptoJS.HmacSHA256(message, this.apiSecret)
        );

        config.headers['X-MBX-APIKEY'] = this.apiKey;
        config.headers['X-MBX-SIGNATURE'] = signature;
        config.headers['X-MBX-TIMESTAMP'] = timestamp;
      }
      return config;
    });
  }

  setCredentials(apiKey: string, apiSecret: string) {
    this.apiKey = apiKey;
    this.apiSecret = apiSecret;
  }

  // 公共接口
  async getInstruments() {
    const { data } = await this.client.get('/public/instruments');
    return data;
  }

  async getTicker(instId: string) {
    const { data } = await this.client.get('/market/ticker', {
      params: { instId },
    });
    return data;
  }

  async getCandles(instId: string, bar: string, limit: number = 100) {
    const { data } = await this.client.get('/market/candles', {
      params: { instId, bar, limit },
    });
    return data;
  }

  // 私有接口
  async getBalance() {
    const { data } = await this.client.get('/account/balance');
    return data;
  }

  async getPositions(instId?: string) {
    const { data } = await this.client.get('/account/positions', {
      params: { instId },
    });
    return data;
  }

  async placeOrder(params: {
    instId: string;
    tdMode: string;
    side: string;
    posSide: string;
    ordType: string;
    sz: string;
    px?: string;
    lever?: number;
  }) {
    const { data } = await this.client.post('/trade/order', params);
    return data;
  }

  async cancelOrder(instId: string, ordId: string) {
    const { data } = await this.client.post('/trade/cancel-order', {
      instId,
      ordId,
    });
    return data;
  }

  async closePosition(instId: string, posSide: string, mgnMode: string) {
    const { data } = await this.client.post('/trade/close-position', {
      instId,
      posSide,
      mgnMode,
    });
    return data;
  }
}

export const api = new APIClient('http://localhost:8080/api/v1');
```

### 8.2 WebSocket 客户端封装

```typescript
// services/websocket.ts
type MessageHandler = (data: any) => void;

class WebSocketClient {
  private ws: WebSocket | null = null;
  private handlers: Map<string, MessageHandler[]> = new Map();
  private reconnectTimer: number | null = null;

  connect(url: string) {
    this.ws = new WebSocket(url);

    this.ws.onopen = () => {
      console.log('WebSocket connected');
      this.startHeartbeat();
    };

    this.ws.onmessage = (event) => {
      this.handleMessage(event.data);
    };

    this.ws.onclose = () => {
      console.log('WebSocket disconnected');
      this.scheduleReconnect(url);
    };
  }

  private handleMessage(data: string) {
    if (data === 'pong') return;

    try {
      const msg = JSON.parse(data);
      if (msg.arg?.channel) {
        const key = `${msg.arg.channel}:${msg.arg.instId || ''}`;
        this.handlers.get(key)?.forEach((h) => h(msg.data));
      }
    } catch (e) {
      console.error('Failed to parse message:', e);
    }
  }

  subscribe(channel: string, instId: string, handler: MessageHandler) {
    const key = `${channel}:${instId}`;
    if (!this.handlers.has(key)) {
      this.handlers.set(key, []);
    }
    this.handlers.get(key)!.push(handler);

    this.send({
      op: 'subscribe',
      args: [{ channel, instId }],
    });
  }

  unsubscribe(channel: string, instId: string) {
    const key = `${channel}:${instId}`;
    this.handlers.delete(key);

    this.send({
      op: 'unsubscribe',
      args: [{ channel, instId }],
    });
  }

  private send(data: any) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(data));
    }
  }

  private startHeartbeat() {
    setInterval(() => {
      if (this.ws?.readyState === WebSocket.OPEN) {
        this.ws.send('ping');
      }
    }, 30000);
  }

  private scheduleReconnect(url: string) {
    if (this.reconnectTimer) return;
    this.reconnectTimer = window.setTimeout(() => {
      this.reconnectTimer = null;
      this.connect(url);
    }, 3000);
  }

  disconnect() {
    this.ws?.close();
  }
}

export const wsClient = new WebSocketClient();
```

### 8.3 React Hook 示例

```typescript
// hooks/useMarketData.ts
import { useEffect, useState } from 'react';
import { api } from '../api/client';
import { wsClient } from '../services/websocket';

export function useTicker(instId: string) {
  const [ticker, setTicker] = useState<any>(null);

  useEffect(() => {
    // 获取初始数据
    api.getTicker(instId).then((res) => {
      if (res.code === 0) {
        setTicker(res.data[0]);
      }
    });

    // 订阅实时更新
    wsClient.subscribe('tickers', instId, (data) => {
      setTicker(data[0]);
    });

    return () => {
      wsClient.unsubscribe('tickers', instId);
    };
  }, [instId]);

  return ticker;
}

export function useCandles(instId: string, bar: string) {
  const [candles, setCandles] = useState<any[]>([]);

  useEffect(() => {
    // 获取历史数据
    api.getCandles(instId, bar, 500).then((res) => {
      if (res.code === 0) {
        setCandles(res.data);
      }
    });

    // 订阅实时更新
    const channel = `candle${bar}`;
    wsClient.subscribe(channel, instId, (data) => {
      setCandles((prev) => {
        const newCandle = data[0];
        const lastIndex = prev.length - 1;
        if (prev[lastIndex]?.[0] === newCandle[0]) {
          // 更新最后一根 K 线
          return [...prev.slice(0, lastIndex), newCandle];
        }
        // 新增 K 线
        return [...prev, newCandle];
      });
    });

    return () => {
      wsClient.unsubscribe(channel, instId);
    };
  }, [instId, bar]);

  return candles;
}
```

---

## 附录：Makefile 命令

```makefile
# 安装依赖
make install-backend

# 运行 API 服务
make dev-backend

# 构建
make build-backend

# 运行测试
make test-backend

# 数据库迁移
make db-migrate
```

---

**文档版本**: v1.0
**更新日期**: 2025-01-19
