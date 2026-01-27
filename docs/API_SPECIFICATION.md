# API 规范文档

> 参考 Binance Futures API 和 OKX API v5 设计规范

## 目录
1. [通用规范](#一通用规范)
2. [认证机制](#二认证机制)
3. [市场数据 API](#三市场数据-api)
4. [交易 API](#四交易-api)
5. [账户 API](#五账户-api)
6. [WebSocket API](#六websocket-api)
7. [数据库设计](#七数据库设计)
8. [错误码规范](#八错误码规范)

---

## 一、通用规范

### 1.1 基础信息

| 项目 | 规范 |
|------|------|
| 基础 URL | `https://api.memeperp.io` |
| API 版本 | `/api/v1` |
| 协议 | HTTPS |
| 数据格式 | JSON |
| 字符编码 | UTF-8 |
| 时间格式 | Unix 时间戳（毫秒） |

### 1.2 请求格式

**HTTP 方法**
| 方法 | 用途 |
|------|------|
| GET | 查询数据 |
| POST | 创建/提交 |
| PUT | 更新 |
| DELETE | 删除/取消 |

**请求头**
```
Content-Type: application/json
Accept: application/json
X-MBX-APIKEY: {apiKey}           // API Key（私有接口）
X-MBX-SIGNATURE: {signature}     // 签名（私有接口）
X-MBX-TIMESTAMP: {timestamp}     // 时间戳（毫秒）
```

### 1.3 响应格式

**成功响应**
```json
{
    "code": 0,
    "msg": "success",
    "data": { ... }
}
```

**错误响应**
```json
{
    "code": 10001,
    "msg": "Invalid parameter",
    "data": null
}
```

**分页响应**
```json
{
    "code": 0,
    "msg": "success",
    "data": {
        "list": [ ... ],
        "total": 1000,
        "page": 1,
        "pageSize": 20
    }
}
```

### 1.4 字段命名规范

**采用驼峰命名法（camelCase）**，参考 Binance/OKX 缩写风格：

| 字段 | 含义 | 示例 |
|------|------|------|
| `symbol` | 交易对 | "MEME-BNB" |
| `instId` | 合约标识 | "MEME-BNB-PERP" |
| `px` | 价格 (price) | "0.00000005" |
| `sz` | 数量 (size) | "1000000" |
| `side` | 方向 | "buy" / "sell" |
| `posSide` | 持仓方向 | "long" / "short" |
| `ordType` | 订单类型 | "limit" / "market" |
| `tif` | 有效期 | "GTC" / "IOC" / "FOK" |
| `lever` | 杠杆 | 100 |
| `mgn` | 保证金 (margin) | "1.5" |
| `pnl` | 盈亏 | "-0.05" |
| `uPnl` | 未实现盈亏 | "0.12" |
| `ts` | 时间戳 | 1705651200000 |
| `cTime` | 创建时间 | 1705651200000 |
| `uTime` | 更新时间 | 1705651200000 |

### 1.5 数值精度

| 类型 | 精度 | 说明 |
|------|------|------|
| 价格 | 18 位小数 | 字符串格式 |
| 数量 | 18 位小数 | 字符串格式 |
| 比率 | 8 位小数 | 如资金费率 |
| 杠杆 | 整数 | 1-100 |
| 时间戳 | 毫秒 | 13 位数字 |

### 1.6 频率限制

| 接口类型 | 限制 | 窗口 |
|----------|------|------|
| 公共接口 | 1200 次 | 1 分钟 |
| 私有接口 | 600 次 | 1 分钟 |
| 下单接口 | 300 次 | 1 分钟 |
| WebSocket | 5 连接 | 每 IP |

---

## 二、认证机制

### 2.1 签名算法

```
签名 = HMAC-SHA256(timestamp + method + requestPath + body, secretKey)
签名结果 = Base64(签名)
```

**示例**
```javascript
const timestamp = Date.now().toString();
const method = 'POST';
const requestPath = '/api/v1/trade/order';
const body = JSON.stringify({ symbol: 'MEME-BNB', side: 'buy', sz: '1000' });

const message = timestamp + method + requestPath + body;
const signature = crypto
    .createHmac('sha256', secretKey)
    .update(message)
    .digest('base64');
```

### 2.2 请求示例

```bash
curl -X POST 'https://api.memeperp.io/api/v1/trade/order' \
  -H 'Content-Type: application/json' \
  -H 'X-MBX-APIKEY: your-api-key' \
  -H 'X-MBX-SIGNATURE: calculated-signature' \
  -H 'X-MBX-TIMESTAMP: 1705651200000' \
  -d '{"symbol":"MEME-BNB","side":"buy","sz":"1000"}'
```

---

## 三、市场数据 API

### 3.1 获取交易对信息

**GET /api/v1/public/instruments**

获取所有可交易的合约信息。

**请求参数**
| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| instType | String | 否 | 合约类型：SPOT, PERP |

**响应示例**
```json
{
    "code": 0,
    "msg": "success",
    "data": [
        {
            "instId": "MEME-BNB-PERP",
            "instType": "PERP",
            "baseCcy": "MEME",
            "quoteCcy": "BNB",
            "settleCcy": "BNB",
            "ctVal": "1",
            "ctMult": "1",
            "ctValCcy": "MEME",
            "tickSz": "0.000000001",
            "lotSz": "1",
            "minSz": "1",
            "maxLever": "100",
            "state": "live",
            "listTime": "1705651200000"
        }
    ]
}
```

---

### 3.2 获取行情 Ticker

**GET /api/v1/market/ticker**

获取单个或所有交易对的最新行情。

**请求参数**
| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| instId | String | 否 | 合约ID，不传返回所有 |

**响应示例**
```json
{
    "code": 0,
    "msg": "success",
    "data": [
        {
            "instId": "MEME-BNB-PERP",
            "last": "0.00000005",
            "lastSz": "100000",
            "askPx": "0.000000051",
            "askSz": "5000000",
            "bidPx": "0.000000049",
            "bidSz": "3000000",
            "open24h": "0.000000045",
            "high24h": "0.000000055",
            "low24h": "0.000000042",
            "volCcy24h": "50",
            "vol24h": "1000000000",
            "sodUtc0": "0.000000048",
            "sodUtc8": "0.000000047",
            "ts": "1705651200000"
        }
    ]
}
```

**字段说明**
| 字段 | 说明 |
|------|------|
| last | 最新成交价 |
| lastSz | 最新成交量 |
| askPx | 卖一价 |
| askSz | 卖一量 |
| bidPx | 买一价 |
| bidSz | 买一量 |
| open24h | 24小时开盘价 |
| high24h | 24小时最高价 |
| low24h | 24小时最低价 |
| volCcy24h | 24小时成交额（BNB）|
| vol24h | 24小时成交量（MEME）|
| sodUtc0 | UTC 0点开盘价 |
| sodUtc8 | UTC+8 0点开盘价 |
| ts | 数据时间戳 |

---

### 3.3 获取 K 线数据

**GET /api/v1/market/candles**

获取K线/蜡烛图数据。

**请求参数**
| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| instId | String | 是 | 合约ID |
| bar | String | 否 | 时间粒度，默认 1m |
| after | String | 否 | 请求此时间戳之前的数据 |
| before | String | 否 | 请求此时间戳之后的数据 |
| limit | String | 否 | 返回条数，默认100，最大500 |

**时间粒度 bar 可选值**
```
1m, 3m, 5m, 15m, 30m, 1H, 2H, 4H, 6H, 12H, 1D, 1W, 1M
```

**响应示例**
```json
{
    "code": 0,
    "msg": "success",
    "data": [
        {
            "ts": "1705651200000",
            "o": "0.000000050",
            "h": "0.000000052",
            "l": "0.000000048",
            "c": "0.000000051",
            "vol": "100000000",
            "volCcy": "5",
            "volCcyQuote": "5",
            "confirm": "1"
        }
    ]
}
```

**字段说明**
| 字段 | 说明 |
|------|------|
| ts | 开盘时间戳 |
| o | 开盘价 (open) |
| h | 最高价 (high) |
| l | 最低价 (low) |
| c | 收盘价 (close) |
| vol | 成交量（张/币） |
| volCcy | 成交量（计价货币） |
| volCcyQuote | 成交额 |
| confirm | 是否已确认（0: 未确认, 1: 已确认） |

---

### 3.4 获取深度数据

**GET /api/v1/market/books**

获取订单簿深度数据。

**请求参数**
| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| instId | String | 是 | 合约ID |
| sz | String | 否 | 深度档位，默认20，最大400 |

**响应示例**
```json
{
    "code": 0,
    "msg": "success",
    "data": {
        "asks": [
            ["0.000000051", "5000000", "0", "3"],
            ["0.000000052", "8000000", "0", "5"]
        ],
        "bids": [
            ["0.000000049", "3000000", "0", "2"],
            ["0.000000048", "6000000", "0", "4"]
        ],
        "ts": "1705651200000"
    }
}
```

**数组字段说明**
```
[价格, 数量, 已废弃, 订单数量]
```

---

### 3.5 获取最近成交

**GET /api/v1/market/trades**

获取最近成交记录。

**请求参数**
| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| instId | String | 是 | 合约ID |
| limit | String | 否 | 返回条数，默认100，最大500 |

**响应示例**
```json
{
    "code": 0,
    "msg": "success",
    "data": [
        {
            "instId": "MEME-BNB-PERP",
            "tradeId": "1234567890",
            "px": "0.000000050",
            "sz": "100000",
            "side": "buy",
            "ts": "1705651200000"
        }
    ]
}
```

---

### 3.6 获取标记价格

**GET /api/v1/market/mark-price**

获取标记价格（用于计算盈亏和清算）。

**请求参数**
| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| instId | String | 否 | 合约ID |

**响应示例**
```json
{
    "code": 0,
    "msg": "success",
    "data": [
        {
            "instId": "MEME-BNB-PERP",
            "instType": "PERP",
            "markPx": "0.000000050",
            "ts": "1705651200000"
        }
    ]
}
```

---

### 3.7 获取资金费率

**GET /api/v1/market/funding-rate**

获取当前资金费率。

**请求参数**
| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| instId | String | 是 | 合约ID |

**响应示例**
```json
{
    "code": 0,
    "msg": "success",
    "data": [
        {
            "instId": "MEME-BNB-PERP",
            "instType": "PERP",
            "fundingRate": "0.0001",
            "nextFundingRate": "0.00015",
            "fundingTime": "1705651200000",
            "nextFundingTime": "1705665600000"
        }
    ]
}
```

---

### 3.8 获取资金费率历史

**GET /api/v1/market/funding-rate-history**

获取历史资金费率。

**请求参数**
| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| instId | String | 是 | 合约ID |
| after | String | 否 | 请求此时间之前的数据 |
| before | String | 否 | 请求此时间之后的数据 |
| limit | String | 否 | 返回条数，默认100 |

**响应示例**
```json
{
    "code": 0,
    "msg": "success",
    "data": [
        {
            "instId": "MEME-BNB-PERP",
            "fundingRate": "0.0001",
            "realizedRate": "0.0001",
            "fundingTime": "1705651200000"
        }
    ]
}
```

---

## 四、交易 API

### 4.1 下单

**POST /api/v1/trade/order**

提交新订单。

**请求参数**
| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| instId | String | 是 | 合约ID |
| tdMode | String | 是 | 交易模式：cross（全仓）, isolated（逐仓） |
| side | String | 是 | 订单方向：buy, sell |
| posSide | String | 是 | 持仓方向：long, short |
| ordType | String | 是 | 订单类型：market, limit, post_only |
| sz | String | 是 | 委托数量 |
| px | String | 条件 | 委托价格（limit 单必填） |
| lever | String | 否 | 杠杆倍数，默认使用当前设置 |
| clOrdId | String | 否 | 客户自定义订单ID |
| reduceOnly | Boolean | 否 | 是否只减仓 |
| tpTriggerPx | String | 否 | 止盈触发价 |
| tpOrdPx | String | 否 | 止盈委托价，-1为市价 |
| slTriggerPx | String | 否 | 止损触发价 |
| slOrdPx | String | 否 | 止损委托价，-1为市价 |

**请求示例**
```json
{
    "instId": "MEME-BNB-PERP",
    "tdMode": "cross",
    "side": "buy",
    "posSide": "long",
    "ordType": "limit",
    "sz": "1000000",
    "px": "0.00000005",
    "lever": "50",
    "clOrdId": "myOrder001"
}
```

**响应示例**
```json
{
    "code": 0,
    "msg": "success",
    "data": {
        "ordId": "1234567890",
        "clOrdId": "myOrder001",
        "sCode": "0",
        "sMsg": ""
    }
}
```

---

### 4.2 撤单

**POST /api/v1/trade/cancel-order**

撤销订单。

**请求参数**
| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| instId | String | 是 | 合约ID |
| ordId | String | 条件 | 订单ID（ordId 和 clOrdId 二选一）|
| clOrdId | String | 条件 | 客户自定义订单ID |

**响应示例**
```json
{
    "code": 0,
    "msg": "success",
    "data": {
        "ordId": "1234567890",
        "clOrdId": "myOrder001",
        "sCode": "0",
        "sMsg": ""
    }
}
```

---

### 4.3 修改订单

**POST /api/v1/trade/amend-order**

修改未成交订单。

**请求参数**
| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| instId | String | 是 | 合约ID |
| ordId | String | 条件 | 订单ID |
| clOrdId | String | 条件 | 客户自定义订单ID |
| newSz | String | 否 | 新数量 |
| newPx | String | 否 | 新价格 |

---

### 4.4 平仓

**POST /api/v1/trade/close-position**

市价全平仓位。

**请求参数**
| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| instId | String | 是 | 合约ID |
| posSide | String | 是 | 持仓方向：long, short |
| mgnMode | String | 是 | 保证金模式：cross, isolated |

**响应示例**
```json
{
    "code": 0,
    "msg": "success",
    "data": {
        "instId": "MEME-BNB-PERP",
        "posSide": "long"
    }
}
```

---

### 4.5 获取订单详情

**GET /api/v1/trade/order**

查询订单详情。

**请求参数**
| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| instId | String | 是 | 合约ID |
| ordId | String | 条件 | 订单ID |
| clOrdId | String | 条件 | 客户自定义订单ID |

**响应示例**
```json
{
    "code": 0,
    "msg": "success",
    "data": {
        "instId": "MEME-BNB-PERP",
        "ordId": "1234567890",
        "clOrdId": "myOrder001",
        "ordType": "limit",
        "side": "buy",
        "posSide": "long",
        "tdMode": "cross",
        "sz": "1000000",
        "px": "0.00000005",
        "avgPx": "0.000000049",
        "accFillSz": "500000",
        "state": "partially_filled",
        "lever": "50",
        "fee": "-0.0001",
        "feeCcy": "BNB",
        "pnl": "0",
        "cTime": "1705651200000",
        "uTime": "1705651300000"
    }
}
```

**订单状态 state**
| 状态 | 说明 |
|------|------|
| live | 等待成交 |
| partially_filled | 部分成交 |
| filled | 完全成交 |
| canceled | 已撤销 |
| mmp_canceled | MMP撤销 |

---

### 4.6 获取未完成订单列表

**GET /api/v1/trade/orders-pending**

获取所有未完成订单。

**请求参数**
| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| instId | String | 否 | 合约ID |
| ordType | String | 否 | 订单类型 |
| state | String | 否 | 订单状态 |
| after | String | 否 | 分页 |
| before | String | 否 | 分页 |
| limit | String | 否 | 返回条数 |

---

### 4.7 获取历史订单

**GET /api/v1/trade/orders-history**

获取最近7天的历史订单。

**请求参数**
| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| instId | String | 是 | 合约ID |
| ordType | String | 否 | 订单类型 |
| state | String | 否 | 订单状态 |
| after | String | 否 | 分页 |
| before | String | 否 | 分页 |
| limit | String | 否 | 返回条数，默认100 |

---

### 4.8 设置止盈止损

**POST /api/v1/trade/order-algo**

设置止盈止损订单。

**请求参数**
| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| instId | String | 是 | 合约ID |
| tdMode | String | 是 | 交易模式 |
| side | String | 是 | 订单方向 |
| posSide | String | 是 | 持仓方向 |
| ordType | String | 是 | 订单类型：conditional, oco, trigger |
| sz | String | 是 | 委托数量 |
| tpTriggerPx | String | 条件 | 止盈触发价 |
| tpOrdPx | String | 条件 | 止盈委托价 |
| slTriggerPx | String | 条件 | 止损触发价 |
| slOrdPx | String | 条件 | 止损委托价 |

---

## 五、账户 API

### 5.1 获取账户余额

**GET /api/v1/account/balance**

获取账户资产余额。

**请求参数**
| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| ccy | String | 否 | 币种，如 BNB |

**响应示例**
```json
{
    "code": 0,
    "msg": "success",
    "data": {
        "totalEq": "10.5",
        "isoEq": "0",
        "adjEq": "10.5",
        "ordFroz": "0.5",
        "imr": "1",
        "mmr": "0.5",
        "mgnRatio": "20",
        "notionalUsd": "5000",
        "uTime": "1705651200000",
        "details": [
            {
                "ccy": "BNB",
                "eq": "10.5",
                "cashBal": "10",
                "uTime": "1705651200000",
                "isoEq": "0",
                "availEq": "9.5",
                "disEq": "10.5",
                "availBal": "9.5",
                "frozenBal": "1",
                "ordFrozen": "0.5",
                "upl": "0.5",
                "uplLiab": "0",
                "crossLiab": "0",
                "isoLiab": "0",
                "mgnRatio": "20",
                "interest": "0",
                "twap": "0",
                "maxLoan": "100",
                "eqUsd": "6000",
                "notionalLever": "5"
            }
        ]
    }
}
```

**字段说明**
| 字段 | 说明 |
|------|------|
| totalEq | 总权益 |
| adjEq | 调整后权益 |
| ordFroz | 挂单冻结 |
| imr | 初始保证金 |
| mmr | 维持保证金 |
| mgnRatio | 保证金率 |
| availEq | 可用权益 |
| availBal | 可用余额 |
| frozenBal | 冻结余额 |
| upl | 未实现盈亏 |

---

### 5.2 获取持仓信息

**GET /api/v1/account/positions**

获取持仓信息。

**请求参数**
| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| instId | String | 否 | 合约ID |
| posId | String | 否 | 持仓ID |

**响应示例**
```json
{
    "code": 0,
    "msg": "success",
    "data": [
        {
            "instId": "MEME-BNB-PERP",
            "instType": "PERP",
            "posId": "pos123456",
            "posSide": "long",
            "pos": "1000000",
            "posCcy": "",
            "availPos": "1000000",
            "avgPx": "0.00000005",
            "upl": "0.05",
            "uplRatio": "0.1",
            "lever": "50",
            "liqPx": "0.000000045",
            "markPx": "0.000000055",
            "imr": "1",
            "margin": "1",
            "mgnRatio": "5.5",
            "mmr": "0.5",
            "interest": "0",
            "tradeId": "trade123",
            "notionalUsd": "5000",
            "adl": "2",
            "cTime": "1705651200000",
            "uTime": "1705651300000"
        }
    ]
}
```

**字段说明**
| 字段 | 说明 |
|------|------|
| posId | 持仓ID |
| posSide | 持仓方向 |
| pos | 持仓数量 |
| availPos | 可平仓数量 |
| avgPx | 开仓均价 |
| upl | 未实现盈亏 |
| uplRatio | 未实现收益率 |
| lever | 杠杆倍数 |
| liqPx | 预估强平价 |
| markPx | 标记价格 |
| imr | 初始保证金 |
| margin | 保证金 |
| mgnRatio | 保证金率 |
| mmr | 维持保证金 |
| adl | 自动减仓指示（1-5） |

---

### 5.3 设置杠杆

**POST /api/v1/account/set-leverage**

设置杠杆倍数。

**请求参数**
| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| instId | String | 是 | 合约ID |
| lever | String | 是 | 杠杆倍数 |
| mgnMode | String | 是 | 保证金模式：cross, isolated |
| posSide | String | 条件 | 持仓方向（逐仓必填） |

---

### 5.4 获取杠杆设置

**GET /api/v1/account/leverage-info**

获取当前杠杆设置。

**请求参数**
| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| instId | String | 是 | 合约ID |
| mgnMode | String | 是 | 保证金模式 |

---

### 5.5 调整保证金

**POST /api/v1/account/position/margin-balance**

增加或减少逐仓保证金。

**请求参数**
| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| instId | String | 是 | 合约ID |
| posSide | String | 是 | 持仓方向 |
| type | String | 是 | 类型：add, reduce |
| amt | String | 是 | 金额 |

---

### 5.6 获取账单流水

**GET /api/v1/account/bills**

获取账户账单。

**请求参数**
| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| instType | String | 否 | 合约类型 |
| ccy | String | 否 | 币种 |
| type | String | 否 | 账单类型 |
| after | String | 否 | 分页 |
| before | String | 否 | 分页 |
| limit | String | 否 | 返回条数 |

**账单类型 type**
| 值 | 说明 |
|---|------|
| 1 | 划转 |
| 2 | 交易 |
| 3 | 强平 |
| 4 | 资金费 |
| 5 | ADL |
| 6 | 清算 |

---

## 六、WebSocket API

### 6.1 连接地址

| 类型 | URL |
|------|-----|
| 公共频道 | wss://ws.memeperp.io/ws/v1/public |
| 私有频道 | wss://ws.memeperp.io/ws/v1/private |

### 6.2 心跳

客户端需要每 30 秒发送 ping，服务端返回 pong。

```json
// 发送
"ping"

// 响应
"pong"
```

### 6.3 订阅格式

```json
{
    "op": "subscribe",
    "args": [
        {
            "channel": "tickers",
            "instId": "MEME-BNB-PERP"
        }
    ]
}
```

### 6.4 取消订阅

```json
{
    "op": "unsubscribe",
    "args": [
        {
            "channel": "tickers",
            "instId": "MEME-BNB-PERP"
        }
    ]
}
```

### 6.5 公共频道

#### Ticker 频道
```json
{
    "op": "subscribe",
    "args": [{ "channel": "tickers", "instId": "MEME-BNB-PERP" }]
}

// 推送数据
{
    "arg": { "channel": "tickers", "instId": "MEME-BNB-PERP" },
    "data": [{
        "instId": "MEME-BNB-PERP",
        "last": "0.00000005",
        "askPx": "0.000000051",
        "bidPx": "0.000000049",
        "vol24h": "1000000000",
        "ts": "1705651200000"
    }]
}
```

#### K 线频道
```json
{
    "op": "subscribe",
    "args": [{ "channel": "candle1m", "instId": "MEME-BNB-PERP" }]
}

// 频道名称: candle1m, candle5m, candle15m, candle1H, candle4H, candle1D

// 推送数据
{
    "arg": { "channel": "candle1m", "instId": "MEME-BNB-PERP" },
    "data": [
        ["1705651200000", "0.00000005", "0.000000052", "0.000000048", "0.000000051", "100000000", "5", "1"]
    ]
}
```

#### 深度频道
```json
{
    "op": "subscribe",
    "args": [{ "channel": "books", "instId": "MEME-BNB-PERP" }]
}

// 增量深度: books
// 全量深度: books5 (5档), books50-l2 (50档)
```

#### 成交频道
```json
{
    "op": "subscribe",
    "args": [{ "channel": "trades", "instId": "MEME-BNB-PERP" }]
}
```

#### 资金费率频道
```json
{
    "op": "subscribe",
    "args": [{ "channel": "funding-rate", "instId": "MEME-BNB-PERP" }]
}
```

#### 标记价格频道
```json
{
    "op": "subscribe",
    "args": [{ "channel": "mark-price", "instId": "MEME-BNB-PERP" }]
}
```

### 6.6 私有频道

需要先登录认证：

```json
{
    "op": "login",
    "args": [{
        "apiKey": "your-api-key",
        "passphrase": "your-passphrase",
        "timestamp": "1705651200",
        "sign": "calculated-signature"
    }]
}
```

#### 账户频道
```json
{
    "op": "subscribe",
    "args": [{ "channel": "account" }]
}
```

#### 持仓频道
```json
{
    "op": "subscribe",
    "args": [{ "channel": "positions", "instId": "MEME-BNB-PERP" }]
}
```

#### 订单频道
```json
{
    "op": "subscribe",
    "args": [{ "channel": "orders", "instId": "MEME-BNB-PERP" }]
}
```

#### 清算频道
```json
{
    "op": "subscribe",
    "args": [{ "channel": "liquidation-warning" }]
}
```

---

## 七、数据库设计

### 7.1 用户表 (users)

```sql
CREATE TABLE users (
    id              BIGSERIAL PRIMARY KEY,
    address         VARCHAR(42) NOT NULL UNIQUE,        -- 钱包地址
    api_key         VARCHAR(64) UNIQUE,                 -- API Key
    api_secret      VARCHAR(128),                       -- API Secret (加密存储)
    referrer_id     BIGINT REFERENCES users(id),        -- 推荐人
    referral_code   VARCHAR(16) UNIQUE,                 -- 推荐码
    fee_tier        SMALLINT DEFAULT 0,                 -- 手续费等级
    created_at      TIMESTAMP DEFAULT NOW(),
    updated_at      TIMESTAMP DEFAULT NOW(),

    INDEX idx_users_address (address),
    INDEX idx_users_referral (referral_code)
);
```

### 7.2 合约信息表 (instruments)

```sql
CREATE TABLE instruments (
    id              BIGSERIAL PRIMARY KEY,
    inst_id         VARCHAR(32) NOT NULL UNIQUE,        -- MEME-BNB-PERP
    inst_type       VARCHAR(16) NOT NULL,               -- PERP, SPOT
    base_ccy        VARCHAR(16) NOT NULL,               -- MEME
    quote_ccy       VARCHAR(16) NOT NULL,               -- BNB
    settle_ccy      VARCHAR(16) NOT NULL,               -- BNB
    ct_val          DECIMAL(36, 18) DEFAULT 1,          -- 合约面值
    tick_sz         DECIMAL(36, 18) NOT NULL,           -- 价格精度
    lot_sz          DECIMAL(36, 18) NOT NULL,           -- 数量精度
    min_sz          DECIMAL(36, 18) NOT NULL,           -- 最小数量
    max_lever       SMALLINT DEFAULT 100,               -- 最大杠杆
    state           VARCHAR(16) DEFAULT 'live',         -- live, suspend
    list_time       BIGINT,                             -- 上架时间
    created_at      TIMESTAMP DEFAULT NOW()
);
```

### 7.3 K 线表 (candles)

```sql
CREATE TABLE candles (
    id              BIGSERIAL PRIMARY KEY,
    inst_id         VARCHAR(32) NOT NULL,
    bar             VARCHAR(8) NOT NULL,                -- 1m, 5m, 1H, etc.
    ts              BIGINT NOT NULL,                    -- 开盘时间戳
    o               DECIMAL(36, 18) NOT NULL,           -- 开盘价
    h               DECIMAL(36, 18) NOT NULL,           -- 最高价
    l               DECIMAL(36, 18) NOT NULL,           -- 最低价
    c               DECIMAL(36, 18) NOT NULL,           -- 收盘价
    vol             DECIMAL(36, 18) NOT NULL,           -- 成交量
    vol_ccy         DECIMAL(36, 18) NOT NULL,           -- 成交额
    confirm         SMALLINT DEFAULT 0,                 -- 是否确认
    created_at      TIMESTAMP DEFAULT NOW(),

    UNIQUE (inst_id, bar, ts),
    INDEX idx_candles_inst_bar_ts (inst_id, bar, ts DESC)
);
```

### 7.4 成交表 (trades)

```sql
CREATE TABLE trades (
    id              BIGSERIAL PRIMARY KEY,
    trade_id        VARCHAR(32) NOT NULL UNIQUE,
    inst_id         VARCHAR(32) NOT NULL,
    px              DECIMAL(36, 18) NOT NULL,           -- 成交价
    sz              DECIMAL(36, 18) NOT NULL,           -- 成交量
    side            VARCHAR(8) NOT NULL,                -- buy, sell
    ts              BIGINT NOT NULL,                    -- 成交时间

    INDEX idx_trades_inst_ts (inst_id, ts DESC)
);
```

### 7.5 订单表 (orders)

```sql
CREATE TABLE orders (
    id              BIGSERIAL PRIMARY KEY,
    ord_id          VARCHAR(32) NOT NULL UNIQUE,        -- 订单ID
    cl_ord_id       VARCHAR(64),                        -- 客户端订单ID
    user_id         BIGINT NOT NULL REFERENCES users(id),
    inst_id         VARCHAR(32) NOT NULL,
    td_mode         VARCHAR(16) NOT NULL,               -- cross, isolated
    side            VARCHAR(8) NOT NULL,                -- buy, sell
    pos_side        VARCHAR(8) NOT NULL,                -- long, short
    ord_type        VARCHAR(16) NOT NULL,               -- market, limit, etc.
    sz              DECIMAL(36, 18) NOT NULL,           -- 委托数量
    px              DECIMAL(36, 18),                    -- 委托价格
    avg_px          DECIMAL(36, 18),                    -- 成交均价
    acc_fill_sz     DECIMAL(36, 18) DEFAULT 0,          -- 累计成交量
    state           VARCHAR(20) NOT NULL,               -- live, filled, canceled
    lever           SMALLINT NOT NULL,                  -- 杠杆
    fee             DECIMAL(36, 18) DEFAULT 0,          -- 手续费
    fee_ccy         VARCHAR(16),                        -- 手续费币种
    pnl             DECIMAL(36, 18) DEFAULT 0,          -- 收益
    reduce_only     BOOLEAN DEFAULT FALSE,
    tp_trigger_px   DECIMAL(36, 18),                    -- 止盈触发价
    sl_trigger_px   DECIMAL(36, 18),                    -- 止损触发价
    c_time          BIGINT NOT NULL,                    -- 创建时间
    u_time          BIGINT NOT NULL,                    -- 更新时间

    INDEX idx_orders_user_state (user_id, state),
    INDEX idx_orders_inst_state (inst_id, state),
    INDEX idx_orders_cl_ord (cl_ord_id)
);
```

### 7.6 持仓表 (positions)

```sql
CREATE TABLE positions (
    id              BIGSERIAL PRIMARY KEY,
    pos_id          VARCHAR(32) NOT NULL UNIQUE,        -- 持仓ID
    user_id         BIGINT NOT NULL REFERENCES users(id),
    inst_id         VARCHAR(32) NOT NULL,
    mgn_mode        VARCHAR(16) NOT NULL,               -- cross, isolated
    pos_side        VARCHAR(8) NOT NULL,                -- long, short
    pos             DECIMAL(36, 18) NOT NULL DEFAULT 0, -- 持仓数量
    avail_pos       DECIMAL(36, 18) NOT NULL DEFAULT 0, -- 可平仓数量
    avg_px          DECIMAL(36, 18),                    -- 开仓均价
    lever           SMALLINT NOT NULL,                  -- 杠杆
    upl             DECIMAL(36, 18) DEFAULT 0,          -- 未实现盈亏
    liq_px          DECIMAL(36, 18),                    -- 预估强平价
    margin          DECIMAL(36, 18) DEFAULT 0,          -- 保证金
    imr             DECIMAL(36, 18) DEFAULT 0,          -- 初始保证金
    mmr             DECIMAL(36, 18) DEFAULT 0,          -- 维持保证金
    mgn_ratio       DECIMAL(18, 8),                     -- 保证金率
    c_time          BIGINT NOT NULL,
    u_time          BIGINT NOT NULL,

    UNIQUE (user_id, inst_id, pos_side, mgn_mode),
    INDEX idx_positions_user (user_id),
    INDEX idx_positions_inst (inst_id)
);
```

### 7.7 账户余额表 (balances)

```sql
CREATE TABLE balances (
    id              BIGSERIAL PRIMARY KEY,
    user_id         BIGINT NOT NULL REFERENCES users(id),
    ccy             VARCHAR(16) NOT NULL,               -- 币种
    eq              DECIMAL(36, 18) DEFAULT 0,          -- 权益
    cash_bal        DECIMAL(36, 18) DEFAULT 0,          -- 现金余额
    avail_bal       DECIMAL(36, 18) DEFAULT 0,          -- 可用余额
    frozen_bal      DECIMAL(36, 18) DEFAULT 0,          -- 冻结余额
    ord_frozen      DECIMAL(36, 18) DEFAULT 0,          -- 挂单冻结
    upl             DECIMAL(36, 18) DEFAULT 0,          -- 未实现盈亏
    u_time          BIGINT NOT NULL,

    UNIQUE (user_id, ccy),
    INDEX idx_balances_user (user_id)
);
```

### 7.8 资金费率表 (funding_rates)

```sql
CREATE TABLE funding_rates (
    id              BIGSERIAL PRIMARY KEY,
    inst_id         VARCHAR(32) NOT NULL,
    funding_rate    DECIMAL(18, 8) NOT NULL,            -- 资金费率
    realized_rate   DECIMAL(18, 8),                     -- 实际资金费率
    funding_time    BIGINT NOT NULL,                    -- 结算时间

    UNIQUE (inst_id, funding_time),
    INDEX idx_funding_inst_time (inst_id, funding_time DESC)
);
```

### 7.9 清算记录表 (liquidations)

```sql
CREATE TABLE liquidations (
    id              BIGSERIAL PRIMARY KEY,
    user_id         BIGINT NOT NULL REFERENCES users(id),
    inst_id         VARCHAR(32) NOT NULL,
    pos_side        VARCHAR(8) NOT NULL,
    sz              DECIMAL(36, 18) NOT NULL,           -- 清算数量
    px              DECIMAL(36, 18) NOT NULL,           -- 清算价格
    loss            DECIMAL(36, 18) NOT NULL,           -- 损失金额
    liquidator      VARCHAR(42),                        -- 清算人地址
    liq_reward      DECIMAL(36, 18),                    -- 清算奖励
    ts              BIGINT NOT NULL,
    tx_hash         VARCHAR(66),                        -- 交易哈希

    INDEX idx_liq_user (user_id),
    INDEX idx_liq_inst_ts (inst_id, ts DESC)
);
```

### 7.10 账单流水表 (bills)

```sql
CREATE TABLE bills (
    id              BIGSERIAL PRIMARY KEY,
    bill_id         VARCHAR(32) NOT NULL UNIQUE,
    user_id         BIGINT NOT NULL REFERENCES users(id),
    inst_id         VARCHAR(32),
    ccy             VARCHAR(16) NOT NULL,
    type            SMALLINT NOT NULL,                  -- 1划转 2交易 3强平 4资金费
    sub_type        SMALLINT,
    bal             DECIMAL(36, 18) NOT NULL,           -- 账户余额
    bal_chg         DECIMAL(36, 18) NOT NULL,           -- 余额变化
    sz              DECIMAL(36, 18),
    px              DECIMAL(36, 18),
    pnl             DECIMAL(36, 18),
    fee             DECIMAL(36, 18),
    ts              BIGINT NOT NULL,

    INDEX idx_bills_user_type (user_id, type),
    INDEX idx_bills_user_ts (user_id, ts DESC)
);
```

### 7.11 推荐返佣表 (referral_rewards)

```sql
CREATE TABLE referral_rewards (
    id              BIGSERIAL PRIMARY KEY,
    referrer_id     BIGINT NOT NULL REFERENCES users(id),
    referee_id      BIGINT NOT NULL REFERENCES users(id),
    ord_id          VARCHAR(32),
    trade_fee       DECIMAL(36, 18) NOT NULL,           -- 交易手续费
    reward          DECIMAL(36, 18) NOT NULL,           -- 返佣金额
    reward_rate     DECIMAL(8, 4) NOT NULL,             -- 返佣比例
    ccy             VARCHAR(16) NOT NULL,
    ts              BIGINT NOT NULL,
    claimed         BOOLEAN DEFAULT FALSE,

    INDEX idx_referral_referrer (referrer_id, claimed)
);
```

---

## 八、错误码规范

### 8.1 系统错误码 (0-999)

| 错误码 | 说明 |
|--------|------|
| 0 | 成功 |
| 1 | 操作失败 |
| 2 | 系统繁忙 |
| 50000 | 请求参数为空 |
| 50001 | 系统错误 |
| 50002 | JSON 格式错误 |
| 50004 | 接口请求超时 |
| 50005 | API 访问被冻结 |
| 50011 | 请求频率过高 |
| 50012 | 账户不存在 |
| 50013 | 账户被冻结 |
| 50014 | 仓位不存在 |

### 8.2 认证错误码 (50100-50199)

| 错误码 | 说明 |
|--------|------|
| 50100 | API Key 无效 |
| 50101 | API Key 过期 |
| 50102 | 签名验证失败 |
| 50103 | 时间戳无效 |
| 50104 | IP 不在白名单 |
| 50105 | 权限不足 |

### 8.3 交易错误码 (51000-51999)

| 错误码 | 说明 |
|--------|------|
| 51000 | 合约不存在 |
| 51001 | 合约已暂停交易 |
| 51002 | 订单不存在 |
| 51003 | 订单已成交 |
| 51004 | 订单已撤销 |
| 51005 | 订单数量超限 |
| 51006 | 价格超出限制 |
| 51007 | 可用余额不足 |
| 51008 | 持仓不存在 |
| 51009 | 可平仓数量不足 |
| 51010 | 杠杆倍数无效 |
| 51011 | 订单类型无效 |
| 51012 | 方向参数无效 |
| 51020 | 下单数量过小 |
| 51021 | 下单数量过大 |
| 51022 | 下单金额过小 |
| 51023 | 下单金额过大 |
| 51024 | 价格精度无效 |
| 51025 | 数量精度无效 |

### 8.4 账户错误码 (52000-52999)

| 错误码 | 说明 |
|--------|------|
| 52000 | 账户类型错误 |
| 52001 | 保证金不足 |
| 52002 | 仓位保证金不足 |
| 52003 | 超过最大持仓 |
| 52004 | 超过最大杠杆 |
| 52005 | 无法调整保证金 |
| 52006 | 转账失败 |

### 8.5 风控错误码 (53000-53999)

| 错误码 | 说明 |
|--------|------|
| 53000 | 触发风控限制 |
| 53001 | 价格偏离过大 |
| 53002 | 单笔交易过大 |
| 53003 | 持仓超限 |
| 53004 | 清算中 |
| 53005 | 已被清算 |

---

## 附录

### A. 参考文档

- [Binance Futures API](https://developers.binance.com/docs/derivatives)
- [OKX API v5](https://www.okx.com/docs-v5/en/)

### B. 版本历史

| 版本 | 日期 | 说明 |
|------|------|------|
| v1.0 | 2025-01-19 | 初版 |
