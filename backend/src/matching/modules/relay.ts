/**
 * Relay Service Module
 *
 * Implements meta-transaction relay service for gasless deposits and withdrawals.
 * Users sign EIP-712 messages, and the relayer submits transactions on-chain.
 *
 * Supported operations:
 * - depositFor() - ERC20 token deposits via meta-tx
 * - depositETHFor() - ETH deposits via meta-tx (auto-wrapped to WETH)
 * - withdrawFor() - Token withdrawals via meta-tx
 */

import { createWalletClient, createPublicClient, http, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { baseSepolia } from "viem/chains";
import db from "../database";

// Get Redis client
const redis = db.getClient();

// ============================================================
// Configuration
// ============================================================

const RPC_URL = process.env.BASE_SEPOLIA_RPC || "https://sepolia.base.org";
const RELAYER_PRIVATE_KEY = process.env.RELAYER_PRIVATE_KEY as Hex;
const SETTLEMENT_ADDRESS = process.env.SETTLEMENT_ADDRESS as Address;

if (!RELAYER_PRIVATE_KEY) {
  console.warn("[Relay] ⚠️  RELAYER_PRIVATE_KEY not set - relay service disabled");
}

if (!SETTLEMENT_ADDRESS) {
  console.warn("[Relay] ⚠️  SETTLEMENT_ADDRESS not set - relay service disabled");
}

// Create relayer account
const relayerAccount = RELAYER_PRIVATE_KEY ? privateKeyToAccount(RELAYER_PRIVATE_KEY) : null;

// Create clients
const publicClient = createPublicClient({
  chain: baseSepolia,
  transport: http(RPC_URL),
});

const walletClient = relayerAccount
  ? createWalletClient({
      account: relayerAccount,
      chain: baseSepolia,
      transport: http(RPC_URL),
    })
  : null;

// Settlement ABI (only the functions we need)
const SETTLEMENT_ABI = [
  {
    name: "depositFor",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "user", type: "address" },
      { name: "token", type: "address" },
      { name: "amount", type: "uint256" },
      { name: "deadline", type: "uint256" },
      { name: "signature", type: "bytes" },
    ],
    outputs: [],
  },
  {
    name: "depositETHFor",
    type: "function",
    stateMutability: "payable",
    inputs: [
      { name: "user", type: "address" },
      { name: "amount", type: "uint256" },
      { name: "deadline", type: "uint256" },
      { name: "signature", type: "bytes" },
    ],
    outputs: [],
  },
  {
    name: "withdrawFor",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "user", type: "address" },
      { name: "token", type: "address" },
      { name: "amount", type: "uint256" },
      { name: "deadline", type: "uint256" },
      { name: "signature", type: "bytes" },
    ],
    outputs: [],
  },
  {
    name: "getMetaTxNonce",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "user", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    name: "balances",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "user", type: "address" }],
    outputs: [
      { name: "available", type: "uint256" },
      { name: "reserved", type: "uint256" },
    ],
  },
] as const;

// ============================================================
// Types
// ============================================================

export interface DepositRequest {
  user: Address;
  token: Address;
  amount: string;
  deadline: number;
  signature: Hex;
}

export interface DepositETHRequest {
  user: Address;
  amount: string;
  deadline: number;
  signature: Hex;
}

export interface WithdrawRequest {
  user: Address;
  token: Address;
  amount: string;
  deadline: number;
  signature: Hex;
}

export interface RelayResult {
  success: boolean;
  txHash?: Hex;
  error?: string;
}

export interface RelayerStatus {
  enabled: boolean;
  address?: Address;
  balance?: string;
  settlementAddress?: Address;
}

// ============================================================
// Constants
// ============================================================

const MIN_RELAYER_BALANCE = BigInt(1e17); // 0.1 ETH minimum
const GAS_BUFFER = BigInt(1e16); // 0.01 ETH buffer for gas

// ============================================================
// Relayer Service Functions
// ============================================================

/**
 * Check if relay service is enabled
 */
export function isRelayEnabled(): boolean {
  return !!(RELAYER_PRIVATE_KEY && SETTLEMENT_ADDRESS && walletClient);
}

/**
 * Get relayer status
 */
