package keeper

import (
	"context"
	"fmt"
	"time"

	"go.uber.org/zap"
	"gorm.io/gorm"

	"github.com/memeperp/backend/internal/blockchain"
	"github.com/memeperp/backend/internal/model"
	"github.com/memeperp/backend/internal/pkg/config"
	"github.com/memeperp/backend/internal/pkg/database"
	"github.com/memeperp/backend/internal/repository"
)

// FundingKeeper settles funding rates every 4 hours
type FundingKeeper struct {
	db             *gorm.DB
	cache          *database.Cache
	cfg            *config.BlockchainConfig
	logger         *zap.Logger
	positionRepo   *repository.PositionRepository
	fundingRepo    *repository.FundingRateRepository
	instrumentRepo *repository.InstrumentRepository

	// Blockchain client and contract
	ethClient       *blockchain.Client
	fundingRateCtx  *blockchain.FundingRateContract

	// Metrics
	settlementsExecuted uint64
	settlementsFailed   uint64
	lastSettlementTime  time.Time
}

func NewFundingKeeper(db *gorm.DB, cache *database.Cache, cfg *config.BlockchainConfig, logger *zap.Logger) *FundingKeeper {
	return &FundingKeeper{
		db:             db,
		cache:          cache,
		cfg:            cfg,
		logger:         logger,
		positionRepo:   repository.NewPositionRepository(db),
		fundingRepo:    repository.NewFundingRateRepository(db),
		instrumentRepo: repository.NewInstrumentRepository(db),
	}
}

// InitBlockchain initializes blockchain connections
func (k *FundingKeeper) InitBlockchain() error {
	var err error

	// Initialize Ethereum client
	k.ethClient, err = blockchain.NewClient(k.cfg, nil, k.logger)
	if err != nil {
		return fmt.Errorf("failed to init eth client: %w", err)
	}

	// Initialize FundingRate contract
	if k.cfg.FundingRateAddr != "" {
		k.fundingRateCtx, err = blockchain.NewFundingRateContract(
			blockchain.HexToAddress(k.cfg.FundingRateAddr),
			k.ethClient,
		)
		if err != nil {
			return fmt.Errorf("failed to init funding rate contract: %w", err)
		}
		k.logger.Info("FundingRate contract initialized",
			zap.String("address", k.cfg.FundingRateAddr))
	}

	return nil
}

func (k *FundingKeeper) Start(ctx context.Context) {
	k.logger.Info("Funding keeper starting...")

	// Initialize blockchain connections
	if err := k.InitBlockchain(); err != nil {
		k.logger.Error("Failed to initialize blockchain, running in DB-only mode",
			zap.Error(err))
	} else {
		k.logger.Info("Blockchain integration enabled for funding settlement")
	}

	k.logger.Info("Funding keeper started",
		zap.String("schedule", "Every 4 hours at 00:00, 04:00, 08:00, 12:00, 16:00, 20:00 UTC"))

	// Check every minute for funding settlement time
	ticker := time.NewTicker(1 * time.Minute)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			k.logger.Info("Funding keeper stopped",
				zap.Uint64("totalSettlements", k.settlementsExecuted),
				zap.Uint64("failedSettlements", k.settlementsFailed))
			if k.ethClient != nil {
				k.ethClient.Close()
			}
			return
		case <-ticker.C:
			k.checkFundingTime(ctx)
		}
	}
}

func (k *FundingKeeper) checkFundingTime(ctx context.Context) {
	now := time.Now().UTC()

	// Funding settlement at 00:00, 04:00, 08:00, 12:00, 16:00, 20:00 UTC
	if now.Minute() == 0 && now.Hour()%4 == 0 {
		// Avoid double settlement within the same minute
		if time.Since(k.lastSettlementTime) > 30*time.Minute {
			k.settleFunding(ctx, now)
		}
	}
}

