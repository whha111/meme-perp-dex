package service

import (
	"fmt"
	"time"

	"github.com/memeperp/backend/internal/model"
	"github.com/memeperp/backend/internal/pkg/database"
	"github.com/memeperp/backend/internal/pkg/errors"
	"github.com/memeperp/backend/internal/repository"
)

type TradeService struct {
	orderRepo      *repository.OrderRepository
	positionRepo   *repository.PositionRepository
	balanceRepo    *repository.BalanceRepository
	instrumentRepo *repository.InstrumentRepository
	billRepo       *repository.BillRepository
	cache          *database.Cache
}

func NewTradeService(
	orderRepo *repository.OrderRepository,
	positionRepo *repository.PositionRepository,
	balanceRepo *repository.BalanceRepository,
	instrumentRepo *repository.InstrumentRepository,
	billRepo *repository.BillRepository,
	cache *database.Cache,
) *TradeService {
	return &TradeService{
		orderRepo:      orderRepo,
		positionRepo:   positionRepo,
		balanceRepo:    balanceRepo,
		instrumentRepo: instrumentRepo,
		billRepo:       billRepo,
		cache:          cache,
	}
}

type PlaceOrderRequest struct {
	InstID      string        `json:"instId" binding:"required"`
	TdMode      string        `json:"tdMode" binding:"required"`
	Side        string        `json:"side" binding:"required"`
	PosSide     string        `json:"posSide" binding:"required"`
	OrdType     string        `json:"ordType" binding:"required"`
	Sz          model.Decimal `json:"sz" binding:"required"`
	Px          model.Decimal `json:"px"`
	Lever       int16         `json:"lever"`
	ClOrdID     string        `json:"clOrdId"`
	ReduceOnly  bool          `json:"reduceOnly"`
	TpTriggerPx model.Decimal `json:"tpTriggerPx"`
	SlTriggerPx model.Decimal `json:"slTriggerPx"`
}

func (s *TradeService) PlaceOrder(userID int64, req *PlaceOrderRequest) (*model.Order, error) {
	// Validate instrument
	inst, err := s.instrumentRepo.GetByInstID(req.InstID)
	if err != nil {
		return nil, errors.New(errors.CodeInstrumentNotFound)
	}
	if inst.State != "live" {
		return nil, errors.New(errors.CodeInstrumentSuspended)
	}

	// Validate order params
	if err := s.validateOrderParams(req, inst); err != nil {
		return nil, err
	}

	// Get or create leverage setting
	lever := req.Lever
	if lever == 0 {
		setting, _ := s.positionRepo.GetLeverageSetting(userID, req.InstID, req.TdMode, req.PosSide)
		if setting != nil {
			lever = setting.Lever
		} else {
			lever = 20 // Default leverage
		}
	}

	// Calculate required margin
	marginRequired := s.calculateMargin(req.Sz, req.Px, lever)

	// Check balance if not reduce only
	if !req.ReduceOnly {
		balance, err := s.balanceRepo.GetByUserAndCcy(userID, inst.SettleCcy)
		if err != nil || balance.AvailBal.LessThan(marginRequired) {
			return nil, errors.New(errors.CodeInsufficientBalance)
		}

		// Freeze margin
		if err := s.balanceRepo.FreezeBalance(userID, inst.SettleCcy, marginRequired); err != nil {
			return nil, err
		}
	}

	// Create order
	now := time.Now().UnixMilli()
	order := &model.Order{
		OrdID:       generateOrderID(),
		ClOrdID:     req.ClOrdID,
		UserID:      userID,
		InstID:      req.InstID,
		TdMode:      req.TdMode,
		Side:        req.Side,
		PosSide:     req.PosSide,
		OrdType:     req.OrdType,
		Sz:          req.Sz,
		Px:          req.Px,
		State:       model.OrderStateLive,
		Lever:       lever,
		ReduceOnly:  req.ReduceOnly,
		TpTriggerPx: req.TpTriggerPx,
		SlTriggerPx: req.SlTriggerPx,
		CTime:       now,
		UTime:       now,
	}

	// For market orders, execute immediately
	if req.OrdType == model.OrderTypeMarket {
		order.State = model.OrderStateFilled
		order.AccFillSz = req.Sz
		// In a real implementation, this would match against the order book
		// For now, use the provided price or mark price
		if req.Px.IsZero() {
			// Get mark price
			order.AvgPx = req.Px // Should get from price feed
		} else {
			order.AvgPx = req.Px
		}

		// Update position
		if err := s.updatePosition(userID, order, marginRequired); err != nil {
			// Rollback margin freeze
			s.balanceRepo.UnfreezeBalance(userID, inst.SettleCcy, marginRequired)
			return nil, err
		}
	}

	if err := s.orderRepo.Create(order); err != nil {
		// Rollback margin freeze
		s.balanceRepo.UnfreezeBalance(userID, inst.SettleCcy, marginRequired)
		return nil, err
	}

	return order, nil
}

