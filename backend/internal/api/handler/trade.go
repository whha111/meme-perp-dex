package handler

import (
	"github.com/gin-gonic/gin"

	"github.com/memeperp/backend/internal/api/middleware"
	"github.com/memeperp/backend/internal/api/response"
	"github.com/memeperp/backend/internal/model"
	"github.com/memeperp/backend/internal/pkg/errors"
	"github.com/memeperp/backend/internal/service"
)

type TradeHandler struct {
	tradeService *service.TradeService
}

func NewTradeHandler(tradeService *service.TradeService) *TradeHandler {
	return &TradeHandler{tradeService: tradeService}
}

// PlaceOrder places a new order
// POST /api/v1/trade/order
func (h *TradeHandler) PlaceOrder(c *gin.Context) {
	userID, ok := middleware.GetUserID(c)
	if !ok {
		response.Error(c, errors.New(errors.CodeInvalidAPIKey))
		return
	}

	var req service.PlaceOrderRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		response.Error(c, errors.Wrap(errors.CodeEmptyRequest, err))
		return
	}

	order, err := h.tradeService.PlaceOrder(userID, &req)
	if err != nil {
		response.Error(c, err)
		return
	}

	response.SuccessOrder(c, order.OrdID, order.ClOrdID)
}

// CancelOrder cancels an order
// POST /api/v1/trade/cancel-order
func (h *TradeHandler) CancelOrder(c *gin.Context) {
	userID, ok := middleware.GetUserID(c)
	if !ok {
		response.Error(c, errors.New(errors.CodeInvalidAPIKey))
		return
	}

	var req struct {
		InstID  string `json:"instId" binding:"required"`
		OrdID   string `json:"ordId"`
		ClOrdID string `json:"clOrdId"`
	}

	if err := c.ShouldBindJSON(&req); err != nil {
		response.Error(c, errors.Wrap(errors.CodeEmptyRequest, err))
		return
	}

	order, err := h.tradeService.CancelOrder(userID, req.InstID, req.OrdID, req.ClOrdID)
	if err != nil {
		response.Error(c, err)
		return
	}

	response.SuccessOrder(c, order.OrdID, order.ClOrdID)
}

// AmendOrder modifies an existing order
// POST /api/v1/trade/amend-order
func (h *TradeHandler) AmendOrder(c *gin.Context) {
	userID, ok := middleware.GetUserID(c)
	if !ok {
		response.Error(c, errors.New(errors.CodeInvalidAPIKey))
		return
	}

	var req struct {
		InstID  string `json:"instId" binding:"required"`
		OrdID   string `json:"ordId"`
		ClOrdID string `json:"clOrdId"`
		NewSz   string `json:"newSz"`
		NewPx   string `json:"newPx"`
	}

	if err := c.ShouldBindJSON(&req); err != nil {
		response.Error(c, errors.Wrap(errors.CodeEmptyRequest, err))
		return
	}

	newSz, _ := parseDecimal(req.NewSz)
	newPx, _ := parseDecimal(req.NewPx)

	order, err := h.tradeService.AmendOrder(userID, req.InstID, req.OrdID, req.ClOrdID, newSz, newPx)
	if err != nil {
		response.Error(c, err)
		return
	}

	response.SuccessOrder(c, order.OrdID, order.ClOrdID)
}

// ClosePosition closes a position at market price
// POST /api/v1/trade/close-position
func (h *TradeHandler) ClosePosition(c *gin.Context) {
	userID, ok := middleware.GetUserID(c)
	if !ok {
		response.Error(c, errors.New(errors.CodeInvalidAPIKey))
		return
	}

	var req struct {
		InstID  string `json:"instId" binding:"required"`
		PosSide string `json:"posSide" binding:"required"`
		MgnMode string `json:"mgnMode" binding:"required"`
	}

	if err := c.ShouldBindJSON(&req); err != nil {
		response.Error(c, errors.Wrap(errors.CodeEmptyRequest, err))
		return
	}

	if err := h.tradeService.ClosePosition(userID, req.InstID, req.PosSide, req.MgnMode); err != nil {
		response.Error(c, err)
		return
	}

	response.Success(c, gin.H{
		"instId":  req.InstID,
		"posSide": req.PosSide,
	})
}

