import { createPublicClient, http } from "viem";
import { baseSepolia } from "viem/chains";
import * as fs from "fs";

const RPC_URL = "https://base-sepolia.g.alchemy.com/v2/Dr8sMe-1MYIF7jBYuZZj8PMOPAAeJ16d";
const SETTLEMENT = "0xB06C32C7536EC5EAD101fEe2AD4005a5eedcB258";

const ABI = [
  { inputs: [{ name: "user", type: "address" }], name: "nonces", outputs: [{ type: "uint256" }], stateMutability: "view", type: "function" },
  { inputs: [], name: "nextPairId", outputs: [{ type: "uint256" }], stateMutability: "view", type: "function" },
  { inputs: [{ name: "pairId", type: "uint256" }], name: "getPairedPosition", outputs: [{
    type: "tuple",
    components: [
      { name: "pairId", type: "uint256" },
      { name: "longTrader", type: "address" },
      { name: "shortTrader", type: "address" },
      { name: "token", type: "address" },
      { name: "size", type: "uint256" },
      { name: "entryPrice", type: "uint256" },
      { name: "longCollateral", type: "uint256" },
      { name: "shortCollateral", type: "uint256" },
      { name: "longSize", type: "uint256" },
      { name: "shortSize", type: "uint256" },
      { name: "openTime", type: "uint256" },
      { name: "accFundingLong", type: "int256" },
      { name: "accFundingShort", type: "int256" },
      { name: "status", type: "uint8" },
    ]
  }], stateMutability: "view", type: "function" },
] as const;

const publicClient = createPublicClient({
  chain: baseSepolia,
  transport: http(RPC_URL),
});

const walletsData = JSON.parse(fs.readFileSync("/Users/qinlinqiu/Desktop/Namespace/scripts/market-maker/wallets.json", "utf-8"));

async function main() {
  for (let i = 0; i < 3; i++) {
    const wallet = walletsData.wallets[i];
    const nonce = await publicClient.readContract({
      address: SETTLEMENT as `0x${string}`,
      abi: ABI,
      functionName: "nonces",
      args: [wallet.address],
    });
    console.log(`Wallet ${i}: ${wallet.address} => nonce ${nonce}`);
  }

  // Check nextPairId
  const nextPairId = await publicClient.readContract({
    address: SETTLEMENT as `0x${string}`,
    abi: ABI,
    functionName: "nextPairId",
  });
  console.log(`\nNext Pair ID: ${nextPairId}`);

  // Check latest position if exists
  if (nextPairId > 0n) {
    const pos = await publicClient.readContract({
      address: SETTLEMENT as `0x${string}`,
      abi: ABI,
      functionName: "getPairedPosition",
      args: [nextPairId - 1n],
    });
    console.log(`\nLatest Position (pairId ${nextPairId - 1n}):`);
    console.log(`  longTrader: ${pos.longTrader}`);
    console.log(`  shortTrader: ${pos.shortTrader}`);
    console.log(`  size: ${pos.size}`);
    console.log(`  entryPrice: ${pos.entryPrice}`);
    console.log(`  status: ${pos.status === 0 ? 'ACTIVE' : pos.status === 1 ? 'CLOSED' : 'LIQUIDATED'}`);
  }
}
main();