func (s *TradeService) CancelOrder(userID int64, instID, ordID, clOrdID string) (*model.Order, error) {
	var order *model.Order
	var err error

	if ordID != "" {
		order, err = s.orderRepo.GetByOrdID(ordID)
	} else if clOrdID != "" {
		order, err = s.orderRepo.GetByClOrdID(userID, clOrdID)
	} else {
		return nil, errors.New(errors.CodeEmptyRequest)
	}

	if err != nil {
		return nil, errors.New(errors.CodeOrderNotFound)
	}

	if order.UserID != userID {
		return nil, errors.New(errors.CodePermissionDenied)
	}

	if order.State != model.OrderStateLive && order.State != model.OrderStatePartiallyFilled {
		return nil, errors.New(errors.CodeOrderCanceled)
	}

	// Calculate unfilled margin
	unfilledSz := order.Sz.Sub(order.AccFillSz)
	marginToReturn := s.calculateMargin(unfilledSz, order.Px, order.Lever)

	// Update order state
	order.State = model.OrderStateCanceled
	order.UTime = time.Now().UnixMilli()

	if err := s.orderRepo.Update(order); err != nil {
		return nil, err
	}

	// Return frozen margin
	inst, _ := s.instrumentRepo.GetByInstID(order.InstID)
	if inst != nil {
		s.balanceRepo.UnfreezeBalance(userID, inst.SettleCcy, marginToReturn)
	}

	return order, nil
}

func (s *TradeService) AmendOrder(userID int64, instID, ordID, clOrdID string, newSz, newPx model.Decimal) (*model.Order, error) {
	var order *model.Order
	var err error

	if ordID != "" {
		order, err = s.orderRepo.GetByOrdID(ordID)
	} else if clOrdID != "" {
		order, err = s.orderRepo.GetByClOrdID(userID, clOrdID)
	} else {
		return nil, errors.New(errors.CodeEmptyRequest)
	}

	if err != nil {
		return nil, errors.New(errors.CodeOrderNotFound)
	}

	if order.UserID != userID {
		return nil, errors.New(errors.CodePermissionDenied)
	}

	if order.State != model.OrderStateLive && order.State != model.OrderStatePartiallyFilled {
		return nil, errors.New(errors.CodeOrderCanceled)
	}

	// Update order
	if !newSz.IsZero() {
		order.Sz = newSz
	}
	if !newPx.IsZero() {
		order.Px = newPx
	}
	order.UTime = time.Now().UnixMilli()

	if err := s.orderRepo.Update(order); err != nil {
		return nil, err
	}

	return order, nil
}

func (s *TradeService) ClosePosition(userID int64, instID, posSide, mgnMode string) error {
	pos, err := s.positionRepo.GetByUserAndInst(userID, instID, posSide, mgnMode)
	if err != nil {
		return errors.New(errors.CodePositionNotFound)
	}

	if pos.Pos.IsZero() {
		return errors.New(errors.CodePositionNotFound)
	}

	// Create a market order to close position
	side := model.SideSell
	if posSide == model.PosSideShort {
		side = model.SideBuy
	}

	_, err = s.PlaceOrder(userID, &PlaceOrderRequest{
		InstID:     instID,
		TdMode:     mgnMode,
		Side:       side,
		PosSide:    posSide,
		OrdType:    model.OrderTypeMarket,
		Sz:         pos.Pos.Abs(),
		ReduceOnly: true,
	})

	return err
}

