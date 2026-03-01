# 数据流审计报告

> 像警察查案一样，追踪每条数据线

---

## ⚠️ 2026-03-01 重大发现

**此文档描述的数据流已过时。** 2026-03-01 全面审计发现:

1. **所有永续合约资金流是虚拟的** — 用户存款/提款/PnL 结算都是内存操作
2. **SettlementV2 和 PerpVault 余额均为 0** — 从未有真实资金进入
3. **做市商使用虚假充值 API** — `POST /api/user/:trader/deposit` 无链上验证
4. **Keeper 读空 PostgreSQL** — 强平监控完全失效

**详见**: `docs/ISSUES_AUDIT_REPORT.md` (48 个问题的完整清单)

---

## 一、服务状态检查

| 服务 | 端口 | 状态 | 说明 |
|------|------|------|------|
| Frontend (Next.js) | 3000 | ✅ 运行 | |
| Go Backend | 8080 | ✅ 运行 | |
| Matching Engine | 8081 | ✅ 运行 | |
| PostgreSQL | 5432 | ✅ 运行 | |
| Redis | 6379 | ✅ 运行 | |

---

## 二、数据线追踪

### 数据线 #1: 当前价格

```
┌─────────────────────────────────────────────────────────────────────┐
│ 📍 前端显示                                                          │
│ 文件: PerpetualTradingTerminal.tsx:474                              │
│ 代码: {marketInfo.currentPrice}                                     │
│ 显示: $0.0000062234                                                 │
└─────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────┐
│ 📦 Hook 调用                                                         │
│ 文件: hooks/useTokenStats.ts:60                                     │
│ 代码: const formattedPrice = formatMemePrice(stats?.price)          │
│ 说明: 从 stats.price (6223380) 转换为 $0.0000062234                 │
└─────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────┐
│ 🌐 API 调用                                                          │
│ URL: http://localhost:8081/api/stats/{token}                        │
│ 方法: GET                                                            │
│ 返回: {"price":"6223380","priceChange24h":"0",...}                  │
└─────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────┐
│ ⚙️ 后端处理                                                          │
│ 文件: matching/server.ts:491-505 (handleGetStats)                   │
│ 调用: engine.getStats(token)                                        │
└─────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────┐
│ 🔧 引擎计算                                                          │
│ 文件: matching/engine.ts:834-878 (getStats)                         │
│ 调用: orderBook.getCurrentPrice()                                   │
└─────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────┐
│ 💾 数据源头                                                          │
│ 来源1: 订单簿成交价 (如果有成交)                                     │
│ 来源2: TokenFactory.getCurrentPrice() (现货价格初始化)              │
│ 合约: 0xCfDCD9F8D39411cF855121331B09aef1C88dc056                    │
└─────────────────────────────────────────────────────────────────────┘

状态: ✅ 正常
当前值: price=6223380 → $0.0000062234
```

---

### 数据线 #2: 订单簿

```
┌─────────────────────────────────────────────────────────────────────┐
│ 📍 前端显示                                                          │
│ 文件: PerpetualTradingTerminal.tsx:520-528                          │
│ 组件: <OrderBook data={wsOrderBook} />                              │
└─────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────┐
│ 📦 Hook 调用                                                         │
│ 文件: hooks/useMatchingEngineWS.ts                                  │
│ 代码: wsOrderBook 来自 WebSocket 订阅                                │
└─────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────┐
│ 🔌 WebSocket 连接                                                    │
│ URL: ws://localhost:8081                                            │
│ 订阅: { type: "subscribe", channel: "orderbook", token: "0x..." }   │
│ 消息: { type: "orderbook", data: { longs: [], shorts: [], ... } }   │
└─────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────┐
│ ⚙️ 后端推送                                                          │
│ 文件: matching/server.ts:646-680 (broadcastOrderBook)               │
│ 调用: orderBook.getDepth(20)                                        │
└─────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────┐
│ 💾 数据源头                                                          │
│ 来源: 内存中的订单簿 (OrderBook 类)                                  │
│ 文件: matching/engine.ts:77-225                                     │
│ 说明: longOrders Map + shortOrders Map                              │
└─────────────────────────────────────────────────────────────────────┘

状态: ✅ 正常 (订单簿为空是因为没人下单)
当前值: longs=[], shorts=[], lastPrice=6223380
```

---

### 数据线 #3: K线图

