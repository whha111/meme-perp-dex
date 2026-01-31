---
name: meme-perp-test
description: Run comprehensive test suite for meme-perp-dex project. Use when user wants to test, verify, or validate functionality. Runs backend tests, contract tests, and validation scripts.
tools: Bash, Read
---

# Meme Perp DEX - Test Suite Runner

Comprehensive testing framework for validating meme-perp-dex functionality.

## When to Use

Use this skill when:
- User asks to "test", "run tests", "verify"
- After implementing new features
- Before committing code
- After fixing bugs
- Preparing for deployment

## Test Categories

### 1. Backend API Tests
Located in: `backend/src/matching/`

**Authentication Tests**:
```bash
cd backend/src/matching
bun test-auth.ts
```
Tests:
- Nonce generation
- Wallet signature verification
- API key generation
- HMAC signature validation

**Token Metadata Tests**:
```bash
bun test-token-metadata.ts
```
Tests:
- CRUD operations
- Search functionality
- Input validation
- XSS protection

**FOMO/Leaderboard Tests**:
```bash
bun test-fomo.ts
```
Tests:
- Event generation
- Leaderboard ranking
- Trader statistics
- Search/filter

**Replay Service Tests**:
```bash
bun test-relay.ts
```
Tests:
- Relayer status
- Nonce queries
- Balance queries
- (Signature tests require config)

**Wallet Verification**:
```bash
bun verify-derived-wallets.ts
```
Validates:
- All 100 trading wallets
- Settlement balances
- Total fund pool

### 2. Contract Tests
Located in: `contracts/`

**Run All Contract Tests**:
```bash
cd contracts
forge test -vv
```

**Specific Test Suites**:
```bash
# Perpetual trading
forge test --match-contract PerpetualTradingTest -vv

# Multi-token support
forge test --match-contract MultiTokenTest -vv

# Risk control
forge test --match-contract RiskControlTest -vv

# Token factory
forge test --match-contract TokenFactoryTest -vv
```

### 3. Integration Tests
```bash
# Check server health
curl http://localhost:8081/health

# Verify Redis
curl http://localhost:8081/api/redis/status

# Test market data
curl http://localhost:8081/api/v1/market/tickers
```

## Complete Test Workflow

### Quick Test (5 minutes)
Run critical tests only:
```bash
cd backend/src/matching

echo "=== Testing Auth ==="
bun test-auth.ts

echo "=== Testing Metadata ==="
bun test-token-metadata.ts

echo "=== Testing FOMO ==="
bun test-fomo.ts

echo "=== Testing Relay ==="
bun test-relay.ts
```

### Full Test (15 minutes)
Run all tests including contracts:
```bash
# Backend tests
cd backend/src/matching
bun test-auth.ts
bun test-token-metadata.ts
bun test-fomo.ts
bun test-relay.ts
bun verify-derived-wallets.ts

# Contract tests
cd ../../contracts
forge test -vv
```

### Pre-Deploy Test (30 minutes)
Complete validation before deployment:
```bash
# 1. Backend module tests
cd backend/src/matching
for test in test-*.ts; do
  echo "Running $test..."
  bun "$test"
done

# 2. Wallet verification
bun verify-derived-wallets.ts

# 3. Contract tests
cd ../../contracts
forge test -vv

# 4. Server integration (requires running server)
curl http://localhost:8081/health
curl http://localhost:8081/api/redis/status
curl http://localhost:8081/api/v1/relay/status

# 5. Check git status
git status

# 6. Verify environment
echo "Checking environment variables..."
[ -n "$SETTLEMENT_ADDRESS" ] && echo "✅ SETTLEMENT_ADDRESS set" || echo "❌ SETTLEMENT_ADDRESS missing"
[ -n "$TOKEN_FACTORY_ADDRESS" ] && echo "✅ TOKEN_FACTORY_ADDRESS set" || echo "❌ TOKEN_FACTORY_ADDRESS missing"
```

## Test Result Interpretation

### Success Indicators
- ✅ All module tests pass
- ✅ Contract tests pass (0 failures)
- ✅ Wallet verification 100% success
- ✅ Server health check returns OK
- ✅ Redis connected

### Common Failures

**"Redis not connected"**:
```bash
# Start Redis
redis-server
# Or check if running
redis-cli ping
```

**"RELAYER_PRIVATE_KEY not set"**:
```bash
# Expected in dev - relay tests skip gracefully
# For full testing, set environment variable
export RELAYER_PRIVATE_KEY="0x..."
```

**"Contract test failed"**:
```bash
# Run with more verbosity
forge test --match-test <testName> -vvvv
# Check foundry.toml configuration
```

**"Wallet verification failed"**:
```bash
# Check Settlement address
echo $SETTLEMENT_ADDRESS
# Verify RPC connection
curl https://sepolia.base.org
```

## Output Format

After running tests, provide summary:
```
=============================================================
Test Results Summary
=============================================================

Backend Tests:
  ✅ Authentication (test-auth.ts) - PASS
  ✅ Token Metadata (test-token-metadata.ts) - PASS
  ✅ FOMO/Leaderboard (test-fomo.ts) - PASS
  ⚠️  Relay Service (test-relay.ts) - SKIP (no config)
  ✅ Wallet Verification - PASS (100/100)

Contract Tests:
  ✅ forge test - PASS (XX tests)

Integration:
  ✅ Server health - OK
  ✅ Redis status - Connected

Overall: ✅ READY FOR DEPLOYMENT
=============================================================
```

## Continuous Testing

### Pre-Commit Hook
Create `.git/hooks/pre-commit`:
```bash
#!/bin/bash
cd backend/src/matching
bun test-auth.ts || exit 1
bun test-token-metadata.ts || exit 1
bun test-fomo.ts || exit 1
echo "✅ All tests passed"
```

### CI/CD Integration
```yaml
test:
  script:
    - cd backend/src/matching
    - bun test-auth.ts
    - bun test-token-metadata.ts
    - bun test-fomo.ts
    - bun test-relay.ts
    - cd ../../contracts
    - forge test
```

## Troubleshooting

### Tests Won't Run
1. Check Node/Bun installation: `bun --version`
2. Check working directory
3. Verify test files exist
4. Check permissions

### Tests Timeout
1. Increase timeout in test files
2. Check network connectivity
3. Verify RPC endpoints responsive

### Flaky Tests
1. Add retry logic
2. Increase delays
3. Mock external dependencies
4. Check for race conditions

## Best Practices

1. **Run tests before committing**
2. **Test after every feature**
3. **Keep tests updated with code**
4. **Document test failures**
5. **Don't skip failing tests**
6. **Use descriptive test names**
7. **Clean up test data**

## Notes

- Backend tests use Bun runtime
- Contract tests use Foundry
- Some tests require running server
- Relay tests skip if no config (expected)
- Wallet verification requires Settlement contract access
