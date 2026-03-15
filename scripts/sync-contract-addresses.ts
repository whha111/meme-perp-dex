#!/usr/bin/env bun
/**
 * Contract Address Sync Script — Single Source of Truth
 * =====================================================
 *
 * Reads from deployments/<chainId>.json and syncs to all config files.
 *
 * Usage:
 *   bun scripts/sync-contract-addresses.ts --chain 97          # dry-run
 *   bun scripts/sync-contract-addresses.ts --chain 97 --apply  # write changes
 *
 * After deploying new contracts:
 *   1. Update deployments/<chainId>.json
 *   2. Run this script with --apply
 *   3. Run scripts/validate-deployment.ts to verify
 */

import { readFileSync, writeFileSync, existsSync } from "fs";
import { resolve, join } from "path";

// ============================================================
// CLI args
// ============================================================

const args = process.argv.slice(2);
const dryRun = !args.includes("--apply");
const chainIdArg = args.find((_, i, a) => a[i - 1] === "--chain");

if (!chainIdArg) {
  console.error("Usage: bun scripts/sync-contract-addresses.ts --chain <chainId> [--apply]");
  console.error("Example: bun scripts/sync-contract-addresses.ts --chain 97 --apply");
  process.exit(1);
}

const chainId = parseInt(chainIdArg);
const ROOT = resolve(import.meta.dir, "..");
const deploymentPath = join(ROOT, "deployments", `${chainId}.json`);

if (!existsSync(deploymentPath)) {
  console.error(`Deployment file not found: ${deploymentPath}`);
  console.error(`Create it first, or use --from-broadcast to generate from Foundry output.`);
  process.exit(1);
}

// ============================================================
// Load deployment data
// ============================================================

interface DeploymentContract {
  address: string;
}

interface Deployment {
  network: string;
  chainId: number;
  rpcUrl: string;
  wssUrl: string;
  explorer: string;
  deployedAt: string;
  deployer: string;
  contracts: Record<string, DeploymentContract>;
  external: Record<string, string>;
}

const deployment: Deployment = JSON.parse(readFileSync(deploymentPath, "utf-8"));

// Helper: get address by contract name
function addr(name: string): string {
  const contract = deployment.contracts[name];
  if (contract) return contract.address;
  const ext = deployment.external[name];
  if (ext) return ext;
  throw new Error(`Address not found for "${name}" in ${deploymentPath}`);
}

// ============================================================
// File update utilities
// ============================================================

let totalChanges = 0;

function updateEnvFile(relPath: string, mapping: Record<string, string>) {
  const absPath = resolve(ROOT, relPath);
  if (!existsSync(absPath)) {
    console.log(`  SKIP (not found): ${relPath}`);
    return;
  }

  let content = readFileSync(absPath, "utf-8");
  let fileChanges = 0;

  for (const [key, value] of Object.entries(mapping)) {
    const regex = new RegExp(`^(${key}=)(.*)$`, "m");
    const match = content.match(regex);
    if (match && match[2] !== value) {
      console.log(`  ${key}: ${match[2]} -> ${value}`);
      content = content.replace(regex, `$1${value}`);
      fileChanges++;
      totalChanges++;
    }
  }

  if (fileChanges > 0 && !dryRun) {
    writeFileSync(absPath, content);
    console.log(`  [WRITTEN] ${relPath} (${fileChanges} changes)`);
  } else if (fileChanges === 0) {
    console.log(`  OK ${relPath}`);
  } else {
    console.log(`  [DRY] ${relPath} (${fileChanges} would change)`);
  }
}

function updateYamlDefaults(relPath: string, mapping: Record<string, string>) {
  const absPath = resolve(ROOT, relPath);
  if (!existsSync(absPath)) {
    console.log(`  SKIP (not found): ${relPath}`);
    return;
  }

  let content = readFileSync(absPath, "utf-8");
  let fileChanges = 0;

  for (const [yamlKey, newDefault] of Object.entries(mapping)) {
    // Word-boundary-safe regex: match "  key: "${ENV:-default}"" pattern
    // Uses lookbehind for start-of-line or whitespace to avoid partial matches
    // e.g. vault_address must NOT match inside perp_vault_address
    const escapedKey = yamlKey.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const regex = new RegExp(
      `((?:^|\\n)(\\s*)${escapedKey}:\\s*"\\$\\{[^:]+:-)([^"]+)(\\}")`,
      "g"
    );
    content = content.replace(regex, (match, prefix, _indent, oldDefault, suffix) => {
      if (oldDefault !== newDefault) {
        console.log(`  ${yamlKey}: ${oldDefault} -> ${newDefault}`);
        fileChanges++;
        totalChanges++;
        return `${prefix}${newDefault}${suffix}`;
      }
      return match;
    });
  }

  if (fileChanges > 0 && !dryRun) {
    writeFileSync(absPath, content);
    console.log(`  [WRITTEN] ${relPath} (${fileChanges} changes)`);
  } else if (fileChanges === 0) {
    console.log(`  OK ${relPath}`);
  } else {
    console.log(`  [DRY] ${relPath} (${fileChanges} would change)`);
  }
}

