"use client";

import React from "react";
import { useTranslations } from "next-intl";

interface RewardRecord {
  id: string;
  type: "level1" | "level2" | "claim";
  traderAddress: string;
  domainName: string;
  tradeType: "buy" | "sell";
  feeAmount: string;
  rewardAmount: string;
  txHash: string;
  timestamp: string;
}

export function RewardHistory() {
  const t = useTranslations("referral");

  // Mock data - replace with real API data
  const rewards: RewardRecord[] = [
    {
      id: "1",
      type: "level1",
      traderAddress: "0x1234...5678",
      domainName: "example.com",
      tradeType: "buy",
      feeAmount: "0.001",
      rewardAmount: "0.00015",
      txHash: "0xabc...123",
      timestamp: "2024-01-10 14:30",
    },
    {
      id: "2",
      type: "level2",
      traderAddress: "0xabcd...ef01",
      domainName: "test.com",
      tradeType: "sell",
      feeAmount: "0.002",
      rewardAmount: "0.00006",
      txHash: "0xdef...456",
      timestamp: "2024-01-10 12:15",
    },
    {
      id: "3",
      type: "claim",
      traderAddress: "",
      domainName: "",
      tradeType: "buy",
      feeAmount: "",
      rewardAmount: "0.05",
      txHash: "0xghi...789",
      timestamp: "2024-01-09 18:00",
    },
  ];

  if (rewards.length === 0) {
    return (
      <div className="text-center py-12">
        <div className="text-4xl mb-4">📊</div>
        <p className="text-okx-text-secondary">{t("noRewards")}</p>
        <p className="text-sm text-okx-text-tertiary mt-2">{t("inviteToEarn")}</p>
      </div>
    );
  }

  const getTypeLabel = (type: string) => {
    switch (type) {
      case "level1":
        return t("level1Reward");
      case "level2":
        return t("level2Reward");
      case "claim":
        return t("claimed");
      default:
        return type;
    }
  };

  const getTypeColor = (type: string) => {
    switch (type) {
      case "level1":
        return "bg-okx-up/20 text-okx-up";
      case "level2":
        return "bg-blue-500/20 text-blue-500";
      case "claim":
        return "bg-purple-500/20 text-purple-500";
      default:
        return "bg-gray-500/20 text-gray-500";
    }
  };

  return (
    <div className="space-y-3">
      {rewards.map((reward) => (
        <div
          key={reward.id}
          className="p-4 bg-okx-bg-hover rounded-lg border border-okx-border-secondary"
        >
          <div className="flex items-start justify-between">
            <div className="flex items-center gap-3">
              <span className={`px-2 py-1 rounded text-xs font-medium ${getTypeColor(reward.type)}`}>
                {getTypeLabel(reward.type)}
              </span>
              <div>
                {reward.type !== "claim" ? (
                  <>
                    <div className="text-sm">
                      <span className="text-okx-text-secondary">{t("from")}: </span>
                      <span className="font-mono">{reward.traderAddress}</span>
                    </div>
                    <div className="text-xs text-okx-text-tertiary mt-1">
                      {reward.domainName} | {reward.tradeType === "buy" ? t("buyTrade") : t("sellTrade")}
                    </div>
                  </>
                ) : (
                  <div className="text-sm text-okx-text-secondary">{t("claimedToWallet")}</div>
                )}
              </div>
            </div>
            <div className="text-right">
              <div className={`font-bold ${reward.type === "claim" ? "text-purple-500" : "text-okx-up"}`}>
                +{reward.rewardAmount} ETH
              </div>
              <div className="text-xs text-okx-text-tertiary">{reward.timestamp}</div>
            </div>
          </div>
          {reward.txHash && (
            <div className="mt-2 pt-2 border-t border-okx-border-primary">
              <a
                href={`https://sepolia.basescan.org/tx/${reward.txHash}`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs text-okx-accent hover:underline"
              >
                {t("viewOnExplorer")} →
              </a>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
