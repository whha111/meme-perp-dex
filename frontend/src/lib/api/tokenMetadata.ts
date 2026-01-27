/**
 * Token Metadata API Client
 * 用于保存和获取代币元数据（logo、描述、社交链接等）
 */

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080';

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

/**
 * 创建或更新代币元数据
 */
export async function createTokenMetadata(data: CreateTokenMetadataRequest): Promise<TokenMetadata> {
  const response = await fetch(`${API_BASE_URL}/api/v1/token/metadata`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(data),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ message: 'Unknown error' }));
    throw new Error(error.message || `Failed to save token metadata: ${response.statusText}`);
  }

  const result = await response.json();
  return result.data;
}

/**
 * 获取代币元数据
 */
export async function getTokenMetadata(instId: string): Promise<TokenMetadata> {
  const response = await fetch(`${API_BASE_URL}/api/v1/token/metadata?instId=${instId}`);

  if (!response.ok) {
    throw new Error(`Failed to fetch token metadata: ${response.statusText}`);
  }

  const result = await response.json();
  return result.data;
}

/**
 * 获取所有代币元数据
 */
export async function getAllTokenMetadata(): Promise<TokenMetadata[]> {
  const response = await fetch(`${API_BASE_URL}/api/v1/token/metadata/all`);

  if (!response.ok) {
    throw new Error(`Failed to fetch all token metadata: ${response.statusText}`);
  }

  const result = await response.json();
  return result.data;
}
