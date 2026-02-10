import { createWalletClient, createPublicClient, http, parseEther, formatEther, type Address } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { baseSepolia } from "viem/chains";
import fs from "fs";

const TOKEN_FACTORY = "0x583d35e9d407Ea03dE5A2139e792841353CB67b1" as Address;
const TEST_TOKEN = "0x8c219589db787c1a5b57b1d2075c76c0d3f51c73" as Address;

const ABI = [
  { type: "function", name: "buy", inputs: [{ name: "tokenAddress", type: "address" }, { name: "minTokensOut", type: "uint256" }], outputs: [], stateMutability: "payable" },
  { type: "function", name: "getPoolState", inputs: [{ name: "tokenAddress", type: "address" }], outputs: [{ name: "", type: "tuple", components: [
    { name: "realETHReserve", type: "uint256" },
    { name: "realTokenReserve", type: "uint256" },
    { name: "soldTokens", type: "uint256" },
    { name: "isGraduated", type: "bool" },
    { name: "isActive", type: "bool" },
    { name: "creator", type: "address" },
    { name: "createdAt", type: "uint64" },
    { name: "metadataURI", type: "string" },
    { name: "graduationFailed", type: "bool" },
    { name: "graduationAttempts", type: "uint8" },
    { name: "perpEnabled", type: "bool" },
  ]}], stateMutability: "view" },
] as const;

const MEME_TOKEN_ABI = [
  { type: "function", name: "isMintingLocked", inputs: [], outputs: [{ name: "", type: "bool" }], stateMutability: "view" },
] as const;

const wallets = JSON.parse(fs.readFileSync("main-wallets.json", "utf-8"));
const account = privateKeyToAccount(wallets[9].privateKey);
console.log("Using wallet[9]:", account.address);

const client = createWalletClient({ account, chain: baseSepolia, transport: http("https://sepolia.base.org") });
const publicClient = createPublicClient({ chain: baseSepolia, transport: http("https://sepolia.base.org") });

async function main() {
  const stateBefore = await publicClient.readContract({ address: TOKEN_FACTORY, abi: ABI, functionName: "getPoolState", args: [TEST_TOKEN] });
  console.log("=== Before buy ===");
  console.log("ETH Reserve:", formatEther(stateBefore.realETHReserve), "ETH");
  console.log("Token Reserve:", (Number(stateBefore.realTokenReserve) / 1e18 / 1e6).toFixed(2), "M");
  console.log("isGraduated:", stateBefore.isGraduated);
  console.log("graduationFailed:", stateBefore.graduationFailed);

  const mintLockBefore = await publicClient.readContract({ address: TEST_TOKEN, abi: MEME_TOKEN_ABI, functionName: "isMintingLocked" });
  console.log("isMintingLocked:", mintLockBefore);

  console.log("\n🔥 Buying 0.5 ETH (should trigger graduation)...");
  try {
    const hash = await client.writeContract({
      address: TOKEN_FACTORY, abi: ABI, functionName: "buy",
      args: [TEST_TOKEN, 0n],
      value: parseEther("0.5"),
    });
    console.log("TX:", hash);
    
    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    console.log("Status:", receipt.status);
    console.log("Gas used:", receipt.gasUsed.toString());
    console.log("Events:", receipt.logs.length);
  } catch (err: any) {
    console.error("❌ Buy failed:", err.shortMessage || err.message);
  }

  const stateAfter = await publicClient.readContract({ address: TOKEN_FACTORY, abi: ABI, functionName: "getPoolState", args: [TEST_TOKEN] });
  console.log("\n=== After buy ===");
  console.log("ETH Reserve:", formatEther(stateAfter.realETHReserve), "ETH");
  console.log("Token Reserve:", (Number(stateAfter.realTokenReserve) / 1e18 / 1e6).toFixed(2), "M");
  console.log("isGraduated:", stateAfter.isGraduated);
  console.log("graduationFailed:", stateAfter.graduationFailed);
  console.log("graduationAttempts:", stateAfter.graduationAttempts);

  const mintLockAfter = await publicClient.readContract({ address: TEST_TOKEN, abi: MEME_TOKEN_ABI, functionName: "isMintingLocked" });
  console.log("isMintingLocked:", mintLockAfter);

  if (stateAfter.isGraduated && mintLockAfter) {
    console.log("\n✅✅✅ GRADUATION SUCCEEDED! Minting properly locked AFTER migration.");
  } else if (stateAfter.graduationFailed && !mintLockAfter) {
    console.log("\n✅ Graduation failed BUT minting is NOT locked! The fix works - token can still trade.");
  } else if (stateAfter.graduationFailed && mintLockAfter) {
    console.log("\n❌ BUG STILL EXISTS! Graduation failed AND minting is locked.");
  } else {
    console.log("\n⏳ Not yet graduated. Need more buys.");
  }
}

main().catch(console.error);
