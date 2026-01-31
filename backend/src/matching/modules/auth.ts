/**
 * Authentication Module
 *
 * Handles wallet-based authentication and API key management
 * - Nonce generation for signature verification
 * - EIP-191 signature verification
 * - API key/secret generation
 * - HMAC-SHA256 request signature verification
 */

import { randomBytes, createHmac } from "crypto";
import { verifyMessage, type Address, type Hex } from "viem";
import db from "../database";

// Get Redis client
const redis = db.getClient();

// ============================================================
// Types
// ============================================================

export interface APICredentials {
  apiKey: string;
  apiSecret: string;
  address: Address;
  expiresAt: number; // Unix timestamp in seconds
}

interface NonceData {
  nonce: string;
  message: string;
  createdAt: number; // Unix timestamp in milliseconds
  expiresAt: number; // Unix timestamp in milliseconds
}

// ============================================================
// Constants
// ============================================================

const NONCE_EXPIRY_MS = 5 * 60 * 1000; // 5 minutes
const API_KEY_EXPIRY_SECONDS = 30 * 24 * 60 * 60; // 30 days
const SIGNATURE_TIMESTAMP_WINDOW_MS = 5 * 60 * 1000; // 5 minutes

// Redis keys
const NONCE_PREFIX = "auth:nonce:";
const API_KEY_PREFIX = "auth:apikey:";

// ============================================================
// Nonce Management
// ============================================================

/**
 * Generate a random nonce for signature verification
 */
function generateNonce(): string {
  return randomBytes(32).toString("hex");
}

/**
 * Create login message for wallet signature
 */
function createLoginMessage(address: Address, nonce: string): string {
  return `Welcome to Meme Perp DEX!

Click to sign in and accept the Terms of Service.

This request will not trigger a blockchain transaction or cost any gas fees.

Wallet address:
${address.toLowerCase()}

Nonce:
${nonce}`;
}

/**
 * Store nonce in Redis with expiry
 */
async function storeNonce(address: Address, nonce: string, message: string): Promise<void> {
  const key = `${NONCE_PREFIX}${address.toLowerCase()}`;
  const data: NonceData = {
    nonce,
    message,
    createdAt: Date.now(),
    expiresAt: Date.now() + NONCE_EXPIRY_MS,
  };

  await redis.setex(key, Math.ceil(NONCE_EXPIRY_MS / 1000), JSON.stringify(data));
}

/**
 * Retrieve and validate nonce from Redis
 */
async function retrieveNonce(address: Address): Promise<NonceData | null> {
  const key = `${NONCE_PREFIX}${address.toLowerCase()}`;
  const data = await redis.get(key);

  if (!data) return null;

  const nonceData: NonceData = JSON.parse(data);

  // Check if expired
  if (Date.now() > nonceData.expiresAt) {
    await redis.del(key);
    return null;
  }

  return nonceData;
}

/**
 * Delete nonce after use (prevents replay attacks)
 */
async function deleteNonce(address: Address): Promise<void> {
  const key = `${NONCE_PREFIX}${address.toLowerCase()}`;
  await redis.del(key);
}

// ============================================================
// API Key Management
// ============================================================

/**
 * Generate API key and secret
 */
function generateAPICredentials(): { apiKey: string; apiSecret: string } {
  const apiKey = `mk_${randomBytes(16).toString("hex")}`;  // mk = meme key
  const apiSecret = randomBytes(32).toString("hex");
  return { apiKey, apiSecret };
}

/**
 * Store API credentials in Redis
 */
async function storeAPICredentials(credentials: APICredentials): Promise<void> {
  const key = `${API_KEY_PREFIX}${credentials.apiKey}`;
  await redis.setex(
    key,
    API_KEY_EXPIRY_SECONDS,
    JSON.stringify(credentials)
  );
}

/**
 * Retrieve API credentials by API key
 */
async function getAPICredentials(apiKey: string): Promise<APICredentials | null> {
  const key = `${API_KEY_PREFIX}${apiKey}`;
  const data = await redis.get(key);

  if (!data) return null;

  const credentials: APICredentials = JSON.parse(data);

  // Check if expired
  if (Date.now() / 1000 > credentials.expiresAt) {
    await redis.del(key);
    return null;
  }

  return credentials;
}

/**
 * Revoke API credentials
 */
