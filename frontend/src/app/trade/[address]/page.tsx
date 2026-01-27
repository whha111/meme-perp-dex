"use client";

import React, { useState, useEffect } from "react";
import { useParams } from "next/navigation";
import { Navbar } from "@/components/layout/Navbar";
import dynamic from "next/dynamic";

// 动态导入 TradingTerminal，禁用 SSR
const TradingTerminal = dynamic(
  () => import("@/components/trading/TradingTerminal").then((mod) => mod.TradingTerminal),
  {
    ssr: false,
    loading: () => (
      <div className="flex flex-col items-center justify-center min-h-[600px] bg-okx-bg-primary text-okx-text-primary">
        <div className="w-8 h-8 border-2 border-okx-up border-t-transparent rounded-full animate-spin"></div>
        <p className="mt-4 text-okx-text-secondary">Loading trading terminal...</p>
      </div>
    ),
  }
);

/**
 * 现货交易页面
 */
export default function TokenTradePage() {
  console.log("========== [TokenTradePage] PAGE COMPONENT EXECUTED ==========");

  const params = useParams();
  const addressOrSymbol = params.address as string;

  console.log("[TokenTradePage] addressOrSymbol:", addressOrSymbol);

  const [mounted, setMounted] = useState(false);

  // 使用符号格式 - 如果是合约地址，转换为符号；如果已经是符号，直接使用
  const symbol = addressOrSymbol?.startsWith("0x")
    ? addressOrSymbol
    : addressOrSymbol?.toUpperCase() || "";

  useEffect(() => {
    console.log("[TokenTradePage] useEffect - setting mounted to true");
    setMounted(true);
  }, []);

  if (!mounted) {
    console.log("[TokenTradePage] Not mounted yet, showing loading...");
    return (
      <main className="min-h-screen bg-okx-bg-primary text-okx-text-primary">
        <Navbar />
        <div className="flex items-center justify-center min-h-screen">
          <div className="w-8 h-8 border-4 border-okx-up border-t-transparent rounded-full animate-spin"></div>
        </div>
      </main>
    );
  }

  console.log("[TokenTradePage] Mounted, rendering TradingTerminal with symbol:", symbol);

  return (
    <main className="min-h-screen bg-okx-bg-primary text-okx-text-primary">
      <Navbar />
      <TradingTerminal symbol={symbol} />
    </main>
  );
}
