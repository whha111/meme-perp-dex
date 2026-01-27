import { createPublicClient, createWalletClient, http, formatEther, type Address } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { baseSepolia } from "viem/chains";

const RPC_URL = "https://base-sepolia-rpc.publicnode.com";
const DEPLOYER_KEY = "0xf9a07bb59ea400ef88bfbcf314d89f357c8580d1a4fb543e48cfb98b02b41d2c";

// 新部署的 PositionManager
const NEW_PM = "0x80b54dbfe9269b659c48767f6c6847fb2206fb3a" as Address;

// 现有合约地址
const FUNDING_RATE = "0x9Abe85f3bBee0f06330E8703e29B327CE551Ba10" as Address;
const LIQUIDATION = "0x468B589c68dBe29b2BC2b765108D63B61805e982" as Address;
const COP400_TOKEN = "0x6Bf5C512a5714D610379b1EA0Dec0BEFb46888f7" as Address;
const FEE_RECEIVER = "0x5AF11d4784c3739cf2FD51Fdc272ae4957ADf7fE" as Address; // deployer

const client = createPublicClient({ chain: baseSepolia, transport: http(RPC_URL) });
const account = privateKeyToAccount(DEPLOYER_KEY);
const walletClient = createWalletClient({ account, chain: baseSepolia, transport: http(RPC_URL) });

const PM_ABI = [
  {
    inputs: [{ name: "_fundingRate", type: "address" }],
    name: "setFundingRate",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [{ name: "_liquidation", type: "address" }],
    name: "setLiquidation",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [{ name: "token", type: "address" }],
    name: "setDefaultToken",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [{ name: "_feeReceiver", type: "address" }],
    name: "setFeeReceiver",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [],
    name: "defaultToken",
    outputs: [{ type: "address" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [],
    name: "feeReceiver",
    outputs: [{ type: "address" }],
    stateMutability: "view",
    type: "function",
  },
] as const;

async function main() {
  console.log("=== 配置新的 PositionManager ===\n");
  console.log("PositionManager:", NEW_PM);

  // 1. 设置 FundingRate
  console.log("\n1. 设置 FundingRate...");
  const fr = await walletClient.writeContract({
    address: NEW_PM,
    abi: PM_ABI,
    functionName: "setFundingRate",
    args: [FUNDING_RATE],
  });
  await client.waitForTransactionReceipt({ hash: fr });
  console.log("   ✅ FundingRate:", FUNDING_RATE);

  // 2. 设置 Liquidation
  console.log("\n2. 设置 Liquidation...");
  const liq = await walletClient.writeContract({
    address: NEW_PM,
    abi: PM_ABI,
    functionName: "setLiquidation",
    args: [LIQUIDATION],
  });
  await client.waitForTransactionReceipt({ hash: liq });
  console.log("   ✅ Liquidation:", LIQUIDATION);

  // 3. 设置 DefaultToken
  console.log("\n3. 设置 DefaultToken (COP400)...");
  const dt = await walletClient.writeContract({
    address: NEW_PM,
    abi: PM_ABI,
    functionName: "setDefaultToken",
    args: [COP400_TOKEN],
  });
  await client.waitForTransactionReceipt({ hash: dt });
  console.log("   ✅ DefaultToken:", COP400_TOKEN);

  // 4. 设置 FeeReceiver
  console.log("\n4. 设置 FeeReceiver...");
  const fee = await walletClient.writeContract({
    address: NEW_PM,
    abi: PM_ABI,
    functionName: "setFeeReceiver",
    args: [FEE_RECEIVER],
  });
  await client.waitForTransactionReceipt({ hash: fee });
  console.log("   ✅ FeeReceiver:", FEE_RECEIVER);

  // 验证配置
  console.log("\n=== 验证配置 ===");
  const defaultToken = await client.readContract({
    address: NEW_PM,
    abi: PM_ABI,
    functionName: "defaultToken",
  });
  const feeReceiver = await client.readContract({
    address: NEW_PM,
    abi: PM_ABI,
    functionName: "feeReceiver",
  });
  console.log("DefaultToken:", defaultToken);
  console.log("FeeReceiver:", feeReceiver);

  console.log("\n✅ 配置完成！");
}

main().catch((e) => console.error("错误:", e.message));
