#!/bin/bash

# 修复关键配置问题脚本
# 生成时间: 2026-01-22

set -e

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

PROJECT_ROOT="/Users/qinlinqiu/Desktop/meme-perp-dex"

echo ""
echo "================================================================="
echo -e "${BLUE}  MemePerp DEX - 关键问题修复工具${NC}"
echo "================================================================="
echo ""
echo "本脚本将帮助你修复审查中发现的关键问题"
echo ""

# ============================================================
# 1. 生成安全的密钥
# ============================================================

echo -e "${BLUE}Step 1: 生成安全密钥${NC}"
echo "-------------------------------------------------------------------"

# 生成 JWT 密钥（64字节）
JWT_SECRET=$(openssl rand -hex 32)
echo "✓ JWT Secret: $JWT_SECRET"

# 生成数据库密码（32字节）
DB_PASSWORD=$(openssl rand -hex 16)
echo "✓ Database Password: $DB_PASSWORD"

# 生成 Redis 密码（32字节）
REDIS_PASSWORD=$(openssl rand -hex 16)
echo "✓ Redis Password: $REDIS_PASSWORD"

echo ""

# ============================================================
# 2. 统一合约地址配置
# ============================================================

echo -e "${BLUE}Step 2: 统一合约地址配置${NC}"
echo "-------------------------------------------------------------------"

# 从前端读取当前的 Settlement 地址
if [ -f "$PROJECT_ROOT/frontend/.env.local" ]; then
    SETTLEMENT_ADDRESS=$(grep NEXT_PUBLIC_SETTLEMENT_ADDRESS "$PROJECT_ROOT/frontend/.env.local" | cut -d'=' -f2)
    echo "当前 Settlement 地址: $SETTLEMENT_ADDRESS"
else
    echo -e "${YELLOW}⚠ 前端配置文件不存在${NC}"
    SETTLEMENT_ADDRESS=""
fi

# 如果没有地址，提示用户输入
if [ -z "$SETTLEMENT_ADDRESS" ] || [ "$SETTLEMENT_ADDRESS" = "" ]; then
    echo ""
    read -p "请输入 Settlement 合约地址（或按 Enter 使用测试地址）: " USER_INPUT
    if [ -z "$USER_INPUT" ]; then
        SETTLEMENT_ADDRESS="0x5FbDB2315678afecb367f032d93F642f64180aa3"  # Anvil 测试地址
        echo "使用测试地址: $SETTLEMENT_ADDRESS"
    else
        SETTLEMENT_ADDRESS=$USER_INPUT
    fi
fi

echo ""

# ============================================================
# 3. 统一 RPC URL
# ============================================================

echo -e "${BLUE}Step 3: 统一 RPC URL${NC}"
echo "-------------------------------------------------------------------"

echo "请选择网络:"
echo "  1) 本地测试 (Anvil - http://127.0.0.1:8545)"
echo "  2) Base Sepolia 测试网"
echo "  3) Base 主网"
echo ""
read -p "选择 [1-3]: " NETWORK_CHOICE

case $NETWORK_CHOICE in
    1)
        RPC_URL="http://127.0.0.1:8545"
        CHAIN_ID=31337
        NETWORK_NAME="Anvil Local"
        ;;
    2)
        RPC_URL="https://sepolia.base.org"
        CHAIN_ID=84532
        NETWORK_NAME="Base Sepolia"
        ;;
    3)
        RPC_URL="https://mainnet.base.org"
        CHAIN_ID=8453
        NETWORK_NAME="Base Mainnet"
        ;;
    *)
        echo -e "${RED}无效选择，使用本地测试网${NC}"
        RPC_URL="http://127.0.0.1:8545"
        CHAIN_ID=31337
        NETWORK_NAME="Anvil Local"
        ;;
esac

echo "✓ 网络: $NETWORK_NAME"
echo "✓ RPC URL: $RPC_URL"
echo "✓ Chain ID: $CHAIN_ID"

