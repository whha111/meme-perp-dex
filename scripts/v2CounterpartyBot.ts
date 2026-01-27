/**
 * V2 对赌机器人 - 使用测试钱包开空单作为对手方
 *
 * Usage:
 *   npx ts-node v2CounterpartyBot.ts <token_address> <size_eth> [num_wallets]
 *
 * Example:
 *   npx ts-node v2CounterpartyBot.ts 0x01c6058175eDA34Fc8922EeAe32BC383CB203211 0.01 5
 */

import {
  createPublicClient,
  createWalletClient,
  http,
  parseEther,
  formatEther,
  type Address,
  type Hex,
  keccak256,
  encodePacked,
  toBytes,
} from "viem";
import { privateKeyToAccount, signTypedData } from "viem/accounts";
import { baseSepolia } from "viem/chains";
import * as fs from "fs";

// ============================================================
// Configuration
// ============================================================

const RPC_URL = "https://base-sepolia.g.alchemy.com/v2/Dr8sMe-1MYIF7jBYuZZj8PMOPAAeJ16d";
const MATCHING_ENGINE_URL = "http://localhost:8081";
const SETTLEMENT_ADDRESS = "0x2F0cb9cb3e96f0733557844e34C5152bFC887aA5" as Address;
const WALLETS_PATH = "/Users/qinlinqiu/Desktop/Namespace/scripts/market-maker/wallets.json";

// Settlement ABI (deposit function)
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

// EIP-712 Domain
const EIP712_DOMAIN = {
  name: "MemePerp",
  version: "1",
  chainId: 84532,
  verifyingContract: SETTLEMENT_ADDRESS,
};

// Order Types for EIP-712 (必须与 server.ts 完全匹配)
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

// ============================================================
// Types
// ============================================================

interface Wallet {
  privateKey: string;
  address: string;
  index: number;
}

interface SignedOrder {
  trader: Address;
  token: Address;
  isLong: boolean;
  orderType: number;
  size: string;
  price: string;
  leverage: number;
  nonce: number;
  deadline: number;
  signature: Hex;
}

// ============================================================
// Bot Class
// ============================================================

class CounterpartyBot {
  private publicClient;
  private wallets: Wallet[];
  private tokenAddress: Address;
  private sizePerWallet: bigint;
  private numWallets: number;

  constructor(tokenAddress: Address, sizeEth: string, numWallets: number) {
    this.publicClient = createPublicClient({
      chain: baseSepolia,
      transport: http(RPC_URL),
    });

    const data = JSON.parse(fs.readFileSync(WALLETS_PATH, "utf-8"));
    this.wallets = data.wallets;
    this.tokenAddress = tokenAddress;
    this.sizePerWallet = parseEther(sizeEth);
    this.numWallets = Math.min(numWallets, this.wallets.length);

    console.log(`=== V2 对赌机器人 ===`);
    console.log(`代币: ${tokenAddress}`);
    console.log(`每个钱包开空单: ${sizeEth} ETH`);
    console.log(`使用钱包数量: ${this.numWallets}`);
    console.log(`总空单规模: ${parseFloat(sizeEth) * this.numWallets} ETH`);
    console.log(`Settlement: ${SETTLEMENT_ADDRESS}`);
    console.log(`Matching Engine: ${MATCHING_ENGINE_URL}`);
    console.log("");
  }

  private getWalletClient(wallet: Wallet) {
    const account = privateKeyToAccount(wallet.privateKey as `0x${string}`);
    return createWalletClient({
      account,
      chain: baseSepolia,
      transport: http(RPC_URL),
    });
  }

  async checkAndDeposit(wallet: Wallet): Promise<boolean> {
    const address = wallet.address as Address;

    // 检查 Settlement 余额
    const balance = await this.publicClient.readContract({
      address: SETTLEMENT_ADDRESS,
      abi: SETTLEMENT_ABI,
      functionName: "balances",
      args: [address],
    });

    const available = balance[0];
    const requiredMargin = this.sizePerWallet / 10n; // 10x 杠杆，需要 10% 保证金

    console.log(`[${wallet.index}] Settlement 余额: ${formatEther(available)} ETH, 需要: ${formatEther(requiredMargin)} ETH`);

    if (available >= requiredMargin) {
      console.log(`[${wallet.index}] 余额充足，无需存款`);
      return true;
    }

    // 检查钱包 ETH 余额
    const walletBalance = await this.publicClient.getBalance({ address });
    const depositAmount = requiredMargin - available + parseEther("0.001"); // 多存一点用于 gas

    if (walletBalance < depositAmount + parseEther("0.001")) {
      console.log(`[${wallet.index}] ETH 余额不足，跳过`);
      return false;
    }

    // 存款
    console.log(`[${wallet.index}] 存款 ${formatEther(depositAmount)} ETH...`);
    const walletClient = this.getWalletClient(wallet);
    const account = privateKeyToAccount(wallet.privateKey as `0x${string}`);

    try {
      const hash = await walletClient.writeContract({
        address: SETTLEMENT_ADDRESS,
        abi: SETTLEMENT_ABI,
        functionName: "deposit",
        args: [],
        value: depositAmount,
        account,
      });

      console.log(`[${wallet.index}] 存款交易: ${hash}`);

      // 等待确认
      await this.publicClient.waitForTransactionReceipt({ hash });
      console.log(`[${wallet.index}] 存款确认`);
      return true;
    } catch (error) {
      console.error(`[${wallet.index}] 存款失败:`, error);
      return false;
    }
  }

