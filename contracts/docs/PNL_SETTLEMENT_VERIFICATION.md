# PnL Settlement + Insurance + Vault 路径验证报告

## 系统概述

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           系统架构                                           │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│   User Wallet                                                               │
│       │                                                                     │
│       │ deposit(ETH)                                                        │
│       ▼                                                                     │
│   ┌─────────────────────────────────────────────────────────────────┐      │
│   │                         VAULT                                    │      │
│   │  ┌────────────────┐    ┌─────────────────┐                      │      │
│   │  │   balances     │    │ lockedBalances  │                      │      │
│   │  │ (可用余额)      │◄──►│ (锁定保证金)     │                      │      │
│   │  └────────────────┘    └─────────────────┘                      │      │
│   │         │                      │                                 │      │
│   │         │                      │ ETH 转移                        │      │
│   │         ▼                      ▼                                 │      │
│   └─────────────────────────────────────────────────────────────────┘      │
│             │                      │                                        │
│             │                      │                                        │
│             ▼                      ▼                                        │
│   ┌─────────────────────────────────────────────────────────────────┐      │
│   │              INSURANCE FUND (Liquidation Contract)               │      │
│   │                                                                  │      │
│   │  insuranceFund (ETH balance) ←─── 亏损流入                       │      │
│   │                              ───► 盈利流出                       │      │
│   │                                                                  │      │
│   └─────────────────────────────────────────────────────────────────┘      │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 1. 完整 Ledger Trace: Open → Mark → Close → Distribute

### 1.1 开仓流程 (Open Position)

```
时间线: T0 → T1

初始状态 (T0):
┌──────────────────────────────────────────────────────────────────────────┐
│ User State                                                               │
│   wallet.ETH        = 10 ETH                                             │
│   vault.balances    = 0                                                  │
│   vault.locked      = 0                                                  │
│                                                                          │
│ Vault State                                                              │
│   contract.ETH      = 0                                                  │
│   Σbalances         = 0                                                  │
│   ΣlockedBalances   = 0                                                  │
│                                                                          │
│ Insurance State                                                          │
│   insuranceFund     = 100 ETH (预充值)                                   │
└──────────────────────────────────────────────────────────────────────────┘

步骤 1: User 存款
─────────────────────────────────────────────────────────────────────────────
vault.deposit{value: 10 ETH}()

  [Vault]
  │ balances[user] += 10 ETH
  │
  │ 账本变化:
  │   balances[user]: 0 → 10 ETH
  │   contract.ETH:   0 → 10 ETH
  │
  └─ emit Deposit(user, 10 ETH, timestamp)

步骤 2: User 开多仓 (size=100 ETH, leverage=10x, collateral=10 ETH)
─────────────────────────────────────────────────────────────────────────────
positionManager.openLong(100 ETH, 10x)

  [PositionManager._openPosition]
  │
  ├─ (1) 计算费用
  │     collateral = size / leverage = 100 / 10 = 10 ETH
  │     openFee = size * openFeeRate = 100 * 0.1% = 0.1 ETH
  │     totalRequired = 10.1 ETH
  │
  ├─ (2) 收取开仓手续费
  │     vault.collectFee(user, feeReceiver, 0.1 ETH)
  │     │
  │     │ [Vault.collectFee]
  │     │   balances[user] -= 0.1 ETH      (10 → 9.9)
  │     │   balances[feeReceiver] += 0.1   (0 → 0.1)
  │     │
  │     └─ emit FeeCollected(user, feeReceiver, 0.1 ETH)
  │
  ├─ (3) 锁定保证金
  │     vault.lockMargin(user, 10 ETH)
  │     │
  │     │ [Vault.lockMargin]
  │     │   balances[user] -= 10 ETH       (9.9 → ❌ INSUFFICIENT!)
  │     │
  │     └─ ❌ 问题: 手续费收取后余额只剩 9.9 ETH，不够锁定 10 ETH
  │
  └─ ⚠️ 实际代码中 totalRequired = collateral + fee = 10.1 ETH
       需要用户有 10.1 ETH 才能开仓

正确流程 (用户存入 11 ETH):
─────────────────────────────────────────────────────────────────────────────
  [PositionManager._openPosition]
  │
  ├─ (1) 检查: vault.getBalance(user) >= collateral + fee = 10.1 ETH ✓
  │
  ├─ (2) vault.collectFee(user, feeReceiver, 0.1 ETH)
  │       balances[user]: 11 → 10.9 ETH
  │       balances[feeReceiver]: 0 → 0.1 ETH
  │
  ├─ (3) vault.lockMargin(user, 10 ETH)
  │       balances[user]: 10.9 → 0.9 ETH
  │       lockedBalances[user]: 0 → 10 ETH
  │
  ├─ (4) 获取入场价格
  │       entryPrice = priceFeed.getMarkPrice() = 1000 USDT
  │
  └─ (5) 创建仓位记录
        position = {
          isLong: true,
          size: 100 ETH,
          collateral: 10 ETH,
          entryPrice: 1000,
          leverage: 10x
        }

开仓后状态 (T1):
┌──────────────────────────────────────────────────────────────────────────┐
│ User State                                                               │
│   wallet.ETH        = 0 ETH                                              │
│   vault.balances    = 0.9 ETH                                            │
│   vault.locked      = 10 ETH                                             │
│                                                                          │
│ Fee Receiver State                                                       │
│   vault.balances    = 0.1 ETH                                            │
│                                                                          │
│ Vault Contract State                                                     │
│   contract.ETH      = 11 ETH (user 11 - fee 0 收取无转移)                │
│   Σbalances         = 1 ETH (0.9 + 0.1)                                  │
│   ΣlockedBalances   = 10 ETH                                             │
│   一致性检查: contract.ETH(11) = Σbalances(1) + Σlocked(10) ✓            │
│                                                                          │
│ Position State                                                           │
│   size: 100 ETH, collateral: 10 ETH, entry: 1000                        │
└──────────────────────────────────────────────────────────────────────────┘
```

### 1.2 持仓期间 (Mark to Market)

