package middleware

import (
	"context"
	"fmt"
	"net/http"
	"time"

	"github.com/gin-gonic/gin"

	"github.com/memeperp/backend/internal/pkg/database"
	"github.com/memeperp/backend/internal/pkg/errors"
)

type RateLimiter struct {
	cache        *database.Cache
	publicLimit  int
	privateLimit int
	orderLimit   int
	window       time.Duration
}

func NewRateLimiter(cache *database.Cache, publicLimit, privateLimit, orderLimit int) *RateLimiter {
	return &RateLimiter{
		cache:        cache,
		publicLimit:  publicLimit,
		privateLimit: privateLimit,
		orderLimit:   orderLimit,
		window:       time.Minute,
	}
}

// RateLimitMiddleware limits request rate based on endpoint type
// Implements dual-layer rate limiting: both IP-based and user-based
// This prevents abuse even when using proxies/VPNs
func (rl *RateLimiter) RateLimitMiddleware(limitType string) gin.HandlerFunc {
	return func(c *gin.Context) {
		var limit int
		switch limitType {
		case "public":
			limit = rl.publicLimit
		case "private":
			limit = rl.privateLimit
		case "order":
			limit = rl.orderLimit
		default:
			limit = rl.publicLimit
		}

		ctx := context.Background()

		// Layer 1: IP-based rate limit (prevents DoS from single IP)
		ipKey := fmt.Sprintf("%s:ip:%s:%s", database.KeyRateLimit, c.ClientIP(), limitType)
		ipCount, err := rl.cache.IncrementRateLimit(ctx, ipKey, rl.window)
		if err == nil && int(ipCount) > limit*2 { // 2x limit for IP to allow multiple users behind NAT
			c.JSON(http.StatusTooManyRequests, gin.H{
				"code": errors.CodeRateLimitExceed,
				"msg":  "rate limit exceeded (IP)",
				"data": nil,
			})
			c.Abort()
			return
		}

		// Layer 2: User-based rate limit (if authenticated)
		var userKey string
		var userCount int64
		if userID, exists := GetUserID(c); exists {
			userKey = fmt.Sprintf("%s:user:%d:%s", database.KeyRateLimit, userID, limitType)
			userCount, err = rl.cache.IncrementRateLimit(ctx, userKey, rl.window)
			if err == nil && int(userCount) > limit {
				c.JSON(http.StatusTooManyRequests, gin.H{
					"code": errors.CodeRateLimitExceed,
					"msg":  "rate limit exceeded (user)",
					"data": nil,
				})
				c.Abort()
				return
			}
		} else {
			// For unauthenticated requests, use stricter IP limit
			if int(ipCount) > limit {
				c.JSON(http.StatusTooManyRequests, gin.H{
					"code": errors.CodeRateLimitExceed,
					"msg":  "rate limit exceeded",
					"data": nil,
				})
				c.Abort()
				return
			}
			userCount = ipCount
		}

		// Set rate limit headers (show user limit if authenticated)
		c.Header("X-RateLimit-Limit", fmt.Sprintf("%d", limit))
		c.Header("X-RateLimit-Remaining", fmt.Sprintf("%d", max(0, limit-int(userCount))))
		c.Header("X-RateLimit-Reset", fmt.Sprintf("%d", time.Now().Add(rl.window).Unix()))

		c.Next()
	}
}

func max(a, b int) int {
	if a > b {
		return a
	}
	return b
}
