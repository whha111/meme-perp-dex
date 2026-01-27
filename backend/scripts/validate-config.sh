#!/bin/bash

# Configuration Validation Script
# Validates environment variables and config files before starting the service

set -e

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

ERRORS=0
WARNINGS=0

echo ""
echo "================================================================="
echo -e "${BLUE}  MemePerp DEX - Configuration Validator${NC}"
echo "================================================================="
echo ""

# Determine environment
APP_ENV="${APP_ENV:-local}"
echo -e "${BLUE}Environment:${NC} $APP_ENV"
echo ""

# ============================================
# Check Required Environment Variables
# ============================================

echo -e "${BLUE}Checking required environment variables...${NC}"
echo "-------------------------------------------------------------------"

# JWT Secret (always required)
if [ -z "$MEMEPERP_JWT_SECRET" ]; then
    echo -e "${RED}✗${NC} MEMEPERP_JWT_SECRET is not set"
    echo "  Generate with: openssl rand -hex 32"
    ((ERRORS++))
else
    if [ ${#MEMEPERP_JWT_SECRET} -lt 32 ]; then
        echo -e "${RED}✗${NC} MEMEPERP_JWT_SECRET is too short (min 32 characters)"
        ((ERRORS++))
    else
        echo -e "${GREEN}✓${NC} MEMEPERP_JWT_SECRET is set (${#MEMEPERP_JWT_SECRET} characters)"
    fi
fi

# Blockchain RPC URL
if [ -z "$MEMEPERP_BLOCKCHAIN_RPC_URL" ]; then
    if [ "$APP_ENV" != "local" ]; then
        echo -e "${RED}✗${NC} MEMEPERP_BLOCKCHAIN_RPC_URL is not set"
        ((ERRORS++))
    else
        echo -e "${YELLOW}⚠${NC} MEMEPERP_BLOCKCHAIN_RPC_URL not set (will use default: http://127.0.0.1:8545)"
        ((WARNINGS++))
    fi
else
    echo -e "${GREEN}✓${NC} MEMEPERP_BLOCKCHAIN_RPC_URL is set: $MEMEPERP_BLOCKCHAIN_RPC_URL"
fi

# Settlement Contract Address
if [ -z "$MEMEPERP_BLOCKCHAIN_POSITION_ADDRESS" ]; then
    echo -e "${RED}✗${NC} MEMEPERP_BLOCKCHAIN_POSITION_ADDRESS is not set"
    echo "  Deploy Settlement contract first and set this variable"
    ((ERRORS++))
else
    echo -e "${GREEN}✓${NC} MEMEPERP_BLOCKCHAIN_POSITION_ADDRESS is set: $MEMEPERP_BLOCKCHAIN_POSITION_ADDRESS"
fi

# Matcher Private Key
if [ -z "$MEMEPERP_BLOCKCHAIN_PRIVATE_KEY" ]; then
    echo -e "${RED}✗${NC} MEMEPERP_BLOCKCHAIN_PRIVATE_KEY is not set"
    echo "  This is required for signing transactions"
    ((ERRORS++))
else
    echo -e "${GREEN}✓${NC} MEMEPERP_BLOCKCHAIN_PRIVATE_KEY is set"
fi

echo ""

# ============================================
# Production-Specific Checks
# ============================================

if [ "$APP_ENV" = "production" ] || [ "$APP_ENV" = "release" ]; then
    echo -e "${BLUE}Production environment checks...${NC}"
    echo "-------------------------------------------------------------------"

    # Database Password
    if [ -z "$MEMEPERP_DATABASE_PASSWORD" ] || [ "$MEMEPERP_DATABASE_PASSWORD" = "postgres" ]; then
        echo -e "${RED}✗${NC} MEMEPERP_DATABASE_PASSWORD must be set securely in production"
        ((ERRORS++))
    else
        echo -e "${GREEN}✓${NC} MEMEPERP_DATABASE_PASSWORD is set"
    fi

    # Redis Password
    if [ -z "$MEMEPERP_REDIS_PASSWORD" ]; then
        echo -e "${YELLOW}⚠${NC} MEMEPERP_REDIS_PASSWORD is not set"
        echo "  Consider setting a password for Redis in production"
        ((WARNINGS++))
    else
        echo -e "${GREEN}✓${NC} MEMEPERP_REDIS_PASSWORD is set"
    fi

    # CORS Origins
    if [ -z "$MEMEPERP_SECURITY_ALLOWED_ORIGINS" ]; then
        echo -e "${YELLOW}⚠${NC} MEMEPERP_SECURITY_ALLOWED_ORIGINS not set"
        echo "  Make sure to configure allowed origins in config file"
        ((WARNINGS++))
    else
        echo -e "${GREEN}✓${NC} MEMEPERP_SECURITY_ALLOWED_ORIGINS is set"
    fi

    echo ""
fi

# ============================================
# Check Config Files
# ============================================

echo -e "${BLUE}Checking configuration files...${NC}"
echo "-------------------------------------------------------------------"

if [ -f "configs/config.yaml" ]; then
    echo -e "${GREEN}✓${NC} configs/config.yaml exists"
else
    echo -e "${RED}✗${NC} configs/config.yaml not found"
    ((ERRORS++))
fi

ENV_CONFIG="configs/config.$APP_ENV.yaml"
if [ -f "$ENV_CONFIG" ]; then
    echo -e "${GREEN}✓${NC} $ENV_CONFIG exists"
else
    echo -e "${YELLOW}⚠${NC} $ENV_CONFIG not found (optional)"
    ((WARNINGS++))
fi

echo ""

# ============================================
# Check Blockchain Connectivity
# ============================================

if [ -n "$MEMEPERP_BLOCKCHAIN_RPC_URL" ]; then
    echo -e "${BLUE}Testing blockchain connectivity...${NC}"
    echo "-------------------------------------------------------------------"

    # Try to connect to RPC
    if command -v curl &> /dev/null; then
        HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" \
            -X POST \
            -H "Content-Type: application/json" \
            --data '{"jsonrpc":"2.0","method":"eth_chainId","params":[],"id":1}' \
            "$MEMEPERP_BLOCKCHAIN_RPC_URL" 2>/dev/null || echo "000")

        if [ "$HTTP_CODE" = "200" ]; then
            echo -e "${GREEN}✓${NC} RPC endpoint is reachable"
        else
            echo -e "${YELLOW}⚠${NC} Cannot reach RPC endpoint (HTTP $HTTP_CODE)"
            echo "  Make sure Anvil or your RPC provider is running"
            ((WARNINGS++))
        fi
    else
        echo -e "${YELLOW}⚠${NC} curl not found, skipping connectivity test"
    fi

    echo ""
fi

# ============================================
# Summary
# ============================================

echo "================================================================="
if [ $ERRORS -eq 0 ]; then
    echo -e "${GREEN}✅  Configuration validation passed${NC}"
    if [ $WARNINGS -gt 0 ]; then
        echo -e "${YELLOW}⚠  $WARNINGS warning(s) - review above${NC}"
    fi
    echo "================================================================="
    echo ""
    exit 0
else
    echo -e "${RED}❌  Configuration validation failed${NC}"
    echo -e "${RED}   $ERRORS error(s) found${NC}"
    if [ $WARNINGS -gt 0 ]; then
        echo -e "${YELLOW}   $WARNINGS warning(s) found${NC}"
    fi
    echo "================================================================="
    echo ""
    echo "Please fix the errors above and try again."
    echo ""
    exit 1
fi
