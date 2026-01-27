// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Script.sol";
import "../src/core/PriceFeed.sol";

interface ITokenFactory {
    function getAllTokens() external view returns (address[] memory);
    function getPoolState(address token) external view returns (
        uint256 realETHReserve,
        uint256 realTokenReserve,
        uint256 soldTokens,
        bool isGraduated,
        bool isActive,
        address creator,
        uint64 createdAt,
        string memory metadataURI
    );
}

/**
 * @title AddTokensToPriceFeed
 * @notice 添加现有代币到 PriceFeed
 */
contract AddTokensToPriceFeed is Script {
    address constant TOKEN_FACTORY = 0xE0ddf67E89f5773c960Bc2329109815E8c66BAAe;
    address constant PRICE_FEED = 0xd69A4DB60cEc962A46C6B9Bc8CC0883081c4eFb7;

    function run() external {
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(deployerPrivateKey);

        console.log("Deployer:", deployer);

        // Get all tokens
        address[] memory tokens = ITokenFactory(TOKEN_FACTORY).getAllTokens();
        console.log("Total tokens:", tokens.length);

        vm.startBroadcast(deployerPrivateKey);

        PriceFeed priceFeed = PriceFeed(PRICE_FEED);
        uint256 added = 0;

        // Add recent tokens (last 10)
        uint256 startIndex = tokens.length > 10 ? tokens.length - 10 : 0;

        for (uint i = startIndex; i < tokens.length; i++) {
            address token = tokens[i];

            // Check if already supported
            if (priceFeed.isTokenSupported(token)) {
                console.log("Already supported:", token);
                continue;
            }

            (
                uint256 realETHReserve,
                uint256 realTokenReserve,
                ,
                ,
                bool isActive,
                ,
                ,
            ) = ITokenFactory(TOKEN_FACTORY).getPoolState(token);

            if (isActive && realTokenReserve > 0 && realETHReserve > 0) {
                // Calculate price: ETH reserve / Token reserve
                // Use safer math to avoid overflow
                uint256 price;
                if (realTokenReserve >= 1e18) {
                    // For large token reserves, divide first
                    price = (realETHReserve * 1e18) / realTokenReserve;
                } else {
                    // For small token reserves
                    price = realETHReserve * 1e18 / realTokenReserve;
                }

                // Ensure price is reasonable (between 1 wei and 1000 ETH per token)
                if (price > 0 && price < 1e21) {
                    priceFeed.addSupportedToken(token, price);
                    console.log("Added token:", token);
                    added++;
                } else {
                    console.log("Skipped (invalid price):", token);
                }
            } else {
                console.log("Skipped (inactive):", token);
            }
        }

        vm.stopBroadcast();

        console.log("\n========================================");
        console.log("Added", added, "tokens to PriceFeed");
        console.log("========================================");
    }
}
