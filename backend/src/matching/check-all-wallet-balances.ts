import { createPublicClient, http, formatEther } from "viem";
import { baseSepolia } from "viem/chains";
import fs from "fs";

const mainWallets = JSON.parse(fs.readFileSync("main-wallets.json", "utf-8"));
const tradingWallets = JSON.parse(fs.readFileSync("trading-wallets.json", "utf-8"));
const client = createPublicClient({
  chain: baseSepolia,
  transport: http("https://base-sepolia-rpc.publicnode.com"),
});

async function main() {
  // Check main wallets
  let mainTotal = 0n;
  let mainWithBalance = 0;
  console.log("=== 主钱包 (前5个) ===");
  for (let i = 0; i < mainWallets.length; i++) {
    const bal = await client.getBalance({ address: mainWallets[i].address });
    if (bal > 0n) mainWithBalance++;
    mainTotal += bal;
    if (i < 5) {
      console.log(`#${i}: ${mainWallets[i].address.slice(0, 10)}... = ${formatEther(bal)} ETH`);
    }
    await new Promise(r => setTimeout(r, 80));
  }
  console.log(`\n主钱包总计: ${mainWallets.length}个, 有余额: ${mainWithBalance}个, 总余额: ${formatEther(mainTotal)} ETH`);

  // Check derived wallets
  let derivedTotal = 0n;
  let derivedWithBalance = 0;
  console.log("\n=== 派生钱包 (前5个) ===");
  for (let i = 0; i < tradingWallets.length; i++) {
    const bal = await client.getBalance({ address: tradingWallets[i].derivedAddress });
    if (bal > 0n) derivedWithBalance++;
    derivedTotal += bal;
    if (i < 5) {
      console.log(`#${i}: ${tradingWallets[i].derivedAddress.slice(0, 10)}... = ${formatEther(bal)} ETH`);
    }
    await new Promise(r => setTimeout(r, 80));
  }
  console.log(`\n派生钱包总计: ${tradingWallets.length}个, 有余额: ${derivedWithBalance}个, 总余额: ${formatEther(derivedTotal)} ETH`);
  console.log(`\n=== 总余额: ${formatEther(mainTotal + derivedTotal)} ETH ===`);
}

main().catch(console.error);
