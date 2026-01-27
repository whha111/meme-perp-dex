import { createPublicClient, createWalletClient, http, formatEther, parseEther, type Address } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { baseSepolia } from "viem/chains";

const RPC_URL = "https://base-sepolia-rpc.publicnode.com";
const DEPLOYER_KEY = "0xf9a07bb59ea400ef88bfbcf314d89f357c8580d1a4fb543e48cfb98b02b41d2c";
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
