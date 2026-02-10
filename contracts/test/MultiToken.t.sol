// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Test.sol";
import "../src/common/Vault.sol";
import "../src/perpetual/PositionManager.sol";
import "../src/perpetual/RiskManager.sol";
import "../src/perpetual/Liquidation.sol";
import "../src/common/PriceFeed.sol";
import "../src/perpetual/FundingRate.sol";
import "../src/periphery/Reader.sol";

/**
 * @title MultiTokenTest
 * @notice 多代币永续交易功能测试
 * @dev 测试多代币开仓、平仓、清算、Reader 批量读取等功能
 */
contract MultiTokenTest is Test {
    // ============================================================
    // Contracts
    // ============================================================

    Vault public vault;
    PositionManager public positionManager;
    RiskManager public riskManager;
    Liquidation public liquidation;
    PriceFeed public priceFeed;
    FundingRate public fundingRate;
    Reader public reader;

    // ============================================================
    // Mock Tokens
    // ============================================================

    address public tokenA = address(0xA);
    address public tokenB = address(0xB);
    address public tokenC = address(0xC);

    // ============================================================
    // Users
    // ============================================================

    address public owner = address(this);
    address public user1 = address(0x1001);
    address public user2 = address(0x1002);
    address public user3 = address(0x1003);
    address public liquidator = address(0x1004);

    // ============================================================
    // Constants
    // ============================================================

    uint256 public constant PRECISION = 1e18;
    uint256 public constant LEVERAGE_PRECISION = 1e4;
    uint256 public constant INITIAL_PRICE_A = 100 * 1e18;  // Token A: $100
    uint256 public constant INITIAL_PRICE_B = 50 * 1e18;   // Token B: $50
    uint256 public constant INITIAL_PRICE_C = 200 * 1e18;  // Token C: $200

    // ============================================================
    // Setup
    // ============================================================

    function setUp() public {
        // Set reasonable block timestamp
        vm.warp(1 hours);

        // Deploy contracts
        vault = new Vault();
        priceFeed = new PriceFeed();
        riskManager = new RiskManager();

        positionManager = new PositionManager(
            address(vault),
            address(priceFeed),
            address(riskManager)
        );

        liquidation = new Liquidation(
            address(positionManager),
            address(vault),
            address(riskManager),
            address(priceFeed)
        );

        fundingRate = new FundingRate(address(positionManager), address(vault), address(priceFeed));

        reader = new Reader(address(positionManager), address(priceFeed), address(vault));

        // Configure contracts
        vault.setAuthorizedContract(address(positionManager), true);
        vault.setAuthorizedContract(address(liquidation), true);
        vault.setInsuranceFund(address(liquidation));

        positionManager.setAuthorizedContract(address(liquidation), true);
        positionManager.setFundingRate(address(fundingRate));

        riskManager.setPositionManager(address(positionManager));
        riskManager.setVault(address(vault));
        riskManager.setInsuranceFund(address(liquidation));

        // Initialize prices for tokens (simplified: no TWAP, no deviation protection)
        priceFeed.addSupportedToken(tokenA, INITIAL_PRICE_A);
        priceFeed.addSupportedToken(tokenB, INITIAL_PRICE_B);
        priceFeed.addSupportedToken(tokenC, INITIAL_PRICE_C);

        // Set test contract as TokenFactory for price updates
        priceFeed.setTokenFactory(address(this));

        // Deposit insurance fund
        vm.deal(owner, 1000 ether);
        liquidation.depositInsuranceFund{value: 500 ether}();

        // Fund users
        vm.deal(user1, 100 ether);
        vm.deal(user2, 100 ether);
        vm.deal(user3, 100 ether);
        vm.deal(liquidator, 10 ether);

        // Users deposit to vault
        vm.prank(user1);
        vault.deposit{value: 50 ether}();

        vm.prank(user2);
        vault.deposit{value: 50 ether}();

        vm.prank(user3);
        vault.deposit{value: 50 ether}();
    }

    // ============================================================
    // Multi-Token Position Tests
    // ============================================================

    function test_MultiToken_OpenLongToken() public {
        uint256 size = 10 ether;
        uint256 leverage = 10 * LEVERAGE_PRECISION; // 10x

        vm.prank(user1);
        positionManager.openLongToken(tokenA, size, leverage, IPositionManager.MarginMode.ISOLATED);

        IPositionManager.PositionEx memory pos = positionManager.getPositionByToken(user1, tokenA);

        assertEq(pos.token, tokenA, "Token should match");
        assertTrue(pos.isLong, "Should be long");
        assertEq(pos.size, size, "Size should match");
        assertEq(pos.leverage, leverage, "Leverage should match");
        assertEq(pos.entryPrice, INITIAL_PRICE_A, "Entry price should match");
    }

    function test_MultiToken_OpenShortToken() public {
        uint256 size = 5 ether;
        uint256 leverage = 5 * LEVERAGE_PRECISION; // 5x

        vm.prank(user2);
        positionManager.openShortToken(tokenB, size, leverage, IPositionManager.MarginMode.ISOLATED);

        IPositionManager.PositionEx memory pos = positionManager.getPositionByToken(user2, tokenB);

        assertEq(pos.token, tokenB, "Token should match");
        assertFalse(pos.isLong, "Should be short");
        assertEq(pos.size, size, "Size should match");
        assertEq(pos.leverage, leverage, "Leverage should match");
    }

    function test_MultiToken_MultiplePositions() public {
        // User1 opens positions on multiple tokens
        vm.startPrank(user1);

        positionManager.openLongToken(tokenA, 5 ether, 5 * LEVERAGE_PRECISION, IPositionManager.MarginMode.ISOLATED);
        positionManager.openShortToken(tokenB, 3 ether, 3 * LEVERAGE_PRECISION, IPositionManager.MarginMode.ISOLATED);

        vm.stopPrank();

        IPositionManager.PositionEx memory posA = positionManager.getPositionByToken(user1, tokenA);
        IPositionManager.PositionEx memory posB = positionManager.getPositionByToken(user1, tokenB);

        assertEq(posA.size, 5 ether, "Token A position size");
        assertTrue(posA.isLong, "Token A should be long");

        assertEq(posB.size, 3 ether, "Token B position size");
        assertFalse(posB.isLong, "Token B should be short");
    }

    function test_MultiToken_ClosePosition() public {
        // Open position
        vm.prank(user1);
        positionManager.openLongToken(tokenA, 10 ether, 10 * LEVERAGE_PRECISION, IPositionManager.MarginMode.ISOLATED);

        // Close position
        vm.prank(user1);
        positionManager.closePositionToken(tokenA);

        IPositionManager.PositionEx memory pos = positionManager.getPositionByToken(user1, tokenA);
        assertEq(pos.size, 0, "Position should be closed");
    }

    // ============================================================
    // Multi-Token PnL Tests
    // ============================================================

    function test_MultiToken_PnL_Long_Profit() public {
        uint256 size = 10 ether;
        uint256 leverage = 10 * LEVERAGE_PRECISION;

        vm.prank(user1);
        positionManager.openLongToken(tokenA, size, leverage, IPositionManager.MarginMode.ISOLATED);

        // Price increases 10%
        uint256 newPrice = INITIAL_PRICE_A * 110 / 100;
        priceFeed.updateTokenPriceFromFactory(tokenA, newPrice);

        int256 pnl = positionManager.getTokenUnrealizedPnL(user1, tokenA);

        // Expected PnL: size * (newPrice - entryPrice) / entryPrice
        // = 10 ether * (110 - 100) / 100 = 1 ether
        // Note: Actual PnL may be slightly less due to fees deducted from position
        assertTrue(pnl > 0, "PnL should be positive");
        // Allow 35% tolerance for fees
        assertApproxEqRel(uint256(pnl), 1 ether, 0.35e18, "PnL should be positive (fees may apply)");
    }

    function test_MultiToken_PnL_Short_Profit() public {
        uint256 size = 10 ether;
        uint256 leverage = 10 * LEVERAGE_PRECISION;

        vm.prank(user1);
        positionManager.openShortToken(tokenB, size, leverage, IPositionManager.MarginMode.ISOLATED);

        // Price decreases 10%
        uint256 newPrice = INITIAL_PRICE_B * 90 / 100;
        priceFeed.updateTokenPriceFromFactory(tokenB, newPrice);

        int256 pnl = positionManager.getTokenUnrealizedPnL(user1, tokenB);

        assertTrue(pnl > 0, "Short PnL should be positive when price drops");
    }

    function test_MultiToken_PnL_Long_Loss() public {
        uint256 size = 10 ether;
        uint256 leverage = 10 * LEVERAGE_PRECISION;

        vm.prank(user1);
        positionManager.openLongToken(tokenA, size, leverage, IPositionManager.MarginMode.ISOLATED);

        // Price decreases 5%
        uint256 newPrice = INITIAL_PRICE_A * 95 / 100;
        priceFeed.updateTokenPriceFromFactory(tokenA, newPrice);

        int256 pnl = positionManager.getTokenUnrealizedPnL(user1, tokenA);

        assertTrue(pnl < 0, "PnL should be negative");
    }

    // ============================================================
    // Multi-Token Liquidation Tests
    // ============================================================

    function test_MultiToken_LiquidationPrice() public {
        uint256 size = 10 ether;
        uint256 leverage = 10 * LEVERAGE_PRECISION; // 10x

        vm.prank(user1);
        positionManager.openLongToken(tokenA, size, leverage, IPositionManager.MarginMode.ISOLATED);

        uint256 liqPrice = positionManager.getTokenLiquidationPrice(user1, tokenA);

        // For 10x leverage long, liquidation price should be around 90% of entry
        // (depends on maintenance margin rate)
        assertTrue(liqPrice < INITIAL_PRICE_A, "Liq price should be below entry for long");
        assertTrue(liqPrice > 0, "Liq price should be positive");
    }

    function test_MultiToken_CanLiquidate() public {
        uint256 size = 10 ether;
        uint256 leverage = 20 * LEVERAGE_PRECISION; // 20x

        vm.prank(user1);
        positionManager.openLongToken(tokenA, size, leverage, IPositionManager.MarginMode.ISOLATED);

        // Initially should not be liquidatable
        bool canLiqBefore = positionManager.canLiquidateToken(user1, tokenA);
        assertFalse(canLiqBefore, "Should not be liquidatable initially");

        // Drop price significantly (50%)
        uint256 crashPrice = INITIAL_PRICE_A * 50 / 100;
        priceFeed.updateTokenPriceFromFactory(tokenA, crashPrice);

        bool canLiqAfter = positionManager.canLiquidateToken(user1, tokenA);
        assertTrue(canLiqAfter, "Should be liquidatable after crash");
    }

    function test_MultiToken_LiquidationCondition() public {
        uint256 size = 5 ether;
        uint256 leverage = 10 * LEVERAGE_PRECISION;

        vm.prank(user1);
        positionManager.openLongToken(tokenA, size, leverage, IPositionManager.MarginMode.ISOLATED);

        // Get position info
        IPositionManager.PositionEx memory pos = positionManager.getPositionByToken(user1, tokenA);
        assertTrue(pos.size > 0, "Position should exist");

        // Initially not liquidatable
        bool canLiqBefore = positionManager.canLiquidateToken(user1, tokenA);
        assertFalse(canLiqBefore, "Should not be liquidatable initially");

        // Drop price to trigger liquidation condition
        uint256 crashPrice = INITIAL_PRICE_A * 85 / 100;  // 15% drop
        priceFeed.updateTokenPriceFromFactory(tokenA, crashPrice);

        // Verify liquidation condition is met
        bool canLiqAfter = positionManager.canLiquidateToken(user1, tokenA);
        assertTrue(canLiqAfter, "Should be liquidatable after price drop");

        // Verify PnL is negative
        int256 pnl = positionManager.getTokenUnrealizedPnL(user1, tokenA);
        assertTrue(pnl < 0, "PnL should be negative");

        // Verify margin ratio is low
        uint256 marginRatio = positionManager.getTokenMarginRatio(user1, tokenA);
        // Maintenance margin is typically around 0.5-1%
        assertTrue(marginRatio < 0.05e18, "Margin ratio should be very low");
    }

    // ============================================================
    // Multi-Token Margin Ratio Tests
    // ============================================================

    function test_MultiToken_MarginRatio() public {
        uint256 size = 10 ether;
        uint256 leverage = 10 * LEVERAGE_PRECISION;

        vm.prank(user1);
        positionManager.openLongToken(tokenA, size, leverage, IPositionManager.MarginMode.ISOLATED);

        uint256 marginRatio = positionManager.getTokenMarginRatio(user1, tokenA);

        // At entry, margin ratio should be around 10% (1/leverage)
        assertTrue(marginRatio > 0, "Margin ratio should be positive");
        // 10x leverage = 10% margin = 0.1e18
        assertApproxEqRel(marginRatio, 0.1e18, 0.1e18, "Margin ratio should be ~10%");
    }

    function test_MultiToken_MarginRatio_Changes() public {
        uint256 size = 10 ether;
        uint256 leverage = 10 * LEVERAGE_PRECISION;

        vm.prank(user1);
        positionManager.openLongToken(tokenA, size, leverage, IPositionManager.MarginMode.ISOLATED);

        uint256 marginRatioBefore = positionManager.getTokenMarginRatio(user1, tokenA);

        // Price increases 10%
        uint256 newPrice = INITIAL_PRICE_A * 110 / 100;
        priceFeed.updateTokenPriceFromFactory(tokenA, newPrice);

        uint256 marginRatioAfter = positionManager.getTokenMarginRatio(user1, tokenA);

        assertTrue(marginRatioAfter > marginRatioBefore, "Margin ratio should increase with profit");
    }

    // ============================================================
    // Reader Contract Tests
    // ============================================================

    function test_Reader_GetPositionsBatch() public {
        // Open positions for multiple users
        vm.prank(user1);
        positionManager.openLongToken(tokenA, 10 ether, 10 * LEVERAGE_PRECISION, IPositionManager.MarginMode.ISOLATED);

        vm.prank(user2);
        positionManager.openShortToken(tokenA, 5 ether, 5 * LEVERAGE_PRECISION, IPositionManager.MarginMode.ISOLATED);

        address[] memory users = new address[](3);
        users[0] = user1;
        users[1] = user2;
        users[2] = user3; // No position

        Reader.PositionInfo[] memory positions = reader.getPositionsBatch(users, tokenA);

        assertEq(positions.length, 3, "Should return 3 positions");
        assertEq(positions[0].size, 10 ether, "User1 size");
        assertTrue(positions[0].isLong, "User1 long");
        assertEq(positions[1].size, 5 ether, "User2 size");
        assertFalse(positions[1].isLong, "User2 short");
        assertEq(positions[2].size, 0, "User3 no position");
    }

    function test_Reader_GetUserPositionsBatch() public {
        // User opens positions on multiple tokens
        vm.startPrank(user1);
        positionManager.openLongToken(tokenA, 10 ether, 10 * LEVERAGE_PRECISION, IPositionManager.MarginMode.ISOLATED);
        positionManager.openShortToken(tokenB, 5 ether, 5 * LEVERAGE_PRECISION, IPositionManager.MarginMode.ISOLATED);
        vm.stopPrank();

        address[] memory tokens = new address[](3);
        tokens[0] = tokenA;
        tokens[1] = tokenB;
        tokens[2] = tokenC; // No position

        Reader.PositionInfo[] memory positions = reader.getUserPositionsBatch(user1, tokens);

        assertEq(positions.length, 3, "Should return 3 positions");
        assertEq(positions[0].size, 10 ether, "TokenA size");
        assertEq(positions[1].size, 5 ether, "TokenB size");
        assertEq(positions[2].size, 0, "TokenC no position");
    }

    function test_Reader_GetTokenInfoBatch() public {
        address[] memory tokens = new address[](3);
        tokens[0] = tokenA;
        tokens[1] = tokenB;
        tokens[2] = tokenC;

        Reader.TokenInfo[] memory infos = reader.getTokenInfoBatch(tokens);

        assertEq(infos.length, 3, "Should return 3 token infos");
        assertEq(infos[0].markPrice, INITIAL_PRICE_A, "TokenA price");
        assertEq(infos[1].markPrice, INITIAL_PRICE_B, "TokenB price");
        assertEq(infos[2].markPrice, INITIAL_PRICE_C, "TokenC price");
    }

    function test_Reader_GetUserBalancesBatch() public {
        address[] memory users = new address[](3);
        users[0] = user1;
        users[1] = user2;
        users[2] = user3;

        Reader.UserBalanceInfo[] memory balances = reader.getUserBalancesBatch(users);

        assertEq(balances.length, 3, "Should return 3 balances");
        assertEq(balances[0].vaultBalance, 50 ether, "User1 balance");
        assertEq(balances[1].vaultBalance, 50 ether, "User2 balance");
        assertEq(balances[2].vaultBalance, 50 ether, "User3 balance");
    }

    function test_Reader_GetUserDashboard() public {
        vm.prank(user1);
        positionManager.openLongToken(tokenA, 10 ether, 10 * LEVERAGE_PRECISION, IPositionManager.MarginMode.ISOLATED);

        address[] memory tokens = new address[](2);
        tokens[0] = tokenA;
        tokens[1] = tokenB;

        (
            uint256 vaultBalance,
            uint256 lockedBalance,
            Reader.PositionInfo[] memory positions,
            Reader.TokenInfo[] memory tokenInfos
        ) = reader.getUserDashboard(user1, tokens);

        assertTrue(vaultBalance > 0, "Should have vault balance");
        assertTrue(lockedBalance > 0, "Should have locked balance");
        assertEq(positions.length, 2, "Should have 2 positions");
        assertEq(tokenInfos.length, 2, "Should have 2 token infos");
        assertEq(positions[0].size, 10 ether, "TokenA position");
    }

    function test_Reader_CheckLiquidatableBatch() public {
        // User1 opens high leverage position
        vm.prank(user1);
        positionManager.openLongToken(tokenA, 10 ether, 20 * LEVERAGE_PRECISION, IPositionManager.MarginMode.ISOLATED);

        // User2 opens low leverage position
        vm.prank(user2);
        positionManager.openLongToken(tokenA, 5 ether, 2 * LEVERAGE_PRECISION, IPositionManager.MarginMode.ISOLATED);

        // Drop price
        priceFeed.updateTokenPriceFromFactory(tokenA, INITIAL_PRICE_A * 50 / 100);

        address[] memory users = new address[](2);
        users[0] = user1;
        users[1] = user2;

        (bool[] memory liquidatable, int256[] memory pnls) = reader.checkLiquidatableBatch(users, tokenA);

        assertEq(liquidatable.length, 2, "Should return 2 results");
        assertTrue(liquidatable[0], "User1 should be liquidatable");
        // User2 may or may not be liquidatable depending on margin
        assertTrue(pnls[0] < 0, "User1 should have negative PnL");
        assertTrue(pnls[1] < 0, "User2 should have negative PnL");
    }

    function test_Reader_GetMarketOverview() public {
        // Open some positions to create market activity
        vm.prank(user1);
        positionManager.openLongToken(tokenA, 10 ether, 10 * LEVERAGE_PRECISION, IPositionManager.MarginMode.ISOLATED);

        vm.prank(user2);
        positionManager.openShortToken(tokenA, 5 ether, 5 * LEVERAGE_PRECISION, IPositionManager.MarginMode.ISOLATED);

        address[] memory tokens = new address[](2);
        tokens[0] = tokenA;
        tokens[1] = tokenB;

        (
            uint256[] memory markPrices,
            uint256[] memory totalLongs,
            uint256[] memory totalShorts
        ) = reader.getMarketOverview(tokens);

        assertEq(markPrices.length, 2, "Should return 2 prices");
        assertEq(markPrices[0], INITIAL_PRICE_A, "TokenA price");
        assertEq(totalLongs[0], 10 ether, "TokenA total longs");
        assertEq(totalShorts[0], 5 ether, "TokenA total shorts");
    }
}
