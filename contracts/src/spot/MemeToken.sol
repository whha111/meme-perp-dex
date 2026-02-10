// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/ERC20Burnable.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title MemeToken
 * @notice MEME 代币合约，总供应量10亿
 * @dev 用于内盘认购分发，现货交易，LP质押
 */
contract MemeToken is ERC20, ERC20Burnable, Ownable {
    uint256 public constant TOTAL_SUPPLY = 1_000_000_000 * 1e18; // 10亿

    constructor() ERC20("MEME", "MEME") Ownable(msg.sender) {
        _mint(msg.sender, TOTAL_SUPPLY);
    }
}
