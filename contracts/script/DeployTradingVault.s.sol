// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Script.sol";
import "../src/perpetual/TradingVault.sol";

/**
 * @title DeployTradingVault
 * @notice Deploy unified TradingVault (replaces SettlementV2 + PerpVault) to BSC Testnet
 *
 * TradingVault = SettlementV2 (user margin custody) + PerpVault (LP pool + settlement + OI)
 *
 * Usage:
 *   cd contracts
 *   forge script script/DeployTradingVault.s.sol \
 *     --rpc-url https://data-seed-prebsc-1-s1.binance.org:8545/ \
 *     --broadcast --slow -vvv
 *
 * After deployment, update these 7 config files:
 *   1. frontend/contracts/deployments/base-sepolia.json — add TradingVault
 *   2. frontend/src/lib/contracts.ts — SETTLEMENT_V2 address (reuses env var)
 *   3. backend/.env — SETTLEMENT_V2_ADDRESS (now points to TradingVault)
 *   4. backend/configs/config.yaml — settlement_v2_address + perp_vault_address
 *   5. CLAUDE.md — contract addresses
 *   6. frontend/.env.local — NEXT_PUBLIC_SETTLEMENT_V2_ADDRESS
 *   7. DEVELOPMENT_RULES.md — contract addresses
 */
contract DeployTradingVault is Script {
    // ── BSC Testnet Constants ──
    address constant WBNB = 0xae13d989daC2f0dEbFf460aC112a837C89BAa7cd;

    // ── Supported Tokens (from TokenFactory.getAllTokens()) ──
    address constant DOGE = 0x2Bb1323d2179cA702b1D7731EcE531bb9971A86E;

    // ── Configuration ──
    uint256 constant SEED_LP_BNB = 0.5 ether;          // Initial LP liquidity
    uint256 constant MAX_OI_PER_TOKEN = 10 ether;       // Per-token OI cap
    uint256 constant DEPOSIT_CAP_PER_USER = 10 ether;   // User deposit cap
    uint256 constant DEPOSIT_CAP_TOTAL = 100 ether;     // Total deposit cap

    function run() external {
        uint256 deployerKey = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(deployerKey);

        console.log("=============================================");
        console.log("  TradingVault Deployment (BSC Testnet)");
        console.log("=============================================");
        console.log("Deployer:", deployer);
        console.log("Balance:", deployer.balance / 1e18, "BNB");
        console.log("WBNB:", WBNB);
        require(deployer.balance >= 0.5 ether, "Need at least 0.5 BNB");

        vm.startBroadcast(deployerKey);

        // ════════════════════════════════════════════
        //  Step 1: Deploy TradingVault
        // ════════════════════════════════════════════
        console.log("\n=== Step 1: Deploy TradingVault ===");

        TradingVault vault = new TradingVault(WBNB, deployer, deployer);
        console.log("TradingVault deployed at:", address(vault));

        // ════════════════════════════════════════════
        //  Step 2: Authorize matcher wallet
        // ════════════════════════════════════════════
        console.log("\n=== Step 2: Authorize matcher ===");

        vault.setAuthorizedContract(deployer, true);
        console.log("  Matcher authorized:", deployer);

        // ════════════════════════════════════════════
        //  Step 3: Authorize state root updater
        // ════════════════════════════════════════════
        console.log("\n=== Step 3: Authorize state root updater ===");

        vault.setAuthorizedUpdater(deployer, true);
        console.log("  State root updater authorized:", deployer);

        // ════════════════════════════════════════════
        //  Step 4: Set deposit caps
        // ════════════════════════════════════════════
        console.log("\n=== Step 4: Set deposit caps ===");

        vault.setDepositCapPerUser(DEPOSIT_CAP_PER_USER);
        vault.setDepositCapTotal(DEPOSIT_CAP_TOTAL);
        console.log("  Per-user cap:", DEPOSIT_CAP_PER_USER / 1e18, "BNB");
        console.log("  Total cap:   ", DEPOSIT_CAP_TOTAL / 1e18, "BNB");

        // ════════════════════════════════════════════
        //  Step 5: Set OI caps
        // ════════════════════════════════════════════
        console.log("\n=== Step 5: Set OI caps ===");

        vault.setMaxOIPerToken(DOGE, MAX_OI_PER_TOKEN);
        console.log("  DOGE max OI:", MAX_OI_PER_TOKEN / 1e18, "BNB");

        // ════════════════════════════════════════════
        //  Step 6: Seed LP liquidity
        // ════════════════════════════════════════════
        console.log("\n=== Step 6: Seed LP liquidity ===");

        vault.depositLP{value: SEED_LP_BNB}();
        console.log("  Seeded:", SEED_LP_BNB / 1e18, "BNB as LP");

        vm.stopBroadcast();

        // ════════════════════════════════════════════
        //  Output Summary
        // ════════════════════════════════════════════
        console.log("\n=============================================");
        console.log("  DEPLOYMENT COMPLETE!");
        console.log("=============================================");
        console.log("");
        console.log("TradingVault:     ", address(vault));
        console.log("WBNB:             ", WBNB);
        console.log("Platform Signer:  ", deployer);
        console.log("LP Pool Value:    ", vault.getPoolValue());
        console.log("LP Shares:        ", vault.totalShares());
        console.log("Deployer Balance: ", deployer.balance);
        console.log("");
        console.log("=== NEXT: Update 7 config files ===");
        console.log("1. frontend/contracts/deployments/base-sepolia.json");
        console.log("2. frontend/src/lib/contracts.ts (or .env.local)");
        console.log("3. backend/.env - SETTLEMENT_V2_ADDRESS=", address(vault));
        console.log("4. backend/configs/config.yaml");
        console.log("5. CLAUDE.md");
        console.log("6. frontend/.env.local");
        console.log("7. DEVELOPMENT_RULES.md");
        console.log("=============================================");
    }
}
