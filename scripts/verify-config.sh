#!/bin/bash

# 配置验证脚本 / Configuration Verification Script
# 用于部署前检查所有必需的环境变量

set -e

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo ""
echo "======================================================================"
echo -e "${BLUE}  MemePerp DEX - Configuration Verification${NC}"
echo "======================================================================"
echo ""

# 检查计数器
ERRORS=0
WARNINGS=0
PASSED=0

# 验证函数
check_env() {
    local var_name="$1"
    local required="$2"
    local description="$3"

    if [ -z "${!var_name}" ]; then
        if [ "$required" = "true" ]; then
            echo -e "${RED}✗ $var_name${NC} - REQUIRED but not set"
            echo "  Description: $description"
            ((ERRORS++))
        else
            echo -e "${YELLOW}⚠ $var_name${NC} - Optional, not set"
            echo "  Description: $description"
            ((WARNINGS++))
        fi
    else
        echo -e "${GREEN}✓ $var_name${NC} = ${!var_name:0:20}..."
        ((PASSED++))
    fi
}

# ============================================================
# Part 1: 前端配置检查
# ============================================================

echo -e "${BLUE}Part 1: Frontend Configuration${NC}"
echo "----------------------------------------------------------------------"

cd frontend

# 加载 .env.local
if [ -f .env.local ]; then
    echo "Loading .env.local..."
    set -a
    source .env.local
    set +a
else
    echo -e "${RED}✗ .env.local not found!${NC}"
    echo "  Please copy .env.example to .env.local and fill in the values"
    ((ERRORS++))
fi

# 检查前端环境变量
check_env "NEXT_PUBLIC_API_URL" "true" "Backend API URL"
check_env "NEXT_PUBLIC_WEBSOCKET_URL" "true" "WebSocket URL for real-time updates"
check_env "NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID" "true" "WalletConnect Project ID"
check_env "NEXT_PUBLIC_SETTLEMENT_ADDRESS" "true" "Settlement contract address"
check_env "NEXT_PUBLIC_VAULT_ADDRESS" "false" "Vault contract address"
check_env "NEXT_PUBLIC_BASE_RPC_URL" "true" "Base chain RPC URL"
check_env "NEXT_PUBLIC_CHAIN_ID" "true" "Target chain ID"
check_env "NEXT_PUBLIC_BLOCK_EXPLORER_URL" "false" "Block explorer URL"

