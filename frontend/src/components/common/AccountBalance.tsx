"use client";

/**
 * AccountBalance - 账户余额管理组件 (ETH 本位)
 *
 * 资金流向:
 * 1. 用户从主钱包发送 ETH 到派生钱包 (native ETH transfer)
 * 2. 后端自动识别 native ETH 余额，无需 wrap 为 WETH
 * 3. 全局 Context 监听余额变化，实时更新
 * 4. 开仓时后端在 Redis 中冻结保证金
 */

import { useState, useCallback, useMemo, useEffect } from "react";
import { formatEther, parseEther } from "viem";
import {
  useAccount,
  useBalance,
  useSendTransaction,
  useWaitForTransactionReceipt,
} from "wagmi";
import { useWalletBalance } from "@/contexts/WalletBalanceContext";
import { useTradingWallet } from "@/hooks/perpetual/useTradingWallet";
import { MATCHING_ENGINE_URL } from "@/config/api";

export function AccountBalance({ onClose }: { onClose?: () => void }) {
  const { address: mainWallet, isConnected } = useAccount();
  const { address: tradingWallet } = useTradingWallet();

  // 全局余额 (Settlement + native ETH + WETH)
  const { totalBalance, walletOnlyBalance, settlementBalance, formattedWethBalance, refreshBalance: refreshGlobalBalance } =
    useWalletBalance();

  const [amount, setAmount] = useState("");
  const [activeTab, setActiveTab] = useState<"deposit" | "withdraw">("deposit");
  const [copied, setCopied] = useState(false);
  const [isWithdrawing, setIsWithdrawing] = useState(false);

  // 主钱包 ETH 余额
  const { data: mainWalletBalance, refetch: refetchMainBalance } = useBalance({
    address: mainWallet,
  });

  // 发送 ETH 到派生钱包
  const {
    sendTransaction,
    data: txHash,
    isPending: isSendPending,
    reset,
  } = useSendTransaction();
  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({
    hash: txHash,
  });

  const amountWei = useMemo(() => {
    try {
      return parseEther(amount || "0");
    } catch {
      return 0n;
    }
  }, [amount]);

  // 充值: 从主钱包发送 native ETH 到派生钱包
  const handleDeposit = useCallback(() => {
    if (!tradingWallet || amountWei === 0n) return;
    sendTransaction({
      to: tradingWallet,
      value: amountWei,
    });
  }, [tradingWallet, amountWei, sendTransaction]);

  // 提现: 通过后端 API
  const handleWithdraw = useCallback(async () => {
    if (!tradingWallet || !mainWallet || amountWei === 0n) return;
    setIsWithdrawing(true);
    try {
      const res = await fetch(`${MATCHING_ENGINE_URL}/api/wallet/withdraw`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tradingWallet,
          mainWallet,
          amount: amountWei.toString(),
          token: "ETH",
        }),
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error || "Withdraw failed");
      setAmount("");
      refreshGlobalBalance();
      refetchMainBalance();
    } catch (e) {
      console.error("[Withdraw] Failed:", e);
    } finally {
      setIsWithdrawing(false);
    }
  }, [tradingWallet, mainWallet, amountWei, refreshGlobalBalance, refetchMainBalance]);

  // 交易成功后刷新余额
  useEffect(() => {
    if (isSuccess) {
      setAmount("");
      reset();
      refetchMainBalance();
      refreshGlobalBalance();
      // 通知后端同步链上余额
      if (tradingWallet) {
        fetch(`${MATCHING_ENGINE_URL}/api/balance/sync`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ trader: tradingWallet }),
        }).catch(() => {});
      }
    }
  }, [isSuccess, reset, refetchMainBalance, refreshGlobalBalance, tradingWallet]);

  const copy = () => {
    if (tradingWallet) {
      navigator.clipboard.writeText(tradingWallet);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  // 格式化 ETH 余额
  const fmtETH = (val: bigint | undefined) => {
    if (!val) return "0.0000";
    const num = Number(formatEther(val));
    if (num >= 1) return num.toFixed(4);
    if (num >= 0.0001) return num.toFixed(6);
    return num.toFixed(8);
  };

  const isProcessing = isSendPending || isConfirming || isWithdrawing;

  return (
    <div className="bg-[#131722] rounded-xl border border-gray-800">
      {/* 标题 */}
      <div className="flex justify-between items-center p-4 border-b border-gray-800">
        <span className="text-white font-semibold">账户</span>
        {onClose && (
          <button onClick={onClose} className="text-gray-500 hover:text-white">
            &times;
          </button>
        )}
      </div>

      {/* 交易账户余额 */}
      <div className="p-4 text-center border-b border-gray-800">
        <div className="text-3xl font-bold text-white">
          Ξ{formattedWethBalance}
        </div>
        <div className="text-gray-500 text-sm mb-2">交易账户总余额</div>
        {/* 余额明细 */}
        <div className="flex justify-center gap-4 text-xs">
          <div>
            <span className="text-gray-500">合约托管: </span>
            <span className="text-gray-300">Ξ{fmtETH(settlementBalance)}</span>
          </div>
          <div>
            <span className="text-gray-500">钱包: </span>
            <span className="text-gray-300">Ξ{fmtETH(walletOnlyBalance)}</span>
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
            className="flex-1 bg-[#1e222d] text-gray-300 text-xs px-3 py-2 rounded font-mono"
          />
          <button
            onClick={copy}
            className="px-3 py-2 bg-blue-600 text-white text-xs rounded hover:bg-blue-700"
          >
            {copied ? "已复制" : "复制"}
          </button>
        </div>
      </div>

      {/* 充值/提现 */}
      <div className="p-4 space-y-4">
        {/* Tab 切换 */}
        <div className="flex gap-2 bg-[#1e222d] rounded-lg p-1">
          <button
            onClick={() => {
              setActiveTab("deposit");
              setAmount("");
            }}
            className={`flex-1 py-2 rounded text-sm font-medium transition-colors ${
              activeTab === "deposit"
                ? "bg-blue-600 text-white"
                : "text-gray-400 hover:text-white"
            }`}
          >
            充值
          </button>
          <button
            onClick={() => {
              setActiveTab("withdraw");
              setAmount("");
            }}
            className={`flex-1 py-2 rounded text-sm font-medium transition-colors ${
              activeTab === "withdraw"
                ? "bg-blue-600 text-white"
                : "text-gray-400 hover:text-white"
            }`}
          >
            提现
          </button>
        </div>

        {/* 余额显示 */}
        <div className="flex justify-between items-center text-sm">
          <span className="text-gray-500">
            {activeTab === "deposit" ? "钱包余额" : "交易账户余额"}
          </span>
          <span className="text-white">
            Ξ{activeTab === "deposit"
              ? fmtETH(mainWalletBalance?.value)
              : formattedWethBalance}
          </span>
        </div>

        {/* 金额输入 */}
        <div className="relative">
          <input
            type="number"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="0"
            className="w-full bg-[#1e222d] text-white text-lg px-4 py-3 rounded-lg focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
          <div className="absolute right-3 top-1/2 -translate-y-1/2 flex items-center gap-2">
            <span className="text-gray-400 text-sm">ETH</span>
            <button
              onClick={() => {
                if (activeTab === "deposit") {
                  mainWalletBalance &&
                    setAmount(formatEther(mainWalletBalance.value));
                } else {
                  totalBalance && setAmount(formatEther(totalBalance));
                }
              }}
              className="text-blue-500 text-sm"
            >
              MAX
            </button>
          </div>
        </div>

        {/* 快捷金额 (ETH) */}
        <div className="flex gap-2">
          {["0.01", "0.05", "0.1", "0.5"].map((v) => (
            <button
              key={v}
              onClick={() => setAmount(v)}
              className="flex-1 py-2 bg-[#1e222d] text-gray-400 text-sm rounded hover:text-white"
            >
              Ξ{v}
            </button>
          ))}
        </div>

        {/* 操作按钮 */}
        {activeTab === "deposit" ? (
          <button
            onClick={handleDeposit}
            disabled={isProcessing || !isConnected || amountWei === 0n}
            className="w-full py-3 bg-blue-600 text-white font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isProcessing ? "处理中..." : "充值 ETH 到交易账户"}
          </button>
        ) : (
          <button
            onClick={handleWithdraw}
            disabled={
              isProcessing || !tradingWallet || !mainWallet || amountWei === 0n
            }
            className="w-full py-3 bg-orange-600 text-white font-medium rounded-lg hover:bg-orange-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isWithdrawing ? "提现中..." : "提现到主钱包"}
          </button>
        )}

        {/* 充值提示 */}
        {activeTab === "deposit" && (
          <div className="text-xs text-gray-500 text-center">
            充值到交易账户后即可开始交易，无需额外操作
          </div>
        )}
      </div>
    </div>
  );
}
