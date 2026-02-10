import { createWalletClient, http, createPublicClient } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { baseSepolia } from "viem/chains";
import fs from "fs";

const wallets = JSON.parse(fs.readFileSync("main-wallets.json", "utf-8"));
const WALLET1 = wallets[0]; // 有6 ETH的钱包

const USDT_ABI = [
  {
    inputs: [
      { name: "to", type: "address" },
      { name: "amount", type: "uint256" }
    ],
    name: "mint",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function"
  }
];

const account = privateKeyToAccount(WALLET1.privateKey as any);
const client = createWalletClient({
  account,
  chain: baseSepolia,
  transport: http("https://sepolia.base.org"),
});

console.log("=== 测试mint权限 ===");
console.log("钱包:", account.address);

try {
  // 尝试给自己mint 100 USDT
  const hash = await client.writeContract({
    address: "0xAa2a6b49C37E0241f9b5385dc4637eDF51026519",
    abi: USDT_ABI,
    functionName: "mint",
    args: [account.address, 100000000n], // 100 USDT
  });
  
  console.log("✅ Mint成功! TX:", hash);
} catch (error: any) {
  console.log("❌ 没有mint权限");
  console.log("错误:", error.message.slice(0, 200));
}
