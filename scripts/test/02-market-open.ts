/**
 * 测试 2: 市价开仓
 */
import { CONFIG, SETTLEMENT_ABI } from "./config";
import {
  createClient, createWallet, loadWallets, signOrder, createOrder,
  formatUSDT, parseUSDT, parseLeverage, parsePrice, sleep, TestReporter
} from "./utils";
import { type Address, type Hex } from "viem";

async function main() {
  const reporter = new TestReporter();
  const client = createClient();
  const wallets = loadWallets();
  const { account: deployer, client: deployerClient } = createWallet(CONFIG.DEPLOYER_KEY);

  console.log("=".repeat(50));
  console.log("测试 2: 市价开仓");
  console.log("=".repeat(50));

  // 使用一个测试代币地址（这里用 USDT 作为交易标的演示）
  // 实际应该是 meme 代币地址
  const testToken = CONFIG.USDT;
  const matchPrice = parsePrice(1.0); // $1.00

  // 1. 首先设置价格
  console.log("\n设置测试代币价格...");
  try {
    const hash = await deployerClient.writeContract({
      address: CONFIG.SETTLEMENT,
      abi: SETTLEMENT_ABI,
      functionName: "updatePrice",
      args: [testToken, matchPrice],
    });
    await client.waitForTransactionReceipt({ hash });
    reporter.add({ name: "设置代币价格", status: "PASS", details: `$${Number(matchPrice) / 1e6}` });
  } catch (e: any) {
    reporter.add({ name: "设置代币价格", status: "FAIL", error: e.message.slice(0, 50) });
    return reporter.summary();
  }

  // 2. 选择两个钱包：一个做多，一个做空
  const longWallet = wallets[0];
  const shortWallet = wallets[1];
  const { account: longAccount, client: longClient } = createWallet(longWallet.privateKey as Hex);
  const { account: shortAccount, client: shortClient } = createWallet(shortWallet.privateKey as Hex);

  console.log(`\n多头钱包: ${longWallet.address}`);
  console.log(`空头钱包: ${shortWallet.address}`);

  // 检查余额
  const [longAvail] = await client.readContract({
    address: CONFIG.SETTLEMENT,
    abi: SETTLEMENT_ABI,
    functionName: "getUserBalance",
    args: [longWallet.address as Address],
  });
  const [shortAvail] = await client.readContract({
    address: CONFIG.SETTLEMENT,
    abi: SETTLEMENT_ABI,
    functionName: "getUserBalance",
    args: [shortWallet.address as Address],
  });

  console.log(`多头余额: ${formatUSDT(longAvail)}`);
  console.log(`空头余额: ${formatUSDT(shortAvail)}`);

  if (longAvail < parseUSDT(10) || shortAvail < parseUSDT(10)) {
    reporter.add({ name: "余额检查", status: "FAIL", error: "余额不足，请先运行 01-deposit.ts" });
    return reporter.summary();
  }

  // 3. 获取 nonce
  const longNonce = await client.readContract({
    address: CONFIG.SETTLEMENT,
    abi: SETTLEMENT_ABI,
    functionName: "nonces",
    args: [longWallet.address as Address],
  });
  const shortNonce = await client.readContract({
    address: CONFIG.SETTLEMENT,
    abi: SETTLEMENT_ABI,
    functionName: "nonces",
    args: [shortWallet.address as Address],
  });

  console.log(`\n多头 nonce: ${longNonce}`);
  console.log(`空头 nonce: ${shortNonce}`);

  // 4. 创建订单
  const orderSize = parseUSDT(50); // 50 USDT 面值
  const leverage = parseLeverage(5); // 5x 杠杆

  const longOrder = createOrder({
    trader: longWallet.address as Address,
    token: testToken,
    isLong: true,
    size: orderSize,
    leverage: leverage,
    price: matchPrice,
    nonce: longNonce,
    orderType: 0, // MARKET
  });

  const shortOrder = createOrder({
    trader: shortWallet.address as Address,
    token: testToken,
    isLong: false,
    size: orderSize,
    leverage: leverage,
    price: matchPrice,
    nonce: shortNonce,
    orderType: 0, // MARKET
  });

  console.log(`\n订单面值: ${formatUSDT(orderSize)}`);
  console.log(`杠杆: ${Number(leverage) / 10000}x`);
  console.log(`所需保证金: ${formatUSDT(orderSize * 10000n / leverage)}`);

  // 5. 签名订单
  console.log("\n签名订单...");
  let longSig: Hex, shortSig: Hex;
  try {
    longSig = await signOrder(longClient, longAccount, longOrder);
    reporter.add({ name: "多头订单签名", status: "PASS" });
  } catch (e: any) {
    reporter.add({ name: "多头订单签名", status: "FAIL", error: e.message.slice(0, 50) });
    return reporter.summary();
  }

  try {
    shortSig = await signOrder(shortClient, shortAccount, shortOrder);
    reporter.add({ name: "空头订单签名", status: "PASS" });
  } catch (e: any) {
    reporter.add({ name: "空头订单签名", status: "FAIL", error: e.message.slice(0, 50) });
    return reporter.summary();
  }

  // 6. 撮合结算
  console.log("\n提交撮合到链上...");
  const pairsBefore = await client.readContract({
    address: CONFIG.SETTLEMENT,
    abi: SETTLEMENT_ABI,
    functionName: "nextPairId",
  });

  try {
    const matchedPair = {
      longOrder: {
        trader: longOrder.trader,
        token: longOrder.token,
        isLong: longOrder.isLong,
        size: longOrder.size,
        leverage: longOrder.leverage,
        price: longOrder.price,
        deadline: longOrder.deadline,
        nonce: longOrder.nonce,
        orderType: longOrder.orderType,
      },
      longSignature: longSig,
      shortOrder: {
        trader: shortOrder.trader,
        token: shortOrder.token,
        isLong: shortOrder.isLong,
        size: shortOrder.size,
        leverage: shortOrder.leverage,
        price: shortOrder.price,
        deadline: shortOrder.deadline,
        nonce: shortOrder.nonce,
        orderType: shortOrder.orderType,
      },
      shortSignature: shortSig,
      matchPrice: matchPrice,
      matchSize: orderSize,
    };

    const hash = await deployerClient.writeContract({
      address: CONFIG.SETTLEMENT,
      abi: SETTLEMENT_ABI,
      functionName: "settleBatch",
      args: [[matchedPair]],
    });
    await client.waitForTransactionReceipt({ hash });

    reporter.add({ name: "市价开仓撮合", status: "PASS", txHash: hash });
  } catch (e: any) {
    reporter.add({ name: "市价开仓撮合", status: "FAIL", error: e.message.slice(0, 100) });
    return reporter.summary();
  }

  // 7. 验证仓位创建
  const pairsAfter = await client.readContract({
    address: CONFIG.SETTLEMENT,
    abi: SETTLEMENT_ABI,
    functionName: "nextPairId",
  });

  if (pairsAfter > pairsBefore) {
    const newPairId = pairsBefore;
    const position = await client.readContract({
      address: CONFIG.SETTLEMENT,
      abi: SETTLEMENT_ABI,
      functionName: "getPairedPosition",
      args: [newPairId],
    });

    console.log(`\n创建的仓位 ID: ${newPairId}`);
    console.log(`  多头: ${position.longTrader}`);
    console.log(`  空头: ${position.shortTrader}`);
    console.log(`  面值: ${formatUSDT(position.size)}`);
    console.log(`  入场价: ${Number(position.entryPrice) / 1e6}`);
    console.log(`  多头保证金: ${formatUSDT(position.longCollateral)}`);
    console.log(`  空头保证金: ${formatUSDT(position.shortCollateral)}`);
    console.log(`  状态: ${position.status === 0 ? "ACTIVE" : position.status === 1 ? "CLOSED" : "LIQUIDATED"}`);

    reporter.add({ name: "仓位创建验证", status: "PASS", details: `Pair ID: ${newPairId}` });
  } else {
    reporter.add({ name: "仓位创建验证", status: "FAIL", error: "未创建新仓位" });
  }

  // 8. 验证余额变化
  const [longAvailAfter, longLocked] = await client.readContract({
    address: CONFIG.SETTLEMENT,
    abi: SETTLEMENT_ABI,
    functionName: "getUserBalance",
    args: [longWallet.address as Address],
  });
  const [shortAvailAfter, shortLocked] = await client.readContract({
    address: CONFIG.SETTLEMENT,
    abi: SETTLEMENT_ABI,
    functionName: "getUserBalance",
    args: [shortWallet.address as Address],
  });

  console.log(`\n余额变化:`);
  console.log(`  多头: ${formatUSDT(longAvail)} -> ${formatUSDT(longAvailAfter)} (锁定: ${formatUSDT(longLocked)})`);
  console.log(`  空头: ${formatUSDT(shortAvail)} -> ${formatUSDT(shortAvailAfter)} (锁定: ${formatUSDT(shortLocked)})`);

  if (longLocked > 0n && shortLocked > 0n) {
    reporter.add({ name: "保证金锁定验证", status: "PASS" });
  } else {
    reporter.add({ name: "保证金锁定验证", status: "FAIL", error: "保证金未锁定" });
  }

  reporter.summary();
}

main().catch(console.error);
