package repository

import (
	"gorm.io/gorm"

	"github.com/memeperp/backend/internal/model"
)

type InstrumentRepository struct {
	db *gorm.DB
}

func NewInstrumentRepository(db *gorm.DB) *InstrumentRepository {
	return &InstrumentRepository{db: db}
}

func (r *InstrumentRepository) GetByInstID(instID string) (*model.Instrument, error) {
	var inst model.Instrument
	if err := r.db.Where("inst_id = ?", instID).First(&inst).Error; err != nil {
		return nil, err
	}
	return &inst, nil
}

func (r *InstrumentRepository) GetAll() ([]model.Instrument, error) {
	var instruments []model.Instrument
	if err := r.db.Find(&instruments).Error; err != nil {
		return nil, err
	}
	return instruments, nil
}

func (r *InstrumentRepository) GetByType(instType string) ([]model.Instrument, error) {
	var instruments []model.Instrument
	if err := r.db.Where("inst_type = ?", instType).Find(&instruments).Error; err != nil {
		return nil, err
	}
	return instruments, nil
}

func (r *InstrumentRepository) GetLive() ([]model.Instrument, error) {
	var instruments []model.Instrument
	if err := r.db.Where("state = ?", "live").Find(&instruments).Error; err != nil {
		return nil, err
	}
	return instruments, nil
}

func (r *InstrumentRepository) Create(inst *model.Instrument) error {
	return r.db.Create(inst).Error
}

func (r *InstrumentRepository) Update(inst *model.Instrument) error {
	return r.db.Save(inst).Error
}
