/**
 * Backfill historic LP-filled trades from Redis into PG perp_trade_mirror.
 *
 * Before Fix #1 (commit e642ee1), LP-filled trades were written only to Redis
 * (TradeRepo.create) — the PG mirror write was missing. Any trade that happened
 * before the fix deployed is therefore absent from perp_trade_mirror.
 *
 * This one-shot script:
 *   1. SCAN memeperp:perp:trade:* in Redis
 *   2. HGETALL each key
 *   3. INSERT ... ON CONFLICT (id) DO NOTHING into perp_trade_mirror
 *
 * Run inside the matching-engine container (has REDIS_URL + POSTGRES_URL):
 *   docker cp scripts/backfill-lp-trades.ts dexi-matching-engine:/tmp/backfill.ts
 *   docker exec dexi-matching-engine bun run /tmp/backfill.ts
 */
import Redis from "ioredis";
import postgres from "postgres";

const REDIS_URL = process.env.REDIS_URL;
const POSTGRES_URL = process.env.POSTGRES_URL;
const DRY_RUN = process.argv.includes("--dry-run");

if (!REDIS_URL || !POSTGRES_URL) {
  console.error("REDIS_URL and POSTGRES_URL must be set (run inside the matching-engine container)");
  process.exit(1);
}

// Respect the memeperp: key prefix that the engine uses
const REDIS_KEY_PREFIX = process.env.REDIS_KEY_PREFIX || "memeperp:";

const redis = new Redis(REDIS_URL);
const sql = postgres(POSTGRES_URL);

type RedisTrade = {
  id: string;
  orderId: string;
  pairId: string;
  token: string;
  trader: string;
  isLong: string;
  isMaker: string;
  size: string;
  price: string;
  fee: string;
  realizedPnL: string;
  timestamp: string;
  type: string;
};

async function scanAllTradeKeys(): Promise<string[]> {
  const pattern = `${REDIS_KEY_PREFIX}perp:trade:*`;
  const keys: string[] = [];
  let cursor = "0";
  do {
    const [next, batch] = await redis.scan(cursor, "MATCH", pattern, "COUNT", 500);
    cursor = next;
    keys.push(...batch);
  } while (cursor !== "0");
  return keys;
}

async function main() {
  console.log(`[Backfill] Redis pattern: ${REDIS_KEY_PREFIX}perp:trade:*`);
  console.log(`[Backfill] DRY_RUN=${DRY_RUN}`);

  // 1. List Redis trade keys
  const keys = await scanAllTradeKeys();
  console.log(`[Backfill] Found ${keys.length} Redis trade keys`);

  if (keys.length === 0) {
    console.log("[Backfill] nothing to do");
    await redis.quit();
    await sql.end();
    return;
  }

  // 2. Get all existing PG ids (single query, much faster than per-trade EXISTS)
  const pgRowsRaw = await sql<Array<{ id: string }>>`SELECT id FROM perp_trade_mirror`;
  const pgIds = new Set(pgRowsRaw.map(r => r.id));
  console.log(`[Backfill] PG currently has ${pgIds.size} trade_mirror rows`);

  // 3. For each Redis trade, insert if missing
  let inserted = 0;
  let skipped = 0;
  let errored = 0;

  for (const key of keys) {
    try {
      const raw = (await redis.hgetall(key)) as unknown as RedisTrade;
      if (!raw?.id) { errored++; continue; }
      if (pgIds.has(raw.id)) { skipped++; continue; }

      if (DRY_RUN) {
        inserted++;
        continue;
      }

      // Map Redis fields to PG columns (see postgres.ts:838-846 for schema)
      await sql`
        INSERT INTO perp_trade_mirror (
          id, order_id, pair_id, token, trader, is_long, is_maker,
          size, price, fee, realized_pnl, timestamp, type, created_at
        ) VALUES (
          ${raw.id},
          ${raw.orderId || ""},
          ${raw.pairId || ""},
          ${(raw.token || "").toLowerCase()},
          ${(raw.trader || "").toLowerCase()},
          ${raw.isLong === "true"},
          ${raw.isMaker === "true"},
          ${raw.size || "0"},
          ${raw.price || "0"},
          ${raw.fee || "0"},
          ${raw.realizedPnL || "0"},
          ${BigInt(raw.timestamp || "0").toString()},
          ${raw.type || "open"},
          ${Date.now()}
        )
        ON CONFLICT (id) DO NOTHING
      `;
      inserted++;
    } catch (e: any) {
      errored++;
      console.error(`[Backfill] Error on ${key.slice(0, 40)}: ${e.message?.slice(0, 80)}`);
    }
  }

  console.log("");
  console.log("=== BACKFILL SUMMARY ===");
  console.log(`  Redis trade keys scanned: ${keys.length}`);
  console.log(`  Already in PG (skipped):  ${skipped}`);
  console.log(`  Inserted into PG:         ${inserted}${DRY_RUN ? " (dry-run)" : ""}`);
  console.log(`  Errored:                  ${errored}`);

  // Final counts
  const [{ count }] = await sql<Array<{ count: string }>>`SELECT COUNT(*)::text AS count FROM perp_trade_mirror`;
  console.log(`  PG perp_trade_mirror row count after: ${count}`);

  await redis.quit();
  await sql.end();
}

main().catch(e => { console.error(e); process.exit(1); });
