import { createPublicClient, http, formatEther, type Address } from "viem";
import { baseSepolia } from "viem/chains";

const RPC_URL = "https://base-sepolia.g.alchemy.com/v2/Dr8sMe-1MYIF7jBYuZZj8PMOPAAeJ16d";

async function main() {
  const client = createPublicClient({
    chain: baseSepolia,
    transport: http(RPC_URL),
  });

  console.log("=== 检查所有已知合约的 ETH 余额 ===\n");

  const contracts: Record<string, Address> = {
    // Current contracts
    "TokenFactory": "0xE0ddf67E89f5773c960Bc2329109815E8c66BAAe",
    "PositionManager": "0xeCA6E2f7466c0A1BA6dB3083a09b8B09969D77Ee",
    "Vault": "0x467a18E3Ec98587Cd88683E6F9e1792C480C09c7",
    "PriceFeed": "0x2dccffb6377364CDD189e2009Af96998F9b8BEcb",
    "Reader": "0xD107aB399645ab54869D53e9301850763E890D4F",
    
    // Settlement versions
    "Settlement V1": "0xaAAc66A691489BBF8571C8E4a95b1F96F07cE0Bc",
    "Settlement V2": "0xd84d1fFF3650ab4806B15A0D5F32932E80f0E32C",
    "Settlement V3": "0x2F0cb9cb3e96f0733557844e34C5152bFC887aA5",
    "Settlement V4 (current)": "0x8dd0De655628c0E8255e3d6c38c3DF2BE36e4D8d",
    
    // Other possible old contracts from deployments
    "InsuranceFund": "0x1234567890123456789012345678901234567890",
    
    // Deployer wallet
    "Deployer": "0x0E7dF4D0c4f4CaC53C68D38F62f180aA41faADeC",
  };

  let totalFound = 0n;

  for (const [name, addr] of Object.entries(contracts)) {
    try {
      const balance = await client.getBalance({ address: addr });
      if (balance > 0n) {
        console.log(name + ": " + formatEther(balance) + " ETH");
        console.log("  Address: " + addr);
        totalFound += balance;
      }
    } catch {}
  }

  console.log("\n合约中找到的 ETH 总计: " + formatEther(totalFound) + " ETH");
  console.log("测试钱包余额: 3.53 ETH");
  console.log("总计可追踪: " + formatEther(totalFound + 3530251569267909716n) + " ETH");
}

main().catch(console.error);
