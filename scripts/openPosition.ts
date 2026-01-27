/**
 * Open Position Script
 * Opens a LONG position on COP400 using the NEW PositionManager
 */
import {
  createPublicClient,
  createWalletClient,
  http,
  parseEther,
  formatEther,
  formatUnits,
  type Address,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { baseSepolia } from "viem/chains";

const RPC_URL = "https://base-sepolia-rpc.publicnode.com";

// New contracts
const POSITION_MANAGER = "0x72E9a39aD581e78DF55fD14D803eD05fB6413660" as Address;
const VAULT = "0x467a18E3Ec98587Cd88683E6F9e1792C480C09c7" as Address;
const PRICE_FEED = "0xd69A4DB60cEc962A46C6B9Bc8CC0883081c4eFb7" as Address;
const COP400 = "0x6Bf5C512a5714D610379b1EA0Dec0BEFb46888f7" as Address;

// Deployer key (for testing)
const PRIVATE_KEY = "0xf9a07bb59ea400ef88bfbcf314d89f357c8580d1a4fb543e48cfb98b02b41d2c";

const LEVERAGE_PRECISION = 10000n;

const client = createPublicClient({
  chain: baseSepolia,
  transport: http(RPC_URL),
});

const VAULT_ABI = [
  {
    inputs: [],
    name: "deposit",
    outputs: [],
    stateMutability: "payable",
    type: "function",
  },
  {
    inputs: [{ name: "user", type: "address" }],
    name: "getBalance",
    outputs: [{ type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
] as const;

const POSITION_MANAGER_ABI = [
  {
    inputs: [
      { name: "token", type: "address" },
      { name: "size", type: "uint256" },
      { name: "leverage", type: "uint256" },
      { name: "mode", type: "uint8" },
    ],
    name: "openLongToken",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [
      { name: "user", type: "address" },
      { name: "token", type: "address" },
    ],
    name: "getPositionByToken",
    outputs: [{
      components: [
        { name: "size", type: "uint256" },
        { name: "collateral", type: "uint256" },
        { name: "entryPrice", type: "uint256" },
        { name: "leverage", type: "uint256" },
        { name: "isLong", type: "bool" },
        { name: "lastFundingIndex", type: "int256" },
        { name: "openTime", type: "uint256" },
      ],
      type: "tuple",
    }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [
      { name: "user", type: "address" },
      { name: "token", type: "address" },
    ],
    name: "getTokenUnrealizedPnL",
    outputs: [
      { name: "hasProfit", type: "bool" },
      { name: "pnl", type: "uint256" },
    ],
    stateMutability: "view",
    type: "function",
  },
] as const;

const PRICE_FEED_ABI = [
  {
    inputs: [{ name: "token", type: "address" }],
    name: "getTokenMarkPrice",
    outputs: [{ type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
] as const;

async function main() {
  console.log("=== 开仓脚本 (新合约) ===\n");

  const account = privateKeyToAccount(PRIVATE_KEY);
  console.log("钱包地址:", account.address);

  const walletClient = createWalletClient({
    account,
    chain: baseSepolia,
    transport: http(RPC_URL),
  });

  // Check balance
  const balance = await client.getBalance({ address: account.address });
  console.log("ETH 余额:", formatEther(balance), "ETH");

  // Check Vault balance
  const vaultBalance = await client.readContract({
    address: VAULT,
    abi: VAULT_ABI,
    functionName: "getBalance",
    args: [account.address],
  });
  console.log("Vault 余额:", formatEther(vaultBalance), "ETH");

  // Get current price
  const markPrice = await client.readContract({
    address: PRICE_FEED,
    abi: PRICE_FEED_ABI,
    functionName: "getTokenMarkPrice",
    args: [COP400],
  });
  console.log("COP400 当前价格:", formatUnits(markPrice, 18), "ETH\n");

  // Position parameters
  const size = parseEther("0.05"); // 0.05 ETH position
  const leverageMultiplier = 5n; // 5x
  const leverage = leverageMultiplier * LEVERAGE_PRECISION;
  const requiredCollateral = (size * LEVERAGE_PRECISION) / leverage; // 0.01 ETH

  console.log("开仓参数:");
  console.log("  代币: COP400");
  console.log("  方向: LONG (多)");
  console.log("  仓位大小:", formatEther(size), "ETH");
  console.log("  杠杆:", leverageMultiplier.toString(), "x");
  console.log("  需要保证金:", formatEther(requiredCollateral), "ETH");

  // Deposit to Vault if needed
  if (vaultBalance < requiredCollateral) {
    const depositAmount = parseEther("0.02");
    console.log("\n存款到 Vault:", formatEther(depositAmount), "ETH...");
    
    const depositHash = await walletClient.writeContract({
      address: VAULT,
      abi: VAULT_ABI,
      functionName: "deposit",
      value: depositAmount,
    });
    await client.waitForTransactionReceipt({ hash: depositHash });
    console.log("  ✅ 存款成功");
  }

  // Open position
  console.log("\n开仓中...");
  try {
    const openHash = await walletClient.writeContract({
      address: POSITION_MANAGER,
      abi: POSITION_MANAGER_ABI,
      functionName: "openLongToken",
      args: [COP400, size, leverage, 0], // mode 0 = isolated
    });
    
    console.log("  交易:", openHash);
    const receipt = await client.waitForTransactionReceipt({ hash: openHash });
    
    if (receipt.status === "success") {
      console.log("  ✅ 开仓成功!\n");

      // Check position
      const position = await client.readContract({
        address: POSITION_MANAGER,
        abi: POSITION_MANAGER_ABI,
        functionName: "getPositionByToken",
        args: [account.address, COP400],
      });

      console.log("=== 仓位详情 ===");
      console.log("  方向:", position.isLong ? "LONG" : "SHORT");
      console.log("  大小:", formatEther(position.size), "ETH");
      console.log("  保证金:", formatEther(position.collateral), "ETH");
      console.log("  入场价:", formatUnits(position.entryPrice, 18), "ETH");
      console.log("  杠杆:", Number(position.leverage) / 10000, "x");

      // Check PnL
      const [hasProfit, pnl] = await client.readContract({
        address: POSITION_MANAGER,
        abi: POSITION_MANAGER_ABI,
        functionName: "getTokenUnrealizedPnL",
        args: [account.address, COP400],
      });
      console.log("  PnL:", hasProfit ? "+" : "-", formatEther(pnl), "ETH");

    } else {
      console.log("  ❌ 交易失败");
    }
  } catch (e: any) {
    console.log("  ❌ 错误:", e.message?.slice(0, 200));
  }
}

main().catch(console.error);
