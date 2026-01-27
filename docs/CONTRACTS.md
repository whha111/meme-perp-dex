# 智能合约接口文档

## 目录
1. [MemeToken](#1-memetoken)
2. [LPToken](#2-lptoken)
3. [Vault](#3-vault)
4. [AMM](#4-amm)
5. [PriceFeed](#5-pricefeed)
6. [LendingPool](#6-lendingpool)
7. [PositionManager](#7-positionmanager)
8. [OrderBook](#8-orderbook)
9. [TakeProfitStopLoss](#9-takeprofitsstoploss)
10. [FundingRate](#10-fundingrate)
11. [Liquidation](#11-liquidation)
12. [RiskManager](#12-riskmanager)
13. [Presale](#13-presale)
14. [Referral](#14-referral)
15. [Router](#15-router)
16. [Reader](#16-reader)

---

## 1. MemeToken

MEME 代币合约，标准 ERC20。

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/ERC20Burnable.sol";

contract MemeToken is ERC20, ERC20Burnable {
    uint256 public constant TOTAL_SUPPLY = 1_000_000_000 * 1e18; // 10亿

    constructor() ERC20("MEME", "MEME") {
        _mint(msg.sender, TOTAL_SUPPLY);
    }
}
```

---

## 2. LPToken

LP 存款凭证代币。

```solidity
interface ILPToken {
    // ========== 事件 ==========
    event Mint(address indexed to, uint256 amount);
    event Burn(address indexed from, uint256 amount);

    // ========== 写入函数 ==========

    /// @notice 铸造 LP Token（仅 LendingPool 可调用）
    function mint(address to, uint256 amount) external;

    /// @notice 销毁 LP Token（仅 LendingPool 可调用）
    function burn(address from, uint256 amount) external;
}
```

---

## 3. Vault

BNB 保证金托管合约。

```solidity
interface IVault {
    // ========== 事件 ==========
    event Deposit(address indexed user, uint256 amount);
    event Withdraw(address indexed user, uint256 amount);
    event MarginLocked(address indexed user, uint256 amount);
    event MarginUnlocked(address indexed user, uint256 amount);
    event PnLSettled(address indexed from, address indexed to, uint256 amount);

    // ========== 读取函数 ==========

    /// @notice 获取用户可用余额
    function getBalance(address user) external view returns (uint256);

    /// @notice 获取用户锁定余额（保证金）
    function getLockedBalance(address user) external view returns (uint256);

    /// @notice 获取用户总余额
    function getTotalBalance(address user) external view returns (uint256);

    // ========== 用户函数 ==========

    /// @notice 存入 BNB
    function deposit() external payable;

    /// @notice 取出 BNB
    /// @param amount 取出数量
    function withdraw(uint256 amount) external;

    // ========== 内部函数（仅授权合约可调用） ==========

    /// @notice 锁定保证金
    function lockMargin(address user, uint256 amount) external;

    /// @notice 解锁保证金
    function unlockMargin(address user, uint256 amount) external;

    /// @notice 结算盈亏
    function settlePnL(address winner, address loser, uint256 amount) external;

    /// @notice 清算时分配资金
    function distributeLiquidation(
        address liquidatedUser,
        address liquidator,
        uint256 liquidatorReward,
        uint256 remainingToPool
    ) external;
}
```

---

## 4. AMM

现货交易和定价合约。

```solidity
interface IAMM {
    // ========== 事件 ==========
    event Swap(
        address indexed user,
        bool isBuy,           // true = BNB→MEME, false = MEME→BNB
        uint256 amountIn,
        uint256 amountOut
    );
    event LiquidityAdded(address indexed user, uint256 bnbAmount, uint256 memeAmount);
    event LiquidityRemoved(address indexed user, uint256 bnbAmount, uint256 memeAmount);

    // ========== 读取函数 ==========

    /// @notice 获取当前现货价格 (MEME/BNB)
    function getSpotPrice() external view returns (uint256);

    /// @notice 获取储备量
    function getReserves() external view returns (uint256 bnbReserve, uint256 memeReserve);

    /// @notice 计算输出数量
    function getAmountOut(bool isBuy, uint256 amountIn) external view returns (uint256);

    /// @notice 计算价格影响
    function getPriceImpact(bool isBuy, uint256 amountIn) external view returns (uint256);

    // ========== 写入函数 ==========

    /// @notice 用 BNB 买 MEME
    /// @param minAmountOut 最小输出数量（滑点保护）
    function swapBNBForMeme(uint256 minAmountOut) external payable returns (uint256 memeOut);

    /// @notice 用 MEME 买 BNB
    /// @param memeAmount 输入的 MEME 数量
    /// @param minAmountOut 最小输出数量（滑点保护）
    function swapMemeForBNB(uint256 memeAmount, uint256 minAmountOut) external returns (uint256 bnbOut);

    /// @notice 添加流动性
    function addLiquidity() external payable returns (uint256 lpTokens);

    /// @notice 移除流动性
    function removeLiquidity(uint256 lpTokens) external returns (uint256 bnbOut, uint256 memeOut);
}
```

---

## 5. PriceFeed

价格聚合和 TWAP 计算。

```solidity
interface IPriceFeed {
    // ========== 事件 ==========
    event PriceUpdated(uint256 price, uint256 timestamp);

    // ========== 读取函数 ==========

    /// @notice 获取当前现货价格
    function getSpotPrice() external view returns (uint256);

    /// @notice 获取 TWAP 价格（用于清算）
    function getTWAP() external view returns (uint256);

    /// @notice 获取标记价格（现货和 TWAP 的加权平均）
    function getMarkPrice() external view returns (uint256);

    /// @notice 获取价格历史
    function getPriceHistory(uint256 count) external view returns (
        uint256[] memory prices,
        uint256[] memory timestamps
    );

    // ========== 写入函数 ==========

    /// @notice 更新价格（由 AMM 调用）
    function updatePrice(uint256 newPrice) external;
}
```

---

## 6. LendingPool

LP 存币借贷合约。

```solidity
interface ILendingPool {
    // ========== 事件 ==========
    event Deposited(address indexed user, uint256 amount, uint256 lpTokens);
    event Withdrawn(address indexed user, uint256 amount, uint256 lpTokens);
    event Borrowed(address indexed user, uint256 amount);
    event Repaid(address indexed user, uint256 amount, uint256 interest);
    event InterestClaimed(address indexed user, uint256 amount);

    // ========== 读取函数 ==========

    /// @notice 获取总存款
    function getTotalDeposits() external view returns (uint256);

    /// @notice 获取总借出
    function getTotalBorrowed() external view returns (uint256);

    /// @notice 获取利用率 (借出/总存款)
    function getUtilization() external view returns (uint256);

    /// @notice 获取当前借贷利率 (年化)
    function getBorrowRate() external view returns (uint256);

    /// @notice 获取当前存款利率 (年化)
    function getSupplyRate() external view returns (uint256);

    /// @notice 获取用户存款数量
    function getUserDeposit(address user) external view returns (uint256);

    /// @notice 获取用户待领取利息
    function getPendingInterest(address user) external view returns (uint256);

    /// @notice 获取用户借款数量
    function getUserBorrow(address user) external view returns (uint256);

    // ========== LP 函数 ==========

    /// @notice 存入 MEME 币
    /// @param amount 存入数量
    /// @return lpTokens 获得的 LP Token 数量
    function deposit(uint256 amount) external returns (uint256 lpTokens);

    /// @notice 取出 MEME 币
    /// @param lpTokens 销毁的 LP Token 数量
    /// @return amount 取回的 MEME 数量
    function withdraw(uint256 lpTokens) external returns (uint256 amount);

    /// @notice 领取利息
    /// @return interest 领取的利息数量
    function claimInterest() external returns (uint256 interest);

    // ========== 借贷函数（仅授权合约可调用） ==========

    /// @notice 借出 MEME（做空用）
    function borrow(address borrower, uint256 amount) external;

    /// @notice 归还 MEME
    function repay(address borrower, uint256 amount) external;
}
```

---

## 7. PositionManager

仓位管理核心合约。

```solidity
interface IPositionManager {
    // ========== 结构体 ==========
    struct Position {
        bool isLong;              // 方向：true=多, false=空
        uint256 size;             // 仓位大小 (BNB)
        uint256 collateral;       // 保证金 (BNB)
        uint256 entryPrice;       // 开仓价格
        uint256 leverage;         // 杠杆倍数
        uint256 borrowedMeme;     // 借的 MEME 数量（做空）
        uint256 lastFundingTime;  // 上次资金费结算时间
        int256 accFundingFee;     // 累计资金费
    }

    // ========== 事件 ==========
    event PositionOpened(
        address indexed user,
        bool isLong,
        uint256 size,
        uint256 collateral,
        uint256 leverage,
        uint256 entryPrice
    );
    event PositionClosed(
        address indexed user,
        bool isLong,
        uint256 size,
        uint256 entryPrice,
        uint256 exitPrice,
        int256 pnl
    );
    event PositionModified(
        address indexed user,
        uint256 newCollateral,
        uint256 newSize
    );
    event PositionLiquidated(
        address indexed user,
        address indexed liquidator,
        uint256 size,
        uint256 collateral
    );

    // ========== 读取函数 ==========

    /// @notice 获取用户仓位
    function getPosition(address user) external view returns (Position memory);

    /// @notice 计算未实现盈亏
    function getUnrealizedPnL(address user) external view returns (int256);

    /// @notice 计算保证金率
    function getMarginRatio(address user) external view returns (uint256);

    /// @notice 计算清算价格
    function getLiquidationPrice(address user) external view returns (uint256);

    /// @notice 获取总多头持仓
    function getTotalLongSize() external view returns (uint256);

    /// @notice 获取总空头持仓
    function getTotalShortSize() external view returns (uint256);

    /// @notice 检查是否可以开仓
    function canOpenPosition(
        address user,
        bool isLong,
        uint256 size,
        uint256 leverage
    ) external view returns (bool, string memory);

    // ========== 写入函数 ==========

    /// @notice 开多仓
    /// @param size 仓位大小 (BNB)
    /// @param leverage 杠杆倍数
    function openLong(uint256 size, uint256 leverage) external;

    /// @notice 开空仓
    /// @param size 仓位大小 (BNB)
    /// @param leverage 杠杆倍数
    function openShort(uint256 size, uint256 leverage) external;

    /// @notice 平仓
    function closePosition() external;

    /// @notice 部分平仓
    /// @param percentage 平仓比例 (1-100)
    function closePositionPartial(uint256 percentage) external;

    /// @notice 追加保证金
    function addCollateral() external payable;

    /// @notice 减少保证金
    /// @param amount 减少数量
    function removeCollateral(uint256 amount) external;

    // ========== 内部函数 ==========

    /// @notice 强制平仓（清算用）
    function forceClose(address user) external;
}
```

---

## 8. OrderBook

限价单管理合约。

```solidity
interface IOrderBook {
    // ========== 结构体 ==========
    struct Order {
        address user;
        bool isLong;              // 方向
        uint256 size;             // 仓位大小
        uint256 leverage;         // 杠杆
        uint256 triggerPrice;     // 触发价格
        uint256 collateral;       // 抵押的保证金
        uint256 createdAt;        // 创建时间
        uint256 expireAt;         // 过期时间
        bool isActive;            // 是否有效
        OrderType orderType;      // 订单类型
    }

    enum OrderType {
        LIMIT_OPEN_LONG,      // 限价开多
        LIMIT_OPEN_SHORT,     // 限价开空
        LIMIT_CLOSE           // 限价平仓
    }

    // ========== 事件 ==========
    event OrderCreated(
        uint256 indexed orderId,
        address indexed user,
        OrderType orderType,
        uint256 triggerPrice
    );
    event OrderExecuted(uint256 indexed orderId, uint256 executionPrice);
    event OrderCancelled(uint256 indexed orderId);
    event OrderExpired(uint256 indexed orderId);

    // ========== 读取函数 ==========

    /// @notice 获取订单
    function getOrder(uint256 orderId) external view returns (Order memory);

    /// @notice 获取用户所有订单
    function getUserOrders(address user) external view returns (uint256[] memory orderIds);

    /// @notice 获取可执行的订单
    function getExecutableOrders() external view returns (uint256[] memory orderIds);

    // ========== 写入函数 ==========

    /// @notice 创建限价开多单
    function createLimitLong(
        uint256 size,
        uint256 leverage,
        uint256 triggerPrice,
        uint256 duration         // 有效期（秒）
    ) external payable returns (uint256 orderId);

    /// @notice 创建限价开空单
    function createLimitShort(
        uint256 size,
        uint256 leverage,
        uint256 triggerPrice,
        uint256 duration
    ) external payable returns (uint256 orderId);

    /// @notice 创建限价平仓单
    function createLimitClose(
        uint256 triggerPrice,
        uint256 duration
    ) external returns (uint256 orderId);

    /// @notice 取消订单
    function cancelOrder(uint256 orderId) external;

    /// @notice 执行订单（Keeper 调用）
    function executeOrder(uint256 orderId) external;

    /// @notice 批量执行订单
    function executeOrders(uint256[] calldata orderIds) external;
}
```

---

## 9. TakeProfitStopLoss

止盈止损合约。

```solidity
interface ITakeProfitStopLoss {
    // ========== 结构体 ==========
    struct TPSL {
        uint256 takeProfitPrice;     // 止盈价 (0 = 不设置)
        uint256 stopLossPrice;       // 止损价 (0 = 不设置)
        uint256 trailingStopPercent; // 追踪止损百分比 (0 = 不设置)
        uint256 highestPrice;        // 追踪止损最高价记录
        uint256 lowestPrice;         // 追踪止损最低价记录
        bool isActive;
    }

    // ========== 事件 ==========
    event TPSLSet(
        address indexed user,
        uint256 takeProfitPrice,
        uint256 stopLossPrice,
        uint256 trailingStopPercent
    );
    event TPSLTriggered(
        address indexed user,
        string triggerType,    // "TP" / "SL" / "TRAILING"
        uint256 triggerPrice
    );
    event TPSLCancelled(address indexed user);

    // ========== 读取函数 ==========

    /// @notice 获取用户止盈止损设置
    function getTPSL(address user) external view returns (TPSL memory);

    /// @notice 检查是否应该触发
    function shouldTrigger(address user) external view returns (
        bool shouldTP,
        bool shouldSL,
        bool shouldTrailing
    );

    /// @notice 获取所有可触发的用户
    function getTriggerable() external view returns (address[] memory users);

    // ========== 写入函数 ==========

    /// @notice 设置止盈止损
    /// @param takeProfitPrice 止盈价 (0 = 不设置)
    /// @param stopLossPrice 止损价 (0 = 不设置)
    function setTPSL(
        uint256 takeProfitPrice,
        uint256 stopLossPrice
    ) external;

    /// @notice 设置追踪止损
    /// @param percent 回撤百分比 (例: 500 = 5%)
    function setTrailingStop(uint256 percent) external;

    /// @notice 取消止盈止损
    function cancelTPSL() external;

    /// @notice 触发止盈止损（Keeper 调用）
    function trigger(address user) external;

    /// @notice 批量触发
    function triggerBatch(address[] calldata users) external;

    /// @notice 更新追踪止损价格（Keeper 调用）
    function updateTrailingPrice(address user) external;
}
```

---

## 10. FundingRate

资金费率合约。

```solidity
interface IFundingRate {
    // ========== 事件 ==========
    event FundingSettled(
        uint256 timestamp,
        int256 fundingRate,
        uint256 totalLongPaid,
        uint256 totalShortPaid
    );
    event FundingPaid(address indexed user, int256 amount);

    // ========== 读取函数 ==========

    /// @notice 获取当前资金费率
    function getCurrentFundingRate() external view returns (int256);

    /// @notice 获取下次结算时间
    function getNextFundingTime() external view returns (uint256);

    /// @notice 获取用户待结算资金费
    function getPendingFunding(address user) external view returns (int256);

    /// @notice 获取资金费率历史
    function getFundingHistory(uint256 count) external view returns (
        int256[] memory rates,
        uint256[] memory timestamps
    );

    // ========== 写入函数 ==========

    /// @notice 结算资金费（每4小时，Keeper 调用）
    function settleFunding() external;

    /// @notice 结算单个用户的资金费
    function settleUserFunding(address user) external;
}
```

---

## 11. Liquidation

清算合约。

```solidity
interface ILiquidation {
    // ========== 事件 ==========
    event Liquidated(
        address indexed user,
        address indexed liquidator,
        uint256 size,
        uint256 collateral,
        uint256 liquidatorReward
    );

    // ========== 读取函数 ==========

    /// @notice 检查用户是否可被清算
    function canLiquidate(address user) external view returns (bool);

    /// @notice 获取可清算用户列表
    function getLiquidatableUsers() external view returns (address[] memory);

    /// @notice 计算清算奖励
    function getLiquidationReward(address user) external view returns (uint256);

    // ========== 写入函数 ==========

    /// @notice 清算用户
    /// @param user 被清算用户
    function liquidate(address user) external;

    /// @notice 批量清算
    function liquidateBatch(address[] calldata users) external;
}
```

---

## 12. RiskManager

风控参数管理。

```solidity
interface IRiskManager {
    // ========== 事件 ==========
    event ParameterUpdated(string parameter, uint256 oldValue, uint256 newValue);

    // ========== 读取函数 ==========

    /// @notice 获取最大杠杆
    function getMaxLeverage() external view returns (uint256);

    /// @notice 获取维持保证金率
    function getMaintenanceMarginRate(uint256 leverage) external view returns (uint256);

    /// @notice 获取单仓位上限
    function getMaxPositionSize() external view returns (uint256);

    /// @notice 获取总持仓上限
    function getMaxOpenInterest() external view returns (uint256);

    /// @notice 获取价格影响上限
    function getMaxPriceImpact() external view returns (uint256);

    /// @notice 验证开仓参数
    function validateOpenPosition(
        address user,
        bool isLong,
        uint256 size,
        uint256 leverage
    ) external view returns (bool isValid, string memory reason);

    // ========== 管理函数（Owner） ==========

    function setMaxLeverage(uint256 value) external;
    function setMaintenanceMarginRate(uint256 leverage, uint256 rate) external;
    function setMaxPositionSize(uint256 value) external;
    function setMaxOpenInterest(uint256 value) external;
    function setMaxPriceImpact(uint256 value) external;
}
```

---

## 13. Presale

内盘认购合约。

```solidity
interface IPresale {
    // ========== 状态枚举 ==========
    enum Status {
        PENDING,      // 未开始
        ACTIVE,       // 认购中
        FILLED,       // 已打满
        CANCELLED,    // 已取消
        FINALIZED     // 已完成
    }

    // ========== 事件 ==========
    event Subscribed(address indexed user, uint256 bnbAmount, uint256 memeAmount);
    event Refunded(address indexed user, uint256 amount);
    event PresaleFilled(uint256 totalRaised);
    event PresaleFinalized();
    event PresaleCancelled();

    // ========== 读取函数 ==========

    /// @notice 获取认购状态
    function getStatus() external view returns (Status);

    /// @notice 获取募集目标
    function getTarget() external view returns (uint256);

    /// @notice 获取已募集金额
    function getRaised() external view returns (uint256);

    /// @notice 获取用户认购数量
    function getUserSubscription(address user) external view returns (uint256 bnb, uint256 meme);

    /// @notice 获取剩余时间
    function getRemainingTime() external view returns (uint256);

    /// @notice 是否可以退款
    function canRefund(address user) external view returns (bool);

    // ========== 写入函数 ==========

    /// @notice 认购
    function subscribe() external payable;

    /// @notice 退款
    function refund() external;

    /// @notice 领取代币（打满后）
    function claim() external returns (uint256 memeAmount);

    // ========== 管理函数 ==========

    /// @notice 开始认购
    function start(uint256 duration) external;

    /// @notice 取消认购（退款所有人）
    function cancel() external;

    /// @notice 完成认购（激活交易）
    function finalize() external;
}
```

---

## 14. Referral

推荐返佣合约。

```solidity
interface IReferral {
    // ========== 事件 ==========
    event ReferrerSet(address indexed user, address indexed referrer);
    event CommissionPaid(
        address indexed referrer,
        address indexed trader,
        uint256 amount
    );
    event CommissionClaimed(address indexed referrer, uint256 amount);

    // ========== 读取函数 ==========

    /// @notice 获取用户的推荐人
    function getReferrer(address user) external view returns (address);

    /// @notice 获取推荐人等级
    function getReferrerTier(address referrer) external view returns (uint256);

    /// @notice 获取返佣比例
    function getCommissionRate(address referrer) external view returns (uint256);

    /// @notice 获取待领取返佣
    function getPendingCommission(address referrer) external view returns (uint256);

    /// @notice 获取推荐人数
    function getReferralCount(address referrer) external view returns (uint256);

    // ========== 写入函数 ==========

    /// @notice 设置推荐人
    function setReferrer(address referrer) external;

    /// @notice 记录返佣（交易时调用）
    function recordCommission(address trader, uint256 fee) external;

    /// @notice 领取返佣
    function claimCommission() external returns (uint256);
}
```

---

## 15. Router

统一交互入口。

```solidity
interface IRouter {
    // ========== 现货交易 ==========

    function swapBNBForMeme(uint256 minOut) external payable;
    function swapMemeForBNB(uint256 memeAmount, uint256 minOut) external;

    // ========== LP 操作 ==========

    function depositLP(uint256 memeAmount) external;
    function withdrawLP(uint256 lpTokens) external;
    function claimLPRewards() external;

    // ========== 保证金 ==========

    function depositMargin() external payable;
    function withdrawMargin(uint256 amount) external;

    // ========== 永续交易 ==========

    function openLong(uint256 size, uint256 leverage) external;
    function openShort(uint256 size, uint256 leverage) external;
    function closePosition() external;
    function closePositionPartial(uint256 percentage) external;
    function addCollateral() external payable;
    function removeCollateral(uint256 amount) external;

    // ========== 止盈止损 ==========

    function setTPSL(uint256 tpPrice, uint256 slPrice) external;
    function setTrailingStop(uint256 percent) external;
    function cancelTPSL() external;

    // ========== 限价单 ==========

    function createLimitLong(
        uint256 size,
        uint256 leverage,
        uint256 triggerPrice,
        uint256 duration
    ) external payable;

    function createLimitShort(
        uint256 size,
        uint256 leverage,
        uint256 triggerPrice,
        uint256 duration
    ) external payable;

    function cancelOrder(uint256 orderId) external;

    // ========== 推荐 ==========

    function setReferrer(address referrer) external;
    function claimReferralRewards() external;

    // ========== 内盘 ==========

    function presaleSubscribe() external payable;
    function presaleRefund() external;
    function presaleClaim() external;
}
```

---

## 16. Reader

只读查询合约（给前端用）。

```solidity
interface IReader {
    // ========== 聚合查询 ==========

    /// @notice 获取用户完整信息
    function getUserInfo(address user) external view returns (
        uint256 bnbBalance,           // Vault 中的 BNB
        uint256 lockedBalance,        // 锁定的保证金
        uint256 memeBalance,          // MEME 余额
        uint256 lpBalance,            // LP Token 余额
        uint256 lpValue,              // LP 价值 (MEME)
        uint256 pendingLPRewards,     // LP 待领利息
        uint256 pendingReferral       // 待领返佣
    );

    /// @notice 获取用户仓位信息
    function getPositionInfo(address user) external view returns (
        bool hasPosition,
        bool isLong,
        uint256 size,
        uint256 collateral,
        uint256 leverage,
        uint256 entryPrice,
        uint256 markPrice,
        int256 unrealizedPnL,
        uint256 marginRatio,
        uint256 liquidationPrice,
        int256 pendingFunding
    );

    /// @notice 获取市场信息
    function getMarketInfo() external view returns (
        uint256 spotPrice,
        uint256 markPrice,
        uint256 twapPrice,
        int256 fundingRate,
        uint256 nextFundingTime,
        uint256 totalLongSize,
        uint256 totalShortSize,
        uint256 longShortRatio
    );

    /// @notice 获取 LP 池信息
    function getLPInfo() external view returns (
        uint256 totalDeposits,
        uint256 totalBorrowed,
        uint256 utilization,
        uint256 borrowRate,
        uint256 supplyRate
    );

    /// @notice 获取用户订单
    function getUserOrders(address user) external view returns (
        uint256[] memory orderIds,
        IOrderBook.Order[] memory orders
    );

    /// @notice 获取可清算用户
    function getLiquidatableUsers(uint256 limit) external view returns (
        address[] memory users,
        uint256[] memory rewards
    );

    /// @notice 批量获取多个用户仓位
    function getPositions(address[] calldata users) external view returns (
        IPositionManager.Position[] memory positions
    );
}
```

---

## 事件汇总

所有重要事件，用于前端监听和后端索引：

```solidity
// 交易相关
event PositionOpened(address user, bool isLong, uint256 size, uint256 leverage, uint256 price);
event PositionClosed(address user, bool isLong, uint256 size, int256 pnl);
event PositionLiquidated(address user, address liquidator, uint256 size);

// 订单相关
event OrderCreated(uint256 orderId, address user, uint256 price);
event OrderExecuted(uint256 orderId, uint256 price);
event OrderCancelled(uint256 orderId);

// 止盈止损
event TPSLTriggered(address user, string triggerType, uint256 price);

// 资金费
event FundingSettled(int256 rate, uint256 longPaid, uint256 shortPaid);

// LP 相关
event LPDeposited(address user, uint256 amount);
event LPWithdrawn(address user, uint256 amount);

// 内盘
event Subscribed(address user, uint256 amount);
event Refunded(address user, uint256 amount);
event PresaleFinalized();
```
