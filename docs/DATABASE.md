# 数据库设计文档

## 概述

本文档定义 MEME Perp DEX 的数据库架构设计，使用 PostgreSQL 作为主数据库，Redis 作为缓存和实时数据存储。

---

## 数据库架构

### 核心设计原则

1. **高性能**: 针对高频交易场景优化索引
2. **数据完整性**: 使用外键约束和事务确保一致性
3. **可扩展性**: 表分区支持海量历史数据
4. **审计追踪**: 关键表记录创建和更新时间

---

## 核心表结构

### 1. 交易对表 (instruments)

存储所有可交易的合约/交易对信息。

```sql
CREATE TABLE instruments (
    id SERIAL PRIMARY KEY,
    inst_id VARCHAR(32) UNIQUE NOT NULL,      -- 交易对ID，如 "MEME-BNB"
    inst_type VARCHAR(16) NOT NULL DEFAULT 'PERP',  -- SPOT/PERP
    base_ccy VARCHAR(16) NOT NULL,            -- 基础货币 (MEME)
    quote_ccy VARCHAR(16) NOT NULL,           -- 计价货币 (BNB)
    token_address VARCHAR(42),                -- Token 合约地址
    pool_address VARCHAR(42),                 -- AMM 池子地址
    position_manager_address VARCHAR(42),     -- 仓位管理合约地址
    ct_val DECIMAL(36, 18) DEFAULT 1,         -- 合约面值
    tick_sz DECIMAL(36, 18),                  -- 最小价格变动
    lot_sz DECIMAL(36, 18),                   -- 最小交易单位
    min_sz DECIMAL(36, 18),                   -- 最小下单量
    max_lv INT DEFAULT 100,                   -- 最大杠杆
    state VARCHAR(16) DEFAULT 'live',         -- live/suspend/preopen
    list_time BIGINT,                         -- 上线时间戳
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_instruments_inst_id ON instruments(inst_id);
CREATE INDEX idx_instruments_state ON instruments(state);
CREATE INDEX idx_instruments_base_ccy ON instruments(base_ccy);
```

### 2. 用户账户表 (accounts)

```sql
CREATE TABLE accounts (
    id SERIAL PRIMARY KEY,
    address VARCHAR(42) UNIQUE NOT NULL,      -- 钱包地址
    username VARCHAR(64),                     -- 可选用户名
    email VARCHAR(128),                       -- 可选邮箱
    referrer_id INT REFERENCES accounts(id),  -- 推荐人
    referral_code VARCHAR(16) UNIQUE,         -- 推荐码
    referral_level INT DEFAULT 1,             -- 推荐等级 (1-4)
    total_volume DECIMAL(36, 18) DEFAULT 0,   -- 累计交易量
    total_pnl DECIMAL(36, 18) DEFAULT 0,      -- 累计盈亏
    fee_tier INT DEFAULT 1,                   -- 手续费等级
    is_blocked BOOLEAN DEFAULT FALSE,         -- 是否封禁
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_accounts_address ON accounts(address);
CREATE INDEX idx_accounts_referral_code ON accounts(referral_code);
CREATE INDEX idx_accounts_referrer_id ON accounts(referrer_id);
```

### 3. 余额表 (balances)

```sql
CREATE TABLE balances (
    id SERIAL PRIMARY KEY,
    account_id INT NOT NULL REFERENCES accounts(id),
    ccy VARCHAR(16) NOT NULL,                 -- 币种 (BNB/MEME/USDT)
    available DECIMAL(36, 18) DEFAULT 0,      -- 可用余额
    frozen DECIMAL(36, 18) DEFAULT 0,         -- 冻结金额 (保证金)
    total DECIMAL(36, 18) GENERATED ALWAYS AS (available + frozen) STORED,
    updated_at TIMESTAMP DEFAULT NOW(),
    UNIQUE(account_id, ccy)
);

CREATE INDEX idx_balances_account_ccy ON balances(account_id, ccy);
```

### 4. 仓位表 (positions)

