# Production Perp DEX Feature Checklist

> Compiled 2026-03-30 from analysis of Binance Futures, OKX, Bybit, dYdX v4, Hyperliquid, GMX v2, Gains Network (gTrade), Drift Protocol, and Vertex Protocol.
>
> Legend: **[MUST]** = table-stakes for production launch, **[NICE]** = competitive advantage / phase-2
>
> Status column reflects current meme-perp-dex state.

---

## 1. Order Types

| # | Feature | Priority | Status | Notes |
|---|---------|----------|--------|-------|
| 1.1 | **Market order** | MUST | DONE | All platforms support |
| 1.2 | **Limit order (GTC)** | MUST | DONE | Core orderbook feature |
| 1.3 | **Stop-loss (stop-market)** | MUST | DONE | Trigger at mark/last price -> market order |
| 1.4 | **Take-profit (TP market)** | MUST | DONE | TP trigger in Order struct |
| 1.5 | **Stop-limit order** | MUST | TODO | Binance/Bybit/OKX/dYdX all support; trigger price + limit price |
| 1.6 | **IOC (Immediate or Cancel)** | MUST | DONE | TimeInForce enum exists |
| 1.7 | **FOK (Fill or Kill)** | MUST | DONE | TimeInForce enum exists |
| 1.8 | **Post-only / Maker-only** | MUST | DONE | `postOnly` field on Order |
| 1.9 | **Reduce-only** | MUST | DONE | `reduceOnly` field on Order |
| 1.10 | **Trailing stop** | NICE | TODO | Binance/Bybit support; callback rate % from peak |
| 1.11 | **TWAP (Time-Weighted Average Price)** | NICE | TODO | Hyperliquid supports; splits large orders over time |
| 1.12 | **Scale orders** | NICE | TODO | Hyperliquid supports; multiple limit orders across price range |
| 1.13 | **Bracket order (TP+SL attached)** | NICE | TODO | OKX/Binance: attach TP/SL at order creation |
| 1.14 | **OCO (One-Cancels-Other)** | NICE | TODO | Binance Futures supports |
| 1.15 | **Conditional / Trigger order** | MUST | PARTIAL | Have conditional ZSet in Redis; need full UI |
| 1.16 | **GTD (Good Till Date)** | NICE | DONE | TimeInForce.GTD exists |

---

## 2. Position Management

| # | Feature | Priority | Status | Notes |
|---|---------|----------|--------|-------|
| 2.1 | **Open long / short** | MUST | DONE | `openLongToken` / `openShortToken` |
| 2.2 | **Close position (market/limit)** | MUST | DONE | |
| 2.3 | **Partial close** | MUST | DONE | |
| 2.4 | **Add margin (isolated mode)** | MUST | DONE | Margin adjustment modal exists |
| 2.5 | **Remove margin** | MUST | DONE | With `maxRemovable` guard |
| 2.6 | **Adjust leverage** | MUST | TODO | Binance/Bybit/OKX allow per-position leverage change |
| 2.7 | **Position TP/SL modification** | MUST | DONE | TP/SL modal connected to backend |
| 2.8 | **Position reversal (flip long->short)** | NICE | TODO | Close + open in single action |
| 2.9 | **Multi-token positions** | MUST | DONE | Per-token position management |
| 2.10 | **Position size display (USD + token qty)** | MUST | DONE | |
| 2.11 | **Unrealized PnL (real-time)** | MUST | DONE | GMX formula |
| 2.12 | **Realized PnL tracking** | MUST | DONE | |
| 2.13 | **Average entry price** | MUST | DONE | Weighted average on add |
| 2.14 | **Liquidation price display** | MUST | DONE | Bybit formula |
| 2.15 | **Funding fee accrual display** | MUST | TODO | Show accumulated funding per position |
| 2.16 | **Position share image** | NICE | TODO | Bybit/Hyperliquid: shareable PnL card |

---

## 3. Margin & Account System

