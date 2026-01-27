import { createPublicClient, http, formatEther, formatUnits, type Address } from "viem";
import { baseSepolia } from "viem/chains";
import * as fs from "fs";

const RPC_URL = "https://base-sepolia.g.alchemy.com/v2/Dr8sMe-1MYIF7jBYuZZj8PMOPAAeJ16d";
const WALLETS_PATH = "/Users/qinlinqiu/Desktop/Namespace/scripts/market-maker/wallets.json";

const SETTLEMENT_ADDRESS = "0x8dd0De655628c0E8255e3d6c38c3DF2BE36e4D8d" as Address;
const USDT_ADDRESS = "0x223095F2c63DB913Baa46FdC2f401E65cB8799F4" as Address;

const SETTLEMENT_ABI = [
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

const ERC20_ABI = [
  {
    inputs: [{ name: "account", type: "address" }],
    name: "balanceOf",
    outputs: [{ type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
] as const;

async function main() {
  const client = createPublicClient({
    chain: baseSepolia,
    transport: http(RPC_URL),
  });

  const data = JSON.parse(fs.readFileSync(WALLETS_PATH, "utf-8"));
  const wallets = data.wallets;

  console.log("=== 检查所有200个测试钱包余额 ===\n");

  let totalEth = 0n;
  let totalUsdt = 0n;
  let totalSettlementAvailable = 0n;
  let totalSettlementLocked = 0n;
  let walletsWithEth = 0;
  let walletsWithUsdt = 0;
  let walletsWithSettlement = 0;

  const results: any[] = [];

  for (let i = 0; i < wallets.length; i++) {
    const wallet = wallets[i];
    const address = wallet.address as Address;

    try {
      // Get ETH balance
      const ethBalance = await client.getBalance({ address });

      // Get USDT balance
      let usdtBalance = 0n;
      try {
        usdtBalance = await client.readContract({
          address: USDT_ADDRESS,
          abi: ERC20_ABI,
          functionName: "balanceOf",
          args: [address],
        });
      } catch {}

      // Get Settlement balance
      let settlementAvail = 0n;
      let settlementLocked = 0n;
      try {
        const [avail, locked] = await client.readContract({
          address: SETTLEMENT_ADDRESS,
          abi: SETTLEMENT_ABI,
          functionName: "getUserBalance",
          args: [address],
        });
        settlementAvail = avail;
        settlementLocked = locked;
      } catch {}

      totalEth += ethBalance;
      totalUsdt += usdtBalance;
      totalSettlementAvailable += settlementAvail;
      totalSettlementLocked += settlementLocked;

      if (ethBalance > 0n) walletsWithEth++;
      if (usdtBalance > 0n) walletsWithUsdt++;
      if (settlementAvail > 0n || settlementLocked > 0n) walletsWithSettlement++;

      // Only print non-zero balances
      if (ethBalance > 0n || usdtBalance > 0n || settlementAvail > 0n) {
        results.push({
          index: wallet.index,
          address,
          eth: formatEther(ethBalance),
          usdt: formatUnits(usdtBalance, 6),
          settlementAvail: formatUnits(settlementAvail, 6),
          settlementLocked: formatUnits(settlementLocked, 6),
        });
      }
    } catch (e: any) {
      console.log("[" + i + "] Error: " + e.message);
    }

    // Progress indicator
    if ((i + 1) % 50 === 0) {
      console.log("已检查 " + (i + 1) + "/200 个钱包...");
    }
  }

  console.log("\n=== 有余额的钱包 ===\n");
  for (const r of results) {
    console.log("[" + r.index + "] " + r.address.slice(0, 10) + "...");
    console.log("    ETH: " + r.eth + ", USDT: " + r.usdt + ", Settlement: " + r.settlementAvail + "/" + r.settlementLocked);
  }

  console.log("\n=== 统计汇总 ===");
  console.log("总钱包数: 200");
  console.log("有 ETH 余额: " + walletsWithEth + " 个钱包");
  console.log("有 USDT 余额: " + walletsWithUsdt + " 个钱包");
  console.log("有 Settlement 余额: " + walletsWithSettlement + " 个钱包");
  console.log("\n总 ETH 余额: " + formatEther(totalEth) + " ETH");
  console.log("总 USDT 余额: " + formatUnits(totalUsdt, 6) + " USDT");
  console.log("总 Settlement 可用余额: " + formatUnits(totalSettlementAvailable, 6) + " USDT");
  console.log("总 Settlement 锁定余额: " + formatUnits(totalSettlementLocked, 6) + " USDT");
}

main().catch(console.error);
