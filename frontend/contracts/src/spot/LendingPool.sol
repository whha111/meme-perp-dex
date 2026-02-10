// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "../interfaces/ILPToken.sol";

/**
 * @title LendingPool
 * @notice LP 存币借贷合约
 * @dev LP 存入 MEME 赚取利息，做空用户从池中借出 MEME
 */
contract LendingPool is Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    // ============================================================
    // Constants
    // ============================================================

    uint256 public constant PRECISION = 1e18;
    uint256 public constant SECONDS_PER_YEAR = 365 days;

    // 利率模型参数
    uint256 public constant BASE_RATE = 2e16; // 2% 基础利率
    uint256 public constant OPTIMAL_UTILIZATION = 80e16; // 80% 最优利用率
    uint256 public constant SLOPE1 = 4e16; // 4% 斜率1（0-80%利用率）
    uint256 public constant SLOPE2 = 75e16; // 75% 斜率2（80-100%利用率）

    // ============================================================
    // State Variables
    // ============================================================

    IERC20 public memeToken;
    ILPToken public lpToken;

    // 总存款和总借出
    uint256 public totalDeposits;
    uint256 public totalBorrowed;

    // 累计利息指数
    uint256 public borrowIndex = PRECISION;
    uint256 public supplyIndex = PRECISION;
    uint256 public lastUpdateTime;

    // 用户借款记录
    struct BorrowInfo {
        uint256 principal; // 借款本金
        uint256 borrowIndex; // 借款时的利息指数
    }
    mapping(address => BorrowInfo) public borrowInfo;

    // 用户存款利息记录
    mapping(address => uint256) public userSupplyIndex;
    mapping(address => uint256) public pendingInterest;

    // 授权合约（PositionManager）
    mapping(address => bool) public authorizedContracts;

    // ============================================================
    // Events
    // ============================================================

    event Deposited(address indexed user, uint256 amount, uint256 lpTokens);
    event Withdrawn(address indexed user, uint256 amount, uint256 lpTokens);
    event Borrowed(address indexed user, uint256 amount);
    event Repaid(address indexed user, uint256 amount, uint256 interest);
    event InterestClaimed(address indexed user, uint256 amount);
    event ContractAuthorized(address indexed contractAddr, bool authorized);

    // ============================================================
    // Errors
    // ============================================================

    error InsufficientLiquidity();
    error InsufficientBalance();
    error InvalidAmount();
    error Unauthorized();
    error ZeroAddress();

    // ============================================================
    // Modifiers
    // ============================================================

    modifier onlyAuthorized() {
        if (!authorizedContracts[msg.sender]) revert Unauthorized();
        _;
    }

    modifier updateInterest() {
        _updateInterest();
        _;
    }

    // ============================================================
    // Constructor
    // ============================================================

    constructor(address _memeToken, address _lpToken) Ownable(msg.sender) {
        if (_memeToken == address(0) || _lpToken == address(0)) revert ZeroAddress();
        memeToken = IERC20(_memeToken);
        lpToken = ILPToken(_lpToken);
        lastUpdateTime = block.timestamp;
    }

    // ============================================================
    // Admin Functions
    // ============================================================

    /**
     * @notice 设置授权合约
     * @param contractAddr 合约地址
     * @param authorized 是否授权
     */
    function setAuthorizedContract(address contractAddr, bool authorized) external onlyOwner {
        if (contractAddr == address(0)) revert ZeroAddress();
        authorizedContracts[contractAddr] = authorized;
        emit ContractAuthorized(contractAddr, authorized);
    }

    // ============================================================
    // LP Functions
    // ============================================================

    /**
     * @notice 存入 MEME 币
     * @param amount 存入数量
     * @return lpTokens 获得的 LP Token 数量
     */
    function deposit(uint256 amount) external nonReentrant updateInterest returns (uint256 lpTokens) {
        if (amount == 0) revert InvalidAmount();

        // 更新用户利息
        _updateUserInterest(msg.sender);

        // 计算 LP Token 数量
        uint256 totalSupply = lpToken.totalSupply();
        if (totalSupply == 0) {
            lpTokens = amount;
        } else {
            lpTokens = (amount * totalSupply) / totalDeposits;
        }

        // 转入 MEME
        memeToken.safeTransferFrom(msg.sender, address(this), amount);

        // 更新状态
        totalDeposits += amount;

        // 铸造 LP Token
        lpToken.mint(msg.sender, lpTokens);

        // 记录用户利息指数
        userSupplyIndex[msg.sender] = supplyIndex;

        emit Deposited(msg.sender, amount, lpTokens);
    }

    /**
     * @notice 取出 MEME 币
     * @param lpTokenAmount 销毁的 LP Token 数量
     * @return amount 取回的 MEME 数量
     */
    function withdraw(uint256 lpTokenAmount) external nonReentrant updateInterest returns (uint256 amount) {
        if (lpTokenAmount == 0) revert InvalidAmount();
        if (lpToken.balanceOf(msg.sender) < lpTokenAmount) revert InsufficientBalance();

        // 更新用户利息
        _updateUserInterest(msg.sender);

        // 计算可取出数量
        uint256 totalSupply = lpToken.totalSupply();
        amount = (lpTokenAmount * totalDeposits) / totalSupply;

        // 检查流动性
        uint256 availableLiquidity = totalDeposits - totalBorrowed;
        if (amount > availableLiquidity) revert InsufficientLiquidity();

        // 销毁 LP Token
        lpToken.burn(msg.sender, lpTokenAmount);

        // 更新状态
        totalDeposits -= amount;

        // 转出 MEME
        memeToken.safeTransfer(msg.sender, amount);

        emit Withdrawn(msg.sender, amount, lpTokenAmount);
    }

    /**
     * @notice 领取利息
     * @return interest 领取的利息数量
     */
    function claimInterest() external nonReentrant updateInterest returns (uint256 interest) {
        _updateUserInterest(msg.sender);

        interest = pendingInterest[msg.sender];
        if (interest == 0) return 0;

        pendingInterest[msg.sender] = 0;

        // 从总存款中扣除（利息已经计入totalDeposits）
        memeToken.safeTransfer(msg.sender, interest);

        emit InterestClaimed(msg.sender, interest);
    }

    // ============================================================
    // Borrow Functions (仅授权合约)
    // ============================================================

    /**
     * @notice 借出 MEME（做空用）
     * @param borrower 借款人地址
     * @param amount 借款数量
     */
    function borrow(address borrower, uint256 amount) external onlyAuthorized updateInterest {
        if (amount == 0) revert InvalidAmount();

        uint256 availableLiquidity = totalDeposits - totalBorrowed;
        if (amount > availableLiquidity) revert InsufficientLiquidity();

        // 更新借款记录
        BorrowInfo storage info = borrowInfo[borrower];
        if (info.principal > 0) {
            // 已有借款，先结算利息
            uint256 accruedInterest = (info.principal * borrowIndex) / info.borrowIndex - info.principal;
            info.principal += accruedInterest;
        }
        info.principal += amount;
        info.borrowIndex = borrowIndex;

        // 更新状态
        totalBorrowed += amount;

        // 转出 MEME 给 PositionManager
        memeToken.safeTransfer(msg.sender, amount);

        emit Borrowed(borrower, amount);
    }

    /**
     * @notice 归还 MEME
     * @param borrower 借款人地址
     * @param amount 归还数量
     */
    function repay(address borrower, uint256 amount) external onlyAuthorized updateInterest {
        BorrowInfo storage info = borrowInfo[borrower];
        if (info.principal == 0) return;

        // 计算累计利息
        uint256 accruedInterest = (info.principal * borrowIndex) / info.borrowIndex - info.principal;
        uint256 totalOwed = info.principal + accruedInterest;

        uint256 repayAmount = amount > totalOwed ? totalOwed : amount;
        uint256 interestPaid = repayAmount > info.principal ? repayAmount - info.principal : 0;
        uint256 principalPaid = repayAmount - interestPaid;

        // 转入 MEME
        memeToken.safeTransferFrom(msg.sender, address(this), repayAmount);

        // 更新借款记录
        info.principal -= principalPaid;
        info.borrowIndex = borrowIndex;

        // 更新状态
        totalBorrowed -= principalPaid;

        // 利息分配给存款人
        totalDeposits += interestPaid;

        emit Repaid(borrower, principalPaid, interestPaid);
    }

    // ============================================================
    // View Functions
    // ============================================================

    /**
     * @notice 获取利用率
     * @return 利用率（18位小数）
     */
    function getUtilization() public view returns (uint256) {
        if (totalDeposits == 0) return 0;
        return (totalBorrowed * PRECISION) / totalDeposits;
    }

    /**
     * @notice 获取当前借贷利率（年化）
     * @return 借贷利率（18位小数）
     */
    function getBorrowRate() public view returns (uint256) {
        uint256 utilization = getUtilization();

        if (utilization <= OPTIMAL_UTILIZATION) {
            // 低利用率区间
            return BASE_RATE + (utilization * SLOPE1) / OPTIMAL_UTILIZATION;
        } else {
            // 高利用率区间
            uint256 excessUtilization = utilization - OPTIMAL_UTILIZATION;
            uint256 maxExcess = PRECISION - OPTIMAL_UTILIZATION;
            return BASE_RATE + SLOPE1 + (excessUtilization * SLOPE2) / maxExcess;
        }
    }

    /**
     * @notice 获取当前存款利率（年化）
     * @return 存款利率（18位小数）
     */
    function getSupplyRate() public view returns (uint256) {
        uint256 borrowRate = getBorrowRate();
        uint256 utilization = getUtilization();
        // 存款利率 = 借贷利率 * 利用率 * (1 - 协议费)
        // 这里简化，协议费为0
        return (borrowRate * utilization) / PRECISION;
    }

    /**
     * @notice 获取用户存款数量
     * @param user 用户地址
     * @return MEME 数量
     */
    function getUserDeposit(address user) external view returns (uint256) {
        uint256 lpBalance = lpToken.balanceOf(user);
        if (lpBalance == 0) return 0;

        uint256 totalSupply = lpToken.totalSupply();
        return (lpBalance * totalDeposits) / totalSupply;
    }

    /**
     * @notice 获取用户待领取利息
     * @param user 用户地址
     * @return 利息数量
     */
    function getPendingInterest(address user) external view returns (uint256) {
        uint256 lpBalance = lpToken.balanceOf(user);
        if (lpBalance == 0) return pendingInterest[user];

        // 计算累计利息
        uint256 currentSupplyIndex = _calculateSupplyIndex();
        uint256 userIndex = userSupplyIndex[user];
        if (userIndex == 0) userIndex = PRECISION;

        uint256 accruedInterest = (lpBalance * (currentSupplyIndex - userIndex)) / PRECISION;
        return pendingInterest[user] + accruedInterest;
    }

    /**
     * @notice 获取用户借款数量（含利息）
     * @param user 用户地址
     * @return 借款数量
     */
    function getUserBorrow(address user) external view returns (uint256) {
        BorrowInfo storage info = borrowInfo[user];
        if (info.principal == 0) return 0;

        uint256 currentBorrowIndex = _calculateBorrowIndex();
        return (info.principal * currentBorrowIndex) / info.borrowIndex;
    }

    /**
     * @notice 获取可用流动性
     * @return 可用 MEME 数量
     */
    function getAvailableLiquidity() external view returns (uint256) {
        return totalDeposits - totalBorrowed;
    }

    // ============================================================
    // Internal Functions
    // ============================================================

    function _updateInterest() internal {
        uint256 timeElapsed = block.timestamp - lastUpdateTime;
        if (timeElapsed == 0) return;

        // 更新借款指数
        uint256 borrowRate = getBorrowRate();
        uint256 borrowInterest = (borrowIndex * borrowRate * timeElapsed) / (SECONDS_PER_YEAR * PRECISION);
        borrowIndex += borrowInterest;

        // 更新存款指数
        uint256 supplyRate = getSupplyRate();
        uint256 supplyInterest = (supplyIndex * supplyRate * timeElapsed) / (SECONDS_PER_YEAR * PRECISION);
        supplyIndex += supplyInterest;

        lastUpdateTime = block.timestamp;
    }

    function _updateUserInterest(address user) internal {
        uint256 lpBalance = lpToken.balanceOf(user);
        if (lpBalance == 0) return;

        uint256 userIndex = userSupplyIndex[user];
        if (userIndex == 0) {
            userSupplyIndex[user] = supplyIndex;
            return;
        }

        // 计算累计利息
        uint256 accruedInterest = (lpBalance * (supplyIndex - userIndex)) / PRECISION;
        pendingInterest[user] += accruedInterest;
        userSupplyIndex[user] = supplyIndex;
    }

    function _calculateBorrowIndex() internal view returns (uint256) {
        uint256 timeElapsed = block.timestamp - lastUpdateTime;
        if (timeElapsed == 0) return borrowIndex;

        uint256 borrowRate = getBorrowRate();
        uint256 borrowInterest = (borrowIndex * borrowRate * timeElapsed) / (SECONDS_PER_YEAR * PRECISION);
        return borrowIndex + borrowInterest;
    }

    function _calculateSupplyIndex() internal view returns (uint256) {
        uint256 timeElapsed = block.timestamp - lastUpdateTime;
        if (timeElapsed == 0) return supplyIndex;

        uint256 supplyRate = getSupplyRate();
        uint256 supplyInterest = (supplyIndex * supplyRate * timeElapsed) / (SECONDS_PER_YEAR * PRECISION);
        return supplyIndex + supplyInterest;
    }
}
