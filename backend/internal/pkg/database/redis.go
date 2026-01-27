package database

import (
	"context"
	"fmt"
	"time"

	"github.com/redis/go-redis/v9"

	"github.com/memeperp/backend/internal/pkg/config"
)

func NewRedis(cfg config.RedisConfig) (*redis.Client, error) {
	client := redis.NewClient(&redis.Options{
		Addr:     cfg.Addr,
		Password: cfg.Password,
		DB:       cfg.DB,
		PoolSize: cfg.PoolSize,
	})

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	if err := client.Ping(ctx).Err(); err != nil {
		return nil, fmt.Errorf("failed to connect to redis: %w", err)
	}

	return client, nil
}

// Cache keys
const (
	KeyTickerPrefix      = "ticker:"       // ticker:MEME-BNB-PERP
	KeyMarkPricePrefix   = "markprice:"    // markprice:MEME-BNB-PERP
	KeyFundingRatePrefix = "fundingrate:"  // fundingrate:MEME-BNB-PERP
	KeyOrderBookPrefix   = "orderbook:"    // orderbook:MEME-BNB-PERP
	KeyUserSession       = "session:"      // session:{address}
	KeyRateLimit         = "ratelimit:"    // ratelimit:{ip}:{endpoint}
	KeyPriceHistory      = "pricehistory:" // pricehistory:MEME-BNB-PERP
)

// Cache operations
type Cache struct {
	client *redis.Client
}

func NewCache(client *redis.Client) *Cache {
	return &Cache{client: client}
}

// IsAvailable returns true if the cache client is available
func (c *Cache) IsAvailable() bool {
	return c != nil && c.client != nil
}

var ErrCacheNotAvailable = fmt.Errorf("redis client not available")

func (c *Cache) SetTicker(ctx context.Context, instID string, data []byte, expiration time.Duration) error {
	if !c.IsAvailable() {
		return ErrCacheNotAvailable
	}
	return c.client.Set(ctx, KeyTickerPrefix+instID, data, expiration).Err()
}

func (c *Cache) GetTicker(ctx context.Context, instID string) ([]byte, error) {
	if !c.IsAvailable() {
		return nil, ErrCacheNotAvailable
	}
	return c.client.Get(ctx, KeyTickerPrefix+instID).Bytes()
}

func (c *Cache) SetMarkPrice(ctx context.Context, instID string, price string, expiration time.Duration) error {
	if !c.IsAvailable() {
		return ErrCacheNotAvailable
	}
	return c.client.Set(ctx, KeyMarkPricePrefix+instID, price, expiration).Err()
}

func (c *Cache) GetMarkPrice(ctx context.Context, instID string) (string, error) {
	if !c.IsAvailable() {
		return "", ErrCacheNotAvailable
	}
	return c.client.Get(ctx, KeyMarkPricePrefix+instID).Result()
}

func (c *Cache) SetFundingRate(ctx context.Context, instID string, data []byte, expiration time.Duration) error {
	if !c.IsAvailable() {
		return ErrCacheNotAvailable
	}
	return c.client.Set(ctx, KeyFundingRatePrefix+instID, data, expiration).Err()
}

func (c *Cache) GetFundingRate(ctx context.Context, instID string) ([]byte, error) {
	if !c.IsAvailable() {
		return nil, ErrCacheNotAvailable
	}
	return c.client.Get(ctx, KeyFundingRatePrefix+instID).Bytes()
}

func (c *Cache) IncrementRateLimit(ctx context.Context, key string, window time.Duration) (int64, error) {
	if !c.IsAvailable() {
		return 0, fmt.Errorf("redis client not available")
	}
	pipe := c.client.Pipeline()
	incr := pipe.Incr(ctx, key)
	pipe.Expire(ctx, key, window)
	_, err := pipe.Exec(ctx)
	if err != nil {
		return 0, err
	}
	return incr.Val(), nil
}

func (c *Cache) PublishMessage(ctx context.Context, channel string, message interface{}) error {
	if !c.IsAvailable() {
		return ErrCacheNotAvailable
	}
	return c.client.Publish(ctx, channel, message).Err()
}

func (c *Cache) Subscribe(ctx context.Context, channels ...string) *redis.PubSub {
	if !c.IsAvailable() {
		return nil
	}
	return c.client.Subscribe(ctx, channels...)
}

// Price history for TWAP calculation
func (c *Cache) AddPriceToHistory(ctx context.Context, instID string, price string, timestamp int64) error {
	if !c.IsAvailable() {
		return ErrCacheNotAvailable
	}
	member := redis.Z{
		Score:  float64(timestamp),
		Member: price,
	}
	return c.client.ZAdd(ctx, KeyPriceHistory+instID, member).Err()
}

func (c *Cache) GetPriceHistory(ctx context.Context, instID string, startTime, endTime int64) ([]string, error) {
	if !c.IsAvailable() {
		return nil, ErrCacheNotAvailable
	}
	result, err := c.client.ZRangeByScore(ctx, KeyPriceHistory+instID, &redis.ZRangeBy{
		Min: fmt.Sprintf("%d", startTime),
		Max: fmt.Sprintf("%d", endTime),
	}).Result()
	return result, err
}

func (c *Cache) TrimPriceHistory(ctx context.Context, instID string, keepAfter int64) error {
	if !c.IsAvailable() {
		return ErrCacheNotAvailable
	}
	return c.client.ZRemRangeByScore(ctx, KeyPriceHistory+instID, "-inf", fmt.Sprintf("%d", keepAfter)).Err()
}
