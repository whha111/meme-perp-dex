# Meme Perpetual DEX 项目完整文档

> 最后更新: 2026-01-27

---

## 目录

1. [项目概述](#1-项目概述)
2. [技术架构](#2-技术架构)
3. [智能合约层](#3-智能合约层)
4. [前端应用](#4-前端应用)
5. [后端服务](#5-后端服务)
6. [撮合引擎](#6-撮合引擎)
7. [核心业务流程](#7-核心业务流程)
8. [数据流图](#8-数据流图)
9. [配置与部署](#9-配置与部署)
10. [功能清单](#10-功能清单)

---

## 1. 项目概述

### 1.1 项目定位

Meme Perpetual DEX 是一个去中心化的 Meme 代币永续合约交易平台，支持：

- **现货交易**: 基于 Bonding Curve 的代币发行与交易
- **永续合约**: 最高 100 倍杠杆的永续合约交易
- **代币毕业**: 代币达到阈值后自动迁移到 DEX

### 1.2 目标用户

- Meme 代币创建者
- 现货交易者
- 永续合约交易者
- 做市商

### 1.3 项目结构

```
meme-perp-dex/
├── contracts/          # Solidity 智能合约 (Foundry)
│   ├── src/core/       # 核心合约
│   ├── src/periphery/  # 外围合约
│   └── src/interfaces/ # 接口定义
├── frontend/           # Next.js 前端应用
│   ├── src/pages/      # 页面组件
│   ├── src/components/ # UI 组件
│   ├── src/hooks/      # React Hooks
│   └── src/utils/      # 工具函数
├── backend/            # 后端服务
│   ├── cmd/            # 入口程序
│   ├── internal/       # 内部模块
│   └── src/matching/   # TypeScript 撮合引擎
└── docs/               # 文档
```

---

## 2. 技术架构

### 2.1 技术栈

| 层级 | 技术 |
|------|------|
| **区块链** | Base Sepolia (EVM 兼容) |
| **智能合约** | Solidity 0.8.20+, Foundry, OpenZeppelin |
| **前端** | Next.js 14, React 18, TypeScript, TailwindCSS |
| **Web3** | Wagmi v2, Viem, RainbowKit |
| **后端 API** | Go 1.22+, Gin, GORM |
| **撮合引擎** | TypeScript, Bun |
| **数据库** | PostgreSQL + TimescaleDB |
| **缓存** | Redis |
| **实时通信** | WebSocket |

### 2.2 架构版本

系统支持两套交易架构：

| 版本 | 架构 | 特点 |
|------|------|------|
| **V1** | PositionManager | 直接链上开仓，用户支付 Gas |
| **V2** | Settlement | EIP-712 签名 + 链下撮合，Matcher 支付 Gas |

**推荐使用 V2 架构**，具有更好的用户体验和更低的交易成本。

### 2.3 系统架构图

```
┌─────────────────────────────────────────────────────────────────┐
│                         用户界面 (Frontend)                       │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────────────┐ │
│  │ 现货交易  │  │ 永续合约  │  │ 账户管理  │  │ 代币创建/发现    │ │
│  └────┬─────┘  └────┬─────┘  └────┬─────┘  └────────┬─────────┘ │
└───────┼─────────────┼─────────────┼─────────────────┼───────────┘
        │             │             │                 │
        ▼             ▼             ▼                 ▼
┌───────────────┐ ┌──────────────────────┐  ┌──────────────────┐
│  TokenFactory │ │    撮合引擎 (8081)    │  │   后端 API (8080) │
│   (链上)      │ │  ┌────────────────┐  │  │  ┌─────────────┐  │
│               │ │  │ Order Book     │  │  │  │ Market Data │  │
│  Bonding      │ │  │ 1:N Matching   │  │  │  │ Positions   │  │
│  Curve AMM    │ │  │ Signature      │  │  │  │ Balances    │  │
│               │ │  └───────┬────────┘  │  │  └─────────────┘  │
└───────┬───────┘ └──────────┼───────────┘  └────────┬──────────┘
        │                    │                       │
        ▼                    ▼                       ▼
┌─────────────────────────────────────────────────────────────────┐
│                      智能合约层 (Base Sepolia)                    │
│  ┌────────────┐ ┌────────────┐ ┌───────────┐ ┌───────────────┐  │
│  │ Settlement │ │ PriceFeed  │ │Liquidation│ │ FundingRate   │  │
│  └────────────┘ └────────────┘ └───────────┘ └───────────────┘  │
│  ┌────────────┐ ┌────────────┐ ┌───────────┐ ┌───────────────┐  │
│  │   Vault    │ │ Position   │ │  Reader   │ │ SessionKey    │  │
│  │            │ │  Manager   │ │           │ │   Manager     │  │
│  └────────────┘ └────────────┘ └───────────┘ └───────────────┘  │
└─────────────────────────────────────────────────────────────────┘
```

---

## 3. 智能合约层

### 3.1 核心合约

#### 3.1.1 TokenFactory.sol - 代币工厂

**功能**: Pump.fun 风格的 Bonding Curve 代币发行

```solidity
// 核心函数
function createToken(string name, string symbol, string metadataURI)
function buy(address token) payable  // 用 ETH 买代币
function sell(address token, uint256 amount)  // 卖代币换 ETH
function graduate(address token)  // 代币毕业到 DEX
```

**Bonding Curve 机制**:
- 初始虚拟储备: 1.82 ETH + 10.73 亿代币
- 定价公式: 恒定乘积 AMM (x × y = k)
- 毕业条件: 售出 79.3 亿代币 (实际储备 ≤ 2.07 亿)
- 毕业奖励: 创建者获得 10% 池子

---

#### 3.1.2 Settlement.sol - V2 结算合约

**功能**: EIP-712 签名订单的链上结算

```solidity
// 核心函数
function deposit(uint256 amount)  // 存入 USDT 保证金
function withdraw(uint256 amount)  // 提取保证金
function submitMatchedPair(MatchedOrder[] orders, bytes[] signatures)  // 提交撮合结果
function requestClosePair(address token)  // 请求平仓
function getUserPositions(address user) view  // 查询仓位
function getBalance(address user) view  // 查询余额
```

**特点**:
- 支持 1:N 撮合 (一个大单对多个小单)
- USDT 作为保证金
- Matcher 代付 Gas

---

#### 3.1.3 PositionManager.sol - V1 仓位管理

**功能**: 直接链上开仓/平仓

```solidity
// 核心函数 (多代币版本)
function openLongToken(address token, uint256 size, uint256 leverage, MarginMode mode)
function openShortToken(address token, uint256 size, uint256 leverage, MarginMode mode)
function closePositionToken(address token)
function getPositionByToken(address user, address token) view
function getTokenUnrealizedPnL(address user, address token) view
function getTokenLiquidationPrice(address user, address token) view
```

**保证金模式**:
- `ISOLATED`: 逐仓 - 每个仓位独立保证金
- `CROSS`: 全仓 - 所有仓位共享保证金

---

#### 3.1.4 PriceFeed.sol - 价格预言机

**功能**: 价格聚合和 TWAP 计算

```solidity
// 核心函数
function updateTokenPriceFromFactory(address token, uint256 price)  // TokenFactory 调用
function getTokenMarkPrice(address token) view  // 获取标记价格
function getTokenSpotPrice(address token) view  // 获取现货价格
function getTokenTWAP(address token, uint256 period) view  // 获取 TWAP
function getPriceHistory(address token, uint256 count) view  // 获取历史价格
```

---

#### 3.1.5 Vault.sol - 资金库

**功能**: BNB/ETH 保证金管理

```solidity
// 核心函数
function deposit() payable  // 存入保证金
function withdraw(uint256 amount)  // 提取保证金
function lockMargin(address user, uint256 amount)  // 锁定保证金
function unlockMargin(address user, uint256 amount)  // 解锁保证金
function settlePnL(address user, int256 pnl)  // 结算盈亏
```

---

#### 3.1.6 Liquidation.sol - 强平引擎

**功能**: 仓位强平和保险基金

```solidity
// 核心函数
function liquidateToken(address user, address token)  // 强平仓位
function canLiquidateToken(address user, address token) view  // 检查是否可强平
function getInsuranceFund() view  // 保险基金余额
function adlQueue(address token) view  // ADL 队列
```

**强平流程**:
1. 检查保证金率 < 维持保证金率
2. 没收抵押品
3. 平仓
4. 支付强平者 5% 奖励
5. 剩余进入保险基金

---

#### 3.1.7 FundingRate.sol - 资金费率

**功能**: 资金费率计算和结算

```solidity
// 核心函数
function settleFunding(address token)  // 结算资金费
function settleUserFunding(address user, address token)  // 结算用户资金费
function getCurrentFundingRate(address token) view  // 当前资金费率
function getCumulativeFundingRate(address token) view  // 累计资金费率
```

**资金费率机制**:
- 结算周期: 每 4 小时
- 费率范围: -1% ~ +1%
- 公式: `fundingRate = clamp(premiumIndex + interestRate, -1%, +1%)`
- 正费率: 多头付给空头
- 负费率: 空头付给多头

---

### 3.2 外围合约

#### Reader.sol - 批量读取

```solidity
function getPositionsBatch(address[] users, address[] tokens) view
function getUserDashboard(address user) view
function getMarketOverview(address[] tokens) view
```

#### SessionKeyManager.sol - 会话密钥

```solidity
function authorizeSessionKey(address key, uint256 dailyLimit, uint256 txLimit)
function revokeSessionKey(address key)
function validateSessionKey(address master, address key, uint256 amount) view
```

---

### 3.3 核心计算公式

#### PnL 计算 (GMX 标准)

```solidity
function getDelta(uint256 size, uint256 avgPrice, uint256 currentPrice, bool isLong)
    returns (bool hasProfit, uint256 delta)
{
    uint256 priceDelta = avgPrice > currentPrice
        ? avgPrice - currentPrice
        : currentPrice - avgPrice;

    delta = size * priceDelta / avgPrice;

    hasProfit = isLong
        ? (currentPrice > avgPrice)
        : (avgPrice > currentPrice);
}
```

**示例**:
- 开多 100 USDT, 入场价 $1.00, 当前价 $1.10
- priceDelta = 0.10
- delta = 100 × 0.10 / 1.00 = 10 USDT 盈利

#### 强平价格 (Bybit 标准)

```
多头: liqPrice = entryPrice × (1 - 1/leverage + MMR)
空头: liqPrice = entryPrice × (1 + 1/leverage - MMR)
```

**示例** (入场价 $100, 10x 杠杆, MMR 0.5%):
- 多头强平价: 100 × (1 - 0.1 + 0.005) = $90.50
- 空头强平价: 100 × (1 + 0.1 - 0.005) = $109.50

---

## 4. 前端应用

### 4.1 页面结构

| 路由 | 页面 | 功能 |
|------|------|------|
| `/` | 首页 | 市场概览、热门代币、毕业进度 |
| `/create` | 创建代币 | 代币发行表单、图片上传 |
| `/trade/[address]` | 现货交易 | 单代币交易、K线图、交易历史 |
| `/exchange` | 交易所 | 现货交易终端 |
| `/perp` | 永续合约 | 永续合约交易终端 |
| `/account` | 账户 | 余额、仓位、账单 |
| `/wallet` | 钱包 | 存取款、余额管理 |
| `/invite/[code]` | 邀请 | 推荐返佣、邀请列表 |
| `/settings` | 设置 | 主题、语言、安全 |

### 4.2 核心组件

#### 交易组件 (components/trading/)

```
PerpetualTradingTerminal.tsx  - V2 永续交易主界面
├── PerpetualOrderPanelV2.tsx - 下单面板
├── AllPositions.tsx          - 仓位列表
├── AccountBalance.tsx        - 账户余额
├── OrderBook.tsx             - 订单簿
├── PerpetualPriceChart.tsx   - K线图
├── TradeHistory.tsx          - 成交历史
├── LiquidationMap.tsx        - 强平热力图
└── HunterLeaderboard.tsx     - 强平猎人排行榜
```

#### 发现组件 (components/discovery/)

```
DiscoveryPage.tsx       - 代币发现主页
├── TokenCard.tsx       - 代币卡片
├── FilterPanel.tsx     - 筛选面板
├── GraduationProgress.tsx - 毕业进度
└── FAQPanel.tsx        - 常见问题
```

### 4.3 核心 Hooks

#### 永续合约 Hooks

```typescript
// V2 架构 (推荐)
usePerpetualV2.ts
├── signOrder()         // EIP-712 签名
├── submitOrder()       // 提交到撮合引擎
├── getPositions()      // 查询仓位
├── getBalance()        // 查询余额
└── closePosition()     // 平仓

// V1 架构 (旧版)
usePerpetual.ts
├── openLong()          // 链上开多
├── openShort()         // 链上开空
├── closePosition()     // 链上平仓
└── getPosition()       // 查询仓位
```

#### 现货 Hooks

```typescript
useTokenFactory.ts      // 代币创建
useExecuteSwap.ts       // 现货交易执行
useTokenInfo.ts         // 代币信息查询
useTokenList.ts         // 代币列表
```

#### 数据 Hooks

```typescript
useMarketData.ts        // 市场数据
useFundingRate.ts       // 资金费率
useKlines.ts            // K线数据
useTradeHistory.ts      // 交易历史
useMatchingEngineWS.ts  // 撮合引擎 WebSocket
```

### 4.4 工具函数

```typescript
// utils/orderSigning.ts
signOrderV2(order, signer)      // EIP-712 签名
submitToMatchingEngine(order)   // 提交订单
verifySignature(order, sig)     // 验证签名

// utils/formatters.ts
formatPrice(price, decimals)    // 价格格式化
formatSize(size)                // 数量格式化
formatPnL(pnl)                  // 盈亏格式化

// utils/tradingWallet.ts
deriveTradingWallet(masterKey)  // 派生交易钱包
```

---

## 5. 后端服务

### 5.1 服务架构

```
backend/
├── cmd/
│   ├── api/main.go      # API 服务入口
│   ├── indexer/main.go  # 链上事件索引器
│   └── keeper/main.go   # 后台任务管理器
├── internal/
│   ├── api/             # HTTP 处理器
│   ├── service/         # 业务逻辑
│   ├── repository/      # 数据访问
│   ├── model/           # 数据模型
│   ├── keeper/          # 后台任务
│   └── blockchain/      # 链上交互
└── src/matching/        # TypeScript 撮合引擎
```

### 5.2 API 端点

#### 市场数据 API

| 端点 | 方法 | 功能 |
|------|------|------|
| `/api/v1/market/instruments` | GET | 获取所有交易对 |
| `/api/v1/market/ticker/:symbol` | GET | 获取单个交易对行情 |
| `/api/v1/market/tickers` | GET | 获取所有行情 |
| `/api/v1/market/candles` | GET | 获取 K 线数据 |
| `/api/v1/market/trades` | GET | 获取成交记录 |
| `/api/v1/market/orderbook/:symbol` | GET | 获取订单簿 |
| `/api/v1/market/mark-price/:symbol` | GET | 获取标记价格 |

#### 账户 API

| 端点 | 方法 | 功能 |
|------|------|------|
| `/api/v1/account/balance` | GET | 获取账户余额 |
| `/api/v1/account/positions` | GET | 获取持仓列表 |
| `/api/v1/account/leverage` | POST | 设置杠杆 |
| `/api/v1/account/margin` | POST | 调整保证金 |
| `/api/v1/account/bills` | GET | 获取账单历史 |

#### 交易 API

| 端点 | 方法 | 功能 |
|------|------|------|
| `/api/v1/trade/order` | POST | 提交订单 |
| `/api/v1/trade/cancel` | POST | 取消订单 |
| `/api/v1/trade/orders` | GET | 获取订单历史 |

#### 公开 API

| 端点 | 方法 | 功能 |
|------|------|------|
| `/api/v1/public/funding-rate/:symbol` | GET | 获取资金费率 |
| `/api/v1/public/server-time` | GET | 获取服务器时间 |
| `/api/v1/public/health` | GET | 健康检查 |

### 5.3 数据模型

```go
// 用户
type User struct {
    ID           uint
    Address      string      // 钱包地址
    ReferralCode string      // 推荐码
    ReferredBy   string      // 推荐人
    CreatedAt    time.Time
}

// 交易对
type Instrument struct {
    ID              uint
    Symbol          string   // "PEPE-USDT-PERP"
    BaseToken       string   // 基础代币地址
    QuoteToken      string   // 报价代币地址
    MaxLeverage     int      // 最大杠杆
    MaintenanceRate float64  // 维持保证金率
    Status          string   // "active", "suspended"
}

// 订单
type Order struct {
    ID         string
    UserID     uint
    Symbol     string
    Side       string    // "long", "short"
    Type       string    // "market", "limit"
    Size       Decimal
    Price      Decimal
    Leverage   int
    Status     string    // "pending", "filled", "cancelled"
    FilledSize Decimal
    CreatedAt  time.Time
}

// 仓位
type Position struct {
    ID           uint
    UserID       uint
    Symbol       string
    Side         string    // "long", "short"
    Size         Decimal
    EntryPrice   Decimal
    Margin       Decimal
    Leverage     int
    LiqPrice     Decimal
    UnrealizedPnL Decimal
    UpdatedAt    time.Time
}

// 成交
type Trade struct {
    ID        string
    Symbol    string
    Price     Decimal
    Size      Decimal
    Side      string
    Timestamp time.Time
}
```

### 5.4 Keeper 服务

后台定时任务管理器：

```go
// keeper/manager.go
type KeeperManager struct {
    priceKeeper       *PriceKeeper       // 价格更新
    liquidationKeeper *LiquidationKeeper // 强平监控
    fundingKeeper     *FundingKeeper     // 资金费结算
    orderKeeper       *OrderKeeper       // 条件单执行
}

// 启动所有 Keeper
func (m *KeeperManager) Start() {
    go m.priceKeeper.Run()        // 每分钟更新价格
    go m.liquidationKeeper.Run()  // 每区块检查强平
    go m.fundingKeeper.Run()      // 每4小时结算资金费
    go m.orderKeeper.Run()        // 每秒检查条件单
}
```

---

## 6. 撮合引擎

### 6.1 架构

撮合引擎是用 TypeScript 编写的独立服务：

```
backend/src/matching/
├── engine.ts       # 撮合核心逻辑
├── server.ts       # HTTP/WebSocket 服务
├── counter.ts      # 订单计数器
└── tests/          # 测试文件
```

### 6.2 订单簿结构

```typescript
interface OrderBook {
    token: string;
    longs: Map<string, Order>;   // 多单 (按价格排序)
    shorts: Map<string, Order>;  // 空单 (按价格排序)

    // 方法
    addOrder(order: Order): void;
    removeOrder(orderId: string): void;
    getBestBid(): bigint;
    getBestAsk(): bigint;
    match(): MatchResult[];
}

interface Order {
    id: string;
    trader: string;
    token: string;
    isLong: boolean;
    size: bigint;
    price: bigint;         // 0 = 市价单
    leverage: number;
    marginMode: 'ISOLATED' | 'CROSS';
    signature: string;
    timestamp: number;

    // 高级选项
    postOnly?: boolean;
    reduceOnly?: boolean;
    timeInForce?: 'GTC' | 'IOC' | 'FOK';
}
```

### 6.3 撮合算法

```typescript
// 价格优先、时间优先
function tryMatch(orderBook: OrderBook): MatchResult[] {
    const matches: MatchResult[] = [];

    while (true) {
        const bestBid = orderBook.getBestBid();  // 最高买价
        const bestAsk = orderBook.getBestAsk();  // 最低卖价

        // 无法撮合
        if (bestBid < bestAsk) break;

        const longOrder = orderBook.getTopLong();
        const shortOrder = orderBook.getTopShort();

        // 计算成交数量
        const matchSize = min(longOrder.size, shortOrder.size);
        const matchPrice = (longOrder.price + shortOrder.price) / 2n;

        matches.push({
            longOrder,
            shortOrder,
            matchSize,
            matchPrice
        });

        // 更新订单簿
        updateOrRemoveOrder(longOrder, matchSize);
        updateOrRemoveOrder(shortOrder, matchSize);
    }

    return matches;
}
```

### 6.4 1:N 撮合

支持一个大单与多个小单撮合：

```typescript
// 示例: 一个 100 USDT 的多单与多个空单撮合
[
    { longOrder: A, shortOrder: B, size: 30 },  // A 与 B 撮合 30
    { longOrder: A, shortOrder: C, size: 50 },  // A 与 C 撮合 50
    { longOrder: A, shortOrder: D, size: 20 },  // A 与 D 撮合 20
]
```

### 6.5 API 端点

| 端点 | 方法 | 功能 |
|------|------|------|
| `/order/submit` | POST | 提交订单 |
| `/order/cancel` | POST | 取消订单 |
| `/order/:id` | GET | 查询订单状态 |
| `/orderbook/:token` | GET | 获取订单簿 |
| `/trades/:token` | GET | 获取成交记录 |
| `/health` | GET | 健康检查 |

### 6.6 WebSocket 事件

```typescript
// 订阅
ws.send({ type: 'subscribe', channel: 'orderbook', token: '0x...' });
ws.send({ type: 'subscribe', channel: 'trades', token: '0x...' });
ws.send({ type: 'subscribe', channel: 'position', trader: '0x...' });

// 推送事件
{ type: 'orderbook_update', data: { bids: [...], asks: [...] } }
{ type: 'trade', data: { price, size, side, timestamp } }
{ type: 'position_update', data: { size, entryPrice, pnl } }
{ type: 'order_filled', data: { orderId, filledSize, avgPrice } }
```

---

## 7. 核心业务流程

### 7.1 代币创建与毕业

```
1. 用户填写代币信息 (名称、符号、图片)
     ↓
2. 调用 TokenFactory.createToken()
     ↓
3. 合约创建 ERC20 代币 + 初始化 Bonding Curve
     ↓
4. 用户通过 buy()/sell() 交易代币
     ↓
5. 每次交易更新 PriceFeed 价格
     ↓
6. 当售出 79.3 亿代币时，自动毕业
     ↓
7. 创建者获得 10% 奖励，剩余进入 DEX LP
```

### 7.2 永续合约开仓 (V2)

```
1. 用户在前端选择代币、方向、杠杆、数量
     ↓
2. 前端调用 usePerpetualV2.signOrder() 生成 EIP-712 签名
     ↓
3. 提交订单到撮合引擎
     ↓
4. 撮合引擎验证签名、检查余额
     ↓
5. 尝试与对手方订单撮合
     ↓
6. 撮合成功后，批量提交到 Settlement 合约
     ↓
7. 合约验证所有签名、锁定保证金、创建仓位
     ↓
8. 前端通过 WebSocket 收到仓位更新
```

### 7.3 平仓流程

```
1. 用户点击平仓按钮
     ↓
2. 前端调用 requestClosePair() 或提交反向订单
     ↓
3. 撮合引擎寻找对手方
     ↓
4. 撮合成功，提交平仓到合约
     ↓
5. 合约计算 PnL、解锁保证金、结算资金费
     ↓
6. 盈利进入用户余额，亏损从保证金扣除
```

### 7.4 强平流程

```
1. LiquidationKeeper 定期检查所有仓位
     ↓
2. 计算当前保证金率 = 保证金 / 仓位价值
     ↓
3. 如果保证金率 < 维持保证金率
     ↓
4. 调用 Liquidation.liquidateToken()
     ↓
5. 没收仓位、平仓
     ↓
6. 支付强平者 5% 奖励
     ↓
7. 剩余进入保险基金
     ↓
8. 如果保险基金不足，触发 ADL
```

### 7.5 资金费结算

```
1. FundingKeeper 每 4 小时触发
     ↓
2. 计算资金费率 = (标记价格 - 指数价格) / 指数价格
     ↓
3. 限制在 -1% ~ +1% 范围内
     ↓
4. 调用 FundingRate.settleFunding()
     ↓
5. 正费率: 多头支付给空头
   负费率: 空头支付给多头
     ↓
6. 更新累计资金费率
```

---

## 8. 数据流图

### 8.1 现货交易数据流

```
┌────────┐     buy/sell      ┌──────────────┐
│  用户  │ ───────────────── │ TokenFactory │
└────┬───┘                   └──────┬───────┘
     │                              │
     │                              │ updatePrice
     │                              ▼
     │                       ┌──────────────┐
     │                       │  PriceFeed   │
     │                       └──────┬───────┘
     │                              │
     │◄─────── 价格更新 ────────────┤
     │                              │
     ▼                              ▼
┌────────┐                   ┌──────────────┐
│  前端  │ ◄──── 查询 ────── │   Backend    │
└────────┘                   └──────────────┘
```

### 8.2 永续合约数据流

```
┌────────┐   签名订单    ┌──────────────┐   批量结算    ┌────────────┐
│  用户  │ ────────────► │  撮合引擎   │ ────────────► │ Settlement │
└────┬───┘               └──────┬───────┘               └─────┬──────┘
     │                          │                             │
     │                          │ 撮合结果                    │ 事件
     │                          ▼                             ▼
     │                   ┌──────────────┐               ┌──────────────┐
     │◄── WebSocket ─────│  WebSocket   │◄── 索引 ─────│   Indexer    │
     │                   └──────────────┘               └──────────────┘
     │                                                        │
     ▼                                                        ▼
┌────────┐                                             ┌──────────────┐
│  前端  │◄────────────── 查询仓位 ────────────────────│   Database   │
└────────┘                                             └──────────────┘
```

---

## 9. 配置与部署

### 9.1 环境变量

#### 前端 (.env.local)

```bash
# 合约地址
NEXT_PUBLIC_SETTLEMENT_ADDRESS=0x...
NEXT_PUBLIC_USDT_ADDRESS=0x...
NEXT_PUBLIC_TOKEN_FACTORY_ADDRESS=0x...
NEXT_PUBLIC_POSITION_MANAGER_ADDRESS=0x...
NEXT_PUBLIC_PRICE_FEED_ADDRESS=0x...

# 服务地址
NEXT_PUBLIC_API_URL=http://localhost:8080
NEXT_PUBLIC_MATCHING_ENGINE_URL=http://localhost:8081
NEXT_PUBLIC_WS_URL=ws://localhost:8080/ws

# 链配置
NEXT_PUBLIC_CHAIN_ID=84532
NEXT_PUBLIC_RPC_URL=https://base-sepolia.g.alchemy.com/v2/xxx

# 功能开关
NEXT_PUBLIC_USE_V2_TRADING=true
```

#### 后端 (.env)

```bash
# 数据库
DATABASE_URL=postgres://user:pass@localhost:5432/meme_perp

# Redis
REDIS_URL=redis://localhost:6379

# 区块链
BLOCKCHAIN_RPC=https://base-sepolia.g.alchemy.com/v2/xxx
BLOCKCHAIN_CHAIN_ID=84532
BLOCKCHAIN_PRIVATE_KEY=0x...

# 合约地址
SETTLEMENT_ADDRESS=0x...
POSITION_MANAGER_ADDRESS=0x...
VAULT_ADDRESS=0x...
LIQUIDATION_ADDRESS=0x...
FUNDING_RATE_ADDRESS=0x...
PRICE_FEED_ADDRESS=0x...

# 服务配置
API_PORT=8080
MATCHING_ENGINE_URL=http://localhost:8081
```

#### 撮合引擎 (.env)

```bash
# 链配置
RPC_URL=https://base-sepolia.g.alchemy.com/v2/xxx
CHAIN_ID=84532

# 合约
SETTLEMENT_ADDRESS=0x...
USDT_ADDRESS=0x...

# Matcher 账户 (代付 Gas)
MATCHER_PRIVATE_KEY=0x...

# 服务
LISTEN_PORT=8081
```

### 9.2 部署架构

```
                          ┌─────────────────┐
                          │   Cloudflare    │
                          │   (CDN + WAF)   │
                          └────────┬────────┘
                                   │
            ┌──────────────────────┼──────────────────────┐
            │                      │                      │
            ▼                      ▼                      ▼
    ┌───────────────┐     ┌───────────────┐     ┌───────────────┐
    │   Frontend    │     │   Backend     │     │   Matching    │
    │   (Vercel)    │     │   API         │     │   Engine      │
    │               │     │   (Docker)    │     │   (Docker)    │
    └───────────────┘     └───────┬───────┘     └───────┬───────┘
                                  │                     │
                          ┌───────┴───────┐             │
                          │               │             │
                          ▼               ▼             │
                   ┌──────────┐    ┌──────────┐        │
                   │PostgreSQL│    │  Redis   │        │
                   │          │    │          │        │
                   └──────────┘    └──────────┘        │
                                                       │
                          ┌────────────────────────────┘
                          │
                          ▼
                   ┌─────────────────────────────────────────┐
                   │         Base Sepolia Blockchain         │
                   │  (Settlement, TokenFactory, etc.)       │
                   └─────────────────────────────────────────┘
```

### 9.3 Docker Compose

```yaml
version: '3.8'
services:
  frontend:
    build: ./frontend
    ports:
      - "3000:3000"
    environment:
      - NEXT_PUBLIC_API_URL=http://backend:8080

  backend:
    build: ./backend
    ports:
      - "8080:8080"
    depends_on:
      - postgres
      - redis
    environment:
      - DATABASE_URL=postgres://user:pass@postgres:5432/meme_perp
      - REDIS_URL=redis://redis:6379

  matching-engine:
    build: ./backend/src/matching
    ports:
      - "8081:8081"
    environment:
      - SETTLEMENT_ADDRESS=${SETTLEMENT_ADDRESS}

  postgres:
    image: timescale/timescaledb:latest-pg14
    volumes:
      - postgres_data:/var/lib/postgresql/data

  redis:
    image: redis:7-alpine
    volumes:
      - redis_data:/data

volumes:
  postgres_data:
  redis_data:
```

---

## 10. 功能清单

### 10.1 已实现功能

#### 现货交易

| 功能 | 状态 | 说明 |
|------|------|------|
| 代币创建 | ✅ | Bonding Curve 发行 |
| 代币买卖 | ✅ | AMM 交易 |
| 代币毕业 | ✅ | 自动迁移到 DEX |
| 价格图表 | ✅ | K 线、深度图 |
| 交易历史 | ✅ | 实时更新 |

#### 永续合约

| 功能 | 状态 | 说明 |
|------|------|------|
| 开多/开空 | ✅ | 支持 1-100x 杠杆 |
| 市价单 | ✅ | 立即成交 |
| 限价单 | ✅ | 挂单等待成交 |
| 平仓 | ✅ | 全部/部分平仓 |
| 仓位显示 | ✅ | 入场价、杠杆、PnL |
| 强平机制 | ✅ | 自动强平 + 保险基金 |
| 资金费率 | ✅ | 每 4 小时结算 |

#### 高级订单 (撮合引擎)

| 功能 | 状态 | 说明 |
|------|------|------|
| Post-Only | ✅ | 只做 Maker |
| IOC/FOK | ✅ | 立即成交或取消 |
| 止盈止损 | ✅ | TP/SL 订单 |
| 追踪止损 | ✅ | Trailing Stop |
| 条件订单 | ✅ | 触发价订单 |
| OCO 订单 | ✅ | 二选一订单 |

#### 风险管理 (撮合引擎)

| 功能 | 状态 | 说明 |
|------|------|------|
| ADL | ✅ | 自动减仓 |
| 动态 MMR | ✅ | 根据仓位调整 |
| 100ms 风控 | ✅ | 高频风险检查 |
| 强平队列 | ✅ | 优先级排序 |
| 直接强平 | ✅ | 触发即强平，无延迟 |

#### 账户功能

| 功能 | 状态 | 说明 |
|------|------|------|
| 余额查询 | ✅ | 可用/锁定 |
| 存取款 | ✅ | USDT 存取 |
| 账单历史 | ✅ | 所有交易记录 |
| 推荐返佣 | ✅ | 30%/10% 二级返佣 |

### 10.2 功能适用性说明

以下功能在撮合引擎中已实现，但可能需要前端 UI 支持才能使用：

| 功能 | 前端 UI | 说明 |
|------|---------|------|
| 子账户 | ❌ | 需要账户管理页面 |
| 全仓模式 | ❌ | 需要模式切换 UI |
| 持仓模式 | ❌ | 需要单向/双向切换 |
| TWAP 订单 | ❌ | 需要高级订单表单 |
| 追踪止损 | ❌ | 需要设置弹窗 |
| OCO 订单 | ❌ | 需要组合订单 UI |

---

## 附录

### A. 合约地址 (Base Sepolia)

```
Settlement:        0xd84d1fFF3650ab4806B15A0D5F32932E80f0E32C
MockUSDT:          0x246c4A147F8b7Afb2b4b820284f11F5119553106
TokenFactory:      待部署
PositionManager:   待部署
PriceFeed:         待部署
Vault:             待部署
Liquidation:       待部署
FundingRate:       待部署
Reader:            待部署
SessionKeyManager: 待部署
```

### B. API 错误码

| 错误码 | 说明 |
|--------|------|
| 1001 | 参数错误 |
| 1002 | 签名验证失败 |
| 1003 | 余额不足 |
| 1004 | 仓位不存在 |
| 1005 | 订单不存在 |
| 2001 | 超过最大杠杆 |
| 2002 | 低于最小保证金 |
| 2003 | 超过持仓限制 |
| 3001 | 撮合失败 |
| 3002 | 订单已取消 |
| 3003 | 订单已成交 |

### C. WebSocket 消息类型

| 类型 | 方向 | 说明 |
|------|------|------|
| subscribe | 客户端→服务端 | 订阅频道 |
| unsubscribe | 客户端→服务端 | 取消订阅 |
| orderbook_update | 服务端→客户端 | 订单簿更新 |
| trade | 服务端→客户端 | 新成交 |
| position_update | 服务端→客户端 | 仓位变化 |
| order_update | 服务端→客户端 | 订单状态变化 |
| liquidation | 服务端→客户端 | 强平事件 |
| funding_rate | 服务端→客户端 | 资金费率更新 |

---

*文档结束*
