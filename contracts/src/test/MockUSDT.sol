// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/**
 * @title MockUSDT
 * @notice 测试用 USDT，任何人都可以免费铸造
 */
contract MockUSDT is ERC20 {
    constructor() ERC20("Test USDT", "USDT") {
        // 给部署者初始铸造 1000 万
        _mint(msg.sender, 10_000_000 * 1e6);
    }

    function decimals() public pure override returns (uint8) {
        return 6;
    }

    /**
     * @notice 免费铸造测试代币
     * @param amount 铸造数量 (6 位小数，如 1000 USDT = 1000000000)
     */
    function mint(uint256 amount) external {
        _mint(msg.sender, amount);
    }

    /**
     * @notice 给指定地址铸造
     */
    function mintTo(address to, uint256 amount) external {
        _mint(to, amount);
    }
}

/**
 * @title MockUSDC
 * @notice 测试用 USDC，任何人都可以免费铸造
 */
contract MockUSDC is ERC20 {
    constructor() ERC20("Test USDC", "USDC") {
        _mint(msg.sender, 10_000_000 * 1e6);
    }

    function decimals() public pure override returns (uint8) {
        return 6;
    }

    function mint(uint256 amount) external {
        _mint(msg.sender, amount);
    }

    function mintTo(address to, uint256 amount) external {
        _mint(to, amount);
    }
}
