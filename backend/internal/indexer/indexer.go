package indexer

import (
	"context"
	"fmt"
	"math/big"
	"time"

	"github.com/ethereum/go-ethereum"
	"github.com/ethereum/go-ethereum/common"
	"github.com/ethereum/go-ethereum/core/types"
	"github.com/ethereum/go-ethereum/ethclient"
	"go.uber.org/zap"
	"gorm.io/gorm"

	"github.com/memeperp/backend/internal/model"
	"github.com/memeperp/backend/internal/pkg/config"
	"github.com/memeperp/backend/internal/pkg/database"
)

// Event topics (keccak256 hashes of event signatures)
var (
	// AMM events
	TopicSwap = common.HexToHash("0xd78ad95fa46c994b6551d0da85fc275fe613ce37657fb8d5e3d130840159d822")

	// PositionManager events
	TopicPositionOpened   = common.HexToHash("0x7f7c9b0b9b00000000000000000000000000000000000000000000000000000001")
	TopicPositionClosed   = common.HexToHash("0x7f7c9b0b9b00000000000000000000000000000000000000000000000000000002")
	TopicPositionModified = common.HexToHash("0x7f7c9b0b9b00000000000000000000000000000000000000000000000000000003")

	// Liquidation events
	TopicLiquidation = common.HexToHash("0x7f7c9b0b9b00000000000000000000000000000000000000000000000000000004")

	// FundingRate events
	TopicFundingSettled = common.HexToHash("0x7f7c9b0b9b00000000000000000000000000000000000000000000000000000005")

	// Vault events
	TopicDeposit  = common.HexToHash("0xe1fffcc4923d04b559f4d29a8bfc6cda04eb5b0d3c460751c2402c5c5cc9109c")
	TopicWithdraw = common.HexToHash("0x884edad9ce6fa2440d8a54cc123490eb96d2768479d49ff9c7366125a9424364")
)

type Indexer struct {
	client       *ethclient.Client
	db           *gorm.DB
	cache        *database.Cache
	cfg          *config.BlockchainConfig
	logger       *zap.Logger
	contracts    map[string]common.Address
	eventHandler *EventHandler
}

func NewIndexer(db *gorm.DB, cache *database.Cache, cfg *config.BlockchainConfig, logger *zap.Logger) (*Indexer, error) {
	client, err := ethclient.Dial(cfg.RPCURL)
	if err != nil {
		return nil, fmt.Errorf("failed to connect to blockchain: %w", err)
	}

	contracts := make(map[string]common.Address)
	if cfg.AMMAddress != "" {
		contracts["AMM"] = common.HexToAddress(cfg.AMMAddress)
	}
	if cfg.PositionAddress != "" {
		contracts["PositionManager"] = common.HexToAddress(cfg.PositionAddress)
	}
	if cfg.LiquidationAddr != "" {
		contracts["Liquidation"] = common.HexToAddress(cfg.LiquidationAddr)
	}
	if cfg.FundingRateAddr != "" {
		contracts["FundingRate"] = common.HexToAddress(cfg.FundingRateAddr)
	}
	if cfg.VaultAddress != "" {
		contracts["Vault"] = common.HexToAddress(cfg.VaultAddress)
	}

	return &Indexer{
		client:       client,
		db:           db,
		cache:        cache,
		cfg:          cfg,
		logger:       logger,
		contracts:    contracts,
		eventHandler: NewEventHandler(db, cache, logger),
	}, nil
}

func (i *Indexer) Start(ctx context.Context) error {
	i.logger.Info("Starting indexer")

	// Get start block
	startBlock, err := i.getStartBlock()
	if err != nil {
		return err
	}

	i.logger.Info("Starting from block", zap.Uint64("block", startBlock))

	// Main indexing loop
	ticker := time.NewTicker(i.cfg.PollInterval)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			i.logger.Info("Indexer shutting down")
			return nil
		case <-ticker.C:
			if err := i.processBlocks(ctx, startBlock); err != nil {
				i.logger.Error("Failed to process blocks", zap.Error(err))
			}
		}
	}
}

