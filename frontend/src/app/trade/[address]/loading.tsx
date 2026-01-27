"use client";

/**
 * Loading state for token trading page
 */
export default function TradeLoading() {
  return (
    <div className="min-h-screen bg-okx-bg-primary">
      {/* Skeleton Navigation Bar */}
      <nav className="sticky top-0 z-30 bg-okx-bg-primary border-b border-okx-border-primary h-[64px]">
        <div className="max-w-[1440px] mx-auto px-4 h-full flex items-center justify-between">
          <div className="flex items-center gap-8">
            <div className="flex items-center gap-2 text-okx-text-primary font-bold text-xl">
              <span className="text-2xl">💊</span>
              FOMO
            </div>
          </div>
          <div className="w-32 h-8 bg-okx-bg-hover rounded-full animate-pulse" />
        </div>
      </nav>

      {/* Skeleton Content */}
      <div className="flex flex-col">
        {/* Top Bar Skeleton */}
        <div className="h-14 bg-okx-bg-secondary border-b border-okx-border-primary flex items-center px-4 gap-6">
          <div className="w-32 h-6 bg-okx-bg-hover rounded animate-pulse" />
          <div className="w-24 h-4 bg-okx-bg-hover rounded animate-pulse" />
          <div className="w-24 h-4 bg-okx-bg-hover rounded animate-pulse" />
        </div>

        {/* Main Content Skeleton */}
        <div className="flex flex-1">
          {/* Left: Chart Area */}
          <div className="flex-[3] border-r border-okx-border-primary">
            <div className="h-[400px] bg-[#131722] flex items-center justify-center">
              <div className="flex flex-col items-center gap-3">
                <div className="w-10 h-10 border-4 border-okx-up border-t-transparent rounded-full animate-spin" />
                <p className="text-okx-text-tertiary text-sm">Loading chart...</p>
              </div>
            </div>
          </div>

          {/* Right: Swap Panel Skeleton */}
          <div className="flex-1 bg-okx-bg-primary p-4">
            <div className="space-y-4">
              <div className="w-full h-10 bg-okx-bg-hover rounded animate-pulse" />
              <div className="w-full h-24 bg-okx-bg-hover rounded animate-pulse" />
              <div className="w-full h-24 bg-okx-bg-hover rounded animate-pulse" />
              <div className="w-full h-12 bg-okx-up/30 rounded animate-pulse" />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
