import { createPublicClient, http, formatEther, formatUnits, type Address } from "viem";
import { baseSepolia } from "viem/chains";

const RPC_URL = "https://base-sepolia-rpc.publicnode.com";
const USER = "0xCAE244A3417e75699da37c0e7EadA6cB244AA2B7" as Address;
const COP400 = "0x6Bf5C512a5714D610379b1EA0Dec0BEFb46888f7" as Address;

const CONTRACTS = {
  POSITION_MANAGER: "0x72E9a39aD581e78DF55fD14D803eD05fB6413660" as Address,
  VAULT: "0x467a18E3Ec98587Cd88683E6F9e1792C480C09c7" as Address,
  PRICE_FEED: "0xd69A4DB60cEc962A46C6B9Bc8CC0883081c4eFb7" as Address,
};

const client = createPublicClient({
  chain: baseSepolia,
  transport: http(RPC_URL),
});

async function main() {
  console.log("=== 查询用户仓位 ===\n");
  console.log("用户地址:", USER);
  console.log("代币: COP400 (" + COP400 + ")\n");

  // 检查 ETH 余额
  const ethBalance = await client.getBalance({ address: USER });
  console.log("ETH 余额:", formatEther(ethBalance), "ETH");

  // 检查 Vault 余额
  try {
    const vaultBalance = await client.readContract({
      address: CONTRACTS.VAULT,
      abi: [{
        inputs: [{ name: "user", type: "address" }],
        name: "getBalance",
        outputs: [{ type: "uint256" }],
        stateMutability: "view",
        type: "function",
      }],
      functionName: "getBalance",
      args: [USER],
    });
    console.log("Vault 余额:", formatEther(vaultBalance), "ETH");
  } catch (e: any) {
    console.log("Vault 余额查询失败:", e.message?.slice(0, 50));
  }

  // 检查 COP400 仓位
  console.log("\n--- COP400 仓位 ---");
  try {
    const position = await client.readContract({
      address: CONTRACTS.POSITION_MANAGER,
      abi: [{
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
      }],
      functionName: "getPositionByToken",
      args: [USER, COP400],
    });

    if (position.size > 0n) {
      console.log("✅ 有仓位!");
      console.log("  方向:", position.isLong ? "LONG" : "SHORT");
      console.log("  大小:", formatEther(position.size), "ETH");
      console.log("  保证金:", formatEther(position.collateral), "ETH");
      console.log("  入场价:", formatUnits(position.entryPrice, 18), "ETH");
      console.log("  杠杆:", Number(position.leverage) / 10000, "x");
      console.log("  开仓时间:", new Date(Number(position.openTime) * 1000).toLocaleString());

      // 检查 PnL
      try {
        const [hasProfit, pnl] = await client.readContract({
          address: CONTRACTS.POSITION_MANAGER,
          abi: [{
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
          }],
          functionName: "getTokenUnrealizedPnL",
          args: [USER, COP400],
        });
        console.log("  PnL:", hasProfit ? "+" : "-", formatEther(pnl), "ETH");
      } catch (e) {
        console.log("  PnL: 无法计算");
      }
    } else {
      console.log("❌ 没有 COP400 仓位");
    }
  } catch (e: any) {
    console.log("查询失败:", e.message?.slice(0, 100));
  }

  // 检查所有支持的代币仓位
  console.log("\n--- 检查所有支持代币的仓位 ---");
  try {
    const supportedTokens = await client.readContract({
      address: CONTRACTS.PRICE_FEED,
      abi: [{
        inputs: [],
        name: "getSupportedTokens",
        outputs: [{ type: "address[]" }],
        stateMutability: "view",
        type: "function",
      }],
      functionName: "getSupportedTokens",
    });

    console.log("支持的代币:", supportedTokens.length, "个");

    for (const token of supportedTokens) {
      try {
        const position = await client.readContract({
          address: CONTRACTS.POSITION_MANAGER,
          abi: [{
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
          }],
          functionName: "getPositionByToken",
          args: [USER, token as Address],
        });

        if (position.size > 0n) {
          console.log("\n✅ 找到仓位:", token);
          console.log("  方向:", position.isLong ? "LONG" : "SHORT");
          console.log("  大小:", formatEther(position.size), "ETH");
        }
      } catch (e) {
        // ignore
      }
    }
  } catch (e: any) {
    console.log("查询支持代币失败:", e.message?.slice(0, 50));
  }
}

main().catch(console.error);
