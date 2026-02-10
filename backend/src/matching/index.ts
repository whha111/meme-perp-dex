/**
 * 撮合引擎 - 模块导出
 */

// Config & Types
export * from "./config";
export * from "./types";

// Database
export * from "./database/redis";

// Modules
// NOTE: modules/matching has been deleted (Phase 2 cleanup - duplicate of engine.ts)
// If server.new.ts is activated, update imports to use engine.ts directly:
// import { engine } from "./engine" instead of "./modules/matching"
// export { default as engine } from "./modules/matching";  // DELETED
export * from "./modules/wallet";
export * from "./modules/order";
export * from "./modules/position";
export * from "./modules/balance";
// ❌ Mode 2: settlement 模块已删除
// export * from "./modules/settlement";
export * from "./modules/liquidation";
export * from "./modules/funding";
export * from "./modules/risk";
export * from "./modules/lifecycle";
export * from "./modules/fomo";
export * from "../spot/spotHistory";

// Utils
export * from "./utils/logger";
export * from "./utils/precision";
export * from "./utils/crypto";
