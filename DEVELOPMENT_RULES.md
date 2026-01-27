# Meme Perp DEX 开发准则与问题清单

> **重要**: 每次修改代码前必须先阅读本文件，确保遵循行业标准

---

## 零、系统架构选择

### V1 架构 (PositionManager - 资金池模式)
- 用户直接与资金池对赌
- 盈利从保险基金支付
- 简单但保险基金可能枯竭
- 文件: `PositionManager.sol`, `usePerpetualToken.ts`, `PerpetualOrderPanel.tsx`

### V2 架构 (Settlement - 用户对赌模式) ⭐ 推荐
- 用户签名 EIP-712 订单（链下，不花 Gas）
- 撮合引擎配对多空订单（链下）
- 撮合引擎批量提交配对结果（链上）
- Settlement 合约验证签名并执行结算
- **盈亏直接在多空之间转移，保险基金仅用于穿仓**
- 文件: `Settlement.sol`, `usePerpetualV2.ts`, `PerpetualOrderPanelV2.tsx`

```
V2 架构流程：
用户下单 → 签名 EIP-712 订单 → 发送到撮合引擎
                                      ↓
                              撮合多空订单配对
                                      ↓
                              批量提交到链上
                                      ↓
                      Settlement 合约验证签名 + 执行结算
                                      ↓
                      盈亏直接转移 (多头盈利 ←→ 空头亏损)
```

### 何时使用哪个架构?
| 场景 | 推荐架构 |
|------|---------|
| 新项目 | V2 Settlement |
| 已有 PositionManager 仓位 | V1 (迁移完成前) |
| 高流动性需求 | V2 Settlement |
| 极简测试 | V1 PositionManager |

---

## 一、行业标准公式 (必须遵循)

### 1. PnL 计算公式 (参考 GMX)

```solidity
// 来源: https://github.com/gmx-io/gmx-contracts/blob/master/contracts/core/Vault.sol
// getDelta 函数

function getDelta(
    uint256 _size,        // 仓位名义价值
    uint256 _averagePrice, // 开仓均价
    uint256 _currentPrice, // 当前标记价格
    bool _isLong
) pure returns (bool hasProfit, uint256 delta) {

    uint256 priceDelta = _averagePrice > _currentPrice
        ? _averagePrice - _currentPrice
        : _currentPrice - _averagePrice;

    // 核心公式
    delta = _size * priceDelta / _averagePrice;

    hasProfit = _isLong
        ? (_currentPrice > _averagePrice)  // 多头: 涨了赚钱
        : (_averagePrice > _currentPrice); // 空头: 跌了赚钱
}
```

### 2. 强平价格公式 (参考 Bybit/Binance)

```solidity
// 来源: https://www.bybit.com/en/help-center/article/Liquidation-Price-USDT-Contract/

// 多头强平价格
liqPrice_long = entryPrice - (initialMargin - maintenanceMargin) / positionSize

// 空头强平价格
liqPrice_short = entryPrice + (initialMargin - maintenanceMargin) / positionSize

// 其中:
// initialMargin = positionSize / leverage
// maintenanceMargin = positionSize * maintenanceMarginRate
```

**简化公式:**
```solidity
// 多头
liqPrice_long = entryPrice * (1 - 1/leverage + MMR)

// 空头
liqPrice_short = entryPrice * (1 + 1/leverage - MMR)

// MMR = Maintenance Margin Rate (维持保证金率, 通常 0.5% - 1%)
```

### 3. 保证金率计算

```solidity
// 保证金率 = (保证金 + 未实现盈亏) / 仓位价值
marginRatio = (collateral + unrealizedPnL) / positionSize

// 当 marginRatio < maintenanceMarginRate 时触发清算
```

### 4. 资金费率计算

```solidity
// 资金费率 = clamp(Premium Index + Interest Rate, -0.75%, 0.75%)
// Premium Index = (markPrice - indexPrice) / indexPrice

// 每 8 小时结算一次
// 多头支付: fundingRate > 0
// 空头支付: fundingRate < 0
```

---

