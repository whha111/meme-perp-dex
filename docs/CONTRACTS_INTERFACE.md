# 智能合约接口文档

## 概述

本文档定义 MEME Perp DEX 核心智能合约的接口规范。

---

## 合约地址 (BSC Testnet)

| 合约 | 地址 | 说明 |
|------|------|------|
| Router | TBD | 统一入口 |
| PositionManager | TBD | 仓位管理 |
| Vault | TBD | 资金托管 |
| AMM | TBD | 现货交易 |
| LendingPool | TBD | LP 借贷 |
| PriceFeed | TBD | 价格聚合 |
| Presale | TBD | 内盘认购 |

---

## 核心合约接口

### 1. Router (统一入口)

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IRouter {
    // ============ 现货交易 ============

    /// @notice 用 BNB 买入 MEME
    /// @param memeToken 目标 MEME 代币地址
    /// @param minMemeOut 最小获得数量 (滑点保护)
    /// @param deadline 交易截止时间
    /// @return memeAmount 实际获得的 MEME 数量
    function swapBNBForMeme(
        address memeToken,
        uint256 minMemeOut,
        uint256 deadline
    ) external payable returns (uint256 memeAmount);

    /// @notice 卖出 MEME 获得 BNB
    /// @param memeToken MEME 代币地址
    /// @param memeAmount 卖出数量
    /// @param minBNBOut 最小获得 BNB (滑点保护)
    /// @param deadline 交易截止时间
    /// @return bnbAmount 实际获得的 BNB 数量
    function swapMemeForBNB(
        address memeToken,
        uint256 memeAmount,
        uint256 minBNBOut,
        uint256 deadline
    ) external returns (uint256 bnbAmount);

    // ============ 永续合约交易 ============

    /// @notice 开多仓
    /// @param memeToken 交易的 MEME 代币
    /// @param size 仓位大小 (MEME 数量)
    /// @param leverage 杠杆倍数 (1-100)
    /// @param acceptablePrice 可接受的最高价格
    /// @return positionId 仓位 ID
    function openLong(
        address memeToken,
        uint256 size,
        uint256 leverage,
        uint256 acceptablePrice
    ) external payable returns (bytes32 positionId);

    /// @notice 开空仓
    /// @param memeToken 交易的 MEME 代币
    /// @param size 仓位大小 (MEME 数量)
    /// @param leverage 杠杆倍数 (1-100)
    /// @param acceptablePrice 可接受的最低价格
    /// @return positionId 仓位 ID
    function openShort(
        address memeToken,
        uint256 size,
        uint256 leverage,
        uint256 acceptablePrice
    ) external payable returns (bytes32 positionId);

    /// @notice 平仓
    /// @param positionId 仓位 ID
    /// @param acceptablePrice 可接受价格
    /// @return pnl 盈亏金额 (BNB)
    function closePosition(
        bytes32 positionId,
        uint256 acceptablePrice
    ) external returns (int256 pnl);

    /// @notice 部分平仓
    /// @param positionId 仓位 ID
    /// @param closeSize 平仓数量
    /// @param acceptablePrice 可接受价格
    /// @return pnl 盈亏金额 (BNB)
    function closePositionPartial(
        bytes32 positionId,
        uint256 closeSize,
        uint256 acceptablePrice
    ) external returns (int256 pnl);

    /// @notice 追加保证金
    /// @param positionId 仓位 ID
    function addMargin(bytes32 positionId) external payable;

    /// @notice 减少保证金
    /// @param positionId 仓位 ID
    /// @param amount 减少金额
    function removeMargin(bytes32 positionId, uint256 amount) external;

    // ============ LP 操作 ============

    /// @notice 存入 LP
    /// @param memeToken MEME 代币地址
    /// @param amount 存入数量
    /// @return lpTokens 获得的 LP 代币数量
    function depositLP(
        address memeToken,
        uint256 amount
    ) external returns (uint256 lpTokens);

    /// @notice 取出 LP
    /// @param memeToken MEME 代币地址
    /// @param lpAmount LP 代币数量
    /// @return memeAmount 获得的 MEME 数量
    function withdrawLP(
        address memeToken,
        uint256 lpAmount
    ) external returns (uint256 memeAmount);

    // ============ 订单管理 ============

    /// @notice 创建限价单
    /// @param memeToken MEME 代币地址
    /// @param isLong 是否做多
    /// @param triggerPrice 触发价格
    /// @param size 仓位大小
    /// @param leverage 杠杆
    /// @return orderId 订单 ID
    function createLimitOrder(
        address memeToken,
        bool isLong,
        uint256 triggerPrice,
        uint256 size,
        uint256 leverage
    ) external payable returns (bytes32 orderId);

    /// @notice 设置止盈止损
    /// @param positionId 仓位 ID
    /// @param takeProfitPrice 止盈价格 (0 表示不设置)
    /// @param stopLossPrice 止损价格 (0 表示不设置)
    function setTPSL(
        bytes32 positionId,
        uint256 takeProfitPrice,
        uint256 stopLossPrice
    ) external;

    /// @notice 取消订单
    /// @param orderId 订单 ID
    function cancelOrder(bytes32 orderId) external;

    // ============ 事件 ============

    event PositionOpened(
        bytes32 indexed positionId,
        address indexed trader,
        address indexed memeToken,
        bool isLong,
        uint256 size,
        uint256 leverage,
        uint256 entryPrice,
        uint256 margin
    );

    event PositionClosed(
        bytes32 indexed positionId,
        address indexed trader,
        uint256 exitPrice,
        int256 pnl,
        uint256 fee
    );

    event MarginUpdated(
        bytes32 indexed positionId,
        uint256 newMargin,
        bool isAdd
    );

    event OrderCreated(
        bytes32 indexed orderId,
        address indexed trader,
        address indexed memeToken,
        bool isLong,
        uint256 triggerPrice,
        uint256 size
    );

    event OrderCancelled(bytes32 indexed orderId);

    event OrderExecuted(
        bytes32 indexed orderId,
        bytes32 indexed positionId
    );
}
```

### 2. PositionManager (仓位管理)

```solidity
interface IPositionManager {
    struct Position {
        address trader;           // 交易者地址
        address memeToken;        // MEME 代币
        bool isLong;              // 方向
        uint256 size;             // 仓位大小 (MEME 数量)
        uint256 collateral;       // 保证金 (BNB)
        uint256 entryPrice;       // 开仓价格 (18 位精度)
        uint256 leverage;         // 杠杆倍数
        uint256 borrowedMeme;     // 借入的 MEME (做空)
        uint256 lastFundingTime;  // 上次资金费时间
        int256 accFundingFee;     // 累计资金费
        uint256 openTime;         // 开仓时间
    }

