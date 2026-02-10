"use client";

import React, { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAccount } from "wagmi";
import { formatEther } from "viem";
import { Navbar } from "@/components/layout/Navbar";
import { useTranslations } from "next-intl";
import { useToast } from "@/components/shared/Toast";
import { ImageUpload } from "@/components/shared/ImageUpload";
import { useCreateMemeToken } from "@/hooks/spot/useCreateMemeToken";
import { NETWORK_CONFIG } from "@/lib/contracts";
import { createTokenMetadata } from "@/lib/api/tokenMetadata";

/**
 * 创建 Meme 代币页面 - Pump.fun 风格
 */
export default function CreateTokenPage() {
  const router = useRouter();
  const { address, isConnected, isReconnecting } = useAccount();
  const [mounted, setMounted] = useState(false);

  // 代币基本信息
  const [tokenName, setTokenName] = useState("");
  const [tokenSymbol, setTokenSymbol] = useState("");
  const [description, setDescription] = useState("");
  const [logoUrl, setLogoUrl] = useState("");
  const [logoIpfsHash, setLogoIpfsHash] = useState("");

  // 社交链接
  const [website, setWebsite] = useState("");
  const [twitter, setTwitter] = useState("");
  const [telegram, setTelegram] = useState("");
  const [discord, setDiscord] = useState("");

  // 初始购买金额
  const [initialBuyEth, setInitialBuyEth] = useState("");

  // 展开社交链接
  const [showSocials, setShowSocials] = useState(false);

  // i18n
  const tc = useTranslations("common");
  const t = useTranslations("create.memeToken");
  const tErrors = useTranslations("errors");
  const { showToast } = useToast();

  // 使用创建代币 hook
  const {
    createToken,
    isPending,
    isConfirming,
    isConfirmed,
    isTransactionFailed,
    step,
    txHash,
    createdTokenAddress,
    error,
    serviceFee,
    serviceFeeEth,
    reset,
  } = useCreateMemeToken();

  useEffect(() => {
    setMounted(true);
  }, []);

  // 监听创建成功
  useEffect(() => {
    const saveMetadataAndRedirect = async () => {
      if (isConfirmed && createdTokenAddress && address) {
        // 保存代币元数据到后端
        try {
          const instId = `${tokenSymbol}-USDT-SWAP`;
          await createTokenMetadata({
            instId,
            tokenAddress: createdTokenAddress,
            name: tokenName,
            symbol: tokenSymbol,
            description,
            logoUrl: logoUrl || logoIpfsHash,
            imageUrl: logoUrl || logoIpfsHash,
            website,
            twitter,
            telegram,
            discord,
            creatorAddress: address,
            totalSupply: "1000000.0", // 1M tokens in base units
            initialBuyAmount: initialBuyEth || undefined,
          });
          console.log("Token metadata saved successfully");
        } catch (error) {
          console.error("Failed to save token metadata:", error);
          // 不阻止跳转，即使保存失败
        }

        showToast(t("tokenCreated"), "success");
        router.push(`/trade/${createdTokenAddress}`);
      }
    };

    saveMetadataAndRedirect();
  }, [isConfirmed, createdTokenAddress, address, tokenName, tokenSymbol, description, logoUrl, logoIpfsHash, website, twitter, telegram, discord, initialBuyEth, router, showToast, t]);

  // 监听交易失败
  useEffect(() => {
    if (isTransactionFailed) {
      showToast(tErrors("unknown"), "error");
      reset();
    }
  }, [isTransactionFailed, showToast, reset, tErrors]);

  // 创建代币
  const handleCreateToken = async () => {
    if (!tokenName || !tokenSymbol) {
      showToast(t("fillNameAndSymbol"), "warning");
      return;
    }

    if (!isConnected || !address) {
      showToast(tc("connectWalletFirst"), "warning");
      return;
    }

    try {
      const metadata = {
        name: tokenName,
        symbol: tokenSymbol,
        description,
        image: logoUrl || logoIpfsHash,
        external_url: website,
        attributes: [
          { trait_type: "twitter", value: twitter },
          { trait_type: "telegram", value: telegram },
          { trait_type: "discord", value: discord },
        ].filter(attr => attr.value),
      };

      const metadataURI = logoIpfsHash
        ? `ipfs://${logoIpfsHash}`
        : `data:application/json;base64,${btoa(JSON.stringify(metadata))}`;

      await createToken({
        name: tokenName,
        symbol: tokenSymbol,
        metadataURI,
        initialBuyEth: initialBuyEth || undefined,
      });
    } catch (err) {
      console.error("Create token error:", err);
      const errorMessage = err instanceof Error ? err.message : tErrors("unknown");
      showToast(errorMessage, "error");
    }
  };

  const isCreating = isPending || isConfirming;

  if (!mounted) {
    return (
      <main className="min-h-screen bg-okx-bg-primary text-okx-text-primary">
        <div className="flex items-center justify-center min-h-screen">
          <div className="w-10 h-10 border-4 border-okx-up border-t-transparent rounded-full animate-spin"></div>
        </div>
      </main>
    );
  }

  const showWalletLoading = isReconnecting;
  const effectivelyConnected = isConnected && !isReconnecting;

  return (
    <main className="min-h-screen bg-okx-bg-primary text-okx-text-primary">
      <Navbar />

      {/* 背景装饰 */}
      <div className="fixed inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-0 left-1/4 w-96 h-96 bg-okx-up/10 rounded-full blur-[128px]"></div>
        <div className="absolute bottom-0 right-1/4 w-96 h-96 bg-okx-up/5 rounded-full blur-[128px]"></div>
      </div>

      <div className="relative max-w-lg mx-auto px-4 py-8">
        {/* 标题区域 */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center gap-2 bg-okx-up/10 border border-okx-up/30 rounded-full px-4 py-1.5 mb-4">
            <span className="text-2xl">🚀</span>
            <span className="text-okx-up text-sm font-medium">{t("launchOnBase")}</span>
          </div>
          <h1 className="text-4xl font-black mb-3 bg-gradient-to-r from-okx-text-primary via-okx-up to-okx-accent bg-clip-text text-transparent">
            {t("title")}
          </h1>
          <p className="text-okx-text-secondary text-sm">
            {t("subtitle")}
          </p>
        </div>

        {/* 主表单卡片 */}
        <div className="bg-okx-bg-card border border-okx-border-primary rounded-2xl overflow-hidden">
          {/* Logo 上传区域 */}
          <div className="p-6 border-b border-okx-border-primary bg-gradient-to-b from-okx-bg-hover to-transparent">
            <div className="flex justify-center">
              <div className="relative group">
                <div className="absolute -inset-1 bg-gradient-to-r from-okx-up to-okx-accent rounded-full opacity-30 blur group-hover:opacity-50 transition-opacity"></div>
                <ImageUpload
                  value={logoUrl}
                  onChange={(url, hash) => {
                    setLogoUrl(url);
                    setLogoIpfsHash(hash);
                  }}
                  label=""
                  hint=""
                  size="lg"
                />
              </div>
            </div>
            <p className="text-center text-okx-text-tertiary text-xs mt-3">{t("uploadLogo")}</p>
          </div>

          {/* 表单主体 */}
          <div className="p-6 space-y-5">
            {/* 名称和符号 */}
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-okx-text-secondary text-xs font-medium mb-2 uppercase tracking-wider">
                  {t("nameLabel")} <span className="text-[#FF3B30]">*</span>
                </label>
                <input
                  type="text"
                  value={tokenName}
                  onChange={(e) => setTokenName(e.target.value)}
                  placeholder={t("namePlaceholder")}
                  className="w-full bg-okx-bg-secondary border border-okx-border-secondary rounded-xl px-4 py-3 text-okx-text-primary placeholder:text-okx-text-tertiary focus:outline-none focus:border-okx-up focus:ring-1 focus:ring-okx-up/50 transition-all"
                />
              </div>
              <div>
                <label className="block text-okx-text-secondary text-xs font-medium mb-2 uppercase tracking-wider">
                  {t("symbolLabel")} <span className="text-[#FF3B30]">*</span>
                </label>
                <input
                  type="text"
                  value={tokenSymbol}
                  onChange={(e) => setTokenSymbol(e.target.value.toUpperCase())}
                  placeholder={t("symbolPlaceholder")}
                  maxLength={10}
                  className="w-full bg-okx-bg-secondary border border-okx-border-secondary rounded-xl px-4 py-3 text-okx-text-primary placeholder:text-okx-text-tertiary focus:outline-none focus:border-okx-up focus:ring-1 focus:ring-okx-up/50 transition-all uppercase"
                />
              </div>
            </div>

            {/* 描述 */}
            <div>
              <label className="block text-okx-text-secondary text-xs font-medium mb-2 uppercase tracking-wider">
                {t("descriptionLabel")}
              </label>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder={t("descriptionPlaceholder")}
                rows={3}
                className="w-full bg-okx-bg-secondary border border-okx-border-secondary rounded-xl px-4 py-3 text-okx-text-primary placeholder:text-okx-text-tertiary focus:outline-none focus:border-okx-up focus:ring-1 focus:ring-okx-up/50 transition-all resize-none"
              />
            </div>

            {/* 社交链接折叠区 */}
            <div>
              <button
                onClick={() => setShowSocials(!showSocials)}
                className="flex items-center gap-2 text-okx-text-secondary text-sm hover:text-okx-text-primary transition-colors"
              >
                <span className={`transform transition-transform ${showSocials ? 'rotate-90' : ''}`}>▶</span>
                {t("addSocialLinks")}
              </button>

              {showSocials && (
                <div className="grid grid-cols-2 gap-3 mt-4">
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-okx-text-tertiary">🌐</span>
                    <input
                      type="url"
                      value={website}
                      onChange={(e) => setWebsite(e.target.value)}
                      placeholder={t("websitePlaceholder")}
                      className="w-full bg-okx-bg-secondary border border-okx-border-secondary rounded-lg pl-9 pr-3 py-2.5 text-okx-text-primary placeholder:text-okx-text-tertiary focus:outline-none focus:border-okx-up text-sm"
                    />
                  </div>
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-okx-text-tertiary">𝕏</span>
                    <input
                      type="url"
                      value={twitter}
                      onChange={(e) => setTwitter(e.target.value)}
                      placeholder={t("twitterPlaceholder")}
                      className="w-full bg-okx-bg-secondary border border-okx-border-secondary rounded-lg pl-9 pr-3 py-2.5 text-okx-text-primary placeholder:text-okx-text-tertiary focus:outline-none focus:border-okx-up text-sm"
                    />
                  </div>
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-okx-text-tertiary">✈️</span>
                    <input
                      type="url"
                      value={telegram}
                      onChange={(e) => setTelegram(e.target.value)}
                      placeholder={t("telegramPlaceholder")}
                      className="w-full bg-okx-bg-secondary border border-okx-border-secondary rounded-lg pl-9 pr-3 py-2.5 text-okx-text-primary placeholder:text-okx-text-tertiary focus:outline-none focus:border-okx-up text-sm"
                    />
                  </div>
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-okx-text-tertiary">💬</span>
                    <input
                      type="url"
                      value={discord}
                      onChange={(e) => setDiscord(e.target.value)}
                      placeholder={t("discordPlaceholder")}
                      className="w-full bg-okx-bg-secondary border border-okx-border-secondary rounded-lg pl-9 pr-3 py-2.5 text-okx-text-primary placeholder:text-okx-text-tertiary focus:outline-none focus:border-okx-up text-sm"
                    />
                  </div>
                </div>
              )}
            </div>

            {/* 初始购买 */}
            <div className="bg-okx-bg-secondary border border-okx-border-secondary rounded-xl p-4">
              <div className="flex items-center justify-between mb-3">
                <span className="text-okx-text-secondary text-sm">{t("initialBuyTitle")}</span>
                <span className="text-xs text-okx-text-tertiary">{t("initialBuySubtitle")}</span>
              </div>
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  value={initialBuyEth}
                  onChange={(e) => setInitialBuyEth(e.target.value)}
                  placeholder="0.00"
                  className="flex-1 bg-transparent text-2xl font-bold text-okx-text-primary placeholder:text-okx-text-tertiary focus:outline-none"
                />
                <div className="flex items-center gap-2 bg-okx-bg-hover rounded-lg px-3 py-2">
                  <div className="w-6 h-6 rounded-full bg-okx-accent flex items-center justify-center">
                    <span className="text-xs">Ξ</span>
                  </div>
                  <span className="font-bold text-okx-text-primary">ETH</span>
                </div>
              </div>
              {/* 快捷金额按钮 */}
              <div className="flex gap-2 mt-3">
                {["0.01", "0.05", "0.1", "0.5", "1"].map(val => (
                  <button
                    key={val}
                    onClick={() => setInitialBuyEth(val)}
                    className={`flex-1 py-1.5 text-xs font-medium rounded-lg border transition-all ${
                      initialBuyEth === val
                        ? "bg-okx-up/20 border-okx-up text-okx-up"
                        : "bg-okx-bg-hover border-okx-border-secondary text-okx-text-secondary hover:border-okx-border-hover hover:text-okx-text-primary"
                    }`}
                  >
                    {val}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* 代币参数信息条 */}
          <div className="px-6 py-4 bg-okx-bg-secondary border-t border-okx-border-primary">
            <div className="flex items-center justify-between text-xs">
              <div className="flex items-center gap-4">
                <div className="flex items-center gap-1.5">
                  <span className="text-okx-text-tertiary">{t("tokenSupply")}</span>
                  <span className="text-okx-text-primary font-medium">1B</span>
                </div>
                <div className="w-px h-3 bg-okx-border-secondary"></div>
                <div className="flex items-center gap-1.5">
                  <span className="text-okx-text-tertiary">{t("graduation")}</span>
                  <span className="text-okx-up font-medium">~5.16 ETH</span>
                </div>
                <div className="w-px h-3 bg-okx-border-secondary"></div>
                <div className="flex items-center gap-1.5">
                  <span className="text-okx-text-tertiary">{t("feeRate")}</span>
                  <span className="text-okx-text-primary font-medium">1%</span>
                </div>
              </div>
              <div className="text-okx-text-tertiary">
                {t("bondingCurve")}
              </div>
            </div>
          </div>

          {/* 创建按钮区域 */}
          <div className="p-6 bg-okx-bg-secondary">
            {showWalletLoading ? (
              <div className="flex items-center justify-center py-4">
                <div className="w-5 h-5 border-2 border-okx-up border-t-transparent rounded-full animate-spin"></div>
                <span className="ml-3 text-okx-text-secondary text-sm">{tc("syncingWallet")}</span>
              </div>
            ) : !effectivelyConnected ? (
              <div className="bg-okx-warning/10 border border-okx-warning/30 rounded-xl p-4">
                <p className="text-okx-warning text-sm text-center font-medium">{tc("connectWalletFirst")}</p>
              </div>
            ) : (
              <button
                onClick={handleCreateToken}
                disabled={isCreating || !tokenName || !tokenSymbol}
                className="w-full relative group"
              >
                {/* 按钮光效 */}
                <div className="absolute -inset-0.5 bg-gradient-to-r from-okx-up to-okx-accent rounded-xl opacity-70 blur group-hover:opacity-100 transition-opacity"></div>
                <div className={`relative bg-gradient-to-r from-okx-up to-okx-accent text-black px-6 py-4 rounded-xl font-bold text-lg transition-all ${
                  isCreating || !tokenName || !tokenSymbol ? 'opacity-50 cursor-not-allowed' : 'hover:shadow-lg hover:shadow-okx-up/30'
                }`}>
                  {isCreating ? (
                    <span className="flex items-center justify-center gap-3">
                      <div className="w-5 h-5 border-2 border-black border-t-transparent rounded-full animate-spin"></div>
                      {step === "creating" && t("submitTx")}
                      {step === "confirming" && t("waitingConfirm")}
                      {step === "done" && t("createSuccess")}
                    </span>
                  ) : (
                    <span className="flex items-center justify-center gap-2">
                      🚀 {t("createTokenButton")}
                    </span>
                  )}
                </div>
              </button>
            )}

            {/* 费用提示 */}
            <div className="mt-4 text-center space-y-1">
              <p className="text-okx-text-tertiary text-xs">
                {t("serviceFee")} {serviceFeeEth} ETH + {t("gas")}
                {initialBuyEth && parseFloat(initialBuyEth) > 0 && (
                  <span className="text-okx-up"> + {initialBuyEth} ETH {t("buyAmount")}</span>
                )}
              </p>
              {txHash && (
                <a
                  href={`${NETWORK_CONFIG.BLOCK_EXPLORER}/tx/${txHash}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-okx-up text-xs hover:underline"
                >
                  {t("viewTransaction")} ↗
                </a>
              )}
            </div>
          </div>
        </div>

        {/* 底部提示 */}
        <div className="mt-6 text-center">
          <p className="text-okx-text-tertiary text-xs">
            {t("termsAgree")} <a href="#" className="text-okx-text-secondary hover:text-okx-text-primary">{t("termsOfService")}</a>
          </p>
        </div>
      </div>
    </main>
  );
}