## 二、系统架构标准 (必须遵循)

### 合约调用链

```
用户交易
    │
    ▼
TokenFactory.buy() / sell()
    │
    ├──► 更新池子状态
    │
    └──► PriceFeed.updateTokenPrice(token, newPrice)  ← 【必须调用】
              │
              ▼
         存储代币价格历史
              │
              ▼
    PositionManager 读取价格
              │
              ├──► getUnrealizedPnL()
              ├──► getLiquidationPrice()
              └──► canLiquidate()
```

### 前端调用链

```
用户操作
    │
    ▼
React Component (UI)
    │
    ▼
Custom Hook (usePerpetualToken)
    │
    ├──► 读取: useReadContract
    │        - getPositionByToken(user, token)  ← 【不是 getPosition】
    │        - getTokenMarkPrice(token)
    │        - 批量读取优化
    │
    └──► 写入: useWriteContract
             - openLongToken(token, size, leverage, mode)  ← 【不是 openLong】
             - closePositionToken(token)
```

---

## 三、已知问题清单

### 🔴 致命问题 (必须修复才能运行)

| ID | 问题 | 文件 | 状态 |
|----|------|------|------|
| C-01 | PriceFeed 没有与 TokenFactory 价格同步 | PriceFeed.sol | ✅ 已修复 (2026-01-21) |
| C-02 | PnL 计算公式不符合行业标准 | PositionManager.sol | ✅ 已修复 - GMX 标准 (2026-01-21) |
| C-03 | 强平价格计算公式错误 | PositionManager.sol | ✅ 已修复 - Bybit 标准 (2026-01-21) |
| C-05 | TokenFactory 交易没有调用价格更新 | TokenFactory.sol | ✅ 已修复 (2026-01-21) |
| F-01 | 前端调用旧的 getPosition 而非 getPositionByToken | usePerpetual.ts | ✅ 已修复 - usePerpetualToken hook (2026-01-21) |
| F-02 | 前端调用 openLong 而非 openLongToken | PerpetualOrderPanel.tsx | ✅ 已修复 (2026-01-21) |
| F-03 | 没有显示当前仓位信息 | PerpetualOrderPanel.tsx | ✅ 已修复 (2026-01-21) |
| F-04 | 没有显示未实现盈亏 | PerpetualOrderPanel.tsx | ✅ 已修复 (2026-01-21) |
| F-05 | 没有显示强平价格 | PerpetualOrderPanel.tsx | ✅ 已修复 (2026-01-21) |
| F-07 | 永续页面没有传入 token 地址 | perp/page.tsx | ✅ 已修复 - PerpetualTradingTerminal 传入 (2026-01-21) |
| F-08 | 没有平仓界面 | 前端 | ✅ 已修复 (2026-01-21) |
| A-01 | 合约间调用链断裂 | 系统架构 | ✅ 已修复 (2026-01-21) |
| A-04 | 前端与合约 ABI 不匹配 | 系统架构 | ✅ 已修复 (2026-01-21) |
| A-05 | 多代币功能写了没用 | 系统架构 | ✅ 已修复 (2026-01-21) |

### 🟡 严重问题 (影响功能完整性)

| ID | 问题 | 文件 | 状态 |
|----|------|------|------|
| C-04 | 资金费率没有定期累计 | PositionManager.sol | ✅ 已修复 - 开仓初始化 (2026-01-21) |
| C-07 | Liquidation 没有对接多代币函数 | Liquidation.sol | ✅ 已修复 - 多代币清算 (2026-01-21) |
| F-06 | 没有显示保证金率 | PerpetualOrderPanel.tsx | ✅ 已修复 (2026-01-21) |
| A-02 | 没有 Keeper 更新资金费率 | 系统架构 | ✅ 已修复 (2026-01-21) |
| A-03 | 没有清算机器人 | 系统架构 | ✅ 已修复 - 支持多代币 (2026-01-21) |

### 🟢 中等问题 (优化项)