echo ""

# ============================================================
# 4. 生成统一配置文件
# ============================================================

echo -e "${BLUE}Step 4: 生成统一配置文件${NC}"
echo "-------------------------------------------------------------------"

# 4.1 前端配置
cat > "$PROJECT_ROOT/frontend/.env.local" << EOF
# 自动生成 - 请勿手动编辑
# 生成时间: $(date)

# API 配置
NEXT_PUBLIC_API_URL=http://localhost:8081
NEXT_PUBLIC_WEBSOCKET_URL=ws://localhost:8081/ws

# 区块链配置
NEXT_PUBLIC_BASE_RPC_URL=$RPC_URL
NEXT_PUBLIC_CHAIN_ID=$CHAIN_ID
NEXT_PUBLIC_TARGET_CHAIN_ID=$CHAIN_ID

# 合约地址
NEXT_PUBLIC_SETTLEMENT_ADDRESS=$SETTLEMENT_ADDRESS

# WalletConnect（可选）
NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID=test_project_id

# 其他
NEXT_PUBLIC_BLOCK_EXPLORER_URL=https://basescan.org
EOF

echo "✓ 创建: frontend/.env.local"

# 4.2 后端配置
cat > "$PROJECT_ROOT/backend/configs/config.local.yaml" << EOF
# 自动生成 - 请勿手动编辑
# 生成时间: $(date)

server:
  addr: ":8080"
  mode: "debug"

database:
  host: "localhost"
  port: 5432
  user: "postgres"
  password: "$DB_PASSWORD"
  dbname: "memeperp"
  sslmode: "disable"

redis:
  addr: "localhost:6379"
  password: "$REDIS_PASSWORD"
  db: 0

blockchain:
  rpc_url: "$RPC_URL"
  chain_id: $CHAIN_ID
  position_address: "$SETTLEMENT_ADDRESS"
  private_key: ""  # 请设置环境变量 MEMEPERP_BLOCKCHAIN_PRIVATE_KEY

jwt:
  secret: "$JWT_SECRET"
  expiration: 24h

rate_limit:
  public_limit: 1200
  private_limit: 600
  order_limit: 300
EOF

echo "✓ 创建: backend/configs/config.local.yaml"

# 4.3 Matching Engine 配置
cat > "$PROJECT_ROOT/backend/src/matching/config.local.json" << EOF
{
  "port": 8081,
  "settlementAddress": "$SETTLEMENT_ADDRESS",
  "rpcUrl": "$RPC_URL",
  "chainId": $CHAIN_ID,
  "matcherPrivateKey": "",
  "batchIntervalMs": 30000
}
EOF

echo "✓ 创建: backend/src/matching/config.local.json"

# 4.4 Docker Compose 环境变量
cat > "$PROJECT_ROOT/.env.docker" << EOF
# 自动生成 - Docker Compose 环境变量
# 生成时间: $(date)

# 数据库
POSTGRES_PASSWORD=$DB_PASSWORD
DATABASE_PASSWORD=$DB_PASSWORD

# Redis
REDIS_PASSWORD=$REDIS_PASSWORD

# JWT
JWT_SECRET=$JWT_SECRET

# 区块链
RPC_URL=$RPC_URL
CHAIN_ID=$CHAIN_ID
SETTLEMENT_ADDRESS=$SETTLEMENT_ADDRESS

# Keeper 私钥（请手动设置）
KEEPER_PRIVATE_KEY=
EOF

echo "✓ 创建: .env.docker"

echo ""

# ============================================================
# 5. 创建配置验证脚本
# ============================================================

echo -e "${BLUE}Step 5: 创建配置验证脚本${NC}"
echo "-------------------------------------------------------------------"

cat > "$PROJECT_ROOT/scripts/validate-config.sh" << 'VALIDATION_SCRIPT'
#!/bin/bash

