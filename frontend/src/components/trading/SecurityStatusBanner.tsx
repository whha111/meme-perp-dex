"use client";

import React from "react";
import { useTranslations } from "next-intl";

/**
 * SecurityStatus type
 * Corresponds to security_status field in backend database
 */
export type SecurityStatus = 'UNKNOWN' | 'AUTHENTIC' | 'MISMATCH' | 'MISSING' | 'TRANSFERRED' | 'GRADUATED';

interface SecurityStatusBannerProps {
  status: SecurityStatus;
  domainName: string;
  className?: string;
}

export function SecurityStatusBanner({ status, domainName, className }: SecurityStatusBannerProps) {
  const t = useTranslations("security");
  
  // Only AUTHENTIC and GRADUATED statuses are safe
  const isAuthentic = status === 'AUTHENTIC' || status === 'GRADUATED';

  if (isAuthentic) {
    return null; // Safe status doesn't show banner
  }

  const getStatusInfo = () => {
    switch (status) {
      case 'MISMATCH':
        return {
          message: t("domainMismatch"),
          color: "bg-yellow-500/20 border-yellow-500 text-yellow-300",
        };
      case 'MISSING':
        return {
          message: t("recordMissing"),
          color: "bg-red-500/20 border-red-500 text-red-300",
        };
      case 'TRANSFERRED':
        return {
          message: t("ownershipTransferred"),
          color: "bg-orange-500/20 border-orange-500 text-orange-300",
        };
      default:
        return {
          message: t("abnormalStatus"),
          color: "bg-red-500/20 border-red-500 text-red-300",
        };
    }
  };

  const statusInfo = getStatusInfo();

  return (
    <div
      className={`w-full border rounded-lg p-4 flex items-center gap-3 ${statusInfo.color} ${className}`}
    >
      <svg
        className="w-5 h-5 flex-shrink-0"
        fill="none"
        stroke="currentColor"
        viewBox="0 0 24 24"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={2}
          d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
        />
      </svg>
      <div className="flex-1">
        <p className="font-semibold text-sm">{statusInfo.message}</p>
        <p className="text-xs opacity-80 mt-1">{t("domain", { domainName })}</p>
      </div>
    </div>
  );
}

