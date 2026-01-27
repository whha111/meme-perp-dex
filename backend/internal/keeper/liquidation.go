package keeper

import (
	"context"
	"fmt"
	"time"

	"github.com/ethereum/go-ethereum/common"
	"go.uber.org/zap"
	"gorm.io/gorm"

	"github.com/memeperp/backend/internal/blockchain"
	"github.com/memeperp/backend/internal/model"
	"github.com/memeperp/backend/internal/pkg/config"
	"github.com/memeperp/backend/internal/pkg/database"
	"github.com/memeperp/backend/internal/repository"
)

// LiquidationKeeper monitors positions and triggers liquidations on-chain
type LiquidationKeeper struct {
	db           *gorm.DB
	cache        *database.Cache
	cfg          *config.BlockchainConfig
	logger       *zap.Logger
	positionRepo *repository.PositionRepository
	userRepo     *repository.UserRepository

	// Blockchain client and contracts
	ethClient       *blockchain.Client
	liquidationCtx  *blockchain.LiquidationContract
	positionMgrCtx  *blockchain.PositionManagerContract

	// Metrics
	liquidationsExecuted uint64
	liquidationsFailed   uint64
	lastCheckTime        time.Time
}

// NewLiquidationKeeper creates a new LiquidationKeeper with blockchain integration
func NewLiquidationKeeper(db *gorm.DB, cache *database.Cache, cfg *config.BlockchainConfig, logger *zap.Logger) *LiquidationKeeper {
	return &LiquidationKeeper{
		db:           db,
		cache:        cache,
		cfg:          cfg,
		logger:       logger,
		positionRepo: repository.NewPositionRepository(db),
		userRepo:     repository.NewUserRepository(db),
	}
}

// InitBlockchain initializes blockchain connections
func (k *LiquidationKeeper) InitBlockchain() error {
	var err error

	// Initialize Ethereum client
	k.ethClient, err = blockchain.NewClient(k.cfg, nil, k.logger)
	if err != nil {
		return fmt.Errorf("failed to init eth client: %w", err)
	}

	// Check keeper balance
	balance, err := k.ethClient.GetBalance(context.Background())
	if err != nil {
		k.logger.Warn("Failed to get keeper balance", zap.Error(err))
	} else {
		k.logger.Info("Keeper balance",
			zap.String("address", k.ethClient.GetAddress().Hex()),
			zap.String("balance", balance.String()))

		// Warn if balance is low
		// 0.01 ETH minimum
		minBalance := "10000000000000000" // 0.01 ETH in wei
		if balance.String() < minBalance {
			k.logger.Warn("Keeper balance is low, transactions may fail")
		}
	}

	// Initialize Liquidation contract
	if k.cfg.LiquidationAddr != "" {
		k.liquidationCtx, err = blockchain.NewLiquidationContract(
			common.HexToAddress(k.cfg.LiquidationAddr),
			k.ethClient,
		)
		if err != nil {
			return fmt.Errorf("failed to init liquidation contract: %w", err)
		}
		k.logger.Info("Liquidation contract initialized",
			zap.String("address", k.cfg.LiquidationAddr))
	}

	// Initialize PositionManager contract
	if k.cfg.PositionAddress != "" {
		k.positionMgrCtx, err = blockchain.NewPositionManagerContract(
			common.HexToAddress(k.cfg.PositionAddress),
			k.ethClient,
		)
		if err != nil {
			return fmt.Errorf("failed to init position manager contract: %w", err)
		}
		k.logger.Info("PositionManager contract initialized",
			zap.String("address", k.cfg.PositionAddress))
	}

	return nil
}

func (k *LiquidationKeeper) Start(ctx context.Context) {
	k.logger.Info("Liquidation keeper starting...")

	// Initialize blockchain connections
	if err := k.InitBlockchain(); err != nil {
		k.logger.Error("Failed to initialize blockchain, running in DB-only mode",
			zap.Error(err))
	} else {
		k.logger.Info("Blockchain integration enabled")
	}

	k.logger.Info("Liquidation keeper started",
		zap.Duration("checkInterval", 5*time.Second))

	ticker := time.NewTicker(5 * time.Second)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			k.logger.Info("Liquidation keeper stopped",
				zap.Uint64("totalLiquidations", k.liquidationsExecuted),
				zap.Uint64("failedLiquidations", k.liquidationsFailed))
			if k.ethClient != nil {
				k.ethClient.Close()
			}
			return
		case <-ticker.C:
			k.checkPositions(ctx)
		}
	}
}

