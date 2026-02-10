/**
 * 批量同步所有派生钱包的链上余额
 */

import fs from "fs";

const API_URL = "http://localhost:8081";
const tradingWallets = JSON.parse(fs.readFileSync("trading-wallets.json", "utf-8"));

console.log("=== 批量同步链上余额 ===");
console.log(`API: ${API_URL}`);
console.log(`钱包数量: ${tradingWallets.length}`);
console.log("");

let successCount = 0;
let failCount = 0;

for (let i = 0; i < tradingWallets.length; i++) {
  const wallet = tradingWallets[i];

  try {
    console.log(`[${i + 1}/${tradingWallets.length}] 同步 ${wallet.derivedAddress.slice(0, 12)}...`);

    const response = await fetch(`${API_URL}/api/balance/sync`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ trader: wallet.derivedAddress }),
    });

    const result = await response.json();

    if (result.success) {
      const availableBalance = Number(result.data.availableBalance) / 1e6;
      console.log(`  ✅ 可用余额: ${availableBalance.toFixed(2)} USDT`);
      successCount++;
    } else {
      console.log(`  ❌ 失败: ${result.error}`);
      failCount++;
    }

    // 小暂停避免限流
    if ((i + 1) % 20 === 0) {
      await new Promise(r => setTimeout(r, 500));
    }

  } catch (error: any) {
    console.log(`  ❌ 异常: ${error.message.slice(0, 80)}`);
    failCount++;
  }
}

console.log("");
console.log("=== 同步完成 ===");
console.log(`✅ 成功: ${successCount}/${tradingWallets.length}`);
console.log(`❌ 失败: ${failCount}/${tradingWallets.length}`);
