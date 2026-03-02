// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Script.sol";
import "../src/spot/TokenFactory.sol";
import "../src/common/PriceFeed.sol";

/**
 * @title DeployFreshTokenFactory
 * @notice Deploy fresh TokenFactory + PriceFeed, wire them together.
 *
 * Usage:
 *   cd contracts
 *   forge script script/DeployFreshTokenFactory.s.sol \
 *     --rpc-url https://base-sepolia-rpc.publicnode.com --broadcast --slow -vvv
 */
contract DeployFreshTokenFactory is Script {
    // Base Sepolia Uniswap V2 Router
    address constant UNISWAP_ROUTER = 0x8cFe327CEc66d1C090Dd72bd0FF11d690C33a2Eb;

    function run() external {
        uint256 deployerKey = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(deployerKey);

        console.log("Deployer:", deployer);
        console.log("Balance:", deployer.balance);

        vm.startBroadcast(deployerKey);

        // 1. Deploy PriceFeed
        PriceFeed priceFeed = new PriceFeed();
        console.log("PriceFeed deployed:", address(priceFeed));

        // 2. Deploy TokenFactory
        TokenFactory tokenFactory = new TokenFactory(deployer, deployer, UNISWAP_ROUTER);
        console.log("TokenFactory deployed:", address(tokenFactory));

        // 3. Wire: PriceFeed <-> TokenFactory
        priceFeed.setTokenFactory(address(tokenFactory));
        tokenFactory.setPriceFeed(address(priceFeed));
        console.log("PriceFeed <-> TokenFactory wired");

        vm.stopBroadcast();

        console.log("\n========================================");
        console.log("Fresh Deploy Complete!");
        console.log("  TokenFactory:", address(tokenFactory));
        console.log("  PriceFeed:   ", address(priceFeed));
        console.log("========================================");
    }
}