func (k *FundingKeeper) settleFunding(ctx context.Context, settlementTime time.Time) {
	fundingTime := settlementTime.Truncate(4 * time.Hour).UnixMilli()
	k.lastSettlementTime = settlementTime

	k.logger.Info("Starting funding rate settlement",
		zap.Int64("fundingTime", fundingTime),
		zap.Time("settlementTime", settlementTime))

	// Try on-chain settlement first
	if k.fundingRateCtx != nil {
		if err := k.settleFundingOnChain(ctx); err != nil {
			k.logger.Error("On-chain funding settlement failed, falling back to DB-only",
				zap.Error(err))
			k.settleFundingInDB(ctx, fundingTime)
		}
	} else {
		k.settleFundingInDB(ctx, fundingTime)
	}
}

// settleFundingOnChain settles funding rate on the blockchain
func (k *FundingKeeper) settleFundingOnChain(ctx context.Context) error {
	k.logger.Info("Executing on-chain funding settlement")

	// Call the contract's settleFunding function
	tx, err := k.fundingRateCtx.SettleFunding(ctx)
	if err != nil {
		k.settlementsFailed++
		return fmt.Errorf("failed to send settlement tx: %w", err)
	}

	k.logger.Info("Funding settlement transaction sent",
		zap.String("txHash", tx.Hash().Hex()))

	// Wait for confirmation
	receipt, err := k.ethClient.WaitForTransaction(ctx, tx)
	if err != nil {
		k.settlementsFailed++
		return fmt.Errorf("settlement tx failed: %w", err)
	}

	k.logger.Info("Funding settlement confirmed on-chain",
		zap.String("txHash", tx.Hash().Hex()),
		zap.Uint64("blockNumber", receipt.BlockNumber.Uint64()),
		zap.Uint64("gasUsed", receipt.GasUsed))

	k.settlementsExecuted++

	// Also update local database for consistency
	k.settleFundingInDB(ctx, time.Now().Truncate(4*time.Hour).UnixMilli())

	return nil
}

// settleFundingInDB settles funding in the local database
func (k *FundingKeeper) settleFundingInDB(ctx context.Context, fundingTime int64) {
	k.logger.Info("Settling funding rate in database",
		zap.Int64("fundingTime", fundingTime))

	// Get all instruments
	instruments, err := k.instrumentRepo.GetLive()
	if err != nil {
		k.logger.Error("Failed to get instruments", zap.Error(err))
		return
	}

	totalPositionsSettled := 0

	for _, inst := range instruments {
		fundingRate := k.calculateFundingRate(ctx, inst.InstID)

		// Save funding rate record
		rate := &model.FundingRate{
			InstID:       inst.InstID,
			FundingRate:  fundingRate,
			RealizedRate: fundingRate,
			FundingTime:  fundingTime,
		}

		if err := k.fundingRepo.Create(rate); err != nil {
			k.logger.Error("Failed to save funding rate",
				zap.String("instId", inst.InstID),
				zap.Error(err))
			continue
		}

		// Apply funding to all positions for this instrument
		positions, err := k.positionRepo.GetByInstID(inst.InstID)
		if err != nil {
			k.logger.Error("Failed to get positions",
				zap.String("instId", inst.InstID),
				zap.Error(err))
			continue
		}

		for _, pos := range positions {
			if err := k.applyFunding(&pos, fundingRate); err != nil {
				k.logger.Error("Failed to apply funding",
					zap.String("posId", pos.PosID),
					zap.Error(err))
			}
		}

		totalPositionsSettled += len(positions)

		k.logger.Debug("Funding settled for instrument",
			zap.String("instId", inst.InstID),
			zap.String("fundingRate", fundingRate.String()),
			zap.Int("positions", len(positions)))
	}

	k.logger.Info("Funding settlement complete",
		zap.Int("instruments", len(instruments)),
		zap.Int("positionsSettled", totalPositionsSettled))

	k.settlementsExecuted++
}