func (i *Indexer) getStartBlock() (uint64, error) {
	// Check sync state in database
	var syncState model.SyncState
	err := i.db.Where("contract = ?", "global").First(&syncState).Error
	if err == nil {
		return syncState.LastBlock + 1, nil
	}

	// Use configured start block or get latest
	if i.cfg.StartBlock > 0 {
		return i.cfg.StartBlock, nil
	}

	// Get latest block from chain
	header, err := i.client.HeaderByNumber(context.Background(), nil)
	if err != nil {
		return 0, err
	}

	return header.Number.Uint64() - i.cfg.ConfirmBlocks, nil
}

func (i *Indexer) processBlocks(ctx context.Context, fromBlock uint64) error {
	// Get latest block
	header, err := i.client.HeaderByNumber(ctx, nil)
	if err != nil {
		return fmt.Errorf("failed to get latest block: %w", err)
	}

	latestBlock := header.Number.Uint64()
	// Only process confirmed blocks
	if latestBlock <= i.cfg.ConfirmBlocks {
		return nil
	}
	toBlock := latestBlock - i.cfg.ConfirmBlocks

	if fromBlock > toBlock {
		return nil
	}

	// Limit batch size (Alchemy free tier allows max 10 blocks)
	if toBlock-fromBlock > 9 {
		toBlock = fromBlock + 9
	}

	i.logger.Debug("Processing blocks", zap.Uint64("from", fromBlock), zap.Uint64("to", toBlock))

	// Build filter query
	addresses := make([]common.Address, 0, len(i.contracts))
	for _, addr := range i.contracts {
		addresses = append(addresses, addr)
	}

	query := ethereum.FilterQuery{
		FromBlock: big.NewInt(int64(fromBlock)),
		ToBlock:   big.NewInt(int64(toBlock)),
		Addresses: addresses,
	}

	logs, err := i.client.FilterLogs(ctx, query)
	if err != nil {
		return fmt.Errorf("failed to filter logs: %w", err)
	}

	// Process logs
	for _, log := range logs {
		if err := i.processLog(ctx, log); err != nil {
			i.logger.Error("Failed to process log",
				zap.Error(err),
				zap.String("txHash", log.TxHash.Hex()),
				zap.Uint("logIndex", log.Index))
		}
	}

	// Update sync state
	return i.updateSyncState(toBlock)
}

func (i *Indexer) processLog(ctx context.Context, log types.Log) error {
	if len(log.Topics) == 0 {
		return nil
	}

	topic := log.Topics[0]

	switch topic {
	case TopicSwap:
		return i.eventHandler.HandleSwap(ctx, log)
	case TopicPositionOpened:
		return i.eventHandler.HandlePositionOpened(ctx, log)
	case TopicPositionClosed:
		return i.eventHandler.HandlePositionClosed(ctx, log)
	case TopicLiquidation:
		return i.eventHandler.HandleLiquidation(ctx, log)
	case TopicFundingSettled:
		return i.eventHandler.HandleFundingSettled(ctx, log)
	case TopicDeposit:
		return i.eventHandler.HandleDeposit(ctx, log)
	case TopicWithdraw:
		return i.eventHandler.HandleWithdraw(ctx, log)
	default:
		i.logger.Debug("Unknown event topic", zap.String("topic", topic.Hex()))
	}

	return nil
}

func (i *Indexer) updateSyncState(lastBlock uint64) error {
	syncState := model.SyncState{
		Contract:  "global",
		LastBlock: lastBlock,
	}

	return i.db.Where("contract = ?", "global").Assign(syncState).FirstOrCreate(&syncState).Error
}

// EventHandler handles different event types
type EventHandler struct {
	db     *gorm.DB
	cache  *database.Cache
	logger *zap.Logger
}

func NewEventHandler(db *gorm.DB, cache *database.Cache, logger *zap.Logger) *EventHandler {
	return &EventHandler{
		db:     db,
		cache:  cache,
		logger: logger,
	}
}

// PositionOpenedEvent represents the PositionOpened event from PositionManager
type PositionOpenedEvent struct {
	User       common.Address
	IsLong     bool
	Size       *big.Int
	Collateral *big.Int
	Leverage   *big.Int
	EntryPrice *big.Int
	Fee        *big.Int
}

