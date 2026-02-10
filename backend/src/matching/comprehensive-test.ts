/**
 * 🧪 综合测试脚本
 *
 * 测试内容:
 * Phase 0: 资金分发 (30 ETH → 200 主钱包现货, 10 ETH → 100 派生钱包合约)
 *          + 派生钱包 depositETH 到 Settlement 合约
 *          + 注册交易 Session (autoDeposit 所需)
 * Phase 1: 现货交易 (200 钱包并发 + 按时间买卖)
 * Phase 2: 合约交易 (100 钱包, 50多50空, 10x-80x, 市价+限价)
 * Phase 3: 邀请返佣 (30 钱包绑定邀请码, 现货+合约返佣)
 * Phase 4: 手续费验证 (Maker 0.02% / Taker 0.05% + 平台钱包收款)
 * Phase 5: ADL 强制减仓 (100x 穿仓 + 保险基金耗尽 + ADL 触发)
 *
 * 运行: bun run comprehensive-test.ts [phase]
 *   phase 0 = 仅分发资金
 *   phase 1 = 仅现货
 *   phase 2 = 仅合约
 *   phase 3 = 仅邀请返佣
 *   phase 4 = 仅手续费验证
 *   phase 5 = 仅 ADL 测试
 *   不传 = 全部运行
 */

