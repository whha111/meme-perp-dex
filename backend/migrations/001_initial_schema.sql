-- Migration: 001_initial_schema
-- Description: Create initial database schema for MEME Perp DEX
-- Created: 2025-01-21

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================================================
-- Users Table
-- ============================================================================
CREATE TABLE IF NOT EXISTS users (
    id BIGSERIAL PRIMARY KEY,
    address VARCHAR(42) NOT NULL UNIQUE,
    api_key VARCHAR(64) UNIQUE,
    api_secret VARCHAR(128),
    referrer_id BIGINT REFERENCES users(id),
    referral_code VARCHAR(16) UNIQUE,
    fee_tier SMALLINT DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_users_referrer ON users(referrer_id);

-- ============================================================================
-- Instruments Table (Trading Pairs)
-- ============================================================================
CREATE TABLE IF NOT EXISTS instruments (
    id BIGSERIAL PRIMARY KEY,
    inst_id VARCHAR(32) NOT NULL UNIQUE,
    inst_type VARCHAR(16) NOT NULL,
    base_ccy VARCHAR(16) NOT NULL,
    quote_ccy VARCHAR(16) NOT NULL,
    settle_ccy VARCHAR(16) NOT NULL,
    ct_val DECIMAL(36, 18) DEFAULT 1,
    tick_sz DECIMAL(36, 18) NOT NULL,
    lot_sz DECIMAL(36, 18) NOT NULL,
    min_sz DECIMAL(36, 18) NOT NULL,
    max_lever SMALLINT DEFAULT 100,
    state VARCHAR(16) DEFAULT 'live',
    list_time BIGINT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- ============================================================================
-- Orders Table
-- ============================================================================
CREATE TABLE IF NOT EXISTS orders (
    id BIGSERIAL PRIMARY KEY,
    ord_id VARCHAR(32) NOT NULL UNIQUE,
    cl_ord_id VARCHAR(64),
    user_id BIGINT NOT NULL REFERENCES users(id),
    inst_id VARCHAR(32) NOT NULL,
    td_mode VARCHAR(16) NOT NULL,
    side VARCHAR(8) NOT NULL,
    pos_side VARCHAR(8) NOT NULL,
    ord_type VARCHAR(16) NOT NULL,
    sz DECIMAL(36, 18) NOT NULL,
    px DECIMAL(36, 18),
    avg_px DECIMAL(36, 18),
    acc_fill_sz DECIMAL(36, 18) DEFAULT 0,
    state VARCHAR(20) NOT NULL,
    lever SMALLINT NOT NULL,
    fee DECIMAL(36, 18) DEFAULT 0,
    fee_ccy VARCHAR(16),
    pnl DECIMAL(36, 18) DEFAULT 0,
    reduce_only BOOLEAN DEFAULT FALSE,
    tp_trigger_px DECIMAL(36, 18),
    sl_trigger_px DECIMAL(36, 18),
    c_time BIGINT NOT NULL,
    u_time BIGINT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_orders_user ON orders(user_id);
CREATE INDEX IF NOT EXISTS idx_orders_inst ON orders(inst_id);
CREATE INDEX IF NOT EXISTS idx_orders_state ON orders(state);
CREATE INDEX IF NOT EXISTS idx_orders_cl_ord ON orders(cl_ord_id);

-- ============================================================================
-- Positions Table
-- ============================================================================
CREATE TABLE IF NOT EXISTS positions (
    id BIGSERIAL PRIMARY KEY,
    pos_id VARCHAR(32) NOT NULL UNIQUE,
    user_id BIGINT NOT NULL REFERENCES users(id),
    inst_id VARCHAR(32) NOT NULL,
    mgn_mode VARCHAR(16) NOT NULL,
    pos_side VARCHAR(8) NOT NULL,
    pos DECIMAL(36, 18) DEFAULT 0,
    avail_pos DECIMAL(36, 18) DEFAULT 0,
    avg_px DECIMAL(36, 18),
    lever SMALLINT NOT NULL,
    upl DECIMAL(36, 18) DEFAULT 0,
    upl_ratio DECIMAL(18, 8),
    liq_px DECIMAL(36, 18),
    margin DECIMAL(36, 18) DEFAULT 0,
    imr DECIMAL(36, 18) DEFAULT 0,
    mmr DECIMAL(36, 18) DEFAULT 0,
    mgn_ratio DECIMAL(18, 8),
    c_time BIGINT NOT NULL,
    u_time BIGINT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_positions_user ON positions(user_id);
CREATE INDEX IF NOT EXISTS idx_positions_inst ON positions(inst_id);

-- ============================================================================
-- Balances Table
-- ============================================================================
CREATE TABLE IF NOT EXISTS balances (
    id BIGSERIAL PRIMARY KEY,
    user_id BIGINT NOT NULL REFERENCES users(id),
    ccy VARCHAR(16) NOT NULL,
    eq DECIMAL(36, 18) DEFAULT 0,
    cash_bal DECIMAL(36, 18) DEFAULT 0,
    avail_bal DECIMAL(36, 18) DEFAULT 0,
    frozen_bal DECIMAL(36, 18) DEFAULT 0,
    ord_frozen DECIMAL(36, 18) DEFAULT 0,
    upl DECIMAL(36, 18) DEFAULT 0,
    u_time BIGINT NOT NULL,
    UNIQUE(user_id, ccy)
);

-- ============================================================================
-- Candles Table (OHLCV Data)
-- ============================================================================
CREATE TABLE IF NOT EXISTS candles (
    id BIGSERIAL PRIMARY KEY,
    inst_id VARCHAR(32) NOT NULL,
    bar VARCHAR(8) NOT NULL,
    ts BIGINT NOT NULL,
    o DECIMAL(36, 18) NOT NULL,
    h DECIMAL(36, 18) NOT NULL,
    l DECIMAL(36, 18) NOT NULL,
    c DECIMAL(36, 18) NOT NULL,
    vol DECIMAL(36, 18) NOT NULL,
    vol_ccy DECIMAL(36, 18) NOT NULL,
    confirm SMALLINT DEFAULT 0,
    UNIQUE(inst_id, bar, ts)
);

CREATE INDEX IF NOT EXISTS idx_candles_inst_ts ON candles(inst_id, ts DESC);

-- ============================================================================
-- Trades Table
-- ============================================================================
CREATE TABLE IF NOT EXISTS trades (
    id BIGSERIAL PRIMARY KEY,
    trade_id VARCHAR(32) NOT NULL UNIQUE,
    inst_id VARCHAR(32) NOT NULL,
    px DECIMAL(36, 18) NOT NULL,
    sz DECIMAL(36, 18) NOT NULL,
    side VARCHAR(8) NOT NULL,
    ts BIGINT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_trades_inst ON trades(inst_id);
CREATE INDEX IF NOT EXISTS idx_trades_ts ON trades(ts DESC);

-- ============================================================================
-- Funding Rates Table
-- ============================================================================
CREATE TABLE IF NOT EXISTS funding_rates (
    id BIGSERIAL PRIMARY KEY,
    inst_id VARCHAR(32) NOT NULL,
    funding_rate DECIMAL(18, 8) NOT NULL,
    realized_rate DECIMAL(18, 8),
    funding_time BIGINT NOT NULL,
    UNIQUE(inst_id, funding_time)
);

-- ============================================================================
-- Liquidations Table
-- ============================================================================
CREATE TABLE IF NOT EXISTS liquidations (
    id BIGSERIAL PRIMARY KEY,
    user_id BIGINT NOT NULL REFERENCES users(id),
    inst_id VARCHAR(32) NOT NULL,
    pos_side VARCHAR(8) NOT NULL,
    sz DECIMAL(36, 18) NOT NULL,
    px DECIMAL(36, 18) NOT NULL,
    loss DECIMAL(36, 18) NOT NULL,
    liquidator VARCHAR(42),
    liq_reward DECIMAL(36, 18),
    ts BIGINT NOT NULL,
    tx_hash VARCHAR(66)
);

CREATE INDEX IF NOT EXISTS idx_liquidations_user ON liquidations(user_id);
CREATE INDEX IF NOT EXISTS idx_liquidations_inst ON liquidations(inst_id);
CREATE INDEX IF NOT EXISTS idx_liquidations_ts ON liquidations(ts DESC);

-- ============================================================================
-- Bills Table (Account History)
-- ============================================================================
CREATE TABLE IF NOT EXISTS bills (
    id BIGSERIAL PRIMARY KEY,
    bill_id VARCHAR(32) NOT NULL UNIQUE,
    user_id BIGINT NOT NULL REFERENCES users(id),
    inst_id VARCHAR(32),
    ccy VARCHAR(16) NOT NULL,
    type SMALLINT NOT NULL,
    sub_type SMALLINT,
    bal DECIMAL(36, 18) NOT NULL,
    bal_chg DECIMAL(36, 18) NOT NULL,
    sz DECIMAL(36, 18),
    px DECIMAL(36, 18),
    pnl DECIMAL(36, 18),
    fee DECIMAL(36, 18),
    ts BIGINT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_bills_user ON bills(user_id);
CREATE INDEX IF NOT EXISTS idx_bills_ts ON bills(ts DESC);

-- ============================================================================
-- Leverage Settings Table
-- ============================================================================
CREATE TABLE IF NOT EXISTS leverage_settings (
    id BIGSERIAL PRIMARY KEY,
    user_id BIGINT NOT NULL REFERENCES users(id),
    inst_id VARCHAR(32) NOT NULL,
    mgn_mode VARCHAR(16) NOT NULL,
    pos_side VARCHAR(8),
    lever SMALLINT NOT NULL,
    u_time BIGINT NOT NULL,
    UNIQUE(user_id, inst_id, mgn_mode, pos_side)
);

-- ============================================================================
-- Algo Orders Table (SL/TP Orders)
-- ============================================================================
CREATE TABLE IF NOT EXISTS algo_orders (
    id BIGSERIAL PRIMARY KEY,
    algo_id VARCHAR(32) NOT NULL UNIQUE,
    user_id BIGINT NOT NULL REFERENCES users(id),
    inst_id VARCHAR(32) NOT NULL,
    td_mode VARCHAR(16) NOT NULL,
    side VARCHAR(8) NOT NULL,
    pos_side VARCHAR(8) NOT NULL,
    ord_type VARCHAR(16) NOT NULL,
    sz DECIMAL(36, 18) NOT NULL,
    tp_trigger_px DECIMAL(36, 18),
    tp_ord_px DECIMAL(36, 18),
    sl_trigger_px DECIMAL(36, 18),
    sl_ord_px DECIMAL(36, 18),
    state VARCHAR(20) NOT NULL,
    trigger_px DECIMAL(36, 18),
    actual_px DECIMAL(36, 18),
    actual_sz DECIMAL(36, 18),
    c_time BIGINT NOT NULL,
    u_time BIGINT NOT NULL,
    trigger_time BIGINT
);

CREATE INDEX IF NOT EXISTS idx_algo_orders_user ON algo_orders(user_id);
CREATE INDEX IF NOT EXISTS idx_algo_orders_inst ON algo_orders(inst_id);
CREATE INDEX IF NOT EXISTS idx_algo_orders_state ON algo_orders(state);

-- ============================================================================
-- Referral Rewards Table
-- ============================================================================
CREATE TABLE IF NOT EXISTS referral_rewards (
    id BIGSERIAL PRIMARY KEY,
    referrer_id BIGINT NOT NULL REFERENCES users(id),
    referee_id BIGINT NOT NULL REFERENCES users(id),
    ord_id VARCHAR(32),
    trade_fee DECIMAL(36, 18) NOT NULL,
    reward DECIMAL(36, 18) NOT NULL,
    reward_rate DECIMAL(8, 4) NOT NULL,
    ccy VARCHAR(16) NOT NULL,
    ts BIGINT NOT NULL,
    claimed BOOLEAN DEFAULT FALSE
);

CREATE INDEX IF NOT EXISTS idx_referral_rewards_referrer ON referral_rewards(referrer_id);

-- ============================================================================
-- Sync State Table (Blockchain Indexer State)
-- ============================================================================
CREATE TABLE IF NOT EXISTS sync_states (
    id BIGSERIAL PRIMARY KEY,
    contract VARCHAR(42) NOT NULL UNIQUE,
    last_block BIGINT NOT NULL,
    last_tx_index INT NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- ============================================================================
-- Trigger: Update updated_at on users
-- ============================================================================
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER update_users_updated_at
    BEFORE UPDATE ON users
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();
