package service

import (
	"context"
	"time"

	"gorm.io/gorm"

	"github.com/memeperp/backend/internal/model"
	"github.com/memeperp/backend/internal/pkg/database"
	"github.com/memeperp/backend/internal/pkg/errors"
	"github.com/memeperp/backend/internal/repository"
)

type PositionService struct {
	positionRepo   *repository.PositionRepository
	balanceRepo    *repository.BalanceRepository
	instrumentRepo *repository.InstrumentRepository
	billRepo       *repository.BillRepository
	cache          *database.Cache
}

func NewPositionService(
	positionRepo *repository.PositionRepository,
	balanceRepo *repository.BalanceRepository,
	instrumentRepo *repository.InstrumentRepository,
	billRepo *repository.BillRepository,
	cache *database.Cache,
) *PositionService {
	return &PositionService{
		positionRepo:   positionRepo,
		balanceRepo:    balanceRepo,
		instrumentRepo: instrumentRepo,
		billRepo:       billRepo,
		cache:          cache,
	}
}

// GetPositions returns all positions for a user with calculated UPL
func (s *PositionService) GetPositions(userID int64, instID string) ([]model.Position, error) {
	positions, err := s.positionRepo.GetByUser(userID, instID)
	if err != nil && err != gorm.ErrRecordNotFound {
		return nil, err
	}

	// Calculate UPL for each position using mark price
	for i := range positions {
		markPx := s.getMarkPrice(positions[i].InstID)
		if !markPx.IsZero() {
			positions[i].MarkPx = markPx
			positions[i].Upl = s.calculateUPL(&positions[i], markPx)
			positions[i].UplRatio = s.calculateUPLRatio(&positions[i])
			positions[i].MgnRatio = s.calculateMgnRatio(&positions[i])
		}
	}

	return positions, nil
}

// GetPosition returns a single position with calculated UPL
func (s *PositionService) GetPosition(userID int64, posID string) (*model.Position, error) {
	pos, err := s.positionRepo.GetByPosID(posID)
	if err != nil {
		return nil, errors.New(errors.CodePositionNotFound)
	}

	if pos.UserID != userID {
		return nil, errors.New(errors.CodePermissionDenied)
	}

	// Calculate UPL
	markPx := s.getMarkPrice(pos.InstID)
	if !markPx.IsZero() {
		pos.MarkPx = markPx
		pos.Upl = s.calculateUPL(pos, markPx)
		pos.UplRatio = s.calculateUPLRatio(pos)
		pos.MgnRatio = s.calculateMgnRatio(pos)
	}

	return pos, nil
}

// GetPositionByInstID returns a position for a specific instrument
func (s *PositionService) GetPositionByInstID(userID int64, instID, posSide, mgnMode string) (*model.Position, error) {
	pos, err := s.positionRepo.GetByUserAndInst(userID, instID, posSide, mgnMode)
	if err != nil {
		return nil, errors.New(errors.CodePositionNotFound)
	}

	// Calculate UPL
	markPx := s.getMarkPrice(pos.InstID)
	if !markPx.IsZero() {
		pos.MarkPx = markPx
		pos.Upl = s.calculateUPL(pos, markPx)
		pos.UplRatio = s.calculateUPLRatio(pos)
		pos.MgnRatio = s.calculateMgnRatio(pos)
	}

	return pos, nil
}

// GetAllNonZeroPositions returns all positions with non-zero size (for keeper)
func (s *PositionService) GetAllNonZeroPositions() ([]model.Position, error) {
	positions, err := s.positionRepo.GetAllNonZero()
	if err != nil {
		return nil, err
	}

	// Calculate UPL for each position
	for i := range positions {
		markPx := s.getMarkPrice(positions[i].InstID)
		if !markPx.IsZero() {
			positions[i].MarkPx = markPx
			positions[i].Upl = s.calculateUPL(&positions[i], markPx)
			positions[i].UplRatio = s.calculateUPLRatio(&positions[i])
			positions[i].MgnRatio = s.calculateMgnRatio(&positions[i])
		}
	}

	return positions, nil
}

// GetPositionsByInstrument returns all positions for an instrument
func (s *PositionService) GetPositionsByInstrument(instID string) ([]model.Position, error) {
	positions, err := s.positionRepo.GetByInstID(instID)
	if err != nil {
		return nil, err
	}

	markPx := s.getMarkPrice(instID)
	for i := range positions {
		if !markPx.IsZero() {
			positions[i].MarkPx = markPx
			positions[i].Upl = s.calculateUPL(&positions[i], markPx)
			positions[i].UplRatio = s.calculateUPLRatio(&positions[i])
			positions[i].MgnRatio = s.calculateMgnRatio(&positions[i])
		}
	}

	return positions, nil
}