```sql
CREATE TABLE positions (
    id SERIAL PRIMARY KEY,
    position_id VARCHAR(32) UNIQUE NOT NULL,  -- 仓位唯一ID
    account_id INT NOT NULL REFERENCES accounts(id),
    inst_id VARCHAR(32) NOT NULL,             -- 交易对
    pos_side VARCHAR(8) NOT NULL,             -- long/short
    margin_mode VARCHAR(8) DEFAULT 'cross',   -- cross/isolated
    size DECIMAL(36, 18) NOT NULL,            -- 仓位大小 (合约张数)
    notional_value DECIMAL(36, 18) NOT NULL,  -- 名义价值 (BNB)
    avg_px DECIMAL(36, 18) NOT NULL,          -- 平均开仓价
    leverage INT NOT NULL,                    -- 杠杆倍数
    margin DECIMAL(36, 18) NOT NULL,          -- 保证金
    liq_px DECIMAL(36, 18),                   -- 清算价格
    mark_px DECIMAL(36, 18),                  -- 标记价格
    unrealized_pnl DECIMAL(36, 18) DEFAULT 0, -- 未实现盈亏
    realized_pnl DECIMAL(36, 18) DEFAULT 0,   -- 已实现盈亏
    funding_fee DECIMAL(36, 18) DEFAULT 0,    -- 累计资金费
    borrowed_amount DECIMAL(36, 18) DEFAULT 0, -- 借币数量 (做空)
    last_funding_ts BIGINT,                   -- 上次资金费时间
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_positions_account_inst ON positions(account_id, inst_id);
CREATE INDEX idx_positions_inst_id ON positions(inst_id);
CREATE INDEX idx_positions_pos_side ON positions(pos_side);
CREATE INDEX idx_positions_liq_px ON positions(liq_px);
```

### 5. 订单表 (orders)

```sql
CREATE TYPE order_status AS ENUM ('pending', 'open', 'partially_filled', 'filled', 'cancelled', 'expired', 'rejected');
CREATE TYPE order_type AS ENUM ('market', 'limit', 'stop', 'take_profit', 'stop_loss', 'trailing_stop');
CREATE TYPE order_side AS ENUM ('buy', 'sell');
CREATE TYPE position_side AS ENUM ('long', 'short', 'net');

CREATE TABLE orders (
    id SERIAL PRIMARY KEY,
    order_id VARCHAR(32) UNIQUE NOT NULL,     -- 订单唯一ID
    client_order_id VARCHAR(64),              -- 客户端订单ID
    account_id INT NOT NULL REFERENCES accounts(id),
    inst_id VARCHAR(32) NOT NULL,             -- 交易对
    side order_side NOT NULL,                 -- buy/sell
    pos_side position_side NOT NULL,          -- long/short/net
    ord_type order_type NOT NULL,             -- market/limit/stop...
    sz DECIMAL(36, 18) NOT NULL,              -- 委托数量
    px DECIMAL(36, 18),                       -- 委托价格 (limit)
    trigger_px DECIMAL(36, 18),               -- 触发价格 (stop)
    leverage INT NOT NULL DEFAULT 1,          -- 杠杆
    reduce_only BOOLEAN DEFAULT FALSE,        -- 是否只减仓
    time_in_force VARCHAR(8) DEFAULT 'GTC',   -- GTC/IOC/FOK
    status order_status DEFAULT 'pending',    -- 订单状态
    filled_sz DECIMAL(36, 18) DEFAULT 0,      -- 已成交数量
    avg_px DECIMAL(36, 18),                   -- 成交均价
    fee DECIMAL(36, 18) DEFAULT 0,            -- 手续费
    pnl DECIMAL(36, 18) DEFAULT 0,            -- 盈亏
    error_code VARCHAR(16),                   -- 错误码
    error_msg TEXT,                           -- 错误信息
    create_time BIGINT NOT NULL,              -- 创建时间戳
    update_time BIGINT NOT NULL,              -- 更新时间戳
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_orders_account_id ON orders(account_id);
CREATE INDEX idx_orders_inst_id ON orders(inst_id);
CREATE INDEX idx_orders_status ON orders(status);
CREATE INDEX idx_orders_create_time ON orders(create_time DESC);
CREATE INDEX idx_orders_ord_type ON orders(ord_type);
```

### 6. 成交记录表 (trades)

