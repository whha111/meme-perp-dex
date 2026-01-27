package handler

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"
)

func TestParseIntParam(t *testing.T) {
	tests := []struct {
		name       string
		input      string
		defaultVal int64
		expect     int64
	}{
		{"valid number", "100", 0, 100},
		{"empty string", "", 50, 50},
		{"invalid string", "abc", 50, 50},
		{"negative number", "-10", 0, -10},
		{"zero", "0", 10, 0},
		{"large number", "999999", 0, 999999},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result := parseIntParam(tt.input, tt.defaultVal)
			if result != tt.expect {
				t.Errorf("parseIntParam(%q, %d) = %d, want %d", tt.input, tt.defaultVal, result, tt.expect)
			}
		})
	}
}

func setupTestRouter() *gin.Engine {
	gin.SetMode(gin.TestMode)
	return gin.New()
}

func TestHealthEndpoint(t *testing.T) {
	router := setupTestRouter()
	router.GET("/health", func(c *gin.Context) {
		c.JSON(http.StatusOK, gin.H{"status": "ok"})
	})

	req, _ := http.NewRequest("GET", "/health", nil)
	resp := httptest.NewRecorder()

	router.ServeHTTP(resp, req)

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

func TestAPIResponseFormat(t *testing.T) {
	router := setupTestRouter()
	router.GET("/test", func(c *gin.Context) {
		c.JSON(http.StatusOK, gin.H{
			"code": "0",
			"msg":  "success",
			"data": gin.H{"test": "value"},
		})
	})

	req, _ := http.NewRequest("GET", "/test", nil)
	resp := httptest.NewRecorder()

	router.ServeHTTP(resp, req)

	var result map[string]interface{}
	if err := json.Unmarshal(resp.Body.Bytes(), &result); err != nil {
		t.Fatalf("Failed to parse response: %v", err)
	}

	// Check response structure
	if result["code"] != "0" {
		t.Errorf("Expected code '0', got '%v'", result["code"])
	}
	if result["msg"] != "success" {
		t.Errorf("Expected msg 'success', got '%v'", result["msg"])
	}
	if result["data"] == nil {
		t.Error("Expected data field to be present")
	}
}

func TestErrorResponseFormat(t *testing.T) {
	router := setupTestRouter()
	router.GET("/error", func(c *gin.Context) {
		c.JSON(http.StatusBadRequest, gin.H{
			"code": "10001",
			"msg":  "invalid parameter",
			"data": nil,
		})
	})

	req, _ := http.NewRequest("GET", "/error", nil)
	resp := httptest.NewRecorder()

	router.ServeHTTP(resp, req)

	if resp.Code != http.StatusBadRequest {
		t.Errorf("Expected status 400, got %d", resp.Code)
	}

	var result map[string]interface{}
	if err := json.Unmarshal(resp.Body.Bytes(), &result); err != nil {
		t.Fatalf("Failed to parse response: %v", err)
	}

	if result["code"] == "0" {
		t.Error("Error response should not have code '0'")
	}
}

func TestQueryParameterParsing(t *testing.T) {
	router := setupTestRouter()
	router.GET("/params", func(c *gin.Context) {
		instID := c.Query("instId")
		limit := parseIntParam(c.Query("limit"), 100)
		after := parseIntParam(c.Query("after"), 0)

		c.JSON(http.StatusOK, gin.H{
			"instId": instID,
			"limit":  limit,
			"after":  after,
		})
	})

	tests := []struct {
		name        string
		url         string
		expectInstID string
		expectLimit int64
		expectAfter int64
	}{
		{
			name:        "all params",
			url:         "/params?instId=MEME-BNB-PERP&limit=50&after=12345",
			expectInstID: "MEME-BNB-PERP",
			expectLimit:  50,
			expectAfter:  12345,
		},
		{
			name:        "default values",
			url:         "/params",
			expectInstID: "",
			expectLimit:  100,
			expectAfter:  0,
		},
		{
			name:        "partial params",
			url:         "/params?instId=TEST&limit=25",
			expectInstID: "TEST",
			expectLimit:  25,
			expectAfter:  0,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			req, _ := http.NewRequest("GET", tt.url, nil)
			resp := httptest.NewRecorder()
			router.ServeHTTP(resp, req)

			var result map[string]interface{}
			if err := json.Unmarshal(resp.Body.Bytes(), &result); err != nil {
				t.Fatalf("Failed to parse response: %v", err)
			}

			if result["instId"] != tt.expectInstID {
				t.Errorf("instId: expected '%s', got '%v'", tt.expectInstID, result["instId"])
			}
			if int64(result["limit"].(float64)) != tt.expectLimit {
				t.Errorf("limit: expected %d, got %v", tt.expectLimit, result["limit"])
			}
			if int64(result["after"].(float64)) != tt.expectAfter {
				t.Errorf("after: expected %d, got %v", tt.expectAfter, result["after"])
			}
		})
	}
}
