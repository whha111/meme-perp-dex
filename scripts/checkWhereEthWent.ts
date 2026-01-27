import { createPublicClient, http, formatEther, type Address } from "viem";
import { baseSepolia } from "viem/chains";
import * as fs from "fs";

const RPC_URL = "https://base-sepolia.g.alchemy.com/v2/Dr8sMe-1MYIF7jBYuZZj8PMOPAAeJ16d";
const WALLETS_PATH = "/Users/qinlinqiu/Desktop/Namespace/scripts/market-maker/wallets.json";

const TOKEN_FACTORY = "0xE0ddf67E89f5773c960Bc2329109815E8c66BAAe" as Address;

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
    outputs: [
      {
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
      },
    ],
    stateMutability: "view",
    type: "function",
  },
] as const;

const ERC20_ABI = [
  {
    inputs: [{ name: "account", type: "address" }],
    name: "balanceOf",
    outputs: [{ type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [],
    name: "symbol",
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

  const data = JSON.parse(fs.readFileSync(WALLETS_PATH, "utf-8"));
  const wallets = data.wallets;

  console.log("=== 分析 ETH 去向 ===\n");

  // 1. 检查 TokenFactory 池子里的 ETH
  console.log("1. TokenFactory 池子里的 ETH:\n");
  
  let allTokens: Address[] = [];
  try {
    allTokens = await client.readContract({
      address: TOKEN_FACTORY,
      abi: TOKEN_FACTORY_ABI,
      functionName: "getAllTokens",
    }) as Address[];
  } catch (e) {
    console.log("无法获取代币列表");
  }

  console.log("共有 " + allTokens.length + " 个代币\n");

  let totalPoolEth = 0n;
  for (let i = 0; i < Math.min(allTokens.length, 50); i++) {
    const token = allTokens[i];
    try {
      const poolState = await client.readContract({
        address: TOKEN_FACTORY,
        abi: TOKEN_FACTORY_ABI,
        functionName: "getPoolState",
        args: [token],
      });
      
      if (poolState.realETHReserve > 0n) {
        totalPoolEth += poolState.realETHReserve;
        console.log("Token " + i + ": " + formatEther(poolState.realETHReserve) + " ETH in pool");
      }
    } catch {}
  }

  console.log("\n池子总 ETH: " + formatEther(totalPoolEth) + " ETH");

  // 2. 检查测试钱包持有的代币价值
  console.log("\n2. 测试钱包持有的代币:\n");
  
  let totalTokenValue = 0n;
  const wallet0 = wallets[0].address as Address;
  
  for (let i = 0; i < Math.min(allTokens.length, 20); i++) {
    const token = allTokens[i];
    try {
      const balance = await client.readContract({
        address: token,
        abi: ERC20_ABI,
        functionName: "balanceOf",
        args: [wallet0],
      });
      
      if (balance > 0n) {
        let symbol = "???";
        try {
          symbol = await client.readContract({
            address: token,
            abi: ERC20_ABI,
            functionName: "symbol",
          });
        } catch {}
        console.log("Wallet 0 holds " + formatEther(balance) + " " + symbol);
      }
    } catch {}
  }

  // 3. 检查旧版本合约余额
  console.log("\n3. 旧版合约可能锁定的 ETH:\n");
  
  const oldContracts = [
    "0xaAAc66A691489BBF8571C8E4a95b1F96F07cE0Bc", // Old Settlement V1
    "0xd84d1fFF3650ab4806B15A0D5F32932E80f0E32C", // Old Settlement V2
    "0x2F0cb9cb3e96f0733557844e34C5152bFC887aA5", // Old Settlement V3
    "0x467a18E3Ec98587Cd88683E6F9e1792C480C09c7", // Vault
    "0xeCA6E2f7466c0A1BA6dB3083a09b8B09969D77Ee", // PositionManager
  ];

  for (const addr of oldContracts) {
    const balance = await client.getBalance({ address: addr as Address });
    if (balance > 0n) {
      console.log(addr.slice(0, 10) + "...: " + formatEther(balance) + " ETH");
    }
  }

  // 4. TokenFactory 合约本身的 ETH
  const factoryBalance = await client.getBalance({ address: TOKEN_FACTORY });
  console.log("\nTokenFactory 合约余额: " + formatEther(factoryBalance) + " ETH");
}

main().catch(console.error);