import {
  createWalletClient,
  createPublicClient,
  http,
  parseEther,
  formatEther,
  getAddress,
  type Address,
  type Hex,
  type WalletClient,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { baseSepolia } from "viem/chains";
import fs from "fs";

// ============================================================
// 配置
// ============================================================

const CONFIG = {
  RPC_URL: process.env.RPC_URL || "https://sepolia.base.org",
  API_URL: "http://localhost:8081",
  CHAIN_ID: 84532,

  // 合约地址 (使用 getAddress 确保 checksum 格式)
  TOKEN_FACTORY_ADDRESS: getAddress("0x583d35e9d407Ea03dE5A2139e792841353CB67b1"),
  SETTLEMENT_ADDRESS: getAddress("0x35ce4ed5e5d2515Ea05a2f49A70170Fa78e13F7c"),

  // 测试代币 (TPEPE3 - 新 TokenFactory，修复了 graduation lockMinting bug)
  TEST_TOKEN: getAddress("0x8c219589db787c1a5b57b1d2075c76c0d3f51c73"),

  // 邀请码
  REFERRAL_CODE: "CZHICLSF",
  REFERRER_ADDRESS: getAddress("0xAecb229194314999E396468eb091b42E44Bc3c8c"),

  // 资金分配
  ETH_FOR_SPOT: 30,        // 30 ETH 现货
  ETH_FOR_PERP: 10,        // 10 ETH 合约
  NUM_SPOT_WALLETS: 200,   // 200 个现货钱包
  NUM_PERP_WALLETS: 100,   // 100 个合约钱包

  // 交易参数
  SPOT_ROUNDS: 10,         // 现货交易轮数
  SPOT_BATCH_SIZE: 20,     // 每批并发数
  SPOT_ROUND_DELAY: 5000,  // 每轮间隔 5 秒
  PERP_ROUND_DELAY: 3000,  // 合约每轮间隔 3 秒
};

// 杠杆选项
const LEVERAGES = [10, 15, 20, 25, 30, 35, 40, 45, 50, 55, 60, 65, 70, 75, 80];

// ============================================================
// ABI
// ============================================================

const TOKEN_FACTORY_ABI = [
  {
    inputs: [{ name: "token", type: "address" }, { name: "minAmountOut", type: "uint256" }],
    name: "buy",
    outputs: [{ name: "amountOut", type: "uint256" }],
    stateMutability: "payable",
    type: "function",
  },
  {
    inputs: [{ name: "token", type: "address" }, { name: "tokenAmount", type: "uint256" }, { name: "minEthOut", type: "uint256" }],
    name: "sell",
    outputs: [{ name: "ethAmountOut", type: "uint256" }],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [{ name: "tokenAddress", type: "address" }],
    name: "getCurrentPrice",
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
] as const;

const ERC20_ABI = [
  {
    inputs: [{ name: "account", type: "address" }],
    name: "balanceOf",
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [{ name: "spender", type: "address" }, { name: "amount", type: "uint256" }],
    name: "approve",
    outputs: [{ name: "", type: "bool" }],
    stateMutability: "nonpayable",
    type: "function",
  },
] as const;

const SETTLEMENT_ABI = [
  {
    inputs: [],
    name: "depositETH",
    outputs: [],
    stateMutability: "payable",
    type: "function",
  },
  {
    inputs: [{ name: "user", type: "address" }],
    name: "getUserBalance",
    outputs: [
      { name: "available", type: "uint256" },
      { name: "locked", type: "uint256" },
    ],
    stateMutability: "view",
    type: "function",
  },
] as const;

// EIP-712 签名
const EIP712_DOMAIN = {
  name: "MemePerp",
  version: "1",
  chainId: CONFIG.CHAIN_ID,
  verifyingContract: CONFIG.SETTLEMENT_ADDRESS,
};

const ORDER_TYPES = {
  Order: [
    { name: "trader", type: "address" },
    { name: "token", type: "address" },
    { name: "isLong", type: "bool" },
    { name: "size", type: "uint256" },
    { name: "leverage", type: "uint256" },
    { name: "price", type: "uint256" },
    { name: "deadline", type: "uint256" },
    { name: "nonce", type: "uint256" },
    { name: "orderType", type: "uint8" },
  ],
} as const;

// ============================================================
// 工具函数
// ============================================================

const publicClient = createPublicClient({
  chain: baseSepolia,
  transport: http(CONFIG.RPC_URL),
});

interface MainWallet {
  index: number;
  address: string;
  privateKey: string;
}

interface TradingWallet {
  index: number;
  mainAddress: string;
  derivedAddress: string;
  privateKey: string;
}

// 加载钱包
const mainWallets: MainWallet[] = JSON.parse(
  fs.readFileSync("main-wallets.json", "utf-8")
);
const tradingWallets: TradingWallet[] = JSON.parse(
  fs.readFileSync("trading-wallets.json", "utf-8")
);

function createWallet(privateKey: Hex) {
  const account = privateKeyToAccount(privateKey);
  return createWalletClient({
    account,
    chain: baseSepolia,
    transport: http(CONFIG.RPC_URL),
  });
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function randomBetween(min: number, max: number) {
  return Math.random() * (max - min) + min;
}

function randomInt(min: number, max: number) {
  return Math.floor(randomBetween(min, max + 1));
}

// ============================================================
// Phase 0: 资金分发
// ============================================================

async function phase0_distributeETH() {
  console.log("\n" + "=".repeat(60));
  console.log("  Phase 0: 资金分发");
  console.log("=".repeat(60));

  const senderAccount = privateKeyToAccount(mainWallets[0].privateKey as Hex);
  const sender = createWalletClient({
    account: senderAccount,
    chain: baseSepolia,
    transport: http(CONFIG.RPC_URL),
  });
  const senderBalance = await publicClient.getBalance({
    address: mainWallets[0].address as Address,
  });
  console.log(`\n发送方: ${mainWallets[0].address}`);
  console.log(`发送方余额: ${formatEther(senderBalance)} ETH`);

  // 30 ETH 分给 200 个主钱包 = 0.15 ETH/钱包
  const ethPerSpotWallet = parseEther("0.15");
  // 10 ETH 分给 100 个派生钱包 = 0.1 ETH/钱包
  const ethPerPerpWallet = parseEther("0.1");

  // 获取初始 nonce (手动管理，避免 nonce 冲突)
  let nonce = await publicClient.getTransactionCount({
    address: mainWallets[0].address as Address,
  });
  console.log(`初始 nonce: ${nonce}`);

  // === Step 1: 分发到 200 个主钱包 (现货交易) ===
  console.log(`\n--- 分发 ${CONFIG.ETH_FOR_SPOT} ETH 到 ${CONFIG.NUM_SPOT_WALLETS} 个主钱包 (${formatEther(ethPerSpotWallet)} ETH/钱包) ---`);

  let spotSuccess = 0;
  let spotFail = 0;

  // 跳过 wallet[0] (它是发送方)，跳过已有余额的钱包
  let spotSkipped = 0;
  for (let i = 1; i < CONFIG.NUM_SPOT_WALLETS; i++) {
    const wallet = mainWallets[i];
    try {
      // 检查是否已有余额 (跳过已分发的)
      const existingBalance = await publicClient.getBalance({
        address: wallet.address as Address,
      });
      if (existingBalance >= parseEther("0.1")) {
        spotSkipped++;
        if (spotSkipped % 50 === 0) console.log(`  ⏭️ 已跳过 ${spotSkipped} 个有余额的钱包...`);
        continue;
      }

      const hash = await sender.sendTransaction({
        to: wallet.address as Address,
        value: ethPerSpotWallet,
        nonce,
      });
      spotSuccess++;
      nonce++; // 手动递增 nonce

      if (spotSuccess % 20 === 0) {
        console.log(`  ✅ ${spotSuccess} 笔发送完成 (进度: ${i + 1}/${CONFIG.NUM_SPOT_WALLETS}, nonce: ${nonce - 1})`);
        await sleep(1000);
      }
    } catch (e: any) {
      spotFail++;
      console.log(`  ❌ #${i} 失败: ${e.message?.slice(0, 80)}`);
      if (e.message?.includes("Nonce") || e.message?.includes("nonce")) {
        nonce = await publicClient.getTransactionCount({
          address: mainWallets[0].address as Address,
        });
        console.log(`  🔄 重置 nonce: ${nonce}`);
      }
      await sleep(2000);
    }
  }
  console.log(`  现货钱包: ✅ ${spotSuccess} 新发送 / ⏭️ ${spotSkipped} 已跳过 / ❌ ${spotFail} 失败`);
  console.log(`  现货钱包分发: ✅ ${spotSuccess} / ❌ ${spotFail}`);

  // === Step 2: 分发到 100 个派生钱包 (合约交易) ===
  console.log(`\n--- 分发 ${CONFIG.ETH_FOR_PERP} ETH 到 ${CONFIG.NUM_PERP_WALLETS} 个派生钱包 (${formatEther(ethPerPerpWallet)} ETH/钱包) ---`);

  let perpSuccess = 0;
  let perpFail = 0;

  let perpSkipped = 0;
  for (let i = 0; i < CONFIG.NUM_PERP_WALLETS; i++) {
    const wallet = tradingWallets[i];
    try {
      // 检查是否已有余额
      const existingBalance = await publicClient.getBalance({
        address: wallet.derivedAddress as Address,
      });
      if (existingBalance >= parseEther("0.05")) {
        perpSkipped++;
        continue;
      }

      const hash = await sender.sendTransaction({
        to: wallet.derivedAddress as Address,
        value: ethPerPerpWallet,
        nonce,
      });
      perpSuccess++;
      nonce++;

      if (perpSuccess % 20 === 0) {
        console.log(`  ✅ ${perpSuccess} 笔发送完成 (进度: ${i + 1}/${CONFIG.NUM_PERP_WALLETS}, nonce: ${nonce - 1})`);
        await sleep(1000);
      }
    } catch (e: any) {
      perpFail++;
      console.log(`  ❌ #${i} 失败: ${e.message?.slice(0, 80)}`);
      if (e.message?.includes("Nonce") || e.message?.includes("nonce")) {
        nonce = await publicClient.getTransactionCount({
          address: mainWallets[0].address as Address,
        });
        console.log(`  🔄 重置 nonce: ${nonce}`);
      }
      await sleep(2000);
    }
  }
  console.log(`  合约钱包: ✅ ${perpSuccess} 新发送 / ⏭️ ${perpSkipped} 已跳过 / ❌ ${perpFail} 失败`);

  // === Step 3: 派生钱包 depositETH 到 Settlement ===
  console.log(`\n--- 派生钱包存入 ETH 到 Settlement 合约 ---`);
  // 每个钱包存入 0.08 ETH (留 0.02 ETH 作为 gas)
  const depositAmount = parseEther("0.08");
  let depositSuccess = 0;
  let depositFail = 0;
  let depositSkipped = 0;

  // 等待前面的交易确认
  console.log(`  等待 5 秒让之前的交易确认...`);
  await sleep(5000);

  for (let i = 0; i < CONFIG.NUM_PERP_WALLETS; i++) {
    const wallet = tradingWallets[i];
    try {
      // 检查 Settlement 已有余额
      const settlementBal = await publicClient.readContract({
        address: CONFIG.SETTLEMENT_ADDRESS,
        abi: SETTLEMENT_ABI,
        functionName: "getUserBalance",
        args: [wallet.derivedAddress as Address],
      });
      const available = (settlementBal as any)[0] || 0n;
      if (BigInt(available.toString()) >= parseEther("0.05")) {
        depositSkipped++;
        continue;
      }

      // 检查派生钱包 ETH 余额
      const ethBal = await publicClient.getBalance({
        address: wallet.derivedAddress as Address,
      });
      if (ethBal < parseEther("0.05")) {
        depositFail++;
        if (depositFail <= 3) console.log(`  ⚠️ #${i} ETH 余额不足: ${formatEther(ethBal)}`);
        continue;
      }

      const client = createWallet(wallet.privateKey as Hex);
      const hash = await client.writeContract({
        address: CONFIG.SETTLEMENT_ADDRESS,
        abi: SETTLEMENT_ABI,
        functionName: "depositETH",
        args: [],
        value: depositAmount,
      });
      depositSuccess++;

      if (depositSuccess % 20 === 0) {
        console.log(`  ✅ ${depositSuccess} 笔存入完成 (进度: ${i + 1}/${CONFIG.NUM_PERP_WALLETS})`);
        await sleep(1000);
      }
    } catch (e: any) {
      depositFail++;
      if (depositFail <= 5) console.log(`  ❌ #${i} depositETH 失败: ${e.message?.slice(0, 80)}`);
      await sleep(500);
    }
  }
  console.log(`  Settlement 存入: ✅ ${depositSuccess} / ⏭️ ${depositSkipped} 已有 / ❌ ${depositFail} 失败`);

  // === Step 4: 注册交易 Session (所有派生钱包) ===
  console.log(`\n--- 注册交易 Session (autoDeposit 所需) ---`);
  let sessionSuccess = 0;
  let sessionFail = 0;

  for (let i = 0; i < CONFIG.NUM_PERP_WALLETS; i++) {
    const wallet = tradingWallets[i];
    try {
      // registerTradingSession 需要一个签名，使得 keccak256(sig) === privateKey
      // 但我们无法反推签名。改用更简单的方式：
      // 直接用私钥作为签名传入 (后端会做 keccak256(signature) 得到一个新私钥)
      // 这样注册的 session 地址会与我们的派生钱包地址不匹配...
      //
      // 正确做法: 我们需要找到一个 signature 使得 keccak256(signature) === wallet.privateKey
      // 这是不可能的 (keccak256 是单向函数)
      //
      // 所以最可靠的方式是: 已经在 Step 3 通过 depositETH 存入了足够保证金，
      // autoDepositIfNeeded 检测到 Settlement 余额充足，直接 return，不需要 session。
      //
      // 但万一下单金额 > 已存入的保证金，仍会需要 session。
      // 为安全起见，我们也通过 API balance/sync 同步余额。
      await fetch(`${CONFIG.API_URL}/api/balance/sync`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ address: wallet.derivedAddress }),
      });
      sessionSuccess++;
    } catch (e: any) {
      sessionFail++;
    }
  }
  console.log(`  余额同步: ✅ ${sessionSuccess} / ❌ ${sessionFail}`);

  console.log(`\n✅ Phase 0 完成! 总花费: ~${CONFIG.ETH_FOR_SPOT + CONFIG.ETH_FOR_PERP} ETH`);
}

