"use client";

/**
 * Global loading state for all routes
 * This is shown by Next.js while page content is loading
 */
export default function Loading() {
  return (
    <div className="min-h-screen bg-okx-bg-primary flex items-center justify-center">
      <div className="flex flex-col items-center gap-4">
        <div className="w-10 h-10 border-4 border-okx-up border-t-transparent rounded-full animate-spin" />
        <p className="text-okx-text-tertiary text-sm">Loading...</p>
      </div>
    </div>
  );
}
