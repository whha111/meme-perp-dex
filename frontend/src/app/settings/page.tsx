"use client";

import React, { useState, useMemo, useEffect } from "react";
import { useAppStore, type AppTheme } from "@/lib/stores/appStore";
import { Navbar } from "@/components/layout/Navbar";
import { useTranslations } from "next-intl";
import { useToast } from "@/components/shared/Toast";
import { useAccount, useDisconnect } from "wagmi";
import { locales, localeNames, localeFlags, type Locale, changeLocale, useLocale } from "@/i18n";

type NavKey = "security" | "profile" | "api" | "notifications" | "fees" | "appearance";

export default function SettingsPage() {
  const t = useTranslations("settings");
  const tCommon = useTranslations("common");
  const { showToast } = useToast();
  const { address, isConnected } = useAccount();
  const { disconnect } = useDisconnect();
  const preferences = useAppStore((state) => state.preferences);
  const setSlippageTolerance = useAppStore((state) => state.setSlippageTolerance);
  const setTransactionDeadline = useAppStore((state) => state.setTransactionDeadline);
  const setTheme = useAppStore((state) => state.setTheme);
  const currentLocale = useLocale();

  const navItems = useMemo(() => [
    { key: "security" as NavKey, icon: "🔒", label: t("navSecurity") },
    { key: "profile" as NavKey, icon: "👤", label: t("navProfile") },
    { key: "api" as NavKey, icon: "🔑", label: t("navApi") },
    { key: "notifications" as NavKey, icon: "🔔", label: t("navNotifications") },
    { key: "fees" as NavKey, icon: "💰", label: t("navFees") },
    { key: "appearance" as NavKey, icon: "🌐", label: t("navAppearance") },
  ], [t]);

  const mockApiKeys = useMemo(() => [
    { name: "Trading Bot v1", key: "pk_live_8x...4f2a", permissions: [t("permRead"), t("permTrade")], created: "2024-01-15" },
    { name: "Portfolio Tracker", key: "pk_live_3m...7c8d", permissions: [t("permReadOnly")], created: "2024-02-20" },
  ], [t]);

  const mockSessions = useMemo(() => [
    { device: "Chrome · macOS", location: "Shanghai, CN", timeKey: "current", isCurrent: true },
    { device: "Safari · iOS iPhone", location: "Beijing, CN", timeKey: "2daysAgo", isCurrent: false },
  ], []);

  const [activeNav, setActiveNav] = useState<NavKey>("security");
  const [localSlippage, setLocalSlippage] = useState(preferences.slippageTolerance.toString());
  const [localDeadline, setLocalDeadline] = useState(preferences.transactionDeadline.toString());
  const [whitelistEnabled, setWhitelistEnabled] = useState(false);

  // Notification preferences (persisted in localStorage)
  const [notifTrade, setNotifTrade] = useState(true);
  const [notifPrice, setNotifPrice] = useState(true);
  const [notifLiquidation, setNotifLiquidation] = useState(true);
  const [notifSystem, setNotifSystem] = useState(false);
  const [notifEmail, setNotifEmail] = useState(false);

  // Profile
  const [nickname, setNickname] = useState("");
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    // Load notification prefs from localStorage
    try {
      const saved = localStorage.getItem("notif_prefs");
      if (saved) {
        const prefs = JSON.parse(saved);
        setNotifTrade(prefs.trade ?? true);
        setNotifPrice(prefs.price ?? true);
        setNotifLiquidation(prefs.liquidation ?? true);
        setNotifSystem(prefs.system ?? false);
        setNotifEmail(prefs.email ?? false);
      }
      const savedNick = localStorage.getItem("user_nickname");
      if (savedNick) setNickname(savedNick);
    } catch { /* ignore */ }
  }, []);

  const saveNotifPrefs = (key: string, val: boolean) => {
    const prefs = { trade: notifTrade, price: notifPrice, liquidation: notifLiquidation, system: notifSystem, email: notifEmail, [key]: val };
    localStorage.setItem("notif_prefs", JSON.stringify(prefs));
    showToast(t("saved"), "success");
  };

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
    showToast(t("saved"), "success");
  };

  const formatAddress = (addr: string) =>
    addr ? `${addr.slice(0, 6)}...${addr.slice(-4)}` : "";

  // Toggle component
  const Toggle = ({ enabled, onChange }: { enabled: boolean; onChange: (v: boolean) => void }) => (
    <button
      onClick={() => onChange(!enabled)}
      className={`w-11 h-6 rounded-full relative transition-colors ${
        enabled ? "bg-meme-lime" : "bg-okx-bg-hover border border-okx-border-primary"
      }`}
    >
      <div className={`w-5 h-5 rounded-full bg-white absolute top-0.5 transition-all ${enabled ? "left-[22px]" : "left-0.5"}`} />
    </button>
  );

  // Section subtitle per tab
  const subtitles: Record<NavKey, string> = {
    security: t("securitySubtitle"),
    profile: t("profileSubtitle"),
    api: t("apiSubtitle"),
    notifications: t("notificationsSubtitle"),
    fees: t("feesSubtitle"),
    appearance: t("appearanceSubtitle"),
  };

  return (
    <div className="min-h-screen bg-okx-bg-primary text-okx-text-primary">
      <Navbar />

      <div className="max-w-[1440px] mx-auto px-8 lg:px-16 py-8">
        <div className="flex gap-8">
          {/* Left Sidebar Navigation */}
          <div className="w-[220px] shrink-0 space-y-1">
            {navItems.map((item) => (
              <button
                key={item.key}
                onClick={() => setActiveNav(item.key)}
                className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg text-sm transition-all ${
                  activeNav === item.key
                    ? "bg-meme-lime/10 text-meme-lime font-bold border border-meme-lime/20"
                    : "text-okx-text-secondary hover:text-okx-text-primary hover:bg-okx-bg-hover"
                }`}
              >
                <span className="text-base">{item.icon}</span>
                {item.label}
              </button>
            ))}
          </div>

          {/* Main Content Area */}
          <div className="flex-1 space-y-6">
            <div>
              <h1 className="text-2xl font-bold">
                {navItems.find((n) => n.key === activeNav)?.label}
              </h1>
              <p className="text-sm text-okx-text-tertiary mt-1">
                {subtitles[activeNav]}
              </p>
            </div>

            {/* ═══════════════ SECURITY TAB ═══════════════ */}
            {activeNav === "security" && (
              <>
                {/* Wallet Connection Card */}
                <div className="meme-card p-6 space-y-5">
                  <div className="flex items-center justify-between">
                    <h3 className="font-bold">{t("walletConnection")}</h3>
                    <span className={`meme-badge ${isConnected ? "meme-badge-success" : "meme-badge-danger"}`}>
                      {isConnected ? t("connected") : t("notConnected")}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-full bg-orange-500/15 flex items-center justify-center">
                        <span className="text-lg">🦊</span>
                      </div>
                      <div>
                        <div className="text-sm font-medium">MetaMask</div>
                        <div className="text-xs text-okx-text-tertiary font-mono">
                          {isConnected && address ? formatAddress(address) : t("notConnected")} · BSC Testnet
                        </div>
                      </div>
                    </div>
                    <button
                      onClick={() => { disconnect(); showToast(t("walletDisconnected"), "success"); }}
                      className="px-4 py-2 rounded-lg text-sm border border-okx-border-secondary text-okx-text-secondary hover:text-okx-down hover:border-okx-down/50 transition-colors"
                    >
                      {t("disconnect")}
                    </button>
                  </div>
                </div>

                {/* Security Verification Card */}
                <div className="meme-card overflow-hidden">
                  <div className="px-6 py-4 border-b border-okx-border-primary">
                    <h3 className="font-bold">{t("securityVerification")}</h3>
                    <p className="text-xs text-okx-text-tertiary mt-1">{t("securityVerificationDesc")}</p>
                  </div>

                  <div className="flex items-center justify-between px-6 py-4 border-b border-okx-border-primary">
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-lg bg-okx-bg-hover flex items-center justify-center text-sm">🔐</div>
                      <div>
                        <div className="text-sm font-medium">{t("tradingPassword")}</div>
                        <div className="text-xs text-okx-text-tertiary">{t("tradingPasswordDesc")}</div>
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="meme-badge meme-badge-warning">{t("notSet")}</span>
                      <button
                        onClick={() => showToast(t("featureComingSoon"), "info")}
                        className="px-3 py-1.5 rounded-lg text-xs bg-okx-bg-hover border border-okx-border-primary text-okx-text-secondary hover:text-okx-text-primary transition-colors"
                      >
                        {t("setup")}
                      </button>
                    </div>
                  </div>

                  <div className="flex items-center justify-between px-6 py-4 border-b border-okx-border-primary">
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-lg bg-okx-bg-hover flex items-center justify-center text-sm">✍️</div>
                      <div>
                        <div className="text-sm font-medium">{t("signatureVerification")}</div>
                        <div className="text-xs text-okx-text-tertiary">{t("signatureVerificationDesc")}</div>
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="meme-badge meme-badge-success">{t("enabled")}</span>
                      <button
                        onClick={() => showToast(t("featureComingSoon"), "info")}
                        className="px-3 py-1.5 rounded-lg text-xs bg-okx-bg-hover border border-okx-border-primary text-okx-text-secondary hover:text-okx-text-primary transition-colors"
                      >
                        {t("configure")}
                      </button>
                    </div>
                  </div>

                  <div className="flex items-center justify-between px-6 py-4">
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-lg bg-okx-bg-hover flex items-center justify-center text-sm">📋</div>
                      <div>
                        <div className="text-sm font-medium">{t("withdrawWhitelist")}</div>
                        <div className="text-xs text-okx-text-tertiary">{t("withdrawWhitelistDesc")}</div>
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className={`meme-badge ${whitelistEnabled ? "meme-badge-success" : "meme-badge-danger"}`}>
                        {whitelistEnabled ? t("enabled") : t("disabled")}
                      </span>
                      <Toggle enabled={whitelistEnabled} onChange={setWhitelistEnabled} />
                    </div>
                  </div>
                </div>

                {/* API Key Management */}
                <div className="meme-card overflow-hidden">
                  <div className="flex items-center justify-between px-6 py-4 border-b border-okx-border-primary">
                    <div>
                      <h3 className="font-bold">{t("apiKeyManagement")}</h3>
                      <p className="text-xs text-okx-text-tertiary mt-1">{t("apiKeyManagementDesc")}</p>
                    </div>
                    <button
                      onClick={() => showToast(t("featureComingSoon"), "info")}
                      className="px-4 py-2 rounded-lg text-xs font-bold bg-meme-lime text-black hover:opacity-90 transition-opacity"
                    >
                      + {t("createApiKey")}
                    </button>
                  </div>

                  {mockApiKeys.map((api, idx) => (
                    <div key={idx} className={`flex items-center justify-between px-6 py-4 ${idx < mockApiKeys.length - 1 ? "border-b border-okx-border-primary" : ""}`}>
                      <div>
                        <div className="text-sm font-medium">{api.name}</div>
                        <div className="text-xs text-okx-text-tertiary font-mono">{api.key}</div>
                      </div>
                      <div className="flex items-center gap-3">
                        {api.permissions.map((perm) => (
                          <span key={perm} className="meme-badge meme-badge-lime">{perm}</span>
                        ))}
                        <button className="text-xs text-okx-down hover:opacity-80">{t("delete")}</button>
                      </div>
                    </div>
                  ))}
                </div>

                {/* Login Activity */}
                <div className="meme-card overflow-hidden">
                  <div className="flex items-center justify-between px-6 py-4 border-b border-okx-border-primary">
                    <div>
                      <h3 className="font-bold">{t("loginActivity")}</h3>
                      <p className="text-xs text-okx-text-tertiary mt-1">{t("loginActivityDesc")}</p>
                    </div>
                    <button
                      onClick={() => showToast(t("featureComingSoon"), "info")}
                      className="px-4 py-2 rounded-lg text-xs border border-okx-down/30 text-okx-down hover:bg-okx-down/10 transition-colors"
                    >
                      {t("logoutOthers")}
                    </button>
                  </div>

                  {mockSessions.map((session, idx) => (
                    <div key={idx} className={`flex items-center justify-between px-6 py-3.5 ${idx < mockSessions.length - 1 ? "border-b border-okx-border-primary" : ""}`}>
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-lg bg-okx-bg-hover flex items-center justify-center text-sm">
                          {idx === 0 ? "💻" : "📱"}
                        </div>
                        <div>
                          <div className="text-sm font-medium">{session.device}</div>
                          <div className="text-xs text-okx-text-tertiary">{session.location} · {t(session.timeKey)}</div>
                        </div>
                      </div>
                      <div className="flex items-center gap-3">
                        {session.isCurrent && <span className="meme-badge meme-badge-success">{t("currentOnline")}</span>}
                        {!session.isCurrent && (
                          <button onClick={() => showToast(t("featureComingSoon"), "info")} className="text-xs text-okx-down hover:opacity-80">{t("logout")}</button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </>
            )}

            {/* ═══════════════ PROFILE TAB ═══════════════ */}
            {activeNav === "profile" && (
              <>
                <div className="meme-card p-6 space-y-6">
                  <h3 className="font-bold">{t("basicInfo")}</h3>

                  {/* Avatar */}
                  <div className="flex items-center gap-4">
                    <div className="w-16 h-16 rounded-full bg-gradient-to-br from-meme-lime/30 to-meme-lime/10 flex items-center justify-center text-2xl border-2 border-meme-lime/20">
                      {isConnected && address ? address.slice(2, 4).toUpperCase() : "?"}
                    </div>
                    <div>
                      <div className="text-sm font-medium">{t("avatar")}</div>
                      <div className="text-xs text-okx-text-tertiary">{t("avatarDesc")}</div>
                    </div>
                  </div>

                  {/* Nickname */}
                  <div>
                    <label className="block text-sm font-medium mb-2">{t("nickname")}</label>
                    <div className="flex gap-3">
                      <input
                        type="text"
                        value={nickname}
                        onChange={(e) => setNickname(e.target.value)}
                        placeholder={t("nicknamePlaceholder")}
                        className="flex-1 meme-input px-4 py-2.5"
                        maxLength={20}
                      />
                      <button
                        onClick={() => {
                          localStorage.setItem("user_nickname", nickname);
                          showToast(t("saved"), "success");
                        }}
                        className="meme-btn-primary px-6 py-2.5"
                      >
                        {t("save")}
                      </button>
                    </div>
                  </div>

                  {/* Wallet Address */}
                  <div>
                    <label className="block text-sm font-medium mb-2">{t("walletAddress")}</label>
                    <div className="flex gap-3">
                      <div className="flex-1 meme-input px-4 py-2.5 text-okx-text-tertiary font-mono text-sm">
                        {isConnected && address ? address : t("notConnected")}
                      </div>
                      {isConnected && address && (
                        <button
                          onClick={() => { navigator.clipboard.writeText(address); showToast(t("copied"), "success"); }}
                          className="px-4 py-2.5 bg-okx-bg-hover border border-okx-border-primary rounded-xl text-sm hover:border-okx-border-hover transition-colors"
                        >
                          {tCommon("copyAddress")}
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Chain */}
                  <div>
                    <label className="block text-sm font-medium mb-2">{t("currentChain")}</label>
                    <div className="meme-input px-4 py-2.5 text-sm flex items-center gap-2">
                      <span className="w-5 h-5 rounded-full bg-yellow-500/20 flex items-center justify-center text-xs">🔗</span>
                      BSC Testnet (Chain 97)
                    </div>
                  </div>
                </div>

                {/* Referral */}
                <div className="meme-card p-6 space-y-4">
                  <h3 className="font-bold">{t("referralInfo")}</h3>
                  <div className="flex items-center gap-3">
                    <div className="flex-1 meme-input px-4 py-2.5 text-sm font-mono text-okx-text-tertiary">
                      {isConnected && address ? `REF-${address.slice(2, 8).toUpperCase()}` : "—"}
                    </div>
                    <button
                      onClick={() => {
                        if (address) {
                          navigator.clipboard.writeText(`${window.location.origin}?ref=${address.slice(2, 8)}`);
                          showToast(t("copied"), "success");
                        }
                      }}
                      className="px-4 py-2.5 bg-okx-bg-hover border border-okx-border-primary rounded-xl text-sm hover:border-okx-border-hover transition-colors"
                    >
                      {t("copyLink")}
                    </button>
                  </div>
                  <p className="text-xs text-okx-text-tertiary">{t("referralDesc")}</p>
                </div>
              </>
            )}

            {/* ═══════════════ API TAB ═══════════════ */}
            {activeNav === "api" && (
              <>
                <div className="meme-card overflow-hidden">
                  <div className="flex items-center justify-between px-6 py-4 border-b border-okx-border-primary">
                    <div>
                      <h3 className="font-bold">{t("apiKeyManagement")}</h3>
                      <p className="text-xs text-okx-text-tertiary mt-1">{t("apiKeyManagementDesc")}</p>
                    </div>
                    <button
                      onClick={() => showToast(t("featureComingSoon"), "info")}
                      className="px-4 py-2 rounded-lg text-xs font-bold bg-meme-lime text-black hover:opacity-90 transition-opacity"
                    >
                      + {t("createApiKey")}
                    </button>
                  </div>

                  {mockApiKeys.map((api, idx) => (
                    <div key={idx} className={`flex items-center justify-between px-6 py-4 ${idx < mockApiKeys.length - 1 ? "border-b border-okx-border-primary" : ""}`}>
                      <div>
                        <div className="text-sm font-medium flex items-center gap-2">
                          {api.name}
                          <span className="text-xs text-okx-text-tertiary">{t("created")}: {api.created}</span>
                        </div>
                        <div className="text-xs text-okx-text-tertiary font-mono mt-1">{api.key}</div>
                      </div>
                      <div className="flex items-center gap-3">
                        {api.permissions.map((perm) => (
                          <span key={perm} className="meme-badge meme-badge-lime">{perm}</span>
                        ))}
                        <button
                          onClick={() => showToast(t("featureComingSoon"), "info")}
                          className="px-3 py-1.5 rounded-lg text-xs bg-okx-bg-hover border border-okx-border-primary text-okx-text-secondary hover:text-okx-text-primary transition-colors"
                        >
                          {t("configure")}
                        </button>
                        <button className="text-xs text-okx-down hover:opacity-80">{t("delete")}</button>
                      </div>
                    </div>
                  ))}
                </div>

                <div className="meme-card p-6 space-y-4">
                  <h3 className="font-bold">{t("apiDocs")}</h3>
                  <p className="text-sm text-okx-text-tertiary">{t("apiDocsDesc")}</p>
                  <div className="flex gap-3">
                    <div className="flex-1 meme-input px-4 py-3 text-xs font-mono text-okx-text-tertiary">
                      REST API: https://api.memeperp.com/v1
                    </div>
                    <div className="flex-1 meme-input px-4 py-3 text-xs font-mono text-okx-text-tertiary">
                      WebSocket: wss://ws.memeperp.com/v1
                    </div>
                  </div>
                </div>
              </>
            )}

            {/* ═══════════════ NOTIFICATIONS TAB ═══════════════ */}
            {activeNav === "notifications" && (
              <>
                <div className="meme-card overflow-hidden">
                  <div className="px-6 py-4 border-b border-okx-border-primary">
                    <h3 className="font-bold">{t("tradeNotifications")}</h3>
                    <p className="text-xs text-okx-text-tertiary mt-1">{t("tradeNotificationsDesc")}</p>
                  </div>

                  <div className="flex items-center justify-between px-6 py-4 border-b border-okx-border-primary">
                    <div>
                      <div className="text-sm font-medium">{t("orderFillNotif")}</div>
                      <div className="text-xs text-okx-text-tertiary">{t("orderFillNotifDesc")}</div>
                    </div>
                    <Toggle enabled={notifTrade} onChange={(v) => { setNotifTrade(v); saveNotifPrefs("trade", v); }} />
                  </div>

                  <div className="flex items-center justify-between px-6 py-4 border-b border-okx-border-primary">
                    <div>
                      <div className="text-sm font-medium">{t("priceAlertNotif")}</div>
                      <div className="text-xs text-okx-text-tertiary">{t("priceAlertNotifDesc")}</div>
                    </div>
                    <Toggle enabled={notifPrice} onChange={(v) => { setNotifPrice(v); saveNotifPrefs("price", v); }} />
                  </div>

                  <div className="flex items-center justify-between px-6 py-4">
                    <div>
                      <div className="text-sm font-medium">{t("liquidationNotif")}</div>
                      <div className="text-xs text-okx-text-tertiary">{t("liquidationNotifDesc")}</div>
                    </div>
                    <Toggle enabled={notifLiquidation} onChange={(v) => { setNotifLiquidation(v); saveNotifPrefs("liquidation", v); }} />
                  </div>
                </div>

                <div className="meme-card overflow-hidden">
                  <div className="px-6 py-4 border-b border-okx-border-primary">
                    <h3 className="font-bold">{t("otherNotifications")}</h3>
                  </div>

                  <div className="flex items-center justify-between px-6 py-4 border-b border-okx-border-primary">
                    <div>
                      <div className="text-sm font-medium">{t("systemNotif")}</div>
                      <div className="text-xs text-okx-text-tertiary">{t("systemNotifDesc")}</div>
                    </div>
                    <Toggle enabled={notifSystem} onChange={(v) => { setNotifSystem(v); saveNotifPrefs("system", v); }} />
                  </div>

                  <div className="flex items-center justify-between px-6 py-4">
                    <div>
                      <div className="text-sm font-medium">{t("emailNotif")}</div>
                      <div className="text-xs text-okx-text-tertiary">{t("emailNotifDesc")}</div>
                    </div>
                    <Toggle enabled={notifEmail} onChange={(v) => { setNotifEmail(v); saveNotifPrefs("email", v); }} />
                  </div>
                </div>
              </>
            )}

            {/* ═══════════════ FEES TAB ═══════════════ */}
            {activeNav === "fees" && (
              <div className="meme-card p-6 space-y-6">
                <h3 className="font-bold">{t("tradeSettings")}</h3>

                <div>
                  <label className="block text-sm font-medium mb-2">{t("slippageTolerance")} (%)</label>
                  <div className="flex gap-2">
                    <input
                      type="number"
                      value={localSlippage}
                      onChange={(e) => setLocalSlippage(e.target.value)}
                      className="flex-1 meme-input px-4 py-2"
                      step="0.1" min="0" max="50"
                    />
                    {["0.5", "1", "2"].map((v) => (
                      <button key={v} onClick={() => setLocalSlippage(v)} className="px-4 py-2 bg-okx-bg-hover border border-okx-border-primary rounded-xl text-sm hover:border-okx-border-hover transition-colors">
                        {v}%
                      </button>
                    ))}
                  </div>
                  <p className="text-xs text-okx-text-tertiary mt-2">{t("slippageHint")}: {preferences.slippageTolerance}%</p>
                </div>

                <div>
                  <label className="block text-sm font-medium mb-2">{t("transactionDeadline")} ({t("seconds")})</label>
                  <div className="flex gap-2">
                    <input
                      type="number"
                      value={localDeadline}
                      onChange={(e) => setLocalDeadline(e.target.value)}
                      className="flex-1 meme-input px-4 py-2"
                      step="60" min="60" max="3600"
                    />
                    {[
                      { label: `10 ${t("minutes")}`, val: "600" },
                      { label: `20 ${t("minutes")}`, val: "1200" },
                      { label: `30 ${t("minutes")}`, val: "1800" },
                    ].map((d) => (
                      <button key={d.val} onClick={() => setLocalDeadline(d.val)} className="px-4 py-2 bg-okx-bg-hover border border-okx-border-primary rounded-xl text-sm hover:border-okx-border-hover transition-colors">
                        {d.label}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="flex gap-3">
                  <button onClick={handleSave} className="meme-btn-primary px-6 py-2.5">{t("save")}</button>
                  <button
                    onClick={() => { setLocalSlippage("1"); setLocalDeadline("1200"); setSlippageTolerance(1); setTransactionDeadline(1200); }}
                    className="px-6 py-2.5 bg-okx-bg-hover border border-okx-border-primary rounded-xl text-sm hover:border-okx-border-hover transition-colors"
                  >
                    {t("reset")}
                  </button>
                </div>
              </div>
            )}

            {/* ═══════════════ APPEARANCE TAB ═══════════════ */}
            {activeNav === "appearance" && mounted && (
              <>
                <div className="meme-card p-6 space-y-6">
                  <h3 className="font-bold">{t("themeSettings")}</h3>
                  <div className="grid grid-cols-3 gap-4">
                    {(["dark", "light", "system"] as AppTheme[]).map((themeOpt) => (
                      <button
                        key={themeOpt}
                        onClick={() => setTheme(themeOpt)}
                        className={`p-4 rounded-xl border-2 transition-all text-center ${
                          preferences.theme === themeOpt
                            ? "border-meme-lime bg-meme-lime/5"
                            : "border-okx-border-primary hover:border-okx-border-hover"
                        }`}
                      >
                        <div className="text-2xl mb-2">
                          {themeOpt === "dark" ? "🌙" : themeOpt === "light" ? "☀️" : "💻"}
                        </div>
                        <div className="text-sm font-medium">{t(`theme_${themeOpt}`)}</div>
                      </button>
                    ))}
                  </div>
                </div>

                <div className="meme-card p-6 space-y-6">
                  <h3 className="font-bold">{t("languageSettings")}</h3>
                  <div className="grid grid-cols-2 gap-3">
                    {locales.map((locale) => (
                      <button
                        key={locale}
                        onClick={() => changeLocale(locale as Locale)}
                        className={`flex items-center gap-3 p-4 rounded-xl border-2 transition-all ${
                          currentLocale === locale
                            ? "border-meme-lime bg-meme-lime/5"
                            : "border-okx-border-primary hover:border-okx-border-hover"
                        }`}
                      >
                        <span className="text-2xl">{localeFlags[locale as Locale]}</span>
                        <div className="text-left">
                          <div className="text-sm font-medium">{localeNames[locale as Locale]}</div>
                          <div className="text-xs text-okx-text-tertiary">{locale.toUpperCase()}</div>
                        </div>
                        {currentLocale === locale && (
                          <svg className="w-5 h-5 ml-auto text-meme-lime" fill="currentColor" viewBox="0 0 20 20">
                            <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                          </svg>
                        )}
                      </button>
                    ))}
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
