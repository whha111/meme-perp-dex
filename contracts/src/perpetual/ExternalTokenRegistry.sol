// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "../interfaces/IExternalTokenRegistry.sol";

/// @notice Uniswap/PancakeSwap V2 Pair — 用于价格源验证（0 改动，就读 reserves）
interface IUniswapV2PairRegistry {
    function token0() external view returns (address);
    function token1() external view returns (address);
    function getReserves() external view returns (uint112 reserve0, uint112 reserve1, uint32 blockTimestampLast);
}

/**
 * @title ExternalTokenRegistry
 * @notice MVP 实现 — 允许第三方 meme 代币通过付费 + 锁仓 LP 的方式在本平台开启合约交易。
 *
 * 业务模型（LP = first-loss bond，不进 PerpVault）:
 *   1. 任何人提交 applyListing(token, pair, tier)，同时 msg.value >= listingFeeBNB + tierMinLP[tier]
 *   2. 合约验证 pair 合法（WBNB 一侧），将 feesPaid 留在 treasury 地址上，LP 锁 60 天
 *   3. admin 调 approveListing(appId) → 状态转 APPROVED → 引擎开启该 token 合约交易
 *   4. 正常情况: 60 天后项目方调 withdrawProjectLP(appId) 取回 LP
 *   5. 违约情况: admin 调 slashListing(appId, reason) → LP 转 treasury 永久没收
 *
 * 安全要点:
 *   - CEI 模式（先改状态再转账），避免 DEVELOPMENT_RULES.md 禁令 #8
 *   - ReentrancyGuard 防御 LP 提取路径
 *   - admin 应为多签（owner 可 setAdmin 更新）
 *   - feesPaid 立即转给 treasury（一次 external call）
 *   - LP 暂存 registry 合约本身 balance，通过 listingsLPTotal() 追踪
 *   - pair 合法性只做 "存在 + 其一是 WBNB" 检查，深度 / TWAP / liquidity 阈值在引擎侧实时评估
 *
 * 链下协同:
 *   - 引擎监听 ListingApproved 事件 → 加载 token 到 lifecycle (state = EXTERNAL_LISTED)
 *   - 引擎监听 ListingDelisted/Slashed 事件 → 立即 pauseToken
 *   - 引擎监听 ListingFeeUpdated → 更新显示的上币费
 */