  async signAndSubmitShortOrder(wallet: Wallet): Promise<boolean> {
    const address = wallet.address as Address;
    const account = privateKeyToAccount(wallet.privateKey as `0x${string}`);

    // 获取 nonce
    const nonce = await this.publicClient.readContract({
      address: SETTLEMENT_ADDRESS,
      abi: SETTLEMENT_ABI,
      functionName: "nonces",
      args: [address],
    });

    // 构建订单
    const order = {
      trader: address,
      token: this.tokenAddress,
      isLong: false, // 开空
      orderType: 0, // Market order
      size: this.sizePerWallet,
      price: 0n, // Market order, no price limit
      leverage: 100000n, // 10x with LEVERAGE_PRECISION = 1e4
      nonce: nonce,
      deadline: BigInt(Math.floor(Date.now() / 1000) + 3600), // 1小时有效
    };

    console.log(`[${wallet.index}] 签名空单: ${formatEther(order.size)} ETH, 10x 杠杆`);

    // 签名 EIP-712
    const signature = await account.signTypedData({
      domain: EIP712_DOMAIN,
      types: ORDER_TYPES,
      primaryType: "Order",
      message: order,
    });

    // 提交到撮合引擎
    const signedOrder: SignedOrder = {
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
    };

    try {
      const response = await fetch(`${MATCHING_ENGINE_URL}/api/order/submit`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(signedOrder),
      });

      const result = await response.json() as { success: boolean; orderId?: string; error?: string };

      if (result.success) {
        console.log(`[${wallet.index}] 订单已提交: ${result.orderId}`);
        return true;
      } else {
        console.error(`[${wallet.index}] 提交失败: ${result.error}`);
        return false;
      }
    } catch (error) {
      console.error(`[${wallet.index}] 提交失败:`, error);
      return false;
    }
  }

  async run(): Promise<void> {
    console.log("\n=== 步骤 1: 检查并存款 ===\n");

    const readyWallets: Wallet[] = [];
    for (let i = 0; i < this.numWallets; i++) {
      const wallet = this.wallets[i];
      const ready = await this.checkAndDeposit(wallet);
      if (ready) {
        readyWallets.push(wallet);
      }
      // 避免 RPC 限制
      await new Promise((r) => setTimeout(r, 500));
    }

    console.log(`\n准备好的钱包: ${readyWallets.length}/${this.numWallets}\n`);

    if (readyWallets.length === 0) {
      console.log("没有可用的钱包，退出");
      return;
    }

    console.log("=== 步骤 2: 签名并提交空单 ===\n");

    let successCount = 0;
    for (const wallet of readyWallets) {
      const success = await this.signAndSubmitShortOrder(wallet);
      if (success) successCount++;
      await new Promise((r) => setTimeout(r, 300));
    }

    console.log(`\n=== 完成 ===`);
    console.log(`成功提交: ${successCount}/${readyWallets.length} 个空单`);
    console.log(`\n现在你可以开多单，机器人的空单会作为对手方`);
    console.log(`然后运行 marketMaker.ts 买入代币拉盘，你的多单就会盈利！`);
  }
}

// ============================================================
// Main
// ============================================================

async function main() {
  const args = process.argv.slice(2);

  if (args.length < 2) {
    console.log("Usage: npx ts-node v2CounterpartyBot.ts <token_address> <size_eth> [num_wallets]");
    console.log("Example: npx ts-node v2CounterpartyBot.ts 0x01c6058175eDA34Fc8922EeAe32BC383CB203211 0.01 5");
    process.exit(1);
  }

  const tokenAddress = args[0] as Address;
  const sizeEth = args[1];
  const numWallets = parseInt(args[2] || "5");

  const bot = new CounterpartyBot(tokenAddress, sizeEth, numWallets);
  await bot.run();
}

main().catch(console.error);
