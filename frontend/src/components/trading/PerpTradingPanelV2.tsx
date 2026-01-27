"use client";

/**
 * 永续合约交易面板 V2
 *
 * 使用签名订单模式：
 * 1. 用户签名订单
 * 2. 提交到链下撮合引擎
 * 3. 撮合后批量结算到链上
 */

import React, { useState, useMemo, useEffect } from "react";
import { useAccount } from "wagmi";
import { formatEther, parseEther, type Address } from "viem";
import { usePerpetualV2 } from "@/hooks/usePerpetualV2";
import { useConnectModal } from "@rainbow-me/rainbowkit";

// Default deposit token (USDT on Base Sepolia)
const DEFAULT_DEPOSIT_TOKEN = (process.env.NEXT_PUBLIC_USDT_ADDRESS || "0x223095F2c63DB913Baa46FdC2f401E65cB8799F4") as Address;

interface PerpTradingPanelV2Props {
  className?: string;
  tokenAddress?: Address;
}

export function PerpTradingPanelV2({ className = "", tokenAddress }: PerpTradingPanelV2Props) {
  const { address, isConnected } = useAccount();
  const { openConnectModal } = useConnectModal();

  const {
    balance,
    walletBalance,
    positions,
    hasPosition,
    pendingOrders,
    orderBook,
    submitMarketOrder,
    submitLimitOrder,
    cancelPendingOrder,
    closePair,
    deposit,
    withdraw,
    refreshOrderBook,
    isSigningOrder,
    isSubmittingOrder,
    isPending,
    isConfirming,
    error,
  } = usePerpetualV2();

  // UI State
  const [side, setSide] = useState<"long" | "short">("long");
  const [orderType, setOrderType] = useState<"market" | "limit">("market");
  const [leverage, setLeverage] = useState(10);
  const [amount, setAmount] = useState("");
  const [price, setPrice] = useState("");
  const [showDepositModal, setShowDepositModal] = useState(false);
  const [depositAmount, setDepositAmount] = useState("");
  const [activeTab, setActiveTab] = useState<"trade" | "positions" | "orders">("trade");
  const [submitResult, setSubmitResult] = useState<{ success: boolean; message: string } | null>(null);

  // Default token if not provided
  const token = tokenAddress || ("0x6Bf5C512a5714D610379b1EA0Dec0BEFb46888f7" as Address); // COP400

  // Refresh order book when token changes
  useEffect(() => {
    if (token) {
      refreshOrderBook(token);
    }
  }, [token, refreshOrderBook]);

  // Format price
  const formatPrice = (p: string | null) => {
    if (!p) return "--";
    const num = parseFloat(p);
    if (num === 0) return "0";
    if (num < 0.0001) return num.toExponential(4);
    if (num < 1) return num.toFixed(6);
    return num.toFixed(4);
  };

  // Calculate margin required
  const marginRequired = useMemo(() => {
    if (!amount || isNaN(parseFloat(amount))) return "0";
    const size = parseFloat(amount);
    return (size / leverage).toFixed(6);
  }, [amount, leverage]);

  // Check if user has enough balance (balance is in 1e6 precision USD)
  const hasEnoughBalance = useMemo(() => {
    if (!balance || !amount) return true;
    const required = parseFloat(marginRequired);
    const available = Number(balance.available) / 1e6;
    return available >= required;
  }, [balance, marginRequired]);

  // Handle order submission
  const handleSubmitOrder = async () => {
    if (!amount || !token) return;

    setSubmitResult(null);

    try {
      let result;
      if (orderType === "market") {
        result = await submitMarketOrder(token, side === "long", amount, leverage);
      } else {
        if (!price) {
          setSubmitResult({ success: false, message: "Please enter a price for limit order" });
          return;
        }
        result = await submitLimitOrder(token, side === "long", amount, leverage, price);
      }

      if (result.success) {
        setSubmitResult({ success: true, message: `Order submitted! ID: ${result.orderId}` });
        setAmount("");
        setPrice("");
      } else {
        setSubmitResult({ success: false, message: result.error || "Order failed" });
      }
    } catch (err) {
      setSubmitResult({ success: false, message: err instanceof Error ? err.message : "Unknown error" });
    }
  };

  // Handle position close
  const handleClosePair = async (pairId: string) => {
    const result = await closePair(pairId);
    if (result.success) {
      setSubmitResult({ success: true, message: "Close request submitted" });
    } else {
      setSubmitResult({ success: false, message: result.error || "Failed to close" });
    }
  };

  // Handle order cancel
  const handleCancelOrder = async (orderId: string) => {
    const result = await cancelPendingOrder(orderId);
    if (result.success) {
      setSubmitResult({ success: true, message: "Order cancelled" });
    } else {
      setSubmitResult({ success: false, message: result.error || "Failed to cancel" });
    }
  };

  // Handle deposit
  const handleDeposit = async () => {
    if (!depositAmount) return;
    try {
      // Convert to token decimals (USDT has 6 decimals)
      const amountInTokenDecimals = (parseFloat(depositAmount) * 1e6).toString();
      await deposit(DEFAULT_DEPOSIT_TOKEN, amountInTokenDecimals);
      setDepositAmount("");
      setShowDepositModal(false);
    } catch (err) {
      console.error("Failed to deposit:", err);
    }
  };

  const isProcessing = isSigningOrder || isSubmittingOrder || isPending || isConfirming;

  return (
    <div className={`bg-okx-bg-card border border-okx-border-primary rounded-xl overflow-hidden ${className}`}>
      {/* Tabs */}
      <div className="flex border-b border-okx-border-primary">
        <button
          onClick={() => setActiveTab("trade")}
          className={`flex-1 py-3 text-sm font-medium transition-colors ${
            activeTab === "trade" ? "text-okx-text-primary border-b-2 border-okx-up" : "text-okx-text-secondary"
          }`}
        >
          Trade
        </button>
        <button
          onClick={() => setActiveTab("positions")}
          className={`flex-1 py-3 text-sm font-medium transition-colors relative ${
            activeTab === "positions" ? "text-okx-text-primary border-b-2 border-okx-up" : "text-okx-text-secondary"
          }`}
        >
          Positions
          {positions.length > 0 && (
            <span className="absolute top-2 right-4 w-2 h-2 bg-okx-up rounded-full" />
          )}
        </button>
        <button
          onClick={() => setActiveTab("orders")}
          className={`flex-1 py-3 text-sm font-medium transition-colors relative ${
            activeTab === "orders" ? "text-okx-text-primary border-b-2 border-okx-up" : "text-okx-text-secondary"
          }`}
        >
          Orders
          {pendingOrders.length > 0 && (
            <span className="absolute top-2 right-4 w-2 h-2 bg-yellow-500 rounded-full" />
          )}
        </button>
      </div>

      {/* Trade Tab */}
      {activeTab === "trade" && (
        <div className="p-4 space-y-4">
          {/* Long/Short Toggle */}
          <div className="flex border border-okx-border-primary rounded-lg overflow-hidden">
            <button
              onClick={() => setSide("long")}
              className={`flex-1 py-3 text-sm font-bold transition-colors ${
                side === "long" ? "bg-okx-up text-black" : "text-okx-text-secondary hover:text-okx-text-primary"
              }`}
            >
              Long
            </button>
            <button
              onClick={() => setSide("short")}
              className={`flex-1 py-3 text-sm font-bold transition-colors ${
                side === "short" ? "bg-okx-down text-white" : "text-okx-text-secondary hover:text-okx-text-primary"
              }`}
            >
              Short
            </button>
          </div>

          {/* Balance Display (balance from API is 1e6 precision USD) */}
          <div className="bg-okx-bg-hover rounded-lg p-3 space-y-2">
            <div className="flex justify-between text-sm">
              <span className="text-okx-text-tertiary">Wallet</span>
              <span>{walletBalance ? parseFloat(formatEther(walletBalance)).toFixed(4) : "0"} ETH</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-okx-text-tertiary">Available</span>
              <span className="text-okx-up">
                {balance ? (Number(balance.available) / 1e6).toFixed(2) : "0"} USD
              </span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-okx-text-tertiary">Locked</span>
              <span>{balance ? (Number(balance.locked) / 1e6).toFixed(2) : "0"} USD</span>
            </div>
            <button
              onClick={() => setShowDepositModal(true)}
              className="w-full py-2 mt-2 text-sm bg-okx-bg-primary border border-okx-border-primary rounded-lg hover:border-okx-up transition-colors"
            >
              Deposit / Withdraw
            </button>
          </div>

          {/* Order Type */}
          <div className="flex gap-2">
            <button
              onClick={() => setOrderType("market")}
              className={`flex-1 py-2 text-sm rounded-lg border transition-colors ${
                orderType === "market" ? "border-okx-up text-okx-up" : "border-okx-border-primary text-okx-text-secondary"
              }`}
            >
              Market
            </button>
            <button
              onClick={() => setOrderType("limit")}
              className={`flex-1 py-2 text-sm rounded-lg border transition-colors ${
                orderType === "limit" ? "border-okx-up text-okx-up" : "border-okx-border-primary text-okx-text-secondary"
              }`}
            >
              Limit
            </button>
          </div>

          {/* Leverage Slider */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <span className="text-okx-text-secondary text-sm">Leverage</span>
              <span className="text-okx-text-primary font-bold">{leverage}x</span>
            </div>
            <input
              type="range"
              min="1"
              max="100"
              value={leverage}
              onChange={(e) => setLeverage(parseInt(e.target.value))}
              className="w-full accent-okx-up"
            />
            <div className="flex justify-between text-xs text-okx-text-tertiary mt-1">
              <span>1x</span>
              <span>25x</span>
              <span>50x</span>
              <span>75x</span>
              <span>100x</span>
            </div>
          </div>

          {/* Price Input (for limit orders) */}
          {orderType === "limit" && (
            <div>
              <label className="block text-okx-text-secondary text-sm mb-2">Price (ETH)</label>
              <input
                type="number"
                value={price}
                onChange={(e) => setPrice(e.target.value)}
                placeholder={orderBook?.lastPrice ? formatPrice(orderBook.lastPrice) : "0.00"}
                className="w-full bg-okx-bg-primary border border-okx-border-primary rounded-lg px-4 py-3 text-okx-text-primary focus:outline-none focus:border-okx-up"
              />
            </div>
          )}

          {/* Size Input */}
          <div>
            <label className="block text-okx-text-secondary text-sm mb-2">Size (ETH)</label>
            <input
              type="number"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="0.00"
              className="w-full bg-okx-bg-primary border border-okx-border-primary rounded-lg px-4 py-3 text-okx-text-primary focus:outline-none focus:border-okx-up"
            />
          </div>

          {/* Quick Amount Buttons (balance is 1e6 precision USD) */}
          <div className="flex gap-2">
            {["25%", "50%", "75%", "100%"].map((pct) => (
              <button
                key={pct}
                onClick={() => {
                  if (balance) {
                    const percent = parseInt(pct) / 100;
                    const available = Number(balance.available) / 1e6;
                    const maxSize = available * leverage * percent;
                    setAmount(maxSize.toFixed(4));
                  }
                }}
                className="flex-1 py-1.5 text-xs bg-okx-bg-hover border border-okx-border-primary rounded hover:border-okx-up transition-colors"
              >
                {pct}
              </button>
            ))}
          </div>

          {/* Order Summary */}
          <div className="bg-okx-bg-hover rounded-lg p-3 text-sm space-y-2">
            <div className="flex justify-between">
              <span className="text-okx-text-tertiary">Margin Required</span>
              <span className={!hasEnoughBalance ? "text-okx-down" : ""}>{marginRequired} ETH</span>
            </div>
            <div className="flex justify-between">
              <span className="text-okx-text-tertiary">Last Price</span>
              <span>{orderBook?.lastPrice ? formatPrice(orderBook.lastPrice) : "--"} ETH</span>
            </div>
          </div>

          {/* Submit Button */}
          {!isConnected ? (
            <button
              onClick={openConnectModal}
              className="w-full py-4 rounded-lg font-bold text-lg bg-okx-up text-black hover:opacity-90 transition-opacity"
            >
              Connect Wallet
            </button>
          ) : (
            <button
              onClick={handleSubmitOrder}
              disabled={isProcessing || !amount || !hasEnoughBalance}
              className={`w-full py-4 rounded-lg font-bold text-lg transition-opacity hover:opacity-90 disabled:opacity-50 ${
                side === "long" ? "bg-okx-up text-black" : "bg-okx-down text-white"
              }`}
            >
              {isSigningOrder
                ? "Signing..."
                : isSubmittingOrder
                ? "Submitting..."
                : isPending || isConfirming
                ? "Processing..."
                : !hasEnoughBalance
                ? "Insufficient Balance"
                : side === "long"
                ? "Long"
                : "Short"}
            </button>
          )}

          {/* Result Message */}
          {submitResult && (
            <div className={`p-3 rounded-lg text-sm ${submitResult.success ? "bg-okx-up/10 text-okx-up" : "bg-okx-down/10 text-okx-down"}`}>
              {submitResult.message}
            </div>
          )}

          {/* Error Message */}
          {error && <p className="text-okx-down text-sm text-center">{error}</p>}

          {/* Risk Warning */}
          <p className="text-okx-text-tertiary text-xs text-center">
            Leverage trading is high risk. Trade responsibly.
          </p>
        </div>
      )}

      {/* Positions Tab */}
      {activeTab === "positions" && (
        <div className="p-4">
          {positions.length === 0 ? (
            <div className="text-center py-8 text-okx-text-tertiary">No open positions</div>
          ) : (
            <div className="space-y-3">
              {positions.map((pos) => {
                // 格式化仓位数据 (后端精度: size=1e18, price=1e12, USD=1e6)
                const sizeTokens = Number(pos.size) / 1e18;
                const entryPriceUsd = Number(pos.entryPrice) / 1e12;
                const markPriceUsd = pos.markPrice ? Number(pos.markPrice) / 1e12 : entryPriceUsd;
                const liqPriceUsd = (pos.liquidationPrice || pos.liqPrice) ? Number(pos.liquidationPrice || pos.liqPrice) / 1e12 : 0;
                const collateralUsd = Number(pos.collateral) / 1e6;
                const pnlUsd = Number(pos.unrealizedPnL) / 1e6;
                const roe = pos.roe ? Number(pos.roe) / 100 : (pnlUsd / collateralUsd * 100);
                const marginRatio = pos.marginRatio ? Number(pos.marginRatio) / 100 : 0;
                const notionalValue = sizeTokens * markPriceUsd;

                // 格式化显示
                const formatTokenPrice = (p: number) => p < 0.0001 ? p.toExponential(4) : p.toFixed(8);
                const formatUsd = (v: number) => v >= 0 ? `$${v.toFixed(2)}` : `-$${Math.abs(v).toFixed(2)}`;
                const formatPnl = (v: number) => v >= 0 ? `+$${v.toFixed(2)}` : `-$${Math.abs(v).toFixed(2)}`;

                return (
                  <div key={pos.pairId} className="bg-okx-bg-hover rounded-lg p-3">
                    {/* Header: Direction + Leverage + Size */}
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-2">
                        <span className={`px-2 py-0.5 rounded text-xs font-bold ${pos.isLong ? "bg-okx-up/20 text-okx-up" : "bg-okx-down/20 text-okx-down"}`}>
                          {pos.isLong ? "LONG" : "SHORT"}
                        </span>
                        <span className="text-sm">{pos.leverage}x</span>
                      </div>
                      <div className="text-right">
                        <div className="text-sm font-medium">{formatUsd(notionalValue)}</div>
                        <div className="text-xs text-okx-text-tertiary">{sizeTokens.toFixed(0)} tokens</div>
                      </div>
                    </div>

                    {/* Price Info */}
                    <div className="grid grid-cols-3 gap-2 text-xs mb-2">
                      <div>
                        <span className="text-okx-text-tertiary">Entry</span>
                        <div className="text-okx-text-primary font-mono">${formatTokenPrice(entryPriceUsd)}</div>
                      </div>
                      <div>
                        <span className="text-okx-text-tertiary">Mark</span>
                        <div className="text-okx-text-primary font-mono">${formatTokenPrice(markPriceUsd)}</div>
                      </div>
                      <div>
                        <span className="text-okx-text-tertiary">Liq</span>
                        <div className={`font-mono ${pos.isLong ? "text-okx-down" : "text-okx-up"}`}>
                          ${formatTokenPrice(liqPriceUsd)}
                        </div>
                      </div>
                    </div>

                    {/* PnL & Margin Info */}
                    <div className="grid grid-cols-2 gap-2 text-xs border-t border-okx-border-primary pt-2">
                      <div>
                        <span className="text-okx-text-tertiary">PnL (ROE)</span>
                        <div className={pnlUsd >= 0 ? "text-okx-up" : "text-okx-down"}>
                          {formatPnl(pnlUsd)} <span className="text-xs">({roe >= 0 ? "+" : ""}{roe.toFixed(2)}%)</span>
                        </div>
                      </div>
                      <div>
                        <span className="text-okx-text-tertiary">Margin</span>
                        <div className="text-okx-text-primary">
                          {formatUsd(collateralUsd)} <span className="text-xs text-okx-text-tertiary">({marginRatio.toFixed(2)}%)</span>
                        </div>
                      </div>
                    </div>

                    {/* Close Button */}
                    <button
                      onClick={() => handleClosePair(pos.pairId)}
                      className="w-full mt-3 py-2 text-sm bg-okx-down/20 text-okx-down rounded-lg hover:bg-okx-down/30 transition-colors"
                    >
                      Close Position
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Orders Tab */}
      {activeTab === "orders" && (
        <div className="p-4">
          {pendingOrders.length === 0 ? (
            <div className="text-center py-8 text-okx-text-tertiary">No pending orders</div>
          ) : (
            <div className="space-y-3">
              {pendingOrders.map((order) => (
                <div key={order.id} className="bg-okx-bg-hover rounded-lg p-3">
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <span className={`px-2 py-0.5 rounded text-xs font-bold ${order.isLong ? "bg-okx-up/20 text-okx-up" : "bg-okx-down/20 text-okx-down"}`}>
                        {order.isLong ? "LONG" : "SHORT"}
                      </span>
                      <span className="text-xs text-okx-text-tertiary">{order.status}</span>
                    </div>
                    <span className="text-sm font-medium">{order.size} ETH</span>
                  </div>
                  <div className="grid grid-cols-2 gap-2 text-xs text-okx-text-tertiary">
                    <div>
                      <span>Price: </span>
                      <span className="text-okx-text-primary">
                        {order.price === "0" ? "MARKET" : formatPrice(order.price)}
                      </span>
                    </div>
                    <div>
                      <span>Filled: </span>
                      <span className="text-okx-text-primary">{order.filledSize} ETH</span>
                    </div>
                  </div>
                  <button
                    onClick={() => handleCancelOrder(order.id)}
                    className="w-full mt-3 py-2 text-sm bg-okx-bg-primary border border-okx-border-primary text-okx-text-secondary rounded-lg hover:border-okx-down hover:text-okx-down transition-colors"
                  >
                    Cancel Order
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Deposit/Withdraw Modal */}
      {showDepositModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-okx-bg-card border border-okx-border-primary rounded-xl p-6 w-96">
            <h3 className="text-lg font-bold mb-4">Deposit Margin</h3>
            <div className="space-y-4">
              <div>
                <label className="block text-okx-text-secondary text-sm mb-2">Amount (ETH)</label>
                <input
                  type="number"
                  value={depositAmount}
                  onChange={(e) => setDepositAmount(e.target.value)}
                  placeholder="0.00"
                  className="w-full bg-okx-bg-primary border border-okx-border-primary rounded-lg px-4 py-3 text-okx-text-primary focus:outline-none focus:border-okx-up"
                />
                <p className="text-okx-text-tertiary text-xs mt-1">
                  Wallet balance: {walletBalance ? parseFloat(formatEther(walletBalance)).toFixed(4) : "0"} ETH
                </p>
              </div>
              <div className="flex gap-2">
                <button
                  onClick={() => setShowDepositModal(false)}
                  className="flex-1 py-3 rounded-lg font-bold border border-okx-border-primary hover:border-okx-text-primary transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={handleDeposit}
                  disabled={isProcessing || !depositAmount}
                  className="flex-1 py-3 rounded-lg font-bold bg-okx-up text-black hover:opacity-90 transition-opacity disabled:opacity-50"
                >
                  {isProcessing ? "Processing..." : "Deposit"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default PerpTradingPanelV2;