func (k *LiquidationKeeper) checkPositions(ctx context.Context) {
	k.lastCheckTime = time.Now()

	// Get all non-zero positions from database
	positions, err := k.positionRepo.GetAllNonZero()
	if err != nil {
		k.logger.Error("Failed to get positions", zap.Error(err))
		return
	}

	if len(positions) == 0 {
		return
	}

	k.logger.Debug("Checking positions for liquidation",
		zap.Int("count", len(positions)))

	for _, pos := range positions {
		// Get user's wallet address from database
		user, err := k.userRepo.GetByID(pos.UserID)
		if err != nil {
			k.logger.Warn("Failed to get user for position",
				zap.String("posId", pos.PosID),
				zap.Int64("userId", pos.UserID),
				zap.Error(err))
			continue
		}

		// First check on-chain if blockchain is available
		if k.positionMgrCtx != nil {
			userAddr := common.HexToAddress(user.Address)
			canLiq, err := k.positionMgrCtx.CanLiquidate(ctx, userAddr)
			if err != nil {
				k.logger.Warn("Failed to check on-chain liquidation status",
					zap.String("user", user.Address),
					zap.Error(err))
				// Fall back to local check
				k.checkLocalLiquidation(ctx, &pos)
				continue
			}

			if canLiq {
				k.logger.Warn("Position can be liquidated (on-chain check)",
					zap.String("posId", pos.PosID),
					zap.String("user", user.Address),
					zap.String("instId", pos.InstID))

				if err := k.liquidateOnChain(ctx, &pos, user.Address); err != nil {
					k.logger.Error("On-chain liquidation failed",
						zap.String("posId", pos.PosID),
						zap.Error(err))
					k.liquidationsFailed++
				}
			}
		} else {
			// No blockchain connection, use local check
			k.checkLocalLiquidation(ctx, &pos)
		}
	}
}

// checkLocalLiquidation checks if position should be liquidated using local data
func (k *LiquidationKeeper) checkLocalLiquidation(ctx context.Context, pos *model.Position) {
	// Get mark price from cache
	markPriceStr, err := k.cache.GetMarkPrice(ctx, pos.InstID)
	if err != nil {
		return
	}

	markPrice, err := model.NewDecimalFromString(markPriceStr)
	if err != nil {
		return
	}

	// Check if position should be liquidated
	if k.shouldLiquidate(pos, markPrice) {
		k.logger.Warn("Position needs liquidation (local check)",
			zap.String("posId", pos.PosID),
			zap.String("instId", pos.InstID),
			zap.String("markPrice", markPrice.String()),
			zap.String("liqPrice", pos.LiqPx.String()))

		// Get user's wallet address for on-chain liquidation
		user, err := k.userRepo.GetByID(pos.UserID)
		if err != nil {
			k.logger.Warn("Failed to get user, falling back to DB-only liquidation",
				zap.Int64("userId", pos.UserID),
				zap.Error(err))
			k.liquidateInDB(pos, markPrice)
			return
		}

		// Try on-chain liquidation first
		if k.liquidationCtx != nil {
			if err := k.liquidateOnChain(ctx, pos, user.Address); err != nil {
				k.logger.Error("On-chain liquidation failed, updating DB only",
					zap.String("posId", pos.PosID),
					zap.Error(err))
				// Fall back to DB update
				k.liquidateInDB(pos, markPrice)
			}
		} else {
			// No blockchain connection, update DB
			k.liquidateInDB(pos, markPrice)
		}
	}
}

func (k *LiquidationKeeper) shouldLiquidate(pos *model.Position, markPrice model.Decimal) bool {
	if pos.LiqPx.IsZero() {
		return false
	}

	if pos.PosSide == model.PosSideLong {
		// Long position liquidated when price drops below liq price
		return markPrice.LessThanOrEqual(pos.LiqPx)
	} else {
		// Short position liquidated when price rises above liq price
		return markPrice.GreaterThanOrEqual(pos.LiqPx)
	}
}

