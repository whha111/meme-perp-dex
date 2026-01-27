import { createPublicClient, http, formatUnits } from "viem";
import { baseSepolia } from "viem/chains";

const RPC_URL = "https://base-sepolia.g.alchemy.com/v2/Dr8sMe-1MYIF7jBYuZZj8PMOPAAeJ16d";
const TOKEN_FACTORY = "0xCfDCD9F8D39411cF855121331B09aef1C88dc056";
const TOKEN_123 = "0x01c6058175eDA34Fc8922EeAe32BC383CB203211";

const ABI = [
  {
    name: "getCurrentPrice",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "tokenAddress", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    name: "getPoolState",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "tokenAddress", type: "address" }],
    outputs: [{
      components: [
        { name: "realETHReserve", type: "uint256" },
        { name: "realTokenReserve", type: "uint256" },
        { name: "soldTokens", type: "uint256" },
        { name: "isGraduated", type: "bool" },
        { name: "isActive", type: "bool" },
        { name: "creator", type: "address" },
        { name: "createdAt", type: "uint64" },
        { name: "metadataURI", type: "string" },
      ],
      type: "tuple",
    }],
  },
] as const;

async function main() {
  const client = createPublicClient({
    chain: baseSepolia,
    transport: http(RPC_URL),
  });

  console.log("Testing TokenFactory price calls...\n");

  try {
    const price = await client.readContract({
      address: TOKEN_FACTORY as `0x${string}`,
      abi: ABI,
      functionName: "getCurrentPrice",
      args: [TOKEN_123 as `0x${string}`],
    });
    console.log("getCurrentPrice:", price.toString(), "(" + formatUnits(price, 18) + " ETH)");

    // Convert to USD (assuming ETH = $3000)
    const priceUSD = Number(price) / 1e18 * 3000;
    console.log("In USD: $" + priceUSD.toFixed(10));
  } catch (e: any) {
    console.log("getCurrentPrice ERROR:", e.message);
  }

  try {
    const state = await client.readContract({
      address: TOKEN_FACTORY as `0x${string}`,
      abi: ABI,
      functionName: "getPoolState",
      args: [TOKEN_123 as `0x${string}`],
    });
    console.log("\nPoolState:");
    console.log("  realETHReserve:", formatUnits(state.realETHReserve, 18), "ETH");
    console.log("  realTokenReserve:", formatUnits(state.realTokenReserve, 18));
    console.log("  isActive:", state.isActive);
  } catch (e: any) {
    console.log("getPoolState ERROR:", e.message);
  }
}

main();