| # | Feature | Priority | Status | Notes |
|---|---------|----------|--------|-------|
| 3.1 | **Isolated margin mode** | MUST | DONE | Current default |
| 3.2 | **Cross margin mode** | MUST | TODO | Binance/Bybit/OKX/Hyperliquid/dYdX all support; shared collateral across positions |
| 3.3 | **Portfolio margin mode** | NICE | TODO | OKX/Hyperliquid: risk-based margin across spot+perps; 3.5x capital efficiency |
| 3.4 | **Margin mode toggle (per-position)** | MUST | TODO | Switch isolated <-> cross before opening |
| 3.5 | **Tiered maintenance margin** | MUST | TODO | Binance/Bybit: larger positions require higher MMR; prevents whale manipulation |
| 3.6 | **Multi-asset collateral** | NICE | TODO | OKX unified: use BTC/ETH as perp collateral with haircut |
| 3.7 | **Sub-accounts** | NICE | TODO | OKX/Binance/Hyperliquid: separate risk per strategy |
| 3.8 | **Unified account (spot+perps+earn)** | NICE | TODO | OKX flagship feature |
| 3.9 | **Account equity / margin ratio display** | MUST | DONE | AccountBalance component |
| 3.10 | **Available balance calculation** | MUST | DONE | Balance minus locked margin |
| 3.11 | **Max position size calculator** | MUST | TODO | Show max openable size given balance + leverage |

---

## 4. Risk Management & Liquidation

| # | Feature | Priority | Status | Notes |
|---|---------|----------|--------|-------|
| 4.1 | **Mark price (oracle-based)** | MUST | DONE | PriceFeed contract |
| 4.2 | **Liquidation engine** | MUST | DONE | Event-driven + scheduled check |
| 4.3 | **Insurance fund** | MUST | DONE | PerpVault = insurance fund |
| 4.4 | **Auto-deleveraging (ADL)** | MUST | PARTIAL | ADL score calculation exists (server.ts:1288); need full ADL execution path |
| 4.5 | **Liquidation cascade prevention** | MUST | TODO | Partial liquidation (reduce to safe level before full liq) -- Binance/Bybit do this |
| 4.6 | **Maintenance margin rate (MMR)** | MUST | DONE | Used in liq price calculation |
| 4.7 | **Open interest caps (per-token)** | MUST | DONE | PerpVault OI tracking |
| 4.8 | **Global open interest limits** | MUST | DONE | RiskManager contract |
| 4.9 | **Price band / circuit breaker** | MUST | TODO | Binance: +/-3% deviation constraint from index; prevents manipulation |
| 4.10 | **Funding rate mechanism** | MUST | DONE | FundingRate contract |
| 4.11 | **Funding rate cap/floor** | MUST | TODO | Typically capped at +/-0.75% per 8h period |
| 4.12 | **Maximum leverage per market** | MUST | DONE | Per-token config |
| 4.13 | **Risk parameter governance** | NICE | TODO | Community/DAO control of risk params |
| 4.14 | **Socialized loss mechanism** | NICE | TODO | Fallback if insurance fund + ADL insufficient |
| 4.15 | **Partial liquidation** | MUST | TODO | Reduce position size incrementally instead of full close; Binance/Bybit/Hyperliquid standard |
| 4.16 | **Liquidation penalty to insurance fund** | MUST | DONE | `settleLiquidation` sends to PerpVault |

---

## 5. Fee Structure

| # | Feature | Priority | Status | Notes |
|---|---------|----------|--------|-------|
| 5.1 | **Maker / taker fee split** | MUST | DONE | Industry standard (Hyperliquid: 0.01%/0.035%) |
| 5.2 | **Volume-based fee tiers** | MUST | TODO | All CEXs + dYdX/Hyperliquid: lower fees for higher volume |
| 5.3 | **Funding fee (periodic)** | MUST | DONE | 8h settlement |
| 5.4 | **Borrowing fee** | NICE | TODO | GMX v2: fee for borrowing liquidity from LP pool |
| 5.5 | **Price impact fee** | NICE | TODO | GMX v2: fee based on OI imbalance impact |
| 5.6 | **Referral fee rebate** | MUST | PARTIAL | `usePerpReferral` hook exists |
| 5.7 | **Token-holder fee discount** | NICE | TODO | Binance BNB / dYdX DYDX: discount for holding platform token |
| 5.8 | **Negative maker fee (rebate)** | NICE | TODO | Hyperliquid top tier: maker rebate encourages liquidity |
| 5.9 | **Fee transparency (per-trade breakdown)** | MUST | TODO | Show opening fee, closing fee, funding accrued per trade |

