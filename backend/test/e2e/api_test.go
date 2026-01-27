package e2e

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
)

// APIResponse represents the standard API response format
type APIResponse struct {
	Code string          `json:"code"`
	Msg  string          `json:"msg"`
	Data json.RawMessage `json:"data"`
}

// TestConfig holds test configuration
type TestConfig struct {
	BaseURL string
	APIKey  string
}

func setupTestServer() *gin.Engine {
	gin.SetMode(gin.TestMode)
	r := gin.New()

	// Setup routes similar to main app
	api := r.Group("/api/v1")

	// Public endpoints
	public := api.Group("/public")
	{
		public.GET("/instruments", mockInstrumentsHandler)
		public.GET("/time", mockTimeHandler)
	}

	// Market endpoints
	market := api.Group("/market")
	{
		market.GET("/ticker", mockTickerHandler)
		market.GET("/tickers", mockTickersHandler)
		market.GET("/candles", mockCandlesHandler)
		market.GET("/trades", mockTradesHandler)
		market.GET("/books", mockBooksHandler)
	}

	// Health check
	r.GET("/health", func(c *gin.Context) {
		c.JSON(http.StatusOK, gin.H{"status": "ok"})
	})

	return r
}

// Mock handlers for testing

func mockInstrumentsHandler(c *gin.Context) {
	c.JSON(http.StatusOK, APIResponse{
		Code: "0",
		Msg:  "success",
		Data: json.RawMessage(`[{
			"instId": "MEME-BNB-PERP",
			"instType": "PERP",
			"baseCcy": "MEME",
			"quoteCcy": "BNB",
			"settleCcy": "BNB",
			"state": "live",
			"minSz": "1",
			"maxLever": 100
		}]`),
	})
}

func mockTimeHandler(c *gin.Context) {
	c.JSON(http.StatusOK, APIResponse{
		Code: "0",
		Msg:  "success",
		Data: json.RawMessage(fmt.Sprintf(`{"ts": %d}`, time.Now().UnixMilli())),
	})
}

func mockTickerHandler(c *gin.Context) {
	instID := c.Query("instId")
	if instID == "" {
		c.JSON(http.StatusBadRequest, APIResponse{
			Code: "10001",
			Msg:  "instId is required",
			Data: nil,
		})
		return
	}

	c.JSON(http.StatusOK, APIResponse{
		Code: "0",
		Msg:  "success",
		Data: json.RawMessage(fmt.Sprintf(`[{
			"instId": "%s",
			"last": "0.0001",
			"high24h": "0.00012",
			"low24h": "0.00008",
			"vol24h": "1000000",
			"ts": %d
		}]`, instID, time.Now().UnixMilli())),
	})
}

func mockTickersHandler(c *gin.Context) {
	c.JSON(http.StatusOK, APIResponse{
		Code: "0",
		Msg:  "success",
		Data: json.RawMessage(`[{
			"instId": "MEME-BNB-PERP",
			"last": "0.0001",
			"vol24h": "1000000"
		}]`),
	})
}

func mockCandlesHandler(c *gin.Context) {
	instID := c.Query("instId")
	bar := c.DefaultQuery("bar", "1m")

	if instID == "" {
		c.JSON(http.StatusBadRequest, APIResponse{
			Code: "10001",
			Msg:  "instId is required",
			Data: nil,
		})
		return
	}

	// Return mock candle data
	now := time.Now().UnixMilli()
	c.JSON(http.StatusOK, APIResponse{
		Code: "0",
		Msg:  "success",
		Data: json.RawMessage(fmt.Sprintf(`[
			["%d", "0.0001", "0.00012", "0.00008", "0.0001", "100000", "10"],
			["%d", "0.0001", "0.00011", "0.00009", "0.00011", "80000", "8"]
		]`, now-60000, now)),
	})
	_ = bar
}

func mockTradesHandler(c *gin.Context) {
	instID := c.Query("instId")
	if instID == "" {
		c.JSON(http.StatusBadRequest, APIResponse{
			Code: "10001",
			Msg:  "instId is required",
			Data: nil,
		})
		return
	}

	c.JSON(http.StatusOK, APIResponse{
		Code: "0",
		Msg:  "success",
		Data: json.RawMessage(fmt.Sprintf(`[{
			"instId": "%s",
			"tradeId": "123456",
			"px": "0.0001",
			"sz": "1000",
			"side": "buy",
			"ts": %d
		}]`, instID, time.Now().UnixMilli())),
	})
}

func mockBooksHandler(c *gin.Context) {
	instID := c.Query("instId")
	if instID == "" {
		c.JSON(http.StatusBadRequest, APIResponse{
			Code: "10001",
			Msg:  "instId is required",
			Data: nil,
		})
		return
	}

	c.JSON(http.StatusOK, APIResponse{
		Code: "0",
		Msg:  "success",
		Data: json.RawMessage(`{
			"asks": [["0.00011", "1000", "0", "1"]],
			"bids": [["0.00009", "2000", "0", "2"]],
			"ts": ` + fmt.Sprintf("%d", time.Now().UnixMilli()) + `
		}`),
	})
}

