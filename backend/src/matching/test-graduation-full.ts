/**
 * Full graduation test: Create TPEPE4, buy to near threshold, trigger graduation with high gas
 */
import { createWalletClient, createPublicClient, http, parseEther, formatEther, type Address, getAddress } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { baseSepolia } from "viem/chains";
import fs from "fs";
import dotenv from "dotenv";
import path from "path";

dotenv.config({ path: path.resolve(__dirname, "../../../contracts/.env") });

const TOKEN_FACTORY = getAddress("0x583d35e9d407Ea03dE5A2139e792841353CB67b1");
const ROUTER = getAddress("0x8cFe327CEc66d1C090Dd72bd0FF11d690C33a2Eb");
const WETH = getAddress("0x4200000000000000000000000000000000000006");
const FACTORY_V2 = getAddress("0x02a84c1b3BBD7401a5f7fa98a384EBC70bB5749E");

const wallets = JSON.parse(fs.readFileSync("main-wallets.json", "utf-8"));

// Deployer (owner)
const deployerAccount = privateKeyToAccount(process.env.PRIVATE_KEY as `0x${string}`);
// Test buyer wallet[9]
const buyerAccount = privateKeyToAccount(wallets[9].privateKey);

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
  { type: "function", name: "createToken", inputs: [
    { name: "name", type: "string" },
    { name: "symbol", type: "string" },
    { name: "metadataURI", type: "string" },
    { name: "minTokensOut", type: "uint256" },
  ], outputs: [{ name: "tokenAddress", type: "address" }], stateMutability: "payable" },
  { type: "function", name: "serviceFee", inputs: [], outputs: [{ name: "", type: "uint256" }], stateMutability: "view" },
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
  const buyerClient = makeWalletClient(buyerAccount);
  const deployerClient = makeWalletClient(deployerAccount);

  // Check balances
  const buyerEth = await publicClient.getBalance({ address: buyerAccount.address });
  const deployerEth = await publicClient.getBalance({ address: deployerAccount.address });
  console.log("Buyer (wallet[9]):", buyerAccount.address, "ETH:", formatEther(buyerEth));
  console.log("Deployer:", deployerAccount.address, "ETH:", formatEther(deployerEth));

  // Step 1: Create token
  console.log("\n=== Step 1: Create TPEPE4 ===");
  const fee = await publicClient.readContract({ address: TOKEN_FACTORY, abi: TOKEN_FACTORY_ABI, functionName: "serviceFee" });

  const metadata = Buffer.from(JSON.stringify({
    name: "Test Pepe 4",
    description: "Graduation test with high gas",
    image: "https://i.imgur.com/71Lj1zA.png"
  })).toString("base64");
  const metadataURI = `data:application/json;base64,${metadata}`;

  const createValue = fee + parseEther("0.01");
  const createHash = await buyerClient.writeContract({
    address: TOKEN_FACTORY,
    abi: TOKEN_FACTORY_ABI,
    functionName: "createToken",
    args: ["Test Pepe 4", "TPEPE4", metadataURI, 1n],
    value: createValue,
  });
  console.log("Create TX:", createHash);
  const createReceipt = await publicClient.waitForTransactionReceipt({ hash: createHash });
  console.log("Status:", createReceipt.status);

  // Extract token address
  let tokenAddress: Address | null = null;
  for (const log of createReceipt.logs) {
    if (log.address.toLowerCase() === TOKEN_FACTORY.toLowerCase() && log.topics[1]) {
      tokenAddress = getAddress("0x" + log.topics[1].slice(26));
      break;
    }
  }
  if (!tokenAddress) {
    console.log("❌ Could not find token address in logs");
    return;
  }
  console.log("TPEPE4:", tokenAddress);

  // Step 2: Buy in large amounts to approach graduation threshold
  console.log("\n=== Step 2: Pump to near graduation ===");
  const threshold = await publicClient.readContract({ address: TOKEN_FACTORY, abi: TOKEN_FACTORY_ABI, functionName: "GRADUATION_THRESHOLD" });
  console.log("Graduation threshold:", (Number(threshold) / 1e18 / 1e6).toFixed(0), "M tokens");

  // Use multiple wallets to buy
  const buyAmounts = [
    parseEther("0.5"),
    parseEther("0.5"),
    parseEther("0.5"),
    parseEther("0.5"),
    parseEther("0.5"),
    parseEther("0.5"),
    parseEther("0.5"),
    parseEther("0.5"),
    parseEther("0.5"),
    parseEther("0.5"),
  ];

  for (let i = 0; i < buyAmounts.length; i++) {
    const walletIdx = i % 10;
    const wallet = privateKeyToAccount(wallets[walletIdx].privateKey);
    const client = makeWalletClient(wallet);

    const bal = await publicClient.getBalance({ address: wallet.address });
    if (bal < buyAmounts[i] + parseEther("0.01")) {
      console.log(`  wallet[${walletIdx}] insufficient balance (${formatEther(bal)} ETH), skipping`);
      continue;
    }

    const state = await publicClient.readContract({ address: TOKEN_FACTORY, abi: TOKEN_FACTORY_ABI, functionName: "getPoolState", args: [tokenAddress] });
    if (state.isGraduated) {
      console.log("  Token already graduated!");
      break;
    }
    if (state.graduationFailed) {
      console.log("  Graduation failed! Will retry with high gas.");
      break;
    }

    const progress = Number(state.soldTokens) * 100 / Number(threshold);
    console.log(`  Buy #${i + 1}: wallet[${walletIdx}] buying ${formatEther(buyAmounts[i])} ETH... (progress: ${progress.toFixed(1)}%)`);

    try {
      const hash = await client.writeContract({
        address: TOKEN_FACTORY,
        abi: TOKEN_FACTORY_ABI,
        functionName: "buy",
        args: [tokenAddress, 0n],
        value: buyAmounts[i],
        gas: 6_000_000n, // HIGH gas limit for potential graduation trigger
      });
      const receipt = await publicClient.waitForTransactionReceipt({ hash, timeout: 60000 });
      console.log(`    Status: ${receipt.status}, gas: ${receipt.gasUsed.toString()}`);
    } catch (err: any) {
      console.log(`    ❌ Buy failed: ${err.shortMessage || err.message}`);
    }
  }

  // Step 3: Check state
  console.log("\n=== Step 3: Check final state ===");
  const finalState = await publicClient.readContract({ address: TOKEN_FACTORY, abi: TOKEN_FACTORY_ABI, functionName: "getPoolState", args: [tokenAddress] });
  const finalProgress = Number(finalState.soldTokens) * 100 / Number(threshold);
  console.log("  isGraduated:", finalState.isGraduated);
  console.log("  graduationFailed:", finalState.graduationFailed);
  console.log("  graduationAttempts:", finalState.graduationAttempts);
  console.log("  progress:", finalProgress.toFixed(1) + "%");
  console.log("  realETHReserve:", formatEther(finalState.realETHReserve), "ETH");
  console.log("  realTokenReserve:", (Number(finalState.realTokenReserve) / 1e18 / 1e6).toFixed(2), "M");

  if (finalState.isGraduated) {
    const pair = await publicClient.readContract({ address: FACTORY_V2, abi: FACTORY_V2_ABI, functionName: "getPair", args: [tokenAddress, WETH] });
    console.log("\n🎉🎉🎉 GRADUATION SUCCEEDED! 🎉🎉🎉");
    console.log("  Uniswap V2 Pair:", pair);
    return;
  }

  if (finalState.graduationFailed) {
    console.log("\n  Graduation failed. Retrying with 5M gas...");
    try {
      const hash = await deployerClient.writeContract({
        address: TOKEN_FACTORY,
        abi: TOKEN_FACTORY_ABI,
        functionName: "retryGraduation",
        args: [tokenAddress],
        gas: 5_000_000n,
      });
      console.log("  Retry TX:", hash);
      const receipt = await publicClient.waitForTransactionReceipt({ hash, timeout: 60000 });
      console.log("  Status:", receipt.status, "gas:", receipt.gasUsed.toString());

      const stateAfter = await publicClient.readContract({ address: TOKEN_FACTORY, abi: TOKEN_FACTORY_ABI, functionName: "getPoolState", args: [tokenAddress] });
      console.log("  isGraduated:", stateAfter.isGraduated);
      console.log("  graduationFailed:", stateAfter.graduationFailed);

      if (stateAfter.isGraduated) {
        const pair = await publicClient.readContract({ address: FACTORY_V2, abi: FACTORY_V2_ABI, functionName: "getPair", args: [tokenAddress, WETH] });
        console.log("\n🎉🎉🎉 GRADUATION SUCCEEDED after retry! 🎉🎉🎉");
        console.log("  Uniswap V2 Pair:", pair);
      }
    } catch (err: any) {
      console.log("  ❌ Retry failed:", err.shortMessage || err.message);
    }
  }
}

main().catch(console.error);