function updateJsonFile(relPath: string) {
  const absPath = resolve(ROOT, relPath);
  // Generate the legacy deployment JSON format
  const legacyData = {
    network: deployment.network,
    chainId: deployment.chainId,
    deployedAt: deployment.deployedAt,
    contracts: Object.fromEntries(
      Object.entries(deployment.contracts).map(([name, data]) => [
        name,
        { address: data.address, deployer: deployment.deployer },
      ])
    ),
    explorer: `${deployment.explorer}/address/${addr("TokenFactory")}`,
  };

  const newContent = JSON.stringify(legacyData, null, 2) + "\n";

  if (existsSync(absPath)) {
    const oldContent = readFileSync(absPath, "utf-8");
    if (oldContent === newContent) {
      console.log(`  OK ${relPath}`);
      return;
    }
  }

  totalChanges++;
  if (!dryRun) {
    writeFileSync(absPath, newContent);
    console.log(`  [WRITTEN] ${relPath}`);
  } else {
    console.log(`  [DRY] ${relPath} (would update)`);
  }
}

// ============================================================
// Main — sync all targets
// ============================================================

console.log(`\nContract Address Sync ${dryRun ? "(DRY RUN)" : "(APPLYING)"}\n`);
console.log(`Source: deployments/${chainId}.json`);
console.log(`Network: ${deployment.network} (chain ${deployment.chainId})`);
console.log(`Deployed: ${deployment.deployedAt}\n`);

// 1. backend/.env (matching engine)
console.log("-- backend/.env --");
updateEnvFile("backend/.env", {
  CHAIN_ID: String(deployment.chainId),
  RPC_URL: deployment.rpcUrl,
  SETTLEMENT_ADDRESS: addr("Settlement"),
  SETTLEMENT_V2_ADDRESS: addr("SettlementV2"),
  TOKEN_FACTORY_ADDRESS: addr("TokenFactory"),
  PRICE_FEED_ADDRESS: addr("PriceFeed"),
  LIQUIDATION_ADDRESS: addr("Liquidation"),
  VAULT_ADDRESS: addr("Vault"),
  POSITION_MANAGER_ADDRESS: addr("PositionManager"),
  INSURANCE_FUND_ADDRESS: addr("InsuranceFund"),
  PERP_VAULT_ADDRESS: addr("PerpVault"),
  COLLATERAL_TOKEN_ADDRESS: addr("WBNB"),
  FUNDING_RATE_ADDRESS: addr("FundingRate"),
  LENDING_POOL_ADDRESS: addr("LendingPool"),
  FEE_RECEIVER_ADDRESS: deployment.deployer,
  WETH_ADDRESS: addr("WBNB"),
  PANCAKESWAP_FACTORY_ADDRESS: addr("PancakeSwapFactoryV2"),
});

// 2. frontend/.env.local
console.log("\n-- frontend/.env.local --");
updateEnvFile("frontend/.env.local", {
  NEXT_PUBLIC_CHAIN_ID: String(deployment.chainId),
  NEXT_PUBLIC_RPC_URL: deployment.rpcUrl,
  NEXT_PUBLIC_BLOCK_EXPLORER_URL: deployment.explorer,
  NEXT_PUBLIC_TOKEN_FACTORY_ADDRESS: addr("TokenFactory"),
  NEXT_PUBLIC_SETTLEMENT_ADDRESS: addr("Settlement"),
  NEXT_PUBLIC_SETTLEMENT_V2_ADDRESS: addr("SettlementV2"),
  NEXT_PUBLIC_VAULT_ADDRESS: addr("Vault"),
  NEXT_PUBLIC_PRICE_FEED_ADDRESS: addr("PriceFeed"),
  NEXT_PUBLIC_POSITION_MANAGER_ADDRESS: addr("PositionManager"),
  NEXT_PUBLIC_RISK_MANAGER_ADDRESS: addr("RiskManager"),
  NEXT_PUBLIC_INSURANCE_FUND_ADDRESS: addr("InsuranceFund"),
  NEXT_PUBLIC_CONTRACT_REGISTRY_ADDRESS: addr("ContractRegistry"),
  NEXT_PUBLIC_ROUTER_ADDRESS: addr("PancakeSwapRouterV2"),
  NEXT_PUBLIC_FUNDING_RATE_ADDRESS: addr("FundingRate"),
  NEXT_PUBLIC_LIQUIDATION_ADDRESS: addr("Liquidation"),
  NEXT_PUBLIC_PERP_VAULT_ADDRESS: addr("PerpVault"),
  NEXT_PUBLIC_WETH_ADDRESS: addr("WBNB"),
  NEXT_PUBLIC_LENDING_POOL_ADDRESS: addr("LendingPool"),
});

