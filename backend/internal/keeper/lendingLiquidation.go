package keeper

import (
	"context"
	"fmt"
	"math/big"
	"time"

	"github.com/ethereum/go-ethereum/common"
	"go.uber.org/zap"
	"gorm.io/gorm"

	"github.com/memeperp/backend/internal/blockchain"
	"github.com/memeperp/backend/internal/pkg/config"
	"github.com/memeperp/backend/internal/pkg/database"
)

// lendingCheckInterval is the interval between lending health checks (5s)
const lendingCheckInterval = 5 * time.Second

// LendingLiquidationKeeper monitors LendingPool borrows and triggers liquidations
// This is a backup keeper — the matching engine is the primary liquidation monitor.
// If the matching engine misses a lending liquidation, this keeper catches it.
type LendingLiquidationKeeper struct {
	db    *gorm.DB
	cache *database.Cache
	cfg   *config.BlockchainConfig
	log   *zap.Logger

	// Blockchain
	ethClient      *blockchain.Client
	lendingPoolCtx *blockchain.LendingPoolContract

	// Metrics
	liquidationsExecuted uint64
	liquidationsFailed   uint64
	lastCheckTime        time.Time

	// Cached enabled tokens (refreshed periodically)
	enabledTokens     []common.Address
	lastTokenRefresh  time.Time
	tokenRefreshEvery time.Duration
}

// NewLendingLiquidationKeeper creates a new keeper for lending liquidation
func NewLendingLiquidationKeeper(
	db *gorm.DB,
	cache *database.Cache,
	cfg *config.BlockchainConfig,
	logger *zap.Logger,
) *LendingLiquidationKeeper {
	return &LendingLiquidationKeeper{
		db:                db,
		cache:             cache,
		cfg:               cfg,
		log:               logger,
		tokenRefreshEvery: 5 * time.Minute, // refresh token list every 5 minutes
	}
}

// InitBlockchain initializes blockchain connections
func (k *LendingLiquidationKeeper) InitBlockchain() error {
	var err error

	// Initialize Ethereum client
	k.ethClient, err = blockchain.NewClient(k.cfg, nil, k.log)
	if err != nil {
		return fmt.Errorf("failed to init eth client: %w", err)
	}

	// Initialize LendingPool contract
	if k.cfg.LendingPoolAddr == "" {
		return fmt.Errorf("lending_pool_address not configured")
	}

	k.lendingPoolCtx, err = blockchain.NewLendingPoolContract(
		common.HexToAddress(k.cfg.LendingPoolAddr),
		k.ethClient,
	)
	if err != nil {
		return fmt.Errorf("failed to init LendingPool contract: %w", err)
	}

	k.log.Info("LendingPool contract initialized",
		zap.String("address", k.cfg.LendingPoolAddr))

	return nil
}

// Start begins the lending liquidation keeper loop
func (k *LendingLiquidationKeeper) Start(ctx context.Context) {
	k.log.Info("Lending liquidation keeper starting...")

	if err := k.InitBlockchain(); err != nil {
		k.log.Error("Failed to initialize blockchain for lending keeper",
			zap.Error(err))
		return
	}

	k.log.Info("Lending liquidation keeper started",
		zap.Duration("checkInterval", lendingCheckInterval))

	ticker := time.NewTicker(lendingCheckInterval)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			k.log.Info("Lending liquidation keeper stopped",
				zap.Uint64("totalLiquidations", k.liquidationsExecuted),
				zap.Uint64("failedLiquidations", k.liquidationsFailed))
			if k.ethClient != nil {
				k.ethClient.Close()
			}
			return
		case <-ticker.C:
			k.checkBorrows(ctx)
		}
	}
}

// refreshEnabledTokens updates the cached list of enabled tokens
func (k *LendingLiquidationKeeper) refreshEnabledTokens(ctx context.Context) error {
	if time.Since(k.lastTokenRefresh) < k.tokenRefreshEvery && len(k.enabledTokens) > 0 {
		return nil // Cache still fresh
	}

	tokens, err := k.lendingPoolCtx.GetEnabledTokens(ctx)
	if err != nil {
		return fmt.Errorf("failed to get enabled tokens: %w", err)
	}

	k.enabledTokens = tokens
	k.lastTokenRefresh = time.Now()

	k.log.Debug("Refreshed enabled tokens",
		zap.Int("count", len(tokens)))

	return nil
}

// checkBorrows checks all enabled token pools for unhealthy utilization
func (k *LendingLiquidationKeeper) checkBorrows(ctx context.Context) {
	k.lastCheckTime = time.Now()

	// Refresh enabled tokens list
	if err := k.refreshEnabledTokens(ctx); err != nil {
		k.log.Error("Failed to refresh enabled tokens", zap.Error(err))
		return
	}

	if len(k.enabledTokens) == 0 {
		return
	}

	for _, token := range k.enabledTokens {
		k.checkTokenPool(ctx, token)
	}
}

