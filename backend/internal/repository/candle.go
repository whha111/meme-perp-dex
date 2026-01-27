package repository

import (
	"gorm.io/gorm"

	"github.com/memeperp/backend/internal/model"
)

type CandleRepository struct {
	db *gorm.DB
}

func NewCandleRepository(db *gorm.DB) *CandleRepository {
	return &CandleRepository{db: db}
}

func (r *CandleRepository) Create(candle *model.Candle) error {
	return r.db.Create(candle).Error
}

func (r *CandleRepository) Upsert(candle *model.Candle) error {
	return r.db.Save(candle).Error
}

func (r *CandleRepository) GetByInstIDAndBar(instID, bar string, after, before int64, limit int) ([]model.Candle, error) {
	var candles []model.Candle
	query := r.db.Where("inst_id = ? AND bar = ?", instID, bar)
	if after > 0 {
		query = query.Where("ts < ?", after)
	}
	if before > 0 {
		query = query.Where("ts > ?", before)
	}
	if err := query.Order("ts DESC").Limit(limit).Find(&candles).Error; err != nil {
		return nil, err
	}
	// Reverse to ascending order
	for i, j := 0, len(candles)-1; i < j; i, j = i+1, j-1 {
		candles[i], candles[j] = candles[j], candles[i]
	}
	return candles, nil
}

func (r *CandleRepository) GetLatest(instID, bar string) (*model.Candle, error) {
	var candle model.Candle
	if err := r.db.Where("inst_id = ? AND bar = ?", instID, bar).Order("ts DESC").First(&candle).Error; err != nil {
		return nil, err
	}
	return &candle, nil
}

func (r *CandleRepository) GetByTimestamp(instID, bar string, ts int64) (*model.Candle, error) {
	var candle model.Candle
	if err := r.db.Where("inst_id = ? AND bar = ? AND ts = ?", instID, bar, ts).First(&candle).Error; err != nil {
		return nil, err
	}
	return &candle, nil
}

func (r *CandleRepository) UpdateOrCreate(candle *model.Candle) error {
	var existing model.Candle
	err := r.db.Where("inst_id = ? AND bar = ? AND ts = ?", candle.InstID, candle.Bar, candle.Ts).First(&existing).Error
	if err == gorm.ErrRecordNotFound {
		return r.db.Create(candle).Error
	}
	if err != nil {
		return err
	}
	candle.ID = existing.ID
	return r.db.Save(candle).Error
}

func (r *CandleRepository) ConfirmCandle(instID, bar string, ts int64) error {
	return r.db.Model(&model.Candle{}).
		Where("inst_id = ? AND bar = ? AND ts = ?", instID, bar, ts).
		Update("confirm", 1).Error
}
