/**
 * externalListing.ts — bridges the ExternalTokenRegistry on-chain contract
 * with the engine's lifecycle + per-token leverage configuration.
 *
 * Responsibilities:
 *   1. On startup, scan the registry for all APPROVED listings and populate
 *      per-token state (markTokenExternalListed + perTokenMaxLeverage map).
 *   2. Subscribe to the registry's events:
 *        ListingApproved  → add to map + mark lifecycle EXTERNAL_LISTED
 *        ListingDelisted  → pauseToken (positions can still close)
 *        ListingSlashed   → pauseToken (LP confiscated, same effect engine-side)
 *   3. Expose getMaxLeverageForToken(token) for the hot path in server.ts.
 *
 * Read-only RPC cost: 1 multicall on startup + 1 event subscription per run.
 * No busy-polling — we trust the chain to emit events reliably.
 */

import {
  createPublicClient,
  http,
  parseAbiItem,
  webSocket,
  getAddress,
  type Address,
  type PublicClient,
} from "viem";
import { logger } from "../utils/logger";
import {
  TokenState,
  markTokenExternalListed,
  unmarkTokenExternalListed,
  pauseToken,
} from "./lifecycle";

// ============================================================
//  Config
// ============================================================

const REGISTRY_ADDRESS = process.env.EXTERNAL_TOKEN_REGISTRY_ADDRESS as Address | undefined;
const RPC_URL = process.env.RPC_URL || "https://bsc-testnet-rpc.publicnode.com";