```
时间线: T1 → T2 (仓位持有中)

┌──────────────────────────────────────────────────────────────────────────┐
│ 价格变动场景                                                              │
├──────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│ Entry Price: 1000                                                        │
│                                                                          │
│ 场景 A: 价格上涨到 1200 (+20%)                                           │
│   unrealizedPnL = size * (currentPrice - entryPrice) / entryPrice        │
│                 = 100 * (1200 - 1000) / 1000                             │
│                 = 100 * 0.2 = +20 ETH (盈利)                             │
│                                                                          │
│ 场景 B: 价格下跌到 900 (-10%)                                            │
│   unrealizedPnL = 100 * (900 - 1000) / 1000                              │
│                 = 100 * (-0.1) = -10 ETH (亏损)                          │
│                                                                          │
│ 场景 C: 价格下跌到 850 (-15%, 穿仓)                                       │
│   unrealizedPnL = 100 * (850 - 1000) / 1000                              │
│                 = 100 * (-0.15) = -15 ETH (亏损 > 保证金)                 │
│   deficit = 15 - 10 = 5 ETH                                              │
│                                                                          │
│ 场景 D: 价格暴跌到 700 (-30%, 深度穿仓)                                   │
│   unrealizedPnL = 100 * (700 - 1000) / 1000                              │
│                 = 100 * (-0.3) = -30 ETH                                  │
│   deficit = 30 - 10 = 20 ETH                                             │
│                                                                          │
└──────────────────────────────────────────────────────────────────────────┘

⚠️ 注意: 持仓期间没有任何账本变动，只有 unrealizedPnL 计算
```

### 1.3 平仓流程 (Close Position)

```
时间线: T2 → T3

用户调用: positionManager.closePosition()

[PositionManager._closePosition]
│
├─ (1) 结算资金费 (如有)
│     int256 funding = fundingRate.settleUserFunding(user)
│     position.accFundingFee += funding
│
├─ (2) 获取退出价格
│     exitPrice = priceFeed.getMarkPrice()
│
├─ (3) 计算 PnL
│     pnl = _calculatePnLForSize(isLong, size, entryPrice, exitPrice)
│     pnl -= accFundingFee  // 扣除资金费
│
├─ (4) 计算平仓手续费
│     closeFee = size * closeFeeRate = 100 * 0.1% = 0.1 ETH
│
├─ (5) 更新全局持仓量
│     totalLongSize -= closeSize
│
├─ (6) 删除仓位记录
│     delete _positions[user]
│
└─ (7) 结算盈亏
      _settlePnL(user, collateral, pnl, closeFee)
```

---

## 2. User Balances vs LockedBalances 追踪

### 2.1 账本状态转换图

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         账本状态转换                                         │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│    ┌─────────────┐                      ┌─────────────┐                    │
│    │  balances   │◄────────────────────►│lockedBalances│                   │
│    │ (可提取)    │      lockMargin()    │ (不可提取)   │                   │
│    └──────┬──────┘      unlockMargin()  └──────┬──────┘                    │
│           │                                     │                           │
│           │ deposit()                           │                           │
│           │ withdraw()                          │ collectFeeFromLocked()    │
│           │ collectFee()                        │ settleProfit/Loss()       │
│           │                                     │                           │
│           ▼                                     ▼                           │
│    ┌─────────────┐                      ┌─────────────┐                    │
│    │ User Wallet │                      │ feeReceiver │                    │
│    └─────────────┘                      │ balances    │                    │
│                                         └─────────────┘                    │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘

状态转换矩阵:
─────────────────────────────────────────────────────────────────────────────
操作                    | balances[user] | lockedBalances[user] | 备注
─────────────────────────────────────────────────────────────────────────────
deposit(x)              | +x             | 0                    | ETH → Vault
withdraw(x)             | -x             | 0                    | Vault → ETH
lockMargin(x)           | -x             | +x                   | 内部转移
unlockMargin(x)         | +x             | -x                   | 内部转移
collectFee(x)           | -x             | 0                    | → feeReceiver
collectFeeFromLocked(x) | 0              | -x                   | → feeReceiver
settleProfit(col,0)     | +col           | -col                 | 无盈利
settleProfit(col,p)     | +col           | -col                 | 盈利 p 从 Insurance
settleLoss(col,loss)    | +(col-loss)    | -col                 | 亏损 → Insurance
settleBankruptcy(col,d) | 0              | -col(→0)             | ⚠️ BUG: col 丢失
─────────────────────────────────────────────────────────────────────────────
```

### 2.2 守恒定律检查

```solidity
// 理论守恒公式
Σ(balances[all]) + Σ(lockedBalances[all]) == Vault.contract.balance - pending_insurance_transfers

// 实际检查
function checkLedgerConsistency() view returns (bool) {
    uint256 totalBalances = 0;
    uint256 totalLocked = 0;

    for (address user in allUsers) {
        totalBalances += balances[user];
        totalLocked += lockedBalances[user];
    }

    // ⚠️ 由于 settleBankruptcy bug，此检查可能失败
    return address(this).balance >= totalBalances + totalLocked;
}
```

---

## 3. Vault Balances vs Insurance ETH Balance

### 3.1 资金池分布图

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         资金池状态                                           │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│   ┌────────────────────────────────────────────────────────────────┐       │
│   │                     VAULT CONTRACT                              │       │
│   │                                                                 │       │
│   │   address(vault).balance = X ETH                               │       │
│   │                                                                 │       │
│   │   组成:                                                         │       │
│   │   ├─ Σbalances[users]         = 可提取余额                      │       │
│   │   ├─ ΣlockedBalances[users]   = 锁定保证金                      │       │
│   │   └─ orphanedFunds            = 孤儿资金 (bug 导致)             │       │
│   │                                                                 │       │
│   └────────────────────────────────────────────────────────────────┘       │
│                            │                                                │
│                            │ settleLoss: ETH{value: loss}                   │
│                            ▼                                                │
│   ┌────────────────────────────────────────────────────────────────┐       │
│   │                  INSURANCE FUND (Liquidation)                   │       │
│   │                                                                 │       │
│   │   address(insurance).balance = Y ETH                           │       │
│   │                                                                 │       │
│   │   内部记账:                                                      │       │
│   │   insuranceFund (state variable) ≈ Y                           │       │
│   │                                                                 │       │
│   │   资金来源:                                                      │       │
│   │   ├─ 初始充值 (owner.depositInsuranceFund)                      │       │
│   │   ├─ 用户亏损 (settleLoss 转入)                                 │       │
│   │   └─ 清算剩余 (distributeLiquidation)                           │       │
│   │                                                                 │       │
│   │   资金去向:                                                      │       │
│   │   ├─ 用户盈利 (payProfit)                                       │       │
│   │   ├─ 覆盖穿仓 (coverDeficit)                                    │       │
│   │   └─ 管理员提取 (withdrawInsuranceFund)                         │       │
│   │                                                                 │       │
│   └────────────────────────────────────────────────────────────────┘       │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 3.2 资金流动追踪

```
场景: 用户 A 盈利 5 ETH，用户 B 亏损 3 ETH

