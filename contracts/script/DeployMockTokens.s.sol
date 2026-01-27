// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Script.sol";
import "../src/test/MockUSDT.sol";

contract DeployMockTokens is Script {
    function run() external {
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(deployerPrivateKey);

        console.log("Deployer:", deployer);

        vm.startBroadcast(deployerPrivateKey);

        // 部署 MockUSDT
        MockUSDT usdt = new MockUSDT();
        console.log("MockUSDT deployed at:", address(usdt));

        // 部署 MockUSDC
        MockUSDC usdc = new MockUSDC();
        console.log("MockUSDC deployed at:", address(usdc));

        vm.stopBroadcast();

        console.log("");
        console.log("=== Update .env.local with these addresses ===");
        console.log("NEXT_PUBLIC_USDT_ADDRESS=", address(usdt));
        console.log("NEXT_PUBLIC_USDC_ADDRESS=", address(usdc));
    }
}
