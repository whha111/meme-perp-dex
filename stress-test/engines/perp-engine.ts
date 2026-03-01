/**
 * Perpetual Trading Engine — 100 wallets continuous perp trading
 *
 * Strategies: 30% open long+pair short, 30% open short+pair long,
 *            25% close, 10% add margin, 5% high leverage (liquidation bait)
 * Uses EIP-712 signatures → POST to matching engine (off-chain, no RPC cost).
 * Only on-chain: deposit to Settlement, nonce reads.
 */
import { parseEther, formatEther, type Address } from "viem";
import { baseSepolia } from "viem/chains";
import { privateKeyToAccount } from "viem/accounts";
import { getRpcPool } from "../utils/rpc-pool.js";
import { type StressWallet, pickRandom, randInt, randBigInt } from "../utils/wallet-manager.js";
import {
  CONTRACTS, SETTLEMENT_ABI, PERP_CONFIG, MATCHING_ENGINE,
  EIP712_DOMAIN, ORDER_TYPES, TOKEN_FACTORY_ABI,
} from "../config.js";

// ── Types ──────────────────────────────────────────────────────

export interface PerpStats {
  totalRounds: number;
  ordersSubmitted: number;
  ordersMatched: number;
  deposits: number;
  failures: number;
  startTime: number;
}

// ── Perp Engine ────────────────────────────────────────────────

export class PerpEngine {
  private running = false;
  private wallets: StressWallet[] = [];
  private tradableTokens: Address[] = [];
  private localNonces: Map<Address, bigint> = new Map();
  readonly stats: PerpStats = { totalRounds: 0, ordersSubmitted: 0, ordersMatched: 0, deposits: 0, failures: 0, startTime: 0 };

  constructor(wallets: StressWallet[]) {
    this.wallets = wallets;
  }

  async start(): Promise<void> {
    this.running = true;
    this.stats.startTime = Date.now();

    // Load tradable tokens + sync nonces
    await this.refreshTokenList();
    await this.syncAllNonces();

    // Bulk deposit: move most of each wallet's ETH into Settlement upfront
    // This prevents the matching engine from trying to auto-deposit (it doesn't have our keys)
    await this.bulkDepositAll();

    console.log(`[PerpEngine] Started with ${this.wallets.length} wallets, ${this.tradableTokens.length} tokens`);

    while (this.running) {
      try {
        await this.executeRound();
      } catch (err: any) {
        console.error(`[PerpEngine] Round error: ${err.message}`);
        this.stats.failures++;
      }

      const delay = randInt(PERP_CONFIG.roundIntervalMs[0], PERP_CONFIG.roundIntervalMs[1]);
      await new Promise(r => setTimeout(r, delay));
    }
  }

  stop(): void {
    this.running = false;
    console.log(`[PerpEngine] Stopping...`);
  }

