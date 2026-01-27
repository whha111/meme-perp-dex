# 技术实现文档

## 目录
1. [价格系统](#一价格系统)
2. [K线系统](#二k线系统)
3. [市值计算](#三市值计算)
4. [实时数据推送](#四实时数据推送)
5. [清算系统](#五清算系统)
6. [资金费率系统](#六资金费率系统)
7. [订单撮合系统](#七订单撮合系统)
8. [Keeper 机器人](#八keeper-机器人)
9. [数据索引系统](#九数据索引系统)
10. [前端技术方案](#十前端技术方案)

---

## 业务流程说明

```
┌─────────────────────────────────────────────────────────────┐
│                      完整业务流程                            │
└─────────────────────────────────────────────────────────────┘

阶段一：内盘认购
├── 用户存入 BNB 认购 MEME 代币
├── 可退款，未打满自动退款
└── 打满 50 BNB 后进入下一阶段

阶段二：同时开启 现货交易 + 永续合约交易
├── 现货交易（AMM）
│   ├── 初始流动性 = 50 BNB + MEME
│   ├── 用户可以买卖 MEME
│   └── 价格由现货交易驱动
│
├── 永续合约交易
│   ├── 价格来源 = AMM 现货价格
│   ├── 用户可做多/做空，最高 100x
│   └── 用户对赌模式
│
└── LP 借贷池
    ├── 用户存 MEME 赚利息
    └── 借给做空者

关键点：
├── 现货交易和永续合约同时开启
├── 价格由 AMM 现货交易驱动
├── 永续合约使用 AMM 价格作为标记价格
└── LP 存币借给做空者赚利息
```

---

## 一、价格系统

### 1.1 价格类型

| 价格类型 | 说明 | 用途 |
|----------|------|------|
| 现货价格 (Spot Price) | AMM 池实时价格 | 现货交易、基准定价 |
| 标记价格 (Mark Price) | 现货 + TWAP 加权 | 计算盈亏、清算 |
| TWAP 价格 | 时间加权平均价 | 防操纵、清算判断 |

### 1.2 价格计算（AMM 模型）

**核心思路**：价格由 AMM 现货交易驱动，永续合约使用 AMM 价格作为标记价格。

```solidity
// AMM 恒定乘积公式
x * y = k

// 初始状态（内盘结束后）
reserveBNB = 50 BNB（募集金额作为初始流动性）
reserveMEME = 初始MEME数量（按比例）
K = reserveBNB * reserveMEME

// 价格计算
spotPrice = reserveBNB / reserveMEME

// 现货买入 MEME → reserveBNB 增加，reserveMEME 减少 → 价格上涨
// 现货卖出 MEME → reserveBNB 减少，reserveMEME 增加 → 价格下跌
```

**合约实现**：

```solidity
contract AMM {
    uint256 public reserveBNB;
    uint256 public reserveMEME;
    uint256 public K; // 恒定乘积

    IERC20 public memeToken;

    /**
     * @notice 初始化（内盘结束后调用）
     */
    function initialize(uint256 _bnbAmount, uint256 _memeAmount) external {
        reserveBNB = _bnbAmount;
        reserveMEME = _memeAmount;
        K = reserveBNB * reserveMEME;
    }

    /**
     * @notice 获取当前现货价格
     */
    function getSpotPrice() public view returns (uint256) {
        return (reserveBNB * PRECISION) / reserveMEME;
    }

    /**
     * @notice 用 BNB 买入 MEME
     */
    function swapBNBForMeme(uint256 minMemeOut) external payable returns (uint256) {
        uint256 bnbIn = msg.value;
        uint256 newReserveBNB = reserveBNB + bnbIn;
        uint256 newReserveMEME = K / newReserveBNB;
        uint256 memeOut = reserveMEME - newReserveMEME;

        require(memeOut >= minMemeOut, "Slippage");

        reserveBNB = newReserveBNB;
        reserveMEME = newReserveMEME;

        memeToken.transfer(msg.sender, memeOut);
        priceFeed.updatePrice(); // 更新价格历史

        return memeOut;
    }

    /**
     * @notice 用 MEME 换 BNB
     */
    function swapMemeForBNB(uint256 memeIn, uint256 minBnbOut) external returns (uint256) {
        memeToken.transferFrom(msg.sender, address(this), memeIn);

        uint256 newReserveMEME = reserveMEME + memeIn;
        uint256 newReserveBNB = K / newReserveMEME;
        uint256 bnbOut = reserveBNB - newReserveBNB;

        require(bnbOut >= minBnbOut, "Slippage");

        reserveBNB = newReserveBNB;
        reserveMEME = newReserveMEME;

        payable(msg.sender).transfer(bnbOut);
        priceFeed.updatePrice(); // 更新价格历史

        return bnbOut;
    }
}

contract PriceFeed {
    IAMM public amm;

    // 价格历史（用于 TWAP）
    struct PricePoint {
        uint256 price;
        uint256 timestamp;
        uint256 cumulativePrice; // 累计价格（用于快速计算 TWAP）
    }

    PricePoint[] public priceHistory;
    uint256 public constant MAX_HISTORY = 1000;
    uint256 public constant TWAP_PERIOD = 10 minutes;
    uint256 public constant PRECISION = 1e18;

    /**
     * @notice 获取现货价格（从 AMM 读取）
     */
    function getSpotPrice() public view returns (uint256) {
        return amm.getSpotPrice();
    }

    /**
     * @notice 开仓时更新价格（由 PositionManager 调用）
     * @param isLong 是否做多
     * @param size 仓位大小（BNB）
     */
    function updatePriceOnOpen(bool isLong, uint256 size) external onlyPositionManager {
        if (isLong) {
            // 开多：增加虚拟 BNB 储备 → 价格上涨
            virtualBNB += size;
        } else {
            // 开空：减少虚拟 BNB 储备 → 价格下跌
            virtualBNB -= size;
        }
        // 保持 K 不变，更新 virtualMEME
        virtualMEME = K / virtualBNB;

        _recordPrice();
    }

    /**
     * @notice 平仓时更新价格（由 PositionManager 调用）
     * @param isLong 原仓位是否做多
     * @param size 平仓大小（BNB）
     */
    function updatePriceOnClose(bool isLong, uint256 size) external onlyPositionManager {
        if (isLong) {
            // 平多：减少虚拟 BNB 储备 → 价格下跌
            virtualBNB -= size;
        } else {
            // 平空：增加虚拟 BNB 储备 → 价格上涨
            virtualBNB += size;
        }
        virtualMEME = K / virtualBNB;

        _recordPrice();
    }

    /**
     * @notice 记录价格历史
     */
    function _recordPrice() internal {
        uint256 currentPrice = getIndexPrice();
        uint256 lastCumulative = priceHistory.length > 0
            ? priceHistory[priceHistory.length - 1].cumulativePrice
            : 0;
        uint256 lastTimestamp = priceHistory.length > 0
            ? priceHistory[priceHistory.length - 1].timestamp
            : block.timestamp;

        // 累计价格 = 上次累计 + 价格 × 时间差
        uint256 timeDelta = block.timestamp - lastTimestamp;
        uint256 newCumulative = lastCumulative + (currentPrice * timeDelta);

        priceHistory.push(PricePoint({
            price: currentPrice,
            timestamp: block.timestamp,
            cumulativePrice: newCumulative
        }));

        // 限制历史长度
        if (priceHistory.length > MAX_HISTORY) {
            _trimHistory();
        }

        emit PriceUpdated(currentPrice, block.timestamp);
    }
}
```

### 1.3 TWAP 价格计算

```solidity
/**
 * @notice 获取 TWAP 价格（时间加权平均）
 * @dev 用于清算，防止价格操纵
 */
function getTWAP() public view returns (uint256) {
    if (priceHistory.length < 2) {
        return getSpotPrice();
    }

    uint256 targetTime = block.timestamp - TWAP_PERIOD;

    // 找到 TWAP_PERIOD 之前的价格点
    uint256 startIndex = _findPriceIndex(targetTime);
    uint256 endIndex = priceHistory.length - 1;

    PricePoint memory startPoint = priceHistory[startIndex];
    PricePoint memory endPoint = priceHistory[endIndex];

    // TWAP = (累计价格差) / 时间差
    uint256 cumulativeDiff = endPoint.cumulativePrice - startPoint.cumulativePrice;
    uint256 timeDiff = endPoint.timestamp - startPoint.timestamp;

    if (timeDiff == 0) {
        return getSpotPrice();
    }

    return cumulativeDiff / timeDiff;
}

/**
 * @notice 获取标记价格（用于计算盈亏）
 * @dev 标记价格 = 现货价格 × 0.5 + TWAP × 0.5
 */
function getMarkPrice() public view returns (uint256) {
    uint256 spot = getSpotPrice();
    uint256 twap = getTWAP();

    // 50% 现货 + 50% TWAP
    return (spot + twap) / 2;
}
```

### 1.4 价格更新触发时机

```
价格由 AMM 现货交易驱动，永续合约使用 AMM 价格：

1. 现货买入 MEME（BNB → MEME）
   └── AMM.swapBNBForMeme() → PriceFeed.updatePrice()
   └── 效果：价格上涨

2. 现货卖出 MEME（MEME → BNB）
   └── AMM.swapMemeForBNB() → PriceFeed.updatePrice()
   └── 效果：价格下跌

3. 永续合约操作（不直接影响价格）
   └── 开仓/平仓不改变 AMM 储备
   └── 但会影响资金费率

4. Keeper 定时更新
   └── 每 15 秒调用一次（即使没有交易）
   └── 确保 TWAP 数据连续

价格联动：
├── 现货交易改变 AMM 储备 → 价格变动
├── 永续合约读取 AMM 价格 → 计算盈亏
└── 两个市场价格一致，自然套利平衡
```

### 1.5 价格影响计算（现货交易）

```solidity
/**
 * @notice 计算现货交易的价格影响
 * @param isBuy 是否买入 MEME
 * @param amount 交易金额
 * @return priceImpact 价格影响百分比（基点，10000 = 100%）
 */
function getPriceImpact(bool isBuy, uint256 amount) public view returns (uint256) {
    uint256 currentPrice = getSpotPrice();

    uint256 newReserveBNB;
    uint256 newReserveMEME;

    if (isBuy) {
        // 买入：BNB 增加
        newReserveBNB = reserveBNB + amount;
        newReserveMEME = K / newReserveBNB;
    } else {
        // 卖出：计算等值 BNB
        uint256 memeValue = (amount * currentPrice) / PRECISION;
        newReserveBNB = reserveBNB - memeValue;
        newReserveMEME = K / newReserveBNB;
    }

    uint256 newPrice = (newReserveBNB * PRECISION) / newReserveMEME;

    // 价格影响 = |新价格 - 当前价格| / 当前价格 * 10000
    if (newPrice >= currentPrice) {
        return ((newPrice - currentPrice) * 10000) / currentPrice;
    } else {
        return ((currentPrice - newPrice) * 10000) / currentPrice;
    }
}
```

### 1.5 价格保护机制

```solidity
contract PriceFeed {
    uint256 public constant MAX_PRICE_DEVIATION = 500; // 5%
    uint256 public constant MAX_PRICE_CHANGE_PER_BLOCK = 200; // 2%

    uint256 public lastBlockPrice;
    uint256 public lastBlockNumber;

    /**
     * @notice 验证价格变动是否合理
     */
    function validatePriceChange(uint256 newPrice) public view returns (bool) {
        if (lastBlockNumber == block.number) {
            // 同一区块内价格变动限制
            uint256 maxChange = (lastBlockPrice * MAX_PRICE_CHANGE_PER_BLOCK) / 10000;
            uint256 priceDiff = newPrice > lastBlockPrice
                ? newPrice - lastBlockPrice
                : lastBlockPrice - newPrice;

            if (priceDiff > maxChange) {
                return false; // 价格变动过大，可能是操纵
            }
        }
        return true;
    }

    /**
     * @notice 检查价格是否偏离 TWAP 过多
     */
    function isPriceValid() public view returns (bool) {
        uint256 spot = getSpotPrice();
        uint256 twap = getTWAP();

        uint256 deviation = spot > twap
            ? ((spot - twap) * 10000) / twap
            : ((twap - spot) * 10000) / twap;

        return deviation <= MAX_PRICE_DEVIATION;
    }
}
```

---

## 二、K线系统

### 2.1 K线数据结构

```typescript
// 后端数据结构
interface Candle {
    timestamp: number;      // 开盘时间戳（毫秒）
    open: string;          // 开盘价
    high: string;          // 最高价
    low: string;           // 最低价
    close: string;         // 收盘价
    volume: string;        // 成交量（BNB）
    volumeMeme: string;    // 成交量（MEME）
    trades: number;        // 成交笔数
}

// 支持的时间周期
type Interval = '1m' | '5m' | '15m' | '30m' | '1h' | '4h' | '1d' | '1w';
```

### 2.2 K线生成流程

```
K线数据来源：AMM 现货交易（买入/卖出 MEME）

链上事件                后端索引               K线聚合              前端展示
    │                      │                     │                    │
    ▼                      ▼                     ▼                    ▼
┌─────────┐         ┌───────────┐         ┌───────────┐         ┌─────────┐
│  Swap   │────────►│ Event     │────────►│ Candle    │────────►│Trading  │
│  Event  │         │ Listener  │         │ Generator │         │ View    │
│(AMM交易)│         └───────────┘         └───────────┘         └─────────┘
└─────────┘               │                     │
    │                     ▼                     ▼
    ▼               ┌───────────┐         ┌───────────┐
┌─────────┐         │ PostgreSQL│         │   Redis   │
│ Price   │         │ (历史)    │         │ (实时)    │
│ Updated │         └───────────┘         └───────────┘
└─────────┘

每次现货交易都会触发：
├── Swap 事件（交易详情）
└── PriceUpdated 事件（价格变动）

后端监听这些事件生成 K 线数据
```

### 2.3 后端实现

```typescript
// backend/src/services/candleService.ts

import { ethers } from 'ethers';
import { Pool } from 'pg';
import Redis from 'ioredis';

interface Trade {
    price: string;
    amount: string;
    timestamp: number;
    isBuy: boolean;
}

class CandleService {
    private db: Pool;
    private redis: Redis;
    private currentCandles: Map<string, Candle> = new Map(); // interval -> candle

    // 支持的时间周期（秒）
    private intervals = {
        '1m': 60,
        '5m': 300,
        '15m': 900,
        '30m': 1800,
        '1h': 3600,
        '4h': 14400,
        '1d': 86400,
        '1w': 604800
    };

    /**
     * 处理新交易
     */
    async processTrade(trade: Trade) {
        const price = trade.price;
        const volume = trade.amount;

        // 更新所有时间周期的 K 线
        for (const [interval, seconds] of Object.entries(this.intervals)) {
            await this.updateCandle(interval, seconds, price, volume, trade.timestamp);
        }

        // 推送实时价格
        await this.pushRealtimePrice(price, trade.timestamp);
    }

    /**
     * 更新 K 线
     */
    async updateCandle(
        interval: string,
        seconds: number,
        price: string,
        volume: string,
        timestamp: number
    ) {
        const candleKey = `candle:${interval}`;
        const candleTime = Math.floor(timestamp / 1000 / seconds) * seconds * 1000;

        let candle = this.currentCandles.get(interval);

        // 检查是否需要创建新 K 线
        if (!candle || candle.timestamp !== candleTime) {
            // 保存旧 K 线到数据库
            if (candle) {
                await this.saveCandle(interval, candle);
            }

            // 创建新 K 线
            candle = {
                timestamp: candleTime,
                open: price,
                high: price,
                low: price,
                close: price,
                volume: volume,
                volumeMeme: '0',
                trades: 1
            };
        } else {
            // 更新现有 K 线
            const priceNum = parseFloat(price);
            const highNum = parseFloat(candle.high);
            const lowNum = parseFloat(candle.low);

            candle.high = priceNum > highNum ? price : candle.high;
            candle.low = priceNum < lowNum ? price : candle.low;
            candle.close = price;
            candle.volume = (parseFloat(candle.volume) + parseFloat(volume)).toString();
            candle.trades += 1;
        }

        this.currentCandles.set(interval, candle);

        // 缓存到 Redis
        await this.redis.set(candleKey, JSON.stringify(candle));

        // 推送 K 线更新
        await this.redis.publish(`candle:${interval}`, JSON.stringify(candle));
    }

    /**
     * 保存 K 线到数据库
     */
    async saveCandle(interval: string, candle: Candle) {
        await this.db.query(`
            INSERT INTO candles (interval, timestamp, open, high, low, close, volume, trades)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
            ON CONFLICT (interval, timestamp)
            DO UPDATE SET high = GREATEST(candles.high, $4),
                          low = LEAST(candles.low, $5),
                          close = $6,
                          volume = candles.volume + $7,
                          trades = candles.trades + $8
        `, [interval, candle.timestamp, candle.open, candle.high,
            candle.low, candle.close, candle.volume, candle.trades]);
    }

    /**
     * 获取历史 K 线
     */
    async getCandles(interval: string, startTime: number, endTime: number): Promise<Candle[]> {
        const result = await this.db.query(`
            SELECT * FROM candles
            WHERE interval = $1 AND timestamp >= $2 AND timestamp <= $3
            ORDER BY timestamp ASC
        `, [interval, startTime, endTime]);

        return result.rows;
    }
}
```

### 2.4 数据库表结构

```sql
-- K线数据表
CREATE TABLE candles (
    id SERIAL PRIMARY KEY,
    interval VARCHAR(10) NOT NULL,      -- '1m', '5m', '1h', etc.
    timestamp BIGINT NOT NULL,          -- 开盘时间戳（毫秒）
    open DECIMAL(36, 18) NOT NULL,
    high DECIMAL(36, 18) NOT NULL,
    low DECIMAL(36, 18) NOT NULL,
    close DECIMAL(36, 18) NOT NULL,
    volume DECIMAL(36, 18) NOT NULL,    -- BNB 成交量
    volume_meme DECIMAL(36, 18),        -- MEME 成交量
    trades INTEGER DEFAULT 0,
    created_at TIMESTAMP DEFAULT NOW(),

    UNIQUE(interval, timestamp)
);

-- 索引
CREATE INDEX idx_candles_interval_timestamp ON candles(interval, timestamp DESC);

-- 交易记录表
CREATE TABLE trades (
    id SERIAL PRIMARY KEY,
    tx_hash VARCHAR(66) NOT NULL UNIQUE,
    block_number BIGINT NOT NULL,
    timestamp BIGINT NOT NULL,
    trader ADDRESS NOT NULL,
    is_buy BOOLEAN NOT NULL,
    price DECIMAL(36, 18) NOT NULL,
    amount_bnb DECIMAL(36, 18) NOT NULL,
    amount_meme DECIMAL(36, 18) NOT NULL,
    created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_trades_timestamp ON trades(timestamp DESC);
CREATE INDEX idx_trades_trader ON trades(trader);
```

### 2.5 WebSocket 推送

```typescript
// backend/src/websocket/priceSocket.ts

import WebSocket from 'ws';
import Redis from 'ioredis';

class PriceWebSocket {
    private wss: WebSocket.Server;
    private redis: Redis;
    private subscriber: Redis;

    constructor(port: number) {
        this.wss = new WebSocket.Server({ port });
        this.redis = new Redis();
        this.subscriber = new Redis();

        this.setupSubscriptions();
        this.setupConnections();
    }

    setupSubscriptions() {
        // 订阅 K 线更新
        const intervals = ['1m', '5m', '15m', '30m', '1h', '4h', '1d'];
        intervals.forEach(interval => {
            this.subscriber.subscribe(`candle:${interval}`);
        });

        // 订阅实时价格
        this.subscriber.subscribe('price:realtime');
        this.subscriber.subscribe('price:mark');

        this.subscriber.on('message', (channel, message) => {
            this.broadcast(channel, message);
        });
    }

    setupConnections() {
        this.wss.on('connection', (ws) => {
            console.log('Client connected');

            ws.on('message', (data) => {
                const msg = JSON.parse(data.toString());
                this.handleMessage(ws, msg);
            });
        });
    }

    handleMessage(ws: WebSocket, msg: any) {
        switch (msg.type) {
            case 'subscribe':
                // 订阅特定频道
                (ws as any).subscriptions = msg.channels;
                break;
            case 'getCandles':
                // 获取历史 K 线
                this.sendHistoryCandles(ws, msg.interval, msg.limit);
                break;
        }
    }

    broadcast(channel: string, message: string) {
        this.wss.clients.forEach(client => {
            if (client.readyState === WebSocket.OPEN) {
                const subscriptions = (client as any).subscriptions || [];
                if (subscriptions.includes(channel) || subscriptions.includes('*')) {
                    client.send(JSON.stringify({
                        channel,
                        data: JSON.parse(message)
                    }));
                }
            }
        });
    }
}
```

---

## 三、市值计算

### 3.1 市值类型

| 类型 | 公式 | 说明 |
|------|------|------|
| 完全稀释市值 (FDV) | 价格 × 总供应量 | 所有代币流通的市值 |
| 流通市值 (MC) | 价格 × 流通量 | 实际流通的市值 |
| LP 池市值 | 池中 BNB × 2 | 流动性池总价值 |

### 3.2 计算实现

```solidity
contract MarketData {
    IAMM public amm;
    IERC20 public memeToken;

    uint256 public constant TOTAL_SUPPLY = 1_000_000_000 * 1e18; // 10亿

    /**
     * @notice 获取完全稀释市值 (FDV)
     * @return fdv 市值（BNB 计价）
     */
    function getFDV() public view returns (uint256) {
        uint256 price = amm.getSpotPrice();
        return (price * TOTAL_SUPPLY) / 1e18;
    }

    /**
     * @notice 获取流通市值
     * @return mc 流通市值（BNB 计价）
     */
    function getMarketCap() public view returns (uint256) {
        uint256 price = amm.getSpotPrice();
        uint256 circulatingSupply = getCirculatingSupply();
        return (price * circulatingSupply) / 1e18;
    }

    /**
     * @notice 获取流通量
     * @dev 流通量 = 总供应 - LP锁定 - 团队锁定 - 未领取
     */
    function getCirculatingSupply() public view returns (uint256) {
        uint256 lpLocked = memeToken.balanceOf(address(amm));
        uint256 lendingPoolLocked = memeToken.balanceOf(lendingPool);
        // 可以添加其他锁定地址

        return TOTAL_SUPPLY - lpLocked - lendingPoolLocked;
    }

    /**
     * @notice 获取 LP 池 TVL
     * @return tvl 总锁定价值（BNB 计价）
     */
    function getLPTvl() public view returns (uint256) {
        (uint256 bnbReserve, ) = amm.getReserves();
        // LP 池 TVL = BNB 储备 × 2（因为另一半是等值的 MEME）
        return bnbReserve * 2;
    }

    /**
     * @notice 获取完整市场数据
     */
    function getMarketInfo() external view returns (
        uint256 price,
        uint256 fdv,
        uint256 marketCap,
        uint256 circulatingSupply,
        uint256 lpTvl,
        uint256 totalLongSize,
        uint256 totalShortSize
    ) {
        price = amm.getSpotPrice();
        fdv = getFDV();
        marketCap = getMarketCap();
        circulatingSupply = getCirculatingSupply();
        lpTvl = getLPTvl();
        totalLongSize = positionManager.getTotalLongSize();
        totalShortSize = positionManager.getTotalShortSize();
    }
}
```

### 3.3 后端市值追踪

```typescript
// backend/src/services/marketService.ts

interface MarketStats {
    price: string;
    priceChange24h: string;
    priceChangePercent24h: string;
    high24h: string;
    low24h: string;
    volume24h: string;
    volumeChange24h: string;
    marketCap: string;
    fdv: string;
    tvl: string;
    totalLong: string;
    totalShort: string;
    longShortRatio: string;
    fundingRate: string;
}

class MarketService {
    /**
     * 获取市场统计数据
     */
    async getMarketStats(): Promise<MarketStats> {
        const now = Date.now();
        const yesterday = now - 24 * 60 * 60 * 1000;

        // 从数据库获取 24 小时数据
        const stats24h = await this.db.query(`
            SELECT
                MIN(low) as low_24h,
                MAX(high) as high_24h,
                SUM(volume) as volume_24h,
                FIRST_VALUE(open) OVER (ORDER BY timestamp ASC) as open_24h,
                LAST_VALUE(close) OVER (ORDER BY timestamp ASC) as close_24h
            FROM candles
            WHERE interval = '1h' AND timestamp >= $1
        `, [yesterday]);

        // 从合约获取实时数据
        const onChainData = await this.contract.getMarketInfo();

        const currentPrice = onChainData.price;
        const openPrice = stats24h.rows[0].open_24h;
        const priceChange = currentPrice - openPrice;
        const priceChangePercent = (priceChange / openPrice) * 100;

        return {
            price: currentPrice.toString(),
            priceChange24h: priceChange.toString(),
            priceChangePercent24h: priceChangePercent.toFixed(2),
            high24h: stats24h.rows[0].high_24h,
            low24h: stats24h.rows[0].low_24h,
            volume24h: stats24h.rows[0].volume_24h,
            marketCap: onChainData.marketCap.toString(),
            fdv: onChainData.fdv.toString(),
            tvl: onChainData.lpTvl.toString(),
            totalLong: onChainData.totalLongSize.toString(),
            totalShort: onChainData.totalShortSize.toString(),
            longShortRatio: this.calculateRatio(
                onChainData.totalLongSize,
                onChainData.totalShortSize
            ),
            fundingRate: await this.getFundingRate()
        };
    }
}
```

---

## 四、实时数据推送

### 4.1 WebSocket 消息类型

```typescript
// 消息类型定义
type WSMessageType =
    | 'price'           // 实时价格
    | 'candle'          // K线更新
    | 'trade'           // 成交记录
    | 'position'        // 仓位更新
    | 'order'           // 订单更新
    | 'liquidation'     // 清算通知
    | 'funding'         // 资金费率
    | 'market';         // 市场数据

interface WSMessage {
    type: WSMessageType;
    channel: string;
    data: any;
    timestamp: number;
}
```

### 4.2 频道订阅

```typescript
// 前端订阅示例
const ws = new WebSocket('wss://api.memeperp.io/ws');

ws.onopen = () => {
    // 订阅实时价格
    ws.send(JSON.stringify({
        type: 'subscribe',
        channels: ['price:realtime', 'candle:1m', 'trade:recent']
    }));

    // 订阅用户相关（需要认证）
    ws.send(JSON.stringify({
        type: 'auth',
        token: 'user_jwt_token'
    }));

    ws.send(JSON.stringify({
        type: 'subscribe',
        channels: ['position:user', 'order:user']
    }));
};

ws.onmessage = (event) => {
    const msg = JSON.parse(event.data);

    switch (msg.type) {
        case 'price':
            updatePrice(msg.data);
            break;
        case 'candle':
            updateChart(msg.data);
            break;
        case 'position':
            updatePosition(msg.data);
            break;
    }
};
```

### 4.3 推送频率

| 数据类型 | 推送频率 | 说明 |
|----------|----------|------|
| 实时价格 | 每笔交易 / 每秒 | 价格变动时推送 |
| K线数据 | 每秒 | 当前 K 线更新 |
| 成交记录 | 每笔交易 | 实时成交 |
| 仓位更新 | 价格变动时 | 盈亏实时计算 |
| 市场数据 | 每 5 秒 | 统计数据 |
| 资金费率 | 每分钟 | 预估值更新 |

---

## 五、清算系统

### 5.1 清算条件

```solidity
/**
 * @notice 检查是否可清算
 * @dev 保证金率 < 维持保证金率 时可清算
 */
function canLiquidate(address user) public view returns (bool) {
    Position memory pos = positionManager.getPosition(user);
    if (pos.size == 0) return false;

    // 获取 TWAP 价格（防操纵）
    uint256 price = priceFeed.getTWAP();

    // 计算未实现盈亏
    int256 pnl = calculatePnL(pos, price);

    // 计算保证金率
    int256 equity = int256(pos.collateral) + pnl;
    if (equity <= 0) return true;

    uint256 marginRatio = (uint256(equity) * 10000) / pos.size;
    uint256 maintenanceMargin = riskManager.getMaintenanceMargin(pos.leverage);

    return marginRatio < maintenanceMargin;
}
```

### 5.2 清算流程

```
┌─────────────────────────────────────────────────────────────┐
│                      清算流程                                │
└─────────────────────────────────────────────────────────────┘
                           │
                           ▼
              ┌─────────────────────────┐
              │  Keeper 监控所有仓位     │
              │  (每 3 秒检查一次)       │
              └─────────────────────────┘
                           │
                           ▼
              ┌─────────────────────────┐
              │  发现可清算仓位          │
              │  marginRatio < 维持保证金│
              └─────────────────────────┘
                           │
                           ▼
              ┌─────────────────────────┐
              │  调用 liquidate(user)   │
              └─────────────────────────┘
                           │
          ┌────────────────┼────────────────┐
          │                │                │
          ▼                ▼                ▼
    ┌───────────┐   ┌───────────┐   ┌───────────┐
    │ 强制平仓   │   │ 计算分配   │   │ 触发事件   │
    │           │   │           │   │           │
    │ forceClose│   │ 清算人0.5% │   │ Liquidated│
    │           │   │ 对手方剩余 │   │           │
    └───────────┘   └───────────┘   └───────────┘
```

### 5.3 Keeper 清算机器人

```typescript
// keeper/src/liquidationKeeper.ts

import { ethers } from 'ethers';

class LiquidationKeeper {
    private provider: ethers.Provider;
    private wallet: ethers.Wallet;
    private liquidationContract: ethers.Contract;
    private positionManager: ethers.Contract;

    private checkInterval = 3000; // 3秒
    private gasLimit = 500000;

    async start() {
        console.log('Liquidation Keeper started');

        while (true) {
            try {
                await this.checkAndLiquidate();
            } catch (error) {
                console.error('Liquidation check error:', error);
            }

            await this.sleep(this.checkInterval);
        }
    }

    async checkAndLiquidate() {
        // 获取所有可清算用户
        const liquidatableUsers = await this.getLiquidatableUsers();

        if (liquidatableUsers.length === 0) {
            return;
        }

        console.log(`Found ${liquidatableUsers.length} liquidatable positions`);

        // 按清算奖励排序（优先清算奖励高的）
        const sorted = await this.sortByReward(liquidatableUsers);

        // 逐个清算
        for (const user of sorted) {
            try {
                const tx = await this.liquidationContract.liquidate(user, {
                    gasLimit: this.gasLimit
                });

                console.log(`Liquidating ${user}, tx: ${tx.hash}`);

                const receipt = await tx.wait();
                console.log(`Liquidation confirmed, gas used: ${receipt.gasUsed}`);

            } catch (error) {
                console.error(`Failed to liquidate ${user}:`, error);
            }
        }
    }

    async getLiquidatableUsers(): Promise<string[]> {
        // 方法1：调用合约批量检查
        const users = await this.liquidationContract.getLiquidatableUsers();
        return users;

        // 方法2：从事件日志获取活跃用户，逐个检查
        // const activeUsers = await this.getActiveUsers();
        // return activeUsers.filter(u => this.liquidationContract.canLiquidate(u));
    }

    async sortByReward(users: string[]): Promise<string[]> {
        const rewards = await Promise.all(
            users.map(async (user) => ({
                user,
                reward: await this.liquidationContract.getLiquidationReward(user)
            }))
        );

        return rewards
            .sort((a, b) => b.reward - a.reward)
            .map(r => r.user);
    }

    sleep(ms: number): Promise<void> {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}
```

---

## 六、资金费率系统

### 6.1 计算公式

```solidity
contract FundingRate {
    uint256 public constant FUNDING_INTERVAL = 4 hours;
    int256 public constant MAX_FUNDING_RATE = 2500;  // 0.25% = 25 / 10000
    int256 public constant MIN_FUNDING_RATE = -2500;

    uint256 public lastFundingTime;
    int256 public currentFundingRate;

    // 历史记录
    struct FundingRecord {
        int256 rate;
        uint256 timestamp;
        uint256 longPayment;
        uint256 shortPayment;
    }
    FundingRecord[] public fundingHistory;

    /**
     * @notice 计算资金费率
     * @dev 资金费率 = (标记价格 - 现货价格) / 现货价格
     */
    function calculateFundingRate() public view returns (int256) {
        uint256 markPrice = priceFeed.getMarkPrice();
        uint256 spotPrice = priceFeed.getSpotPrice();

        int256 priceDiff = int256(markPrice) - int256(spotPrice);
        int256 rate = (priceDiff * 10000) / int256(spotPrice);

        // 限制范围
        if (rate > MAX_FUNDING_RATE) rate = MAX_FUNDING_RATE;
        if (rate < MIN_FUNDING_RATE) rate = MIN_FUNDING_RATE;

        return rate;
    }

    /**
     * @notice 结算资金费（每4小时）
     */
    function settleFunding() external {
        require(
            block.timestamp >= lastFundingTime + FUNDING_INTERVAL,
            "Too early"
        );

        int256 fundingRate = calculateFundingRate();
        currentFundingRate = fundingRate;
        lastFundingTime = block.timestamp;

        // 计算多空支付
        uint256 totalLong = positionManager.getTotalLongSize();
        uint256 totalShort = positionManager.getTotalShortSize();

        uint256 longPayment;
        uint256 shortPayment;

        if (fundingRate > 0) {
            // 多头付给空头
            longPayment = (totalLong * uint256(fundingRate)) / 10000;
            shortPayment = 0;
        } else {
            // 空头付给多头
            longPayment = 0;
            shortPayment = (totalShort * uint256(-fundingRate)) / 10000;
        }

        // 记录历史
        fundingHistory.push(FundingRecord({
            rate: fundingRate,
            timestamp: block.timestamp,
            longPayment: longPayment,
            shortPayment: shortPayment
        }));

        emit FundingSettled(block.timestamp, fundingRate, longPayment, shortPayment);
    }

    /**
     * @notice 获取用户待支付/收取的资金费
     */
    function getPendingFunding(address user) public view returns (int256) {
        Position memory pos = positionManager.getPosition(user);
        if (pos.size == 0) return 0;

        // 计算自上次结算以来的资金费
        uint256 timeSinceLastFunding = block.timestamp - pos.lastFundingTime;
        uint256 periodsElapsed = timeSinceLastFunding / FUNDING_INTERVAL;

        if (periodsElapsed == 0) return 0;

        int256 rate = calculateFundingRate();
        int256 fundingFee = (int256(pos.size) * rate * int256(periodsElapsed)) / 10000;

        // 多头支付正费率，空头支付负费率
        if (pos.isLong) {
            return -fundingFee; // 多头付出
        } else {
            return fundingFee;  // 空头收取
        }
    }
}
```

### 6.2 资金费结算 Keeper

```typescript
// keeper/src/fundingKeeper.ts

class FundingKeeper {
    private fundingContract: ethers.Contract;
    private checkInterval = 60000; // 1分钟检查一次

    async start() {
        console.log('Funding Keeper started');

        while (true) {
            try {
                await this.checkAndSettle();
            } catch (error) {
                console.error('Funding check error:', error);
            }

            await this.sleep(this.checkInterval);
        }
    }

    async checkAndSettle() {
        const lastFundingTime = await this.fundingContract.lastFundingTime();
        const now = Math.floor(Date.now() / 1000);
        const interval = 4 * 60 * 60; // 4 hours

        if (now >= lastFundingTime + interval) {
            console.log('Settling funding rate...');

            const tx = await this.fundingContract.settleFunding({
                gasLimit: 1000000
            });

            console.log(`Funding settled, tx: ${tx.hash}`);
            await tx.wait();
        }
    }
}
```

---

## 七、订单撮合系统

### 7.1 限价单执行

```solidity
contract OrderBook {
    struct Order {
        address user;
        bool isLong;
        uint256 size;
        uint256 leverage;
        uint256 triggerPrice;
        uint256 collateral;
        uint256 expireAt;
        bool isActive;
        OrderType orderType;
    }

    enum OrderType {
        LIMIT_OPEN_LONG,
        LIMIT_OPEN_SHORT,
        LIMIT_CLOSE,
        TAKE_PROFIT,
        STOP_LOSS
    }

    Order[] public orders;

    /**
     * @notice 检查订单是否可执行
     */
    function canExecute(uint256 orderId) public view returns (bool) {
        Order memory order = orders[orderId];

        if (!order.isActive) return false;
        if (block.timestamp > order.expireAt) return false;

        uint256 currentPrice = priceFeed.getMarkPrice();

        switch (order.orderType) {
            case OrderType.LIMIT_OPEN_LONG:
                // 做多：当前价格 <= 触发价格
                return currentPrice <= order.triggerPrice;

            case OrderType.LIMIT_OPEN_SHORT:
                // 做空：当前价格 >= 触发价格
                return currentPrice >= order.triggerPrice;

            case OrderType.TAKE_PROFIT:
                Position memory pos = positionManager.getPosition(order.user);
                if (pos.isLong) {
                    // 多头止盈：当前价格 >= 止盈价
                    return currentPrice >= order.triggerPrice;
                } else {
                    // 空头止盈：当前价格 <= 止盈价
                    return currentPrice <= order.triggerPrice;
                }

            case OrderType.STOP_LOSS:
                Position memory pos2 = positionManager.getPosition(order.user);
                if (pos2.isLong) {
                    // 多头止损：当前价格 <= 止损价
                    return currentPrice <= order.triggerPrice;
                } else {
                    // 空头止损：当前价格 >= 止损价
                    return currentPrice >= order.triggerPrice;
                }

            default:
                return false;
        }
    }

    /**
     * @notice 执行订单
     */
    function executeOrder(uint256 orderId) external {
        require(canExecute(orderId), "Cannot execute");

        Order storage order = orders[orderId];
        order.isActive = false;

        // 根据订单类型执行
        if (order.orderType == OrderType.LIMIT_OPEN_LONG) {
            positionManager.openLongFor(order.user, order.size, order.leverage);
        } else if (order.orderType == OrderType.LIMIT_OPEN_SHORT) {
            positionManager.openShortFor(order.user, order.size, order.leverage);
        } else {
            // 止盈止损：平仓
            positionManager.closePositionFor(order.user);
        }

        emit OrderExecuted(orderId, priceFeed.getMarkPrice());
    }
}
```

### 7.2 订单执行 Keeper

```typescript
// keeper/src/orderKeeper.ts

class OrderKeeper {
    private orderBook: ethers.Contract;
    private checkInterval = 1000; // 1秒检查一次

    async start() {
        console.log('Order Keeper started');

        while (true) {
            try {
                await this.checkAndExecute();
            } catch (error) {
                console.error('Order check error:', error);
            }

            await this.sleep(this.checkInterval);
        }
    }

    async checkAndExecute() {
        // 获取所有可执行订单
        const executableOrders = await this.orderBook.getExecutableOrders();

        if (executableOrders.length === 0) return;

        console.log(`Found ${executableOrders.length} executable orders`);

        // 批量执行
        const tx = await this.orderBook.executeOrders(executableOrders, {
            gasLimit: 2000000
        });

        console.log(`Executing orders, tx: ${tx.hash}`);
        await tx.wait();
    }
}
```

---

## 八、Keeper 机器人

### 8.1 Keeper 类型

| Keeper | 职责 | 运行频率 |
|--------|------|----------|
| Liquidation Keeper | 清算爆仓仓位 | 每 3 秒 |
| Order Keeper | 执行限价单/止盈止损 | 每 1 秒 |
| Funding Keeper | 结算资金费率 | 每 1 分钟检查 |
| Price Keeper | 更新价格（无交易时） | 每 15 秒 |
| TWAP Keeper | 更新 TWAP 数据 | 每 30 秒 |

### 8.2 统一 Keeper 架构

```typescript
// keeper/src/index.ts

import { LiquidationKeeper } from './liquidationKeeper';
import { OrderKeeper } from './orderKeeper';
import { FundingKeeper } from './fundingKeeper';
import { PriceKeeper } from './priceKeeper';

async function main() {
    const provider = new ethers.JsonRpcProvider(process.env.RPC_URL);
    const wallet = new ethers.Wallet(process.env.PRIVATE_KEY!, provider);

    // 初始化所有 Keeper
    const liquidationKeeper = new LiquidationKeeper(wallet);
    const orderKeeper = new OrderKeeper(wallet);
    const fundingKeeper = new FundingKeeper(wallet);
    const priceKeeper = new PriceKeeper(wallet);

    // 并行启动
    await Promise.all([
        liquidationKeeper.start(),
        orderKeeper.start(),
        fundingKeeper.start(),
        priceKeeper.start()
    ]);
}

main().catch(console.error);
```

### 8.3 Keeper 监控

```typescript
// keeper/src/monitor.ts

class KeeperMonitor {
    private metrics = {
        liquidations: 0,
        ordersExecuted: 0,
        fundingSettlements: 0,
        errors: 0,
        gasSpent: BigInt(0)
    };

    recordLiquidation(gasUsed: bigint) {
        this.metrics.liquidations++;
        this.metrics.gasSpent += gasUsed;
    }

    recordOrder(gasUsed: bigint) {
        this.metrics.ordersExecuted++;
        this.metrics.gasSpent += gasUsed;
    }

    recordError(error: Error) {
        this.metrics.errors++;
        console.error('Keeper error:', error);
        // 可以发送告警
    }

    getMetrics() {
        return this.metrics;
    }
}
```

---

## 九、数据索引系统

### 9.1 事件监听

```typescript
// backend/src/indexer/eventListener.ts

class EventListener {
    private provider: ethers.Provider;
    private contracts: Map<string, ethers.Contract> = new Map();

    async start() {
        // 监听所有相关合约事件
        this.listenPositionEvents();
        this.listenTradeEvents();
        this.listenLiquidationEvents();
        this.listenFundingEvents();
    }

    listenPositionEvents() {
        const positionManager = this.contracts.get('PositionManager')!;

        positionManager.on('PositionOpened', async (
            user, isLong, size, collateral, leverage, entryPrice, event
        ) => {
            await this.db.query(`
                INSERT INTO positions (user, is_long, size, collateral, leverage, entry_price, tx_hash, block_number)
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
            `, [user, isLong, size.toString(), collateral.toString(), leverage, entryPrice.toString(),
                event.transactionHash, event.blockNumber]);

            // 推送 WebSocket
            this.ws.broadcast('position:opened', { user, isLong, size, leverage });
        });

        positionManager.on('PositionClosed', async (
            user, isLong, size, entryPrice, exitPrice, pnl, event
        ) => {
            await this.db.query(`
                UPDATE positions SET
                    exit_price = $1, pnl = $2, closed_at = NOW(), status = 'closed'
                WHERE user = $3 AND status = 'open'
            `, [exitPrice.toString(), pnl.toString(), user]);

            // 记录历史
            await this.db.query(`
                INSERT INTO position_history (user, is_long, size, entry_price, exit_price, pnl, tx_hash)
                VALUES ($1, $2, $3, $4, $5, $6, $7)
            `, [user, isLong, size.toString(), entryPrice.toString(), exitPrice.toString(),
                pnl.toString(), event.transactionHash]);
        });
    }

    listenTradeEvents() {
        const amm = this.contracts.get('AMM')!;

        amm.on('Swap', async (user, isBuy, amountIn, amountOut, event) => {
            const block = await this.provider.getBlock(event.blockNumber);
            const price = isBuy
                ? amountIn / amountOut  // BNB/MEME
                : amountOut / amountIn;

            await this.db.query(`
                INSERT INTO trades (tx_hash, block_number, timestamp, trader, is_buy, price, amount_bnb, amount_meme)
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
            `, [event.transactionHash, event.blockNumber, block!.timestamp * 1000,
                user, isBuy, price,
                isBuy ? amountIn.toString() : amountOut.toString(),
                isBuy ? amountOut.toString() : amountIn.toString()]);

            // 更新 K 线
            await this.candleService.processTrade({
                price: price.toString(),
                amount: (isBuy ? amountIn : amountOut).toString(),
                timestamp: block!.timestamp * 1000,
                isBuy
            });
        });
    }
}
```

### 9.2 数据库模型

```sql
-- 用户表
CREATE TABLE users (
    address VARCHAR(42) PRIMARY KEY,
    referrer VARCHAR(42),
    created_at TIMESTAMP DEFAULT NOW(),
    total_volume DECIMAL(36, 18) DEFAULT 0,
    total_pnl DECIMAL(36, 18) DEFAULT 0,
    total_trades INTEGER DEFAULT 0
);

-- 活跃仓位表
CREATE TABLE positions (
    id SERIAL PRIMARY KEY,
    user_address VARCHAR(42) NOT NULL,
    is_long BOOLEAN NOT NULL,
    size DECIMAL(36, 18) NOT NULL,
    collateral DECIMAL(36, 18) NOT NULL,
    leverage INTEGER NOT NULL,
    entry_price DECIMAL(36, 18) NOT NULL,
    liquidation_price DECIMAL(36, 18),
    status VARCHAR(20) DEFAULT 'open',
    tx_hash VARCHAR(66) NOT NULL,
    block_number BIGINT NOT NULL,
    created_at TIMESTAMP DEFAULT NOW(),
    closed_at TIMESTAMP,

    INDEX idx_positions_user (user_address),
    INDEX idx_positions_status (status)
);

-- 仓位历史表
CREATE TABLE position_history (
    id SERIAL PRIMARY KEY,
    user_address VARCHAR(42) NOT NULL,
    is_long BOOLEAN NOT NULL,
    size DECIMAL(36, 18) NOT NULL,
    entry_price DECIMAL(36, 18) NOT NULL,
    exit_price DECIMAL(36, 18) NOT NULL,
    pnl DECIMAL(36, 18) NOT NULL,
    fee DECIMAL(36, 18) DEFAULT 0,
    funding_fee DECIMAL(36, 18) DEFAULT 0,
    tx_hash VARCHAR(66) NOT NULL,
    created_at TIMESTAMP DEFAULT NOW(),

    INDEX idx_history_user (user_address),
    INDEX idx_history_time (created_at)
);

-- 清算记录表
CREATE TABLE liquidations (
    id SERIAL PRIMARY KEY,
    user_address VARCHAR(42) NOT NULL,
    liquidator VARCHAR(42) NOT NULL,
    size DECIMAL(36, 18) NOT NULL,
    collateral DECIMAL(36, 18) NOT NULL,
    liquidator_reward DECIMAL(36, 18) NOT NULL,
    price DECIMAL(36, 18) NOT NULL,
    tx_hash VARCHAR(66) NOT NULL,
    block_number BIGINT NOT NULL,
    created_at TIMESTAMP DEFAULT NOW()
);

-- 资金费率历史
CREATE TABLE funding_history (
    id SERIAL PRIMARY KEY,
    rate DECIMAL(18, 8) NOT NULL,
    long_payment DECIMAL(36, 18) NOT NULL,
    short_payment DECIMAL(36, 18) NOT NULL,
    timestamp BIGINT NOT NULL,
    tx_hash VARCHAR(66) NOT NULL,
    created_at TIMESTAMP DEFAULT NOW()
);

-- 订单表
CREATE TABLE orders (
    id SERIAL PRIMARY KEY,
    order_id INTEGER NOT NULL,
    user_address VARCHAR(42) NOT NULL,
    order_type VARCHAR(20) NOT NULL,
    is_long BOOLEAN NOT NULL,
    size DECIMAL(36, 18) NOT NULL,
    leverage INTEGER NOT NULL,
    trigger_price DECIMAL(36, 18) NOT NULL,
    collateral DECIMAL(36, 18) NOT NULL,
    status VARCHAR(20) DEFAULT 'pending',
    created_at TIMESTAMP DEFAULT NOW(),
    executed_at TIMESTAMP,
    cancelled_at TIMESTAMP,

    INDEX idx_orders_user (user_address),
    INDEX idx_orders_status (status)
);
```

---

## 十、前端技术方案

### 10.1 技术栈

| 层级 | 技术 |
|------|------|
| 框架 | React 18 / Next.js 14 |
| 状态管理 | Zustand |
| 样式 | Tailwind CSS |
| 图表 | TradingView Lightweight Charts |
| Web3 | wagmi + viem |
| WebSocket | 原生 WebSocket |

### 10.2 核心组件

```typescript
// 交易图表组件
// frontend/src/components/TradingChart.tsx

import { createChart, IChartApi } from 'lightweight-charts';

export function TradingChart() {
    const chartRef = useRef<IChartApi>();
    const candlestickSeriesRef = useRef<ISeriesApi<"Candlestick">>();

    useEffect(() => {
        const chart = createChart(containerRef.current!, {
            width: 800,
            height: 400,
            layout: {
                background: { color: '#1a1a2e' },
                textColor: '#d1d4dc',
            },
            grid: {
                vertLines: { color: '#2b2b43' },
                horzLines: { color: '#2b2b43' },
            },
        });

        const candlestickSeries = chart.addCandlestickSeries({
            upColor: '#26a69a',
            downColor: '#ef5350',
            borderVisible: false,
            wickUpColor: '#26a69a',
            wickDownColor: '#ef5350',
        });

        chartRef.current = chart;
        candlestickSeriesRef.current = candlestickSeries;

        // 加载历史数据
        loadHistoryData();

        // WebSocket 实时更新
        connectWebSocket();

        return () => chart.remove();
    }, []);

    const connectWebSocket = () => {
        const ws = new WebSocket('wss://api.memeperp.io/ws');

        ws.onopen = () => {
            ws.send(JSON.stringify({
                type: 'subscribe',
                channels: ['candle:1m']
            }));
        };

        ws.onmessage = (event) => {
            const msg = JSON.parse(event.data);
            if (msg.type === 'candle') {
                candlestickSeriesRef.current?.update({
                    time: msg.data.timestamp / 1000,
                    open: parseFloat(msg.data.open),
                    high: parseFloat(msg.data.high),
                    low: parseFloat(msg.data.low),
                    close: parseFloat(msg.data.close),
                });
            }
        };
    };
}
```

### 10.3 状态管理

```typescript
// frontend/src/stores/tradingStore.ts

import { create } from 'zustand';

interface Position {
    isLong: boolean;
    size: string;
    collateral: string;
    leverage: number;
    entryPrice: string;
    unrealizedPnL: string;
    marginRatio: string;
    liquidationPrice: string;
}

interface TradingStore {
    // 市场数据
    price: string;
    markPrice: string;
    fundingRate: string;

    // 用户数据
    position: Position | null;
    balance: string;
    lockedBalance: string;

    // Actions
    setPrice: (price: string) => void;
    setPosition: (position: Position | null) => void;
    updateBalance: (balance: string, locked: string) => void;
}

export const useTradingStore = create<TradingStore>((set) => ({
    price: '0',
    markPrice: '0',
    fundingRate: '0',
    position: null,
    balance: '0',
    lockedBalance: '0',

    setPrice: (price) => set({ price }),
    setPosition: (position) => set({ position }),
    updateBalance: (balance, locked) => set({ balance, lockedBalance: locked }),
}));
```

---

## 附录

### A. API 接口列表

| 接口 | 方法 | 说明 |
|------|------|------|
| /api/market | GET | 获取市场数据 |
| /api/candles | GET | 获取 K 线数据 |
| /api/trades | GET | 获取成交记录 |
| /api/positions/{address} | GET | 获取用户仓位 |
| /api/orders/{address} | GET | 获取用户订单 |
| /api/history/{address} | GET | 获取历史记录 |
| /api/leaderboard | GET | 获取排行榜 |
| /api/funding/history | GET | 获取资金费率历史 |

### B. WebSocket 频道

| 频道 | 数据 | 推送频率 |
|------|------|----------|
| price:realtime | 实时价格 | 每笔交易 |
| price:mark | 标记价格 | 每秒 |
| candle:{interval} | K 线数据 | 每秒 |
| trade:recent | 最新成交 | 每笔交易 |
| position:{address} | 仓位更新 | 价格变动时 |
| order:{address} | 订单更新 | 状态变化时 |
| liquidation:all | 清算通知 | 发生时 |
| funding:rate | 资金费率 | 每分钟 |

### C. 错误码

| 错误码 | 说明 |
|--------|------|
| 1001 | 余额不足 |
| 1002 | 杠杆无效 |
| 1003 | 仓位已存在 |
| 1004 | 无仓位 |
| 1005 | 超过风控限制 |
| 1006 | 价格过期 |
| 1007 | 滑点过大 |
| 2001 | 订单不存在 |
| 2002 | 订单已取消 |
| 2003 | 订单已执行 |
| 3001 | 不可清算 |
| 3002 | 清算失败 |
