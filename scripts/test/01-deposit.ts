/**
 * 测试 1: USDT 充值到 Settlement
 */
import { CONFIG, SETTLEMENT_ABI, ERC20_ABI } from "./config";
import { createClient, createWallet, loadWallets, formatUSDT, parseUSDT, sleep, TestReporter } from "./utils";
import { type Address, type Hex } from "viem";

async function main() {
  const reporter = new TestReporter();
  const client = createClient();
  const wallets = loadWallets();
  const { account: deployer, client: deployerClient } = createWallet(CONFIG.DEPLOYER_KEY);

  console.log("=".repeat(50));
  console.log("测试 1: USDT 充值");
  console.log("=".repeat(50));

  // 先检查 Deployer 的 USDT 余额
  const deployerUsdt = await client.readContract({
    address: CONFIG.USDT,
    abi: ERC20_ABI,
    functionName: "balanceOf",
    args: [deployer.address],
  });
  console.log(`Deployer USDT: ${formatUSDT(deployerUsdt)}\n`);

  // 如果 USDT 不足，尝试 mint（如果是测试代币）
  if (deployerUsdt < parseUSDT(10000)) {
    console.log("USDT 不足，尝试 mint...");
    try {
      const hash = await deployerClient.writeContract({
        address: CONFIG.USDT,
        abi: ERC20_ABI,
        functionName: "mint",
        args: [deployer.address, parseUSDT(100000)],
      });
      await client.waitForTransactionReceipt({ hash });
      reporter.add({ name: "Mint USDT", status: "PASS", details: "100,000 USDT" });
    } catch (e: any) {
      reporter.add({ name: "Mint USDT", status: "SKIP", error: "可能不是测试代币: " + e.message.slice(0, 30) });
    }
  }

  // 测试数量
  const testAmount = parseUSDT(100); // 100 USDT
  const testWalletCount = 20; // 测试前20个钱包

  // 1. 给测试钱包转 USDT
  console.log(`\n给 ${testWalletCount} 个测试钱包转 USDT...`);
  let transferSuccess = 0;

  for (let i = 0; i < testWalletCount; i++) {
    const wallet = wallets[i];
    try {
      // 检查钱包是否已有足够 USDT
      const bal = await client.readContract({
        address: CONFIG.USDT,
        abi: ERC20_ABI,
        functionName: "balanceOf",
        args: [wallet.address as Address],
      });

      if (bal < testAmount) {
        const hash = await deployerClient.writeContract({
          address: CONFIG.USDT,
          abi: ERC20_ABI,
          functionName: "transfer",
          args: [wallet.address as Address, testAmount],
        });
        await client.waitForTransactionReceipt({ hash });
      }
      transferSuccess++;

      if ((i + 1) % 5 === 0) {
        console.log(`  已转账 ${i + 1}/${testWalletCount}`);
      }
      await sleep(100);
    } catch (e: any) {
      console.log(`  [${i}] 转账失败: ${e.message.slice(0, 40)}`);
    }
  }

  reporter.add({
    name: "USDT 转账到测试钱包",
    status: transferSuccess >= testWalletCount * 0.8 ? "PASS" : "FAIL",
    details: `${transferSuccess}/${testWalletCount} 成功`,
  });

  // 2. 测试钱包 approve + deposit 到 Settlement
  console.log(`\n测试钱包充值到 Settlement...`);
  let depositSuccess = 0;

  for (let i = 0; i < testWalletCount; i++) {
    const wallet = wallets[i];
    const { account, client: walletClient } = createWallet(wallet.privateKey as Hex);

    try {
      // 获取当前余额
      const usdtBal = await client.readContract({
        address: CONFIG.USDT,
        abi: ERC20_ABI,
        functionName: "balanceOf",
        args: [wallet.address as Address],
      });

      if (usdtBal === 0n) continue;

      // Approve
      const approveHash = await walletClient.writeContract({
        address: CONFIG.USDT,
        abi: ERC20_ABI,
        functionName: "approve",
        args: [CONFIG.SETTLEMENT, usdtBal],
      });
      await client.waitForTransactionReceipt({ hash: approveHash });

      // Deposit
      const depositHash = await walletClient.writeContract({
        address: CONFIG.SETTLEMENT,
        abi: SETTLEMENT_ABI,
        functionName: "deposit",
        args: [CONFIG.USDT, usdtBal],
      });
      await client.waitForTransactionReceipt({ hash: depositHash });

      depositSuccess++;

      if ((i + 1) % 5 === 0) {
        console.log(`  已充值 ${i + 1}/${testWalletCount}`);
      }
      await sleep(150);
    } catch (e: any) {
      console.log(`  [${i}] 充值失败: ${e.message.slice(0, 40)}`);
    }
  }

  reporter.add({
    name: "Settlement 充值",
    status: depositSuccess >= testWalletCount * 0.8 ? "PASS" : "FAIL",
    details: `${depositSuccess}/${testWalletCount} 成功`,
  });

  // 3. 验证余额
  console.log(`\n验证 Settlement 余额...`);
  let totalBalance = 0n;

  for (let i = 0; i < testWalletCount; i++) {
    const wallet = wallets[i];
    try {
      const [available, locked] = await client.readContract({
        address: CONFIG.SETTLEMENT,
        abi: SETTLEMENT_ABI,
        functionName: "getUserBalance",
        args: [wallet.address as Address],
      });
      totalBalance += available + locked;

      if (i < 5) {
        console.log(`  钱包 #${i}: ${formatUSDT(available)} available, ${formatUSDT(locked)} locked`);
      }
    } catch {}
  }

  reporter.add({
    name: "Settlement 余额验证",
    status: totalBalance > 0n ? "PASS" : "FAIL",
    details: `总余额: ${formatUSDT(totalBalance)}`,
  });

  reporter.summary();
}

main().catch(console.error);