初始状态:
┌─────────────────────────────────────┐
│ Vault.balance      = 200 ETH       │
│ Insurance.balance  = 100 ETH       │
│ Insurance.fund     = 100 ETH       │
└─────────────────────────────────────┘

用户 B 平仓亏损:
─────────────────────────────────────────
settleLoss(userB, 10 ETH collateral, 3 ETH loss)

  Vault:
    lockedBalances[B] -= 10 ETH
    balances[B] += 7 ETH (returnAmount)

  ETH 转移:
    vault.call{value: 3 ETH}(insuranceFund)

  Insurance:
    receive() → insuranceFund += 3 ETH

结果:
┌─────────────────────────────────────┐
│ Vault.balance      = 197 ETH (-3)  │
│ Insurance.balance  = 103 ETH (+3)  │
│ Insurance.fund     = 103 ETH (+3)  │
└─────────────────────────────────────┘

用户 A 平仓盈利:
─────────────────────────────────────────
settleProfit(userA, 10 ETH collateral, 5 ETH profit)

  Vault:
    lockedBalances[A] -= 10 ETH
    balances[A] += 10 ETH

    调用: insuranceFund.payProfit(userA, 5 ETH)

  Insurance.payProfit:
    insuranceFund -= 5 ETH
    userA.call{value: 5 ETH}  // 直接转给用户钱包!

结果:
┌─────────────────────────────────────┐
│ Vault.balance      = 197 ETH (不变) │
│ Insurance.balance  = 98 ETH (-5)   │
│ Insurance.fund     = 98 ETH (-5)   │
│ UserA.wallet       = +5 ETH        │
└─────────────────────────────────────┘

⚠️ 注意: 盈利直接发到用户钱包，不经过 Vault.balances
```

---

## 4. RealizedPnL vs TransferredPnL

### 4.1 概念定义

```
RealizedPnL (计算的盈亏):
  = size * (exitPrice - entryPrice) / entryPrice
  这是理论上用户应该得到/失去的金额

TransferredPnL (实际转移的金额):
  = 实际从 Insurance 支付的盈利 或 实际转入 Insurance 的亏损
  可能因为资金不足而小于 RealizedPnL
```

### 4.2 差异场景

```
┌────────────────────────────────────────────────────────────────────────────┐
│                   RealizedPnL vs TransferredPnL 对比                       │
├────────────────────────────────────────────────────────────────────────────┤
│                                                                            │
│ 场景 1: 正常盈利                                                           │
│ ──────────────────────────────────────────                                 │
│   RealizedPnL     = +5 ETH                                                 │
│   Insurance.fund  = 100 ETH (充足)                                         │
│   TransferredPnL  = +5 ETH                                                 │
│   差异: 0 ✓                                                                │
│                                                                            │
│ 场景 2: 盈利但保险金不足                                                    │
│ ──────────────────────────────────────────                                 │
│   RealizedPnL     = +50 ETH                                                │
│   Insurance.fund  = 30 ETH (不足)                                          │
│   TransferredPnL  = +30 ETH (最多只能支付这么多)                            │
│   差异: -20 ETH ⚠️ 触发 ADL                                                │
│                                                                            │
│ 场景 3: 正常亏损                                                           │
│ ──────────────────────────────────────────                                 │
│   RealizedPnL     = -5 ETH                                                 │
│   collateral      = 10 ETH (充足)                                          │
│   TransferredPnL  = -5 ETH (转入 Insurance)                                │
│   差异: 0 ✓                                                                │
│                                                                            │
│ 场景 4: 穿仓                                                               │
│ ──────────────────────────────────────────                                 │
│   RealizedPnL     = -15 ETH                                                │
│   collateral      = 10 ETH                                                 │
│   deficit         = 5 ETH                                                  │
│   TransferredPnL  = -10 ETH (只有 collateral 部分)                         │
│   差异: -5 ETH ⚠️ BUG: collateral 未转入 Insurance                         │
│                                                                            │
└────────────────────────────────────────────────────────────────────────────┘
```

### 4.3 代码层面验证

```solidity
// PositionManager._settlePnL
function _settlePnL(address user, uint256 collateral, int256 pnl, uint256 fee) internal {
    // 收取手续费 (从 lockedBalances 扣除)
    vault.collectFeeFromLocked(user, feeReceiver, actualFee);
    collateral -= actualFee;

    if (pnl >= 0) {
        // 盈利路径
        // RealizedPnL = pnl
        // TransferredPnL = Insurance 实际支付的金额 (可能小于 pnl)
        vault.settleProfit(user, collateral, uint256(pnl));
    } else {
        uint256 loss = uint256(-pnl);

        if (loss <= collateral) {
            // 正常亏损路径
            // RealizedPnL = -loss
            // TransferredPnL = -actualLoss (应该 == loss)
            vault.settleLoss(user, collateral, loss);
        } else {
            // 穿仓路径
            // RealizedPnL = -loss
            // TransferredPnL = ??? (BUG: collateral 未正确转移)
            uint256 deficit = loss - collateral;
            vault.settleBankruptcy(user, collateral, deficit);
        }
    }
}
```

---

## 5. Fee 路径 (Open/Close)

### 5.1 开仓手续费路径

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         开仓手续费流向                                       │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│   User.balances ────[collectFee]────> FeeReceiver.balances                 │
│                                                                             │
│   步骤:                                                                     │
│   1. 用户存入 ETH → balances[user] += amount                               │
│   2. 计算手续费:  fee = size * openFeeRate / 10000                         │
│   3. 扣除手续费:  balances[user] -= fee                                    │
│   4. 增加接收者:  balances[feeReceiver] += fee                             │
│                                                                             │
│   特点:                                                                     │
│   - 从可用余额扣除                                                          │
│   - 不涉及 ETH 转移 (纯账本操作)                                            │
│   - FeeReceiver 可以随时 withdraw 提取                                      │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘

代码路径:
  PositionManager._openPosition()
    └─ vault.collectFee(user, feeReceiver, fee)
         └─ Vault.collectFee()
              ├─ balances[user] -= fee
              └─ balances[feeReceiver] += fee
```

