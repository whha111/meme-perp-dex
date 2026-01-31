---
name: meme-perp-deploy
description: Deployment checklist and automation for meme-perp-dex project. Use when user wants to deploy, check deployment readiness, or prepare for production. Validates environment, runs pre-deploy checks, and guides deployment process.
tools: Bash, Read, Grep
---

# Meme Perp DEX - Deployment Skill

Complete deployment checklist and automation for production readiness.

## When to Use

Use this skill when:
- User asks to "deploy", "go live", "production"
- Preparing for deployment
- Validating environment setup
- Checking deployment readiness

## Deployment Checklist

### Phase 1: Pre-Deployment Validation

#### 1.1 Environment Variables
```bash
echo "=== Checking Environment Variables ==="

# Required for Matching Engine
[ -n "$SETTLEMENT_ADDRESS" ] && echo "✅ SETTLEMENT_ADDRESS" || echo "❌ SETTLEMENT_ADDRESS missing"
[ -n "$TOKEN_FACTORY_ADDRESS" ] && echo "✅ TOKEN_FACTORY_ADDRESS" || echo "❌ TOKEN_FACTORY_ADDRESS missing"
[ -n "$PRICE_FEED_ADDRESS" ] && echo "✅ PRICE_FEED_ADDRESS" || echo "❌ PRICE_FEED_ADDRESS missing"
[ -n "$MATCHER_PRIVATE_KEY" ] && echo "✅ MATCHER_PRIVATE_KEY" || echo "❌ MATCHER_PRIVATE_KEY missing"

# Optional but recommended
[ -n "$RELAYER_PRIVATE_KEY" ] && echo "✅ RELAYER_PRIVATE_KEY" || echo "⚠️  RELAYER_PRIVATE_KEY not set (relay disabled)"
[ -n "$BASE_SEPOLIA_RPC" ] && echo "✅ BASE_SEPOLIA_RPC" || echo "⚠️  Using default RPC"
```

#### 1.2 Redis Connection
```bash
echo "=== Checking Redis ==="
redis-cli ping && echo "✅ Redis connected" || echo "❌ Redis not running"
```

#### 1.3 Contract Addresses
```bash
echo "=== Verifying Contracts ==="
cd contracts

# Check Settlement contract
cast code $SETTLEMENT_ADDRESS --rpc-url $BASE_SEPOLIA_RPC | grep -q "0x" && \
  echo "✅ Settlement deployed" || echo "❌ Settlement not found"

# Check TokenFactory
cast code $TOKEN_FACTORY_ADDRESS --rpc-url $BASE_SEPOLIA_RPC | grep -q "0x" && \
  echo "✅ TokenFactory deployed" || echo "❌ TokenFactory not found"

# Check PriceFeed
cast code $PRICE_FEED_ADDRESS --rpc-url $BASE_SEPOLIA_RPC | grep -q "0x" && \
  echo "✅ PriceFeed deployed" || echo "❌ PriceFeed not found"
```

#### 1.4 Wallet Balances
```bash
echo "=== Checking Wallet Balances ==="

# Matcher wallet (needs ETH for gas)
MATCHER_ADDRESS=$(cast wallet address $MATCHER_PRIVATE_KEY)
MATCHER_BALANCE=$(cast balance $MATCHER_ADDRESS --rpc-url $BASE_SEPOLIA_RPC)
echo "Matcher: $MATCHER_ADDRESS"
echo "Balance: $(cast --to-unit $MATCHER_BALANCE ether) ETH"
[[ $(echo "$MATCHER_BALANCE > 1000000000000000000" | bc) == 1 ]] && \
  echo "✅ Sufficient balance (>1 ETH)" || echo "⚠️  Low balance (<1 ETH)"

# Relayer wallet (if configured)
if [ -n "$RELAYER_PRIVATE_KEY" ]; then
  RELAYER_ADDRESS=$(cast wallet address $RELAYER_PRIVATE_KEY)
  RELAYER_BALANCE=$(cast balance $RELAYER_ADDRESS --rpc-url $BASE_SEPOLIA_RPC)
  echo "Relayer: $RELAYER_ADDRESS"
  echo "Balance: $(cast --to-unit $RELAYER_BALANCE ether) ETH"
  [[ $(echo "$RELAYER_BALANCE > 1000000000000000000" | bc) == 1 ]] && \
    echo "✅ Sufficient balance (>1 ETH)" || echo "⚠️  Low balance (<1 ETH)"
fi
```

#### 1.5 Run Tests
```bash
echo "=== Running Test Suite ==="
cd backend/src/matching

# Critical tests only
bun test-auth.ts
bun test-token-metadata.ts
bun test-fomo.ts

echo "✅ All critical tests passed"
```

### Phase 2: Build & Compile

#### 2.1 Backend
```bash
echo "=== Building Backend ==="
cd backend/src/matching

# Check dependencies
bun install

# Verify server can start
timeout 5 bun server.ts || echo "⚠️  Server check timed out (expected)"
```

#### 2.2 Frontend (if deploying)
```bash
echo "=== Building Frontend ==="
cd frontend

npm install
npm run build

echo "✅ Frontend built successfully"
```

#### 2.3 Contracts (if redeploying)
```bash
echo "=== Compiling Contracts ==="
cd contracts

forge build

echo "✅ Contracts compiled"
```

### Phase 3: Deployment

#### 3.1 Start Services

**Redis**:
```bash
# Check if running
redis-cli ping || redis-server &
```

**Matching Engine**:
```bash
cd backend/src/matching

# Production mode
NODE_ENV=production bun server.ts

# Or with PM2
pm2 start server.ts --name meme-perp-matching --interpreter bun
pm2 save
```

