# PerpVault 生产级审计报告

> 基于 GMX V1/V2、HyperLiquid、Aave V3、Jupiter JLP、Gains Network gTrade、dYdX、Synthetix V3、Level Finance 的**源码级**深入研究

---

## 一、研究范围与方法

### 研究了哪些一手资料

| 平台 | 研究内容 |
|------|---------|
| **GMX V1** | `GlpManager.sol` 源码（`getAum()`、`_addLiquidity()`、`_removeLiquidity()`）、`Vault.sol`（`buyUSDG()`、`sellUSDG()`、`poolAmounts`、`guaranteedUsd`、`globalShortSizes`）、`VaultUtils.sol`（`getFeeBasisPoints()` 动态费率公式）、`ShortsTracker.sol`、Collider $1M bug bounty 分析、2025年7月 $42M 重入攻击分析、2022年9月 AVAX 价格操纵事件 |
| **GMX V2** | `AdlUtils.sol` 源码（`updateAdlState()`、`createAdlOrder()`）、`MarketUtils.sol`（`isPnlFactorExceeded()`、`getPoolValue()`、`getNetPnl()`）、`DepositUtils.sol`、`WithdrawalUtils.sol`、Sherlock 审计报告 |
| **HyperLiquid** | HLP vault 技术文档、4天锁定期机制、JELLY 代币攻击事件（2025年3月，$1200万风险）详细分析（Halborn 安全报告）、验证者中心化问题 |
| **Jupiter JLP** | AUM 计算公式（含 `guaranteedUsd`、`globalShortDelta`）、75% 费用分配、池价计算 |
| **Gains Network** | gToken ERC-4626 实现、`accRewardsPerToken` + `accPnlPerTokenUsed` 公式、超额抵押缓冲机制、GNS 铸造/销毁（0.05%/24h 上限）、动态锁定期（1-3 epochs） |
| **Aave V3** | Scaled Balance 机制、`liquidityIndex` 复利计算、Virtual Shares 防通胀攻击、Supply Caps |
| **dYdX V4** | Insurance Fund → ADL 降杠杆 → 社会化损失三层机制 |
| **Synthetix V3** | Debt Shares 机制、SNX 质押者作为对手方、多池委托模型 |
| **Level Finance** | Senior/Mezzanine/Junior 三档 LP 池（不同风险/收益） |
| **OpenZeppelin** | ERC-4626 通胀攻击研究、Virtual Shares + Decimal Offset 方案 |
| **安全事件** | GMX AVAX 零滑点攻击（$56.5万）、GMX ShortsTracker 重入（$4200万）、HyperLiquid JELLY 攻击（$1200万风险）、ERC-4626 first-depositor 攻击 |

---

## 二、各平台 LP 池核心机制深度对比

### 2.1 池子价值（AUM）计算 —— 最核心的区别

#### GMX V1 — `getAum()` 源码（已验证）

```solidity
function getAum(bool maximise) public view returns (uint256) {
    uint256 aum = aumAddition;
    uint256 shortProfits = 0;

    for (uint256 i = 0; i < vault.allWhitelistedTokensLength(); i++) {
        address token = vault.allWhitelistedTokens(i);
        uint256 price = maximise ? vault.getMaxPrice(token) : vault.getMinPrice(token);
        uint256 poolAmount = vault.poolAmounts(token);

        if (vault.stableTokens(token)) {
            // 稳定币：直接加
            aum += poolAmount * price / 10**decimals;
        } else {
            // 1) 全局空头盈亏
            uint256 size = vault.globalShortSizes(token);
            if (size > 0) {
                (uint256 delta, bool hasProfit) = getGlobalShortDelta(token, price, size);
                if (!hasProfit) aum += delta;     // 空头亏损 = 池子赚的
                else shortProfits += delta;       // 空头盈利 = 池子欠的
            }
            // 2) 担保金额（多头仓位的 size - collateral 部分）
            aum += vault.guaranteedUsd(token);
            // 3) 未被锁定的池子代币
            aum += (poolAmount - vault.reservedAmounts(token)) * price / 10**decimals;
        }
    }
    aum = shortProfits > aum ? 0 : aum - shortProfits;
    return aumDeduction > aum ? 0 : aum - aumDeduction;
}
```

