"use client";

import { useState, useCallback, useEffect } from "react";
import { useAccount, useBalance, useReadContract, useWriteContract, useWaitForTransactionReceipt } from "wagmi";
import { parseEther, formatEther, type Address } from "viem";
import { CONTRACTS, AMM_ABI, ERC20_ABI } from "@/lib/contracts";

/**
 * 报价结果
 */
export interface SwapQuote {
  amountIn: string;
  amountOut: string;
  priceImpact: number;
  fee: string;
  rate: string;
  minAmountOut: string;
}

/**
 * 现货交易 Hook
 */
export function useSpotSwap() {
  const { address, isConnected } = useAccount();
  const [isBuy, setIsBuy] = useState(true);
  const [amountIn, setAmountIn] = useState("");
  const [slippage, setSlippage] = useState(0.5); // 0.5%
  const [quote, setQuote] = useState<SwapQuote | null>(null);
  const [isQuoting, setIsQuoting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // ETH 余额
  const { data: ethBalance } = useBalance({
    address,
  });

  // MEME 代币余额
  const { data: memeBalance } = useBalance({
    address,
    token: CONTRACTS.MEME_TOKEN,
  });

  // AMM 是否激活
  const { data: isActive } = useReadContract({
    address: CONTRACTS.AMM,
    abi: AMM_ABI,
    functionName: "isActive",
  });

  // AMM 储备量
  const { data: reserves } = useReadContract({
    address: CONTRACTS.AMM,
    abi: AMM_ABI,
    functionName: "getReserves",
  });

  // 当前价格
  const { data: spotPrice } = useReadContract({
    address: CONTRACTS.AMM,
    abi: AMM_ABI,
    functionName: "getSpotPrice",
  });

  // 手续费率
  const { data: swapFee } = useReadContract({
    address: CONTRACTS.AMM,
    abi: AMM_ABI,
    functionName: "swapFee",
  });

  // MEME 代币授权额度
  const { data: allowance } = useReadContract({
    address: CONTRACTS.MEME_TOKEN,
    abi: ERC20_ABI,
    functionName: "allowance",
    args: address ? [address, CONTRACTS.AMM] : undefined,
    query: {
      enabled: !!address && !isBuy,
    },
  });

  // 写入合约
  const { writeContract, data: txHash, isPending: isSwapping, reset } = useWriteContract();

  // 等待交易确认
  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({
    hash: txHash,
  });

  /**
   * 获取输出数量
   */
  const { data: amountOutData, refetch: refetchAmountOut } = useReadContract({
    address: CONTRACTS.AMM,
    abi: AMM_ABI,
    functionName: "getAmountOut",
    args: amountIn ? [isBuy, parseEther(amountIn)] : undefined,
    query: {
      enabled: !!amountIn && parseFloat(amountIn) > 0,
    },
  });

  /**
   * 获取价格影响
   */
  const { data: priceImpactData } = useReadContract({
    address: CONTRACTS.AMM,
    abi: AMM_ABI,
    functionName: "getPriceImpact",
    args: amountIn ? [isBuy, parseEther(amountIn)] : undefined,
    query: {
      enabled: !!amountIn && parseFloat(amountIn) > 0,
    },
  });

  /**
   * 计算报价
   */
  useEffect(() => {
    if (!amountIn || parseFloat(amountIn) <= 0) {
      setQuote(null);
      return;
    }

    if (amountOutData && priceImpactData !== undefined && swapFee !== undefined) {
      const amountOut = formatEther(amountOutData as bigint);
      const priceImpact = Number(priceImpactData) / 100; // 转为百分比
      const feePercent = Number(swapFee) / 100;
      const fee = (parseFloat(amountIn) * feePercent / 100).toFixed(6);

      // 计算汇率
      const rate = (parseFloat(amountOut) / parseFloat(amountIn)).toFixed(6);

      // 计算最小输出（考虑滑点）
      const minAmountOut = (parseFloat(amountOut) * (1 - slippage / 100)).toFixed(18);

      setQuote({
        amountIn,
        amountOut,
        priceImpact,
        fee,
        rate,
        minAmountOut,
      });
    }
  }, [amountIn, amountOutData, priceImpactData, swapFee, slippage]);

  /**
   * 检查是否需要授权
   */
  const needsApproval = useCallback(() => {
    if (isBuy || !amountIn || !allowance) return false;
    const amountWei = parseEther(amountIn);
    return (allowance as bigint) < amountWei;
  }, [isBuy, amountIn, allowance]);

  /**
   * 授权 MEME 代币
   */
  const approve = useCallback(async () => {
    if (!address) return;

    try {
      writeContract({
        address: CONTRACTS.MEME_TOKEN,
        abi: ERC20_ABI,
        functionName: "approve",
        args: [CONTRACTS.AMM, parseEther("1000000000")], // 授权大额度
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "授权失败");
    }
  }, [address, writeContract]);

  /**
   * 执行交换
   */
  const executeSwap = useCallback(async () => {
    if (!address || !quote) return;

    setError(null);

    try {
      const minAmountOut = parseEther(quote.minAmountOut);

      if (isBuy) {
        // BNB -> MEME
        writeContract({
          address: CONTRACTS.AMM,
          abi: AMM_ABI,
          functionName: "swapBNBForMeme",
          args: [minAmountOut],
          value: parseEther(quote.amountIn),
        });
      } else {
        // MEME -> BNB
        writeContract({
          address: CONTRACTS.AMM,
          abi: AMM_ABI,
          functionName: "swapMemeForBNB",
          args: [parseEther(quote.amountIn), minAmountOut],
        });
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "交易失败");
    }
  }, [address, quote, isBuy, writeContract]);

  /**
   * 切换买卖方向
   */
  const toggleDirection = useCallback(() => {
    setIsBuy((prev) => !prev);
    setAmountIn("");
    setQuote(null);
    reset();
  }, [reset]);

  /**
   * 重置状态
   */
  const resetState = useCallback(() => {
    setAmountIn("");
    setQuote(null);
    setError(null);
    reset();
  }, [reset]);

  // 交易成功后重置
  useEffect(() => {
    if (isSuccess) {
      setTimeout(() => {
        resetState();
      }, 2000);
    }
  }, [isSuccess, resetState]);

  return {
    // 状态
    isBuy,
    amountIn,
    slippage,
    quote,
    isQuoting,
    error,

    // 余额
    ethBalance: ethBalance?.value ? formatEther(ethBalance.value) : "0",
    memeBalance: memeBalance?.value ? formatEther(memeBalance.value) : "0",

    // AMM 状态
    isActive: isActive as boolean,
    reserves: reserves
      ? {
          bnb: formatEther((reserves as [bigint, bigint])[0]),
          meme: formatEther((reserves as [bigint, bigint])[1]),
        }
      : null,
    spotPrice: spotPrice ? formatEther(spotPrice as bigint) : "0",

    // 交易状态
    isSwapping: isSwapping || isConfirming,
    isSuccess,
    txHash,

    // 授权
    needsApproval: needsApproval(),

    // 操作
    setAmountIn,
    setSlippage,
    toggleDirection,
    approve,
    executeSwap,
    resetState,
    refetchQuote: refetchAmountOut,
  };
}

export default useSpotSwap;
