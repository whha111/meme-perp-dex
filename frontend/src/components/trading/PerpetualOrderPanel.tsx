"use client";

import React, { useState, useMemo, useCallback, useEffect } from "react";
import { useAccount, useWriteContract, useWaitForTransactionReceipt, useReadContract, useBalance, useEstimateGas, useGasPrice } from "wagmi";
import { useConnectModal } from "@rainbow-me/rainbowkit";
import { useTranslations } from "next-intl";
import { parseEther, formatEther, type Address } from "viem";
import { useToast } from "@/components/shared/Toast";
import {
  usePerpetualStore,
  useAccountBalance,
  usePositionByInstId,
  useLeverageSettings,
  useOrderForm,
  PositionSide,
  MarginMode,
  OrderType,
} from "@/lib/stores/perpetualStore";
import POSITION_MANAGER_ABI from "@/abis/PositionManager.json";
import VAULT_ABI from "@/abis/Vault.json";
import { useETHPrice } from "@/hooks/useETHPrice";
import { usePerpetualToken, POSITION_MANAGER_ABI as PM_ABI, PRICE_FEED_ABI } from "@/hooks/usePerpetual";

// Contract addresses - Updated 2026-01-25 (Fixed to use correct deployed contracts)
const POSITION_MANAGER_ADDRESS = (process.env.NEXT_PUBLIC_POSITION_MANAGER_ADDRESS ||
  "0xA61536C0D7B603D32F9e9D33Ad4C90fAA8315bb4") as Address;
const VAULT_ADDRESS = (process.env.NEXT_PUBLIC_VAULT_ADDRESS ||
  "0x088ACA5fD043fFf33F4AC6E7F60A23a549C9c9f1") as Address;

// M-002: Type definition for on-chain Position data
interface OnChainPosition {
  isLong: boolean;
  size: bigint;
  collateral: bigint;
  entryPrice: bigint;
  leverage: bigint;
  lastFundingTime: bigint;
  accFundingFee: bigint;
}

// Type guard for Position data
function isValidPosition(pos: unknown): pos is OnChainPosition {
  if (!pos || typeof pos !== 'object') return false;
  const p = pos as Record<string, unknown>;
  return (
    typeof p.isLong === 'boolean' &&
    typeof p.size === 'bigint' &&
    typeof p.collateral === 'bigint' &&
    typeof p.entryPrice === 'bigint' &&
    typeof p.leverage === 'bigint'
  );
}

// M-005: Contract error mappings for user-friendly messages
const CONTRACT_ERROR_MESSAGES: Record<string, string> = {
  // PositionManager errors
  "PositionNotFound": "No position found. You need to open a position first.",
  "PositionAlreadyExists": "You already have an existing position. Close it first or modify it.",
  "InvalidLeverage": "Invalid leverage value. Please choose between 1x and 100x.",
  "InvalidSize": "Invalid position size. Please enter a valid amount.",
  "InsufficientMargin": "Insufficient margin. Increase collateral or reduce position size.",
  "InsufficientCollateral": "Insufficient collateral to support this position.",
  "CannotRemoveCollateral": "Cannot remove collateral. It would put the position at risk.",
  "Unauthorized": "You are not authorized to perform this action.",
  "ZeroAddress": "Invalid address provided.",
  "ValidationFailed": "Validation failed. Please check your inputs.",
  "TokenNotSupported": "This token is not supported for trading.",
  "InsufficientCrossMargin": "Insufficient cross margin balance.",
  "InvalidMarginMode": "Invalid margin mode selected.",
  // Vault errors
  "InsufficientBalance": "Insufficient balance in Vault. Please deposit more ETH.",
  "InsufficientLockedBalance": "Insufficient locked balance.",
  "InvalidAmount": "Invalid amount entered.",
  "TransferFailed": "Transfer failed. Please try again.",
  "InsuranceFundInsufficient": "Insurance fund is insufficient. Please try a smaller position.",
  // Common errors
  "UserRejectedRequestError": "Transaction was rejected by user.",
  "InsufficientFundsError": "Insufficient funds for gas.",
};

// M-005: Parse contract errors into user-friendly messages
function parseContractError(error: Error | null): string {
  if (!error) return "Unknown error occurred";

  const errorMessage = error.message || "";
  const errorName = (error as { name?: string }).name || "";

  // Check for user rejection
  if (errorMessage.includes("User rejected") || errorMessage.includes("user rejected") ||
      errorName === "UserRejectedRequestError") {
    return "Transaction cancelled by user";
  }

  // Check for insufficient funds
  if (errorMessage.includes("insufficient funds") || errorMessage.includes("InsufficientFunds")) {
    return "Insufficient ETH for gas fees";
  }

  // Parse custom contract errors
  for (const [errorType, friendlyMessage] of Object.entries(CONTRACT_ERROR_MESSAGES)) {
    if (errorMessage.includes(errorType) || errorName.includes(errorType)) {
      return friendlyMessage;
    }
  }

  // Parse revert reason strings
  const revertMatch = errorMessage.match(/reverted with reason string ['"]([^'"]+)['"]/);
  if (revertMatch) {
    return revertMatch[1];
  }

  // Parse custom error with data
  const customErrorMatch = errorMessage.match(/reverted with custom error ['"]([^'"]+)['"]/);
  if (customErrorMatch) {
    const errorType = customErrorMatch[1];
    return CONTRACT_ERROR_MESSAGES[errorType] || `Contract error: ${errorType}`;
  }

  // Check for execution reverted
  if (errorMessage.includes("execution reverted")) {
    // Try to extract more specific info
    if (errorMessage.includes("InsufficientBalance")) {
      return CONTRACT_ERROR_MESSAGES["InsufficientBalance"];
    }
    return "Transaction failed. Please check your inputs and try again.";
  }

  // Fallback: truncate long messages
  if (errorMessage.length > 100) {
    return "Transaction failed. Please try again.";
  }

  return errorMessage || "An unexpected error occurred";
}

