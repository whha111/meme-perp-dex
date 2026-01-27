"use client";

/**
 * Hook to get trade data directly from on-chain TokenFactory events
 * This provides K-line data without requiring a backend WebSocket server
 */

import { useEffect, useState, useCallback, useMemo, useRef } from "react";
import { parseAbiItem, formatEther, type Address, type Log, createPublicClient, http, fallback } from "viem";
import { baseSepolia } from "viem/chains";
import { tradeEventEmitter } from "@/lib/tradeEvents";

// TokenFactory Trade event ABI
const TRADE_EVENT_ABI = parseAbiItem(
  "event Trade(address indexed token, address indexed trader, bool isBuy, uint256 ethAmount, uint256 tokenAmount, uint256 virtualEth, uint256 virtualToken, uint256 timestamp)"
);

// Contract address
const TOKEN_FACTORY_ADDRESS = (process.env.NEXT_PUBLIC_TOKEN_FACTORY_ADDRESS ||
  "0xCfDCD9F8D39411cF855121331B09aef1C88dc056") as Address;

export interface OnChainTrade {
  tokenAddress: string;
  trader: string;
  isBuy: boolean;
  ethAmount: bigint;
  tokenAmount: bigint;
  virtualEth: bigint;
  virtualToken: bigint;
  timestamp: number;
  blockNumber: bigint;
  transactionHash: string;
  price: number; // ETH per token (derived from virtualEth/virtualToken)
}

