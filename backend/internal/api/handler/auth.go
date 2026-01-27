package handler

import (
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/ethereum/go-ethereum/accounts"
	"github.com/ethereum/go-ethereum/common"
	"github.com/ethereum/go-ethereum/common/hexutil"
	"github.com/ethereum/go-ethereum/crypto"
	"github.com/gin-gonic/gin"
	"gorm.io/gorm"

	"github.com/memeperp/backend/internal/model"
	"github.com/memeperp/backend/internal/pkg/jwt"
	"github.com/memeperp/backend/internal/repository"
)

// AuthHandler handles authentication endpoints
type AuthHandler struct {
	userRepo   *repository.UserRepository
	jwtManager *jwt.Manager
}

// NewAuthHandler creates a new auth handler
func NewAuthHandler(db *gorm.DB, jwtManager *jwt.Manager) *AuthHandler {
	return &AuthHandler{
		userRepo:   repository.NewUserRepository(db),
		jwtManager: jwtManager,
	}
}

// NonceRequest is the request for getting a nonce
type NonceRequest struct {
	Address string `json:"address" binding:"required"`
}

// NonceResponse is the response containing the nonce to sign
type NonceResponse struct {
	Nonce   string `json:"nonce"`
	Message string `json:"message"`
}

// LoginRequest is the request for login
type LoginRequest struct {
	Address   string `json:"address" binding:"required"`
	Signature string `json:"signature" binding:"required"`
	Nonce     string `json:"nonce" binding:"required"`
}

// LoginResponse is the response after successful login
type LoginResponse struct {
	APIKey       string `json:"apiKey"`
	APISecret    string `json:"apiSecret"`
	AccessToken  string `json:"accessToken"`   // JWT for WebSocket/REST
	RefreshToken string `json:"refreshToken"`  // JWT for token refresh
	Address      string `json:"address"`
	ExpiresAt    int64  `json:"expiresAt"`
}

// nonce storage (in production, use Redis)
var nonceStore = make(map[string]nonceInfo)

type nonceInfo struct {
	Nonce     string
	ExpiresAt time.Time
}

// GetNonce returns a nonce for the user to sign
// @Summary Get login nonce
// @Tags Auth
// @Accept json
// @Produce json
// @Param request body NonceRequest true "Address"
// @Success 200 {object} NonceResponse
// @Router /api/v1/auth/nonce [post]
func (h *AuthHandler) GetNonce(c *gin.Context) {
	var req NonceRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{
			"code": "40000",
			"msg":  "Invalid request: " + err.Error(),
			"data": nil,
		})
		return
	}

	// Validate address format
	if !common.IsHexAddress(req.Address) {
		c.JSON(http.StatusBadRequest, gin.H{
			"code": "40001",
			"msg":  "Invalid Ethereum address",
			"data": nil,
		})
		return
	}

	// Generate random nonce
	nonce := generateNonce()
	message := fmt.Sprintf("Sign this message to login to MemePerpDEX.\n\nNonce: %s\nTimestamp: %d",
		nonce, time.Now().Unix())

	// Store nonce with expiration (5 minutes)
	nonceStore[strings.ToLower(req.Address)] = nonceInfo{
		Nonce:     nonce,
		ExpiresAt: time.Now().Add(5 * time.Minute),
	}

	c.JSON(http.StatusOK, gin.H{
		"code": "0",
		"msg":  "success",
		"data": NonceResponse{
			Nonce:   nonce,
			Message: message,
		},
	})
}

