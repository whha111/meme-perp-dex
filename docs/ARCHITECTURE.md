# 系统架构文档

## 业务流程

```
┌─────────────────────────────────────────────────────────────┐
│                      完整业务流程                            │
│                                                             │
│    阶段一：内盘认购              阶段二：交易阶段             │
│    ─────────────────            ─────────────────────        │
│                                                             │
│    用户存 BNB 认购               同时开启两个功能            │
│         │                              │                    │
│         ▼                              ▼                    │
│    ┌─────────┐   打满 50 BNB    ┌─────────────────┐        │
│    │ 可退款   │ ───────────────► │ 1. 现货交易(AMM) │        │
│    │ 未打满   │                 │ 2. 永续合约交易  │        │
│    │ 自动退款 │                 │ 3. LP存币赚息   │        │
│    └─────────┘                 └─────────────────┘        │
│                                                             │
│    关键：内盘结束后，现货和合约同时开启                       │
│    价格由 AMM 现货交易驱动，永续合约使用 AMM 价格             │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

## 合约架构图

```
                                    用户
                                      │
                                      ▼
                    ┌─────────────────────────────────────┐
                    │            Router.sol               │
                    │         (统一交互入口)               │
                    └─────────────────────────────────────┘
                                      │
          ┌───────────────────────────┼───────────────────────────┐
          │                           │                           │
          ▼                           ▼                           ▼
┌─────────────────┐       ┌─────────────────┐       ┌─────────────────┐
│   Presale.sol   │       │    AMM.sol      │       │PositionManager  │
│   (内盘认购)     │       │  (现货交易)     │       │   (永续交易)     │
└─────────────────┘       └─────────────────┘       └─────────────────┘
          │                         │                         │
          │   打满后初始化           │                         │
          └────────────────────────►│                         │
                                    ▼                         │
                          ┌─────────────────┐                 │
                          │  PriceFeed.sol  │◄────────────────┤
                          │   (价格聚合)    │    (读取价格)
                          │   (TWAP计算)    │
                          └─────────────────┘
                                    ▲
                                    │ 交易后更新价格
                                    │
┌─────────────────┐       ┌─────────────────┐       ┌─────────────────┐
│  MemeToken.sol  │◄──────│    AMM.sol      │       │   Vault.sol     │
│   (MEME代币)    │       │   (储备金)      │       │  (保证金托管)    │
└─────────────────┘       └─────────────────┘       └─────────────────┘
          │                                                   │
          ▼                                                   │
┌─────────────────┐                                          │
│ LendingPool.sol │◄─────────────────────────────────────────┘
│  (LP存币借贷)   │              (做空借币)
└─────────────────┘
          │
          ▼
┌─────────────────┐
│   LPToken.sol   │
│   (LP凭证)      │
└─────────────────┘


                    ┌─────────────────────────────────────┐
                    │           Keeper Services           │
                    └─────────────────────────────────────┘
                                      │
          ┌───────────────────────────┼───────────────────────────┐
          │                           │                           │
          ▼                           ▼                           ▼
┌─────────────────┐       ┌─────────────────┐       ┌─────────────────┐
│Liquidation.sol  │       │  OrderBook.sol  │       │FundingRate.sol  │
│   (清算引擎)    │       │   (限价单)      │       │  (资金费率)     │
└─────────────────┘       └─────────────────┘       └─────────────────┘
          │                         │
          ▼                         ▼
┌─────────────────┐       ┌─────────────────┐
│TakeProfitStop   │       │ RiskManager.sol │
│   Loss.sol      │       │   (风控管理)    │
│ (止盈止损)      │       └─────────────────┘
└─────────────────┘
```

---

## 数据流图

### 1. 开多仓流程

```
用户调用 Router.openLong(size, leverage)
                │
                ▼
        Router.openLong()
                │
                ├──► Vault.lockMargin(user, margin)     // 锁定 BNB 保证金
                │
                ├──► PriceFeed.getMarkPrice()           // 获取标记价格（从AMM）
                │
                ├──► RiskManager.validatePosition()     // 风控检查
                │
                └──► PositionManager.openLong()         // 创建仓位
                            │
                            ├── 记录仓位信息
                            ├── 更新总持仓量
                            └── 触发事件 PositionOpened

