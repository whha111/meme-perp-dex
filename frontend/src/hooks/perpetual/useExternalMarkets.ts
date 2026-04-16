"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { usePublicClient } from "wagmi";
import { type Address, getAddress } from "viem";
import { CONTRACTS, EXTERNAL_TOKEN_REGISTRY_ABI } from "@/lib/contracts";
import {
  Listing,
  LeverageTier,
  ListingStatus,
  MOCK_MODE,
  readMockListings,
} from "./useListingApplication";

// Minimal ABI for reading PancakeSwap V2 pairs
const PAIR_ABI = [
  { inputs: [], name: "getReserves", outputs: [
    { type: "uint112" }, { type: "uint112" }, { type: "uint32" }
  ], stateMutability: "view", type: "function" },
  { inputs: [], name: "token0", outputs: [{ type: "address" }], stateMutability: "view", type: "function" },
] as const;

// Minimal ERC20 ABI for reading symbol
const ERC20_ABI = [
  { inputs: [], name: "symbol", outputs: [{ type: "string" }], stateMutability: "view", type: "function" },
] as const;

const WBNB = (process.env.NEXT_PUBLIC_WETH_ADDRESS || "") as Address;

/**
 * Market row for the public catalog. Mark price is computed from the pair's
 * live reserves; symbol from token contract; volume / OI are placeholders
 * that will be populated by an engine-side endpoint in a later iteration.
 */
export interface ExternalMarket {
  appId: number;
  token: Address;
  pair: Address;
  symbol: string;                // e.g. "UUDOG"
  maxLeverage: number;           // 2/3/5/7/10
  markPriceBNB: number;          // BNB per token (float for display)
  pairBNBReserve: number;        // total BNB on the pair (for LP liquidity display)
  lpBondBNB: number;             // the project's first-loss bond amount
  // Placeholders until engine stats API arrives
  volume24hUSD?: number;
  openInterestUSD?: number;
}

const TIER_TO_LEV: Record<LeverageTier, number> = {
  [LeverageTier.TIER_2X]: 2,
  [LeverageTier.TIER_3X]: 3,
  [LeverageTier.TIER_5X]: 5,
  [LeverageTier.TIER_7X]: 7,
  [LeverageTier.TIER_10X]: 10,
};

export interface UseExternalMarketsResult {
  markets: ExternalMarket[];
  totalLpLockedBNB: number;
  loading: boolean;
  error?: string;
  refresh: () => Promise<void>;
  mockMode: boolean;
}

