/**
 * 测试工具函数
 */
import {
  createPublicClient,
  createWalletClient,
  http,
  type Address,
  type Hex,
  type WalletClient,
  type PublicClient,
} from "viem";
import { privateKeyToAccount, type PrivateKeyAccount } from "viem/accounts";
import * as fs from "fs";
import { CONFIG, ORDER_TYPES } from "./config";

export interface Wallet {
  privateKey: string;
  address: string;
  index: number;
}

export interface Order {
  trader: Address;
  token: Address;
  isLong: boolean;
  size: bigint;
  leverage: bigint;
  price: bigint;
  deadline: bigint;
  nonce: bigint;
  orderType: number; // 0 = MARKET, 1 = LIMIT
}

// 加载测试钱包
export function loadWallets(): Wallet[] {
  const data = JSON.parse(fs.readFileSync(CONFIG.WALLETS_PATH, "utf-8"));
  return data.wallets;
}

// 创建公共客户端
export function createClient(): PublicClient {
  return createPublicClient({
    chain: CONFIG.CHAIN,
    transport: http(CONFIG.RPC_URL),
  });
}

// 创建钱包客户端
export function createWallet(privateKey: Hex): { account: PrivateKeyAccount; client: WalletClient } {
  const account = privateKeyToAccount(privateKey);
  const client = createWalletClient({
    account,
    chain: CONFIG.CHAIN,
    transport: http(CONFIG.RPC_URL),
  });
  return { account, client };
}

// 签名订单
export async function signOrder(
  client: WalletClient,
  account: PrivateKeyAccount,
  order: Order
): Promise<Hex> {
  const signature = await client.signTypedData({
    account,
    domain: CONFIG.EIP712_DOMAIN,
    types: ORDER_TYPES,
    primaryType: "Order",
    message: {
      trader: order.trader,
      token: order.token,
      isLong: order.isLong,
      size: order.size,
      leverage: order.leverage,
      price: order.price,
      deadline: order.deadline,
      nonce: order.nonce,
      orderType: order.orderType,
    },
  });
  return signature;
}

// 创建订单
export function createOrder(params: {
  trader: Address;
  token: Address;
  isLong: boolean;
  size: bigint; // USDT 面值 (6 decimals)
  leverage: bigint; // 杠杆 (10000 = 1x, 100000 = 10x)
  price: bigint; // 价格 (6 decimals)
  nonce: bigint;
  orderType?: number; // 0 = MARKET, 1 = LIMIT
  deadlineMinutes?: number;
}): Order {
  return {
    trader: params.trader,
    token: params.token,
    isLong: params.isLong,
    size: params.size,
    leverage: params.leverage,
    price: params.price,
    deadline: BigInt(Math.floor(Date.now() / 1000) + (params.deadlineMinutes || 60) * 60),
    nonce: params.nonce,
    orderType: params.orderType ?? 0,
  };
}

// 格式化 USDT 金额
export function formatUSDT(amount: bigint): string {
  return (Number(amount) / 1e6).toFixed(2) + " USDT";
}

// 解析 USDT 金额
export function parseUSDT(amount: number): bigint {
  return BigInt(Math.floor(amount * 1e6));
}

// 格式化杠杆
export function formatLeverage(leverage: bigint): string {
  return (Number(leverage) / 10000).toFixed(1) + "x";
}

// 解析杠杆
export function parseLeverage(leverage: number): bigint {
  return BigInt(Math.floor(leverage * 10000));
}

// 格式化价格
export function formatPrice(price: bigint): string {
  return (Number(price) / 1e6).toFixed(4);
}

// 解析价格
export function parsePrice(price: number): bigint {
  return BigInt(Math.floor(price * 1e6));
}

// 睡眠
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// 记录测试结果
export interface TestResult {
  name: string;
  status: "PASS" | "FAIL" | "SKIP";
  error?: string;
  details?: string;
  txHash?: string;
}

export class TestReporter {
  private results: TestResult[] = [];

  add(result: TestResult) {
    this.results.push(result);
    const icon = result.status === "PASS" ? "✅" : result.status === "FAIL" ? "❌" : "⏭️";
    console.log(`${icon} ${result.name}`);
    if (result.error) console.log(`   Error: ${result.error}`);
    if (result.details) console.log(`   Details: ${result.details}`);
    if (result.txHash) console.log(`   TxHash: ${result.txHash}`);
  }

  summary() {
    console.log("\n" + "=".repeat(50));
    console.log("测试结果汇总");
    console.log("=".repeat(50));
    const pass = this.results.filter((r) => r.status === "PASS").length;
    const fail = this.results.filter((r) => r.status === "FAIL").length;
    const skip = this.results.filter((r) => r.status === "SKIP").length;
    console.log(`通过: ${pass} | 失败: ${fail} | 跳过: ${skip}`);
    console.log("");
    if (fail > 0) {
      console.log("失败项目:");
      this.results.filter((r) => r.status === "FAIL").forEach((r) => {
        console.log(`  - ${r.name}: ${r.error}`);
      });
    }
    return { pass, fail, skip, results: this.results };
  }

  getResults() {
    return this.results;
  }
}