**关键点：**
- `guaranteedUsd` = 多头仓位的 (size - collateral)，代表池子担保的金额
- `globalShortDelta` = 空头持仓的未实现盈亏
- **存款用 `getAum(true)` 最大价格**（LP 拿到更少份额）
- **提款用 `getAum(false)` 最小价格**（LP 拿到更少 ETH）
- 这保护了现有 LP 不被新存款者或提款者套利

#### Jupiter JLP — AUM 计算

```
unrealized_pnl = (global_short_sizes * |avg_price - current_price|) / avg_price
nav = (owned_tokens - locked_tokens) * current_price + guaranteed_usd
aum = nav + unrealized_pnl (空头亏) 或 nav - unrealized_pnl (空头赚)
```

与 GMX V1 几乎完全一样。75% 交易费归 LP。

#### Gains Network gTrade — gToken 价格

```
gToken_price = 1 + accRewardsPerToken - max(0, accPnlPerTokenUsed)
```

- `accRewardsPerToken`: 累积费用（只增不减）
- `accPnlPerTokenUsed`: 快照式 PnL 累积器，每 epoch 更新一次
- **包含未实现 PnL**（通过 epoch 快照机制）

#### GMX V2 — Pool Value

```
poolValue = deposited_tokens_value + pending_PnL + pending_borrow_fees
GM_price = poolValue / totalSupply
```

使用 Keeper 两步执行：用户 `createDeposit()` → Keeper 用预言机价格 `executeDeposit()`

#### HyperLiquid HLP

```
equity = deposits + unrealized_PnL (协议原生计算)
```

不是智能合约，是协议内置的 vault。

#### 我们的 PerpVault

```solidity
function getPoolValue() public view returns (uint256) {
    return address(this).balance;  // ⚠️ 不包含未实现盈亏！
}
```

### 🔴 差距 C1（致命）：我们的 `getPoolValue()` 不包含未实现盈亏

**所有主流平台（GMX V1/V2、Jupiter、HyperLiquid、Gains Network）都把未实现交易者盈亏算进池子价值。我们没有。**

**后果：**
1. 份额价格不准确 — 当交易者有大量未实现利润时，份额价格虚高
2. LP 可以抢跑 — 在大量清算（交易者亏损）前存入，拿到便宜份额
3. 新存款者被稀释 — 或者老 LP 被套利

---

### 2.2 存取款机制

| 特性 | GMX V1 | GMX V2 | HyperLiquid | Gains Network | Jupiter | 我们 |
|------|--------|--------|-------------|---------------|---------|------|
| 存款定价 | AUM(最大价格) | Keeper 预言机 | 协议原生 | epoch 快照 | AUM(最大价格) | balance/shares |
| 提款定价 | AUM(最小价格) | Keeper 预言机 | 协议原生 | epoch 快照 | AUM(最小价格) | balance/shares |
| 存提不同价 | **✅ 是** | ✅ | N/A | ✅ | **✅ 是** | **❌ 否** |
| 冷却期 | `lastAddedAt` + cooldown（可配，最大48h） | 可配 | **4天** | 动态 1-3 epochs | 无 | 24h (hardcoded) |
| 冷却可调 | **✅ owner 可设** | ✅ | 否（固定4天） | 自动调整 | N/A | **❌ constant** |
| 存款上限 | `maxUsdgAmount` | Supply caps | 协议控制 | 有 | 有 | **❌ 无** |
| 私有模式 | `inPrivateMode` | 有 | N/A | 有 | N/A | **❌ 无** |
| 滑点保护 | `_minGlp`, `_minOut` | 有 | N/A | 有 | 有 | ✅ `minSharesOut` |

### 🟠 差距 H2：冷却期不可调

GMX 允许 owner 在高波动时期增加冷却期，HyperLiquid 直接用 4 天。我们 hardcoded 24h 无法调整。

