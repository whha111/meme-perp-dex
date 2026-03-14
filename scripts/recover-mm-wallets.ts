#!/usr/bin/env bun
/**
 * Batch recover BNB from market maker wallets to deployer
 */
import { createWalletClient, createPublicClient, http, parseEther, formatEther } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { bscTestnet } from "viem/chains";
import walletsData from "/Users/qinlinqiu/Desktop/Namespace/scripts/market-maker/wallets.json";

const DEPLOYER = "0xAecb229194314999E396468eb091b42E44Bc3c8c" as const;
const RPC = "https://data-seed-prebsc-1-s1.binance.org:8545/";
const GAS_LIMIT = 21000n;
const GAS_PRICE = parseEther("0.000000005"); // 5 gwei

const publicClient = createPublicClient({
  chain: bscTestnet,
  transport: http(RPC),
});

async function main() {
  const wallets = walletsData.wallets;
  let totalRecovered = 0n;
  let successCount = 0;
  let skipCount = 0;

  console.log(`Processing ${wallets.length} market maker wallets...`);
  console.log(`Target: ${DEPLOYER}\n`);

  // Process in batches of 10 to avoid RPC rate limits
  for (let i = 0; i < wallets.length; i += 10) {
    const batch = wallets.slice(i, i + 10);
    const promises = batch.map(async (w: any) => {
      try {
        const balance = await publicClient.getBalance({ address: w.address as `0x${string}` });
        const gasCost = GAS_LIMIT * GAS_PRICE;

        if (balance <= gasCost) {
          return { status: "skip", address: w.address, balance };
        }

        const sendAmount = balance - gasCost;
        const account = privateKeyToAccount(w.privateKey as `0x${string}`);
        const walletClient = createWalletClient({
          account,
          chain: bscTestnet,
          transport: http(RPC),
        });

        const hash = await walletClient.sendTransaction({
          to: DEPLOYER,
          value: sendAmount,
          gas: GAS_LIMIT,
          gasPrice: GAS_PRICE,
        });

        return { status: "ok", address: w.address, amount: sendAmount, hash };
      } catch (e: any) {
        return { status: "error", address: w.address, error: e.message?.slice(0, 80) };
      }
    });

    const results = await Promise.all(promises);
    for (const r of results) {
      if (r.status === "ok") {
        totalRecovered += r.amount!;
        successCount++;
        console.log(`✅ ${r.address} → ${formatEther(r.amount!)} BNB`);
      } else if (r.status === "skip") {
        skipCount++;
      } else {
        console.log(`❌ ${r.address}: ${r.error}`);
      }
    }

    if (i + 10 < wallets.length) {
      await new Promise(r => setTimeout(r, 1000)); // Rate limit
    }
  }

  console.log(`\n=== Summary ===`);
  console.log(`Recovered: ${formatEther(totalRecovered)} BNB from ${successCount} wallets`);
  console.log(`Skipped: ${skipCount} (empty/dust)`);
  console.log(`Total wallets: ${wallets.length}`);
}

main().catch(console.error);
