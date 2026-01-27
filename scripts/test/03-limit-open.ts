/**
 * 测试 3: 限价开仓
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
  console.log("测试 3: 限价开仓");
  console.log("=".repeat(50));

  const testToken = CONFIG.USDT;
  const currentPrice = parsePrice(1.0); // 当前价格 $1.00

  // 设置价格
  try {
    const hash = await deployerClient.writeContract({
      address: CONFIG.SETTLEMENT,
      abi: SETTLEMENT_ABI,
      functionName: "updatePrice",
      args: [testToken, currentPrice],
    });
    await client.waitForTransactionReceipt({ hash });
  } catch {}

  // 选择钱包 2 和 3
  const longWallet = wallets[2];
  const shortWallet = wallets[3];
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
    reporter.add({ name: "余额检查", status: "FAIL", error: "余额不足" });
    return reporter.summary();
  }

  // 获取 nonce
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

  // 限价订单参数
  const orderSize = parseUSDT(30); // 30 USDT 面值
  const leverage = parseLeverage(10); // 10x 杠杆
  const longLimitPrice = parsePrice(0.98); // 多头限价 $0.98 (低于当前价，买入)
  const shortLimitPrice = parsePrice(1.02); // 空头限价 $1.02 (高于当前价，卖出)
  const matchPrice = parsePrice(1.0); // 实际成交价

  console.log(`\n限价订单参数:`);
  console.log(`  面值: ${formatUSDT(orderSize)}`);
  console.log(`  杠杆: ${Number(leverage) / 10000}x`);
  console.log(`  多头限价: $${Number(longLimitPrice) / 1e6}`);
  console.log(`  空头限价: $${Number(shortLimitPrice) / 1e6}`);
  console.log(`  成交价: $${Number(matchPrice) / 1e6}`);

  // 创建限价订单
  const longOrder = createOrder({
    trader: longWallet.address as Address,
    token: testToken,
    isLong: true,
    size: orderSize,
    leverage: leverage,
    price: longLimitPrice, // 限价
    nonce: longNonce,
    orderType: 1, // LIMIT
  });

  const shortOrder = createOrder({
    trader: shortWallet.address as Address,
    token: testToken,
    isLong: false,
    size: orderSize,
    leverage: leverage,
    price: shortLimitPrice, // 限价
    nonce: shortNonce,
    orderType: 1, // LIMIT
  });

  // 签名
  let longSig: Hex, shortSig: Hex;
  try {
    longSig = await signOrder(longClient, longAccount, longOrder);
    shortSig = await signOrder(shortClient, shortAccount, shortOrder);
    reporter.add({ name: "限价订单签名", status: "PASS" });
  } catch (e: any) {
    reporter.add({ name: "限价订单签名", status: "FAIL", error: e.message.slice(0, 50) });
    return reporter.summary();
  }

  // 撮合
  console.log("\n提交限价撮合...");
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

    reporter.add({ name: "限价开仓撮合", status: "PASS", txHash: hash });
  } catch (e: any) {
    reporter.add({ name: "限价开仓撮合", status: "FAIL", error: e.message.slice(0, 100) });
    return reporter.summary();
  }

  // 验证
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

    console.log(`\n创建的限价仓位 ID: ${newPairId}`);
    console.log(`  入场价: $${Number(position.entryPrice) / 1e6}`);
    console.log(`  面值: ${formatUSDT(position.size)}`);
    console.log(`  多头杠杆: ${Number(position.longLeverage) / 10000}x`);
    console.log(`  空头杠杆: ${Number(position.shortLeverage) / 10000}x`);

    reporter.add({ name: "限价仓位创建", status: "PASS", details: `Pair ID: ${newPairId}` });
  } else {
    reporter.add({ name: "限价仓位创建", status: "FAIL" });
  }

  reporter.summary();
}

main().catch(console.error);
