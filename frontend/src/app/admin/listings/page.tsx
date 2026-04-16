"use client";

import React, { useMemo, useState } from "react";
import { formatEther } from "viem";
import { Navbar } from "@/components/layout/Navbar";
import { useToast } from "@/components/shared/Toast";
import { useAccount } from "wagmi";
import { useListingAdmin } from "@/hooks/perpetual/useListingAdmin";
import {
  Listing,
  LeverageTier,
  ListingStatus,
  TIER_LABELS,
  STATUS_LABELS,
} from "@/hooks/perpetual/useListingApplication";

type Tab = "pending" | "live" | "all";

/**
 * /admin/listings — Moderation panel.
 * Style: Terminal Industrial Crisp (pure black #000, 2px lime left-border
 * on active/selected, JetBrains Mono for data, Inter for headings).
 */
export default function AdminListingsPage() {
  const { isConnected } = useAccount();
  const { showToast } = useToast();

  const {
    allListings,
    pending,
    approved,
    isAdmin,
    approve,
    reject,
    delist,
    slash,
    isActing,
    isConfirming,
    error,
    refresh,
    mockMode,
    isContractConfigured,
  } = useListingAdmin();

  const [tab, setTab] = useState<Tab>("pending");
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [reason, setReason] = useState("");

  const visible = useMemo(() => {
    if (tab === "pending") return pending;
    if (tab === "live") return approved;
    return allListings;
  }, [tab, pending, approved, allListings]);

  const selected = useMemo(
    () => (selectedId !== null ? allListings.find((l) => l.appId === selectedId) : undefined),
    [selectedId, allListings]
  );

  const handleAction = async (fn: () => Promise<void>, label: string) => {
    try {
      await fn();
      showToast(`${label} submitted`, "success");
      setReason("");
      await refresh();
    } catch (e: any) {
      showToast(`${label} failed: ${e?.shortMessage ?? e?.message ?? "unknown"}`, "error");
    }
  };

  return (
    <div className="min-h-screen bg-black text-white">
      <Navbar />

      <div className="px-12 pt-10 pb-24 max-w-[1600px] mx-auto">
        {/* Header */}
        <div className="mb-6">
          <h1 className="font-inter text-[32px] leading-tight font-semibold text-white mb-2">Listing Moderation</h1>
          <p className="font-mono text-[13px] text-[#999999]">
            Review external token listing applications. Admin role required.
          </p>
          {mockMode && (
            <div className="mt-3 p-3 bg-[#F59E0B]/10 border border-[#F59E0B]/30 font-mono text-xs text-[#F59E0B]">
              ⚡ MOCK MODE — all applications simulated from browser storage.
            </div>
          )}
          {!mockMode && isConnected && isAdmin === false && (
            <div className="mt-3 p-3 bg-[#FF4444]/10 border border-[#FF4444]/30 font-mono text-xs text-[#FF4444]">
              You are not the admin for this registry. Actions will revert.
            </div>
          )}
          {!isContractConfigured && !mockMode && (
            <div className="mt-3 p-3 bg-[#FF4444]/10 border border-[#FF4444]/30 font-mono text-xs text-[#FF4444]">
              Registry contract not configured.
            </div>
          )}
        </div>

        {/* Tabs + refresh */}
        <div className="flex items-center justify-between mb-4">
          <div className="flex gap-2">
            {(
              [
                { id: "pending", label: `Pending (${pending.length})` },
                { id: "live", label: `Live (${approved.length})` },
                { id: "all", label: `All (${allListings.length})` },
              ] as const
            ).map((t) => {
              const active = tab === t.id;
              return (
                <button
                  key={t.id}
                  onClick={() => { setTab(t.id); setSelectedId(null); }}
                  className={`px-4 py-2 font-mono text-[13px] font-medium border transition-colors ${
                    active
                      ? "bg-[#1A1A1A] border border-l-2 border-l-[#BFFF00] border-[#1A1A1A] text-[#BFFF00]"
                      : "bg-[#111111] border border-[#1A1A1A] text-[#999999] hover:text-white"
                  }`}
                >
                  {t.label}
                </button>
              );
            })}
          </div>

          <button
            onClick={() => refresh()}
            className="px-3 py-2 font-mono text-[11px] text-[#6e6e6e] border border-[#1A1A1A] hover:text-[#BFFF00] hover:border-[#BFFF00] transition-colors"
          >
            ↻ Refresh
          </button>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          {/* ── LEFT: Table ── */}
          <div className="lg:col-span-2 bg-[#111111] border border-[#1A1A1A] overflow-hidden">
            {visible.length === 0 ? (
              <div className="p-8 text-center font-mono text-[13px] text-[#404040]">
                No listings in this view.
              </div>
            ) : (
              <>
                {/* Table header */}
                <div className="grid grid-cols-[60px_1fr_70px_120px_140px_120px] items-center h-10 px-4 gap-4 bg-[#1A1A1A] border-b border-[#1A1A1A]">
                  <span className="font-mono text-[10px] font-medium text-[#6e6e6e] tracking-wider">#</span>
                  <span className="font-mono text-[10px] font-medium text-[#6e6e6e] tracking-wider">TOKEN</span>
                  <span className="font-mono text-[10px] font-medium text-[#6e6e6e] tracking-wider">TIER</span>
                  <span className="font-mono text-[10px] font-medium text-[#6e6e6e] tracking-wider">LP</span>
                  <span className="font-mono text-[10px] font-medium text-[#6e6e6e] tracking-wider">APPLIED</span>
                  <span className="font-mono text-[10px] font-medium text-[#6e6e6e] tracking-wider">STATUS</span>
                </div>

                {/* Rows */}
                {visible.map((l) => {
                  const isSelected = selectedId === l.appId;
                  return (
                    <div
                      key={l.appId}
                      onClick={() => setSelectedId(l.appId)}
                      className={`grid grid-cols-[60px_1fr_70px_120px_140px_120px] items-center h-[52px] px-4 gap-4 border-b border-[#1A1A1A] cursor-pointer transition-colors ${
                        isSelected
                          ? "bg-[#1A1A1A] border-l-2 border-l-[#BFFF00]"
                          : "hover:bg-[#1A1A1A]"
                      }`}
                    >
                      <span className="font-mono text-[12px] text-[#6e6e6e]">
                        #{String(l.appId).padStart(3, "0")}
                      </span>
                      <span className="font-mono text-[12px] text-white">
                        {l.token.slice(0, 10)}…{l.token.slice(-4)}
                      </span>
                      <span className="font-mono text-[12px] text-white">{TIER_LABELS[l.tier]}</span>
                      <span className="font-mono text-[12px] text-white">
                        {Number(formatEther(l.lpAmountBNB)).toFixed(2)} BNB
                      </span>
                      <span className="font-mono text-[11px] text-[#6e6e6e]">
                        {formatTime(l.appliedAt)}
                      </span>
                      <StatusBadge status={l.status} />
                    </div>
                  );
                })}
              </>
            )}
          </div>

          {/* ── RIGHT: Detail drawer ── */}
          <div className="bg-[#111111] border border-[#1A1A1A] p-6">
            {!selected ? (
              <div className="text-center font-mono text-[13px] text-[#404040] py-12">
                Select a listing to view details.
              </div>
            ) : (
              <DetailPane
                listing={selected}
                reason={reason}
                onReasonChange={setReason}
                disabled={isActing || isConfirming || isAdmin === false}
                onApprove={() => handleAction(() => approve(selected.appId), `Approve #${selected.appId}`)}
                onReject={() => handleAction(() => reject(selected.appId, reason || "rejected"), `Reject #${selected.appId}`)}
                onDelist={() => handleAction(() => delist(selected.appId, reason || "delisted"), `Delist #${selected.appId}`)}
                onSlash={() => handleAction(() => slash(selected.appId, reason || "slashed"), `Slash #${selected.appId}`)}
              />
            )}
            {error && <p className="mt-3 font-mono text-xs text-[#FF4444] break-words">{error}</p>}
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Sub-components ───────────────────────────────

function StatusBadge({ status }: { status: ListingStatus }) {
  const s = {
    [ListingStatus.PENDING]:  { color: "#F59E0B", label: "PENDING" },
    [ListingStatus.APPROVED]: { color: "#BFFF00", label: "LIVE" },
    [ListingStatus.REJECTED]: { color: "#FF4444", label: "REJECTED" },
    [ListingStatus.DELISTED]: { color: "#6e6e6e", label: "DELISTED" },
    [ListingStatus.SLASHED]:  { color: "#FF4444", label: "SLASHED" },
    [ListingStatus.NONE]:     { color: "#404040", label: "—" },
  }[status];
  return (
    <div className="flex items-center gap-1.5">
      <span className="w-1.5 h-1.5 rounded-[2px]" style={{ background: s.color }} />
      <span className="font-mono text-[10px] font-medium tracking-wider" style={{ color: s.color }}>
        {s.label}
      </span>
    </div>
  );
}

function DetailPane({
  listing: l, reason, onReasonChange, disabled,
  onApprove, onReject, onDelist, onSlash,
}: {
  listing: Listing;
  reason: string;
  onReasonChange: (v: string) => void;
  disabled: boolean;
  onApprove: () => void;
  onReject: () => void;
  onDelist: () => void;
  onSlash: () => void;
}) {
  const canApprove = l.status === ListingStatus.PENDING;
  const canReject  = l.status === ListingStatus.PENDING;
  const canDelist  = l.status === ListingStatus.APPROVED;
  const canSlash   = [ListingStatus.PENDING, ListingStatus.APPROVED, ListingStatus.DELISTED].includes(l.status);

  return (
    <div className="space-y-4">
      {/* Title + status */}
      <div className="flex items-center justify-between">
        <h3 className="font-inter text-[17px] font-semibold text-white">
          Application #{String(l.appId).padStart(3, "0")}
        </h3>
        <StatusBadge status={l.status} />
      </div>

      {/* Fields */}
      <div className="space-y-2.5 pt-2">
        <Field label="Token" value={`${l.token.slice(0, 10)}…${l.token.slice(-4)}`} full={l.token} />
        <Field label="Pair" value={`${l.pair.slice(0, 10)}…${l.pair.slice(-4)}`} full={l.pair} />
        <Field label="Project Team" value={`${l.projectTeam.slice(0, 10)}…${l.projectTeam.slice(-4)}`} full={l.projectTeam} />
        <Field label="Tier" value={TIER_LABELS[l.tier]} lime />
        <Field label="LP Amount" value={`${Number(formatEther(l.lpAmountBNB)).toFixed(4)} BNB`} />
        <Field label="Fees Paid" value={`${Number(formatEther(l.feesPaid)).toFixed(4)} BNB`} />
        <Field label="Applied" value={formatTime(l.appliedAt)} />
        {l.approvedAt > 0 && <Field label="Approved" value={formatTime(l.approvedAt)} />}
        <Field label="Unlock" value={formatTime(l.lpUnlockAt)} />
      </div>

      {/* Reason input */}
      {(canReject || canDelist || canSlash) && (
        <div className="space-y-1.5 pt-2">
          <span className="font-mono text-[10px] font-medium text-[#6e6e6e] tracking-wider">
            REASON (FOR REJECT / DELIST / SLASH)
          </span>
          <input
            type="text"
            value={reason}
            onChange={(e) => onReasonChange(e.target.value)}
            placeholder="e.g. suspicious token contract"
            className="w-full h-9 px-3 bg-[#1A1A1A] border border-[#1A1A1A] font-mono text-[12px] text-white placeholder-[#404040] focus:outline-none focus:border-[#BFFF00] transition-colors"
          />
        </div>
      )}

      {/* Action buttons */}
      <div className="grid grid-cols-2 gap-2 pt-2">
        <button
          onClick={onApprove}
          disabled={disabled || !canApprove}
          className="h-9 bg-[#BFFF00] hover:bg-[#B0EE00] text-black font-mono text-[12px] font-semibold tracking-wider disabled:opacity-20 disabled:cursor-not-allowed transition-opacity"
        >
          APPROVE
        </button>
        <button
          onClick={onReject}
          disabled={disabled || !canReject}
          className="h-9 bg-[#1A1A1A] border border-[#1A1A1A] text-[#999999] hover:border-[#FF4444] hover:text-[#FF4444] font-mono text-[12px] font-medium tracking-wider disabled:opacity-20 disabled:cursor-not-allowed transition-colors"
        >
          REJECT
        </button>
        <button
          onClick={onDelist}
          disabled={disabled || !canDelist}
          className="h-9 bg-[#1A1A1A] border border-[#1A1A1A] text-[#6e6e6e] hover:border-[#F59E0B] hover:text-[#F59E0B] font-mono text-[12px] font-medium tracking-wider disabled:opacity-20 disabled:cursor-not-allowed transition-colors"
        >
          DELIST
        </button>
        <button
          onClick={onSlash}
          disabled={disabled || !canSlash}
          className="h-9 bg-[#FF4444]/10 border border-[#FF4444] text-[#FF4444] hover:bg-[#FF4444]/20 font-mono text-[12px] font-semibold tracking-wider disabled:opacity-20 disabled:cursor-not-allowed transition-colors"
        >
          SLASH LP
        </button>
      </div>
    </div>
  );
}

function Field({ label, value, full, lime }: { label: string; value: string; full?: string; lime?: boolean }) {
  return (
    <div
      className="flex justify-between items-center gap-2"
      title={full}
      onClick={full ? () => navigator.clipboard?.writeText(full) : undefined}
      style={{ cursor: full ? "pointer" : "default" }}
    >
      <span className="font-mono text-[12px] text-[#6e6e6e]">{label}</span>
      <span className={`font-mono text-[12px] ${lime ? "text-[#BFFF00] font-semibold" : "text-white"}`}>
        {value}
      </span>
    </div>
  );
}

function formatTime(unixSec: number): string {
  if (!unixSec) return "—";
  const d = new Date(unixSec * 1000);
  return d.toLocaleString(undefined, {
    month: "short", day: "2-digit", hour: "2-digit", minute: "2-digit",
  });
}
