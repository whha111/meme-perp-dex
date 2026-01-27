package repository

import (
	"gorm.io/gorm"

	"github.com/memeperp/backend/internal/model"
)

type UserRepository struct {
	db *gorm.DB
}

func NewUserRepository(db *gorm.DB) *UserRepository {
	return &UserRepository{db: db}
}

func (r *UserRepository) GetByID(id int64) (*model.User, error) {
	var user model.User
	if err := r.db.First(&user, id).Error; err != nil {
		return nil, err
	}
	return &user, nil
}

func (r *UserRepository) GetByAddress(address string) (*model.User, error) {
	var user model.User
	if err := r.db.Where("address = ?", address).First(&user).Error; err != nil {
		return nil, err
	}
	return &user, nil
}

func (r *UserRepository) GetByAPIKey(apiKey string) (*model.User, error) {
	var user model.User
	if err := r.db.Where("api_key = ?", apiKey).First(&user).Error; err != nil {
		return nil, err
	}
	return &user, nil
}

func (r *UserRepository) Create(user *model.User) error {
	return r.db.Create(user).Error
}

func (r *UserRepository) Update(user *model.User) error {
	return r.db.Save(user).Error
}

func (r *UserRepository) GetOrCreate(address string) (*model.User, error) {
	var user model.User
	err := r.db.Where("address = ?", address).First(&user).Error
	if err == gorm.ErrRecordNotFound {
		user = model.User{Address: address}
		if err := r.db.Create(&user).Error; err != nil {
			return nil, err
		}
		return &user, nil
	}
	if err != nil {
		return nil, err
	}
	return &user, nil
}
