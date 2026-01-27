/**
 * [FIX WALLET] 钱包认证 Hook
 *
 * 用于在 WebSocket 连接后进行钱包所有权验证
 * 验证成功后才能请求签名等敏感操作
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { useAccount, useSignMessage } from 'wagmi';
import { getWebSocketClient } from '@/lib/websocket/client';
import {
  MessageType,
  WalletAuthChallengeResp,
  WalletAuthVerifyResp,
} from '@/lib/websocket/types';
import { devLog } from '@/lib/debug-logger';

export interface WalletAuthState {
  isAuthenticated: boolean;
  isAuthenticating: boolean;
  error: string | null;
  authenticatedAddress: string | null;
}

export interface UseWalletAuthReturn extends WalletAuthState {
  authenticate: () => Promise<boolean>;
  clearAuth: () => void;
}

/**
 * 钱包认证 Hook
 *
 * 使用流程:
 * 1. 用户连接钱包
 * 2. 调用 authenticate() 开始认证
 * 3. 后端生成挑战字符串
 * 4. 前端请求用户签名
 * 5. 前端发送签名到后端验证
 * 6. 验证成功后 isAuthenticated = true
 */
export function useWalletAuth(): UseWalletAuthReturn {
  const { address, isConnected } = useAccount();
  const { signMessageAsync } = useSignMessage();

  const [state, setState] = useState<WalletAuthState>({
    isAuthenticated: false,
    isAuthenticating: false,
    error: null,
    authenticatedAddress: null,
  });

  // 追踪当前认证的地址，用于检测钱包切换
  const lastAuthenticatedAddress = useRef<string | null>(null);

  /**
   * 清除认证状态
   * 注意：必须在 useEffect 之前定义，否则会导致 "used before declaration" 错误
   */
  const clearAuth = useCallback(() => {
    setState({
      isAuthenticated: false,
      isAuthenticating: false,
      error: null,
      authenticatedAddress: null,
    });
    lastAuthenticatedAddress.current = null;
  }, []);

  // 当钱包地址变化时，清除认证状态
  useEffect(() => {
    if (lastAuthenticatedAddress.current && address !== lastAuthenticatedAddress.current) {
      devLog.log('[WalletAuth] 钱包地址变化，清除认证状态');
      clearAuth();
    }
  }, [address, clearAuth]);

  // 当钱包断开时，清除认证状态
  useEffect(() => {
    if (!isConnected) {
      clearAuth();
    }
  }, [isConnected, clearAuth]);

  /**
   * 执行钱包认证
   */
  const authenticate = useCallback(async (): Promise<boolean> => {
    if (!address || !isConnected) {
      setState(prev => ({
        ...prev,
        error: '请先连接钱包',
        isAuthenticating: false,
      }));
      return false;
    }

    // 如果已经认证了当前地址，直接返回成功
    if (state.isAuthenticated && state.authenticatedAddress === address) {
      return true;
    }

    setState(prev => ({
      ...prev,
      isAuthenticating: true,
      error: null,
    }));

    try {
      const wsClient = getWebSocketClient();

      // 确保 WebSocket 已连接
      if (!wsClient.isConnected()) {
        await wsClient.connect();
      }

      // Step 1: 请求挑战
      devLog.log('[WalletAuth] 请求认证挑战...');
      const challengeResponse = await wsClient.request<WalletAuthChallengeResp>(
        MessageType.WALLET_AUTH_CHALLENGE,
        { wallet_address: address }
      );

      if (!challengeResponse.success || !challengeResponse.challenge) {
        throw new Error(challengeResponse.error || '获取认证挑战失败');
      }

      devLog.log('[WalletAuth] 收到挑战，请求用户签名...');

      // Step 2: 请求用户签名
      let signature: string;
      try {
        signature = await signMessageAsync({
          account: address,
          message: challengeResponse.challenge,
        });
      } catch (signError: unknown) {
        // 直接抛出原始错误，让调用方处理
        // 这样 parseErrorCode 可以正确识别用户取消操作
        throw signError;
      }

      devLog.log('[WalletAuth] 签名成功，验证中...');

      // Step 3: 发送签名到后端验证
      const verifyResponse = await wsClient.request<WalletAuthVerifyResp>(
        MessageType.WALLET_AUTH_VERIFY,
        {
          wallet_address: address,
          signature,
        }
      );

      if (!verifyResponse.success) {
        throw new Error(verifyResponse.error || '钱包验证失败');
      }

      devLog.log('[WalletAuth] 认证成功!');

      // 更新状态
      setState({
        isAuthenticated: true,
        isAuthenticating: false,
        error: null,
        authenticatedAddress: address,
      });
      lastAuthenticatedAddress.current = address;

      return true;
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : '认证失败';
      devLog.error('[WalletAuth] 认证失败:', errorMessage);
      setState(prev => ({
        ...prev,
        isAuthenticated: false,
        isAuthenticating: false,
        error: errorMessage,
        authenticatedAddress: null,
      }));
      return false;
    }
  }, [address, isConnected, signMessageAsync, state.isAuthenticated, state.authenticatedAddress]);

  return {
    ...state,
    authenticate,
    clearAuth,
  };
}

export default useWalletAuth;
