import { createPublicClient, http, formatEther } from "viem";
import { baseSepolia } from "viem/chains";

const client = createPublicClient({
  chain: baseSepolia,
  transport: http("https://base-sepolia-rpc.publicnode.com"),
});

const USER = "0xCAE244A3417e75699da37c0e7EadA6cB244AA2B7";
const POSITION_MANAGER = "0x72E9a39aD581e78DF55fD14D803eD05fB6413660";
const VAULT = "0x467a18E3Ec98587Cd88683E6F9e1792C480C09c7";

async function main() {
  const latestBlock = await client.getBlockNumber();

  // Get all logs from PositionManager
  const logs = await client.getLogs({
    address: POSITION_MANAGER,
    fromBlock: latestBlock - 200n,
    toBlock: latestBlock,
  });

  console.log("=== PositionManager 最近事件 ===");
  console.log("总事件数:", logs.length);

  // Find user-related logs
  const userAddress = USER.slice(2).toLowerCase();
  const userLogs = logs.filter((log) => {
    for (const topic of log.topics) {
      if (topic?.toLowerCase().includes(userAddress)) return true;
    }
    if (log.data?.toLowerCase().includes(userAddress)) return true;
    return false;
  });

  console.log("用户相关事件数:", userLogs.length);

  for (const log of userLogs) {
    console.log("\n---");
    console.log("交易:", log.transactionHash);
    console.log("区块:", log.blockNumber?.toString());
    console.log("Topic0:", log.topics[0]);

    if (log.transactionHash) {
      const tx = await client.getTransaction({ hash: log.transactionHash });
      const selector = tx.input.slice(0, 10);

      const selectors: Record<string, string> = {
        "0xc393d0e3": "closePosition()",
        "0xf757a608": "closePositionToken(address)",
        "0xbf8bfb94": "openLongToken(address,uint256,uint256,uint8)",
        "0x3f8a01f2": "openShortToken(address,uint256,uint256,uint8)",
      };

      console.log("调用函数:", selectors[selector] || selector);

      const receipt = await client.getTransactionReceipt({ hash: log.transactionHash });
      console.log("状态:", receipt.status);

      // Parse event data
      if (log.data && log.data.length > 2) {
        const dataHex = log.data.slice(2);
        const chunks = [];
        for (let i = 0; i < dataHex.length; i += 64) {
          chunks.push(dataHex.slice(i, i + 64));
        }

        console.log("事件数据:");
        for (let i = 0; i < Math.min(6, chunks.length); i++) {
          const val = BigInt("0x" + chunks[i]);
          if (val > 0n && val < 10n ** 21n) {
            console.log("  [" + i + "]:", formatEther(val), "ETH");
          } else {
            console.log("  [" + i + "]:", val.toString());
          }
        }
      }
    }
  }

  // Also check Vault events
  console.log("\n\n=== Vault 最近事件 ===");
  const vaultLogs = await client.getLogs({
    address: VAULT,
    fromBlock: latestBlock - 200n,
    toBlock: latestBlock,
  });

  const userVaultLogs = vaultLogs.filter((log) => {
    for (const topic of log.topics) {
      if (topic?.toLowerCase().includes(userAddress)) return true;
    }
    return false;
  });

  console.log("用户 Vault 事件数:", userVaultLogs.length);

  for (const log of userVaultLogs.slice(-5)) {
    console.log("\n---");
    console.log("交易:", log.transactionHash?.slice(0, 20) + "...");
    console.log("Topic0:", log.topics[0]?.slice(0, 20) + "...");
  }
}

main().catch(console.error);
