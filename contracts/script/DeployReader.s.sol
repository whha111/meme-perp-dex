// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Script.sol";
import "../src/periphery/Reader.sol";

/**
 * @title DeployReader
 * @notice 部署 Reader 合约
 * @dev 使用已部署的合约地址
 */
contract DeployReader is Script {
    // 已部署的合约地址 (Base Sepolia - Updated 2025-01-21)
    address constant POSITION_MANAGER = 0xeCA6E2f7466c0A1BA6dB3083a09b8B09969D77Ee;
    address constant PRICE_FEED = 0x2dccffb6377364CDD189e2009Af96998F9b8BEcb;
    address constant VAULT = 0x467a18E3Ec98587Cd88683E6F9e1792C480C09c7;

    function run() external {
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(deployerPrivateKey);

        console.log("Deployer:", deployer);
        console.log("Deployer balance:", deployer.balance);

        console.log("\n--- Existing Contract Addresses ---");
        console.log("PositionManager:", POSITION_MANAGER);
        console.log("PriceFeed:", PRICE_FEED);
        console.log("Vault:", VAULT);

        vm.startBroadcast(deployerPrivateKey);

        // Deploy Reader contract
        console.log("\n--- Deploying Reader Contract ---");
        Reader reader = new Reader(POSITION_MANAGER, PRICE_FEED, VAULT);
        console.log("Reader deployed at:", address(reader));

        vm.stopBroadcast();

        // Output deployment result
        console.log("\n========================================");
        console.log("Reader Deployment Complete!");
        console.log("========================================");
        console.log("Reader Address:", address(reader));
        console.log("\nVerify with:");
        console.log("forge verify-contract", address(reader), "src/periphery/Reader.sol:Reader --chain base-sepolia");
        console.log("\n========================================");
    }
}
