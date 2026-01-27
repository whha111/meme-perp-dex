package model

import (
	"time"
)

// User represents a user account
type User struct {
	ID           int64     `gorm:"primaryKey;autoIncrement" json:"-"`
	Address      string    `gorm:"type:varchar(42);uniqueIndex;not null" json:"address"`
	APIKey       string    `gorm:"type:varchar(64);uniqueIndex" json:"-"`
	APISecret    string    `gorm:"type:varchar(128)" json:"-"`
	ReferrerID   *int64    `gorm:"index" json:"-"`
	ReferralCode string    `gorm:"type:varchar(16);uniqueIndex" json:"referralCode"`
	FeeTier      int16     `gorm:"default:0" json:"feeTier"`
	CreatedAt    time.Time `gorm:"autoCreateTime" json:"-"`
	UpdatedAt    time.Time `gorm:"autoUpdateTime" json:"-"`
}

func (User) TableName() string {
	return "users"
}

// Instrument represents a trading instrument
type Instrument struct {
	ID        int64   `gorm:"primaryKey;autoIncrement" json:"-"`
	InstID    string  `gorm:"type:varchar(32);uniqueIndex;not null" json:"instId"`
	InstType  string  `gorm:"type:varchar(16);not null" json:"instType"`
	BaseCcy   string  `gorm:"type:varchar(16);not null" json:"baseCcy"`
	QuoteCcy  string  `gorm:"type:varchar(16);not null" json:"quoteCcy"`
	SettleCcy string  `gorm:"type:varchar(16);not null" json:"settleCcy"`
	CtVal     Decimal `gorm:"type:decimal(36,18);default:1" json:"ctVal"`
	TickSz    Decimal `gorm:"type:decimal(36,18);not null" json:"tickSz"`
	LotSz     Decimal `gorm:"type:decimal(36,18);not null" json:"lotSz"`
	MinSz     Decimal `gorm:"type:decimal(36,18);not null" json:"minSz"`
	MaxLever  int16   `gorm:"default:100" json:"maxLever"`
	State     string  `gorm:"type:varchar(16);default:'live'" json:"state"`
	ListTime  int64   `json:"listTime"`
	CreatedAt time.Time `gorm:"autoCreateTime" json:"-"`
}

func (Instrument) TableName() string {
	return "instruments"
}

// Order represents a trading order
type Order struct {
	ID          int64   `gorm:"primaryKey;autoIncrement" json:"-"`
	OrdID       string  `gorm:"type:varchar(32);uniqueIndex;not null" json:"ordId"`
	ClOrdID     string  `gorm:"type:varchar(64);index" json:"clOrdId,omitempty"`
	UserID      int64   `gorm:"index;not null" json:"-"`
	InstID      string  `gorm:"type:varchar(32);index;not null" json:"instId"`
	TdMode      string  `gorm:"type:varchar(16);not null" json:"tdMode"`
	Side        string  `gorm:"type:varchar(8);not null" json:"side"`
	PosSide     string  `gorm:"type:varchar(8);not null" json:"posSide"`
	OrdType     string  `gorm:"type:varchar(16);not null" json:"ordType"`
	Sz          Decimal `gorm:"type:decimal(36,18);not null" json:"sz"`
	Px          Decimal `gorm:"type:decimal(36,18)" json:"px,omitempty"`
	AvgPx       Decimal `gorm:"type:decimal(36,18)" json:"avgPx,omitempty"`
	AccFillSz   Decimal `gorm:"type:decimal(36,18);default:0" json:"accFillSz"`
	State       string  `gorm:"type:varchar(20);index;not null" json:"state"`
	Lever       int16   `gorm:"not null" json:"lever"`
	Fee         Decimal `gorm:"type:decimal(36,18);default:0" json:"fee"`
	FeeCcy      string  `gorm:"type:varchar(16)" json:"feeCcy,omitempty"`
	Pnl         Decimal `gorm:"type:decimal(36,18);default:0" json:"pnl"`
	ReduceOnly  bool    `gorm:"default:false" json:"reduceOnly"`
	TpTriggerPx Decimal `gorm:"type:decimal(36,18)" json:"tpTriggerPx,omitempty"`
	SlTriggerPx Decimal `gorm:"type:decimal(36,18)" json:"slTriggerPx,omitempty"`
	CTime       int64   `gorm:"not null" json:"cTime"`
	UTime       int64   `gorm:"not null" json:"uTime"`

	// Relations
	User *User `gorm:"foreignKey:UserID" json:"-"`
}

