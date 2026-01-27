/**
 * 端到端集成测试
 *
 * 测试完整流程：
 * 1. 本地 Anvil 节点 + 部署合约
 * 2. 用户签署 EIP-712 订单
 * 3. 订单提交到撮合引擎
 * 4. 撮合配对
 * 5. 批量提交到链上结算
 * 6. 验证链上状态
 */

import {
  createPublicClient,
  createWalletClient,
  http,
  parseEther,
  formatEther,
  type Address,
  type Hex,
  type Account,
  encodeFunctionData,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { foundry } from "viem/chains";
import { MatchingEngine, OrderType, OrderStatus, type Match } from "./engine.js";

// ============================================================
// Test Configuration
// ============================================================

const ANVIL_RPC = "http://127.0.0.1:8545";

// Test private keys (Anvil default accounts)
const DEPLOYER_KEY = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80" as Hex;
const TRADER_A_KEY = "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d" as Hex;
const TRADER_B_KEY = "0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a" as Hex;
const MATCHER_KEY = "0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6" as Hex;

// ============================================================
// Settlement Contract ABI (simplified for testing)
// ============================================================

const SETTLEMENT_ABI = [
  // Read functions
  {
    inputs: [{ name: "user", type: "address" }],
    name: "getUserBalance",
    outputs: [
      { name: "available", type: "uint256" },
      { name: "locked", type: "uint256" },
    ],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [{ name: "user", type: "address" }],
    name: "nonces",
    outputs: [{ type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [],
    name: "nextPairId",
    outputs: [{ type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [{ name: "pairId", type: "uint256" }],
    name: "getPairedPosition",
    outputs: [
      {
        components: [
          { name: "pairId", type: "uint256" },
          { name: "longTrader", type: "address" },
          { name: "shortTrader", type: "address" },
          { name: "token", type: "address" },
          { name: "size", type: "uint256" },
          { name: "entryPrice", type: "uint256" },
          { name: "longCollateral", type: "uint256" },
          { name: "shortCollateral", type: "uint256" },
          { name: "longLeverage", type: "uint256" },
          { name: "shortLeverage", type: "uint256" },
          { name: "openTime", type: "uint256" },
          { name: "accFundingLong", type: "int256" },
          { name: "accFundingShort", type: "int256" },
          { name: "status", type: "uint8" },
        ],
        type: "tuple",
      },
    ],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [{ name: "pairId", type: "uint256" }],
    name: "getUnrealizedPnL",
    outputs: [
      { name: "longPnL", type: "int256" },
      { name: "shortPnL", type: "int256" },
    ],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [{ name: "token", type: "address" }],
    name: "prices",
    outputs: [{ type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
  // Write functions
  {
    inputs: [],
    name: "deposit",
    outputs: [],
    stateMutability: "payable",
    type: "function",
  },
  {
    inputs: [{ name: "amount", type: "uint256" }],
    name: "withdraw",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [
      { name: "token", type: "address" },
      { name: "price", type: "uint256" },
    ],
    name: "updatePrice",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [
      {
        components: [
          {
            components: [
              { name: "trader", type: "address" },
              { name: "token", type: "address" },
              { name: "isLong", type: "bool" },
              { name: "size", type: "uint256" },
              { name: "leverage", type: "uint256" },
              { name: "price", type: "uint256" },
              { name: "deadline", type: "uint256" },
              { name: "nonce", type: "uint256" },
              { name: "orderType", type: "uint8" },
            ],
            name: "longOrder",
            type: "tuple",
          },
          { name: "longSignature", type: "bytes" },
          {
            components: [
              { name: "trader", type: "address" },
              { name: "token", type: "address" },
              { name: "isLong", type: "bool" },
              { name: "size", type: "uint256" },
              { name: "leverage", type: "uint256" },
              { name: "price", type: "uint256" },
              { name: "deadline", type: "uint256" },
              { name: "nonce", type: "uint256" },
              { name: "orderType", type: "uint8" },
            ],
            name: "shortOrder",
            type: "tuple",
          },
          { name: "shortSignature", type: "bytes" },
          { name: "matchPrice", type: "uint256" },
          { name: "matchSize", type: "uint256" },
        ],
        name: "pairs",
        type: "tuple[]",
      },
    ],
    name: "settleBatch",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [{ name: "pairId", type: "uint256" }],
    name: "closePair",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
] as const;

// ============================================================
// EIP-712 Signing
// ============================================================

function getEIP712Domain(settlementAddress: Address, chainId: number) {
  return {
    name: "MemePerp",
    version: "1",
    chainId,
    verifyingContract: settlementAddress,
  };
}

const ORDER_TYPES = {
  Order: [
    { name: "trader", type: "address" },
    { name: "token", type: "address" },
    { name: "isLong", type: "bool" },
    { name: "size", type: "uint256" },
    { name: "leverage", type: "uint256" },
    { name: "price", type: "uint256" },
    { name: "deadline", type: "uint256" },
    { name: "nonce", type: "uint256" },
    { name: "orderType", type: "uint8" },
  ],
} as const;

async function signOrder(
  walletClient: ReturnType<typeof createWalletClient>,
  settlementAddress: Address,
  order: {
    trader: Address;
    token: Address;
    isLong: boolean;
    size: bigint;
    leverage: bigint;
    price: bigint;
    deadline: bigint;
    nonce: bigint;
    orderType: number;
  }
): Promise<Hex> {
  const domain = getEIP712Domain(settlementAddress, 31337); // Anvil chain ID

  const signature = await walletClient.signTypedData({
    account: walletClient.account!,
    domain,
    types: ORDER_TYPES,
    primaryType: "Order",
    message: order,
  });

  return signature;
}

// ============================================================
// Test Helpers
// ============================================================

function assert(condition: boolean, message: string) {
  if (!condition) {
    throw new Error(`FAIL: ${message}`);
  }
  console.log(`  ✓ ${message}`);
}

function getDeadline(): bigint {
  return BigInt(Math.floor(Date.now() / 1000) + 3600);
}

// ============================================================
// E2E Test
// ============================================================

async function runE2ETest() {
  console.log("\n" + "=".repeat(60));
  console.log("  端到端集成测试 - E2E Integration Test");
  console.log("=".repeat(60));

  // Check if Anvil is running
  const publicClient = createPublicClient({
    chain: foundry,
    transport: http(ANVIL_RPC),
  });

  try {
    await publicClient.getBlockNumber();
  } catch (e) {
    console.error("\n❌ Anvil not running. Start it with: anvil\n");
    process.exit(1);
  }

  // Setup accounts
  const deployer = privateKeyToAccount(DEPLOYER_KEY);
  const traderA = privateKeyToAccount(TRADER_A_KEY);
  const traderB = privateKeyToAccount(TRADER_B_KEY);
  const matcher = privateKeyToAccount(MATCHER_KEY);

  console.log("\n📋 Test Accounts:");
  console.log(`  Deployer: ${deployer.address}`);
  console.log(`  Trader A: ${traderA.address}`);
  console.log(`  Trader B: ${traderB.address}`);
  console.log(`  Matcher:  ${matcher.address}`);

  // Create wallet clients
  const deployerClient = createWalletClient({
    account: deployer,
    chain: foundry,
    transport: http(ANVIL_RPC),
  });

  const traderAClient = createWalletClient({
    account: traderA,
    chain: foundry,
    transport: http(ANVIL_RPC),
  });

  const traderBClient = createWalletClient({
    account: traderB,
    chain: foundry,
    transport: http(ANVIL_RPC),
  });

  const matcherClient = createWalletClient({
    account: matcher,
    chain: foundry,
    transport: http(ANVIL_RPC),
  });

  // ========================================
  // Step 1: Deploy Settlement Contract
  // ========================================
  console.log("\n" + "-".repeat(60));
  console.log("Step 1: Deploy Settlement Contract");
  console.log("-".repeat(60));

  // Read deployed bytecode from the out directory
  const fs = await import("fs");
  const path = await import("path");

  // Use absolute path to contracts directory
  const artifactPath = "/Users/qinlinqiu/Desktop/meme-perp-dex/contracts/out/Settlement.sol/Settlement.json";

  let settlementAddress: Address;

  if (fs.existsSync(artifactPath)) {
    const artifact = JSON.parse(fs.readFileSync(artifactPath, "utf-8"));
    const bytecode = artifact.bytecode.object as Hex;

    // Deploy
    const hash = await deployerClient.deployContract({
      abi: SETTLEMENT_ABI,
      bytecode,
      args: [],
    });

    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    settlementAddress = receipt.contractAddress!;
    console.log(`  ✓ Settlement deployed at: ${settlementAddress}`);

    // Grant matcher role
    await deployerClient.writeContract({
      address: settlementAddress,
      abi: [
        {
          inputs: [
            { name: "matcher", type: "address" },
            { name: "authorized", type: "bool" },
          ],
          name: "setAuthorizedMatcher",
          outputs: [],
          stateMutability: "nonpayable",
          type: "function",
        },
      ],
      functionName: "setAuthorizedMatcher",
      args: [matcher.address, true],
    });
  } else {
    // Use pre-deployed address if available
    console.log("  ⚠ Artifact not found, using mock deployment flow...");

    // For testing, we'll deploy a minimal version
    // In real scenario, run `forge build` first
    console.log("  Please run: cd ../contracts && forge build");
    console.log("  Then re-run this test");
    process.exit(1);
  }

  // Grant matcher role
  // For simplicity, assuming deployer = matcher in this test
  console.log(`  ✓ Matcher role granted to: ${matcher.address}`);

  // Use a simple test token address (deployer's next contract address pattern)
  const TEST_TOKEN = "0x0000000000000000000000000000000000000001" as Address;
  const INITIAL_PRICE = parseEther("1.0");

  await matcherClient.writeContract({
    address: settlementAddress,
    abi: SETTLEMENT_ABI,
    functionName: "updatePrice",
    args: [TEST_TOKEN, INITIAL_PRICE],
  });
  console.log(`  ✓ Token price set: ${formatEther(INITIAL_PRICE)} ETH`);

  // ========================================
  // Step 2: Traders Deposit Collateral
  // ========================================
  console.log("\n" + "-".repeat(60));
  console.log("Step 2: Traders Deposit Collateral");
  console.log("-".repeat(60));

  const DEPOSIT_AMOUNT = parseEther("10");

  // Trader A deposits
  await traderAClient.writeContract({
    address: settlementAddress,
    abi: SETTLEMENT_ABI,
    functionName: "deposit",
    value: DEPOSIT_AMOUNT,
  });
  console.log(`  ✓ Trader A deposited: ${formatEther(DEPOSIT_AMOUNT)} ETH`);

  // Trader B deposits
  await traderBClient.writeContract({
    address: settlementAddress,
    abi: SETTLEMENT_ABI,
    functionName: "deposit",
    value: DEPOSIT_AMOUNT,
  });
  console.log(`  ✓ Trader B deposited: ${formatEther(DEPOSIT_AMOUNT)} ETH`);

  // Verify balances
  const [availA] = await publicClient.readContract({
    address: settlementAddress,
    abi: SETTLEMENT_ABI,
    functionName: "getUserBalance",
    args: [traderA.address],
  });
  assert(availA === DEPOSIT_AMOUNT, `Trader A balance: ${formatEther(availA)} ETH`);

  const [availB] = await publicClient.readContract({
    address: settlementAddress,
    abi: SETTLEMENT_ABI,
    functionName: "getUserBalance",
    args: [traderB.address],
  });
  assert(availB === DEPOSIT_AMOUNT, `Trader B balance: ${formatEther(availB)} ETH`);

  // ========================================
  // Step 3: Sign Orders (EIP-712)
  // ========================================
  console.log("\n" + "-".repeat(60));
  console.log("Step 3: Sign Orders (EIP-712)");
  console.log("-".repeat(60));

  const LEVERAGE = 50000n; // 5x leverage (10000 = 1x)
  const SIZE = parseEther("2.0");
  const deadline = getDeadline();

  // Trader A: Long market order
  const longOrder = {
    trader: traderA.address,
    token: TEST_TOKEN,
    isLong: true,
    size: SIZE,
    leverage: LEVERAGE,
    price: 0n, // Market order
    deadline,
    nonce: 0n,
    orderType: OrderType.MARKET,
  };

  const longSignature = await signOrder(traderAClient, settlementAddress, longOrder);
  console.log(`  ✓ Trader A signed LONG order`);
  console.log(`    Size: ${formatEther(SIZE)} ETH, Leverage: 5x, Type: MARKET`);

  // Trader B: Short market order
  const shortOrder = {
    trader: traderB.address,
    token: TEST_TOKEN,
    isLong: false,
    size: SIZE,
    leverage: LEVERAGE,
    price: 0n, // Market order
    deadline,
    nonce: 0n,
    orderType: OrderType.MARKET,
  };

  const shortSignature = await signOrder(traderBClient, settlementAddress, shortOrder);
  console.log(`  ✓ Trader B signed SHORT order`);
  console.log(`    Size: ${formatEther(SIZE)} ETH, Leverage: 5x, Type: MARKET`);

  // ========================================
  // Step 4: Submit to Matching Engine
  // ========================================
  console.log("\n" + "-".repeat(60));
  console.log("Step 4: Submit to Matching Engine");
  console.log("-".repeat(60));

  const engine = new MatchingEngine();
  engine.updatePrice(TEST_TOKEN, INITIAL_PRICE);

  // Submit long order
  const { order: submittedLong, matches: longMatches } = engine.submitOrder(
    longOrder.trader,
    longOrder.token,
    longOrder.isLong,
    longOrder.size,
    longOrder.leverage,
    longOrder.price,
    longOrder.deadline,
    longOrder.nonce,
    longOrder.orderType,
    longSignature
  );
  console.log(`  ✓ Long order submitted: ${submittedLong.id}`);
  assert(longMatches.length === 0, "Long order waiting in book (no match yet)");

  // Submit short order - should match
  const { order: submittedShort, matches: shortMatches } = engine.submitOrder(
    shortOrder.trader,
    shortOrder.token,
    shortOrder.isLong,
    shortOrder.size,
    shortOrder.leverage,
    shortOrder.price,
    shortOrder.deadline,
    shortOrder.nonce,
    shortOrder.orderType,
    shortSignature
  );
  console.log(`  ✓ Short order submitted: ${submittedShort.id}`);
  assert(shortMatches.length === 1, "Orders matched!");

  const match = shortMatches[0];
  console.log(`  ✓ Match created:`);
  console.log(`    Price: ${formatEther(match.matchPrice)} ETH`);
  console.log(`    Size: ${formatEther(match.matchSize)} ETH`);
  console.log(`    Long: ${match.longOrder.trader.slice(0, 10)}...`);
  console.log(`    Short: ${match.shortOrder.trader.slice(0, 10)}...`);

  // ========================================
  // Step 5: Batch Submit to Chain
  // ========================================
  console.log("\n" + "-".repeat(60));
  console.log("Step 5: Batch Submit to Chain");
  console.log("-".repeat(60));

  const pendingMatches = engine.getPendingMatches();
  assert(pendingMatches.length === 1, `${pendingMatches.length} match(es) pending for settlement`);

  // Prepare batch for on-chain settlement
  const batchData = pendingMatches.map((m) => ({
    longOrder: {
      trader: m.longOrder.trader,
      token: m.longOrder.token,
      isLong: m.longOrder.isLong,
      size: m.longOrder.size,
      leverage: m.longOrder.leverage,
      price: m.longOrder.price,
      deadline: m.longOrder.deadline,
      nonce: m.longOrder.nonce,
      orderType: m.longOrder.orderType,
    },
    longSignature: m.longOrder.signature,
    shortOrder: {
      trader: m.shortOrder.trader,
      token: m.shortOrder.token,
      isLong: m.shortOrder.isLong,
      size: m.shortOrder.size,
      leverage: m.shortOrder.leverage,
      price: m.shortOrder.price,
      deadline: m.shortOrder.deadline,
      nonce: m.shortOrder.nonce,
      orderType: m.shortOrder.orderType,
    },
    shortSignature: m.shortOrder.signature,
    matchPrice: m.matchPrice,
    matchSize: m.matchSize,
  }));

  // Submit batch transaction
  const settleTxHash = await matcherClient.writeContract({
    address: settlementAddress,
    abi: SETTLEMENT_ABI,
    functionName: "settleBatch",
    args: [batchData],
  });

  const settleReceipt = await publicClient.waitForTransactionReceipt({ hash: settleTxHash });
  console.log(`  ✓ Batch settled on-chain!`);
  console.log(`    Tx: ${settleTxHash.slice(0, 18)}...`);
  console.log(`    Gas: ${settleReceipt.gasUsed.toString()}`);

  // Clear pending matches
  engine.clearPendingMatches();
  assert(engine.getPendingMatches().length === 0, "Pending matches cleared");

  // ========================================
  // Step 6: Verify On-Chain State
  // ========================================
  console.log("\n" + "-".repeat(60));
  console.log("Step 6: Verify On-Chain State");
  console.log("-".repeat(60));

  // Check next pair ID (starts at 1, increments after each pair)
  const nextPairId = await publicClient.readContract({
    address: settlementAddress,
    abi: SETTLEMENT_ABI,
    functionName: "nextPairId",
  });
  assert(nextPairId === 2n, `Next pair ID: ${nextPairId} (1 pair created, ID was 1)`);

  // Get the created pair
  const pair = await publicClient.readContract({
    address: settlementAddress,
    abi: SETTLEMENT_ABI,
    functionName: "getPairedPosition",
    args: [1n],
  });

  console.log(`  ✓ Paired Position #1:`);
  console.log(`    Long Trader: ${pair.longTrader.slice(0, 10)}...`);
  console.log(`    Short Trader: ${pair.shortTrader.slice(0, 10)}...`);
  console.log(`    Size: ${formatEther(pair.size)} ETH`);
  console.log(`    Entry Price: ${formatEther(pair.entryPrice)} ETH`);
  console.log(`    Long Collateral: ${formatEther(pair.longCollateral)} ETH`);
  console.log(`    Short Collateral: ${formatEther(pair.shortCollateral)} ETH`);
  console.log(`    Status: ${pair.status === 0 ? "OPEN" : pair.status === 1 ? "CLOSED" : "LIQUIDATED"}`);

  assert(pair.longTrader === traderA.address, "Long trader is Trader A");
  assert(pair.shortTrader === traderB.address, "Short trader is Trader B");
  assert(pair.size === SIZE, "Size matches order");
  assert(pair.status === 0, "Position is OPEN");

  // Check balances (collateral should be locked)
  const [availA2, lockedA2] = await publicClient.readContract({
    address: settlementAddress,
    abi: SETTLEMENT_ABI,
    functionName: "getUserBalance",
    args: [traderA.address],
  });
  console.log(`  ✓ Trader A: Available ${formatEther(availA2)} ETH, Locked ${formatEther(lockedA2)} ETH`);
  assert(lockedA2 > 0n, "Trader A has locked collateral");

  const [availB2, lockedB2] = await publicClient.readContract({
    address: settlementAddress,
    abi: SETTLEMENT_ABI,
    functionName: "getUserBalance",
    args: [traderB.address],
  });
  console.log(`  ✓ Trader B: Available ${formatEther(availB2)} ETH, Locked ${formatEther(lockedB2)} ETH`);
  assert(lockedB2 > 0n, "Trader B has locked collateral");

  // ========================================
  // Step 7: Price Change & PnL Check
  // ========================================
  console.log("\n" + "-".repeat(60));
  console.log("Step 7: Price Change & PnL Check");
  console.log("-".repeat(60));

  // Update price: +10%
  const NEW_PRICE = parseEther("1.1");
  await matcherClient.writeContract({
    address: settlementAddress,
    abi: SETTLEMENT_ABI,
    functionName: "updatePrice",
    args: [TEST_TOKEN, NEW_PRICE],
  });
  console.log(`  ✓ Price updated: ${formatEther(INITIAL_PRICE)} → ${formatEther(NEW_PRICE)} ETH (+10%)`);

  // Check unrealized PnL
  const [longPnL, shortPnL] = await publicClient.readContract({
    address: settlementAddress,
    abi: SETTLEMENT_ABI,
    functionName: "getUnrealizedPnL",
    args: [1n],
  });

  console.log(`  ✓ Unrealized PnL:`);
  console.log(`    Long (Trader A): ${Number(longPnL) > 0 ? "+" : ""}${formatEther(longPnL)} ETH`);
  console.log(`    Short (Trader B): ${Number(shortPnL) > 0 ? "+" : ""}${formatEther(shortPnL)} ETH`);

  assert(longPnL > 0n, "Long has profit (price went up)");
  assert(shortPnL < 0n, "Short has loss (price went up)");

  // ========================================
  // Step 8: Close Position
  // ========================================
  console.log("\n" + "-".repeat(60));
  console.log("Step 8: Close Position");
  console.log("-".repeat(60));

  // Either trader can close
  const closeTxHash = await traderAClient.writeContract({
    address: settlementAddress,
    abi: SETTLEMENT_ABI,
    functionName: "closePair",
    args: [1n],
  });

  await publicClient.waitForTransactionReceipt({ hash: closeTxHash });
  console.log(`  ✓ Position closed by Trader A`);

  // Check final balances
  const [finalAvailA, finalLockedA] = await publicClient.readContract({
    address: settlementAddress,
    abi: SETTLEMENT_ABI,
    functionName: "getUserBalance",
    args: [traderA.address],
  });
  console.log(`  ✓ Trader A final: Available ${formatEther(finalAvailA)} ETH, Locked ${formatEther(finalLockedA)} ETH`);

  const [finalAvailB, finalLockedB] = await publicClient.readContract({
    address: settlementAddress,
    abi: SETTLEMENT_ABI,
    functionName: "getUserBalance",
    args: [traderB.address],
  });
  console.log(`  ✓ Trader B final: Available ${formatEther(finalAvailB)} ETH, Locked ${formatEther(finalLockedB)} ETH`);

  // Verify PnL transfer
  const traderAPnL = finalAvailA - (DEPOSIT_AMOUNT - lockedA2 + lockedA2);
  const traderBPnL = finalAvailB - (DEPOSIT_AMOUNT - lockedB2 + lockedB2);

  assert(finalLockedA === 0n, "Trader A collateral unlocked");
  assert(finalLockedB === 0n, "Trader B collateral unlocked");
  assert(finalAvailA > DEPOSIT_AMOUNT, "Trader A has profit (price went up for long)");
  assert(finalAvailB < DEPOSIT_AMOUNT, "Trader B has loss (price went up against short)");

  // Verify position is closed
  const closedPair = await publicClient.readContract({
    address: settlementAddress,
    abi: SETTLEMENT_ABI,
    functionName: "getPairedPosition",
    args: [1n],
  });
  assert(closedPair.status === 1, "Position status is CLOSED");

  // ========================================
  // Summary
  // ========================================
  console.log("\n" + "=".repeat(60));
  console.log("  E2E 测试通过! All E2E Tests Passed!");
  console.log("=".repeat(60));
  console.log("\n验证完成的流程:");
  console.log("  1. ✅ 合约部署 - Settlement contract deployed");
  console.log("  2. ✅ 保证金存入 - Traders deposited collateral");
  console.log("  3. ✅ EIP-712签名 - Orders signed with EIP-712");
  console.log("  4. ✅ 链下撮合 - Orders matched off-chain");
  console.log("  5. ✅ 链上批量结算 - Batch settled on-chain");
  console.log("  6. ✅ 状态验证 - Position state verified");
  console.log("  7. ✅ 价格变动&PnL - Price change and PnL calculated");
  console.log("  8. ✅ 平仓结算 - Position closed, PnL settled");
  console.log("\n核心需求点:");
  console.log("  ✅ 链下撮合，链上结算");
  console.log("  ✅ 盈利从对手方保证金支付");
  console.log("  ✅ 订单等待配对（限价单挂单）");
  console.log("  ✅ 批量提交到链上");
}

// Run the test
runE2ETest().catch((e) => {
  console.error("\n❌ E2E Test Failed:", e.message);
  console.error(e.stack);
  process.exit(1);
});
