// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Script.sol";
import "../src/perpetual/ExternalTokenRegistry.sol";

/**
 * @title DeployExternalRegistry
 * @notice Deploy the registry that gates third-party meme-token listings
 *         (fee + LP bond + admin approval flow).
 *
 * Required env vars:
 *   PRIVATE_KEY                   — deployer (also becomes initial owner)
 *   WBNB_ADDRESS                  — WBNB contract on the target chain
 *   TREASURY_ADDRESS              — where listing fees + slashed LP flow
 *   ADMIN_ADDRESS                 — moderator role (can be same as deployer initially)
 *   LISTING_FEE_BNB_WEI           — e.g. "833000000000000000" for ~$500 @ $600 BNB
 *
 * Usage:
 *   forge script script/DeployExternalRegistry.s.sol --rpc-url $RPC_URL --broadcast -vvv
 *
 * After deployment:
 *   1. Update .env / .env.production with the printed address under
 *      NEXT_PUBLIC_EXTERNAL_TOKEN_REGISTRY_ADDRESS + EXTERNAL_TOKEN_REGISTRY_ADDRESS
 *   2. Update deployments/97.json (or deployments/56.json for mainnet)
 *   3. Transfer admin role to a multisig via registry.setAdmin(multisig)
 *   4. Update tier LP thresholds if BNB price diverges from default $600
 */
contract DeployExternalRegistry is Script {
    function run() external {
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");
        address wbnb     = vm.envAddress("WBNB_ADDRESS");
        address treasury = vm.envAddress("TREASURY_ADDRESS");
        address admin    = vm.envAddress("ADMIN_ADDRESS");
        uint256 listingFee = vm.envUint("LISTING_FEE_BNB_WEI");

        address deployer = vm.addr(deployerPrivateKey);

        console.log("=== ExternalTokenRegistry deploy ===");
        console.log("Deployer:     ", deployer);
        console.log("WBNB:         ", wbnb);
        console.log("Treasury:     ", treasury);
        console.log("Admin:        ", admin);
        console.log("Listing fee:  ", listingFee, "wei (BNB)");

        vm.startBroadcast(deployerPrivateKey);

        ExternalTokenRegistry registry = new ExternalTokenRegistry(
            wbnb,
            treasury,
            admin,
            listingFee
        );

        console.log("\nExternalTokenRegistry:", address(registry));

        // Print default tier thresholds so the operator can verify BNB/USD
        // assumption ($600) matches current market price
        console.log("\n-- Default tier min-LP (wei) --");
        console.log("2x:  ", registry.tierMinLP(IExternalTokenRegistry.LeverageTier.TIER_2X));
        console.log("3x:  ", registry.tierMinLP(IExternalTokenRegistry.LeverageTier.TIER_3X));
        console.log("5x:  ", registry.tierMinLP(IExternalTokenRegistry.LeverageTier.TIER_5X));
        console.log("7x:  ", registry.tierMinLP(IExternalTokenRegistry.LeverageTier.TIER_7X));
        console.log("10x: ", registry.tierMinLP(IExternalTokenRegistry.LeverageTier.TIER_10X));

        vm.stopBroadcast();

        console.log("\nNEXT STEPS:");
        console.log("1. Set env var: NEXT_PUBLIC_EXTERNAL_TOKEN_REGISTRY_ADDRESS=", address(registry));
        console.log("2. Update deployments/97.json with the new address");
        console.log("3. If admin should be a multisig, call registry.setAdmin(<multisig>)");
    }
}
