/**
 * 干净的端到端测试 - 使用全新的钱包
 */

import {
  createPublicClient,
  createWalletClient,
  http,
  parseEther,
  formatEther,
  type Address,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { baseSepolia } from "viem/chains";
import * as fs from "fs";

// Configuration
const RPC_URL = "https://base-sepolia.g.alchemy.com/v2/Dr8sMe-1MYIF7jBYuZZj8PMOPAAeJ16d";
const MATCHING_ENGINE_URL = "http://localhost:8081";
const SETTLEMENT_ADDRESS = "0x2F0cb9cb3e96f0733557844e34C5152bFC887aA5" as Address;
const WALLETS_PATH = "/Users/qinlinqiu/Desktop/Namespace/scripts/market-maker/wallets.json";
const TOKEN_ADDRESS = "0x01c6058175eDA34Fc8922EeAe32BC383CB203211" as Address;

const LEVERAGE_PRECISION = 10000n;

const SETTLEMENT_ABI = [
  {
    inputs: [],
    name: "deposit",
    outputs: [],
    stateMutability: "payable",
    type: "function",
  },
  {
    inputs: [{ name: "user", type: "address" }],
    name: "balances",
    outputs: [
      { name: "available", type: "uint256" },
      { name: "locked", type: "uint256" },
    ],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [{ name: "user", type: "address" }],
    name: "nonces",
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
] as const;

const EIP712_DOMAIN = {
  name: "MemePerp",
  version: "1",
  chainId: 84532,
  verifyingContract: SETTLEMENT_ADDRESS,
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
};

interface Wallet {
  privateKey: string;
  address: string;
  index: number;
}

async function main() {
  const publicClient = createPublicClient({
    chain: baseSepolia,
    transport: http(RPC_URL),
  });

  const data = JSON.parse(fs.readFileSync(WALLETS_PATH, "utf-8"));
  const wallets: Wallet[] = data.wallets;

  // 使用全新的钱包：100-110 作为空单，150 作为多单
  const shortWalletIndices = [100, 101, 102, 103, 104];
  const longWalletIndex = 150;

  console.log("=== 干净的端到端测试 ===\n");

  // Step 1: 检查并准备空单钱包
  console.log("步骤 1: 准备空单钱包...\n");
  const readyShortWallets: Wallet[] = [];

  for (const idx of shortWalletIndices) {
    const wallet = wallets[idx];
    const address = wallet.address as Address;
    const account = privateKeyToAccount(wallet.privateKey as `0x${string}`);

    // 检查 nonce
    const nonce = await publicClient.readContract({
      address: SETTLEMENT_ADDRESS,
      abi: SETTLEMENT_ABI,
      functionName: "nonces",
      args: [address],
    });

    if (nonce > 0n) {
      console.log(`[${idx}] nonce=${nonce}, 跳过（订单可能已使用）`);
      continue;
    }

    // 检查余额
    const balance = await publicClient.readContract({
      address: SETTLEMENT_ADDRESS,
      abi: SETTLEMENT_ABI,
      functionName: "balances",
      args: [address],
    });

    const available = balance[0];
    const required = parseEther("0.002"); // 0.01 ETH * 10x leverage = 0.001 ETH margin + buffer

    if (available < required) {
      // 需要存款
      const walletBalance = await publicClient.getBalance({ address });
      if (walletBalance < required) {
        console.log(`[${idx}] ETH 余额不足，跳过`);
        continue;
      }

      const walletClient = createWalletClient({
        account,
        chain: baseSepolia,
        transport: http(RPC_URL),
      });

      const hash = await walletClient.writeContract({
        address: SETTLEMENT_ADDRESS,
        abi: SETTLEMENT_ABI,
        functionName: "deposit",
        args: [],
        value: required,
      });

      await publicClient.waitForTransactionReceipt({ hash });
      console.log(`[${idx}] 存款完成: ${hash}`);
    } else {
      console.log(`[${idx}] 余额充足`);
    }

    readyShortWallets.push(wallet);
    await new Promise(r => setTimeout(r, 300));
  }

  if (readyShortWallets.length === 0) {
    console.error("没有可用的空单钱包");
    process.exit(1);
  }

  console.log(`\n准备好 ${readyShortWallets.length} 个空单钱包\n`);

  // Step 2: 准备多单钱包
  console.log("步骤 2: 准备多单钱包...\n");
  const longWallet = wallets[longWalletIndex];
  const longAddress = longWallet.address as Address;
  const longAccount = privateKeyToAccount(longWallet.privateKey as `0x${string}`);

  const longNonce = await publicClient.readContract({
    address: SETTLEMENT_ADDRESS,
    abi: SETTLEMENT_ABI,
    functionName: "nonces",
    args: [longAddress],
  });

  if (longNonce > 0n) {
    console.error(`多单钱包 nonce=${longNonce}，可能已使用。选择另一个钱包。`);
    process.exit(1);
  }

  const longBalance = await publicClient.readContract({
    address: SETTLEMENT_ADDRESS,
    abi: SETTLEMENT_ABI,
    functionName: "balances",
    args: [longAddress],
  });

  const longRequired = parseEther("0.005"); // 多一些余量
  if (longBalance[0] < longRequired) {
    const walletBalance = await publicClient.getBalance({ address: longAddress });
    if (walletBalance < longRequired) {
      console.error("多单钱包 ETH 余额不足");
      process.exit(1);
    }

    const longWalletClient = createWalletClient({
      account: longAccount,
      chain: baseSepolia,
      transport: http(RPC_URL),
    });

    const hash = await longWalletClient.writeContract({
      address: SETTLEMENT_ADDRESS,
      abi: SETTLEMENT_ABI,
      functionName: "deposit",
      args: [],
      value: longRequired,
    });

    await publicClient.waitForTransactionReceipt({ hash });
    console.log(`多单钱包存款完成: ${hash}`);
  } else {
    console.log(`多单钱包余额充足`);
  }

  // Step 3: 提交空单
  console.log("\n步骤 3: 提交空单...\n");

  for (const wallet of readyShortWallets) {
    const address = wallet.address as Address;
    const account = privateKeyToAccount(wallet.privateKey as `0x${string}`);

    const nonce = await publicClient.readContract({
      address: SETTLEMENT_ADDRESS,
      abi: SETTLEMENT_ABI,
      functionName: "nonces",
      args: [address],
    });

    const order = {
      trader: address,
      token: TOKEN_ADDRESS,
      isLong: false,
      orderType: 0,
      size: parseEther("0.01"),
      price: 0n,
      leverage: 10n * LEVERAGE_PRECISION,
      nonce: nonce,
      deadline: BigInt(Math.floor(Date.now() / 1000) + 3600),
    };

    const signature = await account.signTypedData({
      domain: EIP712_DOMAIN,
      types: ORDER_TYPES,
      primaryType: "Order",
      message: order,
    });

    const response = await fetch(`${MATCHING_ENGINE_URL}/api/order/submit`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        trader: order.trader,
        token: order.token,
        isLong: order.isLong,
        orderType: order.orderType,
        size: order.size.toString(),
        price: order.price.toString(),
        leverage: Number(order.leverage),
        nonce: Number(order.nonce),
        deadline: Number(order.deadline),
        signature,
      }),
    });

    const result = await response.json() as { success: boolean; orderId?: string; error?: string };
    if (result.success) {
      console.log(`[${wallet.index}] 空单已提交: ${result.orderId}`);
    } else {
      console.log(`[${wallet.index}] 空单失败: ${result.error}`);
    }

    await new Promise(r => setTimeout(r, 300));
  }

  // 等待订单簿更新
  await new Promise(r => setTimeout(r, 1000));

  // Step 4: 检查订单簿
  console.log("\n步骤 4: 检查订单簿...");
  const bookResponse = await fetch(`${MATCHING_ENGINE_URL}/api/orderbook/${TOKEN_ADDRESS}`);
  const orderBook = await bookResponse.json() as { shorts: Array<{ size: string; count: number }>; longs: Array<{ size: string }> };
  console.log(`订单簿: ${orderBook.shorts?.[0]?.count || 0} 个空单, ${orderBook.longs?.length || 0} 个多单`);

  // Step 5: 提交多单 (与一个空单大小相同)
  console.log("\n步骤 5: 提交多单...\n");

  const order = {
    trader: longAddress,
    token: TOKEN_ADDRESS,
    isLong: true,
    orderType: 0,
    size: parseEther("0.01"), // 与空单大小相同，确保 1:1 撮合
    price: 0n,
    leverage: 10n * LEVERAGE_PRECISION,
    nonce: longNonce,
    deadline: BigInt(Math.floor(Date.now() / 1000) + 3600),
  };

  const signature = await longAccount.signTypedData({
    domain: EIP712_DOMAIN,
    types: ORDER_TYPES,
    primaryType: "Order",
    message: order,
  });

  const longResponse = await fetch(`${MATCHING_ENGINE_URL}/api/order/submit`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      trader: order.trader,
      token: order.token,
      isLong: order.isLong,
      orderType: order.orderType,
      size: order.size.toString(),
      price: order.price.toString(),
      leverage: Number(order.leverage),
      nonce: Number(order.nonce),
      deadline: Number(order.deadline),
      signature,
    }),
  });

  const longResult = await longResponse.json() as { success: boolean; orderId?: string; matches?: number; error?: string };
  console.log(`多单提交结果:`, longResult);

  // Step 6: 等待结算
  console.log("\n步骤 6: 等待链上结算 (30秒)...");
  await new Promise(r => setTimeout(r, 35000));

  // Step 7: 检查结果
  console.log("\n步骤 7: 检查最终结果...\n");

  // 检查 nonces
  const finalLongNonce = await publicClient.readContract({
    address: SETTLEMENT_ADDRESS,
    abi: SETTLEMENT_ABI,
    functionName: "nonces",
    args: [longAddress],
  });

  const firstShortAddress = readyShortWallets[0].address as Address;
  const finalShortNonce = await publicClient.readContract({
    address: SETTLEMENT_ADDRESS,
    abi: SETTLEMENT_ABI,
    functionName: "nonces",
    args: [firstShortAddress],
  });

  console.log(`多单钱包 nonce: ${longNonce} -> ${finalLongNonce}`);
  console.log(`空单钱包 nonce: 0 -> ${finalShortNonce}`);

  // 检查订单簿
  const finalBookResponse = await fetch(`${MATCHING_ENGINE_URL}/api/orderbook/${TOKEN_ADDRESS}`);
  const finalOrderBook = await finalBookResponse.json();
  console.log(`\n最终订单簿:`, JSON.stringify(finalOrderBook, null, 2));

  // 检查撮合引擎日志
  console.log("\n检查撮合引擎日志...");
  const healthResponse = await fetch(`${MATCHING_ENGINE_URL}/health`);
  const health = await healthResponse.json();
  console.log(`撮合引擎状态:`, health);

  if (finalLongNonce > longNonce || finalShortNonce > 0n) {
    console.log("\n✅ 结算成功！nonce 已递增。");
  } else {
    console.log("\n❌ 结算可能失败，nonce 未变化。请检查日志。");
  }
}

main().catch(console.error);
