import { createPublicClient, http, formatEther } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { baseSepolia } from "viem/chains";

// AUDIT-FIX DP-C01: Read key from env
const DEPLOYER_KEY = (process.env.DEPLOYER_PRIVATE_KEY || process.env.PRIVATE_KEY) as `0x${string}`;
if (!DEPLOYER_KEY) { console.error("Set DEPLOYER_PRIVATE_KEY env var"); process.exit(1); }
const account = privateKeyToAccount(DEPLOYER_KEY as any);
const client = createPublicClient({
  chain: baseSepolia,
  transport: http("https://base-sepolia-rpc.publicnode.com"),
});

console.log("=== 检查部署账户 ===");
console.log("地址:", account.address);

const balance = await client.getBalance({ address: account.address });
console.log("ETH余额:", formatEther(balance), "ETH");

if (balance > 0n) {
  console.log("✅ 有余额！");
} else {
  console.log("❌ 余额为0");
}
