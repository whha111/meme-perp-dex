import { createPublicClient, createWalletClient, http, parseEther, formatEther } from "viem";
import { baseSepolia } from "viem/chains";
import { privateKeyToAccount } from "viem/accounts";
import * as fs from "fs";

const RPC_URL = "https://base-sepolia.g.alchemy.com/v2/Dr8sMe-1MYIF7jBYuZZj8PMOPAAeJ16d";
const TOKEN_FACTORY = "0xCfDCD9F8D39411cF855121331B09aef1C88dc056";
const TOKEN_123 = "0x01c6058175eda34fc8922eeae32bc383cb203211";

async function main() {
  const walletsData = JSON.parse(fs.readFileSync("/Users/qinlinqiu/Desktop/Namespace/scripts/market-maker/wallets.json", "utf-8"));
  const wallet = walletsData.wallets[0];
  const account = privateKeyToAccount(wallet.privateKey as `0x${string}`);

  const publicClient = createPublicClient({
    chain: baseSepolia,
    transport: http(RPC_URL),
  });

  const walletClient = createWalletClient({
    account,
    chain: baseSepolia,
    transport: http(RPC_URL),
  });

  console.log("=== 测试: 小额卖出 ===");
  
  // 卖出 1000 个代币
  const sellAmount = parseEther("1000");
  console.log("卖出数量:", formatEther(sellAmount), "123");

  // 先授权
  const approveHash = await walletClient.writeContract({
    address: TOKEN_123 as `0x${string}`,
    abi: [{ inputs: [{ name: "spender", type: "address" }, { name: "amount", type: "uint256" }], name: "approve", outputs: [{ type: "bool" }], stateMutability: "nonpayable", type: "function" }],
    functionName: "approve",
    args: [TOKEN_FACTORY as `0x${string}`, sellAmount],
  });
  await publicClient.waitForTransactionReceipt({ hash: approveHash });
  console.log("授权成功");

  // 卖出
  const hash = await walletClient.writeContract({
    address: TOKEN_FACTORY as `0x${string}`,
    abi: [{ inputs: [{ name: "tokenAddress", type: "address" }, { name: "tokenAmount", type: "uint256" }, { name: "minETHOut", type: "uint256" }], name: "sell", outputs: [], stateMutability: "nonpayable", type: "function" }],
    functionName: "sell",
    args: [TOKEN_123 as `0x${string}`, sellAmount, 0n],
  });

  console.log("交易哈希:", hash);
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  console.log("交易状态:", receipt.status === "success" ? "✅ 成功" : "❌ 失败");
}

main().catch(e => console.error("失败:", e.message?.slice(0, 300)));
