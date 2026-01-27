/**
 * REST API 客户端
 */

import { createAuthHeaders, isAuthenticated } from './auth';

// API Base URL Configuration
// Use matching engine URL for market data endpoints
const getApiBaseUrl = (): string => {
  // Prefer matching engine URL (which has the tickers endpoint)
  const matchingEngineUrl = process.env.NEXT_PUBLIC_MATCHING_ENGINE_URL;
  const apiUrl = process.env.NEXT_PUBLIC_API_URL;

  // Use matching engine URL if available, otherwise fall back to API URL
  if (matchingEngineUrl) {
    return matchingEngineUrl;
  }

  // Production: API URL is required
  if (process.env.NODE_ENV === 'production' && !apiUrl) {
    throw new Error(
      'NEXT_PUBLIC_API_URL or NEXT_PUBLIC_MATCHING_ENGINE_URL is not configured. ' +
      'Please set this environment variable in production.'
    );
  }

  // Development: fallback to localhost matching engine
  return apiUrl || 'http://localhost:8081';
};

const API_BASE_URL = getApiBaseUrl();

export interface ApiResponse<T> {
  code: string;
  msg: string;
  data: T;
}

export interface Instrument {
  instId: string;
  baseCcy: string;
  quoteCcy: string;
  settleCcy: string;
  instType: string;
  state: string;
  ctVal: string;
  ctMult: string;
  lever: string;
  minSz: string;
  lotSz: string;
  tickSz: string;
  maxLever: number;
  maxLimitSz: string;
  maxMktSz: string;
}

export interface Ticker {
  instId: string;
  last: string;
  lastSz: string;
  askPx: string;
  askSz: string;
  bidPx: string;
  bidSz: string;
  open24h: string;
  high24h: string;
  low24h: string;
  volCcy24h: string;
  vol24h: string;
  ts: number;
  logoUrl?: string;
  imageUrl?: string;
}

export interface Trade {
  instId: string;
  tradeId: string;
  px: string;
  sz: string;
  side: string;
  ts: number;
}

export interface MarkPrice {
  instId: string;
  markPx: string;
  ts: number;
}

export interface FundingRate {
  instId: string;
  fundingRate: string;
  nextFundingRate: string;
  fundingTime: number;
  nextFundingTime: number;
}

class ApiClient {
  private baseUrl: string;

  constructor(baseUrl: string = API_BASE_URL) {
    this.baseUrl = baseUrl;
  }

  private async request<T>(
    endpoint: string,
    options: RequestInit = {},
    requireAuth: boolean = false
  ): Promise<T> {
    const url = `${this.baseUrl}${endpoint}`;
    const method = options.method || 'GET';
    const body = options.body as string | undefined;

    let headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };

    // Add authentication headers for private endpoints
    if (requireAuth) {
      if (!isAuthenticated()) {
        throw new Error('Authentication required. Please login first.');
      }
      const authHeaders = createAuthHeaders(method, endpoint, body);
      headers = { ...headers, ...authHeaders };
    }

    const response = await fetch(url, {
      ...options,
      headers: {
        ...headers,
        ...options.headers,
      },
    });

    if (!response.ok) {
      const errorBody = await response.json().catch(() => ({}));
      throw new Error(errorBody.msg || `API Error: ${response.status} ${response.statusText}`);
    }

    const result: ApiResponse<T> = await response.json();

    if (result.code !== '0') {
      throw new Error(result.msg || 'API Error');
    }

