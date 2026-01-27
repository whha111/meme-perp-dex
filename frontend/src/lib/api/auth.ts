/**
 * Authentication utilities for the perpetual DEX API
 * Handles wallet-based login and API request signing
 */

import { createHmac } from "crypto";

// API credentials storage key
const CREDENTIALS_KEY = "memeperp_api_credentials";

// API credentials interface
export interface APICredentials {
  apiKey: string;
  apiSecret: string;
  address: string;
  expiresAt: number;
}

/**
 * Get stored API credentials
 */
export function getStoredCredentials(): APICredentials | null {
  if (typeof window === "undefined") return null;

  try {
    const stored = localStorage.getItem(CREDENTIALS_KEY);
    if (!stored) return null;

    const credentials = JSON.parse(stored) as APICredentials;

    // Check if expired
    if (Date.now() > credentials.expiresAt * 1000) {
      localStorage.removeItem(CREDENTIALS_KEY);
      return null;
    }

    return credentials;
  } catch {
    return null;
  }
}

/**
 * Store API credentials
 */
export function storeCredentials(credentials: APICredentials): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(CREDENTIALS_KEY, JSON.stringify(credentials));
}

/**
 * Clear stored credentials
 */
export function clearCredentials(): void {
  if (typeof window === "undefined") return;
  localStorage.removeItem(CREDENTIALS_KEY);
}

/**
 * Check if user is authenticated
 */
export function isAuthenticated(): boolean {
  return getStoredCredentials() !== null;
}

/**
 * Generate HMAC-SHA256 signature for API request
 * @param secret - API secret
 * @param timestamp - Request timestamp in milliseconds
 * @param method - HTTP method (GET, POST, etc.)
 * @param path - Request path including query string
 * @param body - Request body (for POST/PUT requests)
 */
export function generateSignature(
  secret: string,
  timestamp: string,
  method: string,
  path: string,
  body: string = ""
): string {
  const message = timestamp + method.toUpperCase() + path + body;

  // Use Web Crypto API for browser environment
  if (typeof window !== "undefined" && window.crypto && window.crypto.subtle) {
    // For browser, we need to use a sync approach
    // Convert to base64 using a simple HMAC implementation
    return hmacSHA256Base64(secret, message);
  }

  // For Node.js environment
  const hmac = createHmac("sha256", secret);
  hmac.update(message);
  return hmac.digest("base64");
}

/**
 * Simple HMAC-SHA256 implementation for browser
 * Returns base64 encoded result
 */
function hmacSHA256Base64(key: string, message: string): string {
  // Convert strings to Uint8Array
  const encoder = new TextEncoder();
  const keyData = encoder.encode(key);
  const messageData = encoder.encode(message);

  // Compute HMAC-SHA256 synchronously using a simplified approach
  // Note: This is a simplified implementation - in production, use Web Crypto API with async
  const blockSize = 64;
  let keyBytes = keyData;

  // If key is longer than block size, hash it
  if (keyBytes.length > blockSize) {
    keyBytes = new Uint8Array(sha256(keyBytes));
  }

  // Pad key to block size
  const paddedKey = new Uint8Array(blockSize);
  paddedKey.set(keyBytes);

  // Create inner and outer padding
  const innerPad = new Uint8Array(blockSize);
  const outerPad = new Uint8Array(blockSize);
  for (let i = 0; i < blockSize; i++) {
    innerPad[i] = paddedKey[i] ^ 0x36;
    outerPad[i] = paddedKey[i] ^ 0x5c;
  }

  // Inner hash: SHA256(innerPad + message)
  const innerData = new Uint8Array(blockSize + messageData.length);
  innerData.set(innerPad);
  innerData.set(messageData, blockSize);
  const innerHash = sha256(innerData);

  // Outer hash: SHA256(outerPad + innerHash)
  const outerData = new Uint8Array(blockSize + 32);
  outerData.set(outerPad);
  outerData.set(innerHash, blockSize);
  const result = sha256(outerData);

  // Convert to base64
  return btoa(String.fromCharCode(...result));
}

/**
 * Simple SHA-256 implementation
 * Note: This is for demonstration - in production, use Web Crypto API
 */
