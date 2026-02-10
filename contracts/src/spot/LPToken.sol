// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title LPToken
 * @notice LP 存款凭证代币
 * @dev 由 LendingPool 或 AMM 铸造/销毁
 */
contract LPToken is ERC20, Ownable {
    // 授权合约（LendingPool, AMM）
    mapping(address => bool) public minters;

    event MinterSet(address indexed minter, bool authorized);

    error Unauthorized();
    error ZeroAddress();

    modifier onlyMinter() {
        if (!minters[msg.sender]) revert Unauthorized();
        _;
    }

    constructor(string memory name, string memory symbol) ERC20(name, symbol) Ownable(msg.sender) {}

    /**
     * @notice 设置铸造者
     * @param minter 铸造者地址
     * @param authorized 是否授权
     */
    function setMinter(address minter, bool authorized) external onlyOwner {
        if (minter == address(0)) revert ZeroAddress();
        minters[minter] = authorized;
        emit MinterSet(minter, authorized);
    }

    /**
     * @notice 铸造 LP Token
     * @param to 接收者
     * @param amount 数量
     */
    function mint(address to, uint256 amount) external onlyMinter {
        _mint(to, amount);
    }

    /**
     * @notice 销毁 LP Token
     * @param from 持有者
     * @param amount 数量
     */
    function burn(address from, uint256 amount) external onlyMinter {
        _burn(from, amount);
    }
}
