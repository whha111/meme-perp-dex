#!/bin/bash

# 启动所有服务 / Start All Services
# 用于本地开发和测试

set -e

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

PROJECT_ROOT="/Users/qinlinqiu/Desktop/meme-perp-dex"

# 日志目录
LOG_DIR="$PROJECT_ROOT/logs"
mkdir -p "$LOG_DIR"

echo ""
echo "======================================================================"
echo -e "${BLUE}  MemePerp DEX - Starting All Services${NC}"
echo "======================================================================"
echo ""

# 清理函数
cleanup() {
    echo ""
    echo -e "${YELLOW}Stopping all services...${NC}"

    # 停止所有后台进程
    if [ ! -z "$ANVIL_PID" ]; then
        echo "Stopping Anvil (PID: $ANVIL_PID)..."
        kill $ANVIL_PID 2>/dev/null || true
    fi

    if [ ! -z "$MATCHING_PID" ]; then
        echo "Stopping Matching Engine (PID: $MATCHING_PID)..."
        kill $MATCHING_PID 2>/dev/null || true
    fi

    if [ ! -z "$FRONTEND_PID" ]; then
        echo "Stopping Frontend (PID: $FRONTEND_PID)..."
        kill $FRONTEND_PID 2>/dev/null || true
    fi

    # 清理其他可能的进程
    pkill -f "anvil --port 8545" || true
    pkill -f "tsx.*server.ts" || true
    pkill -f "next dev" || true

    echo -e "${GREEN}All services stopped.${NC}"
    exit 0
}

# 捕获 Ctrl+C
trap cleanup SIGINT SIGTERM

# ============================================================
# Step 1: 检查依赖
# ============================================================

echo -e "${BLUE}Step 1: Checking Dependencies${NC}"
echo "----------------------------------------------------------------------"

# 检查 Node.js
if ! command -v node &> /dev/null; then
    echo -e "${RED}✗ Node.js not found${NC}"
    exit 1
fi
echo -e "${GREEN}✓ Node.js:${NC} $(node --version)"

# 检查 npm
if ! command -v npm &> /dev/null; then
    echo -e "${RED}✗ npm not found${NC}"
    exit 1
fi
echo -e "${GREEN}✓ npm:${NC} $(npm --version)"

# 检查 Foundry
if ! command -v anvil &> /dev/null; then
    echo -e "${RED}✗ Anvil not found (Install Foundry: https://book.getfoundry.sh/)${NC}"
    exit 1
fi
echo -e "${GREEN}✓ Foundry:${NC} installed"

# 检查 tsx
if ! command -v npx &> /dev/null; then
    echo -e "${RED}✗ npx not found${NC}"
    exit 1
fi
echo -e "${GREEN}✓ tsx:${NC} available via npx"

# ============================================================
# Step 2: 准备环境
# ============================================================

echo ""
echo -e "${BLUE}Step 2: Preparing Environment${NC}"
echo "----------------------------------------------------------------------"

# 设置前端环境变量
cd "$PROJECT_ROOT/frontend"
if [ ! -f ".env.local" ]; then
    echo -e "${YELLOW}⚠ .env.local not found, creating from .env.example...${NC}"
    cp .env.example .env.local

    # 设置本地开发环境变量
    cat > .env.local << EOF
# Local Development Configuration
NEXT_PUBLIC_API_URL=http://localhost:8080
NEXT_PUBLIC_WEBSOCKET_URL=ws://localhost:8080/ws
NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID=test_project_id
NEXT_PUBLIC_BASE_RPC_URL=http://127.0.0.1:8545
NEXT_PUBLIC_CHAIN_ID=31337
NEXT_PUBLIC_TARGET_CHAIN_ID=31337
NEXT_PUBLIC_BLOCK_EXPLORER_URL=http://localhost:8545

# Contracts (will be deployed)
NEXT_PUBLIC_SETTLEMENT_ADDRESS=
NEXT_PUBLIC_VAULT_ADDRESS=
EOF
    echo -e "${GREEN}✓ Created .env.local${NC}"
else
    echo -e "${GREEN}✓ .env.local exists${NC}"
fi

# 检查 node_modules
cd "$PROJECT_ROOT/frontend"
if [ ! -d "node_modules" ]; then
    echo -e "${YELLOW}Installing frontend dependencies...${NC}"
    npm install
fi
echo -e "${GREEN}✓ Frontend dependencies ready${NC}"

cd "$PROJECT_ROOT/backend"
if [ ! -d "node_modules" ]; then
    echo -e "${YELLOW}Installing backend dependencies...${NC}"
    npm install
fi
echo -e "${GREEN}✓ Backend dependencies ready${NC}"

