import { createPublicClient, http, formatEther, formatUnits, type Address } from "viem";
import { baseSepolia } from "viem/chains";

const RPC_URL = "https://base-sepolia-rpc.publicnode.com";
const TX_HASH = "0xbf9adb4e97179999f05115524ee292ce790223a2ef7b3db6d63f19456dc820f0" as `0x${string}`;

const client = createPublicClient({
  chain: baseSepolia,
  transport: http(RPC_URL),
});

async function main() {
  console.log("=== 查询交易详情 ===\n");
  console.log("交易哈希:", TX_HASH);

  // 获取交易
  const tx = await client.getTransaction({ hash: TX_HASH });
  console.log("\n--- 交易信息 ---");
  console.log("发送者:", tx.from);
  console.log("接收者:", tx.to);
  console.log("Value:", formatEther(tx.value), "ETH");
  console.log("区块:", tx.blockNumber?.toString());

  // 获取收据
  const receipt = await client.getTransactionReceipt({ hash: TX_HASH });
  console.log("\n--- 交易收据 ---");
  console.log("状态:", receipt.status === "success" ? "✅ 成功" : "❌ 失败");
  console.log("Gas 使用:", receipt.gasUsed.toString());
  console.log("日志数量:", receipt.logs.length);

  // 解析日志
  console.log("\n--- 事件日志 ---");
  for (let idx = 0; idx < receipt.logs.length; idx++) {
    const log = receipt.logs[idx];
    console.log("\n日志 " + (idx + 1) + ":");
    console.log("  合约:", log.address);
    console.log("  主题:", log.topics[0]?.slice(0, 20) + "...");

    // 尝试解析常见事件
    if (log.topics[0] === "0xaf842fa4ca8ace47009009a423f46501cbbc1065bb12234b6288adceb44de538") {
      console.log("  事件: PositionOpened");
    } else if (log.topics[0] === "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef") {
      console.log("  事件: Transfer (ERC20)");
    } else if (log.topics[0] === "0x90890809c654f11d6e72a28fa60149770a0d11ec6c92319d6ceb2bb0a4ea1a15") {
      console.log("  事件: Deposited");
    }
  }

  // 获取区块时间
  const block = await client.getBlock({ blockNumber: tx.blockNumber! });
  console.log("\n--- 区块信息 ---");
  console.log("区块时间:", new Date(Number(block.timestamp) * 1000).toLocaleString());
}

main().catch(console.error);
