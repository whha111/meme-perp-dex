package repository

import (
	"gorm.io/gorm"

	"github.com/memeperp/backend/internal/model"
)

type FundingRateRepository struct {
	db *gorm.DB
}

func NewFundingRateRepository(db *gorm.DB) *FundingRateRepository {
	return &FundingRateRepository{db: db}
}

func (r *FundingRateRepository) Create(rate *model.FundingRate) error {
	return r.db.Create(rate).Error
}

func (r *FundingRateRepository) GetLatest(instID string) (*model.FundingRate, error) {
	var rate model.FundingRate
	if err := r.db.Where("inst_id = ?", instID).Order("funding_time DESC").First(&rate).Error; err != nil {
		return nil, err
	}
	return &rate, nil
}

func (r *FundingRateRepository) GetHistory(instID string, after, before int64, limit int) ([]model.FundingRate, error) {
	var rates []model.FundingRate
	query := r.db.Where("inst_id = ?", instID)
	if after > 0 {
		query = query.Where("funding_time < ?", after)
	}
	if before > 0 {
		query = query.Where("funding_time > ?", before)
	}
	if err := query.Order("funding_time DESC").Limit(limit).Find(&rates).Error; err != nil {
		return nil, err
	}
	return rates, nil
}

func (r *FundingRateRepository) GetByFundingTime(instID string, fundingTime int64) (*model.FundingRate, error) {
	var rate model.FundingRate
	if err := r.db.Where("inst_id = ? AND funding_time = ?", instID, fundingTime).First(&rate).Error; err != nil {
		return nil, err
	}
	return &rate, nil
}
