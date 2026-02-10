# Claude Code 项目指令

> 每次对话开始时自动读取此文件

## 强制要求

**在修改任何永续合约相关代码之前，必须先执行:**

```bash
cat /Users/qinlinqiu/Desktop/meme-perp-dex/DEVELOPMENT_RULES.md
```

## 项目概述

这是一个 Meme 代币永续合约交易平台，包含:
- **contracts/**: Solidity 智能合约 (Foundry)
- **frontend/**: Next.js 前端
- **backend/**: Go 后端 (待开发)

## 当前状态

系统架构已完成清理和优化 (2026-02-02)。

**已解决:**
- ✅ API URL 统一到 `config/api.ts`
- ✅ WebSocket 统一到 `useUnifiedWebSocket`
- ✅ Store 统一到 `tradingDataStore`
- ✅ 死代码已清理 (~2000+ 行)

**仍需注意:**
1. TokenFactory 交易需同步更新 PriceFeed 价格
2. 使用多代币函数 `openLongToken/openShortToken`
3. PnL 和强平价格计算必须符合行业标准

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

**架构已重构 (2026-02-02)**: 现货和合约代码已分离到独立目录

| 功能 | 合约 | 前端 |
|------|------|------|
| 价格 | contracts/src/common/PriceFeed.sol | - |
| 仓位 | contracts/src/perpetual/PositionManager.sol | frontend/src/hooks/perpetual/usePerpetualV2.ts |
| 现货交易 | contracts/src/spot/TokenFactory.sol | frontend/src/hooks/spot/useExecuteSwap.ts |
| 合约下单面板 | - | frontend/src/components/perpetual/PerpetualOrderPanelV2.tsx |
| 现货下单面板 | - | frontend/src/components/spot/SwapPanelOKX.tsx |
| 交易状态 | - | frontend/src/lib/stores/tradingDataStore.ts |
| API 配置 | - | frontend/src/config/api.ts |

### 目录结构

```
frontend/src/
├── components/
│   ├── common/      # 共用组件 (OrderBook, TradeHistory, PriceBoard)
│   ├── spot/        # 现货交易组件
│   └── perpetual/   # 合约交易组件
├── hooks/
│   ├── common/      # 共用 hooks (useETHPrice, useMarketData)
│   ├── spot/        # 现货 hooks (useSpotSwap, useTokenFactory)
│   └── perpetual/   # 合约 hooks (usePerpetualV2, useRiskControl)

contracts/src/
├── common/          # 共用合约 (PriceFeed, Vault, ContractRegistry)
├── spot/            # 现货合约 (TokenFactory, AMM, Router)
└── perpetual/       # 合约合约 (PositionManager, Settlement, Liquidation)

backend/src/
├── matching/        # 合约撮合引擎
└── spot/            # 现货后端服务
```

## 禁止事项

1. ❌ 不要自己发明 PnL 或强平价格公式
2. ❌ 不要只改合约不改前端
3. ❌ 不要调用旧的 `openLong/openShort`，要用 `openLongToken/openShortToken`
4. ❌ 不要调用旧的 `getPosition`，要用 `getPositionByToken`
5. ❌ 不要忘记 TokenFactory 交易后更新 PriceFeed

## 修改检查清单

每次修改后问自己:
- [ ] 调用链是否完整?
- [ ] 前端是否同步更新?
- [ ] 公式是否符合行业标准?
- [ ] DEVELOPMENT_RULES.md 是否需要更新?
