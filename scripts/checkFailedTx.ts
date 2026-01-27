import { createPublicClient, http, formatEther } from "viem";
import { baseSepolia } from "viem/chains";

const client = createPublicClient({
  chain: baseSepolia,
  transport: http("https://base-sepolia-rpc.publicnode.com"),
});

async function main() {
  const txHash = "0x03e27630589a70ff4327bdffa1e7a9aae52d9905b2733f2845cf9e594372452d" as `0x${string}`;

  const tx = await client.getTransaction({ hash: txHash });
  console.log("=== 交易详情 ===");
  console.log("From:", tx.from);
  console.log("To:", tx.to);
  console.log("Value:", formatEther(tx.value), "ETH");

  const receipt = await client.getTransactionReceipt({ hash: txHash });
  console.log("\nStatus:", receipt.status);
  console.log("Gas used:", receipt.gasUsed.toString());
  console.log("Block:", receipt.blockNumber.toString());

  // Decode input
  const selector = tx.input.slice(0, 10);
  console.log("\n函数选择器:", selector);

  // Known selectors
  if (selector === "0x0d392cd9") {
    console.log("函数: openLongToken(address,uint256,uint256,uint8)");
  } else if (selector === "0x8c172fa2") {
    console.log("函数: openShortToken(address,uint256,uint256,uint8)");
  }

  // Parse input data
  const inputData = tx.input.slice(10);
  if (inputData.length >= 256) {
    const token = "0x" + inputData.slice(24, 64);
    const size = BigInt("0x" + inputData.slice(64, 128));
    const leverage = BigInt("0x" + inputData.slice(128, 192));
    const mode = parseInt(inputData.slice(192, 256), 16);

    console.log("\n=== 解析参数 ===");
    console.log("Token:", token);
    console.log("Size:", formatEther(size), "ETH");
    console.log("Leverage:", Number(leverage) / 10000, "x");
    console.log("Mode:", mode, mode === 0 ? "(Isolated)" : "(Cross)");

    // Check if token is registered
    const PRICE_FEED = "0xd69A4DB60cEc962A46C6B9Bc8CC0883081c4eFb7";
    const PRICE_FEED_ABI = [
      {
        inputs: [{ name: "token", type: "address" }],
        name: "getTokenMarkPrice",
        outputs: [{ type: "uint256" }],
        stateMutability: "view",
        type: "function",
      },
      {
        inputs: [{ name: "token", type: "address" }],
        name: "tokenConfigs",
        outputs: [
          { name: "isRegistered", type: "bool" },
          { name: "maxLeverage", type: "uint256" },
          { name: "maintenanceMargin", type: "uint256" },
          { name: "fundingRateMultiplier", type: "uint256" },
        ],
        stateMutability: "view",
        type: "function",
      },
    ] as const;

    console.log("\n=== 检查 Token 状态 ===");
    try {
      const config = await client.readContract({
        address: PRICE_FEED as `0x${string}`,
        abi: PRICE_FEED_ABI,
        functionName: "tokenConfigs",
        args: [token as `0x${string}`],
      });
      console.log("Token 已注册:", config[0]);
      console.log("最大杠杆:", Number(config[1]) / 10000, "x");
      console.log("维持保证金:", Number(config[2]) / 100, "%");

      if (Number(leverage) > Number(config[1])) {
        console.log("\n❌ 错误原因: 杠杆超过最大限制!");
        console.log("  请求杠杆:", Number(leverage) / 10000, "x");
        console.log("  最大杠杆:", Number(config[1]) / 10000, "x");
      }
    } catch (e: any) {
      console.log("Token 配置查询失败:", e.message?.slice(0, 100));
    }

    try {
      const price = await client.readContract({
        address: PRICE_FEED as `0x${string}`,
        abi: PRICE_FEED_ABI,
        functionName: "getTokenMarkPrice",
        args: [token as `0x${string}`],
      });
      console.log("Token 价格:", formatEther(price), "ETH");
      if (price === 0n) {
        console.log("\n❌ 错误原因: Token 价格为0!");
      }
    } catch (e: any) {
      console.log("价格查询失败:", e.message?.slice(0, 100));
    }

    // Check user's vault balance
    const VAULT = "0x467a18E3Ec98587Cd88683E6F9e1792C480C09c7";
    const VAULT_ABI = [
      {
        inputs: [{ name: "user", type: "address" }],
        name: "getBalance",
        outputs: [{ type: "uint256" }],
        stateMutability: "view",
        type: "function",
      },
    ] as const;

    console.log("\n=== 检查用户 Vault 余额 ===");
    const userBalance = await client.readContract({
      address: VAULT as `0x${string}`,
      abi: VAULT_ABI,
      functionName: "getBalance",
      args: [tx.from],
    });
    console.log("用户 Vault 余额:", formatEther(userBalance), "ETH");

    const requiredCollateral = (size * 10000n) / leverage;
    console.log("需要的保证金:", formatEther(requiredCollateral), "ETH");

    if (userBalance < requiredCollateral) {
      console.log("\n❌ 错误原因: Vault 余额不足!");
    }
  }

  // Check logs
  console.log("\n=== 交易 Logs ===");
  console.log("Logs 数量:", receipt.logs.length);
  for (const log of receipt.logs) {
    console.log("  Log from:", log.address);
  }
}

main().catch(console.error);