function sha256(data: Uint8Array): Uint8Array {
  // SHA-256 constants
  const K = new Uint32Array([
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1,
    0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3,
    0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786,
    0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147,
    0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
    0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b,
    0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a,
    0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
    0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
  ]);

  // Initial hash values
  let H = new Uint32Array([
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c,
    0x1f83d9ab, 0x5be0cd19,
  ]);

  // Pre-processing: adding padding bits
  const msgLen = data.length;
  const bitLen = msgLen * 8;
  const padLen = ((msgLen + 8) % 64 <= 56 ? 56 : 120) - ((msgLen + 8) % 64);
  const paddedLen = msgLen + 1 + padLen + 8;

  const padded = new Uint8Array(paddedLen);
  padded.set(data);
  padded[msgLen] = 0x80;

  // Append length in bits as 64-bit big-endian
  const view = new DataView(padded.buffer);
  view.setUint32(paddedLen - 4, bitLen, false);

  // Process each 64-byte chunk
  const W = new Uint32Array(64);
  for (let i = 0; i < paddedLen; i += 64) {
    // Copy chunk into first 16 words
    for (let j = 0; j < 16; j++) {
      W[j] =
        (padded[i + j * 4] << 24) |
        (padded[i + j * 4 + 1] << 16) |
        (padded[i + j * 4 + 2] << 8) |
        padded[i + j * 4 + 3];
    }

    // Extend to 64 words
    for (let j = 16; j < 64; j++) {
      const s0 =
        ((W[j - 15] >>> 7) | (W[j - 15] << 25)) ^
        ((W[j - 15] >>> 18) | (W[j - 15] << 14)) ^
        (W[j - 15] >>> 3);
      const s1 =
        ((W[j - 2] >>> 17) | (W[j - 2] << 15)) ^
        ((W[j - 2] >>> 19) | (W[j - 2] << 13)) ^
        (W[j - 2] >>> 10);
      W[j] = (W[j - 16] + s0 + W[j - 7] + s1) >>> 0;
    }

    // Initialize working variables
    let [a, b, c, d, e, f, g, h] = H;

    // Compression function
    for (let j = 0; j < 64; j++) {
      const S1 =
        ((e >>> 6) | (e << 26)) ^
        ((e >>> 11) | (e << 21)) ^
        ((e >>> 25) | (e << 7));
      const ch = (e & f) ^ (~e & g);
      const temp1 = (h + S1 + ch + K[j] + W[j]) >>> 0;
      const S0 =
        ((a >>> 2) | (a << 30)) ^
        ((a >>> 13) | (a << 19)) ^
        ((a >>> 22) | (a << 10));
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const temp2 = (S0 + maj) >>> 0;

      h = g;
      g = f;
      f = e;
      e = (d + temp1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (temp1 + temp2) >>> 0;
    }

    // Add compressed chunk to hash value
    H[0] = (H[0] + a) >>> 0;
    H[1] = (H[1] + b) >>> 0;
    H[2] = (H[2] + c) >>> 0;
    H[3] = (H[3] + d) >>> 0;
    H[4] = (H[4] + e) >>> 0;
    H[5] = (H[5] + f) >>> 0;
    H[6] = (H[6] + g) >>> 0;
    H[7] = (H[7] + h) >>> 0;
  }

  // Produce final hash value
  const result = new Uint8Array(32);
  for (let i = 0; i < 8; i++) {
    result[i * 4] = (H[i] >>> 24) & 0xff;
    result[i * 4 + 1] = (H[i] >>> 16) & 0xff;
    result[i * 4 + 2] = (H[i] >>> 8) & 0xff;
    result[i * 4 + 3] = H[i] & 0xff;
  }

  return result;
}

/**
 * Create authentication headers for API request
 */
export function createAuthHeaders(
  method: string,
  path: string,
  body?: string
): Record<string, string> {
  const credentials = getStoredCredentials();
  if (!credentials) {
    throw new Error("Not authenticated");
  }

  const timestamp = Date.now().toString();
  const signature = generateSignature(
    credentials.apiSecret,
    timestamp,
    method,
    path,
    body || ""
  );

  return {
    "X-MBX-APIKEY": credentials.apiKey,
    "X-MBX-SIGNATURE": signature,
    "X-MBX-TIMESTAMP": timestamp,
  };
}

/**
 * Login flow result
 */
export interface LoginResult {
  success: boolean;
  credentials?: APICredentials;
  error?: string;
}

/**
 * Perform login with wallet signature
 * @param address - Wallet address
 * @param signMessage - Function to sign message with wallet
 * @param apiBaseUrl - Base URL for API
 */
export async function loginWithWallet(
  address: string,
  signMessage: (message: string) => Promise<string>,
  apiBaseUrl: string
): Promise<LoginResult> {
  try {
    // Step 1: Get nonce
    const nonceResponse = await fetch(`${apiBaseUrl}/api/v1/auth/nonce`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ address }),
    });

    if (!nonceResponse.ok) {
      const error = await nonceResponse.json();
      return { success: false, error: error.msg || "Failed to get nonce" };
    }

    const nonceData = await nonceResponse.json();
    if (nonceData.code !== "0") {
      return { success: false, error: nonceData.msg };
    }

    const { nonce, message } = nonceData.data;

    // Step 2: Sign message with wallet
    let signature: string;
    try {
      signature = await signMessage(message);
    } catch (err) {
      return {
        success: false,
        error: "User rejected signature request",
      };
    }

    // Step 3: Login with signature
    const loginResponse = await fetch(`${apiBaseUrl}/api/v1/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ address, signature, nonce }),
    });

    if (!loginResponse.ok) {
      const error = await loginResponse.json();
      return { success: false, error: error.msg || "Login failed" };
    }

    const loginData = await loginResponse.json();
    if (loginData.code !== "0") {
      return { success: false, error: loginData.msg };
    }

    // Step 4: Store credentials
    const credentials: APICredentials = {
      apiKey: loginData.data.apiKey,
      apiSecret: loginData.data.apiSecret,
      address: loginData.data.address,
      expiresAt: loginData.data.expiresAt,
    };

    storeCredentials(credentials);

    return { success: true, credentials };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

/**
 * Logout - clear stored credentials
 */
export function logout(): void {
  clearCredentials();
}