// GetOrder returns order details
// GET /api/v1/trade/order
func (h *TradeHandler) GetOrder(c *gin.Context) {
	userID, ok := middleware.GetUserID(c)
	if !ok {
		response.Error(c, errors.New(errors.CodeInvalidAPIKey))
		return
	}

	instID := c.Query("instId")
	ordID := c.Query("ordId")
	clOrdID := c.Query("clOrdId")

	if instID == "" {
		response.Error(c, errors.New(errors.CodeEmptyRequest))
		return
	}

	order, err := h.tradeService.GetOrder(userID, instID, ordID, clOrdID)
	if err != nil {
		response.Error(c, err)
		return
	}

	response.Success(c, order)
}

// GetPendingOrders returns pending orders
// GET /api/v1/trade/orders-pending
func (h *TradeHandler) GetPendingOrders(c *gin.Context) {
	userID, ok := middleware.GetUserID(c)
	if !ok {
		response.Error(c, errors.New(errors.CodeInvalidAPIKey))
		return
	}

	instID := c.Query("instId")
	limit := int(parseIntParam(c.Query("limit"), 100))

	orders, err := h.tradeService.GetPendingOrders(userID, instID, limit)
	if err != nil {
		response.Error(c, err)
		return
	}

	response.Success(c, orders)
}

// GetOrderHistory returns order history
// GET /api/v1/trade/orders-history
func (h *TradeHandler) GetOrderHistory(c *gin.Context) {
	userID, ok := middleware.GetUserID(c)
	if !ok {
		response.Error(c, errors.New(errors.CodeInvalidAPIKey))
		return
	}

	instID := c.Query("instId")
	after := parseIntParam(c.Query("after"), 0)
	before := parseIntParam(c.Query("before"), 0)
	limit := int(parseIntParam(c.Query("limit"), 100))

	orders, err := h.tradeService.GetOrderHistory(userID, instID, after, before, limit)
	if err != nil {
		response.Error(c, err)
		return
	}

	response.Success(c, orders)
}

// PlaceAlgoOrder places a stop-loss/take-profit order
// POST /api/v1/trade/order-algo
func (h *TradeHandler) PlaceAlgoOrder(c *gin.Context) {
	userID, ok := middleware.GetUserID(c)
	if !ok {
		response.Error(c, errors.New(errors.CodeInvalidAPIKey))
		return
	}

	var req service.PlaceAlgoOrderRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		response.Error(c, errors.Wrap(errors.CodeEmptyRequest, err))
		return
	}

	order, err := h.tradeService.PlaceAlgoOrder(userID, &req)
	if err != nil {
		response.Error(c, err)
		return
	}

	response.Success(c, gin.H{
		"algoId": order.AlgoID,
		"sCode":  "0",
		"sMsg":   "",
	})
}

// CancelAlgoOrder cancels an algo order
// POST /api/v1/trade/cancel-algos
func (h *TradeHandler) CancelAlgoOrder(c *gin.Context) {
	userID, ok := middleware.GetUserID(c)
	if !ok {
		response.Error(c, errors.New(errors.CodeInvalidAPIKey))
		return
	}

	var req struct {
		AlgoID string `json:"algoId" binding:"required"`
		InstID string `json:"instId" binding:"required"`
	}

	if err := c.ShouldBindJSON(&req); err != nil {
		response.Error(c, errors.Wrap(errors.CodeEmptyRequest, err))
		return
	}

	if err := h.tradeService.CancelAlgoOrder(userID, req.AlgoID); err != nil {
		response.Error(c, err)
		return
	}

	response.Success(c, gin.H{
		"algoId": req.AlgoID,
		"sCode":  "0",
		"sMsg":   "",
	})
}

// GetPendingAlgoOrders returns pending algo orders
// GET /api/v1/trade/orders-algo-pending
func (h *TradeHandler) GetPendingAlgoOrders(c *gin.Context) {
	userID, ok := middleware.GetUserID(c)
	if !ok {
		response.Error(c, errors.New(errors.CodeInvalidAPIKey))
		return
	}

	instID := c.Query("instId")
	limit := int(parseIntParam(c.Query("limit"), 100))

	orders, err := h.tradeService.GetPendingAlgoOrders(userID, instID, limit)
	if err != nil {
		response.Error(c, err)
		return
	}

	response.Success(c, orders)
}

func parseDecimal(s string) (model.Decimal, error) {
	return model.NewDecimalFromString(s)
}
