import { createPublicClient, http, formatEther } from "viem";
import { baseSepolia } from "viem/chains";

const ADDRESS = "0x94c0D111E54D5A26c35d0a36aEeF6f29c480B480";

const client = createPublicClient({
  chain: baseSepolia,
  transport: http("https://sepolia.base.org"),
});

console.log("=== 检查到账情况 ===");
console.log("地址:", ADDRESS);

const balance = await client.getBalance({ address: ADDRESS });
const eth = formatEther(balance);

console.log("💰 余额:", eth, "ETH");

if (balance > 0n) {
  console.log("✅ 已到账！");
} else {
  console.log("⏳ 未到账，请等待区块确认...");
}