---

## 6. Liquidity & Market Making

| # | Feature | Priority | Status | Notes |
|---|---------|----------|--------|-------|
| 6.1 | **LP vault (counterparty pool)** | MUST | DONE | PerpVault with LP deposits |
| 6.2 | **LP deposit / withdraw** | MUST | DONE | PerpVault LP functions |
| 6.3 | **LP PnL tracking** | MUST | DONE | `getPoolValue()` |
| 6.4 | **Market maker bot** | MUST | DONE | `scripts/market-maker-all.ts` |
| 6.5 | **Isolated LP pools (per-market)** | NICE | TODO | GMX v2 GM pools: LPs choose which markets to back |
| 6.6 | **HLP-style protocol vault** | NICE | TODO | Hyperliquid: protocol-owned market-making vault |
| 6.7 | **User-created vaults** | NICE | TODO | Hyperliquid: anyone can create a vault with 100 USDC |
| 6.8 | **JIT (Just-In-Time) liquidity** | NICE | TODO | Drift: competitive fill auctions at execution time |
| 6.9 | **OI balance incentive** | MUST | DONE | Funding rate mechanism balances long/short |
| 6.10 | **LP fee share** | MUST | DONE | LPs earn from trading fees via PerpVault |
| 6.11 | **LP epoch / cooldown** | NICE | TODO | gTrade: epoch-based vault with accPnlPerToken cap |

---

## 7. API & Developer Features

| # | Feature | Priority | Status | Notes |
|---|---------|----------|--------|-------|
| 7.1 | **REST API (orders, positions, balances)** | MUST | DONE | Matching engine HTTP API |
| 7.2 | **WebSocket (orderbook, trades, positions)** | MUST | DONE | Real-time push via WSS |
| 7.3 | **API key authentication** | MUST | TODO | All CEXs: API key + secret; current system uses wallet signatures |
| 7.4 | **Rate limiting** | MUST | TODO | Essential for production; per-IP and per-user |
| 7.5 | **Order event streaming** | MUST | DONE | WS subscription for order updates |
| 7.6 | **Historical trade data API** | MUST | DONE | Trade history endpoints |
| 7.7 | **Kline / candlestick API** | MUST | DONE | Kline data in engine |
| 7.8 | **Funding rate history API** | MUST | TODO | Historical funding rate data |
| 7.9 | **FIX protocol support** | NICE | TODO | Binance/OKX: institutional standard; very few DEXs support |
| 7.10 | **SDK (TypeScript / Python)** | NICE | TODO | Hyperliquid/dYdX: official client SDKs |
| 7.11 | **Webhook / event notification** | NICE | TODO | Push notifications for fills, liquidations |
| 7.12 | **API documentation (OpenAPI/Swagger)** | MUST | TODO | Essential for third-party integrators |
| 7.13 | **Testnet API access** | MUST | DONE | BSC Testnet (chain 97) |

---

## 8. Data, Analytics & Social

| # | Feature | Priority | Status | Notes |
|---|---------|----------|--------|-------|
| 8.1 | **Trade history (per-user)** | MUST | DONE | Redis + PostgreSQL mirror |
| 8.2 | **Order history** | MUST | DONE | |
| 8.3 | **PnL summary (daily/weekly/monthly)** | MUST | TODO | Hyperliquid: full PnL breakdown per timeframe |
| 8.4 | **Funding payment history** | MUST | TODO | Per-position funding accrual log |
| 8.5 | **Leaderboard** | NICE | PARTIAL | `HunterLeaderboard` component exists; needs perp PnL leaderboard |
| 8.6 | **Open interest chart** | NICE | TODO | Global + per-token OI visualization |
| 8.7 | **Liquidation feed (public)** | NICE | TODO | Hyperliquid: real-time liquidation event stream |
| 8.8 | **Funding rate chart** | NICE | TODO | Historical funding rate visualization |
| 8.9 | **Portfolio analytics** | NICE | TODO | Total PnL, win rate, avg trade duration, Sharpe ratio |
| 8.10 | **Copy trading** | NICE | TODO | Bybit: Classic/Pro copy trading; requires leaderboard + strategy sharing |
| 8.11 | **Position share card** | NICE | TODO | Shareable image with entry, PnL, leverage |
| 8.12 | **Whale tracker / large trade alerts** | NICE | TODO | Hyperliquid ecosystem tool |

