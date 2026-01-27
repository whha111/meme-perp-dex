package service

import (
	"context"
	"fmt"
	"log"
	"time"

	"github.com/memeperp/backend/internal/model"
	"github.com/memeperp/backend/internal/pkg/database"
	"github.com/memeperp/backend/internal/pkg/errors"
	"github.com/memeperp/backend/internal/repository"
)

// LiquidationService handles position liquidations
type LiquidationService struct {
	positionRepo    *repository.PositionRepository
	balanceRepo     *repository.BalanceRepository
	instrumentRepo  *repository.InstrumentRepository
	liquidationRepo *repository.LiquidationRepository
	billRepo        *repository.BillRepository
	cache           *database.Cache
}

func NewLiquidationService(
	positionRepo *repository.PositionRepository,
	balanceRepo *repository.BalanceRepository,
	instrumentRepo *repository.InstrumentRepository,
	liquidationRepo *repository.LiquidationRepository,
	billRepo *repository.BillRepository,
	cache *database.Cache,
) *LiquidationService {
	return &LiquidationService{
		positionRepo:    positionRepo,
		balanceRepo:     balanceRepo,
		instrumentRepo:  instrumentRepo,
		liquidationRepo: liquidationRepo,
		billRepo:        billRepo,
		cache:           cache,
	}
}

// LiquidationConfig holds liquidation parameters
type LiquidationConfig struct {
	MMRRate         float64 // Maintenance Margin Rate (default 0.5%)
	LiquidatorBonus float64 // Bonus for liquidator (default 0.5%)
	InsuranceFee    float64 // Fee to insurance fund (default 0.25%)
}

var defaultLiqConfig = LiquidationConfig{
	MMRRate:         0.005,
	LiquidatorBonus: 0.005,
	InsuranceFee:    0.0025,
}

// CheckLiquidation checks if a position should be liquidated
func (s *LiquidationService) CheckLiquidation(pos *model.Position, markPx model.Decimal) (bool, model.Decimal) {
	if pos.Pos.IsZero() {
		return false, model.Zero()
	}

	// Calculate current margin ratio
	notional := pos.Pos.Abs().Mul(markPx)
	upl := s.calculateUPL(pos, markPx)
	equity := pos.Margin.Add(upl)

	mmr := notional.Mul(model.NewDecimalFromFloat(defaultLiqConfig.MMRRate))

	// Position should be liquidated if equity < MMR
	if equity.LessThan(mmr) {
		return true, equity
	}

	return false, equity
}

// CheckLiquidationByMgnRatio checks liquidation based on margin ratio
func (s *LiquidationService) CheckLiquidationByMgnRatio(pos *model.Position) bool {
	// Margin ratio < 1 means liquidation
	// MgnRatio = equity / MMR
	if !pos.MgnRatio.IsZero() && pos.MgnRatio.LessThan(model.NewDecimalFromInt(1)) {
		return true
	}
	return false
}

