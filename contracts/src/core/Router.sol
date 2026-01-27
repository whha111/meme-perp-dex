// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "../interfaces/IVault.sol";
import "../interfaces/IAMM.sol";
import "../interfaces/ILendingPool.sol";
import "../interfaces/IPositionManager.sol";
import "../interfaces/IReferral.sol";

/**
 * @title Router
 * @notice 统一交互入口合约
 * @dev 为用户提供简化的交互接口，聚合多个合约的功能
 */
contract Router is Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    // ============================================================
    // State Variables
    // ============================================================

    IERC20 public memeToken;
    IVault public vault;
    IAMM public amm;
    ILendingPool public lendingPool;
    IPositionManager public positionManager;
    IReferral public referral;

    // ============================================================
    // Events
    // ============================================================

    event ContractUpdated(string name, address newAddress);

    // ============================================================
    // Errors
    // ============================================================

    error ZeroAddress();
    error TransferFailed();

    // ============================================================
    // Constructor
    // ============================================================

    constructor(address _memeToken) Ownable(msg.sender) {
        if (_memeToken == address(0)) revert ZeroAddress();
        memeToken = IERC20(_memeToken);
    }

    // ============================================================
    // Admin Functions
    // ============================================================

    function setVault(address _vault) external onlyOwner {
        vault = IVault(_vault);
        emit ContractUpdated("vault", _vault);
    }

    function setAMM(address _amm) external onlyOwner {
        amm = IAMM(_amm);
        emit ContractUpdated("amm", _amm);
    }

    function setLendingPool(address _lendingPool) external onlyOwner {
        lendingPool = ILendingPool(_lendingPool);
        emit ContractUpdated("lendingPool", _lendingPool);
    }

    function setPositionManager(address _positionManager) external onlyOwner {
        positionManager = IPositionManager(_positionManager);
        emit ContractUpdated("positionManager", _positionManager);
    }

    function setReferral(address _referral) external onlyOwner {
        referral = IReferral(_referral);
        emit ContractUpdated("referral", _referral);
    }

    // ============================================================
    // Spot Trading Functions
    // ============================================================

    /**
     * @notice 用 BNB 买 MEME
     * @param minOut 最小输出数量
     */
    function swapBNBForMeme(uint256 minOut) external payable nonReentrant returns (uint256 memeOut) {
        memeOut = amm.swapBNBForMeme{value: msg.value}(minOut);
        memeToken.safeTransfer(msg.sender, memeOut);
    }

    /**
     * @notice 用 MEME 买 BNB
     * @param memeAmount 输入的 MEME 数量
     * @param minOut 最小输出数量
     */
    function swapMemeForBNB(uint256 memeAmount, uint256 minOut) external nonReentrant returns (uint256 bnbOut) {
        memeToken.safeTransferFrom(msg.sender, address(this), memeAmount);
        memeToken.approve(address(amm), memeAmount);
        bnbOut = amm.swapMemeForBNB(memeAmount, minOut);

        (bool success,) = msg.sender.call{value: bnbOut}("");
        if (!success) revert TransferFailed();
    }

    // ============================================================
    // LP Functions
    // ============================================================

    /**
     * @notice 存入 MEME 到 LP 池
     * @param memeAmount 存入数量
     */
    function depositLP(uint256 memeAmount) external nonReentrant returns (uint256 lpTokens) {
        memeToken.safeTransferFrom(msg.sender, address(this), memeAmount);
        memeToken.approve(address(lendingPool), memeAmount);
        lpTokens = lendingPool.deposit(memeAmount);
    }

    /**
     * @notice 从 LP 池取出 MEME
     * @param lpTokens LP Token 数量
     */
    function withdrawLP(uint256 lpTokens) external nonReentrant returns (uint256 memeOut) {
        memeOut = lendingPool.withdraw(lpTokens);
        memeToken.safeTransfer(msg.sender, memeOut);
    }

    /**
     * @notice 领取 LP 利息
     */
    function claimLPRewards() external nonReentrant returns (uint256 interest) {
        interest = lendingPool.claimInterest();
        if (interest > 0) {
            memeToken.safeTransfer(msg.sender, interest);
        }
    }

    // ============================================================
    // Margin Functions
    // ============================================================

    /**
     * @notice 存入 BNB 作为保证金
     */
    function depositMargin() external payable nonReentrant {
        vault.deposit{value: msg.value}();
    }

    /**
     * @notice 取出 BNB 保证金
     * @param amount 取出数量
     */
    function withdrawMargin(uint256 amount) external nonReentrant {
        vault.withdraw(amount);
        (bool success,) = msg.sender.call{value: amount}("");
        if (!success) revert TransferFailed();
    }

    // ============================================================
    // Perpetual Trading Functions
    // ============================================================

    /**
     * @notice 开多仓
     * @param size 仓位大小
     * @param leverage 杠杆倍数
     */
    function openLong(uint256 size, uint256 leverage) external nonReentrant {
        positionManager.openLong(size, leverage);
    }

    /**
     * @notice 开空仓
     * @param size 仓位大小
     * @param leverage 杠杆倍数
     */
    function openShort(uint256 size, uint256 leverage) external nonReentrant {
        positionManager.openShort(size, leverage);
    }

    /**
     * @notice 平仓
     */
    function closePosition() external nonReentrant {
        positionManager.closePosition();
    }

    /**
     * @notice 部分平仓
     * @param percentage 平仓比例 (1-100)
     */
    function closePositionPartial(uint256 percentage) external nonReentrant {
        positionManager.closePositionPartial(percentage);
    }

    /**
     * @notice 追加保证金
     */
    function addCollateral() external payable nonReentrant {
        vault.deposit{value: msg.value}();
        positionManager.addCollateral(msg.value);
    }

    /**
     * @notice 减少保证金
     * @param amount 减少数量
     */
    function removeCollateral(uint256 amount) external nonReentrant {
        positionManager.removeCollateral(amount);
    }

    // ============================================================
    // Referral Functions
    // ============================================================

    /**
     * @notice 设置推荐人
     * @param _referrer 推荐人地址
     */
    function setReferrer(address _referrer) external {
        referral.setReferrer(_referrer);
    }

    /**
     * @notice 领取推荐奖励
     */
    function claimReferralRewards() external nonReentrant returns (uint256 reward) {
        reward = referral.claimCommission();
    }

    // ============================================================
    // Combined Functions (便捷操作)
    // ============================================================

    /**
     * @notice 存入保证金并开多仓
     * @param size 仓位大小
     * @param leverage 杠杆倍数
     */
    function depositAndOpenLong(uint256 size, uint256 leverage) external payable nonReentrant {
        vault.deposit{value: msg.value}();
        positionManager.openLong(size, leverage);
    }

    /**
     * @notice 存入保证金并开空仓
     * @param size 仓位大小
     * @param leverage 杠杆倍数
     */
    function depositAndOpenShort(uint256 size, uint256 leverage) external payable nonReentrant {
        vault.deposit{value: msg.value}();
        positionManager.openShort(size, leverage);
    }

    /**
     * @notice 平仓并取出保证金
     */
    function closeAndWithdraw() external nonReentrant {
        positionManager.closePosition();
        uint256 balance = vault.getBalance(msg.sender);
        if (balance > 0) {
            vault.withdraw(balance);
            (bool success,) = msg.sender.call{value: balance}("");
            if (!success) revert TransferFailed();
        }
    }

    // ============================================================
    // View Functions
    // ============================================================

    /**
     * @notice 获取用户保证金余额
     * @param user 用户地址
     */
    function getMarginBalance(address user) external view returns (uint256) {
        return vault.getBalance(user);
    }

    /**
     * @notice 获取当前现货价格
     */
    function getSpotPrice() external view returns (uint256) {
        return amm.getSpotPrice();
    }

    /**
     * @notice 计算交易输出
     * @param isBuy 是否买入 MEME
     * @param amountIn 输入数量
     */
    function getAmountOut(bool isBuy, uint256 amountIn) external view returns (uint256) {
        return amm.getAmountOut(isBuy, amountIn);
    }

    // ============================================================
    // Receive Function
    // ============================================================

    receive() external payable {}
}
