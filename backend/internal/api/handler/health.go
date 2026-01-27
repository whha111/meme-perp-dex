package handler

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/redis/go-redis/v9"
	"gorm.io/gorm"
)

type HealthHandler struct {
	db                *gorm.DB
	redis             *redis.Client
	matchingEngineURL string
}

func NewHealthHandler(db *gorm.DB, redis *redis.Client, matchingEngineURL string) *HealthHandler {
	return &HealthHandler{
		db:                db,
		redis:             redis,
		matchingEngineURL: matchingEngineURL,
	}
}

// ServiceStatus represents the health status of a single service
type ServiceStatus struct {
	Status  string `json:"status"`  // "ok", "degraded", "down"
	Latency string `json:"latency"` // Response time
	Message string `json:"message,omitempty"`
}

// AggregatedHealthResponse represents the overall system health
type AggregatedHealthResponse struct {
	Status   string                    `json:"status"` // "healthy", "degraded", "unhealthy"
	Services map[string]ServiceStatus  `json:"services"`
	Timestamp int64                    `json:"timestamp"`
}

// GetHealth returns a simple health check for this service only
// GET /health
func (h *HealthHandler) GetHealth(c *gin.Context) {
	c.JSON(http.StatusOK, gin.H{
		"status": "ok",
		"service": "go-backend",
	})
}

// GetAggregatedHealth returns aggregated health status of all services
// GET /health/all
func (h *HealthHandler) GetAggregatedHealth(c *gin.Context) {
	ctx := context.Background()
	services := make(map[string]ServiceStatus)

	// Check Database
	dbStatus := h.checkDatabase(ctx)
	services["database"] = dbStatus

	// Check Redis
	redisStatus := h.checkRedis(ctx)
	services["redis"] = redisStatus

	// Check Matching Engine
	matchingEngineStatus := h.checkMatchingEngine()
	services["matching_engine"] = matchingEngineStatus

	// Check self (always ok if we reach here)
	services["go_backend"] = ServiceStatus{
		Status:  "ok",
		Latency: "0ms",
	}

	// Determine overall status
	overallStatus := h.determineOverallStatus(services)

	response := AggregatedHealthResponse{
		Status:    overallStatus,
		Services:  services,
		Timestamp: time.Now().Unix(),
	}

	// Return appropriate HTTP status code
	statusCode := http.StatusOK
	if overallStatus == "unhealthy" {
		statusCode = http.StatusServiceUnavailable
	} else if overallStatus == "degraded" {
		statusCode = http.StatusOK // Still return 200 for degraded
	}

	c.JSON(statusCode, response)
}

func (h *HealthHandler) checkDatabase(ctx context.Context) ServiceStatus {
	start := time.Now()

	sqlDB, err := h.db.DB()
	if err != nil {
		return ServiceStatus{
			Status:  "down",
			Message: "failed to get database instance",
		}
	}

	if err := sqlDB.PingContext(ctx); err != nil {
		return ServiceStatus{
			Status:  "down",
			Latency: fmt.Sprintf("%dms", time.Since(start).Milliseconds()),
			Message: err.Error(),
		}
	}

	latency := time.Since(start).Milliseconds()
	status := "ok"
	if latency > 100 {
		status = "degraded"
	}

	return ServiceStatus{
		Status:  status,
		Latency: fmt.Sprintf("%dms", latency),
	}
}

func (h *HealthHandler) checkRedis(ctx context.Context) ServiceStatus {
	start := time.Now()

	_, err := h.redis.Ping(ctx).Result()
	if err != nil {
		return ServiceStatus{
			Status:  "down",
			Latency: fmt.Sprintf("%dms", time.Since(start).Milliseconds()),
			Message: err.Error(),
		}
	}

	latency := time.Since(start).Milliseconds()
	status := "ok"
	if latency > 50 {
		status = "degraded"
	}

	return ServiceStatus{
		Status:  status,
		Latency: fmt.Sprintf("%dms", latency),
	}
}

func (h *HealthHandler) checkMatchingEngine() ServiceStatus {
	start := time.Now()

	client := &http.Client{
		Timeout: 5 * time.Second,
	}

	resp, err := client.Get(fmt.Sprintf("%s/health", h.matchingEngineURL))
	if err != nil {
		return ServiceStatus{
			Status:  "down",
			Latency: fmt.Sprintf("%dms", time.Since(start).Milliseconds()),
			Message: err.Error(),
		}
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		return ServiceStatus{
			Status:  "down",
			Latency: fmt.Sprintf("%dms", time.Since(start).Milliseconds()),
			Message: fmt.Sprintf("status code: %d, body: %s", resp.StatusCode, string(body)),
		}
	}

	// Try to parse response
	var healthResp map[string]interface{}
	if err := json.NewDecoder(resp.Body).Decode(&healthResp); err == nil {
		// If Matching Engine returns pending matches count, include it
		if pendingMatches, ok := healthResp["pendingMatches"]; ok {
			return ServiceStatus{
				Status:  "ok",
				Latency: fmt.Sprintf("%dms", time.Since(start).Milliseconds()),
				Message: fmt.Sprintf("pending matches: %v", pendingMatches),
			}
		}
	}

	latency := time.Since(start).Milliseconds()
	status := "ok"
	if latency > 200 {
		status = "degraded"
	}

	return ServiceStatus{
		Status:  status,
		Latency: fmt.Sprintf("%dms", latency),
	}
}

func (h *HealthHandler) determineOverallStatus(services map[string]ServiceStatus) string {
	hasDown := false
	hasDegraded := false

	for _, service := range services {
		if service.Status == "down" {
			hasDown = true
		} else if service.Status == "degraded" {
			hasDegraded = true
		}
	}

	// If Matching Engine is down, system is degraded (not fully unhealthy)
	// since historical queries can still work
	if services["matching_engine"].Status == "down" {
		return "degraded"
	}

	// If database or redis is down, system is unhealthy
	if services["database"].Status == "down" || services["redis"].Status == "down" {
		return "unhealthy"
	}

	if hasDown {
		return "unhealthy"
	}
	if hasDegraded {
		return "degraded"
	}
	return "healthy"
}