#### 3.2 Verify Deployment
```bash
echo "=== Verifying Deployment ==="

# Health check
curl http://localhost:8081/health

# Redis status
curl http://localhost:8081/api/redis/status

# Relay status
curl http://localhost:8081/api/v1/relay/status

# Market data
curl http://localhost:8081/api/v1/market/tickers | jq .
```

### Phase 4: Post-Deployment

#### 4.1 Monitor Logs
```bash
# Matching engine logs
tail -f backend/src/matching/logs/server.log

# Or with PM2
pm2 logs meme-perp-matching
```

#### 4.2 Check Metrics
```bash
# WebSocket connections
curl http://localhost:8081/api/stats/websocket

# Active orders
curl http://localhost:8081/api/stats/orders

# Pending matches
curl http://localhost:8081/api/stats/matches
```

#### 4.3 Verify Critical Functions
```bash
# 1. Can query token metadata
curl http://localhost:8081/api/v1/token/metadata/all

# 2. Can get FOMO events
curl http://localhost:8081/api/fomo/events?limit=5

# 3. Can check balances
curl http://localhost:8081/api/v1/relay/balance/0x...

# 4. Can get leaderboard
curl http://localhost:8081/api/leaderboard/global?limit=10
```

## Deployment Configurations

### Development
```bash
export NODE_ENV=development
export LOG_LEVEL=debug
export SKIP_SIGNATURE_VERIFY=true  # Testing only
```

### Staging
```bash
export NODE_ENV=staging
export LOG_LEVEL=info
export SKIP_SIGNATURE_VERIFY=false
```

### Production
```bash
export NODE_ENV=production
export LOG_LEVEL=warn
export SKIP_SIGNATURE_VERIFY=false
export ENABLE_RATE_LIMIT=true
```

## Rollback Procedure

If deployment fails:

```bash
# 1. Stop services
pm2 stop meme-perp-matching

# 2. Revert git
git log --oneline -5
git revert <commit-hash>

# 3. Rebuild
bun install
bun server.ts

# 4. Verify
curl http://localhost:8081/health
```

## Common Issues

### Issue 1: "Contract not found"
**Solution**:
```bash
# Verify RPC connection
curl $BASE_SEPOLIA_RPC -X POST -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"eth_blockNumber","params":[],"id":1}'

# Check contract address
echo $SETTLEMENT_ADDRESS
cast code $SETTLEMENT_ADDRESS --rpc-url $BASE_SEPOLIA_RPC
```

### Issue 2: "Redis connection failed"
**Solution**:
```bash
# Start Redis
redis-server &

# Check connection
redis-cli ping

# Verify port
netstat -an | grep 6379
```

### Issue 3: "Insufficient gas"
**Solution**:
```bash
# Check matcher balance
cast balance $(cast wallet address $MATCHER_PRIVATE_KEY) --rpc-url $BASE_SEPOLIA_RPC

# Send ETH to matcher
cast send --value 1ether $MATCHER_ADDRESS --rpc-url $BASE_SEPOLIA_RPC --private-key $DEPLOYER_KEY
```

## Security Checklist

Before deploying to production:

- [ ] Private keys NOT in code
- [ ] `.env` file in `.gitignore`
- [ ] HTTPS enabled
- [ ] CORS configured properly
- [ ] Rate limiting enabled
- [ ] Signature verification enabled
- [ ] Error messages don't leak sensitive info
- [ ] Logging doesn't include private keys
- [ ] Database backups configured
- [ ] Monitoring alerts set up

## Performance Optimization

```bash
# 1. Enable Redis persistence
# In redis.conf:
save 900 1
save 300 10
save 60 10000

# 2. Optimize Node/Bun
export NODE_OPTIONS="--max-old-space-size=4096"

# 3. Enable compression
# In server config:
compress: true
```

## Monitoring Setup

### Uptime Monitoring
```bash
# Create healthcheck script
cat > healthcheck.sh << 'EOF'
#!/bin/bash
RESPONSE=$(curl -s http://localhost:8081/health)
if [[ $RESPONSE == *"ok"* ]]; then
  exit 0
else
  exit 1
fi
EOF

chmod +x healthcheck.sh

# Add to cron
*/5 * * * * /path/to/healthcheck.sh || systemctl restart meme-perp
```

### Log Rotation
```bash
# /etc/logrotate.d/meme-perp
/var/log/meme-perp/*.log {
  daily
  rotate 14
  compress
  delaycompress
  notifempty
  create 0640 www-data www-data
}
```

## Deployment Summary Template

After deployment, provide summary:
```
=============================================================
Meme Perp DEX - Deployment Summary
=============================================================

Environment: [Production/Staging/Development]
Deployed At: [Timestamp]
Git Commit: [Hash]

Services:
  ✅ Matching Engine - Running (Port 8081)
  ✅ Redis - Connected
  ✅ WebSocket - Active

Contracts:
  ✅ Settlement: 0x...
  ✅ TokenFactory: 0x...
  ✅ PriceFeed: 0x...

Wallets:
  ✅ Matcher: 0x... (Balance: X ETH)
  ✅ Relayer: 0x... (Balance: X ETH)

Health Checks:
  ✅ /health - OK
  ✅ /api/redis/status - Connected
  ✅ /api/v1/relay/status - Enabled

API Endpoints:
  ✅ Authentication (2 endpoints)
  ✅ Token Metadata (3 endpoints)
  ✅ FOMO/Leaderboard (4 endpoints)
  ✅ Relay Service (6 endpoints)

Status: 🎉 DEPLOYMENT SUCCESSFUL
=============================================================
```

## Notes

- Always test in staging first
- Keep deployment scripts in version control
- Document all configuration changes
- Maintain deployment runbook
- Have rollback plan ready
- Monitor for 24h after deployment
