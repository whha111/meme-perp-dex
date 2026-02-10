import { createWalletClient, createPublicClient, http, parseEther, formatEther, type Address } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { baseSepolia } from "viem/chains";
import fs from "fs";

const TOKEN_FACTORY = "0x583d35e9d407Ea03dE5A2139e792841353CB67b1" as Address;

const ABI = [
  {
    type: "function", name: "createToken",
    inputs: [
      { name: "name", type: "string" },
      { name: "symbol", type: "string" },
      { name: "metadataURI", type: "string" },
      { name: "minTokensOut", type: "uint256" },
    ],
    outputs: [{ name: "tokenAddress", type: "address" }],
    stateMutability: "payable",
  },
  {
    type: "function", name: "serviceFee",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
  },
  {
    type: "function", name: "getCurrentPrice",
    inputs: [{ name: "tokenAddress", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
  },
] as const;

const wallets = JSON.parse(fs.readFileSync("main-wallets.json", "utf-8"));
// 用 wallet[9]，余额 0.57 ETH
const account = privateKeyToAccount(wallets[9].privateKey);
console.log("Using wallet[9]:", account.address);

const client = createWalletClient({
  account,
  chain: baseSepolia,
  transport: http("https://sepolia.base.org"),
});
const publicClient = createPublicClient({
  chain: baseSepolia,
  transport: http("https://sepolia.base.org"),
});

async function main() {
  const fee = await publicClient.readContract({ address: TOKEN_FACTORY, abi: ABI, functionName: "serviceFee" });
  console.log("Service fee:", formatEther(fee), "ETH");

  // metadata: base64 encoded JSON with name, description, image
  const metadata = Buffer.from(JSON.stringify({
    name: "Test Pepe 3",
    description: "Meme token for testing graduation fix - round 3",
    image: "https://i.imgur.com/71Lj1zA.png"
  })).toString("base64");

  const metadataURI = `data:application/json;base64,${metadata}`;
  const createValue = fee + parseEther("0.05"); // fee + first buy
  console.log("Creating TPEPE3, value:", formatEther(createValue), "ETH");

  const hash = await client.writeContract({
    address: TOKEN_FACTORY,
    abi: ABI,
    functionName: "createToken",
    args: ["Test Pepe 3", "TPEPE3", metadataURI, 1n],
    value: createValue,
  });

  console.log("TX:", hash);
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  console.log("Status:", receipt.status);
  console.log("Gas used:", receipt.gasUsed.toString());

  // Extract token address from logs
  for (const log of receipt.logs) {
    if (log.address.toLowerCase() === TOKEN_FACTORY.toLowerCase() && log.topics[1]) {
      const tokenAddress = ("0x" + log.topics[1].slice(26)) as Address;
      console.log("\n🎉 New token: TPEPE3 =", tokenAddress);

      const price = await publicClient.readContract({ address: TOKEN_FACTORY, abi: ABI, functionName: "getCurrentPrice", args: [tokenAddress] });
      console.log("Price:", formatEther(price), "ETH/token");
      return;
    }
  }
}

main().catch(console.error);
