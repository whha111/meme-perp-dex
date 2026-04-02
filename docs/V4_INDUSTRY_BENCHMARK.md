# V4 行业对标审计报告

> **日期**: 2026-03-31
> **对标对象**: Binance, OKX, Bybit, dYdX, Hyperliquid, GMX
> **原则**: 根据项目实际情况 (Meme Token DEX) 调整，不照搬大型交易所

---

## 审计总结

| 类别 | 发现数 | 已修复 | 剩余 |
|------|--------|--------|------|
| 后端/撮合引擎 | 8 | 8 | 0 |
| 前端 | 7 | 7 | 0 |
| **合计** | **15** | **15** | **0** |

---

## 项目定位 vs 大型交易所

本项目是 **Meme 代币永续合约 DEX**，与 Binance/OKX 等有本质区别：

| 特性 | 大型交易所 | 本项目 | 原因 |
|------|-----------|--------|------|
| 最大杠杆 | 125x | 2.5x/5x | Meme 代币波动剧烈，高杠杆=秒爆 |
| 保证金模式 | 全仓+逐仓 | 仅逐仓 | 风险隔离优先 |
| 定价 | 独立 Mark Price | Spot Price | Bonding Curve/DEX 即时价格 |
| 对手方 | 纯 P2P 或纯 LP | P2P 优先 + LP 兜底 | 流动性渐进式增长 |
| 手续费 | 分层 (VIP) | 统一 Taker 5bp / Maker 3bp | 早期简化 |
| 强制提款 | 有 | 有 (Merkle proof) | 资金安全 |
| 私钥管理 | 托管/MPC | 派生钱包 + AES-256-GCM 加密 | 用户可导出 |

**不需要的功能** (经分析确认)：
- ❌ 125x 杠杆 — Meme 代币 10x 已极端危险
- ❌ 全仓模式 — 仓位间风险应隔离
- ❌ 分层保证金 — 用户少、仓位小，无需复杂阶梯
- ❌ 完整 TradingView — 轻量级 K 线足够
- ❌ 止盈止损订单 — 后期迭代 (P2 优先级)

---

## 修复清单

### V4-01: ABI stateMutability 错误 (HIGH)

**问题**: `perpVault.ts` 中 `settleTraderLoss` 和 `settleLiquidation` ABI 声明为 `nonpayable`，但合约函数需要 `msg.value`
**影响**: 链上结算调用 revert，亏损/清算无法执行
**修复**: 改为 `stateMutability: "payable"`
**文件**: `backend/src/matching/modules/perpVault.ts` (lines 131-148)

### V4-02: 手续费率散落硬编码 (MEDIUM)

**问题**: 8+ 处不同的费率硬编码 (30bp, 5bp, 0.003 等)，不一致且维护困难
**影响**: 前后端费率不一致，用户实际扣费与显示不符
**修复**: 统一到 `config.ts TRADING.TAKER_FEE_RATE (5n)` / `TRADING.MAKER_FEE_RATE (3n)`
**文件**: `config.ts`, `server.ts` (4处), `engine.ts` (1处)

### V4-03: LP 无盈利上限 (HIGH)

**问题**: 单笔交易盈利无上限，协同攻击可耗尽 LP 池
**对标**: GMX 单笔盈利不超过池子一定比例
**修复**: `closePositionByMatch()` 加 `maxProfit = poolValue * 9%` 上限
**文件**: `backend/src/matching/server.ts` (line ~7420-7445)

### V4-04: 限价单无价格偏离保护 (MEDIUM)

**问题**: 限价单可挂极端价格 (如 1 wei)，可能被恶意利用
**对标**: 所有交易所都有价格偏离限制
**修复**: 限价单偏离 Spot Price ±50% 自动拒绝
**文件**: `backend/src/matching/server.ts` (line ~7907)

### V4-05: Funding Rate 清算检查逻辑错误 (HIGH)

**问题**: `checkFundingLiquidations()` 使用固定初始保证金率 `10000n * 10000n / leverage` 代替实际 collateral
**影响**: 资金费扣减后应触发清算的仓位未被检测到
**修复**: 改用 `position.collateral` vs 计算出的 `maintenanceMargin`
**文件**: `backend/src/matching/modules/funding.ts` (lines 289-307)

### V4-06: FOK 订单部分成交后回滚问题 (MEDIUM)

