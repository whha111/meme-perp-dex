import { createPublicClient, http } from "viem";
import { baseSepolia } from "viem/chains";

const client = createPublicClient({ chain: baseSepolia, transport: http("https://sepolia.base.org") });

const TPEPE = "0x423744F02934B7718888C40134d3C0d00030A551" as `0x${string}`;

const ABI = [
  { type: "function", name: "mintingLocked", inputs: [], outputs: [{ name: "", type: "bool" }], stateMutability: "view" },
  { type: "function", name: "isLocked", inputs: [], outputs: [{ name: "", type: "bool" }], stateMutability: "view" },
  { type: "function", name: "locked", inputs: [], outputs: [{ name: "", type: "bool" }], stateMutability: "view" },
  { type: "function", name: "isMintingLocked", inputs: [], outputs: [{ name: "", type: "bool" }], stateMutability: "view" },
] as const;

for (const fn of ["mintingLocked", "isLocked", "locked", "isMintingLocked"]) {
  try {
    const result = await client.readContract({ address: TPEPE, abi: ABI, functionName: fn as any });
    console.log(`${fn}():`, result);
  } catch (e: any) {
    // not found
  }
}

// Also check who has MINTER_ROLE
const ROLE_ABI = [
  { type: "function", name: "MINTER_ROLE", inputs: [], outputs: [{ name: "", type: "bytes32" }], stateMutability: "view" },
  { type: "function", name: "hasRole", inputs: [{ name: "role", type: "bytes32" }, { name: "account", type: "address" }], outputs: [{ name: "", type: "bool" }], stateMutability: "view" },
] as const;

const TOKEN_FACTORY = "0x8de2Ce2a0f974b4CB00EC5B56BD89382690b5523" as `0x${string}`;

try {
  const minterRole = await client.readContract({ address: TPEPE, abi: ROLE_ABI, functionName: "MINTER_ROLE" });
  console.log("\nMINTER_ROLE:", minterRole);
  
  const factoryHasRole = await client.readContract({ address: TPEPE, abi: ROLE_ABI, functionName: "hasRole", args: [minterRole, TOKEN_FACTORY] });
  console.log("TokenFactory has MINTER_ROLE:", factoryHasRole);
} catch (e: any) {
  console.log("Role check error:", e.shortMessage?.slice(0, 100));
}
