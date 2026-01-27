/**
 * 测试 6: 资金费率
 *
 * 注意：当前合约 FUNDING_INTERVAL = 8 hours
 * 用户要求改为 5 分钟，需要修改合约常量并重新部署
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
  console.log("测试 6: 资金费率");
  console.log("=".repeat(50));

  const testToken = CONFIG.USDT;

  // 1. 设置资金费率
  console.log("\n设置资金费率...");
  // 资金费率使用 1e18 精度，0.01% = 0.0001 * 1e18 = 1e14
  const fundingRate = BigInt(1e14); // 0.01% 每 8 小时

  try {
    const hash = await deployerClient.writeContract({
      address: CONFIG.SETTLEMENT,
      abi: SETTLEMENT_ABI,
      functionName: "updateFundingRate",
      args: [testToken, fundingRate],
    });
    await client.waitForTransactionReceipt({ hash });
    reporter.add({ name: "设置资金费率", status: "PASS", details: `0.01% per 8h` });
  } catch (e: any) {
    reporter.add({ name: "设置资金费率", status: "FAIL", error: e.message.slice(0, 50) });
  }

  // 2. 查询当前资金费率
  try {
    const rate = await client.readContract({
      address: CONFIG.SETTLEMENT,
      abi: SETTLEMENT_ABI,
      functionName: "fundingRates",
      args: [testToken],
    });
    const ratePercent = Number(rate) / 1e18 * 100;
    console.log(`当前资金费率: ${ratePercent.toFixed(4)}%`);
    reporter.add({ name: "查询资金费率", status: "PASS", details: `${ratePercent.toFixed(4)}%` });
  } catch (e: any) {
    reporter.add({ name: "查询资金费率", status: "FAIL", error: e.message.slice(0, 50) });
  }

  // 3. 创建测试仓位
  console.log("\n创建测试仓位用于资金费结算...");

  const longWallet = wallets[3];  // 有 100 USDT 余额
  const shortWallet = wallets[5];  // 有 100 USDT 余额
  const { account: longAccount, client: longClient } = createWallet(longWallet.privateKey as Hex);
  const { account: shortAccount, client: shortClient } = createWallet(shortWallet.privateKey as Hex);

  // 检查余额
  const [longAvail] = await client.readContract({
    address: CONFIG.SETTLEMENT,
    abi: SETTLEMENT_ABI,
    functionName: "getUserBalance",
    args: [longWallet.address as Address],
  });

  if (longAvail < parseUSDT(5)) {
    reporter.add({ name: "余额检查", status: "FAIL", error: "余额不足" });
    return reporter.summary();
  }

  // 设置价格
  const currentPrice = parsePrice(1.0);
  await deployerClient.writeContract({
    address: CONFIG.SETTLEMENT,
    abi: SETTLEMENT_ABI,
    functionName: "updatePrice",
    args: [testToken, currentPrice],
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

  // 创建订单
  const orderSize = parseUSDT(50);
  const leverage = parseLeverage(5);

  const longOrder = createOrder({
    trader: longWallet.address as Address,
    token: testToken,
    isLong: true,
    size: orderSize,
    leverage: leverage,
    price: currentPrice,
    nonce: longNonce,
    orderType: 0,
  });

  const shortOrder = createOrder({
    trader: shortWallet.address as Address,
    token: testToken,
    isLong: false,
    size: orderSize,
    leverage: leverage,
    price: currentPrice,
    nonce: shortNonce,
    orderType: 0,
  });

  // 签名和撮合
  let newPairId: bigint;
  try {
    const longSig = await signOrder(longClient, longAccount, longOrder);
    const shortSig = await signOrder(shortClient, shortAccount, shortOrder);

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
      matchPrice: currentPrice,
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
    reporter.add({ name: "创建资金费测试仓位", status: "PASS", details: `Pair ID: ${newPairId}` });
  } catch (e: any) {
    reporter.add({ name: "创建资金费测试仓位", status: "FAIL", error: e.message.slice(0, 50) });
    return reporter.summary();
  }

  // 4. 查看仓位的累计资金费
  console.log("\n查看仓位累计资金费...");
  try {
    const pos = await client.readContract({
      address: CONFIG.SETTLEMENT,
      abi: SETTLEMENT_ABI,
      functionName: "getPairedPosition",
      args: [newPairId],
    });
    console.log(`  多头累计资金费: ${Number(pos.accFundingLong) / 1e6} USDT`);
    console.log(`  空头累计资金费: ${Number(pos.accFundingShort) / 1e6} USDT`);
    reporter.add({ name: "查看累计资金费", status: "PASS" });
  } catch (e: any) {
    reporter.add({ name: "查看累计资金费", status: "FAIL", error: e.message.slice(0, 50) });
  }

  // 5. 批量结算资金费
  console.log("\n批量结算资金费...");
  try {
    const hash = await deployerClient.writeContract({
      address: CONFIG.SETTLEMENT,
      abi: SETTLEMENT_ABI,
      functionName: "settleFundingBatch",
      args: [[newPairId]],
    });
    await client.waitForTransactionReceipt({ hash });
    reporter.add({ name: "批量结算资金费", status: "PASS", txHash: hash });

    // 再次查看累计资金费
    const posAfter = await client.readContract({
      address: CONFIG.SETTLEMENT,
      abi: SETTLEMENT_ABI,
      functionName: "getPairedPosition",
      args: [newPairId],
    });
    console.log(`结算后:`);
    console.log(`  多头累计资金费: ${Number(posAfter.accFundingLong) / 1e6} USDT`);
    console.log(`  空头累计资金费: ${Number(posAfter.accFundingShort) / 1e6} USDT`);
  } catch (e: any) {
    reporter.add({ name: "批量结算资金费", status: "FAIL", error: e.message.slice(0, 50) });
  }

  // 6. 提示：修改资金费间隔
  console.log("\n" + "=".repeat(50));
  console.log("注意：资金费结算间隔修改");
  console.log("=".repeat(50));
  console.log(`
当前合约设置: FUNDING_INTERVAL = 8 hours
用户要求: 修改为 5 分钟

需要修改 Settlement.sol 第 34 行:
  原: uint256 public constant FUNDING_INTERVAL = 8 hours;
  改: uint256 public constant FUNDING_INTERVAL = 5 minutes;

然后重新部署合约。
`);

  reporter.add({
    name: "资金费间隔配置",
    status: "SKIP",
    details: "需要修改合约 FUNDING_INTERVAL 为 5 minutes 并重新部署",
  });

  reporter.summary();
}

main().catch(console.error);
