// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {ExternalTokenRegistry} from "../src/perpetual/ExternalTokenRegistry.sol";
import {IExternalTokenRegistry} from "../src/interfaces/IExternalTokenRegistry.sol";

/**
 * @notice Minimal mock of a PancakeSwap V2 pair — only token0() / token1() are
 *         called by ExternalTokenRegistry._validatePair. getReserves is stubbed
 *         so future usages won't need a new mock.
 */
contract MockPair {
    address public token0;
    address public token1;

    constructor(address _token0, address _token1) {
        token0 = _token0;
        token1 = _token1;
    }

    function getReserves() external pure returns (uint112, uint112, uint32) {
        return (1_000_000 ether, 500 ether, 0);
    }
}

/**
 * @title ExternalTokenRegistry tests
 * @notice Covers: constructor, applyListing (happy + failure), admin flows
 *         (approve/reject/delist/slash), LP withdrawal + lock semantics,
 *         owner parameter updates, view helpers, accidental-transfer guard.
 */
contract ExternalTokenRegistryTest is Test {
    ExternalTokenRegistry public registry;

    // ── Actors ──
    address public owner       = address(0x1);
    address public admin       = address(0x2);
    address public treasury    = address(0x3);
    address public alice       = address(0x10);
    address public bob         = address(0x11);
    address public stranger    = address(0x99);

    // ── Fake tokens / pairs ──
    address public wbnb        = address(0xAE13); // pretend WBNB
    address public tokenA      = address(0xA01);
    address public tokenB      = address(0xB01);
    MockPair public validPairA; // token0=WBNB, token1=tokenA
    MockPair public validPairB; // token0=tokenB, token1=WBNB
    MockPair public badPair;    // neither side is WBNB

    // ── Constants from contract ──
    uint256 public constant LOCK_DURATION = 60 days;
    uint256 public constant LISTING_FEE   = 1 ether; // arbitrary for tests

    // Event signatures (copied from interface — required for vm.expectEmit)
    event ListingRequested(
        uint256 indexed appId,
        address indexed projectTeam,
        address indexed token,
        address pair,
        IExternalTokenRegistry.LeverageTier tier,
        uint256 feesPaid,
        uint256 lpAmountBNB
    );
    event ListingApproved(uint256 indexed appId, address indexed admin);
    event ListingRejected(uint256 indexed appId, address indexed admin, string reason);
    event ListingDelisted(uint256 indexed appId, address indexed admin, string reason);
    event ListingSlashed(uint256 indexed appId, address indexed admin, uint256 slashedAmount, string reason);
    event ProjectLPWithdrawn(uint256 indexed appId, address indexed projectTeam, uint256 amount);

    // ============================================================
    //  setUp
    // ============================================================

    function setUp() public {
        validPairA = new MockPair(wbnb, tokenA);
        validPairB = new MockPair(tokenB, wbnb);
        badPair    = new MockPair(tokenA, tokenB); // neither side WBNB

        vm.prank(owner);
        registry = new ExternalTokenRegistry(wbnb, treasury, admin, LISTING_FEE);

        // Fund applicants
        vm.deal(alice, 10_000 ether);
        vm.deal(bob,   10_000 ether);
    }

    // ─── Helper: cheap amount just above tier minimum ──────────────
    function _minLP(IExternalTokenRegistry.LeverageTier tier) internal view returns (uint256) {
        return registry.tierMinLP(tier);
    }

    function _totalCost(IExternalTokenRegistry.LeverageTier tier) internal view returns (uint256) {
        return registry.listingFeeBNB() + _minLP(tier);
    }

    // Apply a simple 2x listing as alice/tokenA. Returns appId.
    function _aliceAppliesTier2X() internal returns (uint256) {
        uint256 cost = _totalCost(IExternalTokenRegistry.LeverageTier.TIER_2X);
        vm.prank(alice);
        return registry.applyListing{value: cost}(tokenA, address(validPairA), IExternalTokenRegistry.LeverageTier.TIER_2X);
    }

    // ============================================================
    //  Constructor
    // ============================================================

    function test_constructor_setsInitialState() public view {
        assertEq(registry.WBNB(), wbnb);
        assertEq(registry.treasury(), treasury);
        assertEq(registry.admin(), admin);
        assertEq(registry.listingFeeBNB(), LISTING_FEE);
        assertEq(registry.owner(), owner);
        assertEq(registry.LOCK_DURATION(), 60 days);

        // Tier defaults set
        assertEq(registry.tierMinLP(IExternalTokenRegistry.LeverageTier.TIER_2X),  83 ether);
        assertEq(registry.tierMinLP(IExternalTokenRegistry.LeverageTier.TIER_10X), 833 ether);
    }

    function test_constructor_revertsOnZeroAddress() public {
        vm.expectRevert(IExternalTokenRegistry.ZeroAddress.selector);
        new ExternalTokenRegistry(address(0), treasury, admin, LISTING_FEE);

        vm.expectRevert(IExternalTokenRegistry.ZeroAddress.selector);
        new ExternalTokenRegistry(wbnb, address(0), admin, LISTING_FEE);

        vm.expectRevert(IExternalTokenRegistry.ZeroAddress.selector);
        new ExternalTokenRegistry(wbnb, treasury, address(0), LISTING_FEE);
    }

    // ============================================================
    //  applyListing — happy path
    // ============================================================

    function test_applyListing_storesStateAndTransfersFee() public {
        uint256 fee = LISTING_FEE;
        uint256 minLP = _minLP(IExternalTokenRegistry.LeverageTier.TIER_2X);
        uint256 cost = fee + minLP;

        uint256 treasuryBalBefore = treasury.balance;

        vm.prank(alice);
        uint256 appId = registry.applyListing{value: cost}(
            tokenA, address(validPairA), IExternalTokenRegistry.LeverageTier.TIER_2X
        );

        assertEq(appId, 1, "first appId should be 1");

        IExternalTokenRegistry.Listing memory l = registry.getListing(appId);
        assertEq(l.token, tokenA);
        assertEq(l.pair, address(validPairA));
        assertEq(l.projectTeam, alice);
        assertEq(l.lpAmountBNB, minLP);
        assertEq(l.feesPaid, fee);
        assertEq(uint256(l.status), uint256(IExternalTokenRegistry.ListingStatus.PENDING));
        assertEq(l.lpUnlockAt, block.timestamp + LOCK_DURATION);

        // Fee immediately forwarded to treasury
        assertEq(treasury.balance - treasuryBalBefore, fee);
        // LP stays in registry
        assertEq(address(registry).balance, minLP);
        assertEq(registry.listingsLPTotal(), minLP);
    }

    function test_applyListing_extraBNBAddedToLP() public {
        uint256 fee = LISTING_FEE;
        uint256 minLP = _minLP(IExternalTokenRegistry.LeverageTier.TIER_2X);
        uint256 extra = 10 ether;

        vm.prank(alice);
        uint256 appId = registry.applyListing{value: fee + minLP + extra}(
            tokenA, address(validPairA), IExternalTokenRegistry.LeverageTier.TIER_2X
        );

        IExternalTokenRegistry.Listing memory l = registry.getListing(appId);
        assertEq(l.lpAmountBNB, minLP + extra, "extra BNB counted as LP");
    }

    function test_applyListing_emitsEvent() public {
        uint256 fee = LISTING_FEE;
        uint256 minLP = _minLP(IExternalTokenRegistry.LeverageTier.TIER_5X);

        vm.prank(alice);
        vm.expectEmit(true, true, true, true);
        emit ListingRequested(
            1, alice, tokenA, address(validPairA),
            IExternalTokenRegistry.LeverageTier.TIER_5X, fee, minLP
        );
        registry.applyListing{value: fee + minLP}(
            tokenA, address(validPairA), IExternalTokenRegistry.LeverageTier.TIER_5X
        );
    }

    function test_applyListing_acceptsPairWithWbnbAsToken1() public {
        uint256 cost = _totalCost(IExternalTokenRegistry.LeverageTier.TIER_2X);
        vm.prank(bob);
        uint256 appId = registry.applyListing{value: cost}(
            tokenB, address(validPairB), IExternalTokenRegistry.LeverageTier.TIER_2X
        );
        assertEq(appId, 1);
    }

    // ============================================================
    //  applyListing — failures
    // ============================================================

    function test_applyListing_revertsOnZeroToken() public {
        uint256 cost = _totalCost(IExternalTokenRegistry.LeverageTier.TIER_2X);
        vm.prank(alice);
        vm.expectRevert(IExternalTokenRegistry.ZeroAddress.selector);
        registry.applyListing{value: cost}(
            address(0), address(validPairA), IExternalTokenRegistry.LeverageTier.TIER_2X
        );
    }

    function test_applyListing_revertsOnZeroPair() public {
        uint256 cost = _totalCost(IExternalTokenRegistry.LeverageTier.TIER_2X);
        vm.prank(alice);
        vm.expectRevert(IExternalTokenRegistry.ZeroAddress.selector);
        registry.applyListing{value: cost}(
            tokenA, address(0), IExternalTokenRegistry.LeverageTier.TIER_2X
        );
    }

    function test_applyListing_revertsOnInvalidPair() public {
        uint256 cost = _totalCost(IExternalTokenRegistry.LeverageTier.TIER_2X);
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(
            IExternalTokenRegistry.InvalidPair.selector, address(badPair), tokenA
        ));
        registry.applyListing{value: cost}(
            tokenA, address(badPair), IExternalTokenRegistry.LeverageTier.TIER_2X
        );
    }

    function test_applyListing_revertsOnInsufficientPayment() public {
        uint256 fee = LISTING_FEE;
        uint256 minLP = _minLP(IExternalTokenRegistry.LeverageTier.TIER_2X);
        uint256 required = fee + minLP;
        uint256 shy = required - 1;

        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(
            IExternalTokenRegistry.InsufficientFee.selector, required, shy
        ));
        registry.applyListing{value: shy}(
            tokenA, address(validPairA), IExternalTokenRegistry.LeverageTier.TIER_2X
        );
    }

    // ============================================================
    //  approveListing
    // ============================================================

    function test_approveListing_byAdmin() public {
        uint256 appId = _aliceAppliesTier2X();

        vm.prank(admin);
        vm.expectEmit(true, true, false, false);
        emit ListingApproved(appId, admin);
        registry.approveListing(appId);

        IExternalTokenRegistry.Listing memory l = registry.getListing(appId);
        assertEq(uint256(l.status), uint256(IExternalTokenRegistry.ListingStatus.APPROVED));
        assertEq(l.approvedAt, block.timestamp);
        assertEq(registry.activeAppIdForToken(tokenA), appId);
        assertTrue(registry.isTokenActive(tokenA));
        assertEq(registry.getMaxLeverageForToken(tokenA), 2);

        uint256[] memory active = registry.getActiveListings();
        assertEq(active.length, 1);
        assertEq(active[0], appId);
    }

    function test_approveListing_revertsIfNotAdmin() public {
        uint256 appId = _aliceAppliesTier2X();

        vm.prank(stranger);
        vm.expectRevert(IExternalTokenRegistry.NotAdmin.selector);
        registry.approveListing(appId);

        // owner is also NOT admin — only the admin role is authorized
        vm.prank(owner);
        vm.expectRevert(IExternalTokenRegistry.NotAdmin.selector);
        registry.approveListing(appId);
    }

    function test_approveListing_revertsIfNonPending() public {
        uint256 appId = _aliceAppliesTier2X();
        vm.prank(admin);
        registry.approveListing(appId);

        // second approve on already-APPROVED
        vm.prank(admin);
        vm.expectRevert();
        registry.approveListing(appId);
    }

    function test_approveListing_rejectsDoubleListingSameToken() public {
        uint256 appId1 = _aliceAppliesTier2X();
        vm.prank(admin);
        registry.approveListing(appId1);

        // Bob applies for SAME token (tokenA) with different pair — should succeed applying…
        uint256 cost = _totalCost(IExternalTokenRegistry.LeverageTier.TIER_3X);
        vm.prank(bob);
        uint256 appId2 = registry.applyListing{value: cost}(
            tokenA, address(validPairA), IExternalTokenRegistry.LeverageTier.TIER_3X
        );

        // …but admin cannot approve the second one
        vm.prank(admin);
        vm.expectRevert();
        registry.approveListing(appId2);
    }

    // ============================================================
    //  rejectListing
    // ============================================================

    function test_rejectListing_byAdmin_emitsEvent_keepsLPForWithdrawal() public {
        uint256 appId = _aliceAppliesTier2X();
        uint256 lpAmount = registry.getListing(appId).lpAmountBNB;

        vm.prank(admin);
        vm.expectEmit(true, true, false, true);
        emit ListingRejected(appId, admin, "suspicious token contract");
        registry.rejectListing(appId, "suspicious token contract");

        IExternalTokenRegistry.Listing memory l = registry.getListing(appId);
        assertEq(uint256(l.status), uint256(IExternalTokenRegistry.ListingStatus.REJECTED));
        // LP still escrowed — alice must call withdraw
        assertEq(l.lpAmountBNB, lpAmount);
        assertEq(registry.listingsLPTotal(), lpAmount);
    }

    function test_rejectListing_revertsIfNotAdmin() public {
        uint256 appId = _aliceAppliesTier2X();
        vm.prank(stranger);
        vm.expectRevert(IExternalTokenRegistry.NotAdmin.selector);
        registry.rejectListing(appId, "x");
    }

    function test_rejectListing_revertsIfNonPending() public {
        uint256 appId = _aliceAppliesTier2X();
        vm.prank(admin);
        registry.approveListing(appId);

        vm.prank(admin);
        vm.expectRevert();
        registry.rejectListing(appId, "changed mind");
    }

    // ============================================================
    //  withdrawProjectLP — lock + status semantics
    // ============================================================

    function test_withdrawProjectLP_rejectedAllowsImmediate() public {
        uint256 appId = _aliceAppliesTier2X();
        uint256 expected = registry.getListing(appId).lpAmountBNB;

        vm.prank(admin);
        registry.rejectListing(appId, "nope");

        uint256 balBefore = alice.balance;
        vm.prank(alice);
        vm.expectEmit(true, true, false, true);
        emit ProjectLPWithdrawn(appId, alice, expected);
        registry.withdrawProjectLP(appId);

        assertEq(alice.balance - balBefore, expected);
        assertEq(registry.getListing(appId).lpAmountBNB, 0);
        assertEq(registry.listingsLPTotal(), 0);
    }

    function test_withdrawProjectLP_approvedRequiresLock() public {
        uint256 appId = _aliceAppliesTier2X();
        vm.prank(admin);
        registry.approveListing(appId);

        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(
            IExternalTokenRegistry.LockNotExpired.selector,
            block.timestamp + LOCK_DURATION,
            block.timestamp
        ));
        registry.withdrawProjectLP(appId);

        // Warp past lock → withdraw succeeds
        vm.warp(block.timestamp + LOCK_DURATION + 1);
        vm.prank(alice);
        registry.withdrawProjectLP(appId);

        assertEq(registry.getListing(appId).lpAmountBNB, 0);
    }

    function test_withdrawProjectLP_delistedRequiresLock() public {
        uint256 appId = _aliceAppliesTier2X();
        vm.prank(admin);
        registry.approveListing(appId);

        vm.prank(admin);
        registry.delistListing(appId, "low liquidity");

        // Still locked
        vm.prank(alice);
        vm.expectRevert();
        registry.withdrawProjectLP(appId);

        vm.warp(block.timestamp + LOCK_DURATION + 1);
        vm.prank(alice);
        registry.withdrawProjectLP(appId);

        assertEq(registry.getListing(appId).lpAmountBNB, 0);
    }

    function test_withdrawProjectLP_revertsIfNotProjectTeam() public {
        uint256 appId = _aliceAppliesTier2X();
        vm.prank(admin);
        registry.rejectListing(appId, "x");

        vm.prank(bob);
        vm.expectRevert(IExternalTokenRegistry.NotProjectTeam.selector);
        registry.withdrawProjectLP(appId);
    }

    function test_withdrawProjectLP_revertsOnDoubleWithdraw() public {
        uint256 appId = _aliceAppliesTier2X();
        vm.prank(admin);
        registry.rejectListing(appId, "x");

        vm.prank(alice);
        registry.withdrawProjectLP(appId);

        // Second call — lpAmountBNB is now 0, should revert
        vm.prank(alice);
        vm.expectRevert(IExternalTokenRegistry.TransferFailed.selector);
        registry.withdrawProjectLP(appId);
    }

    function test_withdrawProjectLP_revertsIfSlashed() public {
        uint256 appId = _aliceAppliesTier2X();
        vm.prank(admin);
        registry.slashListing(appId, "rug detected");

        vm.prank(alice);
        vm.expectRevert();
        registry.withdrawProjectLP(appId);
    }

    // ============================================================
    //  delistListing
    // ============================================================

    function test_delistListing_removesFromActive() public {
        uint256 appId = _aliceAppliesTier2X();
        vm.prank(admin);
        registry.approveListing(appId);

        assertTrue(registry.isTokenActive(tokenA));

        vm.prank(admin);
        vm.expectEmit(true, true, false, true);
        emit ListingDelisted(appId, admin, "pair liquidity dropped");
        registry.delistListing(appId, "pair liquidity dropped");

        assertEq(uint256(registry.getListing(appId).status),
                 uint256(IExternalTokenRegistry.ListingStatus.DELISTED));
        assertFalse(registry.isTokenActive(tokenA));
        assertEq(registry.activeAppIdForToken(tokenA), 0);
        assertEq(registry.getActiveListings().length, 0);
    }

    function test_delistListing_revertsIfNotApproved() public {
        uint256 appId = _aliceAppliesTier2X();
        // still PENDING
        vm.prank(admin);
        vm.expectRevert();
        registry.delistListing(appId, "x");
    }

    // ============================================================
    //  slashListing
    // ============================================================

    function test_slashListing_pendingSendsToTreasury() public {
        uint256 appId = _aliceAppliesTier2X();
        uint256 lpAmount = registry.getListing(appId).lpAmountBNB;
        uint256 treasuryBefore = treasury.balance;

        vm.prank(admin);
        vm.expectEmit(true, true, false, true);
        emit ListingSlashed(appId, admin, lpAmount, "scam");
        registry.slashListing(appId, "scam");

        IExternalTokenRegistry.Listing memory l = registry.getListing(appId);
        assertEq(uint256(l.status), uint256(IExternalTokenRegistry.ListingStatus.SLASHED));
        assertEq(l.lpAmountBNB, 0);
        assertEq(registry.listingsLPTotal(), 0);
        assertEq(treasury.balance - treasuryBefore, lpAmount);
    }

    function test_slashListing_approvedRemovesFromActive() public {
        uint256 appId = _aliceAppliesTier2X();
        vm.prank(admin);
        registry.approveListing(appId);

        assertTrue(registry.isTokenActive(tokenA));

        vm.prank(admin);
        registry.slashListing(appId, "rug");

        assertFalse(registry.isTokenActive(tokenA));
        assertEq(registry.activeAppIdForToken(tokenA), 0);
        assertEq(registry.getActiveListings().length, 0);
    }

    function test_slashListing_revertsOnAlreadySlashed() public {
        uint256 appId = _aliceAppliesTier2X();
        vm.prank(admin);
        registry.slashListing(appId, "1");

        vm.prank(admin);
        vm.expectRevert();
        registry.slashListing(appId, "2");
    }

    function test_slashListing_revertsOnRejected() public {
        uint256 appId = _aliceAppliesTier2X();
        vm.prank(admin);
        registry.rejectListing(appId, "x");

        // rejected → LP belongs back to project team; slash not allowed
        vm.prank(admin);
        vm.expectRevert();
        registry.slashListing(appId, "double slash");
    }

    // ============================================================
    //  Owner: parameter updates
    // ============================================================

    function test_setListingFeeBNB_onlyOwner() public {
        vm.prank(owner);
        registry.setListingFeeBNB(2 ether);
        assertEq(registry.listingFeeBNB(), 2 ether);

        vm.prank(admin);
        vm.expectRevert(); // Ownable revert
        registry.setListingFeeBNB(3 ether);
    }

    function test_setTierMinLP_onlyOwner() public {
        vm.prank(owner);
        registry.setTierMinLP(IExternalTokenRegistry.LeverageTier.TIER_5X, 999 ether);
        assertEq(registry.tierMinLP(IExternalTokenRegistry.LeverageTier.TIER_5X), 999 ether);
    }

    function test_setTreasury_rejectsZero() public {
        vm.prank(owner);
        vm.expectRevert(IExternalTokenRegistry.ZeroAddress.selector);
        registry.setTreasury(address(0));
    }

    function test_setAdmin_rejectsZero() public {
        vm.prank(owner);
        vm.expectRevert(IExternalTokenRegistry.ZeroAddress.selector);
        registry.setAdmin(address(0));
    }

    function test_setAdmin_updatesAdminAndHonorsNewRole() public {
        address newAdmin = address(0xBEEF);
        vm.prank(owner);
        registry.setAdmin(newAdmin);
        assertEq(registry.admin(), newAdmin);

        // Old admin loses privileges
        uint256 appId = _aliceAppliesTier2X();
        vm.prank(admin);
        vm.expectRevert(IExternalTokenRegistry.NotAdmin.selector);
        registry.approveListing(appId);

        // New admin works
        vm.prank(newAdmin);
        registry.approveListing(appId);
    }

    // ============================================================
    //  View helpers
    // ============================================================

    function test_getMaxLeverageForToken_returnsZeroWhenNotActive() public view {
        assertEq(registry.getMaxLeverageForToken(tokenA), 0);
    }

    function test_getMaxLeverageForToken_returnsEachTierCorrectly() public {
        // 2x
        uint256 a = _aliceAppliesTier2X();
        vm.prank(admin);
        registry.approveListing(a);
        assertEq(registry.getMaxLeverageForToken(tokenA), 2);

        // Register tokenB @ 10x via bob
        uint256 cost10x = _totalCost(IExternalTokenRegistry.LeverageTier.TIER_10X);
        vm.prank(bob);
        uint256 b = registry.applyListing{value: cost10x}(
            tokenB, address(validPairB), IExternalTokenRegistry.LeverageTier.TIER_10X
        );
        vm.prank(admin);
        registry.approveListing(b);
        assertEq(registry.getMaxLeverageForToken(tokenB), 10);
    }

    function test_getActiveListings_reflectsApproveAndDelist() public {
        uint256 a = _aliceAppliesTier2X();
        vm.prank(admin);
        registry.approveListing(a);
        assertEq(registry.getActiveListings().length, 1);

        vm.prank(admin);
        registry.delistListing(a, "x");
        assertEq(registry.getActiveListings().length, 0);
    }

    // ============================================================
    //  Invariants / accidental-transfer guards
    // ============================================================

    function test_receive_revertsOnDirectTransfer() public {
        vm.deal(stranger, 1 ether);
        vm.prank(stranger);
        (bool ok, ) = address(registry).call{value: 0.5 ether}("");
        assertFalse(ok, "direct BNB transfer must revert");
    }

    function test_rescueStrandedBNB_movesOnlyExcess() public {
        uint256 appId = _aliceAppliesTier2X();
        (appId);
        uint256 escrow = registry.listingsLPTotal();

        // Force some BNB in via selfdestruct-like workaround:
        // we just vm.deal the registry (simulates a stray transfer that somehow bypassed receive)
        vm.deal(address(registry), escrow + 3 ether);
        assertEq(address(registry).balance, escrow + 3 ether);

        address recipient = address(0xCAFE);
        vm.prank(owner);
        registry.rescueStrandedBNB(recipient);

        assertEq(recipient.balance, 3 ether);
        assertEq(address(registry).balance, escrow, "escrow untouched");
    }

    function test_rescueStrandedBNB_revertsIfNoExcess() public {
        _aliceAppliesTier2X();
        vm.prank(owner);
        vm.expectRevert(IExternalTokenRegistry.TransferFailed.selector);
        registry.rescueStrandedBNB(owner);
    }

    function test_listingsLPTotal_invariantAcrossLifecycle() public {
        // 3 listings created — `a` stays pending (never slashed/withdrawn), used as baseline
        _aliceAppliesTier2X();
        uint256 b;
        uint256 c;

        uint256 cost3 = _totalCost(IExternalTokenRegistry.LeverageTier.TIER_3X);
        vm.prank(bob);
        b = registry.applyListing{value: cost3}(
            tokenB, address(validPairB), IExternalTokenRegistry.LeverageTier.TIER_3X
        );

        // Alice applies for another token (use pairA swapped side — create a new pair)
        address tokenC = address(0xC01);
        MockPair pairC = new MockPair(wbnb, tokenC);
        uint256 cost5 = _totalCost(IExternalTokenRegistry.LeverageTier.TIER_5X);
        vm.prank(alice);
        c = registry.applyListing{value: cost5}(
            tokenC, address(pairC), IExternalTokenRegistry.LeverageTier.TIER_5X
        );

        uint256 expectedTotal = _minLP(IExternalTokenRegistry.LeverageTier.TIER_2X)
                              + _minLP(IExternalTokenRegistry.LeverageTier.TIER_3X)
                              + _minLP(IExternalTokenRegistry.LeverageTier.TIER_5X);
        assertEq(registry.listingsLPTotal(), expectedTotal);

        // Slash b → LP moves out
        vm.prank(admin);
        registry.slashListing(b, "x");
        expectedTotal -= _minLP(IExternalTokenRegistry.LeverageTier.TIER_3X);
        assertEq(registry.listingsLPTotal(), expectedTotal);

        // Reject c → LP still escrowed
        vm.prank(admin);
        registry.rejectListing(c, "x");
        assertEq(registry.listingsLPTotal(), expectedTotal);

        // Alice withdraws c LP
        vm.prank(alice);
        registry.withdrawProjectLP(c);
        expectedTotal -= _minLP(IExternalTokenRegistry.LeverageTier.TIER_5X);
        assertEq(registry.listingsLPTotal(), expectedTotal);
    }
}
