package nonce

import (
	"context"
	"fmt"
	"strconv"
	"time"

	"github.com/ethereum/go-ethereum/common"
	"github.com/ethereum/go-ethereum/ethclient"
	"github.com/redis/go-redis/v9"
	"go.uber.org/zap"
)

// Manager manages nonces for blockchain transactions and application-level orders
// Uses Redis for persistence and atomic operations
// Based on Binance's approach: centralized nonce management with chain sync
type Manager struct {
	redis      *redis.Client
	ethClient  *ethclient.Client
	logger     *zap.Logger
	keyPrefix  string
	expiration time.Duration
}

// NewManager creates a new nonce manager
func NewManager(redis *redis.Client, ethClient *ethclient.Client, logger *zap.Logger) *Manager {
	return &Manager{
		redis:      redis,
		ethClient:  ethClient,
		logger:     logger,
		keyPrefix:  "nonce:",
		expiration: 7 * 24 * time.Hour, // Keep nonces for 7 days
	}
}

// GetNextTransactionNonce gets and increments the transaction nonce for an address
// This is used for blockchain transactions (keeper/matcher signing)
func (m *Manager) GetNextTransactionNonce(ctx context.Context, address common.Address) (uint64, error) {
	key := m.keyPrefix + "tx:" + address.Hex()

	// Try to increment in Redis
	nonce, err := m.redis.Incr(ctx, key).Result()
	if err != nil {
		return 0, fmt.Errorf("failed to increment nonce in Redis: %w", err)
	}

	// Set expiration
	m.redis.Expire(ctx, key, m.expiration)

	// Redis INCR returns the new value (after increment), but we want 0-indexed
	// so return nonce - 1
	return uint64(nonce - 1), nil
}

// GetNextOrderNonce gets and increments the order nonce for a trader
// This is used for application-level order validation (prevents replay attacks)
func (m *Manager) GetNextOrderNonce(ctx context.Context, trader common.Address) (uint64, error) {
	key := m.keyPrefix + "order:" + trader.Hex()

	// Try to increment in Redis
	nonce, err := m.redis.Incr(ctx, key).Result()
	if err != nil {
		return 0, fmt.Errorf("failed to increment order nonce in Redis: %w", err)
	}

	// Set expiration
	m.redis.Expire(ctx, key, m.expiration)

	// Redis INCR returns the new value, return 0-indexed
	return uint64(nonce - 1), nil
}

// GetCurrentOrderNonce gets the current order nonce without incrementing
func (m *Manager) GetCurrentOrderNonce(ctx context.Context, trader common.Address) (uint64, error) {
	key := m.keyPrefix + "order:" + trader.Hex()

	val, err := m.redis.Get(ctx, key).Result()
	if err == redis.Nil {
		// Not found, return 0
		return 0, nil
	}
	if err != nil {
		return 0, fmt.Errorf("failed to get order nonce from Redis: %w", err)
	}

	nonce, err := strconv.ParseUint(val, 10, 64)
	if err != nil {
		return 0, fmt.Errorf("invalid nonce value in Redis: %w", err)
	}

	return nonce, nil
}

// SyncTransactionNonceFromChain syncs transaction nonce with on-chain value
// Should be called on startup or after transaction failures
func (m *Manager) SyncTransactionNonceFromChain(ctx context.Context, address common.Address) (uint64, error) {
	// Get pending nonce from chain
	nonce, err := m.ethClient.PendingNonceAt(ctx, address)
	if err != nil {
		return 0, fmt.Errorf("failed to get nonce from chain: %w", err)
	}

	key := m.keyPrefix + "tx:" + address.Hex()

	// Set in Redis
	err = m.redis.Set(ctx, key, nonce, m.expiration).Err()
	if err != nil {
		return 0, fmt.Errorf("failed to set nonce in Redis: %w", err)
	}

	m.logger.Info("Synced transaction nonce from chain",
		zap.String("address", address.Hex()),
		zap.Uint64("nonce", nonce))

	return nonce, nil
}

// ValidateOrderNonce validates that an order's nonce is valid
// Returns true if nonce is >= current expected nonce
func (m *Manager) ValidateOrderNonce(ctx context.Context, trader common.Address, providedNonce uint64) (bool, error) {
	expectedNonce, err := m.GetCurrentOrderNonce(ctx, trader)
	if err != nil {
		return false, err
	}

	// Allow nonce >= expected (for out-of-order execution)
	return providedNonce >= expectedNonce, nil
}

// SetOrderNonce manually sets an order nonce (useful for migration or recovery)
func (m *Manager) SetOrderNonce(ctx context.Context, trader common.Address, nonce uint64) error {
	key := m.keyPrefix + "order:" + trader.Hex()

	err := m.redis.Set(ctx, key, nonce, m.expiration).Err()
	if err != nil {
		return fmt.Errorf("failed to set order nonce in Redis: %w", err)
	}

	m.logger.Info("Manually set order nonce",
		zap.String("trader", trader.Hex()),
		zap.Uint64("nonce", nonce))

	return nil
}

// ResetTransactionNonce resets transaction nonce and syncs from chain
// Useful after transaction failures or stuck transactions
func (m *Manager) ResetTransactionNonce(ctx context.Context, address common.Address) (uint64, error) {
	m.logger.Warn("Resetting transaction nonce",
		zap.String("address", address.Hex()))

	return m.SyncTransactionNonceFromChain(ctx, address)
}

// GetStats returns nonce statistics for monitoring
func (m *Manager) GetStats(ctx context.Context, addresses []common.Address) (map[string]interface{}, error) {
	stats := make(map[string]interface{})

	for _, addr := range addresses {
		// Get transaction nonce
		txKey := m.keyPrefix + "tx:" + addr.Hex()
		txNonce, err := m.redis.Get(ctx, txKey).Result()
		if err != nil && err != redis.Nil {
			return nil, err
		}

		// Get chain nonce
		chainNonce, err := m.ethClient.PendingNonceAt(ctx, addr)
		if err != nil {
			return nil, err
		}

		stats[addr.Hex()] = map[string]interface{}{
			"tx_nonce_redis": txNonce,
			"tx_nonce_chain": chainNonce,
		}
	}

	return stats, nil
}
