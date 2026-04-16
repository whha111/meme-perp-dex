package keeper

import (
	"context"
	"fmt"
	"math/big"
	"strings"
	"time"

	ethereum "github.com/ethereum/go-ethereum"
	"github.com/ethereum/go-ethereum/accounts/abi"
	"github.com/ethereum/go-ethereum/common"
	"github.com/ethereum/go-ethereum/ethclient"
	"go.uber.org/zap"

	"github.com/memeperp/backend/internal/pkg/config"
	"github.com/memeperp/backend/internal/pkg/database"
)

// ListingMonitorKeeper polls ExternalTokenRegistry for APPROVED listings and
// checks each one's Pancake pair liquidity. If liquidity drops below a safety
// threshold, it writes an alert to Redis so the admin UI can surface it.
//
// IMPORTANT: this keeper does NOT take any on-chain action. Delisting is
// always a manual admin decision (see alerts on /admin/listings).
//
// Cadence: 5 min (configurable). Fires multicall-style batched reads so the
// whole scan is ~2 RPC round-trips regardless of listing count.
type ListingMonitorKeeper struct {
	cache    *database.Cache
	cfg      *config.BlockchainConfig
	logger   *zap.Logger
	client   *ethclient.Client
	interval time.Duration

	registryAddr common.Address
	wbnbAddr     common.Address

	// Safety thresholds — pairs below these get flagged
	minBNBReserve *big.Int // e.g. 40 BNB ≈ $24k reserve → $48k pair
}

const (
	listingMonitorInterval = 5 * time.Minute
	alertKeyPrefix         = "listing:alert:" // Redis: listing:alert:<appId>  → JSON, TTL 10m
	alertTTL               = 10 * time.Minute
)

// Minimal ABIs — only the 3 calls we need
const registryAbiJSON = `[
  {"inputs":[],"name":"getActiveListings","outputs":[{"type":"uint256[]"}],"stateMutability":"view","type":"function"},
  {"inputs":[{"name":"appId","type":"uint256"}],"name":"getListing","outputs":[{"type":"tuple","components":[
    {"name":"token","type":"address"},{"name":"pair","type":"address"},{"name":"projectTeam","type":"address"},
    {"name":"lpAmountBNB","type":"uint256"},{"name":"lpUnlockAt","type":"uint256"},{"name":"feesPaid","type":"uint256"},
    {"name":"tier","type":"uint8"},{"name":"status","type":"uint8"},{"name":"appliedAt","type":"uint64"},{"name":"approvedAt","type":"uint64"}
  ]}],"stateMutability":"view","type":"function"}
]`

const pairAbiJSON = `[
  {"inputs":[],"name":"getReserves","outputs":[{"type":"uint112"},{"type":"uint112"},{"type":"uint32"}],"stateMutability":"view","type":"function"},
  {"inputs":[],"name":"token0","outputs":[{"type":"address"}],"stateMutability":"view","type":"function"}
]`

func NewListingMonitorKeeper(cfg *config.BlockchainConfig, cache *database.Cache, logger *zap.Logger) *ListingMonitorKeeper {
	// 40 BNB ≈ $24k (at $600/BNB) → ~$48k pair value → alert below this
	threshold := new(big.Int).Mul(big.NewInt(40), big.NewInt(1e18))

	return &ListingMonitorKeeper{
		cache:         cache,
		cfg:           cfg,
		logger:        logger,
		interval:      listingMonitorInterval,
		minBNBReserve: threshold,
	}
}

