package handler

import (
	"net/http"

	"github.com/gin-gonic/gin"
	"go.uber.org/zap"

	"github.com/memeperp/backend/internal/service"
)

// RelayerHandler handles meta transaction relay requests
type RelayerHandler struct {
	relayer *service.RelayerService
	logger  *zap.Logger
}

// NewRelayerHandler creates a new relayer handler
func NewRelayerHandler(relayer *service.RelayerService, logger *zap.Logger) *RelayerHandler {
	return &RelayerHandler{
		relayer: relayer,
		logger:  logger,
	}
}

// DepositETH handles ETH deposit relay requests
// POST /api/v1/relay/deposit-eth
func (h *RelayerHandler) DepositETH(c *gin.Context) {
	var req service.DepositETHRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{
			"success": false,
			"error":   "invalid request: " + err.Error(),
		})
		return
	}

	// Validate required fields
	if req.User == "" || req.Amount == "" || req.Signature == "" {
		c.JSON(http.StatusBadRequest, gin.H{
			"success": false,
			"error":   "missing required fields: user, amount, signature",
		})
		return
	}

	result, err := h.relayer.DepositETH(c.Request.Context(), &req)
	if err != nil {
		h.logger.Error("Deposit ETH relay failed", zap.Error(err))
		c.JSON(http.StatusInternalServerError, gin.H{
			"success": false,
			"error":   "internal error: " + err.Error(),
		})
		return
	}

	if result.Success {
		c.JSON(http.StatusOK, result)
	} else {
		c.JSON(http.StatusBadRequest, result)
	}
}

// Withdraw handles withdrawal relay requests
// POST /api/v1/relay/withdraw
func (h *RelayerHandler) Withdraw(c *gin.Context) {
	var req service.WithdrawRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{
			"success": false,
			"error":   "invalid request: " + err.Error(),
		})
		return
	}

	// Validate required fields
	if req.User == "" || req.Token == "" || req.Amount == "" || req.Signature == "" {
		c.JSON(http.StatusBadRequest, gin.H{
			"success": false,
			"error":   "missing required fields: user, token, amount, signature",
		})
		return
	}

	result, err := h.relayer.Withdraw(c.Request.Context(), &req)
	if err != nil {
		h.logger.Error("Withdraw relay failed", zap.Error(err))
		c.JSON(http.StatusInternalServerError, gin.H{
			"success": false,
			"error":   "internal error: " + err.Error(),
		})
		return
	}

	if result.Success {
		c.JSON(http.StatusOK, result)
	} else {
		c.JSON(http.StatusBadRequest, result)
	}
}

// GetNonce gets the meta transaction nonce for a user
// GET /api/v1/relay/nonce/:address
func (h *RelayerHandler) GetNonce(c *gin.Context) {
	address := c.Param("address")
	if address == "" {
		c.JSON(http.StatusBadRequest, gin.H{
			"success": false,
			"error":   "address is required",
		})
		return
	}

	nonce, err := h.relayer.GetMetaTxNonce(c.Request.Context(), address)
	if err != nil {
		h.logger.Error("Failed to get nonce", zap.Error(err))
		c.JSON(http.StatusInternalServerError, gin.H{
			"success": false,
			"error":   "failed to get nonce: " + err.Error(),
		})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"nonce":   nonce.String(),
	})
}

// GetBalance gets the user's balance in the Settlement contract
// GET /api/v1/relay/balance/:address
func (h *RelayerHandler) GetBalance(c *gin.Context) {
	address := c.Param("address")
	if address == "" {
		c.JSON(http.StatusBadRequest, gin.H{
			"success": false,
			"error":   "address is required",
		})
		return
	}

	available, locked, err := h.relayer.GetUserBalance(c.Request.Context(), address)
	if err != nil {
		h.logger.Error("Failed to get balance", zap.Error(err))
		c.JSON(http.StatusInternalServerError, gin.H{
			"success": false,
			"error":   "failed to get balance: " + err.Error(),
		})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"success":   true,
		"available": available.String(),
		"locked":    locked.String(),
	})
}

// GetRelayerStatus gets the relayer's status
// GET /api/v1/relay/status
func (h *RelayerHandler) GetRelayerStatus(c *gin.Context) {
	balance, err := h.relayer.GetRelayerBalance(c.Request.Context())
	if err != nil {
		h.logger.Error("Failed to get relayer balance", zap.Error(err))
		c.JSON(http.StatusInternalServerError, gin.H{
			"success": false,
			"error":   "failed to get relayer status: " + err.Error(),
		})
		return
	}

	weth, _ := h.relayer.GetWETHAddress(c.Request.Context())

	c.JSON(http.StatusOK, gin.H{
		"success":        true,
		"relayerBalance": balance.String(),
		"wethAddress":    weth,
	})
}
