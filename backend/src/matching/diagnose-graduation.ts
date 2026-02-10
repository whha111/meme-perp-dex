import { createPublicClient, createWalletClient, http, parseEther, formatEther, type Address, encodeFunctionData, decodeFunctionResult, getAddress } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { baseSepolia } from "viem/chains";
import fs from "fs";

const TOKEN_FACTORY = getAddress("0x583d35e9d407Ea03dE5A2139e792841353CB67b1");
const TEST_TOKEN = getAddress("0x8c219589db787c1a5b57b1d2075c76c0d3f51c73");
const ROUTER = getAddress("0x8cFe327CEc66d1C090Dd72bd0FF11d690C33a2Eb");
const WETH = getAddress("0x4200000000000000000000000000000000000006");
const FACTORY = getAddress("0x02a84c1b3BBd7401a5F7fa98a384EBC70bB5749E");

const publicClient = createPublicClient({ chain: baseSepolia, transport: http("https://sepolia.base.org") });

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
  { type: "function", name: "factory", inputs: [], outputs: [{ name: "", type: "address" }], stateMutability: "view" },
  { type: "function", name: "WETH", inputs: [], outputs: [{ name: "", type: "address" }], stateMutability: "view" },
] as const;

const FACTORY_ABI = [
  { type: "function", name: "getPair", inputs: [{ name: "tokenA", type: "address" }, { name: "tokenB", type: "address" }], outputs: [{ name: "", type: "address" }], stateMutability: "view" },
  { type: "function", name: "createPair", inputs: [{ name: "tokenA", type: "address" }, { name: "tokenB", type: "address" }], outputs: [{ name: "", type: "address" }], stateMutability: "nonpayable" },
  { type: "function", name: "allPairsLength", inputs: [], outputs: [{ name: "", type: "uint256" }], stateMutability: "view" },
] as const;