export interface KlineBar {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

interface UseOnChainTradesReturn {
  trades: OnChainTrade[];
  klines: KlineBar[];
  isLoading: boolean;
  error: Error | null;
  latestPrice: number | null;
  refetch: () => Promise<void>;
}

// TokenCreated event ABI for getting initial price
const TOKEN_CREATED_EVENT_ABI = parseAbiItem(
  "event TokenCreated(address indexed token, address indexed creator, string name, string symbol, string metadataURI, uint256 timestamp)"
);

/**
 * Calculate price from virtual reserves
 * price = virtualEth / virtualToken (in ETH per token)
 *
 * IMPORTANT: The contract emits virtualEth/virtualToken values BEFORE the trade,
 * so we need to calculate the AFTER-trade price based on trade direction.
 *
 * For BUY: user pays ETH, receives tokens
 *   - virtualEth increases by ethAmount
 *   - virtualToken decreases by tokenAmount
 *   - After price = (virtualEth + ethAmount) / (virtualToken - tokenAmount)
 *
 * For SELL: user pays tokens, receives ETH
 *   - virtualEth decreases by ethAmount (the ETH out)
 *   - virtualToken increases by tokenAmount
 *   - After price = (virtualEth - ethAmount) / (virtualToken + tokenAmount)
 */
function calculatePriceAfterTrade(
  virtualEth: bigint,
  virtualToken: bigint,
  ethAmount: bigint,
  tokenAmount: bigint,
  isBuy: boolean
): number {
  let afterVirtualEth: bigint;
  let afterVirtualToken: bigint;

  if (isBuy) {
    // Buy: ETH goes in, tokens come out
    afterVirtualEth = virtualEth + ethAmount;
    afterVirtualToken = virtualToken - tokenAmount;
  } else {
    // Sell: tokens go in, ETH comes out
    // Note: ethAmount in sell event is the ETH received (after fee)
    // We need to estimate the total ETH that was deducted from reserves
    // For simplicity, use ethAmount as approximation (fee is small ~1%)
    afterVirtualEth = virtualEth - ethAmount;
    afterVirtualToken = virtualToken + tokenAmount;
  }

  if (afterVirtualToken <= 0n) return 0;
  return Number(afterVirtualEth) / Number(afterVirtualToken);
}

/**
 * Aggregate trades into K-line bars
 * If no trades exist, generate K-lines from creation time with initial price
 */
function aggregateToKlines(
  trades: OnChainTrade[],
  resolutionSeconds: number,
  initialData?: { createdAt: number; initialPrice: number }
): KlineBar[] {
  const bars = new Map<number, KlineBar>();
  const now = Math.floor(Date.now() / 1000);

  // If we have initial data but no trades, generate K-lines from creation time
  if (trades.length === 0 && initialData && initialData.initialPrice > 0) {
    const { createdAt, initialPrice } = initialData;
    const startTime = Math.floor(createdAt / resolutionSeconds) * resolutionSeconds;

    // Generate K-lines from creation to now (max 500 bars to avoid performance issues)
    const maxBars = 500;
    let currentTime = startTime;
    let barCount = 0;

    while (currentTime <= now && barCount < maxBars) {
      bars.set(currentTime, {
        time: currentTime,
        open: initialPrice,
        high: initialPrice,
        low: initialPrice,
        close: initialPrice,
        volume: 0,
      });
      currentTime += resolutionSeconds;
      barCount++;
    }

    return Array.from(bars.values()).sort((a, b) => a.time - b.time);
  }

  if (trades.length === 0) return [];

  // Sort trades by timestamp
  const sortedTrades = [...trades].sort((a, b) => a.timestamp - b.timestamp);

  // Get initial price for filling gaps before first trade
  const firstTradeTime = sortedTrades[0].timestamp;
  const firstTradePrice = sortedTrades[0].price;

  // If we have initial data, fill in K-lines from creation to first trade
  if (initialData && initialData.createdAt < firstTradeTime) {
    const startTime = Math.floor(initialData.createdAt / resolutionSeconds) * resolutionSeconds;
    const endTime = Math.floor(firstTradeTime / resolutionSeconds) * resolutionSeconds;

    let currentTime = startTime;
    while (currentTime < endTime) {
      bars.set(currentTime, {
        time: currentTime,
        open: initialData.initialPrice,
        high: initialData.initialPrice,
        low: initialData.initialPrice,
        close: initialData.initialPrice,
        volume: 0,
      });
      currentTime += resolutionSeconds;
    }
  }

  for (const trade of sortedTrades) {
    const bucketTime =
      Math.floor(trade.timestamp / resolutionSeconds) * resolutionSeconds;
    const price = trade.price;
    const volume = Number(formatEther(trade.ethAmount));

    let bar = bars.get(bucketTime);

    if (!bar) {
      // Find previous bar's close price for open
      const prevBars = Array.from(bars.values()).filter(
        (b) => b.time < bucketTime
      );
      const prevBar =
        prevBars.length > 0 ? prevBars[prevBars.length - 1] : null;
      const openPrice = prevBar ? prevBar.close : price;

      bar = {
        time: bucketTime,
        open: openPrice,
        high: Math.max(openPrice, price),
        low: Math.min(openPrice, price),
        close: price,
        volume: volume,
      };
    } else {
      bar.high = Math.max(bar.high, price);
      bar.low = Math.min(bar.low, price);
      bar.close = price;
      bar.volume += volume;
    }

    bars.set(bucketTime, bar);
  }

  // Fill gaps between trades with the previous close price
  const sortedBars = Array.from(bars.entries()).sort((a, b) => a[0] - b[0]);
  if (sortedBars.length > 1) {
    const filledBars = new Map<number, KlineBar>();
    for (let i = 0; i < sortedBars.length; i++) {
      const [time, bar] = sortedBars[i];
      filledBars.set(time, bar);

      // Fill gap to next bar
      if (i < sortedBars.length - 1) {
        const nextTime = sortedBars[i + 1][0];
        let fillTime = time + resolutionSeconds;
        while (fillTime < nextTime) {
          filledBars.set(fillTime, {
            time: fillTime,
            open: bar.close,
            high: bar.close,
            low: bar.close,
            close: bar.close,
            volume: 0,
          });
          fillTime += resolutionSeconds;
        }
      }
    }

    // Fill from last bar to now
    const lastBar = sortedBars[sortedBars.length - 1][1];
    let fillTime = sortedBars[sortedBars.length - 1][0] + resolutionSeconds;
    const maxFillBars = 100; // Limit to avoid too many empty bars
    let fillCount = 0;
    while (fillTime <= now && fillCount < maxFillBars) {
      filledBars.set(fillTime, {
        time: fillTime,
        open: lastBar.close,
        high: lastBar.close,
        low: lastBar.close,
        close: lastBar.close,
        volume: 0,
      });
      fillTime += resolutionSeconds;
      fillCount++;
    }

    return Array.from(filledBars.values()).sort((a, b) => a.time - b.time);
  }

  return Array.from(bars.values()).sort((a, b) => a.time - b.time);
}

// TokenFactory ABI for getting pool state
const TOKEN_FACTORY_ABI = [
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
          { name: "graduationFailed", type: "bool" },
          { name: "graduationAttempts", type: "uint8" },
          { name: "perpEnabled", type: "bool" },
        ],
        name: "",
        type: "tuple",
      },
    ],
    stateMutability: "view",
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

// Pump.fun initial price constant (virtualEth / virtualToken)
const INITIAL_VIRTUAL_ETH = 1_820_000_000_000_000_000n; // 1.82 ETH
const INITIAL_VIRTUAL_TOKEN = 1_073_000_000_000_000_000_000_000_000n; // 1.073B tokens
const INITIAL_PRICE = Number(INITIAL_VIRTUAL_ETH) / Number(INITIAL_VIRTUAL_TOKEN); // ~1.7e-9 ETH per token

/**
 * Hook to fetch on-chain trade events and generate K-line data
 */
