#!/bin/bash

# 完整测试套件运行脚本
# Complete Test Suite Runner

set -e  # Exit on error

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo ""
echo "======================================================================"
echo -e "${BLUE}  MemePerp DEX - Complete Test Suite${NC}"
echo "======================================================================"
echo ""

# Track test results
TESTS_PASSED=0
TESTS_FAILED=0

# Function to run a test suite
run_test() {
    local test_name="$1"
    local test_command="$2"

    echo ""
    echo "----------------------------------------------------------------------"
    echo -e "${YELLOW}Running: $test_name${NC}"
    echo "----------------------------------------------------------------------"

    if eval "$test_command"; then
        echo -e "${GREEN}✓ $test_name PASSED${NC}"
        ((TESTS_PASSED++))
        return 0
    else
        echo -e "${RED}✗ $test_name FAILED${NC}"
        ((TESTS_FAILED++))
        return 1
    fi
}

# ============================================================
# Part 1: Smart Contract Tests (Foundry)
# ============================================================

echo ""
echo -e "${BLUE}Part 1: Smart Contract Tests (Foundry)${NC}"
echo ""

cd contracts

run_test "Settlement Core Tests" \
    "forge test --match-contract SettlementTest -vv"

run_test "Security Fixes Tests" \
    "forge test --match-contract SecurityFixesTest -vv"

run_test "Risk Control Fuzz Tests" \
    "forge test --match-contract RiskControlFuzzTest -vv"

# ============================================================
# Part 2: Backend Tests (Matching Engine)
# ============================================================

echo ""
echo -e "${BLUE}Part 2: Backend Tests (Matching Engine)${NC}"
echo ""

cd ../backend

run_test "Matching Engine Unit Tests" \
    "npx tsx src/matching/test-runner.ts"

run_test "Stress Test (1100 orders)" \
    "npx tsx src/matching/stress-test.ts"

# ============================================================
# Part 3: End-to-End Integration Tests
# ============================================================

echo ""
echo -e "${BLUE}Part 3: End-to-End Integration Tests${NC}"
echo ""

# Start Anvil in background
echo "Starting Anvil local node..."
pkill -f anvil || true
sleep 1
anvil --port 8545 > /tmp/anvil-test.log 2>&1 &
ANVIL_PID=$!
echo "Anvil started (PID: $ANVIL_PID)"
sleep 3

run_test "Original E2E Test" \
    "npx tsx src/matching/e2e-test.ts"

run_test "Security Fixes E2E Test" \
    "npx tsx src/matching/security-e2e-test.ts"

# Stop Anvil
echo "Stopping Anvil..."
kill $ANVIL_PID || true
sleep 1

# ============================================================
# Summary
# ============================================================

echo ""
echo "======================================================================"
echo -e "${BLUE}  Test Suite Complete${NC}"
echo "======================================================================"
echo ""
echo -e "  Total Passed: ${GREEN}$TESTS_PASSED${NC}"
echo -e "  Total Failed: ${RED}$TESTS_FAILED${NC}"
echo ""

if [ $TESTS_FAILED -eq 0 ]; then
    echo -e "${GREEN}✅ All tests passed!${NC}"
    echo ""
    exit 0
else
    echo -e "${RED}❌ Some tests failed!${NC}"
    echo ""
    exit 1
fi
