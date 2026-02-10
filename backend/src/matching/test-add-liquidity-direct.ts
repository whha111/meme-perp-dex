import { createWalletClient, createPublicClient, http, parseEther, formatEther, type Address, getAddress, encodeFunctionData } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { baseSepolia } from "viem/chains";
import fs from "fs";

/**
 * Test addLiquidityETH directly (not through TokenFactory) to see exact error.
 *
 * Steps:
 * 1. Mint some test tokens to our wallet
 * 2. Approve Router to spend them
 * 3. Call addLiquidityETH directly
 */

const TOKEN_FACTORY = getAddress("0x583d35e9d407Ea03dE5A2139e792841353CB67b1");
const TEST_TOKEN = getAddress("0x8c219589db787c1a5b57b1d2075c76c0d3f51c73");
const ROUTER = getAddress("0x8cFe327CEc66d1C090Dd72bd0FF11d690C33a2Eb");
const WETH = getAddress("0x4200000000000000000000000000000000000006");
const FACTORY = getAddress("0x02a84c1b3BBD7401a5f7fa98a384EBC70bB5749E");

// Use a test wallet with ETH
const wallets = JSON.parse(fs.readFileSync("main-wallets.json", "utf-8"));
const account = privateKeyToAccount(wallets[9].privateKey);
console.log("Using wallet[9]:", account.address);

const walletClient = createWalletClient({
  account,
  chain: baseSepolia,
  transport: http("https://base-sepolia-rpc.publicnode.com"),
});
const publicClient = createPublicClient({
  chain: baseSepolia,
  transport: http("https://base-sepolia-rpc.publicnode.com"),
});

const ERC20_ABI = [
  { type: "function", name: "balanceOf", inputs: [{ name: "account", type: "address" }], outputs: [{ name: "", type: "uint256" }], stateMutability: "view" },
  { type: "function", name: "approve", inputs: [{ name: "spender", type: "address" }, { name: "amount", type: "uint256" }], outputs: [{ name: "", type: "bool" }], stateMutability: "nonpayable" },
  { type: "function", name: "allowance", inputs: [{ name: "owner", type: "address" }, { name: "spender", type: "address" }], outputs: [{ name: "", type: "uint256" }], stateMutability: "view" },
] as const;

const ROUTER_ABI = [
  { type: "function", name: "addLiquidityETH", inputs: [
    { name: "token", type: "address" },
    { name: "amountTokenDesired", type: "uint256" },
    { name: "amountTokenMin", type: "uint256" },
    { name: "amountETHMin", type: "uint256" },
    { name: "to", type: "address" },
    { name: "deadline", type: "uint256" },
  ], outputs: [
    { name: "amountToken", type: "uint256" },
    { name: "amountETH", type: "uint256" },
    { name: "liquidity", type: "uint256" },
  ], stateMutability: "payable" },
] as const;

const FACTORY_ABI = [
  { type: "function", name: "getPair", inputs: [{ name: "tokenA", type: "address" }, { name: "tokenB", type: "address" }], outputs: [{ name: "", type: "address" }], stateMutability: "view" },
] as const;

async function main() {
  // Check balances
  const ethBal = await publicClient.getBalance({ address: account.address });
  const tokenBal = await publicClient.readContract({ address: TEST_TOKEN, abi: ERC20_ABI, functionName: "balanceOf", args: [account.address] });
  console.log("ETH balance:", formatEther(ethBal));
  console.log("Token balance:", formatEther(tokenBal));

  if (tokenBal === 0n) {
    console.log("\n❌ No tokens in wallet. We need tokens to test. Buy some first.");
    return;
  }

  // Use small amounts for testing
  const testTokenAmount = tokenBal / 10n; // 10% of balance
  const testEthAmount = parseEther("0.01"); // 0.01 ETH
  console.log("\nTest amounts:");
  console.log("  tokens:", formatEther(testTokenAmount));
  console.log("  ETH:", formatEther(testEthAmount));

  // Check pair
  const pair = await publicClient.readContract({ address: FACTORY, abi: FACTORY_ABI, functionName: "getPair", args: [TEST_TOKEN, WETH] });
  console.log("  existing pair:", pair);

  // Step 1: Approve
  console.log("\n=== Step 1: Approve Router ===");
  const approveTx = await walletClient.writeContract({
    address: TEST_TOKEN,
    abi: ERC20_ABI,
    functionName: "approve",
    args: [ROUTER, testTokenAmount],
  });
  console.log("Approve TX:", approveTx);
  await publicClient.waitForTransactionReceipt({ hash: approveTx });

  // Verify allowance
  const allowance = await publicClient.readContract({ address: TEST_TOKEN, abi: ERC20_ABI, functionName: "allowance", args: [account.address, ROUTER] });
  console.log("Allowance after approve:", formatEther(allowance));

  // Step 2: Call addLiquidityETH
  console.log("\n=== Step 2: addLiquidityETH ===");
  const deadline = BigInt(Math.floor(Date.now() / 1000) + 300);

  try {
    // First simulate
    console.log("Simulating...");
    const simResult = await publicClient.simulateContract({
      address: ROUTER,
      abi: ROUTER_ABI,
      functionName: "addLiquidityETH",
      args: [TEST_TOKEN, testTokenAmount, 0n, 0n, account.address, deadline],
      value: testEthAmount,
      account: account.address,
    });
    console.log("✅ Simulation succeeded!");
    console.log("  amountToken:", formatEther(simResult.result[0]));
    console.log("  amountETH:", formatEther(simResult.result[1]));
    console.log("  liquidity:", formatEther(simResult.result[2]));

    // Execute
    console.log("\nExecuting...");
    const hash = await walletClient.writeContract({
      address: ROUTER,
      abi: ROUTER_ABI,
      functionName: "addLiquidityETH",
      args: [TEST_TOKEN, testTokenAmount, 0n, 0n, account.address, deadline],
      value: testEthAmount,
    });
    console.log("TX:", hash);
    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    console.log("Status:", receipt.status);
    console.log("Gas:", receipt.gasUsed.toString());

    // Check pair after
    const pairAfter = await publicClient.readContract({ address: FACTORY, abi: FACTORY_ABI, functionName: "getPair", args: [TEST_TOKEN, WETH] });
    console.log("\n🎉 Pair created:", pairAfter);
  } catch (err: any) {
    console.log("❌ Failed:", err.shortMessage || err.message);
    if (err.cause) {
      console.log("  Cause:", JSON.stringify(err.cause?.data || err.cause?.message || err.cause, null, 2)?.slice(0, 500));
    }
    if (err.details) console.log("  Details:", err.details);
    if (err.metaMessages) console.log("  Meta:", err.metaMessages.join("\n"));
  }
}

main().catch(console.error);
