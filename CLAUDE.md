# Claude Code 项目指令

> 每次对话开始时自动读取此文件

## 强制要求

**在修改任何永续合约相关代码之前，必须先执行:**

```bash
cat /Users/qinlinqiu/Desktop/meme-perp-dex/DEVELOPMENT_RULES.md
```

## ⚠️ 严重警告 (2026-03-01 全面审计)

**发现 48 个问题: 12 CRITICAL, 15 HIGH, 21 MEDIUM**

整个永续合约交易系统运行在**虚拟余额**上，没有真实链上资金:
- SettlementV2 合约余额 = 0 (从未有人调用 deposit())
- PerpVault 合约余额 = 0 (deposit() 从未调用，totalShares = 0)
- 所有用户余额来自 `mode2PnLAdjustments` 内存 Map + Redis
- `POST /api/user/:trader/deposit` 是无验证的虚假充值接口
- 做市商通过此接口注入 6 ETH 幽灵流动性
- Redis 丢失 = 所有资金记录丢失，无法恢复

**详见**: `docs/ISSUES_AUDIT_REPORT.md`

## 项目概述

这是一个 Meme 代币永续合约交易平台，包含:
- **contracts/**: Solidity 智能合约 (Foundry)
- **frontend/**: Next.js 前端
- **backend/**: Go API + Keeper 服务
- **backend/src/matching/**: TypeScript 撮合引擎 (核心，12000+ 行)

## 当前状态

**架构**: 简化版 dYdX v3 — 链下撮合 + SettlementV2 托管 + PerpVault LP 池 + Merkle 提款

**已完成:**
- ✅ PerpVault OI 追踪 (batch queue + nonce管理，100% 成功率)
- ✅ Merkle 快照代码就绪 (modules/snapshot.ts)
- ✅ 提款 Merkle proof 代码就绪 (modules/withdraw.ts)
- ✅ ConfigureSettlement.s.sol 地址已修正

**未连通 (CRITICAL):**
- ❌ 用户存款未调用 SettlementV2.deposit() — 走虚假 API
- ❌ 用户提款未调用 SettlementV2.withdraw() — 走虚假 API
- ❌ PnL 结算未真正流经 PerpVault — 纯 mode2Adj
- ❌ 保险基金纯内存，不持久化
- ❌ Keeper 读空 PostgreSQL，强平监控失效
- ❌ ConfigureSettlement.s.sol 未执行（需要 ETH）

## 行业标准 (必须遵循)

### PnL 计算 (GMX 标准)
```solidity
delta = size * |currentPrice - avgPrice| / avgPrice
hasProfit = isLong ? (currentPrice > avgPrice) : (avgPrice > currentPrice)
```

### 强平价格 (Bybit 标准)
```
多头: liqPrice = entryPrice * (1 - 1/leverage + MMR)
空头: liqPrice = entryPrice * (1 + 1/leverage - MMR)
```

## 关键文件位置

| 功能 | 文件 |
|------|------|
| 撮合引擎入口 | backend/src/matching/server.ts (12000+ 行) |
| PerpVault 模块 | backend/src/matching/modules/perpVault.ts |
| Merkle 快照 | backend/src/matching/modules/snapshot.ts |
| 提款授权 | backend/src/matching/modules/withdraw.ts |
| 链上存款中继 | backend/src/matching/modules/relay.ts |
| 前端合约交互 | frontend/src/hooks/perpetual/usePerpetualV2.ts |
| 前端余额显示 | frontend/src/components/common/AccountBalance.tsx |
| 做市商脚本 | scripts/market-maker-all.ts |
| 部署配置 | frontend/contracts/deployments/base-sepolia.json |
| 审计报告 | docs/ISSUES_AUDIT_REPORT.md |

### 目录结构

```
frontend/src/
├── components/
│   ├── common/      # 共用组件 (OrderBook, TradeHistory, PriceBoard)
│   ├── spot/        # 现货交易组件
│   └── perpetual/   # 合约交易组件
├── hooks/
│   ├── common/      # 共用 hooks
│   ├── spot/        # 现货 hooks
│   └── perpetual/   # 合约 hooks (usePerpetualV2, useRiskControl)

contracts/src/
├── common/          # PriceFeed, Vault, ContractRegistry
├── spot/            # TokenFactory, AMM, Router
└── perpetual/       # PositionManager, Settlement, PerpVault, Liquidation

backend/src/matching/ # TypeScript 撮合引擎 (核心)
backend/internal/     # Go API + Keeper
```

## 禁止事项

1. ❌ 不要自己发明 PnL 或强平价格公式
2. ❌ 不要只改合约不改前端
3. ❌ 不要调用旧的 `openLong/openShort`，要用 `openLongToken/openShortToken`
4. ❌ 不要调用旧的 `getPosition`，要用 `getPositionByToken`
5. ❌ 不要忘记 TokenFactory 交易后更新 PriceFeed
6. ❌ 不要使用 `POST /api/user/:trader/deposit` 虚假充值接口
7. ❌ 不要在 mode2Adj 上建设新功能 — 所有资金流必须走链上合约

## 修改检查清单

每次修改后问自己:
- [ ] 调用链是否完整?
- [ ] 前端是否同步更新?
- [ ] 公式是否符合行业标准?
- [ ] 资金流是否走链上合约（不是 mode2Adj）?
- [ ] DEVELOPMENT_RULES.md 是否需要更新?
