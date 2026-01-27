// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/access/Ownable.sol";
import "../interfaces/IPositionManager.sol";
import "../interfaces/IVault.sol";
import "../interfaces/IPriceFeed.sol";

/**
 * @title FundingRate
 * @notice 资金费率合约
 * @dev 每4小时结算一次，多空持仓量差异决定资金费率方向
 */
contract FundingRate is Ownable {
    // ============================================================
    // Constants
    // ============================================================

    uint256 public constant PRECISION = 1e18;
    uint256 public constant FUNDING_INTERVAL = 4 hours;
    uint256 public constant MAX_FUNDING_RATE = 1e16; // 1% 最大资金费率
    uint256 public constant MAX_HISTORY = 180; // 存储30天的历史 (180 * 4h)

    // ============================================================
    // Structs
    // ============================================================

    struct FundingSnapshot {
        int256 rate; // 资金费率（正数多付空，负数空付多）
        uint256 timestamp;
        uint256 totalLongPaid;
        uint256 totalShortPaid;
    }

    // ============================================================
    // State Variables
    // ============================================================

    IPositionManager public positionManager;
    IVault public vault;
    IPriceFeed public priceFeed;

    // 当前资金费率
    int256 public currentFundingRate;

    // 上次结算时间
    uint256 public lastFundingTime;

    // 累计资金费率（用于计算用户待结算费用）
    int256 public cumulativeFundingRate;

    // 用户上次结算时的累计费率
    mapping(address => int256) public userFundingIndex;

    // M-006: 资金费率历史（环形缓冲）
    FundingSnapshot[] public fundingHistory;
    uint256 public fundingHistoryIndex; // 环形缓冲当前写入位置

    // ============================================================
    // Events
    // ============================================================

    event FundingSettled(uint256 timestamp, int256 fundingRate, uint256 totalLongPaid, uint256 totalShortPaid);

    event UserFundingSettled(address indexed user, int256 amount);

    // ============================================================
    // Errors
    // ============================================================

    error TooEarlyToSettle();
    error ZeroAddress();
    error Unauthorized();
    error FundingOverdue();

    // ============================================================
    // Constructor
    // ============================================================

    constructor(address _positionManager, address _vault, address _priceFeed) Ownable(msg.sender) {
        if (_positionManager == address(0) || _vault == address(0) || _priceFeed == address(0)) {
            revert ZeroAddress();
        }
        positionManager = IPositionManager(_positionManager);
        vault = IVault(_vault);
        priceFeed = IPriceFeed(_priceFeed);
        lastFundingTime = block.timestamp;

        // M-006: 初始化环形缓冲数组
        for (uint256 i = 0; i < MAX_HISTORY; i++) {
            fundingHistory.push(FundingSnapshot({rate: 0, timestamp: 0, totalLongPaid: 0, totalShortPaid: 0}));
        }
    }

    // ============================================================
    // Keeper Functions
    // ============================================================

    /**
     * @notice 结算资金费（每4小时，Keeper 调用）
     */
    function settleFunding() external {
        if (block.timestamp < lastFundingTime + FUNDING_INTERVAL) {
            revert TooEarlyToSettle();
        }

        // 计算资金费率
        int256 newRate = _calculateFundingRate();
        currentFundingRate = newRate;

        // 更新累计费率
        cumulativeFundingRate += newRate;

        // 记录历史
        uint256 totalLong = positionManager.getTotalLongSize();
        uint256 totalShort = positionManager.getTotalShortSize();

        uint256 totalLongPaid = 0;
        uint256 totalShortPaid = 0;

        if (newRate > 0) {
            // 多头付给空头
            totalLongPaid = (totalLong * uint256(newRate)) / PRECISION;
        } else if (newRate < 0) {
            // 空头付给多头
            totalShortPaid = (totalShort * uint256(-newRate)) / PRECISION;
        }

        // M-006: 使用环形缓冲存储历史（O(1) 替代 O(n)）
        fundingHistory[fundingHistoryIndex] = FundingSnapshot({
            rate: newRate,
            timestamp: block.timestamp,
            totalLongPaid: totalLongPaid,
            totalShortPaid: totalShortPaid
        });
        fundingHistoryIndex = (fundingHistoryIndex + 1) % MAX_HISTORY;

        lastFundingTime = block.timestamp;

        emit FundingSettled(block.timestamp, newRate, totalLongPaid, totalShortPaid);
    }

    /**
     * @notice 结算单个用户的资金费
     * @dev 只允许 PositionManager 调用（平仓时自动结算）
     *      如果全局资金费率超过2个周期未结算，会先强制结算全局费率
     * @param user 用户地址
     * @return fundingFee 用户需要支付/收取的资金费（正数支付，负数收取）
     */
    function settleUserFunding(address user) external returns (int256 fundingFee) {
        // 只允许 PositionManager 调用（H-014 权限检查）
        require(msg.sender == address(positionManager), "Only PositionManager");

        IPositionManager.Position memory pos = positionManager.getPosition(user);
        if (pos.size == 0) return 0;

        // H-005: 强制结算检查 - 如果全局费率超过2个周期未结算，先结算全局
        if (block.timestamp >= lastFundingTime + FUNDING_INTERVAL * 2) {
            // 自动结算全局资金费率（最多结算一次以避免 gas 过高）
            _settleGlobalFunding();
        }

        int256 userIndex = userFundingIndex[user];
        if (userIndex == 0) {
            userFundingIndex[user] = cumulativeFundingRate;
            return 0;
        }

        // 计算用户应付/应收的资金费
        int256 rateDiff = cumulativeFundingRate - userIndex;

        if (pos.isLong) {
            // 多头：正费率支付，负费率收取
            fundingFee = (int256(pos.size) * rateDiff) / int256(PRECISION);
        } else {
            // 空头：正费率收取，负费率支付
            fundingFee = -(int256(pos.size) * rateDiff) / int256(PRECISION);
        }

        // 更新用户索引
        userFundingIndex[user] = cumulativeFundingRate;

        emit UserFundingSettled(user, fundingFee);
        return fundingFee;
    }

    /**
     * @notice 内部函数：结算全局资金费率
     * @dev 当 settleUserFunding 检测到超时时自动调用
     */
    function _settleGlobalFunding() internal {
        if (block.timestamp < lastFundingTime + FUNDING_INTERVAL) {
            return; // 还没到结算时间
        }

        // 计算资金费率
        int256 newRate = _calculateFundingRate();
        currentFundingRate = newRate;

        // 更新累计费率
        cumulativeFundingRate += newRate;

        // 记录历史
        uint256 totalLong = positionManager.getTotalLongSize();
        uint256 totalShort = positionManager.getTotalShortSize();

        uint256 totalLongPaid = 0;
        uint256 totalShortPaid = 0;

        if (newRate > 0) {
            totalLongPaid = (totalLong * uint256(newRate)) / PRECISION;
        } else if (newRate < 0) {
            totalShortPaid = (totalShort * uint256(-newRate)) / PRECISION;
        }

        // M-006: 使用环形缓冲存储历史（O(1) 替代 O(n)）
        fundingHistory[fundingHistoryIndex] = FundingSnapshot({
            rate: newRate,
            timestamp: block.timestamp,
            totalLongPaid: totalLongPaid,
            totalShortPaid: totalShortPaid
        });
        fundingHistoryIndex = (fundingHistoryIndex + 1) % MAX_HISTORY;

        lastFundingTime = block.timestamp;

        emit FundingSettled(block.timestamp, newRate, totalLongPaid, totalShortPaid);
    }

    // ============================================================
    // View Functions
    // ============================================================

    /**
     * @notice 获取当前资金费率
     * @return 资金费率（正数多付空，负数空付多）
     */
    function getCurrentFundingRate() external view returns (int256) {
        return currentFundingRate;
    }

    /**
     * @notice 获取预估资金费率（下次结算时）
     * @return 预估资金费率
     */
    function getEstimatedFundingRate() external view returns (int256) {
        return _calculateFundingRate();
    }

    /**
     * @notice 获取下次结算时间
     * @return 下次结算时间戳
     */
    function getNextFundingTime() external view returns (uint256) {
        return lastFundingTime + FUNDING_INTERVAL;
    }

    /**
     * @notice 获取用户待结算资金费
     * @param user 用户地址
     * @return 待结算资金费（正数支付，负数收取）
     */
    function getPendingFunding(address user) external view returns (int256) {
        IPositionManager.Position memory pos = positionManager.getPosition(user);
        if (pos.size == 0) return 0;

        int256 userIndex = userFundingIndex[user];
        if (userIndex == 0) return 0;

        int256 rateDiff = cumulativeFundingRate - userIndex;

        if (pos.isLong) {
            return (int256(pos.size) * rateDiff) / int256(PRECISION);
        } else {
            return -(int256(pos.size) * rateDiff) / int256(PRECISION);
        }
    }

    /**
     * @notice 获取资金费率历史
     * @param count 获取数量
     * @return rates 费率数组
     * @return timestamps 时间戳数组
     */
    function getFundingHistory(uint256 count)
        external
        view
        returns (int256[] memory rates, uint256[] memory timestamps)
    {
        // M-006: 适配环形缓冲的历史读取
        if (count > MAX_HISTORY) count = MAX_HISTORY;

        rates = new int256[](count);
        timestamps = new uint256[](count);

        for (uint256 i = 0; i < count; i++) {
            // 从最新的记录开始往前读取
            uint256 idx = (fundingHistoryIndex + MAX_HISTORY - 1 - i) % MAX_HISTORY;
            FundingSnapshot memory snapshot = fundingHistory[idx];
            // 跳过未初始化的记录
            if (snapshot.timestamp == 0) {
                break;
            }
            rates[i] = snapshot.rate;
            timestamps[i] = snapshot.timestamp;
        }

        return (rates, timestamps);
    }

    /**
     * @notice 年化资金费率
     * @return 年化费率
     */
    function getAnnualizedRate() external view returns (int256) {
        // 每年有 2190 个 4 小时周期 (365 * 24 / 4)
        return currentFundingRate * 2190;
    }

    /**
     * @notice 获取上次结算时间
     * @return 上次结算时间戳
     */
    function getLastFundingTime() external view returns (uint256) {
        return lastFundingTime;
    }

    /**
     * @notice 检查全局资金费率是否过期
     * @return overdue 是否过期（超过2个周期未结算）
     * @return periods 过期的周期数
     */
    function isFundingOverdue() external view returns (bool overdue, uint256 periods) {
        if (block.timestamp >= lastFundingTime + FUNDING_INTERVAL) {
            periods = (block.timestamp - lastFundingTime) / FUNDING_INTERVAL;
            overdue = periods >= 2;
        }
    }

    // ============================================================
    // Internal Functions
    // ============================================================

    /**
     * @notice 计算资金费率
     * @dev 资金费率 = (标记价格 - 现货价格) / 现货价格 * 系数
     *      同时考虑多空持仓量不平衡
     */
    function _calculateFundingRate() internal view returns (int256) {
        uint256 markPrice = priceFeed.getMarkPrice();
        uint256 spotPrice = priceFeed.getSpotPrice();

        if (spotPrice == 0) return 0;

        // 基础费率：基于价格偏差
        int256 priceDiff = int256(markPrice) - int256(spotPrice);
        int256 baseRate = (priceDiff * int256(PRECISION)) / int256(spotPrice);

        // 持仓量不平衡调整
        uint256 totalLong = positionManager.getTotalLongSize();
        uint256 totalShort = positionManager.getTotalShortSize();

        if (totalLong + totalShort == 0) {
            // 无持仓时，仅使用价格偏差
            return _clampRate(baseRate / 24); // 除以24得到4小时费率
        }

        // 不平衡系数
        int256 imbalance;
        if (totalLong > totalShort) {
            imbalance = int256((totalLong - totalShort) * PRECISION / (totalLong + totalShort));
        } else {
            imbalance = -int256((totalShort - totalLong) * PRECISION / (totalLong + totalShort));
        }

        // 综合费率 = 基础费率 * 0.5 + 不平衡费率 * 0.5
        int256 imbalanceRate = (imbalance * int256(MAX_FUNDING_RATE)) / int256(PRECISION);
        int256 combinedRate = (baseRate / 48 + imbalanceRate / 2); // 4小时费率

        return _clampRate(combinedRate);
    }

    function _clampRate(int256 rate) internal pure returns (int256) {
        if (rate > int256(MAX_FUNDING_RATE)) {
            return int256(MAX_FUNDING_RATE);
        }
        if (rate < -int256(MAX_FUNDING_RATE)) {
            return -int256(MAX_FUNDING_RATE);
        }
        return rate;
    }
}
