import { toFunctionSelector } from "viem";

const allErrors = [
  "CannotReferSelf()", "EnforcedPause()", "ExpectedPause()", "FailedCall()",
  "GraduationNotFailed()", "InsufficientBalance(uint256,uint256)",
  "InsufficientFee(uint256,uint256)", "InsufficientLiquidity(uint256,uint256)",
  "InvalidAddress()", "InvalidAmount()", "MaxGraduationAttempts()",
  "NoEarningsToClaim()", "OwnableInvalidOwner(address)",
  "OwnableUnauthorizedAccount(address)", "PoolAlreadyGraduated()",
  "PoolNotActive()", "PoolNotInitialized()", "ReentrancyGuardReentrantCall()",
  "ReferrerAlreadySet()", "SafeERC20FailedOperation(address)",
  // MemeTokenV2
  "AccessControlBadConfirmation()", "AccessControlUnauthorizedAccount(address,bytes32)",
  "AlreadyLocked()", "ECDSAInvalidSignature()", "ECDSAInvalidSignatureLength(uint256)",
  "ECDSAInvalidSignatureS(bytes32)", "ERC20ExceededCap(uint256,uint256)",
  "ERC20InsufficientAllowance(address,uint256,uint256)",
  "ERC20InsufficientBalance(address,uint256,uint256)",
  "ERC20InvalidApprover(address)", "ERC20InvalidCap(uint256)",
  "ERC20InvalidReceiver(address)", "ERC20InvalidSender(address)",
  "ERC20InvalidSpender(address)", "ERC2612ExpiredSignature(uint256)",
  "ERC2612InvalidSigner(address,address)", "InvalidAccountNonce(address,uint256)",
  "InvalidShortString()", "MintingIsLocked()", "StringTooLong(string)",
];

const TARGET = "0xb45b7087";
let found = false;

for (const err of allErrors) {
  const sel = toFunctionSelector("error " + err).slice(0, 10);
  if (sel === TARGET) {
    console.log(`>>> FOUND: ${sel} = ${err}`);
    found = true;
  }
}

if (!found) {
  console.log("Not found in known errors. Trying 4byte.directory...");
  const resp = await fetch(`https://www.4byte.directory/api/v1/signatures/?hex_signature=${TARGET}`);
  const data = await resp.json();
  console.log("4byte results:", JSON.stringify(data.results));
}