// Test cases

func TestHealthEndpoint(t *testing.T) {
	server := setupTestServer()

	req, _ := http.NewRequest("GET", "/health", nil)
	resp := httptest.NewRecorder()
	server.ServeHTTP(resp, req)

	if resp.Code != http.StatusOK {
		t.Errorf("Expected status 200, got %d", resp.Code)
	}

	var result map[string]string
	if err := json.Unmarshal(resp.Body.Bytes(), &result); err != nil {
		t.Fatalf("Failed to parse response: %v", err)
	}

	if result["status"] != "ok" {
		t.Errorf("Expected status 'ok', got '%s'", result["status"])
	}
}

func TestGetInstruments(t *testing.T) {
	server := setupTestServer()

	req, _ := http.NewRequest("GET", "/api/v1/public/instruments", nil)
	resp := httptest.NewRecorder()
	server.ServeHTTP(resp, req)

	if resp.Code != http.StatusOK {
		t.Errorf("Expected status 200, got %d", resp.Code)
	}

	var result APIResponse
	if err := json.Unmarshal(resp.Body.Bytes(), &result); err != nil {
		t.Fatalf("Failed to parse response: %v", err)
	}

	if result.Code != "0" {
		t.Errorf("Expected code '0', got '%s'", result.Code)
	}

	var instruments []map[string]interface{}
	if err := json.Unmarshal(result.Data, &instruments); err != nil {
		t.Fatalf("Failed to parse instruments: %v", err)
	}

	if len(instruments) == 0 {
		t.Error("Expected at least one instrument")
	}
}

func TestGetTicker(t *testing.T) {
	server := setupTestServer()

	tests := []struct {
		name       string
		instID     string
		expectCode int
		expectErr  bool
	}{
		{"valid instId", "MEME-BNB-PERP", http.StatusOK, false},
		{"missing instId", "", http.StatusBadRequest, true},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			url := "/api/v1/market/ticker"
			if tt.instID != "" {
				url += "?instId=" + tt.instID
			}

			req, _ := http.NewRequest("GET", url, nil)
			resp := httptest.NewRecorder()
			server.ServeHTTP(resp, req)

			if resp.Code != tt.expectCode {
				t.Errorf("Expected status %d, got %d", tt.expectCode, resp.Code)
			}

			var result APIResponse
			if err := json.Unmarshal(resp.Body.Bytes(), &result); err != nil {
				t.Fatalf("Failed to parse response: %v", err)
			}

			if tt.expectErr && result.Code == "0" {
				t.Error("Expected error but got success")
			}
			if !tt.expectErr && result.Code != "0" {
				t.Errorf("Expected success but got error: %s", result.Msg)
			}
		})
	}
}

func TestGetCandles(t *testing.T) {
	server := setupTestServer()

	tests := []struct {
		name       string
		instID     string
		bar        string
		expectCode int
	}{
		{"1m candles", "MEME-BNB-PERP", "1m", http.StatusOK},
		{"5m candles", "MEME-BNB-PERP", "5m", http.StatusOK},
		{"1h candles", "MEME-BNB-PERP", "1h", http.StatusOK},
		{"missing instId", "", "1m", http.StatusBadRequest},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			url := "/api/v1/market/candles"
			if tt.instID != "" {
				url += "?instId=" + tt.instID
				if tt.bar != "" {
					url += "&bar=" + tt.bar
				}
			}

			req, _ := http.NewRequest("GET", url, nil)
			resp := httptest.NewRecorder()
			server.ServeHTTP(resp, req)

			if resp.Code != tt.expectCode {
				t.Errorf("Expected status %d, got %d", tt.expectCode, resp.Code)
			}
		})
	}
}

func TestGetTrades(t *testing.T) {
	server := setupTestServer()

	req, _ := http.NewRequest("GET", "/api/v1/market/trades?instId=MEME-BNB-PERP", nil)
	resp := httptest.NewRecorder()
	server.ServeHTTP(resp, req)

	if resp.Code != http.StatusOK {
		t.Errorf("Expected status 200, got %d", resp.Code)
	}

	var result APIResponse
	if err := json.Unmarshal(resp.Body.Bytes(), &result); err != nil {
		t.Fatalf("Failed to parse response: %v", err)
	}

	var trades []map[string]interface{}
	if err := json.Unmarshal(result.Data, &trades); err != nil {
		t.Fatalf("Failed to parse trades: %v", err)
	}

	if len(trades) == 0 {
		t.Error("Expected at least one trade")
	}

	// Verify trade structure
	trade := trades[0]
	requiredFields := []string{"instId", "tradeId", "px", "sz", "side", "ts"}
	for _, field := range requiredFields {
		if _, ok := trade[field]; !ok {
			t.Errorf("Trade missing required field: %s", field)
		}
	}
}

