// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Script.sol";
import "../src/core/PositionManager.sol";

contract UpgradePositionManagerScript is Script {
    function run() external {
        uint256 deployerKey = vm.envUint("PRIVATE_KEY");

        // Existing contract addresses
        address vault = 0x467a18E3Ec98587Cd88683E6F9e1792C480C09c7;
        address priceFeed = 0xd69A4DB60cEc962A46C6B9Bc8CC0883081c4eFb7;
        address riskManager = 0xd4EE5BF901E6812E74a20306F5732326Ced89126;
        address fundingRate = 0x9Abe85f3bBee0f06330E8703e29B327CE551Ba10;
        address liquidation = 0x468B589c68dBe29b2BC2b765108D63B61805e982;

        vm.startBroadcast(deployerKey);

        // Deploy new PositionManager
        PositionManager newPM = new PositionManager(vault, priceFeed, riskManager);

        // Configure the new PositionManager
        newPM.setFundingRate(fundingRate);
        newPM.setLiquidation(liquidation);

        console.log("New PositionManager deployed at:", address(newPM));

        vm.stopBroadcast();
    }
}