  private async executeRound(): Promise<void> {
    if (this.tradableTokens.length === 0) {
      await this.refreshTokenList();
      if (this.tradableTokens.length === 0) return;
    }

    this.stats.totalRounds++;

    // ── Every round: place limit orders on 1-3 random tokens for book depth ──
    const tokensForLimits = randInt(1, Math.min(3, this.tradableTokens.length));
    for (let t = 0; t < tokensForLimits; t++) {
      const token = this.tradableTokens[randInt(0, this.tradableTokens.length - 1)];
      try {
        await this.placeLimitOrders(this.wallets, token);
      } catch (err: any) {
        if (this.stats.failures < 20) {
          console.error(`[PerpEngine] Limit order error: ${err.message?.slice(0, 100)}`);
        }
        this.stats.failures++;
      }
    }

    // ── Then: paired limit orders at current price for actual fills ────
    const count = randInt(PERP_CONFIG.walletsPerRound[0], PERP_CONFIG.walletsPerRound[1]);
    const selected = pickRandom(this.wallets, count);

    // Pair wallets for counterparty matching
    for (let i = 0; i < selected.length - 1; i += 2) {
      if (!this.running) break;

      const walletA = selected[i];
      const walletB = selected[i + 1];
      const token = this.tradableTokens[randInt(0, this.tradableTokens.length - 1)];

      const roll = Math.random();
      try {
        // Close probability is higher (40%) to free up margin for new orders
        const closeProbability = 0.40;
        if (roll < closeProbability) {
          // Close positions for both wallets to free margin
          await this.submitCloseOrder(walletA, token);
          await this.submitCloseOrder(walletB, token);
        } else if (roll < closeProbability + PERP_CONFIG.highLeverageProbability) {
          // High leverage pair (liquidation bait)
          await this.submitPair(walletA, walletB, token, true);
        } else if (roll < closeProbability + PERP_CONFIG.highLeverageProbability + 0.25) {
          // Normal open long + counterparty short
          await this.submitPair(walletA, walletB, token, false);
        } else {
          // Open short + counterparty long (reversed)
          await this.submitPair(walletB, walletA, token, false);
        }
      } catch (err: any) {
        this.stats.failures++;
        console.error(`[PerpEngine] W${walletA.index}/W${walletB.index} error: ${err.message?.slice(0, 100)}`);
        // Re-sync nonce on nonce errors
        if (err.message?.includes("nonce")) {
          await this.syncNonce(walletA);
          await this.syncNonce(walletB);
        }
      }
    }

    // Refresh tokens every 100 rounds
    if (this.stats.totalRounds % 100 === 0) {
      await this.refreshTokenList();
    }

    // Re-sync nonces every 50 rounds
    if (this.stats.totalRounds % 50 === 0) {
      await this.syncAllNonces();
    }
  }

  /** Check available balance from matching engine API */
  private async getAvailableBalance(wallet: StressWallet): Promise<bigint> {
    try {
      const resp = await fetch(`${MATCHING_ENGINE.url}/api/user/${wallet.address}/balance`);
      const data = await resp.json() as { availableBalance?: string };
      return BigInt(data.availableBalance ?? "0");
    } catch {
      return 0n;
    }
  }

  /**
   * Submit a long/short pair — walletA goes long, walletB goes short.
   *
   * IMPORTANT: Uses LIMIT orders at current price (not market orders).
   * Market orders (price=0) match against ANY resting order regardless of price,
   * which instantly consumes our book-depth limit orders. By using limit orders
   * at current price, the pair still crosses (matches each other), but wider-spread
   * book orders are preserved because limit-vs-limit matching requires price crossing.
   */
  private async submitPair(
    longWallet: StressWallet,
    shortWallet: StressWallet,
    token: Address,
    highLeverage: boolean,
  ): Promise<void> {
    const size = parseEther(
      (PERP_CONFIG.minSizeEth + Math.random() * (PERP_CONFIG.maxSizeEth - PERP_CONFIG.minSizeEth)).toFixed(6)
    );

    const leverageMultiplier = highLeverage
      ? BigInt(randInt(PERP_CONFIG.highLeverageRange[0], PERP_CONFIG.highLeverageRange[1]))
      : BigInt(randInt(PERP_CONFIG.leverageRange[0], PERP_CONFIG.leverageRange[1]));
    const leverage = leverageMultiplier * PERP_CONFIG.leveragePrecision;

    // Check available balance from matching engine before submitting
    const requiredMargin = size / leverageMultiplier + parseEther("0.0001"); // margin + fee buffer
    const [longAvail, shortAvail] = await Promise.all([
      this.getAvailableBalance(longWallet),
      this.getAvailableBalance(shortWallet),
    ]);

    if (longAvail < requiredMargin || shortAvail < requiredMargin) {
      if (longAvail < requiredMargin) await this.ensureDeposit(longWallet, requiredMargin);
      if (shortAvail < requiredMargin) await this.ensureDeposit(shortWallet, requiredMargin);

      const [newLong, newShort] = await Promise.all([
        this.getAvailableBalance(longWallet),
        this.getAvailableBalance(shortWallet),
      ]);
      if (newLong < requiredMargin || newShort < requiredMargin) return;
    }

    // Get current price for limit order pricing
    const currentPrice = await this.getTokenPrice(token);

    // If no price available, fall back to market orders (they'll match each other)
    const orderType = currentPrice > 0n ? 1 : 0;

    // Paired limit orders: both at current price so they cross and match each other,
    // but they won't eat resting book orders at wider spreads (limit-vs-limit price check)
    const longResult = await this.submitOrder(longWallet, token, true, size, leverage, orderType, currentPrice);
    if (longResult.success) {
      this.stats.ordersSubmitted++;
      if (longResult.matched) this.stats.ordersMatched++;
    }

    const shortResult = await this.submitOrder(shortWallet, token, false, size, leverage, orderType, currentPrice);
    if (shortResult.success) {
      this.stats.ordersSubmitted++;
      if (shortResult.matched) this.stats.ordersMatched++;
    }

    const lev = `${leverageMultiplier}x${highLeverage ? " ⚠HIGH" : ""}`;
    console.log(`[Perp] W${longWallet.index}↑ W${shortWallet.index}↓ ${formatEther(size)}ETH ${lev} → ${token.slice(0, 10)}...`);
  }