### 🟡 差距 M1：无存款上限 / 私有模式

GMX 有 `inPrivateMode`（只允许白名单存款）和 `maxUsdgAmount`（AUM 上限）。我们没有。

---

### 2.3 费率结构

#### GMX V1 — 动态费率公式（已验证源码）

```solidity
function getFeeBasisPoints(_token, _usdgDelta, _feeBasisPoints, _taxBasisPoints, _increment) {
    if (!vault.hasDynamicFees()) return _feeBasisPoints;

    uint256 initialAmount = vault.usdgAmounts(_token);
    uint256 nextAmount = _increment ? initialAmount + _usdgDelta : initialAmount - _usdgDelta;
    uint256 targetAmount = vault.getTargetUsdgAmount(_token);

    uint256 initialDiff = |initialAmount - targetAmount|;
    uint256 nextDiff = |nextAmount - targetAmount|;

    if (nextDiff < initialDiff) {
        // 靠近目标 → 给折扣
        uint256 rebateBps = taxBasisPoints * initialDiff / targetAmount;
        return max(0, feeBasisPoints - rebateBps);
    }
    // 远离目标 → 加税
    uint256 averageDiff = (initialDiff + nextDiff) / 2;
    uint256 taxBps = taxBasisPoints * min(averageDiff, targetAmount) / targetAmount;
    return feeBasisPoints + taxBps;
}
```

**关键参数：** `mintBurnFeeBasisPoints` = 25bps 基础, `taxBasisPoints` = 50bps 浮动, `stableTaxBasisPoints` = 20bps

#### 各平台费率对比

| 特性 | GMX V1 | GMX V2 | HyperLiquid | Gains | Jupiter | 我们 |
|------|--------|--------|-------------|-------|---------|------|
| 存款费 | 25-75 bps (动态) | 动态价格影响 | 0 | 有 | 有 | 30 bps (固定) |
| 提款费 | 25-75 bps (动态) | 动态价格影响 | 0 | 有 | 有 | 30 bps (固定) |
| 动态费率 | **✅** | **✅** | 无 | 有 | **✅** | **❌** |
| 交易费归LP | 70% | 63% | 100% | 部分 | 75% | 100% |
| 借贷费/持仓费 | ✅ `fundingRate` | ✅ `borrowingFactor` | ✅ funding | ✅ rollover | ✅ | **❌ 无** |

### 🟡 差距 M2：无持仓借贷费

GMX 的 `getFundingFee()` 对每个持仓按时间收费：
```solidity
fundingFee = size * (cumulativeFundingRate - entryFundingRate) / PRECISION
```
这是 LP 的重要收入来源。我们只有开仓/平仓手续费。

---

### 2.4 ADL（自动减仓）机制

#### GMX V2 — AdlUtils.sol（已验证源码）

```solidity
// 触发条件：当 pnlToPoolFactor > MAX_PNL_FACTOR_FOR_ADL
function updateAdlState(DataStore, EventEmitter, IOracle, market, isLong) {
    // 1. 获取当前价格
    // 2. 调用 MarketUtils.isPnlFactorExceeded() 检查
    //    → 返回 (shouldEnableAdl, pnlToPoolFactor, maxPnlFactor)
    // 3. 设置 isAdlEnabled flag
    // 4. 记录 latestAdlTime
}

// 执行：创建市价减仓订单
function createAdlOrder(params) returns (bytes32) {
    // 对最赚钱的仓位创建 decrease order
    // sizeDeltaUsd = 要减少的仓位大小
    // 验证：sizeDelta 不超过仓位大小
}
```

#### HyperLiquid — 阶梯式减仓

1. 先取消所有挂单
2. 迭代关闭 20% 仓位直到保证金足够
3. 如果仍不够 → 协议验证者投票介入

**JELLY 事件教训：** 2025年3月，攻击者用 $710万开低流动性代币的大空头，然后在其他交易所拉盘 429%，HLP 自动继承了水下空头仓位。$2.3亿 HLP 面临清算风险。最终验证者在2分钟内投票下架 JELLY 并以 $0.0095（而非市价 $0.50）结算所有仓位。