// PositionClosedEvent represents the PositionClosed event from PositionManager
type PositionClosedEvent struct {
	User       common.Address
	IsLong     bool
	Size       *big.Int
	EntryPrice *big.Int
	ExitPrice  *big.Int
	Pnl        *big.Int
	Fee        *big.Int
}

// DepositEvent represents the Deposit event from Vault
type DepositEvent struct {
	User      common.Address
	Amount    *big.Int
	Timestamp *big.Int
}

// WithdrawEvent represents the Withdraw event from Vault
type WithdrawEvent struct {
	User      common.Address
	Amount    *big.Int
	Timestamp *big.Int
}

func (h *EventHandler) HandleSwap(ctx context.Context, log types.Log) error {
	h.logger.Info("Processing Swap event", zap.String("txHash", log.TxHash.Hex()))

	// Decode swap event data
	if len(log.Data) < 128 {
		return fmt.Errorf("invalid swap event data length")
	}

	// Extract amounts from log data
	// Swap(address indexed sender, uint amount0In, uint amount1In, uint amount0Out, uint amount1Out, address indexed to)
	amount0In := new(big.Int).SetBytes(log.Data[0:32])
	amount1In := new(big.Int).SetBytes(log.Data[32:64])
	amount0Out := new(big.Int).SetBytes(log.Data[64:96])
	amount1Out := new(big.Int).SetBytes(log.Data[96:128])

	// Determine trade direction and amounts
	var px, sz model.Decimal
	var side string
	if amount0In.Cmp(big.NewInt(0)) > 0 {
		// Selling token0 for token1
		side = "sell"
		sz, _ = model.NewDecimalFromBigInt(amount0In)
		if amount1Out.Cmp(big.NewInt(0)) > 0 {
			// price = amount1Out / amount0In
			priceRatio := new(big.Float).Quo(new(big.Float).SetInt(amount1Out), new(big.Float).SetInt(amount0In))
			priceFloat, _ := priceRatio.Float64()
			px = model.NewDecimalFromFloat(priceFloat)
		}
	} else {
		// Buying token0 with token1
		side = "buy"
		sz, _ = model.NewDecimalFromBigInt(amount0Out)
		if amount1In.Cmp(big.NewInt(0)) > 0 {
			priceRatio := new(big.Float).Quo(new(big.Float).SetInt(amount1In), new(big.Float).SetInt(amount0Out))
			priceFloat, _ := priceRatio.Float64()
			px = model.NewDecimalFromFloat(priceFloat)
		}
	}

	trade := &model.Trade{
		TradeID: fmt.Sprintf("TX%s%d", log.TxHash.Hex()[2:18], log.Index),
		InstID:  "MEME-BNB-PERP",
		Px:      px,
		Sz:      sz,
		Side:    side,
		Ts:      time.Now().UnixMilli(),
	}

	return h.db.Create(trade).Error
}

