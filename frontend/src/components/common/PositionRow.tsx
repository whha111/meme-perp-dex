"use client";

/**
 * Unified Position Row Component
 *
 * Shared rendering for perpetual contract positions across 3 views:
 * - "card"      → PerpetualOrderPanelV2 (detailed card with data grid + action buttons)
 * - "table-row" → AllPositions (compact <tr> for admin table)
 * - "grid-row"  → Account page (7-column CSS grid, clickable)
 *
 * All price/size values use 1e18 precision (ETH-denominated perpetuals).
 * PnL uses GMX standard: delta = size * |markPrice - entryPrice| / entryPrice
 */

import React from "react";

// ─── Shared Types ──────────────────────────────────────────────

/** Common position data shape (superset of all 3 consumers) */
export interface PositionRowData {
  pairId: string;
  token: string;
  trader?: string;
  isLong: boolean;
  size: string;
  entryPrice: string;
  markPrice?: string;
  liquidationPrice?: string;
  collateral: string;
  leverage: string;
  mmr?: string;                   // maintenance margin rate (basis points)
  unrealizedPnL?: string;
  roe?: string;
  fundingFee?: string;
  takeProfitPrice?: string;
  stopLossPrice?: string;
  riskLevel?: "safe" | "warning" | "danger" | "low" | "medium" | "high" | "critical";
}

export type PositionRowVariant = "card" | "table-row" | "grid-row";

export interface PositionRowProps {
  position: PositionRowData;
  variant: PositionRowVariant;

  /** Override mark price (e.g., from live spot feed) */
  realtimePrice?: number;

  /** Render action buttons (card variant only) */
  renderActions?: (pos: PositionRowData, computed: PositionComputed) => React.ReactNode;

  /** Click handler (grid-row variant: navigate to trading page) */
  onClick?: () => void;

  /** Translation function — falls back to English labels */
  t?: (key: string) => string;
}

/** Computed values derived from raw position data */
export interface PositionComputed {
  sizeETH: number;
  entryPrice: number;
  markPrice: number;
  liqPrice: number;
  collateralETH: number;
  leverage: number;
  pnlETH: number;
  roe: number;
  marginRatio: number;
  riskLevel: 0 | 1 | 2 | 3;       // 0=safe, 1=caution, 2=warning, 3=danger
  fundingFeeETH: number;
  tpPrice: number | null;
  slPrice: number | null;
}

// ─── Formatting Utilities ──────────────────────────────────────

/**
 * Format small meme token prices with subscript notation.
 * e.g., 0.00000001234 → "0.0₈1234"
 */
export function formatSmallPrice(price: number): string {
  if (price <= 0) return "0.00";
  if (price >= 1000) return price.toLocaleString("en-US", { maximumFractionDigits: 1 });
  if (price >= 0.01) return price.toFixed(4);
  if (price >= 0.0001) return price.toFixed(6);
  if (price >= 0.000001) return price.toFixed(8);
  const priceStr = price.toFixed(18);
  const match = priceStr.match(/^0\.(0*)([1-9]\d*)/);
  if (match) {
    const zeroCount = match[1].length;
    const significantDigits = match[2].slice(0, 5);
    const subscripts = ["₀", "₁", "₂", "₃", "₄", "₅", "₆", "₇", "₈", "₉"];
    const subscriptNum = zeroCount.toString().split("").map((d) => subscripts[parseInt(d)]).join("");
    return `0.0${subscriptNum}${significantDigits}`;
  }
  return price.toFixed(10);
}

/** Format ETH amounts with appropriate decimal places */
export function formatETHAmount(val: number): string {
  if (Math.abs(val) >= 1) return val.toFixed(4);
  if (Math.abs(val) >= 0.0001) return val.toFixed(6);
  return val.toFixed(8);
}

/** Format address for display: 0x1234...5678 */
export function formatAddress(addr: string): string {
  if (!addr || addr.length < 10) return addr || "";
  return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
}

// ─── Data Processing ───────────────────────────────────────────