```sql
CREATE TABLE trades (
    id SERIAL PRIMARY KEY,
    trade_id VARCHAR(32) UNIQUE NOT NULL,     -- 成交唯一ID
    order_id VARCHAR(32) NOT NULL,            -- 关联订单ID
    account_id INT NOT NULL REFERENCES accounts(id),
    inst_id VARCHAR(32) NOT NULL,             -- 交易对
    side order_side NOT NULL,                 -- buy/sell
    pos_side position_side NOT NULL,          -- long/short
    sz DECIMAL(36, 18) NOT NULL,              -- 成交数量
    px DECIMAL(36, 18) NOT NULL,              -- 成交价格
    fee DECIMAL(36, 18) DEFAULT 0,            -- 手续费
    fee_ccy VARCHAR(16),                      -- 手续费币种
    pnl DECIMAL(36, 18) DEFAULT 0,            -- 盈亏
    fill_time BIGINT NOT NULL,                -- 成交时间戳
    tx_hash VARCHAR(66),                      -- 链上交易哈希
    block_number BIGINT,                      -- 区块号
    created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_trades_account_id ON trades(account_id);
CREATE INDEX idx_trades_inst_id ON trades(inst_id);
CREATE INDEX idx_trades_order_id ON trades(order_id);
CREATE INDEX idx_trades_fill_time ON trades(fill_time DESC);
CREATE INDEX idx_trades_tx_hash ON trades(tx_hash);

-- 按月分区以优化历史数据查询
-- CREATE TABLE trades_2026_01 PARTITION OF trades FOR VALUES FROM ('2026-01-01') TO ('2026-02-01');
```

### 7. K 线数据表 (candles)

```sql
CREATE TABLE candles (
    id SERIAL PRIMARY KEY,
    inst_id VARCHAR(32) NOT NULL,             -- 交易对
    bar VARCHAR(8) NOT NULL,                  -- 周期: 1m/5m/15m/1H/4H/1D
    ts BIGINT NOT NULL,                       -- 时间戳 (秒，周期起始)
    open DECIMAL(36, 18) NOT NULL,            -- 开盘价
    high DECIMAL(36, 18) NOT NULL,            -- 最高价
    low DECIMAL(36, 18) NOT NULL,             -- 最低价
    close DECIMAL(36, 18) NOT NULL,           -- 收盘价
    vol DECIMAL(36, 18) NOT NULL,             -- 交易量 (基础货币)
    vol_ccy DECIMAL(36, 18),                  -- 交易量 (计价货币)
    vol_ccy_quote DECIMAL(36, 18),            -- 交易额 (USD)
    confirm BOOLEAN DEFAULT FALSE,            -- K 线是否完结
    UNIQUE(inst_id, bar, ts)
);

CREATE INDEX idx_candles_inst_bar_ts ON candles(inst_id, bar, ts DESC);

-- 按月分区
-- CREATE TABLE candles_2026_01 PARTITION OF candles FOR VALUES FROM (1704067200) TO (1706745600);
```

### 8. 资金费率表 (funding_rates)

```sql
CREATE TABLE funding_rates (
    id SERIAL PRIMARY KEY,
    inst_id VARCHAR(32) NOT NULL,             -- 交易对
    funding_rate DECIMAL(18, 8) NOT NULL,     -- 资金费率
    realized_rate DECIMAL(18, 8),             -- 实际结算费率
    next_funding_rate DECIMAL(18, 8),         -- 预测下期费率
    funding_time BIGINT NOT NULL,             -- 结算时间戳
    created_at TIMESTAMP DEFAULT NOW(),
    UNIQUE(inst_id, funding_time)
);

CREATE INDEX idx_funding_rates_inst_time ON funding_rates(inst_id, funding_time DESC);
```

### 9. 账单记录表 (bills)

记录所有余额变动（交易、充值、提现、资金费等）。

