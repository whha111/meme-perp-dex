-- Migration: 003_add_token_metadata
-- Description: Add token metadata table for storing token information (logo, description, social links, etc.)
-- Created: 2026-01-23

-- ============================================================================
-- Token Metadata Table
-- ============================================================================
CREATE TABLE IF NOT EXISTS token_metadata (
    id BIGSERIAL PRIMARY KEY,
    inst_id VARCHAR(32) NOT NULL UNIQUE REFERENCES instruments(inst_id) ON DELETE CASCADE,
    token_address VARCHAR(42) NOT NULL,
    name VARCHAR(100) NOT NULL,
    symbol VARCHAR(20) NOT NULL,
    description TEXT,
    logo_url VARCHAR(500), -- IPFS URL or HTTP URL for token logo
    image_url VARCHAR(500), -- Alternative field for image URL
    website VARCHAR(200),
    twitter VARCHAR(100),
    telegram VARCHAR(100),
    discord VARCHAR(100),
    creator_address VARCHAR(42) NOT NULL,
    total_supply DECIMAL(36, 18) NOT NULL,
    initial_buy_amount DECIMAL(36, 18),
    is_graduated BOOLEAN DEFAULT FALSE,
    graduation_time BIGINT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_token_metadata_token_address ON token_metadata(token_address);
CREATE INDEX IF NOT EXISTS idx_token_metadata_creator ON token_metadata(creator_address);
CREATE INDEX IF NOT EXISTS idx_token_metadata_graduated ON token_metadata(is_graduated);

-- Add trigger for updated_at
CREATE TRIGGER update_token_metadata_updated_at
    BEFORE UPDATE ON token_metadata
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- Add comment
COMMENT ON TABLE token_metadata IS 'Stores metadata for tokens created on the platform';
COMMENT ON COLUMN token_metadata.logo_url IS 'IPFS URL or HTTP URL for token logo image';
COMMENT ON COLUMN token_metadata.image_url IS 'Alternative field for image URL (some APIs use this)';
