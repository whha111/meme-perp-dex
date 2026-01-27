// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/access/Ownable.sol";
import "../interfaces/IPriceFeed.sol";

/**
 * @title PriceFeed
 * @notice 价格聚合和 TWAP 计算合约
 * @dev 从 AMM 获取现货价格，计算 TWAP 用于清算和标记价格
 *      M-008: 显式实现 IPriceFeed 接口确保完整性
 *      S-001: 添加价格偏差检查和 max deviation 保护，防止价格操纵攻击
 */
contract PriceFeed is Ownable, IPriceFeed {
    // ============================================================
    // Constants
    // ============================================================

    uint256 public constant TWAP_PERIOD = 30 minutes; // TWAP 计算周期
    uint256 public constant MAX_PRICE_POINTS = 360; // 最多存储价格点数（6小时 @ 1分钟间隔）
    uint256 public constant PRICE_PRECISION = 1e18;

    // S-001: 价格偏差保护常量
    uint256 public constant DEFAULT_MAX_DEVIATION = 10e16; // 默认最大偏差 10%
    uint256 public constant ABSOLUTE_MAX_DEVIATION = 50e16; // 绝对最大偏差 50% (用于极端行情)
    uint256 public constant MIN_TWAP_DATA_POINTS = 3; // TWAP 计算最少需要的数据点

    // ============================================================
    // Structs
    // ============================================================

    struct PricePoint {
        uint256 price;
        uint256 timestamp;
    }

    // ============================================================
    // State Variables
    // ============================================================

    // AMM 合约地址
    address public amm;

    // TokenFactory 合约地址（用于自动添加代币）
    address public tokenFactory;

    // Legacy: 价格历史（环形缓冲）- 用于默认代币
    PricePoint[] public priceHistory;
    uint256 public priceIndex;

    // Legacy: 最新价格
    uint256 public lastPrice;
    uint256 public lastUpdateTime;

    // TWAP 权重（现货:TWAP = 7:3）
    uint256 public spotWeight = 70;
    uint256 public twapWeight = 30;

    // S-001: 价格偏差保护
    uint256 public maxPriceDeviation = DEFAULT_MAX_DEVIATION; // 当前最大允许偏差
    bool public deviationProtectionEnabled = true; // 是否启用偏差保护
    bool public strictMode = false; // 严格模式：偏差过大时 revert；非严格模式：使用 TWAP

    // S-001: 代币级别的偏差配置
    mapping(address => uint256) public tokenMaxDeviation; // 代币特定的最大偏差
    mapping(address => bool) public tokenDeviationProtectionEnabled; // 代币是否启用偏差保护

    // H-016: 多代币支持
    mapping(address => bool) public supportedTokens;
    mapping(address => PricePoint[]) internal tokenPriceHistory;
    mapping(address => uint256) public tokenPriceIndex;
    mapping(address => uint256) public tokenLastPrice;
    mapping(address => uint256) public tokenLastUpdateTime;
    address[] public tokenList;

    // ============================================================
    // Events
    // ============================================================

    event PriceUpdated(uint256 price, uint256 timestamp);
    event AMMSet(address indexed amm);
    event WeightsUpdated(uint256 spotWeight, uint256 twapWeight);
    event TokenPriceUpdated(address indexed token, uint256 price, uint256 timestamp);
    event TokenAdded(address indexed token);
    event TokenRemoved(address indexed token);
    event TokenFactorySet(address indexed tokenFactory);

    // S-001: 价格偏差保护事件
    event PriceDeviationDetected(uint256 spotPrice, uint256 twapPrice, uint256 deviation, uint256 maxAllowed);
    event TokenPriceDeviationDetected(address indexed token, uint256 spotPrice, uint256 twapPrice, uint256 deviation, uint256 maxAllowed);
    event MaxDeviationUpdated(uint256 oldDeviation, uint256 newDeviation);
    event TokenMaxDeviationUpdated(address indexed token, uint256 oldDeviation, uint256 newDeviation);
    event DeviationProtectionToggled(bool enabled);
    event TokenDeviationProtectionToggled(address indexed token, bool enabled);
    event StrictModeToggled(bool enabled);
    event PriceUpdateRejected(uint256 newPrice, uint256 lastPrice, uint256 deviation);
    event TokenPriceUpdateRejected(address indexed token, uint256 newPrice, uint256 lastPrice, uint256 deviation);

    // ============================================================
    // Errors
    // ============================================================

    error Unauthorized();
    error InvalidPrice();
    error ZeroAddress();
    error InvalidWeights();
    error TokenNotSupported();
    error TokenAlreadySupported();
    // S-001: 价格偏差保护错误
    error PriceDeviationTooHigh(uint256 deviation, uint256 maxAllowed);
    error InvalidDeviation();
    error PriceUpdateRejectedDueToDeviation(uint256 newPrice, uint256 lastPrice, uint256 deviation);

    // ============================================================
    // Modifiers
    // ============================================================

    modifier onlyAMM() {
        if (msg.sender != amm) revert Unauthorized();
        _;
    }

    modifier onlyTokenFactory() {
        if (msg.sender != tokenFactory) revert Unauthorized();
        _;
    }

    // ============================================================
    // Constructor
    // ============================================================

    constructor() Ownable(msg.sender) {
        // 初始化价格历史数组
        for (uint256 i = 0; i < MAX_PRICE_POINTS; i++) {
            priceHistory.push(PricePoint({price: 0, timestamp: 0}));
        }
    }

    // ============================================================
    // Admin Functions
    // ============================================================

    /**
     * @notice 设置 AMM 合约地址
     * @param _amm AMM 地址
     */
    function setAMM(address _amm) external onlyOwner {
        if (_amm == address(0)) revert ZeroAddress();
        amm = _amm;
        emit AMMSet(_amm);
    }

    /**
     * @notice 设置 TokenFactory 合约地址
     * @param _tokenFactory TokenFactory 地址
     */
    function setTokenFactory(address _tokenFactory) external onlyOwner {
        if (_tokenFactory == address(0)) revert ZeroAddress();
        tokenFactory = _tokenFactory;
        emit TokenFactorySet(_tokenFactory);
    }

    /**
     * @notice 设置价格权重
     * @param _spotWeight 现货权重
     * @param _twapWeight TWAP 权重
     */
    function setWeights(uint256 _spotWeight, uint256 _twapWeight) external onlyOwner {
        if (_spotWeight + _twapWeight != 100) revert InvalidWeights();
        spotWeight = _spotWeight;
        twapWeight = _twapWeight;
        emit WeightsUpdated(_spotWeight, _twapWeight);
    }

    /**
     * @notice 初始化价格（部署后由 owner 调用一次）
     * @param price 初始价格
     */
    function initializePrice(uint256 price) external onlyOwner {
        if (price == 0) revert InvalidPrice();
        _recordPrice(price);
    }

    // ============================================================
    // S-001: 价格偏差保护管理函数
    // ============================================================

    /**
     * @notice 设置全局最大价格偏差
     * @param _maxDeviation 最大偏差（PRICE_PRECISION 为基准，1e17 = 10%）
     */
    function setMaxPriceDeviation(uint256 _maxDeviation) external onlyOwner {
        if (_maxDeviation == 0 || _maxDeviation > ABSOLUTE_MAX_DEVIATION) revert InvalidDeviation();
        uint256 oldDeviation = maxPriceDeviation;
        maxPriceDeviation = _maxDeviation;
        emit MaxDeviationUpdated(oldDeviation, _maxDeviation);
    }

    /**
     * @notice 设置代币特定的最大价格偏差
     * @param token 代币地址
     * @param _maxDeviation 最大偏差
     */
    function setTokenMaxDeviation(address token, uint256 _maxDeviation) external onlyOwner {
        if (!supportedTokens[token]) revert TokenNotSupported();
        if (_maxDeviation == 0 || _maxDeviation > ABSOLUTE_MAX_DEVIATION) revert InvalidDeviation();
        uint256 oldDeviation = tokenMaxDeviation[token];
        tokenMaxDeviation[token] = _maxDeviation;
        emit TokenMaxDeviationUpdated(token, oldDeviation, _maxDeviation);
    }

    /**
     * @notice 启用/禁用全局偏差保护
     * @param enabled 是否启用
     */
    function setDeviationProtection(bool enabled) external onlyOwner {
        deviationProtectionEnabled = enabled;
        emit DeviationProtectionToggled(enabled);
    }

    /**
     * @notice 启用/禁用代币特定的偏差保护
     * @param token 代币地址
     * @param enabled 是否启用
     */
    function setTokenDeviationProtection(address token, bool enabled) external onlyOwner {
        if (!supportedTokens[token]) revert TokenNotSupported();
        tokenDeviationProtectionEnabled[token] = enabled;
        emit TokenDeviationProtectionToggled(token, enabled);
    }

    /**
     * @notice 设置严格模式
     * @dev 严格模式下，偏差过大会 revert；非严格模式下，使用 TWAP 作为安全价格
     * @param enabled 是否启用严格模式
     */
    function setStrictMode(bool enabled) external onlyOwner {
        strictMode = enabled;
        emit StrictModeToggled(enabled);
    }

    /**
     * @notice H-016: 添加支持的代币
     * @param token 代币地址
     * @param initialPrice 初始价格
     */
    function addSupportedToken(address token, uint256 initialPrice) external onlyOwner {
        if (token == address(0)) revert ZeroAddress();
        if (supportedTokens[token]) revert TokenAlreadySupported();
        if (initialPrice == 0) revert InvalidPrice();

        supportedTokens[token] = true;
        tokenList.push(token);

        // 初始化代币价格历史
        for (uint256 i = 0; i < MAX_PRICE_POINTS; i++) {
            tokenPriceHistory[token].push(PricePoint({price: 0, timestamp: 0}));
        }

        // 记录初始价格
        _recordTokenPrice(token, initialPrice);

        emit TokenAdded(token);
    }

    /**
     * @notice TokenFactory 自动添加代币支持（用于永续合约自动开启）
     * @param token 代币地址
     * @param initialPrice 初始价格
     */
    function addSupportedTokenFromFactory(address token, uint256 initialPrice) external onlyTokenFactory {
        if (token == address(0)) revert ZeroAddress();
        if (supportedTokens[token]) return; // 已支持则跳过，不 revert
        if (initialPrice == 0) revert InvalidPrice();

        supportedTokens[token] = true;
        tokenList.push(token);

        // 初始化代币价格历史
        for (uint256 i = 0; i < MAX_PRICE_POINTS; i++) {
            tokenPriceHistory[token].push(PricePoint({price: 0, timestamp: 0}));
        }

        // 记录初始价格
        _recordTokenPrice(token, initialPrice);

        emit TokenAdded(token);
    }

    /**
     * @notice H-016: 移除支持的代币
     * @param token 代币地址
     */
    function removeSupportedToken(address token) external onlyOwner {
        if (!supportedTokens[token]) revert TokenNotSupported();

        supportedTokens[token] = false;

        // 从列表中移除
        for (uint256 i = 0; i < tokenList.length; i++) {
            if (tokenList[i] == token) {
                tokenList[i] = tokenList[tokenList.length - 1];
                tokenList.pop();
                break;
            }
        }

        emit TokenRemoved(token);
    }

    // ============================================================
    // AMM Functions
    // ============================================================

    /**
     * @notice 更新价格（由 AMM 在每次交易后调用）
     * @param newPrice 新价格
     */
    function updatePrice(uint256 newPrice) external onlyAMM {
        if (newPrice == 0) revert InvalidPrice();
        _recordPrice(newPrice);
    }

    /**
     * @notice H-016: 更新代币价格（由 AMM 在每次交易后调用）
     * @param token 代币地址
     * @param newPrice 新价格
     */
    function updateTokenPrice(address token, uint256 newPrice) external onlyAMM {
        if (!supportedTokens[token]) revert TokenNotSupported();
        if (newPrice == 0) revert InvalidPrice();
        _recordTokenPrice(token, newPrice);
    }

    /**
     * @notice 由 TokenFactory 在每次交易后调用更新价格
     * @dev 只有已支持的代币才会更新，未支持的代币静默跳过
     * @param token 代币地址
     * @param newPrice 新价格
     */
    function updateTokenPriceFromFactory(address token, uint256 newPrice) external onlyTokenFactory {
        // 如果代币未支持永续合约，静默跳过（不 revert，避免阻塞现货交易）
        if (!supportedTokens[token]) return;
        if (newPrice == 0) return;
        _recordTokenPrice(token, newPrice);
    }

    // ============================================================
    // Internal Functions
    // ============================================================

    /**
     * @notice S-001: 记录价格（带偏差检查）
     * @dev 如果新价格与上一个价格偏差过大，根据设置决定是否拒绝
     */
    function _recordPrice(uint256 price) internal {
        // S-001: 检查价格更新偏差（防止单笔交易大幅操纵价格）
        if (lastPrice > 0 && deviationProtectionEnabled) {
            uint256 deviation = _calculateDeviation(price, lastPrice);
            uint256 maxAllowed = maxPriceDeviation;

            if (deviation > maxAllowed) {
                emit PriceUpdateRejected(price, lastPrice, deviation);
                if (strictMode) {
                    revert PriceUpdateRejectedDueToDeviation(price, lastPrice, deviation);
                }
                // 非严格模式：使用受限的价格更新（最多移动 maxDeviation）
                price = _getLimitedPrice(lastPrice, price, maxAllowed);
            }
        }

        // 更新环形缓冲
        priceHistory[priceIndex] = PricePoint({price: price, timestamp: block.timestamp});
        priceIndex = (priceIndex + 1) % MAX_PRICE_POINTS;

        lastPrice = price;
        lastUpdateTime = block.timestamp;

        emit PriceUpdated(price, block.timestamp);
    }

    /**
     * @notice H-016 + S-001: 记录代币价格（带偏差检查）
     */
    function _recordTokenPrice(address token, uint256 price) internal {
        uint256 currentPrice = tokenLastPrice[token];

        // S-001: 检查价格更新偏差
        bool protectionEnabled = tokenDeviationProtectionEnabled[token] || deviationProtectionEnabled;
        if (currentPrice > 0 && protectionEnabled) {
            uint256 deviation = _calculateDeviation(price, currentPrice);
            uint256 maxAllowed = tokenMaxDeviation[token] > 0 ? tokenMaxDeviation[token] : maxPriceDeviation;

            if (deviation > maxAllowed) {
                emit TokenPriceUpdateRejected(token, price, currentPrice, deviation);
                if (strictMode) {
                    revert PriceUpdateRejectedDueToDeviation(price, currentPrice, deviation);
                }
                // 非严格模式：使用受限的价格更新
                price = _getLimitedPrice(currentPrice, price, maxAllowed);
            }
        }

        uint256 idx = tokenPriceIndex[token];
        tokenPriceHistory[token][idx] = PricePoint({price: price, timestamp: block.timestamp});
        tokenPriceIndex[token] = (idx + 1) % MAX_PRICE_POINTS;

        tokenLastPrice[token] = price;
        tokenLastUpdateTime[token] = block.timestamp;

        emit TokenPriceUpdated(token, price, block.timestamp);
    }

    /**
     * @notice S-001: 计算两个价格之间的偏差
     * @param priceA 价格 A
     * @param priceB 价格 B
     * @return 偏差（以 PRICE_PRECISION 为基准）
     */
    function _calculateDeviation(uint256 priceA, uint256 priceB) internal pure returns (uint256) {
        if (priceA == 0 || priceB == 0) return 0;
        uint256 diff = priceA > priceB ? priceA - priceB : priceB - priceA;
        return (diff * PRICE_PRECISION) / priceB;
    }

    /**
     * @notice S-001: 获取受限的价格（最多移动 maxDeviation）
     * @param currentPrice 当前价格
     * @param targetPrice 目标价格
     * @param maxAllowedDeviation 最大允许偏差
     * @return 受限后的价格
     */
    function _getLimitedPrice(
        uint256 currentPrice,
        uint256 targetPrice,
        uint256 maxAllowedDeviation
    ) internal pure returns (uint256) {
        uint256 maxMove = (currentPrice * maxAllowedDeviation) / PRICE_PRECISION;

        if (targetPrice > currentPrice) {
            // 价格上涨：最多涨 maxMove
            uint256 maxPrice = currentPrice + maxMove;
            return targetPrice > maxPrice ? maxPrice : targetPrice;
        } else {
            // 价格下跌：最多跌 maxMove
            uint256 minPrice = currentPrice > maxMove ? currentPrice - maxMove : 1;
            return targetPrice < minPrice ? minPrice : targetPrice;
        }
    }

    // ============================================================
    // View Functions
    // ============================================================

    /**
     * @notice 获取当前现货价格
     * @return 现货价格
     */
    function getSpotPrice() external view returns (uint256) {
        return lastPrice;
    }

    /**
     * @notice 获取 TWAP 价格
     * @return TWAP 价格
     */
    function getTWAP() public view returns (uint256) {
        uint256 cumulativePrice = 0;
        uint256 cumulativeTime = 0;
        uint256 cutoffTime = block.timestamp - TWAP_PERIOD;

        // 遍历价格历史计算时间加权平均
        for (uint256 i = 0; i < MAX_PRICE_POINTS; i++) {
            uint256 idx = (priceIndex + MAX_PRICE_POINTS - 1 - i) % MAX_PRICE_POINTS;
            PricePoint memory point = priceHistory[idx];

            if (point.timestamp == 0 || point.timestamp < cutoffTime) {
                break;
            }

            // 计算下一个点的时间
            uint256 nextIdx = (idx + MAX_PRICE_POINTS - 1) % MAX_PRICE_POINTS;
            PricePoint memory nextPoint = priceHistory[nextIdx];

            uint256 timeWeight;
            if (nextPoint.timestamp == 0 || nextPoint.timestamp < cutoffTime) {
                timeWeight = point.timestamp - cutoffTime;
            } else {
                timeWeight = point.timestamp - nextPoint.timestamp;
            }

            cumulativePrice += point.price * timeWeight;
            cumulativeTime += timeWeight;
        }

        // 如果没有足够的历史数据，返回当前价格
        if (cumulativeTime == 0) {
            return lastPrice;
        }

        return cumulativePrice / cumulativeTime;
    }

    /**
     * @notice 获取标记价格（现货和 TWAP 的加权平均）
     * @dev S-001: 添加偏差检查，如果偏差过大则使用安全价格
     *      注意：偏差检测事件在价格更新时发出，view 函数不发事件
     * @return 标记价格
     */
    function getMarkPrice() external view returns (uint256) {
        uint256 twap = getTWAP();
        uint256 spot = lastPrice;

        // S-001: 偏差保护检查
        if (deviationProtectionEnabled && spot > 0 && twap > 0) {
            uint256 deviation = _calculateDeviation(spot, twap);

            if (deviation > maxPriceDeviation) {
                // 严格模式下 revert
                if (strictMode) {
                    revert PriceDeviationTooHigh(deviation, maxPriceDeviation);
                }

                // 非严格模式：使用更保守的价格（偏向 TWAP）
                // 增加 TWAP 权重以减少操纵影响
                return _getSafeMarkPrice(spot, twap, deviation);
            }
        }

        return (spot * spotWeight + twap * twapWeight) / 100;
    }

    /**
     * @notice S-001: 获取安全的标记价格（当偏差过大时）
     * @dev 根据偏差程度动态调整权重，偏差越大 TWAP 权重越高
     */
    function _getSafeMarkPrice(uint256 spot, uint256 twap, uint256 deviation) internal view returns (uint256) {
        // 偏差超过阈值时，线性增加 TWAP 权重
        // 偏差 = maxDeviation 时，使用正常权重
        // 偏差 = 2 * maxDeviation 时，100% 使用 TWAP
        uint256 excessDeviation = deviation - maxPriceDeviation;
        uint256 twapBoost = (excessDeviation * 100) / maxPriceDeviation;

        if (twapBoost >= 100) {
            // 偏差过大，完全使用 TWAP
            return twap;
        }

        // 动态权重：增加 TWAP 权重
        uint256 adjustedTwapWeight = twapWeight + ((100 - twapWeight) * twapBoost) / 100;
        uint256 adjustedSpotWeight = 100 - adjustedTwapWeight;

        return (spot * adjustedSpotWeight + twap * adjustedTwapWeight) / 100;
    }

    /**
     * @notice 获取最近的价格历史
     * @param count 获取数量
     * @return prices 价格数组
     * @return timestamps 时间戳数组
     */
    function getPriceHistory(uint256 count)
        external
        view
        returns (uint256[] memory prices, uint256[] memory timestamps)
    {
        if (count > MAX_PRICE_POINTS) {
            count = MAX_PRICE_POINTS;
        }

        prices = new uint256[](count);
        timestamps = new uint256[](count);

        for (uint256 i = 0; i < count; i++) {
            uint256 idx = (priceIndex + MAX_PRICE_POINTS - 1 - i) % MAX_PRICE_POINTS;
            prices[i] = priceHistory[idx].price;
            timestamps[i] = priceHistory[idx].timestamp;
        }

        return (prices, timestamps);
    }

    /**
     * @notice 获取上次更新时间
     * @return 上次更新时间戳
     */
    function getLastUpdateTime() external view returns (uint256) {
        return lastUpdateTime;
    }

    // ============================================================
    // H-016: Multi-token View Functions
    // ============================================================

    /**
     * @notice 检查代币是否支持
     */
    function isTokenSupported(address token) external view returns (bool) {
        return supportedTokens[token];
    }

    /**
     * @notice 获取代币现货价格
     */
    function getTokenSpotPrice(address token) external view returns (uint256) {
        if (!supportedTokens[token]) revert TokenNotSupported();
        return tokenLastPrice[token];
    }

    /**
     * @notice 获取代币 TWAP 价格
     */
    function getTokenTWAP(address token) public view returns (uint256) {
        if (!supportedTokens[token]) revert TokenNotSupported();

        uint256 cumulativePrice = 0;
        uint256 cumulativeTime = 0;
        uint256 cutoffTime = block.timestamp - TWAP_PERIOD;
        uint256 currentIndex = tokenPriceIndex[token];

        for (uint256 i = 0; i < MAX_PRICE_POINTS; i++) {
            uint256 idx = (currentIndex + MAX_PRICE_POINTS - 1 - i) % MAX_PRICE_POINTS;
            PricePoint memory point = tokenPriceHistory[token][idx];

            if (point.timestamp == 0 || point.timestamp < cutoffTime) {
                break;
            }

            uint256 nextIdx = (idx + MAX_PRICE_POINTS - 1) % MAX_PRICE_POINTS;
            PricePoint memory nextPoint = tokenPriceHistory[token][nextIdx];

            uint256 timeWeight;
            if (nextPoint.timestamp == 0 || nextPoint.timestamp < cutoffTime) {
                timeWeight = point.timestamp - cutoffTime;
            } else {
                timeWeight = point.timestamp - nextPoint.timestamp;
            }

            cumulativePrice += point.price * timeWeight;
            cumulativeTime += timeWeight;
        }

        if (cumulativeTime == 0) {
            return tokenLastPrice[token];
        }

        return cumulativePrice / cumulativeTime;
    }

    /**
     * @notice 获取代币标记价格
     * @dev S-001: 添加偏差检查，如果偏差过大则使用安全价格
     *      注意：偏差检测事件在价格更新时发出，view 函数不发事件
     */
    function getTokenMarkPrice(address token) external view returns (uint256) {
        if (!supportedTokens[token]) revert TokenNotSupported();

        uint256 twap = getTokenTWAP(token);
        uint256 spot = tokenLastPrice[token];

        // S-001: 偏差保护检查
        bool protectionEnabled = tokenDeviationProtectionEnabled[token] || deviationProtectionEnabled;
        uint256 maxAllowed = tokenMaxDeviation[token] > 0 ? tokenMaxDeviation[token] : maxPriceDeviation;

        if (protectionEnabled && spot > 0 && twap > 0) {
            uint256 deviation = _calculateDeviation(spot, twap);

            if (deviation > maxAllowed) {
                // 严格模式下 revert
                if (strictMode) {
                    revert PriceDeviationTooHigh(deviation, maxAllowed);
                }

                // 非严格模式：使用更保守的价格
                return _getSafeTokenMarkPrice(spot, twap, deviation, maxAllowed);
            }
        }

        return (spot * spotWeight + twap * twapWeight) / 100;
    }

    /**
     * @notice S-001: 获取代币安全的标记价格（当偏差过大时）
     */
    function _getSafeTokenMarkPrice(
        uint256 spot,
        uint256 twap,
        uint256 deviation,
        uint256 maxAllowed
    ) internal view returns (uint256) {
        uint256 excessDeviation = deviation - maxAllowed;
        uint256 twapBoost = (excessDeviation * 100) / maxAllowed;

        if (twapBoost >= 100) {
            return twap;
        }

        uint256 adjustedTwapWeight = twapWeight + ((100 - twapWeight) * twapBoost) / 100;
        uint256 adjustedSpotWeight = 100 - adjustedTwapWeight;

        return (spot * adjustedSpotWeight + twap * adjustedTwapWeight) / 100;
    }

    /**
     * @notice 获取所有支持的代币列表
     */
    function getSupportedTokens() external view returns (address[] memory) {
        return tokenList;
    }

    // ============================================================
    // S-001: 价格偏差检查 View Functions
    // ============================================================

    /**
     * @notice 获取当前现货与 TWAP 的偏差
     * @return deviation 偏差（PRICE_PRECISION 为基准）
     * @return isHealthy 是否在健康范围内
     */
    function getPriceDeviation() external view returns (uint256 deviation, bool isHealthy) {
        uint256 twap = getTWAP();
        if (lastPrice == 0 || twap == 0) {
            return (0, true);
        }
        deviation = _calculateDeviation(lastPrice, twap);
        isHealthy = deviation <= maxPriceDeviation;
    }

    /**
     * @notice 获取代币当前现货与 TWAP 的偏差
     * @param token 代币地址
     * @return deviation 偏差
     * @return isHealthy 是否在健康范围内
     */
    function getTokenPriceDeviation(address token) external view returns (uint256 deviation, bool isHealthy) {
        if (!supportedTokens[token]) revert TokenNotSupported();

        uint256 spot = tokenLastPrice[token];
        uint256 twap = getTokenTWAP(token);

        if (spot == 0 || twap == 0) {
            return (0, true);
        }

        deviation = _calculateDeviation(spot, twap);
        uint256 maxAllowed = tokenMaxDeviation[token] > 0 ? tokenMaxDeviation[token] : maxPriceDeviation;
        isHealthy = deviation <= maxAllowed;
    }

    /**
     * @notice 获取价格健康状态详情
     * @return spot 现货价格
     * @return twap TWAP 价格
     * @return mark 标记价格
     * @return deviation 偏差
     * @return maxAllowed 最大允许偏差
     * @return isHealthy 是否健康
     */
    function getPriceHealthStatus()
        external
        view
        returns (
            uint256 spot,
            uint256 twap,
            uint256 mark,
            uint256 deviation,
            uint256 maxAllowed,
            bool isHealthy
        )
    {
        spot = lastPrice;
        twap = getTWAP();
        maxAllowed = maxPriceDeviation;

        if (spot > 0 && twap > 0) {
            deviation = _calculateDeviation(spot, twap);
            isHealthy = deviation <= maxAllowed;

            // 计算 mark price（考虑偏差保护）
            if (deviationProtectionEnabled && deviation > maxAllowed) {
                mark = _getSafeMarkPrice(spot, twap, deviation);
            } else {
                mark = (spot * spotWeight + twap * twapWeight) / 100;
            }
        } else {
            deviation = 0;
            isHealthy = true;
            mark = spot > 0 ? spot : twap;
        }
    }

    /**
     * @notice 获取代币价格健康状态详情
     * @param token 代币地址
     */
    function getTokenPriceHealthStatus(address token)
        external
        view
        returns (
            uint256 spot,
            uint256 twap,
            uint256 mark,
            uint256 deviation,
            uint256 maxAllowed,
            bool isHealthy
        )
    {
        if (!supportedTokens[token]) revert TokenNotSupported();

        spot = tokenLastPrice[token];
        twap = getTokenTWAP(token);
        maxAllowed = tokenMaxDeviation[token] > 0 ? tokenMaxDeviation[token] : maxPriceDeviation;

        if (spot > 0 && twap > 0) {
            deviation = _calculateDeviation(spot, twap);
            isHealthy = deviation <= maxAllowed;

            bool protectionEnabled = tokenDeviationProtectionEnabled[token] || deviationProtectionEnabled;
            if (protectionEnabled && deviation > maxAllowed) {
                mark = _getSafeTokenMarkPrice(spot, twap, deviation, maxAllowed);
            } else {
                mark = (spot * spotWeight + twap * twapWeight) / 100;
            }
        } else {
            deviation = 0;
            isHealthy = true;
            mark = spot > 0 ? spot : twap;
        }
    }

    /**
     * @notice 检查价格更新是否会被拒绝
     * @param newPrice 新价格
     * @return wouldReject 是否会被拒绝
     * @return deviation 偏差
     * @return limitedPrice 如果非严格模式，实际会使用的价格
     */
    function checkPriceUpdate(uint256 newPrice)
        external
        view
        returns (bool wouldReject, uint256 deviation, uint256 limitedPrice)
    {
        if (lastPrice == 0 || !deviationProtectionEnabled) {
            return (false, 0, newPrice);
        }

        deviation = _calculateDeviation(newPrice, lastPrice);

        if (deviation > maxPriceDeviation) {
            wouldReject = strictMode;
            limitedPrice = _getLimitedPrice(lastPrice, newPrice, maxPriceDeviation);
        } else {
            wouldReject = false;
            limitedPrice = newPrice;
        }
    }

    /**
     * @notice 检查代币价格更新是否会被拒绝
     * @param token 代币地址
     * @param newPrice 新价格
     */
    function checkTokenPriceUpdate(address token, uint256 newPrice)
        external
        view
        returns (bool wouldReject, uint256 deviation, uint256 limitedPrice)
    {
        if (!supportedTokens[token]) revert TokenNotSupported();

        uint256 currentPrice = tokenLastPrice[token];
        bool protectionEnabled = tokenDeviationProtectionEnabled[token] || deviationProtectionEnabled;

        if (currentPrice == 0 || !protectionEnabled) {
            return (false, 0, newPrice);
        }

        deviation = _calculateDeviation(newPrice, currentPrice);
        uint256 maxAllowed = tokenMaxDeviation[token] > 0 ? tokenMaxDeviation[token] : maxPriceDeviation;

        if (deviation > maxAllowed) {
            wouldReject = strictMode;
            limitedPrice = _getLimitedPrice(currentPrice, newPrice, maxAllowed);
        } else {
            wouldReject = false;
            limitedPrice = newPrice;
        }
    }

    /**
     * @notice 获取偏差保护配置
     */
    function getDeviationConfig()
        external
        view
        returns (
            uint256 currentMaxDeviation,
            bool protectionEnabled,
            bool isStrictMode,
            uint256 defaultMax,
            uint256 absoluteMax
        )
    {
        return (
            maxPriceDeviation,
            deviationProtectionEnabled,
            strictMode,
            DEFAULT_MAX_DEVIATION,
            ABSOLUTE_MAX_DEVIATION
        );
    }

    /**
     * @notice 获取代币偏差保护配置
     * @param token 代币地址
     */
    function getTokenDeviationConfig(address token)
        external
        view
        returns (
            uint256 currentMaxDeviation,
            bool protectionEnabled,
            bool usesGlobalConfig
        )
    {
        if (!supportedTokens[token]) revert TokenNotSupported();

        uint256 tokenSpecificMax = tokenMaxDeviation[token];
        currentMaxDeviation = tokenSpecificMax > 0 ? tokenSpecificMax : maxPriceDeviation;
        protectionEnabled = tokenDeviationProtectionEnabled[token] || deviationProtectionEnabled;
        usesGlobalConfig = tokenSpecificMax == 0;
    }
}
