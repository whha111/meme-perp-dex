import { createPublicClient, http, formatEther } from "viem";
import { baseSepolia } from "viem/chains";
import fs from "fs";

const client = createPublicClient({ chain: baseSepolia, transport: http("https://sepolia.base.org") });
const wallets = JSON.parse(fs.readFileSync("main-wallets.json", "utf-8"));

// Check first 10 wallets
for (let i = 0; i < 10; i++) {
  const bal = await client.getBalance({ address: wallets[i].address });
  console.log(`Wallet[${i}]: ${formatEther(bal)} ETH`);
}

// Also check user wallet
const userBal = await client.getBalance({ address: "0xaecb229194314999e396468eb091b42e44bc3c8c" });
console.log(`\nUser wallet: ${formatEther(userBal)} ETH`);
