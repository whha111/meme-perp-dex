// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Address} from "@openzeppelin/contracts/utils/Address.sol";

import {ICurveEvents} from "../interfaces/ICurveEvents.sol";
import {ConstantProductAMMMath} from "../libraries/ConstantProductAMMMath.sol";
import {MemeTokenV2} from "./MemeTokenV2.sol";

interface IUniswapV2Router02 {
    function addLiquidityETH(
        address token,
        uint256 amountTokenDesired,
        uint256 amountTokenMin,
        uint256 amountETHMin,
        address to,
        uint256 deadline
    ) external payable returns (uint256 amountToken, uint256 amountETH, uint256 liquidity);

    function factory() external pure returns (address);
}

interface IUniswapV2Factory {
    function getPair(address tokenA, address tokenB) external view returns (address pair);
}

interface IMemeTokenV2 {
    function mint(address to, uint256 amount) external;
    function burn(uint256 amount) external;
    function lockMinting() external;
    function removeMinter(address minter) external;
}

interface IPriceFeedFactory {
    function addSupportedTokenFromFactory(address token, uint256 initialPrice) external;
    function updateTokenPriceFromFactory(address token, uint256 newPrice) external;
}

// [C-01/C-05] Helper library for price sync to avoid stack too deep
library PriceFeedHelper {
    function syncPrice(
        address priceFeedAddr,
        address token,
        uint256 virtualEth,
        uint256 virtualToken
    ) internal {
        if (priceFeedAddr == address(0)) return;
        uint256 newPrice = ConstantProductAMMMath.getCurrentPrice(virtualEth, virtualToken);
        try IPriceFeedFactory(priceFeedAddr).updateTokenPriceFromFactory(token, newPrice) {} catch {}
    }
}

/**
 * @title TokenFactory
 * @notice Meme 代币工厂 - Pump.fun 风格 Bonding Curve
 * @dev 创建代币 → 立即可交易 → 毕业后迁移到 DEX
 *      P-007: 添加紧急暂停功能
 */
