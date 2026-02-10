import { createPublicClient, http, parseEther, toFunctionSelector } from "viem";
import { baseSepolia } from "viem/chains";

// 0xb45b7087 是什么错误？
// 计算已知错误的 selector
const errors = [
  "InsufficientLiquidity(uint256,uint256)",
  "PoolNotActive()",
  "InvalidAmount()",
  "InvalidAddress()",
  "InsufficientBalance(uint256,uint256)",
  "InsufficientFee(uint256,uint256)",
  "GraduationNotFailed()",
  "Paused()",
  "EnforcedPause()",
  "ReentrancyGuardReentrantCall()",
  "PoolGraduated()",
  "TransferFailed()",
  "SlippageExceeded(uint256,uint256)",
];

for (const err of errors) {
  const sel = toFunctionSelector("error " + err).slice(0, 10);
  console.log(sel, "=", err);
  if (sel === "0xb45b7087") {
    console.log(">>> MATCH FOUND:", err);
  }
}

console.log("\nTarget: 0xb45b7087");

// 也直接 cast 看看
const client = createPublicClient({ chain: baseSepolia, transport: http("https://sepolia.base.org") });

// 获取合约字节码检查是否是 proxy
const code = await client.getCode({ address: "0x8de2Ce2a0f974b4CB00EC5B56BD89382690b5523" as `0x${string}` });
console.log("\nTokenFactory code length:", code?.length, "chars");
console.log("Is proxy (short code)?", (code?.length || 0) < 200 ? "YES" : "NO");