// 3. testnet/.env.testnet
console.log("\n-- testnet/.env.testnet --");
updateEnvFile("testnet/.env.testnet", {
  CHAIN_ID: String(deployment.chainId),
  RPC_URL: deployment.rpcUrl,
  WSS_URL: deployment.wssUrl,
  BLOCK_EXPLORER: deployment.explorer,
  SETTLEMENT_ADDRESS: addr("Settlement"),
  SETTLEMENT_V2_ADDRESS: addr("SettlementV2"),
  TOKEN_FACTORY_ADDRESS: addr("TokenFactory"),
  PRICE_FEED_ADDRESS: addr("PriceFeed"),
  LIQUIDATION_ADDRESS: addr("Liquidation"),
  VAULT_ADDRESS: addr("Vault"),
  POSITION_MANAGER_ADDRESS: addr("PositionManager"),
  INSURANCE_FUND_ADDRESS: addr("InsuranceFund"),
  PERP_VAULT_ADDRESS: addr("PerpVault"),
  FUNDING_RATE_ADDRESS: addr("FundingRate"),
  RISK_MANAGER_ADDRESS: addr("RiskManager"),
  CONTRACT_REGISTRY_ADDRESS: addr("ContractRegistry"),
  ROUTER_ADDRESS: addr("PancakeSwapRouterV2"),
  WETH_ADDRESS: addr("WBNB"),
  FEE_RECEIVER_ADDRESS: deployment.deployer,
  LENDING_POOL_ADDRESS: addr("LendingPool"),
});

// 4. backend/configs/config.yaml
console.log("\n-- backend/configs/config.yaml --");
updateYamlDefaults("backend/configs/config.yaml", {
  rpc_url: deployment.rpcUrl,
  router_address: addr("PancakeSwapRouterV2"),
  vault_address: addr("Vault"),
  position_address: addr("PositionManager"),
  liquidation_address: addr("Liquidation"),
  funding_rate_address: addr("FundingRate"),
  lending_pool_address: addr("LendingPool"),
  price_feed_address: addr("PriceFeed"),
  risk_manager_address: addr("RiskManager"),
  settlement_address: addr("Settlement"),
  settlement_v2_address: addr("SettlementV2"),
  insurance_fund_address: addr("InsuranceFund"),
  contract_registry_address: addr("ContractRegistry"),
  perp_vault_address: addr("PerpVault"),
});

// 5. backend/configs/config.local.yaml
console.log("\n-- backend/configs/config.local.yaml --");
updateYamlDefaults("backend/configs/config.local.yaml", {
  rpc_url: deployment.rpcUrl,
  router_address: addr("PancakeSwapRouterV2"),
  vault_address: addr("Vault"),
  position_address: addr("PositionManager"),
  liquidation_address: addr("Liquidation"),
  funding_rate_address: addr("FundingRate"),
  lending_pool_address: addr("LendingPool"),
  price_feed_address: addr("PriceFeed"),
});

// 6. frontend/contracts/deployments/base-sepolia.json (legacy format)
console.log("\n-- frontend/contracts/deployments/base-sepolia.json --");
updateJsonFile("frontend/contracts/deployments/base-sepolia.json");

// ============================================================
// Summary
// ============================================================

console.log(`\n${"=".repeat(50)}`);
if (totalChanges === 0) {
  console.log("All config files are already in sync!");
} else if (dryRun) {
  console.log(`${totalChanges} changes needed. Run with --apply to write.`);
} else {
  console.log(`Applied ${totalChanges} changes across all config files.`);
}
console.log(`\nNext: bun scripts/validate-deployment.ts --chain ${chainId}`);
console.log("");
