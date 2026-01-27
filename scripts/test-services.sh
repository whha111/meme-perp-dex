#!/bin/bash

# 服务健康检查脚本 / Service Health Check Script

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo ""
echo "======================================================================"
echo -e "${BLUE}  MemePerp DEX - Service Health Check${NC}"
echo "======================================================================"
echo ""

PASSED=0
FAILED=0

check_service() {
    local name="$1"
    local test_command="$2"

    echo -n "Testing $name... "

    if eval "$test_command" > /dev/null 2>&1; then
        echo -e "${GREEN}✓ OK${NC}"
        ((PASSED++))
    else
        echo -e "${RED}✗ FAILED${NC}"
        ((FAILED++))
    fi
}

# ============================================================
# 1. 数据库服务
# ============================================================

echo -e "${BLUE}Database Services:${NC}"
echo "----------------------------------------------------------------------"

check_service "PostgreSQL (5432)" \
    "docker-compose exec -T postgres pg_isready -U postgres"

check_service "Redis (6379)" \
    "docker-compose exec -T redis redis-cli ping"

echo ""

# ============================================================
# 2. 区块链服务
# ============================================================

echo -e "${BLUE}Blockchain Services:${NC}"
echo "----------------------------------------------------------------------"

check_service "Anvil RPC (8545)" \
    "curl -s -X POST -H 'Content-Type: application/json' \
    --data '{\"jsonrpc\":\"2.0\",\"method\":\"eth_blockNumber\",\"params\":[],\"id\":1}' \
    http://127.0.0.1:8545"

echo ""

# ============================================================
# 3. 后端服务
# ============================================================

echo -e "${BLUE}Backend Services:${NC}"
echo "----------------------------------------------------------------------"

check_service "Go Backend API (8080)" \
    "curl -s http://localhost:8080/health"

check_service "Matching Engine (8081)" \
    "curl -s http://localhost:8081/health"

echo ""

# ============================================================
# 4. 前端服务
# ============================================================

echo -e "${BLUE}Frontend Services:${NC}"
echo "----------------------------------------------------------------------"

check_service "Next.js Frontend (3000)" \
    "curl -s http://localhost:3000"

echo ""

# ============================================================
# 5. 合约验证
# ============================================================

echo -e "${BLUE}Smart Contract Verification:${NC}"
echo "----------------------------------------------------------------------"

# 从前端配置读取合约地址
if [ -f frontend/.env.local ]; then
    SETTLEMENT_ADDRESS=$(grep NEXT_PUBLIC_SETTLEMENT_ADDRESS frontend/.env.local | cut -d'=' -f2)

    if [ ! -z "$SETTLEMENT_ADDRESS" ] && [ "$SETTLEMENT_ADDRESS" != "" ]; then
        echo -e "Settlement Contract: ${GREEN}$SETTLEMENT_ADDRESS${NC}"

        # 验证合约是否部署
        CODE=$(cast code $SETTLEMENT_ADDRESS --rpc-url http://127.0.0.1:8545 2>/dev/null)
        if [ ! -z "$CODE" ] && [ "$CODE" != "0x" ]; then
            echo -e "${GREEN}✓ Settlement contract deployed${NC}"
            ((PASSED++))
        else
            echo -e "${RED}✗ Settlement contract not found${NC}"
            ((FAILED++))
        fi
    else
        echo -e "${YELLOW}⚠ Settlement address not configured${NC}"
    fi
else
    echo -e "${YELLOW}⚠ .env.local not found${NC}"
fi

echo ""

# ============================================================
# Summary
# ============================================================

echo "======================================================================"
echo -e "${BLUE}  Health Check Summary${NC}"
echo "======================================================================"
echo ""
echo -e "  ${GREEN}Passed:${NC} $PASSED"
echo -e "  ${RED}Failed:${NC} $FAILED"
echo ""

if [ $FAILED -eq 0 ]; then
    echo -e "${GREEN}✅ All services are healthy!${NC}"
    echo ""
    exit 0
else
    echo -e "${RED}❌ Some services are not responding${NC}"
    echo ""
    echo "Troubleshooting tips:"
    echo "  1. Run: docker-compose ps"
    echo "  2. Check logs: tail -f logs/*.log"
    echo "  3. Restart services: ./scripts/start-full-stack.sh"
    echo ""
    exit 1
fi