// ExecuteLiquidation executes a liquidation
func (s *LiquidationService) ExecuteLiquidation(ctx context.Context, pos *model.Position, markPx model.Decimal, liquidator string) (*model.Liquidation, error) {
	if pos.Pos.IsZero() {
		return nil, errors.New(errors.CodePositionNotExist)
	}

	// Double check liquidation condition
	shouldLiq, equity := s.CheckLiquidation(pos, markPx)
	if !shouldLiq {
		return nil, errors.Newf(errors.CodeOperationFailed, "position not eligible for liquidation")
	}

	now := time.Now().UnixMilli()

	// Calculate loss
	notional := pos.Pos.Abs().Mul(markPx)
	loss := pos.Margin.Sub(equity)
	if loss.LessThan(model.Zero()) {
		loss = model.Zero()
	}

	// Calculate liquidator reward
	liqReward := notional.Mul(model.NewDecimalFromFloat(defaultLiqConfig.LiquidatorBonus))

	// Get instrument for settlement currency
	inst, err := s.instrumentRepo.GetByInstID(pos.InstID)
	if err != nil {
		return nil, err
	}

	// Create liquidation record
	liq := &model.Liquidation{
		UserID:     pos.UserID,
		InstID:     pos.InstID,
		PosSide:    pos.PosSide,
		Sz:         pos.Pos.Abs(),
		Px:         markPx,
		Loss:       loss,
		Liquidator: liquidator,
		LiqReward:  liqReward,
		Ts:         now,
	}

	if err := s.liquidationRepo.Create(liq); err != nil {
		return nil, err
	}

	// Update user balance - deduct remaining margin and loss
	if err := s.balanceRepo.UpdateBalance(pos.UserID, inst.SettleCcy, loss.Neg()); err != nil {
		log.Printf("Failed to update balance for liquidation: %v", err)
	}

	// Create bill record
	bill := &model.Bill{
		BillID:  fmt.Sprintf("BILL%d", now),
		UserID:  pos.UserID,
		InstID:  pos.InstID,
		Ccy:     inst.SettleCcy,
		Type:    model.BillTypeLiquidation,
		Bal:     model.Zero(), // Will be updated with actual balance
		BalChg:  loss.Neg(),
		Sz:      pos.Pos.Abs(),
		Px:      markPx,
		Pnl:     loss.Neg(),
		Ts:      now,
	}

	if err := s.billRepo.Create(bill); err != nil {
		log.Printf("Failed to create liquidation bill: %v", err)
	}

	// Close the position
	pos.Pos = model.Zero()
	pos.AvailPos = model.Zero()
	pos.Margin = model.Zero()
	pos.Upl = model.Zero()
	pos.UplRatio = model.Zero()
	pos.MgnRatio = model.Zero()
	pos.UTime = now

	if err := s.positionRepo.Update(pos); err != nil {
		return nil, err
	}

	log.Printf("Liquidated position: user=%d, inst=%s, side=%s, sz=%s, px=%s, loss=%s",
		pos.UserID, pos.InstID, pos.PosSide, liq.Sz.String(), markPx.String(), loss.String())

	return liq, nil
}

// GetLiquidationsAtRisk returns positions that are at risk of liquidation
func (s *LiquidationService) GetLiquidationsAtRisk(instID string, threshold model.Decimal) ([]model.Position, error) {
	positions, err := s.positionRepo.GetByInstID(instID)
	if err != nil {
		return nil, err
	}

	markPx := s.getMarkPrice(instID)
	if markPx.IsZero() {
		return nil, errors.Newf(errors.CodeOperationFailed, "mark price not available")
	}

	var atRisk []model.Position
	for _, pos := range positions {
		// Calculate margin ratio
		notional := pos.Pos.Abs().Mul(markPx)
		upl := s.calculateUPL(&pos, markPx)
		equity := pos.Margin.Add(upl)
		mmr := notional.Mul(model.NewDecimalFromFloat(defaultLiqConfig.MMRRate))

		if !mmr.IsZero() {
			mgnRatio := equity.Div(mmr)
			// Positions with mgnRatio < threshold are at risk
			if mgnRatio.LessThan(threshold) {
				pos.MgnRatio = mgnRatio
				pos.Upl = upl
				atRisk = append(atRisk, pos)
			}
		}
	}

	return atRisk, nil
}

// CheckAndLiquidateAll checks all positions for an instrument and liquidates eligible ones
func (s *LiquidationService) CheckAndLiquidateAll(ctx context.Context, instID string, markPx model.Decimal, liquidator string) ([]model.Liquidation, error) {
	positions, err := s.positionRepo.GetByInstID(instID)
	if err != nil {
		return nil, err
	}

	var liquidations []model.Liquidation
	for _, pos := range positions {
		shouldLiq, _ := s.CheckLiquidation(&pos, markPx)
		if shouldLiq {
			liq, err := s.ExecuteLiquidation(ctx, &pos, markPx, liquidator)
			if err != nil {
				log.Printf("Failed to liquidate position %s: %v", pos.PosID, err)
				continue
			}
			liquidations = append(liquidations, *liq)
		}
	}

	return liquidations, nil
}

// GetLiquidationHistory returns liquidation history for a user
func (s *LiquidationService) GetLiquidationHistory(userID int64, instID string, after, before int64, limit int) ([]model.Liquidation, error) {
	if limit <= 0 || limit > 100 {
		limit = 100
	}
	return s.liquidationRepo.GetByUser(userID, instID, after, before, limit)
}

// GetRecentLiquidations returns recent liquidations for an instrument
func (s *LiquidationService) GetRecentLiquidations(instID string, limit int) ([]model.Liquidation, error) {
	if limit <= 0 || limit > 100 {
		limit = 100
	}
	return s.liquidationRepo.GetRecent(instID, limit)
}