/** Compute derived values from raw position data (GMX standard PnL) */
export function computePosition(pos: PositionRowData, realtimePrice?: number): PositionComputed {
  const sizeETH = Number(pos.size) / 1e18;
  const entryPrice = Number(pos.entryPrice) / 1e18;
  const leverage = parseFloat(pos.leverage);
  const collateralETH = Number(pos.collateral) / 1e18;
  const liqPrice = Number(pos.liquidationPrice || "0") / 1e18;

  // Mark price: prefer realtime override → pos.markPrice → entryPrice
  const markPrice = realtimePrice ?? (Number(pos.markPrice || pos.entryPrice) / 1e18);

  // GMX standard PnL: delta = size * |markPrice - entryPrice| / entryPrice
  const pnlDelta = entryPrice > 0 ? sizeETH * Math.abs(markPrice - entryPrice) / entryPrice : 0;
  const hasProfit = pos.isLong ? (markPrice > entryPrice) : (entryPrice > markPrice);
  const pnlETH = hasProfit ? pnlDelta : -pnlDelta;

  // ROE = PnL / collateral * 100
  const roe = collateralETH > 0 ? (pnlETH / collateralETH) * 100 : 0;

  // Margin ratio & risk level
  const mmr = parseFloat(String(pos.mmr || "200")) / 100; // basis points → percentage
  const equity = collateralETH + pnlETH;
  const maintenanceMargin = sizeETH * (mmr / 100);
  const marginRatio = equity > 0 ? (maintenanceMargin / equity) * 100 : 999;
  const riskLevel: 0 | 1 | 2 | 3 = marginRatio > 50 ? 3 : marginRatio > 30 ? 2 : marginRatio > 15 ? 1 : 0;

  // Optional fields
  const fundingFeeETH = Number(pos.fundingFee || "0") / 1e18;
  const tpPrice = pos.takeProfitPrice ? Number(pos.takeProfitPrice) / 1e18 : null;
  const slPrice = pos.stopLossPrice ? Number(pos.stopLossPrice) / 1e18 : null;

  return {
    sizeETH, entryPrice, markPrice, liqPrice, collateralETH, leverage,
    pnlETH, roe, marginRatio, riskLevel, fundingFeeETH, tpPrice, slPrice,
  };
}

// ─── Sub-components ────────────────────────────────────────────

/** Direction badge: "▲ Long 10x" or "▼ Short 5x" */
function DirectionBadge({
  isLong,
  leverage,
  size = "sm",
  t,
}: {
  isLong: boolean;
  leverage: number;
  size?: "xs" | "sm";
  t?: (key: string) => string;
}) {
  const label = t
    ? `${isLong ? t("long") : t("short")} ${leverage}x`
    : `${isLong ? "Long" : "Short"} ${leverage}x`;

  if (size === "xs") {
    return (
      <span className={`px-1 py-0.5 rounded text-xs font-bold ${
        isLong ? "bg-green-900/50 text-green-400" : "bg-red-900/50 text-red-400"
      }`}>
        {isLong ? "L" : "S"}{leverage}x
      </span>
    );
  }

  return (
    <span className={`inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] font-semibold ${
      isLong
        ? "bg-emerald-500/15 text-emerald-400 border border-emerald-500/20"
        : "bg-rose-500/15 text-rose-400 border border-rose-500/20"
    }`}>
      {isLong ? "▲" : "▼"} {label}
    </span>
  );
}

/** PnL display with color coding */
function PnLDisplay({
  pnlETH,
  roe,
  compact = false,
}: {
  pnlETH: number;
  roe: number;
  compact?: boolean;
}) {
  const isProfit = pnlETH >= 0;
  const colorClass = isProfit ? "text-emerald-400" : "text-rose-400";
  const sign = isProfit ? "+" : "";

  if (compact) {
    return (
      <div className={`text-right font-medium ${colorClass}`}>
        <div>{sign}{formatETHAmount(pnlETH)}</div>
        <div className="text-xs">{sign}{roe.toFixed(2)}%</div>
      </div>
    );
  }

  return (
    <div className="text-right">
      <span className={`font-semibold ${colorClass}`}>
        {sign}{formatETHAmount(pnlETH)} BNB
      </span>
      <span className={`ml-1 text-[10px] ${isProfit ? "text-emerald-400/70" : "text-rose-400/70"}`}>
        ({sign}{roe.toFixed(2)}%)
      </span>
    </div>
  );
}

/** Risk bar visualization */
function RiskBar({ marginRatio, riskLevel }: { marginRatio: number; riskLevel: 0 | 1 | 2 | 3 }) {
  const barColor = riskLevel >= 3 ? "bg-red-500" : riskLevel >= 2 ? "bg-orange-500" : riskLevel >= 1 ? "bg-yellow-500" : "bg-green-500";
  const barWidth = Math.min(marginRatio, 100);

  return (
    <div className="flex items-center gap-1">
      <div className="w-8 h-1 bg-okx-bg-tertiary rounded-full overflow-hidden">
        <div className={`h-full rounded-full ${barColor}`} style={{ width: `${barWidth}%` }} />
      </div>
      <span className={`font-mono text-[10px] ${riskLevel >= 2 ? "text-orange-400" : "text-okx-text-tertiary"}`}>
        {marginRatio.toFixed(1)}%
      </span>
    </div>
  );
}

