package service

import (
	"context"
	"encoding/json"
	"time"

	"github.com/memeperp/backend/internal/model"
	"github.com/memeperp/backend/internal/pkg/database"
	"github.com/memeperp/backend/internal/pkg/errors"
	"github.com/memeperp/backend/internal/repository"
)

type MarketService struct {
	instrumentRepo    *repository.InstrumentRepository
	tradeRepo         *repository.TradeRepository
	candleRepo        *repository.CandleRepository
	fundingRepo       *repository.FundingRateRepository
	tokenMetadataRepo *repository.TokenMetadataRepository
	cache             *database.Cache
}

func NewMarketService(
	instrumentRepo *repository.InstrumentRepository,
	tradeRepo *repository.TradeRepository,
	candleRepo *repository.CandleRepository,
	fundingRepo *repository.FundingRateRepository,
	tokenMetadataRepo *repository.TokenMetadataRepository,
	cache *database.Cache,
) *MarketService {
	return &MarketService{
		instrumentRepo:    instrumentRepo,
		tradeRepo:         tradeRepo,
		candleRepo:        candleRepo,
		fundingRepo:       fundingRepo,
		tokenMetadataRepo: tokenMetadataRepo,
		cache:             cache,
	}
}

func (s *MarketService) GetInstruments(instType string) ([]model.Instrument, error) {
	if instType != "" {
		return s.instrumentRepo.GetByType(instType)
	}
	return s.instrumentRepo.GetLive()
}

func (s *MarketService) GetInstrument(instID string) (*model.Instrument, error) {
	inst, err := s.instrumentRepo.GetByInstID(instID)
	if err != nil {
		return nil, errors.New(errors.CodeInstrumentNotFound)
	}
	return inst, nil
}

func (s *MarketService) GetTicker(instID string) (*model.Ticker, error) {
	ctx := context.Background()

	// Try cache first
	data, err := s.cache.GetTicker(ctx, instID)
	if err == nil {
		var ticker model.Ticker
		if json.Unmarshal(data, &ticker) == nil {
			return &ticker, nil
		}
	}

	// Build ticker from database
	ticker := &model.Ticker{
		InstID: instID,
		Ts:     time.Now().UnixMilli(),
	}

	// Get latest trade
	latestTrade, err := s.tradeRepo.GetLatest(instID)
	if err == nil {
		ticker.Last = latestTrade.Px
		ticker.LastSz = latestTrade.Sz
	}

	// Get 24h stats
	stats, err := s.tradeRepo.Get24hStats(instID)
	if err == nil {
		ticker.Open24h = stats.Open
		ticker.High24h = stats.High
		ticker.Low24h = stats.Low
		ticker.Vol24h = stats.Volume
		ticker.VolCcy24h = stats.VolumeCcy
	}

	// Try to get token metadata (logo)
	if s.tokenMetadataRepo != nil {
		metadata, err := s.tokenMetadataRepo.GetByInstID(instID)
		if err == nil {
			ticker.LogoURL = metadata.LogoURL
			ticker.ImageURL = metadata.ImageURL
		}
	}

	// Cache the ticker
	if data, err := json.Marshal(ticker); err == nil {
		s.cache.SetTicker(ctx, instID, data, 5*time.Second)
	}

	return ticker, nil
}

func (s *MarketService) GetAllTickers() ([]model.Ticker, error) {
	instruments, err := s.instrumentRepo.GetLive()
	if err != nil {
		return nil, err
	}

	var tickers []model.Ticker
	for _, inst := range instruments {
		ticker, err := s.GetTicker(inst.InstID)
		if err == nil {
			tickers = append(tickers, *ticker)
		}
	}

	return tickers, nil
}

func (s *MarketService) GetCandles(instID, bar string, after, before int64, limit int) ([]model.Candle, error) {
	if limit <= 0 || limit > 500 {
		limit = 100
	}
	return s.candleRepo.GetByInstIDAndBar(instID, bar, after, before, limit)
}

func (s *MarketService) GetTrades(instID string, limit int) ([]model.Trade, error) {
	if limit <= 0 || limit > 500 {
		limit = 100
	}
	return s.tradeRepo.GetByInstID(instID, limit)
}

func (s *MarketService) GetMarkPrice(instID string) (*model.MarkPrice, error) {
	ctx := context.Background()

	// Try cache first
	priceStr, err := s.cache.GetMarkPrice(ctx, instID)
	if err == nil {
		px, _ := model.NewDecimalFromString(priceStr)
		return &model.MarkPrice{
			InstID:   instID,
			InstType: "PERP",
			MarkPx:   px,
			Ts:       time.Now().UnixMilli(),
		}, nil
	}

	// Fall back to latest trade price
	trade, err := s.tradeRepo.GetLatest(instID)
	if err != nil {
		return nil, errors.New(errors.CodeInstrumentNotFound)
	}

	return &model.MarkPrice{
		InstID:   instID,
		InstType: "PERP",
		MarkPx:   trade.Px,
		Ts:       time.Now().UnixMilli(),
	}, nil
}

func (s *MarketService) GetAllMarkPrices() ([]model.MarkPrice, error) {
	instruments, err := s.instrumentRepo.GetLive()
	if err != nil {
		return nil, err
	}

	var prices []model.MarkPrice
	for _, inst := range instruments {
		price, err := s.GetMarkPrice(inst.InstID)
		if err == nil {
			prices = append(prices, *price)
		}
	}

	return prices, nil
}

func (s *MarketService) GetFundingRate(instID string) (*model.FundingRateInfo, error) {
	ctx := context.Background()

	// Try cache first
	data, err := s.cache.GetFundingRate(ctx, instID)
	if err == nil {
		var info model.FundingRateInfo
		if json.Unmarshal(data, &info) == nil {
			return &info, nil
		}
	}

	// Get from database
	rate, err := s.fundingRepo.GetLatest(instID)
	if err != nil {
		// Return default if not found
		return &model.FundingRateInfo{
			InstID:          instID,
			InstType:        "PERP",
			FundingRate:     model.Zero(),
			NextFundingRate: model.Zero(),
			FundingTime:     getNextFundingTime(),
			NextFundingTime: getNextFundingTime() + 4*60*60*1000, // +4 hours
		}, nil
	}

	info := &model.FundingRateInfo{
		InstID:          instID,
		InstType:        "PERP",
		FundingRate:     rate.FundingRate,
		NextFundingRate: rate.FundingRate, // Estimate
		FundingTime:     rate.FundingTime,
		NextFundingTime: getNextFundingTime(),
	}

	// Cache
	if data, err := json.Marshal(info); err == nil {
		s.cache.SetFundingRate(ctx, instID, data, 60*time.Second)
	}

	return info, nil
}

func (s *MarketService) GetFundingRateHistory(instID string, after, before int64, limit int) ([]model.FundingRate, error) {
	if limit <= 0 || limit > 100 {
		limit = 100
	}
	return s.fundingRepo.GetHistory(instID, after, before, limit)
}

func (s *MarketService) GetServerTime() int64 {
	return time.Now().UnixMilli()
}

// getNextFundingTime returns the next funding time (every 4 hours at 00:00, 04:00, 08:00, 12:00, 16:00, 20:00 UTC)
func getNextFundingTime() int64 {
	now := time.Now().UTC()
	hour := now.Hour()
	nextHour := ((hour / 4) + 1) * 4
	if nextHour >= 24 {
		nextHour = 0
		now = now.AddDate(0, 0, 1)
	}
	next := time.Date(now.Year(), now.Month(), now.Day(), nextHour, 0, 0, 0, time.UTC)
	return next.UnixMilli()
}