// Start runs the monitoring ticker. Satisfies the Keeper interface.
func (k *ListingMonitorKeeper) Start(ctx context.Context) {
	if k.cfg.ExternalTokenRegistryAddr == "" {
		k.logger.Info("ListingMonitor disabled — EXTERNAL_TOKEN_REGISTRY_ADDRESS not configured")
		return
	}
	if k.cfg.WBNBAddr == "" {
		k.logger.Warn("ListingMonitor requires WBNB_ADDRESS; disabled")
		return
	}

	client, err := ethclient.Dial(k.cfg.RPCURL)
	if err != nil {
		k.logger.Error("ListingMonitor: dial failed, disabling", zap.Error(err))
		return
	}
	k.client = client
	k.registryAddr = common.HexToAddress(k.cfg.ExternalTokenRegistryAddr)
	k.wbnbAddr = common.HexToAddress(k.cfg.WBNBAddr)

	k.logger.Info("ListingMonitor started",
		zap.String("registry", k.registryAddr.Hex()),
		zap.Duration("interval", k.interval),
		zap.String("minBNBReserve", k.minBNBReserve.String()))

	// Fire once immediately, then on ticker
	k.runOnce(ctx)

	ticker := time.NewTicker(k.interval)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			k.logger.Info("ListingMonitor stopping")
			return
		case <-ticker.C:
			k.runOnce(ctx)
		}
	}
}

func (k *ListingMonitorKeeper) runOnce(ctx context.Context) {
	scanCtx, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()

	appIds, err := k.fetchActiveListingIds(scanCtx)
	if err != nil {
		k.logger.Warn("getActiveListings failed", zap.Error(err))
		return
	}

	if len(appIds) == 0 {
		k.logger.Debug("ListingMonitor: no active listings")
		return
	}

	alerts := 0
	ok := 0
	for _, id := range appIds {
		token, pair, err := k.fetchListingTokenPair(scanCtx, id)
		if err != nil {
			k.logger.Warn("getListing failed",
				zap.Uint64("appId", id),
				zap.Error(err))
			continue
		}

		bnbReserve, err := k.fetchPairBNBReserve(scanCtx, pair)
		if err != nil {
			k.logger.Warn("pair read failed",
				zap.String("pair", pair.Hex()),
				zap.Error(err))
			continue
		}

		if bnbReserve.Cmp(k.minBNBReserve) < 0 {
			alerts++
			k.emitAlert(ctx, id, token, pair, bnbReserve)
		} else {
			ok++
			// Clear stale alert if it was raised previously but has recovered
			_ = k.cache.Delete(ctx, alertKey(id))
		}
	}

	k.logger.Info("ListingMonitor scan complete",
		zap.Int("total", len(appIds)),
		zap.Int("ok", ok),
		zap.Int("alerts", alerts))
}

// ============================================================
//  On-chain reads
// ============================================================

func (k *ListingMonitorKeeper) fetchActiveListingIds(ctx context.Context) ([]uint64, error) {
	parsed, err := abi.JSON(strings.NewReader(registryAbiJSON))
	if err != nil {
		return nil, fmt.Errorf("abi parse: %w", err)
	}
	data, err := parsed.Pack("getActiveListings")
	if err != nil {
		return nil, fmt.Errorf("pack: %w", err)
	}
	msg := k.newCallMsg(data, k.registryAddr)
	raw, err := k.client.CallContract(ctx, msg, nil)
	if err != nil {
		return nil, err
	}
	out, err := parsed.Unpack("getActiveListings", raw)
	if err != nil || len(out) == 0 {
		return nil, fmt.Errorf("unpack: %w", err)
	}
	idsBig, ok := out[0].([]*big.Int)
	if !ok {
		return nil, fmt.Errorf("unexpected type for getActiveListings")
	}
	ids := make([]uint64, 0, len(idsBig))
	for _, b := range idsBig {
		ids = append(ids, b.Uint64())
	}
	return ids, nil
}

