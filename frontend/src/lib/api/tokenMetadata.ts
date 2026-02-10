/**
 * Token Metadata API Client
 *
 * Connects to backend REST API at /api/v1/token/metadata
 */

import { MATCHING_ENGINE_URL } from "@/config/api";

// ============================================================
// Types
// ============================================================

export interface TokenMetadata {
  instId: string;
  tokenAddress: string;
  name: string;
  symbol: string;
  description?: string;
  logoUrl?: string;
  imageUrl?: string;
  website?: string;
  twitter?: string;
  telegram?: string;
  discord?: string;
  creatorAddress: string;
  totalSupply: string;
  initialBuyAmount?: string;
  isGraduated?: boolean;
  graduationTime?: number;
  createdAt?: string;
  updatedAt?: string;
}

export interface CreateTokenMetadataRequest {
  instId: string;
  tokenAddress: string;
  name: string;
  symbol: string;
  description?: string;
  logoUrl?: string;
  imageUrl?: string;
  website?: string;
  twitter?: string;
  telegram?: string;
  discord?: string;
  creatorAddress: string;
  totalSupply: string;
  initialBuyAmount?: string;
}

// ============================================================
// API Functions
// ============================================================

/**
 * 创建或更新代币元数据
 */
export async function createTokenMetadata(
  data: CreateTokenMetadataRequest
): Promise<TokenMetadata> {
  const res = await fetch(`${MATCHING_ENGINE_URL}/api/v1/token/metadata`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || `Failed to create token metadata: ${res.status}`);
  }
  const json = await res.json();
  return json.data ?? json;
}

/**
 * 获取代币元数据
 */
export async function getTokenMetadata(instId: string): Promise<TokenMetadata> {
  const res = await fetch(
    `${MATCHING_ENGINE_URL}/api/v1/token/metadata?instId=${encodeURIComponent(instId)}`
  );
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || `Failed to get token metadata: ${res.status}`);
  }
  const json = await res.json();
  return json.data ?? json;
}

/**
 * 获取所有代币元数据
 */
export async function getAllTokenMetadata(): Promise<TokenMetadata[]> {
  const res = await fetch(`${MATCHING_ENGINE_URL}/api/v1/token/metadata/all`);
  if (!res.ok) {
    return [];
  }
  const json = await res.json();
  return json.data ?? json ?? [];
}
