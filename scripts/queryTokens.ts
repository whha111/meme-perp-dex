/**
 * Query Tradeable Tokens
 * Lists tokens available for perpetual and spot trading
 */

import { createPublicClient, http, formatUnits, formatEther, type Address } from "viem";
import { baseSepolia } from "viem/chains";

const RPC_URL = "https://base-sepolia.g.alchemy.com/v2/Dr8sMe-1MYIF7jBYuZZj8PMOPAAeJ16d";

const CONTRACTS = {
  TOKEN_FACTORY: "0xE0ddf67E89f5773c960Bc2329109815E8c66BAAe" as Address,
  PRICE_FEED: "0xd69A4DB60cEc962A46C6B9Bc8CC0883081c4eFb7" as Address,
};

const TOKEN_FACTORY_ABI = [
  {
    inputs: [],
    name: "getAllTokens",
    outputs: [{ type: "address[]" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [{ name: "tokenAddress", type: "address" }],
    name: "getPoolState",
    outputs: [{
      components: [
        { name: "realETHReserve", type: "uint256" },
        { name: "realTokenReserve", type: "uint256" },
        { name: "soldTokens", type: "uint256" },
        { name: "isGraduated", type: "bool" },
        { name: "isActive", type: "bool" },
        { name: "creator", type: "address" },
        { name: "createdAt", type: "uint64" },
        { name: "metadataURI", type: "string" },
      ],
      type: "tuple",
    }],
    stateMutability: "view",
    type: "function",
  },
] as const;

const PRICE_FEED_ABI = [
  {
    inputs: [],
    name: "getSupportedTokens",
    outputs: [{ type: "address[]" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [{ name: "token", type: "address" }],
    name: "getTokenMarkPrice",
    outputs: [{ type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
] as const;

const ERC20_ABI = [
  {
    inputs: [],
    name: "symbol",
    outputs: [{ type: "string" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [],
    name: "name",
    outputs: [{ type: "string" }],
    stateMutability: "view",
    type: "function",
  },
] as const;

async function main() {
  const client = createPublicClient({
    chain: baseSepolia,
    transport: http(RPC_URL),
  });

  console.log("========== 可交易代币查询 ==========\n");

  // 1. 查询永续合约支持的代币
  console.log("【永续合约交易】PriceFeed 支持的代币:");
  console.log("-".repeat(60));

  try {
    const supportedTokens = await client.readContract({
      address: CONTRACTS.PRICE_FEED,
      abi: PRICE_FEED_ABI,
      functionName: "getSupportedTokens",
    });

    if (supportedTokens.length === 0) {
      console.log("  暂无支持的代币");
    } else {
      for (const token of supportedTokens) {
        try {
          const [symbol, name, markPrice] = await Promise.all([
            client.readContract({ address: token as Address, abi: ERC20_ABI, functionName: "symbol" }),
            client.readContract({ address: token as Address, abi: ERC20_ABI, functionName: "name" }),
            client.readContract({ address: CONTRACTS.PRICE_FEED, abi: PRICE_FEED_ABI, functionName: "getTokenMarkPrice", args: [token as Address] }),
          ]);
          console.log(`  ${symbol} (${name})`);
          console.log(`    地址: ${token}`);
          console.log(`    标记价格: ${formatUnits(markPrice, 18)} ETH`);
        } catch (e) {
          console.log(`  ${token} - 无法获取详情`);
        }
      }
    }
  } catch (e: any) {
    console.log(`  查询失败: ${e.message?.slice(0, 100)}`);
  }

  // 2. 查询现货交易的代币 (TokenFactory)
  console.log("\n【现货交易】TokenFactory 活跃代币:");
  console.log("-".repeat(60));

  try {
    const allTokens = await client.readContract({
      address: CONTRACTS.TOKEN_FACTORY,
      abi: TOKEN_FACTORY_ABI,
      functionName: "getAllTokens",
    });

    console.log(`  总代币数: ${allTokens.length}`);

    // 只显示最近10个代币的详情
    const recentTokens = allTokens.slice(-10);
    console.log(`\n  最近 ${recentTokens.length} 个代币:`);

    let totalActive = 0;
    let totalGraduated = 0;

    for (const token of recentTokens) {
      try {
        const [poolState, symbol] = await Promise.all([
          client.readContract({
            address: CONTRACTS.TOKEN_FACTORY,
            abi: TOKEN_FACTORY_ABI,
            functionName: "getPoolState",
            args: [token as Address],
          }),
          client.readContract({ address: token as Address, abi: ERC20_ABI, functionName: "symbol" }),
        ]);

        const status = poolState.isGraduated ? "🎓已毕业" : (poolState.isActive ? "✅活跃" : "❌非活跃");
        console.log(`\n  ${symbol} ${status}`);
        console.log(`    地址: ${token}`);
        console.log(`    ETH储备: ${formatEther(poolState.realETHReserve)} ETH`);
        console.log(`    已售代币: ${formatEther(poolState.soldTokens)}`);

        if (poolState.isActive) totalActive++;
        if (poolState.isGraduated) totalGraduated++;
      } catch (e) {
        console.log(`  ${token} - 查询失败`);
      }
    }

    // Count all tokens
    for (const token of allTokens.slice(0, -10)) {
      try {
        const poolState = await client.readContract({
          address: CONTRACTS.TOKEN_FACTORY,
          abi: TOKEN_FACTORY_ABI,
          functionName: "getPoolState",
          args: [token as Address],
        });
        if (poolState.isActive) totalActive++;
        if (poolState.isGraduated) totalGraduated++;
      } catch (e) {}
    }

    console.log("\n  统计:");
    console.log(`    活跃代币: ${totalActive}/${allTokens.length}`);
    console.log(`    已毕业: ${totalGraduated}`);

  } catch (e: any) {
    console.log(`  查询失败: ${e.message?.slice(0, 100)}`);
  }

  console.log("\n========== 查询完成 ==========");
}

main().catch(console.error);