func (Order) TableName() string {
	return "orders"
}

// Order states
const (
	OrderStateLive            = "live"
	OrderStatePartiallyFilled = "partially_filled"
	OrderStateFilled          = "filled"
	OrderStateCanceled        = "canceled"
)

// Order types
const (
	OrderTypeMarket   = "market"
	OrderTypeLimit    = "limit"
	OrderTypePostOnly = "post_only"
	OrderTypeFOK      = "fok"
	OrderTypeIOC      = "ioc"
)

// Sides
const (
	SideBuy  = "buy"
	SideSell = "sell"
)

// Position sides
const (
	PosSideLong  = "long"
	PosSideShort = "short"
)

// Trade modes
const (
	TdModeCross    = "cross"
	TdModeIsolated = "isolated"
)

// Position represents a user's position
type Position struct {
	ID       int64   `gorm:"primaryKey;autoIncrement" json:"-"`
	PosID    string  `gorm:"type:varchar(32);uniqueIndex;not null" json:"posId"`
	UserID   int64   `gorm:"index;not null" json:"-"`
	InstID   string  `gorm:"type:varchar(32);index;not null" json:"instId"`
	MgnMode  string  `gorm:"type:varchar(16);not null" json:"mgnMode"`
	PosSide  string  `gorm:"type:varchar(8);not null" json:"posSide"`
	Pos      Decimal `gorm:"type:decimal(36,18);default:0" json:"pos"`
	AvailPos Decimal `gorm:"type:decimal(36,18);default:0" json:"availPos"`
	AvgPx    Decimal `gorm:"type:decimal(36,18)" json:"avgPx"`
	Lever    int16   `gorm:"not null" json:"lever"`
	Upl      Decimal `gorm:"type:decimal(36,18);default:0" json:"upl"`
	UplRatio Decimal `gorm:"type:decimal(18,8)" json:"uplRatio"`
	LiqPx    Decimal `gorm:"type:decimal(36,18)" json:"liqPx,omitempty"`
	Margin   Decimal `gorm:"type:decimal(36,18);default:0" json:"margin"`
	Imr      Decimal `gorm:"type:decimal(36,18);default:0" json:"imr"`
	Mmr      Decimal `gorm:"type:decimal(36,18);default:0" json:"mmr"`
	MgnRatio Decimal `gorm:"type:decimal(18,8)" json:"mgnRatio"`
	MarkPx   Decimal `gorm:"-" json:"markPx,omitempty"`
	CTime    int64   `gorm:"not null" json:"cTime"`
	UTime    int64   `gorm:"not null" json:"uTime"`

	// Relations
	User *User `gorm:"foreignKey:UserID" json:"-"`
}

func (Position) TableName() string {
	return "positions"
}

// Balance represents a user's balance
type Balance struct {
	ID        int64   `gorm:"primaryKey;autoIncrement" json:"-"`
	UserID    int64   `gorm:"uniqueIndex:idx_user_ccy;not null" json:"-"`
	Ccy       string  `gorm:"type:varchar(16);uniqueIndex:idx_user_ccy;not null" json:"ccy"`
	Eq        Decimal `gorm:"type:decimal(36,18);default:0" json:"eq"`
	CashBal   Decimal `gorm:"type:decimal(36,18);default:0" json:"cashBal"`
	AvailBal  Decimal `gorm:"type:decimal(36,18);default:0" json:"availBal"`
	FrozenBal Decimal `gorm:"type:decimal(36,18);default:0" json:"frozenBal"`
	OrdFrozen Decimal `gorm:"type:decimal(36,18);default:0" json:"ordFrozen"`
	Upl       Decimal `gorm:"type:decimal(36,18);default:0" json:"upl"`
	UTime     int64   `gorm:"not null" json:"uTime"`

	// Relations
	User *User `gorm:"foreignKey:UserID" json:"-"`
}