// ============================================================
// Phase 1: 现货交易
// ============================================================

async function phase1_spotTrading() {
  console.log("\n" + "=".repeat(60));
  console.log("  Phase 1: 现货交易测试 (200 钱包并发买卖)");
  console.log("=".repeat(60));

  // 获取当前价格
  const currentPrice = await publicClient.readContract({
    address: CONFIG.TOKEN_FACTORY_ADDRESS,
    abi: TOKEN_FACTORY_ABI,
    functionName: "getCurrentPrice",
    args: [CONFIG.TEST_TOKEN],
  });
  console.log(`\n当前价格: ${Number(currentPrice) / 1e18} ETH`);

  let totalBuys = 0;
  let totalSells = 0;
  let totalBuyFails = 0;
  let totalSellFails = 0;

  for (let round = 1; round <= CONFIG.SPOT_ROUNDS; round++) {
    console.log(`\n--- 第 ${round}/${CONFIG.SPOT_ROUNDS} 轮 ---`);

    // 每轮随机选择一批钱包买入，一批卖出
    const shuffled = [...Array(CONFIG.NUM_SPOT_WALLETS).keys()].sort(() => Math.random() - 0.5);

    // 前3轮纯买入（积累代币），之后买卖混合
    const isBuyOnly = round <= 3;
    const buyers = isBuyOnly
      ? shuffled.slice(0, CONFIG.SPOT_BATCH_SIZE * 2) // 纯买入轮：双倍买家
      : shuffled.slice(0, CONFIG.SPOT_BATCH_SIZE);
    const sellers = isBuyOnly
      ? [] // 纯买入轮：无卖家
      : shuffled.slice(CONFIG.SPOT_BATCH_SIZE, CONFIG.SPOT_BATCH_SIZE * 2);

    // 奇数轮多买少卖 (价格上涨)，偶数轮多卖少买 (价格下跌)
    const isBullRound = round % 3 !== 0; // 2/3 轮看涨

    // 并发买入
    const buyPromises = buyers.map(async (idx) => {
      const wallet = mainWallets[idx];
      try {
        const client = createWallet(wallet.privateKey as Hex);
        // 随机买入金额: 0.01 ~ 0.08 ETH
        const buyAmount = parseEther(randomBetween(0.01, 0.08).toFixed(4));

        const hash = await client.writeContract({
          address: CONFIG.TOKEN_FACTORY_ADDRESS,
          abi: TOKEN_FACTORY_ABI,
          functionName: "buy",
          args: [CONFIG.TEST_TOKEN, 0n],
          value: buyAmount,
        });
        totalBuys++;
        return { success: true, idx, hash, type: "buy", amount: formatEther(buyAmount) };
      } catch (e: any) {
        totalBuyFails++;
        return { success: false, idx, error: e.message?.slice(0, 60), type: "buy" };
      }
    });

    // 并发卖出 (如果持有 token)
    const sellPromises = sellers.map(async (idx) => {
      const wallet = mainWallets[idx];
      try {
        const client = createWallet(wallet.privateKey as Hex);

        // 先查余额
        const tokenBalance = await publicClient.readContract({
          address: CONFIG.TEST_TOKEN,
          abi: ERC20_ABI,
          functionName: "balanceOf",
          args: [wallet.address as Address],
        });

        if (tokenBalance === 0n) {
          return { success: false, idx, error: "无代币可卖", type: "sell" };
        }

        // 卖出 10% ~ 50% 的持仓
        const sellRatio = randomBetween(0.1, 0.5);
        const sellAmount = (tokenBalance * BigInt(Math.floor(sellRatio * 1000))) / 1000n;

        if (sellAmount === 0n) {
          return { success: false, idx, error: "卖出量为0", type: "sell" };
        }

        // 先 approve TokenFactory
        await client.writeContract({
          address: CONFIG.TEST_TOKEN,
          abi: ERC20_ABI,
          functionName: "approve",
          args: [CONFIG.TOKEN_FACTORY_ADDRESS, sellAmount],
        });
        await sleep(500);

        const hash = await client.writeContract({
          address: CONFIG.TOKEN_FACTORY_ADDRESS,
          abi: TOKEN_FACTORY_ABI,
          functionName: "sell",
          args: [CONFIG.TEST_TOKEN, sellAmount, 0n],
        });
        totalSells++;
        return { success: true, idx, hash, type: "sell" };
      } catch (e: any) {
        totalSellFails++;
        return { success: false, idx, error: e.message?.slice(0, 60), type: "sell" };
      }
    });

    // 并发执行
    const results = await Promise.allSettled([...buyPromises, ...sellPromises]);
    const successCount = results.filter(
      (r) => r.status === "fulfilled" && (r.value as any).success
    ).length;
    const failCount = results.length - successCount;

    // 获取最新价格
    const newPrice = await publicClient.readContract({
      address: CONFIG.TOKEN_FACTORY_ADDRESS,
      abi: TOKEN_FACTORY_ABI,
      functionName: "getCurrentPrice",
      args: [CONFIG.TEST_TOKEN],
    });

    const priceChange = ((Number(newPrice) - Number(currentPrice)) / Number(currentPrice) * 100).toFixed(2);
    console.log(`  ✅ ${successCount} 笔成交, ❌ ${failCount} 笔失败`);
    console.log(`  📊 价格: ${(Number(newPrice) / 1e18).toExponential(4)} ETH (${priceChange}%)`);

    // 等待下一轮
    if (round < CONFIG.SPOT_ROUNDS) {
      console.log(`  ⏳ 等待 ${CONFIG.SPOT_ROUND_DELAY / 1000} 秒...`);
      await sleep(CONFIG.SPOT_ROUND_DELAY);
    }
  }

  console.log(`\n✅ Phase 1 完成!`);
  console.log(`  总买入: ${totalBuys} (失败: ${totalBuyFails})`);
  console.log(`  总卖出: ${totalSells} (失败: ${totalSellFails})`);
}

// ============================================================
// Phase 2: 合约交易
// ============================================================

