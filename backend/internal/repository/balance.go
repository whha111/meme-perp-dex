package repository

import (
	"gorm.io/gorm"

	"github.com/memeperp/backend/internal/model"
)

type BalanceRepository struct {
	db *gorm.DB
}

func NewBalanceRepository(db *gorm.DB) *BalanceRepository {
	return &BalanceRepository{db: db}
}

func (r *BalanceRepository) GetByUserAndCcy(userID int64, ccy string) (*model.Balance, error) {
	var balance model.Balance
	if err := r.db.Where("user_id = ? AND ccy = ?", userID, ccy).First(&balance).Error; err != nil {
		return nil, err
	}
	return &balance, nil
}

func (r *BalanceRepository) GetByUser(userID int64) ([]model.Balance, error) {
	var balances []model.Balance
	if err := r.db.Where("user_id = ?", userID).Find(&balances).Error; err != nil {
		return nil, err
	}
	return balances, nil
}

func (r *BalanceRepository) Create(balance *model.Balance) error {
	return r.db.Create(balance).Error
}

func (r *BalanceRepository) Update(balance *model.Balance) error {
	return r.db.Save(balance).Error
}

func (r *BalanceRepository) GetOrCreate(userID int64, ccy string) (*model.Balance, error) {
	var balance model.Balance
	err := r.db.Where("user_id = ? AND ccy = ?", userID, ccy).First(&balance).Error
	if err == gorm.ErrRecordNotFound {
		balance = model.Balance{
			UserID: userID,
			Ccy:    ccy,
		}
		if err := r.db.Create(&balance).Error; err != nil {
			return nil, err
		}
		return &balance, nil
	}
	if err != nil {
		return nil, err
	}
	return &balance, nil
}

// UpdateBalance atomically updates balance
func (r *BalanceRepository) UpdateBalance(userID int64, ccy string, delta model.Decimal) error {
	return r.db.Model(&model.Balance{}).
		Where("user_id = ? AND ccy = ?", userID, ccy).
		UpdateColumn("cash_bal", gorm.Expr("cash_bal + ?", delta.String())).
		UpdateColumn("avail_bal", gorm.Expr("avail_bal + ?", delta.String())).
		UpdateColumn("eq", gorm.Expr("eq + ?", delta.String())).
		Error
}

// FreezeBalance freezes balance for order
func (r *BalanceRepository) FreezeBalance(userID int64, ccy string, amount model.Decimal) error {
	return r.db.Model(&model.Balance{}).
		Where("user_id = ? AND ccy = ?", userID, ccy).
		UpdateColumn("avail_bal", gorm.Expr("avail_bal - ?", amount.String())).
		UpdateColumn("ord_frozen", gorm.Expr("ord_frozen + ?", amount.String())).
		Error
}

// UnfreezeBalance unfreezes balance
func (r *BalanceRepository) UnfreezeBalance(userID int64, ccy string, amount model.Decimal) error {
	return r.db.Model(&model.Balance{}).
		Where("user_id = ? AND ccy = ?", userID, ccy).
		UpdateColumn("avail_bal", gorm.Expr("avail_bal + ?", amount.String())).
		UpdateColumn("ord_frozen", gorm.Expr("ord_frozen - ?", amount.String())).
		Error
}
