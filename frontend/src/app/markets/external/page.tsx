"use client";

import React, { useMemo, useState } from "react";
import Link from "next/link";
import { Navbar } from "@/components/layout/Navbar";
import { useExternalMarkets, type ExternalMarket } from "@/hooks/perpetual/useExternalMarkets";

type SortKey = "volume" | "liquidity" | "leverage" | "newest";

const BNB_USD = 600; // TODO: replace with oracle feed

/**
 * /markets/external — Public catalog of APPROVED external-listed meme perps.
 * Data sources:
 *   - Listing metadata: ExternalTokenRegistry.getActiveListings + getListing
 *   - Mark price:       PancakeSwap V2 pair reserves
 *   - Volume / OI:      placeholder until engine API ships
 */
export default function ExternalMarketsPage() {
  const { markets, totalLpLockedBNB, loading, error, refresh, mockMode } = useExternalMarkets();
  const [sort, setSort] = useState<SortKey>("liquidity");

  const sorted = useMemo(() => {
    const arr = [...markets];
    switch (sort) {
      case "volume":
        arr.sort((a, b) => (b.volume24hUSD ?? 0) - (a.volume24hUSD ?? 0));
        break;
      case "liquidity":
        arr.sort((a, b) => b.pairBNBReserve - a.pairBNBReserve);
        break;
      case "leverage":
        arr.sort((a, b) => b.maxLeverage - a.maxLeverage);
        break;
      case "newest":
        arr.sort((a, b) => b.appId - a.appId);
        break;
    }
    return arr;
  }, [markets, sort]);

  const aggregateVolumeUSD = useMemo(
    () => markets.reduce((s, m) => s + (m.volume24hUSD ?? 0), 0),
    [markets]
  );

  return (
    <div className="min-h-screen bg-black text-white">
      <Navbar />
      <div className="px-12 pt-10 pb-24 max-w-[1440px] mx-auto">

        {/* Header */}
        <div className="mb-8">
          <h1 className="font-inter text-[32px] leading-tight font-semibold text-white mb-2">
            External Markets
          </h1>
          <p className="font-mono text-[13px] text-[#999999]">
            Perpetual contracts on third-party tokens, backed by project-team LP bonds.
          </p>
          {mockMode && (
            <div className="mt-3 p-3 bg-[#F59E0B]/10 border border-[#F59E0B]/30 font-mono text-xs text-[#F59E0B]">
              ⚡ MOCK MODE — data synthesized from browser storage.
            </div>
          )}
          {error && (
            <div className="mt-3 p-3 bg-[#FF4444]/10 border border-[#FF4444]/30 font-mono text-xs text-[#FF4444]">
              {error}
            </div>
          )}
        </div>

        {/* Metric cards */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
          <MetricCard
            label="LIVE MARKETS"
            value={loading ? "—" : String(markets.length)}
            change={markets.length > 0 ? `${markets.length} listed` : "No markets yet"}
            tone="neutral"
          />
          <MetricCard
            label="24H VOLUME"
            value={aggregateVolumeUSD > 0 ? `$${formatShort(aggregateVolumeUSD)}` : "—"}
            change={aggregateVolumeUSD > 0 ? "Live data" : "Engine API pending"}
            tone="lime"
          />
          <MetricCard
            label="TOTAL LP LOCKED"
            value={totalLpLockedBNB > 0
              ? `$${formatShort(totalLpLockedBNB * BNB_USD)}`
              : "—"}
            change={totalLpLockedBNB > 0 ? `${totalLpLockedBNB.toFixed(2)} BNB` : "No bonds yet"}
            tone="neutral"
          />
          <MetricCard
            label="LISTING FEE"
            value="$500"
            change="One-time, non-refundable"
            tone="neutral"
          />
        </div>

        {/* Sort row */}
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-inter text-[18px] font-semibold text-white">All Live Markets</h2>
          <div className="flex items-center gap-2">
            <span className="font-mono text-[12px] text-[#6e6e6e]">Sort:</span>
            <select
              value={sort}
              onChange={(e) => setSort(e.target.value as SortKey)}
              className="bg-[#111111] border border-[#1A1A1A] px-3 py-1.5 font-mono text-[12px] text-white focus:outline-none focus:border-[#BFFF00]"
            >
              <option value="liquidity">Liquidity ↓</option>
              <option value="volume">24h Volume ↓</option>
              <option value="leverage">Max Leverage ↓</option>
              <option value="newest">Newest First</option>
            </select>
            <button
              onClick={() => refresh()}
              className="px-3 py-1.5 font-mono text-[11px] text-[#6e6e6e] border border-[#1A1A1A] hover:text-[#BFFF00] hover:border-[#BFFF00] transition-colors"
            >
              ↻
            </button>
          </div>
        </div>

        {/* Markets grid */}
        {loading ? (
          <div className="bg-[#111111] border border-[#1A1A1A] p-12 text-center font-mono text-[13px] text-[#6e6e6e]">
            Loading markets…
          </div>
        ) : sorted.length === 0 ? (
          <div className="bg-[#111111] border border-[#1A1A1A] p-12 text-center font-mono text-[13px] text-[#6e6e6e]">
            No approved external listings yet.{" "}
            <Link href="/list-your-token" className="text-[#BFFF00] hover:underline">
              List your token →
            </Link>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {sorted.map((m) => (
              <MarketCard key={m.appId} market={m} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Sub-components ──────────────────────────────

function MetricCard({ label, value, change, tone }: {
  label: string; value: string; change: string; tone: "lime" | "neutral" | "error";
}) {
  const changeColor =
    tone === "lime" ? "text-[#BFFF00]" :
    tone === "error" ? "text-[#FF4444]" :
    "text-[#6e6e6e]";
  return (
    <div className="bg-[#111111] border border-[#1A1A1A] p-6 space-y-2.5">
      <div className="font-mono text-[10px] font-medium text-[#6e6e6e] tracking-wider">
        {label}
      </div>
      <div className="font-inter text-[32px] font-semibold text-white leading-none">
        {value}
      </div>
      <div className={`font-mono text-[11px] ${changeColor}`}>{change}</div>
    </div>
  );
}

function MarketCard({ market: m }: { market: ExternalMarket }) {
  const priceUSD = m.markPriceBNB * BNB_USD;
  const volume = m.volume24hUSD;
  const oi = m.openInterestUSD;
  return (
    <div className="bg-[#111111] border border-[#1A1A1A] p-5 space-y-4 hover:border-[#BFFF00] transition-colors">
      {/* Header: symbol + leverage badge */}
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-1 min-w-0">
          <div className="font-inter text-[18px] font-semibold text-white truncate">
            {m.symbol}/BNB
          </div>
          <div className="font-mono text-[11px] text-[#6e6e6e] truncate">
            {m.token.slice(0, 10)}…{m.token.slice(-4)}
          </div>
        </div>
        <div className="shrink-0 px-2 py-1 bg-[#BFFF00]/10 border border-[#BFFF00] font-mono text-[10px] font-bold text-[#BFFF00] tracking-wider">
          {m.maxLeverage}x
        </div>
      </div>

      {/* Mark price */}
      <div className="space-y-1">
        <div className="font-mono text-[10px] font-medium text-[#6e6e6e] tracking-wider">
          MARK PRICE
        </div>
        <div className="font-inter text-[24px] font-semibold text-white leading-none">
          ${formatPrice(priceUSD)}
        </div>
        <div className="font-mono text-[11px] text-[#6e6e6e]">
          {m.markPriceBNB.toExponential(3)} BNB · via Pancake V2
        </div>
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-3 gap-3">
        <Stat label="24H VOL" value={volume !== undefined ? `$${formatShort(volume)}` : "—"} />
        <Stat label="OPEN INT" value={oi !== undefined ? `$${formatShort(oi)}` : "—"} />
        <Stat label="LP BOND" value={`$${formatShort(m.lpBondBNB * BNB_USD)}`} />
      </div>

      {/* Trade CTA */}
      <Link
        href={`/trade/${m.token}`}
        className="block w-full h-10 bg-[#BFFF00] hover:bg-[#B0EE00] text-black font-mono text-[12px] font-semibold tracking-wider flex items-center justify-center transition-colors"
      >
        TRADE →
      </Link>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="space-y-1">
      <div className="font-mono text-[10px] text-[#6e6e6e] tracking-wider">{label}</div>
      <div className="font-mono text-[13px] font-medium text-white">{value}</div>
    </div>
  );
}

// ─── Helpers ─────────────────────────────────────

/** 1_234_567 → "1.23M"; 999 → "999" */
function formatShort(n: number): string {
  if (!Number.isFinite(n) || n < 0) return "—";
  if (n >= 1e9) return `${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(2)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}k`;
  return n.toFixed(0);
}

/** Sub-cent prices get scientific notation; otherwise 4-6 sig digs */
function formatPrice(usd: number): string {
  if (!Number.isFinite(usd) || usd <= 0) return "0";
  if (usd < 0.0001) return usd.toExponential(3);
  if (usd < 1) return usd.toFixed(7);
  if (usd < 1000) return usd.toFixed(3);
  return usd.toLocaleString(undefined, { maximumFractionDigits: 2 });
}