contract ExternalTokenRegistry is IExternalTokenRegistry, Ownable, ReentrancyGuard {
    // ============================================================
    //  Constants
    // ============================================================

    /// @notice LP 锁仓时长 — 60 天
    uint256 public constant LOCK_DURATION = 60 days;

    /// @notice 合约标识（便于链下工具识别）
    string public constant CONTRACT_NAME = "ExternalTokenRegistry";
    string public constant CONTRACT_VERSION = "1.0.0-mvp";

    // ============================================================
    //  State
    // ============================================================

    /// @notice WBNB 合约地址 — pair 合法性的一侧必须是 WBNB
    address public immutable WBNB;

    /// @notice 接受 feesPaid + slash 收入的地址（platform treasury）
    address public treasury;

    /// @notice 有权 approve / reject / delist / slash 的地址（应为多签）
    address public admin;

    /// @notice 当前上币费（BNB wei，对应 $500 USD，admin 手动跟踪 BNB/USD 汇率）
    uint256 public listingFeeBNB;

    /// @notice 各档位最低 LP（BNB wei）
    ///         tierMinLP[LeverageTier.TIER_2X] = wei for $50k, etc.
    mapping(LeverageTier => uint256) public tierMinLP;

    /// @notice 申请计数器 — 下一个 appId
    uint256 public nextAppId;

    /// @notice appId => Listing 完整数据
    mapping(uint256 => Listing) private _listings;

    /// @notice token => 当前 APPROVED 的 appId（0 = 未上币）
    ///         同一 token 同一时刻只能有一个 APPROVED listing
    mapping(address => uint256) public activeAppIdForToken;

    /// @notice APPROVED 状态下的 appId 集合（简单 O(n) 枚举，MVP 可接受）
    uint256[] private _activeAppIds;

    /// @notice 所有被锁仓的 LP 总量（自检用：应 == address(this).balance - 已 slash 但未 transfer 的）
    uint256 public listingsLPTotal;

    // ============================================================
    //  Modifiers
    // ============================================================

    modifier onlyAdmin() {
        if (msg.sender != admin) revert NotAdmin();
        _;
    }

    // ============================================================
    //  Constructor
    // ============================================================

    /**
     * @param _wbnb         WBNB 合约地址（BSC testnet: 0xae13...7cd）
     * @param _treasury     收取上币费和 slash LP 的地址
     * @param _admin        初始 admin（通常是 owner 本身，后续可 setAdmin 改成多签）
     * @param _listingFee   初始上币费（BNB wei）
     */
    constructor(
        address _wbnb,
        address _treasury,
        address _admin,
        uint256 _listingFee
    ) Ownable(msg.sender) {
        if (_wbnb == address(0) || _treasury == address(0) || _admin == address(0)) {
            revert ZeroAddress();
        }
        WBNB = _wbnb;
        treasury = _treasury;
        admin = _admin;
        listingFeeBNB = _listingFee;

        // Default tier LP thresholds — owner can re-tune via setTierMinLP
        // Assuming 1 BNB = $600 USD for initial defaults on testnet
        // Mainnet owner MUST update these to actual USD-peg values
        tierMinLP[LeverageTier.TIER_2X]  = 83 ether;   // ~ $50k
        tierMinLP[LeverageTier.TIER_3X]  = 125 ether;  // ~ $75k
        tierMinLP[LeverageTier.TIER_5X]  = 250 ether;  // ~ $150k
        tierMinLP[LeverageTier.TIER_7X]  = 500 ether;  // ~ $300k
        tierMinLP[LeverageTier.TIER_10X] = 833 ether;  // ~ $500k
    }

    // ============================================================
    //  User: applyListing
    // ============================================================

    /// @inheritdoc IExternalTokenRegistry
    function applyListing(
        address token,
        address pair,
        LeverageTier tier
    ) external payable nonReentrant returns (uint256 appId) {
        if (token == address(0) || pair == address(0)) revert ZeroAddress();

        // 1. Pair 合法性：一侧必须是 WBNB，另一侧必须是 token
        _validatePair(pair, token);

        // 2. 费用 + LP 检查
        uint256 fee = listingFeeBNB;
        uint256 minLP = tierMinLP[tier];
        uint256 required = fee + minLP;
        if (msg.value < required) revert InsufficientFee(required, msg.value);

        // 3. CEI — effects first
        appId = ++nextAppId;
        uint256 lpAmount = msg.value - fee;  // 超出部分也算 LP（项目方自愿多锁）

        _listings[appId] = Listing({
            token: token,
            pair: pair,
            projectTeam: msg.sender,
            lpAmountBNB: lpAmount,
            lpUnlockAt: block.timestamp + LOCK_DURATION,
            feesPaid: fee,
            tier: tier,
            status: ListingStatus.PENDING,
            appliedAt: uint64(block.timestamp),
            approvedAt: 0
        });

        listingsLPTotal += lpAmount;

        emit ListingRequested(appId, msg.sender, token, pair, tier, fee, lpAmount);

        // 4. Interactions — 费用立即转 treasury
        _safeSendETH(treasury, fee);
    }

    // ============================================================
    //  User: withdrawProjectLP
    // ============================================================

    /// @inheritdoc IExternalTokenRegistry
    function withdrawProjectLP(uint256 appId) external nonReentrant {
        Listing storage l = _listings[appId];
        if (l.projectTeam != msg.sender) revert NotProjectTeam();

        // 允许提取的状态: APPROVED / REJECTED / DELISTED （只要没被 SLASHED）
        // SLASHED 状态下 LP 已转 treasury，lpAmountBNB 在 slash 时清零
        if (
            l.status != ListingStatus.APPROVED &&
            l.status != ListingStatus.REJECTED &&
            l.status != ListingStatus.DELISTED
        ) {
            revert InvalidListingStatus(l.status);
        }

        // REJECTED 允许立即取 — 锁仓只对 APPROVED/DELISTED 生效
        if (l.status == ListingStatus.APPROVED || l.status == ListingStatus.DELISTED) {
            if (block.timestamp < l.lpUnlockAt) {
                revert LockNotExpired(l.lpUnlockAt, block.timestamp);
            }
        }

        uint256 amount = l.lpAmountBNB;
        if (amount == 0) revert TransferFailed();

        // CEI — effects
        l.lpAmountBNB = 0;
        listingsLPTotal -= amount;

        emit ProjectLPWithdrawn(appId, msg.sender, amount);

        // Interactions
        _safeSendETH(msg.sender, amount);
    }

    // ============================================================
    //  Admin: approve / reject / delist / slash
    // ============================================================

    /// @inheritdoc IExternalTokenRegistry
    function approveListing(uint256 appId) external onlyAdmin {
        Listing storage l = _listings[appId];
        if (l.status != ListingStatus.PENDING) revert InvalidListingStatus(l.status);

        // 防重入同一 token 被两次上币
        if (activeAppIdForToken[l.token] != 0) {
            revert InvalidListingStatus(_listings[activeAppIdForToken[l.token]].status);
        }

        l.status = ListingStatus.APPROVED;
        l.approvedAt = uint64(block.timestamp);
        activeAppIdForToken[l.token] = appId;
        _activeAppIds.push(appId);

        emit ListingApproved(appId, msg.sender);
    }

    /// @inheritdoc IExternalTokenRegistry
    function rejectListing(uint256 appId, string calldata reason) external onlyAdmin nonReentrant {
        Listing storage l = _listings[appId];
        if (l.status != ListingStatus.PENDING) revert InvalidListingStatus(l.status);

        l.status = ListingStatus.REJECTED;
        // lpUnlockAt 保持原值，但 withdrawProjectLP 对 REJECTED 跳过锁仓检查 → 立即可取

        emit ListingRejected(appId, msg.sender, reason);
        // 不做自动转账 — 项目方主动调 withdrawProjectLP 取回
    }

    /// @inheritdoc IExternalTokenRegistry
    function delistListing(uint256 appId, string calldata reason) external onlyAdmin {
        Listing storage l = _listings[appId];
        if (l.status != ListingStatus.APPROVED) revert InvalidListingStatus(l.status);

        l.status = ListingStatus.DELISTED;

        // 从 activeAppIdForToken 解绑，同时从 _activeAppIds 移除
        activeAppIdForToken[l.token] = 0;
        _removeFromActive(appId);

        emit ListingDelisted(appId, msg.sender, reason);
    }

    /// @inheritdoc IExternalTokenRegistry
    function slashListing(uint256 appId, string calldata reason) external onlyAdmin nonReentrant {
        Listing storage l = _listings[appId];
        ListingStatus oldStatus = l.status;
        if (
            oldStatus != ListingStatus.PENDING &&
            oldStatus != ListingStatus.APPROVED &&
            oldStatus != ListingStatus.DELISTED
        ) {
            revert InvalidListingStatus(oldStatus);
        }

        uint256 slashedAmount = l.lpAmountBNB;

        // CEI — effects (check oldStatus BEFORE overwriting)
        l.status = ListingStatus.SLASHED;
        l.lpAmountBNB = 0;
        listingsLPTotal -= slashedAmount;

        // Only APPROVED listings have an entry in activeAppIdForToken / _activeAppIds
        if (oldStatus == ListingStatus.APPROVED && activeAppIdForToken[l.token] == appId) {
            activeAppIdForToken[l.token] = 0;
            _removeFromActive(appId);
        }

        emit ListingSlashed(appId, msg.sender, slashedAmount, reason);

        // Interactions
        if (slashedAmount > 0) {
            _safeSendETH(treasury, slashedAmount);
        }
    }

    // ============================================================
    //  Owner: parameter updates
    // ============================================================

    function setListingFeeBNB(uint256 newFee) external onlyOwner {
        uint256 old = listingFeeBNB;
        listingFeeBNB = newFee;
        emit ListingFeeUpdated(old, newFee);
    }

    function setTierMinLP(LeverageTier tier, uint256 newMinLP) external onlyOwner {
        uint256 old = tierMinLP[tier];
        tierMinLP[tier] = newMinLP;
        emit TierMinLPUpdated(tier, old, newMinLP);
    }

    function setTreasury(address newTreasury) external onlyOwner {
        if (newTreasury == address(0)) revert ZeroAddress();
        address old = treasury;
        treasury = newTreasury;
        emit TreasuryUpdated(old, newTreasury);
    }

    function setAdmin(address newAdmin) external onlyOwner {
        if (newAdmin == address(0)) revert ZeroAddress();
        address old = admin;
        admin = newAdmin;
        emit AdminUpdated(old, newAdmin);
    }

    // ============================================================
    //  Views
    // ============================================================

    function getListing(uint256 appId) external view returns (Listing memory) {
        return _listings[appId];
    }

    function getActiveListings() external view returns (uint256[] memory) {
        return _activeAppIds;
    }

    function isTokenActive(address token) external view returns (bool) {
        return activeAppIdForToken[token] != 0;
    }

    function getMaxLeverageForToken(address token) external view returns (uint8) {
        uint256 appId = activeAppIdForToken[token];
        if (appId == 0) return 0;
        LeverageTier tier = _listings[appId].tier;
        if (tier == LeverageTier.TIER_2X) return 2;
        if (tier == LeverageTier.TIER_3X) return 3;
        if (tier == LeverageTier.TIER_5X) return 5;
        if (tier == LeverageTier.TIER_7X) return 7;
        if (tier == LeverageTier.TIER_10X) return 10;
        return 0;
    }

    // ============================================================
    //  Internal helpers
    // ============================================================

    /// @dev pair 必须满足: (token0 == WBNB && token1 == token) || (token0 == token && token1 == WBNB)
    function _validatePair(address pair, address token) internal view {
        address t0 = IUniswapV2PairRegistry(pair).token0();
        address t1 = IUniswapV2PairRegistry(pair).token1();
        bool ok = (t0 == WBNB && t1 == token) || (t0 == token && t1 == WBNB);
        if (!ok) revert InvalidPair(pair, token);
    }

    /// @dev 从 _activeAppIds 中移除某 appId (swap-and-pop, O(n))
    function _removeFromActive(uint256 appId) internal {
        uint256 len = _activeAppIds.length;
        for (uint256 i; i < len; ++i) {
            if (_activeAppIds[i] == appId) {
                _activeAppIds[i] = _activeAppIds[len - 1];
                _activeAppIds.pop();
                return;
            }
        }
    }

    /// @dev 安全的 native ETH/BNB 转账 — gas-stipend 安全
    function _safeSendETH(address to, uint256 amount) internal {
        (bool success, ) = to.call{value: amount}("");
        if (!success) revert TransferFailed();
    }

    /// @dev 紧急情况下，owner 可取走不属于任何 listing 的 BNB（例如有人误转入）
    ///      listingsLPTotal 是所有锁仓 LP 的不变量
    function rescueStrandedBNB(address to) external onlyOwner nonReentrant {
        uint256 strayed = address(this).balance - listingsLPTotal;
        if (strayed == 0) revert TransferFailed();
        _safeSendETH(to, strayed);
    }

    // ============================================================
    //  Receive / Fallback
    // ============================================================

    /// @notice 只允许 applyListing 路径进入 ETH，直接转账拒绝
    receive() external payable {
        revert TransferFailed();
    }
}