| ID | 问题 | 文件 | 状态 |
|----|------|------|------|
| C-06 | 没有 Reader 合约批量读取 | 缺失 | ✅ 已修复 - Reader.sol (2026-01-21) |
| C-08 | 清算奖励可能溢出 | Liquidation.sol:161-166 | ✅ 已修复 - H-011 溢出保护 + Solidity 0.8.x 内置检查 (2026-01-21) |

---

## 四、开发规则 (每次修改前检查)

### 规则 1: 先确认调用链完整

```
修改任何函数前问自己:
□ 谁会调用这个函数?
□ 这个函数需要调用谁?
□ 数据从哪里来?
□ 修改后前端需要同步更新吗?
```

### 规则 2: 使用行业标准公式

```
□ PnL 计算是否符合 GMX getDelta 标准?
□ 强平价格是否符合 Bybit 公式?
□ 保证金率计算是否正确?
□ 不要自己发明公式
```

### 规则 3: 合约改动必须同步前端

```
□ 合约函数签名改了 → 更新前端 ABI
□ 合约新增函数 → 前端 hook 要调用
□ 合约返回值改了 → 前端解析要更新
```

### 规则 4: 每个修复必须验证

```
□ 写完合约 → 写测试
□ 部署后 → 前端调用验证
□ 验证失败 → 回滚并分析原因
```

### 规则 5: 更新本文件

```
□ 修复一个问题 → 更新状态为 ✅ 已修复
□ 发现新问题 → 添加到问题清单
□ 新的标准/规则 → 添加到对应章节
```

---

## 五、参考资源

### 开源代码
- GMX V1: https://github.com/gmx-io/gmx-contracts
- GMX V2: https://github.com/gmx-io/gmx-synthetics
- dYdX: https://github.com/dydxprotocol/perpetual
- Perpetual Protocol: https://github.com/perpetual-protocol/perp-curie-contract

### 文档
- Bybit 强平价格: https://www.bybit.com/en/help-center/article/Liquidation-Price-USDT-Contract/
- Hyperliquid 清算: https://hyperliquid.gitbook.io/hyperliquid-docs/trading/liquidations

---

## 六、修复记录

### 2026-01-21 (第二批修复)
**合约修复:**
- C-01/C-05: 添加 `PriceFeed.updateTokenPriceFromFactory()` 函数，TokenFactory 交易后自动同步价格
- C-02: 验证 PnL 计算已符合 GMX 标准，添加 `getTokenUnrealizedPnL()` 多代币支持
- C-03: 重写强平价格公式按 Bybit 标准，添加 `getTokenLiquidationPrice()` 多代币支持
- A-01: 修复合约调用链: TokenFactory → PriceFeed → PositionManager

**前端修复:**
- F-01/F-02: 创建 `usePerpetualToken` hook 支持多代币永续交易
- F-03/F-04/F-05: 在 PerpetualOrderPanel 添加仓位信息展示（大小、入场价、未实现盈亏、强平价）
- F-08: 添加平仓按钮和 `handleClosePosition` 函数
- A-04/A-05: 更新前端 ABI 包含所有多代币函数

**修改的文件:**
- `contracts/src/core/PriceFeed.sol` - 添加 updateTokenPriceFromFactory
- `contracts/src/core/TokenFactory.sol` - 添加 PriceFeedHelper 库和价格同步调用
- `contracts/src/core/PositionManager.sol` - 添加 getTokenUnrealizedPnL, getTokenLiquidationPrice
- `frontend/src/hooks/usePerpetual.ts` - 添加 usePerpetualToken hook 和多代币 ABI
- `frontend/src/components/trading/PerpetualOrderPanel.tsx` - 添加仓位展示和平仓功能

### 2026-01-21 (第三批修复 - 全部完成)
**合约修复:**
- C-04: 在 PositionManager `_openPosition` 中添加 `fundingRate.settleUserFunding()` 初始化用户 funding index
- C-07: 为 Liquidation.sol 添加多代币清算函数 (`liquidateToken`, `canLiquidateToken`, `getUserPnLToken` 等)
- C-06: 创建 Reader.sol 批量读取合约（`getPositionsBatch`, `getUserDashboard`, `getMarketOverview` 等）
- C-08: 确认 H-011 溢出保护 + Solidity 0.8.x 内置检查已解决溢出问题