const TOKEN_FACTORY_ABI = [
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

const ERC20_ABI = [
  { type: "function", name: "balanceOf", inputs: [{ name: "account", type: "address" }], outputs: [{ name: "", type: "uint256" }], stateMutability: "view" },
  { type: "function", name: "totalSupply", inputs: [], outputs: [{ name: "", type: "uint256" }], stateMutability: "view" },
  { type: "function", name: "allowance", inputs: [{ name: "owner", type: "address" }, { name: "spender", type: "address" }], outputs: [{ name: "", type: "uint256" }], stateMutability: "view" },
] as const;

async function main() {
  console.log("=== Graduation Diagnosis ===\n");

  // 1. Check Router
  const factory = await publicClient.readContract({ address: ROUTER, abi: ROUTER_ABI, functionName: "factory" });
  const weth = await publicClient.readContract({ address: ROUTER, abi: ROUTER_ABI, functionName: "WETH" });
  console.log("Router:", ROUTER);
  console.log("  factory():", factory);
  console.log("  WETH():", weth);

  // 2. Check Factory
  const pairsLength = await publicClient.readContract({ address: FACTORY, abi: FACTORY_ABI, functionName: "allPairsLength" });
  console.log("\nFactory:", FACTORY);
  console.log("  allPairsLength:", pairsLength.toString());

  // 3. Check existing pair
  const pair = await publicClient.readContract({ address: FACTORY, abi: FACTORY_ABI, functionName: "getPair", args: [TEST_TOKEN, WETH] });
  console.log("  getPair(TPEPE3, WETH):", pair);

  // 4. Check pool state
  const state = await publicClient.readContract({ address: TOKEN_FACTORY, abi: TOKEN_FACTORY_ABI, functionName: "getPoolState", args: [TEST_TOKEN] });
  console.log("\nPool State:");
  console.log("  realETHReserve:", formatEther(state.realETHReserve), "ETH");
  console.log("  realTokenReserve:", (Number(state.realTokenReserve) / 1e18 / 1e6).toFixed(2), "M tokens");
  console.log("  isGraduated:", state.isGraduated);
  console.log("  graduationFailed:", state.graduationFailed);
  console.log("  graduationAttempts:", state.graduationAttempts);

  // 5. Check TokenFactory's token balance
  const factoryTokenBal = await publicClient.readContract({ address: TEST_TOKEN, abi: ERC20_ABI, functionName: "balanceOf", args: [TOKEN_FACTORY] });
  console.log("\n  TokenFactory token balance:", formatEther(factoryTokenBal), "(should be 0 after burn recovery)");

  // 6. Check TokenFactory's ETH balance
  const factoryEthBal = await publicClient.getBalance({ address: TOKEN_FACTORY });
  console.log("  TokenFactory ETH balance:", formatEther(factoryEthBal), "ETH");

  // 7. Check total supply vs expected
  const totalSupply = await publicClient.readContract({ address: TEST_TOKEN, abi: ERC20_ABI, functionName: "totalSupply" });
  console.log("  Token totalSupply:", (Number(totalSupply) / 1e18 / 1e6).toFixed(2), "M (should be ~793M = soldTokens)");

  // 8. Try simulating addLiquidityETH directly
  console.log("\n=== Simulating addLiquidityETH ===");
  const tokenAmount = state.realTokenReserve; // 207M tokens
  const ethAmount = state.realETHReserve; // ~5.15 ETH
  const DEAD = "0x000000000000000000000000000000000000dEaD" as Address;
  const deadline = BigInt(Math.floor(Date.now() / 1000) + 300);

  console.log("  tokenAmount:", (Number(tokenAmount) / 1e18 / 1e6).toFixed(2), "M");
  console.log("  ethAmount:", formatEther(ethAmount), "ETH");

  try {
    // Simulate addLiquidityETH as if called from TokenFactory
    const result = await publicClient.simulateContract({
      address: ROUTER,
      abi: ROUTER_ABI,
      functionName: "addLiquidityETH",
      args: [TEST_TOKEN, tokenAmount, tokenAmount * 99n / 100n, 0n, DEAD, deadline],
      value: ethAmount,
      account: TOKEN_FACTORY,  // Simulate as if TokenFactory is calling
    });
    console.log("  ✅ Simulation succeeded!");
    console.log("  amountToken:", formatEther(result.result[0]));
    console.log("  amountETH:", formatEther(result.result[1]));
    console.log("  liquidity:", formatEther(result.result[2]));
  } catch (err: any) {
    console.log("  ❌ Simulation failed:", err.shortMessage || err.message);
    // Try to get more details
    if (err.cause?.data) {
      console.log("  Error data:", err.cause.data);
    }
    if (err.details) {
      console.log("  Details:", err.details);
    }
  }

  // 9. Also try createPair first separately
  console.log("\n=== Try creating pair manually ===");
  try {
    const result = await publicClient.simulateContract({
      address: FACTORY,
      abi: FACTORY_ABI,
      functionName: "createPair",
      args: [TEST_TOKEN, WETH],
      account: ROUTER,
    });
    console.log("  ✅ createPair simulation succeeded! Pair would be at:", result.result);
  } catch (err: any) {
    console.log("  ❌ createPair failed:", err.shortMessage || err.message);
    if (err.details) console.log("  Details:", err.details);
  }

  // 10. Check bytecode sizes
  console.log("\n=== Bytecode checks ===");
  const routerCode = await publicClient.getCode({ address: ROUTER });
  const factoryCode = await publicClient.getCode({ address: FACTORY });
  console.log("  Router bytecode length:", routerCode ? routerCode.length : "NO CODE");
  console.log("  Factory bytecode length:", factoryCode ? factoryCode.length : "NO CODE");

  // 11. Check allowance from TokenFactory to Router
  const allowance = await publicClient.readContract({ address: TEST_TOKEN, abi: ERC20_ABI, functionName: "allowance", args: [TOKEN_FACTORY, ROUTER] });
  console.log("\n  TokenFactory->Router allowance:", formatEther(allowance));

  // 12. Check if factory() from router matches our FACTORY constant
  console.log("\n=== Cross-check ===");
  console.log("  Router.factory() matches FACTORY?", factory.toLowerCase() === FACTORY.toLowerCase());
  console.log("  Router.WETH() matches WETH?", weth.toLowerCase() === WETH.toLowerCase());
}

main().catch(console.error);
