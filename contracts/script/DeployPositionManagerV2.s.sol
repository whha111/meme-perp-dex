// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Script.sol";
import "../src/perpetual/PositionManager.sol";

interface IVaultSetPM {
    function setPositionManager(address newPositionManager) external;
}

interface IRiskManagerSetPM {
    function setPositionManager(address newPositionManager) external;
}

interface IFundingRateSetPM {
    function setPositionManager(address newPositionManager) external;
}

interface ILiquidationSetPM {
    function setPositionManager(address newPositionManager) external;
}

/**
 * @title DeployPositionManagerV2
 * @notice 部署新的 PositionManager 并配置相关合约
 */
contract DeployPositionManagerV2 is Script {
    // 已部署的合约地址 (Base Sepolia)
    address constant VAULT = 0x467a18E3Ec98587Cd88683E6F9e1792C480C09c7;
    address constant NEW_PRICE_FEED = 0xd69A4DB60cEc962A46C6B9Bc8CC0883081c4eFb7;
    address constant RISK_MANAGER = 0xd4EE5BF901E6812E74a20306F5732326Ced89126;
    address constant FUNDING_RATE = 0x9Abe85f3bBee0f06330E8703e29B327CE551Ba10;
    address constant LIQUIDATION = 0x468B589c68dBe29b2BC2b765108D63B61805e982;

    function run() external {
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(deployerPrivateKey);

        console.log("Deployer:", deployer);
        console.log("Deployer balance:", deployer.balance);

        vm.startBroadcast(deployerPrivateKey);

        // 1. Deploy new PositionManager
        console.log("\n--- Deploying PositionManager V2 ---");
        PositionManager positionManager = new PositionManager(
            VAULT,
            NEW_PRICE_FEED,
            RISK_MANAGER
        );
        console.log("PositionManager deployed at:", address(positionManager));

        // 2. Set FundingRate contract
        console.log("\n--- Configuring PositionManager ---");
        positionManager.setFundingRate(FUNDING_RATE);
        console.log("FundingRate set:", FUNDING_RATE);

        // Note: Vault, FundingRate, Liquidation need to be updated separately
        // They may not have setPositionManager function or need special permissions
        console.log("\nNote: Update other contracts manually if needed");

        vm.stopBroadcast();

        // Output deployment result
        console.log("\n========================================");
        console.log("PositionManager V2 Deployment Complete!");
        console.log("========================================");
        console.log("PositionManager Address:", address(positionManager));
        console.log("\nUpdate base-sepolia.json with new addresses");
        console.log("========================================");
    }
}