```
┌─────────────────────────────────────────────────────────────────────┐
│ 📍 前端显示                                                          │
│ 文件: PerpetualTradingTerminal.tsx:534                              │
│ 组件: <PerpetualPriceChart token={symbol} />                        │
└─────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────┐
│ 📦 组件内部                                                          │
│ 文件: components/trading/PerpetualPriceChart.tsx                    │
│ 调用: fetch(`${API_URL}/api/kline/${token}?interval=${interval}`)   │
└─────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────┐
│ 🌐 API 调用                                                          │
│ URL: http://localhost:8081/api/kline/{token}?interval=1h            │
│ 方法: GET                                                            │
│ 返回: {"klines":[]}                                                 │
└─────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────┐
│ ⚙️ 后端处理                                                          │
│ 文件: matching/server.ts:468-486 (handleGetKlines)                  │
│ 调用: engine.getKlines(token, interval, limit)                      │
└─────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────┐
│ 💾 数据源头                                                          │
│ 来源: 成交记录生成的 K 线                                            │
│ 文件: matching/engine.ts (klineData Map)                            │
│ 说明: 没有成交就没有 K 线                                            │
└─────────────────────────────────────────────────────────────────────┘

状态: ⚠️ 空数据 (没有成交，无法生成 K 线)
建议: 可用现货价格生成虚拟 K 线，或等待真实成交
```

---

### 数据线 #4: 资金费率

```
┌─────────────────────────────────────────────────────────────────────┐
│ 📍 前端显示                                                          │
│ 文件: PerpetualTradingTerminal.tsx:482-484                          │
│ 代码: {marketInfo.fundingRate} / {marketInfo.nextFunding}           │
└─────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────┐
│ 📦 Hook 调用                                                         │
│ 文件: hooks/useFundingRate.ts                                       │
│ 调用: fetch(`${API_URL}/api/funding/${token}`)                      │
└─────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────┐
│ 🌐 API 调用                                                          │
│ URL: http://localhost:8081/api/funding/{token}                      │
│ 返回: {"rate":"1","nextFundingTime":...,"interval":"8h"}            │
└─────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────┐
│ ⚙️ 后端处理                                                          │
│ 文件: matching/server.ts:509-517 (handleGetFundingRate)             │
│ 调用: engine.getFundingRate(token)                                  │
└─────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────┐
│ 🔧 引擎计算                                                          │
│ 文件: matching/engine.ts:934-962 (calculateFundingRate)             │
│ 公式: 基础费率 + (合约价-现货价)/现货价 / 8                         │
│ 说明: 合约价=现货价时，费率=基础费率(0.01%)                          │
└─────────────────────────────────────────────────────────────────────┘

状态: ✅ 正常
当前值: rate=1 (0.01% = 1 基点)
```

---

### 数据线 #5: 开仓交易

```
┌─────────────────────────────────────────────────────────────────────┐
│ 📍 前端操作                                                          │
│ 文件: components/trading/PerpetualOrderPanelV2.tsx                  │
│ 操作: 用户点击 "Long" 或 "Short" 按钮                                │
└─────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────┐
│ 📦 Hook 调用                                                         │
│ 文件: hooks/usePerpetualV2.ts                                       │
│ 函数: submitOrder()                                                 │
│ 步骤1: 用户签名 EIP-712 订单                                        │
└─────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────┐
│ 🌐 API 调用                                                          │
│ URL: http://localhost:8081/api/order/submit                         │
│ 方法: POST                                                           │
│ Body: { trader, token, isLong, size, leverage, price, signature }   │
└─────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────┐
│ ⚙️ 后端处理                                                          │
│ 文件: matching/server.ts:212-324 (handleOrderSubmit)                │
│ 步骤1: 验证签名                                                      │
│ 步骤2: engine.submitOrder() 加入订单簿                              │
│ 步骤3: 尝试撮合 tryMatch()                                          │
│ 步骤4: 如果撮合成功，创建 Position                                   │
└─────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────┐
│ 🔗 链上结算 (批量)                                                   │
│ 文件: matching/engine.ts (SettlementSubmitter)                      │
│ 间隔: 每 30 秒提交一次                                               │
│ 合约: Settlement 0x48c551f36E74B8d21D26e21139623c6dd438e455         │
└─────────────────────────────────────────────────────────────────────┘

状态: ⚠️ 需要测试
潜在问题:
- 用户需要先连接钱包
- 用户需要先生成交易钱包 (派生钱包)
- 用户需要有保证金 (WETH 余额)
```

---

