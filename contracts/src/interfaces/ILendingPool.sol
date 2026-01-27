// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface ILendingPool {
    function deposit(uint256 amount) external returns (uint256);
    function withdraw(uint256 lpTokens) external returns (uint256);
    function claimInterest() external returns (uint256);
    function borrow(address borrower, uint256 amount) external;
    function repay(address borrower, uint256 amount) external;
}
