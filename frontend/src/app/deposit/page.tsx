"use client";

/**
 * Deposit/Withdraw Page — 派生钱包模式
 *
 * 充值: 主钱包 → 派生钱包 (一步 BNB 转账)
 * 提现: 派生钱包 → 主钱包 (一步 BNB 转账)
 */

import { Navbar } from "@/components/layout/Navbar";
import { AccountBalance } from "@/components/common/AccountBalance";

export default function DepositPage() {
  return (
    <div className="min-h-screen bg-okx-bg-primary">
      <Navbar />
      <div className="max-w-lg mx-auto px-4 pt-8">
        <AccountBalance />
      </div>
    </div>
  );
}
