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
  STATUS_COLORS,
} from "@/hooks/perpetual/useListingApplication";

/**
 * "List Your Token" — external token listing application page.
 *
 * Layout (mirrors /create):
 *   Left column: input form (token, pair, tier select) + cost summary + submit button
 *   Right column: requirements + FAQ + user's existing applications
 */
export default function ListYourTokenPage() {
  const { isConnected, address } = useAccount();
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

  // Display-friendly LP → USD estimate (assumes 1 BNB ≈ $600; real app would fetch price)
  const BNB_USD_PRICE_ESTIMATE = 600;
  const lpUsdEstimate = Number(formatEther(minLPForTier)) * BNB_USD_PRICE_ESTIMATE;
  const feeUsdEstimate = Number(formatEther(listingFeeBNB)) * BNB_USD_PRICE_ESTIMATE;

  const handleSubmit = async () => {
    if (!isConnected) {
      showToast("Please connect your wallet first", "warning");
      return;
    }
    if (!formValid) {
      showToast("Please enter valid token and pair addresses", "warning");
      return;
    }
    try {
      await submitApplication({
        token: tokenAddr as Address,
        pair: pairAddr as Address,
        tier,
      });
      showToast("Application submitted — pending admin review", "success");
      setTokenAddr("");
      setPairAddr("");
      await refreshMyListings();
    } catch (e: any) {
      showToast(`Submit failed: ${e?.shortMessage ?? e?.message ?? "unknown"}`, "error");
    }
  };

  // After tx confirmed, refresh list
  useEffect(() => {
    if (!isConfirming && txHash) {
      void refreshMyListings();
    }
  }, [isConfirming, txHash, refreshMyListings]);

  return (
    <div className="min-h-screen bg-okx-bg-primary">
      <Navbar />

      <div className="px-6 sm:px-12 pt-10 pb-24 max-w-[1400px] mx-auto">
        {/* Page header */}
        <div className="mb-8">
          <h1 className="text-3xl sm:text-4xl font-bold text-okx-text-primary mb-2">
            List Your Token
          </h1>
          <p className="text-okx-text-secondary">
            Apply to open perpetual contract trading for any ERC-20 meme token on our platform.
          </p>
          {mockMode && (
            <div className="mt-4 p-3 bg-yellow-500/10 border border-yellow-500/30 rounded-md text-yellow-300 text-sm">
              ⚡ <strong>Mock mode active</strong> — submissions are simulated locally and do not
              hit the chain. Flip <code>NEXT_PUBLIC_LISTING_MOCK_MODE=false</code> to go live.
            </div>
          )}
          {!isContractConfigured && !mockMode && (
            <div className="mt-4 p-3 bg-red-500/10 border border-red-500/30 rounded-md text-red-300 text-sm">
              Registry contract address not configured. Set
              <code className="mx-1">NEXT_PUBLIC_EXTERNAL_TOKEN_REGISTRY_ADDRESS</code> in
              environment.
            </div>
          )}
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* ── LEFT: Application form ── */}
          <div className="lg:col-span-2 space-y-6">
            {/* Token + Pair form card */}
            <section className="bg-okx-bg-card border border-okx-border-primary rounded-lg p-6 space-y-6">
              <div>
                <h2 className="text-lg font-semibold text-okx-text-primary mb-1">Application</h2>
                <p className="text-sm text-okx-text-secondary">
                  Your token must already have a liquid PancakeSwap V2 pair against WBNB.
                </p>
              </div>

              <label className="block">
                <span className="text-sm text-okx-text-secondary mb-1 block">Token Address</span>
                <input
                  type="text"
                  value={tokenAddr}
                  onChange={(e) => setTokenAddr(e.target.value.trim())}
                  placeholder="0x…"
                  className={`w-full px-3 py-2 bg-okx-bg-secondary border rounded-md text-okx-text-primary placeholder-okx-text-tertiary font-mono text-sm focus:outline-none transition-colors ${
                    tokenAddr && !tokenAddrValid
                      ? "border-red-400"
                      : "border-okx-border-primary focus:border-meme-lime"
                  }`}
                />
                {tokenAddr && !tokenAddrValid && (
                  <span className="text-xs text-red-400 mt-1 block">Invalid address</span>
                )}
              </label>

              <label className="block">
                <span className="text-sm text-okx-text-secondary mb-1 block">
                  PancakeSwap V2 Pair Address (token ↔ WBNB)
                </span>
                <input
                  type="text"
                  value={pairAddr}
                  onChange={(e) => setPairAddr(e.target.value.trim())}
                  placeholder="0x…"
                  className={`w-full px-3 py-2 bg-okx-bg-secondary border rounded-md text-okx-text-primary placeholder-okx-text-tertiary font-mono text-sm focus:outline-none transition-colors ${
                    pairAddr && !pairAddrValid
                      ? "border-red-400"
                      : "border-okx-border-primary focus:border-meme-lime"
                  }`}
                />
                {pairAddr && !pairAddrValid && (
                  <span className="text-xs text-red-400 mt-1 block">Invalid address</span>
                )}
                <span className="text-xs text-okx-text-tertiary mt-1 block">
                  Find your pair at pancakeswap.finance — copy the pair contract address.
                </span>
              </label>

              {/* Tier selector */}
              <div>
                <span className="text-sm text-okx-text-secondary mb-2 block">
                  Max Leverage Tier
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
                  ).map((t) => (
                    <button
                      key={t}
                      type="button"
                      onClick={() => setTier(t)}
                      className={`px-3 py-3 rounded-md border text-sm font-medium transition-all ${
                        tier === t
                          ? "bg-okx-bg-hover border-meme-lime text-meme-lime"
                          : "bg-okx-bg-secondary border-okx-border-primary text-okx-text-secondary hover:border-okx-text-tertiary"
                      }`}
                    >
                      <div className="text-lg font-bold">{TIER_LABELS[t]}</div>
                      <div className="text-xs opacity-70">
                        LP&nbsp;≈&nbsp;${(Number(formatEther(tierMinLP[t] ?? 0n)) * BNB_USD_PRICE_ESTIMATE / 1000).toFixed(0)}k
                      </div>
                    </button>
                  ))}
                </div>
                <p className="text-xs text-okx-text-tertiary mt-2">
                  Higher leverage requires more locked LP. LP is your first-loss bond and locks for
                  60 days.
                </p>
              </div>
            </section>

            {/* Cost summary card */}
            <section className="bg-okx-bg-card border border-okx-border-primary rounded-lg p-6">
              <h3 className="text-lg font-semibold text-okx-text-primary mb-4">Cost Summary</h3>
              <div className="space-y-3 text-sm">
                <Row
                  label="Listing Fee (one-time, non-refundable)"
                  valueBNB={listingFeeBNB}
                  valueUSD={feeUsdEstimate}
                />
                <Row
                  label={`LP Lock (${TIER_LABELS[tier]} tier, 60-day lock)`}
                  valueBNB={minLPForTier}
                  valueUSD={lpUsdEstimate}
                />
                <div className="h-px bg-okx-border-primary my-2" />
                <div className="flex justify-between items-center pt-1">
                  <span className="font-medium text-okx-text-primary">Total Due Now</span>
                  <div className="text-right">
                    <div className="font-semibold text-okx-text-primary">
                      {Number(formatEther(totalCost)).toFixed(4)} BNB
                    </div>
                    <div className="text-xs text-okx-text-tertiary">
                      ≈ ${(feeUsdEstimate + lpUsdEstimate).toLocaleString()}
                    </div>
                  </div>
                </div>
              </div>

              <button
                onClick={handleSubmit}
                disabled={!formValid || isSubmitting || isConfirming || !isConnected}
                className="w-full mt-6 py-3 bg-meme-lime text-black font-semibold rounded-md hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed transition-opacity"
              >
                {!isConnected
                  ? "Connect Wallet"
                  : isSubmitting
                  ? "Submitting…"
                  : isConfirming
                  ? "Confirming…"
                  : "Submit Application"}
              </button>

              {error && (
                <p className="mt-3 text-sm text-red-400 break-words">{error}</p>
              )}
            </section>
          </div>

          {/* ── RIGHT: Requirements + my applications ── */}
          <div className="space-y-6">
            {/* Requirements */}
            <section className="bg-okx-bg-card border border-okx-border-primary rounded-lg p-6">
              <h3 className="text-base font-semibold text-okx-text-primary mb-3">
                Before You Apply
              </h3>
              <ul className="space-y-3 text-sm text-okx-text-secondary">
                <li className="flex gap-2">
                  <span className="text-meme-lime mt-0.5">✓</span>
                  <span>Token already deployed and tradable on PancakeSwap V2</span>
                </li>
                <li className="flex gap-2">
                  <span className="text-meme-lime mt-0.5">✓</span>
                  <span>Pair liquidity <strong>≥ $50,000</strong> (auto-delist below this)</span>
                </li>
                <li className="flex gap-2">
                  <span className="text-meme-lime mt-0.5">✓</span>
                  <span>Token contract ownership renounced or under timelock</span>
                </li>
                <li className="flex gap-2">
                  <span className="text-meme-lime mt-0.5">✓</span>
                  <span>Not fee-on-transfer / rebase (fails validation)</span>
                </li>
                <li className="flex gap-2">
                  <span className="text-meme-lime mt-0.5">✓</span>
                  <span>LP funds available in your wallet (see Cost Summary)</span>
                </li>
              </ul>
            </section>

            {/* How it works */}
            <section className="bg-okx-bg-card border border-okx-border-primary rounded-lg p-6">
              <h3 className="text-base font-semibold text-okx-text-primary mb-3">How it works</h3>
              <ol className="space-y-3 text-sm text-okx-text-secondary list-decimal list-inside">
                <li>
                  Submit application with fee + LP (escrowed in the Registry contract).
                </li>
                <li>
                  Our team reviews within <strong>24 hours</strong>. Rejected: LP returned; fee is
                  retained.
                </li>
                <li>
                  On approval, perpetual trading opens for your token. Users trade against our
                  PerpVault.
                </li>
                <li>
                  60 days later you can <strong>withdraw your LP</strong>. Violations
                  (rugs, malicious contracts) may result in LP slashing.
                </li>
              </ol>
            </section>

            {/* User's applications */}
            {isConnected && (
              <section className="bg-okx-bg-card border border-okx-border-primary rounded-lg p-6">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-base font-semibold text-okx-text-primary">
                    Your Applications
                  </h3>
                  <button
                    onClick={() => refreshMyListings()}
                    className="text-xs text-okx-text-tertiary hover:text-meme-lime"
                  >
                    Refresh
                  </button>
                </div>
                {myListings.length === 0 ? (
                  <p className="text-sm text-okx-text-tertiary">No applications yet.</p>
                ) : (
                  <div className="space-y-3">
                    {myListings.map((l) => (
                      <div
                        key={l.appId}
                        className="bg-okx-bg-secondary border border-okx-border-primary rounded p-3 text-sm"
                      >
                        <div className="flex items-center justify-between mb-1">
                          <span className="font-mono text-xs text-okx-text-tertiary">
                            #{l.appId}
                          </span>
                          <span className={`text-xs font-medium ${STATUS_COLORS[l.status]}`}>
                            {STATUS_LABELS[l.status]}
                          </span>
                        </div>
                        <div className="text-okx-text-primary font-mono text-xs break-all mb-1">
                          {l.token.slice(0, 10)}…{l.token.slice(-6)}
                        </div>
                        <div className="text-xs text-okx-text-tertiary flex justify-between">
                          <span>
                            LP {Number(formatEther(l.lpAmountBNB)).toFixed(2)} BNB · {TIER_LABELS[l.tier]}
                          </span>
                          <span>
                            {l.status === ListingStatus.APPROVED || l.status === ListingStatus.DELISTED
                              ? `Unlocks ${formatUnlockDate(l.lpUnlockAt)}`
                              : ""}
                          </span>
                        </div>
                        {canWithdraw(l) && (
                          <button
                            onClick={async () => {
                              try {
                                await withdrawProjectLP(l.appId);
                                showToast("LP withdrawal submitted", "success");
                                await refreshMyListings();
                              } catch (e: any) {
                                showToast(
                                  `Withdraw failed: ${e?.shortMessage ?? e?.message ?? "unknown"}`,
                                  "error"
                                );
                              }
                            }}
                            disabled={isWithdrawing}
                            className="w-full mt-2 py-1.5 bg-okx-bg-hover border border-meme-lime text-meme-lime text-xs rounded hover:bg-meme-lime hover:text-black transition-colors disabled:opacity-50"
                          >
                            {isWithdrawing ? "Withdrawing…" : "Withdraw LP"}
                          </button>
                        )}
                      </div>
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

// ─── Helpers ───────────────────────────────────────────────────

function Row({
  label,
  valueBNB,
  valueUSD,
}: {
  label: string;
  valueBNB: bigint;
  valueUSD: number;
}) {
  return (
    <div className="flex justify-between items-start gap-4">
      <span className="text-okx-text-secondary">{label}</span>
      <div className="text-right shrink-0">
        <div className="text-okx-text-primary">
          {Number(formatEther(valueBNB)).toFixed(4)} BNB
        </div>
        <div className="text-xs text-okx-text-tertiary">
          ≈ ${valueUSD.toLocaleString()}
        </div>
      </div>
    </div>
  );
}

function canWithdraw(l: { status: ListingStatus; lpAmountBNB: bigint; lpUnlockAt: number }) {
  if (l.lpAmountBNB === 0n) return false;
  if (l.status === ListingStatus.REJECTED) return true;
  if (l.status === ListingStatus.APPROVED || l.status === ListingStatus.DELISTED) {
    return Math.floor(Date.now() / 1000) >= l.lpUnlockAt;
  }
  return false;
}

function formatUnlockDate(unixSec: number): string {
  if (!unixSec) return "—";
  return new Date(unixSec * 1000).toLocaleDateString();
}
