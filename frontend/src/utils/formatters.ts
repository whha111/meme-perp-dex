/**
 * 通用格式化工具函数
 */

/**
 * 格式化时间为"多久之前"的形式
 * @param timestamp Unix 时间戳（秒或毫秒）或 bigint
 * @returns 格式化的时间字符串，如 "3分钟前"、"2小时前"
 */
export function formatTimeAgo(timestamp: bigint | number): string {
  const seconds = Math.floor(Date.now() / 1000 - Number(timestamp));
  
  if (seconds < 60) return `${seconds}秒前`;
  
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}分钟前`;
  
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}小时前`;
  
  const days = Math.floor(hours / 24);
  return `${days}天前`;
}

/**
 * 格式化日期为标准格式
 * @param timestamp Unix 时间戳（毫秒）
 * @returns 格式化的日期字符串，如 "2024-01-05 14:30"
 */
export function formatDate(timestamp: number): string {
  const date = new Date(timestamp);
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  const h = String(date.getHours()).padStart(2, '0');
  const min = String(date.getMinutes()).padStart(2, '0');
  return `${y}-${m}-${d} ${h}:${min}`;
}

/**
 * 格式化日期为简短格式（仅日期）
 * @param timestamp Unix 时间戳（毫秒）
 * @returns 格式化的日期字符串，如 "2024-01-05"
 */
export function formatDateShort(timestamp: number): string {
  const date = new Date(timestamp);
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/**
 * 格式化时间为简短格式（仅时间）
 * @param timestamp Unix 时间戳（毫秒）
 * @returns 格式化的时间字符串，如 "14:30:25"
 */
export function formatTimeShort(timestamp: number): string {
  const date = new Date(timestamp);
  const h = String(date.getHours()).padStart(2, '0');
  const min = String(date.getMinutes()).padStart(2, '0');
  const s = String(date.getSeconds()).padStart(2, '0');
  return `${h}:${min}:${s}`;
}

/**
 * 格式化数字为带千分位的字符串
 * @param value 数字值
 * @param decimals 小数位数，默认 2
 * @returns 格式化的字符串，如 "1,234.56"
 */
export function formatNumber(value: number, decimals: number = 2): string {
  return value.toLocaleString('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

/**
 * 格式化数字为简短形式（K, M, B）
 * @param value 数字值
 * @returns 格式化的字符串，如 "1.2K", "3.4M"
 */
export function formatNumberShort(value: number): string {
  if (value >= 1_000_000_000) {
    return (value / 1_000_000_000).toFixed(2) + 'B';
  }
  if (value >= 1_000_000) {
    return (value / 1_000_000).toFixed(2) + 'M';
  }
  if (value >= 1_000) {
    return (value / 1_000).toFixed(2) + 'K';
  }
  return value.toFixed(2);
}
