"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  useAccount,
  useReadContract,
  useWaitForTransactionReceipt,
  useWriteContract,
  usePublicClient,
} from "wagmi";
import { parseEther, type Address, type Hash } from "viem";
import { CONTRACTS, EXTERNAL_TOKEN_REGISTRY_ABI } from "@/lib/contracts";

// ============================================================
//  Types (mirror IExternalTokenRegistry.sol)
// ============================================================

/** On-chain enum values — order MUST match Solidity LeverageTier */
export enum LeverageTier {
  TIER_2X = 0,
  TIER_3X = 1,
  TIER_5X = 2,
  TIER_7X = 3,
  TIER_10X = 4,
}

/** On-chain enum values — order MUST match Solidity ListingStatus */
export enum ListingStatus {
  NONE = 0,
  PENDING = 1,
  APPROVED = 2,
  REJECTED = 3,
  DELISTED = 4,
  SLASHED = 5,
}

export interface Listing {
  appId: number;
  token: Address;
  pair: Address;
  projectTeam: Address;
  lpAmountBNB: bigint;
  lpUnlockAt: number; // unix seconds
  feesPaid: bigint;
  tier: LeverageTier;
  status: ListingStatus;
  appliedAt: number; // unix seconds
  approvedAt: number; // unix seconds
}

export interface ApplyInput {
  token: Address;
  pair: Address;
  tier: LeverageTier;
}

// ============================================================
//  Mock-mode config (env-gated, persisted to localStorage)
// ============================================================

const MOCK_MODE = process.env.NEXT_PUBLIC_LISTING_MOCK_MODE === "true";
const MOCK_STORAGE_KEY = "memeperp_mock_listings_v1";
const MOCK_SIMULATED_DELAY_MS = 1500;

// ============================================================
//  Hook
// ============================================================

export interface UseListingApplicationResult {
  // User actions
  submitApplication: (input: ApplyInput) => Promise<number | undefined>;
  withdrawProjectLP: (appId: number) => Promise<void>;

  // Reads
  listingFeeBNB: bigint;
  tierMinLP: Record<LeverageTier, bigint>;
  myListings: Listing[];
  refreshMyListings: () => Promise<void>;

  // Tx state
  isSubmitting: boolean;
  isConfirming: boolean;
  isWithdrawing: boolean;
  txHash?: Hash;
  error?: string;

  // Misc
  mockMode: boolean;
  isContractConfigured: boolean;
}

