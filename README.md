# MEME Perp DEX

> Decentralized Perpetual Futures & Spot Trading Platform for Meme Tokens

[![Solidity](https://img.shields.io/badge/Solidity-0.8.20-blue)](https://soliditylang.org/)
[![Next.js](https://img.shields.io/badge/Next.js-14-black)](https://nextjs.org/)
[![Base](https://img.shields.io/badge/Chain-Base%20Sepolia-0052FF)](https://base.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)

---

## Overview

MEME Perp DEX is a full-stack decentralized exchange that combines:

- **Meme Token Launchpad** — Create and trade meme tokens via bonding curve (TokenFactory)
- **Perpetual Futures (V2)** — Up to 100x leverage with P2P order matching and EIP-712 signed orders
- **Multi-Token Lending** — Deposit tokens to earn yield, powering the perpetual system
- **Spot AMM Trading** — Automated market making with real-time price feeds

### Architecture: V2 Settlement (P2P Model)

```
User places order → Signs EIP-712 typed data (gasless)
                          ↓
              Off-chain Matching Engine pairs long/short
                          ↓
              Batch submission to on-chain Settlement contract
                          ↓
              Signature verification + collateral escrow
                          ↓
              PnL transfers directly between counterparties
              (Insurance fund only used for bankruptcy)
```

> Inspired by dYdX v3's signature-derived trading wallet pattern and GMX's PnL calculation model.

---

## Project Structure

```
meme-perp-dex/
├── contracts/                 # Solidity smart contracts (Foundry)
│   ├── src/
│   │   ├── common/            # Shared: PriceFeed, Vault, ContractRegistry
│   │   ├── perpetual/         # V2: Settlement, PerpVault, Liquidation
│   │   └── spot/              # TokenFactory, LendingPool
│   ├── test/                  # Foundry tests
│   └── script/                # Deployment scripts
│
├── frontend/                  # Next.js 14 frontend
│   ├── src/
│   │   ├── app/               # Pages: trade, lend, earnings
│   │   ├── components/        # UI: common, spot, perpetual, lending
│   │   ├── hooks/             # React hooks: common, spot, perpetual, lending
│   │   ├── lib/               # Contracts config, stores, utilities
│   │   └── config/            # API endpoints
│   └── messages/              # i18n: en, zh, ja, ko
│
├── backend/
│   ├── src/matching/          # TypeScript matching engine (Bun)
│   ├── src/spot/              # Spot trading backend
│   └── internal/keeper/       # Go keeper: liquidation, funding
│
├── docs/                      # 23+ documentation files
├── DEVELOPMENT_RULES.md       # Development standards & audit fixes
├── PERPVAULT_AUDIT_REPORT.md  # Security audit report
└── CLAUDE.md                  # AI assistant instructions
```

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| **Smart Contracts** | Solidity 0.8.20, Foundry, OpenZeppelin |
| **Frontend** | Next.js 14, TypeScript, Wagmi v2, Viem, TailwindCSS |
| **State Management** | TanStack Query, Zustand |
| **Matching Engine** | TypeScript + Bun runtime, WebSocket |
| **Backend Services** | Go 1.22+, Gin, GORM |
| **Database** | PostgreSQL + TimescaleDB, Redis |
| **Chain** | Base / Base Sepolia |
| **Charts** | TradingView Lightweight Charts |
| **i18n** | next-intl (EN, ZH, JA, KO) |

---

## Smart Contracts

### Core Contracts (V2 - Active)

| Contract | Description |
|----------|-------------|
| `Settlement.sol` | P2P perpetual settlement with EIP-712 signature verification |
| `PerpVault.sol` | Perpetual collateral vault (WETH-based) |
| `TokenFactory.sol` | Meme token launchpad with bonding curve |
| `LendingPool.sol` | Multi-token lending pool with interest accrual |
| `PriceFeed.sol` | Oracle price feed for all supported tokens |
| `Vault.sol` | Shared asset vault |

### Key Design Decisions

- **PnL Calculation**: GMX standard — `delta = size * |currentPrice - avgPrice| / avgPrice`
- **Liquidation Price**: Bybit standard — `liqPrice = entryPrice * (1 - 1/leverage + MMR)`
- **Funding Rate**: 8-hour settlement intervals with configurable base rate
- **Share Inflation Protection**: Virtual offset pattern (OpenZeppelin ERC4626) in LendingPool
- **Slippage Protection**: Mandatory `minAmountOut` on all swap/trade functions

---

## Features

### Meme Token Launchpad
- One-click token creation with metadata URI
- Bonding curve pricing (buy/sell along curve)
- Automatic graduation to DEX when threshold reached

### Perpetual Futures (V2)
- Up to 100x leverage
- EIP-712 signed orders (gasless order placement)
- Off-chain matching engine with on-chain settlement
- Signature-derived trading wallets (dYdX v3 pattern)
- Funding rate settlement every 8 hours
- Auto-Deleveraging (ADL) when insurance fund depleted
- Real-time WebSocket price/orderbook/trade feeds

### Lending
- Multi-token lending pools
- Supply tokens to earn interest
- Dynamic interest rate model (utilization-based)
- Claim accrued interest anytime

### Spot Trading
- AMM-based token swaps
- Real-time price charts
- Slippage protection with minimum output amounts

---

## Quick Start

### Prerequisites

- Node.js 18+ & pnpm
- Foundry (`curl -L https://foundry.paradigm.xyz | bash`)
- Go 1.22+ (for keeper services)
- Bun runtime (for matching engine)

### Install

```bash
# Clone
git clone https://github.com/whha111/meme-perp-dex.git
cd meme-perp-dex

# Contracts
cd contracts && forge install && forge build

# Frontend
cd frontend && pnpm install

# Matching Engine
cd backend/src/matching && bun install
```

### Development

```bash
# Start frontend dev server
cd frontend && pnpm dev

# Start matching engine
cd backend/src/matching && bun run server.ts

# Run contract tests
cd contracts && forge test -vvv
```

### Deploy Contracts

```bash
cd contracts

# Deploy TokenFactory
forge script script/DeployTokenFactory.s.sol --rpc-url $RPC_URL --broadcast

# Deploy Settlement (V2)
forge script script/DeploySettlement.s.sol --rpc-url $RPC_URL --broadcast

# Deploy LendingPool
forge script script/DeployLendingPool.s.sol --rpc-url $RPC_URL --broadcast
```

---

## Security

### Completed Audit Fixes (V2)

| ID | Severity | Issue | Status |
|----|----------|-------|--------|
| C-01 | Critical | Settlement funding fee double-charging | Fixed |
| C-03 | Critical | LendingPool share inflation attack | Fixed |
| C-04 | Critical | parseFloat precision loss (>9007 ETH) | Fixed |
| C-05 | Critical | Zero slippage protection on swaps | Fixed |
| C-06 | Critical | Private key exposed in React state | Fixed |
| H-08 | High | closePair missing signature verification | Fixed |
| H-10 | High | HTTP plaintext signature transmission | Fixed |
| H-11 | High | Floating-point slippage calculation | Fixed |
| H-09 | High | Redundant WebSocket connections | Mitigated |

See [DEVELOPMENT_RULES.md](DEVELOPMENT_RULES.md) for full details and [PERPVAULT_AUDIT_REPORT.md](PERPVAULT_AUDIT_REPORT.md) for the complete audit report.

---

## Documentation

| Document | Description |
|----------|-------------|
| [DEVELOPMENT_RULES.md](DEVELOPMENT_RULES.md) | Development standards, formulas, and audit fix log |
| [PERPVAULT_AUDIT_REPORT.md](PERPVAULT_AUDIT_REPORT.md) | Production security audit report |
| [docs/SYSTEM_ARCHITECTURE.md](docs/SYSTEM_ARCHITECTURE.md) | System architecture overview |
| [docs/SETTLEMENT_DESIGN.md](docs/SETTLEMENT_DESIGN.md) | V2 Settlement P2P design |
| [docs/CONTRACTS.md](docs/CONTRACTS.md) | Smart contract interfaces |
| [docs/API_SPECIFICATION_V2.md](docs/API_SPECIFICATION_V2.md) | V2 API specification |
| [docs/PRD.md](docs/PRD.md) | Product requirements document |
| [docs/ROADMAP.md](docs/ROADMAP.md) | Development roadmap |
| [docs/PERP_MECHANISM.md](docs/PERP_MECHANISM.md) | Perpetual mechanism deep dive |

---

## Environment Variables

```bash
# Frontend (.env.local)
NEXT_PUBLIC_MATCHING_ENGINE_WS_URL=wss://your-ws-endpoint
NEXT_PUBLIC_MATCHING_ENGINE_URL=https://your-api-endpoint
NEXT_PUBLIC_WALLET_CONNECT_PROJECT_ID=your-wc-project-id

# Contracts (.env)
PRIVATE_KEY=your-deployer-private-key
RPC_URL=https://your-rpc-url
ETHERSCAN_API_KEY=your-etherscan-key
```

> **Warning**: Never commit `.env` files. See `.gitignore` for excluded patterns.

---

## License

MIT License - See [LICENSE](LICENSE) for details.