func (s *TradeService) GetOrder(userID int64, instID, ordID, clOrdID string) (*model.Order, error) {
	var order *model.Order
	var err error

	if ordID != "" {
		order, err = s.orderRepo.GetByOrdID(ordID)
	} else if clOrdID != "" {
		order, err = s.orderRepo.GetByClOrdID(userID, clOrdID)
	} else {
		return nil, errors.New(errors.CodeEmptyRequest)
	}

	if err != nil {
		return nil, errors.New(errors.CodeOrderNotFound)
	}

	if order.UserID != userID {
		return nil, errors.New(errors.CodePermissionDenied)
	}

	return order, nil
}

func (s *TradeService) GetPendingOrders(userID int64, instID string, limit int) ([]model.Order, error) {
	if limit <= 0 || limit > 100 {
		limit = 100
	}
	return s.orderRepo.GetPendingByUser(userID, instID, limit)
}

func (s *TradeService) GetOrderHistory(userID int64, instID string, after, before int64, limit int) ([]model.Order, error) {
	if limit <= 0 || limit > 100 {
		limit = 100
	}
	return s.orderRepo.GetHistoryByUser(userID, instID, after, before, limit)
}

// Algo order methods
type PlaceAlgoOrderRequest struct {
	InstID      string        `json:"instId" binding:"required"`
	TdMode      string        `json:"tdMode" binding:"required"`
	Side        string        `json:"side" binding:"required"`
	PosSide     string        `json:"posSide" binding:"required"`
	OrdType     string        `json:"ordType" binding:"required"`
	Sz          model.Decimal `json:"sz" binding:"required"`
	TpTriggerPx model.Decimal `json:"tpTriggerPx"`
	TpOrdPx     model.Decimal `json:"tpOrdPx"`
	SlTriggerPx model.Decimal `json:"slTriggerPx"`
	SlOrdPx     model.Decimal `json:"slOrdPx"`
}

func (s *TradeService) PlaceAlgoOrder(userID int64, req *PlaceAlgoOrderRequest) (*model.AlgoOrder, error) {
	now := time.Now().UnixMilli()
	order := &model.AlgoOrder{
		AlgoID:      generateAlgoID(),
		UserID:      userID,
		InstID:      req.InstID,
		TdMode:      req.TdMode,
		Side:        req.Side,
		PosSide:     req.PosSide,
		OrdType:     req.OrdType,
		Sz:          req.Sz,
		TpTriggerPx: req.TpTriggerPx,
		TpOrdPx:     req.TpOrdPx,
		SlTriggerPx: req.SlTriggerPx,
		SlOrdPx:     req.SlOrdPx,
		State:       model.AlgoStateLive,
		CTime:       now,
		UTime:       now,
	}

	if err := s.orderRepo.CreateAlgo(order); err != nil {
		return nil, err
	}

	return order, nil
}

func (s *TradeService) CancelAlgoOrder(userID int64, algoID string) error {
	order, err := s.orderRepo.GetAlgoByID(algoID)
	if err != nil {
		return errors.New(errors.CodeOrderNotFound)
	}

	if order.UserID != userID {
		return errors.New(errors.CodePermissionDenied)
	}

	if order.State != model.AlgoStateLive {
		return errors.New(errors.CodeOrderCanceled)
	}

	order.State = model.AlgoStateCanceled
	order.UTime = time.Now().UnixMilli()

	return s.orderRepo.UpdateAlgo(order)
}

func (s *TradeService) GetPendingAlgoOrders(userID int64, instID string, limit int) ([]model.AlgoOrder, error) {
	if limit <= 0 || limit > 100 {
		limit = 100
	}
	return s.orderRepo.GetPendingAlgoByUser(userID, instID, limit)
}

// Helper methods

