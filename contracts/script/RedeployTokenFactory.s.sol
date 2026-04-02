// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Script.sol";
import "../src/spot/TokenFactory.sol";
import "../src/common/PriceFeed.sol";
import "../src/perpetual/Liquidation.sol";

/**
 * @title RedeployTokenFactory
 * @notice 只重新部署 TokenFactory（修复 WETH 地址 bug），并重新连接到已有合约
 *
 * Usage:
 *   cd contracts
 *   forge script script/RedeployTokenFactory.s.sol \
 *     --rpc-url https://data-seed-prebsc-1-s1.binance.org:8545/ \
 *     --broadcast --slow -vvv
 *
 * 修复内容: WETH 从 constant(主网地址) 改为 immutable(构造函数传入)
 * 影响: 毕业功能 (_graduate) 中 getPair(token, WETH) 现在使用正确的测试网 WBNB 地址
 */
contract RedeployTokenFactory is Script {
    // ── BSC Testnet Constants ──
    address constant WBNB = 0xae13d989daC2f0dEbFf460aC112a837C89BAa7cd;
    address constant PANCAKE_ROUTER_V2 = 0xD99D1c33F9fC3444f8101754aBC46c52416550D1;

    // ── Existing deployed contracts (BSC Testnet 2026-03-21 — from deployments/97.json) ──
    address constant PRICE_FEED = 0xB480517B96558E4467cfa1d91d8E6592c66B564D;
    address constant LIQUIDATION = 0x5587Cf6b94E52e2Da0B8412381fcdfe4D39CA562;

    function run() external {
        uint256 deployerKey = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(deployerKey);

        console.log("=== RedeployTokenFactory (buyExactTokens) ===");
        console.log("Deployer:", deployer);
        console.log("Balance:", deployer.balance);
        console.log("WBNB (Testnet):", WBNB);

        vm.startBroadcast(deployerKey);

        // 1. Deploy new TokenFactory with correct WBNB
        TokenFactory newFactory = new TokenFactory(deployer, deployer, PANCAKE_ROUTER_V2, WBNB);
        console.log("\nNew TokenFactory:", address(newFactory));
        console.log("  WETH:", newFactory.WETH());
        console.log("  Router:", newFactory.uniswapV2Router());

        // 2. Wire PriceFeed <-> new TokenFactory
        PriceFeed priceFeed = PriceFeed(PRICE_FEED);
        priceFeed.setTokenFactory(address(newFactory));
        newFactory.setPriceFeed(PRICE_FEED);
        console.log("  PriceFeed <-> TokenFactory wired");

        // 3. Wire Liquidation -> new TokenFactory
        Liquidation liquidation = Liquidation(payable(LIQUIDATION));
        liquidation.setTokenFactory(address(newFactory));
        console.log("  Liquidation -> TokenFactory wired");

        vm.stopBroadcast();

        console.log("\n========================================");
        console.log("TokenFactory Redeploy Complete!");
        console.log("  NEW TokenFactory:", address(newFactory));
        console.log("  WETH (correct):", WBNB);
        console.log("========================================");
        console.log("\nIMPORTANT: Update these config files with new address:");
        console.log("  1. frontend/contracts/deployments/base-sepolia.json");
        console.log("  2. backend/src/matching/config.ts");
        console.log("  3. backend/configs/config.yaml");
    }
}
