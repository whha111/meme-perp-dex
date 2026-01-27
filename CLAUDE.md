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

系统存在严重的架构问题，合约之间调用链断裂，前端调用错误的合约函数。

**核心问题:**
1. TokenFactory 交易不更新 PriceFeed 价格
2. 前端调用旧的单代币函数，合约已支持多代币
3. PnL 和强平价格计算公式不符合行业标准
4. 前端没有显示仓位信息

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

| 功能 | 合约 | 前端 |
|------|------|------|
| 价格 | contracts/src/core/PriceFeed.sol | - |
| 仓位 | contracts/src/core/PositionManager.sol | frontend/src/hooks/usePerpetual.ts |
| 交易 | contracts/src/core/TokenFactory.sol | frontend/src/hooks/useExecuteSwap.ts |
| 下单面板 | - | frontend/src/components/trading/PerpetualOrderPanel.tsx |

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