func (h *EventHandler) HandlePositionOpened(ctx context.Context, log types.Log) error {
	h.logger.Info("Processing PositionOpened event", zap.String("txHash", log.TxHash.Hex()))

	// Decode event data
	// PositionOpened(address indexed user, bool isLong, uint256 size, uint256 collateral, uint256 leverage, uint256 entryPrice, uint256 fee)
	if len(log.Topics) < 2 || len(log.Data) < 192 {
		return fmt.Errorf("invalid PositionOpened event data")
	}

	user := common.HexToAddress(log.Topics[1].Hex())
	isLong := new(big.Int).SetBytes(log.Data[0:32]).Cmp(big.NewInt(0)) != 0
	size := new(big.Int).SetBytes(log.Data[32:64])
	collateral := new(big.Int).SetBytes(log.Data[64:96])
	leverage := new(big.Int).SetBytes(log.Data[96:128])
	entryPrice := new(big.Int).SetBytes(log.Data[128:160])
	fee := new(big.Int).SetBytes(log.Data[160:192])

	posSide := "short"
	if isLong {
		posSide = "long"
	}

	// Create or update position in database
	sizeDec, _ := model.NewDecimalFromBigInt(size)
	collateralDec, _ := model.NewDecimalFromBigInt(collateral)
	entryPriceDec, _ := model.NewDecimalFromBigInt(entryPrice)
	feeDec, _ := model.NewDecimalFromBigInt(fee)

	// Find or create user
	var dbUser model.User
	h.db.Where("address = ?", user.Hex()).FirstOrCreate(&dbUser, model.User{Address: user.Hex()})

	position := &model.Position{
		PosID:   fmt.Sprintf("POS%s%d", log.TxHash.Hex()[2:18], log.Index),
		UserID:  dbUser.ID,
		InstID:  "MEME-BNB-PERP",
		PosSide: posSide,
		Pos:     sizeDec,
		AvailPos: sizeDec,
		AvgPx:   entryPriceDec,
		Margin:  collateralDec,
		Lever:   int16(leverage.Int64()),
		CTime:   time.Now().UnixMilli(),
		UTime:   time.Now().UnixMilli(),
	}

	// Create trade record
	side := "buy"
	if !isLong {
		side = "sell"
	}

	trade := &model.Trade{
		TradeID: fmt.Sprintf("TRD%s%d", log.TxHash.Hex()[2:18], log.Index),
		InstID:  "MEME-BNB-PERP",
		Px:      entryPriceDec,
		Sz:      sizeDec,
		Side:    side,
		Ts:      time.Now().UnixMilli(),
	}
	_ = feeDec // Fee is tracked in bills, not trades

	return h.db.Transaction(func(tx *gorm.DB) error {
		if err := tx.Create(position).Error; err != nil {
			return err
		}
		return tx.Create(trade).Error
	})
}

func (h *EventHandler) HandlePositionClosed(ctx context.Context, log types.Log) error {
	h.logger.Info("Processing PositionClosed event", zap.String("txHash", log.TxHash.Hex()))

	// Decode event data
	// PositionClosed(address indexed user, bool isLong, uint256 size, uint256 entryPrice, uint256 exitPrice, int256 pnl, uint256 fee)
	if len(log.Topics) < 2 || len(log.Data) < 192 {
		return fmt.Errorf("invalid PositionClosed event data")
	}

	user := common.HexToAddress(log.Topics[1].Hex())
	isLong := new(big.Int).SetBytes(log.Data[0:32]).Cmp(big.NewInt(0)) != 0
	size := new(big.Int).SetBytes(log.Data[32:64])
	_ = new(big.Int).SetBytes(log.Data[64:96]) // entryPrice (not used for closing)
	exitPrice := new(big.Int).SetBytes(log.Data[96:128])
	pnlBytes := log.Data[128:160]
	fee := new(big.Int).SetBytes(log.Data[160:192])

	// Handle signed PnL
	pnl := new(big.Int).SetBytes(pnlBytes)
	if pnlBytes[0]&0x80 != 0 {
		// Negative number (two's complement)
		pnl.Sub(pnl, new(big.Int).Lsh(big.NewInt(1), 256))
	}

	posSide := "short"
	if isLong {
		posSide = "long"
	}

	// Find user and position
	var dbUser model.User
	if err := h.db.Where("address = ?", user.Hex()).First(&dbUser).Error; err != nil {
		return fmt.Errorf("user not found: %w", err)
	}

	sizeDec, _ := model.NewDecimalFromBigInt(size)
	exitPriceDec, _ := model.NewDecimalFromBigInt(exitPrice)
	pnlDec, _ := model.NewDecimalFromBigInt(pnl)
	feeDec, _ := model.NewDecimalFromBigInt(fee)

	// Close position: set pos to 0
	if err := h.db.Model(&model.Position{}).
		Where("user_id = ? AND inst_id = ? AND pos_side = ?", dbUser.ID, "MEME-BNB-PERP", posSide).
		Updates(map[string]interface{}{
			"pos":       model.Zero(),
			"avail_pos": model.Zero(),
			"pnl":       pnlDec,
			"u_time":    time.Now().UnixMilli(),
		}).Error; err != nil {
		h.logger.Error("Failed to close position", zap.Error(err))
	}

	// Create trade record
	side := "sell"
	if !isLong {
		side = "buy"
	}

	trade := &model.Trade{
		TradeID: fmt.Sprintf("TRD%s%d", log.TxHash.Hex()[2:18], log.Index),
		InstID:  "MEME-BNB-PERP",
		Px:      exitPriceDec,
		Sz:      sizeDec,
		Side:    side,
		Ts:      time.Now().UnixMilli(),
	}

	// Create bill record (fee tracked here)
	bill := &model.Bill{
		BillID: fmt.Sprintf("BILL%s%d", log.TxHash.Hex()[2:18], log.Index),
		UserID: dbUser.ID,
		InstID: "MEME-BNB-PERP",
		Ccy:    "BNB",
		Type:   5, // close position
		Sz:     sizeDec,
		Px:     exitPriceDec,
		Pnl:    pnlDec,
		Fee:    feeDec,
		Ts:     time.Now().UnixMilli(),
	}

	return h.db.Transaction(func(tx *gorm.DB) error {
		if err := tx.Create(trade).Error; err != nil {
			return err
		}
		return tx.Create(bill).Error
	})
}

