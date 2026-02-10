import { createWalletClient, createPublicClient, http, parseEther, formatEther, type Address } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { baseSepolia } from "viem/chains";
import fs from "fs";

const TOKEN_FACTORY = "0x583d35e9d407Ea03dE5A2139e792841353CB67b1" as Address;
const TEST_TOKEN = "0x8c219589db787c1a5b57b1d2075c76c0d3f51c73" as Address;

const ABI = [
  { type: "function", name: "buy", inputs: [{ name: "tokenAddress", type: "address" }, { name: "minTokensOut", type: "uint256" }], outputs: [], stateMutability: "payable" },
] as const;

const wallets = JSON.parse(fs.readFileSync("main-wallets.json", "utf-8"));
const account = privateKeyToAccount(wallets[1].privateKey);
console.log("Using wallet[1]:", account.address);

const client = createWalletClient({ account, chain: baseSepolia, transport: http("https://sepolia.base.org") });
const publicClient = createPublicClient({ chain: baseSepolia, transport: http("https://sepolia.base.org") });

async function main() {
  console.log("🧪 Testing buy AFTER graduation failed (should still work with fix)...");
  try {
    const hash = await client.writeContract({
      address: TOKEN_FACTORY, abi: ABI, functionName: "buy",
      args: [TEST_TOKEN, 0n],
      value: parseEther("0.01"),
    });
    console.log("TX:", hash);
    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    console.log("Status:", receipt.status);
    console.log("✅ Buy succeeded! Token is still tradeable after graduation failure!");
  } catch (err: any) {
    console.error("❌ Buy failed:", err.shortMessage || err.message);
    console.log("This means the token is still dead after graduation failure.");
  }
}

main().catch(console.error);
