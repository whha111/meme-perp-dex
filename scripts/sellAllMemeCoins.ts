/**
 * 卖出测试钱包持有的所有 meme 币，换成 ETH
 */

import {
  createPublicClient,
  createWalletClient,
  http,
  formatEther,
  type Address,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { baseSepolia } from "viem/chains";
import * as fs from "fs";

const RPC_URL = "https://base-sepolia.g.alchemy.com/v2/Dr8sMe-1MYIF7jBYuZZj8PMOPAAeJ16d";
const WALLETS_PATH = "/Users/qinlinqiu/Desktop/Namespace/scripts/market-maker/wallets.json";

const TOKEN_FACTORY = "0xE0ddf67E89f5773c960Bc2329109815E8c66BAAe" as Address;

const TOKEN_FACTORY_ABI = [
  {
    inputs: [],
    name: "getAllTokens",
    outputs: [{ type: "address[]" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [
      { name: "tokenAddress", type: "address" },
      { name: "tokenAmount", type: "uint256" },
      { name: "minETHOut", type: "uint256" },
    ],
    name: "sell",
    outputs: [],
    stateMutability: "nonpayable",
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
    inputs: [
      { name: "spender", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    name: "approve",
    outputs: [{ type: "bool" }],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [],
    name: "symbol",
    outputs: [{ type: "string" }],
    stateMutability: "view",
    type: "function",
  },
] as const;

interface Wallet {
  privateKey: string;
  address: string;
  index: number;
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function main() {
  const client = createPublicClient({
    chain: baseSepolia,
    transport: http(RPC_URL),
  });

  const data = JSON.parse(fs.readFileSync(WALLETS_PATH, "utf-8"));
  const wallets: Wallet[] = data.wallets;

  console.log("=== 卖出所有 meme 币换成 ETH ===\n");

  // 1. 获取所有代币地址
  const allTokens = await client.readContract({
    address: TOKEN_FACTORY,
    abi: TOKEN_FACTORY_ABI,
    functionName: "getAllTokens",
  }) as Address[];

  console.log("TokenFactory 中共有 " + allTokens.length + " 个代币\n");

  let totalEthReceived = 0n;
  let sellCount = 0;

  // 2. 遍历每个钱包
  for (let i = 0; i < wallets.length; i++) {
    const wallet = wallets[i];
    const address = wallet.address as Address;

    // 检查钱包是否有足够 gas
    const ethBalance = await client.getBalance({ address });
    if (ethBalance < 50000000000000n) { // < 0.00005 ETH
      continue; // 跳过没有 gas 的钱包
    }

    // 3. 检查每个代币的余额
    for (const token of allTokens) {
      try {
        const tokenBalance = await client.readContract({
          address: token,
          abi: ERC20_ABI,
          functionName: "balanceOf",
          args: [address],
        });

        if (tokenBalance > 0n) {
          // 获取代币符号
          let symbol = "???";
          try {
            symbol = await client.readContract({
              address: token,
              abi: ERC20_ABI,
              functionName: "symbol",
            });
          } catch {}

          console.log("[" + i + "] 卖出 " + formatEther(tokenBalance) + " " + symbol);

          // 记录卖出前的 ETH 余额
          const ethBefore = await client.getBalance({ address });

          const account = privateKeyToAccount(wallet.privateKey as Hex);
          const walletClient = createWalletClient({
            account,
            chain: baseSepolia,
            transport: http(RPC_URL),
          });

          // Approve
          try {
            const approveHash = await walletClient.writeContract({
              address: token,
              abi: ERC20_ABI,
              functionName: "approve",
              args: [TOKEN_FACTORY, tokenBalance],
            });
            await client.waitForTransactionReceipt({ hash: approveHash });
          } catch (e: any) {
            console.log("  Approve 失败: " + e.message.slice(0, 50));
            continue;
          }

          // Sell
          try {
            const sellHash = await walletClient.writeContract({
              address: TOKEN_FACTORY,
              abi: TOKEN_FACTORY_ABI,
              functionName: "sell",
              args: [token, tokenBalance, 0n],
            });
            await client.waitForTransactionReceipt({ hash: sellHash });

            // 计算获得的 ETH
            const ethAfter = await client.getBalance({ address });
            const ethGained = ethAfter - ethBefore;
            if (ethGained > 0n) {
              totalEthReceived += ethGained;
              console.log("  获得 " + formatEther(ethGained) + " ETH");
            }

            sellCount++;
            await sleep(300);
          } catch (e: any) {
            console.log("  Sell 失败: " + e.message.slice(0, 50));
          }
        }
      } catch {}
    }

    // 进度显示
    if ((i + 1) % 50 === 0) {
      console.log("\n已处理 " + (i + 1) + "/200 个钱包...\n");
    }
  }

  console.log("\n=== 卖出完成 ===");
  console.log("成功卖出: " + sellCount + " 笔");
  console.log("总共获得约: " + formatEther(totalEthReceived) + " ETH");

  // 最终检查测试钱包总余额
  let finalTotal = 0n;
  for (const w of wallets) {
    const bal = await client.getBalance({ address: w.address as Address });
    finalTotal += bal;
  }
  console.log("\n测试钱包最终总余额: " + formatEther(finalTotal) + " ETH");
}

main().catch(console.error);