注意：开仓不直接影响价格，价格由现货交易驱动
```

### 2. 开空仓流程

```
用户调用 Router.openShort(size, leverage)
                │
                ▼
        Router.openShort()
                │
                ├──► Vault.lockMargin(user, margin)     // 锁定 BNB 保证金
                │
                ├──► LendingPool.borrow(memeAmount)     // 借 MEME 币
                │
                ├──► PriceFeed.getMarkPrice()           // 获取标记价格（从AMM）
                │
                ├──► RiskManager.validatePosition()     // 风控检查
                │
                └──► PositionManager.openShort()        // 创建仓位
                            │
                            ├── 记录仓位信息
                            ├── 记录借币数量
                            ├── 更新总持仓量
                            └── 触发事件 PositionOpened

注意：开仓不直接影响价格，价格由现货交易驱动
```

### 2.5 现货交易流程（价格驱动）

```
用户调用 Router.swapBNBForMeme(minMemeOut)
                │
                ▼
        Router.swapBNBForMeme()
                │
                ├──► AMM.swapBNBForMeme()               // 执行交易
                │          │
                │          ├── 更新储备金
                │          ├── 转出 MEME 给用户
                │          └── 价格上涨
                │
                └──► PriceFeed.updatePrice()            // 记录价格历史
                            │
                            └── 触发事件 PriceUpdated

价格变动影响：
├── 永续合约标记价格变化
├── 多头/空头盈亏变化
└── 可能触发清算
```

### 3. 平仓流程

```
用户调用 Router.closePosition()
                │
                ▼
        Router.closePosition()
                │
                ├──► PriceFeed.getMarkPrice()           // 获取标记价格
                │
                ├──► PositionManager.calculatePnL()     // 计算盈亏
                │
                ├──► FundingRate.settleFunding(user)    // 结算资金费
                │
                ├──► (如果是空仓) LendingPool.repay()   // 还借的币
                │
                ├──► Vault.settlePnL()                  // 结算盈亏
                │          │
                │          ├── 盈利：从对手方转入
                │          └── 亏损：转给对手方
                │
                └──► PositionManager.closePosition()    // 关闭仓位
                            │
                            ├── 删除仓位信息
                            ├── 更新总持仓量
                            └── 触发事件 PositionClosed
```

### 4. 清算流程

```
Keeper 调用 Liquidation.liquidate(user)
                │
                ▼
      Liquidation.liquidate()
                │
                ├──► PriceFeed.getTWAP()                // 获取 TWAP 价格
                │
                ├──► PositionManager.getMarginRatio()   // 计算保证金率
                │
                ├──► require(marginRatio < maintenance) // 检查可清算
                │
                ├──► PositionManager.forceClose()       // 强制平仓
                │
                ├──► Vault.distributeLiquidation()      // 分配清算金
                │          │
                │          ├── 清算人奖励: 0.5%
                │          └── 剩余给对手方
                │
                └──► 触发事件 Liquidated
```

### 5. LP 存币流程

```
用户调用 Router.depositLP(memeAmount)
                │
                ▼
        Router.depositLP()
                │
                ├──► MemeToken.transferFrom(user)       // 转入 MEME
                │
                ├──► LendingPool.deposit(amount)        // 存入借贷池
                │          │
                │          ├── 计算 LP Token 数量
                │          └── 更新总存款
                │
                └──► LPToken.mint(user, lpTokens)       // 铸造 LP 凭证
```

---

## 状态变量关系

### PositionManager 核心状态

```solidity
// 用户仓位
mapping(address => Position) public positions;

struct Position {
    bool isLong;              // 方向
    uint256 size;             // 仓位大小 (BNB 计价)
    uint256 collateral;       // 保证金 (BNB)
    uint256 entryPrice;       // 开仓价格
    uint256 leverage;         // 杠杆倍数
    uint256 borrowedMeme;     // 借的 MEME (做空用)
    uint256 lastFundingTime;  // 上次资金费时间
    int256 accFundingFee;     // 累计资金费
}

// 全局状态
uint256 public totalLongSize;   // 总多头持仓
uint256 public totalShortSize;  // 总空头持仓
```

### Vault 核心状态

```solidity
// 用户余额
mapping(address => uint256) public balances;           // 可用余额
mapping(address => uint256) public lockedBalances;     // 锁定保证金

// 全局
uint256 public totalBalance;
```

### LendingPool 核心状态

```solidity
// LP 状态
uint256 public totalDeposits;      // 总存款
uint256 public totalBorrowed;      // 总借出
uint256 public accInterestPerShare; // 累计每股利息

// 用户状态
mapping(address => uint256) public userDeposits;
mapping(address => uint256) public userDebt;         // 借款
mapping(address => uint256) public rewardDebt;       // 已领利息
```

### AMM 核心状态

```solidity
// 真实储备金（用于现货交易和定价）
uint256 public reserveBNB;      // BNB 储备
uint256 public reserveMEME;     // MEME 储备
uint256 public K;               // 恒定乘积 (reserveBNB * reserveMEME)