async function phase2_perpTrading() {
  console.log("\n" + "=".repeat(60));
  console.log("  Phase 2: 合约交易测试 (100 钱包, 50多/50空, 10x-80x)");
  console.log("=".repeat(60));

  // 杠杆分配: 10x ~ 80x (使用全局 LEVERAGES)

  // 前 50 个做多，后 50 个做空
  const longWallets = tradingWallets.slice(0, 50);
  const shortWallets = tradingWallets.slice(50, 100);

  console.log(`\n多头钱包: ${longWallets.length} 个`);
  console.log(`空头钱包: ${shortWallets.length} 个`);

  // 获取当前价格
  const currentPrice = await publicClient.readContract({
    address: CONFIG.TOKEN_FACTORY_ADDRESS,
    abi: TOKEN_FACTORY_ABI,
    functionName: "getCurrentPrice",
    args: [CONFIG.TEST_TOKEN],
  });
  const priceNum = Number(currentPrice);
  console.log(`当前价格: ${(priceNum / 1e18).toExponential(4)} ETH`);

  // === Step 1: 先下市价单 (前 30 多 + 前 30 空) ===
  console.log(`\n--- Step 1: 市价单 (30 多 + 30 空) ---`);

  const marketOrders: Promise<any>[] = [];

  // 30 多头市价单
  // ⚠️ size 是 ETH 名义价值 (1e18 精度)，不是代币数量！
  // margin = size / leverage, 所以 size = margin * leverage
  for (let i = 0; i < 30; i++) {
    const wallet = longWallets[i];
    const leverage = LEVERAGES[i % LEVERAGES.length];
    // margin 约 0.002~0.005 ETH (小额测试，确保保证金够用)
    const marginEth = randomBetween(0.002, 0.005);
    const sizeEth = marginEth * leverage;
    // size 是 ETH 名义价值 (1e18 精度)
    const sizeWei = parseEther(sizeEth.toFixed(6));

    marketOrders.push(
      submitPerpOrder({
        privateKey: wallet.privateKey as Hex,
        trader: wallet.derivedAddress as Address,
        isLong: true,
        size: sizeWei,
        leverage: BigInt(leverage) * 10000n, // 1e4 精度
        price: 0n,     // 市价
        orderType: 0,  // MARKET
      }).then((r) => ({
        ...r,
        idx: i,
        side: "LONG",
        leverage,
        marginEth: marginEth.toFixed(4),
        sizeEth: sizeEth.toFixed(4),
      }))
    );

    await sleep(200); // 小延迟避免 nonce 冲突
  }

  // 30 空头市价单
  for (let i = 0; i < 30; i++) {
    const wallet = shortWallets[i];
    const leverage = LEVERAGES[i % LEVERAGES.length];
    const marginEth = randomBetween(0.002, 0.005);
    const sizeEth = marginEth * leverage;
    const sizeWei = parseEther(sizeEth.toFixed(6));

    marketOrders.push(
      submitPerpOrder({
        privateKey: wallet.privateKey as Hex,
        trader: wallet.derivedAddress as Address,
        isLong: false,
        size: sizeWei,
        leverage: BigInt(leverage) * 10000n,
        price: 0n,
        orderType: 0,
      }).then((r) => ({
        ...r,
        idx: i,
        side: "SHORT",
        leverage,
        marginEth: marginEth.toFixed(4),
        sizeEth: sizeEth.toFixed(4),
      }))
    );

    await sleep(200);
  }

  const marketResults = await Promise.allSettled(marketOrders);
  const marketSuccess = marketResults.filter(
    (r) => r.status === "fulfilled" && (r.value as any).success
  ).length;
  console.log(`  市价单: ✅ ${marketSuccess} / ❌ ${60 - marketSuccess}`);

  // 打印一些成交详情
  for (const r of marketResults) {
    if (r.status === "fulfilled" && (r.value as any).success) {
      const v = r.value as any;
      if (v.matches?.length > 0) {
        console.log(`  ${v.side} #${v.idx} ${v.leverage}x: 成交 ${v.matches.length} 笔`);
      }
    }
  }

  await sleep(3000);

  // === Step 2: 限价单 (20 多 + 20 空) ===
  console.log(`\n--- Step 2: 限价单 (20 多 + 20 空) ---`);

  const updatedPrice = await publicClient.readContract({
    address: CONFIG.TOKEN_FACTORY_ADDRESS,
    abi: TOKEN_FACTORY_ABI,
    functionName: "getCurrentPrice",
    args: [CONFIG.TEST_TOKEN],
  });
  const updatedPriceNum = Number(updatedPrice);

  const limitOrders: Promise<any>[] = [];

  // 20 多头限价单 (价格低于当前价 1%-10%)
  for (let i = 30; i < 50; i++) {
    const wallet = longWallets[i];
    const leverage = LEVERAGES[i % LEVERAGES.length];
    const marginEth = randomBetween(0.002, 0.005);
    const sizeEth = marginEth * leverage;
    const sizeWei = parseEther(sizeEth.toFixed(6));
    const discount = randomBetween(0.01, 0.10); // 1%~10% 折扣
    const limitPrice = BigInt(Math.floor(updatedPriceNum * (1 - discount)));

    limitOrders.push(
      submitPerpOrder({
        privateKey: wallet.privateKey as Hex,
        trader: wallet.derivedAddress as Address,
        isLong: true,
        size: sizeWei,
        leverage: BigInt(leverage) * 10000n,
        price: limitPrice,
        orderType: 1, // LIMIT
      }).then((r) => ({
        ...r,
        idx: i,
        side: "LONG LIMIT",
        leverage,
        limitPrice: (Number(limitPrice) / 1e18).toExponential(4),
      }))
    );

    await sleep(200);
  }

  // 20 空头限价单 (价格高于当前价 1%-10%)
  for (let i = 30; i < 50; i++) {
    const wallet = shortWallets[i];
    const leverage = LEVERAGES[i % LEVERAGES.length];
    const marginEth = randomBetween(0.002, 0.005);
    const sizeEth = marginEth * leverage;
    const sizeWei = parseEther(sizeEth.toFixed(6));
    const premium = randomBetween(0.01, 0.10);
    const limitPrice = BigInt(Math.floor(updatedPriceNum * (1 + premium)));

    limitOrders.push(
      submitPerpOrder({
        privateKey: wallet.privateKey as Hex,
        trader: wallet.derivedAddress as Address,
        isLong: false,
        size: sizeWei,
        leverage: BigInt(leverage) * 10000n,
        price: limitPrice,
        orderType: 1,
      }).then((r) => ({
        ...r,
        idx: i,
        side: "SHORT LIMIT",
        leverage,
        limitPrice: (Number(limitPrice) / 1e18).toExponential(4),
      }))
    );

    await sleep(200);
  }

  const limitResults = await Promise.allSettled(limitOrders);
  const limitSuccess = limitResults.filter(
    (r) => r.status === "fulfilled" && (r.value as any).success
  ).length;
  console.log(`  限价单: ✅ ${limitSuccess} / ❌ ${40 - limitSuccess}`);

  // === Step 3: 制造价格波动触发爆仓 ===
  console.log(`\n--- Step 3: 现货波动制造爆仓机会 ---`);

  // 用主钱包大量买入推高价格 (砸空头)
  console.log(`  📈 大量买入推高价格 (触发空头爆仓)...`);
  for (let i = 1; i <= 10; i++) {
    try {
      const wallet = createWallet(mainWallets[i].privateKey as Hex);
      const buyAmount = parseEther("0.3"); // 大额买入
      await wallet.writeContract({
        address: CONFIG.TOKEN_FACTORY_ADDRESS,
        abi: TOKEN_FACTORY_ABI,
        functionName: "buy",
        args: [CONFIG.TEST_TOKEN, 0n],
        value: buyAmount,
      });
      console.log(`  ✅ 钱包 #${i} 买入 0.3 ETH`);
      await sleep(500);
    } catch (e: any) {
      console.log(`  ❌ 钱包 #${i} 买入失败: ${e.message?.slice(0, 60)}`);
    }
  }

  // 检查价格变化
  const afterBuyPrice = await publicClient.readContract({
    address: CONFIG.TOKEN_FACTORY_ADDRESS,
    abi: TOKEN_FACTORY_ABI,
    functionName: "getCurrentPrice",
    args: [CONFIG.TEST_TOKEN],
  });
  const priceUp = ((Number(afterBuyPrice) - updatedPriceNum) / updatedPriceNum * 100).toFixed(2);
  console.log(`  📊 价格变化: ${priceUp}% (${(Number(afterBuyPrice) / 1e18).toExponential(4)} ETH)`);

  await sleep(5000);

  // 然后大量卖出压低价格 (砸多头)
  console.log(`\n  📉 大量卖出压低价格 (触发多头爆仓)...`);
  for (let i = 1; i <= 15; i++) {
    try {
      const wallet = mainWallets[i];
      const client = createWallet(wallet.privateKey as Hex);

      const tokenBalance = await publicClient.readContract({
        address: CONFIG.TEST_TOKEN,
        abi: ERC20_ABI,
        functionName: "balanceOf",
        args: [wallet.address as Address],
      });

      if (tokenBalance > 0n) {
        // 先 approve
        await client.writeContract({
          address: CONFIG.TEST_TOKEN,
          abi: ERC20_ABI,
          functionName: "approve",
          args: [CONFIG.TOKEN_FACTORY_ADDRESS, tokenBalance],
        });
        await sleep(500);

        // 全部卖出
        await client.writeContract({
          address: CONFIG.TOKEN_FACTORY_ADDRESS,
          abi: TOKEN_FACTORY_ABI,
          functionName: "sell",
          args: [CONFIG.TEST_TOKEN, tokenBalance, 0n],
        });
        console.log(`  ✅ 钱包 #${i} 全部卖出`);
        await sleep(500);
      }
    } catch (e: any) {
      console.log(`  ❌ 钱包 #${i} 卖出失败: ${e.message?.slice(0, 60)}`);
    }
  }

  const afterSellPrice = await publicClient.readContract({
    address: CONFIG.TOKEN_FACTORY_ADDRESS,
    abi: TOKEN_FACTORY_ABI,
    functionName: "getCurrentPrice",
    args: [CONFIG.TEST_TOKEN],
  });
  const priceDown = ((Number(afterSellPrice) - Number(afterBuyPrice)) / Number(afterBuyPrice) * 100).toFixed(2);
  console.log(`  📊 价格变化: ${priceDown}% (${(Number(afterSellPrice) / 1e18).toExponential(4)} ETH)`);

  // 检查仓位和爆仓
  console.log(`\n--- 检查仓位状态 ---`);
  await checkPositionStatus();

  console.log(`\n✅ Phase 2 完成!`);
}

