package service

import (
	"testing"

	"github.com/memeperp/backend/internal/model"
)

func TestValidateOrderParams(t *testing.T) {
	tests := []struct {
		name    string
		req     *PlaceOrderRequest
		inst    *model.Instrument
		wantErr bool
	}{
		{
			name: "valid market order",
			req: &PlaceOrderRequest{
				InstID:  "MEME-BNB-PERP",
				TdMode:  model.TdModeCross,
				Side:    model.SideBuy,
				PosSide: model.PosSideLong,
				OrdType: model.OrderTypeMarket,
				Sz:      model.NewDecimalFromFloat(100),
				Lever:   20,
			},
			inst: &model.Instrument{
				InstID:   "MEME-BNB-PERP",
				State:    "live",
				MinSz:    model.NewDecimalFromFloat(1),
				MaxLever: 100,
			},
			wantErr: false,
		},
		{
			name: "valid limit order",
			req: &PlaceOrderRequest{
				InstID:  "MEME-BNB-PERP",
				TdMode:  model.TdModeIsolated,
				Side:    model.SideSell,
				PosSide: model.PosSideShort,
				OrdType: model.OrderTypeLimit,
				Sz:      model.NewDecimalFromFloat(100),
				Px:      model.NewDecimalFromFloat(0.0001),
				Lever:   50,
			},
			inst: &model.Instrument{
				InstID:   "MEME-BNB-PERP",
				State:    "live",
				MinSz:    model.NewDecimalFromFloat(1),
				MaxLever: 100,
			},
			wantErr: false,
		},
		{
			name: "invalid side",
			req: &PlaceOrderRequest{
				InstID:  "MEME-BNB-PERP",
				TdMode:  model.TdModeCross,
				Side:    "invalid",
				PosSide: model.PosSideLong,
				OrdType: model.OrderTypeMarket,
				Sz:      model.NewDecimalFromFloat(100),
			},
			inst: &model.Instrument{
				InstID: "MEME-BNB-PERP",
				State:  "live",
				MinSz:  model.NewDecimalFromFloat(1),
			},
			wantErr: true,
		},
		{
			name: "invalid order type",
			req: &PlaceOrderRequest{
				InstID:  "MEME-BNB-PERP",
				TdMode:  model.TdModeCross,
				Side:    model.SideBuy,
				PosSide: model.PosSideLong,
				OrdType: "invalid",
				Sz:      model.NewDecimalFromFloat(100),
			},
			inst: &model.Instrument{
				InstID: "MEME-BNB-PERP",
				State:  "live",
				MinSz:  model.NewDecimalFromFloat(1),
			},
			wantErr: true,
		},
		{
			name: "size too small",
			req: &PlaceOrderRequest{
				InstID:  "MEME-BNB-PERP",
				TdMode:  model.TdModeCross,
				Side:    model.SideBuy,
				PosSide: model.PosSideLong,
				OrdType: model.OrderTypeMarket,
				Sz:      model.NewDecimalFromFloat(0.1),
			},
			inst: &model.Instrument{
				InstID: "MEME-BNB-PERP",
				State:  "live",
				MinSz:  model.NewDecimalFromFloat(1),
			},
			wantErr: true,
		},
		{
			name: "leverage too high",
			req: &PlaceOrderRequest{
				InstID:  "MEME-BNB-PERP",
				TdMode:  model.TdModeCross,
				Side:    model.SideBuy,
				PosSide: model.PosSideLong,
				OrdType: model.OrderTypeMarket,
				Sz:      model.NewDecimalFromFloat(100),
				Lever:   200,
			},
			inst: &model.Instrument{
				InstID:   "MEME-BNB-PERP",
				State:    "live",
				MinSz:    model.NewDecimalFromFloat(1),
				MaxLever: 100,
			},
			wantErr: true,
		},
		{
			name: "limit order without price",
			req: &PlaceOrderRequest{
				InstID:  "MEME-BNB-PERP",
				TdMode:  model.TdModeCross,
				Side:    model.SideBuy,
				PosSide: model.PosSideLong,
				OrdType: model.OrderTypeLimit,
				Sz:      model.NewDecimalFromFloat(100),
			},
			inst: &model.Instrument{
				InstID: "MEME-BNB-PERP",
				State:  "live",
				MinSz:  model.NewDecimalFromFloat(1),
			},
			wantErr: true,
		},
	}

	service := &TradeService{}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			err := service.validateOrderParams(tt.req, tt.inst)
			if (err != nil) != tt.wantErr {
				t.Errorf("validateOrderParams() error = %v, wantErr %v", err, tt.wantErr)
			}
		})
	}
}

func TestCalculateMargin(t *testing.T) {
	tests := []struct {
		name   string
		sz     model.Decimal
		px     model.Decimal
		lever  int16
		expect model.Decimal
	}{
		{
			name:   "basic calculation",
			sz:     model.NewDecimalFromFloat(100),
			px:     model.NewDecimalFromFloat(0.0001),
			lever:  20,
			expect: model.NewDecimalFromFloat(0.0005), // 100 * 0.0001 / 20
		},
		{
			name:   "high leverage",
			sz:     model.NewDecimalFromFloat(1000),
			px:     model.NewDecimalFromFloat(0.001),
			lever:  100,
			expect: model.NewDecimalFromFloat(0.01), // 1000 * 0.001 / 100
		},
		{
			name:   "zero price",
			sz:     model.NewDecimalFromFloat(100),
			px:     model.Zero(),
			lever:  20,
			expect: model.Zero(),
		},
		{
			name:   "zero leverage",
			sz:     model.NewDecimalFromFloat(100),
			px:     model.NewDecimalFromFloat(0.0001),
			lever:  0,
			expect: model.Zero(),
		},
	}

	service := &TradeService{}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result := service.calculateMargin(tt.sz, tt.px, tt.lever)
			if !result.Equal(tt.expect) {
				t.Errorf("calculateMargin() = %v, want %v", result, tt.expect)
			}
		})
	}
}

func TestCalculateLiqPrice(t *testing.T) {
	tests := []struct {
		name    string
		pos     *model.Position
		isLiqPx bool // expect non-zero liq price
	}{
		{
			name: "long position",
			pos: &model.Position{
				PosSide: model.PosSideLong,
				Pos:     model.NewDecimalFromFloat(100),
				AvgPx:   model.NewDecimalFromFloat(0.0001),
				Lever:   20,
			},
			isLiqPx: true,
		},
		{
			name: "short position",
			pos: &model.Position{
				PosSide: model.PosSideShort,
				Pos:     model.NewDecimalFromFloat(100),
				AvgPx:   model.NewDecimalFromFloat(0.0001),
				Lever:   20,
			},
			isLiqPx: true,
		},
		{
			name: "zero position",
			pos: &model.Position{
				PosSide: model.PosSideLong,
				Pos:     model.Zero(),
				AvgPx:   model.NewDecimalFromFloat(0.0001),
				Lever:   20,
			},
			isLiqPx: false,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result := calculateLiqPrice(tt.pos)
			if tt.isLiqPx && result.IsZero() {
				t.Errorf("calculateLiqPrice() expected non-zero, got zero")
			}
			if !tt.isLiqPx && !result.IsZero() {
				t.Errorf("calculateLiqPrice() expected zero, got %v", result)
			}
		})
	}
}
