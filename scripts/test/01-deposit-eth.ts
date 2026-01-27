/**
 * 测试 1: ETH 充值 - 包装 ETH 到 WETH 并存入 Settlement
 *
 * 步骤:
 * 1. 将 ETH 包装成 WETH
 * 2. 授权 Settlement 合约使用 WETH
 * 3. 存入 Settlement 合约
 */
import { CONFIG, SETTLEMENT_ABI, WETH_ABI } from "./config";
import { createClient, createWallet, loadWallets, formatUSDT } from "./utils";
import { formatEther, parseEther, type Address } from "viem";

const DEPOSIT_AMOUNT = parseEther("0.05"); // 每个钱包充值 0.05 ETH (约 $150)
const MIN_ETH_RESERVE = parseEther("0.02"); // 保留用于 gas

async function main() {
  const client = createClient();
  const wallets = loadWallets();

  console.log("=".repeat(60));
  console.log("ETH 充值测试 (Wrap ETH -> WETH -> Settlement)");
  console.log("=".repeat(60));
  console.log(`WETH 地址: ${CONFIG.WETH}`);
  console.log(`Settlement 地址: ${CONFIG.SETTLEMENT}`);
  console.log(`每个钱包充值: ${formatEther(DEPOSIT_AMOUNT)} ETH`);
  console.log(`测试钱包数: ${Math.min(wallets.length, 20)}`);

  // 检查 WETH 价格
  const wethPrice = await client.readContract({
    address: CONFIG.SETTLEMENT,
    abi: SETTLEMENT_ABI,
    functionName: "tokenPrices",
    args: [CONFIG.WETH],
  });
  console.log(`当前 WETH 价格: $${Number(wethPrice) / 1e6}`);

  if (wethPrice === 0n) {
    console.log("\nWETH 价格未设置，无法继续测试");
    return;
  }

  let successCount = 0;
  let failCount = 0;

  // 处理前 20 个钱包
  for (let i = 0; i < Math.min(wallets.length, 20); i++) {
    const wallet = wallets[i];
    const { account, client: walletClient } = createWallet(wallet.privateKey as `0x${string}`);
    const addr = account.address as Address;

    console.log(`\n--- 钱包 #${i}: ${addr.slice(0, 10)}... ---`);

    try {
      // 1. 检查 ETH 余额
      const ethBalance = await client.getBalance({ address: addr });
      console.log(`  ETH 余额: ${formatEther(ethBalance)}`);

      if (ethBalance < DEPOSIT_AMOUNT + MIN_ETH_RESERVE) {
        console.log(`  跳过: ETH 余额不足 (需要 ${formatEther(DEPOSIT_AMOUNT + MIN_ETH_RESERVE)})`);
        failCount++;
        continue;
      }

      // 2. 检查当前 WETH 余额
      const wethBalanceBefore = await client.readContract({
        address: CONFIG.WETH,
        abi: WETH_ABI,
        functionName: "balanceOf",
        args: [addr],
      });
      console.log(`  WETH 余额 (充值前): ${formatEther(wethBalanceBefore)}`);

      // 3. 包装 ETH 为 WETH
      console.log(`  包装 ${formatEther(DEPOSIT_AMOUNT)} ETH -> WETH...`);
      const wrapHash = await walletClient.writeContract({
        address: CONFIG.WETH,
        abi: WETH_ABI,
        functionName: "deposit",
        value: DEPOSIT_AMOUNT,
      });
      await client.waitForTransactionReceipt({ hash: wrapHash });
      console.log(`  包装成功: ${wrapHash.slice(0, 20)}...`);

      // 4. 检查 WETH 余额
      const wethBalanceAfter = await client.readContract({
        address: CONFIG.WETH,
        abi: WETH_ABI,
        functionName: "balanceOf",
        args: [addr],
      });
      console.log(`  WETH 余额 (包装后): ${formatEther(wethBalanceAfter)}`);

      // 5. 授权 Settlement 使用 WETH
      console.log(`  授权 Settlement 使用 WETH...`);
      const approveHash = await walletClient.writeContract({
        address: CONFIG.WETH,
        abi: WETH_ABI,
        functionName: "approve",
        args: [CONFIG.SETTLEMENT, DEPOSIT_AMOUNT],
      });
      await client.waitForTransactionReceipt({ hash: approveHash });
      console.log(`  授权成功: ${approveHash.slice(0, 20)}...`);

      // 6. 存入 Settlement
      console.log(`  存入 Settlement...`);
      const depositHash = await walletClient.writeContract({
        address: CONFIG.SETTLEMENT,
        abi: SETTLEMENT_ABI,
        functionName: "deposit",
        args: [CONFIG.WETH, DEPOSIT_AMOUNT],
      });
      await client.waitForTransactionReceipt({ hash: depositHash });
      console.log(`  存入成功: ${depositHash.slice(0, 20)}...`);

      // 7. 检查 Settlement 余额
      const [available, locked] = await client.readContract({
        address: CONFIG.SETTLEMENT,
        abi: SETTLEMENT_ABI,
        functionName: "getUserBalance",
        args: [addr],
      });
      // Settlement 余额以 USDT 计价 (6 decimals)
      console.log(`  Settlement 余额: 可用 ${formatUSDT(available)}, 锁定 ${formatUSDT(locked)}`);

      successCount++;
    } catch (e: any) {
      console.log(`  失败: ${e.message.slice(0, 80)}`);
      failCount++;
    }
  }

  // 汇总
  console.log("\n" + "=".repeat(60));
  console.log("充值完成");
  console.log("=".repeat(60));
  console.log(`成功: ${successCount}`);
  console.log(`失败: ${failCount}`);

  // 显示总体余额
  console.log("\n--- Settlement 总余额统计 ---");
  let totalAvailable = 0n;
  let totalLocked = 0n;

  for (let i = 0; i < Math.min(wallets.length, 20); i++) {
    const wallet = wallets[i];
    const addr = wallet.address as Address;
    try {
      const [avail, locked] = await client.readContract({
        address: CONFIG.SETTLEMENT,
        abi: SETTLEMENT_ABI,
        functionName: "getUserBalance",
        args: [addr],
      });
      totalAvailable += avail;
      totalLocked += locked;
    } catch {}
  }

  console.log(`总可用余额: ${formatUSDT(totalAvailable)}`);
  console.log(`总锁定余额: ${formatUSDT(totalLocked)}`);
}

main().catch(console.error);
