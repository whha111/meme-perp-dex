/**
 * 回填指定 token 的历史交易数据
 */
import "dotenv/config";
import { connectRedis, disconnectRedis } from "./database/redis";
import { backfillHistoricalTrades } from "../spot/spotHistory";
import type { Address } from "viem";

const TOKEN = (process.argv[2] || "0x197512828dBDB8340e0bA4815f4479B0c5D1eBd2") as Address;
const FROM_BLOCK = BigInt(process.argv[3] || "36957754");
const TO_BLOCK = BigInt(process.argv[4] || "36967754");
const ETH_PRICE_USD = 3000;

async function main() {
  console.log("Connecting to Redis...");
  const connected = await connectRedis();
  console.log("Redis connected:", connected);

  // Verify Redis connection
  const { isRedisConnected, getRedisClient } = await import("./database");
  console.log("isRedisConnected():", isRedisConnected());

  // Test Redis
  const client = getRedisClient();
  await client.set("test:backfill", "working");
  const testVal = await client.get("test:backfill");
  console.log("Redis test:", testVal);

  console.log(`Backfilling trades for ${TOKEN}`);
  console.log(`From block: ${FROM_BLOCK}`);
  console.log(`To block: ${TO_BLOCK}`);

  const count = await backfillHistoricalTrades(TOKEN, FROM_BLOCK, TO_BLOCK, ETH_PRICE_USD);
  console.log(`Processed ${count} trades`);

  // Check if data was saved
  const keys = await client.keys("*spot*");
  console.log("Spot keys after backfill:", keys.length);

  await disconnectRedis();
  process.exit(0);
}

main().catch((err) => {
  console.error("Error:", err);
  process.exit(1);
});