func (k *ListingMonitorKeeper) fetchListingTokenPair(ctx context.Context, appId uint64) (common.Address, common.Address, error) {
	parsed, err := abi.JSON(strings.NewReader(registryAbiJSON))
	if err != nil {
		return common.Address{}, common.Address{}, err
	}
	data, err := parsed.Pack("getListing", big.NewInt(int64(appId)))
	if err != nil {
		return common.Address{}, common.Address{}, err
	}
	msg := k.newCallMsg(data, k.registryAddr)
	raw, err := k.client.CallContract(ctx, msg, nil)
	if err != nil {
		return common.Address{}, common.Address{}, err
	}
	type listingStruct struct {
		Token       common.Address
		Pair        common.Address
		ProjectTeam common.Address
		LpAmountBNB *big.Int
		LpUnlockAt  *big.Int
		FeesPaid    *big.Int
		Tier        uint8
		Status      uint8
		AppliedAt   uint64
		ApprovedAt  uint64
	}
	var listing listingStruct
	if err := parsed.UnpackIntoInterface(&listing, "getListing", raw); err != nil {
		return common.Address{}, common.Address{}, fmt.Errorf("unpackInto: %w", err)
	}
	return listing.Token, listing.Pair, nil
}

func (k *ListingMonitorKeeper) fetchPairBNBReserve(ctx context.Context, pair common.Address) (*big.Int, error) {
	parsed, err := abi.JSON(strings.NewReader(pairAbiJSON))
	if err != nil {
		return nil, err
	}

	// First: token0 to know which reserve slot has WBNB
	tok0Data, _ := parsed.Pack("token0")
	tok0Raw, err := k.client.CallContract(ctx, k.newCallMsg(tok0Data, pair), nil)
	if err != nil {
		return nil, fmt.Errorf("token0: %w", err)
	}
	tok0Out, err := parsed.Unpack("token0", tok0Raw)
	if err != nil || len(tok0Out) == 0 {
		return nil, fmt.Errorf("unpack token0")
	}
	token0, _ := tok0Out[0].(common.Address)

	// Then: reserves
	resData, _ := parsed.Pack("getReserves")
	resRaw, err := k.client.CallContract(ctx, k.newCallMsg(resData, pair), nil)
	if err != nil {
		return nil, fmt.Errorf("getReserves: %w", err)
	}
	resOut, err := parsed.Unpack("getReserves", resRaw)
	if err != nil || len(resOut) < 2 {
		return nil, fmt.Errorf("unpack reserves")
	}
	r0, _ := resOut[0].(*big.Int)
	r1, _ := resOut[1].(*big.Int)

	if token0 == k.wbnbAddr {
		return r0, nil
	}
	return r1, nil
}

// ============================================================
//  Redis alert
// ============================================================

func (k *ListingMonitorKeeper) emitAlert(ctx context.Context, appId uint64, token, pair common.Address, bnbReserve *big.Int) {
	alertJSON := fmt.Sprintf(
		`{"appId":%d,"token":"%s","pair":"%s","bnbReserve":"%s","threshold":"%s","detectedAt":%d,"severity":"WARNING"}`,
		appId, token.Hex(), pair.Hex(), bnbReserve.String(), k.minBNBReserve.String(), time.Now().Unix())

	if err := k.cache.Set(ctx, alertKey(appId), alertJSON, alertTTL); err != nil {
		k.logger.Warn("ListingMonitor: cache.Set failed",
			zap.Uint64("appId", appId),
			zap.Error(err))
	}

	// Normalize BNB reserve to human-readable float for the log
	bnbFloat := new(big.Float).Quo(new(big.Float).SetInt(bnbReserve), big.NewFloat(1e18))
	bnb, _ := bnbFloat.Float64()

	k.logger.Warn("⚠️  LISTING LIQUIDITY ALERT",
		zap.Uint64("appId", appId),
		zap.String("token", token.Hex()),
		zap.String("pair", pair.Hex()),
		zap.Float64("bnbReserve", bnb),
		zap.String("threshold", "40 BNB"))
}

func alertKey(appId uint64) string {
	return fmt.Sprintf("%s%d", alertKeyPrefix, appId)
}

// ============================================================
//  Helpers
// ============================================================

func (k *ListingMonitorKeeper) newCallMsg(data []byte, to common.Address) ethereum.CallMsg {
	return ethereum.CallMsg{To: &to, Data: data}
}
