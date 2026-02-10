import { createPublicClient, http, formatEther, parseAbi } from "viem";
import { baseSepolia } from "viem/chains";
import fs from "fs";

const tradingWallets = JSON.parse(fs.readFileSync("trading-wallets.json", "utf-8"));
const VAULT = "0x780E415Ffd8104Ee2EECD7418A9227Bb92ebE294";

const client = createPublicClient({
  chain: baseSepolia,
  transport: http("https://base-sepolia-rpc.publicnode.com"),
});

const abi = parseAbi([
  "function getBalance(address user) view returns (uint256)",
]);

async function main() {
  // Check Vault contract ETH balance
  const contractBal = await client.getBalance({ address: VAULT as `0x${string}` });
  console.log(`Vault 合约总 ETH 余额: ${formatEther(contractBal)} ETH\n`);

  // Check each derived wallet's balance in Vault
  let totalDeposited = 0n;
  let walletsWithDeposit = 0;
  console.log("=== 派生钱包 Vault 保证金 (前10个) ===");
  for (let i = 0; i < tradingWallets.length; i++) {
    try {
      const bal = await client.readContract({
        address: VAULT as `0x${string}`,
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
      if (i < 10) console.log(`#${i}: 读取失败 - ${e.message?.slice(0, 80)}`);
    }
    await new Promise(r => setTimeout(r, 80));
  }
  console.log(`\n有保证金的派生钱包: ${walletsWithDeposit}/${tradingWallets.length}`);
  console.log(`派生钱包总保证金: ${formatEther(totalDeposited)} ETH`);
}

main().catch(console.error);
