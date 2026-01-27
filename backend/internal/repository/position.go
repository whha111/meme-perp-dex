package repository

import (
	"gorm.io/gorm"

	"github.com/memeperp/backend/internal/model"
)

type PositionRepository struct {
	db *gorm.DB
}

func NewPositionRepository(db *gorm.DB) *PositionRepository {
	return &PositionRepository{db: db}
}

func (r *PositionRepository) GetByPosID(posID string) (*model.Position, error) {
	var pos model.Position
	if err := r.db.Where("pos_id = ?", posID).First(&pos).Error; err != nil {
		return nil, err
	}
	return &pos, nil
}

func (r *PositionRepository) GetByUserAndInst(userID int64, instID, posSide, mgnMode string) (*model.Position, error) {
	var pos model.Position
	if err := r.db.Where("user_id = ? AND inst_id = ? AND pos_side = ? AND mgn_mode = ?",
		userID, instID, posSide, mgnMode).First(&pos).Error; err != nil {
		return nil, err
	}
	return &pos, nil
}

func (r *PositionRepository) Create(pos *model.Position) error {
	return r.db.Create(pos).Error
}

func (r *PositionRepository) Update(pos *model.Position) error {
	return r.db.Save(pos).Error
}

func (r *PositionRepository) Delete(posID string) error {
	return r.db.Where("pos_id = ?", posID).Delete(&model.Position{}).Error
}

func (r *PositionRepository) GetByUser(userID int64, instID string) ([]model.Position, error) {
	var positions []model.Position
	query := r.db.Where("user_id = ?", userID)
	if instID != "" {
		query = query.Where("inst_id = ?", instID)
	}
	// Only return positions with non-zero size
	query = query.Where("pos != 0")
	if err := query.Find(&positions).Error; err != nil {
		return nil, err
	}
	return positions, nil
}

func (r *PositionRepository) GetAllNonZero() ([]model.Position, error) {
	var positions []model.Position
	if err := r.db.Where("pos != 0").Find(&positions).Error; err != nil {
		return nil, err
	}
	return positions, nil
}

func (r *PositionRepository) GetByInstID(instID string) ([]model.Position, error) {
	var positions []model.Position
	if err := r.db.Where("inst_id = ? AND pos != 0", instID).Find(&positions).Error; err != nil {
		return nil, err
	}
	return positions, nil
}

func (r *PositionRepository) GetOrCreate(userID int64, instID, posSide, mgnMode string, lever int16) (*model.Position, error) {
	var pos model.Position
	err := r.db.Where("user_id = ? AND inst_id = ? AND pos_side = ? AND mgn_mode = ?",
		userID, instID, posSide, mgnMode).First(&pos).Error
	if err == gorm.ErrRecordNotFound {
		pos = model.Position{
			UserID:  userID,
			InstID:  instID,
			PosSide: posSide,
			MgnMode: mgnMode,
			Lever:   lever,
		}
		if err := r.db.Create(&pos).Error; err != nil {
			return nil, err
		}
		return &pos, nil
	}
	if err != nil {
		return nil, err
	}
	return &pos, nil
}

// GetLeverageSetting gets the leverage setting for a user
func (r *PositionRepository) GetLeverageSetting(userID int64, instID, mgnMode, posSide string) (*model.LeverageSetting, error) {
	var setting model.LeverageSetting
	query := r.db.Where("user_id = ? AND inst_id = ? AND mgn_mode = ?", userID, instID, mgnMode)
	if posSide != "" {
		query = query.Where("pos_side = ?", posSide)
	}
	if err := query.First(&setting).Error; err != nil {
		return nil, err
	}
	return &setting, nil
}

// SetLeverageSetting sets the leverage for a user
func (r *PositionRepository) SetLeverageSetting(setting *model.LeverageSetting) error {
	return r.db.Save(setting).Error
}
