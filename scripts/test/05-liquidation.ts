/**
 * 测试 5: 爆仓清算
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
  console.log("测试 5: 爆仓清算");
  console.log("=".repeat(50));

  const testToken = CONFIG.USDT;

  // 首先创建一个高杠杆仓位，以便容易触发清算
  console.log("\n创建高杠杆仓位用于清算测试...");

  // 使用钱包 4 和 5
  const longWallet = wallets[4];
  const shortWallet = wallets[5];
  const { account: longAccount, client: longClient } = createWallet(longWallet.privateKey as Hex);
  const { account: shortAccount, client: shortClient } = createWallet(shortWallet.privateKey as Hex);

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

  if (longAvail < parseUSDT(5) || shortAvail < parseUSDT(5)) {
    reporter.add({ name: "余额检查", status: "FAIL", error: "余额不足" });
    return reporter.summary();
  }

  // 设置初始价格
  const entryPrice = parsePrice(1.0);
  await deployerClient.writeContract({
    address: CONFIG.SETTLEMENT,
    abi: SETTLEMENT_ABI,
    functionName: "updatePrice",
    args: [testToken, entryPrice],
  });

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

  // 创建 20x 高杠杆订单
  const orderSize = parseUSDT(20); // 20 USDT 面值
  const highLeverage = parseLeverage(20); // 20x 杠杆

  console.log(`\n订单参数:`);
  console.log(`  面值: ${formatUSDT(orderSize)}`);
  console.log(`  杠杆: 20x`);
  console.log(`  保证金: ${formatUSDT(orderSize / 20n)} 每边`);

  const longOrder = createOrder({
    trader: longWallet.address as Address,
    token: testToken,
    isLong: true,
    size: orderSize,
    leverage: highLeverage,
    price: entryPrice,
    nonce: longNonce,
    orderType: 0,
  });

  const shortOrder = createOrder({
    trader: shortWallet.address as Address,
    token: testToken,
    isLong: false,
    size: orderSize,
    leverage: highLeverage,
    price: entryPrice,
    nonce: shortNonce,
    orderType: 0,
  });

  // 签名
  let longSig: Hex, shortSig: Hex;
  try {
    longSig = await signOrder(longClient, longAccount, longOrder);
    shortSig = await signOrder(shortClient, shortAccount, shortOrder);
  } catch (e: any) {
    reporter.add({ name: "订单签名", status: "FAIL", error: e.message.slice(0, 50) });
    return reporter.summary();
  }

  // 撮合
  let newPairId: bigint;
  try {
    const pairsBefore = await client.readContract({
      address: CONFIG.SETTLEMENT,
      abi: SETTLEMENT_ABI,
      functionName: "nextPairId",
    });

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
      matchPrice: entryPrice,
      matchSize: orderSize,
    };

    const hash = await deployerClient.writeContract({
      address: CONFIG.SETTLEMENT,
      abi: SETTLEMENT_ABI,
      functionName: "settleBatch",
      args: [[matchedPair]],
    });
    await client.waitForTransactionReceipt({ hash });
    newPairId = pairsBefore;
    reporter.add({ name: "创建高杠杆仓位", status: "PASS", details: `Pair ID: ${newPairId}` });
  } catch (e: any) {
    reporter.add({ name: "创建高杠杆仓位", status: "FAIL", error: e.message.slice(0, 50) });
    return reporter.summary();
  }

  // 检查清算前状态
  console.log(`\n仓位 ${newPairId} 创建成功`);
  const pos = await client.readContract({
    address: CONFIG.SETTLEMENT,
    abi: SETTLEMENT_ABI,
    functionName: "getPairedPosition",
    args: [newPairId],
  });
  console.log(`  多头保证金: ${formatUSDT(pos.longCollateral)}`);
  console.log(`  空头保证金: ${formatUSDT(pos.shortCollateral)}`);

  // 模拟价格大幅下跌，触发多头清算
  // 20x 杠杆，维持保证金率 0.5%，下跌约 4.5% 即可触发清算
  const liquidationPrice = parsePrice(0.94); // 价格下跌 6%

  console.log(`\n模拟价格下跌: $1.00 -> $${Number(liquidationPrice) / 1e6}`);

  try {
    const hash = await deployerClient.writeContract({
      address: CONFIG.SETTLEMENT,
      abi: SETTLEMENT_ABI,
      functionName: "updatePrice",
      args: [testToken, liquidationPrice],
    });
    await client.waitForTransactionReceipt({ hash });
    reporter.add({ name: "更新价格触发清算", status: "PASS" });
  } catch (e: any) {
    reporter.add({ name: "更新价格触发清算", status: "FAIL", error: e.message.slice(0, 50) });
  }

  // 检查是否可以清算
  try {
    const [canLiqLong, canLiqShort] = await client.readContract({
      address: CONFIG.SETTLEMENT,
      abi: SETTLEMENT_ABI,
      functionName: "canLiquidate",
      args: [newPairId],
    });

    console.log(`\n清算状态检查:`);
    console.log(`  多头可清算: ${canLiqLong}`);
    console.log(`  空头可清算: ${canLiqShort}`);

    if (canLiqLong || canLiqShort) {
      reporter.add({ name: "清算条件满足", status: "PASS", details: `Long: ${canLiqLong}, Short: ${canLiqShort}` });
    } else {
      reporter.add({ name: "清算条件满足", status: "FAIL", error: "无法触发清算" });

      // 尝试更大的价格变动
      const extremePrice = parsePrice(0.85);
      console.log(`\n尝试更大价格变动: $${Number(extremePrice) / 1e6}`);
      await deployerClient.writeContract({
        address: CONFIG.SETTLEMENT,
        abi: SETTLEMENT_ABI,
        functionName: "updatePrice",
        args: [testToken, extremePrice],
      });

      const [canLiqLong2, canLiqShort2] = await client.readContract({
        address: CONFIG.SETTLEMENT,
        abi: SETTLEMENT_ABI,
        functionName: "canLiquidate",
        args: [newPairId],
      });
      console.log(`  多头可清算: ${canLiqLong2}`);
      console.log(`  空头可清算: ${canLiqShort2}`);
    }
  } catch (e: any) {
    reporter.add({ name: "清算条件检查", status: "FAIL", error: e.message.slice(0, 50) });
  }

  // 执行清算
  console.log("\n执行清算...");

  // 记录清算前保险基金余额
  const insuranceFund = await client.readContract({
    address: CONFIG.SETTLEMENT,
    abi: SETTLEMENT_ABI,
    functionName: "insuranceFund",
  });

  let insuranceBefore = 0n;
  if (insuranceFund !== "0x0000000000000000000000000000000000000000") {
    const [insBal] = await client.readContract({
      address: CONFIG.SETTLEMENT,
      abi: SETTLEMENT_ABI,
      functionName: "getUserBalance",
      args: [insuranceFund as Address],
    });
    insuranceBefore = insBal;
    console.log(`保险基金清算前余额: ${formatUSDT(insuranceBefore)}`);
  }

  // 使用第三方钱包执行清算（获取清算奖励）
  const liquidatorWallet = wallets[10];
  const { client: liquidatorClient } = createWallet(liquidatorWallet.privateKey as Hex);

  const [liqBalBefore] = await client.readContract({
    address: CONFIG.SETTLEMENT,
    abi: SETTLEMENT_ABI,
    functionName: "getUserBalance",
    args: [liquidatorWallet.address as Address],
  });

  try {
    const hash = await liquidatorClient.writeContract({
      address: CONFIG.SETTLEMENT,
      abi: SETTLEMENT_ABI,
      functionName: "liquidate",
      args: [newPairId],
    });
    await client.waitForTransactionReceipt({ hash });
    reporter.add({ name: "执行清算", status: "PASS", txHash: hash });

    // 验证仓位状态
    const closedPos = await client.readContract({
      address: CONFIG.SETTLEMENT,
      abi: SETTLEMENT_ABI,
      functionName: "getPairedPosition",
      args: [newPairId],
    });

    if (closedPos.status === 2) { // LIQUIDATED
      reporter.add({ name: "仓位状态变更", status: "PASS", details: "ACTIVE -> LIQUIDATED" });
    } else {
      reporter.add({ name: "仓位状态变更", status: "FAIL", error: `状态: ${closedPos.status}` });
    }

    // 验证清算奖励
    const [liqBalAfter] = await client.readContract({
      address: CONFIG.SETTLEMENT,
      abi: SETTLEMENT_ABI,
      functionName: "getUserBalance",
      args: [liquidatorWallet.address as Address],
    });

    const reward = liqBalAfter - liqBalBefore;
    console.log(`\n清算奖励: ${formatUSDT(reward)}`);

    if (reward > 0n) {
      reporter.add({ name: "清算奖励发放", status: "PASS", details: formatUSDT(reward) });
    } else {
      reporter.add({ name: "清算奖励发放", status: "FAIL", error: "奖励为 0" });
    }

    // 验证保险基金
    if (insuranceFund !== "0x0000000000000000000000000000000000000000") {
      const [insBalAfter] = await client.readContract({
        address: CONFIG.SETTLEMENT,
        abi: SETTLEMENT_ABI,
        functionName: "getUserBalance",
        args: [insuranceFund as Address],
      });
      const insChange = insBalAfter - insuranceBefore;
      console.log(`保险基金变化: ${Number(insChange) / 1e6} USDT`);
      reporter.add({ name: "保险基金结算", status: "PASS", details: `${Number(insChange) / 1e6} USDT` });
    }
  } catch (e: any) {
    reporter.add({ name: "执行清算", status: "FAIL", error: e.message.slice(0, 100) });
  }

  reporter.summary();
}

main().catch(console.error);
