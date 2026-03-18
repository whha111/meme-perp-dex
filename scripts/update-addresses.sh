#!/bin/bash
# ═══════════════════════════════════════════════════════════════
# update-addresses.sh — One-click contract address updater
#
# After deploying new contracts, run this script to update ALL
# config files across the entire project.
#
# Usage: ./scripts/update-addresses.sh
# ═══════════════════════════════════════════════════════════════

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"

# ── New Contract Addresses (from latest deployment) ──
PRICE_FEED="0x5c727Ea9AC9be9036e538064e7Db245cC09545Fd"
VAULT="0xf00A94A1ae8A276C3AeD24F5B542f4ec5E1F373C"
CONTRACT_REGISTRY="0x4Bd177026918c774FEaAd56AA6cE3D69E0D67021"
TOKEN_FACTORY="0xD75BE83c73fb331Cc566E3d58563f74058E4cA0b"
POSITION_MANAGER="0x5176a9F4093DEdE515C3a524F218cB4324500D22"
SETTLEMENT_V1="0xe866e042Dc6Ec594c7534974cff0F9eaEEbC2a1a"
SETTLEMENT_V2="0xAc85c7ED31fA521Bfdb7AE63D6e9385E4aF79F1b"
PERP_VAULT="0xEafa2faD2bb336dA8Cd8309669B0C16f597DeCdb"
RISK_MANAGER="0x6338608189d8153608d1D014E928490a33cfabF4"
FUNDING_RATE="0x05a2bb4ad567F2B078a7028d4ca47998Fb7F88D6"
LIQUIDATION="0x6c9A628219501C3271eA5b95b5aAb8d1B593383e"
INSURANCE_FUND="0x6140B2F99A95b4E056D0bc6360c17232f1A8ab91"

# Constants (not redeployed)
WBNB="0xae13d989daC2f0dEbFf460aC112a837C89BAa7cd"
PANCAKE_ROUTER="0xD99D1c33F9fC3444f8101754aBC46c52416550D1"
DEPLOYER="0xAecb229194314999E396468eb091b42E44Bc3c8c"

echo "═══════════════════════════════════════════"
echo "  Contract Address Updater"
echo "═══════════════════════════════════════════"

updated=0

update_file() {
  local file="$1"
  local key="$2"
  local val="$3"

  if [ ! -f "$file" ]; then
    return
  fi

  # For .env files: KEY=value
  if [[ "$file" == *.env* ]]; then
    if grep -q "^${key}=" "$file" 2>/dev/null; then
      sed -i '' "s|^${key}=.*|${key}=${val}|" "$file"
    fi
  fi

  # For .yaml files: key: value
  if [[ "$file" == *.yaml ]]; then
    if grep -q "${key}:" "$file" 2>/dev/null; then
      sed -i '' "s|${key}:.*|${key}: \"${val}\"|" "$file"
    fi
  fi
}

# ── 1. Root .env ──
echo "  [1/8] Root .env"
for f in "$ROOT/.env"; do
  update_file "$f" "TOKEN_FACTORY_ADDRESS" "$TOKEN_FACTORY"
  update_file "$f" "SETTLEMENT_ADDRESS" "$SETTLEMENT_V1"
  update_file "$f" "SETTLEMENT_V2_ADDRESS" "$SETTLEMENT_V2"
  update_file "$f" "VAULT_ADDRESS" "$VAULT"
  update_file "$f" "PRICE_FEED_ADDRESS" "$PRICE_FEED"
  update_file "$f" "POSITION_MANAGER_ADDRESS" "$POSITION_MANAGER"
  update_file "$f" "RISK_MANAGER_ADDRESS" "$RISK_MANAGER"
  update_file "$f" "INSURANCE_FUND_ADDRESS" "$INSURANCE_FUND"
  update_file "$f" "CONTRACT_REGISTRY_ADDRESS" "$CONTRACT_REGISTRY"
  update_file "$f" "FUNDING_RATE_ADDRESS" "$FUNDING_RATE"
  update_file "$f" "LIQUIDATION_ADDRESS" "$LIQUIDATION"
  update_file "$f" "PERP_VAULT_ADDRESS" "$PERP_VAULT"
  update_file "$f" "ROUTER_ADDRESS" "$PANCAKE_ROUTER"
done
((updated++))

