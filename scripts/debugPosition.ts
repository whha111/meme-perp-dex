import { createPublicClient, http, formatEther, formatUnits, type Address } from "viem";
import { baseSepolia } from "viem/chains";

// 使用公共 RPC，没有限制
const RPC_URL = "https://base-sepolia-rpc.publicnode.com";
const COP400 = "0x6Bf5C512a5714D610379b1EA0Dec0BEFb46888f7" as Address;
const POSITION_MANAGER = "0x72E9a39aD581e78DF55fD14D803eD05fB6413660" as Address;

const client = createPublicClient({
  chain: baseSepolia,
  transport: http(RPC_URL),
});

async function main() {
  console.log("=== 调试仓位 ===\n");

  const latestBlock = await client.getBlockNumber();
  const fromBlock = latestBlock - 500n;

  console.log("查询最近事件...");
  console.log("从区块:", fromBlock.toString());
  console.log("到区块:", latestBlock.toString());

  // 查询 PositionOpened 事件
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
    fromBlock,
    toBlock: latestBlock,
  });

  console.log("\n开仓事件:", openedLogs.length, "个");
  for (const log of openedLogs) {
    console.log("  用户:", log.args.user);
    console.log("  代币:", log.args.token);
    console.log("  大小:", formatEther(log.args.size || 0n), "ETH");
    console.log("  保证金:", formatEther(log.args.collateral || 0n), "ETH");
    console.log("  方向:", log.args.isLong ? "LONG" : "SHORT");
    console.log("  区块:", log.blockNumber?.toString());
    console.log("  ---");
  }

  // 查询 PositionClosed 事件
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
    fromBlock,
    toBlock: latestBlock,
  });

  console.log("\n平仓事件:", closedLogs.length, "个");
  for (const log of closedLogs) {
    console.log("  用户:", log.args.user);
    console.log("  PnL:", log.args.pnl?.toString());
    console.log("  区块:", log.blockNumber?.toString());
    console.log("  ---");
  }

  // 查询清算事件
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
    fromBlock,
    toBlock: latestBlock,
  });

  console.log("\n清算事件:", liqLogs.length, "个");
  for (const log of liqLogs) {
    console.log("  用户:", log.args.user);
    console.log("  清算人:", log.args.liquidator);
    console.log("  区块:", log.blockNumber?.toString());
    console.log("  ---");
  }

  console.log("\n=== 统计 ===");
  console.log("开仓:", openedLogs.length);
  console.log("平仓:", closedLogs.length);
  console.log("清算:", liqLogs.length);
}

main().catch(console.error);
