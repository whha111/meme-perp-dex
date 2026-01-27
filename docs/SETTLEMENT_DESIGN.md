# 永续合约结算机制设计

## 当前问题

当前系统是 vAMM 模型，存在以下问题：

1. **没有真正的对手方配对** - 多空用户不直接对冲
2. **盈利完全依赖保险基金** - 基金不足时无法支付
3. **缺乏资金平衡机制** - 多空严重失衡时系统承压

## 解决方案对比

### 方案 A: 加强 vAMM 模型（当前架构改进）

```
优点：改动最小
缺点：仍依赖保险基金

资金流向：
亏损用户 → InsuranceFund → 盈利用户

改进点：
1. 确保亏损先进入基金，再支付盈利
2. 实时结算而非平仓时结算
3. 动态调整资金费率平衡多空
```

### 方案 B: 多空对冲池模型（推荐）

```
做多池 (Long Pool)           做空池 (Short Pool)
  ├─ 用户 A: 10 ETH            ├─ 用户 C: 8 ETH
  ├─ 用户 B: 5 ETH             └─ 用户 D: 7 ETH
  └─ 总计: 15 ETH                  总计: 15 ETH

价格上涨 10%:
  - 多头总盈利 = 15 * 10% = 1.5 ETH
  - 空头总亏损 = 15 * 10% = 1.5 ETH
  - 从空头池扣除 1.5 ETH → 转入多头池

✅ 盈亏完全对冲，无需保险基金介入
```

### 方案 C: 订单簿模型

```
买单队列              卖单队列
[A: 100@1.05]         [C: 50@1.06]
[B: 200@1.04]         [D: 150@1.07]

撮合引擎配对：
A (100@1.05) ←→ C (50@1.06) → 成交 50
B (200@1.04) 等待更好价格

✅ 每笔交易都有明确对手方
❌ 需要链下撮合或 Layer2
```

## 推荐实现：多空池对冲模型

### 核心原理

```solidity
// 全局多空池
uint256 public totalLongCollateral;   // 多头总保证金
uint256 public totalShortCollateral;  // 空头总保证金
uint256 public totalLongSize;         // 多头总仓位
uint256 public totalShortSize;        // 空头总仓位

// 结算时，盈利从对手池支付
function settle(address user, int256 pnl) internal {
    Position storage pos = positions[user];

    if (pnl > 0) {
        // 盈利：从对手池扣除
        uint256 profit = uint256(pnl);
        if (pos.isLong) {
            // 多头盈利，从空头池扣
            require(totalShortCollateral >= profit, "Insufficient short pool");
            totalShortCollateral -= profit;
            totalLongCollateral += profit;
        } else {
            // 空头盈利，从多头池扣
            require(totalLongCollateral >= profit, "Insufficient long pool");
            totalLongCollateral -= profit;
            totalShortCollateral += profit;
        }
    } else {
        // 亏损：加入对手池
        uint256 loss = uint256(-pnl);
        if (pos.isLong) {
            totalLongCollateral -= loss;
            totalShortCollateral += loss;
        } else {
            totalShortCollateral -= loss;
            totalLongCollateral += loss;
        }
    }
}
```

### 处理多空不平衡

```solidity
// 当多空失衡时，使用资金费率调节
function calculateFundingPayment() public view returns (int256) {
    if (totalLongSize == totalShortSize) return 0;

    // 多头过多 → 多头支付空头
    // 空头过多 → 空头支付多头
    int256 imbalance = int256(totalLongSize) - int256(totalShortSize);
    int256 totalSize = int256(totalLongSize + totalShortSize);

    // 费率 = 不平衡比例 * 基础费率
    return (imbalance * BASE_FUNDING_RATE) / totalSize;
}
```

### 保险基金仅用于穿仓

```solidity
// 保险基金只在穿仓时介入
function handleBankruptcy(address user, uint256 deficit) internal {
    // 1. 先尝试从对手池覆盖
    // 2. 对手池不足时，使用保险基金
    // 3. 保险基金不足时，触发 ADL

    uint256 covered = 0;

    // Step 1: 对手池
    Position storage pos = positions[user];
    if (pos.isLong && totalShortCollateral >= deficit) {
        totalShortCollateral -= deficit;
        covered = deficit;
    } else if (!pos.isLong && totalLongCollateral >= deficit) {
        totalLongCollateral -= deficit;
        covered = deficit;
    }

    // Step 2: 保险基金
    if (covered < deficit) {
        uint256 fromInsurance = insuranceFund.coverDeficit(deficit - covered);
        covered += fromInsurance;
    }

    // Step 3: ADL
    if (covered < deficit) {
        triggerADL(deficit - covered);
    }
}
```

## 实现步骤

### Phase 1: 修改 Vault 支持多空池（1-2 天）

```solidity
contract Vault {
    // 新增多空池余额跟踪
    uint256 public longPoolBalance;
    uint256 public shortPoolBalance;

    // 修改锁定保证金
    function lockMargin(address user, uint256 amount, bool isLong) external {
        balances[user] -= amount;
        if (isLong) {
            longPoolBalance += amount;
        } else {
            shortPoolBalance += amount;
        }
        lockedBalances[user] += amount;
    }

    // 修改结算函数
    function settlePnL(address user, bool isLong, int256 pnl) external {
        if (pnl > 0) {
            uint256 profit = uint256(pnl);
            if (isLong) {
                require(shortPoolBalance >= profit);
                shortPoolBalance -= profit;
            } else {
                require(longPoolBalance >= profit);
                longPoolBalance -= profit;
            }
            balances[user] += profit;
        }
        // ... 亏损处理
    }
}
```

### Phase 2: 修改 PositionManager（1-2 天）

- 开仓时指定方向，将保证金加入对应池
- 平仓时从对手池获取盈利
- 实现实时盈亏计算

### Phase 3: 添加资金费率实时结算（1 天）

- 每次开仓/平仓时结算累计资金费
- 资金费从多头池/空头池互转

### Phase 4: 完善风控（1 天）

- 多空池余额监控
- 自动限制开仓方向
- ADL 优先级队列

## 总结

| 模型 | 盈利来源 | 系统风险 | 复杂度 | 推荐 |
|------|---------|---------|--------|------|
| 当前 vAMM | 保险基金 | 高 | 低 | ❌ |
| 多空池对冲 | 对手池 | 低 | 中 | ✅ |
| 订单簿 | 对手方 | 最低 | 高 | 未来 |

**推荐路线**：先实现多空池对冲，后续可升级到订单簿。
