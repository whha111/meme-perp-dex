package jwt

import (
	"fmt"
	"time"

	"github.com/golang-jwt/jwt/v5"
)

// Claims represents the JWT claims
type Claims struct {
	Address string `json:"address"`
	UserID  int64  `json:"user_id"`
	jwt.RegisteredClaims
}

// Manager handles JWT token generation and validation
type Manager struct {
	secret         []byte
	accessTokenExp  time.Duration
	refreshTokenExp time.Duration
}

// NewManager creates a new JWT manager
func NewManager(secret string, accessTokenExp time.Duration) *Manager {
	return &Manager{
		secret:          []byte(secret),
		accessTokenExp:  accessTokenExp,
		refreshTokenExp: accessTokenExp * 7, // Refresh token lasts 7x longer
	}
}

// GenerateAccessToken generates an access token for the user
func (m *Manager) GenerateAccessToken(address string, userID int64) (string, error) {
	now := time.Now()
	claims := Claims{
		Address: address,
		UserID:  userID,
		RegisteredClaims: jwt.RegisteredClaims{
			ExpiresAt: jwt.NewNumericDate(now.Add(m.accessTokenExp)),
			IssuedAt:  jwt.NewNumericDate(now),
			NotBefore: jwt.NewNumericDate(now),
		},
	}

	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	return token.SignedString(m.secret)
}

// GenerateTokenPair generates both access and refresh tokens
func (m *Manager) GenerateTokenPair(address string, userID int64) (accessToken, refreshToken string, err error) {
	// Generate access token
	accessToken, err = m.GenerateAccessToken(address, userID)
	if err != nil {
		return "", "", fmt.Errorf("failed to generate access token: %w", err)
	}

	// Generate refresh token
	now := time.Now()
	refreshClaims := Claims{
		Address: address,
		UserID:  userID,
		RegisteredClaims: jwt.RegisteredClaims{
			ExpiresAt: jwt.NewNumericDate(now.Add(m.refreshTokenExp)),
			IssuedAt:  jwt.NewNumericDate(now),
			NotBefore: jwt.NewNumericDate(now),
		},
	}

	token := jwt.NewWithClaims(jwt.SigningMethodHS256, refreshClaims)
	refreshToken, err = token.SignedString(m.secret)
	if err != nil {
		return "", "", fmt.Errorf("failed to generate refresh token: %w", err)
	}

	return accessToken, refreshToken, nil
}

// ValidateToken validates a JWT token and returns the claims
func (m *Manager) ValidateToken(tokenString string) (*Claims, error) {
	token, err := jwt.ParseWithClaims(tokenString, &Claims{}, func(token *jwt.Token) (interface{}, error) {
		// Validate signing method
		if _, ok := token.Method.(*jwt.SigningMethodHMAC); !ok {
			return nil, fmt.Errorf("unexpected signing method: %v", token.Header["alg"])
		}
		return m.secret, nil
	})

	if err != nil {
		return nil, fmt.Errorf("failed to parse token: %w", err)
	}

	if claims, ok := token.Claims.(*Claims); ok && token.Valid {
		// Additional validation: check expiration
		if claims.ExpiresAt != nil && claims.ExpiresAt.Before(time.Now()) {
			return nil, fmt.Errorf("token has expired")
		}
		return claims, nil
	}

	return nil, fmt.Errorf("invalid token")
}

// RefreshAccessToken generates a new access token from a valid refresh token
func (m *Manager) RefreshAccessToken(refreshToken string) (string, error) {
	claims, err := m.ValidateToken(refreshToken)
	if err != nil {
		return "", fmt.Errorf("invalid refresh token: %w", err)
	}

	// Generate new access token
	return m.GenerateAccessToken(claims.Address, claims.UserID)
}