```sql
CREATE TYPE bill_type AS ENUM (
    'deposit',       -- 充值
    'withdraw',      -- 提现
    'trade',         -- 交易
    'fee',           -- 手续费
    'funding',       -- 资金费
    'liquidation',   -- 清算
    'transfer',      -- 划转
    'rebate',        -- 返佣
    'reward',        -- 奖励
    'interest'       -- 利息
);

CREATE TABLE bills (
    id SERIAL PRIMARY KEY,
    bill_id VARCHAR(32) UNIQUE NOT NULL,      -- 账单ID
    account_id INT NOT NULL REFERENCES accounts(id),
    ccy VARCHAR(16) NOT NULL,                 -- 币种
    bill_type bill_type NOT NULL,             -- 账单类型
    amount DECIMAL(36, 18) NOT NULL,          -- 金额 (正为收入，负为支出)
    balance_before DECIMAL(36, 18),           -- 变动前余额
    balance_after DECIMAL(36, 18),            -- 变动后余额
    inst_id VARCHAR(32),                      -- 关联交易对 (交易/资金费时)
    order_id VARCHAR(32),                     -- 关联订单ID
    notes TEXT,                               -- 备注
    ts BIGINT NOT NULL,                       -- 发生时间戳
    created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_bills_account_id ON bills(account_id);
CREATE INDEX idx_bills_ts ON bills(ts DESC);
CREATE INDEX idx_bills_bill_type ON bills(bill_type);
CREATE INDEX idx_bills_inst_id ON bills(inst_id);
```

### 10. 内盘认购表 (presales)

```sql
CREATE TYPE presale_status AS ENUM ('pending', 'active', 'completed', 'cancelled', 'failed');

CREATE TABLE presales (
    id SERIAL PRIMARY KEY,
    presale_id VARCHAR(32) UNIQUE NOT NULL,   -- 内盘ID
    token_name VARCHAR(64) NOT NULL,          -- 代币名称
    token_symbol VARCHAR(16) NOT NULL,        -- 代币符号
    token_logo_url TEXT,                      -- Logo URL
    description TEXT,                         -- 描述
    creator_id INT REFERENCES accounts(id),   -- 创建者
    target_amount DECIMAL(36, 18) NOT NULL,   -- 目标募集金额 (BNB)
    raised_amount DECIMAL(36, 18) DEFAULT 0,  -- 已募集金额
    total_supply DECIMAL(36, 18) NOT NULL,    -- 代币总量
    min_subscription DECIMAL(36, 18),         -- 最小认购量
    max_subscription DECIMAL(36, 18),         -- 最大认购量 (每人)
    status presale_status DEFAULT 'pending',  -- 状态
    start_time TIMESTAMP NOT NULL,            -- 开始时间
    end_time TIMESTAMP,                       -- 结束时间
    activation_time TIMESTAMP,                -- 激活时间 (打满后)
    contract_address VARCHAR(42),             -- 部署后的合约地址
    pool_address VARCHAR(42),                 -- 部署后的池子地址
    tx_hash VARCHAR(66),                      -- 部署交易哈希
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_presales_status ON presales(status);
CREATE INDEX idx_presales_creator_id ON presales(creator_id);
CREATE INDEX idx_presales_start_time ON presales(start_time DESC);
```

### 11. 认购记录表 (subscriptions)

```sql
CREATE TYPE subscription_status AS ENUM ('active', 'refunded', 'claimed', 'cancelled');

CREATE TABLE subscriptions (
    id SERIAL PRIMARY KEY,
    subscription_id VARCHAR(32) UNIQUE NOT NULL,
    presale_id INT NOT NULL REFERENCES presales(id),
    account_id INT NOT NULL REFERENCES accounts(id),
    amount DECIMAL(36, 18) NOT NULL,          -- 认购金额 (BNB)
    token_amount DECIMAL(36, 18),             -- 分配代币数量
    status subscription_status DEFAULT 'active',
    subscribe_tx_hash VARCHAR(66),            -- 认购交易哈希
    refund_tx_hash VARCHAR(66),               -- 退款交易哈希
    claim_tx_hash VARCHAR(66),                -- 领取交易哈希
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW(),
    UNIQUE(presale_id, account_id)
);

CREATE INDEX idx_subscriptions_presale_id ON subscriptions(presale_id);
CREATE INDEX idx_subscriptions_account_id ON subscriptions(account_id);
CREATE INDEX idx_subscriptions_status ON subscriptions(status);
```

### 12. 推荐返佣表 (referral_rewards)

