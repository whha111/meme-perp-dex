import { createPublicClient, createWalletClient, http, parseEther, formatEther } from "viem";
import { baseSepolia } from "viem/chains";
import { privateKeyToAccount } from "viem/accounts";
import * as fs from "fs";

const RPC_URL = "https://base-sepolia.g.alchemy.com/v2/Dr8sMe-1MYIF7jBYuZZj8PMOPAAeJ16d";
const TOKEN_FACTORY = "0xCfDCD9F8D39411cF855121331B09aef1C88dc056";
const TOKEN_123 = "0x01c6058175eda34fc8922eeae32bc383cb203211";

const FACTORY_ABI = [
  {
    inputs: [{ name: "tokenAddress", type: "address" }, { name: "minTokensOut", type: "uint256" }],
    name: "buy",
    outputs: [],
    stateMutability: "payable",
    type: "function",
  },
  {
    inputs: [{ name: "tokenAddress", type: "address" }],
    name: "getCurrentPrice",
    outputs: [{ type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [{ name: "tokenAddress", type: "address" }],
    name: "getPoolState",
    outputs: [{
      components: [
        { name: "realETHReserve", type: "uint256" },
        { name: "realTokenReserve", type: "uint256" },
        { name: "soldTokens", type: "uint256" },
        { name: "isGraduated", type: "bool" },
        { name: "isActive", type: "bool" },
        { name: "creator", type: "address" },
        { name: "createdAt", type: "uint64" },
        { name: "metadataURI", type: "string" },
      ],
      type: "tuple",
    }],
    stateMutability: "view",
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

  console.log("=== 测试: 买入 123token ===");
  console.log("钱包地址:", account.address);

  // 获取当前价格
  const price = await publicClient.readContract({
    address: TOKEN_FACTORY as `0x${string}`,
    abi: FACTORY_ABI,
    functionName: "getCurrentPrice",
    args: [TOKEN_123 as `0x${string}`],
  });
  console.log("当前价格:", formatEther(price), "ETH/token");

  // 获取池子状态
  const poolState = await publicClient.readContract({
    address: TOKEN_FACTORY as `0x${string}`,
    abi: FACTORY_ABI,
    functionName: "getPoolState",
    args: [TOKEN_123 as `0x${string}`],
  });
  console.log("池子ETH储备:", formatEther(poolState.realETHReserve), "ETH");
  console.log("池子状态:", poolState.isActive ? "活跃" : "非活跃");

  // 买入 0.01 ETH 的代币
  const buyAmount = parseEther("0.01");
  console.log("\n买入金额:", formatEther(buyAmount), "ETH");

  try {
    const hash = await walletClient.writeContract({
      address: TOKEN_FACTORY as `0x${string}`,
      abi: FACTORY_ABI,
      functionName: "buy",
      args: [TOKEN_123 as `0x${string}`, 0n], // minTokensOut = 0 for testing
      value: buyAmount,
    });

    console.log("交易哈希:", hash);

    // 等待确认
    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    console.log("交易状态:", receipt.status === "success" ? "✅ 成功" : "❌ 失败");
    console.log("区块号:", receipt.blockNumber);
    console.log("Gas使用:", receipt.gasUsed.toString());

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
