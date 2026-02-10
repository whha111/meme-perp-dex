/**
 * 日志工具
 */

export enum LogLevel {
  DEBUG = 0,
  INFO = 1,
  WARN = 2,
  ERROR = 3,
}

const LOG_LEVEL = parseInt(process.env.LOG_LEVEL || "1");

function formatTimestamp(): string {
  return new Date().toISOString();
}

export const logger = {
  debug(module: string, message: string, ...args: unknown[]): void {
    if (LOG_LEVEL <= LogLevel.DEBUG) {
      console.debug(`[${formatTimestamp()}] [DEBUG] [${module}]`, message, ...args);
    }
  },

  info(module: string, message: string, ...args: unknown[]): void {
    if (LOG_LEVEL <= LogLevel.INFO) {
      console.log(`[${formatTimestamp()}] [INFO] [${module}]`, message, ...args);
    }
  },

  warn(module: string, message: string, ...args: unknown[]): void {
    if (LOG_LEVEL <= LogLevel.WARN) {
      console.warn(`[${formatTimestamp()}] [WARN] [${module}]`, message, ...args);
    }
  },

  error(module: string, message: string, ...args: unknown[]): void {
    if (LOG_LEVEL <= LogLevel.ERROR) {
      console.error(`[${formatTimestamp()}] [ERROR] [${module}]`, message, ...args);
    }
  },
};

export default logger;
