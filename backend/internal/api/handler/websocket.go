package handler

import (
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/gorilla/websocket"
	"go.uber.org/zap"

	"github.com/memeperp/backend/internal/pkg/config"
	"github.com/memeperp/backend/internal/ws"
)

// WebSocketHandler handles WebSocket connections
type WebSocketHandler struct {
	hub       *ws.Hub
	logger    *zap.Logger
	config    *config.Config
	upgrader  websocket.Upgrader
}

// NewWebSocketHandler creates a new WebSocket handler
func NewWebSocketHandler(hub *ws.Hub, cfg *config.Config, logger *zap.Logger) *WebSocketHandler {
	handler := &WebSocketHandler{
		hub:    hub,
		config: cfg,
		logger: logger,
	}

	// Configure WebSocket upgrader with secure origin checking
	handler.upgrader = websocket.Upgrader{
		ReadBufferSize:  1024,
		WriteBufferSize: 1024,
		CheckOrigin:     handler.checkOrigin,
	}

	return handler
}

// checkOrigin validates WebSocket connection origins against whitelist
func (h *WebSocketHandler) checkOrigin(r *http.Request) bool {
	origin := r.Header.Get("Origin")

	// Check if origin is in allowed list
	for _, allowed := range h.config.Security.AllowedOrigins {
		if origin == allowed {
			return true
		}
	}

	h.logger.Warn("WebSocket connection rejected from unauthorized origin",
		zap.String("origin", origin))
	return false
}

// HandlePublicWS handles public WebSocket connections
func (h *WebSocketHandler) HandlePublicWS(c *gin.Context) {
	conn, err := h.upgrader.Upgrade(c.Writer, c.Request, nil)
	if err != nil {
		h.logger.Error("Failed to upgrade WebSocket connection", zap.Error(err))
		return
	}

	client := ws.NewClient(h.hub, conn)
	h.hub.Register(client)

	h.logger.Info("Public WebSocket connection established",
		zap.String("remote_addr", conn.RemoteAddr().String()))

	// Start read and write pumps
	go client.WritePump()
	go client.ReadPump()
}

// HandlePrivateWS handles private WebSocket connections (requires authentication)
func (h *WebSocketHandler) HandlePrivateWS(c *gin.Context) {
	conn, err := h.upgrader.Upgrade(c.Writer, c.Request, nil)
	if err != nil {
		h.logger.Error("Failed to upgrade private WebSocket connection", zap.Error(err))
		return
	}

	client := ws.NewClient(h.hub, conn)
	h.hub.Register(client)

	h.logger.Info("Private WebSocket connection established (auth required)",
		zap.String("remote_addr", conn.RemoteAddr().String()))

	// Client must send login message with JWT token before subscribing to private channels
	// Authentication is enforced per-channel in handleMessage()

	// Start read and write pumps
	go client.WritePump()
	go client.ReadPump()
}

// GetHub returns the WebSocket hub
func (h *WebSocketHandler) GetHub() *ws.Hub {
	return h.hub
}
