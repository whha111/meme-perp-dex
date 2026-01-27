"use client";

/**
 * 交易钱包 Hook
 *
 * 提供签名派生交易钱包的完整功能：
 * - 生成/恢复交易钱包
 * - 查询余额
 * - 发送交易
 * - 导出私钥
 */

import { useState, useCallback, useEffect, useMemo } from "react";
import {
  useAccount,
  useWalletClient,
  usePublicClient,
  useChainId,
} from "wagmi";
import {
  formatEther,
  parseEther,
  type Address,
  type Hex,
  createWalletClient,
  createPublicClient,
  http,
  encodeFunctionData,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { baseSepolia, base } from "viem/chains";
import {
  createTradingWallet,
  getWalletSigningMessage,
  saveTradingWallet,
  loadTradingWallet,
  clearTradingWallet,
  exportPrivateKey,
  derivePrivateKey,
} from "@/utils/tradingWallet";

// 配置
const RPC_URL =
  process.env.NEXT_PUBLIC_BASE_RPC_URL ||
  "https://base-sepolia.g.alchemy.com/v2/Dr8sMe-1MYIF7jBYuZZj8PMOPAAeJ16d";

// Backend API URL
const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8080";

// WETH 合约地址 (Base Sepolia 标准地址)
const WETH_ADDRESS: Address = "0x4200000000000000000000000000000000000006";

// Settlement 合约地址
const SETTLEMENT_ADDRESS: Address =
  (process.env.NEXT_PUBLIC_SETTLEMENT_ADDRESS as Address) ||
  "0x48c551f36E74B8d21D26e21139623c6dd438e455";

// EIP-712 Domain for Settlement contract
const EIP712_DOMAIN = {
  name: "MemePerp",
  version: "1",
  chainId: 84532, // Base Sepolia
  verifyingContract: SETTLEMENT_ADDRESS,
} as const;

// EIP-712 Types for Deposit
const DEPOSIT_TYPES = {
  Deposit: [
    { name: "user", type: "address" },
    { name: "token", type: "address" },
    { name: "amount", type: "uint256" },
    { name: "deadline", type: "uint256" },
    { name: "nonce", type: "uint256" },
  ],
} as const;

export interface TradingWalletState {
  // 交易钱包地址
  address: Address | null;
  // 私钥 (仅在用户请求导出时显示)
  privateKey: Hex | null;
  // ETH 余额
  ethBalance: bigint;
  // 是否已初始化
  isInitialized: boolean;
  // 是否正在加载
  isLoading: boolean;
  // 错误信息
  error: string | null;
}

export interface UseTradingWalletReturn extends TradingWalletState {
  // 生成交易钱包 (需要签名)
  generateWallet: () => Promise<void>;
  // 刷新余额
  refreshBalance: () => Promise<void>;
  // 导出私钥
  exportKey: () => { privateKey: Hex; warning: string } | null;
  // 断开交易钱包
  disconnect: () => void;
  // 从交易钱包发送 ETH
  sendETH: (to: Address, amount: string) => Promise<Hex>;
  // 格式化的 ETH 余额
  formattedEthBalance: string;
  // 签名消息 (用于显示)
  signingMessage: string;
  // 获取签名 (用于派生私钥进行订单签名)
  getSignature: () => Hex | null;
  // 包装 ETH 为 WETH 并存入 Settlement 合约
  wrapAndDeposit: (amount: string) => Promise<Hex>;
  // 是否正在执行包装存入操作
  isWrappingAndDepositing: boolean;
}

export function useTradingWallet(): UseTradingWalletReturn {
  const { address: mainWallet, isConnected } = useAccount();
  const { data: walletClient } = useWalletClient();
  const publicClient = usePublicClient();
  const chainId = useChainId();

  // 状态
  const [state, setState] = useState<TradingWalletState>({
    address: null,
    privateKey: null,
    ethBalance: 0n,
    isInitialized: false,
    isLoading: false,
    error: null,
  });

  // 内部存储签名 (用于发送交易)
  const [signature, setSignature] = useState<Hex | null>(null);

  // 包装存入状态
  const [isWrappingAndDepositing, setIsWrappingAndDepositing] = useState(false);

  // 获取签名消息
  const signingMessage = useMemo(
    () => getWalletSigningMessage(chainId || 84532),
    [chainId]
  );

  // 从本地存储恢复交易钱包
  useEffect(() => {
    if (!mainWallet || !isConnected) {
      setState((prev) => ({
        ...prev,
        address: null,
        privateKey: null,
        ethBalance: 0n,
        isInitialized: false,
      }));
      setSignature(null);
      return;
    }

    const stored = loadTradingWallet(mainWallet);
    if (stored && stored.chainId === chainId) {
      // 验证并恢复
      const wallet = createTradingWallet(stored.signature);
      if (wallet.address.toLowerCase() === stored.tradingWallet.toLowerCase()) {
        setState((prev) => ({
          ...prev,
          address: wallet.address,
          isInitialized: true,
          error: null,
        }));
        setSignature(stored.signature);
      }
    }
  }, [mainWallet, isConnected, chainId]);

  // 刷新余额
  const refreshBalance = useCallback(async () => {
    if (!state.address || !publicClient) return;

    try {
      const balance = await publicClient.getBalance({
        address: state.address,
      });

      setState((prev) => ({
        ...prev,
        ethBalance: balance,
      }));
    } catch (err) {
      console.error("Failed to fetch balance:", err);
    }
  }, [state.address, publicClient]);

  // 初始化后自动刷新余额
  useEffect(() => {
    if (state.isInitialized && state.address) {
      refreshBalance();

      // 每 10 秒刷新一次
      const interval = setInterval(refreshBalance, 10000);
      return () => clearInterval(interval);
    }
  }, [state.isInitialized, state.address, refreshBalance]);

  // 生成交易钱包
  const generateWallet = useCallback(async () => {
    if (!walletClient || !mainWallet) {
      setState((prev) => ({
        ...prev,
        error: "请先连接钱包",
      }));
      return;
    }

    setState((prev) => ({
      ...prev,
      isLoading: true,
      error: null,
    }));

    try {
      // 请求用户签名
      const sig = await walletClient.signMessage({
        message: signingMessage,
      });

      // 从签名派生交易钱包
      const wallet = createTradingWallet(sig as Hex);

      // 保存到本地存储
      saveTradingWallet(mainWallet, wallet.address, sig as Hex, chainId || 84532);

      // 更新状态
      setState((prev) => ({
        ...prev,
        address: wallet.address,
        isInitialized: true,
        isLoading: false,
        error: null,
      }));
      setSignature(sig as Hex);

      // 获取余额
      if (publicClient) {
        const balance = await publicClient.getBalance({
          address: wallet.address,
        });
        setState((prev) => ({
          ...prev,
          ethBalance: balance,
        }));
      }
    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : "签名失败";
      setState((prev) => ({
        ...prev,
        isLoading: false,
        error: errorMessage,
      }));
    }
  }, [walletClient, mainWallet, signingMessage, chainId, publicClient]);

  // 导出私钥
  const exportKey = useCallback(() => {
    if (!signature) return null;
    return exportPrivateKey(signature);
  }, [signature]);

  // 断开交易钱包
  const disconnect = useCallback(() => {
    if (mainWallet) {
      clearTradingWallet(mainWallet);
    }

    setState({
      address: null,
      privateKey: null,
      ethBalance: 0n,
      isInitialized: false,
      isLoading: false,
      error: null,
    });
    setSignature(null);
  }, [mainWallet]);

  // 从交易钱包发送 ETH
  const sendETH = useCallback(
    async (to: Address, amount: string): Promise<Hex> => {
      if (!signature || !state.address) {
        throw new Error("交易钱包未初始化");
      }

      const privateKey = derivePrivateKey(signature);
      const account = privateKeyToAccount(privateKey);

      // 创建钱包客户端
      const chain = chainId === 8453 ? base : baseSepolia;
      const client = createWalletClient({
        account,
        chain,
        transport: http(RPC_URL),
      });

      // 发送交易
      const hash = await client.sendTransaction({
        to,
        value: parseEther(amount),
      });

      // 刷新余额
      setTimeout(refreshBalance, 3000);

      return hash;
    },
    [signature, state.address, chainId, refreshBalance]
  );

  // 格式化余额
  const formattedEthBalance = useMemo(() => {
    return formatEther(state.ethBalance);
  }, [state.ethBalance]);

  // 获取签名 (用于派生私钥进行订单签名)
  const getSignature = useCallback(() => {
    return signature;
  }, [signature]);

  // 通过 Relay API 存入 ETH（用户签名，后端代付 Gas）
  const wrapAndDeposit = useCallback(
    async (amount: string): Promise<Hex> => {
      if (!signature || !state.address) {
        throw new Error("交易钱包未初始化");
      }

      setIsWrappingAndDepositing(true);

      try {
        const privateKey = derivePrivateKey(signature);
        const account = privateKeyToAccount(privateKey);

        const amountWei = parseEther(amount);
        const deadline = Math.floor(Date.now() / 1000) + 3600; // 1 hour from now

        console.log("[depositETH] Starting gasless deposit via relay:", {
          amount,
          amountWei: amountWei.toString(),
          tradingWallet: state.address,
        });

        // 步骤 1：获取用户的 metaTxNonce
        const nonceRes = await fetch(`${API_URL}/api/v1/relay/nonce/${state.address}`);
        const nonceData = await nonceRes.json();
        if (!nonceData.success) {
          throw new Error(nonceData.error || "Failed to get nonce");
        }
        const nonce = BigInt(nonceData.nonce);

        console.log("[depositETH] Got nonce:", nonce.toString());

        // 步骤 2：创建 EIP-712 签名
        const chain = chainId === 8453 ? base : baseSepolia;
        const walletClient = createWalletClient({
          account,
          chain,
          transport: http(RPC_URL),
        });

        const domain = {
          ...EIP712_DOMAIN,
          chainId: chainId || 84532,
        };

        const depositSignature = await walletClient.signTypedData({
          domain,
          types: DEPOSIT_TYPES,
          primaryType: "Deposit",
          message: {
            user: state.address,
            token: WETH_ADDRESS,
            amount: amountWei,
            deadline: BigInt(deadline),
            nonce: nonce,
          },
        });

        console.log("[depositETH] Signed deposit request");

        // 步骤 3：调用 Relay API
        const relayRes = await fetch(`${API_URL}/api/v1/relay/deposit-eth`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            user: state.address,
            amount: amountWei.toString(),
            deadline: deadline,
            signature: depositSignature,
          }),
        });

        const relayData = await relayRes.json();

        if (!relayData.success) {
          throw new Error(relayData.error || "Relay failed");
        }

        console.log("[depositETH] Deposit confirmed via relay:", relayData.txHash);

        // 刷新余额
        setTimeout(refreshBalance, 2000);

        return relayData.txHash as Hex;
      } catch (err) {
        console.error("[depositETH] Error:", err);
        throw err;
      } finally {
        setIsWrappingAndDepositing(false);
      }
    },
    [signature, state.address, chainId, refreshBalance]
  );

  return {
    ...state,
    generateWallet,
    refreshBalance,
    exportKey,
    disconnect,
    sendETH,
    formattedEthBalance,
    signingMessage,
    getSignature,
    wrapAndDeposit,
    isWrappingAndDepositing,
  };
}

export default useTradingWallet;