### 数据线 #6: 我的持仓

```
┌─────────────────────────────────────────────────────────────────────┐
│ 📍 前端显示                                                          │
│ 文件: PerpetualTradingTerminal.tsx:570-654                          │
│ 位置: 底部 "Positions" 标签页                                        │
└─────────────────────────────────────────────────────────────────────┘
                                    │
                    ┌───────────────┴───────────────┐
                    ▼                               ▼
┌─────────────────────────────┐    ┌─────────────────────────────┐
│ 来源1: V2 Matching Engine   │    │ 来源2: 链上合约              │
│ Hook: usePerpetualV2        │    │ Hook: useReadContract       │
│ API: /api/user/{addr}/      │    │ 合约: PositionManager       │
│      positions              │    │ 函数: getPositionByToken    │
└─────────────────────────────┘    └─────────────────────────────┘

状态: ⚠️ 数据来源混乱
问题:
- V2 持仓来自撮合引擎 (内存)
- 链上持仓来自合约 (需要结算后才有)
- 两个来源可能不一致
```

---

### 数据线 #7: 派生交易钱包

```
┌─────────────────────────────────────────────────────────────────────┐
│ 📍 前端操作                                                          │
│ 文件: components/trading/PerpetualOrderPanelV2.tsx                  │
│ 位置: "Generate Trading Wallet" 按钮                                 │
└─────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────┐
│ 📦 Hook 调用                                                         │
│ 文件: hooks/useTradingWallet.ts                                     │
│ 函数: generateWallet()                                              │
│ 步骤1: 用户用主钱包签名固定消息                                      │
│ 步骤2: keccak256(signature) → 派生私钥                              │
│ 步骤3: 保存到 localStorage                                          │
└─────────────────────────────────────────────────────────────────────┘

状态: ✅ 正常
说明: 派生钱包用于签名订单，不需要主钱包每次签名
```

---

### 数据线 #8: 充值保证金

```
┌─────────────────────────────────────────────────────────────────────┐
│ 📍 前端操作                                                          │
│ 文件: hooks/useTradingWallet.ts                                     │
│ 函数: wrapAndDeposit(amount)                                        │
└─────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────┐
│ 📦 步骤1: 获取 Nonce                                                 │
│ API: GET /api/v1/relay/nonce/{address}                              │
│ 后端: Go Backend :8080                                              │
└─────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────┐
│ 📝 步骤2: 签名 EIP-712                                               │
│ 类型: Deposit(user,token,amount,deadline,nonce)                     │
│ 用户: 用派生钱包签名                                                 │
└─────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────┐
│ 🌐 步骤3: 调用 Relay API                                             │
│ API: POST /api/v1/relay/deposit-eth                                 │
│ 后端: Go Backend :8080                                              │
│ Body: { user, amount, deadline, signature }                         │
└─────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────┐
│ 🔗 步骤4: 链上执行                                                   │
│ Relayer 钱包代付 Gas                                                 │
│ 合约: Settlement.depositETHFor()                                    │
│ 操作: ETH → WETH → 存入用户余额                                      │
└─────────────────────────────────────────────────────────────────────┘

状态: ⚠️ 需要测试
依赖:
- Relayer 钱包需要有 ETH (当前 ~1 ETH)
- Settlement 合约需要设置 WETH 地址
- 用户派生钱包需要有 ETH
```

---

## 三、已发现的问题清单

| 编号 | 问题 | 严重程度 | 状态 |
|------|------|----------|------|
| P001 | K线为空 (没有成交记录) | ⚠️ 中 | 预期行为 |
| P002 | 订单簿为空 (没有挂单) | ⚠️ 中 | 预期行为 |
| P003 | 持仓数据来源混乱 (撮合引擎 vs 链上) | 🔴 高 | ✅ 已修复 |
| P004 | 派生钱包余额为 0 (需要充值) | ⚠️ 中 | 用户操作 |
| P005 | 没有做市商挂单 | ⚠️ 中 | 需要做市商 |
| P006 | 撮合引擎使用旧的 Settlement 合约地址 | 🔴 严重 | ✅ 已修复 |
| P007 | Matcher 未授权到 Settlement 合约 | 🔴 严重 | ✅ 已修复 |
| P008 | 订单不显示在UI（前端使用错误地址查询） | 🔴 高 | ✅ 已修复 |
| P009 | 订单详细信息不完整（缺少行业标准字段） | ⚠️ 中 | ✅ 已修复 |