export function useListingApplication(): UseListingApplicationResult {
  const { address } = useAccount();
  const publicClient = usePublicClient();
  const { writeContractAsync } = useWriteContract();

  const [txHash, setTxHash] = useState<Hash | undefined>();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isWithdrawing, setIsWithdrawing] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [myListings, setMyListings] = useState<Listing[]>([]);

  const registryAddr = CONTRACTS.EXTERNAL_TOKEN_REGISTRY;
  const isContractConfigured =
    !!registryAddr && registryAddr !== ("0x0000000000000000000000000000000000000000" as Address);

  // ── Reads: listing fee + tier minimums ──
  const { data: listingFeeBNBRaw } = useReadContract({
    address: registryAddr,
    abi: EXTERNAL_TOKEN_REGISTRY_ABI,
    functionName: "listingFeeBNB",
    query: { enabled: isContractConfigured && !MOCK_MODE },
  });

  // For MVP we batch-read all 5 tiers via multicall
  const tierReads = useMemo(
    () =>
      [
        LeverageTier.TIER_2X,
        LeverageTier.TIER_3X,
        LeverageTier.TIER_5X,
        LeverageTier.TIER_7X,
        LeverageTier.TIER_10X,
      ].map((t) => ({
        address: registryAddr,
        abi: EXTERNAL_TOKEN_REGISTRY_ABI as readonly unknown[],
        functionName: "tierMinLP",
        args: [t],
      })),
    [registryAddr]
  );

  const [tierMinLPs, setTierMinLPs] = useState<Record<LeverageTier, bigint>>(MOCK_TIER_DEFAULTS);

  useEffect(() => {
    if (!isContractConfigured || MOCK_MODE || !publicClient) return;
    (async () => {
      try {
        const results = await publicClient.multicall({ contracts: tierReads as any });
        const next: Record<LeverageTier, bigint> = { ...MOCK_TIER_DEFAULTS };
        const tierKeys = [
          LeverageTier.TIER_2X,
          LeverageTier.TIER_3X,
          LeverageTier.TIER_5X,
          LeverageTier.TIER_7X,
          LeverageTier.TIER_10X,
        ];
        results.forEach((r, i) => {
          if (r.status === "success") next[tierKeys[i]] = r.result as bigint;
        });
        setTierMinLPs(next);
      } catch {
        /* keep defaults */
      }
    })();
  }, [publicClient, isContractConfigured, tierReads]);

  // Wait for current tx
  const { isLoading: isConfirming } = useWaitForTransactionReceipt({
    hash: txHash,
    query: { enabled: !!txHash },
  });

  // ── Actions: Mock vs Real ──

  const submitReal = useCallback(
    async (input: ApplyInput): Promise<number | undefined> => {
      if (!isContractConfigured) throw new Error("Registry contract not configured");
      if (!address) throw new Error("Wallet not connected");

      const fee = (listingFeeBNBRaw as bigint | undefined) ?? 0n;
      const minLP = tierMinLPs[input.tier] ?? 0n;
      const value = fee + minLP;

      const hash = await writeContractAsync({
        address: registryAddr,
        abi: EXTERNAL_TOKEN_REGISTRY_ABI,
        functionName: "applyListing",
        args: [input.token, input.pair, input.tier],
        value,
      });
      setTxHash(hash);
      // appId is returned by the contract but reliably known only via event;
      // for now return undefined and let caller refresh listings after confirm
      return undefined;
    },
    [
      isContractConfigured,
      address,
      listingFeeBNBRaw,
      tierMinLPs,
      writeContractAsync,
      registryAddr,
    ]
  );

  const submitMock = useCallback(
    async (input: ApplyInput): Promise<number> => {
      await new Promise((r) => setTimeout(r, MOCK_SIMULATED_DELAY_MS));
      const all = readMockListings();
      const appId = all.length + 1;
      const now = Math.floor(Date.now() / 1000);
      const minLP = MOCK_TIER_DEFAULTS[input.tier];
      const entry: Listing = {
        appId,
        token: input.token,
        pair: input.pair,
        projectTeam: (address ?? "0x0000000000000000000000000000000000000001") as Address,
        lpAmountBNB: minLP,
        lpUnlockAt: now + 60 * 24 * 3600, // 60 days
        feesPaid: parseEther("1"),
        tier: input.tier,
        status: ListingStatus.PENDING,
        appliedAt: now,
        approvedAt: 0,
      };
      all.push(entry);
      writeMockListings(all);
      return appId;
    },
    [address]
  );

  const submitApplication = useCallback(
    async (input: ApplyInput): Promise<number | undefined> => {
      setError(undefined);
      setIsSubmitting(true);
      try {
        const result = MOCK_MODE ? await submitMock(input) : await submitReal(input);
        return result;
      } catch (e: any) {
        setError(e?.shortMessage ?? e?.message ?? "submit failed");
        throw e;
      } finally {
        setIsSubmitting(false);
      }
    },
    [submitMock, submitReal]
  );

  const withdrawReal = useCallback(
    async (appId: number) => {
      if (!isContractConfigured) throw new Error("Registry contract not configured");
      const hash = await writeContractAsync({
        address: registryAddr,
        abi: EXTERNAL_TOKEN_REGISTRY_ABI,
        functionName: "withdrawProjectLP",
        args: [BigInt(appId)],
      });
      setTxHash(hash);
    },
    [isContractConfigured, writeContractAsync, registryAddr]
  );

  const withdrawMock = useCallback(async (appId: number) => {
    await new Promise((r) => setTimeout(r, MOCK_SIMULATED_DELAY_MS));
    const all = readMockListings();
    const idx = all.findIndex((l) => l.appId === appId);
    if (idx >= 0) {
      all[idx].lpAmountBNB = 0n;
      writeMockListings(all);
    }
  }, []);

  const withdrawProjectLP = useCallback(
    async (appId: number) => {
      setError(undefined);
      setIsWithdrawing(true);
      try {
        if (MOCK_MODE) await withdrawMock(appId);
        else await withdrawReal(appId);
      } catch (e: any) {
        setError(e?.shortMessage ?? e?.message ?? "withdraw failed");
        throw e;
      } finally {
        setIsWithdrawing(false);
      }
    },
    [withdrawMock, withdrawReal]
  );

  // ── Load caller's listings (mock or real) ──
  const refreshMyListings = useCallback(async () => {
    if (MOCK_MODE) {
      const all = readMockListings();
      const mine = address ? all.filter((l) => l.projectTeam.toLowerCase() === address.toLowerCase()) : [];
      setMyListings(mine);
      return;
    }
    if (!isContractConfigured || !publicClient || !address) {
      setMyListings([]);
      return;
    }
    try {
      // Read nextAppId then scan backward for caller's entries (MVP, OK for <100 listings)
      const nextId = (await publicClient.readContract({
        address: registryAddr,
        abi: EXTERNAL_TOKEN_REGISTRY_ABI,
        functionName: "nextAppId",
      })) as bigint;

      const calls = [];
      for (let i = 1n; i <= nextId; i++) {
        calls.push({
          address: registryAddr,
          abi: EXTERNAL_TOKEN_REGISTRY_ABI as readonly unknown[],
          functionName: "getListing",
          args: [i],
        });
      }
      if (calls.length === 0) {
        setMyListings([]);
        return;
      }
      const results = await publicClient.multicall({ contracts: calls as any });
      const mine: Listing[] = [];
      results.forEach((r, idx) => {
        if (r.status !== "success") return;
        const raw = r.result as any;
        if (raw.projectTeam.toLowerCase() !== address.toLowerCase()) return;
        mine.push({
          appId: idx + 1,
          token: raw.token,
          pair: raw.pair,
          projectTeam: raw.projectTeam,
          lpAmountBNB: raw.lpAmountBNB,
          lpUnlockAt: Number(raw.lpUnlockAt),
          feesPaid: raw.feesPaid,
          tier: Number(raw.tier) as LeverageTier,
          status: Number(raw.status) as ListingStatus,
          appliedAt: Number(raw.appliedAt),
          approvedAt: Number(raw.approvedAt),
        });
      });
      setMyListings(mine);
    } catch {
      setMyListings([]);
    }
  }, [address, isContractConfigured, publicClient, registryAddr]);

  // Auto-refresh on mount + when caller changes
  useEffect(() => {
    void refreshMyListings();
  }, [refreshMyListings]);

  return {
    submitApplication,
    withdrawProjectLP,
    listingFeeBNB: (listingFeeBNBRaw as bigint | undefined) ?? (MOCK_MODE ? parseEther("1") : 0n),
    tierMinLP: tierMinLPs,
    myListings,
    refreshMyListings,
    isSubmitting,
    isConfirming,
    isWithdrawing,
    txHash,
    error,
    mockMode: MOCK_MODE,
    isContractConfigured,
  };
}