func (h *EventHandler) HandleLiquidation(ctx context.Context, log types.Log) error {
	h.logger.Info("Processing Liquidation event", zap.String("txHash", log.TxHash.Hex()))

	// Liquidated(address indexed user, address indexed liquidator, uint256 liquidatorReward, uint256 remainingToPool)
	if len(log.Topics) < 3 {
		return fmt.Errorf("invalid Liquidation event data")
	}

	user := common.HexToAddress(log.Topics[1].Hex())
	liquidator := common.HexToAddress(log.Topics[2].Hex())

	var liquidatorReward, remainingToPool *big.Int
	if len(log.Data) >= 64 {
		liquidatorReward = new(big.Int).SetBytes(log.Data[0:32])
		remainingToPool = new(big.Int).SetBytes(log.Data[32:64])
	}

	// Find user
	var dbUser model.User
	if err := h.db.Where("address = ?", user.Hex()).First(&dbUser).Error; err != nil {
		return fmt.Errorf("user not found: %w", err)
	}

	rewardDec, _ := model.NewDecimalFromBigInt(liquidatorReward)
	remainingDec, _ := model.NewDecimalFromBigInt(remainingToPool)

	// Mark position as liquidated
	if err := h.db.Model(&model.Position{}).
		Where("user_id = ?", dbUser.ID).
		Updates(map[string]interface{}{
			"pos":       model.Zero(),
			"avail_pos": model.Zero(),
			"margin":    model.Zero(),
			"u_time":    time.Now().UnixMilli(),
		}).Error; err != nil {
		h.logger.Error("Failed to liquidate position", zap.Error(err))
	}

	// Create liquidation bill
	bill := &model.Bill{
		BillID: fmt.Sprintf("LIQ%s%d", log.TxHash.Hex()[2:18], log.Index),
		UserID: dbUser.ID,
		InstID: "MEME-BNB-PERP",
		Ccy:    "BNB",
		Type:   6, // liquidation
		Pnl:    rewardDec.Neg(),
		Fee:    remainingDec,
		Ts:     time.Now().UnixMilli(),
	}

	h.logger.Info("Position liquidated",
		zap.String("user", user.Hex()),
		zap.String("liquidator", liquidator.Hex()),
		zap.String("reward", rewardDec.String()))

	return h.db.Create(bill).Error
}

func (h *EventHandler) HandleFundingSettled(ctx context.Context, log types.Log) error {
	h.logger.Info("Processing FundingSettled event", zap.String("txHash", log.TxHash.Hex()))

	// FundingSettled(address indexed user, int256 fundingFee, uint256 timestamp)
	if len(log.Topics) < 2 || len(log.Data) < 64 {
		return fmt.Errorf("invalid FundingSettled event data")
	}

	user := common.HexToAddress(log.Topics[1].Hex())
	fundingFeeBytes := log.Data[0:32]
	timestamp := new(big.Int).SetBytes(log.Data[32:64])

	// Handle signed funding fee
	fundingFee := new(big.Int).SetBytes(fundingFeeBytes)
	if fundingFeeBytes[0]&0x80 != 0 {
		fundingFee.Sub(fundingFee, new(big.Int).Lsh(big.NewInt(1), 256))
	}

	var dbUser model.User
	if err := h.db.Where("address = ?", user.Hex()).First(&dbUser).Error; err != nil {
		return fmt.Errorf("user not found: %w", err)
	}

	fundingFeeDec, _ := model.NewDecimalFromBigInt(fundingFee)

	// Create funding bill
	bill := &model.Bill{
		BillID: fmt.Sprintf("FUND%s%d", log.TxHash.Hex()[2:18], log.Index),
		UserID: dbUser.ID,
		InstID: "MEME-BNB-PERP",
		Ccy:    "BNB",
		Type:   7, // funding fee
		Pnl:    fundingFeeDec,
		Ts:     timestamp.Int64() * 1000,
	}

	return h.db.Create(bill).Error
}

