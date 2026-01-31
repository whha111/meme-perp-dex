/**
 * Test script for authentication module
 */

import { generateLoginNonce, verifySignatureAndLogin } from "./modules/auth";
import { createWalletClient, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { baseSepolia } from "viem/chains";
import db from "./database";

const TEST_PRIVATE_KEY = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80" as `0x${string}`;

async function testAuth() {
  console.log("🧪 Testing Authentication Module\n");

  // Connect to Redis
  await db.connect();
  console.log("✅ Connected to Redis\n");

  // Create test account
  const account = privateKeyToAccount(TEST_PRIVATE_KEY);
  const walletClient = createWalletClient({
    account,
    chain: baseSepolia,
    transport: http(),
  });

  console.log("👤 Test Address:", account.address);
  console.log("");

  // Step 1: Generate nonce
  console.log("Step 1: Generate login nonce");
  const { nonce, message } = await generateLoginNonce(account.address);
  console.log("  Nonce:", nonce);
  console.log("  Message:", message.substring(0, 100) + "...");
  console.log("");

  // Step 2: Sign message
  console.log("Step 2: Sign message with wallet");
  const signature = await walletClient.signMessage({
    message,
  });
  console.log("  Signature:", signature.substring(0, 50) + "...");
  console.log("");

  // Step 3: Verify and login
  console.log("Step 3: Verify signature and login");
  const credentials = await verifySignatureAndLogin(
    account.address,
    signature,
    nonce
  );

  if (!credentials) {
    console.error("❌ Login failed!");
    process.exit(1);
  }

  console.log("✅ Login successful!");
  console.log("  API Key:", credentials.apiKey);
  console.log("  API Secret:", credentials.apiSecret.substring(0, 20) + "...");
  console.log("  Address:", credentials.address);
  console.log("  Expires At:", new Date(credentials.expiresAt * 1000).toISOString());
  console.log("");

  // Step 4: Test HMAC signature verification
  console.log("Step 4: Test HMAC signature verification");
  const { verifyAPISignature } = await import("./modules/auth");

  const timestamp = Date.now().toString();
  const method = "GET";
  const path = "/api/user/" + account.address + "/positions";
  const body = "";

  // Generate HMAC signature
  const { createHmac } = await import("crypto");
  const hmacMessage = timestamp + method.toUpperCase() + path + body;
  const hmac = createHmac("sha256", credentials.apiSecret);
  hmac.update(hmacMessage);
  const hmacSignature = hmac.digest("base64");

  console.log("  Timestamp:", timestamp);
  console.log("  Method:", method);
  console.log("  Path:", path);
  console.log("  HMAC Signature:", hmacSignature.substring(0, 30) + "...");
  console.log("");

  const verifyResult = await verifyAPISignature(
    credentials.apiKey,
    hmacSignature,
    timestamp,
    method,
    path,
    body
  );

  if (!verifyResult.valid) {
    console.error("❌ HMAC verification failed:", verifyResult.error);
    process.exit(1);
  }

  console.log("✅ HMAC verification successful!");
  console.log("  Verified Address:", verifyResult.address);
  console.log("");

  // Test with invalid signature
  console.log("Step 5: Test with invalid HMAC signature");
  const invalidResult = await verifyAPISignature(
    credentials.apiKey,
    "invalid_signature",
    timestamp,
    method,
    path,
    body
  );

  if (invalidResult.valid) {
    console.error("❌ Should have failed with invalid signature!");
    process.exit(1);
  }

  console.log("✅ Correctly rejected invalid signature");
  console.log("  Error:", invalidResult.error);
  console.log("");

  // Cleanup
  await db.disconnect();
  console.log("✅ All authentication tests passed! 🎉");
}

testAuth().catch(console.error);