#### dYdX V4 — 三层机制

```
第一层：保险基金吸收损失
第二层：ADL 降杠杆（关闭最赚钱 + 最高杠杆的仓位）
第三层：社会化损失（极端情况）
```

#### 我们的 PerpVault

```solidity
// 当 profitETH > address(this).balance 时：
revert InsufficientPoolBalance(); // 直接回滚，交易者无法平仓！
```

### 🔴 差距 C2（致命）：无 ADL 机制

当交易者利润超过池子余额时，我们直接 revert，交易者无法取回利润。所有主流平台都有 ADL 机制来处理这种情况。

---

### 2.5 安全机制对比

#### 通胀攻击防护

| 方案 | 使用者 | 我们 |
|------|-------|------|
| Dead Shares（锁定到 burn 地址） | Uniswap V2 | ✅ 1000 shares to 0xdEaD |
| Virtual Shares + Decimal Offset | OpenZeppelin ERC-4626 (v4.9+) | ❌ 没用 |
| USDG 中间代币 | GMX V1 | ❌ 没用（不需要，我们是单资产） |
| 协议原生 | HyperLiquid | N/A |

**评估：** 我们的 dead shares 方案可以接受。OpenZeppelin 的 virtual shares 更优雅但对我们的简单单资产池来说不必要。

#### 重入攻击防护

| 平台 | 方案 | 我们 |
|------|------|------|
| GMX V1 | 2025年7月因 ShortsTracker 跨合约重入被攻击 $4200万 | ✅ ReentrancyGuard |
| GMX V2 | RoleStore + handler 模式 | ✅ onlyAuthorized |

**GMX $4200万事件分析：**
- 2022年 Collider 发现 `getAum()` 中 `globalShortSize` 和 `globalShortAveragePrice` 不是原子更新的
- GMX 修复时把均价计算移到了独立的 `ShortsTracker` 合约
- 但 `ShortsTracker` 只在 `PositionManager` 中被调用，直接调用 `Vault` 不会更新 `ShortsTracker`
- 2025年7月，攻击者利用这个重入路径操纵 AUM 计算

**对我们的启示：** 我们的设计更简单（单合约），但如果未来拆分合约，必须确保状态更新的原子性。

#### 价格操纵防护

| 事件 | 平台 | 根因 | 损失 |
|------|------|------|------|
| AVAX 零滑点攻击 | GMX V1 (2022.9) | 零价格影响 + 预言机延迟 | $56.5万 |
| JELLY 攻击 | HyperLiquid (2025.3) | 低流动性代币无仓位限制 | $1200万风险 |
| ShortsTracker 重入 | GMX V1 (2025.7) | 跨合约状态不同步 | $4200万 |

**对我们的启示：**
- ✅ 我们有 `maxOIPerToken` 限制（防 JELLY 类攻击）
- ❌ 但没有按代币流动性动态调整限制
- ✅ 我们的合约架构简单，不存在跨合约重入风险

---

### 2.6 Gains Network 特色 —— 超额抵押缓冲

```
超额抵押（≥100%）：交易者亏损的一部分 → OTC 池 → 用户用资产买 GNS → GNS 被销毁
抵押不足（<100%）：铸造 GNS → OTC 出售换资产 → 补充池子（每24h 最多铸造总量的 0.05%）
```

**对我们的启示：** 可以考虑在未来加入类似机制——当池子大幅亏损时，铸造治理代币补充。但 MVP 阶段不需要。

### 2.7 Level Finance 特色 —— 三档 LP 池

```
Senior (AAA) — 最低风险、最低收益
Mezzanine (AA) — 中等风险、中等收益
Junior (BB) — 最高风险、最高收益
```

每个档位独立隔离，损失优先由 Junior 承担。

**对我们的启示：** 创新但复杂，MVP 不需要。

### 2.8 Synthetix V3 特色 —— Debt Shares 委托模型

