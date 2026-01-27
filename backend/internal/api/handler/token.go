package handler

import (
	"time"

	"github.com/gin-gonic/gin"

	"github.com/memeperp/backend/internal/api/response"
	"github.com/memeperp/backend/internal/model"
	"github.com/memeperp/backend/internal/pkg/errors"
	"github.com/memeperp/backend/internal/repository"
)

type TokenHandler struct {
	tokenMetadataRepo *repository.TokenMetadataRepository
	instrumentRepo    *repository.InstrumentRepository
}

func NewTokenHandler(
	tokenMetadataRepo *repository.TokenMetadataRepository,
	instrumentRepo *repository.InstrumentRepository,
) *TokenHandler {
	return &TokenHandler{
		tokenMetadataRepo: tokenMetadataRepo,
		instrumentRepo:    instrumentRepo,
	}
}

// CreateTokenMetadataRequest represents the request body for creating token metadata
type CreateTokenMetadataRequest struct {
	InstID           string  `json:"instId" binding:"required"`
	TokenAddress     string  `json:"tokenAddress" binding:"required"`
	Name             string  `json:"name" binding:"required"`
	Symbol           string  `json:"symbol" binding:"required"`
	Description      string  `json:"description"`
	LogoURL          string  `json:"logoUrl"`
	ImageURL         string  `json:"imageUrl"`
	Website          string  `json:"website"`
	Twitter          string  `json:"twitter"`
	Telegram         string  `json:"telegram"`
	Discord          string  `json:"discord"`
	CreatorAddress   string  `json:"creatorAddress" binding:"required"`
	TotalSupply      string  `json:"totalSupply" binding:"required"`
	InitialBuyAmount string  `json:"initialBuyAmount"`
}

// CreateTokenMetadata creates or updates token metadata
// POST /api/v1/token/metadata
func (h *TokenHandler) CreateTokenMetadata(c *gin.Context) {
	var req CreateTokenMetadataRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		response.Error(c, errors.New(errors.CodeEmptyRequest))
		return
	}

	// Auto-create instrument if it doesn't exist (for new meme tokens)
	_, err := h.instrumentRepo.GetByInstID(req.InstID)
	if err != nil {
		// Instrument doesn't exist, create it automatically
		// Default values for meme token perpetual contracts
		tickSz, _ := model.NewDecimalFromString("0.000001")
		lotSz, _ := model.NewDecimalFromString("1")
		minSz, _ := model.NewDecimalFromString("1")
		ctVal, _ := model.NewDecimalFromString("1")

		newInstrument := &model.Instrument{
			InstID:    req.InstID,
			InstType:  "SWAP",
			BaseCcy:   req.Symbol,
			QuoteCcy:  "USDT",
			SettleCcy: "USDT",
			CtVal:     ctVal,
			TickSz:    tickSz,
			LotSz:     lotSz,
			MinSz:     minSz,
			MaxLever:  100,
			State:     "live",
			ListTime:  time.Now().UnixMilli(),
		}

		if createErr := h.instrumentRepo.Create(newInstrument); createErr != nil {
			response.Error(c, errors.New(errors.CodeSystemError))
			return
		}
	}

	// Parse decimal values
	totalSupply, err := model.NewDecimalFromString(req.TotalSupply)
	if err != nil {
		response.Error(c, errors.New(errors.CodeEmptyRequest))
		return
	}

	var initialBuyAmount model.Decimal
	if req.InitialBuyAmount != "" {
		initialBuyAmount, err = model.NewDecimalFromString(req.InitialBuyAmount)
		if err != nil {
			response.Error(c, errors.New(errors.CodeEmptyRequest))
			return
		}
	}

	// Check if metadata already exists
	existing, _ := h.tokenMetadataRepo.GetByInstID(req.InstID)

	if existing != nil {
		// Update existing metadata
		existing.Name = req.Name
		existing.Symbol = req.Symbol
		existing.Description = req.Description
		existing.LogoURL = req.LogoURL
		existing.ImageURL = req.ImageURL
		existing.Website = req.Website
		existing.Twitter = req.Twitter
		existing.Telegram = req.Telegram
		existing.Discord = req.Discord
		existing.TotalSupply = totalSupply
		existing.InitialBuyAmount = initialBuyAmount

		if err := h.tokenMetadataRepo.Update(existing); err != nil {
			response.Error(c, errors.New(errors.CodeSystemError))
			return
		}

		response.Success(c, existing)
		return
	}

	// Create new metadata
	metadata := &model.TokenMetadata{
		InstID:           req.InstID,
		TokenAddress:     req.TokenAddress,
		Name:             req.Name,
		Symbol:           req.Symbol,
		Description:      req.Description,
		LogoURL:          req.LogoURL,
		ImageURL:         req.ImageURL,
		Website:          req.Website,
		Twitter:          req.Twitter,
		Telegram:         req.Telegram,
		Discord:          req.Discord,
		CreatorAddress:   req.CreatorAddress,
		TotalSupply:      totalSupply,
		InitialBuyAmount: initialBuyAmount,
		IsGraduated:      false,
	}

	if err := h.tokenMetadataRepo.Create(metadata); err != nil {
		response.Error(c, errors.New(errors.CodeSystemError))
		return
	}

	response.Success(c, metadata)
}

// GetTokenMetadata retrieves token metadata by instId
// GET /api/v1/token/metadata
func (h *TokenHandler) GetTokenMetadata(c *gin.Context) {
	instID := c.Query("instId")
	if instID == "" {
		response.Error(c, errors.New(errors.CodeEmptyRequest))
		return
	}

	metadata, err := h.tokenMetadataRepo.GetByInstID(instID)
	if err != nil {
		response.Error(c, errors.New(errors.CodeAccountNotFound))
		return
	}

	response.Success(c, metadata)
}

// GetAllTokenMetadata retrieves all token metadata
// GET /api/v1/token/metadata/all
func (h *TokenHandler) GetAllTokenMetadata(c *gin.Context) {
	metadataList, err := h.tokenMetadataRepo.GetAll()
	if err != nil {
		response.Error(c, errors.New(errors.CodeSystemError))
		return
	}

	response.Success(c, metadataList)
}
