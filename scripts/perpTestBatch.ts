/**
 * Perpetual Trading Batch Test Script
 * Tests opening and closing positions with multiple wallets
 */

import {
  createPublicClient,
  createWalletClient,
  http,
  parseEther,
  formatEther,
  formatUnits,
  type Address,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { baseSepolia } from "viem/chains";
import * as fs from "fs";
import * as path from "path";

const RPC_URL = "https://base-sepolia.g.alchemy.com/v2/Dr8sMe-1MYIF7jBYuZZj8PMOPAAeJ16d";

const CONTRACTS = {
  TOKEN_FACTORY: "0xE0ddf67E89f5773c960Bc2329109815E8c66BAAe" as Address,
  POSITION_MANAGER: "0x72E9a39aD581e78DF55fD14D803eD05fB6413660" as Address,
  VAULT: "0x467a18E3Ec98587Cd88683E6F9e1792C480C09c7" as Address,
  PRICE_FEED: "0xd69A4DB60cEc962A46C6B9Bc8CC0883081c4eFb7" as Address,
};

const LEVERAGE_PRECISION = 10000n;

// ABIs
const VAULT_ABI = [
  {
    inputs: [],
    name: "deposit",
    outputs: [],
    stateMutability: "payable",
    type: "function",
  },
  {
    inputs: [{ name: "user", type: "address" }],
    name: "getBalance",
    outputs: [{ type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
] as const;

const POSITION_MANAGER_ABI = [
  {
    inputs: [
      { name: "token", type: "address" },
      { name: "size", type: "uint256" },
      { name: "leverage", type: "uint256" },
      { name: "mode", type: "uint8" },
    ],
    name: "openLongToken",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [
      { name: "token", type: "address" },
      { name: "size", type: "uint256" },
      { name: "leverage", type: "uint256" },
      { name: "mode", type: "uint8" },
    ],
    name: "openShortToken",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [{ name: "token", type: "address" }],
    name: "closePositionToken",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [
      { name: "user", type: "address" },
      { name: "token", type: "address" },
    ],
    name: "getTokenUnrealizedPnL",
    outputs: [
      { name: "hasProfit", type: "bool" },
      { name: "pnl", type: "uint256" },
    ],
    stateMutability: "view",
    type: "function",
  },
] as const;

const PRICE_FEED_ABI = [
  {
    inputs: [{ name: "token", type: "address" }],
    name: "getTokenMarkPrice",
    outputs: [{ type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [],
    name: "getSupportedTokens",
    outputs: [{ type: "address[]" }],
    stateMutability: "view",
    type: "function",
  },
] as const;

interface Wallet {
  privateKey: string;
  address: string;
  index: number;
}

function loadWallets(): Wallet[] {
  const walletsPath = path.resolve(__dirname, "../../Namespace/scripts/market-maker/wallets.json");
  const data = fs.readFileSync(walletsPath, "utf-8");
  return JSON.parse(data).wallets;
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function main() {
  console.log("========== Perpetual Batch Test ==========\n");

  const publicClient = createPublicClient({
    chain: baseSepolia,
    transport: http(RPC_URL),
  });

  const wallets = loadWallets();
  console.log(`Loaded ${wallets.length} wallets`);

  // Get supported tokens
  const supportedTokens = await publicClient.readContract({
    address: CONTRACTS.PRICE_FEED,
    abi: PRICE_FEED_ABI,
    functionName: "getSupportedTokens",
  });

  console.log(`Found ${supportedTokens.length} supported tokens`);
  if (supportedTokens.length === 0) {
    console.log("No supported tokens. Add tokens to PriceFeed first.");
    return;
  }

  const testToken = supportedTokens[0] as Address;
  console.log(`Using token: ${testToken}`);

  // Get mark price
  const markPrice = await publicClient.readContract({
    address: CONTRACTS.PRICE_FEED,
    abi: PRICE_FEED_ABI,
    functionName: "getTokenMarkPrice",
    args: [testToken],
  });
  console.log(`Mark price: ${formatUnits(markPrice, 18)} ETH\n`);

  // Test parameters
  const size = parseEther("0.05"); // 0.05 ETH position
  const leverageMultiplier = 5n; // 5x leverage
  const leverage = leverageMultiplier * LEVERAGE_PRECISION; // 50000
  const collateral = (size * LEVERAGE_PRECISION) / leverage; // 0.01 ETH
  const depositAmount = parseEther("0.02"); // Deposit a bit more for fees

  let successfulOpens = 0;
  let successfulCloses = 0;
  let failedOpens = 0;
  let failedCloses = 0;

  // Test with first 10 wallets that have enough balance
  const testWallets = wallets.slice(0, 20);
  let testedCount = 0;
  const maxTests = 5;

  for (const wallet of testWallets) {
    if (testedCount >= maxTests) break;

    const balance = await publicClient.getBalance({ address: wallet.address as Address });
    if (balance < parseEther("0.05")) {
      continue;
    }

    testedCount++;
    const account = privateKeyToAccount(wallet.privateKey as `0x${string}`);
    const walletClient = createWalletClient({
      account,
      chain: baseSepolia,
      transport: http(RPC_URL),
    });

    console.log(`\n--- Wallet ${wallet.index} ---`);
    console.log(`Address: ${wallet.address.slice(0, 10)}...`);
    console.log(`Balance: ${formatEther(balance)} ETH`);

    // 1. Check vault balance and deposit if needed
    const vaultBalance = await publicClient.readContract({
      address: CONTRACTS.VAULT,
      abi: VAULT_ABI,
      functionName: "getBalance",
      args: [wallet.address as Address],
    });

    if (vaultBalance < collateral) {
      console.log(`Depositing ${formatEther(depositAmount)} ETH to Vault...`);
      try {
        const depositHash = await walletClient.writeContract({
          address: CONTRACTS.VAULT,
          abi: VAULT_ABI,
          functionName: "deposit",
          value: depositAmount,
        });
        await publicClient.waitForTransactionReceipt({ hash: depositHash });
        console.log(`  ✅ Deposit successful`);
      } catch (e: any) {
        console.log(`  ❌ Deposit failed: ${e.message?.slice(0, 50)}`);
        continue;
      }
    }

    // 2. Open position (randomly long or short)
    const isLong = Math.random() > 0.5;
    console.log(`Opening ${isLong ? "LONG" : "SHORT"} position (${formatEther(size)} ETH, ${leverageMultiplier}x)...`);

    try {
      const openHash = await walletClient.writeContract({
        address: CONTRACTS.POSITION_MANAGER,
        abi: POSITION_MANAGER_ABI,
        functionName: isLong ? "openLongToken" : "openShortToken",
        args: [testToken, size, leverage, 0],
      });
      await publicClient.waitForTransactionReceipt({ hash: openHash });
      console.log(`  ✅ Position opened`);
      successfulOpens++;

      // 3. Check PnL
      await sleep(1000);
      try {
        const [hasProfit, pnl] = await publicClient.readContract({
          address: CONTRACTS.POSITION_MANAGER,
          abi: POSITION_MANAGER_ABI,
          functionName: "getTokenUnrealizedPnL",
          args: [wallet.address as Address, testToken],
        });
        console.log(`  PnL: ${hasProfit ? "+" : "-"}${formatEther(pnl)} ETH`);
      } catch (e) {
        console.log(`  PnL check failed`);
      }

      // 4. Close position
      await sleep(2000);
      console.log(`Closing position...`);
      try {
        const closeHash = await walletClient.writeContract({
          address: CONTRACTS.POSITION_MANAGER,
          abi: POSITION_MANAGER_ABI,
          functionName: "closePositionToken",
          args: [testToken],
        });
        await publicClient.waitForTransactionReceipt({ hash: closeHash });
        console.log(`  ✅ Position closed`);
        successfulCloses++;
      } catch (e: any) {
        console.log(`  ❌ Close failed: ${e.message?.slice(0, 100)}`);
        failedCloses++;
      }

    } catch (e: any) {
      console.log(`  ❌ Open failed: ${e.message?.slice(0, 100)}`);
      failedOpens++;
    }

    await sleep(1000);
  }

  // Summary
  console.log("\n========== Test Summary ==========");
  console.log(`Wallets tested: ${testedCount}`);
  console.log(`Successful opens: ${successfulOpens}`);
  console.log(`Failed opens: ${failedOpens}`);
  console.log(`Successful closes: ${successfulCloses}`);
  console.log(`Failed closes: ${failedCloses}`);
}

main().catch(console.error);
