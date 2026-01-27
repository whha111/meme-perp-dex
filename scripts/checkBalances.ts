import { createPublicClient, http } from "viem";
import { baseSepolia } from "viem/chains";
import * as fs from "fs";

const RPC_URL = "https://base-sepolia.g.alchemy.com/v2/Dr8sMe-1MYIF7jBYuZZj8PMOPAAeJ16d";
const SETTLEMENT = "0xB06C32C7536EC5EAD101fEe2AD4005a5eedcB258";

const ABI = [
  { inputs: [{ name: "user", type: "address" }], name: "getUserBalance", outputs: [{ name: "available", type: "uint256" }, { name: "locked", type: "uint256" }], stateMutability: "view", type: "function" },
] as const;

const publicClient = createPublicClient({
  chain: baseSepolia,
  transport: http(RPC_URL),
});

const walletsData = JSON.parse(fs.readFileSync("/Users/qinlinqiu/Desktop/Namespace/scripts/market-maker/wallets.json", "utf-8"));

async function main() {
  let totalAvailable = 0n;
  let walletsWithBalance = 0;

  console.log("=== 检查钱包余额 ===\n");

  for (let i = 0; i < 50; i++) {
    const wallet = walletsData.wallets[i];
    const balance = await publicClient.readContract({
      address: SETTLEMENT as `0x${string}`,
      abi: ABI,
      functionName: "getUserBalance",
      args: [wallet.address],
    });

    if (balance[0] > 0n || balance[1] > 0n) {
      console.log(`钱包${i}: available=${balance[0]}, locked=${balance[1]}`);
      totalAvailable += balance[0];
      walletsWithBalance++;
    }
  }

  console.log(`\n总计: ${walletsWithBalance}个钱包有余额, 总可用=${totalAvailable}`);
}
main();
