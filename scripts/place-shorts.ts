/**
 * Place SHORT limit orders for testing — reuses market-maker-all.ts patterns
 * Usage: cd backend && source .env && cd ../scripts && bun run place-shorts.ts
 */

import { createWalletClient, http, parseEther, formatEther, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { readFileSync } from "fs";
import { resolve } from "path";
import { bscTestnet } from "viem/chains";

// Config from env
const API_URL = process.env.NEXT_PUBLIC_MATCHING_ENGINE_URL || "http://localhost:8081";
const CHAIN_ID = parseInt(process.env.CHAIN_ID || "97");
const SETTLEMENT = process.env.SETTLEMENT_ADDRESS as Address;

// TOKEN2 address (from URL)
const TOKEN = (process.env.SHORT_TOKEN || "0xf886a4cfada12bc775a891b23c6b3ba9ce4b8744") as Address;

// EIP-712
const EIP712_DOMAIN = { name: "MemePerp" as const, version: "1" as const, chainId: CHAIN_ID, verifyingContract: SETTLEMENT };
const ORDER_TYPES = {
  Order: [
    { name: "trader", type: "address" }, { name: "token", type: "address" },
    { name: "isLong", type: "bool" }, { name: "size", type: "uint256" },
    { name: "leverage", type: "uint256" }, { name: "price", type: "uint256" },
    { name: "deadline", type: "uint256" }, { name: "nonce", type: "uint256" },
    { name: "orderType", type: "uint8" },
  ],
} as const;

const LEV_PREC = 10000n;
const transport = http(process.env.RPC_URL || "https://data-seed-prebsc-1-s1.binance.org:8545/", { timeout: 30_000 });

// Load wallets
const WALLETS_PATH = resolve(import.meta.dir, "../backend/src/matching/main-wallets.json");
const rawWallets: { address: string; privateKey: string }[] = JSON.parse(readFileSync(WALLETS_PATH, "utf-8"));

async function getEnginePrice(): Promise<bigint> {
  const r = await fetch(`${API_URL}/api/stats/${TOKEN.toLowerCase()}`);
  const d = (await r.json()) as any;
  const p = d.price ? Math.floor(parseFloat(d.price) * 1e18) : 0;
  return BigInt(p);
}

async function getNonce(addr: string): Promise<bigint> {
  try {
    const r = await fetch(`${API_URL}/api/user/${addr.toLowerCase()}/nonce`);
    const d = (await r.json()) as any;
    return BigInt(d.nonce || "0");
  } catch { return 0n; }
}

async function getBalance(addr: string): Promise<string> {
  try {
    const r = await fetch(`${API_URL}/api/user/${addr.toLowerCase()}/balance`);
    const d = (await r.json()) as any;
    return d.display?.availableBalance || "0";
  } catch { return "0"; }
}

async function submitOrder(wallet: { acc: any; cli: any; addr: string }, params: {
  token: Address; isLong: boolean; size: bigint; leverage: bigint; price: bigint; orderType: number; nonce: bigint;
}) {
  const msg = {
    trader: wallet.addr as Address,
    token: params.token,
    isLong: params.isLong,
    size: params.size,
    leverage: params.leverage,
    price: params.price,
    deadline: BigInt(Math.floor(Date.now() / 1000) + 3600),
    nonce: params.nonce,
    orderType: params.orderType,
  };
  const sig = await wallet.cli.signTypedData({
    account: wallet.acc,
    domain: EIP712_DOMAIN,
    types: ORDER_TYPES,
    primaryType: "Order",
    message: msg,
  });
  const body = Object.fromEntries(Object.entries(msg).map(([k, v]) => [k, typeof v === "bigint" ? v.toString() : v]));
  const res = await fetch(`${API_URL}/api/order/submit`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...body, signature: sig }),
  });
  return (await res.json()) as any;
}

async function main() {
  console.log("═══ Place SHORT orders ═══");
  console.log(`Token: ${TOKEN}`);
  console.log(`Engine: ${API_URL}`);
  console.log(`Settlement: ${SETTLEMENT}`);

  // Get current price
  const price = await getEnginePrice();
  console.log(`Current price: ${(Number(price) / 1e18).toExponential(4)}`);

  if (price <= 0n) {
    console.error("❌ Cannot get token price");
    process.exit(1);
  }

  // We want 5 BNB total of short orders, split into multiple orders
  // Using different wallets to avoid nonce conflicts
  const TOTAL_BNB = 5;
  const ORDER_COUNT = 5;
  const SIZE_PER = parseEther((TOTAL_BNB / ORDER_COUNT).toString()); // 1 BNB each
  const LEVERAGE = 50n * LEV_PREC; // 50x leverage — less margin needed (~0.02 BNB per order)

  console.log(`\nPlacing ${ORDER_COUNT} SHORT limit orders × ${TOTAL_BNB / ORDER_COUNT} BNB = ${TOTAL_BNB} BNB total`);
  console.log(`Leverage: 50x, Margin needed per order: ~${(TOTAL_BNB / ORDER_COUNT / 50).toFixed(3)} BNB\n`);

  let placed = 0;
  for (let i = 0; i < ORDER_COUNT; i++) {
    const w = rawWallets[i];
    const acc = privateKeyToAccount(w.privateKey as Hex);
    const cli = createWalletClient({ account: acc, chain: bscTestnet, transport });
    const wallet = { acc, cli, addr: w.address };

    const bal = await getBalance(w.address);
    const nonce = await getNonce(w.address);

    // Price slightly above market (limit short = willing to sell at this price or higher)
    const orderPrice = price * (100n + BigInt(i)) / 100n; // 0% to 4% above market

    console.log(`[${i + 1}/${ORDER_COUNT}] Wallet: ${w.address.slice(0, 10)}... | Balance: ${bal} | Nonce: ${nonce}`);
    console.log(`  → SHORT 1 BNB @ ${(Number(orderPrice) / 1e18).toExponential(4)} (${i}% above market)`);

    try {
      const result = await submitOrder(wallet, {
        token: TOKEN,
        isLong: false,
        size: SIZE_PER,
        leverage: LEVERAGE,
        price: orderPrice,
        orderType: 1, // limit order
        nonce,
      });

      if (result.success || result.orderId) {
        console.log(`  ✅ Order placed: ${result.orderId || "ok"}`);
        placed++;
      } else {
        console.log(`  ❌ Failed: ${result.error || JSON.stringify(result)}`);
      }
    } catch (e: any) {
      console.log(`  ❌ Error: ${e.message?.slice(0, 100)}`);
    }
  }

  console.log(`\n═══ Done: ${placed}/${ORDER_COUNT} SHORT orders placed (${placed} BNB total) ═══`);
}

main().catch(console.error);
