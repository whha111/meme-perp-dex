// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test, console} from "forge-std/Test.sol";
import {LendingPool} from "../src/spot/LendingPool.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @dev Minimal ERC20 mock with free minting
contract MockERC20 is ERC20 {
    constructor(string memory name_, string memory symbol_) ERC20(name_, symbol_) {}

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}

/**
 * @title LendingPool 测试
 * @notice Comprehensive tests for multi-token P2P lending pool
 *
 * Test coverage:
 * 1. Token enablement (via TokenFactory)
 * 2. Deposit / withdraw with share conversion
 * 3. Borrow / repay with interest accrual
 * 4. Interest rate model (low/high utilization)
 * 5. Max utilization cap (90%)
 * 6. Multi-token isolation
 * 7. claimInterest
 * 8. liquidateBorrow
 * 9. Error conditions (not enabled, insufficient liquidity, unauthorized)
 * 10. Admin functions
 */
contract LendingPoolTest is Test {
    LendingPool public pool;
    MockERC20 public tokenA;
    MockERC20 public tokenB;

    address public owner = address(0x1);
    address public tokenFactory = address(0x2);
    address public matchingEngine = address(0x3);
    address public lender1 = address(0x10);
    address public lender2 = address(0x11);
    address public borrower1 = address(0x20);

    uint256 constant PRECISION = 1e18;

    function setUp() public {
        // Deploy LendingPool
        vm.prank(owner);
        pool = new LendingPool(owner, tokenFactory);

        // Authorize the matching engine
        vm.prank(owner);
        pool.setAuthorizedContract(matchingEngine, true);

        // Deploy mock tokens
        tokenA = new MockERC20("Meme A", "MEMA");
        tokenB = new MockERC20("Meme B", "MEMB");

        // Enable tokens (from tokenFactory)
        vm.startPrank(tokenFactory);
        pool.enableToken(address(tokenA));
        pool.enableToken(address(tokenB));
        vm.stopPrank();

        // Mint tokens to test users
        tokenA.mint(lender1, 1_000_000 ether);
        tokenA.mint(lender2, 1_000_000 ether);
        tokenA.mint(matchingEngine, 1_000_000 ether); // for repayments
        tokenB.mint(lender1, 500_000 ether);
        tokenB.mint(matchingEngine, 500_000 ether);

        // Approve LendingPool
        vm.prank(lender1);
        tokenA.approve(address(pool), type(uint256).max);
        vm.prank(lender2);
        tokenA.approve(address(pool), type(uint256).max);
        vm.prank(matchingEngine);
        tokenA.approve(address(pool), type(uint256).max);
        vm.prank(lender1);
        tokenB.approve(address(pool), type(uint256).max);
        vm.prank(matchingEngine);
        tokenB.approve(address(pool), type(uint256).max);
    }

    // ══════════════════════════════════════════════════════════════════════════════
    // 1. TOKEN ENABLEMENT
    // ══════════════════════════════════════════════════════════════════════════════

    function test_EnableToken() public view {
        assertTrue(pool.isTokenEnabled(address(tokenA)));
        assertTrue(pool.isTokenEnabled(address(tokenB)));
        assertEq(pool.getEnabledTokenCount(), 2);
    }

    function test_EnableToken_OnlyTokenFactory() public {
        MockERC20 tokenC = new MockERC20("Meme C", "MEMC");
        vm.prank(lender1);
        vm.expectRevert(LendingPool.NotTokenFactory.selector);
        pool.enableToken(address(tokenC));
    }

    function test_EnableToken_AlreadyEnabled() public {
        vm.prank(tokenFactory);
        vm.expectRevert(LendingPool.TokenAlreadyEnabled.selector);
        pool.enableToken(address(tokenA));
    }

    function test_EnableToken_ZeroAddress() public {
        vm.prank(tokenFactory);
        vm.expectRevert(LendingPool.ZeroAddress.selector);
        pool.enableToken(address(0));
    }

    function test_EnableToken_InitializesPool() public {
        (
            bool enabled,
            uint256 totalDeposits,
            uint256 totalBorrowed,
            uint256 totalShares,
            ,,,
        ) = pool.getPoolInfo(address(tokenA));

        assertTrue(enabled);
        assertEq(totalDeposits, 0);
        assertEq(totalBorrowed, 0);
        assertEq(totalShares, 0);
    }

    // ══════════════════════════════════════════════════════════════════════════════
    // 2. DEPOSIT / WITHDRAW
    // ══════════════════════════════════════════════════════════════════════════════

    function test_Deposit_FirstDeposit() public {
        uint256 amount = 100_000 ether;
        vm.prank(lender1);
        uint256 shares = pool.deposit(address(tokenA), amount);

        // First deposit: shares = amount (1:1)
        assertEq(shares, amount);
        assertEq(pool.getUserShares(address(tokenA), lender1), amount);
        assertEq(pool.getUserDeposit(address(tokenA), lender1), amount);
    }

    function test_Deposit_SecondDeposit() public {
        // First deposit
        vm.prank(lender1);
        pool.deposit(address(tokenA), 100_000 ether);

        // Second deposit (same ratio)
        vm.prank(lender2);
        uint256 shares = pool.deposit(address(tokenA), 50_000 ether);

        assertEq(shares, 50_000 ether);
        assertEq(pool.getUserDeposit(address(tokenA), lender2), 50_000 ether);
    }

    function test_Deposit_ZeroAmount_Reverts() public {
        vm.prank(lender1);
        vm.expectRevert(LendingPool.InvalidAmount.selector);
        pool.deposit(address(tokenA), 0);
    }

    function test_Deposit_TokenNotEnabled() public {
        MockERC20 tokenC = new MockERC20("C", "C");
        tokenC.mint(lender1, 1000 ether);
        vm.prank(lender1);
        tokenC.approve(address(pool), type(uint256).max);

        vm.prank(lender1);
        vm.expectRevert(LendingPool.TokenNotEnabled.selector);
        pool.deposit(address(tokenC), 100 ether);
    }

    function test_Withdraw_Full() public {
        uint256 depositAmount = 100_000 ether;
        vm.prank(lender1);
        uint256 shares = pool.deposit(address(tokenA), depositAmount);

        uint256 balBefore = tokenA.balanceOf(lender1);

        vm.prank(lender1);
        uint256 withdrawn = pool.withdraw(address(tokenA), shares);

        assertEq(withdrawn, depositAmount);
        assertEq(tokenA.balanceOf(lender1), balBefore + depositAmount);
        assertEq(pool.getUserShares(address(tokenA), lender1), 0);
    }

    function test_Withdraw_Partial() public {
        vm.prank(lender1);
        pool.deposit(address(tokenA), 100_000 ether);

        vm.prank(lender1);
        uint256 withdrawn = pool.withdraw(address(tokenA), 40_000 ether);

        assertEq(withdrawn, 40_000 ether);
        assertEq(pool.getUserShares(address(tokenA), lender1), 60_000 ether);
    }

    function test_Withdraw_InsufficientShares() public {
        vm.prank(lender1);
        pool.deposit(address(tokenA), 100_000 ether);

        vm.prank(lender1);
        vm.expectRevert(LendingPool.InsufficientShares.selector);
        pool.withdraw(address(tokenA), 200_000 ether);
    }

    function test_Withdraw_InsufficientLiquidity() public {
        // Deposit
        vm.prank(lender1);
        pool.deposit(address(tokenA), 100_000 ether);

        // Borrow 80% (close to max)
        vm.prank(matchingEngine);
        pool.borrow(address(tokenA), borrower1, 80_000 ether);

        // Try to withdraw more than available
        vm.prank(lender1);
        vm.expectRevert(LendingPool.InsufficientLiquidity.selector);
        pool.withdraw(address(tokenA), 100_000 ether); // Only 20k available
    }

    // ══════════════════════════════════════════════════════════════════════════════
    // 3. BORROW / REPAY
    // ══════════════════════════════════════════════════════════════════════════════

    function test_Borrow_Basic() public {
        // Deposit first
        vm.prank(lender1);
        pool.deposit(address(tokenA), 100_000 ether);

        uint256 engineBalBefore = tokenA.balanceOf(matchingEngine);

        // Borrow
        vm.prank(matchingEngine);
        pool.borrow(address(tokenA), borrower1, 50_000 ether);

        assertEq(tokenA.balanceOf(matchingEngine), engineBalBefore + 50_000 ether);
        assertEq(pool.getUserBorrow(address(tokenA), borrower1), 50_000 ether);
    }

    function test_Borrow_OnlyAuthorized() public {
        vm.prank(lender1);
        pool.deposit(address(tokenA), 100_000 ether);

        vm.prank(lender1);
        vm.expectRevert(LendingPool.Unauthorized.selector);
        pool.borrow(address(tokenA), borrower1, 10_000 ether);
    }

    function test_Borrow_ExceedsMaxUtilization() public {
        vm.prank(lender1);
        pool.deposit(address(tokenA), 100_000 ether);

        // Try to borrow 91% (above 90% max)
        vm.prank(matchingEngine);
        vm.expectRevert(LendingPool.MaxUtilizationExceeded.selector);
        pool.borrow(address(tokenA), borrower1, 91_000 ether);
    }

    function test_Borrow_AtMaxUtilization() public {
        vm.prank(lender1);
        pool.deposit(address(tokenA), 100_000 ether);

        // Borrow exactly 90% — should succeed
        vm.prank(matchingEngine);
        pool.borrow(address(tokenA), borrower1, 90_000 ether);

        assertEq(pool.getUserBorrow(address(tokenA), borrower1), 90_000 ether);
    }

    function test_Borrow_InsufficientLiquidity() public {
        vm.prank(lender1);
        pool.deposit(address(tokenA), 100_000 ether);

        // Borrow 80% first
        vm.prank(matchingEngine);
        pool.borrow(address(tokenA), borrower1, 80_000 ether);

        // Try to borrow another 30k (only 20k available, but also would exceed 90% util)
        vm.prank(matchingEngine);
        vm.expectRevert(); // Either InsufficientLiquidity or MaxUtilizationExceeded
        pool.borrow(address(tokenA), borrower1, 30_000 ether);
    }

    function test_Repay_Full() public {
        vm.prank(lender1);
        pool.deposit(address(tokenA), 100_000 ether);

        vm.prank(matchingEngine);
        pool.borrow(address(tokenA), borrower1, 50_000 ether);

        // Repay fully (using type(uint256).max)
        vm.prank(matchingEngine);
        pool.repay(address(tokenA), borrower1, type(uint256).max);

        assertEq(pool.getUserBorrow(address(tokenA), borrower1), 0);
    }

    function test_Repay_Partial() public {
        vm.prank(lender1);
        pool.deposit(address(tokenA), 100_000 ether);

        vm.prank(matchingEngine);
        pool.borrow(address(tokenA), borrower1, 50_000 ether);

        // Repay 20k
        vm.prank(matchingEngine);
        pool.repay(address(tokenA), borrower1, 20_000 ether);

        // Should have ~30k remaining
        uint256 remaining = pool.getUserBorrow(address(tokenA), borrower1);
        assertEq(remaining, 30_000 ether);
    }

    // ══════════════════════════════════════════════════════════════════════════════
    // 4. INTEREST ACCRUAL
    // ══════════════════════════════════════════════════════════════════════════════

    function test_InterestAccrual_AfterTimeElapse() public {
        // Deposit
        vm.prank(lender1);
        pool.deposit(address(tokenA), 100_000 ether);

        // Borrow 50%
        vm.prank(matchingEngine);
        pool.borrow(address(tokenA), borrower1, 50_000 ether);

        // Advance 1 year
        vm.warp(block.timestamp + 365 days);

        // Check borrow balance increased
        uint256 borrowBalance = pool.getUserBorrow(address(tokenA), borrower1);
        assertTrue(borrowBalance > 50_000 ether, "Borrow balance should increase with interest");

        // At 50% utilization:
        // borrowRate = BASE_RATE + (0.5 * SLOPE1 / OPTIMAL) = 2% + (0.5/0.8)*4% = 2% + 2.5% = 4.5%
        // After 1 year: 50000 * 1.045 = 52250
        // Allow small rounding tolerance
        assertApproxEqRel(borrowBalance, 52_250 ether, 0.01e18); // 1% tolerance
    }

    function test_InterestAccrual_HighUtilization() public {
        vm.prank(lender1);
        pool.deposit(address(tokenA), 100_000 ether);

        // Borrow 85% (above optimal 80%)
        vm.prank(matchingEngine);
        pool.borrow(address(tokenA), borrower1, 85_000 ether);

        // Advance 1 year
        vm.warp(block.timestamp + 365 days);

        uint256 borrowBalance = pool.getUserBorrow(address(tokenA), borrower1);

        // At 85% utilization:
        // excess = 0.85 - 0.80 = 0.05
        // maxExcess = 1.0 - 0.80 = 0.20
        // borrowRate = 2% + 4% + (0.05/0.20)*75% = 6% + 18.75% = 24.75%
        // After 1 year: 85000 * 1.2475 = ~106037.5
        assertApproxEqRel(borrowBalance, 106_037.5 ether, 0.02e18); // 2% tolerance
    }

    function test_InterestAccrual_ZeroBorrows_NoInterest() public {
        vm.prank(lender1);
        pool.deposit(address(tokenA), 100_000 ether);

        vm.warp(block.timestamp + 365 days);

        // No borrows → no interest → deposit value unchanged
        assertEq(pool.getUserDeposit(address(tokenA), lender1), 100_000 ether);
    }

    function test_SupplyRate_ReturnsCorrectly() public {
        vm.prank(lender1);
        pool.deposit(address(tokenA), 100_000 ether);

        vm.prank(matchingEngine);
        pool.borrow(address(tokenA), borrower1, 50_000 ether);

        uint256 borrowRate = pool.getBorrowRate(address(tokenA));
        uint256 supplyRate = pool.getSupplyRate(address(tokenA));
        uint256 utilization = pool.getUtilization(address(tokenA));

        // Supply rate = borrowRate * utilization * (1 - reserveFactor)
        // = borrowRate * 0.5 * 0.9
        assertTrue(supplyRate > 0, "Supply rate should be > 0 with borrows");
        assertTrue(supplyRate < borrowRate, "Supply rate should be < borrow rate");
        assertEq(utilization, 50e16); // 50%
    }

    // ══════════════════════════════════════════════════════════════════════════════
    // 5. CLAIM INTEREST
    // ══════════════════════════════════════════════════════════════════════════════

    function test_ClaimInterest() public {
        // Deposit
        vm.prank(lender1);
        pool.deposit(address(tokenA), 100_000 ether);

        // Borrow
        vm.prank(matchingEngine);
        pool.borrow(address(tokenA), borrower1, 50_000 ether);

        // Advance time
        vm.warp(block.timestamp + 365 days);

        // Repay fully (puts interest back into pool)
        vm.prank(matchingEngine);
        pool.repay(address(tokenA), borrower1, type(uint256).max);

        // Check pending interest
        uint256 pending = pool.getUserPendingInterest(address(tokenA), lender1);
        assertTrue(pending > 0, "Should have pending interest");

        // Claim
        uint256 balBefore = tokenA.balanceOf(lender1);
        vm.prank(lender1);
        uint256 claimed = pool.claimInterest(address(tokenA));

        assertTrue(claimed > 0, "Should claim interest");
        assertEq(tokenA.balanceOf(lender1), balBefore + claimed);
    }

    // ══════════════════════════════════════════════════════════════════════════════
    // 6. MULTI-TOKEN ISOLATION
    // ══════════════════════════════════════════════════════════════════════════════

    function test_MultiToken_Isolation() public {
        // Deposit into both pools
        vm.prank(lender1);
        pool.deposit(address(tokenA), 100_000 ether);
        vm.prank(lender1);
        pool.deposit(address(tokenB), 50_000 ether);

        // Borrow only from token A
        vm.prank(matchingEngine);
        pool.borrow(address(tokenA), borrower1, 50_000 ether);

        // Token B should have 0 utilization
        assertEq(pool.getUtilization(address(tokenB)), 0);
        assertEq(pool.getUtilization(address(tokenA)), 50e16); // 50%

        // Advance time
        vm.warp(block.timestamp + 365 days);

        // Token B deposit should be unchanged (no borrows = no interest)
        assertEq(pool.getUserDeposit(address(tokenB), lender1), 50_000 ether);

        // Token A should have interest accrued
        uint256 depositA = pool.getUserDeposit(address(tokenA), lender1);
        assertTrue(depositA >= 100_000 ether, "Token A deposit should grow with interest");
    }

    function test_MultiToken_EnabledTokensList() public {
        address[] memory tokens = pool.getEnabledTokens();
        assertEq(tokens.length, 2);
        assertEq(tokens[0], address(tokenA));
        assertEq(tokens[1], address(tokenB));
    }

    // ══════════════════════════════════════════════════════════════════════════════
    // 7. LIQUIDATION
    // ══════════════════════════════════════════════════════════════════════════════

    function test_LiquidateBorrow() public {
        vm.prank(lender1);
        pool.deposit(address(tokenA), 100_000 ether);

        vm.prank(matchingEngine);
        pool.borrow(address(tokenA), borrower1, 50_000 ether);

        // Advance time for interest to accrue
        vm.warp(block.timestamp + 30 days);

        uint256 borrowBal = pool.getUserBorrow(address(tokenA), borrower1);
        assertTrue(borrowBal > 50_000 ether, "Should have accrued interest");

        // Liquidate
        vm.prank(matchingEngine);
        uint256 seized = pool.liquidateBorrow(address(tokenA), borrower1);

        assertTrue(seized > 50_000 ether, "Seized should include interest");
        assertEq(pool.getUserBorrow(address(tokenA), borrower1), 0);
    }

    function test_LiquidateBorrow_NoBorrow() public {
        vm.prank(matchingEngine);
        vm.expectRevert(LendingPool.NoBorrowToLiquidate.selector);
        pool.liquidateBorrow(address(tokenA), borrower1);
    }

    function test_LiquidateBorrow_OnlyAuthorized() public {
        vm.prank(lender1);
        pool.deposit(address(tokenA), 100_000 ether);
        vm.prank(matchingEngine);
        pool.borrow(address(tokenA), borrower1, 10_000 ether);

        vm.prank(lender1);
        vm.expectRevert(LendingPool.Unauthorized.selector);
        pool.liquidateBorrow(address(tokenA), borrower1);
    }

    // ══════════════════════════════════════════════════════════════════════════════
    // 8. RESERVE FACTOR & PROTOCOL REVENUE
    // ══════════════════════════════════════════════════════════════════════════════

    function test_ReserveFactor_AccumulatesReserves() public {
        vm.prank(lender1);
        pool.deposit(address(tokenA), 100_000 ether);

        vm.prank(matchingEngine);
        pool.borrow(address(tokenA), borrower1, 50_000 ether);

        // Advance 1 year
        vm.warp(block.timestamp + 365 days);

        // Repay fully to settle interest
        vm.prank(matchingEngine);
        pool.repay(address(tokenA), borrower1, type(uint256).max);

        // Check reserves accumulated (10% of interest)
        (,,,,,,, uint256 reserves) = pool.getPoolInfo(address(tokenA));
        assertTrue(reserves > 0, "Should have protocol reserves");
    }

    function test_WithdrawReserves() public {
        vm.prank(lender1);
        pool.deposit(address(tokenA), 100_000 ether);

        vm.prank(matchingEngine);
        pool.borrow(address(tokenA), borrower1, 50_000 ether);

        vm.warp(block.timestamp + 365 days);

        // Repay to settle interest and build reserves
        vm.prank(matchingEngine);
        pool.repay(address(tokenA), borrower1, type(uint256).max);

        (,,,,,,, uint256 reserves) = pool.getPoolInfo(address(tokenA));
        assertTrue(reserves > 0);

        address treasury = address(0xBEEF);
        uint256 treasuryBal = tokenA.balanceOf(treasury);

        vm.prank(owner);
        pool.withdrawReserves(address(tokenA), reserves, treasury);

        assertEq(tokenA.balanceOf(treasury), treasuryBal + reserves);
    }

    function test_SetReserveFactor() public {
        vm.prank(owner);
        pool.setReserveFactor(address(tokenA), 2000); // 20%

        // Verify via getPoolInfo
        (bool enabled,,,,,,, ) = pool.getPoolInfo(address(tokenA));
        assertTrue(enabled);
    }

    // ══════════════════════════════════════════════════════════════════════════════
    // 9. ADMIN FUNCTIONS
    // ══════════════════════════════════════════════════════════════════════════════

    function test_Pause_BlocksDeposit() public {
        vm.prank(owner);
        pool.pause();

        vm.prank(lender1);
        vm.expectRevert();
        pool.deposit(address(tokenA), 1000 ether);
    }

    function test_Unpause_AllowsDeposit() public {
        vm.prank(owner);
        pool.pause();

        vm.prank(owner);
        pool.unpause();

        vm.prank(lender1);
        pool.deposit(address(tokenA), 1000 ether);
        assertEq(pool.getUserShares(address(tokenA), lender1), 1000 ether);
    }

    function test_EmergencyDisableToken() public {
        vm.prank(owner);
        pool.emergencyDisableToken(address(tokenA));

        assertFalse(pool.isTokenEnabled(address(tokenA)));

        // Deposit should revert
        vm.prank(lender1);
        vm.expectRevert(LendingPool.TokenNotEnabled.selector);
        pool.deposit(address(tokenA), 1000 ether);
    }

    function test_SetAuthorizedContract() public {
        address newEngine = address(0x999);

        vm.prank(owner);
        pool.setAuthorizedContract(newEngine, true);

        // New engine can borrow
        vm.prank(lender1);
        pool.deposit(address(tokenA), 100_000 ether);

        tokenA.mint(newEngine, 100_000 ether);
        vm.prank(newEngine);
        tokenA.approve(address(pool), type(uint256).max);

        vm.prank(newEngine);
        pool.borrow(address(tokenA), borrower1, 10_000 ether);
    }

    function test_SetTokenFactory() public {
        address newFactory = address(0x777);
        vm.prank(owner);
        pool.setTokenFactory(newFactory);

        // New factory can enable tokens
        MockERC20 tokenC = new MockERC20("C", "C");
        vm.prank(newFactory);
        pool.enableToken(address(tokenC));
        assertTrue(pool.isTokenEnabled(address(tokenC)));
    }

    // ══════════════════════════════════════════════════════════════════════════════
    // 10. VIEW FUNCTIONS
    // ══════════════════════════════════════════════════════════════════════════════

    function test_GetAvailableLiquidity() public {
        vm.prank(lender1);
        pool.deposit(address(tokenA), 100_000 ether);

        vm.prank(matchingEngine);
        pool.borrow(address(tokenA), borrower1, 30_000 ether);

        assertEq(pool.getAvailableLiquidity(address(tokenA)), 70_000 ether);
    }

    function test_SharesToAmount_RoundTrip() public {
        vm.prank(lender1);
        pool.deposit(address(tokenA), 100_000 ether);

        uint256 shares = pool.getUserShares(address(tokenA), lender1);
        uint256 amount = pool.sharesToAmount(address(tokenA), shares);
        assertEq(amount, 100_000 ether);
    }

    function test_AmountToShares_RoundTrip() public {
        vm.prank(lender1);
        pool.deposit(address(tokenA), 100_000 ether);

        uint256 sharesFor50k = pool.amountToShares(address(tokenA), 50_000 ether);
        assertEq(sharesFor50k, 50_000 ether); // 1:1 since only deposit and no interest
    }

    // ══════════════════════════════════════════════════════════════════════════════
    // 11. INTEREST RATE MODEL EDGE CASES
    // ══════════════════════════════════════════════════════════════════════════════

    function test_BorrowRate_ZeroUtilization() public view {
        uint256 rate = pool.getBorrowRate(address(tokenA));
        // BASE_RATE = 2% when 0% utilization
        assertEq(rate, 2e16);
    }

    function test_BorrowRate_OptimalUtilization() public {
        vm.prank(lender1);
        pool.deposit(address(tokenA), 100_000 ether);

        vm.prank(matchingEngine);
        pool.borrow(address(tokenA), borrower1, 80_000 ether);

        uint256 rate = pool.getBorrowRate(address(tokenA));
        // At 80% (optimal): BASE_RATE + SLOPE1 = 2% + 4% = 6%
        assertEq(rate, 6e16);
    }

    function test_Utilization_Calculation() public {
        vm.prank(lender1);
        pool.deposit(address(tokenA), 100_000 ether);

        vm.prank(matchingEngine);
        pool.borrow(address(tokenA), borrower1, 50_000 ether);

        uint256 util = pool.getUtilization(address(tokenA));
        assertEq(util, 50e16); // 50%
    }

    // ══════════════════════════════════════════════════════════════════════════════
    // 12. MULTIPLE BORROWS BY SAME BORROWER
    // ══════════════════════════════════════════════════════════════════════════════

    function test_MultipleBorrows_SameBorrower() public {
        vm.prank(lender1);
        pool.deposit(address(tokenA), 100_000 ether);

        // First borrow
        vm.prank(matchingEngine);
        pool.borrow(address(tokenA), borrower1, 20_000 ether);

        // Second borrow
        vm.prank(matchingEngine);
        pool.borrow(address(tokenA), borrower1, 10_000 ether);

        assertEq(pool.getUserBorrow(address(tokenA), borrower1), 30_000 ether);
    }

    function test_MultipleBorrows_WithTimeBetween() public {
        vm.prank(lender1);
        pool.deposit(address(tokenA), 100_000 ether);

        // First borrow
        vm.prank(matchingEngine);
        pool.borrow(address(tokenA), borrower1, 20_000 ether);

        // Advance 30 days
        vm.warp(block.timestamp + 30 days);

        // Second borrow — should settle existing interest first
        vm.prank(matchingEngine);
        pool.borrow(address(tokenA), borrower1, 10_000 ether);

        uint256 totalBorrow = pool.getUserBorrow(address(tokenA), borrower1);
        assertTrue(totalBorrow > 30_000 ether, "Should include interest from first borrow");
    }

    // ══════════════════════════════════════════════════════════════════════════════
    // 12. CLAIM INTEREST — totalDeposits ACCOUNTING FIX
    // ══════════════════════════════════════════════════════════════════════════════

    /**
     * @notice Verify that totalDeposits decreases after claimInterest()
     * @dev Bug fix: claimInterest() was missing pool.totalDeposits -= interest
     */
    function test_ClaimInterest_ReducesTotalDeposits() public {
        // Setup: lender1 deposits, borrower borrows, time passes, borrower repays
        vm.prank(lender1);
        pool.deposit(address(tokenA), 100_000 ether);

        vm.prank(matchingEngine);
        pool.borrow(address(tokenA), borrower1, 50_000 ether);

        vm.warp(block.timestamp + 365 days);

        vm.prank(matchingEngine);
        pool.repay(address(tokenA), borrower1, type(uint256).max);

        // Snapshot totalDeposits BEFORE claim
        (,uint256 totalDepositsBefore,,,,,,) = pool.getPoolInfo(address(tokenA));

        // Claim interest
        uint256 pending = pool.getUserPendingInterest(address(tokenA), lender1);
        assertTrue(pending > 0, "Should have pending interest");

        vm.prank(lender1);
        uint256 claimed = pool.claimInterest(address(tokenA));
        assertTrue(claimed > 0, "Should claim > 0");

        // Snapshot totalDeposits AFTER claim
        (,uint256 totalDepositsAfter,,,,,,) = pool.getPoolInfo(address(tokenA));

        // KEY ASSERTION: totalDeposits must decrease by claimed amount
        assertEq(
            totalDepositsAfter,
            totalDepositsBefore - claimed,
            "totalDeposits must decrease by claimed interest amount"
        );
    }

    /**
     * @notice After claiming, the accounting invariant must hold:
     *         contractBalance >= totalDeposits - totalBorrowed
     */
    function test_ClaimInterest_BalanceInvariant() public {
        vm.prank(lender1);
        pool.deposit(address(tokenA), 100_000 ether);

        vm.prank(matchingEngine);
        pool.borrow(address(tokenA), borrower1, 50_000 ether);

        vm.warp(block.timestamp + 180 days);

        vm.prank(matchingEngine);
        pool.repay(address(tokenA), borrower1, type(uint256).max);

        // Claim interest
        vm.prank(lender1);
        pool.claimInterest(address(tokenA));

        // Check invariant: contractBalance >= totalDeposits - totalBorrowed
        uint256 contractBal = tokenA.balanceOf(address(pool));
        (,uint256 totalDeposits, uint256 totalBorrowed,,,,,) = pool.getPoolInfo(address(tokenA));

        assertTrue(
            contractBal >= totalDeposits - totalBorrowed,
            "Invariant violated: contractBalance < totalDeposits - totalBorrowed"
        );
    }

    /**
     * @notice Multi-user scenario: after one user claims interest,
     *         the other user should still be able to fully withdraw.
     */
    function test_ClaimInterest_MultiUser_WithdrawAfterClaim() public {
        // Both lenders deposit
        vm.prank(lender1);
        pool.deposit(address(tokenA), 100_000 ether);
        vm.prank(lender2);
        pool.deposit(address(tokenA), 100_000 ether);

        // Borrow and accrue interest
        vm.prank(matchingEngine);
        pool.borrow(address(tokenA), borrower1, 80_000 ether);

        vm.warp(block.timestamp + 365 days);

        // Repay fully
        vm.prank(matchingEngine);
        pool.repay(address(tokenA), borrower1, type(uint256).max);

        // Lender1 claims interest
        vm.prank(lender1);
        pool.claimInterest(address(tokenA));

        // Lender2 should still be able to withdraw ALL their shares
        uint256 lender2Shares = pool.getUserShares(address(tokenA), lender2);
        assertTrue(lender2Shares > 0, "Lender2 should have shares");

        uint256 lender2BalBefore = tokenA.balanceOf(lender2);
        vm.prank(lender2);
        uint256 withdrawn = pool.withdraw(address(tokenA), lender2Shares);

        assertTrue(withdrawn > 0, "Lender2 should withdraw > 0");
        assertEq(tokenA.balanceOf(lender2), lender2BalBefore + withdrawn);

        // Lender1 can also withdraw their shares
        uint256 lender1Shares = pool.getUserShares(address(tokenA), lender1);
        if (lender1Shares > 0) {
            vm.prank(lender1);
            pool.withdraw(address(tokenA), lender1Shares);
        }

        // After everyone withdraws, totalDeposits should be ~0
        // Contract balance may still hold reserves (from reserve factor)
        uint256 finalContractBal = tokenA.balanceOf(address(pool));
        (,uint256 finalTotalDeposits,,,,,, uint256 reserves) = pool.getPoolInfo(address(tokenA));

        // totalDeposits must be ~0 (only rounding dust allowed)
        assertTrue(finalTotalDeposits < 1000, "totalDeposits should be ~0 after full withdrawal");

        // Contract balance = reserves + rounding dust (reserves belong to protocol, not depositors)
        assertTrue(
            finalContractBal <= reserves + 1000,
            "contract balance should only contain reserves after full withdrawal"
        );
    }

    /**
     * @notice Claiming zero interest should be a no-op (no revert, returns 0)
     */
    function test_ClaimInterest_ZeroPending_NoOp() public {
        vm.prank(lender1);
        pool.deposit(address(tokenA), 100_000 ether);

        // No borrow, no interest accrued
        (,uint256 totalDepositsBefore,,,,,,) = pool.getPoolInfo(address(tokenA));

        vm.prank(lender1);
        uint256 claimed = pool.claimInterest(address(tokenA));

        assertEq(claimed, 0, "Should claim 0 when no interest");

        (,uint256 totalDepositsAfter,,,,,,) = pool.getPoolInfo(address(tokenA));
        assertEq(totalDepositsAfter, totalDepositsBefore, "totalDeposits unchanged when no interest");
    }
}