    /// @notice 获取仓位信息
    function getPosition(bytes32 positionId) external view returns (Position memory);

    /// @notice 获取用户所有仓位
    function getUserPositions(address user) external view returns (bytes32[] memory);

    /// @notice 计算未实现盈亏
    function getUnrealizedPnL(bytes32 positionId) external view returns (int256);

    /// @notice 计算清算价格
    function getLiquidationPrice(bytes32 positionId) external view returns (uint256);

    /// @notice 计算保证金率
    function getMarginRatio(bytes32 positionId) external view returns (uint256);

    /// @notice 检查是否可清算
    function isLiquidatable(bytes32 positionId) external view returns (bool);

    /// @notice 获取全局持仓信息
    function getGlobalPosition(address memeToken) external view returns (
        uint256 totalLongSize,
        uint256 totalShortSize,
        uint256 totalLongCollateral,
        uint256 totalShortCollateral
    );
}
```

### 3. AMM (现货交易)

```solidity
interface IAMM {
    /// @notice 获取现货价格
    /// @param memeToken MEME 代币地址
    /// @return price 价格 (18 位精度, MEME/BNB)
    function getSpotPrice(address memeToken) external view returns (uint256 price);

    /// @notice 获取储备金
    /// @param memeToken MEME 代币地址
    /// @return bnbReserve BNB 储备
    /// @return memeReserve MEME 储备
    function getReserves(address memeToken) external view returns (
        uint256 bnbReserve,
        uint256 memeReserve
    );