    return result.data;
  }

  // Authenticated request helper
  private async authRequest<T>(
    endpoint: string,
    options: RequestInit = {}
  ): Promise<T> {
    return this.request<T>(endpoint, options, true);
  }

  // Public Endpoints
  async getInstruments(instType?: string): Promise<Instrument[]> {
    const params = instType ? `?instType=${instType}` : '';
    return this.request<Instrument[]>(`/api/v1/public/instruments${params}`);
  }

  async getServerTime(): Promise<{ ts: number }> {
    return this.request<{ ts: number }>('/api/v1/public/time');
  }

  // Market Endpoints
  async getTicker(instId: string): Promise<Ticker[]> {
    return this.request<Ticker[]>(`/api/v1/market/ticker?instId=${instId}`);
  }

  async getTickers(): Promise<Ticker[]> {
    return this.request<Ticker[]>('/api/v1/market/tickers');
  }

  async getCandles(
    instId: string,
    bar: string = '1m',
    options?: { after?: number; before?: number; limit?: number }
  ): Promise<string[][]> {
    const params = new URLSearchParams({ instId, bar });
    if (options?.after) params.append('after', options.after.toString());
    if (options?.before) params.append('before', options.before.toString());
    if (options?.limit) params.append('limit', options.limit.toString());
    return this.request<string[][]>(`/api/v1/market/candles?${params}`);
  }

  async getOrderBook(instId: string): Promise<{
    asks: [string, string, string, string][];
    bids: [string, string, string, string][];
    ts: number;
  }> {
    return this.request(`/api/v1/market/books?instId=${instId}`);
  }

  async getTrades(instId: string, limit: number = 100): Promise<Trade[]> {
    return this.request<Trade[]>(
      `/api/v1/market/trades?instId=${instId}&limit=${limit}`
    );
  }

  async getMarkPrice(instId?: string): Promise<MarkPrice[]> {
    const params = instId ? `?instId=${instId}` : '';
    return this.request<MarkPrice[]>(`/api/v1/market/mark-price${params}`);
  }

  async getFundingRate(instId: string): Promise<FundingRate[]> {
    return this.request<FundingRate[]>(
      `/api/v1/market/funding-rate?instId=${instId}`
    );
  }

  async getFundingRateHistory(
    instId: string,
    options?: { after?: number; before?: number; limit?: number }
  ): Promise<FundingRate[]> {
    const params = new URLSearchParams({ instId });
    if (options?.after) params.append('after', options.after.toString());
    if (options?.before) params.append('before', options.before.toString());
    if (options?.limit) params.append('limit', options.limit.toString());
    return this.request<FundingRate[]>(
      `/api/v1/market/funding-rate-history?${params}`
    );
  }

  // Health Check
  async healthCheck(): Promise<{ status: string }> {
    return this.request<{ status: string }>('/health');
  }

  // ==================
  // Account Endpoints (Authenticated)
  // ==================

  async getAccountBalance(): Promise<AccountBalance[]> {
    return this.authRequest<AccountBalance[]>('/api/v1/account/balance');
  }

  async getPositions(instId?: string): Promise<Position[]> {
    const params = instId ? `?instId=${instId}` : '';
    return this.authRequest<Position[]>(`/api/v1/account/positions${params}`);
  }

  async getAccountBills(
    options?: { instId?: string; type?: string; after?: number; before?: number; limit?: number }
  ): Promise<Bill[]> {
    const params = new URLSearchParams();
    if (options?.instId) params.append('instId', options.instId);
    if (options?.type) params.append('type', options.type);
    if (options?.after) params.append('after', options.after.toString());
    if (options?.before) params.append('before', options.before.toString());
    if (options?.limit) params.append('limit', options.limit.toString());
    const queryString = params.toString();
    return this.authRequest<Bill[]>(`/api/v1/account/bills${queryString ? `?${queryString}` : ''}`);
  }

  // ==================
  // Trade Endpoints (Authenticated)
  // ==================

  async placeOrder(order: Omit<PlaceOrderRequest, 'address'>): Promise<PlaceOrderResponse> {
    return this.authRequest<PlaceOrderResponse>('/api/v1/trade/order', {
      method: 'POST',
      body: JSON.stringify(order),
    });
  }

  async cancelOrder(orderId: string, instId: string): Promise<CancelOrderResponse> {
    return this.authRequest<CancelOrderResponse>('/api/v1/trade/cancel-order', {
      method: 'POST',
      body: JSON.stringify({ orderId, instId }),
    });
  }

  async getPendingOrders(instId?: string): Promise<Order[]> {
    const params = instId ? `?instId=${instId}` : '';
    return this.authRequest<Order[]>(`/api/v1/trade/orders-pending${params}`);
  }

  async getOrderHistory(
    options?: { instId?: string; ordType?: string; state?: string; after?: number; before?: number; limit?: number }
  ): Promise<Order[]> {
    const params = new URLSearchParams();
    if (options?.instId) params.append('instId', options.instId);
    if (options?.ordType) params.append('ordType', options.ordType);
    if (options?.state) params.append('state', options.state);
    if (options?.after) params.append('after', options.after.toString());
    if (options?.before) params.append('before', options.before.toString());
    if (options?.limit) params.append('limit', options.limit.toString());
    const queryString = params.toString();
    return this.authRequest<Order[]>(`/api/v1/trade/orders-history${queryString ? `?${queryString}` : ''}`);
  }

  async closePosition(instId: string, posSide?: string): Promise<ClosePositionResponse> {
    return this.authRequest<ClosePositionResponse>('/api/v1/trade/close-position', {
      method: 'POST',
      body: JSON.stringify({ instId, posSide }),
    });
  }

  // ==================
  // Referral Endpoints
  // ==================

  async getReferralInfo(address: string): Promise<ReferralInfo> {
    return this.request<ReferralInfo>(`/v1/referral/info?address=${address}`);
  }

  async getReferralRewards(
    address: string,
    options?: { after?: number; before?: number; limit?: number }
  ): Promise<ReferralReward[]> {
    const params = new URLSearchParams({ address });
    if (options?.after) params.append('after', options.after.toString());
    if (options?.before) params.append('before', options.before.toString());
    if (options?.limit) params.append('limit', options.limit.toString());
    return this.request<ReferralReward[]>(`/v1/referral/rewards?${params}`);
  }

  async claimReferralRewards(address: string): Promise<ClaimRewardsResponse> {
    return this.request<ClaimRewardsResponse>('/v1/referral/claim', {
      method: 'POST',
      body: JSON.stringify({ address }),
    });
  }
}