# 编译合约
cd "$PROJECT_ROOT/contracts"
echo -e "${YELLOW}Compiling contracts...${NC}"
forge build > "$LOG_DIR/forge-build.log" 2>&1
echo -e "${GREEN}✓ Contracts compiled${NC}"

# ============================================================
# Step 3: 启动 Anvil 本地节点
# ============================================================

echo ""
echo -e "${BLUE}Step 3: Starting Anvil Local Node${NC}"
echo "----------------------------------------------------------------------"

# 停止已有的 Anvil
pkill -f "anvil --port 8545" || true
sleep 1

# 启动 Anvil
anvil --port 8545 > "$LOG_DIR/anvil.log" 2>&1 &
ANVIL_PID=$!

echo -e "${GREEN}✓ Anvil started (PID: $ANVIL_PID)${NC}"
echo "  RPC URL: http://127.0.0.1:8545"
echo "  Chain ID: 31337 (Foundry)"
echo "  Logs: $LOG_DIR/anvil.log"

# 等待 Anvil 启动
echo -n "  Waiting for Anvil to be ready"
for i in {1..10}; do
    if curl -s -X POST -H "Content-Type: application/json" \
        --data '{"jsonrpc":"2.0","method":"eth_blockNumber","params":[],"id":1}' \
        http://127.0.0.1:8545 > /dev/null 2>&1; then
        echo -e " ${GREEN}✓${NC}"
        break
    fi
    echo -n "."
    sleep 1
done

# ============================================================
# Step 4: 部署合约
# ============================================================

echo ""
echo -e "${BLUE}Step 4: Deploying Contracts${NC}"
echo "----------------------------------------------------------------------"

cd "$PROJECT_ROOT/contracts"

# 使用 Anvil 默认账户私钥
DEPLOYER_KEY="0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80"

# 部署 Settlement
echo "Deploying Settlement contract..."
DEPLOY_OUTPUT=$(forge create src/core/Settlement.sol:Settlement \
    --rpc-url http://127.0.0.1:8545 \
    --private-key $DEPLOYER_KEY \
    2>&1)

SETTLEMENT_ADDRESS=$(echo "$DEPLOY_OUTPUT" | grep "Deployed to:" | awk '{print $3}')

if [ -z "$SETTLEMENT_ADDRESS" ]; then
    echo -e "${RED}✗ Failed to deploy Settlement${NC}"
    echo "$DEPLOY_OUTPUT"
    cleanup
fi

echo -e "${GREEN}✓ Settlement deployed:${NC} $SETTLEMENT_ADDRESS"

# 更新前端配置
cd "$PROJECT_ROOT/frontend"
if [ -f ".env.local" ]; then
    sed -i.bak "s|NEXT_PUBLIC_SETTLEMENT_ADDRESS=.*|NEXT_PUBLIC_SETTLEMENT_ADDRESS=$SETTLEMENT_ADDRESS|" .env.local
    rm -f .env.local.bak
fi

# ============================================================
# Step 5: 初始化合约
# ============================================================

echo ""
echo -e "${BLUE}Step 5: Initializing Contracts${NC}"
echo "----------------------------------------------------------------------"

cd "$PROJECT_ROOT/contracts"

# Matcher 账户
MATCHER_ADDRESS="0x70997970C51812dc3A010C7d01b50e0d17dc79C8"

# 授权 Matcher
echo "Authorizing matcher..."
cast send $SETTLEMENT_ADDRESS \
    "setAuthorizedMatcher(address,bool)" \
    $MATCHER_ADDRESS \
    true \
    --rpc-url http://127.0.0.1:8545 \
    --private-key $DEPLOYER_KEY \
    > /dev/null 2>&1

echo -e "${GREEN}✓ Matcher authorized:${NC} $MATCHER_ADDRESS"

# 设置保险基金
INSURANCE_FUND="0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC"

cast send $SETTLEMENT_ADDRESS \
    "setInsuranceFund(address)" \
    $INSURANCE_FUND \
    --rpc-url http://127.0.0.1:8545 \
    --private-key $DEPLOYER_KEY \
    > /dev/null 2>&1

echo -e "${GREEN}✓ Insurance fund set:${NC} $INSURANCE_FUND"

# ============================================================
# Step 6: 启动撮合引擎
# ============================================================

echo ""
echo -e "${BLUE}Step 6: Starting Matching Engine${NC}"
echo "----------------------------------------------------------------------"

cd "$PROJECT_ROOT/backend/src/matching"