---

## 三-A、问题修复记录 (2026-01-26)

### P006: Settlement 合约地址配置错误

**问题描述:**
撮合引擎 `/backend/src/matching/.env` 中配置的 SETTLEMENT_ADDRESS 是旧地址 `0xB06C32C7536EC5EAD101fEe2AD4005a5eedcB258`，而实际部署的新合约地址是 `0x48c551f36E74B8d21D26e21139623c6dd438e455`。

**表现:**
```
The contract function "settleBatch" reverted with the following signature: 0xf4d678b8
Contract Call: address: 0xB06C32C7536EC5EAD101fEe2AD4005a5eedcB258
```

**修复:**
更新 `/backend/src/matching/.env`:
```
SETTLEMENT_ADDRESS=0x48c551f36E74B8d21D26e21139623c6dd438e455
```

### P007: Matcher 未授权

**问题描述:**
撮合引擎的 Matcher 地址 (`0x5AF11d4784c3739cf2FD51Fdc272ae4957ADf7fE`) 未被授权到 Settlement 合约。

**修复:**
使用 Settlement 合约 owner (`0xF339fCf70939e04C8Ce79391BB47bB943122949C`) 执行授权:
```bash
cast send 0x48c551f36E74B8d21D26e21139623c6dd438e455 "setAuthorizedMatcher(address,bool)" 0x5AF11d4784c3739cf2FD51Fdc272ae4957ADf7fE true --private-key <owner_private_key>
```

**验证:**
```bash
cast call 0x48c551f36E74B8d21D26e21139623c6dd438e455 "authorizedMatchers(address)(bool)" 0x5AF11d4784c3739cf2FD51Fdc272ae4957ADf7fE
# 返回: true
```

### P003: 持仓数据来源混乱

**问题描述:**
前端同时从两个来源获取仓位数据：
1. 撮合引擎 API (`/api/user/{trader}/positions`) - V2 系统的主数据源
2. 旧的 PositionManager 合约 - V1 系统的遗留代码

撮合引擎重启后内存中的仓位数据丢失，导致数据不一致。

**修复:**

1. **后端（撮合引擎）**：启动时从链上 Settlement 合约同步已有仓位
   - 新增 `syncPositionsFromChain()` 函数
   - 启动时调用一次，之后每 5 分钟同步一次
   - 文件：`/backend/src/matching/server.ts`

2. **前端**：移除对旧 PositionManager 合约的依赖
   - 删除 `useReadContract` 对 PositionManager 的调用
   - 统一使用 `usePerpetualV2` hook 的数据
   - 文件：`/frontend/src/components/trading/PerpetualTradingTerminal.tsx`

**验证:**
```
[Sync] Total pairs on chain: 1
[Sync] Synced 2 positions from 1 active pairs
[Server] Initial position sync completed
```

### P008: 订单不显示在UI（前端使用错误地址查询）

**问题描述:**
用户使用派生交易钱包 (如 `0xE4df9f4BBefA59D9B233961FecEaCdEdf1AE2E5d`) 提交订单，订单存在于撮合引擎中，但前端的"当前委托"和订单簿中不显示。

**根本原因:**
`PerpetualTradingTerminal.tsx` 调用 `usePerpetualV2()` 时没有传递 `tradingWalletAddress` 参数，导致 hook 使用 MetaMask 主钱包地址（如 `0xF339fCf70939e04C8Ce79391BB47bB943122949C`）而不是派生交易钱包地址来查询订单。

**修复:**
1. 在 `PerpetualTradingTerminal.tsx` 中调用 `useTradingWallet()` hook 获取交易钱包信息
2. 将 `tradingWalletAddress` 和 `tradingWalletSignature` 传递给 `usePerpetualV2()`
3. 更新轮询 useEffect 的依赖项

**修改文件:** `/frontend/src/components/trading/PerpetualTradingTerminal.tsx`

```typescript
// 获取交易钱包信息
const {
  address: tradingWalletAddress,
  getSignature,
  isInitialized: isTradingWalletInitialized,
} = useTradingWallet();

// 获取交易钱包签名
const tradingWalletSignature = getSignature();

// 传递给 usePerpetualV2
const { ... } = usePerpetualV2({
  tradingWalletAddress: tradingWalletAddress || undefined,
  tradingWalletSignature: tradingWalletSignature || undefined,
});
```

### P009: 订单详细信息不完整（缺少行业标准字段）