// ─── Card Variant (PerpetualOrderPanelV2) ──────────────────────

function CardVariant({
  pos,
  computed,
  renderActions,
  t,
}: {
  pos: PositionRowData;
  computed: PositionComputed;
  renderActions?: (pos: PositionRowData, computed: PositionComputed) => React.ReactNode;
  t?: (key: string) => string;
}) {
  const label = (key: string, fallback: string) => (t ? t(key) : fallback);

  return (
    <div className="bg-okx-bg-hover rounded-lg p-2.5 text-[11px]">
      {/* Header: Direction + PnL */}
      <div className="flex justify-between items-center mb-2">
        <DirectionBadge isLong={pos.isLong} leverage={computed.leverage} t={t} />
        <PnLDisplay pnlETH={computed.pnlETH} roe={computed.roe} />
      </div>

      {/* 2-Column Data Grid */}
      <div className="grid grid-cols-2 gap-x-3 gap-y-1 mb-2">
        <div className="flex justify-between">
          <span className="text-okx-text-tertiary">{label("size", "Size")}</span>
          <span className="text-okx-text-primary font-mono">{formatETHAmount(computed.sizeETH)}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-okx-text-tertiary">{label("markPrice", "Mark")}</span>
          <span className="text-okx-text-secondary font-mono">{formatSmallPrice(computed.markPrice)}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-okx-text-tertiary">{label("entryAvg", "Entry")}</span>
          <span className="text-okx-text-primary font-mono">{formatSmallPrice(computed.entryPrice)}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-okx-text-tertiary">{label("liqPrice", "Liq Price")}</span>
          <span className={`font-mono ${pos.isLong ? "text-rose-400/80" : "text-emerald-400/80"}`}>
            {computed.liqPrice > 0 ? formatSmallPrice(computed.liqPrice) : "—"}
          </span>
        </div>
        <div className="flex justify-between items-center">
          <span className="text-okx-text-tertiary">{label("margin", "Margin")}</span>
          <span className="text-okx-text-primary font-mono">
            {computed.collateralETH >= 1 ? computed.collateralETH.toFixed(4) : computed.collateralETH.toFixed(5)}
          </span>
        </div>
        <div className="flex justify-between items-center">
          <span className="text-okx-text-tertiary">{label("marginRatio", "Margin %")}</span>
          <RiskBar marginRatio={computed.marginRatio} riskLevel={computed.riskLevel} />
        </div>

        {/* Conditional: Funding Fee */}
        {computed.fundingFeeETH !== 0 && (
          <div className="flex justify-between col-span-2">
            <span className="text-okx-text-tertiary">{label("fundingFee", "Funding")}</span>
            <span className={`font-mono ${computed.fundingFeeETH >= 0 ? "text-emerald-400/70" : "text-rose-400/70"}`}>
              {computed.fundingFeeETH >= 0 ? "+" : ""}{computed.fundingFeeETH.toFixed(6)} BNB
            </span>
          </div>
        )}

        {/* Conditional: TP/SL */}
        {(computed.tpPrice || computed.slPrice) && (
          <div className="flex justify-between col-span-2">
            <span className="text-okx-text-tertiary">TP/SL</span>
            <span className="font-mono">
              {computed.tpPrice ? <span className="text-emerald-400/70">{formatSmallPrice(computed.tpPrice)}</span> : <span className="text-okx-text-tertiary">—</span>}
              <span className="text-okx-text-tertiary mx-0.5">/</span>
              {computed.slPrice ? <span className="text-rose-400/70">{formatSmallPrice(computed.slPrice)}</span> : <span className="text-okx-text-tertiary">—</span>}
            </span>
          </div>
        )}
      </div>

      {/* Action Buttons (injected by consumer) */}
      {renderActions && (
        <div className="flex gap-1.5">
          {renderActions(pos, computed)}
        </div>
      )}
    </div>
  );
}

// ─── Table Row Variant (AllPositions) ──────────────────────────

