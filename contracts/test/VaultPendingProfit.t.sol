// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Test.sol";
import "../src/common/Vault.sol";

/**
 * @title VaultPendingProfit Test
 * @notice H-016: 测试待领取盈利机制
 */
contract VaultPendingProfitTest is Test {
    Vault public vault;
    MockInsuranceFundWithBalance public insuranceFund;

    address public owner = address(this);
    address public authorizedContract = address(0x1);
    address public user = address(0x100);

    uint256 public constant INITIAL_DEPOSIT = 10 ether;
    uint256 public constant INSURANCE_INITIAL = 100 ether;

    event ProfitPending(address indexed user, uint256 amount);
    event ProfitClaimed(address indexed user, uint256 amount);
    event ProfitPaid(address indexed user, uint256 collateral, uint256 profit);

    function setUp() public {
        vault = new Vault();
        insuranceFund = new MockInsuranceFundWithBalance();

        // 设置保险基金
        vault.setInsuranceFund(address(insuranceFund));

        // 授权合约
        vault.setAuthorizedContract(authorizedContract, true);

        // 给保险基金初始资金
        vm.deal(address(insuranceFund), INSURANCE_INITIAL);

        // 用户存款
        vm.deal(user, INITIAL_DEPOSIT);
        vm.prank(user);
        vault.deposit{value: INITIAL_DEPOSIT}();

        // 锁定保证金（模拟开仓）
        vm.prank(authorizedContract);
        vault.lockMargin(user, INITIAL_DEPOSIT);
    }

    // ============================================================
    // 盈利支付成功测试
    // ============================================================

    function test_SettleProfit_Success() public {
        uint256 collateral = 10 ether;
        uint256 profit = 5 ether;

        uint256 userBalanceBefore = vault.balances(user);

        vm.prank(authorizedContract);
        vault.settleProfit(user, collateral, profit);

        // 保证金应该返还给用户
        assertEq(vault.balances(user), userBalanceBefore + collateral, "Collateral should be returned");

        // 没有待领取盈利
        assertEq(vault.pendingProfits(user), 0, "No pending profit when successful");
    }

    // ============================================================
    // 盈利支付失败 - 记录待领取
    // ============================================================

    function test_SettleProfit_Fails_RecordsPending() public {
        // 使用会拒绝支付的保险基金
        RejectingInsuranceFund rejectingFund = new RejectingInsuranceFund();
        vault.setInsuranceFund(address(rejectingFund));

        uint256 collateral = 10 ether;
        uint256 profit = 5 ether;

        vm.expectEmit(true, false, false, true);
        emit ProfitPending(user, profit);

        vm.prank(authorizedContract);
        vault.settleProfit(user, collateral, profit);

        // 保证金仍然返还
        assertEq(vault.balances(user), collateral, "Collateral should still be returned");

        // 盈利记录为待领取
        assertEq(vault.pendingProfits(user), profit, "Profit should be pending");
    }

    function test_SettleProfit_NoInsuranceFund_RecordsPending() public {
        // 创建没有保险基金的 Vault
        Vault vaultNoInsurance = new Vault();
        vaultNoInsurance.setAuthorizedContract(authorizedContract, true);

        vm.deal(user, INITIAL_DEPOSIT);
        vm.prank(user);
        vaultNoInsurance.deposit{value: INITIAL_DEPOSIT}();
        vm.prank(authorizedContract);
        vaultNoInsurance.lockMargin(user, INITIAL_DEPOSIT);

        uint256 collateral = 10 ether;
        uint256 profit = 5 ether;

        vm.prank(authorizedContract);
        vaultNoInsurance.settleProfit(user, collateral, profit);

        // 盈利记录为待领取
        assertEq(vaultNoInsurance.pendingProfits(user), profit, "Profit should be pending");
    }

    // ============================================================
    // 领取待支付盈利测试
    // ============================================================

    function test_ClaimPendingProfit_Success() public {
        // 先创建待领取盈利
        RejectingInsuranceFund rejectingFund = new RejectingInsuranceFund();
        vault.setInsuranceFund(address(rejectingFund));

        uint256 profit = 5 ether;
        vm.prank(authorizedContract);
        vault.settleProfit(user, INITIAL_DEPOSIT, profit);

        assertEq(vault.pendingProfits(user), profit, "Should have pending profit");

        // 换回正常的保险基金
        vault.setInsuranceFund(address(insuranceFund));

        // 用户领取
        uint256 userEthBefore = user.balance;

        vm.expectEmit(true, false, false, true);
        emit ProfitClaimed(user, profit);

        vm.prank(user);
        vault.claimPendingProfit();

        // 待领取清零
        assertEq(vault.pendingProfits(user), 0, "Pending profit should be cleared");

        // 用户收到 ETH
        assertEq(user.balance, userEthBefore + profit, "User should receive profit ETH");
    }

    function test_ClaimPendingProfit_RevertNoPending() public {
        // 没有待领取盈利时应该回滚
        vm.prank(user);
        vm.expectRevert(Vault.NoPendingProfit.selector);
        vault.claimPendingProfit();
    }

    function test_ClaimPendingProfit_RevertInsuranceInsufficient() public {
        // 创建待领取盈利
        RejectingInsuranceFund rejectingFund = new RejectingInsuranceFund();
        vault.setInsuranceFund(address(rejectingFund));

        uint256 profit = 5 ether;
        vm.prank(authorizedContract);
        vault.settleProfit(user, INITIAL_DEPOSIT, profit);

        // 尝试领取（保险基金仍然拒绝）
        vm.prank(user);
        vm.expectRevert(Vault.InsuranceFundInsufficient.selector);
        vault.claimPendingProfit();

        // 待领取应该保留
        assertEq(vault.pendingProfits(user), profit, "Pending profit should remain");
    }

    // ============================================================
    // 部分领取测试
    // ============================================================

    function test_ClaimPartialPendingProfit_Success() public {
        // 创建待领取盈利
        RejectingInsuranceFund rejectingFund = new RejectingInsuranceFund();
        vault.setInsuranceFund(address(rejectingFund));

        uint256 profit = 10 ether;
        vm.prank(authorizedContract);
        vault.settleProfit(user, INITIAL_DEPOSIT, profit);

        // 换回正常的保险基金
        vault.setInsuranceFund(address(insuranceFund));

        // 部分领取
        uint256 claimAmount = 3 ether;
        uint256 userEthBefore = user.balance;

        vm.prank(user);
        vault.claimPartialPendingProfit(claimAmount);

        // 待领取减少
        assertEq(vault.pendingProfits(user), profit - claimAmount, "Pending should decrease");

        // 用户收到部分 ETH
        assertEq(user.balance, userEthBefore + claimAmount, "User should receive partial profit");
    }

    function test_ClaimPartialPendingProfit_RevertZeroAmount() public {
        // 创建待领取盈利
        RejectingInsuranceFund rejectingFund = new RejectingInsuranceFund();
        vault.setInsuranceFund(address(rejectingFund));
        vm.prank(authorizedContract);
        vault.settleProfit(user, INITIAL_DEPOSIT, 5 ether);

        vault.setInsuranceFund(address(insuranceFund));

        vm.prank(user);
        vm.expectRevert(Vault.InvalidAmount.selector);
        vault.claimPartialPendingProfit(0);
    }

    function test_ClaimPartialPendingProfit_RevertExceedsPending() public {
        // 创建待领取盈利
        RejectingInsuranceFund rejectingFund = new RejectingInsuranceFund();
        vault.setInsuranceFund(address(rejectingFund));
        vm.prank(authorizedContract);
        vault.settleProfit(user, INITIAL_DEPOSIT, 5 ether);

        vault.setInsuranceFund(address(insuranceFund));

        vm.prank(user);
        vm.expectRevert(Vault.InvalidAmount.selector);
        vault.claimPartialPendingProfit(10 ether); // 超过待领取金额
    }

    // ============================================================
    // 累积待领取测试
    // ============================================================

    function test_PendingProfit_Accumulates() public {
        // 使用拒绝支付的保险基金
        RejectingInsuranceFund rejectingFund = new RejectingInsuranceFund();
        vault.setInsuranceFund(address(rejectingFund));

        // 多次结算盈利
        vm.startPrank(authorizedContract);
        vault.settleProfit(user, 3 ether, 2 ether);   // pending += 2
        vault.settleProfit(user, 3 ether, 3 ether);   // pending += 3
        vault.settleProfit(user, 4 ether, 5 ether);   // pending += 5
        vm.stopPrank();

        // 待领取应该累积
        assertEq(vault.pendingProfits(user), 10 ether, "Pending profits should accumulate");
    }

    // ============================================================
    // View 函数测试
    // ============================================================

    function test_GetPendingProfit() public {
        assertEq(vault.getPendingProfit(user), 0, "Initially no pending");

        // 创建待领取
        RejectingInsuranceFund rejectingFund = new RejectingInsuranceFund();
        vault.setInsuranceFund(address(rejectingFund));
        vm.prank(authorizedContract);
        vault.settleProfit(user, INITIAL_DEPOSIT, 7 ether);

        assertEq(vault.getPendingProfit(user), 7 ether, "Should return pending amount");
    }
}

/**
 * @notice Mock Insurance Fund that can pay profits
 */
contract MockInsuranceFundWithBalance {
    receive() external payable {}

    function payProfit(address user, uint256 amount) external {
        require(address(this).balance >= amount, "Insufficient balance");
        (bool success,) = user.call{value: amount}("");
        require(success, "Transfer failed");
    }

    function coverDeficit(uint256 amount) external returns (uint256) {
        if (address(this).balance >= amount) {
            (bool success,) = msg.sender.call{value: amount}("");
            if (success) return amount;
        }
        return 0;
    }
}

/**
 * @notice Insurance Fund that always rejects payProfit calls
 */
contract RejectingInsuranceFund {
    receive() external payable {}

    function payProfit(address, uint256) external pure {
        revert("Rejecting profit payment");
    }

    function coverDeficit(uint256) external pure returns (uint256) {
        return 0;
    }
}