# 验证 API URL 格式
if [ ! -z "$NEXT_PUBLIC_API_URL" ]; then
    if [[ "$NEXT_PUBLIC_API_URL" == http://localhost* ]]; then
        echo -e "${YELLOW}⚠ Warning: API URL is localhost (development mode)${NC}"
        ((WARNINGS++))
    elif [[ "$NEXT_PUBLIC_API_URL" == https://* ]]; then
        echo -e "${GREEN}✓ API URL uses HTTPS${NC}"
    else
        echo -e "${RED}✗ API URL should use HTTPS in production${NC}"
        ((ERRORS++))
    fi
fi

# 验证 WebSocket URL 格式
if [ ! -z "$NEXT_PUBLIC_WEBSOCKET_URL" ]; then
    if [[ "$NEXT_PUBLIC_WEBSOCKET_URL" == ws://localhost* ]]; then
        echo -e "${YELLOW}⚠ Warning: WebSocket URL is localhost (development mode)${NC}"
        ((WARNINGS++))
    elif [[ "$NEXT_PUBLIC_WEBSOCKET_URL" == wss://* ]]; then
        echo -e "${GREEN}✓ WebSocket URL uses WSS (encrypted)${NC}"
    else
        echo -e "${RED}✗ WebSocket URL should use WSS in production${NC}"
        ((ERRORS++))
    fi
fi

cd ..

# ============================================================
# Part 2: 后端配置检查
# ============================================================

echo ""
echo -e "${BLUE}Part 2: Backend Configuration${NC}"
echo "----------------------------------------------------------------------"

# 检查后端配置文件
if [ -f backend/configs/config.yaml ] || [ -f backend/configs/config.production.yaml ]; then
    echo -e "${GREEN}✓ Backend config file exists${NC}"
else
    echo -e "${YELLOW}⚠ Backend config file not found${NC}"
    ((WARNINGS++))
fi

# 检查后端环境变量
check_env "MEMEPERP_DATABASE_HOST" "true" "Database host"
check_env "MEMEPERP_DATABASE_PASSWORD" "true" "Database password"
check_env "MEMEPERP_REDIS_PASSWORD" "false" "Redis password"
check_env "MEMEPERP_BLOCKCHAIN_RPC_URL" "true" "Blockchain RPC URL"
check_env "MEMEPERP_BLOCKCHAIN_PRIVATE_KEY" "true" "Keeper private key"
check_env "MEMEPERP_JWT_SECRET" "true" "JWT secret"
check_env "MEMEPERP_SETTLEMENT_ADDRESS" "true" "Settlement contract address"

# 验证私钥长度
if [ ! -z "$MEMEPERP_BLOCKCHAIN_PRIVATE_KEY" ]; then
    key_length=${#MEMEPERP_BLOCKCHAIN_PRIVATE_KEY}
    if [ $key_length -eq 66 ]; then
        echo -e "${GREEN}✓ Private key length correct (66 chars with 0x)${NC}"
    elif [ $key_length -eq 64 ]; then
        echo -e "${YELLOW}⚠ Private key length correct but missing 0x prefix${NC}"
        ((WARNINGS++))
    else
        echo -e "${RED}✗ Private key length incorrect (got $key_length, expected 64 or 66)${NC}"
        ((ERRORS++))
    fi
fi

# 验证 JWT Secret 长度
if [ ! -z "$MEMEPERP_JWT_SECRET" ]; then
    secret_length=${#MEMEPERP_JWT_SECRET}
    if [ $secret_length -ge 32 ]; then
        echo -e "${GREEN}✓ JWT secret length sufficient (>= 32)${NC}"
    else
        echo -e "${RED}✗ JWT secret too short (got $secret_length, need >= 32)${NC}"
        ((ERRORS++))
    fi
fi

# ============================================================
# Part 3: 合约配置检查
# ============================================================

echo ""
echo -e "${BLUE}Part 3: Contract Configuration${NC}"
echo "----------------------------------------------------------------------"

cd contracts

# 加载 .env
if [ -f .env ]; then
    echo "Loading contracts/.env..."
    set -a
    source .env
    set +a
else
    echo -e "${RED}✗ contracts/.env not found!${NC}"
    ((ERRORS++))
fi

check_env "PRIVATE_KEY" "true" "Deployment private key"
check_env "BASE_RPC_URL" "true" "Base Mainnet RPC URL"
check_env "BASESCAN_API_KEY" "false" "BaseScan API key for verification"

cd ..

# ============================================================
# Part 4: 数据库连接测试
# ============================================================

echo ""
echo -e "${BLUE}Part 4: Database Connection Test${NC}"
echo "----------------------------------------------------------------------"

if [ ! -z "$MEMEPERP_DATABASE_HOST" ] && [ ! -z "$MEMEPERP_DATABASE_PASSWORD" ]; then
    echo "Testing PostgreSQL connection..."

    if command -v psql &> /dev/null; then
        if PGPASSWORD=$MEMEPERP_DATABASE_PASSWORD psql -h $MEMEPERP_DATABASE_HOST -U ${MEMEPERP_DATABASE_USER:-memeperp} -d ${MEMEPERP_DATABASE_NAME:-memeperp} -c "SELECT 1" &> /dev/null; then
            echo -e "${GREEN}✓ Database connection successful${NC}"
        else
            echo -e "${RED}✗ Database connection failed${NC}"
            ((ERRORS++))
        fi
    else
        echo -e "${YELLOW}⚠ psql not installed, skipping database connection test${NC}"
        ((WARNINGS++))
    fi
else
    echo -e "${YELLOW}⚠ Database credentials not set, skipping connection test${NC}"
    ((WARNINGS++))
fi

# ============================================================
# Part 5: RPC 连接测试
# ============================================================

echo ""
echo -e "${BLUE}Part 5: RPC Connection Test${NC}"
echo "----------------------------------------------------------------------"

if [ ! -z "$MEMEPERP_BLOCKCHAIN_RPC_URL" ]; then
    echo "Testing RPC connection..."

    response=$(curl -s -X POST -H "Content-Type: application/json" \
        --data '{"jsonrpc":"2.0","method":"eth_blockNumber","params":[],"id":1}' \
        $MEMEPERP_BLOCKCHAIN_RPC_URL)

    if echo "$response" | grep -q "result"; then
        block_number=$(echo "$response" | grep -o '"result":"[^"]*"' | cut -d'"' -f4)
        echo -e "${GREEN}✓ RPC connection successful${NC}"
        echo "  Latest block: $block_number"
    else
        echo -e "${RED}✗ RPC connection failed${NC}"
        echo "  Response: $response"
        ((ERRORS++))
    fi
else
    echo -e "${YELLOW}⚠ RPC URL not set, skipping RPC test${NC}"
    ((WARNINGS++))
fi

# ============================================================
# Summary
# ============================================================

echo ""
echo "======================================================================"
echo -e "${BLUE}  Configuration Verification Summary${NC}"
echo "======================================================================"
echo ""
echo -e "  ${GREEN}Passed:${NC}   $PASSED"
echo -e "  ${YELLOW}Warnings:${NC} $WARNINGS"
echo -e "  ${RED}Errors:${NC}   $ERRORS"
echo ""

if [ $ERRORS -eq 0 ]; then
    echo -e "${GREEN}✅ Configuration verification PASSED!${NC}"
    echo ""
    echo "Your configuration is ready for deployment."
    echo ""
    exit 0
else
    echo -e "${RED}❌ Configuration verification FAILED!${NC}"
    echo ""
    echo "Please fix the errors above before deploying."
    echo ""
    exit 1
fi