// 价格计算
// spotPrice = reserveBNB / reserveMEME
// 买入 MEME：reserveBNB 增加 → 价格上涨
// 卖出 MEME：reserveBNB 减少 → 价格下跌
```

### PriceFeed 核心状态

```solidity
// 引用 AMM 合约
IAMM public amm;

// 价格历史 (用于 TWAP)
struct PricePoint {
    uint256 price;
    uint256 timestamp;
    uint256 cumulativePrice;
}
PricePoint[] public priceHistory;

// 从 AMM 读取现货价格
function getSpotPrice() public view returns (uint256) {
    return amm.getSpotPrice();
}

// 计算 TWAP（用于清算）
function getTWAP() public view returns (uint256);

// 标记价格 = (现货 + TWAP) / 2
function getMarkPrice() public view returns (uint256);
```

---

## 权限模型

```
┌─────────────────────────────────────────────────────────────┐
│                        Owner (多签)                         │
│                                                             │
│  - 设置风控参数                                              │
│  - 暂停/恢复合约                                             │
│  - 升级合约 (通过时间锁)                                     │
│  - 添加/移除 Keeper                                         │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                       Timelock (48h)                        │
│                                                             │
│  - 所有敏感操作延迟 48 小时执行                               │
│  - 用户有时间退出                                            │
└─────────────────────────────────────────────────────────────┘
                              │
          ┌───────────────────┼───────────────────┐
          │                   │                   │
          ▼                   ▼                   ▼
┌─────────────────┐ ┌─────────────────┐ ┌─────────────────┐
│     Keeper      │ │     Router      │ │    Contracts    │
│                 │ │                 │ │                 │
│ - 执行清算       │ │ - 用户入口      │ │ - 内部调用      │
│ - 执行订单       │ │ - 权限检查      │ │ - 受限访问      │
│ - 更新价格       │ │                 │ │                 │
└─────────────────┘ └─────────────────┘ └─────────────────┘
```

---

## 合约依赖关系

```
                      Presale（内盘认购）
                           │
                           │ 打满后初始化
                           ▼
MemeToken ◄───────────────AMM（现货交易）────────────┐
    │                      │                        │
    │                      │ 价格驱动               │
    │                      ▼                        │
    │               PriceFeed（价格聚合）            │
    │                      │                        │
    ▼                      ▼                        │
LPToken ◄── LendingPool ◄── PositionManager ────────┤
                │                   │               │
                │                   ▼               │
                │              Vault ───────────────┘
                │                   │
                │                   ▼
                └────────────► RiskManager
                                    │
        ┌───────────────────────────┼───────────────────────────┐
        │                           │                           │
        ▼                           ▼                           ▼
   Liquidation               OrderBook              TakeProfitStopLoss
        │                           │                           │
        └───────────────────────────┼───────────────────────────┘
                                    │
                                    ▼
                                 Router
                                    │
                                    ▼
                                  User

关键点：
├── AMM 负责现货交易和定价
├── PriceFeed 从 AMM 读取价格，计算 TWAP
├── 永续合约使用 PriceFeed 价格
└── 价格由现货交易驱动
```

---

## Gas 优化策略

### 1. 存储优化
```solidity
// 使用 packed struct
struct Position {
    uint128 size;        // 够用了
    uint128 collateral;
    uint64 entryPrice;   // 用定点数
    uint32 leverage;     // 最大 100
    uint32 lastFundingTime;
    bool isLong;
}
```

### 2. 批量操作
```solidity
// Keeper 批量清算
function liquidateBatch(address[] calldata users) external {
    for (uint i = 0; i < users.length; i++) {
        _liquidate(users[i]);
    }
}
```

### 3. 缓存读取
```solidity
// 缓存 storage 变量到 memory
function closePosition() external {
    Position memory pos = positions[msg.sender];  // 一次读取
    // 后续使用 pos 而不是 positions[msg.sender]
}
```

---

## 升级策略

### 使用 UUPS 代理模式

```
┌─────────────┐     ┌─────────────┐
│   Proxy     │────►│Implementation│
│ (存储状态)   │     │  (逻辑代码)  │
└─────────────┘     └─────────────┘
       │                   │
       │            ┌──────┴──────┐
       │            │             │
       ▼            ▼             ▼
   Storage      Logic V1      Logic V2
                              (升级后)
```

### 升级流程
```
1. 部署新 Implementation
2. 提交升级提案到 Timelock
3. 等待 48 小时
4. 执行升级
5. 验证状态正确
```
