// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "../interfaces/IPriceFeed.sol";
import "../interfaces/ILPToken.sol";

/**
 * @title AMM
 * @notice 现货交易 AMM 合约（恒定乘积）
 * @dev 实现 BNB-MEME 交易对的现货交易和流动性管理
 */
contract AMM is Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    // ============================================================
    // Constants
    // ============================================================

    uint256 public constant PRECISION = 1e18;
    uint256 public constant FEE_PRECISION = 10000;
    uint256 public constant MIN_LIQUIDITY = 1000; // 最小流动性（防止攻击）

    // ============================================================
    // State Variables
    // ============================================================

    // 代币地址
    IERC20 public memeToken;
    ILPToken public lpToken;
    IPriceFeed public priceFeed;

    // 储备量
    uint256 public bnbReserve;
    uint256 public memeReserve;

    // 手续费（默认 0.3%）
    uint256 public swapFee = 30; // 30/10000 = 0.3%

    // 是否已激活（内盘完成后激活）
    bool public isActive;

    // ============================================================
    // Events
    // ============================================================

    event Swap(address indexed user, bool isBuy, uint256 amountIn, uint256 amountOut, uint256 fee);
    event LiquidityAdded(address indexed user, uint256 bnbAmount, uint256 memeAmount, uint256 lpTokens);
    event LiquidityRemoved(address indexed user, uint256 bnbAmount, uint256 memeAmount, uint256 lpTokens);
    event FeeUpdated(uint256 oldFee, uint256 newFee);
    event Activated();

    // ============================================================
    // Errors
    // ============================================================

    error NotActive();
    error InsufficientLiquidity();
    error InsufficientOutputAmount();
    error InvalidAmount();
    error ExcessivePriceImpact();
    error ZeroAddress();
    error TransferFailed();

    // ============================================================
    // Constructor
    // ============================================================

    constructor(address _memeToken, address _lpToken) Ownable(msg.sender) {
        if (_memeToken == address(0) || _lpToken == address(0)) revert ZeroAddress();
        memeToken = IERC20(_memeToken);
        lpToken = ILPToken(_lpToken);
    }

    // ============================================================
    // Admin Functions
    // ============================================================

    /**
     * @notice 设置价格预言机
     * @param _priceFeed 价格预言机地址
     */
    function setPriceFeed(address _priceFeed) external onlyOwner {
        if (_priceFeed == address(0)) revert ZeroAddress();
        priceFeed = IPriceFeed(_priceFeed);
    }

    /**
     * @notice 设置交易手续费
     * @param _fee 新手续费（基于 10000）
     */
    function setSwapFee(uint256 _fee) external onlyOwner {
        require(_fee <= 100, "Fee too high"); // Max 1%
        emit FeeUpdated(swapFee, _fee);
        swapFee = _fee;
    }

    /**
     * @notice 激活 AMM（创建代币后调用以初始化流动性池）
     * @param bnbAmount 初始 BNB 数量
     * @param memeAmount 初始 MEME 数量
     */
    function activate(uint256 bnbAmount, uint256 memeAmount) external payable onlyOwner {
        require(!isActive, "Already active");
        require(msg.value == bnbAmount, "BNB amount mismatch");
        require(memeAmount > 0, "Invalid MEME amount");

        // 转入 MEME
        memeToken.safeTransferFrom(msg.sender, address(this), memeAmount);

        bnbReserve = bnbAmount;
        memeReserve = memeAmount;
        isActive = true;

        // 铸造初始 LP Token 给 owner
        uint256 liquidity = _sqrt(bnbAmount * memeAmount);
        lpToken.mint(msg.sender, liquidity);

        // 更新价格预言机
        if (address(priceFeed) != address(0)) {
            priceFeed.updatePrice(getSpotPrice());
        }

        emit Activated();
        emit LiquidityAdded(msg.sender, bnbAmount, memeAmount, liquidity);
    }

    // ============================================================
    // Swap Functions
    // ============================================================

    /**
     * @notice 用 BNB 买 MEME
     * @param minAmountOut 最小输出数量（滑点保护）
     * @return memeOut 获得的 MEME 数量
     */
    function swapBNBForMeme(uint256 minAmountOut) external payable nonReentrant returns (uint256 memeOut) {
        if (!isActive) revert NotActive();
        if (msg.value == 0) revert InvalidAmount();

        uint256 amountIn = msg.value;
        uint256 amountInWithFee = amountIn * (FEE_PRECISION - swapFee) / FEE_PRECISION;

        // x * y = k => y_out = y - k / (x + dx)
        memeOut = (memeReserve * amountInWithFee) / (bnbReserve + amountInWithFee);

        if (memeOut < minAmountOut) revert InsufficientOutputAmount();
        if (memeOut >= memeReserve) revert InsufficientLiquidity();

        // 更新储备
        bnbReserve += amountIn;
        memeReserve -= memeOut;

        // 转出 MEME
        memeToken.safeTransfer(msg.sender, memeOut);

        // 更新价格预言机
        if (address(priceFeed) != address(0)) {
            priceFeed.updatePrice(getSpotPrice());
        }

        uint256 fee = amountIn * swapFee / FEE_PRECISION;
        emit Swap(msg.sender, true, amountIn, memeOut, fee);
    }

    /**
     * @notice 用 MEME 买 BNB
     * @param memeAmount 输入的 MEME 数量
     * @param minAmountOut 最小输出数量（滑点保护）
     * @return bnbOut 获得的 BNB 数量
     */
    function swapMemeForBNB(uint256 memeAmount, uint256 minAmountOut) external nonReentrant returns (uint256 bnbOut) {
        if (!isActive) revert NotActive();
        if (memeAmount == 0) revert InvalidAmount();

        uint256 amountInWithFee = memeAmount * (FEE_PRECISION - swapFee) / FEE_PRECISION;

        // x * y = k => x_out = x - k / (y + dy)
        bnbOut = (bnbReserve * amountInWithFee) / (memeReserve + amountInWithFee);

        if (bnbOut < minAmountOut) revert InsufficientOutputAmount();
        if (bnbOut >= bnbReserve) revert InsufficientLiquidity();

        // 转入 MEME
        memeToken.safeTransferFrom(msg.sender, address(this), memeAmount);

        // 更新储备
        memeReserve += memeAmount;
        bnbReserve -= bnbOut;

        // 转出 BNB
        (bool success,) = msg.sender.call{value: bnbOut}("");
        if (!success) revert TransferFailed();

        // 更新价格预言机
        if (address(priceFeed) != address(0)) {
            priceFeed.updatePrice(getSpotPrice());
        }

        uint256 fee = memeAmount * swapFee / FEE_PRECISION;
        emit Swap(msg.sender, false, memeAmount, bnbOut, fee);
    }

    // ============================================================
    // Liquidity Functions
    // ============================================================

    /**
     * @notice 添加流动性
     * @return lpTokens 获得的 LP Token 数量
     */
    function addLiquidity() external payable nonReentrant returns (uint256 lpTokens) {
        if (!isActive) revert NotActive();
        if (msg.value == 0) revert InvalidAmount();

        uint256 bnbAmount = msg.value;
        uint256 memeAmount = (bnbAmount * memeReserve) / bnbReserve;

        // 转入 MEME
        memeToken.safeTransferFrom(msg.sender, address(this), memeAmount);

        // 计算 LP Token 数量（按比例）
        uint256 totalSupply = lpToken.totalSupply();
        lpTokens = (bnbAmount * totalSupply) / bnbReserve;

        // 更新储备
        bnbReserve += bnbAmount;
        memeReserve += memeAmount;

        // 铸造 LP Token
        lpToken.mint(msg.sender, lpTokens);

        emit LiquidityAdded(msg.sender, bnbAmount, memeAmount, lpTokens);
    }

    /**
     * @notice 移除流动性
     * @param lpTokenAmount 销毁的 LP Token 数量
     * @return bnbOut 获得的 BNB 数量
     * @return memeOut 获得的 MEME 数量
     */
    function removeLiquidity(uint256 lpTokenAmount) external nonReentrant returns (uint256 bnbOut, uint256 memeOut) {
        if (lpTokenAmount == 0) revert InvalidAmount();

        uint256 totalSupply = lpToken.totalSupply();

        // 计算份额
        bnbOut = (lpTokenAmount * bnbReserve) / totalSupply;
        memeOut = (lpTokenAmount * memeReserve) / totalSupply;

        if (bnbOut == 0 || memeOut == 0) revert InsufficientLiquidity();

        // 销毁 LP Token
        lpToken.burn(msg.sender, lpTokenAmount);

        // 更新储备
        bnbReserve -= bnbOut;
        memeReserve -= memeOut;

        // 转出代币
        (bool success,) = msg.sender.call{value: bnbOut}("");
        if (!success) revert TransferFailed();
        memeToken.safeTransfer(msg.sender, memeOut);

        emit LiquidityRemoved(msg.sender, bnbOut, memeOut, lpTokenAmount);
    }

    // ============================================================
    // View Functions
    // ============================================================

    /**
     * @notice 获取当前现货价格 (BNB per MEME)
     * @return 价格（18位小数）
     */
    function getSpotPrice() public view returns (uint256) {
        if (memeReserve == 0) return 0;
        return (bnbReserve * PRECISION) / memeReserve;
    }

    /**
     * @notice 获取储备量
     * @return bnb BNB 储备
     * @return meme MEME 储备
     */
    function getReserves() external view returns (uint256 bnb, uint256 meme) {
        return (bnbReserve, memeReserve);
    }

    /**
     * @notice 计算输出数量
     * @param isBuy 是否买入 MEME
     * @param amountIn 输入数量
     * @return 输出数量
     */
    function getAmountOut(bool isBuy, uint256 amountIn) external view returns (uint256) {
        if (amountIn == 0) return 0;

        uint256 amountInWithFee = amountIn * (FEE_PRECISION - swapFee) / FEE_PRECISION;

        if (isBuy) {
            // BNB -> MEME
            return (memeReserve * amountInWithFee) / (bnbReserve + amountInWithFee);
        } else {
            // MEME -> BNB
            return (bnbReserve * amountInWithFee) / (memeReserve + amountInWithFee);
        }
    }

    /**
     * @notice 计算价格影响
     * @param isBuy 是否买入 MEME
     * @param amountIn 输入数量
     * @return 价格影响（基于 10000，例如 100 = 1%）
     */
    function getPriceImpact(bool isBuy, uint256 amountIn) external view returns (uint256) {
        if (amountIn == 0) return 0;

        uint256 currentPrice = getSpotPrice();
        uint256 amountInWithFee = amountIn * (FEE_PRECISION - swapFee) / FEE_PRECISION;

        uint256 newBnbReserve;
        uint256 newMemeReserve;

        if (isBuy) {
            newBnbReserve = bnbReserve + amountIn;
            newMemeReserve = memeReserve - (memeReserve * amountInWithFee) / (bnbReserve + amountInWithFee);
        } else {
            newMemeReserve = memeReserve + amountIn;
            newBnbReserve = bnbReserve - (bnbReserve * amountInWithFee) / (memeReserve + amountInWithFee);
        }

        uint256 newPrice = (newBnbReserve * PRECISION) / newMemeReserve;

        // 计算价格影响百分比
        if (newPrice > currentPrice) {
            return ((newPrice - currentPrice) * FEE_PRECISION) / currentPrice;
        } else {
            return ((currentPrice - newPrice) * FEE_PRECISION) / currentPrice;
        }
    }

    /**
     * @notice 计算添加流动性需要的 MEME 数量
     * @param bnbAmount BNB 数量
     * @return 需要的 MEME 数量
     */
    function getMemeAmountForLiquidity(uint256 bnbAmount) external view returns (uint256) {
        if (bnbReserve == 0) return 0;
        return (bnbAmount * memeReserve) / bnbReserve;
    }

    // ============================================================
    // Internal Functions
    // ============================================================

    function _sqrt(uint256 y) internal pure returns (uint256 z) {
        if (y > 3) {
            z = y;
            uint256 x = y / 2 + 1;
            while (x < z) {
                z = x;
                x = (y / x + x) / 2;
            }
        } else if (y != 0) {
            z = 1;
        }
    }

    // ============================================================
    // Receive Function
    // ============================================================

    receive() external payable {}
}
