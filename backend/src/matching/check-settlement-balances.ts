import { createPublicClient, http, formatEther, parseAbi } from "viem";
import { baseSepolia } from "viem/chains";
import fs from "fs";

const tradingWallets = JSON.parse(fs.readFileSync("trading-wallets.json", "utf-8"));
const SETTLEMENT = "0x35ce4ed5e5d2515Ea05a2f49A70170Fa78e13F7c";

const client = createPublicClient({
  chain: baseSepolia,
  transport: http("https://base-sepolia-rpc.publicnode.com"),
});

const abi = parseAbi([
  "function getBalance(address trader) view returns (uint256)",
]);

async function main() {
  // Check Settlement contract ETH balance
  const contractBal = await client.getBalance({ address: SETTLEMENT as `0x${string}` });
  console.log(`Settlement 合约总余额: ${formatEther(contractBal)} ETH\n`);

  // Check each derived wallet's balance in Settlement
  let totalDeposited = 0n;
  let walletsWithDeposit = 0;
  console.log("=== 派生钱包 Settlement 余额 (前10个) ===");
  for (let i = 0; i < tradingWallets.length; i++) {
    try {
      const bal = await client.readContract({
        address: SETTLEMENT as `0x${string}`,
        abi,
        functionName: "getBalance",
        args: [tradingWallets[i].derivedAddress as `0x${string}`],
      });
      if (bal > 0n) walletsWithDeposit++;
      totalDeposited += bal;
      if (i < 10) {
        console.log(`#${i}: ${tradingWallets[i].derivedAddress.slice(0, 10)}... = ${formatEther(bal)} ETH`);
      }
    } catch (e: any) {
      if (i < 10) console.log(`#${i}: 读取失败 - ${e.message?.slice(0, 50)}`);
    }
    await new Promise(r => setTimeout(r, 80));
  }
  console.log(`\n有保证金的派生钱包: ${walletsWithDeposit}/${tradingWallets.length}`);
  console.log(`派生钱包总保证金: ${formatEther(totalDeposited)} ETH`);
}

main().catch(console.error);
