"use client";

import React, { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { useAccount } from "wagmi";
import { useTranslations } from "next-intl";
import { Navbar } from "@/components/layout/Navbar";

export default function InviteLandingPage() {
  const t = useTranslations("referral");
  const params = useParams();
  const router = useRouter();
  const { address, isConnected } = useAccount();
  const [registering, setRegistering] = useState(false);
  const [registered, setRegistered] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const inviteCode = params.code as string;

  const handleRegister = async () => {
    if (!isConnected || !address) return;

    setRegistering(true);
    setError(null);

    try {
      // TODO: Call smart contract to register with referral code
      // For now, simulate success
      await new Promise((resolve) => setTimeout(resolve, 1500));
      setRegistered(true);

      // Redirect to main page after 2 seconds
      setTimeout(() => {
        router.push("/");
      }, 2000);
    } catch (err) {
      setError(t("registrationFailed"));
    } finally {
      setRegistering(false);
    }
  };

  return (
    <div className="min-h-screen bg-okx-bg-primary text-okx-text-primary">
      <Navbar />

      <div className="max-w-lg mx-auto px-4 py-16">
        <div className="bg-okx-bg-card border border-okx-border-primary rounded-lg p-8 text-center">
          {/* Welcome Icon */}
          <div className="text-6xl mb-6">🎁</div>

          {/* Title */}
          <h1 className="text-2xl font-bold mb-2">{t("welcomeTitle")}</h1>
          <p className="text-okx-text-secondary mb-6">{t("welcomeSubtitle")}</p>

          {/* Benefits */}
          <div className="bg-okx-bg-hover rounded-lg p-4 mb-6 text-left">
            <h3 className="font-medium mb-3">{t("yourBenefits")}</h3>
            <ul className="space-y-2 text-sm text-okx-text-secondary">
              <li className="flex items-center gap-2">
                <span className="text-okx-up">✓</span>
                {t("benefit1")}
              </li>
              <li className="flex items-center gap-2">
                <span className="text-okx-up">✓</span>
                {t("benefit2")}
              </li>
              <li className="flex items-center gap-2">
                <span className="text-okx-up">✓</span>
                {t("benefit3")}
              </li>
            </ul>
          </div>

          {/* Invite Code Display */}
          <div className="mb-6">
            <span className="text-sm text-okx-text-secondary">{t("inviteCode")}</span>
            <div className="font-mono text-lg bg-okx-bg-hover rounded-lg px-4 py-2 mt-1">
              {inviteCode}
            </div>
          </div>

          {/* Action Button */}
          {!isConnected ? (
            <div>
              <p className="text-sm text-okx-text-secondary mb-4">{t("connectToActivate")}</p>
              {/* WalletButton would go here */}
            </div>
          ) : registered ? (
            <div className="p-4 bg-okx-up/10 border border-okx-up/30 rounded-lg">
              <div className="text-okx-up font-bold">{t("registrationSuccess")}</div>
              <p className="text-sm text-okx-text-secondary mt-1">{t("redirecting")}</p>
            </div>
          ) : (
            <button
              onClick={handleRegister}
              disabled={registering}
              className="w-full px-6 py-3 bg-okx-accent text-white rounded-lg hover:bg-okx-accent/80 transition-colors disabled:opacity-50"
            >
              {registering ? t("registering") : t("activateAccount")}
            </button>
          )}

          {error && (
            <div className="mt-4 p-3 bg-okx-down/10 border border-okx-down/30 rounded-lg text-okx-down text-sm">
              {error}
            </div>
          )}

          {/* Terms */}
          <p className="text-xs text-okx-text-tertiary mt-6">{t("termsHint")}</p>
        </div>
      </div>
    </div>
  );
}
