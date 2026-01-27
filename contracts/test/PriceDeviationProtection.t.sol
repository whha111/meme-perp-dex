// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Test.sol";
import "../src/core/PriceFeed.sol";

/**
 * @title PriceDeviationProtection Test
 * @notice S-001: 测试价格偏差保护机制
 */
contract PriceDeviationProtectionTest is Test {
    PriceFeed public priceFeed;

    address public owner = address(this);
    address public amm = address(0x1);
    address public tokenFactory = address(0x2);
    address public testToken = address(0x100);

    uint256 public constant PRICE_PRECISION = 1e18;
    uint256 public constant INITIAL_PRICE = 100 ether; // $100

    function setUp() public {
        // 设置合理的初始时间戳（避免 TWAP 计算时的 underflow）
        vm.warp(1000000);

        priceFeed = new PriceFeed();
        priceFeed.setAMM(amm);
        priceFeed.setTokenFactory(tokenFactory);

        // 初始化价格
        priceFeed.initializePrice(INITIAL_PRICE);

        // 添加测试代币
        priceFeed.addSupportedToken(testToken, INITIAL_PRICE);
    }

    // ============================================================
    // 基础功能测试
    // ============================================================

    function test_DeviationProtection_DefaultConfig() public view {
        (
            uint256 currentMax,
            bool enabled,
            bool strict,
            uint256 defaultMax,
            uint256 absoluteMax
        ) = priceFeed.getDeviationConfig();

        assertEq(currentMax, 10e16, "Default max deviation should be 10%");
        assertTrue(enabled, "Protection should be enabled by default");
        assertFalse(strict, "Strict mode should be disabled by default");
        assertEq(defaultMax, 10e16, "Default max should be 10%");
        assertEq(absoluteMax, 50e16, "Absolute max should be 50%");
    }

    function test_DeviationProtection_SetMaxDeviation() public {
        uint256 newMax = 5e16; // 5%
        priceFeed.setMaxPriceDeviation(newMax);

        (uint256 currentMax, , , , ) = priceFeed.getDeviationConfig();
        assertEq(currentMax, newMax, "Max deviation should be updated");
    }

    function test_DeviationProtection_SetMaxDeviation_RevertOnZero() public {
        vm.expectRevert(PriceFeed.InvalidDeviation.selector);
        priceFeed.setMaxPriceDeviation(0);
    }

    function test_DeviationProtection_SetMaxDeviation_RevertOnTooHigh() public {
        vm.expectRevert(PriceFeed.InvalidDeviation.selector);
        priceFeed.setMaxPriceDeviation(51e16); // > 50%
    }

    // ============================================================
    // 价格更新偏差检查测试
    // ============================================================

    function test_PriceUpdate_NormalUpdate() public {
        // 正常价格更新 (5% 变化)
        uint256 newPrice = 105 ether;

        vm.prank(amm);
        priceFeed.updatePrice(newPrice);

        assertEq(priceFeed.lastPrice(), newPrice, "Price should be updated normally");
    }

    function test_PriceUpdate_LimitedUpdate_NonStrictMode() public {
        // 大幅价格变化 (25% 变化，超过 10% 限制)
        uint256 newPrice = 125 ether;

        vm.prank(amm);
        priceFeed.updatePrice(newPrice);

        // 非严格模式下，价格应该被限制
        uint256 maxMove = (INITIAL_PRICE * 10e16) / PRICE_PRECISION; // 10%
        uint256 expectedPrice = INITIAL_PRICE + maxMove; // 110 ether

        assertEq(priceFeed.lastPrice(), expectedPrice, "Price should be limited to max deviation");
    }

    function test_PriceUpdate_Revert_StrictMode() public {
        // 启用严格模式
        priceFeed.setStrictMode(true);

        uint256 newPrice = 125 ether; // 25% 变化

        vm.prank(amm);
        vm.expectRevert(
            abi.encodeWithSelector(
                PriceFeed.PriceUpdateRejectedDueToDeviation.selector,
                newPrice,
                INITIAL_PRICE,
                25e16 // 25% deviation
            )
        );
        priceFeed.updatePrice(newPrice);
    }

    function test_PriceUpdate_DownwardLimit() public {
        // 大幅下跌 (30% 下跌)
        uint256 newPrice = 70 ether;

        vm.prank(amm);
        priceFeed.updatePrice(newPrice);

        // 应该被限制在 -10%
        uint256 maxMove = (INITIAL_PRICE * 10e16) / PRICE_PRECISION;
        uint256 expectedPrice = INITIAL_PRICE - maxMove; // 90 ether

        assertEq(priceFeed.lastPrice(), expectedPrice, "Downward price should be limited");
    }

    // ============================================================
    // Mark Price 偏差保护测试
    // ============================================================

    function test_MarkPrice_NormalCalculation() public {
        // 建立足够的 TWAP 历史
        _buildPriceHistory(INITIAL_PRICE, 10);

        uint256 markPrice = priceFeed.getMarkPrice();

        // 正常情况：mark = spot * 0.7 + twap * 0.3
        // spot = twap = 100 ether, mark = 100 ether
        assertEq(markPrice, INITIAL_PRICE, "Mark price should equal spot when no deviation");
    }

    function test_MarkPrice_SafePrice_HighDeviation() public {
        // 建立 TWAP 历史
        _buildPriceHistory(INITIAL_PRICE, 10);

        // 手动设置一个高偏差场景（通过逐步更新价格）
        // 由于有限制，需要多次更新
        for (uint256 i = 0; i < 5; i++) {
            uint256 currentPrice = priceFeed.lastPrice();
            uint256 nextPrice = (currentPrice * 110) / 100; // 每次 +10%
            vm.prank(amm);
            priceFeed.updatePrice(nextPrice);
            vm.warp(block.timestamp + 1 minutes);
        }

        // 现在 spot 价格远高于 TWAP
        (uint256 deviation, bool isHealthy) = priceFeed.getPriceDeviation();

        // 获取 mark price（应该使用安全价格）
        uint256 markPrice = priceFeed.getMarkPrice();
        uint256 twap = priceFeed.getTWAP();
        uint256 spot = priceFeed.lastPrice();

        // 如果偏差高，mark price 应该更接近 TWAP
        if (deviation > 10e16) {
            // 验证 mark price 被调整（偏向 TWAP）
            assertTrue(
                markPrice < (spot * 70 + twap * 30) / 100,
                "Mark price should be adjusted towards TWAP"
            );
        }
    }

    function test_MarkPrice_Revert_StrictMode_HighDeviation() public {
        // 建立 TWAP 历史
        _buildPriceHistory(INITIAL_PRICE, 10);

        // 逐步更新价格
        for (uint256 i = 0; i < 5; i++) {
            uint256 currentPrice = priceFeed.lastPrice();
            vm.prank(amm);
            priceFeed.updatePrice((currentPrice * 110) / 100);
            vm.warp(block.timestamp + 1 minutes);
        }

        // 启用严格模式
        priceFeed.setStrictMode(true);

        // 检查偏差
        (uint256 deviation, ) = priceFeed.getPriceDeviation();

        if (deviation > 10e16) {
            vm.expectRevert();
            priceFeed.getMarkPrice();
        }
    }

    // ============================================================
    // 代币级别偏差保护测试
    // ============================================================

    function test_TokenDeviation_CustomConfig() public {
        // 设置代币特定的偏差限制
        uint256 tokenMaxDev = 5e16; // 5%
        priceFeed.setTokenMaxDeviation(testToken, tokenMaxDev);

        (uint256 currentMax, bool enabled, bool usesGlobal) = priceFeed.getTokenDeviationConfig(testToken);

        assertEq(currentMax, tokenMaxDev, "Token max deviation should be set");
        assertTrue(enabled, "Token protection should be enabled");
        assertFalse(usesGlobal, "Should not use global config");
    }

    function test_TokenPriceUpdate_LimitedByCustomConfig() public {
        // 设置代币特定的偏差限制
        priceFeed.setTokenMaxDeviation(testToken, 5e16); // 5%

        // 尝试更新价格 15%
        uint256 newPrice = 115 ether;

        vm.prank(tokenFactory);
        priceFeed.updateTokenPriceFromFactory(testToken, newPrice);

        // 应该被限制在 5%
        uint256 expectedPrice = 105 ether; // 100 + 5%
        assertEq(priceFeed.tokenLastPrice(testToken), expectedPrice, "Token price should be limited");
    }

    // ============================================================
    // 健康状态检查测试
    // ============================================================

    function test_PriceHealthStatus() public {
        _buildPriceHistory(INITIAL_PRICE, 10);

        (
            uint256 spot,
            uint256 twap,
            uint256 mark,
            uint256 deviation,
            uint256 maxAllowed,
            bool isHealthy
        ) = priceFeed.getPriceHealthStatus();

        assertEq(spot, INITIAL_PRICE, "Spot should be initial price");
        assertGt(twap, 0, "TWAP should be calculated");
        assertGt(mark, 0, "Mark should be calculated");
        assertEq(maxAllowed, 10e16, "Max allowed should be default");
        assertTrue(isHealthy, "Price should be healthy");
    }

    function test_CheckPriceUpdate_Preview() public view {
        (bool wouldReject, uint256 deviation, uint256 limitedPrice) = priceFeed.checkPriceUpdate(125 ether);

        assertFalse(wouldReject, "Should not reject in non-strict mode");
        assertEq(deviation, 25e16, "Deviation should be 25%");
        assertEq(limitedPrice, 110 ether, "Limited price should be 110 ether");
    }

    function test_CheckPriceUpdate_Preview_StrictMode() public {
        priceFeed.setStrictMode(true);

        (bool wouldReject, uint256 deviation, ) = priceFeed.checkPriceUpdate(125 ether);

        assertTrue(wouldReject, "Should reject in strict mode");
        assertEq(deviation, 25e16, "Deviation should be 25%");
    }

    // ============================================================
    // 禁用保护测试
    // ============================================================

    function test_DisabledProtection_NoLimit() public {
        priceFeed.setDeviationProtection(false);

        uint256 newPrice = 200 ether; // 100% 变化

        vm.prank(amm);
        priceFeed.updatePrice(newPrice);

        assertEq(priceFeed.lastPrice(), newPrice, "Price should be updated without limit");
    }

    // ============================================================
    // Helper Functions
    // ============================================================

    function _buildPriceHistory(uint256 price, uint256 count) internal {
        for (uint256 i = 0; i < count; i++) {
            vm.warp(block.timestamp + 1 minutes);
            vm.prank(amm);
            priceFeed.updatePrice(price);
        }
    }
}