---

## 9. On-Chain & Settlement

| # | Feature | Priority | Status | Notes |
|---|---------|----------|--------|-------|
| 9.1 | **On-chain deposit** | MUST | DONE | SettlementV2.deposit() |
| 9.2 | **On-chain withdrawal (Merkle proof)** | MUST | DONE | SettlementV2.withdraw() with EIP-712 sig |
| 9.3 | **Batch settlement** | MUST | DONE | PerpVault batch settlement every 30s |
| 9.4 | **OI tracking on-chain** | MUST | DONE | PerpVault increaseOI/decreaseOI |
| 9.5 | **Contract upgradability** | NICE | TODO | Proxy pattern for bug fixes without migration |
| 9.6 | **On-chain order verification** | NICE | TODO | dYdX v4: all orders on-chain via validators |
| 9.7 | **Multi-chain deployment** | NICE | TODO | GMX: Arbitrum + Avalanche + Botanix + MegaETH |
| 9.8 | **Cross-chain deposits** | NICE | TODO | Bridge integration for deposits from other chains |
| 9.9 | **Gas-free trading** | MUST | DONE | Off-chain matching, on-chain settlement only |
| 9.10 | **Deposit cap management** | MUST | DONE | SettlementV2 deposit caps configured |
| 9.11 | **Keeper / relayer system** | MUST | DONE | Go Keeper for liquidation + funding |

---

## 10. UX & Frontend

| # | Feature | Priority | Status | Notes |
|---|---------|----------|--------|-------|
| 10.1 | **Real-time orderbook** | MUST | DONE | WebSocket-driven |
| 10.2 | **TradingView chart integration** | MUST | DONE | Lightweight Charts |
| 10.3 | **Trade history panel** | MUST | DONE | |
| 10.4 | **Position list with PnL** | MUST | DONE | Professional position list UI |
| 10.5 | **Order panel (market/limit/stop)** | MUST | DONE | PerpetualOrderPanelV2 |
| 10.6 | **Mobile-responsive layout** | MUST | TODO | Hyperliquid/dYdX: full mobile web experience |
| 10.7 | **Native mobile app** | NICE | TODO | Bybit/Binance: iOS + Android apps |
| 10.8 | **Dark/light theme** | MUST | DONE | Theme support exists |
| 10.9 | **Multi-language (i18n)** | MUST | DONE | next-intl: zh/en/ja/ko |
| 10.10 | **Wallet connect (multi-wallet)** | MUST | DONE | wagmi integration |
| 10.11 | **One-click trading (session keys)** | MUST | DONE | Trading session / derived wallet |
| 10.12 | **Notification system (in-app)** | MUST | TODO | Fill notifications, liquidation warnings |
| 10.13 | **Order confirmation dialog** | MUST | TODO | Configurable: show/skip confirmation before submission |
| 10.14 | **Position calculator** | NICE | TODO | Simulate PnL/liq price before opening |
| 10.15 | **Keyboard shortcuts** | NICE | TODO | Pro trader feature |
| 10.16 | **Customizable layout** | NICE | TODO | Drag-and-drop panels like Binance Pro |

---

## 11. Security & Compliance

| # | Feature | Priority | Status | Notes |
|---|---------|----------|--------|-------|
| 11.1 | **EIP-712 typed data signing** | MUST | DONE | Order + withdrawal signatures |
| 11.2 | **Nonce management (replay protection)** | MUST | DONE | NonceRepo in Redis |
| 11.3 | **Rate limiting / anti-spam** | MUST | TODO | Per-IP and per-wallet throttling |
| 11.4 | **DDoS protection** | MUST | TODO | Cloudflare / WAF in production |
| 11.5 | **Audit completion** | MUST | DONE | V3 audit: 56/56 fixed |
| 11.6 | **Bug bounty program** | NICE | TODO | Incentivize white-hat disclosure |
| 11.7 | **Withdrawal whitelist** | NICE | TODO | Optional security for large withdrawals |
| 11.8 | **Withdrawal delay (time lock)** | NICE | TODO | Configurable delay for large withdrawals |
| 11.9 | **IP whitelist for API** | NICE | TODO | |
| 11.10 | **CEI pattern (Checks-Effects-Interactions)** | MUST | DONE | Enforced in all contracts |
| 11.11 | **Emergency pause** | MUST | DONE | Token pause via lifecycle module |
| 11.12 | **Monitoring / alerting** | MUST | TODO | PagerDuty/Grafana for anomaly detection |

