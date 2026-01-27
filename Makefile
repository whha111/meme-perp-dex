.PHONY: all build clean test dev

# ============================================================
# 全局命令
# ============================================================

all: build

build: build-frontend build-backend build-contracts

clean: clean-frontend clean-backend clean-contracts

test: test-frontend test-backend test-contracts

# ============================================================
# 前端命令
# ============================================================

.PHONY: dev-frontend build-frontend clean-frontend test-frontend

dev-frontend:
	cd frontend && pnpm dev

build-frontend:
	cd frontend && pnpm build

clean-frontend:
	cd frontend && rm -rf dist node_modules

test-frontend:
	cd frontend && pnpm test

install-frontend:
	cd frontend && pnpm install

# ============================================================
# 后端命令
# ============================================================

.PHONY: dev-backend build-backend clean-backend test-backend

dev-backend:
	cd backend && go run cmd/api/main.go

build-backend:
	cd backend && go build -o bin/api cmd/api/main.go
	cd backend && go build -o bin/keeper cmd/keeper/main.go
	cd backend && go build -o bin/indexer cmd/indexer/main.go

clean-backend:
	cd backend && rm -rf bin

test-backend:
	cd backend && go test ./...

# ============================================================
# 智能合约命令
# ============================================================

.PHONY: build-contracts clean-contracts test-contracts deploy-contracts install-contracts

install-contracts:
	cd contracts && forge install OpenZeppelin/openzeppelin-contracts --no-commit

build-contracts:
	cd contracts && forge build

clean-contracts:
	cd contracts && forge clean

test-contracts:
	cd contracts && forge test -vvv

# Base Chain (测试用)
deploy-base-sepolia:
	cd contracts && forge script script/Deploy.s.sol --rpc-url base_sepolia --broadcast --verify

deploy-base:
	cd contracts && forge script script/Deploy.s.sol --rpc-url base --broadcast --verify

# BSC Chain (正式用)
deploy-bsc-testnet:
	cd contracts && forge script script/Deploy.s.sol --rpc-url bsc_testnet --broadcast --verify

deploy-bsc:
	cd contracts && forge script script/Deploy.s.sol --rpc-url bsc --broadcast --verify

# ============================================================
# Docker 命令
# ============================================================

.PHONY: docker-build docker-up docker-down

docker-build:
	docker-compose build

docker-up:
	docker-compose up -d

docker-down:
	docker-compose down

# ============================================================
# 数据库命令
# ============================================================

.PHONY: db-migrate db-rollback

db-migrate:
	cd backend && go run cmd/migrate/main.go up

db-rollback:
	cd backend && go run cmd/migrate/main.go down

# ============================================================
# 帮助
# ============================================================

.PHONY: help

help:
	@echo "MEME Perp DEX - Makefile Commands"
	@echo ""
	@echo "Global:"
	@echo "  make build          - Build all projects"
	@echo "  make clean          - Clean all build artifacts"
	@echo "  make test           - Run all tests"
	@echo ""
	@echo "Frontend:"
	@echo "  make dev-frontend   - Start frontend dev server"
	@echo "  make build-frontend - Build frontend for production"
	@echo "  make install-frontend - Install frontend dependencies"
	@echo ""
	@echo "Backend:"
	@echo "  make dev-backend    - Start backend API server"
	@echo "  make build-backend  - Build backend binaries"
	@echo ""
	@echo "Contracts:"
	@echo "  make install-contracts   - Install contract dependencies (OpenZeppelin)"
	@echo "  make build-contracts     - Compile smart contracts"
	@echo "  make test-contracts      - Run contract tests"
	@echo ""
	@echo "  Base Chain (测试):"
	@echo "  make deploy-base-sepolia - Deploy to Base Sepolia Testnet"
	@echo "  make deploy-base         - Deploy to Base Mainnet"
	@echo ""
	@echo "  BSC Chain (正式):"
	@echo "  make deploy-bsc-testnet  - Deploy to BSC Testnet"
	@echo "  make deploy-bsc          - Deploy to BSC Mainnet"
	@echo ""
	@echo "Docker:"
	@echo "  make docker-up      - Start all services with Docker"
	@echo "  make docker-down    - Stop all Docker services"
