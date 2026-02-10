/**
 * 临时调试工具：检测无限渲染
 */

const renderCounts = new Map<string, number>();
const renderTimestamps = new Map<string, number[]>();

export function trackRender(componentName: string) {
  const count = (renderCounts.get(componentName) || 0) + 1;
  renderCounts.set(componentName, count);

  const now = Date.now();
  const timestamps = renderTimestamps.get(componentName) || [];
  timestamps.push(now);

  // 只保留最近1秒内的渲染记录
  const recentTimestamps = timestamps.filter(t => now - t < 1000);
  renderTimestamps.set(componentName, recentTimestamps);

  // 如果1秒内渲染超过50次，发出警告
  if (recentTimestamps.length > 50) {
    console.error(
      `[INFINITE LOOP DETECTED] ${componentName} rendered ${recentTimestamps.length} times in 1 second!`,
      `Total renders: ${count}`
    );
    // 输出渲染堆栈
    console.trace();
    return true;
  }

  // 减少日志噪音 - 每1000次渲染才输出一次
  if (count % 1000 === 0) {
    console.log(`[Render Count] ${componentName}: ${count} renders`);
  }

  return false;
}

export function resetRenderCount(componentName: string) {
  renderCounts.delete(componentName);
  renderTimestamps.delete(componentName);
}

export function getRenderStats() {
  const stats: Record<string, number> = {};
  renderCounts.forEach((count, name) => {
    stats[name] = count;
  });
  return stats;
}
