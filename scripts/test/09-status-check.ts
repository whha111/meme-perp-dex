/**
 * 测试 9: 状态检查 - 查看所有仓位、余额、系统状态
 */
import { CONFIG, SETTLEMENT_ABI, ERC20_ABI } from "./config";
import { createClient, createWallet, loadWallets, formatUSDT } from "./utils";
import { formatEther, type Address } from "viem";

async function main() {
  const client = createClient();
  const wallets = loadWallets();
  const { account: deployer } = createWallet(CONFIG.DEPLOYER_KEY);

  console.log("=".repeat(60));
  console.log("系统状态检查");
  console.log("=".repeat(60));

  // ===== 1. 合约配置 =====
  console.log("\n--- 合约配置 ---");

  try {
    const owner = await client.readContract({
      address: CONFIG.SETTLEMENT,
      abi: SETTLEMENT_ABI,
      functionName: "owner",
    });
    console.log(`Owner: ${owner}`);

    const feeRate = await client.readContract({
      address: CONFIG.SETTLEMENT,
      abi: SETTLEMENT_ABI,
      functionName: "feeRate",
    });
    console.log(`手续费率: ${Number(feeRate) / 100}%`);

    const insuranceFund = await client.readContract({
      address: CONFIG.SETTLEMENT,
      abi: SETTLEMENT_ABI,
      functionName: "insuranceFund",
    });
    console.log(`保险基金: ${insuranceFund}`);

    const supportedTokens = await client.readContract({
      address: CONFIG.SETTLEMENT,
      abi: SETTLEMENT_ABI,
      functionName: "getSupportedTokens",
    }) as Address[];
    console.log(`支持的代币: ${supportedTokens.length} 个`);
    supportedTokens.forEach((t, i) => console.log(`  ${i + 1}. ${t}`));

    const isMatcherAuth = await client.readContract({
      address: CONFIG.SETTLEMENT,
      abi: SETTLEMENT_ABI,
      functionName: "authorizedMatchers",
      args: [deployer.address],
    });
    console.log(`Deployer Matcher 权限: ${isMatcherAuth}`);
  } catch (e: any) {
    console.log(`配置读取失败: ${e.message.slice(0, 50)}`);
  }

  // ===== 2. 价格和资金费率 =====
  console.log("\n--- 价格和资金费率 ---");

  try {
    const price = await client.readContract({
      address: CONFIG.SETTLEMENT,
      abi: SETTLEMENT_ABI,
      functionName: "tokenPrices",
      args: [CONFIG.USDT],
    });
    console.log(`USDT 价格: $${Number(price) / 1e6}`);

    const fundingRate = await client.readContract({
      address: CONFIG.SETTLEMENT,
      abi: SETTLEMENT_ABI,
      functionName: "fundingRates",
      args: [CONFIG.USDT],
    });
    console.log(`USDT 资金费率: ${Number(fundingRate) / 1e18 * 100}%`);
  } catch (e: any) {
    console.log(`价格读取失败: ${e.message.slice(0, 50)}`);
  }

  // ===== 3. 仓位统计 =====
  console.log("\n--- 仓位统计 ---");

  try {
    const nextPairId = await client.readContract({
      address: CONFIG.SETTLEMENT,
      abi: SETTLEMENT_ABI,
      functionName: "nextPairId",
    });
    console.log(`总仓位数: ${Number(nextPairId) - 1}`);

    let activeCount = 0;
    let closedCount = 0;
    let liquidatedCount = 0;
    let totalSize = 0n;

    const activePositions: any[] = [];

    for (let i = 1n; i < nextPairId; i++) {
      const pos = await client.readContract({
        address: CONFIG.SETTLEMENT,
        abi: SETTLEMENT_ABI,
        functionName: "getPairedPosition",
        args: [i],
      });

      if (pos.status === 0) {
        activeCount++;
        totalSize += pos.size;
        activePositions.push({ ...pos, pairId: i });
      } else if (pos.status === 1) {
        closedCount++;
      } else if (pos.status === 2) {
        liquidatedCount++;
      }
    }

    console.log(`活跃仓位: ${activeCount}`);
    console.log(`已平仓: ${closedCount}`);
    console.log(`已清算: ${liquidatedCount}`);
    console.log(`活跃仓位总面值: ${formatUSDT(totalSize)}`);

    // 显示活跃仓位详情
    if (activePositions.length > 0) {
      console.log("\n活跃仓位列表:");
      for (const pos of activePositions.slice(0, 10)) {
        const [longPnL, shortPnL] = await client.readContract({
          address: CONFIG.SETTLEMENT,
          abi: SETTLEMENT_ABI,
          functionName: "getUnrealizedPnL",
          args: [pos.pairId],
        });

        const [canLiqLong, canLiqShort] = await client.readContract({
          address: CONFIG.SETTLEMENT,
          abi: SETTLEMENT_ABI,
          functionName: "canLiquidate",
          args: [pos.pairId],
        });

        console.log(`  Pair #${pos.pairId}:`);
        console.log(`    面值: ${formatUSDT(pos.size)}, 入场价: $${Number(pos.entryPrice) / 1e6}`);
        console.log(`    多头: ${pos.longTrader.slice(0, 10)}..., 杠杆: ${Number(pos.longLeverage) / 10000}x, PnL: ${Number(longPnL) / 1e6} USDT${canLiqLong ? " [可清算]" : ""}`);
        console.log(`    空头: ${pos.shortTrader.slice(0, 10)}..., 杠杆: ${Number(pos.shortLeverage) / 10000}x, PnL: ${Number(shortPnL) / 1e6} USDT${canLiqShort ? " [可清算]" : ""}`);
      }
      if (activePositions.length > 10) {
        console.log(`  ... 还有 ${activePositions.length - 10} 个活跃仓位`);
      }
    }
  } catch (e: any) {
    console.log(`仓位统计失败: ${e.message.slice(0, 50)}`);
  }

  // ===== 4. 测试钱包余额 =====
  console.log("\n--- 测试钱包余额 (前20个) ---");

  let totalAvailable = 0n;
  let totalLocked = 0n;
  let totalEth = 0n;
  let totalUsdt = 0n;

  for (let i = 0; i < 20; i++) {
    const wallet = wallets[i];
    const addr = wallet.address as Address;

    try {
      const [avail, locked] = await client.readContract({
        address: CONFIG.SETTLEMENT,
        abi: SETTLEMENT_ABI,
        functionName: "getUserBalance",
        args: [addr],
      });

      const ethBal = await client.getBalance({ address: addr });
      const usdtBal = await client.readContract({
        address: CONFIG.USDT,
        abi: ERC20_ABI,
        functionName: "balanceOf",
        args: [addr],
      });

      totalAvailable += avail;
      totalLocked += locked;
      totalEth += ethBal;
      totalUsdt += usdtBal;

      if (avail > 0n || locked > 0n || usdtBal > 0n) {
        console.log(`  #${i}: Settlement: ${formatUSDT(avail)}/${formatUSDT(locked)}, USDT: ${formatUSDT(usdtBal)}, ETH: ${formatEther(ethBal)}`);
      }
    } catch {}
  }

  console.log(`\n总计 (前20个):`);
  console.log(`  Settlement Available: ${formatUSDT(totalAvailable)}`);
  console.log(`  Settlement Locked: ${formatUSDT(totalLocked)}`);
  console.log(`  钱包 USDT: ${formatUSDT(totalUsdt)}`);
  console.log(`  钱包 ETH: ${formatEther(totalEth)}`);

  // ===== 5. 保险基金余额 =====
  console.log("\n--- 保险基金 ---");

  try {
    const insuranceFund = await client.readContract({
      address: CONFIG.SETTLEMENT,
      abi: SETTLEMENT_ABI,
      functionName: "insuranceFund",
    });

    if (insuranceFund !== "0x0000000000000000000000000000000000000000") {
      const [insFundAvail] = await client.readContract({
        address: CONFIG.SETTLEMENT,
        abi: SETTLEMENT_ABI,
        functionName: "getUserBalance",
        args: [insuranceFund as Address],
      });
      console.log(`保险基金余额: ${formatUSDT(insFundAvail)}`);
    } else {
      console.log("保险基金未设置");
    }
  } catch (e: any) {
    console.log(`保险基金检查失败: ${e.message.slice(0, 50)}`);
  }

  // ===== 6. 合约 USDT 余额 =====
  console.log("\n--- Settlement 合约 USDT 余额 ---");

  try {
    const contractUsdt = await client.readContract({
      address: CONFIG.USDT,
      abi: ERC20_ABI,
      functionName: "balanceOf",
      args: [CONFIG.SETTLEMENT],
    });
    console.log(`Settlement 合约持有 USDT: ${formatUSDT(contractUsdt)}`);
  } catch (e: any) {
    console.log(`合约余额检查失败: ${e.message.slice(0, 50)}`);
  }

  console.log("\n" + "=".repeat(60));
  console.log("状态检查完成");
  console.log("=".repeat(60));
}

main().catch(console.error);
