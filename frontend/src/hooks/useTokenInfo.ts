"use client";

import { useReadContract } from "wagmi";
import { useMemo } from "react";
import { baseSepolia } from "wagmi/chains";

// Minimal ERC20 ABI for name and symbol
const ERC20_ABI = [
  {
    inputs: [],
    name: "name",
    outputs: [{ name: "", type: "string" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [],
    name: "symbol",
    outputs: [{ name: "", type: "string" }],
    stateMutability: "view",
    type: "function",
  },
] as const;

// Get chain ID from env
const chainId = parseInt(process.env.NEXT_PUBLIC_CHAIN_ID || "84532", 10);

export interface TokenInfo {
  name: string | null;
  symbol: string | null;
  isLoading: boolean;
  error: Error | null;
}

/**
 * Hook to fetch token name and symbol from blockchain
 * @param addressOrSymbol - Token contract address (0x...) or symbol
 * @returns Token info with name and symbol
 */
export function useTokenInfo(addressOrSymbol: string): TokenInfo {
  const isAddress = addressOrSymbol?.startsWith("0x") && addressOrSymbol.length === 42;
  const tokenAddress = isAddress ? addressOrSymbol as `0x${string}` : undefined;

  // Fetch token name
  const { data: name, isLoading: nameLoading, error: nameError } = useReadContract({
    address: tokenAddress,
    abi: ERC20_ABI,
    functionName: "name",
    chainId,
    query: {
      enabled: !!tokenAddress,
      staleTime: 60 * 60 * 1000, // Cache for 1 hour since token info doesn't change
    },
  });

  // Fetch token symbol
  const { data: symbol, isLoading: symbolLoading, error: symbolError } = useReadContract({
    address: tokenAddress,
    abi: ERC20_ABI,
    functionName: "symbol",
    chainId,
    query: {
      enabled: !!tokenAddress,
      staleTime: 60 * 60 * 1000, // Cache for 1 hour
    },
  });

  return useMemo(() => ({
    name: name as string | null ?? null,
    symbol: symbol as string | null ?? null,
    isLoading: nameLoading || symbolLoading,
    error: (nameError || symbolError) as Error | null,
  }), [name, symbol, nameLoading, symbolLoading, nameError, symbolError]);
}

/**
 * Get display name for a token
 * Returns symbol if available, otherwise truncated address, otherwise the original input
 */
export function getTokenDisplayName(
  addressOrSymbol: string,
  tokenInfo?: TokenInfo
): string {
  // If we have token info with symbol, use it
  if (tokenInfo?.symbol) {
    return tokenInfo.symbol.toUpperCase();
  }

  // If it's not an address, return as-is (it's already a symbol)
  if (!addressOrSymbol?.startsWith("0x")) {
    return addressOrSymbol?.toUpperCase() || "";
  }

  // If still loading, show loading indicator
  if (tokenInfo?.isLoading) {
    return "...";
  }

  // Truncate address for display
  if (addressOrSymbol.length >= 10) {
    return `${addressOrSymbol.slice(0, 6)}...${addressOrSymbol.slice(-4)}`;
  }

  return addressOrSymbol;
}