# ── 2. Frontend .env.local ──
echo "  [2/8] Frontend .env.local"
for f in "$ROOT/frontend/.env.local"; do
  update_file "$f" "NEXT_PUBLIC_TOKEN_FACTORY_ADDRESS" "$TOKEN_FACTORY"
  update_file "$f" "NEXT_PUBLIC_SETTLEMENT_ADDRESS" "$SETTLEMENT_V1"
  update_file "$f" "NEXT_PUBLIC_SETTLEMENT_V2_ADDRESS" "$SETTLEMENT_V2"
  update_file "$f" "NEXT_PUBLIC_VAULT_ADDRESS" "$VAULT"
  update_file "$f" "NEXT_PUBLIC_PRICE_FEED_ADDRESS" "$PRICE_FEED"
  update_file "$f" "NEXT_PUBLIC_POSITION_MANAGER_ADDRESS" "$POSITION_MANAGER"
  update_file "$f" "NEXT_PUBLIC_RISK_MANAGER_ADDRESS" "$RISK_MANAGER"
  update_file "$f" "NEXT_PUBLIC_INSURANCE_FUND_ADDRESS" "$INSURANCE_FUND"
  update_file "$f" "NEXT_PUBLIC_CONTRACT_REGISTRY_ADDRESS" "$CONTRACT_REGISTRY"
  update_file "$f" "NEXT_PUBLIC_FUNDING_RATE_ADDRESS" "$FUNDING_RATE"
  update_file "$f" "NEXT_PUBLIC_LIQUIDATION_ADDRESS" "$LIQUIDATION"
  update_file "$f" "NEXT_PUBLIC_PERP_VAULT_ADDRESS" "$PERP_VAULT"
  update_file "$f" "NEXT_PUBLIC_ROUTER_ADDRESS" "$PANCAKE_ROUTER"
done
((updated++))

# ── 3. Backend .env ──
echo "  [3/8] Backend .env"
for f in "$ROOT/backend/.env"; do
  update_file "$f" "TOKEN_FACTORY_ADDRESS" "$TOKEN_FACTORY"
  update_file "$f" "SETTLEMENT_ADDRESS" "$SETTLEMENT_V1"
  update_file "$f" "SETTLEMENT_V2_ADDRESS" "$SETTLEMENT_V2"
  update_file "$f" "VAULT_ADDRESS" "$VAULT"
  update_file "$f" "PRICE_FEED_ADDRESS" "$PRICE_FEED"
  update_file "$f" "POSITION_MANAGER_ADDRESS" "$POSITION_MANAGER"
  update_file "$f" "RISK_MANAGER_ADDRESS" "$RISK_MANAGER"
  update_file "$f" "INSURANCE_FUND_ADDRESS" "$INSURANCE_FUND"
  update_file "$f" "CONTRACT_REGISTRY_ADDRESS" "$CONTRACT_REGISTRY"
  update_file "$f" "FUNDING_RATE_ADDRESS" "$FUNDING_RATE"
  update_file "$f" "LIQUIDATION_ADDRESS" "$LIQUIDATION"
  update_file "$f" "PERP_VAULT_ADDRESS" "$PERP_VAULT"
done
((updated++))

# ── 4. Matching engine .env ──
echo "  [4/8] Matching engine .env"
for f in "$ROOT/backend/src/matching/.env"; do
  update_file "$f" "TOKEN_FACTORY_ADDRESS" "$TOKEN_FACTORY"
  update_file "$f" "SETTLEMENT_ADDRESS" "$SETTLEMENT_V1"
  update_file "$f" "SETTLEMENT_V2_ADDRESS" "$SETTLEMENT_V2"
  update_file "$f" "VAULT_ADDRESS" "$VAULT"
  update_file "$f" "PRICE_FEED_ADDRESS" "$PRICE_FEED"
  update_file "$f" "POSITION_MANAGER_ADDRESS" "$POSITION_MANAGER"
  update_file "$f" "RISK_MANAGER_ADDRESS" "$RISK_MANAGER"
  update_file "$f" "INSURANCE_FUND_ADDRESS" "$INSURANCE_FUND"
  update_file "$f" "CONTRACT_REGISTRY_ADDRESS" "$CONTRACT_REGISTRY"
  update_file "$f" "FUNDING_RATE_ADDRESS" "$FUNDING_RATE"
  update_file "$f" "LIQUIDATION_ADDRESS" "$LIQUIDATION"
  update_file "$f" "PERP_VAULT_ADDRESS" "$PERP_VAULT"
done
((updated++))

# ── 5. Backend config.yaml ──
echo "  [5/8] Backend config.yaml files"
for f in "$ROOT/backend/configs/config.yaml" "$ROOT/backend/configs/config.local.yaml"; do
  update_file "$f" "  token_factory_address" "$TOKEN_FACTORY"
  update_file "$f" "  settlement_address" "$SETTLEMENT_V1"
  update_file "$f" "  settlement_v2_address" "$SETTLEMENT_V2"
  update_file "$f" "  vault_address" "$VAULT"
  update_file "$f" "  price_feed_address" "$PRICE_FEED"
  update_file "$f" "  position_address" "$POSITION_MANAGER"
  update_file "$f" "  risk_manager_address" "$RISK_MANAGER"
  update_file "$f" "  insurance_fund_address" "$INSURANCE_FUND"
  update_file "$f" "  contract_registry_address" "$CONTRACT_REGISTRY"
  update_file "$f" "  funding_rate_address" "$FUNDING_RATE"
  update_file "$f" "  liquidation_address" "$LIQUIDATION"
  update_file "$f" "  perp_vault_address" "$PERP_VAULT"
  update_file "$f" "  router_address" "$PANCAKE_ROUTER"
