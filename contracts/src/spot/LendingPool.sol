// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/**
 * @title LendingPool (Multi-Token)
 * @notice P2P meme token lending — holders deposit to earn interest, shorts borrow from pool
 * @dev Aave-style architecture: one contract manages lending pools for ALL meme tokens.
 *      Internal share accounting (no separate ERC20 LP tokens per pool).
 *      Interest compounds per-interaction using borrowIndex/supplyIndex.
 *
 *      Integration:
 *      - TokenFactory calls enableToken() when a token reaches LENDING_ENABLE_THRESHOLD
 *      - Matching engine (authorized) calls borrow/repay when opening/closing shorts
 *      - Holders call deposit/withdraw/claimInterest directly
 */
contract LendingPool is Ownable, ReentrancyGuard, Pausable {
    using SafeERC20 for IERC20;

    // ══════════════════════════════════════════════════════════════════
    // CONSTANTS
    // ══════════════════════════════════════════════════════════════════

    uint256 public constant PRECISION = 1e18;
    uint256 public constant SECONDS_PER_YEAR = 365 days;
    uint256 public constant BPS = 10000;

    // Interest rate model (Aave-style kinked rate)
    uint256 public constant BASE_RATE = 2e16;            // 2% base annual rate
    uint256 public constant OPTIMAL_UTILIZATION = 80e16;  // 80% optimal utilization
    uint256 public constant SLOPE1 = 4e16;                // 4% slope below optimal
    uint256 public constant SLOPE2 = 75e16;               // 75% slope above optimal

    // Utilization cap — cannot borrow more than 90% of deposits
    uint256 public constant MAX_UTILIZATION = 90e16;

    // Default reserve factor (10% of interest goes to protocol)
    uint16 public constant DEFAULT_RESERVE_FACTOR = 1000; // 10% in BPS

    // C-03 fix: 最小首次存款量，防止 share inflation attack
    uint256 public constant MIN_INITIAL_DEPOSIT = 1000;  // 最少 1000 wei

    // C-03 fix: Virtual offset for share calculation (OpenZeppelin ERC4626 方案)
    uint256 private constant VIRTUAL_SHARES = 1e3;   // 虚拟 shares 偏移
    uint256 private constant VIRTUAL_ASSETS = 1;     // 虚拟 assets 偏移

    // ══════════════════════════════════════════════════════════════════
    // STRUCTS
    // ══════════════════════════════════════════════════════════════════

    struct TokenPool {
        bool enabled;
        uint64 lastUpdateTime;
        uint16 reserveFactor;      // Protocol fee share (BPS)
        uint256 borrowIndex;       // Compound borrow interest index (starts 1e18)
        uint256 supplyIndex;       // Compound supply interest index (starts 1e18)
        uint256 totalDeposits;     // Total tokens deposited by lenders
        uint256 totalBorrowed;     // Total tokens currently borrowed
        uint256 totalShares;       // Internal shares outstanding
        uint256 reserves;          // Protocol-owned reserves
    }

    struct BorrowPosition {
        uint256 principal;
        uint256 borrowIndex;
    }

    // ══════════════════════════════════════════════════════════════════
    // STATE
    // ══════════════════════════════════════════════════════════════════

    // Token => pool state
    mapping(address => TokenPool) public tokenPools;

    // Token => user => share balance
    mapping(address => mapping(address => uint256)) public userShares;

    // Token => user => supply index at last interaction
    mapping(address => mapping(address => uint256)) public userSupplyIndex;

    // Token => user => pending interest (accrued but unclaimed)
    mapping(address => mapping(address => uint256)) public userPendingInterest;

    // Token => borrower => borrow position
    mapping(address => mapping(address => BorrowPosition)) public borrowPositions;

    // Registry of enabled tokens (for enumeration)
    address[] public enabledTokens;
    mapping(address => uint256) private _enabledTokenIndex;

    // Authorization
    mapping(address => bool) public authorizedContracts;
    address public tokenFactory;

    // ══════════════════════════════════════════════════════════════════
    // EVENTS
    // ══════════════════════════════════════════════════════════════════

    event TokenEnabled(address indexed token, uint256 timestamp);
    event TokenDisabled(address indexed token, uint256 timestamp);

    event Deposited(address indexed token, address indexed user, uint256 amount, uint256 shares);
    event Withdrawn(address indexed token, address indexed user, uint256 amount, uint256 shares);
    event InterestClaimed(address indexed token, address indexed user, uint256 amount);

    event Borrowed(address indexed token, address indexed borrower, uint256 amount);
    event Repaid(address indexed token, address indexed borrower, uint256 principal, uint256 interest);
    event BorrowLiquidated(address indexed token, address indexed borrower, address indexed liquidator, uint256 amount);

    event InterestAccrued(address indexed token, uint256 borrowIndex, uint256 supplyIndex, uint256 timestamp);
    event AuthorizedContractSet(address indexed contractAddr, bool authorized);
    event ReserveFactorUpdated(address indexed token, uint16 oldFactor, uint16 newFactor);
    event ReservesWithdrawn(address indexed token, uint256 amount, address indexed to);

    // ══════════════════════════════════════════════════════════════════
    // ERRORS
    // ══════════════════════════════════════════════════════════════════

    error TokenNotEnabled();
    error TokenAlreadyEnabled();
    error InvalidAmount();
    error InsufficientLiquidity();
    error InsufficientShares();
    error MaxUtilizationExceeded();
    error Unauthorized();
    error ZeroAddress();
    error NotTokenFactory();
    error NoBorrowToLiquidate();

    // ══════════════════════════════════════════════════════════════════
    // MODIFIERS
    // ══════════════════════════════════════════════════════════════════

    modifier onlyAuthorized() {
        if (!authorizedContracts[msg.sender]) revert Unauthorized();
        _;
    }

    modifier onlyEnabledToken(address token) {
        if (!tokenPools[token].enabled) revert TokenNotEnabled();
        _;
    }

    // ══════════════════════════════════════════════════════════════════
    // CONSTRUCTOR
    // ══════════════════════════════════════════════════════════════════

    constructor(address _owner, address _tokenFactory) Ownable(_owner) {
        if (_tokenFactory == address(0)) revert ZeroAddress();
        tokenFactory = _tokenFactory;
    }

    // ══════════════════════════════════════════════════════════════════
    // ADMIN
    // ══════════════════════════════════════════════════════════════════

    function pause() external onlyOwner { _pause(); }
    function unpause() external onlyOwner { _unpause(); }

    function setTokenFactory(address _tokenFactory) external onlyOwner {
        if (_tokenFactory == address(0)) revert ZeroAddress();
        tokenFactory = _tokenFactory;
    }

    function setAuthorizedContract(address contractAddr, bool authorized) external onlyOwner {
        if (contractAddr == address(0)) revert ZeroAddress();
        authorizedContracts[contractAddr] = authorized;
        emit AuthorizedContractSet(contractAddr, authorized);
    }

    function setReserveFactor(address token, uint16 factor) external onlyOwner onlyEnabledToken(token) {
        if (factor > BPS) revert InvalidAmount();
        uint16 oldFactor = tokenPools[token].reserveFactor;
        tokenPools[token].reserveFactor = factor;
        emit ReserveFactorUpdated(token, oldFactor, factor);
    }

    function withdrawReserves(address token, uint256 amount, address to) external onlyOwner {
        if (to == address(0)) revert ZeroAddress();
        TokenPool storage pool = tokenPools[token];
        if (amount > pool.reserves) revert InsufficientLiquidity();

        pool.reserves -= amount;
        IERC20(token).safeTransfer(to, amount);
        emit ReservesWithdrawn(token, amount, to);
    }

    function emergencyDisableToken(address token) external onlyOwner {
        TokenPool storage pool = tokenPools[token];
        if (!pool.enabled) revert TokenNotEnabled();
        pool.enabled = false;
        emit TokenDisabled(token, block.timestamp);
    }

    // ══════════════════════════════════════════════════════════════════
    // TOKEN FACTORY INTEGRATION
    // ══════════════════════════════════════════════════════════════════

    /**
     * @notice Enable lending for a meme token (called by TokenFactory)
     * @param token The meme token address
     */
    function enableToken(address token) external {
        if (msg.sender != tokenFactory) revert NotTokenFactory();
        if (token == address(0)) revert ZeroAddress();

        TokenPool storage pool = tokenPools[token];
        if (pool.enabled) revert TokenAlreadyEnabled();

        pool.enabled = true;
        pool.lastUpdateTime = uint64(block.timestamp);
        pool.reserveFactor = DEFAULT_RESERVE_FACTOR;
        pool.borrowIndex = PRECISION;
        pool.supplyIndex = PRECISION;

        // Add to registry
        _enabledTokenIndex[token] = enabledTokens.length;
        enabledTokens.push(token);

        emit TokenEnabled(token, block.timestamp);
    }

    // ══════════════════════════════════════════════════════════════════
    // LENDER FUNCTIONS
    // ══════════════════════════════════════════════════════════════════

    /**
     * @notice Deposit meme tokens to earn interest
     * @param token The meme token address
     * @param amount Amount of tokens to deposit
     * @return shares Number of internal shares received
     */
    function deposit(
        address token,
        uint256 amount
    ) external nonReentrant whenNotPaused onlyEnabledToken(token) returns (uint256 shares) {
        if (amount == 0) revert InvalidAmount();

        TokenPool storage pool = tokenPools[token];
        _accrueInterest(token, pool);
        _updateUserInterest(token, pool, msg.sender);

        // C-03 fix: 使用 virtual offset 防止 share inflation attack (参考 OpenZeppelin ERC4626)
        // 首次存款要求最小数量，后续使用 virtual offset 计算 shares
        if (pool.totalShares == 0) {
            require(amount >= MIN_INITIAL_DEPOSIT, "Initial deposit too small");
            shares = amount;
        } else {
            // Virtual offset 公式: shares = amount * (totalShares + VIRTUAL_SHARES) / (totalDeposits + VIRTUAL_ASSETS)
            // 这使得攻击者无法通过直接 transfer 来操纵 share 价格
            shares = (amount * (pool.totalShares + VIRTUAL_SHARES)) / (pool.totalDeposits + VIRTUAL_ASSETS);
        }
        require(shares > 0, "Deposit too small for shares");

        // Transfer tokens in
        IERC20(token).safeTransferFrom(msg.sender, address(this), amount);

        // Update state
        pool.totalDeposits += amount;
        pool.totalShares += shares;
        userShares[token][msg.sender] += shares;
        userSupplyIndex[token][msg.sender] = pool.supplyIndex;

        emit Deposited(token, msg.sender, amount, shares);
    }

    /**
     * @notice Withdraw meme tokens by redeeming shares
     * @param token The meme token address
     * @param shares Number of shares to redeem
     * @return amount Amount of tokens received
     */
    function withdraw(
        address token,
        uint256 shares
    ) external nonReentrant whenNotPaused onlyEnabledToken(token) returns (uint256 amount) {
        if (shares == 0) revert InvalidAmount();
        if (userShares[token][msg.sender] < shares) revert InsufficientShares();

        TokenPool storage pool = tokenPools[token];
        _accrueInterest(token, pool);
        _updateUserInterest(token, pool, msg.sender);

        // C-03 fix: 使用 virtual offset 计算 amount (与 deposit 对称)
        amount = (shares * (pool.totalDeposits + VIRTUAL_ASSETS)) / (pool.totalShares + VIRTUAL_SHARES);

        // Check available liquidity
        uint256 available = pool.totalDeposits - pool.totalBorrowed;
        if (amount > available) revert InsufficientLiquidity();

        // Update state
        pool.totalDeposits -= amount;
        pool.totalShares -= shares;
        userShares[token][msg.sender] -= shares;
        userSupplyIndex[token][msg.sender] = pool.supplyIndex;

        // Transfer tokens out
        IERC20(token).safeTransfer(msg.sender, amount);

        emit Withdrawn(token, msg.sender, amount, shares);
    }

    /**
     * @notice Claim accrued interest without withdrawing principal
     * @param token The meme token address
     * @return interest Amount of interest claimed
     */
    function claimInterest(
        address token
    ) external nonReentrant whenNotPaused onlyEnabledToken(token) returns (uint256 interest) {
        TokenPool storage pool = tokenPools[token];
        _accrueInterest(token, pool);
        _updateUserInterest(token, pool, msg.sender);

        interest = userPendingInterest[token][msg.sender];
        if (interest == 0) return 0;

        userPendingInterest[token][msg.sender] = 0;

        // Deduct claimed interest from totalDeposits to maintain accounting invariant:
        // contractBalance >= totalDeposits - totalBorrowed
        pool.totalDeposits -= interest;

        IERC20(token).safeTransfer(msg.sender, interest);

        emit InterestClaimed(token, msg.sender, interest);
    }

    // ══════════════════════════════════════════════════════════════════
    // BORROWER FUNCTIONS (authorized contracts only)
    // ══════════════════════════════════════════════════════════════════

    /**
     * @notice Borrow meme tokens (for short selling)
     * @param token The meme token address
     * @param borrower The borrower's address
     * @param amount Amount to borrow
     */
    function borrow(
        address token,
        address borrower,
        uint256 amount
    ) external onlyAuthorized onlyEnabledToken(token) {
        if (amount == 0) revert InvalidAmount();

        TokenPool storage pool = tokenPools[token];
        _accrueInterest(token, pool);

        // Check available liquidity
        uint256 available = pool.totalDeposits - pool.totalBorrowed;
        if (amount > available) revert InsufficientLiquidity();

        // Check max utilization (90%)
        uint256 newBorrowed = pool.totalBorrowed + amount;
        if (pool.totalDeposits > 0) {
            uint256 newUtilization = (newBorrowed * PRECISION) / pool.totalDeposits;
            if (newUtilization > MAX_UTILIZATION) revert MaxUtilizationExceeded();
        }

        // Update borrow position (settle existing interest first)
        BorrowPosition storage pos = borrowPositions[token][borrower];
        if (pos.principal > 0) {
            uint256 accrued = (pos.principal * pool.borrowIndex) / pos.borrowIndex - pos.principal;
            pos.principal += accrued;
        }
        pos.principal += amount;
        pos.borrowIndex = pool.borrowIndex;

        // Update pool state
        pool.totalBorrowed += amount;

        // Transfer tokens to the authorized contract (matching engine)
        IERC20(token).safeTransfer(msg.sender, amount);

        emit Borrowed(token, borrower, amount);
    }

    /**
     * @notice Repay borrowed meme tokens
     * @param token The meme token address
     * @param borrower The borrower's address
     * @param amount Amount to repay (use type(uint256).max for full repayment)
     */
    function repay(
        address token,
        address borrower,
        uint256 amount
    ) external onlyAuthorized onlyEnabledToken(token) {
        TokenPool storage pool = tokenPools[token];
        _accrueInterest(token, pool);

        BorrowPosition storage pos = borrowPositions[token][borrower];
        if (pos.principal == 0) return;

        // Calculate total owed (principal + accrued interest)
        uint256 accrued = (pos.principal * pool.borrowIndex) / pos.borrowIndex - pos.principal;
        uint256 totalOwed = pos.principal + accrued;

        // Cap repayment at total owed
        uint256 repayAmount = amount > totalOwed ? totalOwed : amount;

        // Split into principal and interest portions
        uint256 interestPaid;
        uint256 principalPaid;
        if (repayAmount >= totalOwed) {
            // Full repayment
            interestPaid = accrued;
            principalPaid = pos.principal;
        } else if (repayAmount > accrued) {
            // Partial: pay all interest + some principal
            interestPaid = accrued;
            principalPaid = repayAmount - accrued;
        } else {
            // Only covers part of interest
            interestPaid = repayAmount;
            principalPaid = 0;
        }

        // Transfer tokens from authorized contract
        IERC20(token).safeTransferFrom(msg.sender, address(this), repayAmount);

        // Update borrow position
        pos.principal = (repayAmount >= totalOwed) ? 0 : pos.principal - principalPaid + (accrued - interestPaid);
        pos.borrowIndex = pool.borrowIndex;

        // Update pool state
        pool.totalBorrowed -= principalPaid;

        // Interest distribution: reserveFactor to protocol, rest to depositors
        uint256 protocolShare = (interestPaid * pool.reserveFactor) / BPS;
        uint256 depositorShare = interestPaid - protocolShare;
        pool.reserves += protocolShare;
        pool.totalDeposits += depositorShare;

        emit Repaid(token, borrower, principalPaid, interestPaid);
    }

    /**
     * @notice Force-repay a borrower's position (liquidation)
     * @dev The authorized contract must have tokens to repay. Typically the matching engine
     *      buys tokens from the bonding curve using the borrower's collateral, then calls this.
     * @param token The meme token address
     * @param borrower The borrower to liquidate
     * @return seized Total amount repaid (principal + interest)
     */
    function liquidateBorrow(
        address token,
        address borrower
    ) external onlyAuthorized onlyEnabledToken(token) returns (uint256 seized) {
        TokenPool storage pool = tokenPools[token];
        _accrueInterest(token, pool);

        BorrowPosition storage pos = borrowPositions[token][borrower];
        if (pos.principal == 0) revert NoBorrowToLiquidate();

        // Calculate total owed
        uint256 accrued = (pos.principal * pool.borrowIndex) / pos.borrowIndex - pos.principal;
        seized = pos.principal + accrued;

        // Transfer tokens from authorized contract (engine already bought them)
        IERC20(token).safeTransferFrom(msg.sender, address(this), seized);

        // Update pool
        pool.totalBorrowed -= pos.principal;

        // Interest to depositors and protocol
        uint256 protocolShare = (accrued * pool.reserveFactor) / BPS;
        uint256 depositorShare = accrued - protocolShare;
        pool.reserves += protocolShare;
        pool.totalDeposits += depositorShare;

        // Clear position
        pos.principal = 0;
        pos.borrowIndex = 0;

        emit BorrowLiquidated(token, borrower, msg.sender, seized);
    }

    // ══════════════════════════════════════════════════════════════════
    // VIEW FUNCTIONS
    // ══════════════════════════════════════════════════════════════════

    function getPoolInfo(address token) external view returns (
        bool enabled,
        uint256 totalDeposits,
        uint256 totalBorrowed,
        uint256 totalShares,
        uint256 utilization,
        uint256 borrowRate,
        uint256 supplyRate,
        uint256 reserves
    ) {
        TokenPool storage pool = tokenPools[token];
        enabled = pool.enabled;
        totalDeposits = pool.totalDeposits;
        totalBorrowed = pool.totalBorrowed;
        totalShares = pool.totalShares;
        utilization = _getUtilization(pool);
        borrowRate = _getBorrowRate(_getUtilization(pool));
        supplyRate = _getSupplyRate(pool);
        reserves = pool.reserves;
    }

    function getUtilization(address token) public view returns (uint256) {
        return _getUtilization(tokenPools[token]);
    }

    function getBorrowRate(address token) public view returns (uint256) {
        return _getBorrowRate(_getUtilization(tokenPools[token]));
    }

    function getSupplyRate(address token) public view returns (uint256) {
        return _getSupplyRate(tokenPools[token]);
    }

    function getAvailableLiquidity(address token) external view returns (uint256) {
        TokenPool storage pool = tokenPools[token];
        if (pool.totalDeposits <= pool.totalBorrowed) return 0;
        return pool.totalDeposits - pool.totalBorrowed;
    }

    function getUserDeposit(address token, address user) external view returns (uint256) {
        TokenPool storage pool = tokenPools[token];
        uint256 shares = userShares[token][user];
        if (shares == 0 || pool.totalShares == 0) return 0;
        return (shares * pool.totalDeposits) / pool.totalShares;
    }

    function getUserShares(address token, address user) external view returns (uint256) {
        return userShares[token][user];
    }

    function getUserPendingInterest(address token, address user) external view returns (uint256) {
        TokenPool storage pool = tokenPools[token];
        uint256 shares = userShares[token][user];
        if (shares == 0) return userPendingInterest[token][user];

        uint256 currentIndex = _calculateSupplyIndex(token, pool);
        uint256 idx = userSupplyIndex[token][user];
        if (idx == 0) idx = PRECISION;

        uint256 accrued = (shares * (currentIndex - idx)) / PRECISION;
        return userPendingInterest[token][user] + accrued;
    }

    function getUserBorrow(address token, address user) external view returns (uint256) {
        BorrowPosition storage pos = borrowPositions[token][user];
        if (pos.principal == 0) return 0;

        TokenPool storage pool = tokenPools[token];
        uint256 currentIndex = _calculateBorrowIndex(token, pool);
        return (pos.principal * currentIndex) / pos.borrowIndex;
    }

    function isTokenEnabled(address token) external view returns (bool) {
        return tokenPools[token].enabled;
    }

    function getEnabledTokens() external view returns (address[] memory) {
        return enabledTokens;
    }

    function getEnabledTokenCount() external view returns (uint256) {
        return enabledTokens.length;
    }

    function sharesToAmount(address token, uint256 shares) public view returns (uint256) {
        TokenPool storage pool = tokenPools[token];
        if (pool.totalShares == 0) return shares;
        return (shares * pool.totalDeposits) / pool.totalShares;
    }

    function amountToShares(address token, uint256 amount) public view returns (uint256) {
        TokenPool storage pool = tokenPools[token];
        if (pool.totalShares == 0) return amount;
        return (amount * pool.totalShares) / pool.totalDeposits;
    }

    // ══════════════════════════════════════════════════════════════════
    // INTERNAL: Interest Rate Model
    // ══════════════════════════════════════════════════════════════════

    function _getUtilization(TokenPool storage pool) internal view returns (uint256) {
        if (pool.totalDeposits == 0) return 0;
        return (pool.totalBorrowed * PRECISION) / pool.totalDeposits;
    }

    function _getBorrowRate(uint256 utilization) internal pure returns (uint256) {
        if (utilization <= OPTIMAL_UTILIZATION) {
            return BASE_RATE + (utilization * SLOPE1) / OPTIMAL_UTILIZATION;
        } else {
            uint256 excess = utilization - OPTIMAL_UTILIZATION;
            uint256 maxExcess = PRECISION - OPTIMAL_UTILIZATION;
            return BASE_RATE + SLOPE1 + (excess * SLOPE2) / maxExcess;
        }
    }

    function _getSupplyRate(TokenPool storage pool) internal view returns (uint256) {
        uint256 utilization = _getUtilization(pool);
        uint256 borrowRate = _getBorrowRate(utilization);
        uint256 reserveShare = PRECISION - (uint256(pool.reserveFactor) * PRECISION / BPS);
        return (borrowRate * utilization * reserveShare) / (PRECISION * PRECISION);
    }

    // ══════════════════════════════════════════════════════════════════
    // INTERNAL: Interest Accrual
    // ══════════════════════════════════════════════════════════════════

    function _accrueInterest(address token, TokenPool storage pool) internal {
        uint256 timeElapsed = block.timestamp - pool.lastUpdateTime;
        if (timeElapsed == 0) return;

        uint256 utilization = _getUtilization(pool);
        uint256 borrowRate = _getBorrowRate(utilization);

        // Update borrow index
        uint256 borrowInterest = (pool.borrowIndex * borrowRate * timeElapsed) / (SECONDS_PER_YEAR * PRECISION);
        pool.borrowIndex += borrowInterest;

        // Calculate actual interest earned on borrows
        if (pool.totalBorrowed > 0) {
            uint256 interestEarned = (pool.totalBorrowed * borrowRate * timeElapsed) / (SECONDS_PER_YEAR * PRECISION);

            // Split: reserveFactor to protocol, rest to supply index
            uint256 protocolShare = (interestEarned * pool.reserveFactor) / BPS;
            pool.reserves += protocolShare;

            uint256 depositorShare = interestEarned - protocolShare;
            if (pool.totalDeposits > 0) {
                uint256 supplyInterest = (pool.supplyIndex * depositorShare) / pool.totalDeposits;
                pool.supplyIndex += supplyInterest;
            }
        }

        pool.lastUpdateTime = uint64(block.timestamp);

        emit InterestAccrued(token, pool.borrowIndex, pool.supplyIndex, block.timestamp);
    }

    function _updateUserInterest(address token, TokenPool storage pool, address user) internal {
        uint256 shares = userShares[token][user];
        if (shares == 0) return;

        uint256 idx = userSupplyIndex[token][user];
        if (idx == 0) {
            userSupplyIndex[token][user] = pool.supplyIndex;
            return;
        }

        uint256 accrued = (shares * (pool.supplyIndex - idx)) / PRECISION;
        userPendingInterest[token][user] += accrued;
        userSupplyIndex[token][user] = pool.supplyIndex;
    }

    function _calculateBorrowIndex(address, TokenPool storage pool) internal view returns (uint256) {
        uint256 timeElapsed = block.timestamp - pool.lastUpdateTime;
        if (timeElapsed == 0) return pool.borrowIndex;

        uint256 utilization = _getUtilization(pool);
        uint256 borrowRate = _getBorrowRate(utilization);
        uint256 interest = (pool.borrowIndex * borrowRate * timeElapsed) / (SECONDS_PER_YEAR * PRECISION);
        return pool.borrowIndex + interest;
    }

    function _calculateSupplyIndex(address, TokenPool storage pool) internal view returns (uint256) {
        uint256 timeElapsed = block.timestamp - pool.lastUpdateTime;
        if (timeElapsed == 0) return pool.supplyIndex;

        if (pool.totalBorrowed == 0 || pool.totalDeposits == 0) return pool.supplyIndex;

        uint256 utilization = _getUtilization(pool);
        uint256 borrowRate = _getBorrowRate(utilization);
        uint256 interestEarned = (pool.totalBorrowed * borrowRate * timeElapsed) / (SECONDS_PER_YEAR * PRECISION);

        uint256 depositorShare = interestEarned - (interestEarned * pool.reserveFactor / BPS);
        uint256 supplyInterest = (pool.supplyIndex * depositorShare) / pool.totalDeposits;
        return pool.supplyIndex + supplyInterest;
    }
}
