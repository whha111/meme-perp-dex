"use client";

/**
 * PerpetualOrderPanelV2 - 用户对赌模式交易面板
 *
 * 新架构流程：
 * 1. 用户签名 EIP-712 订单（链下，不花 Gas）
 * 2. 撮合引擎配对多空订单（链下）
 * 3. 撮合引擎批量提交配对结果（链上）
 * 4. Settlement 合约验证签名并执行结算
 * 5. 盈亏直接在多空之间转移，保险基金仅用于穿仓
 */

import React, { useState, useMemo, useCallback, useEffect } from "react";
import { useAccount } from "wagmi";
import { useConnectModal } from "@rainbow-me/rainbowkit";
import { useTranslations } from "next-intl";
import { formatEther, type Address } from "viem";
import { useToast } from "@/components/shared/Toast";
import { AccountBalance } from "@/components/trading/AccountBalance";
import {
  usePerpetualStore,
  useLeverageSettings,
  useOrderForm,
  PositionSide,
  MarginMode,
} from "@/lib/stores/perpetualStore";
import { usePerpetualV2 } from "@/hooks/usePerpetualV2";
import { useTradingWallet } from "@/hooks/useTradingWallet";
import { useETHPrice } from "@/hooks/useETHPrice";
import { Copy, Check, Key, RefreshCw, ExternalLink } from "lucide-react";

// Leverage options
const LEVERAGE_OPTIONS = [1, 2, 3, 5, 10, 20, 50, 75, 100];

interface PerpetualOrderPanelV2Props {
  symbol: string;
  displaySymbol?: string;
  tokenAddress?: Address;
  className?: string;
  isPerpEnabled?: boolean;
}

