"use client";

import { useCallback, useEffect, useState } from "react";
import {
  useAccount,
  usePublicClient,
  useWriteContract,
  useWaitForTransactionReceipt,
} from "wagmi";
import { type Hash } from "viem";
import { CONTRACTS, EXTERNAL_TOKEN_REGISTRY_ABI } from "@/lib/contracts";
import {
  Listing,
  LeverageTier,
  ListingStatus,
  MOCK_MODE,
  readMockListings,
  writeMockListings,
} from "./useListingApplication";

/**
 * Admin-side hook for the listing registry.
 *
 * Surfaces the 4 moderation operations (approve / reject / delist / slash)
 * plus a live list of PENDING + APPROVED applications, matching the
 * mock-vs-real dichotomy of useListingApplication.
 */
export interface UseListingAdminResult {
  // Data
  allListings: Listing[];
  pending: Listing[];
  approved: Listing[];
  isAdmin: boolean | null; // null = loading

  // Actions
  approve: (appId: number) => Promise<void>;
  reject: (appId: number, reason: string) => Promise<void>;
  delist: (appId: number, reason: string) => Promise<void>;
  slash: (appId: number, reason: string) => Promise<void>;

  // Tx state
  isActing: boolean;
  isConfirming: boolean;
  txHash?: Hash;
  error?: string;

  // Misc
  refresh: () => Promise<void>;
  mockMode: boolean;
  isContractConfigured: boolean;
}

const MOCK_SIMULATED_DELAY_MS = 800;

