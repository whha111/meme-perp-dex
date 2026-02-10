import { toFunctionSelector } from "viem";

const errors = [
  "PoolNotInitialized()",
  "PoolAlreadyGraduated()",
  "MaxGraduationAttempts()",
  "NoEarningsToClaim()",
  "ReferrerAlreadySet()",
  "CannotReferSelf()",
];

for (const err of errors) {
  const sel = toFunctionSelector("error " + err).slice(0, 10);
  console.log(sel, "=", err);
  if (sel === "0xb45b7087") {
    console.log(">>> MATCH:", err);
  }
}

console.log("\nStill not found? Check _buyInternal deeper...");
// Maybe it's from the PriceFeed or another external call
const externalErrors = [
  "CallerNotAuthorized()",
  "PriceNotAvailable()",
  "StalePrice()",
  "InvalidPrice()",
  "TokenNotSupported()",
  "PriceTooOld()",
  "ZeroPrice()",
  "PriceFeedNotSet()",
  "OnlyPriceFeed()",
  "NotPriceFeed()",
  "Unauthorized()",
  "AccessControlUnauthorizedAccount(address,bytes32)",
];

for (const err of externalErrors) {
  const sel = toFunctionSelector("error " + err).slice(0, 10);
  console.log(sel, "=", err);
  if (sel === "0xb45b7087") {
    console.log(">>> MATCH:", err);
  }
}
