"use client";

import { useEffect, useState, useRef, createContext, useContext, useCallback } from "react";

export type ToastSeverity = "info" | "warning" | "error" | "success";

export interface ToastMessage {
  id: string;
  message: string;
  severity: ToastSeverity;
  duration?: number;
}

interface ToastContextType {
  showToast: (message: string, severity?: ToastSeverity, duration?: number) => void;
  toasts: ToastMessage[];
  removeToast: (id: string) => void;
}

const ToastContext = createContext<ToastContextType | undefined>(undefined);

export function useToast() {
  const context = useContext(ToastContext);
  if (!context) {
    throw new Error("useToast must be used within ToastProvider");
  }
  return context;
}

// Toast 队列管理器
class ToastManager {
  private static instance: ToastManager;
  private queue: ToastMessage[] = [];
  private activeToasts: Set<string> = new Set();
  private maxConcurrentToasts = 3;
  
  static getInstance(): ToastManager {
    if (!ToastManager.instance) {
      ToastManager.instance = new ToastManager();
    }
    return ToastManager.instance;
  }
  
  addToast(toast: ToastMessage): void {
    this.queue.push(toast);
    this.processQueue();
  }
  
  removeToast(id: string): void {
    this.activeToasts.delete(id);
    this.processQueue();
  }
  
  private processQueue(): void {
    while (
      this.activeToasts.size < this.maxConcurrentToasts && 
      this.queue.length > 0
    ) {
      const toast = this.queue.shift()!;
      this.activeToasts.add(toast.id);
      
      // 通知 UI 更新
      window.dispatchEvent(new CustomEvent('toast-show', { detail: toast }));
      
      // 自动移除
      if (toast.duration && toast.duration > 0) {
        setTimeout(() => {
          this.removeToast(toast.id);
          window.dispatchEvent(new CustomEvent('toast-remove', { detail: toast.id }));
        }, toast.duration);
      }
    }
  }
  
  getActiveToasts(): ToastMessage[] {
    return Array.from(this.activeToasts).map(id => 
      this.queue.find(t => t.id === id) || 
      Array.from(this.activeToasts).map(id => ({ id, message: '', severity: 'info' } as ToastMessage)).find(t => t.id === id)!
    );
  }
}

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<ToastMessage[]>([]);
  const toastManager = useRef(ToastManager.getInstance());

  const showToast = useCallback(
    (message: string, severity: ToastSeverity = "info", duration: number = 5000) => {
      const id = Math.random().toString(36).substring(7);
      const toast: ToastMessage = { id, message, severity, duration };
      toastManager.current.addToast(toast);
    },
    []
  );

  const removeToast = useCallback((id: string) => {
    toastManager.current.removeToast(id);
  }, []);

  // 监听 Toast 事件
  useEffect(() => {
    const handleToastShow = (event: CustomEvent<ToastMessage>) => {
      setToasts(prev => [...prev, event.detail]);
    };
    
    const handleToastRemove = (event: CustomEvent<string>) => {
      setToasts(prev => prev.filter(toast => toast.id !== event.detail));
    };
    
    window.addEventListener('toast-show', handleToastShow as EventListener);
    window.addEventListener('toast-remove', handleToastRemove as EventListener);
    
    return () => {
      window.removeEventListener('toast-show', handleToastShow as EventListener);
      window.removeEventListener('toast-remove', handleToastRemove as EventListener);
    };
  }, []);

  return (
    <ToastContext.Provider value={{ showToast, toasts, removeToast }}>
      {children}
      <ToastContainer toasts={toasts} removeToast={removeToast} />
    </ToastContext.Provider>
  );
}

function ToastContainer({
  toasts,
  removeToast,
}: {
  toasts: ToastMessage[];
  removeToast: (id: string) => void;
}) {
  return (
    <div className="fixed top-4 right-4 z-[9999] flex flex-col gap-3 pointer-events-none">
      {toasts.map((toast) => (
        <div key={toast.id} className="pointer-events-auto">
          <ToastItem toast={toast} onClose={() => removeToast(toast.id)} />
        </div>
      ))}
    </div>
  );
}

// 图标组件
function ToastIcon({ severity }: { severity: ToastSeverity }) {
  const icons = {
    info: (
      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
      </svg>
    ),
    success: (
      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
      </svg>
    ),
    warning: (
      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
      </svg>
    ),
    error: (
      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z" />
      </svg>
    ),
  };
  return icons[severity];
}

function ToastItem({ toast, onClose }: { toast: ToastMessage; onClose: () => void }) {
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    // 触发入场动画
    requestAnimationFrame(() => setIsVisible(true));
  }, []);

  const config = {
    info: {
      bg: "bg-[#1a1f2e]",
      border: "border-blue-500/30",
      icon: "text-blue-400",
      text: "text-gray-100",
    },
    success: {
      bg: "bg-[#1a2e1f]",
      border: "border-green-500/30",
      icon: "text-green-400",
      text: "text-gray-100",
    },
    warning: {
      bg: "bg-[#2e2a1a]",
      border: "border-yellow-500/30",
      icon: "text-yellow-400",
      text: "text-gray-100",
    },
    error: {
      bg: "bg-[#2e1a1a]",
      border: "border-red-500/30",
      icon: "text-red-400",
      text: "text-gray-100",
    },
  };

  const style = config[toast.severity];

  return (
    <div
      className={`
        min-w-[320px] max-w-md rounded-xl border shadow-2xl
        ${style.bg} ${style.border}
        transform transition-all duration-300 ease-out
        ${isVisible ? 'translate-x-0 opacity-100' : 'translate-x-full opacity-0'}
      `}
      data-testid={`toast-${toast.severity}`}
    >
      <div className="flex items-center gap-3 p-4">
        {/* 图标 */}
        <div className={`flex-shrink-0 ${style.icon}`}>
          <ToastIcon severity={toast.severity} />
        </div>

        {/* 消息内容 */}
        <p className={`flex-1 text-sm font-medium ${style.text}`}>
          {toast.message}
        </p>

        {/* 关闭按钮 */}
        <button
          onClick={onClose}
          className="flex-shrink-0 p-1 rounded-lg text-gray-500 hover:text-gray-300 hover:bg-white/5 transition-colors"
          aria-label="关闭"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>
    </div>
  );
}