done
((updated++))

# ── 6. Deployment JSON (97.json) ──
echo "  [6/8] Deployment JSON"
cat > "$ROOT/deployments/97.json" << DEPLOYEOF
{
  "chainId": 97,
  "chainName": "BSC Testnet",
  "deployedAt": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "deployer": "$DEPLOYER",
  "contracts": {
    "TokenFactory": "$TOKEN_FACTORY",
    "Settlement": "$SETTLEMENT_V1",
    "SettlementV2": "$SETTLEMENT_V2",
    "PriceFeed": "$PRICE_FEED",
    "PositionManager": "$POSITION_MANAGER",
    "Vault": "$VAULT",
    "PerpVault": "$PERP_VAULT",
    "RiskManager": "$RISK_MANAGER",
    "FundingRate": "$FUNDING_RATE",
    "Liquidation": "$LIQUIDATION",
    "InsuranceFund": "$INSURANCE_FUND",
    "ContractRegistry": "$CONTRACT_REGISTRY",
    "WBNB": "$WBNB",
    "PancakeRouterV2": "$PANCAKE_ROUTER"
  }
}
DEPLOYEOF
((updated++))

# ── 7. Frontend deployment JSON ──
echo "  [7/8] Frontend deployment JSON"
cat > "$ROOT/frontend/contracts/deployments/base-sepolia.json" << DEPLOYEOF
{
  "chainId": 97,
  "chainName": "BSC Testnet",
  "deployedAt": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "deployer": "$DEPLOYER",
  "contracts": {
    "TokenFactory": "$TOKEN_FACTORY",
    "Settlement": "$SETTLEMENT_V1",
    "SettlementV2": "$SETTLEMENT_V2",
    "PriceFeed": "$PRICE_FEED",
    "PositionManager": "$POSITION_MANAGER",
    "Vault": "$VAULT",
    "PerpVault": "$PERP_VAULT",
    "RiskManager": "$RISK_MANAGER",
    "FundingRate": "$FUNDING_RATE",
    "Liquidation": "$LIQUIDATION",
    "InsuranceFund": "$INSURANCE_FUND",
    "ContractRegistry": "$CONTRACT_REGISTRY",
    "WBNB": "$WBNB",
    "PancakeRouterV2": "$PANCAKE_ROUTER"
  }
}
DEPLOYEOF
((updated++))

# ── 8. Testnet env ──
echo "  [8/8] Testnet .env"
for f in "$ROOT/testnet/.env.testnet"; do
  update_file "$f" "TOKEN_FACTORY_ADDRESS" "$TOKEN_FACTORY"
  update_file "$f" "SETTLEMENT_ADDRESS" "$SETTLEMENT_V1"
  update_file "$f" "SETTLEMENT_V2_ADDRESS" "$SETTLEMENT_V2"
  update_file "$f" "VAULT_ADDRESS" "$VAULT"
  update_file "$f" "PRICE_FEED_ADDRESS" "$PRICE_FEED"
  update_file "$f" "POSITION_MANAGER_ADDRESS" "$POSITION_MANAGER"
  update_file "$f" "RISK_MANAGER_ADDRESS" "$RISK_MANAGER"
  update_file "$f" "INSURANCE_FUND_ADDRESS" "$INSURANCE_FUND"
  update_file "$f" "CONTRACT_REGISTRY_ADDRESS" "$CONTRACT_REGISTRY"
  update_file "$f" "FUNDING_RATE_ADDRESS" "$FUNDING_RATE"
  update_file "$f" "LIQUIDATION_ADDRESS" "$LIQUIDATION"
  update_file "$f" "PERP_VAULT_ADDRESS" "$PERP_VAULT"
done
((updated++))

echo "═══════════════════════════════════════════"
echo "  ✅ $updated config groups updated!"
echo "═══════════════════════════════════════════"
echo ""
echo "New addresses:"
echo "  TokenFactory:    $TOKEN_FACTORY"
echo "  SettlementV2:    $SETTLEMENT_V2"
echo "  PerpVault:       $PERP_VAULT"
echo "  PriceFeed:       $PRICE_FEED"
echo "  Liquidation:     $LIQUIDATION"
echo ""
echo "Next: clear databases and restart services"
