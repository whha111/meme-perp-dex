package service

import (
	"context"
	"sync"
	"time"

	"go.uber.org/zap"

	"github.com/memeperp/backend/internal/model"
	"github.com/memeperp/backend/internal/pkg/database"
	"github.com/memeperp/backend/internal/repository"
	"github.com/memeperp/backend/internal/ws"
)

// CandleService manages K-line data generation
type CandleService struct {
	candleRepo *repository.CandleRepository
	tradeRepo  *repository.TradeRepository
	cache      *database.Cache
	hub        *ws.Hub
	logger     *zap.Logger

	// Current candles being built (in memory)
	currentCandles map[string]map[string]*model.Candle // instID -> bar -> candle
	mu             sync.RWMutex
}

// Bar interval durations
var barDurations = map[string]time.Duration{
	model.Bar1m:  1 * time.Minute,
	model.Bar3m:  3 * time.Minute,
	model.Bar5m:  5 * time.Minute,
	model.Bar15m: 15 * time.Minute,
	model.Bar30m: 30 * time.Minute,
	model.Bar1H:  1 * time.Hour,
	model.Bar2H:  2 * time.Hour,
	model.Bar4H:  4 * time.Hour,
	model.Bar6H:  6 * time.Hour,
	model.Bar12H: 12 * time.Hour,
	model.Bar1D:  24 * time.Hour,
}

func NewCandleService(
	candleRepo *repository.CandleRepository,
	tradeRepo *repository.TradeRepository,
	cache *database.Cache,
	hub *ws.Hub,
	logger *zap.Logger,
) *CandleService {
	return &CandleService{
		candleRepo:     candleRepo,
		tradeRepo:      tradeRepo,
		cache:          cache,
		hub:            hub,
		logger:         logger,
		currentCandles: make(map[string]map[string]*model.Candle),
	}
}

// Start starts the candle service
func (s *CandleService) Start(ctx context.Context, instruments []string) {
	s.logger.Info("Starting candle service")

	// Initialize candles for all instruments
	for _, instID := range instruments {
		s.currentCandles[instID] = make(map[string]*model.Candle)
	}

	// Start candle closing timer
	go s.candleCloser(ctx)
}

// ProcessTrade updates candles with a new trade
func (s *CandleService) ProcessTrade(instID string, price, size model.Decimal, ts int64) {
	s.mu.Lock()
	defer s.mu.Unlock()

	instCandles, ok := s.currentCandles[instID]
	if !ok {
		instCandles = make(map[string]*model.Candle)
		s.currentCandles[instID] = instCandles
	}

	// Update all bar intervals
	for bar, duration := range barDurations {
		candleTs := getCandleTimestamp(ts, duration)

		candle, ok := instCandles[bar]
		if !ok || candle.Ts != candleTs {
			// New candle period
			if candle != nil {
				// Close previous candle
				s.closeCandle(candle)
			}

			// Create new candle
			candle = &model.Candle{
				InstID:  instID,
				Bar:     bar,
				Ts:      candleTs,
				O:       price,
				H:       price,
				L:       price,
				C:       price,
				Vol:     size,
				VolCcy:  price.Mul(size),
				Confirm: 0,
			}
			instCandles[bar] = candle
		} else {
			// Update existing candle
			if price.GreaterThan(candle.H) {
				candle.H = price
			}
			if price.LessThan(candle.L) {
				candle.L = price
			}
			candle.C = price
			candle.Vol = candle.Vol.Add(size)
			candle.VolCcy = candle.VolCcy.Add(price.Mul(size))
		}

		// Broadcast update
		if s.hub != nil {
			s.hub.Broadcast("candle"+bar, instID, candleToArray(candle))
		}
	}
}

func (s *CandleService) closeCandle(candle *model.Candle) {
	candle.Confirm = 1

	// Save to database
	if err := s.candleRepo.UpdateOrCreate(candle); err != nil {
		s.logger.Error("Failed to save candle",
			zap.String("instId", candle.InstID),
			zap.String("bar", candle.Bar),
			zap.Error(err))
	}

	// Broadcast closed candle
	if s.hub != nil {
		s.hub.Broadcast("candle"+candle.Bar, candle.InstID, candleToArray(candle))
	}
}

func (s *CandleService) candleCloser(ctx context.Context) {
	// Check every second for candles that need to be closed
	ticker := time.NewTicker(1 * time.Second)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			s.checkCandleClose()
		}
	}
}

func (s *CandleService) checkCandleClose() {
	now := time.Now().UnixMilli()

	s.mu.Lock()
	defer s.mu.Unlock()

	for instID, instCandles := range s.currentCandles {
		for bar, candle := range instCandles {
			if candle == nil {
				continue
			}

			duration := barDurations[bar]
			candleEnd := candle.Ts + duration.Milliseconds()

			if now >= candleEnd && candle.Confirm == 0 {
				s.closeCandle(candle)
				delete(instCandles, bar)
				s.logger.Debug("Candle closed",
					zap.String("instId", instID),
					zap.String("bar", bar),
					zap.Int64("ts", candle.Ts))
			}
		}
	}
}

// GetCurrentCandle returns the current (unconfirmed) candle
func (s *CandleService) GetCurrentCandle(instID, bar string) *model.Candle {
	s.mu.RLock()
	defer s.mu.RUnlock()

	if instCandles, ok := s.currentCandles[instID]; ok {
		return instCandles[bar]
	}
	return nil
}

func getCandleTimestamp(ts int64, duration time.Duration) int64 {
	durationMs := duration.Milliseconds()
	return (ts / durationMs) * durationMs
}

func candleToArray(c *model.Candle) []string {
	return []string{
		formatInt64(c.Ts),
		c.O.String(),
		c.H.String(),
		c.L.String(),
		c.C.String(),
		c.Vol.String(),
		c.VolCcy.String(),
		formatInt16(c.Confirm),
	}
}

func formatInt64(n int64) string {
	return model.NewDecimalFromInt(n).String()
}

func formatInt16(n int16) string {
	return model.NewDecimalFromInt(int64(n)).String()
}
