// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * @title IExternalTokenRegistry
 * @notice 外部代币申请上合约的公开接口 — 允许第三方 meme 代币通过付费+锁仓 LP 的方式在本平台
 *         开启合约交易。价格源为 PancakeSwap V2 Pair (30min TWAP)，LP 以 first-loss bond
 *         形式托管在 Registry 中 60 天后解锁，admin 可在违约时 slash。
 *
 * @dev MVP 语义（重要）:
 *      - Project LP **不**进 PerpVault，**不**作为主动对手盘
 *      - 所有对手盘仍由全平台共享 PerpVault 提供
 *      - Project LP = **履约押金** (first-loss bond)，违约时 admin 可 slash 到 treasury
 *      - 这样设计使 Registry 合约职责单一（纯托管 + 元数据），PerpVault 零改动
 */
interface IExternalTokenRegistry {
    // ============================================================
    //  Enums
    // ============================================================

    /// @notice 申请生命周期状态
    enum ListingStatus {
        NONE,            // default — appId 不存在
        PENDING,         // 已付费 + 已锁 LP，等待 admin 审核
        APPROVED,        // 审核通过，引擎已开启该 token 合约交易
        REJECTED,        // admin 拒绝，LP 已退回，费用不退
        DELISTED,        // 下架 (主动或流动性不足)，LP 按锁仓规则处理
        SLASHED          // 项目方违约，LP 被 slash 到 treasury
    }

    /// @notice 申请的目标杠杆档位 — 决定所需 LP 最低额度
    /// @dev LP 最小额度 = BASE_LP_USD × (maxLeverage / 2)² , 单位 USD
    enum LeverageTier {
        TIER_2X,   // 2x max, minLP = $50k  (1× base)
        TIER_3X,   // 3x max, minLP = $112.5k (2.25× base)  actual: 50k*1.5² = 112.5k — but rounded to $75k in config
        TIER_5X,   // 5x max, minLP = $150k (6.25× base) — rounded simpler tiers
        TIER_7X,   // 7x max, minLP = $300k
        TIER_10X   // 10x max, minLP = $500k
    }

    // ============================================================
    //  Structs
    // ============================================================

    struct Listing {
        address token;            // meme token (ERC-20)
        address pair;             // PancakeSwap V2 pair (token / WBNB)
        address projectTeam;      // 申请人 — 也是 LP 的受益人 (LP 退回目标)
        uint256 lpAmountBNB;      // 锁仓的 LP 金额 (wei)
        uint256 lpUnlockAt;       // 解锁时间戳 (seconds since epoch); lpAmountBNB can withdraw after
        uint256 feesPaid;         // 已付的上币费 (wei, in BNB at listing time)
        LeverageTier tier;        // 项目方申请时选的杠杆档位
        ListingStatus status;     // 当前状态
        uint64 appliedAt;         // 申请时间戳
        uint64 approvedAt;        // 审核时间戳 (0 if not approved yet)
    }

    // ============================================================
    //  Events
    // ============================================================

    /// @notice 用户提交申请
    event ListingRequested(
        uint256 indexed appId,
        address indexed projectTeam,
        address indexed token,
        address pair,
        LeverageTier tier,
        uint256 feesPaid,
        uint256 lpAmountBNB
    );

    /// @notice admin 批准上币
    event ListingApproved(uint256 indexed appId, address indexed admin);

    /// @notice admin 拒绝申请 — LP 退还项目方
    event ListingRejected(uint256 indexed appId, address indexed admin, string reason);

    /// @notice 正常下架 (流动性不足 / 项目方主动) — LP 按规则处理
    event ListingDelisted(uint256 indexed appId, address indexed admin, string reason);

    /// @notice 违约 slash — LP 被转入 treasury
    event ListingSlashed(uint256 indexed appId, address indexed admin, uint256 slashedAmount, string reason);