# 创建配置文件
cat > config.local.json << EOF
{
  "port": 8080,
  "settlementAddress": "$SETTLEMENT_ADDRESS",
  "rpcUrl": "http://127.0.0.1:8545",
  "matcherPrivateKey": "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d",
  "chainId": 31337
}
EOF

# 启动服务器
npx tsx server.ts > "$LOG_DIR/matching-engine.log" 2>&1 &
MATCHING_PID=$!

echo -e "${GREEN}✓ Matching Engine started (PID: $MATCHING_PID)${NC}"
echo "  API URL: http://localhost:8080"
echo "  Logs: $LOG_DIR/matching-engine.log"

# 等待服务器启动
echo -n "  Waiting for API to be ready"
for i in {1..15}; do
    if curl -s http://localhost:8080/health > /dev/null 2>&1; then
        echo -e " ${GREEN}✓${NC}"
        break
    fi
    echo -n "."
    sleep 1
done

# ============================================================
# Step 7: 启动前端
# ============================================================

echo ""
echo -e "${BLUE}Step 7: Starting Frontend${NC}"
echo "----------------------------------------------------------------------"

cd "$PROJECT_ROOT/frontend"

# 构建前端（开发模式）
npm run dev > "$LOG_DIR/frontend.log" 2>&1 &
FRONTEND_PID=$!

echo -e "${GREEN}✓ Frontend started (PID: $FRONTEND_PID)${NC}"
echo "  URL: http://localhost:3000"
echo "  Logs: $LOG_DIR/frontend.log"

# 等待前端启动
echo -n "  Waiting for frontend to be ready"
for i in {1..30}; do
    if curl -s http://localhost:3000 > /dev/null 2>&1; then
        echo -e " ${GREEN}✓${NC}"
        break
    fi
    echo -n "."
    sleep 1
done

# ============================================================
# Step 8: 显示服务信息
# ============================================================

echo ""
echo "======================================================================"
echo -e "${GREEN}  All Services Started Successfully!${NC}"
echo "======================================================================"
echo ""
echo -e "${CYAN}Service Status:${NC}"
echo "----------------------------------------------------------------------"
echo -e "  ${GREEN}✓${NC} Anvil Local Node"
echo "    - RPC URL: ${BLUE}http://127.0.0.1:8545${NC}"
echo "    - Chain ID: 31337"
echo "    - PID: $ANVIL_PID"
echo ""
echo -e "  ${GREEN}✓${NC} Smart Contracts"
echo "    - Settlement: ${BLUE}$SETTLEMENT_ADDRESS${NC}"
echo "    - Matcher: ${BLUE}$MATCHER_ADDRESS${NC}"
echo ""
echo -e "  ${GREEN}✓${NC} Matching Engine API"
echo "    - API URL: ${BLUE}http://localhost:8080${NC}"
echo "    - Health: ${BLUE}http://localhost:8080/health${NC}"
echo "    - PID: $MATCHING_PID"
echo ""
echo -e "  ${GREEN}✓${NC} Frontend Application"
echo "    - URL: ${BLUE}http://localhost:3000${NC}"
echo "    - PID: $FRONTEND_PID"
echo ""
echo "----------------------------------------------------------------------"
echo ""
echo -e "${CYAN}Test Accounts (Anvil Default):${NC}"
echo "----------------------------------------------------------------------"
echo "  Account #0: 0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266"
echo "    Private Key: 0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80"
echo "    Balance: 10000 ETH"
echo ""
echo "  Account #1: 0x70997970C51812dc3A010C7d01b50e0d17dc79C8"
echo "    Private Key: 0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d"
echo "    Balance: 10000 ETH"
echo ""
echo "  Account #2: 0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC"
echo "    Private Key: 0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a"
echo "    Balance: 10000 ETH"
echo ""
echo "----------------------------------------------------------------------"
echo ""
echo -e "${CYAN}Quick Test Commands:${NC}"
echo "----------------------------------------------------------------------"
echo "  # Check API health"
echo "  curl http://localhost:8080/health"
echo ""
echo "  # Check RPC"
echo "  curl -X POST http://127.0.0.1:8545 \\"
echo "    -H 'Content-Type: application/json' \\"
echo "    -d '{\"jsonrpc\":\"2.0\",\"method\":\"eth_blockNumber\",\"params\":[],\"id\":1}'"
echo ""
echo "  # View logs"
echo "  tail -f $LOG_DIR/anvil.log"
echo "  tail -f $LOG_DIR/matching-engine.log"
echo "  tail -f $LOG_DIR/frontend.log"
echo ""
echo "----------------------------------------------------------------------"
echo ""
echo -e "${YELLOW}Press Ctrl+C to stop all services${NC}"
echo ""

# 保持脚本运行
wait
