package keeper

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"time"

	"go.uber.org/zap"
	"gorm.io/gorm"

	"github.com/memeperp/backend/internal/model"
	"github.com/memeperp/backend/internal/pkg/config"
	"github.com/memeperp/backend/internal/pkg/database"
	"github.com/memeperp/backend/internal/repository"
)

// PriceKeeper fetches and updates mark prices from external sources
type PriceKeeper struct {
	db             *gorm.DB
	cache          *database.Cache
	cfg            *config.BlockchainConfig
	logger         *zap.Logger
	instrumentRepo *repository.InstrumentRepository
	client         *http.Client
}

func NewPriceKeeper(db *gorm.DB, cache *database.Cache, cfg *config.BlockchainConfig, logger *zap.Logger) *PriceKeeper {
	return &PriceKeeper{
		db:             db,
		cache:          cache,
		cfg:            cfg,
		logger:         logger,
		instrumentRepo: repository.NewInstrumentRepository(db),
		client: &http.Client{
			Timeout: 10 * time.Second,
		},
	}
}

func (k *PriceKeeper) Start(ctx context.Context) {
	k.logger.Info("Price keeper started")

	// Update prices immediately on start
	k.updatePrices(ctx)

	ticker := time.NewTicker(5 * time.Second)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			k.logger.Info("Price keeper stopped")
			return
		case <-ticker.C:
			k.updatePrices(ctx)
		}
	}
}

func (k *PriceKeeper) updatePrices(ctx context.Context) {
	// Get all instruments
	instruments, err := k.instrumentRepo.GetAll()
	if err != nil {
		k.logger.Error("Failed to get instruments", zap.Error(err))
		return
	}

	for _, inst := range instruments {
		price, err := k.fetchPrice(ctx, inst.BaseCcy)
		if err != nil {
			k.logger.Debug("Failed to fetch price",
				zap.String("symbol", inst.BaseCcy),
				zap.Error(err))
			continue
		}

		// Update mark price in cache
		if err := k.cache.SetMarkPrice(ctx, inst.InstID, price.String(), 30*time.Second); err != nil {
			k.logger.Error("Failed to set mark price",
				zap.String("instId", inst.InstID),
				zap.Error(err))
		}

		// Also update ticker data
		ticker := k.buildTicker(inst, price)
		tickerData, _ := json.Marshal(ticker)
		if err := k.cache.SetTicker(ctx, inst.InstID, tickerData, 30*time.Second); err != nil {
			k.logger.Error("Failed to set ticker",
				zap.String("instId", inst.InstID),
				zap.Error(err))
		}
	}
}

func (k *PriceKeeper) fetchPrice(ctx context.Context, symbol string) (model.Decimal, error) {
	// Try CoinGecko API first
	price, err := k.fetchFromCoinGecko(ctx, symbol)
	if err == nil {
		return price, nil
	}

	// Fallback to Binance
	price, err = k.fetchFromBinance(ctx, symbol)
	if err == nil {
		return price, nil
	}

	return model.Zero(), fmt.Errorf("failed to fetch price for %s", symbol)
}

func (k *PriceKeeper) fetchFromCoinGecko(ctx context.Context, symbol string) (model.Decimal, error) {
	// Map symbol to CoinGecko ID
	cgID := symbolToCoinGeckoID(symbol)
	if cgID == "" {
		return model.Zero(), fmt.Errorf("unknown symbol: %s", symbol)
	}

	url := fmt.Sprintf("https://api.coingecko.com/api/v3/simple/price?ids=%s&vs_currencies=usd", cgID)

	req, err := http.NewRequestWithContext(ctx, "GET", url, nil)
	if err != nil {
		return model.Zero(), err
	}

	resp, err := k.client.Do(req)
	if err != nil {
		return model.Zero(), err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return model.Zero(), fmt.Errorf("coingecko returned status %d", resp.StatusCode)
	}

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return model.Zero(), err
	}

	var result map[string]map[string]float64
	if err := json.Unmarshal(body, &result); err != nil {
		return model.Zero(), err
	}

	if data, ok := result[cgID]; ok {
		if price, ok := data["usd"]; ok {
			return model.NewDecimalFromFloat(price), nil
		}
	}

	return model.Zero(), fmt.Errorf("price not found for %s", symbol)
}

func (k *PriceKeeper) fetchFromBinance(ctx context.Context, symbol string) (model.Decimal, error) {
	// Map to Binance trading pair
	pair := symbolToBinancePair(symbol)
	if pair == "" {
		return model.Zero(), fmt.Errorf("unknown symbol: %s", symbol)
	}

	url := fmt.Sprintf("https://api.binance.com/api/v3/ticker/price?symbol=%s", pair)

	req, err := http.NewRequestWithContext(ctx, "GET", url, nil)
	if err != nil {
		return model.Zero(), err
	}

	resp, err := k.client.Do(req)
	if err != nil {
		return model.Zero(), err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return model.Zero(), fmt.Errorf("binance returned status %d", resp.StatusCode)
	}

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return model.Zero(), err
	}

	var result struct {
		Price string `json:"price"`
	}
	if err := json.Unmarshal(body, &result); err != nil {
		return model.Zero(), err
	}

	price, err := model.NewDecimalFromString(result.Price)
	if err != nil {
		return model.Zero(), err
	}

	return price, nil
}

func (k *PriceKeeper) buildTicker(inst model.Instrument, price model.Decimal) model.Ticker {
	now := time.Now().UnixMilli()
	return model.Ticker{
		InstID:    inst.InstID,
		Last:      price,
		LastSz:    model.NewDecimalFromInt(1),
		AskPx:     price.Mul(model.NewDecimalFromFloat(1.001)), // 0.1% spread
		AskSz:     model.NewDecimalFromInt(100),
		BidPx:     price.Mul(model.NewDecimalFromFloat(0.999)),
		BidSz:     model.NewDecimalFromInt(100),
		Open24h:   price, // Would need historical data
		High24h:   price,
		Low24h:    price,
		VolCcy24h: model.Zero(),
		Vol24h:    model.Zero(),
		Ts:        now,
	}
}

func symbolToCoinGeckoID(symbol string) string {
	mapping := map[string]string{
		"PEPE":  "pepe",
		"DOGE":  "dogecoin",
		"SHIB":  "shiba-inu",
		"FLOKI": "floki",
		"WIF":   "dogwifcoin",
		"BONK":  "bonk",
		"MEME":  "memecoin",
		"TURBO": "turbo",
		"ETH":   "ethereum",
		"BNB":   "binancecoin",
	}
	return mapping[symbol]
}

func symbolToBinancePair(symbol string) string {
	mapping := map[string]string{
		"PEPE":  "PEPEUSDT",
		"DOGE":  "DOGEUSDT",
		"SHIB":  "SHIBUSDT",
		"FLOKI": "FLOKIUSDT",
		"WIF":   "WIFUSDT",
		"BONK":  "BONKUSDT",
		"MEME":  "MEMEUSDT",
		"TURBO": "TURBOUSDT",
		"ETH":   "ETHUSDT",
		"BNB":   "BNBUSDT",
	}
	return mapping[symbol]
}
