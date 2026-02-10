import { createPublicClient, http, formatEther, getAddress } from "viem";
import { baseSepolia } from "viem/chains";
import fs from "fs";
import dotenv from "dotenv";
import path from "path";

dotenv.config({ path: path.resolve(__dirname, "../../../contracts/.env") });
import { privateKeyToAccount } from "viem/accounts";

const publicClient = createPublicClient({ chain: baseSepolia, transport: http("https://base-sepolia-rpc.publicnode.com") });
const wallets = JSON.parse(fs.readFileSync("main-wallets.json", "utf-8"));
const deployer = privateKeyToAccount(process.env.PRIVATE_KEY as `0x${string}`);

async function main() {
  let total = 0n;
  console.log("=== All wallet balances ===");

  // Check deployer
  const deployerBal = await publicClient.getBalance({ address: deployer.address });
  console.log(`deployer: ${deployer.address} = ${formatEther(deployerBal)} ETH`);
  total += deployerBal;

  // Check first 20 wallets
  for (let i = 0; i < Math.min(wallets.length, 200); i++) {
    const bal = await publicClient.getBalance({ address: wallets[i].address });
    if (bal > 0n) {
      console.log(`wallet[${i}]: ${wallets[i].address} = ${formatEther(bal)} ETH`);
      total += bal;
    }
  }

  console.log(`\nTotal available: ${formatEther(total)} ETH`);
}

main().catch(console.error);
