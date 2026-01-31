/**
 * Test script for Token Metadata module
 */

import {
  saveTokenMetadata,
  getTokenMetadata,
  getAllTokenMetadata,
  deleteTokenMetadata,
  searchTokens,
  getTokensByCreator,
  type CreateTokenMetadataRequest,
} from "./modules/tokenMetadata";
import db from "./database";

async function testTokenMetadata() {
  console.log("🧪 Testing Token Metadata Module\n");

  // Connect to Redis
  await db.connect();
  console.log("✅ Connected to Redis\n");

  try {
    // Test 1: Save token metadata
    console.log("Test 1: Save token metadata");
    const tokenData: CreateTokenMetadataRequest = {
      instId: "PEPE-USDT",
      tokenAddress: "0x1234567890123456789012345678901234567890",
      name: "Pepe Token",
      symbol: "PEPE",
      description: "The best meme token on Base!",
      logoUrl: "https://example.com/pepe-logo.png",
      imageUrl: "https://example.com/pepe-image.png",
      website: "https://pepe.com",
      twitter: "@pepecoin",
      telegram: "https://t.me/pepecoin",
      discord: "https://discord.gg/pepe",
      creatorAddress: "0xabcdefabcdefabcdefabcdefabcdefabcdefabcd",
      totalSupply: "1000000000000000000000000000", // 1 billion
      initialBuyAmount: "1000000000000000000", // 1 ETH
    };

    const saved = await saveTokenMetadata(tokenData);
    console.log("  Saved:", {
      instId: saved.instId,
      symbol: saved.symbol,
      name: saved.name,
      creatorAddress: saved.creatorAddress,
    });
    console.log("");

    // Test 2: Get token metadata
    console.log("Test 2: Get token metadata by instId");
    const retrieved = await getTokenMetadata("PEPE-USDT");
    if (!retrieved) {
      throw new Error("Failed to retrieve token metadata");
    }
    console.log("  Retrieved:", {
      instId: retrieved.instId,
      symbol: retrieved.symbol,
      description: retrieved.description,
      website: retrieved.website,
    });
    console.log("");

    // Test 3: Save another token
    console.log("Test 3: Save another token (DOGE)");
    const dogeData: CreateTokenMetadataRequest = {
      instId: "DOGE-USDT",
      tokenAddress: "0x9876543210987654321098765432109876543210",
      name: "Doge Token",
      symbol: "DOGE",
      description: "Much wow, such token!",
      logoUrl: "https://example.com/doge-logo.png",
      website: "https://doge.com",
      twitter: "@dogecoin",
      creatorAddress: "0xabcdefabcdefabcdefabcdefabcdefabcdefabcd",
      totalSupply: "500000000000000000000000000", // 500 million
    };

    const savedDoge = await saveTokenMetadata(dogeData);
    console.log("  Saved:", {
      instId: savedDoge.instId,
      symbol: savedDoge.symbol,
    });
    console.log("");

    // Test 4: Get all token metadata
    console.log("Test 4: Get all token metadata");
    const allTokens = await getAllTokenMetadata();
    console.log(`  Total tokens: ${allTokens.length}`);
    allTokens.forEach((token) => {
      console.log(`    - ${token.symbol} (${token.instId})`);
    });
    console.log("");

    // Test 5: Update token metadata
    console.log("Test 5: Update token metadata (PEPE)");
    const updatedData: CreateTokenMetadataRequest = {
      ...tokenData,
      description: "Updated: The BEST meme token on Base! 🚀",
      telegram: "https://t.me/pepecoin_official",
    };

    const updated = await saveTokenMetadata(updatedData);
    console.log("  Updated:", {
      description: updated.description,
      telegram: updated.telegram,
      updatedAt: updated.updatedAt,
    });
    console.log("");

    // Test 6: Search tokens
    console.log("Test 6: Search tokens by name");
    const searchResults = await searchTokens("pepe");
    console.log(`  Found ${searchResults.length} tokens matching "pepe":`);
    searchResults.forEach((token) => {
      console.log(`    - ${token.name} (${token.symbol})`);
    });
    console.log("");

    // Test 7: Get tokens by creator
    console.log("Test 7: Get tokens by creator address");
    const creatorTokens = await getTokensByCreator(
      "0xabcdefabcdefabcdefabcdefabcdefabcdefabcd"
    );
    console.log(`  Creator has ${creatorTokens.length} tokens:`);
    creatorTokens.forEach((token) => {
      console.log(`    - ${token.symbol}`);
    });
    console.log("");

    // Test 8: Validation - missing required fields
    console.log("Test 8: Validation - missing required fields");
    try {
      await saveTokenMetadata({
        instId: "INVALID-TOKEN",
        name: "Invalid Token",
        symbol: "INVALID",
      } as any);
      console.error("  ❌ Should have failed validation!");
    } catch (error) {
      console.log("  ✅ Correctly rejected:", (error as Error).message);
    }
    console.log("");

    // Test 9: Validation - invalid address
    console.log("Test 9: Validation - invalid address");
    try {
      await saveTokenMetadata({
        ...tokenData,
        instId: "INVALID-ADDR",
        tokenAddress: "invalid_address",
      } as any);
      console.error("  ❌ Should have failed validation!");
    } catch (error) {
      console.log("  ✅ Correctly rejected:", (error as Error).message);
    }
    console.log("");

    // Test 10: Validation - invalid URL
    console.log("Test 10: Validation - invalid URL");
    try {
      await saveTokenMetadata({
        ...tokenData,
        instId: "INVALID-URL",
        website: "not-a-valid-url",
      });
      console.error("  ❌ Should have failed validation!");
    } catch (error) {
      console.log("  ✅ Correctly rejected:", (error as Error).message);
    }
    console.log("");

    // Test 11: Delete token metadata
    console.log("Test 11: Delete token metadata");
    const deleted = await deleteTokenMetadata("DOGE-USDT");
    console.log(`  Deleted DOGE: ${deleted}`);

    const remaining = await getAllTokenMetadata();
    console.log(`  Remaining tokens: ${remaining.length}`);
    console.log("");

    // Cleanup
    console.log("Cleanup: Deleting test data");
    await deleteTokenMetadata("PEPE-USDT");
    console.log("  Test data deleted");
    console.log("");

    console.log("✅ All token metadata tests passed! 🎉");
  } catch (error) {
    console.error("❌ Test failed:", error);
    throw error;
  } finally {
    await db.disconnect();
    console.log("✅ Disconnected from Redis");
  }
}

testTokenMetadata().catch(console.error);
