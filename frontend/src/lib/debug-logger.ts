/**
 * 🔧 统一调试日志工具
 * 
 * 用于在整个项目中植入打桩调试日志，方便快速定位问题
 * 
 * 使用方式:
 * ```ts
 * import { debugLog, DebugModule } from '@/lib/debug-logger';
 * 
 * debugLog.info(DebugModule.VERIFY, 1, '开始验证域名', { domain: 'example.com' });
 * debugLog.error(DebugModule.CREATE, 3, '创建失败', { error: err.message });
 * ```
 */

// 是否启用调试日志（生产环境可关闭）
const DEBUG_ENABLED = process.env.NODE_ENV !== 'production' || process.env.NEXT_PUBLIC_DEBUG === 'true';

// 是否在控制台显示详细数据
const VERBOSE = true;

/**
 * 调试模块枚举
 */
export enum DebugModule {
  // 前端页面
  PAGE_VERIFY = 'Page:Verify',
  PAGE_DEPLOY = 'Page:Deploy',
  PAGE_TOKEN = 'Page:Token',
  PAGE_TRADE = 'Page:Trade',
  PAGE_HOME = 'Page:Home',
  
  // 前端 Hooks
  HOOK_VERIFY = 'Hook:Verify',
  HOOK_REGISTER = 'Hook:Register',
  HOOK_CREATE = 'Hook:Create',
  HOOK_SWAP = 'Hook:Swap',
  HOOK_POOL = 'Hook:Pool',
  HOOK_EVENTS = 'Hook:Events',
  
  // 前端 API Routes
  API_VERIFY = 'API:Verify',
  API_REGISTER_SIG = 'API:RegisterSig',
  API_CREATE_SIG = 'API:CreateSig',
  
  // WebSocket 客户端
  WS_CLIENT = 'WS:Client',
  
  // 合约交互
  CONTRACT_REGISTRY = 'Contract:Registry',
  CONTRACT_HOOK = 'Contract:Hook',
  CONTRACT_TOKEN = 'Contract:Token',
  
  // 后端服务
  BACKEND_GATEWAY = 'Backend:Gateway',
  BACKEND_IDENTITY = 'Backend:Identity',
  BACKEND_WATCHER = 'Backend:Watcher',
  BACKEND_TRADE = 'Backend:Trade',
}

/**
 * 日志级别
 */
type LogLevel = 'info' | 'warn' | 'error' | 'success' | 'debug';

/**
 * 日志条目接口
 */
interface LogEntry {
  timestamp: string;
  level: LogLevel;
  module: DebugModule;
  step: number;
  message: string;
  data?: unknown;
  duration?: number;
}

/**
 * 日志历史记录（用于导出和分析）
 */
const logHistory: LogEntry[] = [];
const MAX_HISTORY = 1000;

/**
 * 颜色配置
 */
const COLORS = {
  info: '#3B82F6',    // 蓝色
  warn: '#F59E0B',    // 橙色
  error: '#EF4444',   // 红色
  success: '#10B981', // 绿色
  debug: '#8B5CF6',   // 紫色
};

const MODULE_COLORS: Record<string, string> = {
  'Page': '#EC4899',      // 粉色
  'Hook': '#14B8A6',      // 青色
  'API': '#F97316',       // 橙色
  'WS': '#6366F1',        // 靛蓝 (WebSocket)
  'Contract': '#8B5CF6',  // 紫色
  'Backend': '#84CC16',   // 黄绿
};

/**
 * 格式化时间戳
 */
function getTimestamp(): string {
  const now = new Date();
  return now.toISOString().split('T')[1].slice(0, 12);
}

/**
 * 获取模块颜色
 */
function getModuleColor(module: DebugModule): string {
  const prefix = module.split(':')[0];
  return MODULE_COLORS[prefix] || '#6B7280';
}

/**
 * 核心日志函数
 */
function log(
  level: LogLevel,
  module: DebugModule,
  step: number,
  message: string,
  data?: unknown,
  duration?: number
): void {
  if (!DEBUG_ENABLED) return;

  const timestamp = getTimestamp();
  const entry: LogEntry = { timestamp, level, module, step, message, data, duration };
  
  // 添加到历史记录
  logHistory.push(entry);
  if (logHistory.length > MAX_HISTORY) {
    logHistory.shift();
  }

  // 构建日志前缀
  const prefix = `[${timestamp}][${module}][Step ${step}]`;
  const durationStr = duration !== undefined ? ` (${duration}ms)` : '';
  
  // 浏览器控制台样式
  if (typeof window !== 'undefined') {
    const moduleColor = getModuleColor(module);
    const levelColor = COLORS[level];
    
    const styles = [
      `color: #6B7280; font-weight: normal`,  // timestamp
      `color: ${moduleColor}; font-weight: bold`, // module
      `color: #6B7280; font-weight: normal`,  // step
      `color: ${levelColor}; font-weight: bold`, // message
    ];
    
    console.groupCollapsed(
      `%c${timestamp} %c[${module}] %c[Step ${step}] %c${message}${durationStr}`,
      ...styles
    );
    
    if (VERBOSE && data !== undefined) {
      console.log('📦 Data:', data);
    }
    
    if (level === 'error') {
      console.trace('Stack trace:');
    }
    
    console.groupEnd();
  } else {
    // Node.js 环境（API Routes）
    const emoji = {
      info: 'ℹ️',
      warn: '⚠️',
      error: '❌',
      success: '✅',
      debug: '🔍',
    }[level];
    
    console.log(`${emoji} ${prefix} ${message}${durationStr}`);
    if (VERBOSE && data !== undefined) {
      console.log('   📦 Data:', JSON.stringify(data, null, 2));
    }
  }
}