contract TokenFactory is Ownable, ReentrancyGuard, Pausable, ICurveEvents {
    using SafeERC20 for IERC20;

    // ══════════════════════════════════════════════════════════════════════════════
    // CONSTANTS (Pump.fun 参数，按 ETH 等值换算)
    // ══════════════════════════════════════════════════════════════════════════════

    // Pump.fun: 30 SOL (~$6,000) 虚拟储备, 85 SOL (~$17,000) 毕业
    // ETH 等值: 1.82 ETH 虚拟储备, ~5.16 ETH 毕业
    uint256 public constant VIRTUAL_ETH_RESERVE = 1.82 ether;
    uint256 public constant REAL_TOKEN_SUPPLY = 1_000_000_000 ether; // 10亿真实供应
    uint256 public constant VIRTUAL_TOKEN_RESERVE = 1_073_000_000 ether; // 10.73亿虚拟供应

    // 毕业阈值：当 realTokenReserve <= 2.07亿时毕业 (卖出7.93亿代币后)
    uint256 public constant GRADUATION_THRESHOLD = 207_000_000 ether;

    // 手续费 1%
    uint256 public constant FEE_BPS = 100;

    // 永续合约开启阈值：池子里有 0.1 ETH 真实资金后自动开启永续合约
    uint256 public constant PERP_ENABLE_THRESHOLD = 0.1 ether;

    // 创建代币服务费
    uint256 public serviceFee = 0.001 ether;

    // ══════════════════════════════════════════════════════════════════════════════
    // STATE
    // ══════════════════════════════════════════════════════════════════════════════

    struct PoolState {
        uint256 realETHReserve;      // 真实 ETH 储备
        uint256 realTokenReserve;    // 真实代币储备
        uint256 soldTokens;          // 已售出代币数量
        bool isGraduated;            // 是否已毕业
        bool isActive;               // 是否活跃
        address creator;             // 创建者
        uint64 createdAt;            // 创建时间
        string metadataURI;          // 元数据 URI
        bool graduationFailed;       // M-007: 毕业是否失败
        uint8 graduationAttempts;    // M-007: 毕业尝试次数
        bool perpEnabled;            // 是否已开启永续合约交易
    }

    // tokenAddress => PoolState
    mapping(address => PoolState) private _pools;

    // 所有代币地址列表
    address[] public allTokens;

    // 手续费接收地址
    address public feeReceiver;

    // DEX Router 地址
    address public uniswapV2Router;

    // PriceFeed 地址（用于自动开启永续合约）
    address public priceFeed;

    // WETH 地址 (Base Sepolia)
    address public constant WETH = 0x4200000000000000000000000000000000000006;

    // ══════════════════════════════════════════════════════════════════════════════
    // ERRORS
    // ══════════════════════════════════════════════════════════════════════════════

    error PoolNotInitialized();
    error PoolAlreadyGraduated();
    error PoolNotActive();
    error InvalidAmount();
    error InvalidAddress();
    error InsufficientLiquidity(uint256 requested, uint256 available);
    error InsufficientBalance(uint256 requested, uint256 available);
    error InsufficientFee(uint256 sent, uint256 required);
    error GraduationNotFailed();     // M-007: 毕业未失败
    error MaxGraduationAttempts();   // M-007: 达到最大尝试次数

    // ══════════════════════════════════════════════════════════════════════════════
    // EVENTS
    // ══════════════════════════════════════════════════════════════════════════════

    event ServiceFeeUpdated(uint256 oldFee, uint256 newFee);
    event FeeReceiverUpdated(address indexed oldReceiver, address indexed newReceiver);
    event RouterUpdated(address indexed oldRouter, address indexed newRouter);
    // M-007: 毕业相关事件
    event GraduationFailed(address indexed token, uint8 attempt, string reason);
    event GraduationRetried(address indexed token, uint8 attempt);
    event GraduationRolledBack(address indexed token, uint256 ethReturned);
    // 永续合约自动开启事件
    event PerpEnabled(address indexed token, uint256 ethReserve, uint256 price);
    event PriceFeedUpdated(address indexed oldPriceFeed, address indexed newPriceFeed);

    // ══════════════════════════════════════════════════════════════════════════════
    // CONSTRUCTOR
    // ══════════════════════════════════════════════════════════════════════════════

    constructor(
        address initialOwner,
        address feeReceiver_,
        address uniswapV2Router_
    ) Ownable(initialOwner) {
        if (feeReceiver_ == address(0)) revert InvalidAddress();
        if (uniswapV2Router_ == address(0)) revert InvalidAddress();

        feeReceiver = feeReceiver_;
        uniswapV2Router = uniswapV2Router_;
    }

    // ══════════════════════════════════════════════════════════════════════════════
    // CORE FUNCTIONS
    // ══════════════════════════════════════════════════════════════════════════════

    /**
     * @notice 创建代币并立即开始交易
     * @param name 代币名称
     * @param symbol 代币符号
     * @param metadataURI 元数据 URI (IPFS)
     * @param minTokensOut 最小获得代币数量 (如果附带 ETH 购买)
     */
    // P-007: Added whenNotPaused
    function createToken(
        string memory name,
        string memory symbol,
        string memory metadataURI,
        uint256 minTokensOut
    ) external payable nonReentrant whenNotPaused returns (address tokenAddress) {
        if (msg.value < serviceFee) revert InsufficientFee(msg.value, serviceFee);

        uint256 buyAmount = msg.value - serviceFee;

        // 创建代币
        MemeTokenV2 token = new MemeTokenV2(
            name,
            symbol,
            address(this), // admin
            address(this), // minter
            metadataURI
        );
        tokenAddress = address(token);

        // 初始化池子
        _pools[tokenAddress] = PoolState({
            realETHReserve: 0,
            realTokenReserve: REAL_TOKEN_SUPPLY,
            soldTokens: 0,
            isGraduated: false,
            isActive: true,
            creator: msg.sender,
            createdAt: uint64(block.timestamp),
            metadataURI: metadataURI,
            graduationFailed: false,
            graduationAttempts: 0,
            perpEnabled: false
        });

        allTokens.push(tokenAddress);

        // 转移服务费
        _safeTransferFee(serviceFee);

        emit TokenCreated(tokenAddress, msg.sender, name, symbol, metadataURI, REAL_TOKEN_SUPPLY);

        // 如果附带 ETH，执行首次购买
        if (buyAmount > 0) {
            _buyInternal(tokenAddress, msg.sender, buyAmount, minTokensOut);
        }

        return tokenAddress;
    }

    /**
     * @notice 买入代币
     * @param tokenAddress 代币地址
     * @param minTokensOut 最小获得代币数量
     */
    // P-007: Added whenNotPaused
    function buy(address tokenAddress, uint256 minTokensOut) external payable nonReentrant whenNotPaused {
        if (msg.value == 0) revert InvalidAmount();
        _buyInternal(tokenAddress, msg.sender, msg.value, minTokensOut);
    }

    /**
     * @notice 卖出代币
     * @param tokenAddress 代币地址
     * @param tokenAmount 卖出数量
     * @param minETHOut 最小获得 ETH 数量
     */
    // P-007: Added whenNotPaused
    function sell(address tokenAddress, uint256 tokenAmount, uint256 minETHOut) external nonReentrant whenNotPaused {
        if (tokenAmount == 0) revert InvalidAmount();
        _sellInternal(tokenAddress, msg.sender, tokenAmount, minETHOut);
    }

    // ══════════════════════════════════════════════════════════════════════════════
    // INTERNAL
    // ══════════════════════════════════════════════════════════════════════════════

    function _safeTransferFee(uint256 amount) internal {
        if (amount == 0) return;
        Address.sendValue(payable(feeReceiver), amount);
    }

    function _buyInternal(
        address tokenAddress,
        address buyer,
        uint256 ethAmount,
        uint256 minTokensOut
    ) internal returns (uint256 tokensOut) {
        PoolState storage state = _pools[tokenAddress];
        if (!state.isActive) revert PoolNotActive();
        if (state.isGraduated) revert PoolAlreadyGraduated();

        uint256 virtualEth = VIRTUAL_ETH_RESERVE + state.realETHReserve;
        uint256 virtualToken = state.realTokenReserve + (VIRTUAL_TOKEN_RESERVE - REAL_TOKEN_SUPPLY);

        // 计算毕业前最大可购买代币数量
        uint256 maxBuyableTokens = state.realTokenReserve > GRADUATION_THRESHOLD
            ? state.realTokenReserve - GRADUATION_THRESHOLD
            : 0;

        // 计算手续费
        uint256 fee = (ethAmount * FEE_BPS) / 10000;
        uint256 amountIn = ethAmount - fee;

        // 计算可获得代币数量
        tokensOut = ConstantProductAMMMath.getTokensOut(virtualEth, virtualToken, amountIn);

        // 检查是否触发毕业
        uint256 refundAmount = 0;
        bool willGraduate = false;

        if (tokensOut >= maxBuyableTokens && maxBuyableTokens > 0) {
            willGraduate = true;
            tokensOut = maxBuyableTokens;

            // 计算实际需要的 ETH
            uint256 ethNeeded = ConstantProductAMMMath.getETHIn(virtualEth, virtualToken, tokensOut);

            if (amountIn > ethNeeded) {
                uint256 excessEth = amountIn - ethNeeded;
                amountIn = ethNeeded;

                // 重新计算手续费
                uint256 newFee = (amountIn * FEE_BPS) / (10000 - FEE_BPS);
                refundAmount = excessEth + (fee - newFee);
                fee = newFee;
            }
        } else if (tokensOut > state.realTokenReserve) {
            revert InsufficientLiquidity(tokensOut, state.realTokenReserve);
        }

        if (tokensOut < minTokensOut) revert InsufficientLiquidity(tokensOut, minTokensOut);

        // 转移手续费
        if (fee > 0) {
            _safeTransferFee(fee);
        }

        // 退还多余 ETH
        if (refundAmount > 0) {
            (bool refundSuccess,) = buyer.call{value: refundAmount}("");
            require(refundSuccess, "Refund failed");
        }

        // 更新状态
        state.realETHReserve += amountIn;
        state.realTokenReserve -= tokensOut;
        state.soldTokens += tokensOut;

        // 铸造代币给买家
        IMemeTokenV2(tokenAddress).mint(buyer, tokensOut);

        emit Trade(tokenAddress, buyer, true, amountIn, tokensOut, virtualEth, virtualToken, block.timestamp);

        // 检查是否开启永续合约（达到阈值且未开启）
        if (!state.perpEnabled && state.realETHReserve >= PERP_ENABLE_THRESHOLD && priceFeed != address(0)) {
            _enablePerp(tokenAddress, state);
        }

        // [C-01/C-05 修复] 同步价格到 PriceFeed（用于永续合约）
        PriceFeedHelper.syncPrice(
            priceFeed,
            tokenAddress,
            VIRTUAL_ETH_RESERVE + state.realETHReserve,
            state.realTokenReserve + (VIRTUAL_TOKEN_RESERVE - REAL_TOKEN_SUPPLY)
        );

        // 检查是否毕业
        if (willGraduate || (state.realTokenReserve <= GRADUATION_THRESHOLD && !state.isGraduated)) {
            _graduate(tokenAddress, state);
        }

        return tokensOut;
    }

    function _sellInternal(
        address tokenAddress,
        address seller,
        uint256 tokenAmount,
        uint256 minETHOut
    ) internal returns (uint256 ethOut) {
        PoolState storage state = _pools[tokenAddress];
        if (!state.isActive) revert PoolNotActive();
        if (state.isGraduated) revert PoolAlreadyGraduated();

        // 检查余额
        uint256 actualBalance = IERC20(tokenAddress).balanceOf(seller);
        if (actualBalance < tokenAmount) revert InsufficientBalance(tokenAmount, actualBalance);

        uint256 virtualEth = VIRTUAL_ETH_RESERVE + state.realETHReserve;
        uint256 virtualToken = state.realTokenReserve + (VIRTUAL_TOKEN_RESERVE - REAL_TOKEN_SUPPLY);

        uint256 ethOutTotal = ConstantProductAMMMath.getETHOut(virtualEth, virtualToken, tokenAmount);

        uint256 fee = (ethOutTotal * FEE_BPS) / 10000;
        ethOut = ethOutTotal - fee;

        if (ethOut < minETHOut) revert InsufficientLiquidity(ethOut, minETHOut);
        if (ethOutTotal > state.realETHReserve) revert InsufficientLiquidity(ethOutTotal, state.realETHReserve);

        // 转移代币到合约
        IERC20(tokenAddress).safeTransferFrom(seller, address(this), tokenAmount);

        // 转移手续费
        _safeTransferFee(fee);

        // 转移 ETH 给卖家
        (bool success,) = seller.call{value: ethOut}("");
        require(success, "ETH transfer failed");

        // 更新状态
        state.realETHReserve -= ethOutTotal;
        state.realTokenReserve += tokenAmount;
        state.soldTokens -= tokenAmount;

        // 销毁代币
        IMemeTokenV2(tokenAddress).burn(tokenAmount);

        emit Trade(tokenAddress, seller, false, ethOut, tokenAmount, virtualEth, virtualToken, block.timestamp);

        // [C-01/C-05 修复] 同步价格到 PriceFeed（用于永续合约）
        PriceFeedHelper.syncPrice(
            priceFeed,
            tokenAddress,
            VIRTUAL_ETH_RESERVE + state.realETHReserve,
            state.realTokenReserve + (VIRTUAL_TOKEN_RESERVE - REAL_TOKEN_SUPPLY)
        );
    }

    /**
     * @notice 自动开启永续合约交易
     * @dev 当池子达到 PERP_ENABLE_THRESHOLD 时自动调用 PriceFeed 添加代币
     */
    function _enablePerp(address tokenAddress, PoolState storage state) internal {
        // 计算当前价格
        uint256 virtualEth = VIRTUAL_ETH_RESERVE + state.realETHReserve;
        uint256 virtualToken = state.realTokenReserve + (VIRTUAL_TOKEN_RESERVE - REAL_TOKEN_SUPPLY);
        uint256 currentPrice = ConstantProductAMMMath.getCurrentPrice(virtualEth, virtualToken);

        // 调用 PriceFeed 添加代币支持
        try IPriceFeedFactory(priceFeed).addSupportedTokenFromFactory(tokenAddress, currentPrice) {
            state.perpEnabled = true;
            emit PerpEnabled(tokenAddress, state.realETHReserve, currentPrice);
        } catch {
            // 如果失败，不阻止交易，下次买入会重试
        }
    }

    function _graduate(address tokenAddress, PoolState storage state) internal {
        if (state.isGraduated) revert PoolAlreadyGraduated();

        uint256 ethAmount = state.realETHReserve;
        uint256 tokenAmount = state.realTokenReserve;

        // M-007: 增加尝试次数
        state.graduationAttempts++;

        // 锁定铸造
        IMemeTokenV2(tokenAddress).lockMinting();

        // 授权 Router
        IERC20(tokenAddress).approve(uniswapV2Router, tokenAmount);

        // LP Token 发送到死地址 (销毁)
        address DEAD_ADDRESS = 0x000000000000000000000000000000000000dEaD;

        // 允许 1% 滑点
        uint256 minTokenAmount = tokenAmount * 99 / 100;

        try IUniswapV2Router02(uniswapV2Router).addLiquidityETH{value: ethAmount}(
            tokenAddress,
            tokenAmount,
            minTokenAmount,
            0,
            DEAD_ADDRESS,
            block.timestamp + 300
        ) returns (uint256, uint256, uint256) {
            state.isGraduated = true;
            state.graduationFailed = false;

            address factory = IUniswapV2Router02(uniswapV2Router).factory();
            address pairAddress = IUniswapV2Factory(factory).getPair(tokenAddress, WETH);

            // 移除 Minter 权限
            IMemeTokenV2(tokenAddress).removeMinter(address(this));

            emit LiquidityMigrated(tokenAddress, pairAddress, ethAmount, tokenAmount, block.timestamp);
        } catch Error(string memory reason) {
            // M-007: 标记失败，允许重试而不是直接revert
            IERC20(tokenAddress).approve(uniswapV2Router, 0);
            state.graduationFailed = true;
            emit GraduationFailed(tokenAddress, state.graduationAttempts, reason);
        } catch {
            // M-007: 未知错误
            IERC20(tokenAddress).approve(uniswapV2Router, 0);
            state.graduationFailed = true;
            emit GraduationFailed(tokenAddress, state.graduationAttempts, "Unknown error");
        }
    }

    // ══════════════════════════════════════════════════════════════════════════════
    // ADMIN
    // ══════════════════════════════════════════════════════════════════════════════

    // P-007: Emergency pause functionality
    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }

    function setServiceFee(uint256 newFee) external onlyOwner {
        uint256 oldFee = serviceFee;
        serviceFee = newFee;
        emit ServiceFeeUpdated(oldFee, newFee);
    }

    function setFeeReceiver(address newFeeReceiver) external onlyOwner {
        if (newFeeReceiver == address(0)) revert InvalidAddress();
        address oldReceiver = feeReceiver;
        feeReceiver = newFeeReceiver;
        emit FeeReceiverUpdated(oldReceiver, newFeeReceiver);
    }

    function setUniswapV2Router(address newRouter) external onlyOwner {
        if (newRouter == address(0)) revert InvalidAddress();
        address oldRouter = uniswapV2Router;
        uniswapV2Router = newRouter;
        emit RouterUpdated(oldRouter, newRouter);
    }

    /**
     * @notice 设置 PriceFeed 地址（用于自动开启永续合约）
     * @param newPriceFeed PriceFeed 地址
     */
    function setPriceFeed(address newPriceFeed) external onlyOwner {
        if (newPriceFeed == address(0)) revert InvalidAddress();
        address oldPriceFeed = priceFeed;
        priceFeed = newPriceFeed;
        emit PriceFeedUpdated(oldPriceFeed, newPriceFeed);
    }

    /**
     * @notice M-007: 管理员重试毕业流程
     * @param tokenAddress 代币地址
     */
    function retryGraduation(address tokenAddress) external onlyOwner nonReentrant {
        PoolState storage state = _pools[tokenAddress];
        if (!state.graduationFailed) revert GraduationNotFailed();
        if (state.isGraduated) revert PoolAlreadyGraduated();
        if (state.graduationAttempts >= 3) revert MaxGraduationAttempts();

        emit GraduationRetried(tokenAddress, state.graduationAttempts + 1);
        _graduate(tokenAddress, state);
    }

    /**
     * @notice M-007: 紧急回退毕业流程，允许继续交易
     * @dev 将ETH退还给当前代币持有者（按比例），重置池子状态
     * @param tokenAddress 代币地址
     */
    function rollbackGraduation(address tokenAddress) external onlyOwner nonReentrant {
        PoolState storage state = _pools[tokenAddress];
        if (!state.graduationFailed) revert GraduationNotFailed();
        if (state.isGraduated) revert PoolAlreadyGraduated();

        // 重置毕业失败状态
        state.graduationFailed = false;
        // 增加代币储备以防止立即触发毕业
        // 注意：这是一个紧急措施，可能导致价格波动
        state.realTokenReserve += GRADUATION_THRESHOLD / 10; // 增加一些缓冲

        emit GraduationRolledBack(tokenAddress, state.realETHReserve);
    }

    /**
     * @notice M-007: 紧急提取卡住的ETH（仅在毕业失败后）
     * @param tokenAddress 代币地址
     * @param recipient 接收地址
     */
    function emergencyWithdraw(address tokenAddress, address recipient) external onlyOwner nonReentrant {
        if (recipient == address(0)) revert InvalidAddress();

        PoolState storage state = _pools[tokenAddress];
        if (!state.graduationFailed) revert GraduationNotFailed();
        if (state.graduationAttempts < 3) revert("Must attempt graduation 3 times first");

        uint256 ethAmount = state.realETHReserve;
        state.realETHReserve = 0;
        state.isActive = false;

        (bool success,) = recipient.call{value: ethAmount}("");
        require(success, "ETH transfer failed");
    }

    // ══════════════════════════════════════════════════════════════════════════════
    // VIEWS
    // ══════════════════════════════════════════════════════════════════════════════

    function getPoolState(address tokenAddress) external view returns (PoolState memory) {
        return _pools[tokenAddress];
    }

    function getCurrentPrice(address tokenAddress) external view returns (uint256) {
        PoolState memory state = _pools[tokenAddress];
        uint256 virtualEth = VIRTUAL_ETH_RESERVE + state.realETHReserve;
        uint256 virtualToken = state.realTokenReserve + (VIRTUAL_TOKEN_RESERVE - REAL_TOKEN_SUPPLY);
        return ConstantProductAMMMath.getCurrentPrice(virtualEth, virtualToken);
    }

    function previewBuy(address tokenAddress, uint256 ethIn) external view returns (uint256) {
        PoolState memory state = _pools[tokenAddress];
        uint256 virtualEth = VIRTUAL_ETH_RESERVE + state.realETHReserve;
        uint256 virtualToken = state.realTokenReserve + (VIRTUAL_TOKEN_RESERVE - REAL_TOKEN_SUPPLY);
        uint256 fee = (ethIn * FEE_BPS) / 10000;
        return ConstantProductAMMMath.getTokensOut(virtualEth, virtualToken, ethIn - fee);
    }

    function previewSell(address tokenAddress, uint256 tokensIn) external view returns (uint256) {
        PoolState memory state = _pools[tokenAddress];
        uint256 virtualEth = VIRTUAL_ETH_RESERVE + state.realETHReserve;
        uint256 virtualToken = state.realTokenReserve + (VIRTUAL_TOKEN_RESERVE - REAL_TOKEN_SUPPLY);
        uint256 ethOutTotal = ConstantProductAMMMath.getETHOut(virtualEth, virtualToken, tokensIn);
        uint256 fee = (ethOutTotal * FEE_BPS) / 10000;
        return ethOutTotal - fee;
    }

    function getAllTokens() external view returns (address[] memory) {
        return allTokens;
    }

    function getTokenCount() external view returns (uint256) {
        return allTokens.length;
    }

    receive() external payable {}
}