// 提交永续合约订单
async function submitPerpOrder(params: {
  privateKey: Hex;
  trader: Address;
  isLong: boolean;
  size: bigint;
  leverage: bigint;
  price: bigint;
  orderType: number;
}): Promise<any> {
  try {
    const account = privateKeyToAccount(params.privateKey);
    const walletClient = createWalletClient({
      account,
      chain: baseSepolia,
      transport: http(CONFIG.RPC_URL),
    });

    // 获取 nonce
    let nonce = 0n;
    try {
      const nonceRes = await fetch(`${CONFIG.API_URL}/api/user/${params.trader}/nonce`);
      const nonceData = await nonceRes.json();
      nonce = BigInt(nonceData.nonce || 0);
    } catch {
      nonce = 0n;
    }

    const deadline = BigInt(Math.floor(Date.now() / 1000) + 3600);

    const orderMessage = {
      trader: params.trader,
      token: CONFIG.TEST_TOKEN,
      isLong: params.isLong,
      size: params.size,
      leverage: params.leverage,
      price: params.price,
      deadline,
      nonce,
      orderType: params.orderType,
    };

    // 签名
    const signature = await walletClient.signTypedData({
      domain: EIP712_DOMAIN,
      types: ORDER_TYPES,
      primaryType: "Order",
      message: orderMessage,
    });

    // 提交到 API
    const response = await fetch(`${CONFIG.API_URL}/api/order/submit`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        trader: orderMessage.trader,
        token: orderMessage.token,
        isLong: orderMessage.isLong,
        size: orderMessage.size.toString(),
        leverage: orderMessage.leverage.toString(),
        price: orderMessage.price.toString(),
        deadline: orderMessage.deadline.toString(),
        nonce: orderMessage.nonce.toString(),
        orderType: orderMessage.orderType,
        signature,
      }),
    });

    const result = await response.json();
    return { success: result.success !== false && !result.error, ...result };
  } catch (e: any) {
    return { success: false, error: e.message?.slice(0, 100) };
  }
}

// 检查仓位状态
async function checkPositionStatus() {
  try {
    // 检查前 10 个多头和空头的仓位
    for (let i = 0; i < 5; i++) {
      const longTrader = tradingWallets[i].derivedAddress;
      const shortTrader = tradingWallets[50 + i].derivedAddress;

      const longRes = await fetch(`${CONFIG.API_URL}/api/user/${longTrader}/positions`);
      const shortRes = await fetch(`${CONFIG.API_URL}/api/user/${shortTrader}/positions`);

      const longData = await longRes.json();
      const shortData = await shortRes.json();

      if (longData.positions?.length > 0) {
        const p = longData.positions[0];
        console.log(`  LONG #${i}: size=${p.size}, pnl=${p.unrealizedPnL}, liq=${p.liquidationPrice}`);
      }
      if (shortData.positions?.length > 0) {
        const p = shortData.positions[0];
        console.log(`  SHORT #${i}: size=${p.size}, pnl=${p.unrealizedPnL}, liq=${p.liquidationPrice}`);
      }
    }
  } catch (e: any) {
    console.log(`  检查仓位失败: ${e.message?.slice(0, 60)}`);
  }
}

// ============================================================
// Phase 3: 邀请返佣测试
// ============================================================

