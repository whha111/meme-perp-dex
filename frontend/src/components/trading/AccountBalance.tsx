"use client";

import { useState, useCallback, useMemo, useEffect } from "react";
import { formatUnits, parseUnits, type Address } from "viem";
import { useAccount, useReadContract, useWriteContract, useWaitForTransactionReceipt } from "wagmi";
import { usePerpetualV2 } from "@/hooks/usePerpetualV2";
import { useTradingWallet } from "@/hooks/useTradingWallet";

const USDT_ADDRESS = (process.env.NEXT_PUBLIC_USDT_ADDRESS || "0x83214D0a99EB664c3559D1619Ef9B5f78A655C4e") as Address;
const USDC_ADDRESS = (process.env.NEXT_PUBLIC_USDC_ADDRESS || "0x6Fa3DB92806d0e2A77a8AD02afD0991E1430ca2E") as Address;
const SETTLEMENT_ADDRESS = (process.env.NEXT_PUBLIC_SETTLEMENT_ADDRESS || "") as Address;

const ERC20_ABI = [
  { name: "balanceOf", type: "function", stateMutability: "view", inputs: [{ name: "account", type: "address" }], outputs: [{ type: "uint256" }] },
  { name: "allowance", type: "function", stateMutability: "view", inputs: [{ name: "owner", type: "address" }, { name: "spender", type: "address" }], outputs: [{ type: "uint256" }] },
  { name: "approve", type: "function", stateMutability: "nonpayable", inputs: [{ name: "spender", type: "address" }, { name: "amount", type: "uint256" }], outputs: [{ type: "bool" }] },
  { name: "mint", type: "function", stateMutability: "nonpayable", inputs: [{ name: "to", type: "address" }, { name: "amount", type: "uint256" }], outputs: [] },
] as const;

const SETTLEMENT_ABI = [
  { name: "depositTo", type: "function", stateMutability: "nonpayable", inputs: [{ name: "recipient", type: "address" }, { name: "token", type: "address" }, { name: "amount", type: "uint256" }], outputs: [] },
] as const;