### 5.2 平仓手续费路径

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         平仓手续费流向                                       │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│   User.lockedBalances ────[collectFeeFromLocked]────> FeeReceiver.balances │
│                                                                             │
│   步骤:                                                                     │
│   1. 计算手续费:  fee = closeSize * closeFeeRate / 10000                   │
│   2. 确保手续费不超过保证金: actualFee = min(fee, collateral)               │
│   3. 扣除锁定余额: lockedBalances[user] -= actualFee                        │
│   4. 增加接收者:   balances[feeReceiver] += actualFee                       │
│   5. 调整保证金:   collateral -= actualFee (用于后续结算)                   │
│                                                                             │
│   特点:                                                                     │
│   - 从锁定保证金扣除                                                        │
│   - 在 PnL 结算之前执行                                                     │
│   - 保证金减少后再计算 returnAmount                                         │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘

代码路径:
  PositionManager._settlePnL()
    └─ vault.collectFeeFromLocked(user, feeReceiver, actualFee)
         └─ Vault.collectFeeFromLocked()
              ├─ lockedBalances[user] -= actualFee
              └─ balances[feeReceiver] += actualFee
```

### 5.3 手续费会计检查

```
手续费守恒公式:
─────────────────────────────────────────────────────────────────────────────
totalFeesCollected = Σ(openFees) + Σ(closeFees)

balances[feeReceiver] 应该 >= totalFeesCollected (考虑 withdraw)

检查点:
├─ collectFee:         balances[user] -= fee, balances[feeReceiver] += fee
├─ collectFeeFromLocked: lockedBalances[user] -= fee, balances[feeReceiver] += fee
└─ 守恒: Σbalances 不变 (只是内部转移)
```

---

## 6. Bankruptcy 和 Deficit 路径

### 6.1 穿仓判定

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         穿仓判定逻辑                                         │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│   计算 PnL:                                                                 │
│   pnl = size * (exitPrice - entryPrice) / entryPrice                       │
│                                                                             │
│   判定条件:                                                                  │
│   ┌──────────────────────────────────────────────────────────────┐        │
│   │ if (pnl >= 0)                                                 │        │
│   │     → settleProfit (盈利路径)                                 │        │
│   │                                                               │        │
│   │ else if (|pnl| <= collateral)                                │        │
│   │     → settleLoss (正常亏损路径)                               │        │
│   │                                                               │        │
│   │ else                                                          │        │
│   │     → settleBankruptcy (穿仓路径)                             │        │
│   │     deficit = |pnl| - collateral                             │        │
│   └──────────────────────────────────────────────────────────────┘        │
│                                                                             │
│   示例 (10x 杠杆, 10 ETH 保证金, 100 ETH 仓位):                             │
│   ├─ 价格跌 5%:  pnl = -5 ETH   → 正常亏损 (返还 5 ETH)                    │
│   ├─ 价格跌 10%: pnl = -10 ETH  → 边界 (返还 0 ETH)                        │
│   ├─ 价格跌 15%: pnl = -15 ETH  → 穿仓 (deficit = 5 ETH)                   │
│   └─ 价格跌 30%: pnl = -30 ETH  → 深穿仓 (deficit = 20 ETH)                │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 6.2 Bankruptcy 资金流详解

```
当前实现 (有 BUG):
─────────────────────────────────────────────────────────────────────────────
settleBankruptcy(user, 10 ETH collateral, 5 ETH deficit)

  [Vault.settleBankruptcy]
  │
  ├─ (1) lockedBalances[user] = 0
  │      // 清零，但 10 ETH 去哪了？
  │
  ├─ (2) insuranceFund.balance 检查
  │
  └─ (3) insuranceFund.coverDeficit(5 ETH)
         │
         │ [Liquidation.coverDeficit]
         │   insuranceFund -= 5 ETH
         │
         └─ emit DeficitCovered(5 ETH)

问题分析:
┌─────────────────────────────────────────────────────────────────────────────┐
│                                                                             │
│   操作前:                                                                    │
│     lockedBalances[user] = 10 ETH                                          │
│     Vault.balance = 100 ETH                                                │
│     Insurance.balance = 50 ETH                                             │
│                                                                             │
│   操作后:                                                                    │
│     lockedBalances[user] = 0 ETH                                           │
│     Vault.balance = 100 ETH (没变!)                                        │
│     Insurance.balance = 50 ETH (没变!)                                     │
│                                                                             │
│   ❌ BUG: 10 ETH 的 collateral 从账本消失，但 ETH 还在 Vault 合约里         │
│           应该把这 10 ETH 转给 Insurance，然后 Insurance 用它来覆盖盈利方   │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘

正确实现应该:
─────────────────────────────────────────────────────────────────────────────
settleBankruptcy(user, 10 ETH collateral, 5 ETH deficit)

  [应该的逻辑]
  │
  ├─ (1) lockedBalances[user] = 0
  │
  ├─ (2) 将 collateral 转给 Insurance
  │      insuranceFund.call{value: 10 ETH}("")
  │      // Insurance 现在有这 10 ETH 可以用于支付对手方盈利
  │
  └─ (3) insuranceFund.coverDeficit(5 ETH)
         // Insurance 从自己的储备中额外拿出 5 ETH
         // 总共 10 + 5 = 15 ETH 可用于支付对手盈利
