// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console} from "forge-std/Script.sol";
import {TokenFactory} from "../src/spot/TokenFactory.sol";

contract DeployTokenFactory is Script {
    // Base Sepolia Uniswap V2 Router (或其他 DEX Router)
    address constant UNISWAP_V2_ROUTER = 0x4752ba5DBc23f44D87826276BF6Fd6b1C372aD24;

    function run() external {
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(deployerPrivateKey);

        console.log("Deployer:", deployer);

        vm.startBroadcast(deployerPrivateKey);

        TokenFactory factory = new TokenFactory(
            deployer,           // initialOwner
            deployer,           // feeReceiver (暂时用部署者地址)
            UNISWAP_V2_ROUTER   // uniswapV2Router
        );

        console.log("TokenFactory deployed at:", address(factory));

        vm.stopBroadcast();
    }
}