// Login verifies the signature and returns API credentials
// @Summary Login with wallet signature
// @Tags Auth
// @Accept json
// @Produce json
// @Param request body LoginRequest true "Login request"
// @Success 200 {object} LoginResponse
// @Router /api/v1/auth/login [post]
func (h *AuthHandler) Login(c *gin.Context) {
	var req LoginRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{
			"code": "40000",
			"msg":  "Invalid request: " + err.Error(),
			"data": nil,
		})
		return
	}

	// Validate address format
	address := strings.ToLower(req.Address)
	if !common.IsHexAddress(address) {
		c.JSON(http.StatusBadRequest, gin.H{
			"code": "40001",
			"msg":  "Invalid Ethereum address",
			"data": nil,
		})
		return
	}

	// Check nonce
	storedNonce, exists := nonceStore[address]
	if !exists {
		c.JSON(http.StatusBadRequest, gin.H{
			"code": "40002",
			"msg":  "Nonce not found, please request a new one",
			"data": nil,
		})
		return
	}

	// Check nonce expiration
	if time.Now().After(storedNonce.ExpiresAt) {
		delete(nonceStore, address)
		c.JSON(http.StatusBadRequest, gin.H{
			"code": "40003",
			"msg":  "Nonce expired, please request a new one",
			"data": nil,
		})
		return
	}

	// Verify nonce matches
	if storedNonce.Nonce != req.Nonce {
		c.JSON(http.StatusBadRequest, gin.H{
			"code": "40004",
			"msg":  "Invalid nonce",
			"data": nil,
		})
		return
	}

	// Build the message that was signed
	message := fmt.Sprintf("Sign this message to login to MemePerpDEX.\n\nNonce: %s", req.Nonce)

	// Verify signature
	recoveredAddr, err := recoverAddress(message, req.Signature)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{
			"code": "40005",
			"msg":  "Invalid signature: " + err.Error(),
			"data": nil,
		})
		return
	}

	if strings.ToLower(recoveredAddr.Hex()) != address {
		c.JSON(http.StatusBadRequest, gin.H{
			"code": "40006",
			"msg":  "Signature does not match address",
			"data": nil,
		})
		return
	}

	// Delete used nonce
	delete(nonceStore, address)

	// Get or create user
	user, err := h.userRepo.GetByAddress(req.Address)
	if err == gorm.ErrRecordNotFound {
		// Create new user with API credentials
		apiKey := generateAPIKey()
		apiSecret := generateAPISecret()

		user = &model.User{
			Address:   req.Address,
			APIKey:    apiKey,
			APISecret: apiSecret,
		}

		if err := h.userRepo.Create(user); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{
				"code": "50000",
				"msg":  "Failed to create user",
				"data": nil,
			})
			return
		}
	} else if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{
			"code": "50000",
			"msg":  "Database error",
			"data": nil,
		})
		return
	} else {
		// User exists, regenerate API credentials
		user.APIKey = generateAPIKey()
		user.APISecret = generateAPISecret()

		if err := h.userRepo.Update(user); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{
				"code": "50000",
				"msg":  "Failed to update user",
				"data": nil,
			})
			return
		}
	}

	// Generate JWT tokens
	accessToken, refreshToken, err := h.jwtManager.GenerateTokenPair(user.Address, user.ID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{
			"code": "50001",
			"msg":  "Failed to generate JWT tokens",
			"data": nil,
		})
		return
	}

	// Return API credentials and JWT tokens
	c.JSON(http.StatusOK, gin.H{
		"code": "0",
		"msg":  "success",
		"data": LoginResponse{
			APIKey:       user.APIKey,
			APISecret:    user.APISecret,
			AccessToken:  accessToken,
			RefreshToken: refreshToken,
			Address:      user.Address,
			ExpiresAt:    time.Now().Add(30 * 24 * time.Hour).Unix(), // 30 days
		},
	})
}

// generateNonce generates a random nonce
func generateNonce() string {
	bytes := make([]byte, 16)
	rand.Read(bytes)
	return hex.EncodeToString(bytes)
}

// generateAPIKey generates a random API key
func generateAPIKey() string {
	bytes := make([]byte, 32)
	rand.Read(bytes)
	return hex.EncodeToString(bytes)
}

// generateAPISecret generates a random API secret
func generateAPISecret() string {
	bytes := make([]byte, 64)
	rand.Read(bytes)
	return hex.EncodeToString(bytes)
}

// recoverAddress recovers the address from a signed message
func recoverAddress(message, signatureHex string) (common.Address, error) {
	// Decode signature
	signature, err := hexutil.Decode(signatureHex)
	if err != nil {
		return common.Address{}, fmt.Errorf("invalid signature format: %w", err)
	}

	if len(signature) != 65 {
		return common.Address{}, fmt.Errorf("invalid signature length: %d", len(signature))
	}

	// Adjust v value for Ethereum personal sign
	if signature[64] >= 27 {
		signature[64] -= 27
	}

	// Hash the message with Ethereum prefix
	hash := accounts.TextHash([]byte(message))

	// Recover public key
	pubKey, err := crypto.SigToPub(hash, signature)
	if err != nil {
		return common.Address{}, fmt.Errorf("failed to recover public key: %w", err)
	}

	// Get address from public key
	address := crypto.PubkeyToAddress(*pubKey)
	return address, nil
}