export function AccountBalance({ onClose }: { onClose?: () => void }) {
  const { address: mainWallet, isConnected } = useAccount();
  const { address: tradingWallet } = useTradingWallet();
  const { balance, refreshBalance } = usePerpetualV2({ tradingWalletAddress: tradingWallet || undefined });

  const [amount, setAmount] = useState("");
  const [token, setToken] = useState<"USDT" | "USDC">("USDT");
  const [copied, setCopied] = useState(false);

  const tokenAddress = token === "USDT" ? USDT_ADDRESS : USDC_ADDRESS;

  const { data: walletBalance, refetch: refetchBalance } = useReadContract({
    address: tokenAddress, abi: ERC20_ABI, functionName: "balanceOf",
    args: mainWallet ? [mainWallet] : undefined,
  });

  const { data: allowance, refetch: refetchAllowance } = useReadContract({
    address: tokenAddress, abi: ERC20_ABI, functionName: "allowance",
    args: mainWallet ? [mainWallet, SETTLEMENT_ADDRESS] : undefined,
  });

  const { writeContract, data: txHash, isPending, reset } = useWriteContract();
  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({ hash: txHash });

  const amountBigInt = useMemo(() => {
    try { return parseUnits(amount || "0", 6); } catch { return 0n; }
  }, [amount]);

  const needsApproval = (allowance ?? 0n) < amountBigInt && amountBigInt > 0n;

  const handleApprove = useCallback(() => {
    writeContract({ address: tokenAddress, abi: ERC20_ABI, functionName: "approve", args: [SETTLEMENT_ADDRESS, 2n ** 256n - 1n] });
  }, [tokenAddress, writeContract]);

  const handleDeposit = useCallback(() => {
    if (!tradingWallet || amountBigInt === 0n) return;
    writeContract({ address: SETTLEMENT_ADDRESS, abi: SETTLEMENT_ABI, functionName: "depositTo", args: [tradingWallet, tokenAddress, amountBigInt] });
  }, [tradingWallet, tokenAddress, amountBigInt, writeContract]);

  const handleMint = useCallback(() => {
    if (!mainWallet) return;
    writeContract({ address: tokenAddress, abi: ERC20_ABI, functionName: "mint", args: [mainWallet, parseUnits("10000", 6)] });
  }, [mainWallet, tokenAddress, writeContract]);

  useEffect(() => {
    if (isSuccess) {
      setAmount("");
      reset();
      refetchBalance();
      refetchAllowance();
      refreshBalance?.();
    }
  }, [isSuccess]);

  const copy = () => {
    if (tradingWallet) {
      navigator.clipboard.writeText(tradingWallet);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const fmt = (v: bigint | undefined) => v ? Number(formatUnits(v, 6)).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : "0.00";
  const isProcessing = isPending || isConfirming;

  return (
    <div className="bg-[#131722] rounded-xl border border-gray-800">
      {/* 标题 */}
      <div className="flex justify-between items-center p-4 border-b border-gray-800">
        <span className="text-white font-semibold">账户</span>
        {onClose && <button onClick={onClose} className="text-gray-500 hover:text-white">&times;</button>}
      </div>

      {/* 余额 */}
      <div className="p-4 text-center border-b border-gray-800">
        <div className="text-3xl font-bold text-white">${fmt(balance?.available)}</div>
        <div className="text-gray-500 text-sm">可用余额</div>
      </div>

      {/* 交易账户 */}
      <div className="p-4 border-b border-gray-800">
        <div className="text-gray-500 text-xs mb-2">交易账户</div>
        <div className="flex gap-2">
          <input value={tradingWallet || ""} readOnly className="flex-1 bg-[#1e222d] text-gray-300 text-xs px-3 py-2 rounded font-mono" />
          <button onClick={copy} className="px-3 py-2 bg-blue-600 text-white text-xs rounded hover:bg-blue-700">
            {copied ? "已复制" : "复制"}
          </button>
        </div>
      </div>

      {/* 充值 */}
      <div className="p-4 space-y-4">
        {/* 代币选择 */}
        <div className="flex gap-2">
          {(["USDT", "USDC"] as const).map(t => (
            <button key={t} onClick={() => setToken(t)}
              className={`flex-1 py-2 rounded text-sm font-medium ${token === t ? "bg-blue-600 text-white" : "bg-[#1e222d] text-gray-400"}`}>
              {t}
            </button>
          ))}
        </div>

        {/* 钱包余额 */}
        <div className="flex justify-between items-center text-sm">
          <span className="text-gray-500">钱包余额</span>
          <div className="flex items-center gap-2">
            <span className="text-white">{fmt(walletBalance)} {token}</span>
            <button onClick={handleMint} disabled={isProcessing} className="text-xs text-blue-400 hover:text-blue-300">
              领取测试币
            </button>
          </div>
        </div>

        {/* 金额 */}
        <div className="relative">
          <input type="number" value={amount} onChange={e => setAmount(e.target.value)} placeholder="0"
            className="w-full bg-[#1e222d] text-white text-lg px-4 py-3 rounded-lg focus:outline-none focus:ring-1 focus:ring-blue-500" />
          <button onClick={() => walletBalance && setAmount(formatUnits(walletBalance, 6))}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-blue-500 text-sm">MAX</button>
        </div>

        {/* 快捷金额 */}
        <div className="flex gap-2">
          {["100", "500", "1000", "5000"].map(v => (
            <button key={v} onClick={() => setAmount(v)}
              className="flex-1 py-2 bg-[#1e222d] text-gray-400 text-sm rounded hover:text-white">${v}</button>
          ))}
        </div>

        {/* 按钮 */}
        <button
          onClick={needsApproval ? handleApprove : handleDeposit}
          disabled={isProcessing || !isConnected || (!needsApproval && amountBigInt === 0n)}
          className="w-full py-3 bg-blue-600 text-white font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed">
          {isProcessing ? "处理中..." : needsApproval ? `授权 ${token}` : "充值"}
        </button>
      </div>
    </div>
  );
}