```
LP 存入抵押品(SNX/ETH/USDC) → V3 Vault → 委托给 Spartan Council Pool
→ 生成 sUSD → 提供给永续市场 → 交易费按比例分配
```

**对我们的启示：** 多池委托模型过于复杂，但 Debt Shares 的概念（按比例追踪全局债务变化）与我们的份额模型类似。

---

## 三、我们的 PerpVault 逐项分析

### 3.1 已经做好的（符合生产标准）

| # | 功能 | 对标 | 状态 |
|---|------|------|------|
| 1 | Dead Shares 防通胀（1000 → 0xdEaD） | OpenZeppelin ERC-4626, Uniswap V2 | ✅ |
| 2 | 存取款费（30 bps） | GMX 25-75 bps 范围内 | ✅ |
| 3 | 冷却期从存款时间算 | GMX `lastAddedAt` | ✅ |
| 4 | 滑点保护 `minSharesOut` / `minETHOut` | GMX `_minGlp`, `_minOut` | ✅ |
| 5 | OI 提款守卫 | GMX `reservedAmounts` | ✅ |
| 6 | 每代币 OI 上限 `maxOIPerToken` | GMX `maxGlobalLongSizes` | ✅ |
| 7 | O(1) 总 OI 累加器 | 比 GMX（循环）更优 | ✅ |
| 8 | ReentrancyGuard | 行业标准 | ✅ |
| 9 | Pausable 暂停 | 行业标准 | ✅ |
| 10 | 最后 LP 退出例外（dead shares only） | 我们的创新 | ✅ |
| 11 | 100% 费用归池子 | 与 HyperLiquid 一致 | ✅ |
| 12 | 清算结算 + 清算人奖励 | 行业标准 | ✅ |
| 13 | 紧急提款 `emergencyRescue` | 行业标准 | ✅ |

### 3.2 必须修复的

#### 🔴 C1（致命）：池子价值不包含未实现盈亏

```
当前：  getPoolValue() = address(this).balance
应该是：getPoolValue() = address(this).balance - netPendingPnL
```

**所有平台（GMX V1/V2、Jupiter、HyperLiquid、Gains Network）都把未实现 PnL 算进去。**

**修复方案：**
```solidity
int256 public netPendingPnL; // 正 = 交易者赚 = 池子负债

function updatePendingPnL(int256 _netPnL) external onlyAuthorized {
    emit PendingPnLUpdated(netPendingPnL, _netPnL);
    netPendingPnL = _netPnL;
}

function getPoolValue() public view returns (uint256) {
    int256 adjusted = int256(address(this).balance) - netPendingPnL;
    return adjusted > 0 ? uint256(adjusted) : 0;
}
```

撮合引擎每次开仓/平仓/价格变动时调用 `updatePendingPnL()`。

#### 🔴 C2（致命）：无 ADL 机制

```
当前：  settleTraderProfit() 中 balance < profitETH → revert
应该是：触发 ADL → 关闭最赚钱仓位 → 部分结算
```

**修复方案：**
```solidity
uint256 public constant ADL_THRESHOLD_BPS = 9000; // 90%

function shouldADL() public view returns (bool) {
    if (netPendingPnL <= 0) return false;
    uint256 pendingProfit = uint256(netPendingPnL);
    return pendingProfit * FEE_PRECISION > address(this).balance * ADL_THRESHOLD_BPS;
}

event ADLTriggered(uint256 pnlToPool, uint256 poolValue);
event ADLExecuted(address indexed trader, uint256 reducedSize);

// 撮合引擎调用：部分结算利润
function settleTraderProfitPartial(
    address trader,
    uint256 profitETH,
    uint256 maxPayable
) external onlyAuthorized nonReentrant {
    uint256 actualPay = profitETH > maxPayable ? maxPayable : profitETH;
    // ... 正常结算逻辑但用 actualPay
}
```

#### 🔴 C3（致命）：无低流动性代币仓位限制

**JELLY 事件教训：** 攻击者在低流动性代币上开大仓位 → 在其他交易所操纵价格 → 池子继承水下仓位。