export function useExternalMarkets(): UseExternalMarketsResult {
  const publicClient = usePublicClient();
  const [markets, setMarkets] = useState<ExternalMarket[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | undefined>();

  const registryAddr = CONTRACTS.EXTERNAL_TOKEN_REGISTRY;
  const isContractConfigured =
    !!registryAddr && registryAddr !== ("0x0000000000000000000000000000000000000000" as const);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(undefined);

    try {
      // ── Mock mode: read from localStorage, synthesize prices ──
      if (MOCK_MODE) {
        const all = readMockListings();
        const approved = all.filter((l) => l.status === ListingStatus.APPROVED);
        const fake: ExternalMarket[] = approved.map((l) => ({
          appId: l.appId,
          token: l.token,
          pair: l.pair,
          symbol: `MOCK${l.appId}`,
          maxLeverage: TIER_TO_LEV[l.tier] ?? 2,
          markPriceBNB: 0.00000001 + (l.appId % 10) * 1e-9,
          pairBNBReserve: 50 + (l.appId % 20) * 10,
          lpBondBNB: Number(l.lpAmountBNB) / 1e18,
          volume24hUSD: 100_000 + (l.appId % 10) * 50_000,
          openInterestUSD: 10_000 + (l.appId % 7) * 8_000,
        }));
        setMarkets(fake);
        return;
      }

      if (!isContractConfigured || !publicClient) {
        setMarkets([]);
        return;
      }

      // ── Step 1: enumerate active listings ──
      const activeIds = (await publicClient.readContract({
        address: registryAddr,
        abi: EXTERNAL_TOKEN_REGISTRY_ABI,
        functionName: "getActiveListings",
      })) as bigint[];

      if (activeIds.length === 0) {
        setMarkets([]);
        return;
      }

      // ── Step 2: multicall getListing for each active appId ──
      const listingCalls = activeIds.map((id) => ({
        address: registryAddr,
        abi: EXTERNAL_TOKEN_REGISTRY_ABI as readonly unknown[],
        functionName: "getListing",
        args: [id],
      }));
      const listingResults = await publicClient.multicall({ contracts: listingCalls as any });

      type RegListing = {
        token: Address; pair: Address; projectTeam: Address;
        lpAmountBNB: bigint; lpUnlockAt: bigint; feesPaid: bigint;
        tier: number; status: number; appliedAt: bigint; approvedAt: bigint;
      };

      const rawListings: { appId: number; raw: RegListing }[] = [];
      listingResults.forEach((r, i) => {
        if (r.status !== "success") return;
        rawListings.push({ appId: Number(activeIds[i]), raw: r.result as RegListing });
      });

      if (rawListings.length === 0) {
        setMarkets([]);
        return;
      }

      // ── Step 3: multicall pair reserves + token0 + token symbol ──
      const pairCalls: any[] = [];
      for (const { raw } of rawListings) {
        pairCalls.push({ address: raw.pair, abi: PAIR_ABI, functionName: "getReserves" });
        pairCalls.push({ address: raw.pair, abi: PAIR_ABI, functionName: "token0" });
        pairCalls.push({ address: raw.token, abi: ERC20_ABI, functionName: "symbol" });
      }
      const pairResults = await publicClient.multicall({ contracts: pairCalls });

      // ── Step 4: assemble markets ──
      const out: ExternalMarket[] = [];
      for (let i = 0; i < rawListings.length; i++) {
        const { appId, raw } = rawListings[i];
        const reservesRes = pairResults[i * 3];
        const token0Res   = pairResults[i * 3 + 1];
        const symbolRes   = pairResults[i * 3 + 2];

        if (reservesRes.status !== "success" || token0Res.status !== "success") continue;

        const reserves = reservesRes.result as [bigint, bigint, number];
        const token0 = token0Res.result as Address;

        const tokenIsToken0 = token0.toLowerCase() === raw.token.toLowerCase();
        const tokenReserve = tokenIsToken0 ? reserves[0] : reserves[1];
        const bnbReserve   = tokenIsToken0 ? reserves[1] : reserves[0];

        // Mark price: BNB per 1 token, adjusted for 18 decimals on both sides
        let markPriceBNB = 0;
        if (tokenReserve > 0n) {
          markPriceBNB = Number(bnbReserve) / Number(tokenReserve);
        }

        const symbol = symbolRes.status === "success" ? String(symbolRes.result) : "???";

        out.push({
          appId,
          token: getAddress(raw.token),
          pair: getAddress(raw.pair),
          symbol,
          maxLeverage: TIER_TO_LEV[raw.tier as LeverageTier] ?? 2,
          markPriceBNB,
          pairBNBReserve: Number(bnbReserve) / 1e18,
          lpBondBNB: Number(raw.lpAmountBNB) / 1e18,
          // Volume / OI not yet wired — engine API coming in a later day
          volume24hUSD: undefined,
          openInterestUSD: undefined,
        });
      }

      setMarkets(out);
    } catch (e: any) {
      setError(e?.shortMessage ?? e?.message ?? "fetch failed");
      setMarkets([]);
    } finally {
      setLoading(false);
    }
  }, [publicClient, registryAddr, isContractConfigured]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const totalLpLockedBNB = useMemo(
    () => markets.reduce((s, m) => s + m.lpBondBNB, 0),
    [markets]
  );

  return {
    markets,
    totalLpLockedBNB,
    loading,
    error,
    refresh,
    mockMode: MOCK_MODE,
  };
}