```

### 6.3 Deficit 覆盖逻辑

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                     Insurance Fund coverDeficit 逻辑                        │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│   function coverDeficit(uint256 amount) external {                         │
│       require(msg.sender == address(vault), "Only vault");                 │
│                                                                             │
│       if (insuranceFund >= amount) {                                       │
│           // 有足够资金                                                     │
│           insuranceFund -= amount;                                         │
│           emit DeficitCovered(amount);                                     │
│       } else {                                                             │
│           // 资金不足                                                       │
│           uint256 shortfall = amount - insuranceFund;                      │
│           insuranceFund = 0;                                               │
│                                                                             │
│           // 触发 ADL 或暂停交易                                            │
│           _handleInsuranceShortfall(shortfall);                            │
│           emit DeficitCovered(amount - shortfall);                         │
│       }                                                                     │
│   }                                                                         │
│                                                                             │
│   _handleInsuranceShortfall:                                               │
│   ├─ 1. 检查是否需要 ADL                                                   │
│   ├─ 2. 执行 ADL (强制减少盈利仓位)                                        │
│   └─ 3. 如果还不够，暂停交易                                               │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 7. Settlement 调用顺序图

### 7.1 完整调用序列

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                          Settlement 调用顺序                                 │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  User                PositionManager           Vault              Insurance │
│   │                       │                     │                     │    │
│   │  closePosition()      │                     │                     │    │
│   │──────────────────────>│                     │                     │    │
│   │                       │                     │                     │    │
│   │                       │ [1] settleUserFunding()                   │    │
│   │                       │────────────────────────────────────────>  │    │
│   │                       │ <──────── int256 funding ────────────────│    │
│   │                       │                     │                     │    │
│   │                       │ [2] getMarkPrice()  │                     │    │
│   │                       │──────────────────>  │                     │    │
│   │                       │ <─── exitPrice ────│                     │    │
│   │                       │                     │                     │    │
│   │                       │ [3] _calculatePnL() │                     │    │
│   │                       │  (internal)         │                     │    │
│   │                       │                     │                     │    │
│   │                       │ [4] update global   │                     │    │
│   │                       │     positions       │                     │    │
│   │                       │                     │                     │    │
│   │                       │ [5] delete position │                     │    │
│   │                       │                     │                     │    │
│   │                       │ [6] _settlePnL()    │                     │    │
│   │                       │──────────────────────────────────────────>│    │
│   │                       │                     │                     │    │
│   │                       │    [6a] collectFeeFromLocked()            │    │
│   │                       │    ────────────────>│                     │    │
│   │                       │                     │ lockedBalances -= fee    │
│   │                       │                     │ balances[feeRcv] += fee  │
│   │                       │    <────────────────│                     │    │
│   │                       │                     │                     │    │
│   │                       │    [6b-profit] settleProfit()             │    │
│   │                       │    ────────────────>│                     │    │
│   │                       │                     │ lockedBal -= col    │    │
│   │                       │                     │ balances += col     │    │
│   │                       │                     │                     │    │
│   │                       │                     │ [6b-i] payProfit()  │    │
│   │                       │                     │────────────────────>│    │
│   │                       │                     │                     │    │
│   │                       │                     │  insuranceFund -= profit │
│   │                       │                     │  user.call{profit}()│    │
│   │                       │                     │<────────────────────│    │
│   │                       │    <────────────────│                     │    │
│   │                       │                     │                     │    │
│   │    [OR]               │    [6b-loss] settleLoss()                 │    │
│   │                       │    ────────────────>│                     │    │
│   │                       │                     │ lockedBal -= col    │    │
│   │                       │                     │ balances += (col-loss)   │
│   │                       │                     │                     │    │
│   │                       │                     │ [6b-ii] receive()   │    │
│   │                       │                     │────{loss ETH}──────>│    │
│   │                       │                     │  insuranceFund += loss   │
│   │                       │    <────────────────│<────────────────────│    │
│   │                       │                     │                     │    │
│   │    [OR]               │    [6b-bankruptcy] settleBankruptcy()     │    │
│   │                       │    ────────────────>│                     │    │
│   │                       │                     │ lockedBal = 0       │    │
│   │                       │                     │ ⚠️ col ETH 丢失!    │    │
│   │                       │                     │                     │    │
│   │                       │                     │ [6b-iii] coverDeficit()  │
│   │                       │                     │────────────────────>│    │
│   │                       │                     │  insuranceFund -= deficit│
│   │                       │    <────────────────│<────────────────────│    │
│   │                       │                     │                     │    │
│   │    <──────────────────│                     │                     │    │
│   │                       │                     │                     │    │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 7.2 调用顺序一致性检查

```
检查点 1: 资金费在 PnL 计算前结算 ✓
─────────────────────────────────────────────────────────────────────────────
顺序: fundingRate.settleUserFunding() → _calculatePnL()
这确保了资金费被正确计入 PnL

检查点 2: 手续费在 PnL 结算前收取 ✓
─────────────────────────────────────────────────────────────────────────────
顺序: collectFeeFromLocked() → settleProfit/Loss/Bankruptcy()
这确保了手续费从 collateral 中扣除

检查点 3: 仓位删除在结算前 ⚠️ 潜在问题
─────────────────────────────────────────────────────────────────────────────
顺序: delete _positions[user] → _settlePnL()
如果 _settlePnL 失败（但不 revert），仓位已经删除
实际上由于所有状态变更都在一个事务中，要么全成功要么全失败，所以这不是问题

检查点 4: Insurance 调用可能失败但不 revert ⚠️
─────────────────────────────────────────────────────────────────────────────
在 settleProfit 中:
  (bool success,) = insuranceFund.call(...payProfit...);
  if (success) { actualProfit = profit; }
  // 不 revert，用户可能拿不到盈利但仓位已关闭

这是设计决策：允许部分失败以避免 DoS，但可能导致用户损失
```

---

## 8. Solvency 检查: Insurance >= Σ(maxProfit)

### 8.1 理论偿付能力模型

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                     Insurance Fund 偿付能力模型                             │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│   定义:                                                                     │
│   ├─ maxProfitLong  = Σ(longPosition.size * (maxPrice - entryPrice) / entry)│
│   ├─ maxProfitShort = Σ(shortPosition.size * (entryPrice - minPrice) / entry│
│   └─ totalMaxProfit = maxProfitLong + maxProfitShort                       │
│                                                                             │
│   偿付能力条件:                                                             │
│   insuranceFund >= totalMaxProfit                                          │
│                                                                             │
│   问题: maxPrice 和 minPrice 是无界的!                                      │
│   ├─ 理论上 maxPrice → ∞                                                   │
│   ├─ 理论上 minPrice → 0                                                   │
│   └─ 因此 totalMaxProfit → ∞                                               │
│                                                                             │
│   实际约束:                                                                  │
│   ├─ 清算机制: 在穿仓前强制平仓                                             │
│   ├─ ADL 机制: 保险金不足时强制减仓盈利方                                   │
│   └─ 价格保护: TWAP 和偏差限制减少极端价格                                  │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 8.2 实际偿付能力检查

```solidity
// RiskManager 中应该实现的检查
function checkInsuranceSolvency() external view returns (
    bool isSolvent,
    uint256 insuranceBalance,
    uint256 estimatedMaxPayout
) {
    insuranceBalance = ILiquidation(liquidation).getInsuranceFund();

    // 计算所有盈利仓位的最大潜在盈利
    // 使用当前 unrealizedPnL 作为估计
    uint256 totalUnrealizedProfit = 0;

    for (address user in allUsers) {
        int256 pnl = positionManager.getUnrealizedPnL(user);
        if (pnl > 0) {
            totalUnrealizedProfit += uint256(pnl);
        }
    }

    // 加上安全边际 (例如 50%)
    estimatedMaxPayout = totalUnrealizedProfit * 150 / 100;

    isSolvent = insuranceBalance >= estimatedMaxPayout;
}

