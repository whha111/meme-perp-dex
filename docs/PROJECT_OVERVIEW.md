# okb.fun - 项目总览文档

> **版本**: v2.0
> **日期**: 2025-01
> **定位**: Meme 全生命周期博弈平台 (The Meme Arena)

---

## 目录

1. [项目概述](#1-项目概述)
2. [核心创新](#2-核心创新)
3. [技术架构](#3-技术架构)
4. [功能模块](#4-功能模块)
5. [数据库设计](#5-数据库设计)
6. [智能合约](#6-智能合约)
7. [API 规范](#7-api-规范)
8. [开发技术栈](#8-开发技术栈)
9. [文档冗余分析](#9-文档冗余分析)
10. [问题与改进建议](#10-问题与改进建议)

---

## 1. 项目概述

### 1.1 项目定位

**okb.fun** 是一个去中心化 Meme 币博弈平台，区别于传统发射平台（如 pump.fun），核心创新在于：

| 特性 | 传统平台 (pump.fun) | okb.fun |
|------|-------------------|---------|
| 交易类型 | 仅现货 | 现货 + 永续合约 |
| 做空能力 | ❌ | ✅ |
| 冷启动流动性 | 虚拟池 | 桥接流动性模型 |
| 博弈方式 | 单边（只能做多） | 双边（多空博弈） |
| 庄家优势 | 高（散户无反制） | 降低（可做空对冲） |

### 1.2 目标用户

- **Meme 币投机者**：P小将，追求高波动高收益
- **高风险交易者**：利用杠杆放大收益
- **LP 被动收益用户**：存币赚取利息
- **套利者**：利用基差和资金费率套利

### 1.3 业务流程

```
┌─────────────────────────────────────────────────────────────────┐
│                     okb.fun 完整业务流程                          │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  创建 Token (一键发射，无需认购期)                                │
│      ↓                                                          │
│  ★ 立即开始交易 ★ (现货 + 永续合约同时可用)                       │
│      ↓                                                          │
│  ┌───────────────────────────────────────────────────────────┐ │
│  │  啃老期 (TVL: 0 → 50 ETH)                                  │ │
│  │                                                           │ │
│  │  现货池 (真实资金)        合约池 (虚拟资金)                  │ │
│  │  ┌─────────────┐       ┌─────────────┐                   │ │
│  │  │ Bonding Curve│◄────│   vAMM      │                   │ │
│  │  │ 虚拟池: 1 ETH │ 信用额度│ 借款上限:20%│                   │ │
│  │  │ TVL: 真实ETH │       │             │                   │ │
│  │  └─────────────┘       └─────────────┘                   │ │
│  │         ▲                    │                           │ │
│  │         └──── 吸血费率 ───────┘                           │ │
│  │              (合约费用 → 现货池)                           │ │
│  └───────────────────────────────────────────────────────────┘ │
│      ↓ TVL ≥ 50 ETH && 保险基金 ≥ 10 ETH                        │
│  毕业 & 分家                                                    │
│      ↓                                                          │
│  ┌───────────────────────────────────────────────────────────┐ │
│  │  独立期                                                   │ │
│  │  - 现货: 迁移到 DEX (Uniswap/PancakeSwap)                 │ │
│  │  - 合约: 独立运营，用保险基金                              │ │
│  └───────────────────────────────────────────────────────────┘ │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

**核心区别于 pump.fun**：创建即交易，无需等待，且同时支持现货和合约！

---

## 2. 核心创新

### 2.1 桥接流动性模型

解决传统平台的核心痛点：**虚拟池困境**

| 问题 | 描述 |
|------|------|
| 虚拟池太小 | 现货进入门槛低，但合约易被操控 |
| 虚拟池太大 | 合约稳定，但现货成本过高 |

**解决方案：信用额度模式**

```
合约池没有独立资金，而是拥有现货池的"信用额度"（最高20%）
- vAMM 代表现货池充当对手盘
- 合约盈利 → 从现货池借钱赔付
- 合约亏损 → 资金注入现货池
```

### 2.2 四道防线风控体系

| 防线 | 机制 | 目的 |
|------|------|------|
| 第一道 | 动态滑点 | 单边拥挤时增加开仓成本，劝退投机 |
| 第二道 | 吸血费率 | 持续消耗单边持仓者，为现货池输血 |
| 第三道 | 熔断 | 硬性限制，禁止加剧方向的新开仓 |
| 第四道 | ADL 自动减仓 | 最后防线，强制平仓保护现货池 |

### 2.3 吸血费率（拐点模型）

```
if (utilization <= 50%):
    rate = 0.01% + utilization × 0.02%
else:
    rate = 1% × e^(8 × (utilization - 50%))

关键特点：费率不是支付给对手盘，而是支付给现货池
```

| 资金使用率 | 费率/小时 | 费率/天 |
|-----------|----------|---------|
| 10% | 0.03% | 0.72% |
| 50% | 1.0% | 24% |
| 70% | 5.5% | 132% |
| 90% | 54.6% | 1310% |

---

## 3. 技术架构

### 3.1 系统架构图

```
┌─────────────────────────────────────────────────────────────────┐
│                           用户端                                 │
│     浏览器 / 移动端 App (Next.js + React)                        │
└─────────────────────────────────────────────────────────────────┘
                               │
                   ┌───────────┴───────────┐
                   │                       │
                   ▼                       ▼
┌─────────────────────────┐   ┌─────────────────────────┐
│     REST API            │   │     WebSocket           │
│   (Gin + Go)            │   │   实时推送              │
│                         │   │   - Ticker              │
│   - 市场数据            │   │   - K线                 │
│   - 账户信息            │   │   - 成交                │
│   - 交易下单            │   │   - 仓位                │
│   - 内盘认购            │   │   - 订单                │
└─────────────────────────┘   └─────────────────────────┘
                   │                       │
                   └───────────┬───────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────────┐
│                       业务服务层                                 │
│   ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐         │
│   │ 交易服务 │ │ 市场服务 │ │ 账户服务 │ │ K线服务  │         │
│   └──────────┘ └──────────┘ └──────────┘ └──────────┘         │
└─────────────────────────────────────────────────────────────────┘
                               │
            ┌──────────────────┼──────────────────┐
            │                  │                  │
            ▼                  ▼                  ▼
┌─────────────────┐ ┌─────────────────┐ ┌─────────────────┐
│   PostgreSQL    │ │     Redis       │ │   Blockchain    │
│   + TimescaleDB │ │   缓存 + 实时   │ │   Base/BSC      │
└─────────────────┘ └─────────────────┘ └─────────────────┘
                                               │
                                               ▼
┌─────────────────────────────────────────────────────────────────┐
│                       智能合约层                                 │
│   ┌────────────┐ ┌────────────┐ ┌────────────┐ ┌────────────┐  │
│   │PositionMgr │ │Liquidation │ │ FundingRate│ │    AMM     │  │
│   │  仓位管理  │ │  清算引擎  │ │  资金费率  │ │  现货交易  │  │
│   └────────────┘ └────────────┘ └────────────┘ └────────────┘  │
│   ┌────────────┐ ┌────────────┐ ┌────────────┐ ┌────────────┐  │
│   │   Vault    │ │LendingPool │ │  Presale   │ │ RiskManager│  │
│   │  保证金库  │ │  LP借贷池  │ │  内盘认购  │ │  风控管理  │  │
│   └────────────┘ └────────────┘ └────────────┘ └────────────┘  │
└─────────────────────────────────────────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────────┐
│                       Keeper 服务                                │
│   ┌────────────┐ ┌────────────┐ ┌────────────┐ ┌────────────┐  │
│   │ 清算 Keeper│ │ 订单 Keeper│ │资金费Keeper│ │ 索引 Keeper│  │
│   └────────────┘ └────────────┘ └────────────┘ └────────────┘  │
└─────────────────────────────────────────────────────────────────┘
```

### 3.2 目录结构

```
meme-perp-dex/
├── frontend/                    # Next.js 前端
│   ├── src/
│   │   ├── app/                 # 页面路由
│   │   ├── components/          # UI 组件 (50+)
│   │   ├── hooks/               # React Hooks (18个)
│   │   ├── lib/                 # 工具库 (25个文件)
│   │   ├── abis/                # 合约 ABI
│   │   └── config/              # 配置
│   └── messages/                # i18n 多语言
│
├── backend/                     # Go 后端
│   ├── cmd/
│   │   ├── api/                 # API 服务
│   │   ├── keeper/              # Keeper 服务
│   │   └── indexer/             # 索引服务
│   └── internal/
│       ├── api/                 # HTTP API
│       ├── service/             # 业务逻辑
│       ├── repository/          # 数据访问
│       ├── model/               # 数据模型
│       ├── keeper/              # Keeper 逻辑
│       ├── ws/                  # WebSocket
│       └── pkg/                 # 通用包
│
├── contracts/                   # Solidity 合约
│   ├── src/
│   │   ├── core/                # 核心合约 (13个)
│   │   ├── interfaces/          # 接口 (10个)
│   │   └── libraries/           # 工具库
│   ├── script/                  # 部署脚本
│   └── test/                    # 测试
│
└── docs/                        # 文档 (15个)
```

---

## 4. 功能模块

### 4.1 模块清单

| 模块 | 描述 | 状态 |
|------|------|------|
| **Token 创建** | 一键发射，立即开始交易 | ✅ 已设计 |
| **现货交易** | AMM 自动做市，Bonding Curve (初始虚拟池 1 ETH) | ✅ 已设计 |
| **永续合约** | 最高 50x 杠杆，多空交易，借用现货池信用额度 | ✅ 已设计 |
| **LP 借贷池** | 存 MEME 赚利息 | ✅ 已设计 |
| **止盈止损** | TP/SL + 追踪止损 | ✅ 已设计 |
| **限价单** | 挂单等待成交 | ✅ 已设计 |
| **资金费率** | 吸血费率（流向现货池） | ✅ 已设计 |
| **清算系统** | 自动清算 + ADL | ✅ 已设计 |
| **推荐返佣** | 邀请返佣 10-30% | ✅ 已设计 |
| **毕业迁移** | TVL ≥ 50 ETH 后迁移到 DEX | ✅ 已设计 |

**注意**：~~内盘认购~~ 已移除，采用 pump.fun 模式：创建即交易

### 4.2 核心参数

| 参数 | 值 | 说明 |
|------|-----|------|
| GRADUATION_THRESHOLD | 50 ETH | 毕业标准 |
| MAX_CREDIT_RATIO | 20% | 初始信用额度比例 |
| MAX_LEVERAGE | 50x | 最大杠杆 |
| FUNDING_INTERVAL | 4 小时 | 资金费率周期 |
| ADL_TRIGGER | 70% | ADL 触发阈值 |
| TWAP_WINDOW | 5 分钟 | 标记价格时间窗口 |

### 4.3 手续费结构

| 费用类型 | 费率 | 去向 |
|----------|------|------|
| 开仓手续费 | 0.05% | 平台 40% + LP 40% + 返佣 20% |
| 平仓手续费 | 0.05% | 同上 |
| 清算罚金 | 1% | 清算人 0.5% + 对手方 0.5% |
| 借贷利息 | 动态 | LP 池 |
| 吸血费率 | 动态 | 现货池 |

---

## 5. 数据库设计

### 5.1 核心表

| 表名 | 描述 | 主要字段 |
|------|------|----------|
| `instruments` | 交易对 | inst_id, base_ccy, quote_ccy, state |
| `accounts` | 用户账户 | address, referrer_id, referral_level |
| `balances` | 余额 | account_id, ccy, available, frozen |
| `positions` | 仓位 | account_id, inst_id, pos_side, size, leverage |
| `orders` | 订单 | order_id, side, ord_type, sz, px, status |
| `trades` | 成交 | trade_id, inst_id, px, sz, side |
| `candles` | K线 | inst_id, bar, ts, o, h, l, c, vol |
| `funding_rates` | 资金费率 | inst_id, funding_rate, funding_time |
| `tokens` | Token 信息 | name, symbol, creator, tvl, status |
| `bills` | 账单 | account_id, bill_type, amount, ts |
| `referral_rewards` | 返佣 | referrer_id, reward_amount |

### 5.2 索引策略

```sql
-- 高频查询优化
CREATE INDEX idx_positions_account_inst ON positions(account_id, inst_id);
CREATE INDEX idx_orders_account_status ON orders(account_id, status);
CREATE INDEX idx_candles_inst_bar_ts ON candles(inst_id, bar, ts DESC);
CREATE INDEX idx_trades_inst_ts ON trades(inst_id, fill_time DESC);

-- 分区策略
- trades: 按月分区
- candles: 按时间戳范围分区
- bills: 按月分区
```

### 5.3 Redis 缓存

| Key Pattern | 数据类型 | 过期时间 |
|-------------|----------|----------|
| `market:ticker:{instId}` | Hash | 60s |
| `market:depth:{instId}` | Hash | 5s |
| `account:balance:{address}` | Hash | 30s |
| `order:pending:{instId}` | Sorted Set | - |

---

## 6. 智能合约

### 6.1 合约架构

```
                      用户
                        │
                        ▼
            ┌─────────────────────┐
            │     Router.sol      │
            │   (统一交互入口)     │
            └─────────────────────┘
                        │
    ┌───────────────────┼───────────────────┐
    │                   │                   │
    ▼                   ▼                   ▼
┌────────────┐   ┌────────────┐   ┌────────────┐
│ Presale    │   │    AMM     │   │PositionMgr │
│ (内盘认购) │   │ (现货交易) │   │ (永续交易) │
└────────────┘   └────────────┘   └────────────┘
        │               │               │
        │  打满后初始化  │               │
        └──────────────►│               │
                        ▼               │
              ┌────────────┐           │
              │ PriceFeed  │◄──────────┤
              │ (价格聚合) │  (读取价格)
              └────────────┘
                        ▲
                        │ 交易后更新价格
                        │
┌────────────┐   ┌────────────┐   ┌────────────┐
│ MemeToken  │◄──│    AMM     │   │   Vault    │
│ (MEME代币) │   │  (储备金)  │   │ (保证金)   │
└────────────┘   └────────────┘   └────────────┘
        │                               │
        ▼                               │
┌────────────┐                          │
│LendingPool │◄─────────────────────────┘
│ (LP借贷)   │       (做空借币)
└────────────┘
```

### 6.2 核心合约列表

| 合约 | 文件 | 功能 |
|------|------|------|
| PositionManager | core/PositionManager.sol | 仓位管理（开仓、平仓） |
| Liquidation | core/Liquidation.sol | 清算引擎 |
| FundingRate | core/FundingRate.sol | 资金费率结算 |
| Vault | core/Vault.sol | BNB 保证金托管 |
| AMM | core/AMM.sol | 现货交易 + 定价 |
| LendingPool | core/LendingPool.sol | LP 存币借贷 |
| TokenFactory | core/TokenFactory.sol | Token 创建工厂 |
| PriceFeed | core/PriceFeed.sol | 价格聚合 + TWAP |
| RiskManager | core/RiskManager.sol | 风控参数管理 |
| Router | core/Router.sol | 统一交互入口 |

### 6.3 合约接口示例

```solidity
interface IPositionManager {
    function openLong(uint256 size, uint256 leverage) external;
    function openShort(uint256 size, uint256 leverage) external;
    function closePosition() external;
    function getPosition(address user) external view returns (Position memory);
    function getUnrealizedPnL(address user) external view returns (int256);
    function getLiquidationPrice(address user) external view returns (uint256);
}
```

---

## 7. API 规范

### 7.1 基础信息

| 项目 | 规范 |
|------|------|
| 基础 URL | `https://api.okb.fun/api/v1` |
| 数据格式 | JSON |
| 时间格式 | Unix 时间戳（毫秒） |

### 7.2 响应格式

```json
{
    "code": 0,
    "msg": "success",
    "data": { ... }
}
```

### 7.3 核心端点

**市场数据**
```
GET  /market/instruments      # 获取交易对
GET  /market/ticker           # 获取行情
GET  /market/candles          # 获取K线
GET  /market/trades           # 获取成交
GET  /market/funding-rate     # 获取资金费率
```

**交易**
```
POST /trade/order             # 下单
POST /trade/close-position    # 平仓
POST /trade/cancel-order      # 撤单
GET  /trade/orders-pending    # 获取挂单
```

**账户**
```
GET  /account/balance         # 获取余额
GET  /account/positions       # 获取仓位
GET  /account/bills           # 获取账单
```

### 7.4 WebSocket

**连接**: `wss://ws.okb.fun/ws/v1`

**订阅频道**
```json
{
    "op": "subscribe",
    "args": [
        { "channel": "tickers", "instId": "PEPE-ETH" },
        { "channel": "candle1m", "instId": "PEPE-ETH" }
    ]
}
```

| 频道 | 说明 |
|------|------|
| tickers | 行情推送 |
| candle{period} | K线 (1m/5m/15m/1H/4H/1D) |
| trades | 成交推送 |
| positions | 仓位推送 (需认证) |
| orders | 订单推送 (需认证) |
| funding-rate | 资金费推送 |

---

## 8. 开发技术栈

### 8.1 前端

| 技术 | 版本 | 用途 |
|------|------|------|
| Next.js | 14.2.0 | 框架 |
| React | 18.3.0 | UI |
| TypeScript | 5.4.0 | 类型 |
| Zustand | 5.0.9 | 状态管理 |
| TanStack Query | 5.40.0 | 数据获取 |
| Wagmi | 2.9.0 | Web3 连接 |
| Viem | 2.13.0 | 以太坊交互 |
| RainbowKit | 2.1.0 | 钱包 UI |
| Tailwind CSS | 3.4.3 | 样式 |
| Lightweight Charts | 4.1.0 | K线图表 |
| next-intl | 4.7.0 | 国际化 |

### 8.2 后端

| 技术 | 版本 | 用途 |
|------|------|------|
| Go | 1.22+ | 语言 |
| Gin | - | Web 框架 |
| GORM | - | ORM |
| PostgreSQL | 16+ | 主数据库 |
| TimescaleDB | - | 时序数据 |
| Redis | 7+ | 缓存 |
| Gorilla WebSocket | - | 实时推送 |

### 8.3 智能合约

| 技术 | 版本 | 用途 |
|------|------|------|
| Solidity | 0.8.20 | 语言 |
| Foundry | - | 开发框架 |
| OpenZeppelin | - | 安全库 |
| Forge | - | 测试 |

### 8.4 基础设施

| 技术 | 用途 |
|------|------|
| Docker | 容器化 |
| Base Chain | 测试网 |
| BSC Chain | 生产网 |

---

## 9. 文档冗余分析

### 9.1 现有文档清单

| 文档 | 大小 | 内容 | 状态 |
|------|------|------|------|
| PRD.md | 20KB | 产品需求 | ⚠️ 部分过时 |
| ARCHITECTURE.md | 21KB | 系统架构 | ⚠️ 与 SYSTEM_ARCHITECTURE 重复 |
| SYSTEM_ARCHITECTURE.md | 66KB | 详细架构 | ⚠️ 过于详细，需精简 |
| API_SPECIFICATION.md | 35KB | API v1 | ⚠️ 与 v2 重复 |
| API_SPECIFICATION_V2.md | 15KB | API v2 | ✅ 保留 |
| DATABASE.md | 18KB | 数据库设计 | ✅ 保留 |
| CONTRACTS.md | 27KB | 合约接口 | ✅ 保留 |
| CONTRACTS_INTERFACE.md | 19KB | 合约接口 | ⚠️ 与 CONTRACTS 重复 |
| PERP_MECHANISM.md | 17KB | 永续合约机制 | ✅ **核心文档** |
| PLAN.md | 18KB | 重构计划 | ⚠️ 已过时 |
| TECHNICAL.md | 54KB | 技术细节 | ⚠️ 太详细 |
| DEVELOPMENT_STANDARDS.md | 30KB | 开发规范 | ✅ 保留 |
| BACKEND_INTEGRATION.md | 16KB | 后端集成 | ✅ 保留 |
| ROADMAP.md | 9KB | 路线图 | ⚠️ 需更新 |

### 9.2 建议合并/删除

| 操作 | 文档 | 原因 |
|------|------|------|
| **合并** | ARCHITECTURE + SYSTEM_ARCHITECTURE | 内容重复 |
| **合并** | API_SPECIFICATION + V2 | 保留 V2 |
| **合并** | CONTRACTS + CONTRACTS_INTERFACE | 内容重复 |
| **删除** | PLAN.md (根目录) | 已过时 |
| **更新** | PRD.md | 添加桥接流动性模型 |
| **精简** | TECHNICAL.md | 太详细，提取关键部分 |

### 9.3 推荐文档结构

```
docs/
├── PROJECT_OVERVIEW.md      # 项目总览 (本文档)
├── PRD.md                   # 产品需求 (更新)
├── PERP_MECHANISM.md        # 永续合约机制 (核心)
├── ARCHITECTURE.md          # 系统架构 (合并)
├── API_SPECIFICATION.md     # API 规范 (V2)
├── DATABASE.md              # 数据库设计
├── CONTRACTS.md             # 智能合约 (合并)
├── DEVELOPMENT_STANDARDS.md # 开发规范
└── DEPLOYMENT.md            # 部署指南 (新建)
```

---

## 10. 问题与改进建议

### 10.1 功能层面问题

| 问题 | 描述 | 建议 |
|------|------|------|
| **内盘认购模块多余** | 采用 pump.fun 模式，不需要认购期 | 删除 Presale 合约和相关代码 |
| **AA 钱包未实现** | 文档提及账户抽象，但代码未实现 | 如暂不实现，从 PRD 移除 |
| **OrderBook 过度设计** | 早期不需要复杂订单簿 | 简化为基础限价单 |
| **追踪止损复杂** | 链上实现成本高 | 考虑后端实现 |
| **推荐返佣未集成** | 合约有接口，前后端未完整实现 | 需要完整集成 |

### 10.2 技术层面问题

| 问题 | 描述 | 建议 |
|------|------|------|
| **前端组件过多** | 50+ 组件，部分未使用 | 清理未使用组件 |
| **API 版本混乱** | 有 v1 和 v2 两套规范 | 统一为 v1 |
| **数据库表重复设计** | DATABASE.md 和 API_SPECIFICATION 都有表定义 | 统一到 DATABASE.md |
| **Mock 数据过多** | InstrumentSelector 使用 Mock 数据 | 替换为真实 API |

### 10.3 架构层面问题

| 问题 | 描述 | 建议 |
|------|------|------|
| **Keeper 服务分散** | 清算/订单/资金费分开 | 考虑合并或微服务化 |
| **缺少监控** | 没有 Prometheus/Grafana | 添加监控方案 |
| **缺少错误追踪** | 没有 Sentry 集成 | 添加错误追踪 |

### 10.4 文档层面问题

| 问题 | 描述 | 建议 |
|------|------|------|
| **文档分散** | 15 个文档，内容重复 | 合并为 8 个核心文档 |
| **PRD 过时** | 未包含桥接流动性模型 | 更新 PRD |
| **缺少部署文档** | 没有 Docker/K8s 部署指南 | 新建 DEPLOYMENT.md |
| **代码与文档不一致** | 部分合约接口与文档不符 | 同步更新 |

### 10.5 需要删除/移除的功能

**A. 域名相关功能（根据 PLAN.md）**

| 功能 | 描述 | 状态 |
|------|------|------|
| `/token/[domain]` 路由 | 域名详情页 | 应删除 |
| `useDomainTagsStream` | 域名标签流 | 应删除 |
| `useDomainMetrics` | 域名指标 | 应删除 |
| `DomainCard` | 域名卡片 | 应删除 |
| DNS 验证服务 | 后端域名验证 | 应删除 |
| `DomainRegistry.sol` | 域名注册合约 | 应删除 |

**B. 内盘认购功能（采用 pump.fun 即时交易模式）**

| 功能 | 描述 | 状态 |
|------|------|------|
| `Presale.sol` | 内盘认购合约 | 应删除/重构为 TokenFactory |
| `/presale/[id]` 路由 | 认购详情页 | 应删除 |
| `/create` 页面中的认购逻辑 | 募集/认购流程 | 应改为一键发射 |
| `presales` 表 | 数据库表 | 应删除 |
| `subscriptions` 表 | 认购记录表 | 应删除 |
| 后端认购相关 API | subscribe/refund/claim | 应删除 |

### 10.6 优先级建议

**P0 - 必须修复**
1. 更新 PRD.md 添加桥接流动性模型
2. 统一 API 规范为一个版本
3. 删除未使用的域名相关代码
4. 前端 Mock 数据替换为真实 API

**P1 - 重要**
1. 合并重复文档
2. 完成推荐返佣功能集成
3. 添加部署文档

**P2 - 改进**
1. 清理未使用组件
2. 添加监控和错误追踪
3. 优化 Keeper 服务架构

---

## 附录

### A. 相关文档链接

| 文档 | 描述 |
|------|------|
| [PERP_MECHANISM.md](./PERP_MECHANISM.md) | 永续合约机制详解 |
| [DATABASE.md](./DATABASE.md) | 数据库设计 |
| [API_SPECIFICATION.md](./API_SPECIFICATION.md) | API 规范 |
| [CONTRACTS.md](./CONTRACTS.md) | 智能合约接口 |
| [DEVELOPMENT_STANDARDS.md](./DEVELOPMENT_STANDARDS.md) | 开发规范 |

### B. 更新日志

| 版本 | 日期 | 变更 |
|------|------|------|
| v2.0 | 2025-01-20 | 合并所有文档，添加分析和建议 |
| v1.0 | 2025-01-19 | 初始版本 |

---

*本文档整合自项目所有现有文档，作为项目的统一参考文档*