// liquidateOnChain executes liquidation on the blockchain
func (k *LiquidationKeeper) liquidateOnChain(ctx context.Context, pos *model.Position, walletAddress string) error {
	if k.liquidationCtx == nil {
		return fmt.Errorf("liquidation contract not initialized")
	}

	userAddr := common.HexToAddress(walletAddress)

	k.logger.Info("Executing on-chain liquidation",
		zap.String("posId", pos.PosID),
		zap.String("user", walletAddress))

	// Execute liquidation transaction
	tx, err := k.liquidationCtx.Liquidate(ctx, userAddr)
	if err != nil {
		return fmt.Errorf("failed to send liquidation tx: %w", err)
	}

	k.logger.Info("Liquidation transaction sent",
		zap.String("txHash", tx.Hash().Hex()),
		zap.String("posId", pos.PosID))

	// Wait for transaction confirmation
	receipt, err := k.ethClient.WaitForTransaction(ctx, tx)
	if err != nil {
		return fmt.Errorf("liquidation tx failed: %w", err)
	}

	k.logger.Info("Liquidation confirmed on-chain",
		zap.String("txHash", tx.Hash().Hex()),
		zap.String("posId", pos.PosID),
		zap.Uint64("blockNumber", receipt.BlockNumber.Uint64()),
		zap.Uint64("gasUsed", receipt.GasUsed))

	k.liquidationsExecuted++

	// Update local database to sync with chain state
	// The actual position update happens on-chain, we just mark it in our DB
	liq := &model.Liquidation{
		UserID:     pos.UserID,
		InstID:     pos.InstID,
		PosSide:    pos.PosSide,
		Sz:         pos.Pos,
		Px:         model.Zero(), // Will be filled from chain event
		Loss:       model.Zero(), // Will be filled from chain event
		Liquidator: k.ethClient.GetAddress().Hex(),
		TxHash:     tx.Hash().Hex(),
		Ts:         time.Now().UnixMilli(),
	}

	if err := k.db.Create(liq).Error; err != nil {
		k.logger.Warn("Failed to save liquidation record",
			zap.String("txHash", tx.Hash().Hex()),
			zap.Error(err))
	}

	return nil
}

// liquidateInDB updates the database only (fallback when blockchain is unavailable)
func (k *LiquidationKeeper) liquidateInDB(pos *model.Position, markPrice model.Decimal) {
	k.logger.Info("Executing DB-only liquidation",
		zap.String("posId", pos.PosID),
		zap.String("markPrice", markPrice.String()))

	// Calculate loss
	var pnl model.Decimal
	if pos.PosSide == model.PosSideLong {
		pnl = pos.Pos.Mul(markPrice.Sub(pos.AvgPx))
	} else {
		pnl = pos.Pos.Mul(pos.AvgPx.Sub(markPrice))
	}

	// Create liquidation record
	liq := &model.Liquidation{
		UserID:  pos.UserID,
		InstID:  pos.InstID,
		PosSide: pos.PosSide,
		Sz:      pos.Pos,
		Px:      markPrice,
		Loss:    pnl.Neg(),
		Ts:      time.Now().UnixMilli(),
	}

	if err := k.db.Create(liq).Error; err != nil {
		k.logger.Error("Failed to create liquidation record", zap.Error(err))
		k.liquidationsFailed++
		return
	}

	// Clear position
	pos.Pos = model.Zero()
	pos.AvailPos = model.Zero()
	pos.Margin = model.Zero()
	pos.UTime = time.Now().UnixMilli()

	if err := k.positionRepo.Update(pos); err != nil {
		k.logger.Error("Failed to update position after liquidation", zap.Error(err))
		k.liquidationsFailed++
		return
	}

	k.liquidationsExecuted++
}

// GetMetrics returns keeper metrics
func (k *LiquidationKeeper) GetMetrics() map[string]interface{} {
	return map[string]interface{}{
		"liquidations_executed": k.liquidationsExecuted,
		"liquidations_failed":   k.liquidationsFailed,
		"last_check_time":       k.lastCheckTime,
		"blockchain_enabled":    k.ethClient != nil,
	}
}