func (Balance) TableName() string {
	return "balances"
}

// Candle represents OHLCV data
type Candle struct {
	ID      int64   `gorm:"primaryKey;autoIncrement" json:"-"`
	InstID  string  `gorm:"type:varchar(32);uniqueIndex:idx_candle;not null" json:"instId"`
	Bar     string  `gorm:"type:varchar(8);uniqueIndex:idx_candle;not null" json:"bar"`
	Ts      int64   `gorm:"uniqueIndex:idx_candle;not null" json:"ts"`
	O       Decimal `gorm:"type:decimal(36,18);not null" json:"o"`
	H       Decimal `gorm:"type:decimal(36,18);not null" json:"h"`
	L       Decimal `gorm:"type:decimal(36,18);not null" json:"l"`
	C       Decimal `gorm:"type:decimal(36,18);not null" json:"c"`
	Vol     Decimal `gorm:"type:decimal(36,18);not null" json:"vol"`
	VolCcy  Decimal `gorm:"type:decimal(36,18);not null" json:"volCcy"`
	Confirm int16   `gorm:"default:0" json:"confirm"`
}

func (Candle) TableName() string {
	return "candles"
}

// Candle bar intervals
const (
	Bar1m  = "1m"
	Bar3m  = "3m"
	Bar5m  = "5m"
	Bar15m = "15m"
	Bar30m = "30m"
	Bar1H  = "1H"
	Bar2H  = "2H"
	Bar4H  = "4H"
	Bar6H  = "6H"
	Bar12H = "12H"
	Bar1D  = "1D"
	Bar1W  = "1W"
	Bar1M  = "1M"
)

// Trade represents a trade record
type Trade struct {
	ID      int64   `gorm:"primaryKey;autoIncrement" json:"-"`
	TradeID string  `gorm:"type:varchar(32);uniqueIndex;not null" json:"tradeId"`
	InstID  string  `gorm:"type:varchar(32);index;not null" json:"instId"`
	Px      Decimal `gorm:"type:decimal(36,18);not null" json:"px"`
	Sz      Decimal `gorm:"type:decimal(36,18);not null" json:"sz"`
	Side    string  `gorm:"type:varchar(8);not null" json:"side"`
	Ts      int64   `gorm:"index;not null" json:"ts"`
}

func (Trade) TableName() string {
	return "trades"
}

// FundingRate represents funding rate history
type FundingRate struct {
	ID           int64   `gorm:"primaryKey;autoIncrement" json:"-"`
	InstID       string  `gorm:"type:varchar(32);uniqueIndex:idx_funding;not null" json:"instId"`
	FundingRate  Decimal `gorm:"type:decimal(18,8);not null" json:"fundingRate"`
	RealizedRate Decimal `gorm:"type:decimal(18,8)" json:"realizedRate"`
	FundingTime  int64   `gorm:"uniqueIndex:idx_funding;not null" json:"fundingTime"`
}

func (FundingRate) TableName() string {
	return "funding_rates"
}

// Liquidation represents a liquidation record
type Liquidation struct {
	ID         int64   `gorm:"primaryKey;autoIncrement" json:"-"`
	UserID     int64   `gorm:"index;not null" json:"-"`
	InstID     string  `gorm:"type:varchar(32);index;not null" json:"instId"`
	PosSide    string  `gorm:"type:varchar(8);not null" json:"posSide"`
	Sz         Decimal `gorm:"type:decimal(36,18);not null" json:"sz"`
	Px         Decimal `gorm:"type:decimal(36,18);not null" json:"px"`
	Loss       Decimal `gorm:"type:decimal(36,18);not null" json:"loss"`
	Liquidator string  `gorm:"type:varchar(42)" json:"liquidator,omitempty"`
	LiqReward  Decimal `gorm:"type:decimal(36,18)" json:"liqReward,omitempty"`
	Ts         int64   `gorm:"index;not null" json:"ts"`
	TxHash     string  `gorm:"type:varchar(66)" json:"txHash,omitempty"`
}

