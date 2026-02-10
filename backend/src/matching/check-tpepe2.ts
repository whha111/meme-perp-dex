import { createPublicClient, http, formatEther } from "viem";
import { baseSepolia } from "viem/chains";

const client = createPublicClient({ chain: baseSepolia, transport: http("https://sepolia.base.org") });
const TPEPE2 = "0x9ab99d816b7e98d904f6a74098a490cd48dfa63f" as `0x${string}`;
const TOKEN_FACTORY = "0x8de2Ce2a0f974b4CB00EC5B56BD89382690b5523" as `0x${string}`;

const ABI = [
  { type: "function", name: "getPoolState", inputs: [{ name: "tokenAddress", type: "address" }], outputs: [{ name: "", type: "tuple", components: [{ name: "realETHReserve", type: "uint256" }, { name: "realTokenReserve", type: "uint256" }, { name: "soldTokens", type: "uint256" }, { name: "isGraduated", type: "bool" }, { name: "isActive", type: "bool" }, { name: "creator", type: "address" }, { name: "createdAt", type: "uint64" }, { name: "metadataURI", type: "string" }, { name: "graduationFailed", type: "bool" }, { name: "graduationAttempts", type: "uint8" }]}], stateMutability: "view" },
  { type: "function", name: "getCurrentPrice", inputs: [{ name: "tokenAddress", type: "address" }], outputs: [{ name: "", type: "uint256" }], stateMutability: "view" },
  { type: "function", name: "GRADUATION_THRESHOLD", inputs: [], outputs: [{ name: "", type: "uint256" }], stateMutability: "view" },
] as const;

const TOKEN_ABI = [
  { type: "function", name: "isMintingLocked", inputs: [], outputs: [{ name: "", type: "bool" }], stateMutability: "view" },
  { type: "function", name: "totalSupply", inputs: [], outputs: [{ name: "", type: "uint256" }], stateMutability: "view" },
] as const;

async function main() {
  const pool = await client.readContract({ address: TOKEN_FACTORY, abi: ABI, functionName: "getPoolState", args: [TPEPE2] }) as any;
  const price = await client.readContract({ address: TOKEN_FACTORY, abi: ABI, functionName: "getCurrentPrice", args: [TPEPE2] });
  const locked = await client.readContract({ address: TPEPE2, abi: TOKEN_ABI, functionName: "isMintingLocked" });

  let threshold: bigint;
  try {
    threshold = await client.readContract({ address: TOKEN_FACTORY, abi: ABI, functionName: "GRADUATION_THRESHOLD" });
  } catch {
    threshold = 793000000n * 10n ** 18n; // default
  }

  const soldTokens = pool.soldTokens ?? pool[2];
  const progress = Number(soldTokens * 10000n / threshold) / 100;

  console.log("=== TPEPE2 状态 ===");
  console.log("isActive:", pool.isActive ?? pool[4]);
  console.log("isGraduated:", pool.isGraduated ?? pool[3]);
  console.log("graduationFailed:", pool.graduationFailed ?? pool[8]);
  console.log("graduationAttempts:", pool.graduationAttempts ?? pool[9]);
  console.log("isMintingLocked:", locked);
  console.log("currentPrice:", formatEther(price), "ETH");
  console.log("realETHReserve:", formatEther(pool.realETHReserve ?? pool[0]), "ETH");
  console.log("realTokenReserve:", formatEther(pool.realTokenReserve ?? pool[1]), "tokens");
  console.log("soldTokens:", formatEther(soldTokens), "tokens");
  console.log("进度:", progress.toFixed(2) + "%");
}
main().catch(console.error);
