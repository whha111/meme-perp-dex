/**
 * 测试 8: 合约精度和下单面值精度
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
  console.log("测试 8: 合约精度测试");
  console.log("=".repeat(50));

  const testToken = CONFIG.USDT;

  // 设置价格
  const currentPrice = parsePrice(1.0);
  await deployerClient.writeContract({
    address: CONFIG.SETTLEMENT,
    abi: SETTLEMENT_ABI,
    functionName: "updatePrice",
    args: [testToken, currentPrice],
  });

  // ===== 测试 A: 最小下单面值 =====
  console.log("\n--- 测试 A: 最小下单面值 ---");

  const longWallet = wallets[8];
  const shortWallet = wallets[9];
  const { account: longAccount, client: longClient } = createWallet(longWallet.privateKey as Hex);
  const { account: shortAccount, client: shortClient } = createWallet(shortWallet.privateKey as Hex);

  // 检查余额
  const [longAvail] = await client.readContract({
    address: CONFIG.SETTLEMENT,
    abi: SETTLEMENT_ABI,
    functionName: "getUserBalance",
    args: [longWallet.address as Address],
  });

  if (longAvail < parseUSDT(1)) {
    reporter.add({ name: "余额检查", status: "FAIL", error: "余额不足" });
    return reporter.summary();
  }

  // 测试不同精度的订单面值
  const testSizes = [
    { size: parseUSDT(0.01), desc: "0.01 USDT (最小)" },
    { size: parseUSDT(0.1), desc: "0.1 USDT" },
    { size: parseUSDT(1), desc: "1 USDT" },
    { size: parseUSDT(10.5), desc: "10.5 USDT (带小数)" },
    { size: parseUSDT(100.123456), desc: "100.123456 USDT (6位小数)" },
  ];

  for (const test of testSizes) {
    console.log(`\n测试订单面值: ${test.desc}`);

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

    const leverage = parseLeverage(2); // 2x 杠杆，保证金够用

    const longOrder = createOrder({
      trader: longWallet.address as Address,
      token: testToken,
      isLong: true,
      size: test.size,
      leverage: leverage,
      price: currentPrice,
      nonce: longNonce,
      orderType: 0,
    });

    const shortOrder = createOrder({
      trader: shortWallet.address as Address,
      token: testToken,
      isLong: false,
      size: test.size,
      leverage: leverage,
      price: currentPrice,
      nonce: shortNonce,
      orderType: 0,
    });

    try {
      const longSig = await signOrder(longClient, longAccount, longOrder);
      const shortSig = await signOrder(shortClient, shortAccount, shortOrder);

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
        matchPrice: currentPrice,
        matchSize: test.size,
      };

      const hash = await deployerClient.writeContract({
        address: CONFIG.SETTLEMENT,
        abi: SETTLEMENT_ABI,
        functionName: "settleBatch",
        args: [[matchedPair]],
      });
      await client.waitForTransactionReceipt({ hash });

      reporter.add({ name: `订单面值 ${test.desc}`, status: "PASS" });
    } catch (e: any) {
      reporter.add({ name: `订单面值 ${test.desc}`, status: "FAIL", error: e.message.slice(0, 50) });
    }

    await sleep(200);
  }

  // ===== 测试 B: 价格精度 =====
  console.log("\n--- 测试 B: 价格精度 ---");

  const testPrices = [
    { price: parsePrice(0.000001), desc: "0.000001 (最小)" },
    { price: parsePrice(0.001), desc: "0.001" },
    { price: parsePrice(1.123456), desc: "1.123456 (6位小数)" },
    { price: parsePrice(1000), desc: "1000" },
    { price: parsePrice(99999.999999), desc: "99999.999999 (最大精度)" },
  ];

  for (const test of testPrices) {
    try {
      const hash = await deployerClient.writeContract({
        address: CONFIG.SETTLEMENT,
        abi: SETTLEMENT_ABI,
        functionName: "updatePrice",
        args: [testToken, test.price],
      });
      await client.waitForTransactionReceipt({ hash });

      // 验证读取
      const readPrice = await client.readContract({
        address: CONFIG.SETTLEMENT,
        abi: SETTLEMENT_ABI,
        functionName: "tokenPrices",
        args: [testToken],
      });

      if (readPrice === test.price) {
        reporter.add({ name: `价格精度 ${test.desc}`, status: "PASS", details: `设置=${test.price}, 读取=${readPrice}` });
      } else {
        reporter.add({ name: `价格精度 ${test.desc}`, status: "FAIL", error: `设置=${test.price}, 读取=${readPrice}` });
      }
    } catch (e: any) {
      reporter.add({ name: `价格精度 ${test.desc}`, status: "FAIL", error: e.message.slice(0, 50) });
    }
  }

  // ===== 测试 C: 杠杆精度 =====
  console.log("\n--- 测试 C: 杠杆精度 ---");

  const testLeverages = [
    { leverage: parseLeverage(1), desc: "1x" },
    { leverage: parseLeverage(1.5), desc: "1.5x" },
    { leverage: parseLeverage(10), desc: "10x" },
    { leverage: parseLeverage(50), desc: "50x" },
    { leverage: parseLeverage(100), desc: "100x (最大)" },
  ];

  // 恢复正常价格
  await deployerClient.writeContract({
    address: CONFIG.SETTLEMENT,
    abi: SETTLEMENT_ABI,
    functionName: "updatePrice",
    args: [testToken, parsePrice(1.0)],
  });

  for (const test of testLeverages) {
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

    const testSize = parseUSDT(10);
    const margin = (testSize * 10000n) / test.leverage;

    console.log(`\n测试杠杆 ${test.desc}, 所需保证金: ${formatUSDT(margin)}`);

    const longOrder = createOrder({
      trader: longWallet.address as Address,
      token: testToken,
      isLong: true,
      size: testSize,
      leverage: test.leverage,
      price: parsePrice(1.0),
      nonce: longNonce,
      orderType: 0,
    });

    const shortOrder = createOrder({
      trader: shortWallet.address as Address,
      token: testToken,
      isLong: false,
      size: testSize,
      leverage: test.leverage,
      price: parsePrice(1.0),
      nonce: shortNonce,
      orderType: 0,
    });

    try {
      const longSig = await signOrder(longClient, longAccount, longOrder);
      const shortSig = await signOrder(shortClient, shortAccount, shortOrder);

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
        matchPrice: parsePrice(1.0),
        matchSize: testSize,
      };

      const hash = await deployerClient.writeContract({
        address: CONFIG.SETTLEMENT,
        abi: SETTLEMENT_ABI,
        functionName: "settleBatch",
        args: [[matchedPair]],
      });
      await client.waitForTransactionReceipt({ hash });

      reporter.add({ name: `杠杆 ${test.desc}`, status: "PASS" });
    } catch (e: any) {
      reporter.add({ name: `杠杆 ${test.desc}`, status: "FAIL", error: e.message.slice(0, 50) });
    }

    await sleep(200);
  }

  // ===== 测试 D: PnL 计算精度 =====
  console.log("\n--- 测试 D: PnL 计算精度 ---");

  // 获取最新仓位
  const nextPairId = await client.readContract({
    address: CONFIG.SETTLEMENT,
    abi: SETTLEMENT_ABI,
    functionName: "nextPairId",
  });

  if (nextPairId > 1n) {
    const lastPairId = nextPairId - 1n;
    const pos = await client.readContract({
      address: CONFIG.SETTLEMENT,
      abi: SETTLEMENT_ABI,
      functionName: "getPairedPosition",
      args: [lastPairId],
    });

    if (pos.status === 0) { // ACTIVE
      // 测试不同价格变动下的 PnL 精度
      const priceChanges = [
        { price: parsePrice(1.0001), desc: "+0.01%" },
        { price: parsePrice(1.01), desc: "+1%" },
        { price: parsePrice(0.9999), desc: "-0.01%" },
        { price: parsePrice(0.99), desc: "-1%" },
      ];

      for (const pc of priceChanges) {
        await deployerClient.writeContract({
          address: CONFIG.SETTLEMENT,
          abi: SETTLEMENT_ABI,
          functionName: "updatePrice",
          args: [pos.token, pc.price],
        });

        const [longPnL, shortPnL] = await client.readContract({
          address: CONFIG.SETTLEMENT,
          abi: SETTLEMENT_ABI,
          functionName: "getUnrealizedPnL",
          args: [lastPairId],
        });

        console.log(`价格变动 ${pc.desc}: Long PnL=${Number(longPnL)/1e6}, Short PnL=${Number(shortPnL)/1e6}`);

        // 验证 PnL 为零和
        if (longPnL + shortPnL === 0n) {
          reporter.add({ name: `PnL 零和验证 (${pc.desc})`, status: "PASS" });
        } else {
          reporter.add({ name: `PnL 零和验证 (${pc.desc})`, status: "FAIL", error: `Long+Short=${Number(longPnL+shortPnL)/1e6}` });
        }
      }
    }
  }

  reporter.summary();
}

main().catch(console.error);