/**
 * 计时器 - 用于测量操作耗时
 */
const timers: Map<string, number> = new Map();

/**
 * 调试日志工具对象
 */
export const debugLog = {
  /**
   * 信息日志
   */
  info: (module: DebugModule, step: number, message: string, data?: unknown) => {
    log('info', module, step, message, data);
  },

  /**
   * 警告日志
   */
  warn: (module: DebugModule, step: number, message: string, data?: unknown) => {
    log('warn', module, step, message, data);
  },

  /**
   * 错误日志
   */
  error: (module: DebugModule, step: number, message: string, data?: unknown) => {
    log('error', module, step, message, data);
  },

  /**
   * 成功日志
   */
  success: (module: DebugModule, step: number, message: string, data?: unknown) => {
    log('success', module, step, message, data);
  },

  /**
   * 调试日志
   */
  debug: (module: DebugModule, step: number, message: string, data?: unknown) => {
    log('debug', module, step, message, data);
  },

  /**
   * 开始计时
   */
  startTimer: (key: string) => {
    timers.set(key, Date.now());
  },

  /**
   * 结束计时并记录
   */
  endTimer: (key: string, module: DebugModule, step: number, message: string, data?: unknown) => {
    const startTime = timers.get(key);
    if (startTime) {
      const duration = Date.now() - startTime;
      log('info', module, step, message, data, duration);
      timers.delete(key);
      return duration;
    }
    return 0;
  },

  /**
   * 流程开始标记
   */
  flowStart: (flowName: string, module: DebugModule, data?: unknown) => {
    if (!DEBUG_ENABLED) return;
    
    console.log(
      `%c━━━━━━━━━━━━━━━ 🚀 ${flowName} 开始 ━━━━━━━━━━━━━━━`,
      'color: #10B981; font-weight: bold; font-size: 12px'
    );
    log('info', module, 0, `${flowName} 开始`, data);
    timers.set(`flow:${flowName}`, Date.now());
  },

  /**
   * 流程结束标记
   */
  flowEnd: (flowName: string, module: DebugModule, success: boolean, data?: unknown) => {
    if (!DEBUG_ENABLED) return;
    
    const startTime = timers.get(`flow:${flowName}`);
    const duration = startTime ? Date.now() - startTime : 0;
    
    const status = success ? '✅ 成功' : '❌ 失败';
    const color = success ? '#10B981' : '#EF4444';
    
    console.log(
      `%c━━━━━━━━━━━━━━━ ${status} ${flowName} 结束 (${duration}ms) ━━━━━━━━━━━━━━━`,
      `color: ${color}; font-weight: bold; font-size: 12px`
    );
    
    log(success ? 'success' : 'error', module, 99, `${flowName} ${status}`, { ...data as object, duration });
    timers.delete(`flow:${flowName}`);
  },

  /**
   * 获取日志历史
   */
  getHistory: () => [...logHistory],

  /**
   * 清除日志历史
   */
  clearHistory: () => {
    logHistory.length = 0;
  },

  /**
   * 导出日志为 JSON
   */
  exportLogs: () => {
    return JSON.stringify(logHistory, null, 2);
  },

  /**
   * 在控制台打印日志摘要
   */
  printSummary: () => {
    if (!DEBUG_ENABLED) return;
    
    const errors = logHistory.filter(l => l.level === 'error');
    const warns = logHistory.filter(l => l.level === 'warn');
    
    console.log('\n📊 调试日志摘要:');
    console.log(`   总条目: ${logHistory.length}`);
    console.log(`   错误: ${errors.length}`);
    console.log(`   警告: ${warns.length}`);
    
    if (errors.length > 0) {
      console.log('\n❌ 错误列表:');
      errors.forEach((e, i) => {
        console.log(`   ${i + 1}. [${e.module}] ${e.message}`);
      });
    }
  },
};

// 导出类型
export type { LogEntry, LogLevel };

// 在浏览器中暴露到 window 对象，方便手动调试
if (typeof window !== 'undefined') {
  (window as unknown as Record<string, unknown>).debugLog = debugLog;
  (window as unknown as Record<string, unknown>).DebugModule = DebugModule;
}

// ============================================================================
// [FIX SECURITY] 生产安全的控制台日志封装
// ============================================================================

/**
 * 开发环境专用日志
 * 生产环境下完全静默，不输出任何内容
 */
export const devLog = {
  log: (...args: unknown[]) => {
    if (DEBUG_ENABLED) console.log(...args);
  },
  warn: (...args: unknown[]) => {
    if (DEBUG_ENABLED) console.warn(...args);
  },
  error: (...args: unknown[]) => {
    // 错误总是记录，但在生产环境只记录摘要
    if (DEBUG_ENABLED) {
      console.error(...args);
    } else {
      // 生产环境：只记录第一个参数（通常是错误消息）
      const firstArg = args[0];
      if (typeof firstArg === 'string') {
        console.error(`[Error] ${firstArg.substring(0, 100)}`);
      }
    }
  },
  info: (...args: unknown[]) => {
    if (DEBUG_ENABLED) console.info(...args);
  },
  debug: (...args: unknown[]) => {
    if (DEBUG_ENABLED) console.debug(...args);
  },
  table: (...args: unknown[]) => {
    if (DEBUG_ENABLED) console.table(...args);
  },
  group: (label: string) => {
    if (DEBUG_ENABLED) console.group(label);
  },
  groupEnd: () => {
    if (DEBUG_ENABLED) console.groupEnd();
  },
  groupCollapsed: (label: string) => {
    if (DEBUG_ENABLED) console.groupCollapsed(label);
  },
};

/**
 * 检查是否为开发环境
 */
export const isDev = DEBUG_ENABLED;