  /** Submit a close order (market order in opposite direction) */
  private async submitCloseOrder(wallet: StressWallet, token: Address): Promise<void> {
    const pool = getRpcPool();

    // Read existing position
    try {
      const position = await pool.call(() =>
        pool.httpClient.readContract({
          address: CONTRACTS.positionManager,
          abi: [{ inputs: [{ name: "user", type: "address" }, { name: "token", type: "address" }], name: "getPositionByToken", outputs: [{ components: [{ name: "size", type: "uint256" }, { name: "collateral", type: "uint256" }, { name: "avgPrice", type: "uint256" }, { name: "isLong", type: "bool" }, { name: "lastFundingIndex", type: "uint256" }, { name: "openTimestamp", type: "uint256" }], type: "tuple" }], stateMutability: "view", type: "function" }] as const,
          functionName: "getPositionByToken",
          args: [wallet.address, token],
        })
      );

      if (position.size === 0n) return; // No position to close

      // Use limit order at current price for closing (avoids eating book depth)
      const closePrice = await this.getTokenPrice(token);
      const closeOrderType = closePrice > 0n ? 1 : 0;
      const result = await this.submitOrder(
        wallet, token, !position.isLong, position.size, 10000n, closeOrderType, closePrice
      );

      if (result.success) {
        this.stats.ordersSubmitted++;
        if (result.matched) this.stats.ordersMatched++;
        console.log(`[Perp] W${wallet.index} CLOSE ${position.isLong ? "LONG" : "SHORT"} ${formatEther(position.size)}ETH`);
      }
    } catch {
      // Position might not exist, skip
    }
  }