func TestGetOrderBook(t *testing.T) {
	server := setupTestServer()

	req, _ := http.NewRequest("GET", "/api/v1/market/books?instId=MEME-BNB-PERP", nil)
	resp := httptest.NewRecorder()
	server.ServeHTTP(resp, req)

	if resp.Code != http.StatusOK {
		t.Errorf("Expected status 200, got %d", resp.Code)
	}

	var result APIResponse
	if err := json.Unmarshal(resp.Body.Bytes(), &result); err != nil {
		t.Fatalf("Failed to parse response: %v", err)
	}

	var book map[string]interface{}
	if err := json.Unmarshal(result.Data, &book); err != nil {
		t.Fatalf("Failed to parse order book: %v", err)
	}

	// Verify order book structure
	if _, ok := book["asks"]; !ok {
		t.Error("Order book missing 'asks'")
	}
	if _, ok := book["bids"]; !ok {
		t.Error("Order book missing 'bids'")
	}
	if _, ok := book["ts"]; !ok {
		t.Error("Order book missing 'ts'")
	}
}

func TestGetServerTime(t *testing.T) {
	server := setupTestServer()

	req, _ := http.NewRequest("GET", "/api/v1/public/time", nil)
	resp := httptest.NewRecorder()
	server.ServeHTTP(resp, req)

	if resp.Code != http.StatusOK {
		t.Errorf("Expected status 200, got %d", resp.Code)
	}

	var result APIResponse
	if err := json.Unmarshal(resp.Body.Bytes(), &result); err != nil {
		t.Fatalf("Failed to parse response: %v", err)
	}

	var timeData map[string]int64
	if err := json.Unmarshal(result.Data, &timeData); err != nil {
		t.Fatalf("Failed to parse time: %v", err)
	}

	ts := timeData["ts"]
	now := time.Now().UnixMilli()

	// Verify timestamp is within 5 seconds of now
	if ts < now-5000 || ts > now+5000 {
		t.Errorf("Server time %d is not within 5 seconds of now %d", ts, now)
	}
}

// Benchmark tests

func BenchmarkGetTicker(b *testing.B) {
	server := setupTestServer()
	req, _ := http.NewRequest("GET", "/api/v1/market/ticker?instId=MEME-BNB-PERP", nil)

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		resp := httptest.NewRecorder()
		server.ServeHTTP(resp, req)
	}
}

func BenchmarkGetCandles(b *testing.B) {
	server := setupTestServer()
	req, _ := http.NewRequest("GET", "/api/v1/market/candles?instId=MEME-BNB-PERP&bar=1m", nil)

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		resp := httptest.NewRecorder()
		server.ServeHTTP(resp, req)
	}
}

// Test POST endpoints

func TestPlaceOrderValidation(t *testing.T) {
	// This test validates the order request structure
	tests := []struct {
		name    string
		body    string
		isValid bool
	}{
		{
			name:    "valid market order",
			body:    `{"instId":"MEME-BNB-PERP","tdMode":"cross","side":"buy","posSide":"long","ordType":"market","sz":"100"}`,
			isValid: true,
		},
		{
			name:    "valid limit order",
			body:    `{"instId":"MEME-BNB-PERP","tdMode":"cross","side":"sell","posSide":"short","ordType":"limit","sz":"100","px":"0.0001"}`,
			isValid: true,
		},
		{
			name:    "missing instId",
			body:    `{"tdMode":"cross","side":"buy","ordType":"market","sz":"100"}`,
			isValid: false,
		},
		{
			name:    "missing sz",
			body:    `{"instId":"MEME-BNB-PERP","tdMode":"cross","side":"buy","ordType":"market"}`,
			isValid: false,
		},
		{
			name:    "invalid side",
			body:    `{"instId":"MEME-BNB-PERP","tdMode":"cross","side":"invalid","ordType":"market","sz":"100"}`,
			isValid: false,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			var req struct {
				InstID  string `json:"instId"`
				TdMode  string `json:"tdMode"`
				Side    string `json:"side"`
				PosSide string `json:"posSide"`
				OrdType string `json:"ordType"`
				Sz      string `json:"sz"`
				Px      string `json:"px"`
			}

			err := json.Unmarshal([]byte(tt.body), &req)
			if err != nil {
				t.Fatalf("Failed to parse body: %v", err)
			}

			// Validate required fields
			isValid := req.InstID != "" && req.Sz != ""
			if req.Side != "" && req.Side != "buy" && req.Side != "sell" {
				isValid = false
			}

			if isValid != tt.isValid {
				t.Errorf("Validation: got %v, want %v", isValid, tt.isValid)
			}
		})
	}
}
