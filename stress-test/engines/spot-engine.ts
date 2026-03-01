/**
 * Spot Trading Engine — 200 wallets continuous spot trading
 *
 * Strategies: 40% buy, 30% sell, 15% create token, 15% liquidity
 * Each round picks 3-5 random wallets, interval 1-3s.
 * Reuses patterns from marketMaker.ts and buySpot.ts.
 */
import { parseEther, formatEther, erc20Abi, type Address } from "viem";
import { baseSepolia } from "viem/chains";
import { privateKeyToAccount } from "viem/accounts";
import { getRpcPool } from "../utils/rpc-pool.js";
import { type StressWallet, pickRandom, randInt } from "../utils/wallet-manager.js";
import { CONTRACTS, TOKEN_FACTORY_ABI, SPOT_CONFIG } from "../config.js";

// ── Types ──────────────────────────────────────────────────────

export interface SpotStats {
  totalRounds: number;
  buys: number;
  sells: number;
  creates: number;
  failures: number;
  startTime: number;
}

// ── Spot Engine ────────────────────────────────────────────────

export class SpotEngine {
  private running = false;
  private wallets: StressWallet[] = [];
  private knownTokens: Address[] = [];
  private busyWallets: Set<Address> = new Set(); // Prevent concurrent txs from same wallet
  readonly stats: SpotStats = { totalRounds: 0, buys: 0, sells: 0, creates: 0, failures: 0, startTime: 0 };

  constructor(wallets: StressWallet[]) {
    this.wallets = wallets;
  }

  async start(): Promise<void> {
    this.running = true;
    this.stats.startTime = Date.now();

    // Load existing tokens
    await this.refreshTokenList();
    console.log(`[SpotEngine] Started with ${this.wallets.length} wallets, ${this.knownTokens.length} known tokens`);

    while (this.running) {
      try {
        await this.executeRound();
      } catch (err: any) {
        console.error(`[SpotEngine] Round error: ${err.message}`);
        this.stats.failures++;
      }

      const delay = randInt(SPOT_CONFIG.roundIntervalMs[0], SPOT_CONFIG.roundIntervalMs[1]);
      await new Promise(r => setTimeout(r, delay));
    }
  }

  stop(): void {
    this.running = false;
    console.log(`[SpotEngine] Stopping...`);
  }

  private async executeRound(): Promise<void> {
    this.stats.totalRounds++;
    const count = randInt(SPOT_CONFIG.walletsPerRound[0], SPOT_CONFIG.walletsPerRound[1]);
    // Filter out busy wallets to prevent nonce conflicts
    const available = this.wallets.filter(w => !this.busyWallets.has(w.address));
    if (available.length === 0) return;
    const selected = pickRandom(available, Math.min(count, available.length));

    for (const wallet of selected) {
      if (!this.running) break;

      this.busyWallets.add(wallet.address);
      const roll = Math.random();
      try {
        if (roll < SPOT_CONFIG.buyProbability) {
          await this.executeBuy(wallet);
        } else if (roll < SPOT_CONFIG.buyProbability + SPOT_CONFIG.sellProbability) {
          await this.executeSell(wallet);
        } else if (roll < SPOT_CONFIG.buyProbability + SPOT_CONFIG.sellProbability + SPOT_CONFIG.createTokenProbability) {
          await this.executeCreateToken(wallet);
        } else {
          // Provide liquidity = just buy
          await this.executeBuy(wallet);
        }
      } catch (err: any) {
        this.stats.failures++;
        console.error(`[SpotEngine] Wallet ${wallet.index} error: ${err.message?.slice(0, 80)}`);
      } finally {
        this.busyWallets.delete(wallet.address);
      }
    }

    // Refresh token list every 50 rounds
    if (this.stats.totalRounds % 50 === 0) {
      await this.refreshTokenList();
    }
  }

