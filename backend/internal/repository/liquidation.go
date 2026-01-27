package repository

import (
	"gorm.io/gorm"

	"github.com/memeperp/backend/internal/model"
)

type LiquidationRepository struct {
	db *gorm.DB
}

func NewLiquidationRepository(db *gorm.DB) *LiquidationRepository {
	return &LiquidationRepository{db: db}
}

func (r *LiquidationRepository) Create(liq *model.Liquidation) error {
	return r.db.Create(liq).Error
}

func (r *LiquidationRepository) GetByUser(userID int64, instID string, after, before int64, limit int) ([]model.Liquidation, error) {
	var liquidations []model.Liquidation
	query := r.db.Where("user_id = ?", userID)
	if instID != "" {
		query = query.Where("inst_id = ?", instID)
	}
	if after > 0 {
		query = query.Where("ts < ?", after)
	}
	if before > 0 {
		query = query.Where("ts > ?", before)
	}
	if err := query.Order("ts DESC").Limit(limit).Find(&liquidations).Error; err != nil {
		return nil, err
	}
	return liquidations, nil
}

func (r *LiquidationRepository) GetRecent(instID string, limit int) ([]model.Liquidation, error) {
	var liquidations []model.Liquidation
	query := r.db.Model(&model.Liquidation{})
	if instID != "" {
		query = query.Where("inst_id = ?", instID)
	}
	if err := query.Order("ts DESC").Limit(limit).Find(&liquidations).Error; err != nil {
		return nil, err
	}
	return liquidations, nil
}

func (r *LiquidationRepository) GetByTxHash(txHash string) (*model.Liquidation, error) {
	var liq model.Liquidation
	if err := r.db.Where("tx_hash = ?", txHash).First(&liq).Error; err != nil {
		return nil, err
	}
	return &liq, nil
}
