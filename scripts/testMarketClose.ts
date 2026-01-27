/**
 * 测试市价平仓 - 关闭仓位
 */
import { createPublicClient, createWalletClient, http, formatUnits } from "viem";
import { baseSepolia } from "viem/chains";
import { privateKeyToAccount } from "viem/accounts";
import * as fs from "fs";

const RPC_URL = "https://base-sepolia.g.alchemy.com/v2/Dr8sMe-1MYIF7jBYuZZj8PMOPAAeJ16d";
const SETTLEMENT = "0xB06C32C7536EC5EAD101fEe2AD4005a5eedcB258";

const SETTLEMENT_ABI = [
  {
    inputs: [{ name: "pairId", type: "uint256" }],
    name: "closePair",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function"
  },
  {
    inputs: [{ name: "pairId", type: "uint256" }],
    name: "getPairedPosition",
    outputs: [{
      type: "tuple",
      components: [
        { name: "pairId", type: "uint256" },
        { name: "longTrader", type: "address" },
        { name: "shortTrader", type: "address" },
        { name: "token", type: "address" },
        { name: "size", type: "uint256" },
        { name: "entryPrice", type: "uint256" },
        { name: "longCollateral", type: "uint256" },
        { name: "shortCollateral", type: "uint256" },
        { name: "longSize", type: "uint256" },
        { name: "shortSize", type: "uint256" },
        { name: "openTime", type: "uint256" },
        { name: "accFundingLong", type: "int256" },
        { name: "accFundingShort", type: "int256" },
        { name: "status", type: "uint8" },
      ]
    }],
    stateMutability: "view",
    type: "function"
  },
  {
    inputs: [{ name: "user", type: "address" }],
    name: "getUserBalance",
    outputs: [
      { name: "available", type: "uint256" },
      { name: "locked", type: "uint256" }
    ],
    stateMutability: "view",
    type: "function"
  },
] as const;

async function main() {
  const walletsData = JSON.parse(fs.readFileSync("/Users/qinlinqiu/Desktop/Namespace/scripts/market-maker/wallets.json", "utf-8"));

  // 使用钱包1 (long trader) 来关闭仓位
  const traderWallet = walletsData.wallets[0];
  const traderAccount = privateKeyToAccount(traderWallet.privateKey as `0x${string}`);

  const publicClient = createPublicClient({
    chain: baseSepolia,
    transport: http(RPC_URL),
  });

  const walletClient = createWalletClient({
    account: traderAccount,
    chain: baseSepolia,
    transport: http(RPC_URL),
  });

  console.log("=== 测试: 市价平仓 ===");
  console.log("交易者:", traderAccount.address);

  // 检查仓位状态
  const pairId = 3n; // 之前开的仓位
  console.log("\n--- 仓位信息 (关闭前) ---");

  const position = await publicClient.readContract({
    address: SETTLEMENT as `0x${string}`,
    abi: SETTLEMENT_ABI,
    functionName: "getPairedPosition",
    args: [pairId],
  });

  console.log("pairId:", position.pairId.toString());
  console.log("longTrader:", position.longTrader);
  console.log("shortTrader:", position.shortTrader);
  console.log("size:", position.size.toString());
  console.log("entryPrice:", position.entryPrice.toString());
  console.log("longCollateral:", position.longCollateral.toString());
  console.log("shortCollateral:", position.shortCollateral.toString());
  console.log("status:", position.status === 0 ? "ACTIVE" : position.status === 1 ? "CLOSED" : "LIQUIDATED");

  if (position.status !== 0) {
    console.log("\n仓位已关闭或已清算，无需操作");
    return;
  }

  // 检查余额 (关闭前)
  const longBalance = await publicClient.readContract({
    address: SETTLEMENT as `0x${string}`,
    abi: SETTLEMENT_ABI,
    functionName: "getUserBalance",
    args: [position.longTrader],
  });
  const shortBalance = await publicClient.readContract({
    address: SETTLEMENT as `0x${string}`,
    abi: SETTLEMENT_ABI,
    functionName: "getUserBalance",
    args: [position.shortTrader],
  });

  console.log("\n--- 余额 (关闭前) ---");
  console.log(`多头 (${position.longTrader.slice(0, 10)}...): available=${longBalance[0]}, locked=${longBalance[1]}`);
  console.log(`空头 (${position.shortTrader.slice(0, 10)}...): available=${shortBalance[0]}, locked=${shortBalance[1]}`);

  // 关闭仓位
  console.log("\n--- 关闭仓位 ---");
  try {
    const hash = await walletClient.writeContract({
      address: SETTLEMENT as `0x${string}`,
      abi: SETTLEMENT_ABI,
      functionName: "closePair",
      args: [pairId],
    });

    console.log("交易哈希:", hash);
    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    console.log("状态:", receipt.status === "success" ? "✅ 成功" : "❌ 失败");

    // 检查仓位状态 (关闭后)
    const positionAfter = await publicClient.readContract({
      address: SETTLEMENT as `0x${string}`,
      abi: SETTLEMENT_ABI,
      functionName: "getPairedPosition",
      args: [pairId],
    });
    console.log("\n--- 仓位状态 (关闭后) ---");
    console.log("status:", positionAfter.status === 0 ? "ACTIVE" : positionAfter.status === 1 ? "CLOSED" : "LIQUIDATED");

    // 检查余额 (关闭后)
    const longBalanceAfter = await publicClient.readContract({
      address: SETTLEMENT as `0x${string}`,
      abi: SETTLEMENT_ABI,
      functionName: "getUserBalance",
      args: [position.longTrader],
    });
    const shortBalanceAfter = await publicClient.readContract({
      address: SETTLEMENT as `0x${string}`,
      abi: SETTLEMENT_ABI,
      functionName: "getUserBalance",
      args: [position.shortTrader],
    });

    console.log("\n--- 余额 (关闭后) ---");
    console.log(`多头 (${position.longTrader.slice(0, 10)}...): available=${longBalanceAfter[0]}, locked=${longBalanceAfter[1]}`);
    console.log(`空头 (${position.shortTrader.slice(0, 10)}...): available=${shortBalanceAfter[0]}, locked=${shortBalanceAfter[1]}`);

    // 计算PnL
    const longDiff = Number(longBalanceAfter[0]) + Number(longBalanceAfter[1]) - Number(longBalance[0]) - Number(longBalance[1]);
    const shortDiff = Number(shortBalanceAfter[0]) + Number(shortBalanceAfter[1]) - Number(shortBalance[0]) - Number(shortBalance[1]);
    console.log("\n--- PnL ---");
    console.log(`多头PnL: ${longDiff >= 0 ? '+' : ''}${longDiff}`);
    console.log(`空头PnL: ${shortDiff >= 0 ? '+' : ''}${shortDiff}`);

  } catch (e: any) {
    console.error("关闭失败:", e.message?.slice(0, 500));
  }
}

main().catch(console.error);
