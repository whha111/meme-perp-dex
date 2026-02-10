/**
 * Pump TPEPE4 to graduation using multiple wallets with high gas
 */
import { createWalletClient, createPublicClient, http, parseEther, formatEther, type Address, getAddress } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { baseSepolia } from "viem/chains";
import fs from "fs";
import dotenv from "dotenv";
import path from "path";

dotenv.config({ path: path.resolve(__dirname, "../../../contracts/.env") });

const TOKEN_FACTORY = getAddress("0x583d35e9d407Ea03dE5A2139e792841353CB67b1");
const TPEPE4 = getAddress("0xF8609911644b8c36b406370F5d7eCf5B3A07fF78");
const WETH = getAddress("0x4200000000000000000000000000000000000006");
const FACTORY_V2 = getAddress("0x02a84c1b3BBD7401a5f7fa98a384EBC70bB5749E");

const wallets = JSON.parse(fs.readFileSync("main-wallets.json", "utf-8"));
const deployerAccount = privateKeyToAccount(process.env.PRIVATE_KEY as `0x${string}`);

const publicClient = createPublicClient({
  chain: baseSepolia,
  transport: http("https://base-sepolia-rpc.publicnode.com"),
});

function makeWalletClient(account: ReturnType<typeof privateKeyToAccount>) {
  return createWalletClient({
    account,
    chain: baseSepolia,
    transport: http("https://base-sepolia-rpc.publicnode.com"),
  });
}

const TOKEN_FACTORY_ABI = [
  { type: "function", name: "buy", inputs: [
    { name: "tokenAddress", type: "address" },
    { name: "minTokensOut", type: "uint256" },
  ], outputs: [], stateMutability: "payable" },
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
  { type: "function", name: "retryGraduation", inputs: [{ name: "tokenAddress", type: "address" }], outputs: [], stateMutability: "nonpayable" },
  { type: "function", name: "GRADUATION_THRESHOLD", inputs: [], outputs: [{ name: "", type: "uint256" }], stateMutability: "view" },
] as const;

const FACTORY_V2_ABI = [
  { type: "function", name: "getPair", inputs: [{ name: "tokenA", type: "address" }, { name: "tokenB", type: "address" }], outputs: [{ name: "", type: "address" }], stateMutability: "view" },
] as const;

