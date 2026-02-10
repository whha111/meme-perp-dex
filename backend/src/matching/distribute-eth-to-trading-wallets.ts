/**
 * 从主钱包#1分发ETH到所有派生钱包
 *
 * 每个派生钱包需要少量 ETH 用于 gas:
 * - Approve USDT: ~0.003 ETH
 * - Deposit USDT: ~0.003 ETH
 * - 交易订单签名: 不需要 gas (链下签名)
 *
 * 给每个钱包 0.01 ETH 应该够了
 */

import { createWalletClient, http, parseEther } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { baseSepolia } from "viem/chains";
import fs from "fs";

const RPC_URL = "https://sepolia.base.org";
const ETH_PER_WALLET = parseEther("0.01"); // 0.01 ETH 每个钱包

const mainWallets = JSON.parse(fs.readFileSync("main-wallets.json", "utf-8"));
const tradingWallets = JSON.parse(fs.readFileSync("trading-wallets.json", "utf-8"));

// 使用有 6 ETH 的主钱包 #1
const sender = mainWallets[0];
const account = privateKeyToAccount(sender.privateKey as any);

const client = createWalletClient({
  account,
  chain: baseSepolia,
  transport: http(RPC_URL),
});

console.log("=== 开始分发 ETH 到派生钱包 ===");
console.log(`发送方: ${account.address}`);
console.log(`接收钱包数: ${tradingWallets.length}`);
console.log(`每个钱包: ${0.01} ETH`);
console.log(`总计: ${tradingWallets.length * 0.01} ETH`);
console.log("");

let successCount = 0;
let failCount = 0;

for (let i = 0; i < tradingWallets.length; i++) {
  const wallet = tradingWallets[i];

  try {
    console.log(`[${i + 1}/${tradingWallets.length}] 转账到 ${wallet.derivedAddress.slice(0, 12)}...`);

    const hash = await client.sendTransaction({
      to: wallet.derivedAddress,
      value: ETH_PER_WALLET,
    });

    console.log(`✅ 成功! TX: ${hash.slice(0, 20)}...`);
    successCount++;

    // 每 10 个暂停避免限流
    if ((i + 1) % 10 === 0) {
      console.log(`⏸️  暂停 2 秒...`);
      await new Promise(r => setTimeout(r, 2000));
    } else {
      // 小暂停避免 nonce 问题
      await new Promise(r => setTimeout(r, 500));
    }

  } catch (error: any) {
    console.log(`❌ 失败: ${error.message.slice(0, 100)}`);
    failCount++;
  }
}

console.log("");
console.log("=== 分发完成 ===");
console.log(`✅ 成功: ${successCount}/${tradingWallets.length}`);
console.log(`❌ 失败: ${failCount}/${tradingWallets.length}`);
console.log(`💰 总花费: ${(successCount * 0.01).toFixed(4)} ETH`);