func (k *FundingKeeper) calculateFundingRate(ctx context.Context, instID string) model.Decimal {
	// If blockchain is available, try to get funding rate from contract
	if k.fundingRateCtx != nil {
		rate, err := k.fundingRateCtx.GetCurrentFundingRate(ctx)
		if err == nil && rate != nil {
			// Convert from contract format (scaled by 1e18) to decimal
			rateDecimal, _ := model.NewDecimalFromString(rate.String())
			// Divide by 1e18 to get actual rate
			divisor, _ := model.NewDecimalFromString("1000000000000000000")
			return rateDecimal.Div(divisor)
		}
		k.logger.Warn("Failed to get funding rate from chain, calculating locally",
			zap.Error(err))
	}

	// Fallback: calculate locally based on market skew
	// Funding rate formula: (markPrice - spotPrice) / spotPrice
	// Clamped to ±0.25%

	// Get positions to determine market skew
	positions, _ := k.positionRepo.GetByInstID(instID)

	var longSize, shortSize model.Decimal
	for _, pos := range positions {
		if pos.PosSide == model.PosSideLong {
			longSize = longSize.Add(pos.Pos)
		} else {
			shortSize = shortSize.Add(pos.Pos)
		}
	}

	// If more longs than shorts, positive funding rate (longs pay shorts)
	// If more shorts than longs, negative funding rate (shorts pay longs)
	if longSize.IsZero() && shortSize.IsZero() {
		return model.Zero()
	}

	totalSize := longSize.Add(shortSize)
	if totalSize.IsZero() {
		return model.Zero()
	}

	// Calculate imbalance
	imbalance := longSize.Sub(shortSize).Div(totalSize)

	// Scale to max ±0.25%
	maxRate, _ := model.NewDecimalFromString("0.0025")
	fundingRate := imbalance.Mul(maxRate)

	// Clamp
	if fundingRate.GreaterThan(maxRate) {
		fundingRate = maxRate
	}
	negMaxRate := maxRate.Neg()
	if fundingRate.LessThan(negMaxRate) {
		fundingRate = negMaxRate
	}

	return fundingRate
}

func (k *FundingKeeper) applyFunding(pos *model.Position, rate model.Decimal) error {
	// Calculate funding payment
	// For long: pay if rate > 0, receive if rate < 0
	// For short: receive if rate > 0, pay if rate < 0

	notional := pos.Pos.Mul(pos.AvgPx)
	fundingPayment := notional.Mul(rate)

	if pos.PosSide == model.PosSideLong {
		// Longs pay when rate is positive
		fundingPayment = fundingPayment.Neg()
	}

	// Update position margin
	pos.Margin = pos.Margin.Add(fundingPayment)
	pos.UTime = time.Now().UnixMilli()

	// Create bill record
	bill := &model.Bill{
		BillID: generateBillID(),
		UserID: pos.UserID,
		InstID: pos.InstID,
		Ccy:    "ETH", // Changed from BNB to ETH for Base chain
		Type:   model.BillTypeFunding,
		Bal:    pos.Margin,
		BalChg: fundingPayment,
		Ts:     time.Now().UnixMilli(),
	}

	if err := k.db.Create(bill).Error; err != nil {
		return err
	}

	return k.positionRepo.Update(pos)
}

// GetMetrics returns keeper metrics
func (k *FundingKeeper) GetMetrics() map[string]interface{} {
	return map[string]interface{}{
		"settlements_executed":  k.settlementsExecuted,
		"settlements_failed":    k.settlementsFailed,
		"last_settlement_time":  k.lastSettlementTime,
		"blockchain_enabled":    k.ethClient != nil,
	}
}

func generateBillID() string {
	return "BILL" + time.Now().Format("20060102150405") + randomString(6)
}

func randomString(n int) string {
	const letters = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"
	b := make([]byte, n)
	for i := range b {
		b[i] = letters[time.Now().UnixNano()%int64(len(letters))]
	}
	return string(b)
}