---

## 12. Meme-Specific Features (Unique to This Platform)

| # | Feature | Priority | Status | Notes |
|---|---------|----------|--------|-------|
| 12.1 | **Bonding curve launchpad** | MUST | DONE | TokenFactory with pump.fun curve |
| 12.2 | **Auto-graduation to DEX** | MUST | DONE | 80% sold -> PancakeSwap listing |
| 12.3 | **Token lifecycle management** | MUST | DONE | Heat tiers, pause/unpause |
| 12.4 | **Coverage ratio monitoring** | MUST | DONE | LP coverage vs OI |
| 12.5 | **Per-token risk parameters** | MUST | DONE | Dynamic params per token lifecycle |
| 12.6 | **Token holder tracking** | MUST | DONE | `getTokenHolders` module |
| 12.7 | **Spot + perpetual in one platform** | MUST | DONE | TokenFactory spot + perp trading |
| 12.8 | **Lending liquidation for token holdings** | NICE | DONE | `lendingLiquidation` module |

---

## Summary: Launch-Critical Gaps

The following **MUST-have** items are currently TODO and should be prioritized for production launch:

### High Priority (blocking launch)
1. **Cross margin mode** (3.2) -- Expected by all serious perp traders
2. **Tiered maintenance margin** (3.5) -- Prevents whale manipulation, industry standard
3. **Partial liquidation** (4.15) -- Reduces unnecessary full liquidations
4. **Price band / circuit breaker** (4.9) -- Prevents oracle manipulation attacks
5. **Volume-based fee tiers** (5.2) -- Required for market maker incentives
6. **Rate limiting** (7.4, 11.3) -- Essential security for production
7. **API documentation** (7.12) -- Required for integrators and market makers
8. **Mobile-responsive layout** (10.6) -- Large portion of crypto users are mobile
9. **Monitoring / alerting** (11.12) -- Cannot operate without observability

### Medium Priority (soon after launch)
10. **Stop-limit order** (1.5) -- Very common order type
11. **Adjust leverage on position** (2.6) -- Standard feature on all CEXs
12. **Funding rate history API** (7.8) -- Needed for arb traders
13. **PnL summary analytics** (8.3) -- User retention feature
14. **Notification system** (10.12) -- Fill/liquidation alerts
15. **ADL execution path** (4.4) -- Score exists but full execution needed
16. **Max position size calculator** (3.11) -- UX improvement
17. **DDoS protection** (11.4) -- Production infrastructure
18. **Funding rate cap** (4.11) -- Prevents extreme funding spikes

---

## Platform Feature Matrix (Reference)

