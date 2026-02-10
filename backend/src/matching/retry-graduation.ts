import { createWalletClient, createPublicClient, http, formatEther, type Address, getAddress } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { baseSepolia } from "viem/chains";
import fs from "fs";

const TOKEN_FACTORY = getAddress("0x583d35e9d407Ea03dE5A2139e792841353CB67b1");
const TEST_TOKEN = getAddress("0x8c219589db787c1a5b57b1d2075c76c0d3f51c73");
const ROUTER = getAddress("0x8cFe327CEc66d1C090Dd72bd0FF11d690C33a2Eb");
const WETH = getAddress("0x4200000000000000000000000000000000000006");

// Use deployer wallet (owner of TokenFactory) from contracts/.env
import dotenv from "dotenv";
import path from "path";
dotenv.config({ path: path.resolve(__dirname, "../../../contracts/.env") });
const account = privateKeyToAccount(process.env.PRIVATE_KEY as `0x${string}`);
console.log("Using deployer (owner):", account.address);

const walletClient = createWalletClient({
  account,
  chain: baseSepolia,
  transport: http("https://base-sepolia-rpc.publicnode.com"),
});
const publicClient = createPublicClient({
  chain: baseSepolia,
  transport: http("https://base-sepolia-rpc.publicnode.com"),
});

const TOKEN_FACTORY_ABI = [
  { type: "function", name: "retryGraduation", inputs: [{ name: "tokenAddress", type: "address" }], outputs: [], stateMutability: "nonpayable" },
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
  { type: "function", name: "owner", inputs: [], outputs: [{ name: "", type: "address" }], stateMutability: "view" },
] as const;

const FACTORY_ABI = [
  { type: "function", name: "getPair", inputs: [{ name: "tokenA", type: "address" }, { name: "tokenB", type: "address" }], outputs: [{ name: "", type: "address" }], stateMutability: "view" },
] as const;

async function main() {
  // Pre-check
  const owner = await publicClient.readContract({ address: TOKEN_FACTORY, abi: TOKEN_FACTORY_ABI, functionName: "owner" });
  console.log("TokenFactory owner:", owner);
  console.log("We are owner?", owner.toLowerCase() === account.address.toLowerCase());

  const stateBefore = await publicClient.readContract({ address: TOKEN_FACTORY, abi: TOKEN_FACTORY_ABI, functionName: "getPoolState", args: [TEST_TOKEN] });
  console.log("\n=== Before retryGraduation ===");
  console.log("  graduationFailed:", stateBefore.graduationFailed);
  console.log("  graduationAttempts:", stateBefore.graduationAttempts);
  console.log("  isGraduated:", stateBefore.isGraduated);
  console.log("  realETHReserve:", formatEther(stateBefore.realETHReserve), "ETH");
  console.log("  realTokenReserve:", (Number(stateBefore.realTokenReserve) / 1e18 / 1e6).toFixed(2), "M");

  if (stateBefore.graduationAttempts >= 3) {
    console.log("\n❌ Max graduation attempts (3) reached. Need to use rollbackGraduation first.");
    return;
  }

  console.log("\n=== Calling retryGraduation... ===");
  try {
    // Set high gas limit manually — addLiquidityETH with pair creation needs ~2.7M gas,
    // plus _graduate() overhead (mint, approve, try/catch framing).
    // The 63/64 gas forwarding rule means we need even more.
    // 2.7M / (63/64) ≈ 2.74M, plus ~200k overhead = ~3M minimum
    const hash = await walletClient.writeContract({
      address: TOKEN_FACTORY,
      abi: TOKEN_FACTORY_ABI,
      functionName: "retryGraduation",
      args: [TEST_TOKEN],
      gas: 5_000_000n, // 5M gas to be safe
    });
    console.log("TX hash:", hash);

    const receipt = await publicClient.waitForTransactionReceipt({ hash, timeout: 60000 });
    console.log("Status:", receipt.status);
    console.log("Gas used:", receipt.gasUsed.toString());

    // Check state after
    const stateAfter = await publicClient.readContract({ address: TOKEN_FACTORY, abi: TOKEN_FACTORY_ABI, functionName: "getPoolState", args: [TEST_TOKEN] });
    console.log("\n=== After retryGraduation ===");
    console.log("  isGraduated:", stateAfter.isGraduated);
    console.log("  graduationFailed:", stateAfter.graduationFailed);
    console.log("  graduationAttempts:", stateAfter.graduationAttempts);

    if (stateAfter.isGraduated) {
      console.log("\n🎉 GRADUATION SUCCEEDED!");
      // Check the pair
      const factoryAddr = getAddress("0x02a84c1b3BBD7401a5f7fa98a384EBC70bB5749E");
      const pair = await publicClient.readContract({ address: factoryAddr, abi: FACTORY_ABI, functionName: "getPair", args: [TEST_TOKEN, WETH] });
      console.log("  Uniswap V2 Pair:", pair);
    } else if (stateAfter.graduationFailed) {
      console.log("\n❌ Graduation failed again (attempt", stateAfter.graduationAttempts, ")");

      // Parse logs for GraduationFailed event
      for (const log of receipt.logs) {
        console.log("  Log:", log.address, log.topics[0]?.slice(0, 10));
      }
    }
  } catch (err: any) {
    console.log("❌ Transaction failed:", err.shortMessage || err.message);
    if (err.details) console.log("Details:", err.details);
  }
}

main().catch(console.error);