**前端修复:**
- F-07: 在 PerpetualTradingTerminal 中传入 `tokenAddress` prop 到 PerpetualOrderPanel
- F-06: 添加保证金率显示 (`getTokenMarginRatio` + UI 展示)

**后端修复:**
- A-02: 确认 FundingKeeper 已实现，支持链上结算
- A-03: 为 LiquidationContract 添加多代币清算函数 (`LiquidateToken`, `CanLiquidateToken` 等)

**修改的文件:**
- `contracts/src/core/PositionManager.sol` - 添加 getTokenMarginRatio, settleUserFunding 调用
- `contracts/src/core/Liquidation.sol` - 添加 liquidateToken, canLiquidateToken 等多代币函数
- `contracts/src/periphery/Reader.sol` - 新建批量读取合约
- `contracts/src/interfaces/IPositionManager.sol` - 添加 view 函数接口
- `frontend/src/hooks/usePerpetual.ts` - 添加 marginRatio 支持
- `frontend/src/components/trading/PerpetualOrderPanel.tsx` - 添加保证金率展示
- `frontend/src/components/trading/PerpetualTradingTerminal.tsx` - 传入 tokenAddress
- `backend/internal/blockchain/contracts.go` - 添加多代币清算合约绑定

### 2026-01-21 (初始)
- 创建本开发准则文件
- 完成问题收集和行业标准研究

---

## 七、V2 架构部署指南

### 部署步骤

1. **部署 Settlement 合约**
```bash
cd contracts
forge script script/DeploySettlement.s.sol --rpc-url $RPC_URL --broadcast
# 记录输出的 Settlement 地址
```

2. **配置前端**
```env
# frontend/.env.local
NEXT_PUBLIC_SETTLEMENT_ADDRESS=<部署的地址>
NEXT_PUBLIC_MATCHING_ENGINE_URL=http://localhost:8081
NEXT_PUBLIC_USE_V2_TRADING=true
```

3. **配置撮合引擎**
```bash
cd backend/src/matching
cp .env.template .env
# 编辑 .env 设置:
# - SETTLEMENT_ADDRESS
# - MATCHER_PRIVATE_KEY (需要有 ETH 支付 gas)
# - RPC_URL
```

4. **启动撮合引擎**
```bash
cd backend/src/matching
npm install
npm run dev
```

5. **验证部署**
```bash
# 检查 Settlement 合约
cast call $SETTLEMENT_ADDRESS "owner()" --rpc-url $RPC_URL

# 检查撮合引擎
curl http://localhost:8081/health
```

### 关键文件

| 功能 | 合约 | 后端 | 前端 |
|------|------|------|------|
| 结算 | Settlement.sol | - | - |
| 部署 | DeploySettlement.s.sol | - | - |
| 撮合 | - | matching/engine.ts | - |
| API | - | matching/server.ts | - |
| Hook | - | - | usePerpetualV2.ts |
| 组件 | - | - | PerpetualOrderPanelV2.tsx |
| 签名 | - | - | orderSigning.ts |

### 授权撮合者
```bash
# 在部署后，授权撮合者地址
cast send $SETTLEMENT_ADDRESS "setAuthorizedMatcher(address,bool)" $MATCHER_ADDRESS true \
  --rpc-url $RPC_URL --private-key $OWNER_PRIVATE_KEY
```

---

**最后更新**: 2026-01-25
**下次修改前必须先读取本文件**
**V2 Settlement 架构已添加！**

---

## 八、Settlement 合约升级记录

### 2026-01-25 - 支持 1:N 撮合 + USDT 计价

**升级 1: 1:N 撮合**

问题: 原有 `usedOrders` 映射将整个订单标记为已使用，导致一个大订单只能与一个对手方撮合。

解决方案:
- 替换 `usedOrders` 为 `filledAmounts` 追踪每个订单的已成交数量
- 修改 `_validateOrder` 检查 `filledAmounts[orderHash] >= order.size`
- 修改 `_settlePair` 验证不超额成交并更新已成交数量
- 顺序 nonce 模式只在完全成交时递增 nonce