// UpdatePositionUPL updates unrealized PnL for a position
func (s *PositionService) UpdatePositionUPL(pos *model.Position, markPx model.Decimal) error {
	pos.Upl = s.calculateUPL(pos, markPx)
	pos.UplRatio = s.calculateUPLRatio(pos)
	pos.MgnRatio = s.calculateMgnRatio(pos)
	pos.UTime = time.Now().UnixMilli()

	return s.positionRepo.Update(pos)
}

// UpdateAllPositionsUPL updates UPL for all positions of an instrument (for keeper)
func (s *PositionService) UpdateAllPositionsUPL(instID string, markPx model.Decimal) error {
	positions, err := s.positionRepo.GetByInstID(instID)
	if err != nil {
		return err
	}

	for _, pos := range positions {
		pos.Upl = s.calculateUPL(&pos, markPx)
		pos.UplRatio = s.calculateUPLRatio(&pos)
		pos.MgnRatio = s.calculateMgnRatio(&pos)
		pos.UTime = time.Now().UnixMilli()

		if err := s.positionRepo.Update(&pos); err != nil {
			return err
		}

		// Update user's balance UPL
		if err := s.updateBalanceUPL(pos.UserID, instID, pos.Upl); err != nil {
			return err
		}
	}

	return nil
}

// SetLeverage sets the leverage for a position
func (s *PositionService) SetLeverage(userID int64, instID string, lever int16, mgnMode, posSide string) error {
	// Validate leverage
	inst, err := s.instrumentRepo.GetByInstID(instID)
	if err != nil {
		return errors.New(errors.CodeInstrumentNotFound)
	}

	if lever < 1 || lever > inst.MaxLever {
		return errors.New(errors.CodeInvalidLeverage)
	}

	// Check if user has open positions
	positions, err := s.positionRepo.GetByUser(userID, instID)
	if err != nil && err != gorm.ErrRecordNotFound {
		return err
	}

	for _, pos := range positions {
		if !pos.Pos.IsZero() && pos.MgnMode == mgnMode {
			// Check if decreasing leverage with open position
			if lever < pos.Lever {
				// Need to add more margin
				additionalMargin := s.calculateAdditionalMargin(&pos, lever)
				balance, err := s.balanceRepo.GetByUserAndCcy(userID, inst.SettleCcy)
				if err != nil || balance.AvailBal.LessThan(additionalMargin) {
					return errors.New(errors.CodeInsufficientBalance)
				}
			}
		}
	}

	// Save leverage setting
	setting := &model.LeverageSetting{
		UserID:  userID,
		InstID:  instID,
		MgnMode: mgnMode,
		PosSide: posSide,
		Lever:   lever,
		UTime:   time.Now().UnixMilli(),
	}

	return s.positionRepo.SetLeverageSetting(setting)
}

// GetLeverageInfo returns leverage settings for an instrument
func (s *PositionService) GetLeverageInfo(userID int64, instID, mgnMode string) (*model.LeverageSetting, error) {
	setting, err := s.positionRepo.GetLeverageSetting(userID, instID, mgnMode, "")
	if err == gorm.ErrRecordNotFound {
		return &model.LeverageSetting{
			InstID:  instID,
			MgnMode: mgnMode,
			Lever:   20, // Default leverage
			UTime:   time.Now().UnixMilli(),
		}, nil
	}
	return setting, err
}

// AdjustMargin adjusts the margin for an isolated position
func (s *PositionService) AdjustMargin(userID int64, instID, posSide, adjustType string, amount model.Decimal) error {
	pos, err := s.positionRepo.GetByUserAndInst(userID, instID, posSide, model.TdModeIsolated)
	if err != nil {
		return errors.New(errors.CodePositionNotFound)
	}

	inst, err := s.instrumentRepo.GetByInstID(instID)
	if err != nil {
		return errors.New(errors.CodeInstrumentNotFound)
	}

	if adjustType == "add" {
		balance, err := s.balanceRepo.GetByUserAndCcy(userID, inst.SettleCcy)
		if err != nil || balance.AvailBal.LessThan(amount) {
			return errors.New(errors.CodeInsufficientBalance)
		}

		if err := s.balanceRepo.FreezeBalance(userID, inst.SettleCcy, amount); err != nil {
			return err
		}

		pos.Margin = pos.Margin.Add(amount)
	} else if adjustType == "reduce" {
		// Check if we can reduce margin
		minMargin := pos.Mmr
		if pos.Margin.Sub(amount).LessThan(minMargin) {
			return errors.New(errors.CodeCannotAdjustMargin)
		}

		pos.Margin = pos.Margin.Sub(amount)

		if err := s.balanceRepo.UnfreezeBalance(userID, inst.SettleCcy, amount); err != nil {
			return err
		}
	} else {
		return errors.New(errors.CodeEmptyRequest)
	}

	// Recalculate liquidation price
	pos.LiqPx = s.calculateLiquidationPrice(pos)
	pos.UTime = time.Now().UnixMilli()

	return s.positionRepo.Update(pos)
}