async function phase3_referralTest() {
  console.log("\n" + "=".repeat(60));
  console.log("  Phase 3: 邀请返佣测试 (30 钱包)");
  console.log("=".repeat(60));

  // 使用主钱包 170~199 做邀请返佣测试
  const referralWallets = mainWallets.slice(170, 200);
  console.log(`\n邀请码: ${CONFIG.REFERRAL_CODE}`);
  console.log(`推荐人: ${CONFIG.REFERRER_ADDRESS}`);
  console.log(`测试钱包: #170 ~ #199 (${referralWallets.length} 个)`);

  // === Step 1: 绑定邀请码 ===
  console.log(`\n--- Step 1: 绑定邀请码 ---`);
  let bindSuccess = 0;

  for (let i = 0; i < referralWallets.length; i++) {
    const wallet = referralWallets[i];
    try {
      const res = await fetch(`${CONFIG.API_URL}/api/referral/bind`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          address: wallet.address,
          referralCode: CONFIG.REFERRAL_CODE,
        }),
      });
      const data = await res.json();
      if (data.success) {
        bindSuccess++;
      } else {
        console.log(`  ⚠️ #${170 + i} 绑定: ${data.message || data.error || "unknown"}`);
      }
    } catch (e: any) {
      console.log(`  ❌ #${170 + i} 绑定失败: ${e.message?.slice(0, 60)}`);
    }
  }
  console.log(`  绑定结果: ✅ ${bindSuccess} / ${referralWallets.length}`);

  // === Step 2: 用绑定了邀请码的钱包做现货交易 ===
  console.log(`\n--- Step 2: 现货交易产生返佣 ---`);

  let tradeSuccess = 0;
  for (let i = 0; i < referralWallets.length; i++) {
    const wallet = referralWallets[i];
    try {
      const client = createWallet(wallet.privateKey as Hex);
      const buyAmount = parseEther(randomBetween(0.02, 0.05).toFixed(4));

      await client.writeContract({
        address: CONFIG.TOKEN_FACTORY_ADDRESS,
        abi: TOKEN_FACTORY_ABI,
        functionName: "buy",
        args: [CONFIG.TEST_TOKEN, 0n],
        value: buyAmount,
      });
      tradeSuccess++;

      if ((i + 1) % 10 === 0) {
        console.log(`  ✅ ${i + 1}/${referralWallets.length} 笔交易完成`);
      }
      await sleep(500);
    } catch (e: any) {
      console.log(`  ❌ #${170 + i} 交易失败: ${e.message?.slice(0, 60)}`);
    }
  }
  console.log(`  现货交易: ✅ ${tradeSuccess} / ${referralWallets.length}`);

  // === Step 3: 用绑定了邀请码的派生钱包做合约交易 ===
  console.log(`\n--- Step 3: 合约交易产生返佣 ---`);

  // 使用派生钱包 70~99 (对应主钱包 70~99，但我们绑定 170~199 的主钱包)
  // 实际上合约返佣是根据交易者地址绑定的，所以需要先绑定派生钱包地址
  console.log(`  绑定派生钱包邀请码...`);
  for (let i = 70; i < 100; i++) {
    try {
      await fetch(`${CONFIG.API_URL}/api/referral/bind`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          address: tradingWallets[i].derivedAddress,
          referralCode: CONFIG.REFERRAL_CODE,
        }),
      });
    } catch { }
  }

  // 确保派生钱包 70-84 有保证金 (Phase 0 已存入，但如果单独运行 Phase 3 需要)
  console.log(`  检查并存入保证金...`);
  for (let i = 70; i < 85; i++) {
    const wallet = tradingWallets[i];
    try {
      const bal = await publicClient.readContract({
        address: CONFIG.SETTLEMENT_ADDRESS,
        abi: SETTLEMENT_ABI,
        functionName: "getUserBalance",
        args: [wallet.derivedAddress as Address],
      });
      const available = (bal as any)[0] || bal;
      if (BigInt(available.toString()) < parseEther("0.01")) {
        // 需要存入
        const client = createWallet(wallet.privateKey as Hex);
        const ethBal = await publicClient.getBalance({ address: wallet.derivedAddress as Address });
        if (ethBal > parseEther("0.02")) {
          await client.writeContract({
            address: CONFIG.SETTLEMENT_ADDRESS,
            abi: SETTLEMENT_ABI,
            functionName: "depositETH",
            args: [],
            value: parseEther("0.05"),
          });
          await sleep(300);
        }
      }
    } catch (e: any) {
      // ignore
    }
  }

  // 下合约单
  let perpTradeSuccess = 0;
  const currentPrice = await publicClient.readContract({
    address: CONFIG.TOKEN_FACTORY_ADDRESS,
    abi: TOKEN_FACTORY_ABI,
    functionName: "getCurrentPrice",
    args: [CONFIG.TEST_TOKEN],
  });
  const priceNum = Number(currentPrice);

  for (let i = 70; i < 85; i++) {
    const wallet = tradingWallets[i];
    const leverage = LEVERAGES[i % LEVERAGES.length];
    // size = ETH 名义价值, margin = 0.003 ETH * leverage
    const sizeWei = parseEther((0.003 * leverage).toFixed(6));

    const result = await submitPerpOrder({
      privateKey: wallet.privateKey as Hex,
      trader: wallet.derivedAddress as Address,
      isLong: i % 2 === 0,
      size: sizeWei,
      leverage: BigInt(leverage) * 10000n,
      price: 0n,
      orderType: 0,
    });

    if (result.success) perpTradeSuccess++;
    await sleep(300);
  }
  console.log(`  合约交易: ✅ ${perpTradeSuccess} / 15`);

  // === Step 4: 检查返佣 ===
  console.log(`\n--- Step 4: 查询返佣记录 ---`);
  try {
    const commRes = await fetch(
      `${CONFIG.API_URL}/api/referral/commissions?address=${CONFIG.REFERRER_ADDRESS}&limit=10`
    );
    const commData = await commRes.json();
    console.log(`  返佣记录: ${JSON.stringify(commData).slice(0, 200)}`);

    const referrerRes = await fetch(
      `${CONFIG.API_URL}/api/referral/referrer?address=${CONFIG.REFERRER_ADDRESS}`
    );
    const referrerData = await referrerRes.json();
    console.log(`  推荐人信息: ${JSON.stringify(referrerData).slice(0, 200)}`);
  } catch (e: any) {
    console.log(`  查询返佣失败: ${e.message?.slice(0, 60)}`);
  }

  console.log(`\n✅ Phase 3 完成!`);
}

// ============================================================
// Phase 4: 手续费验证 (Maker/Taker)
// ============================================================

