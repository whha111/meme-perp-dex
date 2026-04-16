"use client";

import React, { useMemo, useState, useEffect } from "react";
import { useAccount } from "wagmi";
import { formatEther, isAddress, type Address } from "viem";
import { Navbar } from "@/components/layout/Navbar";
import { useToast } from "@/components/shared/Toast";
import {
  useListingApplication,
  LeverageTier,
  ListingStatus,
  TIER_LABELS,
  STATUS_LABELS,
} from "@/hooks/perpetual/useListingApplication";

/**
 * /list-your-token — Applicant page.
 * Style: Terminal Industrial Crisp (pure black #000, lime #BFFF00 accent,
 * Inter for headings, JetBrains Mono for data/labels).
 */
export default function ListYourTokenPage() {
  const { isConnected } = useAccount();
  const { showToast } = useToast();

  const {
    submitApplication,
    withdrawProjectLP,
    listingFeeBNB,
    tierMinLP,
    myListings,
    refreshMyListings,
    isSubmitting,
    isConfirming,
    isWithdrawing,
    txHash,
    error,
    mockMode,
    isContractConfigured,
  } = useListingApplication();

  const [tokenAddr, setTokenAddr] = useState("");
  const [pairAddr, setPairAddr] = useState("");
  const [tier, setTier] = useState<LeverageTier>(LeverageTier.TIER_2X);

  const tokenAddrValid = useMemo(() => isAddress(tokenAddr), [tokenAddr]);
  const pairAddrValid = useMemo(() => isAddress(pairAddr), [pairAddr]);
  const formValid = tokenAddrValid && pairAddrValid;

  const minLPForTier = tierMinLP[tier] ?? 0n;
  const totalCost = listingFeeBNB + minLPForTier;

  // Display-friendly BNB → USD (assumes 1 BNB ≈ $600; TODO: fetch from oracle)
  const BNB_USD = 600;
  const lpUSD = Number(formatEther(minLPForTier)) * BNB_USD;
  const feeUSD = Number(formatEther(listingFeeBNB)) * BNB_USD;

  const handleSubmit = async () => {
    if (!isConnected) { showToast("Please connect your wallet first", "warning"); return; }
    if (!formValid) { showToast("Please enter valid token and pair addresses", "warning"); return; }
    try {
      await submitApplication({ token: tokenAddr as Address, pair: pairAddr as Address, tier });
      showToast("Application submitted — pending admin review", "success");
      setTokenAddr("");
      setPairAddr("");
      await refreshMyListings();
    } catch (e: any) {
      showToast(`Submit failed: ${e?.shortMessage ?? e?.message ?? "unknown"}`, "error");
    }
  };

  useEffect(() => {
    if (!isConfirming && txHash) void refreshMyListings();
  }, [isConfirming, txHash, refreshMyListings]);

  return (
    <div className="min-h-screen bg-black text-white">
      <Navbar />

      <div className="px-12 pt-10 pb-24 max-w-[1440px] mx-auto">
        {/* Page header */}
        <div className="mb-8">
          <h1 className="font-inter text-[32px] leading-tight font-semibold text-white mb-2">List Your Token</h1>
          <p className="font-mono text-[13px] text-[#999999]">
            Apply to open perpetual contract trading for any ERC-20 meme token on our platform.
          </p>
          {mockMode && (
            <div className="mt-4 p-3 bg-[#F59E0B]/10 border border-[#F59E0B]/30 font-mono text-xs text-[#F59E0B]">
              ⚡ MOCK MODE — submissions simulated locally. Flip NEXT_PUBLIC_LISTING_MOCK_MODE=false to go live.
            </div>
          )}
          {!isContractConfigured && !mockMode && (
            <div className="mt-4 p-3 bg-[#FF4444]/10 border border-[#FF4444]/30 font-mono text-xs text-[#FF4444]">
              Registry contract not configured. Set NEXT_PUBLIC_EXTERNAL_TOKEN_REGISTRY_ADDRESS.
            </div>
          )}
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* ── LEFT: form + cost ── */}
          <div className="lg:col-span-2 space-y-6">

            {/* Form card */}
            <section className="bg-[#111111] border border-[#1A1A1A] p-6 space-y-5">
              <div>
                <h2 className="font-inter text-[16px] font-semibold text-white mb-1">Application</h2>
                <p className="font-mono text-xs text-[#999999]">
                  Your token must already have a liquid PancakeSwap V2 pair against WBNB.
                </p>
              </div>

              {/* Token address */}
              <label className="block space-y-1.5">
                <span className="font-mono text-[10px] font-medium text-[#6e6e6e] tracking-wider">TOKEN ADDRESS</span>
                <input
                  type="text"
                  value={tokenAddr}
                  onChange={(e) => setTokenAddr(e.target.value.trim())}
                  placeholder="0x…"
                  className={`w-full h-10 px-3.5 bg-[#1A1A1A] border font-mono text-[13px] text-white placeholder-[#404040] focus:outline-none transition-colors ${
                    tokenAddr && !tokenAddrValid ? "border-[#FF4444]" : "border-[#1A1A1A] focus:border-[#BFFF00]"
                  }`}
                />
                {tokenAddr && !tokenAddrValid && (
                  <span className="font-mono text-[11px] text-[#FF4444]">Invalid address</span>
                )}
              </label>

              {/* Pair address */}
              <label className="block space-y-1.5">
                <span className="font-mono text-[10px] font-medium text-[#6e6e6e] tracking-wider">PANCAKESWAP V2 PAIR</span>
                <input
                  type="text"
                  value={pairAddr}
                  onChange={(e) => setPairAddr(e.target.value.trim())}
                  placeholder="0x…"
                  className={`w-full h-10 px-3.5 bg-[#1A1A1A] border font-mono text-[13px] text-white placeholder-[#404040] focus:outline-none transition-colors ${
                    pairAddr && !pairAddrValid ? "border-[#FF4444]" : "border-[#1A1A1A] focus:border-[#BFFF00]"
                  }`}
                />
                <span className="font-mono text-[11px] text-[#404040] block">
                  Find your pair at pancakeswap.finance — copy the pair contract address.
                </span>
              </label>

              {/* Tier selector */}
              <div className="space-y-2">
                <span className="font-mono text-[10px] font-medium text-[#6e6e6e] tracking-wider block">
                  MAX LEVERAGE TIER
                </span>
                <div className="grid grid-cols-5 gap-2">
                  {(
                    [
                      LeverageTier.TIER_2X,
                      LeverageTier.TIER_3X,
                      LeverageTier.TIER_5X,
                      LeverageTier.TIER_7X,
                      LeverageTier.TIER_10X,
                    ] as const
                  ).map((t) => {
                    const active = tier === t;
                    return (
                      <button
                        key={t}
                        type="button"
                        onClick={() => setTier(t)}
                        className={`flex flex-col items-center justify-center h-16 border transition-all ${
                          active
                            ? "bg-[#1A1A1A] border-2 border-[#BFFF00]"
                            : "bg-[#1A1A1A] border border-[#1A1A1A] hover:border-[#404040]"
                        }`}
                      >
                        <span className={`font-inter text-lg font-semibold ${active ? "text-[#BFFF00]" : "text-[#999999]"}`}>
                          {TIER_LABELS[t]}
                        </span>
                        <span className={`font-mono text-[10px] ${active ? "text-[#BFFF00]" : "text-[#404040]"}`}>
                          LP ${(Number(formatEther(tierMinLP[t] ?? 0n)) * BNB_USD / 1000).toFixed(0)}k
                        </span>
                      </button>
                    );
                  })}
                </div>
                <p className="font-mono text-[11px] text-[#404040] leading-relaxed">
                  Higher leverage requires more locked LP. LP is your first-loss bond and locks for 60 days.
                </p>
              </div>
            </section>

            {/* Cost summary */}
            <section className="bg-[#111111] border border-[#1A1A1A] p-6">
              <h3 className="font-inter text-[16px] font-semibold text-white mb-4">Cost Summary</h3>
              <div className="space-y-4 text-sm">
                <Row
                  label="Listing Fee"
                  sub="one-time, non-refundable"
                  valueBNB={listingFeeBNB}
                  valueUSD={feeUSD}
                />
                <Row
                  label={`LP Lock (${TIER_LABELS[tier]} tier)`}
                  sub="60-day lock · first-loss bond"
                  valueBNB={minLPForTier}
                  valueUSD={lpUSD}
                />
                <div className="h-px bg-[#1A1A1A]" />
                <div className="flex justify-between items-center pt-1">
                  <span className="font-inter text-[14px] font-semibold text-white">Total Due Now</span>
                  <div className="text-right">
                    <div className="font-inter text-[20px] font-semibold text-[#BFFF00] leading-none">
                      {Number(formatEther(totalCost)).toFixed(4)} BNB
                    </div>
                    <div className="font-mono text-[11px] text-[#6e6e6e] mt-1">
                      ≈ ${(feeUSD + lpUSD).toLocaleString()}
                    </div>
                  </div>
                </div>
              </div>

              <button
                onClick={handleSubmit}
                disabled={!formValid || isSubmitting || isConfirming || !isConnected}
                className="w-full mt-6 h-12 bg-[#BFFF00] hover:bg-[#B0EE00] text-black font-mono text-[13px] font-semibold tracking-wider disabled:opacity-30 disabled:cursor-not-allowed transition-opacity"
              >
                {!isConnected ? "CONNECT WALLET"
                  : isSubmitting ? "SUBMITTING…"
                  : isConfirming ? "CONFIRMING…"
                  : "SUBMIT APPLICATION"}
              </button>

              {error && <p className="mt-3 font-mono text-xs text-[#FF4444] break-words">{error}</p>}
            </section>
          </div>

          {/* ── RIGHT: requirements + how-it-works + my applications ── */}
          <div className="space-y-6">

            {/* Requirements */}
            <section className="bg-[#111111] border border-[#1A1A1A] p-6">
              <h3 className="font-inter text-[15px] font-semibold text-white mb-3">Before You Apply</h3>
              <ul className="space-y-3 font-mono text-[12px] text-[#999999] leading-relaxed">
                {[
                  "Token already tradable on PancakeSwap V2",
                  "Pair liquidity ≥ $50,000 (auto-delist below)",
                  "Token ownership renounced or under timelock",
                  "Not fee-on-transfer / rebase (fails validation)",
                  "LP funds available (see Cost Summary)",
                ].map((t, i) => (
                  <li key={i} className="flex gap-3 items-start">
                    <span className="shrink-0 mt-1.5 w-1.5 h-1.5 bg-[#BFFF00] rounded-[2px]" />
                    <span>{t}</span>
                  </li>
                ))}
              </ul>
            </section>

            {/* How it works */}
            <section className="bg-[#111111] border border-[#1A1A1A] p-6">
              <h3 className="font-inter text-[15px] font-semibold text-white mb-3">How It Works</h3>
              <ol className="space-y-3 font-mono text-[12px] text-[#999999] leading-relaxed">
                {[
                  "Submit application with fee + LP (escrowed in Registry)",
                  "Team reviews within 24h. Rejected: LP returned; fee retained.",
                  "On approval, perpetual trading opens. Users trade against PerpVault.",
                  "60 days later you can withdraw LP. Violations → LP slashed.",
                ].map((t, i) => (
                  <li key={i} className="flex gap-3 items-start">
                    <span className="shrink-0 font-mono font-bold text-[#BFFF00] text-[11px] w-6">
                      {String(i + 1).padStart(2, "0")}
                    </span>
                    <span>{t}</span>
                  </li>
                ))}
              </ol>
            </section>

            {/* My applications */}
            {isConnected && (
              <section className="bg-[#111111] border border-[#1A1A1A] p-6">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="font-inter text-[15px] font-semibold text-white">Your Applications</h3>
                  <button
                    onClick={() => refreshMyListings()}
                    className="font-mono text-[11px] text-[#6e6e6e] hover:text-[#BFFF00] transition-colors"
                  >
                    ↻ Refresh
                  </button>
                </div>
                {myListings.length === 0 ? (
                  <p className="font-mono text-[12px] text-[#404040]">No applications yet.</p>
                ) : (
                  <div className="space-y-3">
                    {myListings.map((l) => (
                      <ApplicationCard
                        key={l.appId}
                        listing={l}
                        isWithdrawing={isWithdrawing}
                        onWithdraw={async () => {
                          try {
                            await withdrawProjectLP(l.appId);
                            showToast("LP withdrawal submitted", "success");
                            await refreshMyListings();
                          } catch (e: any) {
                            showToast(`Withdraw failed: ${e?.shortMessage ?? e?.message ?? "unknown"}`, "error");
                          }
                        }}
                      />
                    ))}
                  </div>
                )}
              </section>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Subcomponents ─────────────────────────────────────

function Row({ label, sub, valueBNB, valueUSD }: {
  label: string; sub: string; valueBNB: bigint; valueUSD: number;
}) {
  return (
    <div className="flex justify-between items-start gap-4">
      <div className="space-y-0.5">
        <div className="font-mono text-[13px] text-[#999999]">{label}</div>
        <div className="font-mono text-[11px] text-[#404040]">{sub}</div>
      </div>
      <div className="text-right space-y-0.5">
        <div className="font-inter text-[14px] font-semibold text-white leading-none">
          {Number(formatEther(valueBNB)).toFixed(4)} BNB
        </div>
        <div className="font-mono text-[11px] text-[#404040]">
          ≈ ${valueUSD.toLocaleString()}
        </div>
      </div>
    </div>
  );
}

function ApplicationCard({
  listing: l, isWithdrawing, onWithdraw,
}: {
  listing: ReturnType<typeof useListingApplication>["myListings"][0];
  isWithdrawing: boolean;
  onWithdraw: () => void;
}) {
  const statusStyle = {
    [ListingStatus.PENDING]:  { color: "#F59E0B", label: "PENDING" },
    [ListingStatus.APPROVED]: { color: "#BFFF00", label: "LIVE" },
    [ListingStatus.REJECTED]: { color: "#FF4444", label: "REJECTED" },
    [ListingStatus.DELISTED]: { color: "#6e6e6e", label: "DELISTED" },
    [ListingStatus.SLASHED]:  { color: "#FF4444", label: "SLASHED" },
    [ListingStatus.NONE]:     { color: "#404040", label: "—" },
  }[l.status];

  const canW = l.lpAmountBNB > 0n && (
    l.status === ListingStatus.REJECTED
    || ((l.status === ListingStatus.APPROVED || l.status === ListingStatus.DELISTED)
        && Math.floor(Date.now() / 1000) >= l.lpUnlockAt)
  );

  return (
    <div className="bg-[#1A1A1A] border border-[#1A1A1A] p-3 space-y-1.5">
      <div className="flex items-center justify-between">
        <span className="font-mono text-[11px] text-[#6e6e6e]">#{String(l.appId).padStart(3, "0")}</span>
        <div className="flex items-center gap-1.5">
          <span className="w-1.5 h-1.5 rounded-[2px]" style={{ background: statusStyle.color }} />
          <span className="font-mono text-[10px] font-medium tracking-wider" style={{ color: statusStyle.color }}>
            {statusStyle.label}
          </span>
        </div>
      </div>
      <div className="font-mono text-[12px] text-white">
        {l.token.slice(0, 10)}…{l.token.slice(-4)}
      </div>
      <div className="flex justify-between font-mono text-[11px] text-[#6e6e6e]">
        <span>LP {Number(formatEther(l.lpAmountBNB)).toFixed(2)} BNB · {TIER_LABELS[l.tier]}</span>
        <span>
          {l.status === ListingStatus.APPROVED || l.status === ListingStatus.DELISTED
            ? `Unlocks ${new Date(l.lpUnlockAt * 1000).toLocaleDateString()}`
            : l.status === ListingStatus.PENDING
              ? "Awaiting review"
              : ""}
        </span>
      </div>
      {canW && (
        <button
          onClick={onWithdraw}
          disabled={isWithdrawing}
          className="w-full mt-1 h-8 border border-[#BFFF00] text-[#BFFF00] hover:bg-[#BFFF00] hover:text-black font-mono text-[11px] font-semibold tracking-wider disabled:opacity-50 transition-colors"
        >
          {isWithdrawing ? "WITHDRAWING…" : "WITHDRAW LP"}
        </button>
      )}
    </div>
  );
}
