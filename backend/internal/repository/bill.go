package repository

import (
	"gorm.io/gorm"

	"github.com/memeperp/backend/internal/model"
)

type BillRepository struct {
	db *gorm.DB
}

func NewBillRepository(db *gorm.DB) *BillRepository {
	return &BillRepository{db: db}
}

func (r *BillRepository) Create(bill *model.Bill) error {
	return r.db.Create(bill).Error
}

func (r *BillRepository) GetByUser(userID int64, instType, ccy string, billType int16, after, before int64, limit int) ([]model.Bill, error) {
	var bills []model.Bill
	query := r.db.Where("user_id = ?", userID)
	if ccy != "" {
		query = query.Where("ccy = ?", ccy)
	}
	if billType > 0 {
		query = query.Where("type = ?", billType)
	}
	if after > 0 {
		query = query.Where("ts < ?", after)
	}
	if before > 0 {
		query = query.Where("ts > ?", before)
	}
	if err := query.Order("ts DESC").Limit(limit).Find(&bills).Error; err != nil {
		return nil, err
	}
	return bills, nil
}

func (r *BillRepository) GetByBillID(billID string) (*model.Bill, error) {
	var bill model.Bill
	if err := r.db.Where("bill_id = ?", billID).First(&bill).Error; err != nil {
		return nil, err
	}
	return &bill, nil
}