func (s *TradeService) validateOrderParams(req *PlaceOrderRequest, inst *model.Instrument) error {
	// Validate side
	if req.Side != model.SideBuy && req.Side != model.SideSell {
		return errors.New(errors.CodeInvalidSide)
	}

	// Validate position side
	if req.PosSide != model.PosSideLong && req.PosSide != model.PosSideShort {
		return errors.New(errors.CodeInvalidSide)
	}

	// Validate order type
	validTypes := []string{model.OrderTypeMarket, model.OrderTypeLimit, model.OrderTypePostOnly, model.OrderTypeFOK, model.OrderTypeIOC}
	isValidType := false
	for _, t := range validTypes {
		if req.OrdType == t {
			isValidType = true
			break
		}
	}
	if !isValidType {
		return errors.New(errors.CodeInvalidOrderType)
	}

	// Validate size
	if req.Sz.LessThan(inst.MinSz) {
		return errors.New(errors.CodeQuantityTooSmall)
	}

	// Validate price for limit orders
	if req.OrdType == model.OrderTypeLimit && req.Px.IsZero() {
		return errors.New(errors.CodeEmptyRequest)
	}

	// Validate trade mode
	if req.TdMode != model.TdModeCross && req.TdMode != model.TdModeIsolated {
		return errors.New(errors.CodeAccountTypeError)
	}

	// Validate leverage
	if req.Lever > inst.MaxLever {
		return errors.New(errors.CodeExceedMaxLeverage)
	}

	return nil
}

func (s *TradeService) calculateMargin(sz, px model.Decimal, lever int16) model.Decimal {
	if px.IsZero() || lever == 0 {
		return model.Zero()
	}
	// margin = sz * px / lever
	notional := sz.Mul(px)
	return notional.Div(model.NewDecimalFromInt(int64(lever)))
}

func (s *TradeService) updatePosition(userID int64, order *model.Order, marginUsed model.Decimal) error {
	pos, err := s.positionRepo.GetOrCreate(userID, order.InstID, order.PosSide, order.TdMode, order.Lever)
	if err != nil {
		return err
	}

	now := time.Now().UnixMilli()

	// Update position based on order side
	if (order.Side == model.SideBuy && order.PosSide == model.PosSideLong) ||
		(order.Side == model.SideSell && order.PosSide == model.PosSideShort) {
		// Opening position
		if pos.Pos.IsZero() {
			pos.AvgPx = order.AvgPx
		} else {
			// Calculate new average price
			totalCost := pos.Pos.Mul(pos.AvgPx).Add(order.AccFillSz.Mul(order.AvgPx))
			newTotal := pos.Pos.Add(order.AccFillSz)
			pos.AvgPx = totalCost.Div(newTotal)
		}
		pos.Pos = pos.Pos.Add(order.AccFillSz)
		pos.AvailPos = pos.AvailPos.Add(order.AccFillSz)
		pos.Margin = pos.Margin.Add(marginUsed)
	} else {
		// Closing position
		pos.Pos = pos.Pos.Sub(order.AccFillSz)
		pos.AvailPos = pos.AvailPos.Sub(order.AccFillSz)

		// Calculate PnL
		var pnl model.Decimal
		if order.PosSide == model.PosSideLong {
			pnl = order.AccFillSz.Mul(order.AvgPx.Sub(pos.AvgPx))
		} else {
			pnl = order.AccFillSz.Mul(pos.AvgPx.Sub(order.AvgPx))
		}
		order.Pnl = pnl

		// Return margin proportionally
		if !pos.Margin.IsZero() {
			marginReturn := marginUsed.Mul(order.AccFillSz).Div(pos.Pos.Add(order.AccFillSz))
			pos.Margin = pos.Margin.Sub(marginReturn)
		}
	}

	// Generate position ID if new
	if pos.PosID == "" {
		pos.PosID = generatePosID()
		pos.CTime = now
	}
	pos.UTime = now
	pos.Lever = order.Lever

	// Recalculate liquidation price
	if !pos.Pos.IsZero() {
		pos.LiqPx = calculateLiqPrice(pos)
	}

	return s.positionRepo.Update(pos)
}

func calculateLiqPrice(pos *model.Position) model.Decimal {
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

func generateOrderID() string {
	return fmt.Sprintf("ORD%d", time.Now().UnixNano())
}

func generateAlgoID() string {
	return fmt.Sprintf("ALGO%d", time.Now().UnixNano())
}

func generatePosID() string {
	return fmt.Sprintf("POS%d", time.Now().UnixNano())
}