**修复方案：**
```solidity
// maxOIPerToken 必须根据代币流动性设置
// 低流动性代币：最大 OI << 池子价值
// 高流动性代币：最大 OI 可以更大

// 此外，增加单笔仓位大小限制
uint256 public maxPositionSizePerToken;
mapping(address => uint256) public maxSinglePositionSize;
```

### 3.3 应该修复的

#### 🟠 H1：冷却期不可调

```
当前：  uint256 public constant WITHDRAWAL_COOLDOWN = 24 hours;
应该是：uint256 public withdrawalCooldown = 24 hours; // owner 可调
```

```solidity
uint256 public constant MAX_COOLDOWN = 7 days;
uint256 public withdrawalCooldown = 24 hours;

function setCooldown(uint256 _cooldown) external onlyOwner {
    require(_cooldown <= MAX_COOLDOWN, "Exceeds max");
    withdrawalCooldown = _cooldown;
    emit CooldownUpdated(_cooldown);
}
```

HyperLiquid 用 4 天，GMX 最多 48 小时。市场波动时需要更长冷却期。

#### 🟠 H2：无存款上限 / 私有模式

```solidity
uint256 public maxPoolValue; // 0 = 不限
bool public depositsPaused;

function _deposit(uint256 minSharesOut) internal {
    if (depositsPaused) revert DepositsPaused();
    // ... 存款逻辑 ...
    if (maxPoolValue > 0 && getPoolValue() > maxPoolValue) revert ExceedsMaxPoolValue();
}
```

上线初期需要限制 TVL 增长速度，发现问题时需要暂停存款。

### 3.4 可以后续做的

| # | 功能 | 对标 | 优先级 |
|---|------|------|-------|
| M1 | 动态费率（根据池子平衡调整） | GMX `getFeeBasisPoints()` | 中 |
| M2 | 持仓借贷费 | GMX `fundingRate`, Gains `rolloverFee` | 中 |
| M3 | PnL 更新事件 | - | 低 |
| M4 | 超额抵押缓冲 / 治理代币铸造 | Gains Network | 低 |
| M5 | 存提不同定价 | GMX max/min price | 低（加了 PnL 后不太需要） |

---

## 四、安全攻防案例与我们的防护状态

### 4.1 ERC-4626 首存者通胀攻击

**攻击方式：** 首存者存 1 wei → 直接转大量代币到合约 → 后续存款者因舍入误差损失全部资金

**我们的防护：** ✅ Dead Shares (1000) — 首存时锁定 1000 shares 到 0xdEaD，攻击者无法获得所有份额

**OpenZeppelin 建议的更优方案：** Virtual Shares + Decimal Offset — 但对我们的单资产 ETH 池来说，dead shares 足够

### 4.2 GMX AVAX 零滑点攻击（2022.9, $56.5万）

**攻击方式：** GMX 提供零价格影响交易 → 攻击者在 GMX 开大仓 → 在 CEX 操纵价格 → 在 GMX 获利平仓

**我们的防护：**
- ✅ 我们不是 AMM，通过撮合引擎执行
- ⚠️ 但如果价格源可被操纵，同类攻击仍可能发生
- ✅ `maxOIPerToken` 限制了单代币暴露

### 4.3 GMX ShortsTracker 重入攻击（2025.7, $4200万）

**攻击方式：** Vault 和 ShortsTracker 状态更新不原子 → 重入时 AUM 计算错误 → GLP 价格被操纵

**我们的防护：** ✅ 单合约设计，不存在跨合约状态不同步问题 + ReentrancyGuard

**⚠️ 未来风险：** 如果我们拆分合约或加入新的 tracker，必须确保状态原子更新

### 4.4 HyperLiquid JELLY 攻击（2025.3, $1200万风险）

**攻击方式：** 在低流动性代币上开超大空头 → 在其他交易所拉盘 429% → HLP 继承水下空头

**我们的防护：**
- ✅ `maxOIPerToken` — 但需要根据代币流动性合理设置
- ❌ 没有按代币流动性动态调整限制
- ❌ 没有单笔仓位大小限制