**升级 2: USDT 计价**

问题: 原版使用 ETH 作为保证金，盈亏随 ETH 价格波动。

解决方案:
- 添加 `collateralToken` 状态变量（USDT/USDC）
- 修改 `deposit(uint256 amount)` 为 ERC20 转入
- 修改 `withdraw(uint256 amount)` 为 ERC20 转出
- 所有保证金、仓位、盈亏都以 USDT 计价

**新合约地址**:
- Settlement: `0xaAAc66A691489BBF8571C8E4a95b1F96F07cE0Bc`
- MockUSDT: `0x8d44C3cf6252FaC397c7A237F70466907D6fcB47`

**USDT 精度**: 6 位小数 (1 USDT = 1e6)

**关键变更**:
```solidity
// 保证金代币
IERC20 public collateralToken;

// 存款（需先 approve）
function deposit(uint256 amount) external;

// 提款
function withdraw(uint256 amount) external;
```

**用户操作流程**:
```javascript
// 1. 获取测试 USDT
await mockUsdt.mint(userAddress, 10000 * 1e6); // 10,000 USDT

// 2. 授权 Settlement 使用 USDT
await usdt.approve(settlementAddress, MaxUint256);

// 3. 存入 USDT
await settlement.deposit(1000 * 1e6); // 存入 1,000 USDT

// 4. 签名订单、交易...

// 5. 提款 USDT
await settlement.withdraw(500 * 1e6); // 提取 500 USDT
```

**升级 3: Session Key（免签名交易）**

问题: 每次操作都需要钱包签名，体验差。

解决方案:
- 用户授权 Session Key（临时密钥）
- Session Key 代用户执行存款/提款/交易
- 用户无需频繁签名，体验接近中心化交易所

**Session Key 特性**:
- 金额限制：单次最大金额 + 每日限额
- 时间限制：自动过期
- 权限控制：可单独控制存款/交易/提款权限
- 可随时撤销

**最终合约地址**:
- Settlement: `0xd84d1fFF3650ab4806B15A0D5F32932E80f0E32C`
- MockUSDT: `0x246c4A147F8b7Afb2b4b820284f11F5119553106`

**前端集成示例**:
```javascript
// 1. 首次设置：生成 Session Key 并授权
const sessionWallet = ethers.Wallet.createRandom();
localStorage.setItem('sessionKey', sessionWallet.privateKey);

await settlement.authorizeSessionKey(
    sessionWallet.address,
    1000 * 1e6,      // 单次最大 1000 USDT
    5000 * 1e6,      // 每日限额 5000 USDT
    Date.now()/1000 + 86400,  // 24小时有效
    true,  // 可存款
    true,  // 可交易
    false  // 不可提款（更安全）
);

// 2. 用户 approve USDT（只需一次）
await usdt.approve(settlementAddress, MaxUint256);

// 3. 之后：Session Key 自动存款（无钱包弹窗）
const sessionKey = new ethers.Wallet(localStorage.getItem('sessionKey'), provider);
await settlement.connect(sessionKey).depositWithSessionKey(userAddress, amount);
```

**验证命令**:
```bash
# 查询保证金代币地址
cast call 0xd84d1fFF3650ab4806B15A0D5F32932E80f0E32C "getCollateralToken()" --rpc-url $RPC_URL

# 查询 Session Key 授权
cast call 0xd84d1fFF3650ab4806B15A0D5F32932E80f0E32C "getSessionKey(address,address)" <user> <sessionKey> --rpc-url $RPC_URL

# 查询用户 USDT 余额
cast call 0x246c4A147F8b7Afb2b4b820284f11F5119553106 "balanceOf(address)" <user> --rpc-url $RPC_URL

# Mint 测试 USDT（任何人都可以）
cast send 0x246c4A147F8b7Afb2b4b820284f11F5119553106 "mint(address,uint256)" <user> 10000000000 --rpc-url $RPC_URL
```
