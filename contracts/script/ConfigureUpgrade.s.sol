// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Script.sol";

interface IRiskManager {
    function setPositionManager(address _positionManager) external;
    function setVault(address _vault) external;
}

/**
 * @title ConfigureUpgrade
 * @notice 配置 RiskManager 指向新的 Vault 和 PositionManager
 */
contract ConfigureUpgrade is Script {
    // 现有合约
    address constant EXISTING_RISK_MANAGER = 0xd4EE5BF901E6812E74a20306F5732326Ced89126;

    // 新部署的合约
    address constant NEW_VAULT = 0x467a18E3Ec98587Cd88683E6F9e1792C480C09c7;
    address constant NEW_POSITION_MANAGER = 0xeCA6E2f7466c0A1BA6dB3083a09b8B09969D77Ee;

    function run() external {
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(deployerPrivateKey);

        console.log("===========================================");
        console.log("Configure RiskManager for Upgrade");
        console.log("===========================================");
        console.log("Deployer:", deployer);

        vm.startBroadcast(deployerPrivateKey);

        IRiskManager riskManager = IRiskManager(EXISTING_RISK_MANAGER);

        // 更新 RiskManager 指向新合约
        console.log("\n--- Updating RiskManager ---");
        riskManager.setPositionManager(NEW_POSITION_MANAGER);
        console.log("RiskManager.positionManager updated to:", NEW_POSITION_MANAGER);

        riskManager.setVault(NEW_VAULT);
        console.log("RiskManager.vault updated to:", NEW_VAULT);

        vm.stopBroadcast();

        console.log("\n===========================================");
        console.log("Configuration Completed!");
        console.log("===========================================");
    }
}
