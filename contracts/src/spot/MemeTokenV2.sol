// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {ERC20Burnable} from "@openzeppelin/contracts/token/ERC20/extensions/ERC20Burnable.sol";
import {ERC20Permit} from "@openzeppelin/contracts/token/ERC20/extensions/ERC20Permit.sol";
import {ERC20Capped} from "@openzeppelin/contracts/token/ERC20/extensions/ERC20Capped.sol";
import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/**
 * @title MemeTokenV2
 * @notice Meme 代币合约 - 由 TokenFactory 创建
 * @dev 支持 mint/burn，毕业后锁定 minting
 */
contract MemeTokenV2 is
    ERC20,
    ERC20Burnable,
    ERC20Permit,
    ERC20Capped,
    AccessControl,
    ReentrancyGuard
{
    bytes32 public constant ADMIN_ROLE = keccak256("ADMIN_ROLE");
    bytes32 public constant MINTER_ROLE = keccak256("MINTER_ROLE");
    uint256 public constant DEFAULT_CAP = 1_000_000_000 * 10 ** 18; // 10亿

    string private _metadataURI;
    bool private _mintingLocked;
    uint64 public createdAt;

    error MintingIsLocked();
    error AlreadyLocked();
    error MintingNotLocked();

    constructor(
        string memory name_,
        string memory symbol_,
        address admin,
        address minter,
        string memory metadataURI_
    )
        ERC20(name_, symbol_)
        ERC20Permit(name_)
        ERC20Capped(DEFAULT_CAP)
    {
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(ADMIN_ROLE, admin);
        _grantRole(MINTER_ROLE, minter);

        _metadataURI = metadataURI_;
        createdAt = uint64(block.timestamp);
    }

    /**
     * @notice 铸造代币 (仅 Minter)
     */
    function mint(address to, uint256 amount) external onlyRole(MINTER_ROLE) nonReentrant {
        if (_mintingLocked) revert MintingIsLocked();
        _mint(to, amount);
    }

    /**
     * @notice 销毁代币 (仅 Minter，用于卖出时)
     */
    function burn(uint256 amount) public override onlyRole(MINTER_ROLE) {
        _burn(msg.sender, amount);
    }

    /**
     * @notice 锁定铸造 (毕业后调用)
     */
    function lockMinting() external onlyRole(MINTER_ROLE) {
        if (_mintingLocked) revert AlreadyLocked();
        _mintingLocked = true;
    }

    /**
     * @notice 解锁铸造 (毕业失败时回滚用)
     * @dev 仅 ADMIN_ROLE 可调用，用于毕业失败后恢复代币交易
     */
    function unlockMinting() external onlyRole(ADMIN_ROLE) {
        if (!_mintingLocked) revert MintingNotLocked();
        _mintingLocked = false;
    }

    /**
     * @notice 移除 Minter 权限 (毕业后调用)
     */
    function removeMinter(address minter) external onlyRole(ADMIN_ROLE) {
        _revokeRole(MINTER_ROLE, minter);
    }

    /**
     * @notice 获取元数据 URI
     */
    function metadataURI() external view returns (string memory) {
        return _metadataURI;
    }

    /**
     * @notice 是否已锁定铸造
     */
    function isMintingLocked() external view returns (bool) {
        return _mintingLocked;
    }

    // Overrides required by Solidity
    function _update(address from, address to, uint256 value) internal override(ERC20, ERC20Capped) {
        super._update(from, to, value);
    }
}
