/**
 * Stress Test - Concurrent Trading with Multiple Wallets
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

const RPC_URL = "https://base-sepolia.g.alchemy.com/v2/Dr8sMe-1MYIF7jBYuZZj8PMOPAAeJ16d";

const CONTRACTS = {
  TOKEN_FACTORY: "0xE0ddf67E89f5773c960Bc2329109815E8c66BAAe" as Address,
};

const TOKEN_FACTORY_ABI = [
  {
    inputs: [
      { name: "tokenAddress", type: "address" },
      { name: "minTokensOut", type: "uint256" },
    ],
    name: "buy",
    outputs: [],
    stateMutability: "payable",
    type: "function",
  },
  {
    inputs: [],
    name: "getAllTokens",
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

async function main() {
  console.log("========== Stress Test: Concurrent Trading ==========\n");

  const publicClient = createPublicClient({
    chain: baseSepolia,
    transport: http(RPC_URL),
  });

  const wallets = loadWallets();
  console.log(`Loaded ${wallets.length} wallets`);

  // Get tokens
  const tokens = await publicClient.readContract({
    address: CONTRACTS.TOKEN_FACTORY,
    abi: TOKEN_FACTORY_ABI,
    functionName: "getAllTokens",
  });

  console.log(`Found ${tokens.length} tokens`);
  if (tokens.length === 0) return;

  // Select recent active tokens
  const testTokens = tokens.slice(-5) as Address[];
  console.log(`Testing with ${testTokens.length} tokens\n`);

  // Find wallets with balance
  const eligibleWallets: Wallet[] = [];
  for (const wallet of wallets.slice(0, 100)) {
    const balance = await publicClient.getBalance({ address: wallet.address as Address });
    if (balance >= parseEther("0.005")) {
      eligibleWallets.push(wallet);
    }
    if (eligibleWallets.length >= 20) break;
  }

  console.log(`Found ${eligibleWallets.length} wallets with sufficient balance\n`);

  // Create concurrent buy transactions
  console.log("=== Starting Concurrent Buys ===\n");

  const startTime = Date.now();
  const buyPromises: Promise<{ wallet: number; success: boolean; error?: string }>[] = [];

  for (let i = 0; i < Math.min(10, eligibleWallets.length); i++) {
    const wallet = eligibleWallets[i];
    const token = testTokens[i % testTokens.length];
    const buyAmount = parseEther((0.001 + Math.random() * 0.004).toFixed(4));

    const account = privateKeyToAccount(wallet.privateKey as `0x${string}`);
    const walletClient = createWalletClient({
      account,
      chain: baseSepolia,
      transport: http(RPC_URL),
    });

    const promise = (async () => {
      try {
        const hash = await walletClient.writeContract({
          address: CONTRACTS.TOKEN_FACTORY,
          abi: TOKEN_FACTORY_ABI,
          functionName: "buy",
          args: [token, 0n],
          value: buyAmount,
        });

        await publicClient.waitForTransactionReceipt({ hash });
        console.log(`[${wallet.index}] ✅ Bought ${formatEther(buyAmount)} ETH of ${token.slice(0, 10)}...`);
        return { wallet: wallet.index, success: true };
      } catch (e: any) {
        console.log(`[${wallet.index}] ❌ Failed: ${e.message?.slice(0, 50)}`);
        return { wallet: wallet.index, success: false, error: e.message };
      }
    })();

    buyPromises.push(promise);
  }

  // Wait for all concurrent transactions
  console.log(`\nWaiting for ${buyPromises.length} concurrent transactions...\n`);
  const results = await Promise.all(buyPromises);

  const endTime = Date.now();
  const duration = (endTime - startTime) / 1000;

  // Summary
  const successful = results.filter(r => r.success).length;
  const failed = results.filter(r => !r.success).length;

  console.log("\n========== Stress Test Results ==========");
  console.log(`Total transactions: ${results.length}`);
  console.log(`Successful: ${successful}`);
  console.log(`Failed: ${failed}`);
  console.log(`Duration: ${duration.toFixed(2)} seconds`);
  console.log(`TPS: ${(results.length / duration).toFixed(2)} tx/sec`);
}

main().catch(console.error);
