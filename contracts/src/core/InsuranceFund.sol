// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/**
 * @title InsuranceFund
 * @notice 保险基金合约 - 用于支付交易者盈利和覆盖穿仓损失
 * @dev 资金来源：
 *      1. 初始注入资金
 *      2. 交易手续费的一部分
 *      3. 交易者亏损
 *      资金用途：
 *      1. 支付交易者盈利
 *      2. 覆盖穿仓亏空
 */
contract InsuranceFund is Ownable, ReentrancyGuard {
    // ============================================================
    // State Variables
    // ============================================================

    /// @notice Vault 合约地址
    address public vault;

    /// @notice PositionManager 合约地址
    address public positionManager;

    /// @notice 授权可以调用的合约
    mapping(address => bool) public authorizedContracts;

    /// @notice 最低保留余额 (防止基金完全耗尽)
    uint256 public minReserve = 0.01 ether;

    /// @notice 单次最大支付比例 (相对于总余额, 以 10000 为基数)
    uint256 public maxPayoutRatio = 5000; // 50%

    // ============================================================
    // Events
    // ============================================================

    event Deposit(address indexed from, uint256 amount);
    event ProfitPaid(address indexed user, uint256 requested, uint256 paid);
    event LossCovered(address indexed user, uint256 amount);
    event DeficitCovered(uint256 requested, uint256 covered);
    event AuthorizedContractSet(address indexed contractAddr, bool authorized);
    event MinReserveSet(uint256 oldValue, uint256 newValue);
    event MaxPayoutRatioSet(uint256 oldValue, uint256 newValue);

    // ============================================================
    // Errors
    // ============================================================

    error Unauthorized();
    error ZeroAddress();
    error InsufficientFunds();
    error TransferFailed();

    // ============================================================
    // Modifiers
    // ============================================================

    modifier onlyAuthorized() {
        if (!authorizedContracts[msg.sender] && msg.sender != owner()) {
            revert Unauthorized();
        }
        _;
    }

    // ============================================================
    // Constructor
    // ============================================================

    constructor() Ownable(msg.sender) {}

    // ============================================================
    // Admin Functions
    // ============================================================

    function setVault(address _vault) external onlyOwner {
        if (_vault == address(0)) revert ZeroAddress();
        vault = _vault;
        authorizedContracts[_vault] = true;
        emit AuthorizedContractSet(_vault, true);
    }

    function setPositionManager(address _positionManager) external onlyOwner {
        if (_positionManager == address(0)) revert ZeroAddress();
        positionManager = _positionManager;
        authorizedContracts[_positionManager] = true;
        emit AuthorizedContractSet(_positionManager, true);
    }

    function setAuthorizedContract(address contractAddr, bool authorized) external onlyOwner {
        authorizedContracts[contractAddr] = authorized;
        emit AuthorizedContractSet(contractAddr, authorized);
    }

    function setMinReserve(uint256 _minReserve) external onlyOwner {
        emit MinReserveSet(minReserve, _minReserve);
        minReserve = _minReserve;
    }

    function setMaxPayoutRatio(uint256 _maxPayoutRatio) external onlyOwner {
        require(_maxPayoutRatio <= 10000, "Ratio too high");
        emit MaxPayoutRatioSet(maxPayoutRatio, _maxPayoutRatio);
        maxPayoutRatio = _maxPayoutRatio;
    }

    // ============================================================
    // Deposit Functions
    // ============================================================

    /// @notice 向保险基金存入 ETH
    receive() external payable {
        emit Deposit(msg.sender, msg.value);
    }

    /// @notice 存入资金
    function deposit() external payable {
        emit Deposit(msg.sender, msg.value);
    }

    // ============================================================
    // Core Functions (Called by Vault/PositionManager)
    // ============================================================

    /**
     * @notice 支付用户盈利
     * @dev 由 Vault 或 PositionManager 调用
     * @param user 接收盈利的用户地址
     * @param amount 请求支付的金额
     * @return paid 实际支付的金额
     */
    function payProfit(address user, uint256 amount) external onlyAuthorized nonReentrant returns (uint256 paid) {
        if (user == address(0)) revert ZeroAddress();
        if (amount == 0) return 0;

        uint256 balance = address(this).balance;

        // 计算可用于支付的金额 (保留最低储备)
        uint256 available = balance > minReserve ? balance - minReserve : 0;

        // 限制单次最大支付
        uint256 maxPayout = (balance * maxPayoutRatio) / 10000;
        available = available > maxPayout ? maxPayout : available;

        // 实际支付金额
        paid = amount > available ? available : amount;

        if (paid > 0) {
            (bool success, ) = user.call{value: paid}("");
            if (!success) revert TransferFailed();
        }

        emit ProfitPaid(user, amount, paid);
        return paid;
    }

    /**
     * @notice 支付盈利到 Vault (用于 Cross Margin 模式)
     * @dev 将盈利转入 Vault，由 Vault 记账给用户
     * @param user 用户地址 (用于记录)
     * @param amount 请求金额
     * @return paid 实际支付金额
     */
    function payProfitToVault(address user, uint256 amount) external onlyAuthorized nonReentrant returns (uint256 paid) {
        if (vault == address(0)) revert ZeroAddress();
        if (amount == 0) return 0;

        uint256 balance = address(this).balance;
        uint256 available = balance > minReserve ? balance - minReserve : 0;
        uint256 maxPayout = (balance * maxPayoutRatio) / 10000;
        available = available > maxPayout ? maxPayout : available;

        paid = amount > available ? available : amount;

        if (paid > 0) {
            // 发送到 Vault
            (bool success, ) = vault.call{value: paid}("");
            if (!success) revert TransferFailed();
        }

        emit ProfitPaid(user, amount, paid);
        return paid;
    }

    /**
     * @notice 接收亏损资金
     * @dev 由 Vault 调用，将交易者亏损转入保险基金
     */
    function receiveLoss() external payable onlyAuthorized {
        emit LossCovered(msg.sender, msg.value);
    }

    /**
     * @notice 覆盖穿仓亏空
     * @dev 当交易者穿仓时，保险基金覆盖亏空
     * @param amount 请求覆盖的金额
     * @return covered 实际覆盖的金额
     */
    function coverDeficit(uint256 amount) external onlyAuthorized nonReentrant returns (uint256 covered) {
        uint256 balance = address(this).balance;
        uint256 available = balance > minReserve ? balance - minReserve : 0;

        covered = amount > available ? available : amount;

        if (covered > 0) {
            (bool success, ) = msg.sender.call{value: covered}("");
            if (!success) revert TransferFailed();
        }

        emit DeficitCovered(amount, covered);
        return covered;
    }

    // ============================================================
    // View Functions
    // ============================================================

    /// @notice 获取保险基金余额
    function getBalance() external view returns (uint256) {
        return address(this).balance;
    }

    /// @notice 获取可用于支付的余额
    function getAvailableBalance() external view returns (uint256) {
        uint256 balance = address(this).balance;
        return balance > minReserve ? balance - minReserve : 0;
    }

    /// @notice 检查是否能支付指定金额
    function canPay(uint256 amount) external view returns (bool, uint256 actualPayable) {
        uint256 balance = address(this).balance;
        uint256 available = balance > minReserve ? balance - minReserve : 0;
        uint256 maxPayout = (balance * maxPayoutRatio) / 10000;
        available = available > maxPayout ? maxPayout : available;

        actualPayable = amount > available ? available : amount;
        return (actualPayable >= amount, actualPayable);
    }

    // ============================================================
    // Emergency Functions
    // ============================================================

    /// @notice 紧急提取 (仅限 owner)
    function emergencyWithdraw(address to, uint256 amount) external onlyOwner {
        if (to == address(0)) revert ZeroAddress();
        if (amount > address(this).balance) revert InsufficientFunds();

        (bool success, ) = to.call{value: amount}("");
        if (!success) revert TransferFailed();
    }
}
