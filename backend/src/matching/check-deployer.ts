import { createPublicClient, http, formatEther } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { baseSepolia } from "viem/chains";

const DEPLOYER_KEY = "0xf9a07bb59ea400ef88bfbcf314d89f357c8580d1a4fb543e48cfb98b02b41d2c";
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
