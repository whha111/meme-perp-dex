# P2P 永续合约优化方案

> 最后更新: 2026-01-26

## 目录

1. [当前架构](#当前架构)
2. [待优化功能](#待优化功能)
3. [功能详细设计](#功能详细设计)
4. [实现优先级](#实现优先级)
5. [技术细节](#技术细节)

---

## 当前架构

### 系统概述

```
┌─────────────────────────────────────────────────────────────┐
│                        P2P 永续合约系统                       │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│   用户A (多)  ◄──────────────────────────►  用户B (空)       │
│       │                                         │           │
│       │         ┌───────────────────┐          │           │
│       └────────►│   Matching Engine │◄─────────┘           │
│                 │     (撮合引擎)     │                       │
│                 └─────────┬─────────┘                       │
│                           │                                 │
│                           ▼                                 │
│                 ┌───────────────────┐                       │
│                 │    Settlement     │                       │
│                 │    (结算合约)      │                       │
│                 └───────────────────┘                       │
│                                                             │
│   A的盈利 = B的亏损  |  A的亏损 = B的盈利                     │
│   系统永远平衡，零协议风险                                    │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### 已实现功能

| 模块 | 功能 | 状态 |
|------|------|------|
| 合约 | Settlement 结算合约 | ✅ 完成 |
| 合约 | EIP-712 签名验证 | ✅ 完成 |
| 合约 | 资金费率结算 | ✅ 完成 |
| 后端 | 撮合引擎 | ✅ 完成 |
| 后端 | 订单簿管理 | ✅ 完成 |
| 后端 | WebSocket 推送 | ✅ 完成 |
| 前端 | 签名派生交易钱包 | ✅ 完成 |
| 前端 | 下单面板 (市价/限价) | ✅ 完成 |
| 前端 | K线图表 | ✅ 完成 |
| 前端 | 订单簿显示 | ✅ 完成 |

### 核心文件位置

```
contracts/
└── src/core/
    └── Settlement.sol          # 结算合约

backend/
└── src/matching/
    ├── engine.ts               # 撮合引擎
    └── server.ts               # HTTP/WS 服务

frontend/
└── src/
    ├── hooks/
    │   ├── usePerpetualV2.ts   # 永续交易 Hook
    │   └── useTradingWallet.ts # 交易钱包 Hook
    └── components/trading/
        ├── PerpetualOrderPanelV2.tsx  # 下单面板
        ├── OrderBook.tsx              # 订单簿
        └── PerpetualPriceChart.tsx    # K线图表
```

---

## 待优化功能

### 功能清单

| 优先级 | 功能 | 目的 | 复杂度 |
|--------|------|------|--------|
| P0 | 做市商激励 | 吸引做市商提供流动性 | 中 |
| P0 | 订单簿深度优化 | 更好的买卖盘显示 | 低 |
| P1 | 限价单管理 | 用户挂单、撤单 | 中 |
| P1 | 交易挖矿 | 激励用户交易 | 高 |
| P2 | 等待时间提示 | 显示预估成交时间 | 低 |
| P2 | 做市商面板 | 专业做市商工具 | 高 |

---

## 功能详细设计

### 1. 做市商激励系统

#### 1.1 目标

吸引做市商 (Market Maker) 持续挂单，提供流动性。

#### 1.2 激励机制

```
┌─────────────────────────────────────────────────────────────┐
│                      费率结构                                │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│   Taker (吃单方): 支付 0.05% 手续费                          │
│   Maker (挂单方): 获得 0.02% 返佣                            │
│                                                             │
│   示例:                                                     │
│   - 用户A 挂限价单 (Maker)                                  │
│   - 用户B 市价单成交 (Taker)                                │
│   - 用户B 支付 0.05% = $5 (假设成交 $10,000)                │
│   - 用户A 获得 0.02% = $2 返佣                              │
│   - 平台收入 0.03% = $3                                     │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

#### 1.3 合约修改

```solidity
// Settlement.sol 新增

// 费率配置
uint256 public takerFeeRate = 50;   // 0.05% (基点)
uint256 public makerRebateRate = 20; // 0.02% 返佣

// 做市商累计返佣
mapping(address => uint256) public makerRebates;

// 结算时计算费用
function _settleFees(
    address maker,
    address taker,
    uint256 size
) internal {
    uint256 takerFee = size * takerFeeRate / 100000;
    uint256 makerRebate = size * makerRebateRate / 100000;

    // Taker 支付费用
    balances[taker].available -= takerFee;

    // Maker 获得返佣
    makerRebates[maker] += makerRebate;

    // 平台收入
    uint256 platformFee = takerFee - makerRebate;
    balances[feeReceiver].available += platformFee;
}

// 提取返佣
function claimRebates() external {
    uint256 amount = makerRebates[msg.sender];
    require(amount > 0, "No rebates");
    makerRebates[msg.sender] = 0;
    balances[msg.sender].available += amount;
}
```

#### 1.4 前端显示

```
┌─────────────────────────────────────────┐
│  Fee Structure                          │
├─────────────────────────────────────────┤
│  Taker Fee:     0.05%                   │
│  Maker Rebate:  0.02%                   │
│                                         │
│  Your Pending Rebates: $123.45          │
│  [Claim Rebates]                        │
└─────────────────────────────────────────┘
```

---

### 2. 订单簿深度优化

#### 2.1 目标

- 显示更多价格档位
- 显示深度图 (Depth Chart)
- 实时更新动画

#### 2.2 UI 设计

```
┌─────────────────────────────────────────┐
│  Order Book                    [Depth]  │
├───────────────────┬─────────────────────┤
│  Price    Size    │    Size    Price    │
├───────────────────┼─────────────────────┤
│                   │  ████  50   $2005   │
│                   │  ██    20   $2004   │
│                   │  ███   35   $2003   │
│                   │  █████ 80   $2002   │
│                   │  ██    25   $2001   │
├───────────────────┼─────────────────────┤
│         Spread: $2 (0.1%)               │
├───────────────────┼─────────────────────┤
│  $1999   30  ██   │                     │
│  $1998   45  ███  │                     │
│  $1997   60  ████ │                     │
│  $1996   25  ██   │                     │
│  $1995   90  █████│                     │
└───────────────────┴─────────────────────┘
```

#### 2.3 深度图

```
┌─────────────────────────────────────────┐
│              Depth Chart                │
│                                         │
│  Bids                          Asks     │
│                    │                    │
│  ██████████        │         ██████████ │
│  ████████          │           ████████ │
│  ██████            │             ██████ │
│  ████              │               ████ │
│  ──────────────────┼────────────────────│
│        $1990    $2000    $2010          │
└─────────────────────────────────────────┘
```

#### 2.4 技术实现

```typescript
// 订单簿聚合
interface OrderBookLevel {
  price: string;
  size: string;
  total: string;      // 累计深度
  percentage: number; // 占比 (用于宽度)
}

// 深度图数据
interface DepthData {
  bids: { price: number; cumulative: number }[];
  asks: { price: number; cumulative: number }[];
}
```

---

### 3. 限价单管理

#### 3.1 目标

用户可以：
- 查看所有挂单
- 修改订单价格/数量
- 取消订单

#### 3.2 UI 设计

```
┌─────────────────────────────────────────────────────────────┐
│  Open Orders                                                │
├─────────────────────────────────────────────────────────────┤
│  Side   Price     Size    Filled    Status    Actions       │
├─────────────────────────────────────────────────────────────┤
│  Long   $2001     10 ETH  0/10      Pending   [Edit][Cancel]│
│  Short  $1995     5 ETH   2/5       Partial   [Edit][Cancel]│
│  Long   $2010     20 ETH  0/20      Pending   [Edit][Cancel]│
├─────────────────────────────────────────────────────────────┤
│                                      [Cancel All]           │
└─────────────────────────────────────────────────────────────┘
```

#### 3.3 后端 API

```typescript
// 新增 API 端点

// 获取用户订单
GET /api/orders?user={address}

// 取消订单
POST /api/orders/{orderId}/cancel
{
  "signature": "0x..."  // 用户签名确认
}

// 修改订单
POST /api/orders/{orderId}/amend
{
  "newPrice": "2005",
  "newSize": "15",
  "signature": "0x..."
}
```

#### 3.4 签名消息

```typescript
const CANCEL_ORDER_TYPEHASH = keccak256(
  "CancelOrder(bytes32 orderId,uint256 nonce)"
);

const AMEND_ORDER_TYPEHASH = keccak256(
  "AmendOrder(bytes32 orderId,uint256 newPrice,uint256 newSize,uint256 nonce)"
);
```

---

### 4. 交易挖矿

#### 4.1 目标

激励用户交易，分发平台代币。

#### 4.2 机制设计

```
┌─────────────────────────────────────────────────────────────┐
│                    交易挖矿规则                               │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  每日挖矿池: 10,000 MEME 代币                                │
│                                                             │
│  分配规则:                                                  │
│  - 用户交易量占比 = 用户分配比例                             │
│  - Maker 订单权重 2x                                        │
│  - Taker 订单权重 1x                                        │
│                                                             │
│  示例:                                                      │
│  - 用户A 做市交易 $100,000 → 权重 200,000                   │
│  - 用户B 吃单交易 $50,000  → 权重 50,000                    │
│  - 总权重: 250,000                                          │
│  - 用户A 获得: 10,000 * 200,000/250,000 = 8,000 MEME       │
│  - 用户B 获得: 10,000 * 50,000/250,000 = 2,000 MEME        │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

#### 4.3 合约设计

```solidity
// TradingRewards.sol

contract TradingRewards {
    IERC20 public rewardToken;

    // 每日奖励池
    uint256 public dailyRewardPool = 10000 * 1e18;

    // 用户每日交易权重
    mapping(uint256 => mapping(address => uint256)) public dailyVolume;
    // day => user => weighted volume

    // 每日总权重
    mapping(uint256 => uint256) public dailyTotalVolume;

    // 记录交易
    function recordTrade(
        address user,
        uint256 volume,
        bool isMaker
    ) external onlySettlement {
        uint256 day = block.timestamp / 1 days;
        uint256 weight = isMaker ? volume * 2 : volume;

        dailyVolume[day][user] += weight;
        dailyTotalVolume[day] += weight;
    }

    // 领取奖励
    function claimRewards(uint256 day) external {
        require(day < block.timestamp / 1 days, "Day not ended");

        uint256 userVolume = dailyVolume[day][msg.sender];
        require(userVolume > 0, "No volume");

        uint256 reward = dailyRewardPool * userVolume / dailyTotalVolume[day];
        dailyVolume[day][msg.sender] = 0;

        rewardToken.transfer(msg.sender, reward);
    }
}
```

#### 4.4 前端显示

```
┌─────────────────────────────────────────┐
│  Trading Rewards                        │
├─────────────────────────────────────────┤
│  Today's Pool:    10,000 MEME           │
│  Your Volume:     $50,000 (2x)          │
│  Est. Reward:     ~500 MEME             │
│                                         │
│  Yesterday:       800 MEME [Claim]      │
│  Total Claimed:   5,000 MEME            │
└─────────────────────────────────────────┘
```

---

### 5. 等待时间提示

#### 5.1 目标

告诉用户订单预计多久成交。

#### 5.2 计算方法

```typescript
function estimateWaitTime(order: Order): string {
  const orderBook = getOrderBook(order.token);

  // 市价单
  if (order.type === 'market') {
    const availableLiquidity = order.isLong
      ? orderBook.asks.reduce((sum, o) => sum + o.size, 0)
      : orderBook.bids.reduce((sum, o) => sum + o.size, 0);

    if (availableLiquidity >= order.size) {
      return "Instant";
    } else {
      return "Waiting for counterparty...";
    }
  }

  // 限价单
  const spread = orderBook.asks[0].price - orderBook.bids[0].price;
  const distanceFromMid = Math.abs(order.price - (orderBook.asks[0].price + orderBook.bids[0].price) / 2);

  if (distanceFromMid < spread * 0.5) {
    return "< 1 min";
  } else if (distanceFromMid < spread * 2) {
    return "1-5 min";
  } else {
    return "May take longer";
  }
}
```

#### 5.3 UI 显示

```
┌─────────────────────────────────────────┐
│  Order Preview                          │
├─────────────────────────────────────────┤
│  Type:      Market Long                 │
│  Size:      10 ETH                      │
│  Est. Price: $2,001.50                  │
│  Fee:       $1.00 (0.05%)               │
│                                         │
│  ⏱️ Est. Fill Time: Instant             │
│                                         │
│  [Confirm Order]                        │
└─────────────────────────────────────────┘
```

---

### 6. 做市商面板

#### 6.1 目标

为专业做市商提供高效工具。

#### 6.2 功能

- 批量挂单
- 自动对冲
- 价差设置
- 库存管理
- API 密钥管理

#### 6.3 UI 设计

```
┌─────────────────────────────────────────────────────────────┐
│  Market Maker Dashboard                                     │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  Spread Settings                                            │
│  ┌─────────────────────────────────────────────────────┐    │
│  │  Bid Spread: [-0.1%]  Ask Spread: [+0.1%]           │    │
│  │  Order Size: [5 ETH]  Levels: [5]                   │    │
│  │  [Apply]                                            │    │
│  └─────────────────────────────────────────────────────┘    │
│                                                             │
│  Current Orders                                             │
│  ┌─────────────────────────────────────────────────────┐    │
│  │  Bids                    │    Asks                  │    │
│  │  $1999 - 5 ETH           │    $2001 - 5 ETH        │    │
│  │  $1998 - 5 ETH           │    $2002 - 5 ETH        │    │
│  │  $1997 - 5 ETH           │    $2003 - 5 ETH        │    │
│  └─────────────────────────────────────────────────────┘    │
│                                                             │
│  Inventory                                                  │
│  ┌─────────────────────────────────────────────────────┐    │
│  │  Net Position: +15 ETH (Long)                       │    │
│  │  PnL: +$1,234.56                                    │    │
│  │  [Flatten Position]                                 │    │
│  └─────────────────────────────────────────────────────┘    │
│                                                             │
│  Statistics                                                 │
│  ┌─────────────────────────────────────────────────────┐    │
│  │  24h Volume: $500,000                               │    │
│  │  Rebates Earned: $100.00                            │    │
│  │  Fill Rate: 85%                                     │    │
│  └─────────────────────────────────────────────────────┘    │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

---

## 实现优先级

### Phase 1 (1-2 周)

| 功能 | 工作量 | 负责模块 |
|------|--------|----------|
| 做市商激励 (费率) | 2天 | 合约 + 前端 |
| 订单簿深度优化 | 2天 | 前端 |
| 返佣提取功能 | 1天 | 合约 + 前端 |

### Phase 2 (2-3 周)

| 功能 | 工作量 | 负责模块 |
|------|--------|----------|
| 限价单管理 | 3天 | 后端 + 前端 |
| 订单修改/取消 | 2天 | 后端 + 前端 |
| 等待时间提示 | 1天 | 前端 |

### Phase 3 (3-4 周)

| 功能 | 工作量 | 负责模块 |
|------|--------|----------|
| 交易挖矿合约 | 3天 | 合约 |
| 交易挖矿前端 | 2天 | 前端 |
| 做市商面板 | 5天 | 前端 |

---

## 技术细节

### 合约地址 (Base Sepolia)

```
Settlement:       0xB06C32C7536EC5EAD101fEe2AD4005a5eedcB258
TokenFactory:     0xCfDCD9F8D39411cF855121331B09aef1C88dc056
ContractRegistry: 0x8f6277275c4e11A42b3928B55e5653bB694D5A61
USDT:             0x2251A4dD878a0AF6d18B5F0CAE7FDF9fe85D8324
```

### API 端点 (后端)

```
撮合引擎:  http://localhost:8081
  POST /api/order          # 提交订单
  GET  /api/orderbook      # 获取订单簿
  GET  /api/trades         # 获取成交记录
  WS   /ws                 # WebSocket 推送
```

### 前端技术栈

```
Next.js 14 + TypeScript
wagmi + viem (Web3)
TanStack Query (数据获取)
Zustand (状态管理)
TradingView (图表)
```

---

## 附录

### A. 费率对比

| 平台 | Taker | Maker |
|------|-------|-------|
| Binance Futures | 0.04% | 0.02% |
| Bybit | 0.06% | 0.01% |
| GMX | 0.1% | 0.1% |
| dYdX | 0.05% | 0% |
| **MemePerp (建议)** | **0.05%** | **-0.02%** |

### B. 冷启动策略

1. **团队做市** - 团队账户双向挂单
2. **做市商招募** - 联系专业做市商
3. **高返佣期** - 前3个月 Maker 返佣 0.03%
4. **交易大赛** - 交易量排名奖励

### C. 风险提示

- 纯 P2P 模式下，订单可能需要等待对手方
- 深度不足时，大单可能无法立即成交
- 限价单可能永远不成交