export function PerpetualOrderPanelV2({
  symbol,
  displaySymbol,
  tokenAddress,
  className,
  isPerpEnabled = true,
}: PerpetualOrderPanelV2Props) {
  const { address, isConnected } = useAccount();
  const { openConnectModal } = useConnectModal();
  const { showToast } = useToast();
  const t = useTranslations("perp");
  const tc = useTranslations("common");
  const tw = useTranslations("tradingWallet");

  const tokenSymbol = displaySymbol || symbol;

  // ETH 价格
  const { price: ethPrice } = useETHPrice();

  // Trading Wallet Hook - 签名派生钱包
  const {
    address: tradingWalletAddress,
    ethBalance: tradingWalletBalance,
    formattedEthBalance: formattedTradingWalletBalance,
    isInitialized: isTradingWalletInitialized,
    isLoading: isTradingWalletLoading,
    error: tradingWalletError,
    generateWallet,
    refreshBalance: refreshTradingWalletBalance,
    exportKey,
    disconnect: disconnectTradingWallet,
    getSignature,
    wrapAndDeposit,
    isWrappingAndDepositing,
  } = useTradingWallet();

  // 获取交易钱包签名（用于订单签名）
  const tradingWalletSignature = getSignature();

  // Deposit Modal 状态
  const [showDepositModal, setShowDepositModal] = useState(false);
  const [copied, setCopied] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showPrivateKey, setShowPrivateKey] = useState(false);
  const [privateKeyData, setPrivateKeyData] = useState<{ privateKey: string; warning: string } | null>(null);

  // Wrap and Deposit 状态
  const [wrapAmount, setWrapAmount] = useState("");

  // V2 Hook - 使用 Settlement 合约 + 撮合引擎
  // 传入交易钱包信息用于签名订单
  const {
    balance,
    positions,
    pendingOrders,
    orderBook,
    submitMarketOrder,
    submitLimitOrder,
    closePair,
    refreshOrderBook,
    isSigningOrder,
    isSubmittingOrder,
    isPending,
    isConfirming,
  } = usePerpetualV2({
    tradingWalletAddress: tradingWalletAddress || undefined,
    tradingWalletSignature: tradingWalletSignature || undefined,
  });

  // Store state
  const instId = `${tokenSymbol.toUpperCase()}-PERP`;
  const leverageSettings = useLeverageSettings(instId);
  const orderForm = useOrderForm();

  // Local UI state
  const [showLeverageSlider, setShowLeverageSlider] = useState(false);
  const [amountError, setAmountError] = useState<string | null>(null);

  // 单位选择: USDT / ETH / 代币
  const [amountUnit, setAmountUnit] = useState<"USDT" | "ETH" | "TOKEN">("USDT");

  // Order type state (市价/限价)
  const [orderType, setOrderType] = useState<"market" | "limit">("market");
  const [limitPrice, setLimitPrice] = useState("");

  // TP/SL state (止盈止损)
  const [showTpSl, setShowTpSl] = useState(false);
  const [takeProfit, setTakeProfit] = useState("");
  const [stopLoss, setStopLoss] = useState("");

  // Get store actions
  const updateOrderForm = usePerpetualStore.getState().updateOrderForm;
  const updateLeverage = usePerpetualStore.getState().updateLeverage;
  const updateMarginMode = usePerpetualStore.getState().updateMarginMode;

  // Refresh order book when token changes
  useEffect(() => {
    if (tokenAddress) {
      refreshOrderBook(tokenAddress);
    }
  }, [tokenAddress, refreshOrderBook]);

  // Derive state from store
  const side = orderForm.side;
  const marginMode = orderForm.marginMode;
  const leverage = orderForm.leverage;
  const amount = orderForm.size;

  // Handlers
  const setSide = (newSide: PositionSide) => updateOrderForm({ side: newSide });
  const setMarginMode = (mode: MarginMode) => updateMarginMode(instId, mode);
  const setLeverage = (lev: number) => updateLeverage(instId, lev);

  const setAmount = (val: string) => {
    updateOrderForm({ size: val });
    if (val && !/^\d*\.?\d*$/.test(val)) {
      setAmountError("Please enter a valid number");
    } else {
      setAmountError(null);
    }
  };

  // 代币价格 (USD) - 从 orderBook.lastPrice 获取 (1e12 精度)
  const tokenPriceUSD = useMemo(() => {
    if (orderBook?.lastPrice) {
      return Number(orderBook.lastPrice) / 1e12;
    }
    return 0;
  }, [orderBook?.lastPrice]);

  // 根据用户选择的单位，统一换算成仓位价值 (USDT) 和 Meme 币数量
  const { positionValueUSDT, positionSizeToken } = useMemo(() => {
    const inputAmount = parseFloat(amount) || 0;
    if (inputAmount <= 0 || tokenPriceUSD <= 0) {
      return { positionValueUSDT: 0, positionSizeToken: 0 };
    }

    let valueUSDT = 0;
    let tokenAmount = 0;

    if (amountUnit === "USDT") {
      valueUSDT = inputAmount;
      tokenAmount = inputAmount / tokenPriceUSD;
    } else if (amountUnit === "ETH") {
      valueUSDT = inputAmount * (ethPrice || 0);
      tokenAmount = valueUSDT / tokenPriceUSD;
    } else if (amountUnit === "TOKEN") {
      tokenAmount = inputAmount;
      valueUSDT = inputAmount * tokenPriceUSD;
    }

    return { positionValueUSDT: valueUSDT, positionSizeToken: tokenAmount };
  }, [amount, amountUnit, ethPrice, tokenPriceUSD]);

  // 计算所需保证金 (USD)
  const requiredMarginUSD = useMemo(() => {
    if (positionValueUSDT <= 0) return 0;
    const marginUSD = positionValueUSDT / leverage;
    const feeUSD = positionValueUSDT * 0.001; // 0.1% fee
    return marginUSD + feeUSD;
  }, [positionValueUSDT, leverage]);

  // 格式化保证金显示
  const requiredMarginDisplay = useMemo(() => {
    if (requiredMarginUSD <= 0) return "$0.00";
    return `$${requiredMarginUSD.toFixed(2)}`;
  }, [requiredMarginUSD]);

  // Check if balance is sufficient (使用 Settlement 合约 USD 余额)
  const { hasSufficientBalance, availableBalanceUSD } = useMemo(() => {
    // Settlement 合约余额 (USD, 1e6 精度)
    const settlementBalanceUSD = balance ? Number(balance.available) / 1e6 : 0;
    return {
      hasSufficientBalance: settlementBalanceUSD >= requiredMarginUSD,
      availableBalanceUSD: settlementBalanceUSD,
    };
  }, [balance, requiredMarginUSD]);

  // Find positions for current token
  const currentTokenPositions = useMemo(() => {
    if (!tokenAddress) return [];
    return positions.filter(
      (p) => p.token.toLowerCase() === tokenAddress.toLowerCase()
    );
  }, [positions, tokenAddress]);

  // Place order handler
  const handlePlaceOrder = useCallback(async () => {
    if (!isConnected) {
      openConnectModal?.();
      return;
    }

    if (!tokenAddress) {
      showToast("Token address not available", "error");
      return;
    }

    if (!amount || parseFloat(amount) <= 0) {
      showToast("请输入有效的数量", "error");
      return;
    }

    if (positionSizeToken <= 0) {
      showToast("无法计算仓位大小，请检查价格", "error");
      return;
    }

    // Validate limit price for limit orders
    if (orderType === "limit" && (!limitPrice || parseFloat(limitPrice) <= 0)) {
      showToast(t("enterLimitPrice") || "请输入限价", "error");
      return;
    }

    if (!hasSufficientBalance) {
      showToast("余额不足，请先充值", "error");
      return;
    }

    if (!isTradingWalletInitialized) {
      showToast("请先创建交易钱包", "error");
      return;
    }

    try {
      const isLong = side === "long";
      // 使用 Meme 代币数量 (行业标准)
      const sizeTokenString = positionSizeToken.toFixed(18);

      console.log(`[Order] Unit: ${amountUnit}, Input: ${amount}, Value: $${positionValueUSDT.toFixed(2)}, Token Amount: ${positionSizeToken.toLocaleString()}`);

      showToast(
        `正在签名 ${isLong ? "做多" : "做空"} ${positionSizeToken.toLocaleString()} ${tokenSymbol} ($${positionValueUSDT.toFixed(2)})...`,
        "info"
      );

      let result;
      if (orderType === "market") {
        result = await submitMarketOrder(tokenAddress, isLong, sizeTokenString, leverage);
      } else {
        result = await submitLimitOrder(tokenAddress, isLong, sizeTokenString, leverage, limitPrice);
      }

      if (result.success) {
        showToast(
          `${orderType === "limit" ? "Limit" : "Market"} order submitted! ${result.orderId ? `ID: ${result.orderId}` : ""}`,
          "success"
        );
        updateOrderForm({ size: "" });
        setAmount("");
        if (orderType === "limit") setLimitPrice("");
      } else {
        showToast(result.error || "Order submission failed", "error");
      }
    } catch (error) {
      console.error("[Order Error]", error);
      showToast(
        error instanceof Error ? error.message : "Order failed",
        "error"
      );
    }
  }, [
    isConnected,
    openConnectModal,
    tokenAddress,
    amount,
    orderType,
    limitPrice,
    hasSufficientBalance,
    side,
    leverage,
    submitMarketOrder,
    submitLimitOrder,
    updateOrderForm,
    showToast,
    t,
  ]);

  // Close position handler
  const handleClosePosition = useCallback(
    async (pairId: string) => {
      if (!isConnected) {
        openConnectModal?.();
        return;
      }

      try {
        showToast("Closing position...", "info");
        const result = await closePair(pairId);

        if (result.success) {
          showToast("Position closed successfully!", "success");
        } else {
          showToast(result.error || "Failed to close position", "error");
        }
      } catch (error) {
        console.error("[Close Position Error]", error);
        showToast(
          error instanceof Error ? error.message : "Close failed",
          "error"
        );
      }
    },
    [isConnected, openConnectModal, closePair, showToast]
  );

  return (
    <div className={`bg-okx-bg-secondary rounded-lg ${className}`}>
      {/* V2 Architecture Badge */}
      <div className="p-2 bg-gradient-to-r from-purple-900/30 to-blue-900/30 border-b border-purple-500/30">
        <div className="flex items-center justify-center gap-2 text-[11px] text-purple-300">
          <span className="w-2 h-2 bg-purple-400 rounded-full animate-pulse" />
          <span>Peer-to-Peer Trading (V2)</span>
        </div>
      </div>

      {/* Account Section - 简洁版 */}
      <div className="p-3 border-b border-okx-border-primary">
        {!isConnected ? (
          // 未连接钱包
          <button
            onClick={() => openConnectModal?.()}
            className="w-full py-2.5 text-[13px] font-medium bg-[#A3E635] hover:bg-[#84cc16] text-black rounded transition-colors"
          >
            {tc("connectWallet") || "Connect Wallet"}
          </button>
        ) : !isTradingWalletInitialized ? (
          // 未创建交易钱包 - 简洁的初始化按钮
          <div>
            <div className="flex items-center justify-between mb-2">
              <span className="text-okx-text-secondary text-[12px]">{tw("account")}</span>
              <span className="text-okx-text-tertiary text-[12px]">{tw("notActivated")}</span>
            </div>
            {tradingWalletError && (
              <p className="text-red-400 text-[11px] mb-2">{tradingWalletError}</p>
            )}
            <button
              onClick={generateWallet}
              disabled={isTradingWalletLoading}
              className="w-full py-2 text-[12px] font-medium bg-[#A3E635] hover:bg-[#84cc16] disabled:bg-gray-600 text-black rounded transition-colors"
            >
              {isTradingWalletLoading ? tw("activating") : tw("activateAccount")}
            </button>
          </div>
        ) : (
          // 已激活 - 显示 USD 余额
          <div>
            <div className="flex items-center justify-between">
              <span className="text-okx-text-secondary text-[12px]">{tw("account")}</span>
              <div className="flex items-center gap-2">
                <span className="text-okx-text-primary text-[14px] font-semibold">
                  ${availableBalanceUSD.toFixed(2)}
                </span>
              </div>
            </div>
            <div className="flex gap-2 mt-2">
              <button
                onClick={() => setShowDepositModal(true)}
                className="flex-1 py-2 text-[12px] font-medium bg-[#A3E635] hover:bg-[#84cc16] text-black rounded transition-colors"
              >
                充值 USDT/USDC
              </button>
              <button
                onClick={() => setShowSettings(true)}
                className="px-3 py-2 text-[12px] text-okx-text-tertiary hover:text-okx-text-primary bg-okx-bg-hover rounded transition-colors"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                </svg>
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Deposit Modal - 直接集成 AccountBalance 组件 */}
      {showDepositModal && (
        <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4">
          <div className="w-full max-w-md">
            <AccountBalance onClose={() => setShowDepositModal(false)} />
          </div>
        </div>
      )}

      {/* Settings Modal */}
      {showSettings && (
        <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4">
          <div className="bg-okx-bg-secondary rounded-xl w-full max-w-sm border border-okx-border-primary">
            {/* Header */}
            <div className="flex items-center justify-between p-4 border-b border-okx-border-primary">
              <h3 className="text-[16px] font-semibold text-okx-text-primary">{tw("accountSettings")}</h3>
              <button
                onClick={() => setShowSettings(false)}
                className="p-1 text-okx-text-tertiary hover:text-okx-text-primary transition-colors"
              >
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            {/* Content */}
            <div className="p-4 space-y-3">
              {/* Wallet Address */}
              <div className="bg-okx-bg-primary rounded-lg p-3 border border-okx-border-primary">
                <p className="text-[11px] text-okx-text-tertiary mb-1">{tw("walletAddress")}</p>
                <p className="text-[12px] text-okx-text-primary font-mono truncate">{tradingWalletAddress}</p>
              </div>

              {/* Export Private Key */}
              <button
                onClick={() => {
                  const data = exportKey();
                  if (data) {
                    setPrivateKeyData(data);
                    setShowPrivateKey(true);
                    setShowSettings(false);
                  }
                }}
                className="w-full flex items-center justify-between p-3 bg-okx-bg-primary rounded-lg border border-okx-border-primary hover:border-okx-border-secondary transition-colors"
              >
                <div className="flex items-center gap-2">
                  <Key className="w-4 h-4 text-yellow-500" />
                  <span className="text-[13px] text-okx-text-primary">{tw("exportPrivateKey")}</span>
                </div>
                <svg className="w-4 h-4 text-okx-text-tertiary" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                </svg>
              </button>

              {/* Disconnect */}
              <button
                onClick={() => {
                  disconnectTradingWallet();
                  setShowSettings(false);
                }}
                className="w-full py-2.5 text-[13px] font-medium text-okx-down hover:text-okx-down/80 border border-okx-down/50 hover:border-okx-down/70 rounded-lg transition-colors"
              >
                {tw("disconnectAccount")}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Private Key Modal */}
      {showPrivateKey && privateKeyData && (
        <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4">
          <div className="bg-okx-bg-secondary rounded-xl w-full max-w-sm border border-okx-border-primary">
            {/* Header */}
            <div className="flex items-center justify-between p-4 border-b border-okx-border-primary">
              <div className="flex items-center gap-2">
                <Key className="w-5 h-5 text-yellow-500" />
                <h3 className="text-[16px] font-semibold text-okx-text-primary">{tw("privateKey")}</h3>
              </div>
              <button
                onClick={() => {
                  setShowPrivateKey(false);
                  setPrivateKeyData(null);
                }}
                className="p-1 text-okx-text-tertiary hover:text-okx-text-primary transition-colors"
              >
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            {/* Content */}
            <div className="p-4 space-y-4">
              {/* Warning */}
              <div className="bg-red-900/20 border border-red-700/30 rounded-lg p-3">
                <p className="text-red-400 text-[11px]">⚠️ {tw("privateKeyWarning")}</p>
              </div>

              {/* Private Key */}
              <div className="bg-okx-bg-primary rounded-lg p-3 border border-okx-border-primary">
                <p className="text-okx-text-primary font-mono text-[11px] break-all select-all">
                  {privateKeyData.privateKey}
                </p>
              </div>

              {/* Copy Button */}
              <button
                onClick={() => {
                  navigator.clipboard.writeText(privateKeyData.privateKey);
                  showToast(tc("copied"), "success");
                }}
                className="w-full py-2.5 text-[13px] font-medium bg-yellow-600 hover:bg-yellow-700 text-white rounded-lg transition-colors"
              >
                {tw("copyPrivateKey")}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Margin Mode & Leverage */}
      <div className="p-4 border-b border-okx-border-primary">
        <div className="flex gap-2 mb-3">
          <button
            onClick={() => setMarginMode("cross")}
            className={`flex-1 py-1.5 text-[12px] rounded transition-colors ${
              marginMode === "cross"
                ? "bg-okx-bg-hover text-okx-text-primary"
                : "text-okx-text-tertiary hover:text-okx-text-secondary"
            }`}
          >
            {t("cross") || "Cross"}
          </button>
          <button
            onClick={() => setMarginMode("isolated")}
            className={`flex-1 py-1.5 text-[12px] rounded transition-colors ${
              marginMode === "isolated"
                ? "bg-okx-bg-hover text-okx-text-primary"
                : "text-okx-text-tertiary hover:text-okx-text-secondary"
            }`}
          >
            {t("isolated") || "Isolated"}
          </button>
        </div>

        {/* Leverage */}
        <div className="flex items-center justify-between">
          <span className="text-okx-text-secondary text-[12px]">
            {t("leverage") || "Leverage"}
          </span>
          <button
            onClick={() => setShowLeverageSlider(!showLeverageSlider)}
            className="flex items-center gap-1 text-[14px] text-okx-text-primary font-medium hover:text-[#A3E635] transition-colors"
          >
            {leverage}x
            <svg
              className="w-3 h-3"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M19 9l-7 7-7-7"
              />
            </svg>
          </button>
        </div>

        {/* Leverage Slider */}
        {showLeverageSlider && (
          <div className="mt-3 space-y-2">
            <input
              type="range"
              min="1"
              max="100"
              value={leverage}
              onChange={(e) => setLeverage(parseInt(e.target.value))}
              className="w-full h-1 bg-okx-bg-hover rounded-lg appearance-none cursor-pointer accent-[#A3E635]"
            />
            <div className="flex justify-between text-[10px] text-okx-text-tertiary">
              {LEVERAGE_OPTIONS.map((lev) => (
                <button
                  key={lev}
                  onClick={() => setLeverage(lev)}
                  className={`px-1 py-0.5 rounded ${
                    leverage === lev
                      ? "text-[#A3E635]"
                      : "hover:text-okx-text-secondary"
                  }`}
                >
                  {lev}x
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Long/Short Tabs */}
      <div className="flex border-b border-okx-border-primary">
        <button
          onClick={() => setSide("long")}
          className={`flex-1 py-3 text-[14px] font-medium transition-colors ${
            side === "long"
              ? "text-okx-up border-b-2 border-okx-up bg-okx-up/10"
              : "text-okx-text-tertiary hover:text-okx-text-secondary"
          }`}
        >
          {t("openLong") || "Open Long"}
        </button>
        <button
          onClick={() => setSide("short")}
          className={`flex-1 py-3 text-[14px] font-medium transition-colors ${
            side === "short"
              ? "text-okx-down border-b-2 border-okx-down bg-okx-down/10"
              : "text-okx-text-tertiary hover:text-okx-text-secondary"
          }`}
        >
          {t("openShort") || "Open Short"}
        </button>
      </div>

      {/* Order Form */}
      <div className="p-4 space-y-3">
        {/* Order Type Tabs - 市价/限价 */}
        <div className="flex gap-1 bg-okx-bg-hover rounded p-0.5">
          <button
            onClick={() => setOrderType("market")}
            className={`flex-1 py-1.5 text-[12px] rounded transition-colors ${
              orderType === "market"
                ? "bg-okx-bg-primary text-okx-text-primary font-medium"
                : "text-okx-text-tertiary hover:text-okx-text-secondary"
            }`}
          >
            {t("market") || "Market"}
          </button>
          <button
            onClick={() => setOrderType("limit")}
            className={`flex-1 py-1.5 text-[12px] rounded transition-colors ${
              orderType === "limit"
                ? "bg-okx-bg-primary text-okx-text-primary font-medium"
                : "text-okx-text-tertiary hover:text-okx-text-secondary"
            }`}
          >
            {t("limit") || "Limit"}
          </button>
        </div>

        {/* Limit Price Input - 限价单价格 */}
        {orderType === "limit" && (
          <div>
            <div className="flex justify-between text-[11px] mb-1">
              <span className="text-okx-text-tertiary">
                {t("price") || "Price"}
              </span>
              <span className="text-okx-text-tertiary">USD</span>
            </div>
            <input
              type="text"
              value={limitPrice}
              onChange={(e) => setLimitPrice(e.target.value)}
              placeholder="0.00"
              className="w-full bg-okx-bg-hover border border-okx-border-primary rounded px-3 py-2 text-[14px] text-okx-text-primary placeholder:text-okx-text-tertiary outline-none focus:border-[#A3E635]"
            />
          </div>
        )}

        {/* Amount Input - 用户可选择单位 */}
        <div>
          <div className="flex justify-between items-center text-[11px] mb-1">
            <span className="text-okx-text-tertiary">开仓数量</span>
            {/* 单位切换按钮 */}
            <div className="flex gap-1 bg-okx-bg-tertiary rounded p-0.5">
              {(["USDT", "ETH", "TOKEN"] as const).map((unit) => (
                <button
                  key={unit}
                  onClick={() => {
                    setAmountUnit(unit);
                    setAmount(""); // 切换时清空输入
                  }}
                  className={`px-2 py-0.5 text-[10px] rounded transition-colors ${
                    amountUnit === unit
                      ? "bg-[#A3E635] text-black font-medium"
                      : "text-okx-text-tertiary hover:text-okx-text-secondary"
                  }`}
                >
                  {unit === "TOKEN" ? "代币" : unit}
                </button>
              ))}
            </div>
          </div>
          <div className="relative">
            <input
              type="text"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder={
                amountUnit === "USDT" ? "输入 USDT 金额" :
                amountUnit === "ETH" ? "输入 ETH 数量" :
                "输入代币数量"
              }
              className={`w-full bg-okx-bg-hover border rounded px-3 py-2 pr-20 text-[14px] text-okx-text-primary placeholder:text-okx-text-tertiary outline-none ${
                amountError
                  ? "border-okx-down focus:border-okx-down"
                  : "border-okx-border-primary focus:border-[#A3E635]"
              }`}
            />
            <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[11px] text-[#A3E635] font-medium">
              {amountUnit === "TOKEN" ? "代币" : amountUnit}
            </span>
          </div>
          {amountError && (
            <div className="text-[10px] text-okx-down mt-1">{amountError}</div>
          )}
          {/* 快捷按钮 - 根据单位显示不同选项 */}
          <div className="flex gap-2 mt-2">
            {amountUnit === "USDT" && [10, 50, 100, 500].map((val) => (
              <button
                key={val}
                onClick={() => setAmount(val.toString())}
                className="flex-1 py-1 text-[11px] text-okx-text-tertiary bg-okx-bg-hover rounded hover:text-okx-text-secondary transition-colors"
              >
                ${val}
              </button>
            ))}
            {amountUnit === "ETH" && [0.01, 0.05, 0.1, 0.5].map((val) => (
              <button
                key={val}
                onClick={() => setAmount(val.toString())}
                className="flex-1 py-1 text-[11px] text-okx-text-tertiary bg-okx-bg-hover rounded hover:text-okx-text-secondary transition-colors"
              >
                {val}
              </button>
            ))}
            {amountUnit === "TOKEN" && ["1K", "10K", "100K", "1M"].map((label, idx) => (
              <button
                key={label}
                onClick={() => setAmount([1000, 10000, 100000, 1000000][idx].toString())}
                className="flex-1 py-1 text-[11px] text-okx-text-tertiary bg-okx-bg-hover rounded hover:text-okx-text-secondary transition-colors"
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        {/* TP/SL Toggle - 止盈止损 */}
        <div>
          <button
            onClick={() => setShowTpSl(!showTpSl)}
            className="flex items-center gap-2 text-[12px] text-okx-text-secondary hover:text-okx-text-primary transition-colors"
          >
            <div className={`w-4 h-4 rounded border flex items-center justify-center transition-colors ${
              showTpSl ? "bg-[#A3E635] border-[#A3E635]" : "border-okx-border-primary"
            }`}>
              {showTpSl && (
                <svg className="w-3 h-3 text-black" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                </svg>
              )}
            </div>
            <span>TP/SL</span>
            <span className="text-[10px] text-okx-text-tertiary">({t("takeProfitStopLoss") || "Take Profit / Stop Loss"})</span>
          </button>

          {showTpSl && (
            <div className="mt-2 space-y-2 p-3 bg-okx-bg-hover/50 rounded border border-okx-border-primary">
              {/* Take Profit */}
              <div>
                <div className="flex justify-between text-[11px] mb-1">
                  <span className="text-okx-up">{t("takeProfit") || "Take Profit"}</span>
                  <span className="text-okx-text-tertiary">USD</span>
                </div>
                <input
                  type="text"
                  value={takeProfit}
                  onChange={(e) => setTakeProfit(e.target.value)}
                  placeholder={t("tpPrice") || "TP Price"}
                  className="w-full bg-okx-bg-primary border border-okx-border-primary rounded px-3 py-1.5 text-[13px] text-okx-text-primary placeholder:text-okx-text-tertiary outline-none focus:border-okx-up"
                />
              </div>
              {/* Stop Loss */}
              <div>
                <div className="flex justify-between text-[11px] mb-1">
                  <span className="text-okx-down">{t("stopLoss") || "Stop Loss"}</span>
                  <span className="text-okx-text-tertiary">USD</span>
                </div>
                <input
                  type="text"
                  value={stopLoss}
                  onChange={(e) => setStopLoss(e.target.value)}
                  placeholder={t("slPrice") || "SL Price"}
                  className="w-full bg-okx-bg-primary border border-okx-border-primary rounded px-3 py-1.5 text-[13px] text-okx-text-primary placeholder:text-okx-text-tertiary outline-none focus:border-okx-down"
                />
              </div>
            </div>
          )}
        </div>

        {/* Order Summary - 根据用户选择的单位显示 */}
        <div className="bg-okx-bg-hover rounded p-3 space-y-2 text-[12px]">
          {/* 用户输入 */}
          <div className="flex justify-between">
            <span className="text-okx-text-tertiary">开仓数量</span>
            <span className="text-okx-text-primary">
              {parseFloat(amount) || 0} {amountUnit === "TOKEN" ? "代币" : amountUnit}
            </span>
          </div>
          {/* 仓位价值 (统一换算为 USDT) */}
          <div className="flex justify-between">
            <span className="text-okx-text-tertiary">仓位价值</span>
            <span className="text-okx-text-primary">
              ≈ ${positionValueUSDT.toFixed(2)} USDT
            </span>
          </div>
          {/* 代币价格（如果选择代币单位时显示） */}
          {amountUnit === "TOKEN" && tokenPriceUSD > 0 && (
            <div className="flex justify-between">
              <span className="text-okx-text-tertiary">代币价格</span>
              <span className="text-okx-text-secondary">
                ${tokenPriceUSD < 0.0001 ? tokenPriceUSD.toExponential(4) : tokenPriceUSD.toFixed(8)}
              </span>
            </div>
          )}
          {/* 委托量 (代币数量) */}
          <div className="flex justify-between">
            <span className="text-okx-text-tertiary">委托量</span>
            <span className="text-okx-text-primary">
              {positionSizeToken >= 1000000
                ? `${(positionSizeToken / 1000000).toFixed(2)}M`
                : positionSizeToken >= 1000
                ? `${(positionSizeToken / 1000).toFixed(2)}K`
                : positionSizeToken.toFixed(2)} {tokenSymbol}
            </span>
          </div>
          {/* 所需保证金 (USD) */}
          <div className="flex justify-between">
            <span className="text-okx-text-tertiary">所需保证金</span>
            <span className="text-okx-text-primary">
              {requiredMarginDisplay}
            </span>
          </div>
          {/* 手续费 */}
          <div className="flex justify-between">
            <span className="text-okx-text-tertiary">手续费 (0.1%)</span>
            <span className="text-okx-text-primary">
              ${(positionValueUSDT * 0.001).toFixed(2)}
            </span>
          </div>
          {/* 合计所需 */}
          <div className="flex justify-between border-t border-okx-border-primary pt-2">
            <span className="text-okx-text-secondary font-medium">合计所需</span>
            <span className="text-okx-text-primary font-medium">
              {requiredMarginDisplay}
            </span>
          </div>
          {/* 账户余额 (USD) */}
          <div className="flex justify-between pt-1">
            <span className="text-okx-text-tertiary">账户余额</span>
            <span
              className={`font-medium ${
                hasSufficientBalance ? "text-okx-text-primary" : "text-okx-down"
              }`}
            >
              ${availableBalanceUSD.toFixed(2)}
            </span>
          </div>
        </div>

        {/* Info Banner */}
        <div className="bg-purple-900/20 border border-purple-500/30 rounded p-2 text-[11px] text-purple-300">
          {tw("p2pInfo")}
        </div>

        {/* Insufficient Balance Warning */}
        {!hasSufficientBalance && parseFloat(amount) > 0 && (
          <div className="bg-okx-down/10 border border-okx-down/30 rounded p-2 text-[11px] text-okx-down">
            {tw("insufficientBalance")}
          </div>
        )}

        {/* Trading Wallet Not Initialized Warning */}
        {!isTradingWalletInitialized && (
          <div className="bg-yellow-900/30 border border-yellow-500/30 rounded p-2 text-[11px] text-yellow-300">
            {tw("createTradingWalletFirst")}
          </div>
        )}

        {/* Perp Not Enabled Warning */}
        {!isPerpEnabled && (
          <div className="bg-yellow-900/20 border border-yellow-500/30 rounded p-2 text-[11px] text-yellow-400">
            {t("perpNotEnabled")}
          </div>
        )}

        {/* Submit Button */}
        <button
          onClick={handlePlaceOrder}
          disabled={
            !isPerpEnabled ||
            !amount ||
            parseFloat(amount) <= 0 ||
            isSigningOrder ||
            isSubmittingOrder ||
            isPending ||
            isConfirming ||
            (!hasSufficientBalance && parseFloat(amount) > 0) ||
            !!amountError
          }
          className={`w-full py-3 rounded font-medium text-[14px] transition-all ${
            !isPerpEnabled
              ? "bg-gray-600 text-gray-400"
              : side === "long"
              ? "bg-okx-up hover:bg-okx-up/90 text-white disabled:bg-okx-up/50"
              : "bg-okx-down hover:bg-okx-down/90 text-white disabled:bg-okx-down/50"
          } disabled:cursor-not-allowed`}
        >
          {!isPerpEnabled
            ? t("perpNotEnabled") || "Perp trading not enabled"
            : !isConnected
            ? tc("connectWallet") || "Connect Wallet"
            : !hasSufficientBalance && parseFloat(amount) > 0
            ? t("depositFirst") || "Deposit First"
            : isSigningOrder
            ? "Signing..."
            : isSubmittingOrder
            ? "Submitting..."
            : isPending
            ? "Pending..."
            : isConfirming
            ? "Confirming..."
            : side === "long"
            ? `${orderType === "limit" ? "Limit " : ""}${t("openLong") || "Open Long"}`
            : `${orderType === "limit" ? "Limit " : ""}${t("openShort") || "Open Short"}`}
        </button>
      </div>

      {/* Positions Section - 当前仓位 */}
      {currentTokenPositions.length > 0 && (
        <div className="p-3 border-t border-okx-border-primary">
          <div className="text-[12px] font-medium text-okx-text-primary mb-2">
            {t("myPositions") || "My Positions"}
          </div>
          <div className="space-y-2">
            {currentTokenPositions.map((pos) => {
              // 正确的精度转换
              const sizeToken = Number(pos.size) / 1e18; // Meme 代币数量 (1e18 精度)
              const entryPrice = Number(pos.entryPrice) / 1e12; // 价格 (1e12 精度)
              const leverage = Number(pos.leverage) / 1e4; // 杠杆 (1e4 精度)
              const pnlUSD = Number(pos.unrealizedPnL) / 1e6; // PnL (1e6 精度, USD)
              const collateralUSD = Number(pos.collateral) / 1e6; // 保证金 (1e6 精度, USD)
              const positionValue = sizeToken * entryPrice; // 仓位价值 USD

              return (
                <div
                  key={pos.pairId}
                  className="bg-okx-bg-hover rounded p-2 text-[11px]"
                >
                  <div className="flex justify-between items-center mb-1">
                    <span className={pos.isLong ? "text-okx-up font-medium" : "text-okx-down font-medium"}>
                      {pos.isLong ? "LONG" : "SHORT"} {leverage}x
                    </span>
                    <span className="text-okx-text-secondary">
                      {sizeToken >= 1e6 ? `${(sizeToken / 1e6).toFixed(2)}M` : sizeToken >= 1e3 ? `${(sizeToken / 1e3).toFixed(2)}K` : sizeToken.toFixed(2)} {tokenSymbol}
                    </span>
                  </div>
                  <div className="flex justify-between items-center mb-1">
                    <span className="text-okx-text-tertiary">
                      Entry: ${entryPrice < 0.0001 ? entryPrice.toExponential(4) : entryPrice.toFixed(8)}
                    </span>
                    <span className="text-okx-text-secondary">
                      Value: ${positionValue.toFixed(2)}
                    </span>
                  </div>
                  <div className="flex justify-between items-center mb-2">
                    <span className="text-okx-text-tertiary">
                      Margin: ${collateralUSD.toFixed(2)}
                    </span>
                    <span className={pnlUSD >= 0 ? "text-okx-up" : "text-okx-down"}>
                      PnL: {pnlUSD >= 0 ? "+" : ""}${pnlUSD.toFixed(2)}
                    </span>
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={() => handleClosePosition(pos.pairId)}
                      disabled={isSubmittingOrder || isPending}
                      className="flex-1 py-1.5 text-[11px] bg-okx-down/80 hover:bg-okx-down text-white rounded disabled:opacity-50 transition-colors"
                    >
                      {t("marketClose") || "Market Close"}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Status Summary */}
      <div className="p-3 border-t border-okx-border-primary bg-okx-bg-hover/30">
        <div className="flex justify-between text-[11px]">
          <div className="flex items-center gap-2">
            <span className="text-okx-text-tertiary">Positions:</span>
            <span className={currentTokenPositions.length > 0 ? "text-purple-300" : "text-okx-text-tertiary"}>
              {currentTokenPositions.length}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-okx-text-tertiary">Pending:</span>
            <span className={pendingOrders.length > 0 ? "text-yellow-300" : "text-okx-text-tertiary"}>
              {pendingOrders.length}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
