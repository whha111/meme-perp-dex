/**
 * MEME Perp DEX Trading Bot
 *
 * Uses 200 test wallets to create tokens and perform trading
 */

import {
  createPublicClient,
  createWalletClient,
  http,
  parseEther,
  formatEther,
  type Address,
  type PrivateKeyAccount,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { baseSepolia } from "viem/chains";
import * as fs from "fs";
import * as path from "path";

// ============================================================
// Configuration
// ============================================================

const RPC_URL = "https://base-sepolia.g.alchemy.com/v2/Dr8sMe-1MYIF7jBYuZZj8PMOPAAeJ16d";

const CONTRACTS = {
  TOKEN_FACTORY: "0xE0ddf67E89f5773c960Bc2329109815E8c66BAAe" as Address,
  POSITION_MANAGER: "0xeCA6E2f7466c0A1BA6dB3083a09b8B09969D77Ee" as Address,
  VAULT: "0x467a18E3Ec98587Cd88683E6F9e1792C480C09c7" as Address,
  PRICE_FEED: "0x2dccffb6377364CDD189e2009Af96998F9b8BEcb" as Address,
  READER: "0xD107aB399645ab54869D53e9301850763E890D4F" as Address,
};

// Token Factory ABI (relevant functions only)
const TOKEN_FACTORY_ABI = [
  {
    inputs: [
      { name: "name", type: "string" },
      { name: "symbol", type: "string" },
      { name: "metadataURI", type: "string" },
      { name: "minTokensOut", type: "uint256" },
    ],
    name: "createToken",
    outputs: [{ name: "tokenAddress", type: "address" }],
    stateMutability: "payable",
    type: "function",
  },
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
    inputs: [],
    name: "serviceFee",
    outputs: [{ type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [],
    name: "getAllTokens",
    outputs: [{ type: "address[]" }],
    stateMutability: "view",
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
    inputs: [
      { name: "tokenAddress", type: "address" },
      { name: "ethIn", type: "uint256" },
    ],
    name: "previewBuy",
    outputs: [{ type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
] as const;

// ERC20 ABI for token operations
const ERC20_ABI = [
  {
    inputs: [{ name: "account", type: "address" }],
    name: "balanceOf",
    outputs: [{ type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [
      { name: "spender", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    name: "approve",
    outputs: [{ type: "bool" }],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [],
    name: "symbol",
    outputs: [{ type: "string" }],
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
  const data = fs.readFileSync(walletsPath, "utf-8");
  const walletsFile: WalletsFile = JSON.parse(data);
  return walletsFile.wallets;
}

function randomTokenName(): { name: string; symbol: string } {
  const prefixes = ["Moon", "Doge", "Pepe", "Shiba", "Cat", "Dog", "Elon", "Rocket", "Diamond", "Ape", "Wojak", "Chad", "Gigachad", "Based", "Cope", "Seethe", "Fren", "Wagmi", "Gm", "Ngmi"];
  const suffixes = ["Coin", "Token", "Inu", "Swap", "Moon", "Rocket", "Finance", "Capital", "DAO", "Protocol", "Network", "Chain", "Labs", "Verse", "World"];

  const prefix = prefixes[Math.floor(Math.random() * prefixes.length)];
  const suffix = suffixes[Math.floor(Math.random() * suffixes.length)];
  const randomNum = Math.floor(Math.random() * 1000);

  return {
    name: `${prefix}${suffix}${randomNum}`,
    symbol: `${prefix.toUpperCase().slice(0, 3)}${randomNum}`,
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ============================================================
// Main Trading Bot
// ============================================================

class TradingBot {
  private publicClient;
  private wallets: Wallet[];
  private createdTokens: Address[] = [];

  constructor() {
    this.publicClient = createPublicClient({
      chain: baseSepolia,
      transport: http(RPC_URL),
    });
    this.wallets = loadWallets();
    console.log(`Loaded ${this.wallets.length} wallets`);
  }

  private getWalletClient(wallet: Wallet) {
    const account = privateKeyToAccount(wallet.privateKey as `0x${string}`);
    return createWalletClient({
      account,
      chain: baseSepolia,
      transport: http(RPC_URL),
    });
  }

  async checkWalletBalance(wallet: Wallet): Promise<bigint> {
    const balance = await this.publicClient.getBalance({
      address: wallet.address as Address,
    });
    return balance;
  }

  async createToken(wallet: Wallet, buyAmount: bigint = parseEther("0.01")): Promise<Address | null> {
    const walletClient = this.getWalletClient(wallet);
    const account = privateKeyToAccount(wallet.privateKey as `0x${string}`);

    const { name, symbol } = randomTokenName();
    const metadataURI = `ipfs://QmTest${Date.now()}`;

    // Service fee is 0.001 ETH
    const serviceFee = parseEther("0.001");
    const totalValue = serviceFee + buyAmount;

    console.log(`[Wallet ${wallet.index}] Creating token: ${name} (${symbol})`);
    console.log(`  - Service fee: ${formatEther(serviceFee)} ETH`);
    console.log(`  - Initial buy: ${formatEther(buyAmount)} ETH`);

    try {
      const hash = await walletClient.writeContract({
        address: CONTRACTS.TOKEN_FACTORY,
        abi: TOKEN_FACTORY_ABI,
        functionName: "createToken",
        args: [name, symbol, metadataURI, 0n],
        value: totalValue,
      });

      console.log(`  - Tx hash: ${hash}`);

      // Wait for confirmation
      const receipt = await this.publicClient.waitForTransactionReceipt({ hash });

      if (receipt.status === "success") {
        // Get the created token address from logs
        const allTokens = await this.publicClient.readContract({
          address: CONTRACTS.TOKEN_FACTORY,
          abi: TOKEN_FACTORY_ABI,
          functionName: "getAllTokens",
        });

        const tokenAddress = allTokens[allTokens.length - 1] as Address;
        console.log(`  - Token created: ${tokenAddress}`);
        this.createdTokens.push(tokenAddress);
        return tokenAddress;
      } else {
        console.log(`  - Transaction failed`);
        return null;
      }
    } catch (error: any) {
      console.error(`  - Error: ${error.message}`);
      return null;
    }
  }

  async buyToken(wallet: Wallet, tokenAddress: Address, ethAmount: bigint): Promise<boolean> {
    const walletClient = this.getWalletClient(wallet);

    console.log(`[Wallet ${wallet.index}] Buying ${formatEther(ethAmount)} ETH worth of token ${tokenAddress.slice(0, 10)}...`);

    try {
      const hash = await walletClient.writeContract({
        address: CONTRACTS.TOKEN_FACTORY,
        abi: TOKEN_FACTORY_ABI,
        functionName: "buy",
        args: [tokenAddress, 0n],
        value: ethAmount,
      });

      console.log(`  - Tx hash: ${hash}`);

      const receipt = await this.publicClient.waitForTransactionReceipt({ hash });

      if (receipt.status === "success") {
        console.log(`  - Buy successful`);
        return true;
      } else {
        console.log(`  - Buy failed`);
        return false;
      }
    } catch (error: any) {
      console.error(`  - Error: ${error.message}`);
      return false;
    }
  }

  async sellToken(wallet: Wallet, tokenAddress: Address, tokenAmount: bigint): Promise<boolean> {
    const walletClient = this.getWalletClient(wallet);
    const account = privateKeyToAccount(wallet.privateKey as `0x${string}`);

    console.log(`[Wallet ${wallet.index}] Selling ${formatEther(tokenAmount)} tokens of ${tokenAddress.slice(0, 10)}...`);

    try {
      // First approve the token
      const approveHash = await walletClient.writeContract({
        address: tokenAddress,
        abi: ERC20_ABI,
        functionName: "approve",
        args: [CONTRACTS.TOKEN_FACTORY, tokenAmount],
      });

      await this.publicClient.waitForTransactionReceipt({ hash: approveHash });
      console.log(`  - Approved`);

      // Then sell
      const hash = await walletClient.writeContract({
        address: CONTRACTS.TOKEN_FACTORY,
        abi: TOKEN_FACTORY_ABI,
        functionName: "sell",
        args: [tokenAddress, tokenAmount, 0n],
      });

      console.log(`  - Tx hash: ${hash}`);

      const receipt = await this.publicClient.waitForTransactionReceipt({ hash });

      if (receipt.status === "success") {
        console.log(`  - Sell successful`);
        return true;
      } else {
        console.log(`  - Sell failed`);
        return false;
      }
    } catch (error: any) {
      console.error(`  - Error: ${error.message}`);
      return false;
    }
  }

  async getTokenBalance(wallet: Wallet, tokenAddress: Address): Promise<bigint> {
    const balance = await this.publicClient.readContract({
      address: tokenAddress,
      abi: ERC20_ABI,
      functionName: "balanceOf",
      args: [wallet.address as Address],
    });
    return balance;
  }

  async runBatchTokenCreation(numTokens: number = 20): Promise<void> {
    console.log(`\n========== Creating ${numTokens} Tokens ==========\n`);

    const walletsToUse = this.wallets.slice(0, numTokens);

    for (const wallet of walletsToUse) {
      const balance = await this.checkWalletBalance(wallet);

      if (balance < parseEther("0.02")) {
        console.log(`[Wallet ${wallet.index}] Insufficient balance: ${formatEther(balance)} ETH`);
        continue;
      }

      await this.createToken(wallet, parseEther("0.01"));
      await sleep(2000); // Wait between transactions to avoid rate limiting
    }

    console.log(`\nCreated ${this.createdTokens.length} tokens`);
    console.log("Token addresses:", this.createdTokens);
  }

  async runTradingSimulation(numTrades: number = 50): Promise<void> {
    console.log(`\n========== Running ${numTrades} Trades ==========\n`);

    // Get existing tokens if we haven't created any
    if (this.createdTokens.length === 0) {
      const allTokens = await this.publicClient.readContract({
        address: CONTRACTS.TOKEN_FACTORY,
        abi: TOKEN_FACTORY_ABI,
        functionName: "getAllTokens",
      });
      this.createdTokens = allTokens as Address[];
      console.log(`Found ${this.createdTokens.length} existing tokens`);
    }

    if (this.createdTokens.length === 0) {
      console.log("No tokens available for trading");
      return;
    }

    let successfulTrades = 0;

    for (let i = 0; i < numTrades; i++) {
      // Pick random wallet and token
      const walletIndex = Math.floor(Math.random() * Math.min(100, this.wallets.length));
      const wallet = this.wallets[walletIndex];
      const tokenIndex = Math.floor(Math.random() * this.createdTokens.length);
      const tokenAddress = this.createdTokens[tokenIndex];

      // Decide buy or sell
      const isBuy = Math.random() > 0.4; // 60% chance to buy

      if (isBuy) {
        const balance = await this.checkWalletBalance(wallet);
        if (balance >= parseEther("0.005")) {
          const buyAmount = parseEther((0.001 + Math.random() * 0.009).toFixed(4));
          const success = await this.buyToken(wallet, tokenAddress, buyAmount);
          if (success) successfulTrades++;
        }
      } else {
        const tokenBalance = await this.getTokenBalance(wallet, tokenAddress);
        if (tokenBalance > 0n) {
          // Sell 10-50% of balance
          const sellPercentage = 0.1 + Math.random() * 0.4;
          const sellAmount = BigInt(Math.floor(Number(tokenBalance) * sellPercentage));
          if (sellAmount > 0n) {
            const success = await this.sellToken(wallet, tokenAddress, sellAmount);
            if (success) successfulTrades++;
          }
        }
      }

      await sleep(1500); // Wait between trades
    }

    console.log(`\n========== Trading Complete ==========`);
    console.log(`Successful trades: ${successfulTrades}/${numTrades}`);
  }

  async checkAllBalances(): Promise<void> {
    console.log(`\n========== Checking Wallet Balances ==========\n`);

    let totalBalance = 0n;
    let fundedWallets = 0;

    for (const wallet of this.wallets.slice(0, 50)) {
      const balance = await this.checkWalletBalance(wallet);
      totalBalance += balance;
      if (balance > 0n) {
        fundedWallets++;
        console.log(`[${wallet.index}] ${wallet.address}: ${formatEther(balance)} ETH`);
      }
    }

    console.log(`\nTotal: ${formatEther(totalBalance)} ETH across ${fundedWallets} funded wallets`);
  }
}

// ============================================================
// Main
// ============================================================

async function main() {
  const bot = new TradingBot();

  // Check wallet balances first
  await bot.checkAllBalances();

  // Create 20 new tokens
  await bot.runBatchTokenCreation(20);

  // Run 50 random trades
  await bot.runTradingSimulation(50);
}

main().catch(console.error);
