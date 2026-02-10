// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Script.sol";
import "../src/perpetual/Settlement.sol";

/**
 * @title UpgradeSettlement
 * @notice 升级 Settlement 合约（保留现有代币）
 */
contract UpgradeSettlement is Script {
    function run() external {
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(deployerPrivateKey);

        // 使用现有代币地址
        address usdtAddress = vm.envOr("USDT_ADDRESS", address(0xAa2a6b49C37E0241f9b5385dc4637eDF51026519));
        address usdcAddress = vm.envOr("USDC_ADDRESS", address(0xb9dD696A78637A1A5237A4e69b95c3f6D8DDC4cD));
        address usd1Address = vm.envOr("USD1_ADDRESS", address(0xE5Cc3d23f446A000B903624f6a439DEe617dD6F3));
        address wethAddress = vm.envOr("WETH_ADDRESS", address(0x4200000000000000000000000000000000000006));
        address registryAddress = vm.envOr("CONTRACT_REGISTRY_ADDRESS", address(0x51014b1135820949b4d903f6E144ceA825E6Ac2F));

        address matcherAddress = vm.envOr("MATCHER_ADDRESS", deployer);

        console.log("===========================================");
        console.log("Upgrading Settlement Contract");
        console.log("===========================================");
        console.log("Deployer:", deployer);
        console.log("Deployer balance:", deployer.balance / 1e18, "ETH");

        vm.startBroadcast(deployerPrivateKey);

        // 1. 部署新 Settlement
        Settlement settlement = new Settlement();
        console.log("New Settlement deployed at:", address(settlement));

        // 2. 配置
        settlement.setContractRegistry(registryAddress);
        settlement.addSupportedToken(usdtAddress, 6);
        settlement.addSupportedToken(usdcAddress, 6);
        settlement.addSupportedToken(usd1Address, 18);
        settlement.addSupportedToken(wethAddress, 18);
        settlement.setAuthorizedMatcher(matcherAddress, true);
        settlement.setInsuranceFund(deployer);
        settlement.setFeeReceiver(deployer);

        vm.stopBroadcast();

        console.log("\n===========================================");
        console.log("Deployment Complete!");
        console.log("===========================================");
        console.log("Settlement:", address(settlement));
        console.log("\nUpdate your .env files:");
        console.log("NEXT_PUBLIC_SETTLEMENT_ADDRESS=", address(settlement));
    }
}