**问题描述:**
订单信息只包含基本字段（id, token, isLong, size, price, status, filledSize, createdAt），缺少行业标准交易所（OKX/Binance）的完整字段。

**对比行业标准:**

| 字段 | 修复前 | OKX | Binance |
|------|--------|-----|---------|
| 平均成交价 (avgFillPrice) | ❌ | ✅ avgPx | ✅ avgPrice |
| 杠杆倍数 (leverage) | ❌ | ✅ lever | - |
| 订单类型 (orderType) | ❌ | ✅ ordType | ✅ type |
| 有效期 (timeInForce) | ❌ | ✅ | ✅ GTC/IOC/FOK |
| 保证金 (margin) | ❌ | ✅ | - |
| 手续费 (fee) | ❌ | ✅ | - |
| 只减仓 (reduceOnly) | ❌ | ✅ | ✅ |
| 更新时间 (updatedAt) | ❌ | ✅ uTime | ✅ updateTime |
| 止盈止损价 | ❌ | ✅ | ✅ stopPrice |
| 累计成交额 | ❌ | ✅ fillNotionalUsd | ✅ cumQuote |
| 订单来源 (source) | ❌ | ✅ | - |

**修复:**

1. **后端 Order 接口扩展** (`/backend/src/matching/engine.ts`):
   - 添加 TimeInForce 枚举 (GTC/IOC/FOK/GTD)
   - 添加 OrderSource 枚举 (API/WEB/APP)
   - Order 接口添加 40+ 个行业标准字段
   - 新增 `updateOrderFillInfo()` 函数计算成交信息

2. **后端 API 返回完整信息** (`/backend/src/matching/server.ts`):
   - `handleGetUserOrders()` 返回所有行业标准字段

3. **前端 OrderInfo 接口** (`/frontend/src/hooks/usePerpetualV2.ts`):
   - 更新为完整的行业标准类型定义

4. **前端订单列表 UI** (`/frontend/src/components/trading/PerpetualTradingTerminal.tsx`):
   - 显示 13 列完整订单信息
   - 包含：时间、交易对、类型、方向、杠杆、委托价、委托量、成交均价、已成交/总量、保证金、手续费、状态、操作

**新增字段列表:**
- `clientOrderId` - 用户自定义订单ID
- `leverage` - 杠杆倍数
- `orderType` - 订单类型 (MARKET/LIMIT)
- `timeInForce` - 有效期类型 (GTC/IOC/FOK/GTD)
- `reduceOnly` - 是否只减仓
- `avgFillPrice` - 平均成交价格
- `totalFillValue` - 累计成交金额
- `fee` / `feeCurrency` - 手续费及币种
- `margin` / `collateral` - 保证金信息
- `takeProfitPrice` / `stopLossPrice` - 止盈止损
- `updatedAt` / `lastFillTime` - 时间戳
- `source` - 订单来源
- `lastFillPrice` / `lastFillSize` / `tradeId` - 最后成交明细

---

## 四、合约状态检查

| 合约 | 地址 | 功能 | 状态 |
|------|------|------|------|
| Settlement | 0x48c551f36E74B8d21D26e21139623c6dd438e455 | P2P结算 | ✅ WETH 配置正确, Matcher 已授权 |
| TokenFactory | 0xCfDCD9F8D39411cF855121331B09aef1C88dc056 | Meme币发行 | ✅ 正常 |
| PriceFeed | 0xd69A4DB60cEc962A46C6B9Bc8CC0883081c4eFb7 | 价格预言机 | 待检查 |

### Settlement 合约详细检查

```
Owner: 0xF339fCf70939e04C8Ce79391BB47bB943122949C
WETH: 0x4200000000000000000000000000000000000006 ✅
Authorized Matcher: 0x5AF11d4784c3739cf2FD51Fdc272ae4957ADf7fE ✅
```

---

## 五、下一步行动

1. [x] 检查 Settlement 合约状态 - ✅ 已完成
2. [x] 修复 Matcher 授权问题 (P006, P007) - ✅ 已完成
3. [x] 修复持仓数据来源问题 (P003) - ✅ 已完成
4. [x] 修复订单不显示在UI的问题 (P008) - ✅ 已完成
5. [x] 完善订单详细信息为行业标准 (P009) - ✅ 已完成
6. [ ] 重启撮合引擎使改动生效
7. [ ] 测试完整的开仓流程（需要刷新前端页面验证）
8. [ ] 测试充值流程
9. [ ] 部署做市商机器人