async function phase4_feeVerification() {
  console.log("\n" + "=".repeat(60));
  console.log("  Phase 4: 手续费验证 (Maker 0.02% / Taker 0.05%)");
  console.log("=".repeat(60));

  const FEE_RECEIVER = "0x5AF11d4784c3739cf2FD51Fdc272ae4957ADf7fE".toLowerCase();

  // 记录测试前的 FEE_RECEIVER mode2 余额
  let feeBalanceBefore = 0n;
  try {
    const res = await fetch(`${CONFIG.API_URL}/api/user/${FEE_RECEIVER}/balance`);
    const data = await res.json();
    feeBalanceBefore = BigInt(data.mode2Adjustment || data.availableBalance || "0");
  } catch { }
  console.log(`\n手续费钱包 mode2 初始: ${Number(feeBalanceBefore) / 1e18} ETH`);

  // === Step 1: 下限价单 (Maker) ===
  console.log(`\n--- Step 1: 挂限价单 (Maker 方) ---`);

  const currentPrice = await publicClient.readContract({
    address: CONFIG.TOKEN_FACTORY_ADDRESS,
    abi: TOKEN_FACTORY_ABI,
    functionName: "getCurrentPrice",
    args: [CONFIG.TEST_TOKEN],
  });
  const priceNum = Number(currentPrice);

  // 用钱包 0-4 挂 5 个限价买单 (Long Limit, 低于当前价 0.1%)
  const makerWallets = tradingWallets.slice(0, 5);
  const makerPrice = BigInt(Math.floor(priceNum * 0.999)); // 0.1% 折扣

  const marginEth = 0.005;
  const leverage = 20;
  const sizeEth = marginEth * leverage; // 0.1 ETH notional

  for (let i = 0; i < 5; i++) {
    const wallet = makerWallets[i];
    const result = await submitPerpOrder({
      privateKey: wallet.privateKey as Hex,
      trader: wallet.derivedAddress as Address,
      isLong: true,
      size: parseEther(sizeEth.toFixed(6)),
      leverage: BigInt(leverage) * 10000n,
      price: makerPrice,
      orderType: 1, // LIMIT
    });
    console.log(`  Maker #${i}: ${result.success ? "✅ 挂单成功" : "❌ " + (result.error || "failed")}`);
    await sleep(300);
  }

  // === Step 2: 下市价单吃掉限价单 (Taker) ===
  console.log(`\n--- Step 2: 市价单吃单 (Taker 方) ---`);

  const takerWallets = tradingWallets.slice(50, 55);
  let totalMatched = 0;

  for (let i = 0; i < 5; i++) {
    const wallet = takerWallets[i];
    const result = await submitPerpOrder({
      privateKey: wallet.privateKey as Hex,
      trader: wallet.derivedAddress as Address,
      isLong: false, // Short 吃掉 Long Limit
      size: parseEther(sizeEth.toFixed(6)),
      leverage: BigInt(leverage) * 10000n,
      price: 0n, // 市价
      orderType: 0, // MARKET
    });
    if (result.success && result.matches?.length > 0) {
      totalMatched++;
      console.log(`  Taker #${i}: ✅ 成交 ${result.matches.length} 笔`);
    } else {
      console.log(`  Taker #${i}: ${result.success ? "⚠️ 未成交" : "❌ " + (result.error || "failed")}`);
    }
    await sleep(300);
  }

  // === Step 3: 验证手续费 ===
  console.log(`\n--- Step 3: 验证手续费收取 ---`);
  await sleep(2000);

  let feeBalanceAfter = 0n;
  try {
    const res = await fetch(`${CONFIG.API_URL}/api/user/${FEE_RECEIVER}/balance`);
    const data = await res.json();
    feeBalanceAfter = BigInt(data.mode2Adjustment || data.availableBalance || "0");
  } catch { }

  const feeCollected = feeBalanceAfter - feeBalanceBefore;
  console.log(`  手续费钱包 mode2 变化: +${Number(feeCollected) / 1e18} ETH`);

  // 预期: 5 笔 Maker (0.02%) + 5 笔 Taker (0.05%)
  // notional = 0.1 ETH × 5 = 0.5 ETH
  // Maker fee = 0.5 × 0.0002 = 0.0001 ETH
  // Taker fee = 0.5 × 0.0005 = 0.00025 ETH
  // Total ≈ 0.00035 ETH
  const expectedMin = parseEther("0.0002");
  const expectedMax = parseEther("0.001");

  if (feeCollected > 0n) {
    console.log(`  ✅ 手续费已正确收取到平台钱包`);
    if (feeCollected >= expectedMin && feeCollected <= expectedMax) {
      console.log(`  ✅ 金额在预期范围内 (${Number(expectedMin) / 1e18} ~ ${Number(expectedMax) / 1e18} ETH)`);
    } else {
      console.log(`  ⚠️ 金额偏离预期范围 (实际: ${Number(feeCollected) / 1e18}, 预期: ${Number(expectedMin) / 1e18} ~ ${Number(expectedMax) / 1e18})`);
    }
  } else {
    console.log(`  ❌ 未检测到手续费收入 (可能成交数不足: ${totalMatched} 笔)`);
  }

  // 检查个别交易的 Maker/Taker 标记
  console.log(`\n--- Step 4: 检查 Maker/Taker 标记 ---`);
  for (let i = 0; i < 2; i++) {
    try {
      const res = await fetch(`${CONFIG.API_URL}/api/trades/${tradingWallets[i].derivedAddress}/history`);
      const data = await res.json();
      const trades = data.trades || data;
      if (Array.isArray(trades) && trades.length > 0) {
        const t = trades[0];
        console.log(`  钱包 #${i} 最近交易: isMaker=${t.isMaker}, fee=${t.fee}`);
      }
    } catch { }
  }
  for (let i = 50; i < 52; i++) {
    try {
      const res = await fetch(`${CONFIG.API_URL}/api/trades/${tradingWallets[i].derivedAddress}/history`);
      const data = await res.json();
      const trades = data.trades || data;
      if (Array.isArray(trades) && trades.length > 0) {
        const t = trades[0];
        console.log(`  钱包 #${i} 最近交易: isMaker=${t.isMaker}, fee=${t.fee}`);
      }
    } catch { }
  }

  console.log(`\n✅ Phase 4 完成!`);
}

// ============================================================
// Phase 5: ADL 强制减仓测试
// ============================================================

