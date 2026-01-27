/**
 * 测试 7: 盈利提现
 */
import { CONFIG, SETTLEMENT_ABI, ERC20_ABI } from "./config";
import {
  createClient, createWallet, loadWallets,
  formatUSDT, parseUSDT, sleep, TestReporter
} from "./utils";
import { type Address, type Hex } from "viem";

async function main() {
  const reporter = new TestReporter();
  const client = createClient();
  const wallets = loadWallets();

  console.log("=".repeat(50));
  console.log("测试 7: 盈利提现");
  console.log("=".repeat(50));

  // 选择一个有余额的钱包
  let testWallet = null;
  let testBalance = 0n;

  console.log("\n查找有可用余额的钱包...");
  for (let i = 0; i < 10; i++) {
    const wallet = wallets[i];
    const [avail, locked] = await client.readContract({
      address: CONFIG.SETTLEMENT,
      abi: SETTLEMENT_ABI,
      functionName: "getUserBalance",
      args: [wallet.address as Address],
    });

    if (avail > parseUSDT(1)) { // 至少有 1 USDT 可用
      testWallet = wallet;
      testBalance = avail;
      console.log(`找到钱包 #${i}: ${formatUSDT(avail)} available, ${formatUSDT(locked)} locked`);
      break;
    }
  }

  if (!testWallet) {
    reporter.add({ name: "查找可提现钱包", status: "FAIL", error: "没有找到有可用余额的钱包" });
    return reporter.summary();
  }

  reporter.add({ name: "查找可提现钱包", status: "PASS", details: formatUSDT(testBalance) });

  const { client: walletClient } = createWallet(testWallet.privateKey as Hex);

  // 1. 记录提现前的钱包 USDT 余额
  const usdtBefore = await client.readContract({
    address: CONFIG.USDT,
    abi: ERC20_ABI,
    functionName: "balanceOf",
    args: [testWallet.address as Address],
  });
  console.log(`\n提现前钱包 USDT: ${formatUSDT(usdtBefore)}`);

  // 2. 执行提现
  const withdrawAmount = testBalance / 2n; // 提现一半
  console.log(`\n提现金额: ${formatUSDT(withdrawAmount)}`);

  try {
    const hash = await walletClient.writeContract({
      address: CONFIG.SETTLEMENT,
      abi: SETTLEMENT_ABI,
      functionName: "withdraw",
      args: [CONFIG.USDT, withdrawAmount],
    });
    await client.waitForTransactionReceipt({ hash });
    reporter.add({ name: "执行提现", status: "PASS", txHash: hash });
  } catch (e: any) {
    reporter.add({ name: "执行提现", status: "FAIL", error: e.message.slice(0, 100) });
    return reporter.summary();
  }

  // 3. 验证提现后余额
  const [availAfter] = await client.readContract({
    address: CONFIG.SETTLEMENT,
    abi: SETTLEMENT_ABI,
    functionName: "getUserBalance",
    args: [testWallet.address as Address],
  });
  console.log(`提现后 Settlement 余额: ${formatUSDT(availAfter)}`);

  const expectedAvail = testBalance - withdrawAmount;
  if (availAfter <= expectedAvail) {
    reporter.add({ name: "Settlement 余额扣减", status: "PASS", details: `${formatUSDT(testBalance)} -> ${formatUSDT(availAfter)}` });
  } else {
    reporter.add({ name: "Settlement 余额扣减", status: "FAIL", error: `预期 ${formatUSDT(expectedAvail)}, 实际 ${formatUSDT(availAfter)}` });
  }

  // 4. 验证钱包收到 USDT
  const usdtAfter = await client.readContract({
    address: CONFIG.USDT,
    abi: ERC20_ABI,
    functionName: "balanceOf",
    args: [testWallet.address as Address],
  });
  console.log(`提现后钱包 USDT: ${formatUSDT(usdtAfter)}`);

  const usdtReceived = usdtAfter - usdtBefore;
  console.log(`收到 USDT: ${formatUSDT(usdtReceived)}`);

  if (usdtReceived >= withdrawAmount - parseUSDT(0.01)) { // 允许小误差
    reporter.add({ name: "钱包收到 USDT", status: "PASS", details: formatUSDT(usdtReceived) });
  } else {
    reporter.add({ name: "钱包收到 USDT", status: "FAIL", error: `预期 ${formatUSDT(withdrawAmount)}, 实际 ${formatUSDT(usdtReceived)}` });
  }

  // 5. 测试提现超额
  console.log("\n测试提现超额...");
  const excessAmount = availAfter + parseUSDT(1000); // 超过可用余额

  try {
    await walletClient.writeContract({
      address: CONFIG.SETTLEMENT,
      abi: SETTLEMENT_ABI,
      functionName: "withdraw",
      args: [CONFIG.USDT, excessAmount],
    });
    reporter.add({ name: "超额提现拒绝", status: "FAIL", error: "应该被拒绝但成功了" });
  } catch (e: any) {
    // 预期会失败
    reporter.add({ name: "超额提现拒绝", status: "PASS", details: "正确拒绝超额提现" });
  }

  // 6. 测试提现 0 金额
  console.log("\n测试提现 0 金额...");
  try {
    await walletClient.writeContract({
      address: CONFIG.SETTLEMENT,
      abi: SETTLEMENT_ABI,
      functionName: "withdraw",
      args: [CONFIG.USDT, 0n],
    });
    reporter.add({ name: "零金额提现拒绝", status: "FAIL", error: "应该被拒绝但成功了" });
  } catch (e: any) {
    reporter.add({ name: "零金额提现拒绝", status: "PASS", details: "正确拒绝零金额" });
  }

  reporter.summary();
}

main().catch(console.error);
