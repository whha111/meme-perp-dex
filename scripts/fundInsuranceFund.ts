import { createPublicClient, createWalletClient, http, formatEther, parseEther, type Address } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { baseSepolia } from "viem/chains";

const RPC_URL = "https://base-sepolia-rpc.publicnode.com";
// AUDIT-FIX DP-C01: Read key from env
const DEPLOYER_KEY = (process.env.DEPLOYER_PRIVATE_KEY || process.env.PRIVATE_KEY) as `0x${string}`;
if (!DEPLOYER_KEY) { console.error("Set DEPLOYER_PRIVATE_KEY env var"); process.exit(1); }
const INSURANCE_FUND = "0xe92f0cd02bf8f6849c698b4f0271f28f0c29ac02" as Address;

const client = createPublicClient({ chain: baseSepolia, transport: http(RPC_URL) });
const account = privateKeyToAccount(DEPLOYER_KEY);
const walletClient = createWalletClient({ account, chain: baseSepolia, transport: http(RPC_URL) });

async function main() {
  const balance = await client.getBalance({ address: account.address });
  console.log("Deployer Balance:", formatEther(balance), "ETH");

  // Fund with smaller amount
  const fundAmount = parseEther("0.001");
  console.log("Funding InsuranceFund with", formatEther(fundAmount), "ETH...");

  const hash = await walletClient.sendTransaction({
    to: INSURANCE_FUND,
    value: fundAmount,
  });

  await client.waitForTransactionReceipt({ hash });
  console.log("Done! Tx:", hash);

  const ifBalance = await client.getBalance({ address: INSURANCE_FUND });
  console.log("InsuranceFund Balance:", formatEther(ifBalance), "ETH");
}

main().catch(e => console.error(e.message));
