"use client";

/**
 * AccountBalance - 账户余额管理组件 (BNB 本位)
 *
 * 简化版资金流 (派生钱包模式):
 * 1. 充值: 主钱包 → 派生钱包 (一步 BNB 转账)
 * 2. 提款: 派生钱包 → 主钱包 (一步 BNB 转账)
 * 3. 保证金由引擎自动管理 (派生钱包 ↔ PerpVault)
 */

import { useState, useCallback, useMemo, useRef } from "react";
import { formatEther, parseEther, type Address } from "viem";
import {
  useAccount,
  useBalance,
  useSendTransaction,
  usePublicClient,
} from "wagmi";
import { useWalletBalance } from "@/contexts/WalletBalanceContext";
import { useTradingWallet } from "@/hooks/perpetual/useTradingWallet";

export function AccountBalance({ onClose }: { onClose?: () => void }) {
  const { address: mainWallet, isConnected } = useAccount();
  const publicClient = usePublicClient();

  // Trading wallet (signature-derived EOA)
  const {
    address: tradingWallet,
    getSignature,
    sendETH,
    ethBalance: tradingWalletNativeBalance,
    refreshBalance: refreshTradingWalletBalance,
  } = useTradingWallet();

  const tradingWalletSignature = getSignature();

  // Global balance (native BNB + locked margin)
  const {
    totalBalance,
    walletOnlyBalance,
    lockedMargin,
    nativeEthBalance,
    formattedWethBalance,
    refreshBalance: refreshGlobalBalance,
  } = useWalletBalance();

  const [amount, setAmount] = useState("");
  const [activeTab, setActiveTab] = useState<"deposit" | "withdraw">("deposit");
  const [copied, setCopied] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [stepError, setStepError] = useState<string | null>(null);

  // Main wallet BNB balance
  const { data: mainWalletBalance, refetch: refetchMainBalance } = useBalance({
    address: mainWallet,
  });

  // Send BNB to trading wallet (wagmi)
  const { sendTransactionAsync, isPending: isSendPending } =
    useSendTransaction();

  const amountWei = useMemo(() => {
    try {
      return parseEther(amount || "0");
    } catch {
      return 0n;
    }
  }, [amount]);

  // ═══════════════════════════════════════════════════════════
  // Deposit: Main wallet → Trading wallet (one step BNB transfer)
  // ═══════════════════════════════════════════════════════════
  const handleDeposit = useCallback(async () => {
    if (!tradingWallet || amountWei === 0n || !publicClient) return;
    setStepError(null);
    setIsProcessing(true);

    try {
      const txHash = await sendTransactionAsync({
        to: tradingWallet,
        value: amountWei,
      });
      await publicClient.waitForTransactionReceipt({ hash: txHash });

      setAmount("");
      refreshGlobalBalance();
      refetchMainBalance();
    } catch (e) {
      console.error("[Deposit] Failed:", e);
      setStepError(
        `充值失败: ${e instanceof Error ? e.message : "未知错误"}`
      );
    } finally {
      setIsProcessing(false);
    }
  }, [
    tradingWallet, amountWei, publicClient,
    sendTransactionAsync, refreshGlobalBalance, refetchMainBalance,
  ]);

  // ═══════════════════════════════════════════════════════════
  // Withdraw: Trading wallet → Main wallet (one step BNB transfer)
  // ═══════════════════════════════════════════════════════════
  const handleWithdraw = useCallback(async () => {
    if (!tradingWallet || !mainWallet || amountWei === 0n) return;
    setStepError(null);
    setIsProcessing(true);

    try {
      const gasReserve = parseEther("0.001");
      const maxSend = tradingWalletNativeBalance > gasReserve
        ? tradingWalletNativeBalance - gasReserve : 0n;
      if (amountWei > maxSend) {
        setStepError("余额不足 (需要预留 gas 费用)");
        setIsProcessing(false);
        return;
      }
      await sendETH(mainWallet, amount);

      setAmount("");
      refreshGlobalBalance();
      refetchMainBalance();
      refreshTradingWalletBalance();
    } catch (e) {
      console.error("[Withdraw] Failed:", e);
      setStepError(
        `提款失败: ${e instanceof Error ? e.message : "未知错误"}`
      );
    } finally {
      setIsProcessing(false);
    }
  }, [
    tradingWallet, mainWallet, amountWei, amount,
    tradingWalletNativeBalance, sendETH,
    refreshGlobalBalance, refetchMainBalance, refreshTradingWalletBalance,
  ]);

  const copy = () => {
    if (tradingWallet) {
      navigator.clipboard.writeText(tradingWallet);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  // Format BNB balance
  const fmtETH = (val: bigint | undefined) => {
    if (!val) return "0.0000";
    const num = Number(formatEther(val));
    if (num >= 1) return num.toFixed(4);
    if (num >= 0.0001) return num.toFixed(6);
    return num.toFixed(8);
  };

  return (
    <div className="bg-okx-bg-card rounded-xl border border-gray-800">
      {/* 标题 */}
      <div className="flex justify-between items-center p-4 border-b border-gray-800">
        <span className="text-okx-text-primary font-semibold">账户</span>
        {onClose && (
          <button onClick={onClose} className="text-gray-500 hover:text-okx-text-primary">
            &times;
          </button>
        )}
      </div>

      {/* 交易账户余额 */}
      <div className="p-4 text-center border-b border-gray-800">
        <div className="text-3xl font-bold text-okx-text-primary">
          BNB {formattedWethBalance}
        </div>
        <div className="text-gray-500 text-sm mb-2">交易账户总余额</div>
        {/* 余额明细 */}
        <div className="flex justify-center gap-4 text-xs">
          <div>
            <span className="text-gray-500">可用: </span>
            <span className="text-gray-300">BNB {fmtETH(nativeEthBalance)}</span>
          </div>
          <div>
            <span className="text-gray-500">保证金锁定: </span>
            <span className="text-gray-300">BNB {fmtETH(lockedMargin)}</span>
          </div>
        </div>
      </div>

      {/* 交易账户地址 */}
      <div className="p-4 border-b border-gray-800">
        <div className="text-gray-500 text-xs mb-2">交易账户</div>
        <div className="flex gap-2">
          <input
            value={tradingWallet || ""}
            readOnly
            className="flex-1 bg-okx-bg-secondary text-gray-300 text-xs px-3 py-2 rounded font-mono"
          />
          <button
            onClick={copy}
            className="px-3 py-2 bg-okx-brand text-white text-xs rounded hover:bg-okx-brand/80"
          >
            {copied ? "已复制" : "复制"}
          </button>
        </div>
      </div>

      {/* 充值/提现 */}
      <div className="p-4 space-y-4">
        {/* Tab 切换 */}
        <div className="flex gap-2 bg-okx-bg-secondary rounded-lg p-1">
          <button
            onClick={() => {
              setActiveTab("deposit");
              setAmount("");
              setStepError(null);
            }}
            className={`flex-1 py-2 rounded text-sm font-medium transition-colors ${
              activeTab === "deposit"
                ? "bg-okx-brand text-white"
                : "text-gray-400 hover:text-okx-text-primary"
            }`}
          >
            充值
          </button>
          <button
            onClick={() => {
              setActiveTab("withdraw");
              setAmount("");
              setStepError(null);
            }}
            className={`flex-1 py-2 rounded text-sm font-medium transition-colors ${
              activeTab === "withdraw"
                ? "bg-okx-brand text-white"
                : "text-gray-400 hover:text-okx-text-primary"
            }`}
          >
            提现
          </button>
        </div>

        {/* 余额显示 */}
        <div className="flex justify-between items-center text-sm">
          <span className="text-gray-500">
            {activeTab === "deposit" ? "钱包余额" : "可提现余额"}
          </span>
          <span className="text-okx-text-primary">
            BNB {activeTab === "deposit"
              ? fmtETH(mainWalletBalance?.value)
              : fmtETH(tradingWalletNativeBalance)}
          </span>
        </div>

        {/* 金额输入 */}
        <div className="relative">
          <input
            type="number"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="0"
            disabled={isProcessing}
            className="w-full bg-okx-bg-secondary text-okx-text-primary text-lg px-4 py-3 rounded-lg focus:outline-none focus:ring-1 focus:ring-okx-brand disabled:opacity-50"
          />
          <div className="absolute right-3 top-1/2 -translate-y-1/2 flex items-center gap-2">
            <span className="text-gray-400 text-sm">BNB</span>
            <button
              onClick={() => {
                if (activeTab === "deposit") {
                  if (mainWalletBalance) {
                    const GAS_RESERVE = 5000000000000000n; // 0.005 BNB
                    const maxDeposit = mainWalletBalance.value > GAS_RESERVE
                      ? mainWalletBalance.value - GAS_RESERVE
                      : 0n;
                    setAmount(formatEther(maxDeposit));
                  }
                } else {
                  const gasReserve = parseEther("0.001");
                  const maxW = tradingWalletNativeBalance > gasReserve
                    ? tradingWalletNativeBalance - gasReserve : 0n;
                  if (maxW > 0n) setAmount(formatEther(maxW));
                }
              }}
              disabled={isProcessing}
              className="text-okx-brand text-sm disabled:opacity-50"
            >
              MAX
            </button>
          </div>
        </div>

        {/* 快捷金额 (BNB) */}
        <div className="flex gap-2">
          {["0.01", "0.05", "0.1", "0.5"].map((v) => (
            <button
              key={v}
              onClick={() => setAmount(v)}
              disabled={isProcessing}
              className="flex-1 py-2 bg-okx-bg-secondary text-gray-400 text-sm rounded hover:text-okx-text-primary disabled:opacity-50"
            >
              BNB {v}
            </button>
          ))}
        </div>

        {/* 错误提示 */}
        {stepError && (
          <div className="text-xs text-red-400 bg-red-900/20 rounded-lg px-3 py-2">
            {stepError}
          </div>
        )}

        {/* 操作按钮 */}
        {activeTab === "deposit" ? (
          <button
            onClick={handleDeposit}
            disabled={isProcessing || !isConnected || amountWei === 0n || !tradingWalletSignature}
            className="w-full py-3 bg-okx-brand text-white font-medium rounded-lg hover:bg-okx-brand/80 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isProcessing ? "充值中..." : "充值 BNB 到交易账户"}
          </button>
        ) : (
          <button
            onClick={handleWithdraw}
            disabled={
              isProcessing || !tradingWallet || !mainWallet || amountWei === 0n || !tradingWalletSignature
            }
            className="w-full py-3 bg-okx-brand text-white font-medium rounded-lg hover:bg-okx-brand/80 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isProcessing ? "提现中..." : "提现到主钱包"}
          </button>
        )}

        {/* 充值提示 */}
        {activeTab === "deposit" && !isProcessing && (
          <div className="text-xs text-gray-500 text-center">
            BNB 直接转入你的交易钱包，一步到账
          </div>
        )}

        {/* 提现提示 */}
        {activeTab === "withdraw" && !isProcessing && (
          <div className="text-xs text-gray-500 text-center">
            从交易钱包直接转回主钱包，一步到账
          </div>
        )}

        {/* 未激活交易钱包提示 */}
        {!tradingWalletSignature && isConnected && (
          <div className="text-xs text-yellow-500 text-center">
            请先在交易面板激活交易钱包
          </div>
        )}

      </div>
    </div>
  );
}