func (Liquidation) TableName() string {
	return "liquidations"
}

// Bill represents account bill/transaction history
type Bill struct {
	ID      int64   `gorm:"primaryKey;autoIncrement" json:"-"`
	BillID  string  `gorm:"type:varchar(32);uniqueIndex;not null" json:"billId"`
	UserID  int64   `gorm:"index;not null" json:"-"`
	InstID  string  `gorm:"type:varchar(32)" json:"instId,omitempty"`
	Ccy     string  `gorm:"type:varchar(16);not null" json:"ccy"`
	Type    int16   `gorm:"not null" json:"type"`
	SubType int16   `json:"subType,omitempty"`
	Bal     Decimal `gorm:"type:decimal(36,18);not null" json:"bal"`
	BalChg  Decimal `gorm:"type:decimal(36,18);not null" json:"balChg"`
	Sz      Decimal `gorm:"type:decimal(36,18)" json:"sz,omitempty"`
	Px      Decimal `gorm:"type:decimal(36,18)" json:"px,omitempty"`
	Pnl     Decimal `gorm:"type:decimal(36,18)" json:"pnl,omitempty"`
	Fee     Decimal `gorm:"type:decimal(36,18)" json:"fee,omitempty"`
	Ts      int64   `gorm:"index;not null" json:"ts"`
}

func (Bill) TableName() string {
	return "bills"
}

// Bill types
const (
	BillTypeTransfer   = 1
	BillTypeTrade      = 2
	BillTypeLiquidation = 3
	BillTypeFunding    = 4
	BillTypeADL        = 5
)

// LeverageSetting represents user's leverage settings
type LeverageSetting struct {
	ID      int64  `gorm:"primaryKey;autoIncrement" json:"-"`
	UserID  int64  `gorm:"uniqueIndex:idx_lever_setting;not null" json:"-"`
	InstID  string `gorm:"type:varchar(32);uniqueIndex:idx_lever_setting;not null" json:"instId"`
	MgnMode string `gorm:"type:varchar(16);uniqueIndex:idx_lever_setting;not null" json:"mgnMode"`
	PosSide string `gorm:"type:varchar(8);uniqueIndex:idx_lever_setting" json:"posSide,omitempty"`
	Lever   int16  `gorm:"not null" json:"lever"`
	UTime   int64  `gorm:"not null" json:"uTime"`
}

func (LeverageSetting) TableName() string {
	return "leverage_settings"
}

// AlgoOrder represents stop-loss/take-profit orders
type AlgoOrder struct {
	ID          int64   `gorm:"primaryKey;autoIncrement" json:"-"`
	AlgoID      string  `gorm:"type:varchar(32);uniqueIndex;not null" json:"algoId"`
	UserID      int64   `gorm:"index;not null" json:"-"`
	InstID      string  `gorm:"type:varchar(32);index;not null" json:"instId"`
	TdMode      string  `gorm:"type:varchar(16);not null" json:"tdMode"`
	Side        string  `gorm:"type:varchar(8);not null" json:"side"`
	PosSide     string  `gorm:"type:varchar(8);not null" json:"posSide"`
	OrdType     string  `gorm:"type:varchar(16);not null" json:"ordType"` // conditional, oco, trigger
	Sz          Decimal `gorm:"type:decimal(36,18);not null" json:"sz"`
	TpTriggerPx Decimal `gorm:"type:decimal(36,18)" json:"tpTriggerPx,omitempty"`
	TpOrdPx     Decimal `gorm:"type:decimal(36,18)" json:"tpOrdPx,omitempty"`
	SlTriggerPx Decimal `gorm:"type:decimal(36,18)" json:"slTriggerPx,omitempty"`
	SlOrdPx     Decimal `gorm:"type:decimal(36,18)" json:"slOrdPx,omitempty"`
	State       string  `gorm:"type:varchar(20);index;not null" json:"state"`
	TriggerPx   Decimal `gorm:"type:decimal(36,18)" json:"triggerPx,omitempty"`
	ActualPx    Decimal `gorm:"type:decimal(36,18)" json:"actualPx,omitempty"`
	ActualSz    Decimal `gorm:"type:decimal(36,18)" json:"actualSz,omitempty"`
	CTime       int64   `gorm:"not null" json:"cTime"`
	UTime       int64   `gorm:"not null" json:"uTime"`
	TriggerTime int64   `json:"triggerTime,omitempty"`
}

