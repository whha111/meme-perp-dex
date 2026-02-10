import { createPublicClient, http, formatEther } from "viem";
import { base } from "viem/chains";
import fs from "fs";

const wallets = JSON.parse(fs.readFileSync("main-wallets.json", "utf-8"));
const client = createPublicClient({
  chain: base,
  transport: http("https://mainnet.base.org"),
});

console.log("=== 检查 Base 主网（非测试网）===\n");

for (let i = 0; i < 10; i++) {
  const balance = await client.getBalance({ address: wallets[i].address });
  if (balance > 0n) {
    console.log(`✅ #${i + 1}: ${wallets[i].address} = ${formatEther(balance)} ETH`);
  }
  await new Promise(r => setTimeout(r, 300));
}