    /// @notice 项目方解锁后提取 LP
    event ProjectLPWithdrawn(uint256 indexed appId, address indexed projectTeam, uint256 amount);

    /// @notice 费用 / LP 参数更新
    event ListingFeeUpdated(uint256 oldFee, uint256 newFee);
    event TierMinLPUpdated(LeverageTier tier, uint256 oldMinLP, uint256 newMinLP);
    event TreasuryUpdated(address oldTreasury, address newTreasury);
    event AdminUpdated(address oldAdmin, address newAdmin);

    // ============================================================
    //  Custom Errors
    // ============================================================

    error NotAdmin();
    error NotProjectTeam();
    error InvalidListingStatus(ListingStatus current);
    error InsufficientFee(uint256 required, uint256 paid);
    error InsufficientLP(uint256 required, uint256 paid);
    error LockNotExpired(uint256 unlockAt, uint256 currentTime);
    error InvalidPair(address pair, address token);
    error ZeroAddress();
    error TransferFailed();

    // ============================================================
    //  User Functions
    // ============================================================

    /**
     * @notice 申请上币 — 用户需同时支付：listingFee (USD) + 对应档位的 LP 最低额度
     *         以 BNB 支付，合约按 listingFeePriceBNB 锁仓费率折算 USD
     * @param token      meme 代币 ERC-20 地址
     * @param pair       PancakeSwap V2 Pair 地址（必须存在且其一为 WBNB）
     * @param tier       申请的最大杠杆档位
     * @return appId     生成的申请 ID
     */
    function applyListing(
        address token,
        address pair,
        LeverageTier tier
    ) external payable returns (uint256 appId);

    /**
     * @notice 解锁期满后，项目方取回自己的 LP
     * @param appId  申请 ID
     */
    function withdrawProjectLP(uint256 appId) external;

    // ============================================================
    //  Admin Functions
    // ============================================================

    /**
     * @notice admin 批准申请 — 此后引擎可开启该 token 交易
     */
    function approveListing(uint256 appId) external;

    /**
     * @notice admin 拒绝申请 — LP 退回项目方，feesPaid 留给 treasury (不退)
     */
    function rejectListing(uint256 appId, string calldata reason) external;

    /**
     * @notice 正常下架 — 引擎停止该 token 交易；LP 仍按 lpUnlockAt 规则正常解锁
     */
    function delistListing(uint256 appId, string calldata reason) external;

    /**
     * @notice 违约 slash — LP 转给 treasury (永久没收)；同时下架
     */
    function slashListing(uint256 appId, string calldata reason) external;

    /// @notice 更新上币费 (BNB wei)
    function setListingFeeBNB(uint256 newFee) external;

    /// @notice 更新某档位的最小 LP (BNB wei)
    function setTierMinLP(LeverageTier tier, uint256 newMinLP) external;

    /// @notice 更新 treasury 地址
    function setTreasury(address newTreasury) external;

    /// @notice 更新 admin 地址（应为多签）
    function setAdmin(address newAdmin) external;

    // ============================================================
    //  View Functions
    // ============================================================

    /// @notice 读取指定申请
    function getListing(uint256 appId) external view returns (Listing memory);

    /// @notice 当前激活的（已 APPROVED）申请 ID 列表
    function getActiveListings() external view returns (uint256[] memory);

    /// @notice 某 token 是否被激活上币（引擎侧快速查询）
    function isTokenActive(address token) external view returns (bool);

    /// @notice token 对应的 maxLeverage（引擎侧查询，若未上币返回 0）
    function getMaxLeverageForToken(address token) external view returns (uint8);

    /// @notice 当前上币费（BNB wei）
    function listingFeeBNB() external view returns (uint256);

    /// @notice 档位对应的最低 LP（BNB wei）
    function tierMinLP(LeverageTier tier) external view returns (uint256);

    /// @notice 锁仓时长（常量 60 days）
    function LOCK_DURATION() external view returns (uint256);
}
