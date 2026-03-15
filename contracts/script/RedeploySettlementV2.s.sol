// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Script.sol";
import "../src/perpetual/SettlementV2.sol";

/**
 * @title RedeploySettlementV2
 * @notice Redeploy SettlementV2 with depositBNB() support, then configure
 *
 * Usage:
 *   cd contracts
 *   forge script script/RedeploySettlementV2.s.sol \
 *     --rpc-url https://data-seed-prebsc-1-s1.binance.org:8545/ \
 *     --broadcast --slow -vvv
 *
 * Requires:
 *   PRIVATE_KEY env var (deployer = matcher = signer)
 */
contract RedeploySettlementV2 is Script {
    // BSC Testnet WBNB
    address constant WBNB = 0xae13d989daC2f0dEbFf460aC112a837C89BAa7cd;

    // Deposit caps (same as original deployment)
    uint256 constant DEPOSIT_CAP_PER_USER = 10 ether;
    uint256 constant DEPOSIT_CAP_TOTAL = 100 ether;

    function run() external {
        uint256 deployerKey = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(deployerKey);

        console.log("=============================================");
        console.log("  Redeploy SettlementV2 (with depositBNB)");
        console.log("=============================================");
        console.log("Deployer:", deployer);
        console.log("Balance:", deployer.balance / 1e18, "BNB");

        vm.startBroadcast(deployerKey);

        // 1. Deploy new SettlementV2
        SettlementV2 sv2 = new SettlementV2(WBNB, deployer, deployer);
        console.log("SettlementV2 deployed:", address(sv2));

        // 2. Configure: authorize deployer as state root updater
        sv2.setAuthorizedUpdater(deployer, true);
        console.log("Authorized updater:", deployer);

        // 3. Set deposit caps
        sv2.setDepositCapPerUser(DEPOSIT_CAP_PER_USER);
        sv2.setDepositCapTotal(DEPOSIT_CAP_TOTAL);
        console.log("Deposit caps: per-user=10 BNB, total=100 BNB");

        vm.stopBroadcast();

        // Output
        console.log("");
        console.log("=============================================");
        console.log("  DONE! Update these config files:");
        console.log("=============================================");
        console.log("New SettlementV2:", address(sv2));
        console.log("");
        console.log("1. frontend/.env.local");
        console.log("2. frontend/contracts/deployments/base-sepolia.json");
        console.log("3. backend/configs/config.yaml");
        console.log("4. docker-compose.yml");
        console.log("5. docs/BSC_MAINNET_DEPLOYMENT.md");
        console.log("6. README.md");
        console.log("7. DEVELOPMENT_RULES.md (if applicable)");
        console.log("=============================================");
    }
}
