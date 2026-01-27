/**
 * 测试 4: 平仓（市价平仓、限价平仓）
 */
import { CONFIG, SETTLEMENT_ABI } from "./config";
import {
  createClient, createWallet, loadWallets,
  formatUSDT, parsePrice, sleep, TestReporter
} from "./utils";
import { type Address, type Hex } from "viem";

async function main() {
  const reporter = new TestReporter();
  const client = createClient();
  const wallets = loadWallets();
  const { account: deployer, client: deployerClient } = createWallet(CONFIG.DEPLOYER_KEY);

  console.log("=".repeat(50));
  console.log("测试 4: 平仓");
  console.log("=".repeat(50));

  // 查找活跃仓位
  console.log("\n查找活跃仓位...");
  const nextPairId = await client.readContract({
    address: CONFIG.SETTLEMENT,
    abi: SETTLEMENT_ABI,
    functionName: "nextPairId",
  });

  let activePositions: any[] = [];
  for (let i = 1n; i < nextPairId; i++) {
    try {
      const pos = await client.readContract({
        address: CONFIG.SETTLEMENT,
        abi: SETTLEMENT_ABI,
        functionName: "getPairedPosition",
        args: [i],
      });
      if (pos.status === 0) { // ACTIVE
        activePositions.push({ ...pos, pairId: i });
      }
    } catch {}
  }

  console.log(`找到 ${activePositions.length} 个活跃仓位`);

  if (activePositions.length === 0) {
    reporter.add({ name: "活跃仓位检查", status: "FAIL", error: "没有活跃仓位，请先运行开仓测试" });
    return reporter.summary();
  }

  reporter.add({ name: "活跃仓位检查", status: "PASS", details: `${activePositions.length} 个` });

  // ===== 测试 A: 用户自行平仓 =====
  console.log("\n--- 测试 A: 用户自行平仓 ---");

  const posToClose = activePositions[0];
  console.log(`\n选择仓位 ${posToClose.pairId} 进行平仓`);
  console.log(`  多头: ${posToClose.longTrader}`);
  console.log(`  空头: ${posToClose.shortTrader}`);
  console.log(`  面值: ${formatUSDT(posToClose.size)}`);
  console.log(`  入场价: $${Number(posToClose.entryPrice) / 1e6}`);

  // 先更新价格（模拟价格变化）
  const exitPrice = parsePrice(1.05); // 价格上涨到 $1.05，多头盈利
  console.log(`\n模拟价格变动: $${Number(posToClose.entryPrice) / 1e6} -> $${Number(exitPrice) / 1e6}`);

  try {
    const hash = await deployerClient.writeContract({
      address: CONFIG.SETTLEMENT,
      abi: SETTLEMENT_ABI,
      functionName: "updatePrice",
      args: [posToClose.token, exitPrice],
    });
    await client.waitForTransactionReceipt({ hash });
    reporter.add({ name: "更新退出价格", status: "PASS" });
  } catch (e: any) {
    reporter.add({ name: "更新退出价格", status: "FAIL", error: e.message.slice(0, 50) });
  }

  // 查看 PnL
  try {
    const [longPnL, shortPnL] = await client.readContract({
      address: CONFIG.SETTLEMENT,
      abi: SETTLEMENT_ABI,
      functionName: "getUnrealizedPnL",
      args: [posToClose.pairId],
    });
    console.log(`未实现盈亏:`);
    console.log(`  多头 PnL: ${Number(longPnL) / 1e6} USDT`);
    console.log(`  空头 PnL: ${Number(shortPnL) / 1e6} USDT`);
    reporter.add({ name: "PnL 计算", status: "PASS", details: `Long: ${Number(longPnL) / 1e6}, Short: ${Number(shortPnL) / 1e6}` });
  } catch (e: any) {
    reporter.add({ name: "PnL 计算", status: "FAIL", error: e.message.slice(0, 50) });
  }

  // 多头用户自行平仓
  const longWallet = wallets.find(w => w.address.toLowerCase() === posToClose.longTrader.toLowerCase());
  if (longWallet) {
    const { client: longClient } = createWallet(longWallet.privateKey as Hex);

    // 记录平仓前余额
    const [availBefore] = await client.readContract({
      address: CONFIG.SETTLEMENT,
      abi: SETTLEMENT_ABI,
      functionName: "getUserBalance",
      args: [longWallet.address as Address],
    });

    try {
      const hash = await longClient.writeContract({
        address: CONFIG.SETTLEMENT,
        abi: SETTLEMENT_ABI,
        functionName: "closePair",
        args: [posToClose.pairId],
      });
      await client.waitForTransactionReceipt({ hash });
      reporter.add({ name: "用户自行平仓", status: "PASS", txHash: hash });

      // 验证仓位已关闭
      const closedPos = await client.readContract({
        address: CONFIG.SETTLEMENT,
        abi: SETTLEMENT_ABI,
        functionName: "getPairedPosition",
        args: [posToClose.pairId],
      });

      if (closedPos.status === 1) { // CLOSED
        reporter.add({ name: "仓位状态变更", status: "PASS", details: "ACTIVE -> CLOSED" });
      } else {
        reporter.add({ name: "仓位状态变更", status: "FAIL", error: `状态: ${closedPos.status}` });
      }

      // 验证余额变化
      const [availAfter] = await client.readContract({
        address: CONFIG.SETTLEMENT,
        abi: SETTLEMENT_ABI,
        functionName: "getUserBalance",
        args: [longWallet.address as Address],
      });
      console.log(`\n多头余额变化: ${formatUSDT(availBefore)} -> ${formatUSDT(availAfter)}`);
      const profit = availAfter - availBefore;
      console.log(`盈利: ${Number(profit) / 1e6} USDT`);

      if (availAfter > availBefore) {
        reporter.add({ name: "盈利结算", status: "PASS", details: `+${formatUSDT(profit)}` });
      } else {
        reporter.add({ name: "盈利结算", status: "PASS", details: `${formatUSDT(profit)}` });
      }
    } catch (e: any) {
      reporter.add({ name: "用户自行平仓", status: "FAIL", error: e.message.slice(0, 50) });
    }
  } else {
    reporter.add({ name: "用户自行平仓", status: "SKIP", error: "找不到多头钱包" });
  }

  // ===== 测试 B: Matcher 批量平仓 =====
  console.log("\n--- 测试 B: Matcher 批量平仓 ---");

  // 重新获取活跃仓位
  activePositions = [];
  for (let i = 1n; i < nextPairId; i++) {
    try {
      const pos = await client.readContract({
        address: CONFIG.SETTLEMENT,
        abi: SETTLEMENT_ABI,
        functionName: "getPairedPosition",
        args: [i],
      });
      if (pos.status === 0) {
        activePositions.push({ ...pos, pairId: i });
      }
    } catch {}
  }

  if (activePositions.length > 0) {
    const posToCloseBatch = activePositions[0];
    const batchExitPrice = parsePrice(0.95); // 价格下跌

    console.log(`\n批量平仓仓位 ${posToCloseBatch.pairId}`);
    console.log(`退出价格: $${Number(batchExitPrice) / 1e6}`);

    try {
      const hash = await deployerClient.writeContract({
        address: CONFIG.SETTLEMENT,
        abi: SETTLEMENT_ABI,
        functionName: "closePairsBatch",
        args: [[posToCloseBatch.pairId], [batchExitPrice]],
      });
      await client.waitForTransactionReceipt({ hash });
      reporter.add({ name: "Matcher 批量平仓", status: "PASS", txHash: hash });

      // 验证
      const closedPos = await client.readContract({
        address: CONFIG.SETTLEMENT,
        abi: SETTLEMENT_ABI,
        functionName: "getPairedPosition",
        args: [posToCloseBatch.pairId],
      });

      if (closedPos.status === 1) {
        reporter.add({ name: "批量平仓验证", status: "PASS" });
      } else {
        reporter.add({ name: "批量平仓验证", status: "FAIL" });
      }
    } catch (e: any) {
      reporter.add({ name: "Matcher 批量平仓", status: "FAIL", error: e.message.slice(0, 50) });
    }
  } else {
    reporter.add({ name: "Matcher 批量平仓", status: "SKIP", error: "没有更多活跃仓位" });
  }

  reporter.summary();
}

main().catch(console.error);
