import { toFunctionSelector } from "viem";

const errors = [
  "EnforcedPause()",
  "ExpectedPause()",
  "FailedCall()",
  "SafeERC20FailedOperation(address)",
  "OwnableInvalidOwner(address)",
  "OwnableUnauthorizedAccount(address)",
  "ReentrancyGuardReentrantCall()",
];

for (const err of errors) {
  const sel = toFunctionSelector("error " + err).slice(0, 10);
  console.log(sel, "=", err);
  if (sel === "0xb45b7087") {
    console.log(">>> MATCH:", err);
  }
}

// MemeTokenV2 errors
console.log("\nMemeTokenV2 errors:");
const memeErrors = [
  "ERC20InsufficientBalance(address,uint256,uint256)",
  "ERC20InvalidSender(address)",
  "ERC20InvalidReceiver(address)",
  "ERC20InsufficientAllowance(address,uint256,uint256)",
  "ERC20InvalidApprover(address)",
  "ERC20InvalidSpender(address)",
  "ERC2612ExpiredSignature(uint256)",
  "ERC2612InvalidSigner(address,address)",
  "InvalidAccountNonce(address,uint256)",
  "InvalidShortString()",
  "StringTooLong(string)",
  "ERC20ExceededCap(uint256,uint256)",
  "ERC20InvalidCap(uint256)",
  "AccessControlUnauthorizedAccount(address,bytes32)",
  "AccessControlBadConfirmation()",
  "TransfersPaused()",
  "ExceedsMaxSupply(uint256,uint256)",
  "MintCapExceeded(uint256,uint256)",
];

for (const err of memeErrors) {
  const sel = toFunctionSelector("error " + err).slice(0, 10);
  if (sel === "0xb45b7087") {
    console.log(">>> MATCH:", err);
  }
}

// Maybe it's Pausable - check Whennotpaused modifier
console.log("\nChecking Pausable-related...");
const pauseErrors = [
  "EnforcedPause()",
  "ExpectedPause()",
];
for (const err of pauseErrors) {
  const sel = toFunctionSelector("error " + err).slice(0, 10);
  console.log(sel, "=", err);
}

// Let me try the python approach - get all errors from ABI and compute selectors
console.log("\nBrute force from MemeTokenV2 ABI...");
