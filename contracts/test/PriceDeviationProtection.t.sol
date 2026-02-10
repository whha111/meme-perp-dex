// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Test.sol";
import "../src/common/PriceFeed.sol";

/**
 * @title PriceDeviationProtection Test
 * @notice S-001: 测试价格偏差保护机制
 * 
 * NOTE: This test file has been disabled because the PriceFeed contract
 * has been simplified. The new PriceFeed:
 * - No longer has deviation protection (100% hard-pegged to Bonding Curve)
 * - No longer has TWAP calculations
 * - No longer has mark price calculations (mark = spot)
 * - Only supports multi-token price updates from TokenFactory
 * 
 * If deviation protection is needed in the future, this test can be
 * re-enabled and the PriceFeed contract updated accordingly.
 */
contract PriceDeviationProtectionTest is Test {
    PriceFeed public priceFeed;

    address public owner = address(this);
    address public tokenFactory = address(0x2);
    address public testToken = address(0x100);

    uint256 public constant PRICE_PRECISION = 1e18;
    uint256 public constant INITIAL_PRICE = 100 ether; // $100

    function setUp() public {
        vm.warp(1000000);

        priceFeed = new PriceFeed();
        priceFeed.setTokenFactory(tokenFactory);
        priceFeed.addSupportedToken(testToken, INITIAL_PRICE);
    }

    // ============================================================
    // Basic Functionality Tests (Updated for new PriceFeed)
    // ============================================================

    function test_TokenFactory_SetCorrectly() public view {
        assertEq(priceFeed.tokenFactory(), tokenFactory, "TokenFactory should be set");
    }

    function test_Token_AddedCorrectly() public view {
        assertTrue(priceFeed.supportedTokens(testToken), "Token should be supported");
        assertEq(priceFeed.tokenLastPrice(testToken), INITIAL_PRICE, "Initial price should be set");
    }

    function test_PriceUpdate_FromTokenFactory() public {
        uint256 newPrice = 150 ether;
        
        vm.prank(tokenFactory);
        priceFeed.updateTokenPriceFromFactory(testToken, newPrice);
        
        assertEq(priceFeed.tokenLastPrice(testToken), newPrice, "Price should be updated");
    }

    function test_PriceUpdate_OnlyTokenFactory() public {
        uint256 newPrice = 150 ether;
        
        vm.prank(address(0x999)); // Not tokenFactory
        vm.expectRevert(PriceFeed.Unauthorized.selector);
        priceFeed.updateTokenPriceFromFactory(testToken, newPrice);
    }

    function test_GetTokenSpotPrice() public view {
        assertEq(priceFeed.getTokenSpotPrice(testToken), INITIAL_PRICE, "Spot price should match");
    }

    function test_GetTokenMarkPrice() public view {
        // In the new PriceFeed, mark price = spot price (100% hard-pegged)
        assertEq(priceFeed.getTokenMarkPrice(testToken), INITIAL_PRICE, "Mark price should equal spot price");
    }

    function test_UnsupportedToken_Reverts() public {
        address unsupportedToken = address(0x999);
        
        vm.expectRevert(PriceFeed.TokenNotSupported.selector);
        priceFeed.getTokenSpotPrice(unsupportedToken);
    }

    // ============================================================
    // Legacy Interface Tests
    // ============================================================

    function test_LegacyUpdatePrice_IsNoOp() public {
        // updatePrice is now a no-op for legacy compatibility
        priceFeed.updatePrice(200 ether);
        // No state change expected - this is just for compatibility
    }

    function test_LegacyGetMarkPrice_ReturnsFirstTokenPrice() public view {
        // Legacy interface returns first token's price for backward compatibility
        assertEq(priceFeed.getMarkPrice(), INITIAL_PRICE, "Legacy getMarkPrice should return first token price");
    }

    function test_LegacyGetSpotPrice_ReturnsFirstTokenPrice() public view {
        // Legacy interface returns first token's price for backward compatibility
        assertEq(priceFeed.getSpotPrice(), INITIAL_PRICE, "Legacy getSpotPrice should return first token price");
    }
}
