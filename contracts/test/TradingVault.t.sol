// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Test.sol";
import "../src/perpetual/TradingVault.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/utils/cryptography/MerkleProof.sol";

/**
 * @title MockWBNB
 * @notice Test WBNB token with deposit()/withdraw() for TradingVault tests
 */
contract MockWBNB is ERC20 {
    constructor() ERC20("Wrapped BNB", "WBNB") {}

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    function deposit() external payable {
        _mint(msg.sender, msg.value);
    }

    function withdraw(uint256 amount) external {
        _burn(msg.sender, amount);
        (bool ok,) = msg.sender.call{value: amount}("");
        require(ok, "transfer failed");
    }

    function balanceOf(address account) public view override returns (uint256) {
        return super.balanceOf(account);
    }

    receive() external payable {}
}

/**
 * @title TradingVault Test
 * @notice Unified tests for TradingVault = SettlementV2 (user margin) + PerpVault (LP pool)
 *
 * Tests cover:
 *   - User deposits (WBNB + native BNB)
 *   - FastWithdraw (signature-only, daily use)
 *   - Merkle withdraw (fallback)
 *   - LP deposits, withdrawals, share accounting
 *   - Settlement (pure bookkeeping, no transfers)
 *   - OI tracking
 *   - Admin functions
 *   - Edge cases & authorization
 */
