// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Script.sol";
import "../src/core/PriceFeed.sol";

interface ITokenFactory {
    function setPriceFeed(address newPriceFeed) external;
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

interface IPositionManager {
    function setPriceFeed(address newPriceFeed) external;
}

/**
 * @title DeployPriceFeedV2
 * @notice 部署带多代币支持的 PriceFeed 合约
 */
contract DeployPriceFeedV2 is Script {
    // 已部署的合约地址 (Base Sepolia)
    address constant TOKEN_FACTORY = 0xE0ddf67E89f5773c960Bc2329109815E8c66BAAe;
    address constant POSITION_MANAGER = 0xeCA6E2f7466c0A1BA6dB3083a09b8B09969D77Ee;
    address constant AMM = 0x9ba6958811cf887536E34316Ea732fB40c3fc06c;

    function run() external {
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(deployerPrivateKey);

        console.log("Deployer:", deployer);
        console.log("Deployer balance:", deployer.balance);

        vm.startBroadcast(deployerPrivateKey);

        // 1. Deploy new PriceFeed contract
        console.log("\n--- Deploying PriceFeed V2 ---");
        PriceFeed priceFeed = new PriceFeed();
        console.log("PriceFeed deployed at:", address(priceFeed));

        // 2. Initialize legacy price (required for getMarkPrice)
        console.log("\n--- Initializing PriceFeed ---");
        priceFeed.initializePrice(1e18); // 1 ETH initial price
        console.log("Initialized legacy price: 1 ETH");

        // 3. Set AMM
        priceFeed.setAMM(AMM);
        console.log("Set AMM:", AMM);

        // 4. Set TokenFactory
        priceFeed.setTokenFactory(TOKEN_FACTORY);
        console.log("Set TokenFactory:", TOKEN_FACTORY);

        // Note: TokenFactory and PositionManager need to be upgraded to support setPriceFeed
        console.log("\nNote: TokenFactory and PositionManager don't have setPriceFeed function");
        console.log("The new tokens will need to be manually added to PriceFeed");

        vm.stopBroadcast();

        // Note: Add tokens manually after deployment using AddTokensToPriceFeed script

        // Output deployment result
        console.log("\n========================================");
        console.log("PriceFeed V2 Deployment Complete!");
        console.log("========================================");
        console.log("PriceFeed Address:", address(priceFeed));
        console.log("\nUpdate base-sepolia.json with new PriceFeed address");
        console.log("========================================");
    }
}
