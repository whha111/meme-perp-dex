// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Script.sol";
import "../src/perpetual/Settlement.sol";

/**
 * @title UpgradeSettlementOnly
 * @notice 只升级 Settlement 合约（保持现有稳定币和保险基金）
 * @dev 用于添加 Pausable 功能后的升级部署
 */
contract UpgradeSettlementOnly is Script {
    function run() external {
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(deployerPrivateKey);

        // 从环境变量读取现有合约地址
        address usdtAddress = vm.envAddress("USDT_ADDRESS");
        address usdcAddress = vm.envAddress("USDC_ADDRESS");
        address usd1Address = vm.envAddress("USD1_ADDRESS");
        address wethAddress = vm.envOr("WETH_ADDRESS", address(0x4200000000000000000000000000000000000006));
        address registryAddress = vm.envAddress("CONTRACT_REGISTRY_ADDRESS");
        address insuranceFundAddress = vm.envAddress("INSURANCE_FUND_ADDRESS");
        address matcherAddress = vm.envOr("MATCHER_ADDRESS", deployer);
        address feeReceiverAddress = vm.envOr("FEE_RECEIVER_ADDRESS", deployer);

        console.log("===========================================");
        console.log("Upgrading Settlement Contract (with Pausable)");
        console.log("===========================================");
        console.log("Deployer:", deployer);
        console.log("Deployer balance:", deployer.balance / 1e18, "ETH");

        vm.startBroadcast(deployerPrivateKey);

        // 1. 部署新的 Settlement 合约
        console.log("\n--- Deploying New Settlement ---");
        Settlement settlement = new Settlement();
        console.log("New Settlement deployed at:", address(settlement));

        // 2. 配置合约
        console.log("\n--- Configuring Settlement ---");

        // 设置 ContractRegistry
        settlement.setContractRegistry(registryAddress);
        console.log("ContractRegistry set:", registryAddress);

        // 添加支持的稳定币（复用现有地址）
        settlement.addSupportedToken(usdtAddress, 6);
        console.log("Added USDT (6 decimals):", usdtAddress);

        settlement.addSupportedToken(usdcAddress, 6);
        console.log("Added USDC (6 decimals):", usdcAddress);

        settlement.addSupportedToken(usd1Address, 18);
        console.log("Added USD1 (18 decimals):", usd1Address);

        settlement.addSupportedToken(wethAddress, 18);
        console.log("Added WETH (18 decimals):", wethAddress);

        // 配置授权撮合者
        settlement.setAuthorizedMatcher(matcherAddress, true);
        console.log("Authorized matcher:", matcherAddress);

        // 设置保险基金地址
        settlement.setInsuranceFund(insuranceFundAddress);
        console.log("Insurance fund set:", insuranceFundAddress);

        // 设置手续费接收者
        settlement.setFeeReceiver(feeReceiverAddress);
        console.log("Fee receiver set:", feeReceiverAddress);

        vm.stopBroadcast();

        // 3. 输出部署结果
        console.log("\n===========================================");
        console.log("Upgrade Completed!");
        console.log("===========================================");
        console.log("\n--- New Features ---");
        console.log("+ emergencyPause(reason) - Pause all critical operations");
        console.log("+ emergencyUnpause() - Resume operations");
        console.log("+ Affected functions: withdraw, withdrawFor, settleBatch,");
        console.log("  closePair, closePairsBatch, executeADL, liquidate");
        console.log("\n--- Contract Address ---");
        console.log("NEW Settlement:", address(settlement));
        console.log("\n--- Update .env files ---");
        console.log("SETTLEMENT_ADDRESS=", address(settlement));
        console.log("NEXT_PUBLIC_SETTLEMENT_ADDRESS=", address(settlement));
        console.log("\n--- Important ---");
        console.log("1. Update frontend/.env.local with new SETTLEMENT_ADDRESS");
        console.log("2. Update backend/src/matching/.env with new SETTLEMENT_ADDRESS");
        console.log("3. Restart matching engine to use new contract");
        console.log("4. Users need to re-deposit funds to new contract");
        console.log("===========================================");
    }
}
