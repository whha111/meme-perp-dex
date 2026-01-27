package middleware

import (
	"github.com/gin-gonic/gin"
	"github.com/memeperp/backend/internal/pkg/config"
)

// CORSMiddleware handles Cross-Origin Resource Sharing with security controls
// Based on OWASP best practices: https://cheatsheetseries.owasp.org/cheatsheets/Cross-Origin_Resource_Sharing_Cheat_Sheet.html
func CORSMiddleware(cfg *config.Config) gin.HandlerFunc {
	allowedOrigins := cfg.Security.AllowedOrigins
	if len(allowedOrigins) == 0 {
		// Fallback to localhost for development if not configured
		allowedOrigins = []string{"http://localhost:3000"}
	}

	return func(c *gin.Context) {
		origin := c.Request.Header.Get("Origin")

		// Check if origin is in whitelist
		isAllowed := false
		for _, allowed := range allowedOrigins {
			if origin == allowed {
				isAllowed = true
				break
			}
		}

		// Only set CORS headers if origin is allowed
		if isAllowed {
			c.Header("Access-Control-Allow-Origin", origin) // Echo the specific origin, not "*"
			c.Header("Access-Control-Allow-Credentials", "true")
			c.Header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
			c.Header("Access-Control-Allow-Headers", "Origin, Content-Type, Accept, Authorization, X-MBX-APIKEY, X-MBX-SIGNATURE, X-MBX-TIMESTAMP")
			c.Header("Access-Control-Expose-Headers", "X-RateLimit-Limit, X-RateLimit-Remaining, X-RateLimit-Reset")
			c.Header("Access-Control-Max-Age", "86400")
		}

		if c.Request.Method == "OPTIONS" {
			if isAllowed {
				c.AbortWithStatus(204)
			} else {
				// Reject preflight from unauthorized origins
				c.AbortWithStatus(403)
			}
			return
		}

		// For non-OPTIONS requests from unauthorized origins, let them through
		// but without CORS headers (browser will block the response)
		c.Next()
	}
}