// Utilization thresholds (1e18 scale, matching LendingPool.sol)
// 85% = 85 * 1e16 = 850000000000000000
// 90% = 90 * 1e16 = 900000000000000000
var (
	utilizationWarning  = new(big.Int).Mul(big.NewInt(85), new(big.Int).Exp(big.NewInt(10), big.NewInt(16), nil))
	utilizationCritical = new(big.Int).Mul(big.NewInt(90), new(big.Int).Exp(big.NewInt(10), big.NewInt(16), nil))
)

// checkTokenPool checks utilization for a single token pool
func (k *LendingLiquidationKeeper) checkTokenPool(ctx context.Context, token common.Address) {
	// Get pool utilization (1e18 scale: 1e18 = 100%)
	utilization, err := k.lendingPoolCtx.GetUtilization(ctx, token)
	if err != nil {
		k.log.Debug("Failed to get utilization",
			zap.String("token", token.Hex()),
			zap.Error(err))
		return
	}

	// If utilization is below warning threshold, skip this token
	if utilization.Cmp(utilizationWarning) < 0 {
		return
	}

	// Calculate utilization percentage for logging (utilization * 100 / 1e18)
	pct := new(big.Int).Div(new(big.Int).Mul(utilization, big.NewInt(100)), new(big.Int).Exp(big.NewInt(10), big.NewInt(18), nil))

	k.log.Warn("High utilization detected",
		zap.String("token", token.Hex()),
		zap.String("utilization", utilization.String()),
		zap.Int64("pct", pct.Int64()))

	// If utilization exceeds critical threshold, alert
	if utilization.Cmp(utilizationCritical) >= 0 {
		k.log.Error("CRITICAL: Pool utilization above 90%",
			zap.String("token", token.Hex()),
			zap.Int64("pct", pct.Int64()),
			zap.String("action", "matching engine should handle individual liquidations"))

		// Get available liquidity for monitoring
		liquidity, err := k.lendingPoolCtx.GetAvailableLiquidity(ctx, token)
		if err == nil {
			k.log.Error("Available liquidity critically low",
				zap.String("token", token.Hex()),
				zap.String("availableLiquidity", liquidity.String()))
		}

		// Note: The keeper doesn't execute individual borrower liquidations directly
		// because it doesn't maintain a list of borrowers. The matching engine
		// (lendingLiquidation.ts) tracks borrowers and handles liquidations.
		// The keeper serves as a monitoring/alerting layer.
		//
		// Future enhancement: store borrower list in DB/cache for keeper access
	}
}

// ExecuteLiquidation manually liquidates a specific borrower (for admin use)
func (k *LendingLiquidationKeeper) ExecuteLiquidation(ctx context.Context, token, borrower common.Address) error {
	if k.lendingPoolCtx == nil {
		return fmt.Errorf("LendingPool contract not initialized")
	}

	// Check borrow amount first
	borrowAmount, err := k.lendingPoolCtx.GetUserBorrow(ctx, token, borrower)
	if err != nil {
		return fmt.Errorf("failed to get user borrow: %w", err)
	}

	if borrowAmount.Cmp(big.NewInt(0)) == 0 {
		return fmt.Errorf("user has no active borrow on this token")
	}

	k.log.Info("Executing lending liquidation",
		zap.String("token", token.Hex()),
		zap.String("borrower", borrower.Hex()),
		zap.String("borrowAmount", borrowAmount.String()))

	tx, err := k.lendingPoolCtx.LiquidateBorrow(ctx, token, borrower)
	if err != nil {
		k.liquidationsFailed++
		return fmt.Errorf("liquidation tx failed: %w", err)
	}

	k.log.Info("Lending liquidation tx sent",
		zap.String("txHash", tx.Hash().Hex()),
		zap.String("token", token.Hex()),
		zap.String("borrower", borrower.Hex()))

	// Wait for confirmation
	receipt, err := k.ethClient.WaitForTransaction(ctx, tx)
	if err != nil {
		k.liquidationsFailed++
		return fmt.Errorf("liquidation tx wait failed: %w", err)
	}

	k.log.Info("Lending liquidation confirmed",
		zap.String("txHash", tx.Hash().Hex()),
		zap.Uint64("blockNumber", receipt.BlockNumber.Uint64()),
		zap.Uint64("gasUsed", receipt.GasUsed))

	k.liquidationsExecuted++
	return nil
}

// GetMetrics returns keeper metrics
func (k *LendingLiquidationKeeper) GetMetrics() map[string]interface{} {
	return map[string]interface{}{
		"liquidations_executed": k.liquidationsExecuted,
		"liquidations_failed":  k.liquidationsFailed,
		"last_check_time":      k.lastCheckTime,
		"enabled_tokens":       len(k.enabledTokens),
		"blockchain_enabled":   k.ethClient != nil,
	}
}