// ==================
// Types
// ==================

export interface AccountBalance {
  ccy: string;
  bal: string;
  availBal: string;
  frozenBal: string;
  uTime: number;
}

export interface Position {
  instId: string;
  posSide: 'long' | 'short';
  pos: string;
  avgPx: string;
  lever: string;
  margin: string;
  uPnl: string;
  pnl: string;
  liqPx: string;
  cTime: number;
  uTime: number;
}

export interface Bill {
  billId: string;
  instId: string;
  type: string;
  sz: string;
  px: string;
  pnl: string;
  fee: string;
  cTime: number;
}

export interface PlaceOrderRequest {
  address: string;
  instId: string;
  side: 'buy' | 'sell';
  posSide?: 'long' | 'short';
  ordType: 'market' | 'limit';
  sz: string;
  px?: string;
  lever?: number;
  tpTriggerPx?: string;
  slTriggerPx?: string;
}

export interface PlaceOrderResponse {
  ordId: string;
  clOrdId?: string;
  sCode: string;
  sMsg: string;
}

export interface CancelOrderResponse {
  ordId: string;
  sCode: string;
  sMsg: string;
}

export interface Order {
  ordId: string;
  instId: string;
  side: string;
  posSide: string;
  ordType: string;
  px: string;
  sz: string;
  fillSz: string;
  avgPx: string;
  state: string;
  lever: string;
  fee: string;
  pnl: string;
  cTime: number;
  uTime: number;
}

export interface ClosePositionResponse {
  instId: string;
  posSide: string;
}

export interface ReferralInfo {
  address: string;
  code: string;
  tier: number;
  rebateRate: string;
  totalInvites: number;
  activeInvites: number;
  totalEarned: string;
  pendingReward: string;
}

export interface ReferralReward {
  rewardId: string;
  fromAddress: string;
  amount: string;
  ccy: string;
  type: string;
  tradeId?: string;
  cTime: number;
}

export interface ClaimRewardsResponse {
  claimedAmount: string;
  txHash: string;
}

// Singleton instance
export const apiClient = new ApiClient();

export default apiClient;