// ============================================================
//  Mock storage helpers (localStorage, SSR-safe)
// ============================================================

const MOCK_TIER_DEFAULTS: Record<LeverageTier, bigint> = {
  [LeverageTier.TIER_2X]: parseEther("83"),
  [LeverageTier.TIER_3X]: parseEther("125"),
  [LeverageTier.TIER_5X]: parseEther("250"),
  [LeverageTier.TIER_7X]: parseEther("500"),
  [LeverageTier.TIER_10X]: parseEther("833"),
};

function readMockListings(): Listing[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(MOCK_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as Array<Omit<Listing, "lpAmountBNB" | "feesPaid"> & { lpAmountBNB: string; feesPaid: string }>;
    return parsed.map((p) => ({
      ...p,
      lpAmountBNB: BigInt(p.lpAmountBNB),
      feesPaid: BigInt(p.feesPaid),
    }));
  } catch {
    return [];
  }
}

function writeMockListings(listings: Listing[]): void {
  if (typeof window === "undefined") return;
  const serialisable = listings.map((l) => ({
    ...l,
    lpAmountBNB: l.lpAmountBNB.toString(),
    feesPaid: l.feesPaid.toString(),
  }));
  localStorage.setItem(MOCK_STORAGE_KEY, JSON.stringify(serialisable));
}

// Exported for admin hook — both hooks read/write the same mock store
export { readMockListings, writeMockListings, MOCK_TIER_DEFAULTS, MOCK_MODE, MOCK_STORAGE_KEY };

// Helpful human-readable labels
export const TIER_LABELS: Record<LeverageTier, string> = {
  [LeverageTier.TIER_2X]: "2x",
  [LeverageTier.TIER_3X]: "3x",
  [LeverageTier.TIER_5X]: "5x",
  [LeverageTier.TIER_7X]: "7x",
  [LeverageTier.TIER_10X]: "10x",
};

export const STATUS_LABELS: Record<ListingStatus, string> = {
  [ListingStatus.NONE]: "—",
  [ListingStatus.PENDING]: "Pending Review",
  [ListingStatus.APPROVED]: "Live",
  [ListingStatus.REJECTED]: "Rejected",
  [ListingStatus.DELISTED]: "Delisted",
  [ListingStatus.SLASHED]: "Slashed",
};

export const STATUS_COLORS: Record<ListingStatus, string> = {
  [ListingStatus.NONE]: "text-okx-text-tertiary",
  [ListingStatus.PENDING]: "text-yellow-500",
  [ListingStatus.APPROVED]: "text-meme-lime",
  [ListingStatus.REJECTED]: "text-red-400",
  [ListingStatus.DELISTED]: "text-okx-text-secondary",
  [ListingStatus.SLASHED]: "text-red-600",
};
