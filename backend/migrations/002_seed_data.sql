-- Migration: 002_seed_data
-- Description: Seed initial data for MEME Perp DEX
-- Created: 2025-01-21

-- ============================================================================
-- Initial Instruments (Meme Coin Perpetual Contracts)
-- ============================================================================
INSERT INTO instruments (inst_id, inst_type, base_ccy, quote_ccy, settle_ccy, ct_val, tick_sz, lot_sz, min_sz, max_lever, state, list_time)
VALUES
    ('PEPE-USDT-SWAP', 'SWAP', 'PEPE', 'USDT', 'USDT', 1000000, 0.0000000001, 1, 1, 100, 'live', EXTRACT(EPOCH FROM NOW()) * 1000),
    ('DOGE-USDT-SWAP', 'SWAP', 'DOGE', 'USDT', 'USDT', 1000, 0.00001, 1, 1, 100, 'live', EXTRACT(EPOCH FROM NOW()) * 1000),
    ('SHIB-USDT-SWAP', 'SWAP', 'SHIB', 'USDT', 'USDT', 1000000, 0.00000001, 1, 1, 100, 'live', EXTRACT(EPOCH FROM NOW()) * 1000),
    ('FLOKI-USDT-SWAP', 'SWAP', 'FLOKI', 'USDT', 'USDT', 1000000, 0.00000001, 1, 1, 100, 'live', EXTRACT(EPOCH FROM NOW()) * 1000),
    ('WIF-USDT-SWAP', 'SWAP', 'WIF', 'USDT', 'USDT', 1, 0.0001, 0.1, 0.1, 100, 'live', EXTRACT(EPOCH FROM NOW()) * 1000),
    ('BONK-USDT-SWAP', 'SWAP', 'BONK', 'USDT', 'USDT', 1000000, 0.0000000001, 1, 1, 100, 'live', EXTRACT(EPOCH FROM NOW()) * 1000),
    ('MEME-USDT-SWAP', 'SWAP', 'MEME', 'USDT', 'USDT', 1, 0.0001, 1, 1, 100, 'live', EXTRACT(EPOCH FROM NOW()) * 1000),
    ('TURBO-USDT-SWAP', 'SWAP', 'TURBO', 'USDT', 'USDT', 1000, 0.000001, 1, 1, 100, 'live', EXTRACT(EPOCH FROM NOW()) * 1000)
ON CONFLICT (inst_id) DO NOTHING;

-- ============================================================================
-- Initial Sync States
-- ============================================================================
INSERT INTO sync_states (contract, last_block, last_tx_index)
VALUES
    ('0x98e48863d5c80092211811503AC0532cF7b80f49', 0, 0),  -- Router
    ('0x32d92E26f52E99F8a8ED81B36110Af759aaA2443', 0, 0),  -- PositionManager
    ('0x468B589c68dBe29b2BC2b765108D63B61805e982', 0, 0),  -- Liquidation
    ('0x9Abe85f3bBee0f06330E8703e29B327CE551Ba10', 0, 0)   -- FundingRate
ON CONFLICT (contract) DO NOTHING;
