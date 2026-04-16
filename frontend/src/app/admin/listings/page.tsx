"use client";

import React, { useMemo, useState } from "react";
import { formatEther, type Address } from "viem";
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
  STATUS_COLORS,
} from "@/hooks/perpetual/useListingApplication";

type Tab = "pending" | "live" | "all";

/**
 * Admin listing review panel.
 *
 * Layout:
 *   Top bar      : tab switcher + refresh
 *   Main area    : master-detail (listing table + right-side drawer with actions)
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

  const Header = (
    <div className="mb-6">
      <h1 className="text-3xl font-bold text-okx-text-primary mb-2">Listing Moderation</h1>
      <p className="text-okx-text-secondary text-sm">
        Review external token listing applications. Admin role required.
      </p>
      {mockMode && (
        <div className="mt-3 p-3 bg-yellow-500/10 border border-yellow-500/30 rounded text-yellow-300 text-xs">
          ⚡ Mock mode — all applications are simulated from browser storage.
        </div>
      )}
      {!mockMode && isConnected && isAdmin === false && (
        <div className="mt-3 p-3 bg-red-500/10 border border-red-500/30 rounded text-red-300 text-sm">
          You are not the admin for this registry. Actions will revert.
        </div>
      )}
      {!isContractConfigured && !mockMode && (
        <div className="mt-3 p-3 bg-red-500/10 border border-red-500/30 rounded text-red-300 text-sm">
          Registry contract not configured.
        </div>
      )}
    </div>
  );

  return (
    <div className="min-h-screen bg-okx-bg-primary">
      <Navbar />
      <div className="px-6 sm:px-12 pt-10 pb-24 max-w-[1600px] mx-auto">
        {Header}

        {/* Tabs + refresh */}
        <div className="flex items-center justify-between mb-4">
          <div className="flex gap-2">
            {(
              [
                { id: "pending", label: `Pending (${pending.length})` },
                { id: "live", label: `Live (${approved.length})` },
                { id: "all", label: `All (${allListings.length})` },
              ] as const
            ).map((t) => (
              <button
                key={t.id}
                onClick={() => {
                  setTab(t.id);
                  setSelectedId(null);
                }}
                className={`px-4 py-2 rounded-md text-sm font-medium border transition-colors ${
                  tab === t.id
                    ? "bg-okx-bg-hover border-meme-lime text-meme-lime"
                    : "bg-okx-bg-card border-okx-border-primary text-okx-text-secondary hover:text-okx-text-primary"
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>

          <button
            onClick={() => refresh()}
            className="px-3 py-2 text-xs text-okx-text-tertiary border border-okx-border-primary rounded hover:text-meme-lime hover:border-meme-lime transition-colors"
          >
            Refresh
          </button>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          {/* ── LEFT: Listing table ── */}
          <div className="lg:col-span-2 bg-okx-bg-card border border-okx-border-primary rounded-lg overflow-hidden">
            {visible.length === 0 ? (
              <div className="p-8 text-center text-okx-text-tertiary text-sm">
                No listings in this view.
              </div>
            ) : (
              <table className="w-full text-sm">
                <thead className="bg-okx-bg-secondary text-okx-text-tertiary text-xs uppercase">
                  <tr>
                    <th className="px-4 py-2 text-left font-medium">#</th>
                    <th className="px-4 py-2 text-left font-medium">Token</th>
                    <th className="px-4 py-2 text-left font-medium">Tier</th>
                    <th className="px-4 py-2 text-left font-medium">LP</th>
                    <th className="px-4 py-2 text-left font-medium">Applied</th>
                    <th className="px-4 py-2 text-left font-medium">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {visible.map((l) => (
                    <tr
                      key={l.appId}
                      onClick={() => setSelectedId(l.appId)}
                      className={`border-t border-okx-border-primary cursor-pointer hover:bg-okx-bg-hover transition-colors ${
                        selectedId === l.appId ? "bg-okx-bg-hover" : ""
                      }`}
                    >
                      <td className="px-4 py-3 text-okx-text-tertiary font-mono">#{l.appId}</td>
                      <td className="px-4 py-3 font-mono text-xs text-okx-text-primary">
                        {l.token.slice(0, 8)}…{l.token.slice(-4)}
                      </td>
                      <td className="px-4 py-3 text-okx-text-primary">{TIER_LABELS[l.tier]}</td>
                      <td className="px-4 py-3 text-okx-text-primary">
                        {Number(formatEther(l.lpAmountBNB)).toFixed(2)} BNB
                      </td>
                      <td className="px-4 py-3 text-okx-text-tertiary text-xs">
                        {formatTime(l.appliedAt)}
                      </td>
                      <td className="px-4 py-3">
                        <span className={`text-xs font-medium ${STATUS_COLORS[l.status]}`}>
                          {STATUS_LABELS[l.status]}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          {/* ── RIGHT: Detail drawer ── */}
          <div className="bg-okx-bg-card border border-okx-border-primary rounded-lg p-6">
            {!selected ? (
              <div className="text-center text-okx-text-tertiary text-sm py-12">
                Select a listing to view details.
              </div>
            ) : (
              <DetailPane
                listing={selected}
                reason={reason}
                onReasonChange={setReason}
                disabled={isActing || isConfirming || isAdmin === false}
                onApprove={() =>
                  handleAction(() => approve(selected.appId), `Approve #${selected.appId}`)
                }
                onReject={() =>
                  handleAction(
                    () => reject(selected.appId, reason || "rejected"),
                    `Reject #${selected.appId}`
                  )
                }
                onDelist={() =>
                  handleAction(
                    () => delist(selected.appId, reason || "delisted"),
                    `Delist #${selected.appId}`
                  )
                }
                onSlash={() =>
                  handleAction(
                    () => slash(selected.appId, reason || "slashed"),
                    `Slash #${selected.appId}`
                  )
                }
              />
            )}
            {error && (
              <p className="mt-3 text-xs text-red-400 break-words">{error}</p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Detail drawer ────────────────────────────────────────

interface DetailPaneProps {
  listing: Listing;
  reason: string;
  onReasonChange: (v: string) => void;
  disabled: boolean;
  onApprove: () => void;
  onReject: () => void;
  onDelist: () => void;
  onSlash: () => void;
}

function DetailPane({
  listing: l,
  reason,
  onReasonChange,
  disabled,
  onApprove,
  onReject,
  onDelist,
  onSlash,
}: DetailPaneProps) {
  const canApprove = l.status === ListingStatus.PENDING;
  const canReject = l.status === ListingStatus.PENDING;
  const canDelist = l.status === ListingStatus.APPROVED;
  const canSlash = [
    ListingStatus.PENDING,
    ListingStatus.APPROVED,
    ListingStatus.DELISTED,
  ].includes(l.status);

  return (
    <>
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-semibold text-okx-text-primary">Application #{l.appId}</h3>
        <span className={`text-sm font-medium ${STATUS_COLORS[l.status]}`}>
          {STATUS_LABELS[l.status]}
        </span>
      </div>

      <div className="space-y-2 text-sm mb-5">
        <Field label="Token" value={l.token} mono copyable />
        <Field label="Pair" value={l.pair} mono copyable />
        <Field label="Project Team" value={l.projectTeam} mono copyable />
        <Field label="Tier" value={TIER_LABELS[l.tier]} />
        <Field
          label="LP Amount"
          value={`${Number(formatEther(l.lpAmountBNB)).toFixed(4)} BNB`}
        />
        <Field
          label="Fees Paid"
          value={`${Number(formatEther(l.feesPaid)).toFixed(4)} BNB`}
        />
        <Field label="Applied" value={formatTime(l.appliedAt)} />
        {l.approvedAt > 0 && <Field label="Approved" value={formatTime(l.approvedAt)} />}
        <Field label="Unlock" value={formatTime(l.lpUnlockAt)} />
      </div>

      {/* Reason input (shared for reject/delist/slash) */}
      {(canReject || canDelist || canSlash) && (
        <label className="block mb-4">
          <span className="text-xs text-okx-text-secondary mb-1 block">
            Reason (for reject / delist / slash)
          </span>
          <input
            type="text"
            value={reason}
            onChange={(e) => onReasonChange(e.target.value)}
            placeholder="e.g. suspicious token contract"
            className="w-full px-3 py-2 bg-okx-bg-secondary border border-okx-border-primary rounded-md text-okx-text-primary text-sm focus:outline-none focus:border-meme-lime"
          />
        </label>
      )}

      {/* Action buttons */}
      <div className="grid grid-cols-2 gap-2">
        <button
          onClick={onApprove}
          disabled={disabled || !canApprove}
          className="py-2 bg-meme-lime text-black text-sm font-semibold rounded hover:opacity-90 disabled:opacity-30 disabled:cursor-not-allowed transition-opacity"
        >
          Approve
        </button>
        <button
          onClick={onReject}
          disabled={disabled || !canReject}
          className="py-2 bg-okx-bg-secondary border border-okx-border-primary text-okx-text-secondary text-sm font-medium rounded hover:border-red-400 hover:text-red-400 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
        >
          Reject
        </button>
        <button
          onClick={onDelist}
          disabled={disabled || !canDelist}
          className="py-2 bg-okx-bg-secondary border border-okx-border-primary text-okx-text-secondary text-sm font-medium rounded hover:border-yellow-400 hover:text-yellow-400 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
        >
          Delist
        </button>
        <button
          onClick={onSlash}
          disabled={disabled || !canSlash}
          className="py-2 bg-red-500/10 border border-red-500/40 text-red-400 text-sm font-semibold rounded hover:bg-red-500/20 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
        >
          Slash LP
        </button>
      </div>

      {disabled && (
        <p className="mt-3 text-xs text-okx-text-tertiary">
          {/* generic message; concrete reasons surfaced via Toast */}
          Action unavailable.
        </p>
      )}
    </>
  );
}

function Field({
  label,
  value,
  mono,
  copyable,
}: {
  label: string;
  value: string;
  mono?: boolean;
  copyable?: boolean;
}) {
  return (
    <div className="flex justify-between items-start gap-2">
      <span className="text-okx-text-tertiary shrink-0">{label}</span>
      <span
        className={`text-right break-all text-okx-text-primary ${mono ? "font-mono text-xs" : ""} ${
          copyable ? "cursor-pointer" : ""
        }`}
        title={copyable ? `Click to copy: ${value}` : undefined}
        onClick={
          copyable
            ? () => {
                if (typeof navigator !== "undefined" && navigator.clipboard) {
                  void navigator.clipboard.writeText(value);
                }
              }
            : undefined
        }
      >
        {mono && value.length > 14 ? `${value.slice(0, 8)}…${value.slice(-6)}` : value}
      </span>
    </div>
  );
}

function formatTime(unixSec: number): string {
  if (!unixSec) return "—";
  return new Date(unixSec * 1000).toLocaleString();
}