### 4.5 Flash Loan 攻击

**攻击方式：** 闪电贷大量资金 → 存入池子 → 操纵池子价值 → 获利退出

**我们的防护：** ✅ 两步提款（request → execute，24h 冷却）完全阻止了闪电贷攻击

### 4.6 三明治攻击（Sandwich Attack）

**攻击方式：** 在 LP 大额存/提前后夹击

**我们的防护：** ✅ 30 bps 费用使小额三明治无利可图 + 冷却期阻止同区块套利

---

## 五、最终实施优先级

```
第一优先（上线前必须完成）：
  C1 — netPendingPnL 加入池子价值计算      (~30 行合约 + 撮合引擎改动)
  C2 — ADL 机制基础实现                    (~40 行合约 + 撮合引擎改动)
  C3 — 按代币流动性设置合理的 maxOIPerToken  (运营配置)

第二优先（上线后第一次迭代）：
  H1 — 冷却期可配置                        (~10 行)
  H2 — 存款上限 + 私有模式                  (~15 行)

第三优先（成熟期迭代）：
  M1 — 动态费率
  M2 — 持仓借贷费
  M3 — 超额抵押缓冲
```

---

## 六、参考资料

### 源码
- [GMX V1 GlpManager.sol](https://github.com/gmx-io/gmx-contracts/blob/master/contracts/core/GlpManager.sol)
- [GMX V1 Vault.sol](https://github.com/gmx-io/gmx-contracts/blob/master/contracts/core/Vault.sol)
- [GMX V1 VaultUtils.sol](https://github.com/gmx-io/gmx-contracts/blob/master/contracts/core/VaultUtils.sol)
- [GMX V2 AdlUtils.sol](https://github.com/gmx-io/gmx-synthetics/blob/main/contracts/adl/AdlUtils.sol)
- [GMX V2 MarketUtils.sol](https://github.com/gmx-io/gmx-synthetics/blob/main/contracts/market/MarketUtils.sol)
- [OpenZeppelin ERC-4626](https://github.com/OpenZeppelin/openzeppelin-contracts/blob/master/contracts/token/ERC20/extensions/ERC4626.sol)
- [Gains Network gToken Docs](https://docs.gains.trade/liquidity-farming-pools/gtoken-vaults)
- [Jupiter JLP Economics](https://hub.jup.ag/guides/jlp/JLP-Economics)

### 安全事件分析
- [GMX $42M Hack July 2025 (Halborn)](https://www.halborn.com/blog/post/explained-the-gmx-hack-july-2025)
- [GMX $1M Bounty - Collider](https://www.collider.vc/post/gmx-granted-million-dollar-bug-bounty-to-collider-the-bug-aftermath)
- [HyperLiquid JELLY Exploit March 2025 (Halborn)](https://www.halborn.com/blog/post/explained-the-hyperliquid-hack-march-2025)
- [GMX AVAX Price Manipulation 2022](https://medium.com/neptune-mutual/decoding-gmxs-price-manipulation-exploit-33f0b1910a2f)
- [OpenZeppelin ERC-4626 Inflation Attack Defense](https://www.openzeppelin.com/news/a-novel-defense-against-erc4626-inflation-attacks)
- [ERC-4626 Exchange Rate Manipulation Risks](https://www.openzeppelin.com/news/erc-4626-tokens-in-defi-exchange-rate-manipulation-risks)

### 社区讨论与行业分析
- [GMX V1 Architecture Explainer](https://hackmd.io/@0xProtosec/SksD4CY9j)
- [Perp DEX Architecture & Security (QuillAudits)](https://www.quillaudits.com/blog/dex/perp-dex-architecture-and-security)
- [dYdX Loss Mechanisms](https://help.dydx.trade/en/articles/166973-contract-loss-mechanisms-on-dydx-chain)
- [Synthetix V3 Explainer](https://blog.synthetix.io/a-quick-explainer-on-synthetix-v3/)
- [Level Finance LP Tranches](https://www.gate.com/learn/articles/understanding-level-finance-in-one-article/751)
