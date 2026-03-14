// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/access/Ownable2Step.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/cryptography/MerkleProof.sol";
import "../interfaces/IWETH.sol";

/**
 * @title TradingVault
 * @notice Unified fund custody contract — merges SettlementV2 (user margin) + PerpVault (LP pool)
 *
 * Architecture:
 * - All funds (user deposits + LP deposits) held in ONE contract as WBNB
 * - PnL settlement is pure bookkeeping (no cross-contract ETH transfers)
 * - Two withdrawal paths: fastWithdraw (daily) + Merkle withdraw (fallback)
 * - LP pool as counterparty for perpetual trades (GMX model)
 *
 * Fund flows:
 *   User deposit  → WBNB into contract → userDeposits[user] tracking
 *   LP deposit    → BNB wrapped to WBNB → lpPoolBalance + shares tracking
 *   Trader profit → lpPoolBalance -= amount (bookkeeping only, no transfer)
 *   Trader loss   → lpPoolBalance += amount (bookkeeping only, no transfer)
 *   User withdraw → fastWithdraw (platform signature) or withdraw (Merkle proof)
 *   LP withdraw   → shares burned → WBNB unwrapped → BNB sent to LP
 */
contract TradingVault is Ownable2Step, ReentrancyGuard, Pausable, EIP712 {
    using ECDSA for bytes32;
    using SafeERC20 for IERC20;

    // ============================================================
    // Constants
    // ============================================================

    uint256 public constant PRECISION = 1e18;
    uint256 public constant FEE_PRECISION = 10000; // basis points

    // EIP-712 type hashes
    bytes32 public constant WITHDRAWAL_TYPEHASH = keccak256(
        "Withdrawal(address user,uint256 amount,uint256 nonce,uint256 deadline,bytes32 merkleRoot)"
    );
    bytes32 public constant FAST_WITHDRAWAL_TYPEHASH = keccak256(
        "FastWithdrawal(address user,uint256 amount,uint256 nonce,uint256 deadline)"
    );

    // LP constants
    uint256 public constant MAX_COOLDOWN = 7 days;
    uint256 public constant MIN_LIQUIDITY = 0.1 ether;
    uint256 public constant MIN_LP_DEPOSIT = 0.001 ether;
    uint256 public constant DEAD_SHARES = 1000;
    address public constant DEAD_ADDRESS = address(0xdEaD);

    // ============================================================
    // State — User Margin (from SettlementV2)
    // ============================================================

    address public platformSigner;
    IERC20 public immutable collateralToken; // WBNB

    mapping(address => uint256) public userDeposits;
    mapping(address => uint256) public withdrawalNonces;      // Merkle path
    mapping(address => uint256) public fastWithdrawalNonces;   // Fast path
    mapping(address => uint256) public totalWithdrawn;

    uint256 public depositCapPerUser;
    uint256 public depositCapTotal;
    uint256 public totalDeposited;

    // ============================================================
    // State — Merkle Attestation (from SettlementV2)
    // ============================================================

    struct StateRoot {
        bytes32 root;
        uint256 timestamp;
        uint256 blockNumber;
    }

    StateRoot public currentStateRoot;
    StateRoot[] public stateRootHistory;
    mapping(address => bool) public authorizedUpdaters;

    // ============================================================
    // State — LP Pool (from PerpVault)
    // ============================================================

    uint256 public lpPoolBalance;     // Explicit LP pool balance tracking
    uint256 public totalShares;
    uint256 public totalFeesCollected;
    uint256 public totalProfitsPaid;
    uint256 public totalLossesReceived;
    uint256 public totalLiquidationReceived;
    int256 public netPendingPnL;

    mapping(address => uint256) public shares;
    mapping(address => uint256) public lastDepositAt;
    mapping(address => uint256) public lpWithdrawalAmount;
    mapping(address => uint256) public lpWithdrawalTimestamp;

    uint256 public withdrawalCooldown = 24 hours;
    uint256 public maxPoolValue;
    bool public lpDepositsPaused;
    uint256 public depositFeeBps = 50;     // 0.5%
    uint256 public withdrawalFeeBps = 50;  // 0.5%
    uint256 public maxUtilization = 5000;  // 50%
    uint256 public adlThresholdBps = 7000; // 70%

    // ============================================================
    // State — OI Tracking (from PerpVault)
    // ============================================================

    mapping(address => uint256) public longOI;
    mapping(address => uint256) public shortOI;
    mapping(address => uint256) public maxOIPerToken;
    address[] public oiTokens;
    mapping(address => bool) public isOIToken;
    uint256 public totalOIAccumulator;

    // ============================================================
    // State — Authorization
    // ============================================================

    mapping(address => bool) public authorizedContracts; // matcher wallet

    // ============================================================
    // Events
    // ============================================================

    // User margin
    event Deposited(address indexed user, uint256 amount, uint256 totalDeposits);
    event DepositedFor(address indexed user, address indexed relayer, uint256 amount);
    event DepositedBNB(address indexed user, uint256 amount, uint256 totalDeposits);
    event Withdrawn(address indexed user, uint256 amount, uint256 nonce);
    event FastWithdrawn(address indexed user, uint256 amount, uint256 nonce);

    // State root
    event StateRootUpdated(bytes32 indexed root, uint256 timestamp, uint256 snapshotId);

    // LP pool
    event LPDeposit(address indexed lp, uint256 ethAmount, uint256 sharesReceived, uint256 sharePrice, uint256 fee);
    event LPWithdrawalRequested(address indexed lp, uint256 shares, uint256 timestamp);
    event LPWithdrawalExecuted(address indexed lp, uint256 shares, uint256 ethReceived, uint256 sharePrice, uint256 fee);
    event LPWithdrawalCancelled(address indexed lp, uint256 shares);

    // Settlement
    event TraderProfitSettled(address indexed trader, uint256 profitETH);
    event TraderProfitSettledPartial(address indexed trader, uint256 requestedETH, uint256 actualETH);
    event TraderLossSettled(uint256 lossETH);
    event LiquidationSettled(address indexed liquidator, uint256 collateralETH, uint256 liquidatorReward);
    event FeeCollected(uint256 feeETH);
    event ADLTriggered(uint256 pendingProfit, uint256 poolBalance);
    event PendingPnLUpdated(int256 oldPnL, int256 newPnL);

    // OI
    event OIIncreased(address indexed token, bool isLong, uint256 sizeETH, uint256 newOI);
    event OIDecreased(address indexed token, bool isLong, uint256 sizeETH, uint256 newOI);

    // Admin
    event PlatformSignerUpdated(address indexed oldSigner, address indexed newSigner);
    event UpdaterAuthorized(address indexed updater, bool authorized);
    event ContractAuthorized(address indexed contractAddr, bool authorized);
    event DepositCapPerUserUpdated(uint256 oldCap, uint256 newCap);
    event DepositCapTotalUpdated(uint256 oldCap, uint256 newCap);
    event CooldownUpdated(uint256 oldCooldown, uint256 newCooldown);
    event MaxPoolValueSet(uint256 maxValue);
    event LPDepositsPausedSet(bool paused);
    event MaxOIPerTokenSet(address indexed token, uint256 maxOI);

    // ============================================================
    // Errors
    // ============================================================

    error InvalidAmount();
    error InvalidSignature();
    error InvalidProof();
    error InvalidNonce();
    error DeadlineExpired();
    error InsufficientEquity();
    error InsufficientPoolBalance();
    error UnauthorizedUpdater();
    error Unauthorized();
    error ZeroAddress();
    error UserDepositCapExceeded();
    error TotalDepositCapExceeded();
    error ExceedsMaxOI();
    error NoWithdrawalPending();
    error CooldownNotMet();
    error BelowMinLiquidity();
    error InsufficientShares();
    error TransferFailed();
    error SlippageExceeded();
    error InsufficientPoolForOI();
    error LPDepositsPausedError();
    error ExceedsMaxPoolValue();
    error CooldownTooLong();

    // ============================================================
    // Modifiers
    // ============================================================

    modifier onlyAuthorized() {
        if (!authorizedContracts[msg.sender]) revert Unauthorized();
        _;
    }

    // ============================================================
    // Constructor
    // ============================================================

    constructor(
        address _collateralToken,
        address _platformSigner,
        address initialOwner
    ) Ownable(initialOwner) EIP712("TradingVault", "1") {
        if (_collateralToken == address(0)) revert ZeroAddress();
        if (_platformSigner == address(0)) revert ZeroAddress();

        collateralToken = IERC20(_collateralToken);
        platformSigner = _platformSigner;
    }

    // ============================================================
    // User Deposit Functions
    // ============================================================

    function deposit(uint256 amount) external nonReentrant whenNotPaused {
        if (amount == 0) revert InvalidAmount();
        _checkDepositCaps(msg.sender, amount);

        collateralToken.safeTransferFrom(msg.sender, address(this), amount);
        userDeposits[msg.sender] += amount;
        totalDeposited += amount;

        emit Deposited(msg.sender, amount, userDeposits[msg.sender]);
    }

    function depositFor(address user, uint256 amount) external nonReentrant whenNotPaused {
        if (amount == 0) revert InvalidAmount();
        if (user == address(0)) revert ZeroAddress();
        _checkDepositCaps(user, amount);

        collateralToken.safeTransferFrom(msg.sender, address(this), amount);
        userDeposits[user] += amount;
        totalDeposited += amount;

        emit DepositedFor(user, msg.sender, amount);
    }

    function depositBNB() external payable nonReentrant whenNotPaused {
        uint256 amount = msg.value;
        if (amount == 0) revert InvalidAmount();
        _checkDepositCaps(msg.sender, amount);

        // CEI: Effects before Interactions
        userDeposits[msg.sender] += amount;
        totalDeposited += amount;

        // Wrap native BNB → WBNB
        IWETH(address(collateralToken)).deposit{value: amount}();

        emit DepositedBNB(msg.sender, amount, userDeposits[msg.sender]);
    }

    function depositBNBFor(address user) external payable nonReentrant whenNotPaused {
        uint256 amount = msg.value;
        if (amount == 0) revert InvalidAmount();
        if (user == address(0)) revert ZeroAddress();
        _checkDepositCaps(user, amount);

        // CEI: Effects before Interactions
        userDeposits[user] += amount;
        totalDeposited += amount;

        // Wrap native BNB → WBNB
        IWETH(address(collateralToken)).deposit{value: amount}();

        emit DepositedBNB(user, amount, userDeposits[user]);
    }

    function _checkDepositCaps(address user, uint256 amount) internal view {
        if (depositCapPerUser > 0 && userDeposits[user] + amount > depositCapPerUser) {
            revert UserDepositCapExceeded();
        }
        if (depositCapTotal > 0 && totalDeposited + amount > depositCapTotal) {
            revert TotalDepositCapExceeded();
        }
    }

    // ============================================================
    // User Withdrawal — Fast Path (signature only, daily use)
    // ============================================================

    /**
     * @notice Fast withdrawal — only requires platform signature, no Merkle proof
     * @dev Dual signature security: msg.sender (user wallet) + platformSigner (EIP-712)
     *      Follows Hyperliquid model: engine verifies balance → signs → user submits
     */
    function fastWithdraw(
        uint256 amount,
        uint256 nonce,
        uint256 deadline,
        bytes calldata signature
    ) external nonReentrant whenNotPaused {
        if (amount == 0) revert InvalidAmount();
        if (block.timestamp > deadline) revert DeadlineExpired();

        address user = msg.sender;
        if (nonce != fastWithdrawalNonces[user]) revert InvalidNonce();

        // Verify platform signature (EIP-712)
        bytes32 structHash = keccak256(
            abi.encode(FAST_WITHDRAWAL_TYPEHASH, user, amount, nonce, deadline)
        );
        bytes32 digest = _hashTypedDataV4(structHash);
        address recoveredSigner = ECDSA.recover(digest, signature);
        if (recoveredSigner != platformSigner) revert InvalidSignature();

        // Check contract has enough WBNB
        uint256 balance = collateralToken.balanceOf(address(this));
        if (balance < amount) revert InsufficientEquity();

        // Update state (CEI: state before transfer)
        fastWithdrawalNonces[user] = nonce + 1;
        totalWithdrawn[user] += amount;
        if (totalDeposited >= amount) {
            totalDeposited -= amount;
        } else {
            totalDeposited = 0;
        }

        // Transfer WBNB
        collateralToken.safeTransfer(user, amount);

        emit FastWithdrawn(user, amount, nonce);
    }

    // ============================================================
    // User Withdrawal — Merkle Path (fallback, platform-offline)
    // ============================================================

    /**
     * @notice Withdraw with Merkle proof and platform signature (fallback)
     * @dev Used when platform is offline — user can prove equity via on-chain Merkle root
     */
    function withdraw(
        uint256 amount,
        uint256 userEquity,
        bytes32[] calldata merkleProof,
        uint256 deadline,
        bytes calldata signature
    ) external nonReentrant whenNotPaused {
        if (amount == 0) revert InvalidAmount();
        if (block.timestamp > deadline) revert DeadlineExpired();

        address user = msg.sender;
        uint256 nonce = withdrawalNonces[user];

        // 1. Verify Merkle proof
        bytes32 leaf = keccak256(abi.encodePacked(user, userEquity));
        if (!MerkleProof.verify(merkleProof, currentStateRoot.root, leaf)) {
            revert InvalidProof();
        }

        // 2. Check equity
        uint256 maxWithdrawable = userEquity > totalWithdrawn[user]
            ? userEquity - totalWithdrawn[user]
            : 0;
        if (amount > maxWithdrawable) revert InsufficientEquity();

        // 3. Verify platform signature (EIP-712)
        bytes32 structHash = keccak256(
            abi.encode(WITHDRAWAL_TYPEHASH, user, amount, nonce, deadline, currentStateRoot.root)
        );
        bytes32 digest = _hashTypedDataV4(structHash);
        address recoveredSigner = ECDSA.recover(digest, signature);
        if (recoveredSigner != platformSigner) revert InvalidSignature();

        // 4. Update state
        withdrawalNonces[user] = nonce + 1;
        totalWithdrawn[user] += amount;
        if (totalDeposited >= amount) {
            totalDeposited -= amount;
        } else {
            totalDeposited = 0;
        }

        // 5. Transfer WBNB
        collateralToken.safeTransfer(user, amount);

        emit Withdrawn(user, amount, nonce);
    }

    // ============================================================
    // LP Pool Functions
    // ============================================================

    /**
     * @notice LP deposit — accepts native BNB, wraps to WBNB, mints shares
     * @dev First deposit mints DEAD_SHARES to prevent inflation attack
     */
    function depositLP() external payable nonReentrant whenNotPaused {
        _depositLP(0);
    }

    function depositLPWithSlippage(uint256 minSharesOut) external payable nonReentrant whenNotPaused {
        _depositLP(minSharesOut);
    }

    function _depositLP(uint256 minSharesOut) internal {
        if (lpDepositsPaused) revert LPDepositsPausedError();
        if (msg.value < MIN_LP_DEPOSIT) revert InvalidAmount();

        // Wrap BNB → WBNB first
        IWETH(address(collateralToken)).deposit{value: msg.value}();

        // Deduct deposit fee
        uint256 fee = (msg.value * depositFeeBps) / FEE_PRECISION;
        uint256 depositAmount = msg.value - fee;

        uint256 sharesToMint;

        if (totalShares == 0) {
            // First deposit: mint dead shares to prevent inflation attack
            sharesToMint = depositAmount - DEAD_SHARES;
            if (sharesToMint == 0) revert InvalidAmount();
            shares[DEAD_ADDRESS] = DEAD_SHARES;
            totalShares = DEAD_SHARES;
        } else {
            uint256 poolValue = getPoolValue();
            if (poolValue == 0) {
                sharesToMint = depositAmount;
            } else {
                sharesToMint = (depositAmount * totalShares) / poolValue;
            }
        }

        if (sharesToMint == 0) revert InvalidAmount();
        if (minSharesOut > 0 && sharesToMint < minSharesOut) revert SlippageExceeded();

        shares[msg.sender] += sharesToMint;
        totalShares += sharesToMint;
        lastDepositAt[msg.sender] = block.timestamp;
        lpPoolBalance += depositAmount;
        totalFeesCollected += fee;

        // Check max pool value after deposit
        if (maxPoolValue > 0 && getPoolValue() > maxPoolValue) revert ExceedsMaxPoolValue();

        emit LPDeposit(msg.sender, msg.value, sharesToMint, getSharePrice(), fee);
    }

    function requestWithdrawalLP(uint256 shareAmount) external whenNotPaused {
        if (shareAmount == 0) revert InvalidAmount();

        uint256 availableShares = shares[msg.sender] - lpWithdrawalAmount[msg.sender];
        if (shareAmount > availableShares) revert InsufficientShares();

        lpWithdrawalAmount[msg.sender] += shareAmount;
        lpWithdrawalTimestamp[msg.sender] = block.timestamp;

        emit LPWithdrawalRequested(msg.sender, shareAmount, block.timestamp);
    }

    function executeWithdrawalLP() external nonReentrant whenNotPaused {
        _executeWithdrawalLP(0);
    }

    function executeWithdrawalLPWithSlippage(uint256 minETHOut) external nonReentrant whenNotPaused {
        _executeWithdrawalLP(minETHOut);
    }

    function _executeWithdrawalLP(uint256 minETHOut) internal {
        uint256 pendingShares = lpWithdrawalAmount[msg.sender];
        if (pendingShares == 0) revert NoWithdrawalPending();

        // Cooldown from both deposit time and request time
        if (block.timestamp < lastDepositAt[msg.sender] + withdrawalCooldown) {
            revert CooldownNotMet();
        }
        if (block.timestamp < lpWithdrawalTimestamp[msg.sender] + withdrawalCooldown) {
            revert CooldownNotMet();
        }

        // Calculate ETH at current share price
        uint256 grossETH = (pendingShares * getSharePrice()) / PRECISION;
        uint256 fee = (grossETH * withdrawalFeeBps) / FEE_PRECISION;
        uint256 ethAmount = grossETH - fee;

        if (grossETH > lpPoolBalance) revert InsufficientPoolBalance();

        // Check minimum liquidity
        uint256 remainingPool = lpPoolBalance - grossETH;
        uint256 remainingUserShares = totalShares - pendingShares;
        bool onlyDeadSharesRemain = remainingUserShares <= DEAD_SHARES;
        if (remainingPool < MIN_LIQUIDITY && remainingPool != 0 && !onlyDeadSharesRemain) {
            revert BelowMinLiquidity();
        }

        // Pool must retain enough to cover active OI
        if (totalOIAccumulator > 0 && remainingPool > 0 && remainingPool < totalOIAccumulator) {
            revert InsufficientPoolForOI();
        }

        // Slippage protection
        if (minETHOut > 0 && ethAmount < minETHOut) revert SlippageExceeded();

        // Clear pending withdrawal
        lpWithdrawalAmount[msg.sender] = 0;
        lpWithdrawalTimestamp[msg.sender] = 0;

        // Burn shares
        shares[msg.sender] -= pendingShares;
        totalShares -= pendingShares;
        lpPoolBalance -= grossETH;
        totalFeesCollected += fee;

        // Unwrap WBNB → BNB and send to LP
        IWETH(address(collateralToken)).withdraw(ethAmount);
        (bool success,) = msg.sender.call{value: ethAmount}("");
        if (!success) revert TransferFailed();

        emit LPWithdrawalExecuted(msg.sender, pendingShares, ethAmount, getSharePrice(), fee);
    }

    function cancelWithdrawalLP() external {
        uint256 pendingShares = lpWithdrawalAmount[msg.sender];
        if (pendingShares == 0) revert NoWithdrawalPending();

        lpWithdrawalAmount[msg.sender] = 0;
        lpWithdrawalTimestamp[msg.sender] = 0;

        emit LPWithdrawalCancelled(msg.sender, pendingShares);
    }

    // ============================================================
    // Settlement Functions — Pure Bookkeeping (no transfers!)
    // ============================================================

    /**
     * @notice Settle trader profit — LP pool pays (bookkeeping only)
     * @dev No ETH transfer! Money stays in contract. Trader withdraws via fastWithdraw.
     *      C2: If pool balance insufficient, pays what's available (ADL).
     */
    function settleTraderProfit(address trader, uint256 profitETH) external onlyAuthorized {
        if (profitETH == 0) return;

        uint256 actualPay = profitETH;
        if (lpPoolBalance < profitETH) {
            actualPay = lpPoolBalance;
            emit ADLTriggered(profitETH, lpPoolBalance);
            if (actualPay == 0) revert InsufficientPoolBalance();
        }

        lpPoolBalance -= actualPay;
        totalProfitsPaid += actualPay;

        if (actualPay < profitETH) {
            emit TraderProfitSettledPartial(trader, profitETH, actualPay);
        } else {
            emit TraderProfitSettled(trader, profitETH);
        }
    }

    /**
     * @notice Settle trader loss — LP pool receives (bookkeeping only)
     * @dev No msg.value needed! Loss was already in the contract (from user deposits).
     */
    function settleTraderLoss(uint256 lossETH) external onlyAuthorized {
        if (lossETH == 0) return;
        lpPoolBalance += lossETH;
        totalLossesReceived += lossETH;
        emit TraderLossSettled(lossETH);
    }

    /**
     * @notice Collect trading fee — LP pool receives (bookkeeping only)
     */
    function collectFee(uint256 feeETH) external onlyAuthorized {
        if (feeETH == 0) return;
        lpPoolBalance += feeETH;
        totalFeesCollected += feeETH;
        emit FeeCollected(feeETH);
    }

    /**
     * @notice Settle liquidation — LP pool receives collateral, liquidator gets WBNB reward
     */
    function settleLiquidation(
        uint256 collateralETH,
        uint256 liquidatorReward,
        address liquidator
    ) external onlyAuthorized nonReentrant {
        if (collateralETH == 0) revert InvalidAmount();
        if (liquidatorReward > collateralETH) revert InvalidAmount();

        lpPoolBalance += collateralETH;
        totalLiquidationReceived += collateralETH;

        // Pay liquidator reward in WBNB
        if (liquidatorReward > 0 && liquidator != address(0)) {
            lpPoolBalance -= liquidatorReward;
            collateralToken.safeTransfer(liquidator, liquidatorReward);
        }

        emit LiquidationSettled(liquidator, collateralETH, liquidatorReward);
    }

    /**
     * @notice Update net pending PnL of all open positions
     */
    function updatePendingPnL(int256 _netPnL) external onlyAuthorized {
        emit PendingPnLUpdated(netPendingPnL, _netPnL);
        netPendingPnL = _netPnL;
    }

    // ============================================================
    // OI Tracking
    // ============================================================

    function increaseOI(address token, bool isLong, uint256 sizeETH) external onlyAuthorized {
        if (sizeETH == 0) return;

        if (!isOIToken[token]) {
            oiTokens.push(token);
            isOIToken[token] = true;
        }

        if (isLong) {
            longOI[token] += sizeETH;
            emit OIIncreased(token, true, sizeETH, longOI[token]);
        } else {
            shortOI[token] += sizeETH;
            emit OIIncreased(token, false, sizeETH, shortOI[token]);
        }

        totalOIAccumulator += sizeETH;

        uint256 maxOI = getMaxOI();
        if (maxOI > 0 && totalOIAccumulator > maxOI) revert ExceedsMaxOI();

        uint256 tokenMax = maxOIPerToken[token];
        if (tokenMax > 0 && (longOI[token] + shortOI[token]) > tokenMax) {
            revert ExceedsMaxOI();
        }
    }

    function decreaseOI(address token, bool isLong, uint256 sizeETH) external onlyAuthorized {
        if (sizeETH == 0) return;

        if (isLong) {
            uint256 decreased = longOI[token] > sizeETH ? sizeETH : longOI[token];
            longOI[token] -= decreased;
            totalOIAccumulator = totalOIAccumulator > decreased ? totalOIAccumulator - decreased : 0;
            emit OIDecreased(token, true, decreased, longOI[token]);
        } else {
            uint256 decreased = shortOI[token] > sizeETH ? sizeETH : shortOI[token];
            shortOI[token] -= decreased;
            totalOIAccumulator = totalOIAccumulator > decreased ? totalOIAccumulator - decreased : 0;
            emit OIDecreased(token, false, decreased, shortOI[token]);
        }
    }

    // ============================================================
    // State Root Management (Merkle fallback)
    // ============================================================

    function updateStateRoot(bytes32 newRoot) external {
        if (!authorizedUpdaters[msg.sender] && msg.sender != owner()) {
            revert UnauthorizedUpdater();
        }

        if (currentStateRoot.root != bytes32(0)) {
            stateRootHistory.push(currentStateRoot);
        }

        currentStateRoot = StateRoot({
            root: newRoot,
            timestamp: block.timestamp,
            blockNumber: block.number
        });

        emit StateRootUpdated(newRoot, block.timestamp, stateRootHistory.length);
    }

    // ============================================================
    // Admin Functions
    // ============================================================

    // --- User margin admin ---

    function setPlatformSigner(address newSigner) external onlyOwner {
        if (newSigner == address(0)) revert ZeroAddress();
        address oldSigner = platformSigner;
        platformSigner = newSigner;
        emit PlatformSignerUpdated(oldSigner, newSigner);
    }

    function setAuthorizedUpdater(address updater, bool authorized) external onlyOwner {
        if (updater == address(0)) revert ZeroAddress();
        authorizedUpdaters[updater] = authorized;
        emit UpdaterAuthorized(updater, authorized);
    }

    function setDepositCapPerUser(uint256 cap) external onlyOwner {
        uint256 oldCap = depositCapPerUser;
        depositCapPerUser = cap;
        emit DepositCapPerUserUpdated(oldCap, cap);
    }

    function setDepositCapTotal(uint256 cap) external onlyOwner {
        uint256 oldCap = depositCapTotal;
        depositCapTotal = cap;
        emit DepositCapTotalUpdated(oldCap, cap);
    }

    // --- LP pool admin ---

    function setAuthorizedContract(address contractAddr, bool authorized) external onlyOwner {
        if (contractAddr == address(0)) revert ZeroAddress();
        authorizedContracts[contractAddr] = authorized;
        emit ContractAuthorized(contractAddr, authorized);
    }

    function setMaxOIPerToken(address token, uint256 maxOI) external onlyOwner {
        if (token == address(0)) revert ZeroAddress();
        maxOIPerToken[token] = maxOI;
        emit MaxOIPerTokenSet(token, maxOI);
    }

    function setCooldown(uint256 _cooldown) external onlyOwner {
        if (_cooldown > MAX_COOLDOWN) revert CooldownTooLong();
        emit CooldownUpdated(withdrawalCooldown, _cooldown);
        withdrawalCooldown = _cooldown;
    }

    function setMaxPoolValue(uint256 _maxValue) external onlyOwner {
        maxPoolValue = _maxValue;
        emit MaxPoolValueSet(_maxValue);
    }

    function setLPDepositsPaused(bool _paused) external onlyOwner {
        lpDepositsPaused = _paused;
        emit LPDepositsPausedSet(_paused);
    }

    function setMaxUtilization(uint256 _bps) external onlyOwner {
        require(_bps >= 3000 && _bps <= 9500, "Out of range");
        maxUtilization = _bps;
    }

    function setAdlThreshold(uint256 _bps) external onlyOwner {
        require(_bps >= 5000 && _bps <= 9500, "Out of range");
        adlThresholdBps = _bps;
    }

    function setLPFees(uint256 _depositBps, uint256 _withdrawalBps) external onlyOwner {
        require(_depositBps <= 200 && _withdrawalBps <= 200, "Fee too high");
        depositFeeBps = _depositBps;
        withdrawalFeeBps = _withdrawalBps;
    }

    // --- Emergency ---

    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }

    // ============================================================
    // View Functions
    // ============================================================

    // --- LP Pool views ---

    function getPoolValue() public view returns (uint256) {
        int256 adjusted = int256(lpPoolBalance) - netPendingPnL;
        return adjusted > 0 ? uint256(adjusted) : 0;
    }

    function getSharePrice() public view returns (uint256) {
        if (totalShares == 0) return PRECISION;
        uint256 poolValue = getPoolValue();
        if (poolValue == 0) return 0;
        return (poolValue * PRECISION) / totalShares;
    }

    function getMaxOI() public view returns (uint256) {
        return (getPoolValue() * maxUtilization) / FEE_PRECISION;
    }

    function getTotalOI() public view returns (uint256) {
        return totalOIAccumulator;
    }

    function shouldADL() public view returns (bool shouldTrigger, uint256 pnlToPoolBps) {
        if (netPendingPnL <= 0) return (false, 0);
        uint256 pendingProfit = uint256(netPendingPnL);
        if (lpPoolBalance == 0) return (true, type(uint256).max);
        pnlToPoolBps = (pendingProfit * FEE_PRECISION) / lpPoolBalance;
        shouldTrigger = pnlToPoolBps >= adlThresholdBps;
    }

    function getLPValue(address lp) external view returns (uint256) {
        if (totalShares == 0) return 0;
        return (shares[lp] * getSharePrice()) / PRECISION;
    }

    function getTokenOI(address token) external view returns (uint256 long_, uint256 short_) {
        return (longOI[token], shortOI[token]);
    }

    function getUtilization() external view returns (uint256) {
        uint256 poolValue = getPoolValue();
        if (poolValue == 0) return 0;
        return (getTotalOI() * FEE_PRECISION) / poolValue;
    }

    function getLPWithdrawalInfo(address lp) external view returns (
        uint256 pendingShares,
        uint256 requestTime,
        uint256 executeAfter,
        uint256 estimatedETH
    ) {
        pendingShares = lpWithdrawalAmount[lp];
        requestTime = lpWithdrawalTimestamp[lp];
        executeAfter = requestTime > 0 ? requestTime + withdrawalCooldown : 0;
        estimatedETH = totalShares > 0 ? (pendingShares * getSharePrice()) / PRECISION : 0;
    }

    function getPoolStats() external view returns (
        uint256 poolValue,
        uint256 sharePrice,
        uint256 _totalShares,
        uint256 totalOI,
        uint256 maxOI,
        uint256 utilization,
        uint256 _totalFeesCollected,
        uint256 _totalProfitsPaid,
        uint256 _totalLossesReceived,
        uint256 _totalLiquidationReceived
    ) {
        poolValue = getPoolValue();
        sharePrice = getSharePrice();
        _totalShares = totalShares;
        totalOI = getTotalOI();
        maxOI = getMaxOI();
        utilization = poolValue > 0 ? (totalOI * FEE_PRECISION) / poolValue : 0;
        _totalFeesCollected = totalFeesCollected;
        _totalProfitsPaid = totalProfitsPaid;
        _totalLossesReceived = totalLossesReceived;
        _totalLiquidationReceived = totalLiquidationReceived;
    }

    function getExtendedStats() external view returns (
        int256 _netPendingPnL,
        uint256 _lpPoolBalance,
        uint256 _withdrawalCooldown,
        uint256 _maxPoolValue,
        bool _lpDepositsPaused,
        bool adlNeeded,
        uint256 adlPnlBps
    ) {
        _netPendingPnL = netPendingPnL;
        _lpPoolBalance = lpPoolBalance;
        _withdrawalCooldown = withdrawalCooldown;
        _maxPoolValue = maxPoolValue;
        _lpDepositsPaused = lpDepositsPaused;
        (adlNeeded, adlPnlBps) = shouldADL();
    }

    function getOITokenCount() external view returns (uint256) {
        return oiTokens.length;
    }

    // --- User margin views ---

    function getUserDeposits(address user) external view returns (uint256) {
        return userDeposits[user];
    }

    function getUserNonce(address user) external view returns (uint256) {
        return withdrawalNonces[user];
    }

    function getFastWithdrawalNonce(address user) external view returns (uint256) {
        return fastWithdrawalNonces[user];
    }

    function getUserTotalWithdrawn(address user) external view returns (uint256) {
        return totalWithdrawn[user];
    }

    function getWithdrawableBalance(address user, uint256 userEquity) external view returns (uint256) {
        if (userEquity <= totalWithdrawn[user]) return 0;
        return userEquity - totalWithdrawn[user];
    }

    function verifyMerkleProof(
        address user,
        uint256 equity,
        bytes32[] calldata proof
    ) external view returns (bool) {
        bytes32 leaf = keccak256(abi.encodePacked(user, equity));
        return MerkleProof.verify(proof, currentStateRoot.root, leaf);
    }

    function getStateRootHistoryLength() external view returns (uint256) {
        return stateRootHistory.length;
    }

    function getStateRootByIndex(uint256 index) external view returns (StateRoot memory) {
        return stateRootHistory[index];
    }

    function domainSeparator() external view returns (bytes32) {
        return _domainSeparatorV4();
    }

    // ============================================================
    // Receive — only from WBNB (for unwrap callback)
    // ============================================================

    receive() external payable {
        require(msg.sender == address(collateralToken), "Only WBNB");
    }
}