// Minimal ABI — only the entries we actually read/subscribe to
const REGISTRY_ABI = [
  // Views
  {
    inputs: [],
    name: "nextAppId",
    outputs: [{ type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [{ name: "appId", type: "uint256" }],
    name: "getListing",
    outputs: [
      {
        type: "tuple",
        components: [
          { name: "token", type: "address" },
          { name: "pair", type: "address" },
          { name: "projectTeam", type: "address" },
          { name: "lpAmountBNB", type: "uint256" },
          { name: "lpUnlockAt", type: "uint256" },
          { name: "feesPaid", type: "uint256" },
          { name: "tier", type: "uint8" },
          { name: "status", type: "uint8" },
          { name: "appliedAt", type: "uint64" },
          { name: "approvedAt", type: "uint64" },
        ],
      },
    ],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [{ name: "token", type: "address" }],
    name: "getMaxLeverageForToken",
    outputs: [{ type: "uint8" }],
    stateMutability: "view",
    type: "function",
  },
  // Events — parseAbiItem strings below
] as const;

// Mirror the on-chain enum ordering
enum ListingStatus {
  NONE = 0,
  PENDING = 1,
  APPROVED = 2,
  REJECTED = 3,
  DELISTED = 4,
  SLASHED = 5,
}

enum LeverageTier {
  TIER_2X = 0,
  TIER_3X = 1,
  TIER_5X = 2,
  TIER_7X = 3,
  TIER_10X = 4,
}

const TIER_TO_LEV: Record<number, number> = {
  [LeverageTier.TIER_2X]: 2,
  [LeverageTier.TIER_3X]: 3,
  [LeverageTier.TIER_5X]: 5,
  [LeverageTier.TIER_7X]: 7,
  [LeverageTier.TIER_10X]: 10,
};

// ============================================================
//  Internal state
// ============================================================

/** token (lowercase) → max leverage (2/3/5/7/10) for APPROVED external listings */
const perTokenMaxLev = new Map<string, number>();
/** token (lowercase) → Pancake pair address for price oracle */
const perTokenPair = new Map<string, Address>();
/** appId → token (for delist/slash event handling — event carries appId, not token) */
const appIdToToken = new Map<number, string>();

let publicClient: PublicClient | null = null;
let unwatchApproved: (() => void) | null = null;
let unwatchDelisted: (() => void) | null = null;
let unwatchSlashed: (() => void) | null = null;

// ============================================================
//  Public API
// ============================================================

/** Returns 0 if token is not external-listed, else 2/3/5/7/10 */
export function getMaxLeverageForExternalToken(token: Address): number {
  return perTokenMaxLev.get(token.toLowerCase()) ?? 0;
}

/** Returns undefined if token is not external-listed */
export function getPancakePairForExternalToken(token: Address): Address | undefined {
  return perTokenPair.get(token.toLowerCase());
}

export function isExternalListed(token: Address): boolean {
  return perTokenMaxLev.has(token.toLowerCase());
}

export function getExternalListingStats(): {
  activeListings: number;
  tokens: string[];
} {
  return {
    activeListings: perTokenMaxLev.size,
    tokens: Array.from(perTokenMaxLev.keys()),
  };
}

// ============================================================
//  Startup: scan + subscribe
// ============================================================

export async function initExternalListingBridge(): Promise<void> {
  if (!REGISTRY_ADDRESS) {
    logger.info("ExternalListing", "EXTERNAL_TOKEN_REGISTRY_ADDRESS not set — skipping bridge init");
    return;
  }

  publicClient = createPublicClient({ transport: http(RPC_URL) }) as PublicClient;

  try {
    await scanApprovedListings();
    attachEventWatchers();
    logger.info(
      "ExternalListing",
      `Bridge initialized — ${perTokenMaxLev.size} active external listing(s) loaded`
    );
  } catch (e: any) {
    logger.warn("ExternalListing", `Bridge init failed: ${e?.message?.slice(0, 120)}`);
  }
}

/**
 * Full scan of the Registry on startup — enumerate every appId and collect the
 * APPROVED ones. Uses multicall to do it in one RPC round-trip.
 */
async function scanApprovedListings(): Promise<void> {
  if (!publicClient || !REGISTRY_ADDRESS) return;

  const nextId = (await publicClient.readContract({
    address: REGISTRY_ADDRESS,
    abi: REGISTRY_ABI,
    functionName: "nextAppId",
  })) as bigint;

  if (nextId === 0n) {
    logger.info("ExternalListing", "Registry has zero listings");
    return;
  }

  const calls = [];
  for (let i = 1n; i <= nextId; i++) {
    calls.push({
      address: REGISTRY_ADDRESS,
      abi: REGISTRY_ABI,
      functionName: "getListing",
      args: [i],
    } as const);
  }

  const results = await publicClient.multicall({ contracts: calls as any });

  let loaded = 0;
  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    if (r.status !== "success") continue;
    const l = r.result as any;
    const appId = i + 1;
    appIdToToken.set(appId, String(l.token).toLowerCase());

    if (Number(l.status) !== ListingStatus.APPROVED) continue;

    activateInternal({
      token: l.token,
      pair: l.pair,
      tier: Number(l.tier),
      source: "startup-scan",
    });
    loaded++;
  }

  logger.info("ExternalListing", `Scan complete: ${loaded}/${Number(nextId)} listings in APPROVED state`);
}

/**
 * Subscribe to registry events. We use viem watch APIs which poll by default
 * but are cheap (one eth_getLogs per ~4s, and only blocks where events
 * actually fire will carry data).
 */
function attachEventWatchers(): void {
  if (!publicClient || !REGISTRY_ADDRESS) return;

  const approvedEvent = parseAbiItem("event ListingApproved(uint256 indexed appId, address indexed admin)");
  const delistedEvent = parseAbiItem("event ListingDelisted(uint256 indexed appId, address indexed admin, string reason)");
  const slashedEvent = parseAbiItem("event ListingSlashed(uint256 indexed appId, address indexed admin, uint256 slashedAmount, string reason)");

  unwatchApproved = publicClient.watchEvent({
    address: REGISTRY_ADDRESS,
    event: approvedEvent,
    onLogs: (logs) => {
      for (const l of logs) {
        const appId = Number(l.args.appId);
        void handleApproved(appId);
      }
    },
  });

  unwatchDelisted = publicClient.watchEvent({
    address: REGISTRY_ADDRESS,
    event: delistedEvent,
    onLogs: (logs) => {
      for (const l of logs) {
        const appId = Number(l.args.appId);
        const reason = String(l.args.reason ?? "delisted");
        handleRemoved(appId, `delisted: ${reason}`);
      }
    },
  });

  unwatchSlashed = publicClient.watchEvent({
    address: REGISTRY_ADDRESS,
    event: slashedEvent,
    onLogs: (logs) => {
      for (const l of logs) {
        const appId = Number(l.args.appId);
        const reason = String(l.args.reason ?? "slashed");
        handleRemoved(appId, `slashed: ${reason}`);
      }
    },
  });

  logger.info("ExternalListing", `Event watchers attached for ${REGISTRY_ADDRESS.slice(0, 10)}…`);
}

/**
 * Handle approval: read full listing detail, then activate.
 * (The event alone only carries appId + admin; we need tier + token + pair.)
 */
async function handleApproved(appId: number): Promise<void> {
  if (!publicClient || !REGISTRY_ADDRESS) return;
  try {
    const l = (await publicClient.readContract({
      address: REGISTRY_ADDRESS,
      abi: REGISTRY_ABI,
      functionName: "getListing",
      args: [BigInt(appId)],
    })) as any;
    if (Number(l.status) !== ListingStatus.APPROVED) {
      logger.warn("ExternalListing", `Approved event but status=${l.status} for appId=${appId}`);
      return;
    }
    appIdToToken.set(appId, String(l.token).toLowerCase());
    activateInternal({
      token: l.token,
      pair: l.pair,
      tier: Number(l.tier),
      source: `event-approved#${appId}`,
    });
  } catch (e: any) {
    logger.warn("ExternalListing", `handleApproved #${appId} failed: ${e?.message?.slice(0, 80)}`);
  }
}

function activateInternal(args: {
  token: Address;
  pair: Address;
  tier: number;
  source: string;
}): void {
  const tokenLC = String(args.token).toLowerCase();
  const maxLev = TIER_TO_LEV[args.tier] ?? 2;

  perTokenMaxLev.set(tokenLC, maxLev);
  perTokenPair.set(tokenLC, getAddress(args.pair));

  // Engine-side lifecycle — registers the token if not seen before
  markTokenExternalListed(getAddress(args.token), 0n);

  logger.info(
    "ExternalListing",
    `Activated ${tokenLC.slice(0, 10)}… tier=${maxLev}x pair=${args.pair.slice(0, 10)}… (${args.source})`
  );
}

function handleRemoved(appId: number, reason: string): void {
  const tokenLC = appIdToToken.get(appId);
  if (!tokenLC) {
    logger.warn("ExternalListing", `Removed event for unknown appId ${appId}`);
    return;
  }

  perTokenMaxLev.delete(tokenLC);
  perTokenPair.delete(tokenLC);

  const tokenAddr = getAddress(tokenLC) as Address;
  unmarkTokenExternalListed(tokenAddr, reason);
  // Also pause (in case token wasn't in EXTERNAL_LISTED state for any reason)
  try { pauseToken(tokenAddr, `external-registry: ${reason}`); } catch { /* noop if already paused */ }

  logger.info("ExternalListing", `Deactivated ${tokenLC.slice(0, 10)}… (${reason})`);
}

/** For graceful shutdown */
export function shutdownExternalListingBridge(): void {
  unwatchApproved?.();
  unwatchDelisted?.();
  unwatchSlashed?.();
  unwatchApproved = unwatchDelisted = unwatchSlashed = null;
  publicClient = null;
}
