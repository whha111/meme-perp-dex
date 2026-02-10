"use client";

import { useTranslations } from "next-intl";
import type { Address } from "viem";
import type { PoolInfo, UserLendingPosition } from "@/hooks/lending/useLendingPool";

interface LendingPoolCardProps {
  pool: PoolInfo;
  userPosition?: UserLendingPosition;
  isSelected: boolean;
  onSelect: (token: Address) => void;
}

export function LendingPoolCard({ pool, userPosition, isSelected, onSelect }: LendingPoolCardProps) {
  const t = useTranslations("lending");

  // Utilization color
  const utilNum = parseFloat(pool.utilizationPercent);
  const utilColor = utilNum >= 90 ? "bg-okx-down" : utilNum >= 80 ? "bg-yellow-500" : "bg-okx-up";
  const utilWidth = Math.min(utilNum, 100);

  return (
    <div
      onClick={() => onSelect(pool.token)}
      className={`bg-okx-bg-card border rounded-lg p-4 cursor-pointer transition-all hover:border-okx-accent ${
        isSelected ? "border-okx-accent bg-okx-accent/5" : "border-okx-border-primary"
      }`}
    >
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-full bg-okx-bg-hover flex items-center justify-center text-sm font-bold">
            {pool.tokenSymbol.slice(0, 2)}
          </div>
          <div>
            <div className="font-bold text-sm">{pool.tokenSymbol}</div>
            <div className="text-[10px] text-okx-text-tertiary truncate max-w-[120px]">{pool.tokenName}</div>
          </div>
        </div>
        {userPosition && (
          <span className="text-[10px] px-2 py-0.5 rounded-full bg-okx-up/20 text-okx-up font-medium">
            {t("deposited")}
          </span>
        )}
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-2 gap-2 mb-3">
        <div>
          <div className="text-[10px] text-okx-text-tertiary">{t("tvl")}</div>
          <div className="text-xs font-medium">{pool.totalDepositsFormatted}</div>
        </div>
        <div>
          <div className="text-[10px] text-okx-text-tertiary">{t("utilization")}</div>
          <div className="text-xs font-medium">{pool.utilizationPercent}%</div>
        </div>
        <div>
          <div className="text-[10px] text-okx-text-tertiary">{t("supplyAPY")}</div>
          <div className="text-xs font-bold text-okx-up">{pool.supplyAPY}%</div>
        </div>
        <div>
          <div className="text-[10px] text-okx-text-tertiary">{t("borrowAPY")}</div>
          <div className="text-xs font-medium">{pool.borrowAPY}%</div>
        </div>
      </div>

      {/* Utilization Bar */}
      <div className="w-full h-1.5 bg-okx-bg-hover rounded-full overflow-hidden mb-2">
        <div
          className={`h-full rounded-full transition-all ${utilColor}`}
          style={{ width: `${utilWidth}%` }}
        />
      </div>

      {/* User Position (if exists) */}
      {userPosition && (
        <div className="border-t border-okx-border-primary pt-2 mt-1">
          <div className="flex justify-between text-[10px]">
            <span className="text-okx-text-tertiary">{t("yourDeposit")}</span>
            <span className="font-medium">{userPosition.depositAmountFormatted} {pool.tokenSymbol}</span>
          </div>
          {userPosition.pendingInterest > 0n && (
            <div className="flex justify-between text-[10px] mt-0.5">
              <span className="text-okx-text-tertiary">{t("pendingInterest")}</span>
              <span className="font-medium text-okx-up">+{userPosition.pendingInterestFormatted}</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