contract TradingVaultTest is Test {
    TradingVault public vault;
    MockWBNB public wbnb;

    // Test accounts
    address public owner;
    uint256 public ownerKey = 1;

    address public platformSigner;
    uint256 public platformSignerKey = 2;

    address public updater;
    uint256 public updaterKey = 3;

    address public user1;
    uint256 public user1Key = 4;

    address public user2;
    uint256 public user2Key = 5;

    address public matchingEngine = address(0x100);
    address public lp1 = address(0x10);
    address public lp2 = address(0x11);
    address public trader1 = address(0x20);
    address public liquidator1 = address(0x30);
    address public tokenA = address(0xA);
    address public tokenB = address(0xB);

    uint256 constant WBNB_UNIT = 1e18;
    uint256 constant PRECISION = 1e18;
    uint256 constant FEE_PRECISION = 10000;
    uint256 constant DEAD_SHARES = 1000;

    // Default fee is 50 bps (0.5%) in TradingVault
    uint256 constant DEFAULT_FEE_BPS = 50;

    // EIP-712 type hashes
    bytes32 public constant WITHDRAWAL_TYPEHASH = keccak256(
        "Withdrawal(address user,uint256 amount,uint256 nonce,uint256 deadline,bytes32 merkleRoot)"
    );
    bytes32 public constant FAST_WITHDRAWAL_TYPEHASH = keccak256(
        "FastWithdrawal(address user,uint256 amount,uint256 nonce,uint256 deadline)"
    );

    // Helper: calculate LP deposit fee
    function _depositFee(uint256 amount) internal pure returns (uint256) {
        return (amount * DEFAULT_FEE_BPS) / FEE_PRECISION;
    }

    function _netDeposit(uint256 amount) internal pure returns (uint256) {
        return amount - _depositFee(amount);
    }

    function _firstDepositShares(uint256 amount) internal pure returns (uint256) {
        return _netDeposit(amount) - DEAD_SHARES;
    }

    function _withdrawalFee(uint256 grossETH) internal pure returns (uint256) {
        return (grossETH * DEFAULT_FEE_BPS) / FEE_PRECISION;
    }

    function setUp() public {
        // Generate addresses from private keys
        owner = vm.addr(ownerKey);
        platformSigner = vm.addr(platformSignerKey);
        updater = vm.addr(updaterKey);
        user1 = vm.addr(user1Key);
        user2 = vm.addr(user2Key);

        // Deploy MockWBNB
        wbnb = new MockWBNB();

        // Deploy TradingVault
        vm.prank(owner);
        vault = new TradingVault(
            address(wbnb),
            platformSigner,
            owner
        );

        // Authorize updater + matching engine
        vm.startPrank(owner);
        vault.setAuthorizedUpdater(updater, true);
        vault.setAuthorizedContract(matchingEngine, true);
        vm.stopPrank();

        // Mint WBNB to users (10 BNB each)
        wbnb.mint(user1, 10 * WBNB_UNIT);
        wbnb.mint(user2, 10 * WBNB_UNIT);

        // Users approve TradingVault
        vm.prank(user1);
        wbnb.approve(address(vault), type(uint256).max);
        vm.prank(user2);
        wbnb.approve(address(vault), type(uint256).max);

        // Fund LP and trader accounts with BNB for LP deposits
        vm.deal(lp1, 1000 ether);
        vm.deal(lp2, 1000 ether);
        vm.deal(trader1, 100 ether);
        vm.deal(liquidator1, 100 ether);
    }

    // ============================================================
    // 1. User WBNB Deposits
    // ============================================================

    function test_deposit() public {
        vm.prank(user1);
        vault.deposit(5 * WBNB_UNIT);

        assertEq(vault.getUserDeposits(user1), 5 * WBNB_UNIT);
        assertEq(wbnb.balanceOf(address(vault)), 5 * WBNB_UNIT);
    }

    function test_depositFor() public {
        vm.prank(user1);
        vault.depositFor(user2, 3 * WBNB_UNIT);

        assertEq(vault.getUserDeposits(user2), 3 * WBNB_UNIT);
        assertEq(wbnb.balanceOf(user1), 7 * WBNB_UNIT);
    }

    function test_deposit_zeroAmount_reverts() public {
        vm.prank(user1);
        vm.expectRevert(TradingVault.InvalidAmount.selector);
        vault.deposit(0);
    }

    function test_depositFor_zeroAddress_reverts() public {
        vm.prank(user1);
        vm.expectRevert(TradingVault.ZeroAddress.selector);
        vault.depositFor(address(0), 1 * WBNB_UNIT);
    }

    // ============================================================
    // 2. User Native BNB Deposits
    // ============================================================

    function test_depositBNB() public {
        vm.deal(user1, 5 ether);
        vm.prank(user1);
        vault.depositBNB{value: 3 ether}();

        assertEq(vault.getUserDeposits(user1), 3 * WBNB_UNIT);
        assertEq(wbnb.balanceOf(address(vault)), 3 * WBNB_UNIT);
        assertEq(vault.totalDeposited(), 3 * WBNB_UNIT);
    }

    function test_depositBNB_zeroAmount_reverts() public {
        vm.deal(user1, 1 ether);
        vm.prank(user1);
        vm.expectRevert(TradingVault.InvalidAmount.selector);
        vault.depositBNB{value: 0}();
    }

    function test_depositBNBFor() public {
        vm.deal(user1, 5 ether);
        vm.prank(user1);
        vault.depositBNBFor{value: 2 ether}(user2);

        assertEq(vault.getUserDeposits(user2), 2 * WBNB_UNIT);
        assertEq(wbnb.balanceOf(address(vault)), 2 * WBNB_UNIT);
    }

    function test_depositBNBFor_zeroAddress_reverts() public {
        vm.deal(user1, 1 ether);
        vm.prank(user1);
        vm.expectRevert(TradingVault.ZeroAddress.selector);
        vault.depositBNBFor{value: 1 ether}(address(0));
    }

    // ============================================================
    // 3. Deposit Caps
    // ============================================================

    function test_deposit_exceedsUserCap_reverts() public {
        vm.prank(owner);
        vault.setDepositCapPerUser(2 * WBNB_UNIT);

        vm.prank(user1);
        vault.deposit(15 * WBNB_UNIT / 10);

        vm.prank(user1);
        vm.expectRevert(TradingVault.UserDepositCapExceeded.selector);
        vault.deposit(6 * WBNB_UNIT / 10);
    }

    function test_deposit_exceedsTotalCap_reverts() public {
        vm.prank(owner);
        vault.setDepositCapTotal(3 * WBNB_UNIT);

        vm.prank(user1);
        vault.deposit(2 * WBNB_UNIT);

        vm.prank(user2);
        vm.expectRevert(TradingVault.TotalDepositCapExceeded.selector);
        vault.deposit(15 * WBNB_UNIT / 10);

        // Exact cap should work
        vm.prank(user2);
        vault.deposit(1 * WBNB_UNIT);
        assertEq(vault.totalDeposited(), 3 * WBNB_UNIT);
    }

    function test_depositBNB_exceedsUserCap_reverts() public {
        vm.prank(owner);
        vault.setDepositCapPerUser(2 * WBNB_UNIT);

        vm.deal(user1, 5 ether);
        vm.prank(user1);
        vm.expectRevert(TradingVault.UserDepositCapExceeded.selector);
        vault.depositBNB{value: 3 ether}();
    }

    // ============================================================
    // 4. FastWithdraw (signature-only, daily path)
    // ============================================================

    function test_fastWithdraw_fullFlow() public {
        // 1. User deposits 5 WBNB
        vm.prank(user1);
        vault.deposit(5 * WBNB_UNIT);

        // 2. Generate fast withdrawal signature
        uint256 withdrawAmount = 2 * WBNB_UNIT;
        uint256 nonce = 0;
        uint256 deadline = block.timestamp + 1 hours;

        bytes memory sig = _signFastWithdrawal(user1, withdrawAmount, nonce, deadline);

        // 3. User submits fastWithdraw
        uint256 balBefore = wbnb.balanceOf(user1);
        vm.prank(user1);
        vault.fastWithdraw(withdrawAmount, nonce, deadline, sig);

        // 4. Verify
        assertEq(wbnb.balanceOf(user1) - balBefore, withdrawAmount);
        assertEq(vault.getFastWithdrawalNonce(user1), 1);
        assertEq(vault.getUserTotalWithdrawn(user1), withdrawAmount);
    }

    function test_fastWithdraw_invalidSignature_reverts() public {
        vm.prank(user1);
        vault.deposit(5 * WBNB_UNIT);

        uint256 deadline = block.timestamp + 1 hours;

        // Sign with wrong key (user1Key instead of platformSignerKey)
        bytes32 structHash = keccak256(
            abi.encode(FAST_WITHDRAWAL_TYPEHASH, user1, 1 * WBNB_UNIT, uint256(0), deadline)
        );
        bytes32 digest = keccak256(
            abi.encodePacked("\x19\x01", vault.domainSeparator(), structHash)
        );
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(user1Key, digest);
        bytes memory wrongSig = abi.encodePacked(r, s, v);

        vm.prank(user1);
        vm.expectRevert(TradingVault.InvalidSignature.selector);
        vault.fastWithdraw(1 * WBNB_UNIT, 0, deadline, wrongSig);
    }

    function test_fastWithdraw_expiredDeadline_reverts() public {
        vm.prank(user1);
        vault.deposit(5 * WBNB_UNIT);

        uint256 pastDeadline = block.timestamp - 1;
        bytes memory sig = _signFastWithdrawal(user1, 1 * WBNB_UNIT, 0, pastDeadline);

        vm.prank(user1);
        vm.expectRevert(TradingVault.DeadlineExpired.selector);
        vault.fastWithdraw(1 * WBNB_UNIT, 0, pastDeadline, sig);
    }

    function test_fastWithdraw_invalidNonce_reverts() public {
        vm.prank(user1);
        vault.deposit(5 * WBNB_UNIT);

        uint256 deadline = block.timestamp + 1 hours;
        // Use nonce 1 when expected nonce is 0
        bytes memory sig = _signFastWithdrawal(user1, 1 * WBNB_UNIT, 1, deadline);

        vm.prank(user1);
        vm.expectRevert(TradingVault.InvalidNonce.selector);
        vault.fastWithdraw(1 * WBNB_UNIT, 1, deadline, sig);
    }

    function test_fastWithdraw_insufficientBalance_reverts() public {
        // Deposit only 1 WBNB
        vm.prank(user1);
        vault.deposit(1 * WBNB_UNIT);

        uint256 deadline = block.timestamp + 1 hours;
        // Try to withdraw 5 WBNB (more than contract holds)
        bytes memory sig = _signFastWithdrawal(user1, 5 * WBNB_UNIT, 0, deadline);

        vm.prank(user1);
        vm.expectRevert(TradingVault.InsufficientEquity.selector);
        vault.fastWithdraw(5 * WBNB_UNIT, 0, deadline, sig);
    }

    function test_fastWithdraw_nonceTracking() public {
        vm.prank(user1);
        vault.deposit(10 * WBNB_UNIT);

        uint256 deadline = block.timestamp + 1 hours;

        // First fastWithdraw (nonce 0)
        bytes memory sig0 = _signFastWithdrawal(user1, 2 * WBNB_UNIT, 0, deadline);
        vm.prank(user1);
        vault.fastWithdraw(2 * WBNB_UNIT, 0, deadline, sig0);
        assertEq(vault.getFastWithdrawalNonce(user1), 1);

        // Second fastWithdraw (nonce 1)
        bytes memory sig1 = _signFastWithdrawal(user1, 3 * WBNB_UNIT, 1, deadline);
        vm.prank(user1);
        vault.fastWithdraw(3 * WBNB_UNIT, 1, deadline, sig1);
        assertEq(vault.getFastWithdrawalNonce(user1), 2);

        assertEq(vault.getUserTotalWithdrawn(user1), 5 * WBNB_UNIT);
    }

    function test_fastWithdraw_whenPaused_reverts() public {
        vm.prank(user1);
        vault.deposit(5 * WBNB_UNIT);

        vm.prank(owner);
        vault.pause();

        uint256 deadline = block.timestamp + 1 hours;
        bytes memory sig = _signFastWithdrawal(user1, 1 * WBNB_UNIT, 0, deadline);

        vm.prank(user1);
        vm.expectRevert(Pausable.EnforcedPause.selector);
        vault.fastWithdraw(1 * WBNB_UNIT, 0, deadline, sig);
    }

    function test_fastWithdraw_zeroAmount_reverts() public {
        vm.prank(user1);
        vault.deposit(5 * WBNB_UNIT);

        uint256 deadline = block.timestamp + 1 hours;
        bytes memory sig = _signFastWithdrawal(user1, 0, 0, deadline);

        vm.prank(user1);
        vm.expectRevert(TradingVault.InvalidAmount.selector);
        vault.fastWithdraw(0, 0, deadline, sig);
    }

    // ============================================================
    // 5. Merkle Withdraw (fallback path)
    // ============================================================

    function test_withdraw_fullFlow() public {
        // 1. Users deposit
        vm.prank(user1);
        vault.deposit(5 * WBNB_UNIT);
        vm.prank(user2);
        vault.deposit(5 * WBNB_UNIT);

        // 2. Build Merkle tree (user1 profited: equity=7, user2 lost: equity=3)
        uint256 user1Equity = 7 * WBNB_UNIT;
        uint256 user2Equity = 3 * WBNB_UNIT;

        bytes32 leaf1 = keccak256(abi.encodePacked(user1, user1Equity));
        bytes32 leaf2 = keccak256(abi.encodePacked(user2, user2Equity));
        bytes32 merkleRoot = _hashPair(leaf1, leaf2);

        // 3. Submit state root
        vm.prank(updater);
        vault.updateStateRoot(merkleRoot);

        // 4. Verify Merkle proof
        bytes32[] memory proof1 = new bytes32[](1);
        proof1[0] = leaf2;
        assertTrue(vault.verifyMerkleProof(user1, user1Equity, proof1));

        // 5. User1 withdraws 2 BNB profit
        uint256 deadline = block.timestamp + 1 hours;
        bytes memory sig = _signMerkleWithdrawal(user1, 2 * WBNB_UNIT, 0, deadline, merkleRoot);

        uint256 balBefore = wbnb.balanceOf(user1);
        vm.prank(user1);
        vault.withdraw(2 * WBNB_UNIT, user1Equity, proof1, deadline, sig);

        assertEq(wbnb.balanceOf(user1) - balBefore, 2 * WBNB_UNIT);
        assertEq(vault.getUserNonce(user1), 1);
        assertEq(vault.getUserTotalWithdrawn(user1), 2 * WBNB_UNIT);

        // 6. User1 withdraws remaining equity
        bytes memory sig2 = _signMerkleWithdrawal(user1, 5 * WBNB_UNIT, 1, deadline, merkleRoot);
        vm.prank(user1);
        vault.withdraw(5 * WBNB_UNIT, user1Equity, proof1, deadline, sig2);
        assertEq(vault.getUserTotalWithdrawn(user1), 7 * WBNB_UNIT);
    }

    function test_withdraw_exceedsEquity_reverts() public {
        vm.prank(user1);
        vault.deposit(5 * WBNB_UNIT);

        uint256 user1Equity = 5 * WBNB_UNIT;
        bytes32 leaf = keccak256(abi.encodePacked(user1, user1Equity));
        bytes32 merkleRoot = _hashPair(leaf, leaf);

        vm.prank(updater);
        vault.updateStateRoot(merkleRoot);

        bytes32[] memory proof = new bytes32[](1);
        proof[0] = leaf;

        uint256 deadline = block.timestamp + 1 hours;
        bytes memory sig = _signMerkleWithdrawal(user1, 6 * WBNB_UNIT, 0, deadline, merkleRoot);

        vm.prank(user1);
        vm.expectRevert(TradingVault.InsufficientEquity.selector);
        vault.withdraw(6 * WBNB_UNIT, user1Equity, proof, deadline, sig);
    }

    function test_withdraw_invalidProof_reverts() public {
        vm.prank(user1);
        vault.deposit(5 * WBNB_UNIT);

        uint256 user1Equity = 5 * WBNB_UNIT;
        bytes32 fakeLeaf = keccak256(abi.encodePacked(user1, uint256(999 * WBNB_UNIT)));
        bytes32 realLeaf = keccak256(abi.encodePacked(user1, user1Equity));
        bytes32 merkleRoot = _hashPair(realLeaf, realLeaf);

        vm.prank(updater);
        vault.updateStateRoot(merkleRoot);

        bytes32[] memory wrongProof = new bytes32[](1);
        wrongProof[0] = fakeLeaf;

        uint256 deadline = block.timestamp + 1 hours;
        bytes memory sig = _signMerkleWithdrawal(user1, 1 * WBNB_UNIT, 0, deadline, merkleRoot);

        vm.prank(user1);
        vm.expectRevert(TradingVault.InvalidProof.selector);
        vault.withdraw(1 * WBNB_UNIT, user1Equity, wrongProof, deadline, sig);
    }

    function test_withdraw_expiredDeadline_reverts() public {
        vm.prank(user1);
        vault.deposit(5 * WBNB_UNIT);

        uint256 user1Equity = 5 * WBNB_UNIT;
        bytes32 leaf = keccak256(abi.encodePacked(user1, user1Equity));
        bytes32 merkleRoot = _hashPair(leaf, leaf);

        vm.prank(updater);
        vault.updateStateRoot(merkleRoot);

        bytes32[] memory proof = new bytes32[](1);
        proof[0] = leaf;

        uint256 pastDeadline = block.timestamp - 1;
        bytes memory sig = _signMerkleWithdrawal(user1, 1 * WBNB_UNIT, 0, pastDeadline, merkleRoot);

        vm.prank(user1);
        vm.expectRevert(TradingVault.DeadlineExpired.selector);
        vault.withdraw(1 * WBNB_UNIT, user1Equity, proof, pastDeadline, sig);
    }

    // ============================================================
    // 6. Dual Withdrawal Paths (don't interfere)
    // ============================================================

    function test_dualWithdrawPaths() public {
        vm.prank(user1);
        vault.deposit(10 * WBNB_UNIT);

        // Setup Merkle root
        uint256 user1Equity = 10 * WBNB_UNIT;
        bytes32 leaf = keccak256(abi.encodePacked(user1, user1Equity));
        bytes32 merkleRoot = _hashPair(leaf, leaf);
        vm.prank(updater);
        vault.updateStateRoot(merkleRoot);

        uint256 deadline = block.timestamp + 1 hours;

        // FastWithdraw uses nonce 0
        bytes memory fastSig = _signFastWithdrawal(user1, 2 * WBNB_UNIT, 0, deadline);
        vm.prank(user1);
        vault.fastWithdraw(2 * WBNB_UNIT, 0, deadline, fastSig);

        assertEq(vault.getFastWithdrawalNonce(user1), 1);
        assertEq(vault.getUserNonce(user1), 0); // Merkle nonce unaffected

        // Merkle withdraw uses its own nonce 0
        bytes32[] memory proof = new bytes32[](1);
        proof[0] = leaf;
        bytes memory merkleSig = _signMerkleWithdrawal(user1, 3 * WBNB_UNIT, 0, deadline, merkleRoot);
        vm.prank(user1);
        vault.withdraw(3 * WBNB_UNIT, user1Equity, proof, deadline, merkleSig);

        assertEq(vault.getUserNonce(user1), 1);
        assertEq(vault.getFastWithdrawalNonce(user1), 1); // Fast nonce unaffected
        assertEq(vault.getUserTotalWithdrawn(user1), 5 * WBNB_UNIT); // Shared totalWithdrawn
    }

    // ============================================================
    // 7. LP Deposits
    // ============================================================

    function test_LP_firstDeposit() public {
        vm.prank(lp1);
        vault.depositLP{value: 10 ether}();

        uint256 expectedShares = _firstDepositShares(10 ether);
        assertEq(vault.shares(lp1), expectedShares);
        assertEq(vault.totalShares(), expectedShares + DEAD_SHARES);
        assertEq(vault.shares(vault.DEAD_ADDRESS()), DEAD_SHARES);
        // lpPoolBalance = net deposit (10 - fee)
        assertEq(vault.lpPoolBalance(), _netDeposit(10 ether));
        assertEq(vault.getPoolValue(), _netDeposit(10 ether));
        // WBNB balance includes the fee
        assertEq(wbnb.balanceOf(address(vault)), 10 ether);
    }

    function test_LP_subsequentDeposit() public {
        vm.prank(lp1);
        vault.depositLP{value: 10 ether}();
        uint256 totalSharesAfterLP1 = vault.totalShares();
        uint256 poolAfterLP1 = vault.getPoolValue();

        vm.prank(lp2);
        vault.depositLP{value: 5 ether}();

        uint256 lp2Net = _netDeposit(5 ether);
        uint256 expectedLP2Shares = (lp2Net * totalSharesAfterLP1) / poolAfterLP1;
        assertEq(vault.shares(lp2), expectedLP2Shares);
    }

    function test_LP_depositRevertBelowMinimum() public {
        vm.prank(lp1);
        vm.expectRevert(TradingVault.InvalidAmount.selector);
        vault.depositLP{value: 0.0001 ether}();
    }

    function test_LP_depositRevertWhenPaused() public {
        vm.prank(owner);
        vault.pause();

        vm.prank(lp1);
        vm.expectRevert(Pausable.EnforcedPause.selector);
        vault.depositLP{value: 1 ether}();
    }

    function test_LP_depositRevertWhenLPDepositsPaused() public {
        vm.prank(owner);
        vault.setLPDepositsPaused(true);

        vm.prank(lp1);
        vm.expectRevert(TradingVault.LPDepositsPausedError.selector);
        vault.depositLP{value: 1 ether}();
    }

    // ============================================================
    // 8. LP Withdrawals (cooldown + fee)
    // ============================================================

    function test_LP_withdrawal_fullFlow() public {
        vm.prank(lp1);
        vault.depositLP{value: 10 ether}();
        uint256 lp1Shares = vault.shares(lp1);

        // Request
        vm.prank(lp1);
        vault.requestWithdrawalLP(lp1Shares);

        // Before cooldown — revert
        vm.prank(lp1);
        vm.expectRevert(TradingVault.CooldownNotMet.selector);
        vault.executeWithdrawalLP();

        // Advance past cooldown
        vm.warp(block.timestamp + 24 hours + 1);

        // Execute — LP receives BNB
        uint256 balBefore = lp1.balance;
        vm.prank(lp1);
        vault.executeWithdrawalLP();

        assertGt(lp1.balance - balBefore, 9.9 ether, "LP should receive most BNB back");
        assertEq(vault.shares(lp1), 0, "Shares should be burned");
    }

    function test_LP_withdrawal_partialShares() public {
        vm.prank(lp1);
        vault.depositLP{value: 10 ether}();
        uint256 lp1Shares = vault.shares(lp1);
        uint256 withdrawShares = lp1Shares * 4 / 10;

        vm.prank(lp1);
        vault.requestWithdrawalLP(withdrawShares);
        vm.warp(block.timestamp + 24 hours + 1);

        uint256 balBefore = lp1.balance;
        vm.prank(lp1);
        vault.executeWithdrawalLP();

        assertGt(lp1.balance - balBefore, 3.9 ether, "Should receive ~4 BNB");
        assertEq(vault.shares(lp1), lp1Shares - withdrawShares);
    }

    function test_LP_withdrawal_cancelPending() public {
        vm.prank(lp1);
        vault.depositLP{value: 10 ether}();
        uint256 lp1Shares = vault.shares(lp1);

        vm.prank(lp1);
        vault.requestWithdrawalLP(lp1Shares / 2);

        vm.prank(lp1);
        vault.cancelWithdrawalLP();

        assertEq(vault.lpWithdrawalAmount(lp1), 0);
        assertEq(vault.lpWithdrawalTimestamp(lp1), 0);
    }

    function test_LP_withdrawal_revertInsufficientShares() public {
        vm.prank(lp1);
        vault.depositLP{value: 10 ether}();
        uint256 lp1Shares = vault.shares(lp1);

        vm.prank(lp1);
        vm.expectRevert(TradingVault.InsufficientShares.selector);
        vault.requestWithdrawalLP(lp1Shares + 1);
    }

    function test_LP_withdrawal_revertBelowMinLiquidity() public {
        vm.prank(lp1);
        vault.depositLP{value: 0.15 ether}();
        uint256 lp1Shares = vault.shares(lp1);
        uint256 withdrawAmount = lp1Shares * 4 / 10;

        vm.prank(lp1);
        vault.requestWithdrawalLP(withdrawAmount);
        vm.warp(block.timestamp + 24 hours + 1);

        vm.prank(lp1);
        vm.expectRevert(TradingVault.BelowMinLiquidity.selector);
        vault.executeWithdrawalLP();
    }

    function test_LP_withdrawal_canWithdrawAll() public {
        vm.prank(lp1);
        vault.depositLP{value: 1 ether}();
        uint256 lp1Shares = vault.shares(lp1);

        vm.prank(lp1);
        vault.requestWithdrawalLP(lp1Shares);
        vm.warp(block.timestamp + 24 hours + 1);

        vm.prank(lp1);
        vault.executeWithdrawalLP();

        assertEq(vault.shares(lp1), 0);
    }

    function test_LP_withdrawalInfo() public {
        vm.prank(lp1);
        vault.depositLP{value: 10 ether}();
        uint256 lp1Shares = vault.shares(lp1);
        uint256 halfShares = lp1Shares / 2;

        vm.prank(lp1);
        vault.requestWithdrawalLP(halfShares);

        (uint256 pendingShares, uint256 requestTime, uint256 executeAfter, uint256 estimatedETH) =
            vault.getLPWithdrawalInfo(lp1);

        assertEq(pendingShares, halfShares);
        assertGt(requestTime, 0);
        assertEq(executeAfter, requestTime + 24 hours);
        uint256 expectedETH = (halfShares * vault.getSharePrice()) / PRECISION;
        assertEq(estimatedETH, expectedETH);
    }

    // ============================================================
    // 9. Settlement — Pure Bookkeeping (no transfers!)
    // ============================================================

    function test_settleTraderProfit() public {
        // First seed LP pool with deposits
        vm.prank(lp1);
        vault.depositLP{value: 10 ether}();
        uint256 poolBefore = vault.getPoolValue();

        // Settle profit — pure bookkeeping, no ETH transfer
        vm.prank(matchingEngine);
        vault.settleTraderProfit(trader1, 2 ether);

        assertEq(vault.getPoolValue(), poolBefore - 2 ether, "Pool reduced by profit");
        assertEq(vault.totalProfitsPaid(), 2 ether);
        // Trader does NOT receive ETH here — they use fastWithdraw later
    }

    function test_settleTraderProfit_ADL_partialPayment() public {
        vm.prank(lp1);
        vault.depositLP{value: 1 ether}();
        uint256 poolBefore = vault.lpPoolBalance();

        // Request 2 ETH profit but pool only has ~1 ETH → partial
        vm.prank(matchingEngine);
        vault.settleTraderProfit(trader1, 2 ether);

        assertEq(vault.lpPoolBalance(), 0, "Pool drained for ADL");
        assertEq(vault.totalProfitsPaid(), poolBefore, "Paid what was available");
    }

    function test_settleTraderProfit_revertWhenPoolEmpty() public {
        // No LP deposits, pool is empty
        vm.prank(matchingEngine);
        vm.expectRevert(TradingVault.InsufficientPoolBalance.selector);
        vault.settleTraderProfit(trader1, 1 ether);
    }

    function test_settleTraderProfit_zeroIsNoop() public {
        vm.prank(lp1);
        vault.depositLP{value: 10 ether}();
        uint256 poolBefore = vault.getPoolValue();

        vm.prank(matchingEngine);
        vault.settleTraderProfit(trader1, 0);

        assertEq(vault.getPoolValue(), poolBefore);
    }

    function test_settleTraderLoss() public {
        vm.prank(lp1);
        vault.depositLP{value: 10 ether}();
        uint256 poolBefore = vault.getPoolValue();

        // No msg.value needed — pure bookkeeping
        vm.prank(matchingEngine);
        vault.settleTraderLoss(3 ether);

        assertEq(vault.getPoolValue(), poolBefore + 3 ether, "Pool grows by loss");
        assertEq(vault.totalLossesReceived(), 3 ether);
    }

    function test_settleTraderLoss_zeroIsNoop() public {
        vm.prank(lp1);
        vault.depositLP{value: 10 ether}();
        uint256 poolBefore = vault.getPoolValue();

        vm.prank(matchingEngine);
        vault.settleTraderLoss(0);
        assertEq(vault.getPoolValue(), poolBefore);
    }

    function test_collectFee() public {
        vm.prank(lp1);
        vault.depositLP{value: 10 ether}();
        uint256 poolBefore = vault.getPoolValue();
        uint256 feesBefore = vault.totalFeesCollected();

        // No msg.value needed — pure bookkeeping
        vm.prank(matchingEngine);
        vault.collectFee(0.1 ether);

        assertEq(vault.getPoolValue(), poolBefore + 0.1 ether, "Pool grows by fee");
        assertEq(vault.totalFeesCollected(), feesBefore + 0.1 ether);
    }

    function test_settleLiquidation() public {
        vm.prank(lp1);
        vault.depositLP{value: 10 ether}();
        // Also need WBNB in contract for liquidator reward
        wbnb.mint(address(vault), 5 ether); // simulate user deposits providing WBNB

        uint256 poolBefore = vault.lpPoolBalance();
        uint256 liquidatorBefore = wbnb.balanceOf(liquidator1);

        vm.prank(matchingEngine);
        vault.settleLiquidation(5 ether, 0.5 ether, liquidator1);

        assertEq(vault.lpPoolBalance(), poolBefore + 5 ether - 0.5 ether, "Pool = +collateral - reward");
        assertEq(wbnb.balanceOf(liquidator1) - liquidatorBefore, 0.5 ether, "Liquidator gets WBNB reward");
    }

    function test_settleLiquidation_revertRewardExceedsCollateral() public {
        vm.prank(lp1);
        vault.depositLP{value: 10 ether}();

        vm.prank(matchingEngine);
        vm.expectRevert(TradingVault.InvalidAmount.selector);
        vault.settleLiquidation(1 ether, 2 ether, liquidator1);
    }

    function test_updatePendingPnL() public {
        vm.prank(lp1);
        vault.depositLP{value: 10 ether}();
        uint256 lpBalance = vault.lpPoolBalance();

        // Positive PnL = traders winning, pool shrinks
        vm.prank(matchingEngine);
        vault.updatePendingPnL(2 ether);

        assertEq(vault.getPoolValue(), lpBalance - 2 ether);
        assertEq(vault.netPendingPnL(), 2 ether);
    }

    // ============================================================
    // 10. Settlement + FastWithdraw Integration
    // ============================================================

    function test_settlementProfitThenFastWithdraw() public {
        // User deposits + LP deposits (both in same contract)
        vm.prank(user1);
        vault.deposit(5 * WBNB_UNIT);
        vm.prank(lp1);
        vault.depositLP{value: 10 ether}();

        // Settle profit for user1 (LP pool pays, bookkeeping)
        vm.prank(matchingEngine);
        vault.settleTraderProfit(user1, 2 ether);

        // User1 can fastWithdraw (money is in the contract already)
        uint256 deadline = block.timestamp + 1 hours;
        bytes memory sig = _signFastWithdrawal(user1, 7 * WBNB_UNIT, 0, deadline);

        uint256 balBefore = wbnb.balanceOf(user1);
        vm.prank(user1);
        vault.fastWithdraw(7 * WBNB_UNIT, 0, deadline, sig);

        assertEq(wbnb.balanceOf(user1) - balBefore, 7 * WBNB_UNIT);
    }

    // ============================================================
    // 11. OI Tracking
    // ============================================================

    function test_increaseOI_long() public {
        vm.prank(lp1);
        vault.depositLP{value: 10 ether}();

        vm.prank(matchingEngine);
        vault.increaseOI(tokenA, true, 2 ether);

        (uint256 long_, uint256 short_) = vault.getTokenOI(tokenA);
        assertEq(long_, 2 ether);
        assertEq(short_, 0);
        assertEq(vault.getTotalOI(), 2 ether);
    }

    function test_increaseOI_revertExceedsMax() public {
        vm.prank(lp1);
        vault.depositLP{value: 10 ether}();

        // maxOI = poolValue * 50% (default maxUtilization)
        uint256 maxOI = vault.getMaxOI();

        vm.prank(matchingEngine);
        vm.expectRevert(TradingVault.ExceedsMaxOI.selector);
        vault.increaseOI(tokenA, true, maxOI + 1);
    }

    function test_increaseOI_revertExceedsPerTokenMax() public {
        vm.prank(lp1);
        vault.depositLP{value: 100 ether}();

        vm.prank(owner);
        vault.setMaxOIPerToken(tokenA, 5 ether);

        vm.prank(matchingEngine);
        vm.expectRevert(TradingVault.ExceedsMaxOI.selector);
        vault.increaseOI(tokenA, true, 6 ether);
    }

    function test_decreaseOI() public {
        vm.prank(lp1);
        vault.depositLP{value: 10 ether}();

        vm.prank(matchingEngine);
        vault.increaseOI(tokenA, true, 4 ether);
        vm.prank(matchingEngine);
        vault.decreaseOI(tokenA, true, 3 ether);

        (uint256 long_,) = vault.getTokenOI(tokenA);
        assertEq(long_, 1 ether);
        assertEq(vault.totalOIAccumulator(), 1 ether);
    }

    function test_decreaseOI_cannotUnderflow() public {
        vm.prank(lp1);
        vault.depositLP{value: 10 ether}();

        vm.prank(matchingEngine);
        vault.increaseOI(tokenA, true, 2 ether);
        vm.prank(matchingEngine);
        vault.decreaseOI(tokenA, true, 5 ether);

        (uint256 long_,) = vault.getTokenOI(tokenA);
        assertEq(long_, 0);
        assertEq(vault.totalOIAccumulator(), 0);
    }

    function test_OI_multipleTokens() public {
        vm.prank(lp1);
        vault.depositLP{value: 20 ether}();

        vm.prank(matchingEngine);
        vault.increaseOI(tokenA, true, 3 ether);
        vm.prank(matchingEngine);
        vault.increaseOI(tokenB, false, 4 ether);

        assertEq(vault.getTotalOI(), 7 ether);
        assertEq(vault.getOITokenCount(), 2);
    }

    // ============================================================
    // 12. State Root Management
    // ============================================================

    function test_updateStateRoot() public {
        bytes32 root1 = keccak256("root1");

        vm.prank(updater);
        vault.updateStateRoot(root1);

        (bytes32 currentRoot,,) = vault.currentStateRoot();
        assertEq(currentRoot, root1);

        bytes32 root2 = keccak256("root2");
        vm.prank(owner);
        vault.updateStateRoot(root2);

        (currentRoot,,) = vault.currentStateRoot();
        assertEq(currentRoot, root2);
        assertEq(vault.getStateRootHistoryLength(), 1);
    }

    function test_updateStateRoot_unauthorized_reverts() public {
        vm.prank(user1);
        vm.expectRevert(TradingVault.UnauthorizedUpdater.selector);
        vault.updateStateRoot(keccak256("root"));
    }

    // ============================================================
    // 13. Authorization Tests
    // ============================================================

    function test_unauthorized_settleProfit() public {
        vm.prank(lp1);
        vault.depositLP{value: 10 ether}();

        vm.prank(lp1);
        vm.expectRevert(TradingVault.Unauthorized.selector);
        vault.settleTraderProfit(trader1, 1 ether);
    }

    function test_unauthorized_settleLoss() public {
        vm.prank(lp1);
        vm.expectRevert(TradingVault.Unauthorized.selector);
        vault.settleTraderLoss(1 ether);
    }

    function test_unauthorized_increaseOI() public {
        vm.prank(lp1);
        vm.expectRevert(TradingVault.Unauthorized.selector);
        vault.increaseOI(tokenA, true, 1 ether);
    }

    function test_unauthorized_collectFee() public {
        vm.prank(lp1);
        vm.expectRevert(TradingVault.Unauthorized.selector);
        vault.collectFee(1 ether);
    }

    // ============================================================
    // 14. Admin Functions
    // ============================================================

    function test_admin_setPlatformSigner() public {
        address newSigner = makeAddr("newSigner");

        vm.prank(owner);
        vault.setPlatformSigner(newSigner);
        assertEq(vault.platformSigner(), newSigner);
    }

    function test_admin_setUpdater() public {
        address newUpdater = makeAddr("newUpdater");
        vm.prank(owner);
        vault.setAuthorizedUpdater(newUpdater, true);
        assertTrue(vault.authorizedUpdaters(newUpdater));

        vm.prank(owner);
        vault.setAuthorizedUpdater(newUpdater, false);
        assertFalse(vault.authorizedUpdaters(newUpdater));
    }

    function test_admin_setMaxOIPerToken() public {
        vm.prank(owner);
        vault.setMaxOIPerToken(tokenA, 50 ether);
        assertEq(vault.maxOIPerToken(tokenA), 50 ether);
    }

    function test_admin_setCooldown() public {
        vm.prank(owner);
        vault.setCooldown(12 hours);
        assertEq(vault.withdrawalCooldown(), 12 hours);
    }

    function test_admin_setCooldown_revertTooLong() public {
        vm.prank(owner);
        vm.expectRevert(TradingVault.CooldownTooLong.selector);
        vault.setCooldown(8 days);
    }

    function test_admin_pause_unpause() public {
        vm.prank(owner);
        vault.pause();
        assertTrue(vault.paused());

        vm.prank(user1);
        vm.expectRevert(Pausable.EnforcedPause.selector);
        vault.deposit(1 * WBNB_UNIT);

        vm.prank(owner);
        vault.unpause();

        vm.prank(user1);
        vault.deposit(1 * WBNB_UNIT);
        assertEq(vault.getUserDeposits(user1), 1 * WBNB_UNIT);
    }

    function test_admin_onlyOwner() public {
        vm.prank(user1);
        vm.expectRevert(
            abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, user1)
        );
        vault.pause();

        vm.prank(user1);
        vm.expectRevert(
            abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, user1)
        );
        vault.setDepositCapPerUser(1 * WBNB_UNIT);
    }

    function test_transferOwnership_twoStep() public {
        address newOwner = makeAddr("newOwner");

        vm.prank(owner);
        vault.transferOwnership(newOwner);
        assertEq(vault.owner(), owner);
        assertEq(vault.pendingOwner(), newOwner);

        vm.prank(newOwner);
        vault.acceptOwnership();
        assertEq(vault.owner(), newOwner);
    }

    // ============================================================
    // 15. View Functions
    // ============================================================

    function test_emptyPool_sharePrice() public view {
        assertEq(vault.getSharePrice(), PRECISION);
    }

    function test_emptyPool_maxOI() public view {
        assertEq(vault.getMaxOI(), 0);
    }

    function test_utilization() public {
        vm.prank(lp1);
        vault.depositLP{value: 10 ether}();

        vm.prank(matchingEngine);
        vault.increaseOI(tokenA, true, 2 ether);

        uint256 poolValue = vault.getPoolValue();
        assertEq(vault.getUtilization(), (2 ether * FEE_PRECISION) / poolValue);
    }

    function test_poolStats() public {
        vm.prank(lp1);
        vault.depositLP{value: 10 ether}();
        uint256 totalSharesNow = vault.totalShares();
        uint256 depositFee = _depositFee(10 ether);
        uint256 netDep = _netDeposit(10 ether);

        // Settle loss +2 (bookkeeping)
        vm.prank(matchingEngine);
        vault.settleTraderLoss(2 ether);

        // Settle profit -1 (bookkeeping)
        vm.prank(matchingEngine);
        vault.settleTraderProfit(trader1, 1 ether);

        // Fee +0.5 (bookkeeping)
        vm.prank(matchingEngine);
        vault.collectFee(0.5 ether);

        (
            uint256 poolValue,
            uint256 sharePrice,
            uint256 _totalShares,
            uint256 totalOI,
            uint256 maxOI,
            ,
            uint256 feesCollected,
            uint256 profitsPaid,
            uint256 lossesReceived,
        ) = vault.getPoolStats();

        // Pool = netDep + 2 - 1 + 0.5
        assertEq(poolValue, netDep + 1.5 ether);
        assertEq(_totalShares, totalSharesNow);
        assertEq(sharePrice, (poolValue * PRECISION) / totalSharesNow);
        assertEq(totalOI, 0);
        assertEq(maxOI, (poolValue * 5000) / FEE_PRECISION); // 50% maxUtilization
        assertEq(feesCollected, depositFee + 0.5 ether);
        assertEq(profitsPaid, 1 ether);
        assertEq(lossesReceived, 2 ether);
    }

    function test_shouldADL() public {
        vm.prank(lp1);
        vault.depositLP{value: 10 ether}();

        // Set large pending PnL
        vm.prank(matchingEngine);
        vault.updatePendingPnL(int256(8 ether)); // 80% of ~10 ETH pool

        (bool shouldTrigger, uint256 pnlBps) = vault.shouldADL();
        assertTrue(shouldTrigger, "Should trigger ADL at high PnL");
        assertGt(pnlBps, 7000, "PnL/pool ratio > 70%");
    }

    // ============================================================
    // 16. LP + Settlement Integration
    // ============================================================

    function test_LP_afterProfitIncrease() public {
        // LP deposits 10 BNB
        vm.prank(lp1);
        vault.depositLP{value: 10 ether}();
        uint256 lp1Shares = vault.shares(lp1);

        // User deposits 5 BNB (provides actual BNB/WBNB backing for trader loss settlement)
        vm.deal(user1, 5 ether);
        vm.prank(user1);
        vault.depositBNB{value: 5 ether}();

        // Trader loss 5 ETH (bookkeeping) → LP pool grows, WBNB already in contract
        vm.prank(matchingEngine);
        vault.settleTraderLoss(5 ether);

        // Withdraw all LP shares
        vm.prank(lp1);
        vault.requestWithdrawalLP(lp1Shares);
        vm.warp(block.timestamp + 24 hours + 1);

        uint256 balBefore = lp1.balance;
        vm.prank(lp1);
        vault.executeWithdrawalLP();

        assertGt(lp1.balance - balBefore, 14.5 ether, "Should get ~15 BNB minus fees");
    }

    function test_multipleLPs_fairDistribution() public {
        vm.prank(lp1);
        vault.depositLP{value: 10 ether}();

        vm.prank(lp2);
        vault.depositLP{value: 10 ether}();

        // Trader loss 4 ETH (bookkeeping) → pool grows
        vm.prank(matchingEngine);
        vault.settleTraderLoss(4 ether);

        uint256 lp1Val = vault.getLPValue(lp1);
        uint256 lp2Val = vault.getLPValue(lp2);
        assertGt(lp1Val, 11 ether, "LP1 profited");
        assertGt(lp2Val, 11 ether, "LP2 profited");
    }

    // ============================================================
    // 17. receive() — only from WBNB
    // ============================================================

    function test_receive_revertNonWBNB() public {
        vm.deal(user1, 1 ether);
        vm.prank(user1);
        (bool success,) = address(vault).call{value: 1 ether}("");
        assertFalse(success, "Should reject BNB from non-WBNB");
    }

    // ============================================================
    // 18. BNB deposit then fastWithdraw flow
    // ============================================================

    function test_depositBNB_then_fastWithdraw() public {
        vm.deal(user1, 5 ether);
        vm.prank(user1);
        vault.depositBNB{value: 5 ether}();

        uint256 deadline = block.timestamp + 1 hours;
        bytes memory sig = _signFastWithdrawal(user1, 3 * WBNB_UNIT, 0, deadline);

        uint256 balBefore = wbnb.balanceOf(user1);
        vm.prank(user1);
        vault.fastWithdraw(3 * WBNB_UNIT, 0, deadline, sig);

        assertEq(wbnb.balanceOf(user1) - balBefore, 3 * WBNB_UNIT);
    }

    // ============================================================
    // Helpers
    // ============================================================

    function _hashPair(bytes32 a, bytes32 b) internal pure returns (bytes32) {
        return a < b
            ? keccak256(abi.encodePacked(a, b))
            : keccak256(abi.encodePacked(b, a));
    }

    function _signFastWithdrawal(
        address user,
        uint256 amount,
        uint256 nonce,
        uint256 deadline
    ) internal view returns (bytes memory) {
        bytes32 structHash = keccak256(
            abi.encode(FAST_WITHDRAWAL_TYPEHASH, user, amount, nonce, deadline)
        );
        bytes32 digest = keccak256(
            abi.encodePacked("\x19\x01", vault.domainSeparator(), structHash)
        );
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(platformSignerKey, digest);
        return abi.encodePacked(r, s, v);
    }

    function _signMerkleWithdrawal(
        address user,
        uint256 amount,
        uint256 nonce,
        uint256 deadline,
        bytes32 merkleRoot
    ) internal view returns (bytes memory) {
        bytes32 structHash = keccak256(
            abi.encode(WITHDRAWAL_TYPEHASH, user, amount, nonce, deadline, merkleRoot)
        );
        bytes32 digest = keccak256(
            abi.encodePacked("\x19\x01", vault.domainSeparator(), structHash)
        );
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(platformSignerKey, digest);
        return abi.encodePacked(r, s, v);
    }
}