// 当前系统的检查 (RiskManager.sol)
function checkInsuranceCoverage() external view returns (
    bool isSufficient,
    uint256 fundBalance,
    uint256 requiredAmount
) {
    fundBalance = liquidation.getInsuranceFund();

    // 简化计算: 多空不平衡部分的最大风险
    uint256 totalLong = positionManager.getTotalLongSize();
    uint256 totalShort = positionManager.getTotalShortSize();

    uint256 imbalance = totalLong > totalShort
        ? totalLong - totalShort
        : totalShort - totalLong;

    // 假设最大波动 10%
    requiredAmount = (imbalance * 10) / 100;

    isSufficient = fundBalance >= requiredAmount;
}
```

### 8.3 风险场景分析

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         Insurance 风险场景                                   │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│ 场景 1: 正常市场                                                            │
│ ──────────────────                                                          │
│   Long = 1000 ETH, Short = 1000 ETH                                        │
│   多空平衡，双方盈亏互相抵消                                                 │
│   Insurance 只需覆盖穿仓差额                                                 │
│   风险: 低                                                                   │
│                                                                             │
│ 场景 2: 单边市场                                                            │
│ ──────────────────                                                          │
│   Long = 1000 ETH, Short = 100 ETH                                         │
│   如果价格上涨 20%，Long 盈利 200 ETH                                       │
│   Short 只能提供 100 * 20% = 20 ETH 亏损                                    │
│   缺口 = 180 ETH 需要 Insurance 覆盖                                        │
│   风险: 高                                                                   │
│                                                                             │
│ 场景 3: 极端行情 (闪崩/闪涨)                                                │
│ ──────────────────                                                          │
│   价格瞬间变动 50%                                                          │
│   多个仓位同时穿仓                                                          │
│   Insurance 可能被耗尽                                                       │
│   触发 ADL → 暂停交易                                                       │
│   风险: 极高                                                                 │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 9. 场景矩阵: 盈利/亏损/穿仓/深穿仓

### 9.1 完整场景矩阵

```
初始条件:
├─ User 存款: 11 ETH
├─ 开仓: size=100 ETH, leverage=10x, collateral=10 ETH
├─ 开仓费: 0.1 ETH
├─ 平仓费: 0.1 ETH
├─ 入场价: 1000
└─ Insurance 初始: 100 ETH

┌───────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┐
│                                              场景矩阵                                                                  │
├─────────┬──────────┬──────────┬───────────────┬──────────────────┬──────────────────────┬──────────────────────────────┤
│ 场景    │ 退出价格 │ 价格变化 │ Raw PnL       │ Net PnL(扣费后)  │ 用户最终收益          │ Insurance 变化                │
├─────────┼──────────┼──────────┼───────────────┼──────────────────┼──────────────────────┼──────────────────────────────┤
│ A 大盈利│ 1200     │ +20%     │ +20 ETH       │ +19.9 ETH        │ 收回 col + profit    │ -19.9 ETH                    │
│         │          │          │               │                  │ = 9.9 + 19.9         │ (支付盈利)                    │
│         │          │          │               │                  │ = 29.8 ETH           │                              │
├─────────┼──────────┼──────────┼───────────────┼──────────────────┼──────────────────────┼──────────────────────────────┤
│ B 小盈利│ 1050     │ +5%      │ +5 ETH        │ +4.9 ETH         │ 收回 col + profit    │ -4.9 ETH                     │
│         │          │          │               │                  │ = 9.9 + 4.9          │                              │
│         │          │          │               │                  │ = 14.8 ETH           │                              │
├─────────┼──────────┼──────────┼───────────────┼──────────────────┼──────────────────────┼──────────────────────────────┤
│ C 持平  │ 1000     │ 0%       │ 0 ETH         │ -0.1 ETH         │ 收回 col - fee       │ 0                            │
│         │          │          │               │ (平仓费)         │ = 9.9 ETH            │                              │
├─────────┼──────────┼──────────┼───────────────┼──────────────────┼──────────────────────┼──────────────────────────────┤
│ D 小亏损│ 950      │ -5%      │ -5 ETH        │ -5.1 ETH         │ 收回 col - loss - fee│ +5.0 ETH                     │
│         │          │          │               │                  │ = 10 - 5 - 0.1       │ (收到亏损)                    │
│         │          │          │               │                  │ = 4.9 ETH            │                              │
├─────────┼──────────┼──────────┼───────────────┼──────────────────┼──────────────────────┼──────────────────────────────┤
│ E 边界  │ ~901     │ -9.9%    │ -9.9 ETH      │ -10 ETH          │ 收回 0 ETH           │ +9.9 ETH                     │
│ (全亏)  │          │          │               │                  │ (全部损失)            │                              │
├─────────┼──────────┼──────────┼───────────────┼──────────────────┼──────────────────────┼──────────────────────────────┤
│ F 穿仓  │ 850      │ -15%     │ -15 ETH       │ -15.1 ETH        │ 收回 0 ETH           │ ⚠️ 应收 +10 ETH             │
│         │          │          │               │ deficit=5.1 ETH  │                      │ ⚠️ 实际收 0 (BUG)            │
│         │          │          │               │                  │                      │ coverDeficit(-5.1)           │
├─────────┼──────────┼──────────┼───────────────┼──────────────────┼──────────────────────┼──────────────────────────────┤
│ G 深穿仓│ 700      │ -30%     │ -30 ETH       │ -30.1 ETH        │ 收回 0 ETH           │ ⚠️ 应收 +10 ETH             │
│         │          │          │               │ deficit=20.1 ETH │                      │ ⚠️ 实际收 0 (BUG)            │
│         │          │          │               │                  │                      │ coverDeficit(-20.1)          │
│         │          │          │               │                  │                      │ 可能触发 ADL                 │
├─────────┼──────────┼──────────┼───────────────┼──────────────────┼──────────────────────┼──────────────────────────────┤
│ H 保险金│ 700      │ -30%     │ -30 ETH       │ -30.1 ETH        │ 收回 0 ETH           │ insuranceFund = 0            │
│ 不足    │          │          │               │ deficit=20.1 ETH │                      │ 触发 ADL                     │
│         │          │          │               │ 但保险只有 15 ETH│                      │ 暂停交易                     │
└─────────┴──────────┴──────────┴───────────────┴──────────────────┴──────────────────────┴──────────────────────────────┘
```

### 9.2 每个场景的详细追踪

#### 场景 A: 大盈利 (+20%)

```
开仓后状态:
  user.balances = 0.9 ETH
  user.lockedBalances = 10 ETH
  feeReceiver.balances = 0.1 ETH
  Vault.ETH = 11 ETH
  Insurance.ETH = 100 ETH

