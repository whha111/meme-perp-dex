/**
 * 简单的交易事件系统
 * 用于在交易成功后通知相关组件刷新数据
 */

type TradeEventListener = (tokenAddress: string, txHash: string) => void;

class TradeEventEmitter {
  private listeners: Set<TradeEventListener> = new Set();

  subscribe(listener: TradeEventListener): () => void {
    this.listeners.add(listener);
    console.log(`[TradeEventEmitter] New subscriber added, total: ${this.listeners.size}`);
    return () => {
      this.listeners.delete(listener);
      console.log(`[TradeEventEmitter] Subscriber removed, remaining: ${this.listeners.size}`);
    };
  }

  emit(tokenAddress: string, txHash: string): void {
    console.log(`[TradeEventEmitter] Emitting event for token: ${tokenAddress}, tx: ${txHash}, listeners: ${this.listeners.size}`);
    this.listeners.forEach(listener => {
      try {
        listener(tokenAddress, txHash);
      } catch (err) {
        console.error('[TradeEventEmitter] Listener error:', err);
      }
    });
  }
}

export const tradeEventEmitter = new TradeEventEmitter();