async function main() {
  const threshold = await publicClient.readContract({ address: TOKEN_FACTORY, abi: TOKEN_FACTORY_ABI, functionName: "GRADUATION_THRESHOLD" });
  const thresholdNum = Number(threshold) / 1e18;

  // Check initial state
  let state = await publicClient.readContract({ address: TOKEN_FACTORY, abi: TOKEN_FACTORY_ABI, functionName: "getPoolState", args: [TPEPE4] });
  console.log("=== TPEPE4 Current State ===");
  console.log("  realTokenReserve:", (Number(state.realTokenReserve) / 1e18 / 1e6).toFixed(2), "M");
  console.log("  graduation at:", (thresholdNum / 1e6).toFixed(0), "M remaining");
  console.log("  tokens to sell:", ((Number(state.realTokenReserve) / 1e18 - thresholdNum) / 1e6).toFixed(2), "M more needed");
  console.log("  realETHReserve:", formatEther(state.realETHReserve), "ETH");

  if (state.isGraduated) {
    console.log("\n  Already graduated!");
    return;
  }

  // Buy using all wallets with available balance
  console.log("\n=== Pumping ===");
  let round = 0;
  while (true) {
    round++;
    state = await publicClient.readContract({ address: TOKEN_FACTORY, abi: TOKEN_FACTORY_ABI, functionName: "getPoolState", args: [TPEPE4] });

    if (state.isGraduated) {
      console.log("\n🎉 GRADUATED!");
      break;
    }
    if (state.graduationFailed) {
      console.log("\n  Graduation failed! Attempting retry with high gas...");
      break;
    }

    const remainingTokens = Number(state.realTokenReserve) / 1e18 - thresholdNum;
    if (remainingTokens <= 0) {
      console.log("  At or below threshold, should graduate on next buy");
    }

    const progress = ((1 - Number(state.realTokenReserve) / 1e18 / (1e9)) * 100).toFixed(1);
    console.log(`\nRound ${round}: ${progress}% sold, ${(Number(state.realTokenReserve)/1e18/1e6).toFixed(1)}M remaining (target: ${(thresholdNum/1e6).toFixed(0)}M)`);

    // Find wallets with balance — check ALL wallets
    let bought = false;
    for (let i = 0; i < wallets.length; i++) {
      const wallet = privateKeyToAccount(wallets[i].privateKey);
      const bal = await publicClient.getBalance({ address: wallet.address });
      // Use most of balance, leave 0.01 ETH for gas
      const buyAmount = bal > parseEther("0.06") ? bal - parseEther("0.01") : 0n;

      if (buyAmount < parseEther("0.05")) continue;

      // Cap at 0.5 ETH per buy
      const amount = buyAmount > parseEther("0.5") ? parseEther("0.5") : buyAmount;
      console.log(`  wallet[${i}]: buying ${formatEther(amount)} ETH (bal: ${formatEther(bal)})`);

      const client = makeWalletClient(wallet);
      try {
        const hash = await client.writeContract({
          address: TOKEN_FACTORY,
          abi: TOKEN_FACTORY_ABI,
          functionName: "buy",
          args: [TPEPE4, 0n],
          value: amount,
          gas: 6_000_000n, // HIGH gas for potential graduation
        });
        const receipt = await publicClient.waitForTransactionReceipt({ hash, timeout: 60000 });
        console.log(`    Status: ${receipt.status}, gas: ${receipt.gasUsed.toString()}`);
        bought = true;
        break; // One buy per round, check state
      } catch (err: any) {
        console.log(`    ❌ ${err.shortMessage || err.message}`);
      }
    }

    if (!bought) {
      console.log("\n  ❌ No wallets with sufficient balance!");
      break;
    }

    if (round > 50) {
      console.log("\n  Too many rounds, stopping.");
      break;
    }
  }

  // Final state check
  state = await publicClient.readContract({ address: TOKEN_FACTORY, abi: TOKEN_FACTORY_ABI, functionName: "getPoolState", args: [TPEPE4] });
  console.log("\n=== Final State ===");
  console.log("  isGraduated:", state.isGraduated);
  console.log("  graduationFailed:", state.graduationFailed);
  console.log("  graduationAttempts:", state.graduationAttempts);
  console.log("  realETHReserve:", formatEther(state.realETHReserve), "ETH");
  console.log("  realTokenReserve:", (Number(state.realTokenReserve) / 1e18 / 1e6).toFixed(2), "M");

  if (state.isGraduated) {
    const pair = await publicClient.readContract({ address: FACTORY_V2, abi: FACTORY_V2_ABI, functionName: "getPair", args: [TPEPE4, WETH] });
    console.log("\n🎉🎉🎉 GRADUATION SUCCEEDED! 🎉🎉🎉");
    console.log("  Uniswap V2 Pair:", pair);
  } else if (state.graduationFailed) {
    console.log("\n  Graduation failed. Retrying with 5M gas...");
    const deployerClient = makeWalletClient(deployerAccount);
    try {
      const hash = await deployerClient.writeContract({
        address: TOKEN_FACTORY,
        abi: TOKEN_FACTORY_ABI,
        functionName: "retryGraduation",
        args: [TPEPE4],
        gas: 5_000_000n,
      });
      console.log("  TX:", hash);
      const receipt = await publicClient.waitForTransactionReceipt({ hash, timeout: 60000 });
      console.log("  Status:", receipt.status, "gas:", receipt.gasUsed.toString());

      const after = await publicClient.readContract({ address: TOKEN_FACTORY, abi: TOKEN_FACTORY_ABI, functionName: "getPoolState", args: [TPEPE4] });
      if (after.isGraduated) {
        const pair = await publicClient.readContract({ address: FACTORY_V2, abi: FACTORY_V2_ABI, functionName: "getPair", args: [TPEPE4, WETH] });
        console.log("\n🎉🎉🎉 GRADUATION SUCCEEDED after retry! 🎉🎉🎉");
        console.log("  Pair:", pair);
      } else {
        console.log("  Still failed. graduationAttempts:", after.graduationAttempts);
      }
    } catch (err: any) {
      console.log("  ❌ Retry failed:", err.shortMessage || err.message);
    }
  }
}

main().catch(console.error);
