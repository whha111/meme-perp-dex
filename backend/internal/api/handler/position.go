package handler

import (
	"github.com/gin-gonic/gin"

	"github.com/memeperp/backend/internal/api/middleware"
	"github.com/memeperp/backend/internal/api/response"
	"github.com/memeperp/backend/internal/pkg/errors"
	"github.com/memeperp/backend/internal/service"
)

type PositionHandler struct {
	positionService    *service.PositionService
	liquidationService *service.LiquidationService
}

func NewPositionHandler(positionService *service.PositionService, liquidationService *service.LiquidationService) *PositionHandler {
	return &PositionHandler{
		positionService:    positionService,
		liquidationService: liquidationService,
	}
}

// GetPositions returns user positions with UPL
// GET /api/v1/account/positions
//
// RESPONSIBILITY: Returns positions from database (indexed from blockchain events).
// This includes both active and recently closed positions.
//
// For real-time current positions from Matching Engine:
// GET http://localhost:8081/api/user/{address}/positions
//
// DIFFERENCE:
//   - Go Backend (this): Historical view from database, includes PnL calculations
//   - Matching Engine: Real-time in-memory state of active positions
func (h *PositionHandler) GetPositions(c *gin.Context) {
	userID, ok := middleware.GetUserID(c)
	if !ok {
		response.Error(c, errors.New(errors.CodeInvalidAPIKey))
		return
	}

	instID := c.Query("instId")

	positions, err := h.positionService.GetPositions(userID, instID)
	if err != nil {
		response.Error(c, err)
		return
	}

	response.Success(c, positions)
}

// GetPosition returns a single position
// GET /api/v1/account/position
func (h *PositionHandler) GetPosition(c *gin.Context) {
	userID, ok := middleware.GetUserID(c)
	if !ok {
		response.Error(c, errors.New(errors.CodeInvalidAPIKey))
		return
	}

	posID := c.Query("posId")
	if posID == "" {
		response.Error(c, errors.New(errors.CodeEmptyRequest))
		return
	}

	position, err := h.positionService.GetPosition(userID, posID)
	if err != nil {
		response.Error(c, err)
		return
	}

	response.Success(c, position)
}

// GetPositionHistory returns closed position history
// GET /api/v1/account/positions-history
func (h *PositionHandler) GetPositionHistory(c *gin.Context) {
	userID, ok := middleware.GetUserID(c)
	if !ok {
		response.Error(c, errors.New(errors.CodeInvalidAPIKey))
		return
	}

	req := &service.PositionHistoryRequest{
		InstType: c.Query("instType"),
		InstID:   c.Query("instId"),
		After:    parseIntParam(c.Query("after"), 0),
		Before:   parseIntParam(c.Query("before"), 0),
		Limit:    int(parseIntParam(c.Query("limit"), 100)),
	}

	history, err := h.positionService.GetPositionHistory(userID, req)
	if err != nil {
		response.Error(c, err)
		return
	}

	response.Success(c, history)
}

// GetLiquidationHistory returns liquidation history
// GET /api/v1/account/liquidations
func (h *PositionHandler) GetLiquidationHistory(c *gin.Context) {
	userID, ok := middleware.GetUserID(c)
	if !ok {
		response.Error(c, errors.New(errors.CodeInvalidAPIKey))
		return
	}

	instID := c.Query("instId")
	after := parseIntParam(c.Query("after"), 0)
	before := parseIntParam(c.Query("before"), 0)
	limit := int(parseIntParam(c.Query("limit"), 100))

	liquidations, err := h.liquidationService.GetLiquidationHistory(userID, instID, after, before, limit)
	if err != nil {
		response.Error(c, err)
		return
	}

	response.Success(c, liquidations)
}

// GetRecentLiquidations returns recent public liquidations
// GET /api/v1/market/liquidations
func (h *PositionHandler) GetRecentLiquidations(c *gin.Context) {
	instID := c.Query("instId")
	limit := int(parseIntParam(c.Query("limit"), 100))

	liquidations, err := h.liquidationService.GetRecentLiquidations(instID, limit)
	if err != nil {
		response.Error(c, err)
		return
	}

	response.Success(c, liquidations)
}
