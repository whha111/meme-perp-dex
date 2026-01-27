// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IPriceFeed {
    // Legacy single-token functions (for backward compatibility)
    function updatePrice(uint256 newPrice) external;
    function getSpotPrice() external view returns (uint256);
    function getMarkPrice() external view returns (uint256);
    function getTWAP() external view returns (uint256);

    // H-016: Multi-token support
    function updateTokenPrice(address token, uint256 newPrice) external;
    function getTokenSpotPrice(address token) external view returns (uint256);
    function getTokenMarkPrice(address token) external view returns (uint256);
    function getTokenTWAP(address token) external view returns (uint256);
    function isTokenSupported(address token) external view returns (bool);
}