func (AlgoOrder) TableName() string {
	return "algo_orders"
}

// Algo order states
const (
	AlgoStateLive      = "live"
	AlgoStateEffective = "effective"
	AlgoStateCanceled  = "canceled"
	AlgoStateTriggered = "order_triggered"
	AlgoStateFailed    = "order_failed"
)

// Ticker represents real-time market data
type Ticker struct {
	InstID     string  `json:"instId"`
	Last       Decimal `json:"last"`
	LastSz     Decimal `json:"lastSz"`
	AskPx      Decimal `json:"askPx"`
	AskSz      Decimal `json:"askSz"`
	BidPx      Decimal `json:"bidPx"`
	BidSz      Decimal `json:"bidSz"`
	Open24h    Decimal `json:"open24h"`
	High24h    Decimal `json:"high24h"`
	Low24h     Decimal `json:"low24h"`
	VolCcy24h  Decimal `json:"volCcy24h"`
	Vol24h     Decimal `json:"vol24h"`
	SodUtc0    Decimal `json:"sodUtc0"`
	SodUtc8    Decimal `json:"sodUtc8"`
	Ts         int64   `json:"ts"`
	LogoURL    string  `json:"logoUrl,omitempty"`
	ImageURL   string  `json:"imageUrl,omitempty"`
}

// OrderBook represents the order book
type OrderBook struct {
	Asks [][4]string `json:"asks"` // [price, size, deprecated, numOrders]
	Bids [][4]string `json:"bids"`
	Ts   int64       `json:"ts"`
}

// MarkPrice represents the mark price
type MarkPrice struct {
	InstID   string  `json:"instId"`
	InstType string  `json:"instType"`
	MarkPx   Decimal `json:"markPx"`
	Ts       int64   `json:"ts"`
}

// FundingRateInfo represents current funding rate info
type FundingRateInfo struct {
	InstID          string  `json:"instId"`
	InstType        string  `json:"instType"`
	FundingRate     Decimal `json:"fundingRate"`
	NextFundingRate Decimal `json:"nextFundingRate"`
	FundingTime     int64   `json:"fundingTime"`
	NextFundingTime int64   `json:"nextFundingTime"`
}

// AccountBalance represents full account balance info
type AccountBalance struct {
	TotalEq     Decimal           `json:"totalEq"`
	IsoEq       Decimal           `json:"isoEq"`
	AdjEq       Decimal           `json:"adjEq"`
	OrdFroz     Decimal           `json:"ordFroz"`
	Imr         Decimal           `json:"imr"`
	Mmr         Decimal           `json:"mmr"`
	MgnRatio    Decimal           `json:"mgnRatio"`
	NotionalUsd Decimal           `json:"notionalUsd"`
	UTime       int64             `json:"uTime"`
	Details     []BalanceDetail   `json:"details"`
}

