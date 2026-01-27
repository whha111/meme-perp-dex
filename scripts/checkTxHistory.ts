import { createPublicClient, http, formatEther, type Address, parseAbiItem } from "viem";
import { baseSepolia } from "viem/chains";

const RPC_URL = "https://base-sepolia-rpc.publicnode.com";
const USER = "0xCAE244A3417e75699da37c0e7EadA6cB244AA2B7" as Address;
const POSITION_MANAGER = "0x72E9a39aD581e78DF55fD14D803eD05fB6413660" as Address;
const VAULT = "0x467a18E3Ec98587Cd88683E6F9e1792C480C09c7" as Address;

const client = createPublicClient({
  chain: baseSepolia,
  transport: http(RPC_URL),
});

async function main() {
  console.log("=== 查询用户交易历史 ===\n");
  console.log("用户:", USER);

  const latestBlock = await client.getBlockNumber();
  // 查询更大范围 - 最近 5000 区块
  const fromBlock = latestBlock - 5000n;

  console.log("查询范围:", fromBlock.toString(), "-", latestBlock.toString());

  // 查询用户发送到 PositionManager 的所有交易
  console.log("\n--- PositionManager 相关事件 ---");

  // PositionOpened events for this user
  try {
    const openedLogs = await client.getLogs({
      address: POSITION_MANAGER,
      event: {
        type: "event",
        name: "PositionOpened",
        inputs: [
          { indexed: true, name: "user", type: "address" },
          { indexed: true, name: "token", type: "address" },
          { indexed: false, name: "size", type: "uint256" },
          { indexed: false, name: "collateral", type: "uint256" },
          { indexed: false, name: "entryPrice", type: "uint256" },
          { indexed: false, name: "leverage", type: "uint256" },
          { indexed: false, name: "isLong", type: "bool" },
        ],
      },
      args: {
        user: USER,
      },
      fromBlock,
      toBlock: latestBlock,
    });

    console.log("\n开仓事件:", openedLogs.length, "个");
    for (const log of openedLogs) {
      console.log("  代币:", log.args.token);
      console.log("  大小:", formatEther(log.args.size || 0n), "ETH");
      console.log("  保证金:", formatEther(log.args.collateral || 0n), "ETH");
      console.log("  方向:", log.args.isLong ? "LONG" : "SHORT");
      console.log("  区块:", log.blockNumber?.toString());
      console.log("  交易:", log.transactionHash);
      console.log("  ---");
    }
  } catch (e: any) {
    console.log("开仓事件查询失败:", e.message?.slice(0, 100));
  }

  // PositionClosed events for this user
  try {
    const closedLogs = await client.getLogs({
      address: POSITION_MANAGER,
      event: {
        type: "event",
        name: "PositionClosed",
        inputs: [
          { indexed: true, name: "user", type: "address" },
          { indexed: true, name: "token", type: "address" },
          { indexed: false, name: "size", type: "uint256" },
          { indexed: false, name: "exitPrice", type: "uint256" },
          { indexed: false, name: "pnl", type: "int256" },
        ],
      },
      args: {
        user: USER,
      },
      fromBlock,
      toBlock: latestBlock,
    });

    console.log("\n平仓事件:", closedLogs.length, "个");
    for (const log of closedLogs) {
      console.log("  代币:", log.args.token);
      console.log("  PnL:", log.args.pnl?.toString());
      console.log("  区块:", log.blockNumber?.toString());
      console.log("  交易:", log.transactionHash);
      console.log("  ---");
    }
  } catch (e: any) {
    console.log("平仓事件查询失败:", e.message?.slice(0, 100));
  }

  // Liquidation events for this user
  try {
    const liqLogs = await client.getLogs({
      address: POSITION_MANAGER,
      event: {
        type: "event",
        name: "PositionLiquidated",
        inputs: [
          { indexed: true, name: "user", type: "address" },
          { indexed: true, name: "token", type: "address" },
          { indexed: true, name: "liquidator", type: "address" },
          { indexed: false, name: "size", type: "uint256" },
          { indexed: false, name: "collateral", type: "uint256" },
        ],
      },
      args: {
        user: USER,
      },
      fromBlock,
      toBlock: latestBlock,
    });

    console.log("\n清算事件:", liqLogs.length, "个");
    for (const log of liqLogs) {
      console.log("  代币:", log.args.token);
      console.log("  清算人:", log.args.liquidator);
      console.log("  区块:", log.blockNumber?.toString());
      console.log("  交易:", log.transactionHash);
      console.log("  ---");
    }
  } catch (e: any) {
    console.log("清算事件查询失败:", e.message?.slice(0, 100));
  }

  // Vault deposit events
  console.log("\n--- Vault 相关事件 ---");
  try {
    const depositLogs = await client.getLogs({
      address: VAULT,
      event: {
        type: "event",
        name: "Deposited",
        inputs: [
          { indexed: true, name: "user", type: "address" },
          { indexed: false, name: "amount", type: "uint256" },
        ],
      },
      args: {
        user: USER,
      },
      fromBlock,
      toBlock: latestBlock,
    });

    console.log("\n存款事件:", depositLogs.length, "个");
    for (const log of depositLogs) {
      console.log("  金额:", formatEther(log.args.amount || 0n), "ETH");
      console.log("  区块:", log.blockNumber?.toString());
      console.log("  ---");
    }
  } catch (e: any) {
    console.log("存款事件查询失败:", e.message?.slice(0, 100));
  }
}

main().catch(console.error);