```sql
CREATE TABLE referral_rewards (
    id SERIAL PRIMARY KEY,
    reward_id VARCHAR(32) UNIQUE NOT NULL,
    referrer_id INT NOT NULL REFERENCES accounts(id),  -- 推荐人
    referee_id INT NOT NULL REFERENCES accounts(id),   -- 被推荐人
    trade_id VARCHAR(32),                     -- 关联成交ID
    order_id VARCHAR(32),                     -- 关联订单ID
    inst_id VARCHAR(32),                      -- 交易对
    trade_volume DECIMAL(36, 18),             -- 交易量
    trade_fee DECIMAL(36, 18),                -- 原手续费
    reward_amount DECIMAL(36, 18) NOT NULL,   -- 返佣金额
    reward_ccy VARCHAR(16) NOT NULL,          -- 返佣币种
    reward_rate DECIMAL(8, 4),                -- 返佣比例
    status VARCHAR(16) DEFAULT 'pending',     -- pending/paid/cancelled
    paid_at TIMESTAMP,                        -- 支付时间
    created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_referral_rewards_referrer_id ON referral_rewards(referrer_id);
CREATE INDEX idx_referral_rewards_referee_id ON referral_rewards(referee_id);
CREATE INDEX idx_referral_rewards_created_at ON referral_rewards(created_at DESC);
CREATE INDEX idx_referral_rewards_status ON referral_rewards(status);
```

---

## Redis 缓存设计

### Key 命名规范

```
{service}:{entity}:{identifier}:{field}
```

### 缓存数据

| Key Pattern | 数据类型 | 过期时间 | 说明 |
|-------------|----------|----------|------|
| `market:ticker:{instId}` | Hash | 60s | 行情数据 |
| `market:depth:{instId}` | Hash | 5s | 订单簿 |
| `market:trades:{instId}` | List | 300s | 最新成交 |
| `account:balance:{address}` | Hash | 30s | 余额缓存 |
| `account:positions:{address}` | Hash | 10s | 仓位缓存 |
| `order:pending:{instId}` | Sorted Set | - | 待成交订单 |
| `rate:limit:{address}:{api}` | String | 60s | API 限流 |
| `session:{sessionId}` | Hash | 24h | 登录会话 |

### Ticker 数据结构

```json
{
  "instId": "MEME-BNB",
  "last": "0.00000005",
  "open24h": "0.00000004",
  "high24h": "0.00000006",
  "low24h": "0.00000003",
  "vol24h": "1000000000",
  "volCcy24h": "50",
  "ts": 1704067200000
}
```

---

## 数据库索引策略

### 高频查询优化

1. **行情查询**: `instruments` 表按 `inst_id` 索引
2. **仓位查询**: `positions` 表按 `(account_id, inst_id)` 联合索引
3. **订单查询**: `orders` 表按 `(account_id, status)` 和 `create_time` 索引
4. **K 线查询**: `candles` 表按 `(inst_id, bar, ts)` 联合索引

### 分区策略

- `trades` 表: 按月分区
- `candles` 表: 按时间戳范围分区
- `bills` 表: 按月分区

---

## 数据一致性

### 交易原子性

```sql
BEGIN;
-- 1. 冻结保证金
UPDATE balances SET available = available - $margin, frozen = frozen + $margin
WHERE account_id = $aid AND ccy = 'BNB';

-- 2. 创建订单
INSERT INTO orders (...) VALUES (...);

-- 3. 创建仓位
INSERT INTO positions (...) VALUES (...);

-- 4. 记录账单
INSERT INTO bills (...) VALUES (...);
COMMIT;
```

### 资金费结算

```sql
BEGIN;
-- 批量更新仓位资金费
UPDATE positions SET
  funding_fee = funding_fee + calculated_fee,
  last_funding_ts = $ts
WHERE inst_id = $instId AND size > 0;

-- 批量更新余额
UPDATE balances SET
  available = available - calculated_fee
WHERE account_id IN (SELECT account_id FROM positions WHERE inst_id = $instId);

-- 记录账单
INSERT INTO bills (...) SELECT ...;
COMMIT;
```

---

## 监控指标

### 数据库监控

- 连接数
- 查询响应时间
- 慢查询日志
- 表大小和索引使用率
- 锁等待

### 业务监控

- 每分钟交易量
- 活跃用户数
- 订单成功率
- 清算数量

---

## 备份策略

### 备份计划

| 类型 | 频率 | 保留时间 |
|------|------|----------|
| 全量备份 | 每日 | 30 天 |
| 增量备份 | 每小时 | 7 天 |
| WAL 归档 | 实时 | 72 小时 |

### 恢复测试

每周执行一次备份恢复测试，确保数据可恢复。
