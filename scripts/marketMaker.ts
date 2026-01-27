/**
 * Market Maker Script - K线做市
 *
 * 使用测试钱包进行买卖交易，生成自然的K线图
 *
 * Usage:
 *   npx ts-node marketMaker.ts <token_address> [num_trades]
 *
 * Example:
 *   npx ts-node marketMaker.ts 0x01c6058175eDA34Fc8922EeAe32BC383CB203211 100
 */

import {
  createPublicClient,
  createWalletClient,
  http,
  parseEther,
  formatEther,
  type Address,
  erc20Abi,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { baseSepolia } from "viem/chains";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ============================================================
// Configuration
// ============================================================

const RPC_URL = "https://base-sepolia.g.alchemy.com/v2/Dr8sMe-1MYIF7jBYuZZj8PMOPAAeJ16d";

// 新的合约地址
const TOKEN_FACTORY_ADDRESS = "0xCfDCD9F8D39411cF855121331B09aef1C88dc056" as Address;

// Token Factory ABI
const TOKEN_FACTORY_ABI = [
  {
    inputs: [
      { name: "tokenAddress", type: "address" },
      { name: "minTokensOut", type: "uint256" },
    ],
    name: "buy",
    outputs: [],
    stateMutability: "payable",
    type: "function",
  },
  {
    inputs: [
      { name: "tokenAddress", type: "address" },
      { name: "tokenAmount", type: "uint256" },
      { name: "minETHOut", type: "uint256" },
    ],
    name: "sell",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [{ name: "tokenAddress", type: "address" }],
    name: "getPoolState",
    outputs: [
      {
        components: [
          { name: "realETHReserve", type: "uint256" },
          { name: "realTokenReserve", type: "uint256" },
          { name: "soldTokens", type: "uint256" },
          { name: "isGraduated", type: "bool" },
          { name: "isActive", type: "bool" },
          { name: "creator", type: "address" },
          { name: "createdAt", type: "uint64" },
          { name: "metadataURI", type: "string" },
        ],
        type: "tuple",
      },
    ],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [{ name: "tokenAddress", type: "address" }],
    name: "getCurrentPrice",
    outputs: [{ type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
] as const;

// ============================================================
// Types
// ============================================================

interface Wallet {
  privateKey: string;
  address: string;
  index: number;
}

interface WalletsFile {
  wallets: Wallet[];
  count: number;
}

// ============================================================
// Utilities
// ============================================================

function loadWallets(): Wallet[] {
  const walletsPath = path.resolve(__dirname, "../../Namespace/scripts/market-maker/wallets.json");
  if (!fs.existsSync(walletsPath)) {
    console.error(`Wallets file not found: ${walletsPath}`);
    process.exit(1);
  }
  const data = fs.readFileSync(walletsPath, "utf-8");
  const walletsFile: WalletsFile = JSON.parse(data);
  return walletsFile.wallets;
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// 生成随机交易金额（ETH）
function randomBuyAmount(): bigint {
  // 0.001 - 0.01 ETH
  const amount = 0.001 + Math.random() * 0.009;
  return parseEther(amount.toFixed(6));
}

// 生成随机卖出比例
function randomSellPercentage(): number {
  // 10% - 50%
  return 0.1 + Math.random() * 0.4;
}

// ============================================================
// Market Maker Class
// ============================================================

class MarketMaker {
  private publicClient;
  private wallets: Wallet[];
  private tokenAddress: Address;

  constructor(tokenAddress: Address) {
    this.publicClient = createPublicClient({
      chain: baseSepolia,
      transport: http(RPC_URL),
    });
    this.wallets = loadWallets();
    this.tokenAddress = tokenAddress;
    console.log(`Loaded ${this.wallets.length} wallets`);
    console.log(`Target token: ${tokenAddress}`);
  }

  private getWalletClient(wallet: Wallet) {
    const account = privateKeyToAccount(wallet.privateKey as `0x${string}`);
    return createWalletClient({
      account,
      chain: baseSepolia,
      transport: http(RPC_URL),
    });
  }

  async getPoolInfo(): Promise<void> {
    try {
      const poolState = await this.publicClient.readContract({
        address: TOKEN_FACTORY_ADDRESS,
        abi: TOKEN_FACTORY_ABI,
        functionName: "getPoolState",
        args: [this.tokenAddress],
      });

      const currentPrice = await this.publicClient.readContract({
        address: TOKEN_FACTORY_ADDRESS,
        abi: TOKEN_FACTORY_ABI,
        functionName: "getCurrentPrice",
        args: [this.tokenAddress],
      });

      console.log("\n========== Pool State ==========");
      console.log(`ETH Reserve: ${formatEther(poolState.realETHReserve)} ETH`);
      console.log(`Token Reserve: ${formatEther(poolState.realTokenReserve)} tokens`);
      console.log(`Sold Tokens: ${formatEther(poolState.soldTokens)} tokens`);
      console.log(`Current Price: ${formatEther(currentPrice)} ETH/token`);
      console.log(`Is Active: ${poolState.isActive}`);
      console.log(`Is Graduated: ${poolState.isGraduated}`);
      console.log("================================\n");
    } catch (error: any) {
      console.error(`Failed to get pool info: ${error.message}`);
    }
  }

  async checkWalletBalance(wallet: Wallet): Promise<{ eth: bigint; token: bigint }> {
    const ethBalance = await this.publicClient.getBalance({
      address: wallet.address as Address,
    });

    const tokenBalance = await this.publicClient.readContract({
      address: this.tokenAddress,
      abi: erc20Abi,
      functionName: "balanceOf",
      args: [wallet.address as Address],
    });

    return { eth: ethBalance, token: tokenBalance };
  }

  async buy(wallet: Wallet, ethAmount: bigint): Promise<boolean> {
    const walletClient = this.getWalletClient(wallet);

    console.log(`[Wallet ${wallet.index}] BUY ${formatEther(ethAmount)} ETH`);

    try {
      const hash = await walletClient.writeContract({
        address: TOKEN_FACTORY_ADDRESS,
        abi: TOKEN_FACTORY_ABI,
        functionName: "buy",
        args: [this.tokenAddress, 0n],
        value: ethAmount,
      });

      const receipt = await this.publicClient.waitForTransactionReceipt({ hash });

      if (receipt.status === "success") {
        console.log(`  ✓ Buy success - tx: ${hash.slice(0, 18)}...`);
        return true;
      } else {
        console.log(`  ✗ Buy failed`);
        return false;
      }
    } catch (error: any) {
      console.error(`  ✗ Error: ${error.message.slice(0, 100)}`);
      return false;
    }
  }

  async sell(wallet: Wallet, tokenAmount: bigint): Promise<boolean> {
    const walletClient = this.getWalletClient(wallet);

    console.log(`[Wallet ${wallet.index}] SELL ${formatEther(tokenAmount)} tokens`);

    try {
      // First approve
      const approveHash = await walletClient.writeContract({
        address: this.tokenAddress,
        abi: erc20Abi,
        functionName: "approve",
        args: [TOKEN_FACTORY_ADDRESS, tokenAmount * 2n], // approve 2x to avoid re-approval
      });
      await this.publicClient.waitForTransactionReceipt({ hash: approveHash });

      // Then sell
      const hash = await walletClient.writeContract({
        address: TOKEN_FACTORY_ADDRESS,
        abi: TOKEN_FACTORY_ABI,
        functionName: "sell",
        args: [this.tokenAddress, tokenAmount, 0n],
      });

      const receipt = await this.publicClient.waitForTransactionReceipt({ hash });

      if (receipt.status === "success") {
        console.log(`  ✓ Sell success - tx: ${hash.slice(0, 18)}...`);
        return true;
      } else {
        console.log(`  ✗ Sell failed`);
        return false;
      }
    } catch (error: any) {
      console.error(`  ✗ Error: ${error.message.slice(0, 100)}`);
      return false;
    }
  }

  async runMarketMaking(numTrades: number = 50): Promise<void> {
    console.log(`\n========== Starting Market Making: ${numTrades} trades ==========\n`);

    await this.getPoolInfo();

    let successfulTrades = 0;
    let buyCount = 0;
    let sellCount = 0;

    // 随机趋势：上涨、下跌或震荡
    // 0 = 震荡, 1 = 上涨, -1 = 下跌
    let trend = 0;
    let trendDuration = 0;

    for (let i = 0; i < numTrades; i++) {
      // 每10-20笔交易可能改变趋势
      if (trendDuration <= 0) {
        trend = Math.floor(Math.random() * 3) - 1; // -1, 0, 1
        trendDuration = 10 + Math.floor(Math.random() * 10);
        console.log(`\n--- Trend change: ${trend > 0 ? '上涨' : trend < 0 ? '下跌' : '震荡'} (${trendDuration} trades) ---\n`);
      }
      trendDuration--;

      // 根据趋势决定买卖概率
      let buyProbability = 0.5;
      if (trend > 0) buyProbability = 0.7; // 上涨趋势，70%买入
      if (trend < 0) buyProbability = 0.3; // 下跌趋势，30%买入

      const isBuy = Math.random() < buyProbability;

      // 选择钱包
      const walletIndex = Math.floor(Math.random() * Math.min(50, this.wallets.length));
      const wallet = this.wallets[walletIndex];

      const balances = await this.checkWalletBalance(wallet);

      if (isBuy) {
        // 买入
        if (balances.eth >= parseEther("0.002")) {
          const buyAmount = randomBuyAmount();
          if (balances.eth >= buyAmount) {
            const success = await this.buy(wallet, buyAmount);
            if (success) {
              successfulTrades++;
              buyCount++;
            }
          }
        } else {
          console.log(`[Wallet ${wallet.index}] Insufficient ETH: ${formatEther(balances.eth)}`);
        }
      } else {
        // 卖出
        if (balances.token > 0n) {
          const sellPercentage = randomSellPercentage();
          const sellAmount = BigInt(Math.floor(Number(balances.token) * sellPercentage));
          if (sellAmount > parseEther("0.0001")) {
            const success = await this.sell(wallet, sellAmount);
            if (success) {
              successfulTrades++;
              sellCount++;
            }
          }
        } else {
          // 没有代币，改为买入
          if (balances.eth >= parseEther("0.002")) {
            const buyAmount = randomBuyAmount();
            const success = await this.buy(wallet, buyAmount);
            if (success) {
              successfulTrades++;
              buyCount++;
            }
          }
        }
      }

      // 交易间隔随机 1-3 秒
      const delay = 1000 + Math.random() * 2000;
      await sleep(delay);

      // 每10笔交易显示进度
      if ((i + 1) % 10 === 0) {
        console.log(`\n--- Progress: ${i + 1}/${numTrades} trades (${buyCount} buys, ${sellCount} sells) ---\n`);
      }
    }

    console.log(`\n========== Market Making Complete ==========`);
    console.log(`Successful trades: ${successfulTrades}/${numTrades}`);
    console.log(`Buys: ${buyCount}, Sells: ${sellCount}`);

    await this.getPoolInfo();
  }

  async checkWalletsStatus(): Promise<void> {
    console.log("\n========== Checking Wallet Balances ==========\n");

    let totalEth = 0n;
    let totalToken = 0n;
    let fundedWallets = 0;
    let walletsWithToken = 0;

    for (const wallet of this.wallets.slice(0, 50)) {
      const balances = await this.checkWalletBalance(wallet);
      totalEth += balances.eth;
      totalToken += balances.token;

      if (balances.eth > 0n) fundedWallets++;
      if (balances.token > 0n) walletsWithToken++;

      if (balances.eth > 0n || balances.token > 0n) {
        console.log(`[${wallet.index}] ETH: ${formatEther(balances.eth)}, Token: ${formatEther(balances.token)}`);
      }
    }

    console.log(`\n--- Summary (first 50 wallets) ---`);
    console.log(`Total ETH: ${formatEther(totalEth)} ETH across ${fundedWallets} wallets`);
    console.log(`Total Token: ${formatEther(totalToken)} tokens across ${walletsWithToken} wallets`);
  }
}

// ============================================================
// Main
// ============================================================

async function main() {
  const args = process.argv.slice(2);

  if (args.length === 0) {
    console.log("Usage: npx ts-node marketMaker.ts <token_address> [num_trades]");
    console.log("Example: npx ts-node marketMaker.ts 0x01c6058175eDA34Fc8922EeAe32BC383CB203211 100");
    process.exit(1);
  }

  const tokenAddress = args[0] as Address;
  const numTrades = parseInt(args[1] || "50");

  if (!tokenAddress.startsWith("0x") || tokenAddress.length !== 42) {
    console.error("Invalid token address");
    process.exit(1);
  }

  const marketMaker = new MarketMaker(tokenAddress);

  // 先检查钱包状态
  await marketMaker.checkWalletsStatus();

  // 开始做市
  await marketMaker.runMarketMaking(numTrades);
}

main().catch(console.error);
