/**
 * 测试准备 - 检查环境和配置
 */
import { CONFIG, SETTLEMENT_ABI, ERC20_ABI } from "./config";
import { createClient, createWallet, loadWallets, formatUSDT, TestReporter } from "./utils";
import { formatEther, type Address } from "viem";

async function main() {
  const reporter = new TestReporter();
  const client = createClient();
  const wallets = loadWallets();
  const { account: deployer, client: deployerClient } = createWallet(CONFIG.DEPLOYER_KEY);

  console.log("=".repeat(50));
  console.log("测试环境检查");
  console.log("=".repeat(50));
  console.log(`Deployer: ${deployer.address}`);
  console.log(`Settlement: ${CONFIG.SETTLEMENT}`);
  console.log(`USDT: ${CONFIG.USDT}`);
  console.log(`测试钱包数量: ${wallets.length}\n`);

  // 1. 检查 Settlement 合约
  try {
    const owner = await client.readContract({
      address: CONFIG.SETTLEMENT,
      abi: SETTLEMENT_ABI,
      functionName: "owner",
    });
    reporter.add({ name: "Settlement 合约存在", status: "PASS", details: `Owner: ${owner}` });

    // 检查是否是 owner
    if (owner.toLowerCase() === deployer.address.toLowerCase()) {
      reporter.add({ name: "Deployer 是 Settlement Owner", status: "PASS" });
    } else {
      reporter.add({ name: "Deployer 是 Settlement Owner", status: "FAIL", error: `Owner 是 ${owner}` });
    }
  } catch (e: any) {
    reporter.add({ name: "Settlement 合约存在", status: "FAIL", error: e.message.slice(0, 50) });
  }

  // 2. 检查 USDT 合约
  try {
    const decimals = await client.readContract({
      address: CONFIG.USDT,
      abi: ERC20_ABI,
      functionName: "decimals",
    });
    const symbol = await client.readContract({
      address: CONFIG.USDT,
      abi: ERC20_ABI,
      functionName: "symbol",
    });
    reporter.add({ name: "USDT 合约存在", status: "PASS", details: `${symbol} (${decimals} decimals)` });
  } catch (e: any) {
    reporter.add({ name: "USDT 合约存在", status: "FAIL", error: e.message.slice(0, 50) });
  }

  // 3. 检查 USDT 是否是支持的代币
  try {
    const supportedTokens = await client.readContract({
      address: CONFIG.SETTLEMENT,
      abi: SETTLEMENT_ABI,
      functionName: "getSupportedTokens",
    }) as Address[];
    const isSupported = supportedTokens.some(t => t.toLowerCase() === CONFIG.USDT.toLowerCase());
    if (isSupported) {
      reporter.add({ name: "USDT 已添加为支持代币", status: "PASS" });
    } else {
      reporter.add({ name: "USDT 已添加为支持代币", status: "FAIL", error: "需要调用 addSupportedToken" });

      // 尝试添加
      console.log("\n尝试添加 USDT 为支持代币...");
      try {
        const hash = await deployerClient.writeContract({
          address: CONFIG.SETTLEMENT,
          abi: SETTLEMENT_ABI,
          functionName: "addSupportedToken",
          args: [CONFIG.USDT, 6],
        });
        await client.waitForTransactionReceipt({ hash });
        reporter.add({ name: "添加 USDT 支持", status: "PASS", txHash: hash });
      } catch (e: any) {
        reporter.add({ name: "添加 USDT 支持", status: "FAIL", error: e.message.slice(0, 50) });
      }
    }
  } catch (e: any) {
    reporter.add({ name: "检查支持代币", status: "FAIL", error: e.message.slice(0, 50) });
  }

  // 4. 检查 Deployer 是否是授权 Matcher
  try {
    const isAuthorized = await client.readContract({
      address: CONFIG.SETTLEMENT,
      abi: SETTLEMENT_ABI,
      functionName: "authorizedMatchers",
      args: [deployer.address],
    });
    if (isAuthorized) {
      reporter.add({ name: "Deployer 已授权为 Matcher", status: "PASS" });
    } else {
      reporter.add({ name: "Deployer 已授权为 Matcher", status: "FAIL", error: "需要授权" });

      // 尝试授权
      console.log("\n尝试授权 Deployer 为 Matcher...");
      try {
        const hash = await deployerClient.writeContract({
          address: CONFIG.SETTLEMENT,
          abi: SETTLEMENT_ABI,
          functionName: "setAuthorizedMatcher",
          args: [deployer.address, true],
        });
        await client.waitForTransactionReceipt({ hash });
        reporter.add({ name: "授权 Matcher", status: "PASS", txHash: hash });
      } catch (e: any) {
        reporter.add({ name: "授权 Matcher", status: "FAIL", error: e.message.slice(0, 50) });
      }
    }
  } catch (e: any) {
    reporter.add({ name: "检查 Matcher 授权", status: "FAIL", error: e.message.slice(0, 50) });
  }

  // 5. 检查保险基金设置
  try {
    const insuranceFund = await client.readContract({
      address: CONFIG.SETTLEMENT,
      abi: SETTLEMENT_ABI,
      functionName: "insuranceFund",
    });
    if (insuranceFund !== "0x0000000000000000000000000000000000000000") {
      reporter.add({ name: "保险基金已设置", status: "PASS", details: `${insuranceFund}` });
    } else {
      reporter.add({ name: "保险基金已设置", status: "FAIL", error: "未设置" });

      // 尝试设置
      console.log("\n尝试设置保险基金...");
      try {
        const hash = await deployerClient.writeContract({
          address: CONFIG.SETTLEMENT,
          abi: SETTLEMENT_ABI,
          functionName: "setInsuranceFund",
          args: [deployer.address],
        });
        await client.waitForTransactionReceipt({ hash });
        reporter.add({ name: "设置保险基金", status: "PASS", txHash: hash });
      } catch (e: any) {
        reporter.add({ name: "设置保险基金", status: "FAIL", error: e.message.slice(0, 50) });
      }
    }
  } catch (e: any) {
    reporter.add({ name: "检查保险基金", status: "FAIL", error: e.message.slice(0, 50) });
  }

  // 6. 检查手续费率
  try {
    const feeRate = await client.readContract({
      address: CONFIG.SETTLEMENT,
      abi: SETTLEMENT_ABI,
      functionName: "feeRate",
    });
    reporter.add({ name: "手续费率", status: "PASS", details: `${Number(feeRate) / 100}%` });
  } catch (e: any) {
    reporter.add({ name: "检查手续费率", status: "FAIL", error: e.message.slice(0, 50) });
  }

  // 7. 检查测试钱包 ETH 余额
  let totalEth = 0n;
  for (const w of wallets.slice(0, 10)) {
    const bal = await client.getBalance({ address: w.address as Address });
    totalEth += bal;
  }
  const avgEth = totalEth / 10n;
  reporter.add({ name: "测试钱包 ETH 余额", status: "PASS", details: `前10个平均 ${formatEther(avgEth)} ETH` });

  // 8. 检查测试钱包 USDT 余额
  let totalUsdt = 0n;
  for (const w of wallets.slice(0, 10)) {
    try {
      const bal = await client.readContract({
        address: CONFIG.USDT,
        abi: ERC20_ABI,
        functionName: "balanceOf",
        args: [w.address as Address],
      });
      totalUsdt += bal;
    } catch {}
  }
  reporter.add({ name: "测试钱包 USDT 余额", status: "PASS", details: `前10个共 ${formatUSDT(totalUsdt)}` });

  // 9. 检查 Deployer USDT 余额
  try {
    const bal = await client.readContract({
      address: CONFIG.USDT,
      abi: ERC20_ABI,
      functionName: "balanceOf",
      args: [deployer.address],
    });
    reporter.add({ name: "Deployer USDT 余额", status: "PASS", details: formatUSDT(bal) });
  } catch (e: any) {
    reporter.add({ name: "Deployer USDT 余额", status: "FAIL", error: e.message.slice(0, 50) });
  }

  // 10. 检查当前价格
  try {
    const price = await client.readContract({
      address: CONFIG.SETTLEMENT,
      abi: SETTLEMENT_ABI,
      functionName: "tokenPrices",
      args: [CONFIG.USDT],
    });
    if (price > 0n) {
      reporter.add({ name: "USDT 价格已设置", status: "PASS", details: `${Number(price) / 1e6}` });
    } else {
      reporter.add({ name: "USDT 价格已设置", status: "FAIL", error: "价格为 0" });
    }
  } catch (e: any) {
    reporter.add({ name: "检查 USDT 价格", status: "FAIL", error: e.message.slice(0, 50) });
  }

  reporter.summary();
}

main().catch(console.error);