export function useListingAdmin(): UseListingAdminResult {
  const { address } = useAccount();
  const publicClient = usePublicClient();
  const { writeContractAsync } = useWriteContract();

  const registryAddr = CONTRACTS.EXTERNAL_TOKEN_REGISTRY;
  const isContractConfigured =
    !!registryAddr && registryAddr !== ("0x0000000000000000000000000000000000000000" as const);

  const [allListings, setAllListings] = useState<Listing[]>([]);
  const [isAdmin, setIsAdmin] = useState<boolean | null>(null);
  const [isActing, setIsActing] = useState(false);
  const [txHash, setTxHash] = useState<Hash | undefined>();
  const [error, setError] = useState<string | undefined>();

  const { isLoading: isConfirming } = useWaitForTransactionReceipt({
    hash: txHash,
    query: { enabled: !!txHash },
  });

  // ── Refresh: load all listings + check admin role ──
  const refresh = useCallback(async () => {
    setError(undefined);

    if (MOCK_MODE) {
      // Mock mode: anyone is admin (dev convenience); all listings visible
      setAllListings(readMockListings());
      setIsAdmin(true);
      return;
    }

    if (!isContractConfigured || !publicClient) {
      setAllListings([]);
      setIsAdmin(null);
      return;
    }

    try {
      // 1. Fetch admin + nextAppId in one multicall
      const [adminRes, nextIdRes] = await publicClient.multicall({
        contracts: [
          {
            address: registryAddr,
            abi: EXTERNAL_TOKEN_REGISTRY_ABI,
            functionName: "admin",
          },
          {
            address: registryAddr,
            abi: EXTERNAL_TOKEN_REGISTRY_ABI,
            functionName: "nextAppId",
          },
        ],
      });

      if (adminRes.status === "success" && address) {
        setIsAdmin(
          (adminRes.result as string).toLowerCase() === address.toLowerCase()
        );
      } else {
        setIsAdmin(false);
      }

      if (nextIdRes.status !== "success") {
        setAllListings([]);
        return;
      }

      const nextId = nextIdRes.result as bigint;
      if (nextId === 0n) {
        setAllListings([]);
        return;
      }

      // 2. Fetch every listing via multicall
      const calls = [];
      for (let i = 1n; i <= nextId; i++) {
        calls.push({
          address: registryAddr,
          abi: EXTERNAL_TOKEN_REGISTRY_ABI as readonly unknown[],
          functionName: "getListing",
          args: [i],
        });
      }
      const listingResults = await publicClient.multicall({ contracts: calls as any });

      const list: Listing[] = [];
      listingResults.forEach((r, i) => {
        if (r.status !== "success") return;
        const raw = r.result as any;
        list.push({
          appId: i + 1,
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
      setAllListings(list);
    } catch (e: any) {
      setError(e?.shortMessage ?? e?.message ?? "refresh failed");
    }
  }, [publicClient, address, registryAddr, isContractConfigured]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // ── Actions ──

  const runMockAction = useCallback(
    async (
      appId: number,
      updater: (l: Listing) => Listing
    ): Promise<void> => {
      await new Promise((r) => setTimeout(r, MOCK_SIMULATED_DELAY_MS));
      const all = readMockListings();
      const idx = all.findIndex((l) => l.appId === appId);
      if (idx < 0) throw new Error(`listing #${appId} not found`);
      all[idx] = updater(all[idx]);
      writeMockListings(all);
      setAllListings(all);
    },
    []
  );

  const runRealAction = useCallback(
    async (
      fnName: "approveListing" | "rejectListing" | "delistListing" | "slashListing",
      args: readonly unknown[]
    ): Promise<void> => {
      if (!isContractConfigured) throw new Error("Registry contract not configured");
      const hash = await writeContractAsync({
        address: registryAddr,
        abi: EXTERNAL_TOKEN_REGISTRY_ABI,
        functionName: fnName,
        args,
      });
      setTxHash(hash);
    },
    [isContractConfigured, writeContractAsync, registryAddr]
  );

  const wrapAction = useCallback(
    async (fn: () => Promise<void>) => {
      setError(undefined);
      setIsActing(true);
      try {
        await fn();
      } catch (e: any) {
        setError(e?.shortMessage ?? e?.message ?? "action failed");
        throw e;
      } finally {
        setIsActing(false);
      }
    },
    []
  );

  const approve = useCallback(
    async (appId: number) => {
      await wrapAction(async () => {
        if (MOCK_MODE) {
          await runMockAction(appId, (l) => ({
            ...l,
            status: ListingStatus.APPROVED,
            approvedAt: Math.floor(Date.now() / 1000),
          }));
        } else {
          await runRealAction("approveListing", [BigInt(appId)]);
        }
      });
    },
    [wrapAction, runMockAction, runRealAction]
  );

  const reject = useCallback(
    async (appId: number, reason: string) => {
      await wrapAction(async () => {
        if (MOCK_MODE) {
          await runMockAction(appId, (l) => ({ ...l, status: ListingStatus.REJECTED }));
        } else {
          await runRealAction("rejectListing", [BigInt(appId), reason]);
        }
      });
    },
    [wrapAction, runMockAction, runRealAction]
  );

  const delist = useCallback(
    async (appId: number, reason: string) => {
      await wrapAction(async () => {
        if (MOCK_MODE) {
          await runMockAction(appId, (l) => ({ ...l, status: ListingStatus.DELISTED }));
        } else {
          await runRealAction("delistListing", [BigInt(appId), reason]);
        }
      });
    },
    [wrapAction, runMockAction, runRealAction]
  );

  const slash = useCallback(
    async (appId: number, reason: string) => {
      await wrapAction(async () => {
        if (MOCK_MODE) {
          await runMockAction(appId, (l) => ({
            ...l,
            status: ListingStatus.SLASHED,
            lpAmountBNB: 0n,
          }));
        } else {
          await runRealAction("slashListing", [BigInt(appId), reason]);
        }
      });
    },
    [wrapAction, runMockAction, runRealAction]
  );

  // Derived lists
  const pending = allListings.filter((l) => l.status === ListingStatus.PENDING);
  const approved = allListings.filter((l) => l.status === ListingStatus.APPROVED);

  return {
    allListings,
    pending,
    approved,
    isAdmin,
    approve,
    reject,
    delist,
    slash,
    isActing,
    isConfirming,
    txHash,
    error,
    refresh,
    mockMode: MOCK_MODE,
    isContractConfigured,
  };
}