func (h *EventHandler) HandleDeposit(ctx context.Context, log types.Log) error {
	h.logger.Info("Processing Deposit event", zap.String("txHash", log.TxHash.Hex()))

	// Deposit(address indexed user, uint256 amount, uint256 timestamp)
	if len(log.Topics) < 2 || len(log.Data) < 64 {
		return fmt.Errorf("invalid Deposit event data")
	}

	user := common.HexToAddress(log.Topics[1].Hex())
	amount := new(big.Int).SetBytes(log.Data[0:32])
	timestamp := new(big.Int).SetBytes(log.Data[32:64])

	amountDec, _ := model.NewDecimalFromBigInt(amount)

	// Find or create user
	var dbUser model.User
	h.db.Where("address = ?", user.Hex()).FirstOrCreate(&dbUser, model.User{Address: user.Hex()})

	// Update or create balance
	var balance model.Balance
	err := h.db.Where("user_id = ? AND ccy = ?", dbUser.ID, "BNB").First(&balance).Error
	if err != nil {
		// Create new balance
		balance = model.Balance{
			UserID:   dbUser.ID,
			Ccy:      "BNB",
			Eq:       amountDec,
			CashBal:  amountDec,
			AvailBal: amountDec,
			UTime:    timestamp.Int64() * 1000,
		}
		return h.db.Create(&balance).Error
	}

	// Update existing balance
	balance.Eq = balance.Eq.Add(amountDec)
	balance.CashBal = balance.CashBal.Add(amountDec)
	balance.AvailBal = balance.AvailBal.Add(amountDec)
	balance.UTime = timestamp.Int64() * 1000

	return h.db.Save(&balance).Error
}

func (h *EventHandler) HandleWithdraw(ctx context.Context, log types.Log) error {
	h.logger.Info("Processing Withdraw event", zap.String("txHash", log.TxHash.Hex()))

	// Withdraw(address indexed user, uint256 amount, uint256 timestamp)
	if len(log.Topics) < 2 || len(log.Data) < 64 {
		return fmt.Errorf("invalid Withdraw event data")
	}

	user := common.HexToAddress(log.Topics[1].Hex())
	amount := new(big.Int).SetBytes(log.Data[0:32])
	timestamp := new(big.Int).SetBytes(log.Data[32:64])

	amountDec, _ := model.NewDecimalFromBigInt(amount)

	var dbUser model.User
	if err := h.db.Where("address = ?", user.Hex()).First(&dbUser).Error; err != nil {
		return fmt.Errorf("user not found: %w", err)
	}

	// Update balance
	var balance model.Balance
	if err := h.db.Where("user_id = ? AND ccy = ?", dbUser.ID, "BNB").First(&balance).Error; err != nil {
		return fmt.Errorf("balance not found: %w", err)
	}

	if balance.AvailBal.LessThan(amountDec) {
		h.logger.Warn("Insufficient balance for withdraw",
			zap.String("user", user.Hex()),
			zap.String("amount", amountDec.String()),
			zap.String("available", balance.AvailBal.String()))
	}

	balance.Eq = balance.Eq.Sub(amountDec)
	balance.CashBal = balance.CashBal.Sub(amountDec)
	balance.AvailBal = balance.AvailBal.Sub(amountDec)
	balance.UTime = timestamp.Int64() * 1000

	return h.db.Save(&balance).Error
}