  private async executeBuy(wallet: StressWallet): Promise<void> {
    if (this.knownTokens.length === 0) return;

    const pool = getRpcPool();
    const token = this.knownTokens[randInt(0, this.knownTokens.length - 1)];
    const ethAmount = parseEther(
      (SPOT_CONFIG.minBuyEth + Math.random() * (SPOT_CONFIG.maxBuyEth - SPOT_CONFIG.minBuyEth)).toFixed(6)
    );

    // Check balance first
    const balance = await pool.call(() =>
      pool.httpClient.getBalance({ address: wallet.address })
    );

    if (balance < ethAmount + parseEther("0.0005")) {
      if (this.stats.totalRounds <= 3) {
        console.log(`[Spot] W${wallet.index} skip buy: balance=${formatEther(balance)} < need=${formatEther(ethAmount + parseEther("0.0005"))}`);
      }
      return;
    }

    const walletClient = pool.createWallet(wallet.privateKey);
    const account = privateKeyToAccount(wallet.privateKey);

    const hash = await pool.call(() =>
      walletClient.writeContract({
        chain: baseSepolia,
        address: CONTRACTS.tokenFactory,
        abi: TOKEN_FACTORY_ABI,
        functionName: "buy",
        args: [token, 0n],
        value: ethAmount,
        account,
      })
    );

    await pool.call(() => pool.httpClient.waitForTransactionReceipt({ hash }));
    this.stats.buys++;
    console.log(`[Spot] W${wallet.index} BUY ${formatEther(ethAmount)} ETH → ${token.slice(0, 10)}...`);
  }

  private async executeSell(wallet: StressWallet): Promise<void> {
    if (this.knownTokens.length === 0) return;

    const pool = getRpcPool();
    const token = this.knownTokens[randInt(0, this.knownTokens.length - 1)];

    // Check token balance
    const tokenBalance = await pool.call(() =>
      pool.httpClient.readContract({
        address: token,
        abi: erc20Abi,
        functionName: "balanceOf",
        args: [wallet.address],
      })
    );

    if (tokenBalance === 0n) return; // No tokens to sell

    const sellPct = SPOT_CONFIG.sellPercentRange[0] +
      Math.random() * (SPOT_CONFIG.sellPercentRange[1] - SPOT_CONFIG.sellPercentRange[0]);
    const sellAmount = BigInt(Math.floor(Number(tokenBalance) * sellPct));

    if (sellAmount < parseEther("0.0001")) return;

    const walletClient = pool.createWallet(wallet.privateKey);
    const account = privateKeyToAccount(wallet.privateKey);

    // Approve
    await pool.call(() =>
      walletClient.writeContract({
        chain: baseSepolia,
        address: token,
        abi: erc20Abi,
        functionName: "approve",
        args: [CONTRACTS.tokenFactory, sellAmount * 2n],
        account,
      })
    );

    // Sell
    const hash = await pool.call(() =>
      walletClient.writeContract({
        chain: baseSepolia,
        address: CONTRACTS.tokenFactory,
        abi: TOKEN_FACTORY_ABI,
        functionName: "sell",
        args: [token, sellAmount, 0n],
        account,
      })
    );

    await pool.call(() => pool.httpClient.waitForTransactionReceipt({ hash }));
    this.stats.sells++;
    console.log(`[Spot] W${wallet.index} SELL ${formatEther(sellAmount)} tokens ${token.slice(0, 10)}...`);
  }

  private async executeCreateToken(wallet: StressWallet): Promise<void> {
    const pool = getRpcPool();
    const walletClient = pool.createWallet(wallet.privateKey);
    const account = privateKeyToAccount(wallet.privateKey);

    const id = Date.now().toString(36);
    const name = `StressToken_${id}`;
    const symbol = `ST${id.slice(-4).toUpperCase()}`;

    try {
      const hash = await pool.call(() =>
        walletClient.writeContract({
          chain: baseSepolia,
          address: CONTRACTS.tokenFactory,
          abi: TOKEN_FACTORY_ABI,
          functionName: "createToken",
          args: [name, symbol, `ipfs://stress-test/${id}`, 0n],
          value: parseEther("0.001"), // Initial liquidity
          account,
        })
      );

      const receipt = await pool.call(() => pool.httpClient.waitForTransactionReceipt({ hash }));
      this.stats.creates++;
      console.log(`[Spot] W${wallet.index} CREATE ${symbol} tx:${hash.slice(0, 12)}...`);

      // Refresh token list after creation
      await this.refreshTokenList();
    } catch (err: any) {
      this.stats.failures++;
    }
  }

  private async refreshTokenList(): Promise<void> {
    try {
      const pool = getRpcPool();
      const tokens = await pool.call(() =>
        pool.httpClient.readContract({
          address: CONTRACTS.tokenFactory,
          abi: TOKEN_FACTORY_ABI,
          functionName: "getAllTokens",
        })
      );
      this.knownTokens = tokens as Address[];
    } catch {
      // Keep existing list if refresh fails
    }
  }
}
