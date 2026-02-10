// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Script.sol";
import "../src/spot/LendingPool.sol";

/**
 * @title DeployLendingPool
 * @notice Deploy the multi-token P2P LendingPool and wire it to TokenFactory
 *
 * Usage:
 *   forge script script/DeployLendingPool.s.sol --rpc-url $RPC_URL --broadcast
 *
 * After deployment:
 *   1. Call TokenFactory.setLendingPool(lendingPoolAddress) from owner
 *   2. Call LendingPool.setAuthorizedContract(matchingEngineAddress, true) from owner
 */
contract DeployLendingPool is Script {
    function run() external {
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(deployerPrivateKey);
        address tokenFactory = vm.envAddress("TOKEN_FACTORY_ADDRESS");

        console.log("Deployer:", deployer);
        console.log("TokenFactory:", tokenFactory);

        vm.startBroadcast(deployerPrivateKey);

        // Deploy LendingPool
        LendingPool lendingPool = new LendingPool(deployer, tokenFactory);
        console.log("LendingPool deployed at:", address(lendingPool));

        // Wire TokenFactory → LendingPool
        // NOTE: This requires calling TokenFactory.setLendingPool() separately
        // since this script doesn't have the TokenFactory contract instance
        console.log("");
        console.log("=== POST-DEPLOY STEPS ===");
        console.log("1. TokenFactory.setLendingPool(", address(lendingPool), ")");
        console.log("2. LendingPool.setAuthorizedContract(<matching_engine>, true)");

        vm.stopBroadcast();
    }
}
