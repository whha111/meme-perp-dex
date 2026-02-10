import { createWalletClient, createPublicClient, http, parseEther, formatEther, type Address } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { baseSepolia } from "viem/chains";
import fs from "fs";

const TOKEN_FACTORY = "0x8de2Ce2a0f974b4CB00EC5B56BD89382690b5523" as Address;

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
  {
    type: "function", name: "getPoolState",
    inputs: [{ name: "tokenAddress", type: "address" }],
    outputs: [{ name: "", type: "tuple", components: [
      { name: "realETHReserve", type: "uint256" },
      { name: "realTokenReserve", type: "uint256" },
      { name: "soldTokens", type: "uint256" },
      { name: "isGraduated", type: "bool" },
      { name: "isActive", type: "bool" },
      { name: "creator", type: "address" },
      { name: "createdAt", type: "uint64" },
      { name: "metadataURI", type: "string" },
    ]}],
    stateMutability: "view",
  },
] as const;

// 用主钱包[0]创建
const wallets = JSON.parse(fs.readFileSync("main-wallets.json", "utf-8"));
const account = privateKeyToAccount(wallets[0].privateKey);

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
  // 查 serviceFee
  const fee = await publicClient.readContract({ address: TOKEN_FACTORY, abi: ABI, functionName: "serviceFee" });
  console.log("Service fee:", formatEther(fee), "ETH");

  // 用 0.1 ETH 创建代币 (fee + 首次购买)
  const createValue = fee + parseEther("0.05"); // fee + 0.05 ETH 首次购买
  console.log("Creating TPEPE2 with", formatEther(createValue), "ETH...");

  const hash = await client.writeContract({
    address: TOKEN_FACTORY,
    abi: ABI,
    functionName: "createToken",
    args: ["Test Pepe 2", "TPEPE2", "data:application/json;base64,eyJuYW1lIjoiVGVzdCBQZXBlIDIiLCJkZXNjcmlwdGlvbiI6IlRlc3QgdG9rZW4gZm9yIGRldiIsImltYWdlIjoiaHR0cHM6Ly9pLmltZ3VyLmNvbS83MUxqMXpBLnBuZyJ9", 1n],
    value: createValue,
  });

  console.log("TX:", hash);
  console.log("Waiting for confirmation...");

  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  console.log("Status:", receipt.status);

  // 从 logs 中提取新代币地址
  // TokenCreated event
  for (const log of receipt.logs) {
    if (log.address.toLowerCase() === TOKEN_FACTORY.toLowerCase()) {
      // First topic is the event signature, look for address in topics or data
      console.log("Log topics:", log.topics);
      console.log("Log data:", log.data);
      // TokenCreated(address indexed tokenAddress, string name, string symbol, address creator)
      if (log.topics[1]) {
        const tokenAddress = "0x" + log.topics[1].slice(26);
        console.log("\n🎉 New token address:", tokenAddress);

        // Verify
        const price = await publicClient.readContract({ address: TOKEN_FACTORY, abi: ABI, functionName: "getCurrentPrice", args: [tokenAddress as Address] });
        console.log("Initial price:", formatEther(price), "ETH/token");

        const pool = await publicClient.readContract({ address: TOKEN_FACTORY, abi: ABI, functionName: "getPoolState", args: [tokenAddress as Address] }) as any;
        console.log("isActive:", pool.isActive);
        console.log("isGraduated:", pool.isGraduated);
      }
    }
  }
}

main().catch(console.error);
