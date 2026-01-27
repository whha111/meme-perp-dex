import { createPublicClient, http, formatEther } from "viem";
import { baseSepolia } from "viem/chains";
import * as fs from "fs";

const RPC_URL = "https://base-sepolia.g.alchemy.com/v2/Dr8sMe-1MYIF7jBYuZZj8PMOPAAeJ16d";
const WALLETS_PATH = "/Users/qinlinqiu/Desktop/Namespace/scripts/market-maker/wallets.json";

async function main() {
  const client = createPublicClient({
    chain: baseSepolia,
    transport: http(RPC_URL),
  });

  const data = JSON.parse(fs.readFileSync(WALLETS_PATH, "utf-8"));
  const wallets = data.wallets;

  console.log("=== 检查全部200个测试钱包余额 ===\n");

  let totalBalance = 0n;
  let walletsWithBalance = 0;

  for (let i = 0; i < wallets.length; i++) {
    const wallet = wallets[i];
    const balance = await client.getBalance({ address: wallet.address as `0x${string}` });
    totalBalance += balance;
    if (balance > 0n) walletsWithBalance++;

    if ((i + 1) % 50 === 0) {
      console.log("已检查 " + (i + 1) + "/200...");
    }
  }

  console.log("\n=== 结果 ===");
  console.log("有余额的钱包: " + walletsWithBalance + "/200");
  console.log("总余额: " + formatEther(totalBalance) + " ETH");
}

main().catch(console.error);