export async function getRelayerStatus(): Promise<RelayerStatus> {
  if (!isRelayEnabled() || !relayerAccount) {
    return { enabled: false };
  }

  try {
    const balance = await publicClient.getBalance({
      address: relayerAccount.address,
    });

    return {
      enabled: true,
      address: relayerAccount.address,
      balance: balance.toString(),
      settlementAddress: SETTLEMENT_ADDRESS,
    };
  } catch (error) {
    console.error("[Relay] Failed to get relayer status:", error);
    return {
      enabled: true,
      address: relayerAccount.address,
      balance: "0",
      settlementAddress: SETTLEMENT_ADDRESS,
    };
  }
}

/**
 * Get user's meta-tx nonce from Settlement contract
 */
export async function getMetaTxNonce(user: Address): Promise<bigint> {
  if (!SETTLEMENT_ADDRESS) {
    throw new Error("Settlement address not configured");
  }

  try {
    const nonce = await publicClient.readContract({
      address: SETTLEMENT_ADDRESS,
      abi: SETTLEMENT_ABI,
      functionName: "getMetaTxNonce",
      args: [user],
    });

    return nonce;
  } catch (error) {
    console.error("[Relay] Failed to get nonce for", user, error);
    throw error;
  }
}

/**
 * Get user balance from Settlement contract
 */
export async function getUserBalance(
  user: Address
): Promise<{ available: bigint; reserved: bigint }> {
  if (!SETTLEMENT_ADDRESS) {
    throw new Error("Settlement address not configured");
  }

  try {
    const result = await publicClient.readContract({
      address: SETTLEMENT_ADDRESS,
      abi: SETTLEMENT_ABI,
      functionName: "balances",
      args: [user],
    });

    return {
      available: result[0],
      reserved: result[1],
    };
  } catch (error) {
    console.error("[Relay] Failed to get balance for", user, error);
    throw error;
  }
}

/**
 * Execute depositFor meta-transaction
 */
