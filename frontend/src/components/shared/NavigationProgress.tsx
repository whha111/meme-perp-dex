"use client";

import { useEffect, useState, useRef } from "react";
import { usePathname } from "next/navigation";

/**
 * 全局导航进度条
 * 在页面导航时显示顶部进度条，让用户知道页面正在加载
 */
export function NavigationProgress() {
  const pathname = usePathname();
  const [isNavigating, setIsNavigating] = useState(false);
  const [progress, setProgress] = useState(0);
  const intervalRef = useRef<NodeJS.Timeout | null>(null);
  const prevPathRef = useRef(pathname);

  // 当路径变化时，表示导航完成
  useEffect(() => {
    if (pathname !== prevPathRef.current) {
      prevPathRef.current = pathname;
      // 导航完成，快速填满进度条然后隐藏
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
      setProgress(100);
      setIsNavigating(false);

      // 短暂显示完成状态后隐藏
      const timer = setTimeout(() => {
        setProgress(0);
      }, 300);

      return () => clearTimeout(timer);
    }
  }, [pathname]);

  // 监听所有链接点击，立即显示进度条
  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      const link = target.closest("a");

      if (link) {
        const href = link.getAttribute("href");
        // 检查是否是内部导航链接
        if (href && href.startsWith("/") && !href.startsWith("//")) {
          // 如果是当前页面，不显示进度条
          if (href === pathname || href === prevPathRef.current) return;

          // 立即显示进度条
          setIsNavigating(true);
          setProgress(20);

          // 清理之前的定时器
          if (intervalRef.current) {
            clearInterval(intervalRef.current);
          }

          // 模拟进度增长
          intervalRef.current = setInterval(() => {
            setProgress((prev) => {
              if (prev >= 90) {
                return prev;
              }
              // 越接近90%，增长越慢
              const increment = Math.max(1, (90 - prev) / 10);
              return Math.min(90, prev + increment);
            });
          }, 200);
        }
      }
    };

    document.addEventListener("click", handleClick, true);
    return () => {
      document.removeEventListener("click", handleClick, true);
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
      }
    };
  }, [pathname]);

  if (!isNavigating && progress === 0) return null;

  return (
    <div className="fixed top-0 left-0 right-0 z-[9999] h-1 bg-transparent pointer-events-none">
      <div
        className="h-full bg-okx-up transition-all ease-out"
        style={{
          width: `${progress}%`,
          transitionDuration: progress === 100 ? "150ms" : "200ms",
          boxShadow: progress > 0 ? "0 0 10px rgba(163, 230, 53, 0.7), 0 0 5px rgba(163, 230, 53, 0.5)" : "none",
        }}
      />
    </div>
  );
}