// RecordOnChainLiquidation records a liquidation that happened on-chain
func (s *LiquidationService) RecordOnChainLiquidation(userID int64, instID, posSide string, sz, px, loss model.Decimal, liquidator, txHash string) error {
	liq := &model.Liquidation{
		UserID:     userID,
		InstID:     instID,
		PosSide:    posSide,
		Sz:         sz,
		Px:         px,
		Loss:       loss,
		Liquidator: liquidator,
		TxHash:     txHash,
		Ts:         time.Now().UnixMilli(),
	}

	return s.liquidationRepo.Create(liq)
}

// SendLiquidationWarning checks if a position is close to liquidation and returns warning info
func (s *LiquidationService) SendLiquidationWarning(pos *model.Position, markPx model.Decimal) *LiquidationWarning {
	if pos.Pos.IsZero() {
		return nil
	}

	notional := pos.Pos.Abs().Mul(markPx)
	upl := s.calculateUPL(pos, markPx)
	equity := pos.Margin.Add(upl)
	mmr := notional.Mul(model.NewDecimalFromFloat(defaultLiqConfig.MMRRate))

	if mmr.IsZero() {
		return nil
	}

	mgnRatio := equity.Div(mmr)
	warningThreshold := model.NewDecimalFromFloat(1.5) // Warn when mgnRatio < 1.5

	if mgnRatio.LessThan(warningThreshold) {
		return &LiquidationWarning{
			PosID:      pos.PosID,
			InstID:     pos.InstID,
			PosSide:    pos.PosSide,
			Pos:        pos.Pos.String(),
			MgnRatio:   mgnRatio.String(),
			LiqPx:      pos.LiqPx.String(),
			MarkPx:     markPx.String(),
			IsUrgent:   mgnRatio.LessThan(model.NewDecimalFromFloat(1.1)),
		}
	}

	return nil
}

// LiquidationWarning represents a warning for positions close to liquidation
type LiquidationWarning struct {
	PosID    string `json:"posId"`
	InstID   string `json:"instId"`
	PosSide  string `json:"posSide"`
	Pos      string `json:"pos"`
	MgnRatio string `json:"mgnRatio"`
	LiqPx    string `json:"liqPx"`
	MarkPx   string `json:"markPx"`
	IsUrgent bool   `json:"isUrgent"`
}

// calculateUPL calculates unrealized PnL
func (s *LiquidationService) calculateUPL(pos *model.Position, markPx model.Decimal) model.Decimal {
	if pos.Pos.IsZero() || pos.AvgPx.IsZero() {
		return model.Zero()
	}

	if pos.PosSide == model.PosSideLong {
		return markPx.Sub(pos.AvgPx).Mul(pos.Pos)
	} else {
		return pos.AvgPx.Sub(markPx).Mul(pos.Pos.Abs())
	}
}

// getMarkPrice retrieves mark price from cache
func (s *LiquidationService) getMarkPrice(instID string) model.Decimal {
	if s.cache == nil {
		return model.Zero()
	}

	priceStr, err := s.cache.GetMarkPrice(context.Background(), instID)
	if err != nil {
		return model.Zero()
	}

	price, err := model.NewDecimalFromString(priceStr)
	if err != nil {
		return model.Zero()
	}
	return price
}

// EstimateLiquidationPrice estimates the liquidation price for a position
func (s *LiquidationService) EstimateLiquidationPrice(pos *model.Position) model.Decimal {
	if pos.Pos.IsZero() {
		return model.Zero()
	}

	lever := model.NewDecimalFromInt(int64(pos.Lever))
	one := model.NewDecimalFromInt(1)
	mmrRate := model.NewDecimalFromFloat(defaultLiqConfig.MMRRate)

	if pos.PosSide == model.PosSideLong {
		// Long: liqPx = avgPx * (1 - 1/lever + mmrRate)
		factor := one.Sub(one.Div(lever)).Add(mmrRate)
		return pos.AvgPx.Mul(factor)
	} else {
		// Short: liqPx = avgPx * (1 + 1/lever - mmrRate)
		factor := one.Add(one.Div(lever)).Sub(mmrRate)
		return pos.AvgPx.Mul(factor)
	}
}