function TableRowVariant({
  pos,
  computed,
}: {
  pos: PositionRowData;
  computed: PositionComputed;
}) {
  const bgClass =
    (pos.riskLevel === "danger" || pos.riskLevel === "critical" || pos.riskLevel === "high") ? "bg-red-900/10" :
    (pos.riskLevel === "warning" || pos.riskLevel === "medium") ? "bg-yellow-900/10" : "";

  return (
    <tr className={`border-b border-gray-800 hover:bg-gray-800/50 ${bgClass}`}>
      {/* Trader */}
      <td className="py-1.5 px-1">
        <span className="font-mono text-okx-text-primary">{formatAddress(pos.trader || "")}</span>
      </td>

      {/* Side */}
      <td className="py-1.5 px-1 text-center">
        <DirectionBadge isLong={pos.isLong} leverage={computed.leverage} size="xs" />
      </td>

      {/* Size + Collateral */}
      <td className="py-1.5 px-1 text-right">
        <div className="text-okx-text-primary">{formatETHAmount(computed.sizeETH)}</div>
        <div className="text-gray-500 text-xs">{formatETHAmount(computed.collateralETH)}</div>
      </td>

      {/* Entry Price */}
      <td className="py-1.5 px-1 text-right font-mono text-okx-text-primary">
        {formatSmallPrice(computed.entryPrice)}
      </td>

      {/* Liquidation Price */}
      <td className={`py-1.5 px-1 text-right font-mono ${pos.isLong ? "text-red-400" : "text-green-400"}`}>
        {formatSmallPrice(computed.liqPrice)}
      </td>

      {/* PnL */}
      <td className="py-1.5 px-1">
        <PnLDisplay pnlETH={computed.pnlETH} roe={computed.roe} compact />
      </td>

      {/* Risk Bar (inline — consumer can replace with RiskProgressBarCompact) */}
      <td className="py-1.5 px-1">
        <RiskBar marginRatio={computed.marginRatio} riskLevel={computed.riskLevel} />
      </td>
    </tr>
  );
}

// ─── Grid Row Variant (Account Page) ───────────────────────────

function GridRowVariant({
  pos,
  computed,
  onClick,
  t,
}: {
  pos: PositionRowData;
  computed: PositionComputed;
  onClick?: () => void;
  t?: (key: string) => string;
}) {
  const isProfit = computed.pnlETH >= 0;
  const sign = isProfit ? "+" : "";

  return (
    <div
      className="grid grid-cols-7 gap-2 py-3.5 border-b border-okx-border-primary hover:bg-okx-bg-hover transition-colors cursor-pointer"
      onClick={onClick}
    >
      {/* Token Name */}
      <span className="font-mono text-sm font-medium text-okx-text-primary truncate">
        {pos.token.slice(0, 8)}...-PERP
      </span>

      {/* Direction Badge */}
      <span>
        <span className={`inline-block text-xs font-semibold px-2 py-0.5 rounded ${
          pos.isLong ? "bg-meme-lime/15 text-meme-lime" : "bg-okx-down/15 text-okx-down"
        }`}>
          {t ? (pos.isLong ? t("long") : t("short")) : (pos.isLong ? "Long" : "Short")} {computed.leverage}x
        </span>
      </span>

      {/* Size */}
      <span className="font-mono text-sm text-okx-text-secondary text-right">
        {formatETHAmount(computed.sizeETH)}
      </span>

      {/* Collateral */}
      <span className="font-mono text-sm text-okx-text-secondary text-right">
        {formatETHAmount(computed.collateralETH)}
      </span>

      {/* Entry Price */}
      <span className="font-mono text-sm text-okx-text-secondary text-right">
        {formatSmallPrice(computed.entryPrice)}
      </span>

      {/* Liquidation Price */}
      <span className="font-mono text-sm text-okx-down text-right">
        {formatSmallPrice(computed.liqPrice)}
      </span>

      {/* PnL */}
      <span className={`font-mono text-sm font-semibold text-right ${isProfit ? "text-meme-lime" : "text-okx-down"}`}>
        {sign}{formatETHAmount(computed.pnlETH)} ({sign}{computed.roe.toFixed(1)}%)
      </span>
    </div>
  );
}

// ─── Main Component ────────────────────────────────────────────

export function PositionRow({
  position,
  variant,
  realtimePrice,
  renderActions,
  onClick,
  t,
}: PositionRowProps) {
  const computed = computePosition(position, realtimePrice);

  switch (variant) {
    case "card":
      return <CardVariant pos={position} computed={computed} renderActions={renderActions} t={t} />;
    case "table-row":
      return <TableRowVariant pos={position} computed={computed} />;
    case "grid-row":
      return <GridRowVariant pos={position} computed={computed} onClick={onClick} t={t} />;
  }
}

// Default export for convenience
export default PositionRow;