# 配置验证脚本

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

ERRORS=0
WARNINGS=0

echo "验证配置文件..."
echo ""

# 检查前端配置
if [ -f "frontend/.env.local" ]; then
    echo -e "${GREEN}✓${NC} frontend/.env.local 存在"

    # 检查关键变量
    if grep -q "NEXT_PUBLIC_SETTLEMENT_ADDRESS=" frontend/.env.local; then
        ADDR=$(grep NEXT_PUBLIC_SETTLEMENT_ADDRESS frontend/.env.local | cut -d'=' -f2)
        if [ -z "$ADDR" ] || [ "$ADDR" = "your_settlement_address_here" ]; then
            echo -e "${RED}✗${NC} Settlement 地址未配置"
            ((ERRORS++))
        else
            echo -e "${GREEN}✓${NC} Settlement 地址已配置: $ADDR"
        fi
    fi
else
    echo -e "${RED}✗${NC} frontend/.env.local 不存在"
    ((ERRORS++))
fi

echo ""

# 检查后端配置
if [ -f "backend/configs/config.local.yaml" ]; then
    echo -e "${GREEN}✓${NC} backend/configs/config.local.yaml 存在"
else
    echo -e "${YELLOW}⚠${NC} backend/configs/config.local.yaml 不存在"
    ((WARNINGS++))
fi

echo ""

if [ $ERRORS -eq 0 ]; then
    echo -e "${GREEN}✅ 配置验证通过${NC}"
    exit 0
else
    echo -e "${RED}❌ 发现 $ERRORS 个错误${NC}"
    exit 1
fi
VALIDATION_SCRIPT

chmod +x "$PROJECT_ROOT/scripts/validate-config.sh"
echo "✓ 创建: scripts/validate-config.sh"

echo ""

# ============================================================
# 6. 创建安全启动脚本
# ============================================================

echo -e "${BLUE}Step 6: 创建安全启动脚本${NC}"
echo "-------------------------------------------------------------------"

cat > "$PROJECT_ROOT/scripts/start-secure.sh" << 'START_SCRIPT'
#!/bin/bash

# 安全启动脚本 - 带配置验证

set -e

# 验证配置
./scripts/validate-config.sh

# 检查私钥
if [ -z "$MATCHER_PRIVATE_KEY" ]; then
    echo "错误: MATCHER_PRIVATE_KEY 环境变量未设置"
    echo "请运行: export MATCHER_PRIVATE_KEY=0x..."
    exit 1
fi

# 启动服务
echo "配置验证通过，启动服务..."
./scripts/start-core-services.sh
START_SCRIPT

chmod +x "$PROJECT_ROOT/scripts/start-secure.sh"
echo "✓ 创建: scripts/start-secure.sh"

echo ""

# ============================================================
# 7. 总结
# ============================================================

echo "================================================================="
echo -e "${GREEN}  修复完成！${NC}"
echo "================================================================="
echo ""
echo "已生成以下文件:"
echo "  ✓ frontend/.env.local"
echo "  ✓ backend/configs/config.local.yaml"
echo "  ✓ backend/src/matching/config.local.json"
echo "  ✓ .env.docker"
echo "  ✓ scripts/validate-config.sh"
echo "  ✓ scripts/start-secure.sh"
echo ""
echo "生成的安全密钥:"
echo "  JWT Secret: $JWT_SECRET"
echo "  DB Password: $DB_PASSWORD"
echo "  Redis Password: $REDIS_PASSWORD"
echo ""
echo -e "${YELLOW}⚠ 重要提醒:${NC}"
echo "  1. 请将这些密钥保存到安全的地方"
echo "  2. 不要提交到 Git"
echo "  3. 设置 Matcher 私钥:"
echo "     export MATCHER_PRIVATE_KEY=0x..."
echo "  4. 启动服务:"
echo "     ./scripts/start-secure.sh"
echo ""
echo "================================================================="
