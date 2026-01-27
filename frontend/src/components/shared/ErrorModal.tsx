"use client";

import { useEffect, useState, createContext, useContext, useCallback, useRef } from "react";
import { ErrorCode, getErrorMessage, parseErrorCode, isUserCancelledError } from "@/lib/errors/errorDictionary";

// ============================================================
// 全局错误触发器（可在 hook 中使用）
// ============================================================

type ErrorEventDetail = {
  error?: unknown;
  code?: ErrorCode;
  locale?: string;
};

/**
 * 全局显示错误弹窗（可在任何地方调用，无需 hook）
 */
export function showGlobalError(error: unknown, locale?: string) {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('show-error-modal', {
      detail: { error, locale } as ErrorEventDetail
    }));
  }
}

/**
 * 全局显示错误弹窗（通过错误码）
 */
export function showGlobalErrorByCode(code: ErrorCode, locale?: string) {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('show-error-modal', {
      detail: { code, locale } as ErrorEventDetail
    }));
  }
}

// ============================================================
// Context
// ============================================================

interface ErrorModalContextType {
  showError: (error: unknown, locale?: string) => void;
  showErrorByCode: (code: ErrorCode, locale?: string) => void;
  hideError: () => void;
}

const ErrorModalContext = createContext<ErrorModalContextType | undefined>(undefined);

export function useErrorModal() {
  const context = useContext(ErrorModalContext);
  if (!context) {
    throw new Error("useErrorModal must be used within ErrorModalProvider");
  }
  return context;
}

// ============================================================
// Provider
// ============================================================

interface ErrorState {
  id: string;
  code: ErrorCode;
  title: string;
  description: string;
  visible: boolean;
}

const AUTO_DISMISS_DURATION = 15000; // 15秒

export function ErrorModalProvider({
  children,
  locale = 'zh'
}: {
  children: React.ReactNode;
  locale?: string;
}) {
  const [error, setError] = useState<ErrorState | null>(null);
  const timerRef = useRef<NodeJS.Timeout | null>(null);

  // 清除定时器
  const clearTimer = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  // 隐藏错误
  const hideError = useCallback(() => {
    clearTimer();
    setError(prev => prev ? { ...prev, visible: false } : null);
    // 动画结束后清除状态
    setTimeout(() => setError(null), 300);
  }, [clearTimer]);

  // 显示错误（根据错误码）
  const showErrorByCode = useCallback((code: ErrorCode, lang?: string) => {
    // 用户主动取消的操作不显示错误
    if (isUserCancelledError(code)) {
      return;
    }

    clearTimer();

    const message = getErrorMessage(code, lang || locale);
    const newError: ErrorState = {
      id: Math.random().toString(36).substring(7),
      code,
      title: message.title,
      description: message.description,
      visible: true,
    };

    setError(newError);

    // 15秒后自动消失
    timerRef.current = setTimeout(hideError, AUTO_DISMISS_DURATION);
  }, [locale, clearTimer, hideError]);

  // 显示错误（从原始错误对象解析）
  const showError = useCallback((err: unknown, lang?: string) => {
    const code = parseErrorCode(err);
    showErrorByCode(code, lang);
  }, [showErrorByCode]);

  // 监听全局错误事件
  useEffect(() => {
    const handleGlobalError = (event: CustomEvent<ErrorEventDetail>) => {
      const { error, code, locale: lang } = event.detail;
      if (code) {
        showErrorByCode(code, lang);
      } else if (error) {
        showError(error, lang);
      }
    };

    window.addEventListener('show-error-modal', handleGlobalError as EventListener);
    return () => {
      window.removeEventListener('show-error-modal', handleGlobalError as EventListener);
      clearTimer();
    };
  }, [showError, showErrorByCode, clearTimer]);

  return (
    <ErrorModalContext.Provider value={{ showError, showErrorByCode, hideError }}>
      {children}
      {error && <ErrorModal error={error} onClose={hideError} />}
    </ErrorModalContext.Provider>
  );
}

// ============================================================
// Modal Component
// ============================================================

function ErrorModal({
  error,
  onClose
}: {
  error: ErrorState;
  onClose: () => void;
}) {
  const [progress, setProgress] = useState(100);

  // 进度条动画
  useEffect(() => {
    if (!error.visible) return;

    const startTime = Date.now();
    const duration = AUTO_DISMISS_DURATION;

    const updateProgress = () => {
      const elapsed = Date.now() - startTime;
      const remaining = Math.max(0, 100 - (elapsed / duration) * 100);
      setProgress(remaining);

      if (remaining > 0) {
        requestAnimationFrame(updateProgress);
      }
    };

    requestAnimationFrame(updateProgress);
  }, [error.visible]);

  return (
    <>
      {/* 背景遮罩 */}
      <div
        className={`
          fixed inset-0 z-[9999]
          bg-black/40 dark:bg-black/60 backdrop-blur-sm
          transition-opacity duration-300
          ${error.visible ? 'opacity-100' : 'opacity-0'}
        `}
        onClick={onClose}
      />

      {/* 弹窗 */}
      <div
        className={`
          fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-[10000]
          w-[90%] max-w-[400px]
          transition-all duration-300 ease-out
          ${error.visible
            ? 'opacity-100 scale-100'
            : 'opacity-0 scale-95'
          }
        `}
      >
        <div className="
          relative overflow-hidden
          bg-white dark:bg-[#1a1a2e]
          border border-gray-200 dark:border-gray-700
          rounded-2xl shadow-2xl
        ">
          {/* 进度条 */}
          <div className="absolute top-0 left-0 right-0 h-1 bg-gray-100 dark:bg-gray-800">
            <div
              className="h-full bg-gradient-to-r from-red-500 to-orange-500 transition-all duration-100"
              style={{ width: `${progress}%` }}
            />
          </div>

          {/* 内容 */}
          <div className="p-6 pt-8">
            {/* 图标 */}
            <div className="flex justify-center mb-4">
              <div className="
                w-16 h-16 rounded-full
                bg-red-100 dark:bg-red-900/30
                flex items-center justify-center
              ">
                <svg
                  className="w-8 h-8 text-red-500 dark:text-red-400"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
                  />
                </svg>
              </div>
            </div>

            {/* 标题 */}
            <h3 className="
              text-center text-xl font-semibold mb-2
              text-gray-900 dark:text-white
            ">
              {error.title}
            </h3>

            {/* 描述 */}
            <p className="
              text-center text-sm mb-2
              text-gray-600 dark:text-gray-400
            ">
              {error.description}
            </p>

            {/* 错误码 */}
            <p className="
              text-center text-xs
              text-gray-400 dark:text-gray-500
            ">
              错误码: {error.code}
            </p>
          </div>

          {/* 关闭按钮 */}
          <div className="px-6 pb-6">
            <button
              onClick={onClose}
              className="
                w-full py-3 rounded-xl
                bg-gray-100 dark:bg-gray-800
                hover:bg-gray-200 dark:hover:bg-gray-700
                text-gray-700 dark:text-gray-300
                font-medium text-sm
                transition-colors duration-200
              "
            >
              关闭
            </button>
          </div>

          {/* 右上角关闭按钮 */}
          <button
            onClick={onClose}
            className="
              absolute top-4 right-4
              p-1 rounded-lg
              text-gray-400 hover:text-gray-600
              dark:text-gray-500 dark:hover:text-gray-300
              hover:bg-gray-100 dark:hover:bg-gray-800
              transition-colors
            "
            aria-label="关闭"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      </div>
    </>
  );
}

export default ErrorModalProvider;
