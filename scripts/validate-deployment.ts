#!/usr/bin/env bun
/**
 * Deployment Validation Script
 * ============================
 *
 * Verifies all config files are in sync with deployments/<chainId>.json.
 * Also scans source code for hardcoded addresses that should use env vars.
 *
 * Usage:
 *   bun scripts/validate-deployment.ts --chain 97
 */

import { readFileSync, existsSync } from "fs";
import { resolve, join } from "path";
import { execFileSync } from "child_process";

// ============================================================
// CLI args
// ============================================================

const args = process.argv.slice(2);
const chainIdArg = args.find((_, i, a) => a[i - 1] === "--chain");

if (!chainIdArg) {
  console.error("Usage: bun scripts/validate-deployment.ts --chain <chainId>");
  process.exit(1);
}

const chainId = parseInt(chainIdArg);
const ROOT = resolve(import.meta.dir, "..");
const deploymentPath = join(ROOT, "deployments", `${chainId}.json`);

if (!existsSync(deploymentPath)) {
  console.error(`Deployment file not found: ${deploymentPath}`);
  process.exit(1);
}

// ============================================================
// Load deployment data
// ============================================================

interface Deployment {
  network: string;
  chainId: number;
  rpcUrl: string;
  wssUrl: string;
  explorer: string;
  deployedAt: string;
  deployer: string;
  contracts: Record<string, { address: string }>;
  external: Record<string, string>;
}

const deployment: Deployment = JSON.parse(readFileSync(deploymentPath, "utf-8"));

// Collect all addresses for scanning
const allAddresses = new Map<string, string>();
for (const [name, data] of Object.entries(deployment.contracts)) {
  allAddresses.set(name, data.address);
}
for (const [name, value] of Object.entries(deployment.external)) {
  allAddresses.set(name, value);
}

let errors = 0;
let warnings = 0;

function logError(msg: string) {
  console.error(`  ERROR: ${msg}`);
  errors++;
}

function logWarn(msg: string) {
  console.warn(`  WARN: ${msg}`);
  warnings++;
}

function logOk(msg: string) {
  console.log(`  OK: ${msg}`);
}

// ============================================================
// Check 1: Env files contain correct addresses
// ============================================================

function checkEnvFile(relPath: string, mapping: Record<string, string>) {
  const absPath = resolve(ROOT, relPath);
  if (!existsSync(absPath)) {
    logWarn(`${relPath} not found (skipped)`);
    return;
  }

  const content = readFileSync(absPath, "utf-8");
  let mismatches = 0;

  for (const [key, expected] of Object.entries(mapping)) {
    const regex = new RegExp(`^${key}=(.*)$`, "m");
    const match = content.match(regex);
    if (!match) {
      logWarn(`${relPath}: ${key} not found`);
    } else if (match[1] !== expected) {
      logError(`${relPath}: ${key}=${match[1]} (expected ${expected})`);
      mismatches++;
    }
  }

  if (mismatches === 0) {
    logOk(relPath);
  }
}

function checkYamlDefaults(relPath: string, mapping: Record<string, string>) {
  const absPath = resolve(ROOT, relPath);
  if (!existsSync(absPath)) {
    logWarn(`${relPath} not found (skipped)`);
    return;
  }

  const content = readFileSync(absPath, "utf-8");
  let mismatches = 0;

  for (const [yamlKey, expected] of Object.entries(mapping)) {
    const escapedKey = yamlKey.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const regex = new RegExp(`(?:^|\\n)\\s*${escapedKey}:\\s*"\\$\\{[^:]+:-([^"]+)\\}"`);
    const match = content.match(regex);
    if (!match) {
      // Key might not have a default (which is fine for required fields)
      continue;
    } else if (match[1] !== expected) {
      logError(`${relPath}: ${yamlKey} default=${match[1]} (expected ${expected})`);
      mismatches++;
    }
  }

  if (mismatches === 0) {
    logOk(relPath);
  }
}

function addr(name: string): string {
  return allAddresses.get(name)!;
}

// ============================================================
// Check 2: Scan source for hardcoded addresses
// ============================================================

// Known BSC Mainnet addresses that should NEVER appear in source
const FORBIDDEN_ADDRESSES: Record<string, string> = {
  "0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c": "BSC Mainnet WBNB",
  "0xcA143Ce32Fe78f1f7019d7d551a6402fC5350c73": "BSC Mainnet PancakeSwap Factory",
  "0x10ED43C718714eb63d5aA57B78B54704E256024E": "BSC Mainnet PancakeSwap Router",
  "0x55d398326f99059fF775485246999027B3197955": "BSC Mainnet USDT",
  "0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d": "BSC Mainnet USDC",
};

function scanForHardcodedAddresses() {
  const searchDirs = [
    resolve(ROOT, "backend/src"),
    resolve(ROOT, "frontend/src"),
  ];

  for (const dir of searchDirs) {
    if (!existsSync(dir)) continue;

    for (const [address, label] of Object.entries(FORBIDDEN_ADDRESSES)) {
      try {
        const result = execFileSync(
          "grep",
          ["-rn", address, dir, "--include=*.ts", "--include=*.tsx", "--include=*.js"],
          { encoding: "utf-8", timeout: 10000 }
        ).trim();

        if (result) {
          const lines = result.split("\n");
          for (const line of lines) {
            if (line.includes("node_modules") || line.includes(".next")) continue;
            logError(`Hardcoded ${label} found: ${line.substring(0, 120)}`);
          }
        }
      } catch {
        // grep returns exit code 1 when no match — that's fine
      }
    }
  }
}