async function phase5_adlTest() {
  console.log("\n" + "=".repeat(60));
  console.log("  Phase 5: ADL 强制减仓测试");
  console.log("=".repeat(60));
  console.log("  目标: 制造穿仓 → 保险基金不足 → ADL 触发");

  // === Step 1: 建立对手方盈利仓位 (低杠杆，大额) ===
  console.log(`\n--- Step 1: 建立对手方仓位 (低杠杆，大额) ---`);
  console.log(`  这些仓位将成为 ADL 目标 (盈利方)`);

  // 10 个多头 (5x, 大仓位) + 10 个空头 (5x, 大仓位)
  const longADLWallets = tradingWallets.slice(0, 10);
  const shortADLWallets = tradingWallets.slice(50, 60);

  let step1Success = 0;
  for (let i = 0; i < 10; i++) {
    // 多头
    const longResult = await submitPerpOrder({
      privateKey: longADLWallets[i].privateKey as Hex,
      trader: longADLWallets[i].derivedAddress as Address,
      isLong: true,
      size: parseEther("0.05"), // 0.05 ETH notional
      leverage: 50000n,         // 5x
      price: 0n,
      orderType: 0,
    });

    // 空头
    const shortResult = await submitPerpOrder({
      privateKey: shortADLWallets[i].privateKey as Hex,
      trader: shortADLWallets[i].derivedAddress as Address,
      isLong: false,
      size: parseEther("0.05"),
      leverage: 50000n,
      price: 0n,
      orderType: 0,
    });

    if (longResult.success) step1Success++;
    if (shortResult.success) step1Success++;
    await sleep(300);
  }
  console.log(`  基础仓位建立: ✅ ${step1Success} / 20`);

  await sleep(3000);

  // === Step 2: 建立高杠杆牺牲仓位 (100x，会穿仓) ===
  console.log(`\n--- Step 2: 建立高杠杆牺牲仓位 (100x) ---`);
  console.log(`  这些仓位将在价格变动后穿仓`);

  // 用钱包 10-19 开 100x 多头 (牺牲品)
  const sacrificeLongWallets = tradingWallets.slice(10, 20);
  // 用钱包 60-69 开 100x 空头 (作为对手方)
  const sacrificeCounterWallets = tradingWallets.slice(60, 70);

  let step2Success = 0;
  for (let i = 0; i < 10; i++) {
    // 高杠杆多头 (小保证金)
    const longResult = await submitPerpOrder({
      privateKey: sacrificeLongWallets[i].privateKey as Hex,
      trader: sacrificeLongWallets[i].derivedAddress as Address,
      isLong: true,
      size: parseEther("0.1"), // 0.1 ETH notional, margin = 0.001 ETH at 100x
      leverage: 1000000n,       // 100x
      price: 0n,
      orderType: 0,
    });

    // 对手方空头
    const shortResult = await submitPerpOrder({
      privateKey: sacrificeCounterWallets[i].privateKey as Hex,
      trader: sacrificeCounterWallets[i].derivedAddress as Address,
      isLong: false,
      size: parseEther("0.1"),
      leverage: 1000000n,
      price: 0n,
      orderType: 0,
    });

    if (longResult.success) step2Success++;
    if (shortResult.success) step2Success++;
    await sleep(300);
  }
  console.log(`  高杠杆仓位建立: ✅ ${step2Success} / 20`);

  // 查看当前保险基金状态
  console.log(`\n--- 保险基金状态 ---`);
  try {
    const res = await fetch(`${CONFIG.API_URL}/api/risk/market/${CONFIG.TEST_TOKEN}`);
    const data = await res.json();
    console.log(`  保险基金: ${JSON.stringify(data).slice(0, 200)}`);
  } catch { }

  // === Step 3: 大幅推低现货价格 (触发多头穿仓) ===
  console.log(`\n--- Step 3: 大量卖出 → 压低价格 → 触发多头穿仓 ---`);
  console.log(`  👀 请观察前端: 强平事件 + ADL 事件`);

  const preBefore = await publicClient.readContract({
    address: CONFIG.TOKEN_FACTORY_ADDRESS,
    abi: TOKEN_FACTORY_ABI,
    functionName: "getCurrentPrice",
    args: [CONFIG.TEST_TOKEN],
  });
  console.log(`  当前价格: ${(Number(preBefore) / 1e18).toExponential(4)} ETH`);

  // 用 20 个主钱包大量卖出
  let sellCount = 0;
  for (let i = 1; i <= 20; i++) {
    const wallet = mainWallets[i];
    try {
      const client = createWallet(wallet.privateKey as Hex);

      const tokenBalance = await publicClient.readContract({
        address: CONFIG.TEST_TOKEN,
        abi: ERC20_ABI,
        functionName: "balanceOf",
        args: [wallet.address as Address],
      });

      if (tokenBalance > 0n) {
        await client.writeContract({
          address: CONFIG.TEST_TOKEN,
          abi: ERC20_ABI,
          functionName: "approve",
          args: [CONFIG.TOKEN_FACTORY_ADDRESS, tokenBalance],
        });
        await sleep(500);

        await client.writeContract({
          address: CONFIG.TOKEN_FACTORY_ADDRESS,
          abi: TOKEN_FACTORY_ABI,
          functionName: "sell",
          args: [CONFIG.TEST_TOKEN, tokenBalance, 0n],
        });
        sellCount++;
        if (sellCount % 5 === 0) {
          const p = await publicClient.readContract({
            address: CONFIG.TOKEN_FACTORY_ADDRESS,
            abi: TOKEN_FACTORY_ABI,
            functionName: "getCurrentPrice",
            args: [CONFIG.TEST_TOKEN],
          });
          const drop = ((Number(p) - Number(preBefore)) / Number(preBefore) * 100).toFixed(2);
          console.log(`  📉 ${sellCount} 笔卖出, 价格变化: ${drop}%`);
        }
        await sleep(300);
      }
    } catch (e: any) {
      // ignore individual failures
    }
  }

  const preAfter = await publicClient.readContract({
    address: CONFIG.TOKEN_FACTORY_ADDRESS,
    abi: TOKEN_FACTORY_ABI,
    functionName: "getCurrentPrice",
    args: [CONFIG.TEST_TOKEN],
  });
  const totalDrop = ((Number(preAfter) - Number(preBefore)) / Number(preBefore) * 100).toFixed(2);
  console.log(`  总卖出: ${sellCount} 笔, 总价格变化: ${totalDrop}%`);

  // === Step 4: 等待风控检测 + 查看 ADL 结果 ===
  console.log(`\n--- Step 4: 等待风控引擎检测 (10秒) ---`);
  console.log(`  👀 请观察撮合引擎日志: [Liquidation] 和 [ADL] 标记`);
  await sleep(10000);

  // === Step 5: 检查结果 ===
  console.log(`\n--- Step 5: 检查仓位状态 ---`);

  // 检查高杠杆仓位是否被清算
  let liquidated = 0;
  let adlAffected = 0;

  for (let i = 0; i < 10; i++) {
    const trader = sacrificeLongWallets[i].derivedAddress;
    try {
      const res = await fetch(`${CONFIG.API_URL}/api/user/${trader}/positions`);
      const data = await res.json();
      const positions = data.positions || data;
      if (!Array.isArray(positions) || positions.length === 0) {
        liquidated++;
      }
    } catch { }
  }
  console.log(`  100x 多头被强平: ${liquidated} / 10`);

  // 检查低杠杆仓位是否被 ADL
  for (let i = 50; i < 60; i++) {
    const trader = tradingWallets[i].derivedAddress;
    try {
      const res = await fetch(`${CONFIG.API_URL}/api/trades/${trader}/history`);
      const data = await res.json();
      const trades = data.trades || data;
      if (Array.isArray(trades)) {
        const adlTrades = trades.filter((t: any) => t.type === "adl");
        if (adlTrades.length > 0) {
          adlAffected++;
          console.log(`  📋 钱包 #${i} 被 ADL: ${adlTrades.length} 次`);
        }
      }
    } catch { }
  }
  console.log(`  空头被 ADL 减仓: ${adlAffected} / 10`);

  // 检查所有交易记录中的 ADL 事件
  console.log(`\n--- ADL 事件汇总 ---`);
  try {
    const res = await fetch(`${CONFIG.API_URL}/api/trades/${CONFIG.TEST_TOKEN}`);
    const data = await res.json();
    const trades = data.trades || data;
    if (Array.isArray(trades)) {
      const adlTrades = trades.filter((t: any) => t.type === "adl");
      const liqTrades = trades.filter((t: any) => t.type === "liquidation");
      console.log(`  强平记录: ${liqTrades.length} 笔`);
      console.log(`  ADL 记录: ${adlTrades.length} 笔`);
      for (const t of adlTrades.slice(0, 5)) {
        console.log(`    ADL: trader=${(t.trader || "").slice(0, 10)}, size=${t.size}, pnl=${t.realizedPnL}`);
      }
    }
  } catch (e: any) {
    console.log(`  查询失败: ${e.message?.slice(0, 60)}`);
  }

  if (liquidated > 0) {
    console.log(`\n  ✅ 强平测试通过: ${liquidated} 个高杠杆仓位被清算`);
  } else {
    console.log(`\n  ⚠️ 未检测到强平 (价格变动可能不够大, 或 100x 仓位已匹配失败)`);
  }

  if (adlAffected > 0) {
    console.log(`  ✅ ADL 测试通过: ${adlAffected} 个对手方仓位被减仓`);
  } else {
    console.log(`  ⚠️ 未检测到 ADL (保险基金可能足够覆盖, 无需 ADL)`);
    console.log(`  提示: ADL 仅在穿仓 + 保险基金不足时触发`);
  }

  console.log(`\n✅ Phase 5 完成!`);
}

// ============================================================
// 主函数
// ============================================================

async function main() {
  const phase = process.argv[2] ? parseInt(process.argv[2]) : -1;

  console.log("🧪 综合测试脚本");
  console.log(`测试代币: ${CONFIG.TEST_TOKEN}`);
  console.log(`Settlement: ${CONFIG.SETTLEMENT_ADDRESS}`);
  console.log(`撮合引擎: ${CONFIG.API_URL}`);
  console.log(`主钱包: ${mainWallets.length} 个`);
  console.log(`派生钱包: ${tradingWallets.length} 个`);

  if (phase === 0 || phase === -1) {
    await phase0_distributeETH();
  }

  if (phase === 1 || phase === -1) {
    await phase1_spotTrading();
  }

  if (phase === 2 || phase === -1) {
    await phase2_perpTrading();
  }

  if (phase === 3 || phase === -1) {
    await phase3_referralTest();
  }

  if (phase === 4 || phase === -1) {
    await phase4_feeVerification();
  }

  if (phase === 5 || phase === -1) {
    await phase5_adlTest();
  }

  console.log("\n" + "=".repeat(60));
  console.log("  🎉 所有测试完成!");
  console.log("=".repeat(60));
}

main().catch((e) => {
  console.error("测试失败:", e);
  process.exit(1);
});
