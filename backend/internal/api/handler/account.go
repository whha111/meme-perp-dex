package handler

import (
	"github.com/gin-gonic/gin"

	"github.com/memeperp/backend/internal/api/middleware"
	"github.com/memeperp/backend/internal/api/response"
	"github.com/memeperp/backend/internal/model"
	"github.com/memeperp/backend/internal/pkg/errors"
	"github.com/memeperp/backend/internal/service"
)

type AccountHandler struct {
	accountService *service.AccountService
}

func NewAccountHandler(accountService *service.AccountService) *AccountHandler {
	return &AccountHandler{accountService: accountService}
}

// GetBalance returns account balance
// GET /api/v1/account/balance
func (h *AccountHandler) GetBalance(c *gin.Context) {
	userID, ok := middleware.GetUserID(c)
	if !ok {
		response.Error(c, errors.New(errors.CodeInvalidAPIKey))
		return
	}

	ccy := c.Query("ccy")

	balance, err := h.accountService.GetBalance(userID, ccy)
	if err != nil {
		response.Error(c, err)
		return
	}

	response.Success(c, balance)
}

// GetPositions returns user positions
// GET /api/v1/account/positions
func (h *AccountHandler) GetPositions(c *gin.Context) {
	userID, ok := middleware.GetUserID(c)
	if !ok {
		response.Error(c, errors.New(errors.CodeInvalidAPIKey))
		return
	}

	instID := c.Query("instId")

	positions, err := h.accountService.GetPositions(userID, instID)
	if err != nil {
		response.Error(c, err)
		return
	}

	response.Success(c, positions)
}

// SetLeverage sets leverage for an instrument
// POST /api/v1/account/set-leverage
func (h *AccountHandler) SetLeverage(c *gin.Context) {
	userID, ok := middleware.GetUserID(c)
	if !ok {
		response.Error(c, errors.New(errors.CodeInvalidAPIKey))
		return
	}

	var req struct {
		InstID  string `json:"instId" binding:"required"`
		Lever   string `json:"lever" binding:"required"`
		MgnMode string `json:"mgnMode" binding:"required"`
		PosSide string `json:"posSide"`
	}

	if err := c.ShouldBindJSON(&req); err != nil {
		response.Error(c, errors.Wrap(errors.CodeEmptyRequest, err))
		return
	}

	lever := parseIntParam(req.Lever, 20)

	if err := h.accountService.SetLeverage(userID, req.InstID, int16(lever), req.MgnMode, req.PosSide); err != nil {
		response.Error(c, err)
		return
	}

	response.Success(c, gin.H{
		"instId":  req.InstID,
		"lever":   req.Lever,
		"mgnMode": req.MgnMode,
		"posSide": req.PosSide,
	})
}

// GetLeverageInfo returns leverage settings
// GET /api/v1/account/leverage-info
func (h *AccountHandler) GetLeverageInfo(c *gin.Context) {
	userID, ok := middleware.GetUserID(c)
	if !ok {
		response.Error(c, errors.New(errors.CodeInvalidAPIKey))
		return
	}

	instID := c.Query("instId")
	mgnMode := c.Query("mgnMode")

	if instID == "" || mgnMode == "" {
		response.Error(c, errors.New(errors.CodeEmptyRequest))
		return
	}

	setting, err := h.accountService.GetLeverageInfo(userID, instID, mgnMode)
	if err != nil {
		response.Error(c, err)
		return
	}

	response.Success(c, []model.LeverageSetting{*setting})
}

// AdjustMargin adjusts isolated position margin
// POST /api/v1/account/position/margin-balance
func (h *AccountHandler) AdjustMargin(c *gin.Context) {
	userID, ok := middleware.GetUserID(c)
	if !ok {
		response.Error(c, errors.New(errors.CodeInvalidAPIKey))
		return
	}

	var req struct {
		InstID  string        `json:"instId" binding:"required"`
		PosSide string        `json:"posSide" binding:"required"`
		Type    string        `json:"type" binding:"required"` // add, reduce
		Amt     model.Decimal `json:"amt" binding:"required"`
	}

	if err := c.ShouldBindJSON(&req); err != nil {
		response.Error(c, errors.Wrap(errors.CodeEmptyRequest, err))
		return
	}

	if err := h.accountService.AdjustMargin(userID, req.InstID, req.PosSide, req.Type, req.Amt); err != nil {
		response.Error(c, err)
		return
	}

	response.Success(c, gin.H{
		"instId":  req.InstID,
		"posSide": req.PosSide,
		"type":    req.Type,
		"amt":     req.Amt.String(),
	})
}

// GetBills returns account bills
// GET /api/v1/account/bills
func (h *AccountHandler) GetBills(c *gin.Context) {
	userID, ok := middleware.GetUserID(c)
	if !ok {
		response.Error(c, errors.New(errors.CodeInvalidAPIKey))
		return
	}

	instType := c.Query("instType")
	ccy := c.Query("ccy")
	billType := int16(parseIntParam(c.Query("type"), 0))
	after := parseIntParam(c.Query("after"), 0)
	before := parseIntParam(c.Query("before"), 0)
	limit := int(parseIntParam(c.Query("limit"), 100))

	bills, err := h.accountService.GetBills(userID, instType, ccy, billType, after, before, limit)
	if err != nil {
		response.Error(c, err)
		return
	}

	response.Success(c, bills)
}
