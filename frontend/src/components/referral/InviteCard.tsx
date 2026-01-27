"use client";

import React, { useState } from "react";
import { useTranslations } from "next-intl";
import QRCode from "qrcode";

interface InviteCardProps {
  code: string;
  codeReadable?: string;
  address: string;
  currentRebateBps: number;
}

export function InviteCard({ code, codeReadable, address, currentRebateBps }: InviteCardProps) {
  const t = useTranslations("referral");
  const [copied, setCopied] = useState(false);
  const [qrDataUrl, setQrDataUrl] = useState<string>("");

  const inviteLink = typeof window !== "undefined"
    ? `${window.location.origin}/invite/${codeReadable || code.slice(0, 18)}`
    : "";

  // Generate QR code on mount
  React.useEffect(() => {
    if (inviteLink) {
      QRCode.toDataURL(inviteLink, {
        width: 200,
        margin: 2,
        color: {
          dark: "#000000",
          light: "#ffffff",
        },
      }).then(setQrDataUrl).catch(console.error);
    }
  }, [inviteLink]);

  const copyToClipboard = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error("Failed to copy:", err);
    }
  };

  return (
    <div className="bg-okx-bg-card border border-okx-border-primary rounded-lg p-6">
      <h3 className="text-lg font-bold mb-4">{t("myInviteCode")}</h3>

      {/* QR Code */}
      <div className="flex justify-center mb-4">
        <div className="bg-white p-3 rounded-lg">
          {qrDataUrl ? (
            <img src={qrDataUrl} alt="Invite QR Code" className="w-[160px] h-[160px]" />
          ) : (
            <div className="w-[160px] h-[160px] flex items-center justify-center text-gray-400">
              Loading...
            </div>
          )}
        </div>
      </div>

      {/* Invite Code */}
      <div className="mb-4">
        <label className="text-sm text-okx-text-secondary block mb-1">
          {t("inviteCode")}
        </label>
        <div className="flex items-center gap-2">
          <input
            type="text"
            value={codeReadable || code.slice(0, 18) + "..."}
            readOnly
            className="flex-1 bg-okx-bg-hover border border-okx-border-secondary rounded-lg px-3 py-2 text-sm font-mono"
          />
          <button
            onClick={() => copyToClipboard(codeReadable || code)}
            className="px-3 py-2 bg-okx-bg-hover border border-okx-border-secondary rounded-lg hover:bg-okx-border-secondary transition-colors"
          >
            {copied ? t("copied") : t("copy")}
          </button>
        </div>
      </div>

      {/* Invite Link */}
      <div className="mb-4">
        <label className="text-sm text-okx-text-secondary block mb-1">
          {t("inviteLink")}
        </label>
        <div className="flex items-center gap-2">
          <input
            type="text"
            value={inviteLink}
            readOnly
            className="flex-1 bg-okx-bg-hover border border-okx-border-secondary rounded-lg px-3 py-2 text-sm truncate"
          />
          <button
            onClick={() => copyToClipboard(inviteLink)}
            className="px-3 py-2 bg-okx-accent text-white rounded-lg hover:bg-okx-accent/80 transition-colors"
          >
            {t("copyLink")}
          </button>
        </div>
      </div>

      {/* Current Rebate */}
      <div className="p-3 bg-okx-up/10 border border-okx-up/30 rounded-lg">
        <div className="flex justify-between items-center">
          <span className="text-sm text-okx-text-secondary">{t("currentRebate")}</span>
          <span className="text-lg font-bold text-okx-up">
            {(currentRebateBps / 100).toFixed(0)}%
          </span>
        </div>
        <p className="text-xs text-okx-text-tertiary mt-1">{t("rebateDesc")}</p>
      </div>

      {/* Create Custom Code Button */}
      <button className="w-full mt-4 px-4 py-2 bg-okx-bg-hover border border-okx-border-secondary rounded-lg hover:bg-okx-border-secondary transition-colors text-sm">
        {t("createCustomCode")}
      </button>
    </div>
  );
}
