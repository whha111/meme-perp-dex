"use client";

import React from "react";
import { useTranslations } from "next-intl";

interface Invitee {
  address: string;
  registeredAt: string;
  totalVolume: string;
  rewardsGenerated: string;
  isActive: boolean;
}

export function InviteeList() {
  const t = useTranslations("referral");

  // Mock data - replace with real API data
  const invitees: Invitee[] = [
    {
      address: "0x1234...5678",
      registeredAt: "2024-01-10",
      totalVolume: "2.5",
      rewardsGenerated: "0.0375",
      isActive: true,
    },
    {
      address: "0xabcd...ef01",
      registeredAt: "2024-01-09",
      totalVolume: "1.2",
      rewardsGenerated: "0.018",
      isActive: true,
    },
    {
      address: "0x9876...5432",
      registeredAt: "2024-01-08",
      totalVolume: "0",
      rewardsGenerated: "0",
      isActive: false,
    },
  ];

  if (invitees.length === 0) {
    return (
      <div className="text-center py-12">
        <div className="text-4xl mb-4">👥</div>
        <p className="text-okx-text-secondary">{t("noInvitees")}</p>
        <p className="text-sm text-okx-text-tertiary mt-2">{t("shareCodeHint")}</p>
      </div>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-okx-border-primary">
            <th className="text-left py-3 px-4 text-okx-text-secondary font-medium">
              {t("inviteeAddress")}
            </th>
            <th className="text-left py-3 px-4 text-okx-text-secondary font-medium">
              {t("joinedDate")}
            </th>
            <th className="text-right py-3 px-4 text-okx-text-secondary font-medium">
              {t("tradeVolume")}
            </th>
            <th className="text-right py-3 px-4 text-okx-text-secondary font-medium">
              {t("rewardsGenerated")}
            </th>
            <th className="text-center py-3 px-4 text-okx-text-secondary font-medium">
              {t("status")}
            </th>
          </tr>
        </thead>
        <tbody>
          {invitees.map((invitee, idx) => (
            <tr key={idx} className="border-b border-okx-border-primary hover:bg-okx-bg-hover">
              <td className="py-3 px-4 font-mono">{invitee.address}</td>
              <td className="py-3 px-4 text-okx-text-secondary">{invitee.registeredAt}</td>
              <td className="py-3 px-4 text-right">{invitee.totalVolume} ETH</td>
              <td className="py-3 px-4 text-right text-okx-up">{invitee.rewardsGenerated} ETH</td>
              <td className="py-3 px-4 text-center">
                <span
                  className={`inline-flex px-2 py-1 rounded-full text-xs ${
                    invitee.isActive
                      ? "bg-okx-up/20 text-okx-up"
                      : "bg-okx-text-tertiary/20 text-okx-text-tertiary"
                  }`}
                >
                  {invitee.isActive ? t("active") : t("inactive")}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
