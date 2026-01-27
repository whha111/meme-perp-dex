/**
 * Perpetual Trading Test Script
 *
 * Tests the PositionManager contract with multiple test wallets
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

// ============================================================
// Configuration
// ============================================================

const RPC_URL = "https://base-sepolia.g.alchemy.com/v2/Dr8sMe-1MYIF7jBYuZZj8PMOPAAeJ16d";

const CONTRACTS = {
  TOKEN_FACTORY: "0xE0ddf67E89f5773c960Bc2329109815E8c66BAAe" as Address,
  POSITION_MANAGER: "0x72E9a39aD581e78DF55fD14D803eD05fB6413660" as Address,
  VAULT: "0x467a18E3Ec98587Cd88683E6F9e1792C480C09c7" as Address,
  PRICE_FEED: "0xd69A4DB60cEc962A46C6B9Bc8CC0883081c4eFb7" as Address,
  READER: "0xD107aB399645ab54869D53e9301850763E890D4F" as Address,
};

// PositionManager ABI
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
    stateMutability: "payable",
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
    stateMutability: "payable",
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
    name: "getPositionByToken",
    outputs: [
      {
        components: [
          { name: "size", type: "uint256" },
          { name: "collateral", type: "uint256" },
          { name: "entryPrice", type: "uint256" },
          { name: "leverage", type: "uint256" },
          { name: "isLong", type: "bool" },
          { name: "lastFundingIndex", type: "int256" },
          { name: "openTime", type: "uint256" },
        ],
        type: "tuple",
      },
    ],
    stateMutability: "view",
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
  {
    inputs: [
      { name: "user", type: "address" },
      { name: "token", type: "address" },
    ],
    name: "getTokenLiquidationPrice",
    outputs: [{ type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [
      { name: "user", type: "address" },
      { name: "token", type: "address" },
    ],
    name: "getTokenMarginRatio",
    outputs: [{ type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
] as const;

// PriceFeed ABI
const PRICE_FEED_ABI = [
  {
    inputs: [{ name: "token", type: "address" }],
    name: "getTokenMarkPrice",
    outputs: [{ type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
] as const;

// TokenFactory ABI
const TOKEN_FACTORY_ABI = [
  {
    inputs: [],
    name: "getAllTokens",
    outputs: [{ type: "address[]" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [{ name: "tokenAddress", type: "address" }],
    name: "getPoolState",
    outputs: [
      {
        components: [
          { name: "realETHReserve", type: "uint256" },
          { name: "realTokenReserve", type: "uint256" },
          { name: "soldTokens", type: "uint256" },
          { name: "isGraduated", type: "bool" },
          { name: "isActive", type: "bool" },
          { name: "creator", type: "address" },
          { name: "createdAt", type: "uint64" },
          { name: "metadataURI", type: "string" },
        ],
        type: "tuple",
      },
    ],
    stateMutability: "view",
    type: "function",
  },
] as const;

// ============================================================
// Types
// ============================================================

interface Wallet {
  privateKey: string;
  address: string;
  index: number;
}

interface WalletsFile {
  wallets: Wallet[];
  count: number;
}

// ============================================================
// Utilities
// ============================================================

function loadWallets(): Wallet[] {
  const walletsPath = path.resolve(__dirname, "../../Namespace/scripts/market-maker/wallets.json");
  const data = fs.readFileSync(walletsPath, "utf-8");
  const walletsFile: WalletsFile = JSON.parse(data);
  return walletsFile.wallets;
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ============================================================
// Main Test
// ============================================================

async function main() {
  console.log("========== Perpetual Trading Test ==========\n");

  const publicClient = createPublicClient({
    chain: baseSepolia,
    transport: http(RPC_URL),
  });

  const wallets = loadWallets();
  console.log(`Loaded ${wallets.length} wallets`);

  // Get available tokens
  console.log("\n--- Getting Available Tokens ---");
  const allTokens = await publicClient.readContract({
    address: CONTRACTS.TOKEN_FACTORY,
    abi: TOKEN_FACTORY_ABI,
    functionName: "getAllTokens",
  });

  console.log(`Found ${allTokens.length} tokens`);

  if (allTokens.length === 0) {
    console.log("No tokens available for testing. Run tradingBot.ts first.");
    return;
  }

  // Pick a few active tokens
  const activeTokens: Address[] = [];
  for (const token of allTokens.slice(-5)) {
    try {
      const poolState = await publicClient.readContract({
        address: CONTRACTS.TOKEN_FACTORY,
        abi: TOKEN_FACTORY_ABI,
        functionName: "getPoolState",
        args: [token as Address],
      });

      if (poolState.isActive && !poolState.isGraduated) {
        activeTokens.push(token as Address);
        console.log(`Active token: ${token}`);
      }
    } catch (e) {
      // Skip
    }
  }

  if (activeTokens.length === 0) {
    console.log("No active tokens found");
    return;
  }

  const testToken = activeTokens[0];
  console.log(`\nUsing test token: ${testToken}`);

  // Get current price
  try {
    const markPrice = await publicClient.readContract({
      address: CONTRACTS.PRICE_FEED,
      abi: PRICE_FEED_ABI,
      functionName: "getTokenMarkPrice",
      args: [testToken],
    });
    console.log(`Current mark price: ${formatUnits(markPrice, 18)} ETH`);
  } catch (e: any) {
    console.log(`Price not available: ${e.message}`);
  }

  // Test with wallets that have sufficient balance
  const testWallets = wallets.slice(0, 10);
  let successfulTests = 0;
  let failedTests = 0;

  console.log("\n--- Running Perpetual Tests ---\n");

  for (const wallet of testWallets) {
    const balance = await publicClient.getBalance({ address: wallet.address as Address });

    if (balance < parseEther("0.02")) {
      console.log(`[Wallet ${wallet.index}] Insufficient balance: ${formatEther(balance)} ETH`);
      continue;
    }

    const account = privateKeyToAccount(wallet.privateKey as `0x${string}`);
    const walletClient = createWalletClient({
      account,
      chain: baseSepolia,
      transport: http(RPC_URL),
    });

    // Test 1: Open Long Position
    console.log(`\n[Wallet ${wallet.index}] Opening LONG position...`);

    const size = parseEther("0.01"); // 0.01 ETH position size
    const leverageMultiplier = 5n; // 5x leverage
    const LEVERAGE_PRECISION = 10000n;
    const leverage = leverageMultiplier * LEVERAGE_PRECISION; // 50000 for 5x
    const collateral = (size * LEVERAGE_PRECISION) / leverage; // Required collateral

    try {
      const hash = await walletClient.writeContract({
        address: CONTRACTS.POSITION_MANAGER,
        abi: POSITION_MANAGER_ABI,
        functionName: "openLongToken",
        args: [testToken, size, leverage, 0], // mode 0 = isolated
        value: collateral,
      });

      console.log(`  Tx: ${hash}`);
      const receipt = await publicClient.waitForTransactionReceipt({ hash });

      if (receipt.status === "success") {
        console.log(`  ✅ Long position opened successfully`);
        successfulTests++;

        // Check position
        await sleep(1000);
        const position = await publicClient.readContract({
          address: CONTRACTS.POSITION_MANAGER,
          abi: POSITION_MANAGER_ABI,
          functionName: "getPositionByToken",
          args: [wallet.address as Address, testToken],
        });

        console.log(`  Position size: ${formatEther(position.size)} ETH`);
        console.log(`  Collateral: ${formatEther(position.collateral)} ETH`);
        console.log(`  Entry price: ${formatUnits(position.entryPrice, 18)}`);
        console.log(`  Leverage: ${position.leverage}x`);
        console.log(`  Is Long: ${position.isLong}`);

        // Get PnL
        try {
          const [hasProfit, pnl] = await publicClient.readContract({
            address: CONTRACTS.POSITION_MANAGER,
            abi: POSITION_MANAGER_ABI,
            functionName: "getTokenUnrealizedPnL",
            args: [wallet.address as Address, testToken],
          });
          console.log(`  Unrealized PnL: ${hasProfit ? "+" : "-"}${formatEther(pnl)} ETH`);
        } catch (e) {
          console.log(`  PnL calculation error`);
        }

        // Get liquidation price
        try {
          const liqPrice = await publicClient.readContract({
            address: CONTRACTS.POSITION_MANAGER,
            abi: POSITION_MANAGER_ABI,
            functionName: "getTokenLiquidationPrice",
            args: [wallet.address as Address, testToken],
          });
          console.log(`  Liquidation price: ${formatUnits(liqPrice, 18)}`);
        } catch (e) {
          console.log(`  Liquidation price error`);
        }

        // Close position after a short delay
        await sleep(2000);
        console.log(`\n[Wallet ${wallet.index}] Closing position...`);

        try {
          const closeHash = await walletClient.writeContract({
            address: CONTRACTS.POSITION_MANAGER,
            abi: POSITION_MANAGER_ABI,
            functionName: "closePositionToken",
            args: [testToken],
          });

          console.log(`  Tx: ${closeHash}`);
          const closeReceipt = await publicClient.waitForTransactionReceipt({ hash: closeHash });

          if (closeReceipt.status === "success") {
            console.log(`  ✅ Position closed successfully`);
            successfulTests++;
          } else {
            console.log(`  ❌ Close failed`);
            failedTests++;
          }
        } catch (e: any) {
          console.log(`  ❌ Close error: ${e.message?.slice(0, 100)}`);
          failedTests++;
        }

      } else {
        console.log(`  ❌ Transaction failed`);
        failedTests++;
      }
    } catch (e: any) {
      console.log(`  ❌ Error: ${e.message?.slice(0, 200)}`);
      failedTests++;
    }

    await sleep(2000);
  }

  // Summary
  console.log("\n========== Test Summary ==========");
  console.log(`Successful tests: ${successfulTests}`);
  console.log(`Failed tests: ${failedTests}`);
  console.log(`Total: ${successfulTests + failedTests}`);
}

main().catch(console.error);
