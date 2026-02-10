// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Script.sol";
import "../src/common/Vault.sol";
import "../src/perpetual/PositionManager.sol";

/**
 * @title UpgradeVaultAndPositionManager
 * @notice 升级Vault和PositionManager合约以修复手续费收取逻辑
 * @dev 部署新版本合约并配置权限
 */
contract UpgradeVaultAndPositionManager is Script {
    // 现有合约地址 (Base Sepolia)
    address constant EXISTING_PRICE_FEED = 0x2dccffb6377364CDD189e2009Af96998F9b8BEcb;
    address constant EXISTING_RISK_MANAGER = 0xd4EE5BF901E6812E74a20306F5732326Ced89126;
    address constant EXISTING_FUNDING_RATE = 0x9Abe85f3bBee0f06330E8703e29B327CE551Ba10;
    address constant EXISTING_LIQUIDATION = 0x468B589c68dBe29b2BC2b765108D63B61805e982;
    address constant EXISTING_LENDING_POOL = 0xA488d58915967cfE62bc5f55336972c3FBD6aF01;

    // 新部署的合约
    Vault public newVault;
    PositionManager public newPositionManager;

    function run() external {
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(deployerPrivateKey);

        console.log("===========================================");
        console.log("Upgrade Vault and PositionManager");
        console.log("===========================================");
        console.log("Deployer:", deployer);
        console.log("Deployer balance:", deployer.balance / 1e15, "finney");

        vm.startBroadcast(deployerPrivateKey);

        // 1. 部署新的 Vault
        console.log("\n--- Deploying New Vault ---");
        newVault = new Vault();
        console.log("New Vault deployed at:", address(newVault));

        // 2. 部署新的 PositionManager
        console.log("\n--- Deploying New PositionManager ---");
        newPositionManager = new PositionManager(
            address(newVault),
            EXISTING_PRICE_FEED,
            EXISTING_RISK_MANAGER
        );
        console.log("New PositionManager deployed at:", address(newPositionManager));

        // 3. 配置 Vault 权限
        console.log("\n--- Configuring Vault ---");
        newVault.setAuthorizedContract(address(newPositionManager), true);
        newVault.setAuthorizedContract(EXISTING_LIQUIDATION, true);
        newVault.setAuthorizedContract(EXISTING_FUNDING_RATE, true);
        newVault.setLendingPool(EXISTING_LENDING_POOL);
        newVault.setInsuranceFund(EXISTING_LIQUIDATION);
        console.log("Vault authorized contracts set");

        // 4. 配置 PositionManager
        console.log("\n--- Configuring PositionManager ---");
        newPositionManager.setFundingRate(EXISTING_FUNDING_RATE);
        newPositionManager.setAuthorizedContract(EXISTING_LIQUIDATION, true);
        // 设置手续费接收者为 deployer
        newPositionManager.setFeeReceiver(deployer);
        console.log("PositionManager configured");
        console.log("Fee receiver set to:", deployer);

        vm.stopBroadcast();

        // 5. 输出结果
        console.log("\n===========================================");
        console.log("Upgrade Completed!");
        console.log("===========================================");
        console.log("\nNew Contract Addresses:");
        console.log("Vault:           ", address(newVault));
        console.log("PositionManager: ", address(newPositionManager));
        console.log("\nUpdate your .env.local with:");
        console.log("NEXT_PUBLIC_VAULT_ADDRESS=", address(newVault));
        console.log("NEXT_PUBLIC_POSITION_MANAGER_ADDRESS=", address(newPositionManager));
        console.log("\n===========================================");
    }
}
