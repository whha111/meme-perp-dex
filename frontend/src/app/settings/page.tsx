"use client";

import React, { useState } from "react";
import { useAppStore } from "@/lib/stores/appStore";
import { Navbar } from "@/components/layout/Navbar";
import { useTranslations } from "next-intl";
import { useToast } from "@/components/shared/Toast";

export default function SettingsPage() {
  const t = useTranslations("settings");
  const { showToast } = useToast();
  const preferences = useAppStore((state) => state.preferences);
  const setSlippageTolerance = useAppStore((state) => state.setSlippageTolerance);
  const setTransactionDeadline = useAppStore((state) => state.setTransactionDeadline);
  const recentInstruments = useAppStore((state) => state.recentInstruments);
  const clearRecentInstruments = () => useAppStore.setState({ recentInstruments: [] });

  const slippageTolerance = preferences.slippageTolerance;
  const transactionDeadline = preferences.transactionDeadline;

  const [localSlippage, setLocalSlippage] = useState(slippageTolerance.toString());
  const [localDeadline, setLocalDeadline] = useState(transactionDeadline.toString());
  const [showSuccess, setShowSuccess] = useState(false);

  const handleSave = () => {
    const slippage = parseFloat(localSlippage);
    const deadline = parseInt(localDeadline);

    if (isNaN(slippage) || slippage < 0 || slippage > 50) {
      showToast(t("slippageRange"), "warning");
      return;
    }

    if (isNaN(deadline) || deadline < 60 || deadline > 3600) {
      showToast(t("deadlineRange"), "warning");
      return;
    }

    setSlippageTolerance(slippage);
    setTransactionDeadline(deadline);
    setShowSuccess(true);
    setTimeout(() => setShowSuccess(false), 3000);
  };

  const handleReset = () => {
    setLocalSlippage("1");
    setLocalDeadline("1200");
    setSlippageTolerance(1);
    setTransactionDeadline(1200);
  };

  return (
    <div className="min-h-screen bg-okx-bg-primary text-okx-text-primary">
      {/* Shared Navbar with theme and language selectors */}
      <Navbar />

      <div className="max-w-4xl mx-auto p-8">
        <h1 className="text-3xl font-bold mb-8">{t("title")}</h1>

        {showSuccess && (
          <div className="mb-6 p-4 bg-green-500/20 border border-green-500 rounded-lg">
            ✅ {t("saved")}
          </div>
        )}

        {/* 交易设置 */}
        <section className="mb-8 p-6 bg-okx-bg-card rounded-lg okx-card">
          <h2 className="text-xl font-semibold mb-4">{t("tradeSettings")}</h2>

          <div className="space-y-6">
            {/* 滑点容忍度 */}
            <div>
              <label className="block text-sm font-medium mb-2">
                {t("slippageTolerance")} (%)
              </label>
              <div className="flex gap-2">
                <input
                  type="number"
                  value={localSlippage}
                  onChange={(e) => setLocalSlippage(e.target.value)}
                  className="flex-1 px-4 py-2 bg-okx-bg-hover border border-okx-border-secondary rounded-lg focus:outline-none focus:border-okx-accent"
                  step="0.1"
                  min="0"
                  max="50"
                />
                <button
                  onClick={() => setLocalSlippage("0.5")}
                  className="px-4 py-2 bg-okx-bg-hover border border-okx-border-secondary rounded-lg hover:bg-okx-border-secondary"
                >
                  0.5%
                </button>
                <button
                  onClick={() => setLocalSlippage("1")}
                  className="px-4 py-2 bg-okx-bg-hover border border-okx-border-secondary rounded-lg hover:bg-okx-border-secondary"
                >
                  1%
                </button>
                <button
                  onClick={() => setLocalSlippage("2")}
                  className="px-4 py-2 bg-okx-bg-hover border border-okx-border-secondary rounded-lg hover:bg-okx-border-secondary"
                >
                  2%
                </button>
              </div>
              <p className="text-sm text-okx-text-secondary mt-2">
                {t("slippageHint")}: {slippageTolerance}%
              </p>
            </div>

            {/* 交易截止时间 */}
            <div>
              <label className="block text-sm font-medium mb-2">
                {t("transactionDeadline")} ({t("seconds")})
              </label>
              <div className="flex gap-2">
                <input
                  type="number"
                  value={localDeadline}
                  onChange={(e) => setLocalDeadline(e.target.value)}
                  className="flex-1 px-4 py-2 bg-okx-bg-hover border border-okx-border-secondary rounded-lg focus:outline-none focus:border-okx-accent"
                  step="60"
                  min="60"
                  max="3600"
                />
                <button
                  onClick={() => setLocalDeadline("600")}
                  className="px-4 py-2 bg-okx-bg-hover border border-okx-border-secondary rounded-lg hover:bg-okx-border-secondary"
                >
                  10 {t("minutes")}
                </button>
                <button
                  onClick={() => setLocalDeadline("1200")}
                  className="px-4 py-2 bg-okx-bg-hover border border-okx-border-secondary rounded-lg hover:bg-okx-border-secondary"
                >
                  20 {t("minutes")}
                </button>
                <button
                  onClick={() => setLocalDeadline("1800")}
                  className="px-4 py-2 bg-okx-bg-hover border border-okx-border-secondary rounded-lg hover:bg-okx-border-secondary"
                >
                  30 {t("minutes")}
                </button>
              </div>
              <p className="text-sm text-okx-text-secondary mt-2">
                {t("slippageHint")}: {transactionDeadline} {t("seconds")} ({Math.floor(transactionDeadline / 60)} {t("minutes")})
              </p>
            </div>
          </div>

          <div className="flex gap-4 mt-6">
            <button
              onClick={handleSave}
              className="px-6 py-2 bg-okx-accent text-white rounded-lg hover:bg-okx-accent/80 transition-colors"
            >
              {t("save")}
            </button>
            <button
              onClick={handleReset}
              className="px-6 py-2 bg-okx-bg-hover border border-okx-border-secondary rounded-lg hover:bg-okx-border-secondary transition-colors"
            >
              {t("reset")}
            </button>
          </div>
        </section>

        {/* 最近访问的交易对 */}
        <section className="p-6 bg-okx-bg-card rounded-lg okx-card">
          <div className="flex justify-between items-center mb-4">
            <h2 className="text-xl font-semibold">{t("recentInstruments") || "最近访问"}</h2>
            <button
              onClick={clearRecentInstruments}
              className="px-4 py-2 text-sm bg-red-500/20 border border-red-500 rounded-lg hover:bg-red-500/30 transition-colors"
            >
              {t("clearHistory")}
            </button>
          </div>

          {recentInstruments.length === 0 ? (
            <p className="text-okx-text-secondary">{t("noHistory")}</p>
          ) : (
            <div className="space-y-2">
              {recentInstruments.map((instId) => (
                <div
                  key={instId}
                  className="p-3 bg-okx-bg-hover rounded-lg flex justify-between items-center"
                >
                  <span>{instId}</span>
                  <a
                    href={`/trade/${instId}`}
                    className="text-okx-accent hover:underline"
                  >
                    {t("visit")} →
                  </a>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* 说明文档 */}
        <section className="mt-8 p-6 bg-okx-bg-card rounded-lg okx-card">
          <h2 className="text-xl font-semibold mb-4">{t("settingsHelp")}</h2>
          <div className="space-y-3 text-sm text-okx-text-secondary">
            <p>
              <strong className="text-okx-text-primary">{t("slippageTolerance")}:</strong> {t("slippageHelp")}
            </p>
            <p>
              <strong className="text-okx-text-primary">{t("transactionDeadline")}:</strong> {t("deadlineHelp")}
            </p>
            <p>
              <strong className="text-okx-text-primary">{t("recentInstruments") || "最近访问"}:</strong> {t("historyHelp")}
            </p>
          </div>
        </section>
      </div>
    </div>
  );
}