| Feature | Binance | OKX | Bybit | dYdX v4 | Hyperliquid | GMX v2 | gTrade | Drift | Vertex |
|---------|---------|-----|-------|---------|-------------|--------|--------|-------|--------|
| Order types | 11+ | 10+ | 8+ | 4 | 6+ | 2 | 3 | 5+ | 4+ |
| Max leverage | 125x | 100x | 125x | 50x | 40x | 100x | 150x | 20x | 20x |
| Cross margin | Y | Y | Y | Y | Y | N/A | N/A | Y | Y |
| Portfolio margin | Y | Y | Y | N | Y | N | N | N | Y |
| Sub-accounts | Y | Y | Y | Y | Y | N | N | N | Y |
| ADL | Y | Y | Y | Y | Y | N | N | Y | Y |
| Insurance fund | Y | Y | Y | Y | Y (HLP) | Y (LP) | Y (gDAI) | Y | Y |
| Copy trading | Y | Y | Y | N | N | N | N | N | N |
| Maker fee | 0.02% | 0.02% | 0.02% | 0.02% | 0.01% | N/A | 0.06% | 0.01% | 0.02% |
| Taker fee | 0.05% | 0.05% | 0.055% | 0.05% | 0.035% | 0.05-0.07% | 0.08% | 0.1% | 0.04% |
| Funding interval | 8h | 8h | 8h | 1h | 1h (8h rate) | Continuous | 1h | 1h | 1h |
| API: REST | Y | Y | Y | Y | Y | Y | Y | Y | Y |
| API: WebSocket | Y | Y | Y | Y | Y | N | N | Y | Y |
| API: FIX | Y | Y | Y | N | N | N | N | N | N |
| Leaderboard | Y | Y | Y | Y | Y | N | N | Y | N |
| Mobile app | Y | Y | Y | Y (web) | Y (web) | Y (web) | Y (web) | Y (web) | Y (web) |
| Markets | 300+ | 200+ | 400+ | 200+ | 200+ | 30+ | 150+ | 40+ | 30+ |

---

## Sources

- [Binance Futures Order Types](https://www.binance.com/en/support/faq/types-of-order-on-binance-futures-360033779452)
- [Binance Academy: Perpetual Futures](https://academy.binance.com/en/articles/what-are-perpetual-futures-contracts)
- [OKX Unified Account](https://www.okx.com/en-us/learn/what-is-a-unified-account)
- [OKX Portfolio Margin](https://www.okx.com/en-us/help/portfolio-margin-mode-cross-margin-trading-risk-unit-merge)
- [Bybit Copy Trading Guide](https://www.bitdegree.org/crypto/tutorials/bybit-copy-trading)
- [Bybit Futures Fee Structure](https://www.bybit.com/en/help-center/article/Perpetual-Futures-Contract-Fees-Explained)
- [dYdX v4 Review 2026](https://coinbureau.com/review/dydx)
- [dYdX Help Center](https://help.dydx.trade/en/articles/166976-introduction-and-overview)
- [Hyperliquid Docs](https://hyperliquid.gitbook.io/hyperliquid-docs)
- [Hyperliquid Fees](https://hyperliquid.gitbook.io/hyperliquid-docs/trading/fees)
- [Hyperliquid Margining](https://hyperliquid.gitbook.io/hyperliquid-docs/trading/margining)
- [Hyperliquid WebSocket API](https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/websocket)
- [GMX v2 Docs](https://docs.gmx.io/docs/intro/)
- [GMX v2 Liquidity](https://docs.gmx.io/docs/providing-liquidity/v2/)
- [GMX Review 2026](https://cryptoadventure.com/gmx-review-2026-perpetuals-gm-pools-multichain-trading-and-real-ways-users-try-to-earn/)
- [Gains Network gTrade Docs](https://docs.gains.trade/gtrade-leveraged-trading/overview)
- [Drift Protocol Docs](https://docs.drift.trade/)
- [Drift AMM](https://docs.drift.trade/protocol/about-v3/drift-amm)
- [Vertex Protocol Docs](https://docs.vertexprotocol.com/basics/technical-architecture)
- [Vertex Hybrid Orderbook AMM](https://vertex-protocol.gitbook.io/docs/basics/hybrid-orderbook-amm-design)
- [DEX Fee Comparison 2026](https://coinspot.io/en/analysis/dydx-gmx-hyperliquid-and-vertex-protocol-compared-a-trader-focused-rundown-for-picking-your-dex/)
- [Hyperliquid vs dYdX 2026](https://www.buildix.trade/blog/hyperliquid-vs-dydx-best-perp-dex-comparison-2026)
- [ADL Mechanism Explained](https://www.cube.exchange/what-is/auto-deleveraging-adl)
- [Bybit ADL Mechanism](https://www.bybit.com/en/help-center/article/Auto-Deleveraging-ADL)
- [Perp Architecture Endgame](https://cyber.fund/content/perps)
- [Hyperliquid Leaderboard](https://app.hyperliquid.xyz/leaderboard)
- [Best Hyperliquid Tools 2026](https://www.buildix.trade/blog/best-hyperliquid-tools-2026-complete-guide)
