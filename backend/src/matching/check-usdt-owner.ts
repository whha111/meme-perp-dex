import { createPublicClient, http } from "viem";
import { baseSepolia } from "viem/chains";

const USDT_ADDRESS = "0xAa2a6b49C37E0241f9b5385dc4637eDF51026519";
const DEPLOYER = "0x5AF11d4784c3739cf2FD51Fdc272ae4957ADf7fE"; // 部署账户

const ABI = [
  {
    inputs: [],
    name: "owner",
    outputs: [{ type: "address" }],
    stateMutability: "view",
    type: "function"
  }
];

const client = createPublicClient({
  chain: baseSepolia,
  transport: http("https://sepolia.base.org"),
});

console.log("=== 检查USDT合约owner ===\n");

try {
  const owner = await client.readContract({
    address: USDT_ADDRESS,
    abi: ABI,
    functionName: "owner"
  });
  
  console.log("USDT Owner:", owner);
  console.log("部署账户:", DEPLOYER);
  console.log("当前钱包:", "0x94c0D111E54D5A26c35d0a36aEeF6f29c480B480");
  
  if (owner === DEPLOYER) {
    console.log("\n✅ 部署账户有mint权限");
  } else {
    console.log("\n❌ 需要使用owner账户:", owner);
  }
} catch (e: any) {
  console.log("检查失败:", e.message);
}