平仓 (exitPrice = 1200):
  pnl = 100 * (1200 - 1000) / 1000 = +20 ETH

_settlePnL(user, 10 ETH collateral, +20 ETH pnl, 0.1 ETH fee):

  [1] collectFeeFromLocked(user, feeReceiver, 0.1 ETH)
      user.lockedBalances: 10 → 9.9 ETH
      feeReceiver.balances: 0.1 → 0.2 ETH
      collateral = 10 - 0.1 = 9.9 ETH

  [2] settleProfit(user, 9.9 ETH, 20 ETH)
      user.lockedBalances: 9.9 → 0 ETH
      user.balances: 0.9 → 10.8 ETH

      Insurance.payProfit(user, 20 ETH):
        insuranceFund: 100 → 80 ETH
        user.wallet += 20 ETH (直接转账)

平仓后状态:
  user.balances = 10.8 ETH (Vault 账本)
  user.wallet = +20 ETH (Insurance 转入)
  user.lockedBalances = 0
  feeReceiver.balances = 0.2 ETH
  Vault.ETH = 11 ETH (不变)
  Insurance.ETH = 80 ETH

用户总收益:
  10.8 (可提取) + 20 (已收到) - 11 (初始存入) = 19.8 ETH
  考虑开仓费 0.1 + 平仓费 0.1 = 0.2 ETH
  净盈利 = 20 - 0.2 = 19.8 ETH ✓
```

#### 场景 F: 穿仓 (-15%)

```
开仓后状态:
  user.balances = 0.9 ETH
  user.lockedBalances = 10 ETH
  Vault.ETH = 11 ETH
  Insurance.ETH = 100 ETH

平仓 (exitPrice = 850):
  pnl = 100 * (850 - 1000) / 1000 = -15 ETH
  loss = 15 ETH > collateral = 10 ETH → 穿仓!
  deficit = 15 - 10 = 5 ETH

_settlePnL(user, 10 ETH collateral, -15 ETH pnl, 0.1 ETH fee):

  [1] collectFeeFromLocked(user, feeReceiver, 0.1 ETH)
      user.lockedBalances: 10 → 9.9 ETH
      feeReceiver.balances: 0.1 → 0.2 ETH
      collateral = 9.9 ETH

      重新计算: loss = 15 ETH, collateral = 9.9 ETH
      deficit = 15 - 9.9 = 5.1 ETH

  [2] settleBankruptcy(user, 9.9 ETH, 5.1 ETH)

      ⚠️ 当前实现:
      user.lockedBalances: 9.9 → 0 ETH
      // 9.9 ETH 从账本消失!

      Insurance.coverDeficit(5.1 ETH):
        insuranceFund: 100 → 94.9 ETH

      ✗ 问题: Vault 里的 9.9 ETH 没转给 Insurance

平仓后状态 (当前实现):
  user.balances = 0.9 ETH
  user.lockedBalances = 0
  feeReceiver.balances = 0.2 ETH
  Vault.ETH = 11 ETH (没变! 应该是 11 - 9.9 = 1.1 ETH)
  Insurance.ETH = 100 - 5.1 = 94.9 ETH (应该是 100 + 9.9 - 5.1 = 104.8 ETH)

账本一致性检查:
  Σbalances = 0.9 + 0.2 = 1.1 ETH
  ΣlockedBalances = 0 ETH
  总计 = 1.1 ETH

  Vault.ETH = 11 ETH

  ❌ 11 != 1.1 → 9.9 ETH 成为孤儿资金!