// calculateUPL calculates unrealized PnL
func (s *PositionService) calculateUPL(pos *model.Position, markPx model.Decimal) model.Decimal {
	if pos.Pos.IsZero() || pos.AvgPx.IsZero() {
		return model.Zero()
	}

	if pos.PosSide == model.PosSideLong {
		// Long: UPL = (markPx - avgPx) * pos
		return markPx.Sub(pos.AvgPx).Mul(pos.Pos)
	} else {
		// Short: UPL = (avgPx - markPx) * pos
		return pos.AvgPx.Sub(markPx).Mul(pos.Pos.Abs())
	}
}

// calculateUPLRatio calculates UPL ratio
func (s *PositionService) calculateUPLRatio(pos *model.Position) model.Decimal {
	if pos.Margin.IsZero() {
		return model.Zero()
	}
	return pos.Upl.Div(pos.Margin)
}

// calculateMgnRatio calculates margin ratio
func (s *PositionService) calculateMgnRatio(pos *model.Position) model.Decimal {
	if pos.Mmr.IsZero() {
		return model.Zero()
	}
	equity := pos.Margin.Add(pos.Upl)
	return equity.Div(pos.Mmr)
}

// calculateLiquidationPrice calculates the liquidation price
func (s *PositionService) calculateLiquidationPrice(pos *model.Position) model.Decimal {
	if pos.Pos.IsZero() {
		return model.Zero()
	}

	lever := model.NewDecimalFromInt(int64(pos.Lever))
	one := model.NewDecimalFromInt(1)
	mmrRate := model.NewDecimalFromFloat(0.005) // 0.5% maintenance margin rate

	if pos.PosSide == model.PosSideLong {
		factor := one.Sub(one.Div(lever)).Add(mmrRate)
		return pos.AvgPx.Mul(factor)
	} else {
		factor := one.Add(one.Div(lever)).Sub(mmrRate)
		return pos.AvgPx.Mul(factor)
	}
}

// calculateAdditionalMargin calculates additional margin needed when decreasing leverage
func (s *PositionService) calculateAdditionalMargin(pos *model.Position, newLever int16) model.Decimal {
	if pos.Pos.IsZero() {
		return model.Zero()
	}

	notional := pos.Pos.Mul(pos.AvgPx)
	currentMargin := notional.Div(model.NewDecimalFromInt(int64(pos.Lever)))
	newMargin := notional.Div(model.NewDecimalFromInt(int64(newLever)))

	if newMargin.GreaterThan(currentMargin) {
		return newMargin.Sub(currentMargin)
	}
	return model.Zero()
}

// getMarkPrice retrieves mark price from cache
func (s *PositionService) getMarkPrice(instID string) model.Decimal {
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

// updateBalanceUPL updates the UPL in user's balance
func (s *PositionService) updateBalanceUPL(userID int64, instID string, upl model.Decimal) error {
	inst, err := s.instrumentRepo.GetByInstID(instID)
	if err != nil {
		return err
	}

	balance, err := s.balanceRepo.GetOrCreate(userID, inst.SettleCcy)
	if err != nil {
		return err
	}

	balance.Upl = upl
	balance.UTime = time.Now().UnixMilli()

	return s.balanceRepo.Update(balance)
}

// PositionHistoryRequest represents position history query parameters
type PositionHistoryRequest struct {
	InstType string `form:"instType"`
	InstID   string `form:"instId"`
	After    int64  `form:"after"`
	Before   int64  `form:"before"`
	Limit    int    `form:"limit"`
}

// GetPositionHistory returns closed position history (positions that are now zero)
func (s *PositionService) GetPositionHistory(userID int64, req *PositionHistoryRequest) ([]model.Bill, error) {
	if req.Limit <= 0 || req.Limit > 100 {
		req.Limit = 100
	}

	// Get bills of type trade that closed positions
	return s.billRepo.GetByUser(userID, req.InstType, "", model.BillTypeTrade, req.After, req.Before, req.Limit)
}