    /// @notice 计算买入 MEME 需要的 BNB
    /// @param memeToken MEME 代币地址
    /// @param memeAmount 想要买入的 MEME 数量
    /// @return bnbNeeded 需要的 BNB
    /// @return priceImpact 价格影响 (基点)
    function getBuyPrice(
        address memeToken,
        uint256 memeAmount
    ) external view returns (uint256 bnbNeeded, uint256 priceImpact);

    /// @notice 计算卖出 MEME 获得的 BNB
    /// @param memeToken MEME 代币地址
    /// @param memeAmount 想要卖出的 MEME 数量
    /// @return bnbOut 获得的 BNB
    /// @return priceImpact 价格影响 (基点)
    function getSellPrice(
        address memeToken,
        uint256 memeAmount
    ) external view returns (uint256 bnbOut, uint256 priceImpact);

    event Swap(
        address indexed memeToken,
        address indexed trader,
        bool isBuy,
        uint256 memeAmount,
        uint256 bnbAmount,
        uint256 newPrice
    );
}
```

### 4. PriceFeed (价格聚合)

```solidity
interface IPriceFeed {
    /// @notice 获取标记价格 (用于盈亏计算)
    /// @param memeToken MEME 代币地址
    /// @return markPrice 标记价格 (18 位精度)
    function getMarkPrice(address memeToken) external view returns (uint256 markPrice);

    /// @notice 获取 TWAP 价格 (用于清算)
    /// @param memeToken MEME 代币地址
    /// @param period TWAP 周期 (秒)
    /// @return twapPrice TWAP 价格
    function getTWAP(
        address memeToken,
        uint256 period
    ) external view returns (uint256 twapPrice);

    /// @notice 获取价格历史
    /// @param memeToken MEME 代币地址
    /// @param count 获取数量
    /// @return prices 价格数组
    /// @return timestamps 时间戳数组
    function getPriceHistory(
        address memeToken,
        uint256 count
    ) external view returns (uint256[] memory prices, uint256[] memory timestamps);
}
```

### 5. Vault (资金托管)

```solidity
interface IVault {
    /// @notice 存入 BNB
    function deposit() external payable;

    /// @notice 提取 BNB
    /// @param amount 提取金额
    function withdraw(uint256 amount) external;

    /// @notice 获取用户余额
    /// @param user 用户地址
    /// @return available 可用余额
    /// @return locked 锁定余额 (保证金)
    function getBalance(address user) external view returns (
        uint256 available,
        uint256 locked
    );

    /// @notice 获取总资产
    /// @return total 总 BNB 余额
    function totalAssets() external view returns (uint256 total);

    event Deposited(address indexed user, uint256 amount);
    event Withdrawn(address indexed user, uint256 amount);
}
```

### 6. LendingPool (LP 借贷)

```solidity
interface ILendingPool {
    struct PoolInfo {
        address memeToken;        // MEME 代币
        uint256 totalDeposits;    // 总存款
        uint256 totalBorrowed;    // 总借出
        uint256 utilizationRate;  // 利用率 (基点)
        uint256 borrowRate;       // 借贷年化利率 (基点)
        uint256 supplyRate;       // 存款年化利率 (基点)
    }

    /// @notice 获取池子信息
    function getPoolInfo(address memeToken) external view returns (PoolInfo memory);

    /// @notice 获取用户存款
    function getUserDeposit(
        address memeToken,
        address user
    ) external view returns (
        uint256 depositAmount,
        uint256 pendingReward
    );

