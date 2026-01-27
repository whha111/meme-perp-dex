import { createPublicClient, createWalletClient, http, parseEther, formatEther, formatUnits } from "viem";
import { baseSepolia } from "viem/chains";
import { privateKeyToAccount } from "viem/accounts";
import * as fs from "fs";

const RPC_URL = "https://base-sepolia.g.alchemy.com/v2/Dr8sMe-1MYIF7jBYuZZj8PMOPAAeJ16d";
const TOKEN_FACTORY = "0xCfDCD9F8D39411cF855121331B09aef1C88dc056";
const TOKEN_123 = "0x01c6058175eda34fc8922eeae32bc383cb203211";

const FACTORY_ABI = [
  {
    inputs: [{ name: "tokenAddress", type: "address" }, { name: "tokenAmount", type: "uint256" }, { name: "minETHOut", type: "uint256" }],
    name: "sell",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [{ name: "tokenAddress", type: "address" }],
    name: "getCurrentPrice",
    outputs: [{ type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
] as const;

const ERC20_ABI = [
  {
    inputs: [{ name: "account", type: "address" }],
    name: "balanceOf",
    outputs: [{ type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [{ name: "spender", type: "address" }, { name: "amount", type: "uint256" }],
    name: "approve",
    outputs: [{ type: "bool" }],
    stateMutability: "nonpayable",
    type: "function",
  },
] as const;

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

  console.log("=== 测试: 卖出 123token ===");
  console.log("钱包地址:", account.address);

  // 检查代币余额
  const tokenBalance = await publicClient.readContract({
    address: TOKEN_123 as `0x${string}`,
    abi: ERC20_ABI,
    functionName: "balanceOf",
    args: [account.address],
  });
  console.log("代币余额:", formatEther(tokenBalance), "123");

  if (tokenBalance === 0n) {
    console.log("没有代币可卖，请先买入");
    return;
  }

  // 获取当前价格
  const price = await publicClient.readContract({
    address: TOKEN_FACTORY as `0x${string}`,
    abi: FACTORY_ABI,
    functionName: "getCurrentPrice",
    args: [TOKEN_123 as `0x${string}`],
  });
  console.log("当前价格:", formatEther(price), "ETH/token");

  // 卖出一半
  const sellAmount = tokenBalance / 2n;
  console.log("\n卖出数量:", formatEther(sellAmount), "123");

  try {
    // 先授权
    console.log("授权中...");
    const approveHash = await walletClient.writeContract({
      address: TOKEN_123 as `0x${string}`,
      abi: ERC20_ABI,
      functionName: "approve",
      args: [TOKEN_FACTORY as `0x${string}`, sellAmount],
    });
    await publicClient.waitForTransactionReceipt({ hash: approveHash });
    console.log("授权成功");

    // 卖出
    const hash = await walletClient.writeContract({
      address: TOKEN_FACTORY as `0x${string}`,
      abi: FACTORY_ABI,
      functionName: "sell",
      args: [TOKEN_123 as `0x${string}`, sellAmount, 0n],
    });

    console.log("交易哈希:", hash);

    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    console.log("交易状态:", receipt.status === "success" ? "✅ 成功" : "❌ 失败");
    console.log("区块号:", receipt.blockNumber);

    // 获取新价格
    const newPrice = await publicClient.readContract({
      address: TOKEN_FACTORY as `0x${string}`,
      abi: FACTORY_ABI,
      functionName: "getCurrentPrice",
      args: [TOKEN_123 as `0x${string}`],
    });
    console.log("\n新价格:", formatEther(newPrice), "ETH/token");
    console.log("价格变化:", ((Number(newPrice) - Number(price)) / Number(price) * 100).toFixed(4), "%");

  } catch (e: any) {
    console.error("交易失败:", e.message?.slice(0, 500));
  }
}

main().catch(console.error);