  /** Sign and submit an order to the matching engine */
  private async submitOrder(
    wallet: StressWallet,
    token: Address,
    isLong: boolean,
    size: bigint,
    leverage: bigint,
    orderType: number,
    price: bigint = 0n,
  ): Promise<{ success: boolean; matched: boolean }> {
    const account = privateKeyToAccount(wallet.privateKey);
    const nonce = this.getLocalNonce(wallet);
    const deadline = BigInt(Math.floor(Date.now() / 1000) + 3600);

    const order = {
      trader: wallet.address,
      token,
      isLong,
      size,
      leverage,
      price,
      deadline,
      nonce,
      orderType,
    };

    const signature = await account.signTypedData({
      domain: EIP712_DOMAIN,
      types: ORDER_TYPES,
      primaryType: "Order" as const,
      message: order,
    });

    let result: { success: boolean; matches?: any[]; error?: string };
    try {
      const response = await fetch(`${MATCHING_ENGINE.url}${MATCHING_ENGINE.submitEndpoint}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          trader: order.trader,
          token: order.token,
          isLong: order.isLong,
          size: order.size.toString(),
          leverage: order.leverage.toString(),
          price: order.price.toString(),
          deadline: order.deadline.toString(),
          nonce: order.nonce.toString(),
          orderType: order.orderType,
          signature,
        }),
      });
      result = await response.json() as { success: boolean; matches?: any[]; error?: string };
    } catch (fetchErr: any) {
      // Matching engine unreachable
      if (this.stats.failures % 50 === 0) {
        console.error(`[PerpEngine] Matching engine unreachable: ${fetchErr.message?.slice(0, 60)}`);
      }
      return { success: false, matched: false };
    }

    if (result.success) {
      this.incrementNonce(wallet);
      return { success: true, matched: (result.matches?.length ?? 0) > 0 };
    }

    // Log first few errors for debugging
    if (this.stats.failures < 20) {
      console.error(`[PerpEngine] W${wallet.index} order rejected: ${result.error?.slice(0, 100)}`);
    }

    if (result.error?.includes("nonce")) {
      await this.syncNonce(wallet);
    }

    this.stats.failures++;
    return { success: false, matched: false };
  }

  /** Ensure wallet has enough margin in Settlement contract */
  private async ensureDeposit(wallet: StressWallet, requiredMargin: bigint): Promise<void> {
    const pool = getRpcPool();

    const balance = await pool.call(() =>
      pool.httpClient.readContract({
        address: CONTRACTS.settlement,
        abi: SETTLEMENT_ABI,
        functionName: "getUserBalance",
        args: [wallet.address],
      })
    );

    // Settlement uses 6-decimal precision internally; convert to 18-decimal for comparison
    const SETTLEMENT_TO_ETH = 10n ** 12n;
    const rawAvailable = (balance as any)[0] ?? (balance as any).available ?? 0n;
    const available = rawAvailable * SETTLEMENT_TO_ETH;

    if (available >= requiredMargin) return;

    // Need to deposit (depositAmount is in 18-decimal ETH, depositETH handles conversion)
    const depositAmount = requiredMargin - available + parseEther("0.001");
    const walletClient = pool.createWallet(wallet.privateKey);
    const account = privateKeyToAccount(wallet.privateKey);

    // Check ETH balance
    const ethBalance = await pool.call(() =>
      pool.httpClient.getBalance({ address: wallet.address })
    );

    if (ethBalance < depositAmount + parseEther("0.0005")) {
      if (this.stats.totalRounds <= 2) {
        console.log(`[Perp] W${wallet.index} skip deposit: ethBalance=${formatEther(ethBalance)} < need=${formatEther(depositAmount + parseEther("0.0005"))}`);
      }
      return;
    }

    const hash = await pool.call(() =>
      walletClient.writeContract({
        chain: baseSepolia,
        address: CONTRACTS.settlement,
        abi: SETTLEMENT_ABI,
        functionName: "depositETH",
        args: [],
        value: depositAmount,
        account,
      })
    );

    await pool.call(() => pool.httpClient.waitForTransactionReceipt({ hash }));
    this.stats.deposits++;
    console.log(`[Perp] W${wallet.index} DEPOSIT ${formatEther(depositAmount)} ETH to Settlement`);

    // Sync balance with matching engine so it picks up the new deposit
    try {
      await fetch(`${MATCHING_ENGINE.url}/api/balance/sync`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ trader: wallet.address }),
      });
    } catch {} // Non-critical — matching engine will sync on next order
  }

  /**
   * Bulk deposit: move ~80% of each wallet's ETH into Settlement at startup.
   * This prevents the matching engine's autoDepositIfNeeded from trying to
   * deposit from wallets it doesn't control (no private key access).
   */
  private async bulkDepositAll(): Promise<void> {
    const pool = getRpcPool();
    const GAS_RESERVE = parseEther("0.003"); // Keep 0.003 ETH for gas

    let deposited = 0;
    for (const wallet of this.wallets) {
      try {
        const ethBalance = await pool.call(() =>
          pool.httpClient.getBalance({ address: wallet.address })
        );

        // Check existing Settlement balance (6-decimal → 18-decimal conversion)
        const SETTLEMENT_TO_ETH = 10n ** 12n;
        let existingAvailable = 0n;
        try {
          const bal = await pool.call(() =>
            pool.httpClient.readContract({
              address: CONTRACTS.settlement,
              abi: SETTLEMENT_ABI,
              functionName: "getUserBalance",
              args: [wallet.address],
            })
          );
          existingAvailable = ((bal as any)[0] ?? 0n) * SETTLEMENT_TO_ETH;
        } catch {}

        // Skip if already has >0.01 ETH in Settlement
        if (existingAvailable > parseEther("0.01")) {
          console.log(`[Perp] W${wallet.index} already has ${formatEther(existingAvailable)} ETH in Settlement, skip deposit`);
          deposited++;
          continue;
        }

        // Deposit: balance - gas reserve
        if (ethBalance <= GAS_RESERVE) {
          console.log(`[Perp] W${wallet.index} skip bulk deposit: balance=${formatEther(ethBalance)} < gas reserve`);
          continue;
        }

        const depositAmount = ethBalance - GAS_RESERVE;
        const walletClient = pool.createWallet(wallet.privateKey);
        const account = privateKeyToAccount(wallet.privateKey);

        const hash = await pool.call(() =>
          walletClient.writeContract({
            chain: baseSepolia,
            address: CONTRACTS.settlement,
            abi: SETTLEMENT_ABI,
            functionName: "depositETH",
            args: [],
            value: depositAmount,
            account,
          })
        );

        await pool.call(() => pool.httpClient.waitForTransactionReceipt({ hash }));

        // Sync with matching engine
        try {
          await fetch(`${MATCHING_ENGINE.url}/api/balance/sync`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ trader: wallet.address }),
          });
        } catch {}

        deposited++;
        this.stats.deposits++;
        console.log(`[Perp] W${wallet.index} BULK DEPOSIT ${formatEther(depositAmount)} ETH to Settlement`);
      } catch (err: any) {
        console.error(`[Perp] W${wallet.index} bulk deposit failed: ${err.message?.slice(0, 80)}`);
      }
    }

    console.log(`[PerpEngine] Bulk deposit complete: ${deposited}/${this.wallets.length} wallets deposited`);
  }

  // ── Limit Order Placement (Order Book Depth) ──────────────

  /** Get current price of a token — uses TokenFactory bonding curve as source of truth */
  private async getTokenPrice(token: Address): Promise<bigint> {
    // Primary: TokenFactory bonding curve (always has a price)
    try {
      const pool = getRpcPool();
      const price = await pool.call(() =>
        pool.httpClient.readContract({
          address: CONTRACTS.tokenFactory,
          abi: TOKEN_FACTORY_ABI,
          functionName: "getCurrentPrice",
          args: [token],
        })
      );
      if ((price as bigint) > 0n) return price as bigint;
    } catch {}

    // Fallback: matching engine stats API
    try {
      const resp = await fetch(`${MATCHING_ENGINE.url}/api/stats/${token}`);
      const data = await resp.json() as { lastPrice?: string; price?: string };
      const priceStr = data.lastPrice || data.price || "0";
      const p = BigInt(priceStr);
      if (p > 0n) return p;
    } catch {}

    return 0n;
  }

  /**
   * Place limit orders around the current price to create visible order book depth.
   *
   * Strategy: Place orders at multiple price levels with WIDE spreads (5-30%).
   * Since paired trading now uses limit orders at current price, these wider-spread
   * orders won't be consumed (limit-vs-limit matching requires price crossing).
   *
   * Each call places 6-12 orders: half bids, half asks, across 5 spread tiers.
   */
  private async placeLimitOrders(wallets: StressWallet[], token: Address): Promise<void> {
    const currentPrice = await this.getTokenPrice(token);
    if (currentPrice === 0n) return;

    // More orders per round for denser book
    const orderCount = randInt(6, 12);
    const candidates = pickRandom(wallets, orderCount);

    // Spread tiers: 5%, 10%, 15%, 20%, 25% — creates visible depth at multiple levels
    const spreadTiersBps = [500, 1000, 1500, 2000, 2500];

    for (const wallet of candidates) {
      if (!this.running) break;

      const available = await this.getAvailableBalance(wallet);
      if (available < parseEther("0.002")) continue;

      const isLong = Math.random() > 0.5;
      // Pick a random spread tier + some jitter (±2%)
      const tierIdx = randInt(0, spreadTiersBps.length - 1);
      const jitterBps = randInt(-200, 200);
      const spreadBps = Math.max(300, spreadTiersBps[tierIdx] + jitterBps); // minimum 3%
      let price: bigint;

      if (isLong) {
        price = currentPrice * BigInt(10000 - spreadBps) / 10000n;
      } else {
        price = currentPrice * BigInt(10000 + spreadBps) / 10000n;
      }

      if (price === 0n) continue;

      const size = parseEther(
        (PERP_CONFIG.minSizeEth + Math.random() * (PERP_CONFIG.maxSizeEth - PERP_CONFIG.minSizeEth) * 0.5).toFixed(6)
      );
      const leverageMultiplier = BigInt(randInt(2, 15));
      const leverage = leverageMultiplier * PERP_CONFIG.leveragePrecision;

      const result = await this.submitOrder(wallet, token, isLong, size, leverage, 1, price);
      if (result.success) {
        this.stats.ordersSubmitted++;
        const side = isLong ? "BID" : "ASK";
        const spreadPct = (spreadBps / 100).toFixed(1);
        console.log(`[Perp] W${wallet.index} ${side} ${formatEther(size)}ETH @${spreadPct}% ${isLong ? "below" : "above"} → ${token.slice(0, 10)}...`);
      }
    }
  }

  // ── Nonce Management ───────────────────────────────────────

  private getLocalNonce(wallet: StressWallet): bigint {
    return this.localNonces.get(wallet.address) ?? 0n;
  }

  private incrementNonce(wallet: StressWallet): void {
    const current = this.getLocalNonce(wallet);
    this.localNonces.set(wallet.address, current + 1n);
  }

  private async syncNonce(wallet: StressWallet): Promise<void> {
    // Primary: matching engine API (has the latest nonce including off-chain orders)
    try {
      const resp = await fetch(`${MATCHING_ENGINE.url}/api/user/${wallet.address}/nonce`);
      const data = await resp.json() as { nonce?: string | number };
      if (data.nonce != null) {
        this.localNonces.set(wallet.address, BigInt(data.nonce));
        return;
      }
    } catch {}

    // Fallback: on-chain Settlement nonces
    const pool = getRpcPool();
    try {
      const nonce = await pool.call(() =>
        pool.httpClient.readContract({
          address: CONTRACTS.settlement,
          abi: SETTLEMENT_ABI,
          functionName: "nonces",
          args: [wallet.address],
        })
      );
      this.localNonces.set(wallet.address, nonce as bigint);
    } catch {}
  }

  private async syncAllNonces(): Promise<void> {
    // Try matching engine API first (batch via concurrent fetches)
    let apiSynced = 0;
    const batchSize = 10;
    for (let i = 0; i < this.wallets.length; i += batchSize) {
      const batch = this.wallets.slice(i, i + batchSize);
      const results = await Promise.allSettled(
        batch.map(async (w) => {
          const resp = await fetch(`${MATCHING_ENGINE.url}/api/user/${w.address}/nonce`);
          const data = await resp.json() as { nonce?: string | number };
          if (data.nonce != null) {
            this.localNonces.set(w.address, BigInt(data.nonce));
            apiSynced++;
          }
        })
      );
    }

    if (apiSynced > 0) {
      console.log(`[PerpEngine] Synced ${apiSynced}/${this.wallets.length} nonces from matching engine`);
      return;
    }

    // Fallback: batch on-chain reads
    const pool = getRpcPool();
    const calls = this.wallets.map(w => () =>
      pool.httpClient.readContract({
        address: CONTRACTS.settlement,
        abi: SETTLEMENT_ABI,
        functionName: "nonces",
        args: [w.address],
      })
    );

    const results = await pool.batchRead(calls);
    results.forEach((r, i) => {
      if (r.success && r.result != null) {
        this.localNonces.set(this.wallets[i].address, r.result as bigint);
      }
    });
    console.log(`[PerpEngine] Synced ${results.filter(r => r.success).length}/${this.wallets.length} nonces from chain`);
  }

  private async refreshTokenList(): Promise<void> {
    try {
      const pool = getRpcPool();
      // Use perpTokenFactory — the one the matching engine knows about
      const tokens = await pool.call(() =>
        pool.httpClient.readContract({
          address: CONTRACTS.perpTokenFactory,
          abi: TOKEN_FACTORY_ABI,
          functionName: "getAllTokens",
        })
      );
      this.tradableTokens = tokens as Address[];
    } catch {}
  }
}
