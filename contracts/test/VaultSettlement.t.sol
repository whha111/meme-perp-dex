// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Test.sol";
import "../src/core/Vault.sol";

/**
 * @title VaultSettlement Test
 * @notice H-014, H-015: 测试修复后的 Vault 结算逻辑
 */
contract VaultSettlementTest is Test {
    Vault public vault;
    MockInsuranceFund public insuranceFund;

    address public owner = address(this);
    address public authorizedContract = address(0x1);
    address public user = address(0x100);
    address public counterparty = address(0x200);

    uint256 public constant INITIAL_DEPOSIT = 10 ether;
    uint256 public constant INSURANCE_INITIAL = 100 ether;

    function setUp() public {
        vault = new Vault();
        insuranceFund = new MockInsuranceFund();

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
    // H-014: settleBankruptcy 测试 - 保证金转移到保险基金
    // ============================================================

    function test_SettleBankruptcy_TransfersCollateralToInsurance() public {
        uint256 collateral = 10 ether;
        uint256 deficit = 5 ether; // 穿仓 5 ETH

        uint256 insuranceBalanceBefore = address(insuranceFund).balance;
        uint256 vaultBalanceBefore = address(vault).balance;

        vm.prank(authorizedContract);
        uint256 coveredDeficit = vault.settleBankruptcy(user, collateral, deficit);

        // 验证：保险基金净变化 = 收到保证金 - 支付亏空
        // Insurance: +collateral (收入), -coveredDeficit (支出)
        uint256 insuranceBalanceAfter = address(insuranceFund).balance;
        assertEq(
            insuranceBalanceAfter,
            insuranceBalanceBefore + collateral - coveredDeficit,
            "Insurance net change should be collateral minus covered deficit"
        );

        // 验证：Vault 余额变化 = 保证金转出 + 亏空覆盖收入
        // Vault: -collateral (支出), +coveredDeficit (收入)
        uint256 vaultBalanceAfter = address(vault).balance;
        assertEq(
            vaultBalanceAfter,
            vaultBalanceBefore - collateral + coveredDeficit,
            "Vault net change should be -collateral + covered deficit"
        );

        // 验证：用户锁定余额清零
        assertEq(vault.lockedBalances(user), 0, "User locked balance should be zero");

        // 验证：亏空被完全覆盖
        assertEq(coveredDeficit, deficit, "Deficit should be fully covered");
    }

    function test_SettleBankruptcy_PartialCollateral() public {
        // 用户只有部分保证金的情况
        uint256 collateral = 15 ether; // 声称有 15 ETH，但实际只锁定了 10 ETH
        uint256 deficit = 5 ether;

        uint256 insuranceBalanceBefore = address(insuranceFund).balance;

        vm.prank(authorizedContract);
        uint256 coveredDeficit = vault.settleBankruptcy(user, collateral, deficit);

        // 验证：保险基金净变化 = 实际保证金 - 亏空覆盖
        uint256 insuranceBalanceAfter = address(insuranceFund).balance;
        assertEq(
            insuranceBalanceAfter,
            insuranceBalanceBefore + INITIAL_DEPOSIT - coveredDeficit, // 实际只有 10 ETH
            "Insurance should receive actual locked amount minus covered deficit"
        );
    }

    function test_SettleBankruptcy_ZeroCollateral() public {
        // 先解锁用户所有保证金
        vm.prank(authorizedContract);
        vault.unlockMargin(user, INITIAL_DEPOSIT);

        uint256 insuranceBalanceBefore = address(insuranceFund).balance;

        // 穿仓但没有保证金
        vm.prank(authorizedContract);
        uint256 coveredDeficit = vault.settleBankruptcy(user, 0, 5 ether);

        // 验证：保险基金只支出亏空覆盖，没有收到保证金
        // 净变化 = 0 (无保证金) - coveredDeficit
        assertEq(
            address(insuranceFund).balance,
            insuranceBalanceBefore - coveredDeficit,
            "Insurance should only decrease by covered deficit when no collateral"
        );
    }

    function test_SettleBankruptcy_NoInsuranceFund() public {
        // 移除保险基金设置
        Vault vaultNoInsurance = new Vault();
        vaultNoInsurance.setAuthorizedContract(authorizedContract, true);

        vm.deal(user, INITIAL_DEPOSIT);
        vm.prank(user);
        vaultNoInsurance.deposit{value: INITIAL_DEPOSIT}();

        vm.prank(authorizedContract);
        vaultNoInsurance.lockMargin(user, INITIAL_DEPOSIT);

        // 即使没有保险基金，也应该能正常清除用户余额
        vm.prank(authorizedContract);
        vaultNoInsurance.settleBankruptcy(user, INITIAL_DEPOSIT, 5 ether);

        assertEq(vaultNoInsurance.lockedBalances(user), 0, "User locked balance should be zero");
    }

    // ============================================================
    // H-015: settleLoss 测试 - 原子性保证
    // ============================================================

    function test_SettleLoss_SuccessfulTransfer() public {
        uint256 collateral = 10 ether;
        uint256 loss = 3 ether;

        uint256 insuranceBalanceBefore = address(insuranceFund).balance;

        vm.prank(authorizedContract);
        uint256 actualLoss = vault.settleLoss(user, collateral, loss);

        // 验证：实际亏损等于声明亏损
        assertEq(actualLoss, loss, "Actual loss should equal declared loss");

        // 验证：保险基金收到亏损
        assertEq(
            address(insuranceFund).balance,
            insuranceBalanceBefore + loss,
            "Insurance should receive loss amount"
        );

        // 验证：用户锁定余额减少
        assertEq(
            vault.lockedBalances(user),
            0, // 整个保证金被处理
            "User locked balance should be updated"
        );

        // 验证：用户可用余额增加（返还部分）
        assertEq(
            vault.balances(user),
            collateral - loss, // 7 ETH 返还
            "User should receive remaining collateral"
        );
    }

    function test_SettleLoss_PartialLoss() public {
        uint256 collateral = 10 ether;
        uint256 loss = 4 ether;

        vm.prank(authorizedContract);
        uint256 actualLoss = vault.settleLoss(user, collateral, loss);

        assertEq(actualLoss, loss, "Actual loss should be 4 ETH");
        assertEq(vault.balances(user), 6 ether, "User should receive 6 ETH back");
    }

    function test_SettleLoss_FullLoss() public {
        uint256 collateral = 10 ether;
        uint256 loss = 10 ether; // 全部亏损

        vm.prank(authorizedContract);
        uint256 actualLoss = vault.settleLoss(user, collateral, loss);

        assertEq(actualLoss, loss, "Actual loss should be 10 ETH");
        assertEq(vault.balances(user), 0, "User should receive nothing back");
    }

    function test_SettleLoss_LossExceedsCollateral() public {
        uint256 collateral = 10 ether;
        uint256 loss = 15 ether; // 亏损超过保证金

        vm.prank(authorizedContract);
        uint256 actualLoss = vault.settleLoss(user, collateral, loss);

        // 最多只能亏损保证金数量
        assertEq(actualLoss, collateral, "Actual loss should be capped at collateral");
        assertEq(vault.balances(user), 0, "User should receive nothing back");
    }

    function test_SettleLoss_RevertsOnTransferFail() public {
        // 使用会拒绝接收的保险基金
        RejectingInsuranceFund rejectingFund = new RejectingInsuranceFund();
        vault.setInsuranceFund(address(rejectingFund));

        uint256 collateral = 10 ether;
        uint256 loss = 5 ether;

        // 应该回滚因为 ETH 转移失败
        vm.prank(authorizedContract);
        vm.expectRevert(Vault.TransferFailed.selector);
        vault.settleLoss(user, collateral, loss);

        // 验证：用户余额没有变化（交易回滚）
        assertEq(vault.lockedBalances(user), INITIAL_DEPOSIT, "User locked balance should be unchanged");
        assertEq(vault.balances(user), 0, "User balance should be unchanged");
    }

    function test_SettleLoss_ZeroLoss() public {
        uint256 collateral = 10 ether;
        uint256 loss = 0;

        vm.prank(authorizedContract);
        uint256 actualLoss = vault.settleLoss(user, collateral, loss);

        assertEq(actualLoss, 0, "Actual loss should be zero");
        assertEq(vault.balances(user), collateral, "User should receive all collateral back");
    }

    // ============================================================
    // 综合场景测试
    // ============================================================

    function test_Integration_MultipleLossSettlements() public {
        // 创建多个用户
        address user2 = address(0x201);
        address user3 = address(0x202);

        // 给用户存款
        vm.deal(user2, 20 ether);
        vm.deal(user3, 15 ether);

        vm.prank(user2);
        vault.deposit{value: 20 ether}();
        vm.prank(user3);
        vault.deposit{value: 15 ether}();

        // 锁定保证金
        vm.startPrank(authorizedContract);
        vault.lockMargin(user2, 20 ether);
        vault.lockMargin(user3, 15 ether);
        vm.stopPrank();

        uint256 insuranceBalanceStart = address(insuranceFund).balance;

        // 结算多个亏损
        vm.startPrank(authorizedContract);
        vault.settleLoss(user, 10 ether, 3 ether);   // user1 亏 3 ETH
        vault.settleLoss(user2, 20 ether, 8 ether);  // user2 亏 8 ETH
        vault.settleLoss(user3, 15 ether, 5 ether);  // user3 亏 5 ETH
        vm.stopPrank();

        // 验证保险基金收到所有亏损
        assertEq(
            address(insuranceFund).balance,
            insuranceBalanceStart + 3 ether + 8 ether + 5 ether,
            "Insurance should receive all losses"
        );

        // 验证用户余额
        assertEq(vault.balances(user), 7 ether, "User1 should receive 7 ETH");
        assertEq(vault.balances(user2), 12 ether, "User2 should receive 12 ETH");
        assertEq(vault.balances(user3), 10 ether, "User3 should receive 10 ETH");
    }

    function test_Integration_BankruptcyThenLoss() public {
        // 创建另一个用户
        address user2 = address(0x201);
        vm.deal(user2, 20 ether);
        vm.prank(user2);
        vault.deposit{value: 20 ether}();
        vm.prank(authorizedContract);
        vault.lockMargin(user2, 20 ether);

        uint256 insuranceBalanceStart = address(insuranceFund).balance;

        // user1 穿仓 (保证金 10 ETH，亏空 2 ETH)
        vm.prank(authorizedContract);
        uint256 coveredDeficit = vault.settleBankruptcy(user, 10 ether, 2 ether);

        // user2 正常亏损 5 ETH
        vm.prank(authorizedContract);
        vault.settleLoss(user2, 20 ether, 5 ether);

        // 验证保险基金净变化 = user1保证金 - 覆盖亏空 + user2亏损
        // = 10 ETH - 2 ETH + 5 ETH = 13 ETH
        assertEq(
            address(insuranceFund).balance,
            insuranceBalanceStart + 10 ether - coveredDeficit + 5 ether,
            "Insurance should receive bankruptcy collateral - deficit + loss"
        );
    }

    // ============================================================
    // Ledger 一致性测试
    // ============================================================

    function test_LedgerConsistency_AfterSettleLoss() public {
        uint256 vaultEthBefore = address(vault).balance;
        uint256 totalLedgerBefore = vault.balances(user) + vault.lockedBalances(user);

        uint256 collateral = 10 ether;
        uint256 loss = 4 ether;

        vm.prank(authorizedContract);
        vault.settleLoss(user, collateral, loss);

        uint256 vaultEthAfter = address(vault).balance;
        uint256 totalLedgerAfter = vault.balances(user) + vault.lockedBalances(user);

        // Vault ETH 减少 = 用户亏损
        assertEq(vaultEthBefore - vaultEthAfter, loss, "Vault ETH should decrease by loss");

        // 用户账本减少 = 用户亏损
        assertEq(totalLedgerBefore - totalLedgerAfter, loss, "User ledger should decrease by loss");

        // ETH 和账本变化一致
        assertEq(
            vaultEthBefore - vaultEthAfter,
            totalLedgerBefore - totalLedgerAfter,
            "ETH and ledger changes should match"
        );
    }

    function test_LedgerConsistency_AfterBankruptcy() public {
        uint256 vaultEthBefore = address(vault).balance;

        uint256 collateral = 10 ether;
        uint256 deficit = 3 ether;

        vm.prank(authorizedContract);
        uint256 coveredDeficit = vault.settleBankruptcy(user, collateral, deficit);

        uint256 vaultEthAfter = address(vault).balance;

        // Vault ETH 净变化 = 保证金转出 - 亏空覆盖收入
        // = -collateral + coveredDeficit
        uint256 expectedChange = collateral - coveredDeficit;
        assertEq(vaultEthBefore - vaultEthAfter, expectedChange, "Vault ETH net change should be collateral - covered deficit");

        // 用户账本清零
        assertEq(vault.balances(user), 0, "User balance should be zero");
        assertEq(vault.lockedBalances(user), 0, "User locked balance should be zero");
    }
}

/**
 * @notice Mock Insurance Fund that accepts ETH
 */
contract MockInsuranceFund {
    receive() external payable {}

    function coverDeficit(uint256 amount) external returns (uint256) {
        if (address(this).balance >= amount) {
            (bool success,) = msg.sender.call{value: amount}("");
            if (success) return amount;
        }
        return 0;
    }

    function payProfit(address user, uint256 amount) external {
        if (address(this).balance >= amount) {
            (bool success,) = user.call{value: amount}("");
            require(success, "Profit payment failed");
        }
    }
}

/**
 * @notice Insurance Fund that rejects ETH transfers
 */
contract RejectingInsuranceFund {
    receive() external payable {
        revert("Rejecting ETH");
    }
}