export async function relayDeposit(request: DepositRequest): Promise<RelayResult> {
  if (!isRelayEnabled() || !walletClient) {
    return {
      success: false,
      error: "Relay service not enabled",
    };
  }

  try {
    // Validate deadline
    const now = Math.floor(Date.now() / 1000);
    if (request.deadline < now) {
      return {
        success: false,
        error: "Deadline expired",
      };
    }

    // Check relayer balance
    const balance = await publicClient.getBalance({
      address: relayerAccount!.address,
    });

    if (balance < MIN_RELAYER_BALANCE) {
      console.error(
        `[Relay] Insufficient relayer balance: ${balance} < ${MIN_RELAYER_BALANCE}`
      );
      return {
        success: false,
        error: "Relayer insufficient balance",
      };
    }

    // Execute depositFor
    console.log(`[Relay] Depositing ${request.amount} ${request.token} for ${request.user}`);

    const hash = await walletClient.writeContract({
      address: SETTLEMENT_ADDRESS!,
      abi: SETTLEMENT_ABI,
      functionName: "depositFor",
      args: [
        request.user,
        request.token,
        BigInt(request.amount),
        BigInt(request.deadline),
        request.signature,
      ],
    });

    console.log(`[Relay] ✅ Deposit tx submitted: ${hash}`);

    // Wait for confirmation
    const receipt = await publicClient.waitForTransactionReceipt({ hash });

    if (receipt.status === "success") {
      console.log(`[Relay] ✅ Deposit confirmed: ${hash}`);
      return {
        success: true,
        txHash: hash,
      };
    } else {
      console.error(`[Relay] ❌ Deposit failed: ${hash}`);
      return {
        success: false,
        error: "Transaction failed",
      };
    }
  } catch (error) {
    console.error("[Relay] Deposit error:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

/**
 * Execute depositETHFor meta-transaction
 */
export async function relayDepositETH(request: DepositETHRequest): Promise<RelayResult> {
  if (!isRelayEnabled() || !walletClient) {
    return {
      success: false,
      error: "Relay service not enabled",
    };
  }

  try {
    // Validate deadline
    const now = Math.floor(Date.now() / 1000);
    if (request.deadline < now) {
      return {
        success: false,
        error: "Deadline expired",
      };
    }

    const amount = BigInt(request.amount);

    // Check relayer balance (needs ETH for both the deposit and gas)
    const balance = await publicClient.getBalance({
      address: relayerAccount!.address,
    });

    const required = amount + GAS_BUFFER;
    if (balance < required) {
      console.error(
        `[Relay] Insufficient relayer balance: ${balance} < ${required} (amount: ${amount} + gas buffer: ${GAS_BUFFER})`
      );
      return {
        success: false,
        error: `Relayer insufficient balance. Has: ${balance}, needs: ${required}`,
      };
    }

    // Execute depositETHFor
    console.log(`[Relay] Depositing ${request.amount} ETH for ${request.user}`);

    const hash = await walletClient.writeContract({
      address: SETTLEMENT_ADDRESS!,
      abi: SETTLEMENT_ABI,
      functionName: "depositETHFor",
      args: [request.user, amount, BigInt(request.deadline), request.signature],
      value: amount,
    });

    console.log(`[Relay] ✅ DepositETH tx submitted: ${hash}`);

    // Wait for confirmation
    const receipt = await publicClient.waitForTransactionReceipt({ hash });

    if (receipt.status === "success") {
      console.log(`[Relay] ✅ DepositETH confirmed: ${hash}`);
      return {
        success: true,
        txHash: hash,
      };
    } else {
      console.error(`[Relay] ❌ DepositETH failed: ${hash}`);
      return {
        success: false,
        error: "Transaction failed",
      };
    }
  } catch (error) {
    console.error("[Relay] DepositETH error:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

/**
 * Execute withdrawFor meta-transaction
 */
export async function relayWithdraw(request: WithdrawRequest): Promise<RelayResult> {
  if (!isRelayEnabled() || !walletClient) {
    return {
      success: false,
      error: "Relay service not enabled",
    };
  }

  try {
    // Validate deadline
    const now = Math.floor(Date.now() / 1000);
    if (request.deadline < now) {
      return {
        success: false,
        error: "Deadline expired",
      };
    }

    // Check relayer balance
    const balance = await publicClient.getBalance({
      address: relayerAccount!.address,
    });

    if (balance < MIN_RELAYER_BALANCE) {
      console.error(
        `[Relay] Insufficient relayer balance: ${balance} < ${MIN_RELAYER_BALANCE}`
      );
      return {
        success: false,
        error: "Relayer insufficient balance",
      };
    }

    // Execute withdrawFor
    console.log(`[Relay] Withdrawing ${request.amount} ${request.token} for ${request.user}`);

    const hash = await walletClient.writeContract({
      address: SETTLEMENT_ADDRESS!,
      abi: SETTLEMENT_ABI,
      functionName: "withdrawFor",
      args: [
        request.user,
        request.token,
        BigInt(request.amount),
        BigInt(request.deadline),
        request.signature,
      ],
    });

    console.log(`[Relay] ✅ Withdraw tx submitted: ${hash}`);

    // Wait for confirmation
    const receipt = await publicClient.waitForTransactionReceipt({ hash });

    if (receipt.status === "success") {
      console.log(`[Relay] ✅ Withdraw confirmed: ${hash}`);
      return {
        success: true,
        txHash: hash,
      };
    } else {
      console.error(`[Relay] ❌ Withdraw failed: ${hash}`);
      return {
        success: false,
        error: "Transaction failed",
      };
    }
  } catch (error) {
    console.error("[Relay] Withdraw error:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

// ============================================================
// Helper Functions
// ============================================================

/**
 * Format ETH amount for display
 */
export function formatETH(wei: bigint): string {
  const eth = Number(wei) / 1e18;
  return eth.toFixed(4);
}

/**
 * Log relay service status on startup
 */
export function logRelayStatus(): void {
  if (isRelayEnabled() && relayerAccount) {
    console.log("[Relay] ✅ Relay service enabled");
    console.log(`[Relay] Relayer address: ${relayerAccount.address}`);
    console.log(`[Relay] Settlement address: ${SETTLEMENT_ADDRESS}`);
  } else {
    console.log("[Relay] ⚠️  Relay service disabled (missing configuration)");
  }
}