**问题**: FOK 订单进入 `tryMatch()` 后如不能全部成交，回滚时对手方订单状态已被修改
**对标**: 所有交易所 FOK 先检查深度再匹配
**修复**: 匹配前用 `calculateAvailableSize()` 预检，不够直接拒绝
**文件**: `backend/src/matching/engine.ts`

### V4-07: config.ts 缺少关键常量 (LOW)

**问题**: Max Profit Rate、Price Band、毕业后杠杆上限无配置
**修复**: 新增 `MAX_PROFIT_RATE: 900n`, `PRICE_BAND_BPS: 5000n`, `MAX_LEVERAGE_GRADUATED: 50000n`
**文件**: `backend/src/matching/config.ts`

### V4-08: Mark Price 确认 (INFO)

**问题**: 需确认 Mark Price = Spot Price 的设计合理性
**结论**: ✅ 正确 — `syncSpotPrices()` 每秒从 Bonding Curve/DEX 同步价格，合约内部成交不影响
**文件**: `backend/src/matching/server.ts` (line ~1246 注释确认)

### V4-09: 交易对显示错误 (LOW)

**问题**: 前端显示 `XXXUSDT` 而非 `/BNB`，最大杠杆显示 `10x` 而非 `2.5x`
**修复**: 改为 `XXX/BNB` + `2.5x`
**文件**: `frontend/src/components/perpetual/PerpetualTradingTerminal.tsx`

### V4-10: OrderBook 点击不填价 (LOW)

**问题**: 点击 OrderBook 价格无反应，只有 `console.log`
**对标**: 所有交易所点击盘口自动填入限价
**修复**: 新增 `orderBookSuggestedPrice` state，点击后自动切到限价模式 + 填入价格
**文件**: `PerpetualTradingTerminal.tsx` + `PerpetualOrderPanelV2.tsx`

### V4-11: parseFloat 处理 ETH 金额 (MEDIUM)

**问题**: `BigInt(Math.floor(parseFloat(marginAmount) * 1e18))` 精度丢失
**对标**: V2 审计 C04 同类问题
**修复**: 改用 viem `parseEther(marginAmount)`
**文件**: `frontend/src/components/perpetual/PerpetualOrderPanelV2.tsx`

### V4-12: 手续费显示不准确 (LOW)

**问题**: 前端显示硬编码 "Taker 0.3%"，实际后端是 0.05%
**修复**: 动态显示 `orderType === "limit" ? "Maker 0.03%" : "Taker 0.05%"`，计算同步
**文件**: `PerpetualOrderPanelV2.tsx` + `earnings/page.tsx`

### V4-13: 全仓模式未禁用 (LOW)

**问题**: 全仓按钮可点击但后端不支持
**修复**: Cross 按钮 `disabled` + "Soon" badge
**文件**: `frontend/src/components/perpetual/PerpetualOrderPanelV2.tsx`

### V4-14: 保险基金显示为空 (MEDIUM)

**问题**: `useRiskControl.ts` 用空 `useState` 而非从 store 读取 WS 推送的保险基金数据
**修复**: 改用 `useTradingDataStore(state => state.insuranceFund)` + 类型映射
**文件**: `frontend/src/hooks/perpetual/useRiskControl.ts`

### V4-15: Bill/Trade 记录 (INFO — 确认已有)

**问题**: 需确认每笔余额变更是否有记录
**结论**: ✅ 所有路径已有 `RedisSettlementLogRepo` 写入 (DEPOSIT, WITHDRAW, SETTLE_PNL, TRADING_FEE, FUNDING_FEE, LIQUIDATION, ADL, MARGIN_ADD, MARGIN_REMOVE)
**文件**: `backend/src/matching/server.ts` (多处)

---

## 不适用项 (经分析排除)

| 特性 | 原因 |
|------|------|
| 高杠杆 (>5x) | Meme 代币波动性，2.5x/5x 已是合理上限 |
| 全仓模式 | 仓位间风险隔离更重要，后期可迭代 |
| 分层保证金 | 用户量少，无需 VIP 分层 |
| 独立 Mark Price | Bonding Curve 即时价格更适合项目场景 |
| TradingView 高级版 | 轻量 K 线足够，降低部署复杂度 |
| 止盈止损 | P2 优先级，后期迭代 |
| 跟单交易 | P3 优先级 |
| 网格交易 | 不适用于 Meme 代币场景 |

---

## 验证状态

- ✅ 所有服务编译通过 (TypeScript clean, Go build clean)
- ✅ 前端 Docker 构建成功
- ✅ 撮合引擎运行正常
- ✅ Go Backend 运行正常
- ✅ 373 contract tests pass