// ============================================================
// Check 3: chain_id consistency
// ============================================================

function checkChainId() {
  // Check docker-compose.yml defaults
  const dcPath = resolve(ROOT, "docker-compose.yml");
  if (existsSync(dcPath)) {
    const content = readFileSync(dcPath, "utf-8");
    const mainnetDefault = content.match(/CHAIN_ID[:-]+56(?:\}|"|\s)/);
    if (mainnetDefault) {
      logError(`docker-compose.yml contains mainnet chain_id default (56)`);
    }
  }

  // Check config.ts
  const configPath = resolve(ROOT, "backend/src/matching/config.ts");
  if (existsSync(configPath)) {
    const content = readFileSync(configPath, "utf-8");
    const match = content.match(/CHAIN_ID\s*=\s*parseInt\([^)]*\|\|\s*"(\d+)"/);
    if (match && match[1] !== String(deployment.chainId)) {
      logError(`config.ts default chain_id=${match[1]} (expected ${deployment.chainId})`);
    }
  }
}

// ============================================================
// Check 4: deployment JSON consistency
// ============================================================

function checkDeploymentJson() {
  const legacyPath = resolve(ROOT, "frontend/contracts/deployments/base-sepolia.json");
  if (!existsSync(legacyPath)) {
    logWarn("frontend/contracts/deployments/base-sepolia.json not found");
    return;
  }

  const legacy = JSON.parse(readFileSync(legacyPath, "utf-8"));

  if (legacy.chainId !== deployment.chainId) {
    logError(`base-sepolia.json chainId=${legacy.chainId} (expected ${deployment.chainId})`);
  }

  for (const [name, data] of Object.entries(deployment.contracts)) {
    const legacyContract = legacy.contracts?.[name];
    if (!legacyContract) {
      logWarn(`base-sepolia.json missing contract: ${name}`);
    } else if ((legacyContract as { address: string }).address !== data.address) {
      logError(`base-sepolia.json ${name}=${(legacyContract as { address: string }).address} (expected ${data.address})`);
    }
  }
}

// ============================================================
// Main
// ============================================================

console.log(`\nDeployment Validation — ${deployment.network} (chain ${deployment.chainId})\n`);
console.log(`Source: deployments/${chainId}.json`);
console.log(`Deployed: ${deployment.deployedAt}\n`);

// Check 1: Env files
console.log("-- Env file consistency --");

checkEnvFile("backend/.env", {
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
});

checkEnvFile("frontend/.env.local", {
  NEXT_PUBLIC_CHAIN_ID: String(deployment.chainId),
  NEXT_PUBLIC_TOKEN_FACTORY_ADDRESS: addr("TokenFactory"),
  NEXT_PUBLIC_SETTLEMENT_V2_ADDRESS: addr("SettlementV2"),
  NEXT_PUBLIC_PRICE_FEED_ADDRESS: addr("PriceFeed"),
  NEXT_PUBLIC_PERP_VAULT_ADDRESS: addr("PerpVault"),
  NEXT_PUBLIC_WETH_ADDRESS: addr("WBNB"),
});

checkEnvFile("testnet/.env.testnet", {
  CHAIN_ID: String(deployment.chainId),
  SETTLEMENT_V2_ADDRESS: addr("SettlementV2"),
  TOKEN_FACTORY_ADDRESS: addr("TokenFactory"),
  PERP_VAULT_ADDRESS: addr("PerpVault"),
});

// Check 2: YAML defaults
console.log("\n-- YAML config defaults --");

checkYamlDefaults("backend/configs/config.yaml", {
  router_address: addr("PancakeSwapRouterV2"),
  vault_address: addr("Vault"),
  position_address: addr("PositionManager"),
  liquidation_address: addr("Liquidation"),
  funding_rate_address: addr("FundingRate"),
  price_feed_address: addr("PriceFeed"),
  settlement_v2_address: addr("SettlementV2"),
  perp_vault_address: addr("PerpVault"),
});

// Check 3: Hardcoded addresses in source
console.log("\n-- Hardcoded address scan --");
scanForHardcodedAddresses();
logOk("Source code scan complete");

// Check 4: Chain ID consistency
console.log("\n-- Chain ID consistency --");
checkChainId();
logOk("Chain ID check complete");

// Check 5: Deployment JSON consistency
console.log("\n-- Deployment JSON consistency --");
checkDeploymentJson();

// ============================================================
// Summary
// ============================================================

console.log(`\n${"=".repeat(50)}`);
if (errors === 0 && warnings === 0) {
  console.log("All checks passed! Deployment is consistent.");
} else {
  if (errors > 0) {
    console.log(`${errors} error(s) found — deployment is INCONSISTENT.`);
    console.log(`Run: bun scripts/sync-contract-addresses.ts --chain ${chainId} --apply`);
  }
  if (warnings > 0) {
    console.log(`${warnings} warning(s) — non-critical issues.`);
  }
}
console.log("");

process.exit(errors > 0 ? 1 : 0);