interface PerpetualOrderPanelProps {
  symbol: string;
  displaySymbol?: string;  // 显示用的代币符号
  tokenAddress?: Address;  // F-01/F-02: 代币合约地址（用于多代币支持）
  className?: string;
  isPerpEnabled?: boolean; // 合约交易是否已启用
}

// Leverage options
const LEVERAGE_OPTIONS = [1, 2, 3, 5, 10, 20, 50, 75, 100];

export function PerpetualOrderPanel({ symbol, displaySymbol, tokenAddress, className, isPerpEnabled = true }: PerpetualOrderPanelProps) {
  const { address, isConnected } = useAccount();
  const { openConnectModal } = useConnectModal();
  const { showToast } = useToast();
  const t = useTranslations("perp");
  const tc = useTranslations("common");

  // ETH price for USD calculations
  const { price: ethPrice } = useETHPrice();

  // 使用 displaySymbol 或 symbol
  const tokenSymbol = displaySymbol || symbol;

  // F-01/F-02: 使用多代币永续合约 hook
  const {
    position: tokenPosition,
    hasPosition: hasTokenPosition,
    unrealizedPnL: tokenUnrealizedPnL,
    liquidationPrice: tokenLiquidationPrice,
    marginRatio: tokenMarginRatio, // F-06: 保证金率
    markPrice: tokenMarkPrice,
    isTokenSupported,
    openLongToken,
    openShortToken,
    closePositionToken,
    isPending: isTokenPending,
    isConfirming: isTokenConfirming,
    refetchPosition: refetchTokenPosition,
  } = usePerpetualToken(tokenAddress);

  // Store state
  const instId = `${tokenSymbol.toUpperCase()}-PERP`;
  const accountBalance = useAccountBalance();
  const position = usePositionByInstId(instId);
  const leverageSettings = useLeverageSettings(instId);
  const orderForm = useOrderForm();

  // Local UI state
  const [showLeverageSlider, setShowLeverageSlider] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showDepositWithdraw, setShowDepositWithdraw] = useState(false);
  const [depositAmount, setDepositAmount] = useState("");
  const [withdrawAmount, setWithdrawAmount] = useState("");
  const [activeTab, setActiveTab] = useState<"deposit" | "withdraw">("deposit");
  // L-001: Input validation state
  const [amountError, setAmountError] = useState<string | null>(null);
  const [amountUnit, setAmountUnit] = useState<"USDT" | "ETH" | "TOKEN">("USDT"); // 用户选择的单位
  const [depositError, setDepositError] = useState<string | null>(null);
  const [withdrawError, setWithdrawError] = useState<string | null>(null);

  // Get store actions via getState() to avoid infinite re-renders
  const updateOrderForm = usePerpetualStore.getState().updateOrderForm;
  const updateLeverage = usePerpetualStore.getState().updateLeverage;
  const updateMarginMode = usePerpetualStore.getState().updateMarginMode;

  // Contract write hooks
  const { writeContract, data: txHash, isPending: isWritePending, error: writeError } = useWriteContract();
  const { isLoading: isConfirming, isSuccess: isConfirmed } = useWaitForTransactionReceipt({
    hash: txHash,
  });

  // M-004: Gas price for transaction cost estimation
  const { data: gasPrice } = useGasPrice();

  // M-004: Estimated transaction cost display
  const estimatedGasCost = useMemo(() => {
    // Average gas for openLong/openShort is ~200,000 gas
    const estimatedGas = 200000n;
    if (!gasPrice) return null;
    const costWei = estimatedGas * gasPrice;
    const costETH = Number(costWei) / 1e18;
    return costETH.toFixed(6);
  }, [gasPrice]);

  // M-001: Read LEVERAGE_PRECISION from contract instead of hardcoding
  const { data: leveragePrecision } = useReadContract({
    address: POSITION_MANAGER_ADDRESS,
    abi: POSITION_MANAGER_ABI,
    functionName: "LEVERAGE_PRECISION",
  });

  // Read vault balance
  const { data: vaultBalance, refetch: refetchVaultBalance, error: vaultError, isLoading: vaultLoading } = useReadContract({
    address: VAULT_ADDRESS,
    abi: VAULT_ABI,
    functionName: "getBalance",
    args: address ? [address] : undefined,
    query: {
      enabled: !!address,
    },
  });

  // Debug logging
  useEffect(() => {
    console.log("[VaultDebug] VAULT_ADDRESS:", VAULT_ADDRESS);
    console.log("[VaultDebug] User address:", address);
    console.log("[VaultDebug] Vault balance:", vaultBalance?.toString());
    console.log("[VaultDebug] Vault error:", vaultError);
    console.log("[VaultDebug] Vault loading:", vaultLoading);
  }, [address, vaultBalance, vaultError, vaultLoading]);

  // Read locked balance
  const { data: lockedBalance } = useReadContract({
    address: VAULT_ADDRESS,
    abi: VAULT_ABI,
    functionName: "getLockedBalance",
    args: address ? [address] : undefined,
    query: {
      enabled: !!address,
    },
  });

  // Read position from chain
  const { data: onChainPosition, refetch: refetchPosition } = useReadContract({
    address: POSITION_MANAGER_ADDRESS,
    abi: POSITION_MANAGER_ABI,
    functionName: "getPosition",
    args: address ? [address] : undefined,
    query: {
      enabled: !!address,
      refetchInterval: 5000, // Refetch every 5 seconds
    },
  });

  // Read wallet ETH balance
  const { data: walletBalance } = useBalance({
    address: address,
  });

  // Format vault balance for display
  const formattedVaultBalance = useMemo(() => {
    if (!vaultBalance) return "0.0000";
    return parseFloat(formatEther(vaultBalance as bigint)).toFixed(4);
  }, [vaultBalance]);

  const formattedLockedBalance = useMemo(() => {
    if (!lockedBalance) return "0.0000";
    return parseFloat(formatEther(lockedBalance as bigint)).toFixed(4);
  }, [lockedBalance]);

  const formattedWalletBalance = useMemo(() => {
    if (!walletBalance) return "0.0000";
    return parseFloat(walletBalance.formatted).toFixed(4);
  }, [walletBalance]);

  // M-002: Parse on-chain position data with type safety
  const chainPosition = useMemo(() => {
    if (!onChainPosition) return null;
    // Use type guard for safe type checking
    if (!isValidPosition(onChainPosition)) {
      console.warn("[Position] Invalid position data format:", onChainPosition);
      return null;
    }
    // Check if position exists (size > 0)
    if (onChainPosition.size === 0n) return null;

    const precision = leveragePrecision ? Number(leveragePrecision) : 10000;
    return {
      isLong: onChainPosition.isLong,
      size: formatEther(onChainPosition.size),
      collateral: formatEther(onChainPosition.collateral),
      entryPrice: formatEther(onChainPosition.entryPrice),
      leverage: Number(onChainPosition.leverage) / precision,
    };
  }, [onChainPosition, leveragePrecision]);

  // Debug position data
  useEffect(() => {
    console.log("[PositionDebug] On-chain position:", onChainPosition);
    console.log("[PositionDebug] Parsed position:", chainPosition);
  }, [onChainPosition, chainPosition]);

  // Handle transaction confirmation
  useEffect(() => {
    if (isConfirmed && txHash) {
      showToast(`Order confirmed! Tx: ${txHash.slice(0, 10)}...`, "success");
      setIsSubmitting(false);
      // Reset form
      updateOrderForm({ size: "", price: "" });
      setAmount("");
      // Refetch position and balance data
      refetchPosition();
      refetchVaultBalance();
      // F-01/F-02: 也刷新多代币仓位数据
      if (tokenAddress) {
        refetchTokenPosition();
      }
    }
  }, [isConfirmed, txHash, showToast, updateOrderForm, refetchPosition, refetchVaultBalance, tokenAddress, refetchTokenPosition]);

  // M-005: Handle write errors with user-friendly messages
  useEffect(() => {
    if (writeError) {
      console.error("[Order Error]", writeError);
      const friendlyMessage = parseContractError(writeError);
      showToast(friendlyMessage, "error");
      setIsSubmitting(false);
    }
  }, [writeError, showToast]);

  // Set selected instrument on mount - use getState() to avoid subscribing to entire store
  useEffect(() => {
    usePerpetualStore.getState().setSelectedInstId(instId);
  }, [instId]);

  // Derive state from store
  const side = orderForm.side;
  const marginMode = orderForm.marginMode;
  const leverage = orderForm.leverage;
  const amount = orderForm.size;

  // Handlers
  const setSide = (newSide: PositionSide) => updateOrderForm({ side: newSide });
  const setMarginMode = (mode: MarginMode) => {
    updateMarginMode(instId, mode);
  };
  const setLeverage = (lev: number) => updateLeverage(instId, lev);

  // Handlers (simplified without complex validation to avoid white screen)
  const setAmount = (val: string) => {
    updateOrderForm({ size: val });
    // Simple validation
    if (val && !/^\d*\.?\d*$/.test(val)) {
      setAmountError("Please enter a valid number");
    } else {
      setAmountError(null);
    }
  };

  // Simple deposit validation
  const validateAndSetDeposit = (val: string) => {
    setDepositAmount(val);
    if (val && !/^\d*\.?\d*$/.test(val)) {
      setDepositError("Invalid number");
    } else {
      setDepositError(null);
    }
  };

  // Simple withdraw validation
  const validateAndSetWithdraw = (val: string) => {
    setWithdrawAmount(val);
    if (val && !/^\d*\.?\d*$/.test(val)) {
      setWithdrawError("Invalid number");
    } else {
      setWithdrawError(null);
    }
  };

  // Balance data from store or defaults
  const balance = useMemo(() => ({
    available: accountBalance?.available || "0.00",
    total: accountBalance?.total || "0.00",
    unrealizedPnl: accountBalance?.unrealizedPnl || "0.00",
  }), [accountBalance]);

  // Position data from store or defaults
  const positionData = useMemo(() => ({
    size: position?.size || "0",
    entryPrice: position?.entryPrice || "0",
    markPrice: position?.markPrice || "0",
    unrealizedPnl: position?.unrealizedPnl || "0",
    liquidationPrice: position?.liquidationPrice || "0",
    margin: position?.margin || "0",
    leverage: position?.leverage || leverage,
    side: position?.side || "long",
  }), [position, leverage]);

  // 获取代币价格 (USD)
  const tokenPriceUSD = useMemo(() => {
    if (tokenMarkPrice) {
      // tokenMarkPrice 是 1e12 精度
      return Number(tokenMarkPrice) / 1e12;
    }
    return 0;
  }, [tokenMarkPrice]);

  // 根据用户选择的单位，统一换算成仓位价值 (USDT)
  const { positionValueUSDT, positionSizeETH } = useMemo(() => {
    const inputAmount = parseFloat(amount) || 0;
    if (inputAmount <= 0) {
      return { positionValueUSDT: 0, positionSizeETH: 0 };
    }

    let valueUSDT = 0;

    if (amountUnit === "USDT") {
      // 直接是 USDT 金额
      valueUSDT = inputAmount;
    } else if (amountUnit === "ETH") {
      // ETH 转 USDT
      valueUSDT = inputAmount * (ethPrice || 0);
    } else if (amountUnit === "TOKEN") {
      // 代币数量 * 代币价格 = USDT
      valueUSDT = inputAmount * tokenPriceUSD;
    }

    // 换算成 ETH（合约需要）
    const sizeETH = ethPrice ? valueUSDT / ethPrice : 0;

    return { positionValueUSDT: valueUSDT, positionSizeETH: sizeETH };
  }, [amount, amountUnit, ethPrice, tokenPriceUSD]);

  // 计算所需保证金
  const { requiredMarginUSDT, requiredMarginETH } = useMemo(() => {
    if (positionValueUSDT <= 0 || !ethPrice) {
      return { requiredMarginUSDT: "0.00", requiredMarginETH: "0.0000" };
    }
    const marginUSDT = positionValueUSDT / leverage;
    const feeUSDT = positionValueUSDT * 0.001; // 0.1% 开仓手续费
    const totalUSDT = marginUSDT + feeUSDT;
    const totalETH = totalUSDT / ethPrice;
    return {
      requiredMarginUSDT: totalUSDT.toFixed(4),
      requiredMarginETH: totalETH.toFixed(6),
    };
  }, [positionValueUSDT, leverage, ethPrice]);

  // 兼容旧代码
  const requiredMargin = requiredMarginETH;

  // Check if vault balance is sufficient
  const { hasSufficientBalance, vaultBalanceETH } = useMemo(() => {
    const balanceWei = vaultBalance ? BigInt(vaultBalance.toString()) : 0n;
    const balanceETH = Number(balanceWei) / 1e18;
    const requiredETH = parseFloat(requiredMarginETH) || 0;
    return {
      hasSufficientBalance: balanceETH >= requiredETH,
      vaultBalanceETH: balanceETH.toFixed(4),
    };
  }, [vaultBalance, requiredMarginETH]);

  const handlePlaceOrder = useCallback(async () => {
    if (!isConnected) {
      openConnectModal?.();
      return;
    }

    if (!amount || parseFloat(amount) <= 0) {
      showToast("Please enter a valid amount", "error");
      return;
    }

    // Check vault balance before placing order
    if (!hasSufficientBalance) {
      showToast(t("insufficientBalance") || "Insufficient Vault balance. Please deposit first.", "error");
      setShowDepositWithdraw(true);
      setActiveTab("deposit");
      return;
    }

    try {
      setIsSubmitting(true);

      // 使用换算后的 ETH 数量
      if (!ethPrice || ethPrice <= 0) {
        showToast("无法获取 ETH 价格，请稍后重试", "error");
        setIsSubmitting(false);
        return;
      }

      if (positionSizeETH <= 0) {
        showToast("请输入有效的开仓数量", "error");
        setIsSubmitting(false);
        return;
      }

      const sizeETHString = positionSizeETH.toFixed(18); // 保持足够精度

      console.log(`[Order] Unit: ${amountUnit}, Input: ${amount}, Value: $${positionValueUSDT.toFixed(2)}, Size ETH: ${positionSizeETH}`);

      // F-01/F-02: 使用多代币函数（如果提供了 tokenAddress）
      if (tokenAddress) {
        // marginMode: 0 = ISOLATED, 1 = CROSS
        const marginModeValue = marginMode === "cross" ? 1 : 0;

        if (side === "long") {
          await openLongToken(sizeETHString, leverage, marginModeValue);
        } else {
          await openShortToken(sizeETHString, leverage, marginModeValue);
        }
        showToast(`${side === "long" ? "做多" : "做空"} $${positionValueUSDT.toFixed(2)} 订单已提交...`, "info");
        return;
      }

      // Legacy: 没有 tokenAddress 时使用旧函数
      const sizeWei = parseEther(sizeETHString);

      // M-001: Use contract's LEVERAGE_PRECISION instead of hardcoded value
      const LEVERAGE_PRECISION_VALUE = leveragePrecision ? BigInt(leveragePrecision.toString()) : 10000n;
      const leverageValue = BigInt(leverage) * LEVERAGE_PRECISION_VALUE;

      // Call the appropriate contract function based on side
      if (side === "long") {
        writeContract({
          address: POSITION_MANAGER_ADDRESS,
          abi: POSITION_MANAGER_ABI,
          functionName: "openLong",
          args: [sizeWei, leverageValue],
        });
      } else {
        writeContract({
          address: POSITION_MANAGER_ADDRESS,
          abi: POSITION_MANAGER_ABI,
          functionName: "openShort",
          args: [sizeWei, leverageValue],
        });
      }

      showToast(`${side === "long" ? "Long" : "Short"} order submitted...`, "info");
    } catch (error) {
      console.error("[Order Error]", error);
      const friendlyMessage = parseContractError(error as Error);
      showToast(friendlyMessage, "error");
      setIsSubmitting(false);
    }
  }, [isConnected, openConnectModal, amount, side, showToast, leverage, writeContract, hasSufficientBalance, t, leveragePrecision, tokenAddress, marginMode, openLongToken, openShortToken]);

  // F-08: 平仓处理函数
  const handleClosePosition = useCallback(async () => {
    if (!isConnected) {
      openConnectModal?.();
      return;
    }

    try {
      setIsSubmitting(true);

      if (tokenAddress) {
        await closePositionToken();
        showToast("Close position submitted...", "info");
      } else {
        writeContract({
          address: POSITION_MANAGER_ADDRESS,
          abi: POSITION_MANAGER_ABI,
          functionName: "closePosition",
        });
        showToast("Close position submitted...", "info");
      }
    } catch (error) {
      console.error("[Close Position Error]", error);
      const friendlyMessage = parseContractError(error as Error);
      showToast(friendlyMessage, "error");
      setIsSubmitting(false);
    }
  }, [isConnected, openConnectModal, tokenAddress, closePositionToken, writeContract, showToast]);

  // Handle deposit
  const handleDeposit = useCallback(async () => {
    if (!isConnected) {
      openConnectModal?.();
      return;
    }

    if (!depositAmount || parseFloat(depositAmount) <= 0) {
      showToast("Please enter a valid amount", "error");
      return;
    }

    try {
      const depositWei = parseEther(depositAmount);
      writeContract({
        address: VAULT_ADDRESS,
        abi: VAULT_ABI,
        functionName: "deposit",
        value: depositWei,
      });
      showToast(t("depositSubmitted") || "Deposit submitted", "info");
    } catch (error) {
      console.error("[Deposit Error]", error);
      const friendlyMessage = parseContractError(error as Error);
      showToast(friendlyMessage, "error");
    }
  }, [isConnected, openConnectModal, depositAmount, showToast, writeContract, t]);

  // Handle withdraw
  const handleWithdraw = useCallback(async () => {
    if (!isConnected) {
      openConnectModal?.();
      return;
    }

    if (!withdrawAmount || parseFloat(withdrawAmount) <= 0) {
      showToast("Please enter a valid amount", "error");
      return;
    }

    try {
      const withdrawWei = parseEther(withdrawAmount);
      writeContract({
        address: VAULT_ADDRESS,
        abi: VAULT_ABI,
        functionName: "withdraw",
        args: [withdrawWei],
      });
      showToast(t("withdrawSubmitted") || "Withdrawal submitted", "info");
    } catch (error) {
      console.error("[Withdraw Error]", error);
      const friendlyMessage = parseContractError(error as Error);
      showToast(friendlyMessage, "error");
    }
  }, [isConnected, openConnectModal, withdrawAmount, showToast, writeContract, t]);

  // Refetch vault balance after transaction confirmation
  useEffect(() => {
    if (isConfirmed) {
      refetchVaultBalance();
      setDepositAmount("");
      setWithdrawAmount("");
    }
  }, [isConfirmed, refetchVaultBalance]);

  return (
    <div className={`bg-okx-bg-secondary rounded-lg ${className}`}>
      {/* Header with Balance */}
      <div className="p-4 border-b border-okx-border-primary">
        <div className="flex justify-between items-center mb-2">
          <span className="text-okx-text-secondary text-[12px]">{t("vaultBalance")} (ETH)</span>
          {/* L-002: Loading indicator */}
          {vaultLoading ? (
            <span className="text-okx-text-tertiary text-[14px] animate-pulse">Loading...</span>
          ) : (
            <span className="text-okx-text-primary text-[14px] font-medium">{formattedVaultBalance} ETH</span>
          )}
        </div>
        <div className="flex justify-between items-center text-[11px] text-okx-text-tertiary mb-2">
          <span>{t("lockedMargin")}</span>
          {vaultLoading ? (
            <span className="animate-pulse">---</span>
          ) : (
            <span>{formattedLockedBalance} ETH</span>
          )}
        </div>
        <div className="flex justify-between items-center text-[11px] text-okx-text-tertiary mb-3">
          <span>{t("walletBalance")}</span>
          <span>{formattedWalletBalance} ETH</span>
        </div>
        <button
          onClick={() => setShowDepositWithdraw(!showDepositWithdraw)}
          className="w-full py-2 text-[12px] font-medium bg-[#A3E635] hover:bg-[#84cc16] text-black rounded transition-colors"
        >
          {showDepositWithdraw ? t("hide") : t("depositWithdraw")}
        </button>
      </div>

      {/* Deposit/Withdraw Section */}
      {showDepositWithdraw && (
        <div className="p-4 border-b border-okx-border-primary bg-okx-bg-hover/50">
          {/* Tab Selector */}
          <div className="flex gap-2 mb-3">
            <button
              onClick={() => setActiveTab("deposit")}
              className={`flex-1 py-1.5 text-[12px] rounded transition-colors ${
                activeTab === "deposit"
                  ? "bg-okx-up text-white"
                  : "text-okx-text-tertiary hover:text-okx-text-secondary bg-okx-bg-hover"
              }`}
            >
              {t("deposit")}
            </button>
            <button
              onClick={() => setActiveTab("withdraw")}
              className={`flex-1 py-1.5 text-[12px] rounded transition-colors ${
                activeTab === "withdraw"
                  ? "bg-okx-down text-white"
                  : "text-okx-text-tertiary hover:text-okx-text-secondary bg-okx-bg-hover"
              }`}
            >
              {t("withdraw")}
            </button>
          </div>

          {activeTab === "deposit" ? (
            <div className="space-y-3">
              <div>
                <div className="flex justify-between text-[11px] mb-1">
                  <span className="text-okx-text-tertiary">Deposit Amount</span>
                  <span className="text-okx-text-tertiary">Available: {formattedWalletBalance} ETH</span>
                </div>
                <input
                  type="text"
                  value={depositAmount}
                  onChange={(e) => validateAndSetDeposit(e.target.value)}
                  placeholder="0.00"
                  className={`w-full bg-okx-bg-hover border rounded px-3 py-2 text-[14px] text-okx-text-primary placeholder:text-okx-text-tertiary outline-none ${
                    depositError ? "border-okx-down focus:border-okx-down" : "border-okx-border-primary focus:border-[#A3E635]"
                  }`}
                />
                {depositError && (
                  <div className="text-[10px] text-okx-down mt-1">{depositError}</div>
                )}
                <div className="flex gap-2 mt-2">
                  {[25, 50, 75, 100].map((pct) => (
                    <button
                      key={pct}
                      onClick={() => {
                        if (walletBalance) {
                          const maxAmount = parseFloat(walletBalance.formatted) * (pct / 100);
                          setDepositAmount(maxAmount.toFixed(4));
                        }
                      }}
                      className="flex-1 py-1 text-[11px] text-okx-text-tertiary bg-okx-bg-hover rounded hover:text-okx-text-secondary transition-colors"
                    >
                      {pct}%
                    </button>
                  ))}
                </div>
              </div>
              <button
                onClick={handleDeposit}
                disabled={!depositAmount || parseFloat(depositAmount) <= 0 || isWritePending || isConfirming || !!depositError}
                className="w-full py-2.5 rounded font-medium text-[13px] bg-okx-up hover:bg-okx-up/90 text-white disabled:bg-okx-up/50 disabled:cursor-not-allowed transition-colors"
              >
                {isWritePending || isConfirming ? "Processing..." : "Deposit ETH"}
              </button>
            </div>
          ) : (
            <div className="space-y-3">
              <div>
                <div className="flex justify-between text-[11px] mb-1">
                  <span className="text-okx-text-tertiary">Withdraw Amount</span>
                  <span className="text-okx-text-tertiary">Available: {formattedVaultBalance} ETH</span>
                </div>
                <input
                  type="text"
                  value={withdrawAmount}
                  onChange={(e) => validateAndSetWithdraw(e.target.value)}
                  placeholder="0.00"
                  className={`w-full bg-okx-bg-hover border rounded px-3 py-2 text-[14px] text-okx-text-primary placeholder:text-okx-text-tertiary outline-none ${
                    withdrawError ? "border-okx-down focus:border-okx-down" : "border-okx-border-primary focus:border-[#A3E635]"
                  }`}
                />
                {withdrawError && (
                  <div className="text-[10px] text-okx-down mt-1">{withdrawError}</div>
                )}
                <div className="flex gap-2 mt-2">
                  {[25, 50, 75, 100].map((pct) => (
                    <button
                      key={pct}
                      onClick={() => {
                        if (vaultBalance) {
                          const maxAmount = parseFloat(formatEther(vaultBalance as bigint)) * (pct / 100);
                          setWithdrawAmount(maxAmount.toFixed(4));
                        }
                      }}
                      className="flex-1 py-1 text-[11px] text-okx-text-tertiary bg-okx-bg-hover rounded hover:text-okx-text-secondary transition-colors"
                    >
                      {pct}%
                    </button>
                  ))}
                </div>
              </div>
              <button
                onClick={handleWithdraw}
                disabled={!withdrawAmount || parseFloat(withdrawAmount) <= 0 || isWritePending || isConfirming || !!withdrawError}
                className="w-full py-2.5 rounded font-medium text-[13px] bg-okx-down hover:bg-okx-down/90 text-white disabled:bg-okx-down/50 disabled:cursor-not-allowed transition-colors"
              >
                {isWritePending || isConfirming ? "Processing..." : "Withdraw ETH"}
              </button>
            </div>
          )}
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
          <span className="text-okx-text-secondary text-[12px]">{t("leverage") || "Leverage"}</span>
          <button
            onClick={() => setShowLeverageSlider(!showLeverageSlider)}
            className="flex items-center gap-1 text-[14px] text-okx-text-primary font-medium hover:text-[#A3E635] transition-colors"
          >
            {leverage}x
            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
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
                    leverage === lev ? "text-[#A3E635]" : "hover:text-okx-text-secondary"
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
        {/* Order Type - 仅支持市价单 */}
        <div className="flex gap-2 text-[12px]">
          <div className="px-3 py-1 rounded bg-okx-bg-hover text-okx-text-primary">
            {t("market") || "Market"}
          </div>
          <span className="px-2 py-1 text-okx-text-tertiary text-[10px]">
            {t("limitComingSoon") || "Limit orders coming soon"}
          </span>
        </div>

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
                amountError ? "border-okx-down focus:border-okx-down" : "border-okx-border-primary focus:border-[#A3E635]"
              }`}
            />
            <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[11px] text-[#A3E635] font-medium">
              {amountUnit === "TOKEN" ? "代币" : amountUnit}
            </span>
          </div>
          {/* L-001: Validation error message */}
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

        {/* TP/SL - 功能即将推出提示 */}
        <div className="flex items-center justify-between text-[11px] text-okx-text-tertiary">
          <span>{t("tpSl") || "TP/SL"}</span>
          <span>{t("comingSoon") || "Coming soon"}</span>
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
          {/* 所需保证金 */}
          <div className="flex justify-between">
            <span className="text-okx-text-tertiary">所需保证金</span>
            <span className="text-okx-text-primary">
              ${requiredMarginUSDT} USDT
            </span>
          </div>
          {/* 手续费 */}
          <div className="flex justify-between">
            <span className="text-okx-text-tertiary">手续费 (0.1%)</span>
            <span className="text-okx-text-primary">
              ${(positionValueUSDT * 0.001).toFixed(4)} USDT
            </span>
          </div>
          {/* 合计所需 ETH */}
          <div className="flex justify-between border-t border-okx-border-primary pt-2">
            <span className="text-okx-text-secondary font-medium">合计所需</span>
            <span className="text-okx-text-primary font-medium">
              {requiredMarginETH} ETH
              <span className="text-okx-text-tertiary ml-1">(≈ ${requiredMarginUSDT})</span>
            </span>
          </div>
          {/* Vault 余额 */}
          <div className="flex justify-between pt-1">
            <span className="text-okx-text-tertiary">Vault 余额</span>
            <span className={`font-medium ${hasSufficientBalance ? "text-okx-text-primary" : "text-okx-down"}`}>
              {vaultBalanceETH} ETH {ethPrice ? `≈ $${(parseFloat(vaultBalanceETH) * ethPrice).toFixed(2)}` : ""}
            </span>
          </div>
          {/* M-004: Estimated Gas Cost */}
          {estimatedGasCost && (
            <div className="flex justify-between pt-1">
              <span className="text-okx-text-tertiary">{t("estimatedGas") || "Est. Gas Cost"}</span>
              <span className="text-okx-text-tertiary">~{estimatedGasCost} ETH</span>
            </div>
          )}
        </div>

        {/* Insufficient Balance Warning */}
        {!hasSufficientBalance && parseFloat(amount) > 0 && (
          <div className="bg-okx-down/10 border border-okx-down/30 rounded p-2 text-[11px] text-okx-down">
            {t("insufficientBalanceWarning") || "Insufficient Vault balance. Please deposit ETH first."}
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
          disabled={!isPerpEnabled || !amount || parseFloat(amount) <= 0 || positionValueUSDT <= 0 || isSubmitting || isWritePending || isConfirming || isTokenPending || isTokenConfirming || (!hasSufficientBalance && positionValueUSDT > 0) || !!amountError}
          className={`w-full py-3 rounded font-medium text-[14px] transition-all ${
            !isPerpEnabled
              ? "bg-gray-600 text-gray-400"
              : side === "long"
              ? "bg-okx-up hover:bg-okx-up/90 text-white disabled:bg-okx-up/50"
              : "bg-okx-down hover:bg-okx-down/90 text-white disabled:bg-okx-down/50"
          } disabled:cursor-not-allowed`}
        >
          {!isPerpEnabled
            ? "永续合约暂未启用"
            : !isConnected
            ? "连接钱包"
            : !hasSufficientBalance && positionValueUSDT > 0
            ? "余额不足，请先充值"
            : isWritePending || isSubmitting || isTokenPending
            ? "提交中..."
            : isConfirming || isTokenConfirming
            ? "确认中..."
            : side === "long"
            ? `做多 ${positionValueUSDT > 0 ? `$${positionValueUSDT.toFixed(2)}` : ""}`
            : `做空 ${positionValueUSDT > 0 ? `$${positionValueUSDT.toFixed(2)}` : ""}`}
        </button>
      </div>

      {/* F-03/F-04/F-05/F-08: 当前仓位信息 */}
      {hasTokenPosition && tokenPosition && (
        <div className="p-4 border-t border-okx-border-primary">
          <div className="flex justify-between items-center mb-3">
            <span className="text-okx-text-secondary text-[13px] font-medium">
              {t("currentPosition") || "Current Position"}
            </span>
            <span className={`px-2 py-0.5 rounded text-[11px] font-medium ${
              tokenPosition.isLong
                ? "bg-okx-up/20 text-okx-up"
                : "bg-okx-down/20 text-okx-down"
            }`}>
              {tokenPosition.isLong ? "LONG" : "SHORT"} {Number(tokenPosition.leverage) / 10000}x
            </span>
          </div>

          <div className="bg-okx-bg-hover rounded p-3 space-y-2 text-[12px]">
            {/* F-03: 仓位大小 */}
            <div className="flex justify-between">
              <span className="text-okx-text-tertiary">{t("positionSize") || "Size"}</span>
              <span className="text-okx-text-primary">
                {parseFloat(formatEther(tokenPosition.size)).toFixed(4)} ETH
              </span>
            </div>

            {/* 开仓均价 */}
            <div className="flex justify-between">
              <span className="text-okx-text-tertiary">{t("entryPrice") || "Entry Price"}</span>
              <span className="text-okx-text-primary">
                {parseFloat(formatEther(tokenPosition.entryPrice)).toFixed(6)} ETH
              </span>
            </div>

            {/* 当前标记价格 */}
            {tokenMarkPrice && (
              <div className="flex justify-between">
                <span className="text-okx-text-tertiary">{t("markPrice") || "Mark Price"}</span>
                <span className="text-okx-text-primary">
                  {parseFloat(formatEther(tokenMarkPrice)).toFixed(6)} ETH
                </span>
              </div>
            )}

            {/* 保证金 */}
            <div className="flex justify-between">
              <span className="text-okx-text-tertiary">{t("collateral") || "Collateral"}</span>
              <span className="text-okx-text-primary">
                {parseFloat(formatEther(tokenPosition.collateral)).toFixed(4)} ETH
              </span>
            </div>

            {/* F-04: 未实现盈亏 */}
            {tokenUnrealizedPnL !== null && (
              <div className="flex justify-between border-t border-okx-border-primary pt-2">
                <span className="text-okx-text-tertiary">{t("unrealizedPnL") || "Unrealized PnL"}</span>
                <span className={`font-medium ${
                  tokenUnrealizedPnL >= 0n ? "text-okx-up" : "text-okx-down"
                }`}>
                  {tokenUnrealizedPnL >= 0n ? "+" : ""}
                  {parseFloat(formatEther(tokenUnrealizedPnL)).toFixed(4)} ETH
                </span>
              </div>
            )}

            {/* F-05: 强平价格 */}
            {tokenLiquidationPrice !== null && tokenLiquidationPrice > 0n && (
              <div className="flex justify-between">
                <span className="text-okx-text-tertiary">{t("liquidationPrice") || "Liq. Price"}</span>
                <span className="text-okx-down font-medium">
                  {parseFloat(formatEther(tokenLiquidationPrice)).toFixed(6)} ETH
                </span>
              </div>
            )}

            {/* F-06: 保证金率 */}
            {tokenMarginRatio !== null && tokenPosition && tokenPosition.size > 0n && (
              <div className="flex justify-between">
                <span className="text-okx-text-tertiary">{t("marginRatio") || "Margin Ratio"}</span>
                <span className={`font-medium ${
                  // 保证金率低于 5% 显示红色警告
                  tokenMarginRatio < parseEther("0.05")
                    ? "text-okx-down"
                    : tokenMarginRatio < parseEther("0.1")
                    ? "text-yellow-500"
                    : "text-okx-up"
                }`}>
                  {(Number(tokenMarginRatio) / 1e18 * 100).toFixed(2)}%
                </span>
              </div>
            )}
          </div>

          {/* F-08: 平仓按钮 */}
          <button
            onClick={handleClosePosition}
            disabled={isSubmitting || isWritePending || isConfirming || isTokenPending || isTokenConfirming}
            className="w-full mt-3 py-2.5 rounded font-medium text-[13px] bg-okx-down hover:bg-okx-down/90 text-white disabled:bg-okx-down/50 disabled:cursor-not-allowed transition-colors"
          >
            {isWritePending || isTokenPending
              ? "Submitting..."
              : isConfirming || isTokenConfirming
              ? "Confirming..."
              : t("closePosition") || "Close Position"}
          </button>
        </div>
      )}

    </div>
  );
}