// BalanceDetail represents balance detail for a currency
type BalanceDetail struct {
	Ccy          string  `json:"ccy"`
	Eq           Decimal `json:"eq"`
	CashBal      Decimal `json:"cashBal"`
	UTime        int64   `json:"uTime"`
	IsoEq        Decimal `json:"isoEq"`
	AvailEq      Decimal `json:"availEq"`
	DisEq        Decimal `json:"disEq"`
	AvailBal     Decimal `json:"availBal"`
	FrozenBal    Decimal `json:"frozenBal"`
	OrdFrozen    Decimal `json:"ordFrozen"`
	Upl          Decimal `json:"upl"`
	MgnRatio     Decimal `json:"mgnRatio"`
}

// ReferralReward represents referral commission
type ReferralReward struct {
	ID         int64   `gorm:"primaryKey;autoIncrement" json:"-"`
	ReferrerID int64   `gorm:"index;not null" json:"-"`
	RefereeID  int64   `gorm:"not null" json:"-"`
	OrdID      string  `gorm:"type:varchar(32)" json:"ordId,omitempty"`
	TradeFee   Decimal `gorm:"type:decimal(36,18);not null" json:"tradeFee"`
	Reward     Decimal `gorm:"type:decimal(36,18);not null" json:"reward"`
	RewardRate Decimal `gorm:"type:decimal(8,4);not null" json:"rewardRate"`
	Ccy        string  `gorm:"type:varchar(16);not null" json:"ccy"`
	Ts         int64   `gorm:"not null" json:"ts"`
	Claimed    bool    `gorm:"default:false" json:"claimed"`
}

func (ReferralReward) TableName() string {
	return "referral_rewards"
}

// SyncState tracks blockchain sync progress
type SyncState struct {
	ID          int64  `gorm:"primaryKey;autoIncrement" json:"-"`
	Contract    string `gorm:"type:varchar(42);uniqueIndex;not null" json:"contract"`
	LastBlock   uint64 `gorm:"not null" json:"lastBlock"`
	LastTxIndex uint   `gorm:"not null" json:"lastTxIndex"`
	UpdatedAt   time.Time `gorm:"autoUpdateTime" json:"updatedAt"`
}

func (SyncState) TableName() string {
	return "sync_states"
}

// TokenMetadata stores metadata for tokens (logo, description, social links, etc.)
type TokenMetadata struct {
	ID              int64     `gorm:"primaryKey;autoIncrement" json:"id"`
	InstID          string    `gorm:"type:varchar(32);uniqueIndex;not null" json:"instId"`
	TokenAddress    string    `gorm:"type:varchar(42);not null" json:"tokenAddress"`
	Name            string    `gorm:"type:varchar(100);not null" json:"name"`
	Symbol          string    `gorm:"type:varchar(20);not null" json:"symbol"`
	Description     string    `gorm:"type:text" json:"description,omitempty"`
	LogoURL         string    `gorm:"type:varchar(500);column:logo_url" json:"logoUrl,omitempty"`
	ImageURL        string    `gorm:"type:varchar(500);column:image_url" json:"imageUrl,omitempty"`
	Website         string    `gorm:"type:varchar(200)" json:"website,omitempty"`
	Twitter         string    `gorm:"type:varchar(100)" json:"twitter,omitempty"`
	Telegram        string    `gorm:"type:varchar(100)" json:"telegram,omitempty"`
	Discord         string    `gorm:"type:varchar(100)" json:"discord,omitempty"`
	CreatorAddress  string    `gorm:"type:varchar(42);not null" json:"creatorAddress"`
	TotalSupply     Decimal   `gorm:"type:decimal(36,18);not null" json:"totalSupply"`
	InitialBuyAmount Decimal  `gorm:"type:decimal(36,18)" json:"initialBuyAmount,omitempty"`
	IsGraduated     bool      `gorm:"default:false" json:"isGraduated"`
	GraduationTime  *int64    `json:"graduationTime,omitempty"`
	CreatedAt       time.Time `gorm:"autoCreateTime" json:"createdAt"`
	UpdatedAt       time.Time `gorm:"autoUpdateTime" json:"updatedAt"`
}

func (TokenMetadata) TableName() string {
	return "token_metadata"
}