    /// @notice 计算借贷利率
    /// @param utilizationRate 利用率 (基点)
    /// @return borrowRate 借贷年化利率 (基点)
    function calculateBorrowRate(uint256 utilizationRate) external pure returns (uint256);

    event Deposited(
        address indexed memeToken,
        address indexed user,
        uint256 amount,
        uint256 lpTokens
    );

    event Withdrawn(
        address indexed memeToken,
        address indexed user,
        uint256 amount,
        uint256 lpTokens
    );

    event Borrowed(
        address indexed memeToken,
        bytes32 indexed positionId,
        uint256 amount
    );

    event Repaid(
        address indexed memeToken,
        bytes32 indexed positionId,
        uint256 amount,
        uint256 interest
    );
}
```

### 7. FundingRate (资金费率)

```solidity
interface IFundingRate {
    /// @notice 获取当前资金费率
    /// @param memeToken MEME 代币地址
    /// @return rate 资金费率 (可正可负, 18 位精度)
    function getCurrentFundingRate(address memeToken) external view returns (int256 rate);

    /// @notice 获取下次结算时间
    /// @return nextFundingTime 下次结算的 Unix 时间戳
    function getNextFundingTime() external view returns (uint256 nextFundingTime);

    /// @notice 计算仓位的待结算资金费
    /// @param positionId 仓位 ID
    /// @return fundingFee 待结算资金费 (可正可负)
    function getPendingFunding(bytes32 positionId) external view returns (int256 fundingFee);

    /// @notice 结算资金费 (仅 Keeper)
    /// @param memeToken MEME 代币地址
    function settleFunding(address memeToken) external;

    event FundingSettled(
        address indexed memeToken,
        int256 fundingRate,
        uint256 timestamp
    );
}
```

### 8. Liquidation (清算引擎)

```solidity
interface ILiquidation {
    /// @notice 清算仓位
    /// @param positionId 仓位 ID
    /// @return liquidationReward 清算人奖励
    function liquidate(bytes32 positionId) external returns (uint256 liquidationReward);

    /// @notice 批量清算
    /// @param positionIds 仓位 ID 数组
    /// @return totalReward 总奖励
    function liquidateBatch(bytes32[] calldata positionIds) external returns (uint256 totalReward);

    /// @notice 获取清算参数
    /// @return liquidationFeeRate 清算费率 (基点)
    /// @return liquidatorRewardRate 清算人奖励率 (基点)
    /// @return maintenanceMarginRate 维持保证金率 (基点)
    function getLiquidationParams() external view returns (
        uint256 liquidationFeeRate,
        uint256 liquidatorRewardRate,
        uint256 maintenanceMarginRate
    );

    event Liquidated(
        bytes32 indexed positionId,
        address indexed trader,
        address indexed liquidator,
        uint256 liquidationPrice,
        uint256 liquidatorReward,
        uint256 remainingCollateral
    );
}
```

### 9. Presale (内盘认购)

```solidity
interface IPresale {
    struct PresaleInfo {
        string name;              // 代币名称
        string symbol;            // 代币符号
        address creator;          // 创建者
        uint256 targetAmount;     // 目标募集 (BNB)
        uint256 raisedAmount;     // 已募集 (BNB)
        uint256 totalSupply;      // 代币总量
        uint256 startTime;        // 开始时间
        uint256 endTime;          // 结束时间
        uint256 minSubscription;  // 最小认购
        uint256 maxSubscription;  // 最大认购
        bool isActive;            // 是否活跃
        bool isCompleted;         // 是否完成
        address tokenAddress;     // 部署后的代币地址
    }

    /// @notice 创建内盘
    /// @param name 代币名称
    /// @param symbol 代币符号
    /// @param totalSupply 代币总量
    /// @param duration 持续时间 (秒)
    /// @return presaleId 内盘 ID
    function createPresale(
        string calldata name,
        string calldata symbol,
        uint256 totalSupply,
        uint256 duration
    ) external returns (bytes32 presaleId);

