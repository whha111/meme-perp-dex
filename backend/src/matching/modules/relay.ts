/**
 * DEPRECATED — relay module (SettlementV2 gasless deposits)
 *
 * This module has been replaced by the derived wallet margin architecture.
 * Users now deposit BNB directly to their derived wallet.
 * Margin is locked in PerpVault via marginBatch.ts.
 *
 * All functions are stubs that return safe defaults.
 * This file exists only to prevent runtime errors from dynamic imports in server.ts.
 * TODO: Remove all dynamic import("./modules/relay") calls from server.ts in a future cleanup pass.
 */

import type { Address } from "viem";
import { logger } from "../utils/logger";

export async function getUserDeposits(_user: Address): Promise<bigint> {
  return 0n;
}

export async function getUserTotalWithdrawn(_user: Address): Promise<bigint> {
  return 0n;
}

export async function getWithdrawalNonce(_user: Address): Promise<bigint> {
  return 0n;
}

export function getRelayerStatus() {
  return { deprecated: true, status: "disabled", message: "Relay module deprecated — use derived wallet" };
}

export async function getMetaTxNonce(_user: Address): Promise<bigint> {
  return 0n;
}

export async function getUserBalance(_user: Address) {
  return { available: 0n, locked: 0n, total: 0n };
}

export async function relayDeposit(_request: any) {
  return { success: false, reason: "DEPRECATED: relay module disabled" };
}

export function logRelayStatus() {
  logger.info("Relay", "DEPRECATED — relay module disabled, using derived wallet margin");
}