// Create a dedicated public client for Base Sepolia with fallback RPC endpoints
// This ensures reliability even when primary RPC is unstable
const primaryRpc = process.env.NEXT_PUBLIC_BASE_TESTNET_RPC_URL || "https://sepolia.base.org";
const fallbackRpcs = [
  "https://base-sepolia-rpc.publicnode.com",
  "https://sepolia.base.org",
  "https://base-sepolia.blockpi.network/v1/rpc/public",
];

const dedicatedPublicClient = createPublicClient({
  chain: baseSepolia,
  transport: fallback(
    [
      http(primaryRpc),
      ...fallbackRpcs.filter(rpc => rpc !== primaryRpc).map(rpc => http(rpc)),
    ],
    { rank: true, retryCount: 3 }
  ),
});

export function useOnChainTrades(
  tokenAddress: string | null,
  options?: {
    enabled?: boolean;
    resolutionSeconds?: number;
    fromBlock?: bigint;
    maxBlocks?: bigint;
  }
): UseOnChainTradesReturn {
  const {
    enabled = true,
    resolutionSeconds = 60, // 1 minute default
    fromBlock,
    maxBlocks = 10000n, // Look back ~10000 blocks by default
  } = options || {};

  // Use dedicated Base Sepolia client instead of wagmi's publicClient
  // This ensures it works even if user isn't connected or is on wrong chain
  const publicClient = dedicatedPublicClient;
  const [trades, setTrades] = useState<OnChainTrade[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [initialData, setInitialData] = useState<{ createdAt: number; initialPrice: number } | null>(null);

  const fetchTrades = useCallback(async () => {
    console.log(`[useOnChainTrades] fetchTrades called, tokenAddress: ${tokenAddress}, enabled: ${enabled}`);
    if (!publicClient || !tokenAddress || !enabled) {
      console.log(`[useOnChainTrades] Skipping fetch - publicClient: ${!!publicClient}, tokenAddress: ${tokenAddress}, enabled: ${enabled}`);
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      // First, try to get pool state for creation time and current price
      try {
        const [poolStateResult, priceResult] = await Promise.all([
          publicClient.readContract({
            address: TOKEN_FACTORY_ADDRESS,
            abi: TOKEN_FACTORY_ABI,
            functionName: "getPoolState",
            args: [tokenAddress as Address],
          }),
          publicClient.readContract({
            address: TOKEN_FACTORY_ADDRESS,
            abi: TOKEN_FACTORY_ABI,
            functionName: "getCurrentPrice",
            args: [tokenAddress as Address],
          }),
        ]);

        const poolState = poolStateResult as {
          realETHReserve: bigint;
          realTokenReserve: bigint;
          soldTokens: bigint;
          isGraduated: boolean;
          isActive: boolean;
          creator: string;
          createdAt: bigint;
          metadataURI: string;
        };

        const currentPrice = priceResult as bigint;
        const createdAt = Number(poolState.createdAt);

        // Use current price if available, otherwise use initial price
        const priceEth = currentPrice > 0n ? Number(currentPrice) / 1e18 : INITIAL_PRICE;

        if (createdAt > 0) {
          setInitialData({
            createdAt,
            initialPrice: priceEth,
          });
        }
      } catch (poolError) {
        // Pool might not exist yet, use default initial price
        console.warn("Could not fetch pool state:", poolError);
      }

      // Get current block
      const currentBlock = await publicClient.getBlockNumber();
      const startBlock = fromBlock || currentBlock - maxBlocks;

      // Fetch Trade events for this token
      console.log(`[useOnChainTrades] Fetching logs from block ${startBlock} to ${currentBlock} for token ${tokenAddress}`);
      const logs = await publicClient.getLogs({
        address: TOKEN_FACTORY_ADDRESS,
        event: TRADE_EVENT_ABI,
        args: {
          token: tokenAddress as Address,
        },
        fromBlock: startBlock > 0n ? startBlock : 0n,
        toBlock: currentBlock,
      });

      console.log(`[useOnChainTrades] Found ${logs.length} trade logs`);

      // Parse logs into trades
      const parsedTrades: OnChainTrade[] = logs.map((log) => {
        const args = log.args as {
          token: Address;
          trader: Address;
          isBuy: boolean;
          ethAmount: bigint;
          tokenAmount: bigint;
          virtualEth: bigint;
          virtualToken: bigint;
          timestamp: bigint;
        };

        // Calculate price AFTER the trade (contract emits BEFORE-trade values)
        const price = calculatePriceAfterTrade(
          args.virtualEth,
          args.virtualToken,
          args.ethAmount,
          args.tokenAmount,
          args.isBuy
        );
        console.log(`[useOnChainTrades] Trade: isBuy=${args.isBuy}, ethAmount=${args.ethAmount}, tokenAmount=${args.tokenAmount}, virtualEth=${args.virtualEth}, virtualToken=${args.virtualToken}, priceAfter=${price}, tx=${log.transactionHash}`);

        return {
          tokenAddress: args.token,
          trader: args.trader,
          isBuy: args.isBuy,
          ethAmount: args.ethAmount,
          tokenAmount: args.tokenAmount,
          virtualEth: args.virtualEth,
          virtualToken: args.virtualToken,
          timestamp: Number(args.timestamp),
          blockNumber: log.blockNumber,
          transactionHash: log.transactionHash,
          price,
        };
      });

      console.log(`[useOnChainTrades] Parsed ${parsedTrades.length} trades, setting state`);
      setTrades(parsedTrades);
    } catch (err) {
      console.error("Failed to fetch on-chain trades:", err);
      setError(err instanceof Error ? err : new Error(String(err)));
    } finally {
      setIsLoading(false);
    }
  }, [publicClient, tokenAddress, enabled, fromBlock, maxBlocks]);

  // Fetch on mount and when dependencies change
  useEffect(() => {
    fetchTrades();
  }, [fetchTrades]);

  // Auto-refresh every 15 seconds to catch new trades
  useEffect(() => {
    if (!enabled || !tokenAddress) return;
    const interval = setInterval(fetchTrades, 15000);
    return () => clearInterval(interval);
  }, [enabled, tokenAddress, fetchTrades]);

  // Subscribe to trade events for immediate refresh
  useEffect(() => {
    if (!tokenAddress) return;

    const unsubscribe = tradeEventEmitter.subscribe((tradedToken, txHash) => {
      // Refresh if the traded token matches or after any trade (for general updates)
      if (tradedToken.toLowerCase() === tokenAddress.toLowerCase()) {
        console.log(`[useOnChainTrades] Trade completed for ${tradedToken}, refreshing...`);
        // Small delay to ensure chain has processed the event
        setTimeout(fetchTrades, 1000);
      }
    });

    return unsubscribe;
  }, [tokenAddress, fetchTrades]);

  // Generate K-lines from trades (with initial data for tokens without trades)
  const klines = useMemo(
    () => aggregateToKlines(trades, resolutionSeconds, initialData || undefined),
    [trades, resolutionSeconds, initialData]
  );

  // Get latest price (from trades or initial data)
  const latestPrice = useMemo(() => {
    if (trades.length > 0) {
      const sortedTrades = [...trades].sort((a, b) => b.timestamp - a.timestamp);
      return sortedTrades[0].price;
    }
    return initialData?.initialPrice || null;
  }, [trades, initialData]);

  return {
    trades,
    klines,
    isLoading,
    error,
    latestPrice,
    refetch: fetchTrades,
  };
}

/**
 * Hook to watch for new trades in real-time
 */
export function useOnChainTradeStream(
  tokenAddress: string | null,
  options?: {
    enabled?: boolean;
    onTrade?: (trade: OnChainTrade) => void;
  }
) {
  const { enabled = true, onTrade } = options || {};
  // Use dedicated Base Sepolia client
  const publicClient = dedicatedPublicClient;
  const [latestTrade, setLatestTrade] = useState<OnChainTrade | null>(null);
  const [isConnected, setIsConnected] = useState(false);

  useEffect(() => {
    if (!publicClient || !tokenAddress || !enabled) {
      setIsConnected(false);
      return;
    }

    let unwatch: (() => void) | undefined;

    try {
      unwatch = publicClient.watchContractEvent({
        address: TOKEN_FACTORY_ADDRESS,
        abi: [TRADE_EVENT_ABI],
        eventName: "Trade",
        args: {
          token: tokenAddress as Address,
        },
        onLogs: (logs) => {
          for (const log of logs) {
            const args = log.args as {
              token: Address;
              trader: Address;
              isBuy: boolean;
              ethAmount: bigint;
              tokenAmount: bigint;
              virtualEth: bigint;
              virtualToken: bigint;
              timestamp: bigint;
            };

            const trade: OnChainTrade = {
              tokenAddress: args.token,
              trader: args.trader,
              isBuy: args.isBuy,
              ethAmount: args.ethAmount,
              tokenAmount: args.tokenAmount,
              virtualEth: args.virtualEth,
              virtualToken: args.virtualToken,
              timestamp: Number(args.timestamp),
              blockNumber: log.blockNumber,
              transactionHash: log.transactionHash,
              // Calculate price AFTER the trade
              price: calculatePriceAfterTrade(
                args.virtualEth,
                args.virtualToken,
                args.ethAmount,
                args.tokenAmount,
                args.isBuy
              ),
            };

            setLatestTrade(trade);
            onTrade?.(trade);
          }
        },
      });

      setIsConnected(true);
    } catch (err) {
      console.error("Failed to watch trade events:", err);
      setIsConnected(false);
    }

    return () => {
      unwatch?.();
      setIsConnected(false);
    };
  }, [publicClient, tokenAddress, enabled, onTrade]);

  return {
    latestTrade,
    isConnected,
  };
}
