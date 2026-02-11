/**
 * REST API 客户端 (未对接版本)
 *
 * 接口保留，返回空数据
 * TODO: 对接真实后端 API
 */

// ============================================================
// Types (保留所有类型定义)
// ============================================================

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

// ============================================================
// ApiClient (未对接 - 返回空数据)
// ============================================================

class ApiClient {
  private baseUrl: string;

  constructor(baseUrl?: string) {
    this.baseUrl = baseUrl || process.env.NEXT_PUBLIC_MATCHING_ENGINE_URL || process.env.NEXT_PUBLIC_API_URL || "http://localhost:8081";
  }

  // ==================
  // Public Endpoints
  // ==================

  async getInstruments(_instType?: string): Promise<Instrument[]> {
    // TODO: 对接真实 API
    return [];
  }

  async getServerTime(): Promise<{ ts: number }> {
    return { ts: Date.now() };
  }

  // ==================
  // Market Endpoints
  // ==================

  async getTicker(_instId: string): Promise<Ticker[]> {
    // TODO: 对接真实 API
    return [];
  }

  async getTickers(): Promise<Ticker[]> {
    try {
      const res = await fetch(`${this.baseUrl}/api/v1/market/tickers`);
      if (!res.ok) return [];
      const json = await res.json();
      if (json.code === "0" && Array.isArray(json.data)) {
        return json.data;
      }
      return [];
    } catch {
      return [];
    }
  }

  async getCandles(
    _instId: string,
    _bar: string = "1m",
    _options?: { after?: number; before?: number; limit?: number }
  ): Promise<string[][]> {
    // TODO: 对接真实 API
    return [];
  }

  async getOrderBook(_instId: string): Promise<{
    asks: [string, string, string, string][];
    bids: [string, string, string, string][];
    ts: number;
  }> {
    // TODO: 对接真实 API
    return {
      asks: [],
      bids: [],
      ts: Date.now(),
    };
  }

  async getTrades(_instId: string, _limit: number = 100): Promise<Trade[]> {
    // TODO: 对接真实 API
    return [];
  }

  async getMarkPrice(_instId?: string): Promise<MarkPrice[]> {
    // TODO: 对接真实 API
    return [];
  }

  async getFundingRate(_instId: string): Promise<FundingRate[]> {
    // TODO: 对接真实 API
    return [];
  }

  // ==================
  // Health Check
  // ==================

  async healthCheck(): Promise<{ status: string }> {
    // TODO: 对接真实 API
    return { status: "not_connected" };
  }

  // ==================
  // Referral Endpoints
  // ==================

  async getReferralInfo(_address: string): Promise<ReferralInfo> {
    // TODO: 对接真实 API
    return {
      address: "",
      code: "",
      tier: 0,
      rebateRate: "0",
      totalInvites: 0,
      activeInvites: 0,
      totalEarned: "0",
      pendingReward: "0",
    };
  }

  async getReferralRewards(
    _address: string,
    _options?: { after?: number; before?: number; limit?: number }
  ): Promise<ReferralReward[]> {
    // TODO: 对接真实 API
    return [];
  }

  async claimReferralRewards(_address: string): Promise<ClaimRewardsResponse> {
    // TODO: 对接真实 API
    throw new Error("API 未对接");
  }
}

// Singleton instance
export const apiClient = new ApiClient();

export default apiClient;
