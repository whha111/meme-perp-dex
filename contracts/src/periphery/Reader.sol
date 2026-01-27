// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "../interfaces/IPositionManager.sol";
import "../interfaces/IPriceFeed.sol";
import "../interfaces/IVault.sol";

/**
 * @title Reader
 * @notice C-06: 批量读取合约，用于优化前端数据获取
 * @dev 提供批量读取功能，减少 RPC 调用次数
 */
contract Reader {
    // ============================================================
    // State Variables
    // ============================================================

    IPositionManager public positionManager;
    IPriceFeed public priceFeed;
    IVault public vault;

    // ============================================================
    // Structs for batch returns
    // ============================================================

    struct PositionInfo {
        address user;
        address token;
        bool isLong;
        uint256 size;
        uint256 collateral;
        uint256 entryPrice;
        uint256 leverage;
        int256 unrealizedPnL;
        uint256 liquidationPrice;
        uint256 marginRatio;
    }

    struct TokenInfo {
        address token;
        uint256 markPrice;
        uint256 totalLongSize;
        uint256 totalShortSize;
    }

    struct UserBalanceInfo {
        address user;
        uint256 vaultBalance;
        uint256 lockedBalance;
        uint256 availableBalance;
    }

    // ============================================================
    // Constructor
    // ============================================================

    constructor(address _positionManager, address _priceFeed, address _vault) {
        positionManager = IPositionManager(_positionManager);
        priceFeed = IPriceFeed(_priceFeed);
        vault = IVault(_vault);
    }

    // ============================================================
    // Batch Read Functions
    // ============================================================

    /**
     * @notice 批量获取多个用户在指定代币上的仓位信息
     * @param users 用户地址数组
     * @param token 代币地址
     * @return positions 仓位信息数组
     */
    function getPositionsBatch(address[] calldata users, address token)
        external
        view
        returns (PositionInfo[] memory positions)
    {
        positions = new PositionInfo[](users.length);

        for (uint256 i = 0; i < users.length; i++) {
            positions[i] = _getPositionInfo(users[i], token);
        }

        return positions;
    }

    /**
     * @notice 获取单个用户在多个代币上的仓位信息
     * @param user 用户地址
     * @param tokens 代币地址数组
     * @return positions 仓位信息数组
     */
    function getUserPositionsBatch(address user, address[] calldata tokens)
        external
        view
        returns (PositionInfo[] memory positions)
    {
        positions = new PositionInfo[](tokens.length);

        for (uint256 i = 0; i < tokens.length; i++) {
            positions[i] = _getPositionInfo(user, tokens[i]);
        }

        return positions;
    }

    /**
     * @notice 批量获取多个代币的信息
     * @param tokens 代币地址数组
     * @return infos 代币信息数组
     */
    function getTokenInfoBatch(address[] calldata tokens)
        external
        view
        returns (TokenInfo[] memory infos)
    {
        infos = new TokenInfo[](tokens.length);

        for (uint256 i = 0; i < tokens.length; i++) {
            infos[i] = TokenInfo({
                token: tokens[i],
                markPrice: priceFeed.getTokenMarkPrice(tokens[i]),
                totalLongSize: positionManager.getTokenTotalLongSize(tokens[i]),
                totalShortSize: positionManager.getTokenTotalShortSize(tokens[i])
            });
        }

        return infos;
    }

    /**
     * @notice 批量获取多个用户的 Vault 余额信息
     * @param users 用户地址数组
     * @return balances 余额信息数组
     */
    function getUserBalancesBatch(address[] calldata users)
        external
        view
        returns (UserBalanceInfo[] memory balances)
    {
        balances = new UserBalanceInfo[](users.length);

        for (uint256 i = 0; i < users.length; i++) {
            uint256 vaultBal = vault.getBalance(users[i]);
            uint256 lockedBal = vault.getLockedBalance(users[i]);

            balances[i] = UserBalanceInfo({
                user: users[i],
                vaultBalance: vaultBal,
                lockedBalance: lockedBal,
                availableBalance: vaultBal > lockedBal ? vaultBal - lockedBal : 0
            });
        }

        return balances;
    }

    /**
     * @notice 获取完整的用户仪表板数据
     * @param user 用户地址
     * @param tokens 关注的代币列表
     * @return vaultBalance 金库余额
     * @return lockedBalance 锁定余额
     * @return positions 仓位数组
     * @return tokenInfos 代币信息数组
     */
    function getUserDashboard(address user, address[] calldata tokens)
        external
        view
        returns (
            uint256 vaultBalance,
            uint256 lockedBalance,
            PositionInfo[] memory positions,
            TokenInfo[] memory tokenInfos
        )
    {
        vaultBalance = vault.getBalance(user);
        lockedBalance = vault.getLockedBalance(user);

        positions = new PositionInfo[](tokens.length);
        tokenInfos = new TokenInfo[](tokens.length);

        for (uint256 i = 0; i < tokens.length; i++) {
            positions[i] = _getPositionInfo(user, tokens[i]);
            tokenInfos[i] = TokenInfo({
                token: tokens[i],
                markPrice: priceFeed.getTokenMarkPrice(tokens[i]),
                totalLongSize: positionManager.getTokenTotalLongSize(tokens[i]),
                totalShortSize: positionManager.getTokenTotalShortSize(tokens[i])
            });
        }

        return (vaultBalance, lockedBalance, positions, tokenInfos);
    }

    /**
     * @notice 批量检查哪些用户可以被清算
     * @param users 用户地址数组
     * @param token 代币地址
     * @return liquidatable 可清算状态数组
     * @return pnls 未实现盈亏数组
     */
    function checkLiquidatableBatch(address[] calldata users, address token)
        external
        view
        returns (bool[] memory liquidatable, int256[] memory pnls)
    {
        liquidatable = new bool[](users.length);
        pnls = new int256[](users.length);

        for (uint256 i = 0; i < users.length; i++) {
            liquidatable[i] = positionManager.canLiquidateToken(users[i], token);
            pnls[i] = positionManager.getTokenUnrealizedPnL(users[i], token);
        }

        return (liquidatable, pnls);
    }

    /**
     * @notice 获取所有代币的市场概览
     * @param tokens 代币地址数组
     * @return markPrices 标记价格数组
     * @return totalLongs 总多头头寸数组
     * @return totalShorts 总空头头寸数组
     */
    function getMarketOverview(address[] calldata tokens)
        external
        view
        returns (
            uint256[] memory markPrices,
            uint256[] memory totalLongs,
            uint256[] memory totalShorts
        )
    {
        markPrices = new uint256[](tokens.length);
        totalLongs = new uint256[](tokens.length);
        totalShorts = new uint256[](tokens.length);

        for (uint256 i = 0; i < tokens.length; i++) {
            markPrices[i] = priceFeed.getTokenMarkPrice(tokens[i]);
            totalLongs[i] = positionManager.getTokenTotalLongSize(tokens[i]);
            totalShorts[i] = positionManager.getTokenTotalShortSize(tokens[i]);
        }

        return (markPrices, totalLongs, totalShorts);
    }

    // ============================================================
    // Internal Functions
    // ============================================================

    function _getPositionInfo(address user, address token)
        internal
        view
        returns (PositionInfo memory info)
    {
        IPositionManager.PositionEx memory pos = positionManager.getPositionByToken(user, token);

        if (pos.size == 0) {
            return PositionInfo({
                user: user,
                token: token,
                isLong: false,
                size: 0,
                collateral: 0,
                entryPrice: 0,
                leverage: 0,
                unrealizedPnL: 0,
                liquidationPrice: 0,
                marginRatio: type(uint256).max
            });
        }

        int256 pnl = positionManager.getTokenUnrealizedPnL(user, token);
        uint256 liqPrice = positionManager.getTokenLiquidationPrice(user, token);
        uint256 marginRatio = positionManager.getTokenMarginRatio(user, token);

        return PositionInfo({
            user: user,
            token: token,
            isLong: pos.isLong,
            size: pos.size,
            collateral: pos.collateral,
            entryPrice: pos.entryPrice,
            leverage: pos.leverage,
            unrealizedPnL: pnl,
            liquidationPrice: liqPrice,
            marginRatio: marginRatio
        });
    }
}
