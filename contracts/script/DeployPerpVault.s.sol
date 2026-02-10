// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Script.sol";
import "../src/perpetual/PerpVault.sol";

/**
 * @title DeployPerpVault
 * @notice Deploy the GMX-style LP pool for perpetual trading
 *
 * Usage:
 *   forge script script/DeployPerpVault.s.sol --rpc-url $RPC_URL --broadcast
 *
 * After deployment:
 *   1. PerpVault.setAuthorizedContract(matchingEngineAddress, true)
 *   2. PerpVault.setVault(vaultAddress) — existing Vault.sol for trader margin
 *   3. PerpVault.setMaxOIPerToken(tokenAddress, maxOI) — per-token OI cap
 *   4. Seed initial ETH liquidity: deposit() with ETH
 */
contract DeployPerpVault is Script {
    function run() external {
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(deployerPrivateKey);

        console.log("Deployer:", deployer);

        vm.startBroadcast(deployerPrivateKey);

        // Deploy PerpVault
        PerpVault perpVault = new PerpVault();
        console.log("PerpVault deployed at:", address(perpVault));

        console.log("");
        console.log("=== POST-DEPLOY STEPS ===");
        console.log("1. PerpVault.setAuthorizedContract(<matching_engine>, true)");
        console.log("2. PerpVault.setVault(<vault_address>)");
        console.log("3. PerpVault.setMaxOIPerToken(<token>, <maxOI>)  (optional per-token cap)");
        console.log("4. Seed liquidity: PerpVault.deposit{value: X}()");

        vm.stopBroadcast();
    }
}
