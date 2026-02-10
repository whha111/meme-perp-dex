// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Script.sol";
import "../src/common/Vault.sol";
import "../src/perpetual/PositionManager.sol";

/**
 * @title TestFeeCollection
 * @notice 测试开仓和平仓手续费收取功能
 */
contract TestFeeCollection is Script {
    address constant NEW_VAULT = 0x467a18E3Ec98587Cd88683E6F9e1792C480C09c7;
    address constant NEW_POSITION_MANAGER = 0xeCA6E2f7466c0A1BA6dB3083a09b8B09969D77Ee;

    function run() external {
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(deployerPrivateKey);

        Vault vault = Vault(payable(NEW_VAULT));
        PositionManager pm = PositionManager(NEW_POSITION_MANAGER);

        console.log("=== Test Fee Collection ===");
        console.log("Tester:", deployer);

        address feeReceiver = pm.feeReceiver();
        console.log("Fee Receiver:", feeReceiver);

        // Get initial balances
        uint256 feeReceiverBefore = vault.balances(feeReceiver);
        console.log("Fee Receiver Balance (before):", feeReceiverBefore);

        vm.startBroadcast(deployerPrivateKey);

        // 1. Deposit
        console.log("\n--- Deposit ---");
        vault.deposit{value: 0.1 ether}();

        // 2. Open Long
        console.log("\n--- Open Long (5x, 0.05 ETH) ---");
        pm.openLong(0.05 ether, 50000);

        vm.stopBroadcast();

        // Check fee collected on open
        uint256 feeReceiverAfterOpen = vault.balances(feeReceiver);
        console.log("Fee Receiver Balance (after open):", feeReceiverAfterOpen);
        console.log("Open Fee Collected:", feeReceiverAfterOpen - feeReceiverBefore);

        vm.startBroadcast(deployerPrivateKey);

        // 3. Close Position
        console.log("\n--- Close Position ---");
        pm.closePosition();

        vm.stopBroadcast();

        // Check final
        uint256 feeReceiverFinal = vault.balances(feeReceiver);
        console.log("Fee Receiver Balance (final):", feeReceiverFinal);
        console.log("Close Fee Collected:", feeReceiverFinal - feeReceiverAfterOpen);
        console.log("Total Fee Collected:", feeReceiverFinal - feeReceiverBefore);

        if (feeReceiverFinal > feeReceiverBefore) {
            console.log("\n[PASS] Fee collection working!");
        } else {
            console.log("\n[FAIL] Fee collection issue!");
        }
    }
}
