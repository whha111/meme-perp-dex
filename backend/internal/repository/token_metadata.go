package repository

import (
	"gorm.io/gorm"

	"github.com/memeperp/backend/internal/model"
)

type TokenMetadataRepository struct {
	db *gorm.DB
}

func NewTokenMetadataRepository(db *gorm.DB) *TokenMetadataRepository {
	return &TokenMetadataRepository{db: db}
}

func (r *TokenMetadataRepository) GetByInstID(instID string) (*model.TokenMetadata, error) {
	var metadata model.TokenMetadata
	if err := r.db.Where("inst_id = ?", instID).First(&metadata).Error; err != nil {
		return nil, err
	}
	return &metadata, nil
}

func (r *TokenMetadataRepository) GetByTokenAddress(tokenAddress string) (*model.TokenMetadata, error) {
	var metadata model.TokenMetadata
	if err := r.db.Where("token_address = ?", tokenAddress).First(&metadata).Error; err != nil {
		return nil, err
	}
	return &metadata, nil
}

func (r *TokenMetadataRepository) Create(metadata *model.TokenMetadata) error {
	return r.db.Create(metadata).Error
}

func (r *TokenMetadataRepository) Update(metadata *model.TokenMetadata) error {
	return r.db.Save(metadata).Error
}

func (r *TokenMetadataRepository) GetAll() ([]model.TokenMetadata, error) {
	var metadataList []model.TokenMetadata
	if err := r.db.Find(&metadataList).Error; err != nil {
		return nil, err
	}
	return metadataList, nil
}

func (r *TokenMetadataRepository) GetByCreator(creatorAddress string) ([]model.TokenMetadata, error) {
	var metadataList []model.TokenMetadata
	if err := r.db.Where("creator_address = ?", creatorAddress).Find(&metadataList).Error; err != nil {
		return nil, err
	}
	return metadataList, nil
}
