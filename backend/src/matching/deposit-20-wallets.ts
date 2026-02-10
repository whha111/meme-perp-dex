/**
 * 存入 ETH 到 Settlement 合约 (前20个派生钱包)
 */
import { createPublicClient, createWalletClient, http, parseEther, formatEther, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { baseSepolia } from "viem/chains";
import fs from "fs";

const SETTLEMENT = "0x35ce4ed5e5d2515Ea05a2f49A70170Fa78e13F7c" as Address;
const RPC_URL = "https://sepolia.base.org";

const SETTLEMENT_ABI = [
  {
    inputs: [],
    name: "depositETH",
    outputs: [],
    stateMutability: "payable",
    type: "function",
  },
  {
    inputs: [{ name: "user", type: "address" }],
    name: "getUserBalance",
    outputs: [
      { name: "available", type: "uint256" },
      { name: "locked", type: "uint256" },
    ],
    stateMutability: "view",
    type: "function",
  },
] as const;

const publicClient = createPublicClient({
  chain: baseSepolia,
  transport: http(RPC_URL),
});

const tradingWallets = JSON.parse(fs.readFileSync("trading-wallets.json", "utf-8"));

async function main() {
  const NUM_WALLETS = 20;
  const depositAmount = parseEther("0.02"); // 存入 0.02 ETH 保证金

  console.log("=== 存入 ETH 到 Settlement (前20个派生钱包) ===");
  console.log(`Settlement: ${SETTLEMENT}`);
  console.log(`每个钱包存入: ${formatEther(depositAmount)} ETH`);
  console.log("");

  let success = 0;
  let fail = 0;
  let skipped = 0;

  for (let i = 0; i < NUM_WALLETS; i++) {
    const wallet = tradingWallets[i];
    const addr = wallet.derivedAddress as Address;

    try {
      // 检查已有 Settlement 余额
      const bal = await publicClient.readContract({
        address: SETTLEMENT,
        abi: SETTLEMENT_ABI,
        functionName: "getUserBalance",
        args: [addr],
      });
      const available = bal[0];

      if (available >= parseEther("0.01")) {
        skipped++;
        console.log(`#${i}: ${addr.slice(0, 10)}... 已有 ${formatEther(available)} ETH, 跳过`);
        continue;
      }

      // 检查 ETH 余额
      const ethBal = await publicClient.getBalance({ address: addr });
      if (ethBal < parseEther("0.025")) {
        fail++;
        console.log(`#${i}: ${addr.slice(0, 10)}... ETH余额不足: ${formatEther(ethBal)} ETH`);
        continue;
      }

      // 存入
      const account = privateKeyToAccount(wallet.privateKey as Hex);
      const client = createWalletClient({
        account,
        chain: baseSepolia,
        transport: http(RPC_URL),
      });

      const hash = await client.writeContract({
        address: SETTLEMENT,
        abi: SETTLEMENT_ABI,
        functionName: "depositETH",
        args: [],
        value: depositAmount,
      });

      success++;
      console.log(`#${i}: ✅ 存入 ${formatEther(depositAmount)} ETH (tx: ${hash.slice(0, 18)}...)`);

      // 同步到 matching engine
      await fetch("http://localhost:8081/api/balance/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ address: addr }),
      }).catch(() => {});

    } catch (e: any) {
      fail++;
      console.log(`#${i}: ❌ 失败: ${e.message?.slice(0, 80)}`);
    }

    await new Promise(r => setTimeout(r, 500));
  }

  console.log(`\n结果: ✅ ${success} 存入 / ⏭️ ${skipped} 跳过 / ❌ ${fail} 失败`);

  // 验证
  console.log("\n--- 验证余额 (前5个) ---");
  for (let i = 0; i < Math.min(5, NUM_WALLETS); i++) {
    const addr = tradingWallets[i].derivedAddress as Address;
    const bal = await publicClient.readContract({
      address: SETTLEMENT,
      abi: SETTLEMENT_ABI,
      functionName: "getUserBalance",
      args: [addr],
    });
    console.log(`#${i}: available=${formatEther(bal[0])} ETH, locked=${formatEther(bal[1])} ETH`);
  }
}

main().catch(console.error);