async function revokeAPICredentials(apiKey: string): Promise<void> {
  const key = `${API_KEY_PREFIX}${apiKey}`;
  await redis.del(key);
}

// ============================================================
// Public API
// ============================================================

/**
 * Generate nonce for login
 * Returns nonce and message to be signed
 */
export async function generateLoginNonce(address: Address): Promise<{ nonce: string; message: string }> {
  const nonce = generateNonce();
  const message = createLoginMessage(address, nonce);

  await storeNonce(address, nonce, message);

  return { nonce, message };
}

/**
 * Verify wallet signature and issue API credentials
 *
 * @param address - Wallet address
 * @param signature - Wallet signature (EIP-191)
 * @param nonce - Nonce from generateLoginNonce
 * @returns API credentials if valid, null otherwise
 */
export async function verifySignatureAndLogin(
  address: Address,
  signature: Hex,
  nonce: string
): Promise<APICredentials | null> {
  // Retrieve stored nonce
  const nonceData = await retrieveNonce(address);

  if (!nonceData) {
    console.error("[Auth] Nonce not found or expired for address:", address);
    return null;
  }

  // Verify nonce matches
  if (nonceData.nonce !== nonce) {
    console.error("[Auth] Nonce mismatch");
    return null;
  }

  // Verify signature
  try {
    const isValid = await verifyMessage({
      address,
      message: nonceData.message,
      signature,
    });

    if (!isValid) {
      console.error("[Auth] Invalid signature");
      return null;
    }
  } catch (error) {
    console.error("[Auth] Signature verification error:", error);
    return null;
  }

  // Delete nonce to prevent reuse
  await deleteNonce(address);

  // Generate API credentials
  const { apiKey, apiSecret } = generateAPICredentials();
  const expiresAt = Math.floor(Date.now() / 1000) + API_KEY_EXPIRY_SECONDS;

  const credentials: APICredentials = {
    apiKey,
    apiSecret,
    address,
    expiresAt,
  };

  // Store credentials
  await storeAPICredentials(credentials);

  console.log("[Auth] Login successful for address:", address);

  return credentials;
}

/**
 * Verify HMAC-SHA256 signature for API request
 *
 * Message format: timestamp + method + path + body
 *
 * @param apiKey - API key from X-MBX-APIKEY header
 * @param signature - Base64 signature from X-MBX-SIGNATURE header
 * @param timestamp - Timestamp from X-MBX-TIMESTAMP header
 * @param method - HTTP method (GET, POST, etc.)
 * @param path - Request path including query string
 * @param body - Request body (empty string for GET)
 * @returns true if valid, false otherwise
 */
export async function verifyAPISignature(
  apiKey: string,
  signature: string,
  timestamp: string,
  method: string,
  path: string,
  body: string = ""
): Promise<{ valid: boolean; address?: Address; error?: string }> {
  // Retrieve API credentials
  const credentials = await getAPICredentials(apiKey);

  if (!credentials) {
    return { valid: false, error: "Invalid or expired API key" };
  }

  // Verify timestamp is within acceptable window
  const requestTime = parseInt(timestamp);
  const now = Date.now();
  const timeDiff = Math.abs(now - requestTime);

  if (timeDiff > SIGNATURE_TIMESTAMP_WINDOW_MS) {
    return { valid: false, error: "Request timestamp out of acceptable range" };
  }

  // Generate expected signature
  const message = timestamp + method.toUpperCase() + path + body;
  const hmac = createHmac("sha256", credentials.apiSecret);
  hmac.update(message);
  const expectedSignature = hmac.digest("base64");

  // Compare signatures (constant-time comparison to prevent timing attacks)
  const signaturesMatch = constantTimeCompare(signature, expectedSignature);

  if (!signaturesMatch) {
    return { valid: false, error: "Invalid signature" };
  }

  return { valid: true, address: credentials.address };
}

/**
 * Constant-time string comparison to prevent timing attacks
 */
function constantTimeCompare(a: string, b: string): boolean {
  if (a.length !== b.length) {
    return false;
  }

  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }

  return result === 0;
}

/**
 * Logout - revoke API credentials
 */
export async function logout(apiKey: string): Promise<void> {
  await revokeAPICredentials(apiKey);
  console.log("[Auth] Logout successful for API key:", apiKey);
}