```

---

## 10. Edge Cases 详细分析

### 10.1 Edge Case 列表

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           Edge Cases                                        │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│ EC-1: 平仓费 > 剩余保证金                                                   │
│ ─────────────────────────────────────────                                   │
│ 场景: collateral = 0.05 ETH, closeFee = 0.1 ETH                            │
│ 代码:                                                                       │
│   uint256 actualFee = fee > collateral ? collateral : fee;                 │
│   vault.collectFeeFromLocked(user, feeReceiver, actualFee);                │
│ 结果: 只收取 0.05 ETH 手续费，feeReceiver 少收                              │
│ 状态: ✓ 已处理                                                              │
│                                                                             │
│ EC-2: Insurance 余额 = 0 时有人盈利平仓                                     │
│ ─────────────────────────────────────────                                   │
│ 场景: insuranceFund = 0, user profit = 5 ETH                               │
│ 代码:                                                                       │
│   if (insuranceFund >= amount) { ... }                                     │
│   else { _handleInsuranceShortfall(...); }                                 │
│ 结果: 用户只能拿回保证金，盈利部分触发 ADL                                   │
│ 状态: ✓ 已处理 (但用户体验差)                                               │
│                                                                             │
│ EC-3: lockedBalances[user] < 传入的 collateral                             │
│ ─────────────────────────────────────────                                   │
│ 场景: 并发问题或合约状态不一致                                              │
│ 代码 (settleProfit):                                                        │
│   if (lockedBalances[user] >= collateral) { ... }                          │
│   else if (lockedBalances[user] > 0) { available = lockedBalances[user]; } │
│ 结果: 解锁实际可用的金额                                                    │
│ 状态: ✓ 已处理                                                              │
│                                                                             │
│ EC-4: ETH 转移失败 (receive 不存在或 revert)                                │
│ ─────────────────────────────────────────                                   │
│ 场景: insuranceFund 合约没有 receive/fallback                               │
│ 代码 (settleLoss):                                                          │
│   (bool success,) = insuranceFund.call{value: actualLoss}("");             │
│   if (!success) { /* 静默失败 */ }                                         │
│ 结果: 账本已更新但 ETH 没转移 = 不一致                                      │
│ 状态: ⚠️ 问题                                                               │
│                                                                             │
│ EC-5: 穿仓时 deficit > Insurance 余额                                       │
│ ─────────────────────────────────────────                                   │
│ 场景: deficit = 20 ETH, insuranceFund = 10 ETH                             │
│ 代码:                                                                       │
│   coveredDeficit = deficit > fundBalance ? fundBalance : deficit;          │
│   insuranceFund.coverDeficit(coveredDeficit);                              │
│ 结果: 只能覆盖 10 ETH，剩余 10 ETH 触发 ADL                                 │
│ 状态: ✓ 已处理                                                              │
│                                                                             │
│ EC-6: 同一用户同时有多个仓位 (多代币)                                       │
│ ─────────────────────────────────────────                                   │
│ 场景: user 对 tokenA 有盈利仓位，对 tokenB 有亏损仓位                       │
│ 当前: 每个仓位独立结算                                                      │
│ 问题: 无跨仓位 netting                                                      │
│ 状态: 设计决策 (逐仓模式)                                                   │
│                                                                             │
│ EC-7: 穿仓但 Vault 合约 ETH 余额不足                                        │
│ ─────────────────────────────────────────                                   │
│ 场景: Vault.balance < collateral (不应该发生)                               │
│ 代码 (settleLoss):                                                          │
│   if (address(this).balance >= actualLoss) { ... }                         │
│ 结果: 不转移 ETH，账本不一致                                                │
│ 状态: ⚠️ 防御性检查存在但不完整                                             │
│                                                                             │
│ EC-8: 零金额操作                                                            │
│ ─────────────────────────────────────────                                   │
│ 场景: collectFee(user, receiver, 0)                                        │
│ 代码:                                                                       │
│   if (amount == 0) return;                                                 │
│ 结果: 提前返回，不执行任何操作                                              │
│ 状态: ✓ 已处理                                                              │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 10.2 关键 Bug 总结

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         关键 Bug 总结                                        │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│ BUG-1: settleBankruptcy 账本泄漏                                            │
│ ─────────────────────────────────────────                                   │
│ 严重性: 🔴 严重                                                             │
│ 影响: 穿仓时 collateral ETH 永久卡在 Vault                                  │
│ 修复: 在清零 lockedBalances 前，将 ETH 转给 Insurance                       │
│ 状态: ✅ 已修复 (H-014) - 见 Vault.sol:295-338                              │
│                                                                             │
│ BUG-2: settleLoss ETH 转移失败时账本不一致                                  │
│ ─────────────────────────────────────────                                   │
│ 严重性: 🟡 中等                                                             │
│ 影响: 亏损 ETH 没转移但账本已更新                                           │
│ 修复: 先转移 ETH，成功后再更新账本；或使用 require                          │
│ 状态: ✅ 已修复 (H-015) - 见 Vault.sol:250-292                              │
│                                                                             │
│ BUG-3: settleProfit Insurance 调用失败时用户损失                            │
│ ─────────────────────────────────────────                                   │
│ 严重性: 🟡 中等                                                             │
│ 影响: 盈利可能无法支付但仓位已关闭                                          │
│ 修复: 记录未支付盈利，允许用户后续 claim                                    │
│ 状态: ✅ 已修复 (H-016) - 见 Vault.sol:212-256, 182-225                     │
│       添加 pendingProfits 映射 + claimPendingProfit 函数                    │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 11. 修复建议代码

### 11.1 修复 settleBankruptcy

```solidity
function settleBankruptcy(
    address user,
    uint256 collateral,
    uint256 deficit
) external onlyAuthorized nonReentrant returns (uint256 coveredDeficit) {
    // 获取用户实际锁定余额
    uint256 userLocked = lockedBalances[user];
    uint256 actualCollateral = collateral > userLocked ? userLocked : collateral;

    // 清除用户锁定保证金
    lockedBalances[user] = 0;

    // 🔧 修复: 将 collateral 的 ETH 转给 Insurance
    // 这部分 ETH 可以用于支付盈利方
    if (actualCollateral > 0 && insuranceFund != address(0)) {
        require(address(this).balance >= actualCollateral, "Insufficient Vault balance");
        (bool success,) = insuranceFund.call{value: actualCollateral}("");
        require(success, "Collateral transfer to insurance failed");
    }

    // 从保险基金覆盖 deficit（超出 collateral 的部分）
    if (deficit > 0 && insuranceFund != address(0)) {
        try IInsuranceFund(insuranceFund).coverDeficit(deficit) returns (uint256 covered) {
            coveredDeficit = covered;
        } catch {
            coveredDeficit = 0;
        }
    }

    emit BankruptcyHandled(user, actualCollateral, deficit, coveredDeficit);
}
```

### 11.2 修复 settleLoss

```solidity
function settleLoss(
    address user,
    uint256 collateral,
    uint256 loss
) external onlyAuthorized nonReentrant returns (uint256 actualLoss) {
    uint256 userLocked = lockedBalances[user];
    uint256 effectiveCollateral = collateral > userLocked ? userLocked : collateral;
    actualLoss = loss > effectiveCollateral ? effectiveCollateral : loss;
    uint256 returnAmount = effectiveCollateral - actualLoss;

    // 🔧 修复: 先转移 ETH，成功后再更新账本
    if (actualLoss > 0 && insuranceFund != address(0)) {
        require(address(this).balance >= actualLoss, "Insufficient Vault balance");
        (bool success,) = insuranceFund.call{value: actualLoss}("");
        require(success, "Loss transfer to insurance failed");
    }

    // ETH 转移成功后，更新账本
    if (userLocked >= effectiveCollateral) {
        lockedBalances[user] -= effectiveCollateral;
    } else {
        lockedBalances[user] = 0;
    }

    if (returnAmount > 0) {
        balances[user] += returnAmount;
    }

    emit LossCollected(user, effectiveCollateral, actualLoss);
}
```

---

## 12. 验证清单

```
□ PnL 计算正确性
  ✓ GMX 标准公式
  ✓ 符号处理正确
  ⚠️ 整数除法精度损失（向下取整）

□ Collateral Accounting
  ✓ 开仓: balances → lockedBalances
  ✓ 盈利平仓: lockedBalances → balances + Insurance 支付
  ⚠️ 亏损平仓: ETH 转移可能失败
  ❌ 穿仓: collateral 账本泄漏

□ Insurance Fund 资金流
  ✓ 方向正确（亏损流入，盈利流出）
  ⚠️ 转移原子性问题
  ❌ 穿仓时 collateral 未流入

□ Fee 路径
  ✓ 开仓费从 balances 扣除
  ✓ 平仓费从 lockedBalances 扣除
  ✓ 手续费上限保护

□ Settlement 顺序
  ✓ 资金费先结算
  ✓ 手续费先收取
  ⚠️ 仓位先删除（事务性保证）

□ Solvency
  ⚠️ 无实时偿付能力检查
  ✓ ADL 机制存在
  ✓ 暂停交易机制存在

□ Edge Cases
  ✓ 零金额处理
  ✓ 余额不足处理
  ⚠️ 转移失败处理不完整
```
