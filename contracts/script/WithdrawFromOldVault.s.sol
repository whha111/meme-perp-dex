// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Script.sol";

interface IVault {
    function getBalance(address user) external view returns (uint256);
    function withdraw(uint256 amount) external;
}

contract WithdrawFromOldVault is Script {
    // Old Vault address where 0.1246 ETH was deposited
    address constant OLD_VAULT = 0x4cDb69aed6AE81D65F79d7849aD2C64633914d7A;

    function run() external {
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(deployerPrivateKey);

        console.log("Checking balance in old Vault for:", deployer);

        IVault vault = IVault(OLD_VAULT);
        uint256 balance = vault.getBalance(deployer);

        console.log("Balance in old Vault:", balance);
        console.log("Balance in ETH:", balance / 1e18);

        if (balance > 0) {
            console.log("Withdrawing all balance...");
            vm.startBroadcast(deployerPrivateKey);
            vault.withdraw(balance);
            vm.stopBroadcast();
            console.log("Withdrawal complete!");
        } else {
            console.log("No balance to withdraw");
        }
    }
}
