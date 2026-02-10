# Contract Deployment - 2026-01-29

## Network: Base Sepolia (Chain ID: 84532)

## Deployed Contract Addresses

| Contract | Address |
|----------|---------|
| MemeToken | `0x13Bb1Ff472FBd7831b676d5b4040CC2aEAFc12cd` |
| LPToken (Lending) | `0xC7862c5F3F4610c468bB6Bbcd042c3626C79824e` |
| LPToken (AMM) | `0x64Fdadc4E146887e5424FB2dcb701355BD4B1161` |
| Vault | `0x2f96e061aD7149268E2Ada5752f95Bc7c665385d` |
| PriceFeed | `0xf6CE7410c07711ABc2bD700A98a5f49f30599B61` |
| AMM | `0x367d739478c2F8cE4e7247F92E9E95d692286d9c` |
| LendingPool | `0x9344f8DebC826CDABD1BF59e0E60f45e6Acb2535` |
| RiskManager | `0x34E25e0123eD364B20C514C4c12729db929f4516` |
| ContractSpec | `0x79065E5A3f84Ac661Fa0c3247E4FDAeD7BC24762` |
| PositionManager | `0x0412B92f488140B9FCce55B1B100aCd8007dD88f` |
| FundingRate | `0x0306557d7F057040eAAF63Dc6cA8072Cb9920336` |
| Liquidation | `0x2Ebb4960A770F9469B9a478C26aA9DE05E6a6b99` |
| Router | `0xc4766bD3a0dD2Cec21035348aFEA55D436a41e70` |
| TokenFactory | `0x4a9aa9CBE6011923267c090817AEEF98B3Ab3ce3` |

## Configuration Applied

1. **PriceFeed <-> TokenFactory**: Bidirectional configuration
   - `priceFeed.setTokenFactory(tokenFactory)`
   - `tokenFactory.setPriceFeed(priceFeed)`

2. **Vault Authorizations**:
   - PositionManager
   - Liquidation
   - FundingRate

3. **LP Token Minters**:
   - LendingPool for LP Token (Lending)
   - AMM for LP Token (AMM)

## Environment Files Updated

- `/contracts/.env` - No changes needed (uses RPC and private key)
- `/frontend/.env.local` - All contract addresses updated
- `/backend/src/matching/.env` - All perpetual contract addresses added
- `/backend/src/matching/config.ts` - Fallback addresses updated

## Code Files Updated

- `/frontend/src/lib/contracts.ts` - CONTRACTS object updated
- `/frontend/src/hooks/useOnChainTrades.ts` - TokenFactory address updated
- `/frontend/src/components/trading/PerpetualOrderPanel.tsx` - Address constants updated
- `/backend/src/matching/server.ts` - Address constants updated
- `/backend/src/matching/server.new.ts` - Address constants updated
- `/backend/src/matching/engine.ts` - Legacy compatibility method updated

## Deployer

- Address: `0x5AF11d4784c3739cf2FD51Fdc272ae4957ADf7fE`
- Gas Used: ~39.7M gas
- Cost: ~0.000056 ETH

## Transaction Details

Saved to: `/contracts/broadcast/Deploy.s.sol/84532/run-latest.json`
