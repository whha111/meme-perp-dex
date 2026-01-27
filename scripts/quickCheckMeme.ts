import { createPublicClient, http, formatEther, type Address } from "viem";
import { baseSepolia } from "viem/chains";
import * as fs from "fs";

const client = createPublicClient({
  chain: baseSepolia,
  transport: http("https://base-sepolia.g.alchemy.com/v2/Dr8sMe-1MYIF7jBYuZZj8PMOPAAeJ16d"),
});

const TOKEN_FACTORY = "0xE0ddf67E89f5773c960Bc2329109815E8c66BAAe" as Address;
const wallets = JSON.parse(fs.readFileSync("/Users/qinlinqiu/Desktop/Namespace/scripts/market-maker/wallets.json", "utf-8")).wallets;

const TOKEN_FACTORY_ABI = [{
  inputs: [],
  name: "getAllTokens",
  outputs: [{ type: "address[]" }],
  stateMutability: "view",
  type: "function",
}] as const;

const ERC20_ABI = [{
  inputs: [{ name: "account", type: "address" }],
  name: "balanceOf",
  outputs: [{ type: "uint256" }],
  stateMutability: "view",
  type: "function",
}, {
  inputs: [],
  name: "symbol",
  outputs: [{ type: "string" }],
  stateMutability: "view",
  type: "function",
}] as const;

async function main() {
  const tokens = await client.readContract({ address: TOKEN_FACTORY, abi: TOKEN_FACTORY_ABI, functionName: "getAllTokens" }) as Address[];
  console.log("共 " + tokens.length + " 个代币\n");

  let totalHoldings = 0;

  // 只检查前10个钱包
  for (let i = 0; i < 10; i++) {
    const addr = wallets[i].address as Address;
    let hasHolding = false;

    for (const token of tokens) {
      try {
        const bal = await client.readContract({ address: token, abi: ERC20_ABI, functionName: "balanceOf", args: [addr] });
        if (bal > 0n) {
          if (!hasHolding) {
            console.log("钱包 #" + i + ":");
            hasHolding = true;
          }
          const sym = await client.readContract({ address: token, abi: ERC20_ABI, functionName: "symbol" });
          console.log("  " + sym + ": " + formatEther(bal));
          totalHoldings++;
        }
      } catch {}
    }
  }

  console.log("\n前10个钱包共有 " + totalHoldings + " 个持仓");
}
main().catch(console.error);
