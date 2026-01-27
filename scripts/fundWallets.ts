/**
 * Fund Test Wallets Script
 *
 * Distributes ETH from deployer wallet to test wallets
 */

import {
  createPublicClient,
  createWalletClient,
  http,
  parseEther,
  formatEther,
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

// Deployer private key (from contracts/.env)
const DEPLOYER_PRIVATE_KEY = "0xf9a07bb59ea400ef88bfbcf314d89f357c8580d1a4fb543e48cfb98b02b41d2c";

// Amount to send to each wallet
const AMOUNT_PER_WALLET = parseEther("0.01"); // 0.01 ETH per wallet

// Number of wallets to fund
const NUM_WALLETS_TO_FUND = 30;

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
// Main
// ============================================================

async function main() {
  console.log("========== Fund Test Wallets ==========\n");

  const publicClient = createPublicClient({
    chain: baseSepolia,
    transport: http(RPC_URL),
  });

  const deployerAccount = privateKeyToAccount(DEPLOYER_PRIVATE_KEY as `0x${string}`);
  const walletClient = createWalletClient({
    account: deployerAccount,
    chain: baseSepolia,
    transport: http(RPC_URL),
  });

  // Check deployer balance
  const deployerBalance = await publicClient.getBalance({
    address: deployerAccount.address,
  });

  console.log(`Deployer address: ${deployerAccount.address}`);
  console.log(`Deployer balance: ${formatEther(deployerBalance)} ETH`);

  const totalNeeded = AMOUNT_PER_WALLET * BigInt(NUM_WALLETS_TO_FUND);
  console.log(`Total needed: ${formatEther(totalNeeded)} ETH for ${NUM_WALLETS_TO_FUND} wallets`);

  if (deployerBalance < totalNeeded + parseEther("0.1")) {
    console.error("\nInsufficient deployer balance!");
    console.log(`Please fund the deployer with at least ${formatEther(totalNeeded + parseEther("0.1"))} ETH`);
    console.log(`Deployer address: ${deployerAccount.address}`);
    return;
  }

  // Load wallets
  const wallets = loadWallets();
  const walletsToFund = wallets.slice(0, NUM_WALLETS_TO_FUND);

  console.log(`\nFunding ${walletsToFund.length} wallets with ${formatEther(AMOUNT_PER_WALLET)} ETH each...\n`);

  let funded = 0;
  let skipped = 0;

  for (const wallet of walletsToFund) {
    // Check if wallet already has enough balance
    const currentBalance = await publicClient.getBalance({
      address: wallet.address as Address,
    });

    if (currentBalance >= AMOUNT_PER_WALLET / 2n) {
      console.log(`[${wallet.index}] Already has ${formatEther(currentBalance)} ETH - skipping`);
      skipped++;
      continue;
    }

    try {
      const hash = await walletClient.sendTransaction({
        to: wallet.address as Address,
        value: AMOUNT_PER_WALLET,
      });

      console.log(`[${wallet.index}] Sent ${formatEther(AMOUNT_PER_WALLET)} ETH - tx: ${hash}`);

      // Wait for confirmation
      await publicClient.waitForTransactionReceipt({ hash });
      funded++;

      await sleep(500); // Small delay between transactions
    } catch (error: any) {
      console.error(`[${wallet.index}] Error: ${error.message}`);
    }
  }

  console.log(`\n========== Complete ==========`);
  console.log(`Funded: ${funded} wallets`);
  console.log(`Skipped: ${skipped} wallets (already funded)`);

  // Check final deployer balance
  const finalBalance = await publicClient.getBalance({
    address: deployerAccount.address,
  });
  console.log(`\nDeployer remaining balance: ${formatEther(finalBalance)} ETH`);
}

main().catch(console.error);