    /// @notice 认购
    /// @param presaleId 内盘 ID
    function subscribe(bytes32 presaleId) external payable;

    /// @notice 退款
    /// @param presaleId 内盘 ID
    function refund(bytes32 presaleId) external;

    /// @notice 领取代币 (认购完成后)
    /// @param presaleId 内盘 ID
    function claim(bytes32 presaleId) external;

    /// @notice 获取内盘信息
    function getPresaleInfo(bytes32 presaleId) external view returns (PresaleInfo memory);

    /// @notice 获取用户认购信息
    function getUserSubscription(
        bytes32 presaleId,
        address user
    ) external view returns (uint256 amount, bool hasClaimed);

    event PresaleCreated(
        bytes32 indexed presaleId,
        address indexed creator,
        string name,
        string symbol,
        uint256 targetAmount
    );

    event Subscribed(
        bytes32 indexed presaleId,
        address indexed subscriber,
        uint256 amount
    );

    event Refunded(
        bytes32 indexed presaleId,
        address indexed subscriber,
        uint256 amount
    );

    event PresaleCompleted(
        bytes32 indexed presaleId,
        address tokenAddress,
        address poolAddress
    );

    event Claimed(
        bytes32 indexed presaleId,
        address indexed subscriber,
        uint256 tokenAmount
    );
}
```

### 10. Referral (推荐返佣)

```solidity
interface IReferral {
    /// @notice 设置推荐人
    /// @param referrer 推荐人地址
    function setReferrer(address referrer) external;

    /// @notice 通过推荐码设置推荐人
    /// @param code 推荐码
    function setReferrerByCode(string calldata code) external;

    /// @notice 获取推荐码
    /// @param user 用户地址
    /// @return code 推荐码
    function getReferralCode(address user) external view returns (string memory code);

    /// @notice 获取推荐人
    /// @param user 用户地址
    /// @return referrer 推荐人地址
    function getReferrer(address user) external view returns (address referrer);

    /// @notice 获取推荐统计
    /// @param user 用户地址
    /// @return referralCount 推荐人数
    /// @return totalRebate 总返佣
    /// @return level 推荐等级
    function getReferralStats(address user) external view returns (
        uint256 referralCount,
        uint256 totalRebate,
        uint256 level
    );

    /// @notice 领取返佣
    function claimRebate() external returns (uint256 amount);

    event ReferrerSet(address indexed user, address indexed referrer, string code);
    event RebateRecorded(address indexed referrer, address indexed trader, uint256 amount);
    event RebateClaimed(address indexed user, uint256 amount);
}
```

---

## 错误码

```solidity
// 通用错误
error InvalidAddress();
error InvalidAmount();
error Unauthorized();
error Paused();

// 交易错误
error InsufficientBalance();
error InsufficientMargin();
error ExceedsMaxLeverage();
error ExceedsPositionLimit();
error PriceSlippageExceeded();
error PositionNotFound();
error InvalidPositionSize();

// 清算错误
error NotLiquidatable();
error AlreadyLiquidated();

// 内盘错误
error PresaleNotActive();
error PresaleCompleted();
error ExceedsSubscriptionLimit();
error RefundNotAllowed();

// 价格错误
error StalePrice();
error InvalidPrice();
```

---

## 事件监听 (后端索引)

后端需要监听以下事件以保持数据同步:

1. **Router**
   - `PositionOpened` - 新仓位
   - `PositionClosed` - 平仓
   - `OrderCreated` - 新订单
   - `OrderExecuted` - 订单成交
   - `OrderCancelled` - 订单取消

2. **AMM**
   - `Swap` - 现货交易

3. **LendingPool**
   - `Deposited` - LP 存款
   - `Withdrawn` - LP 取款

4. **FundingRate**
   - `FundingSettled` - 资金费结算

5. **Liquidation**
   - `Liquidated` - 清算事件

6. **Presale**
   - `PresaleCreated` - 内盘创建
   - `Subscribed` - 认购
   - `PresaleCompleted` - 内盘完成
