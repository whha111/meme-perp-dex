import { toFunctionSelector } from "viem";

// OpenZeppelin / Solidity 常见错误
const moreErrors = [
  "Unauthorized()",
  "OwnableUnauthorizedAccount(address)",
  "OwnableInvalidOwner(address)",
  "AddressEmptyCode(address)",
  "FailedCall()",
  "InsufficientBalance(uint256,uint256)",
  "AddressInsufficientBalance(address)",
  "SafeERC20FailedOperation(address)",
  "ERC20InsufficientAllowance(address,uint256,uint256)",
  "ERC20InsufficientBalance(address,uint256,uint256)",
  "MathOverflowedMulDiv()",
  "ServiceFeeTooHigh()",
  "CallerNotPriceFeed()",
  "NotOwner()",
  "PriceFeedNotSet()",
  "PoolAlreadyExists()",
  "TokenNotActive()",
];

for (const err of moreErrors) {
  const sel = toFunctionSelector("error " + err).slice(0, 10);
  if (sel === "0xb45b7087") {
    console.log(">>> MATCH:", err);
  }
}

// 暴力搜索合约 solidity 源码
console.log("Searching contract source...");
