// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Script.sol";

interface IFundingRate {
    function baseFundingRateBps() external view returns (uint256);
    function maxFundingRateBps() external view returns (uint256);
    function skewFactor() external view returns (uint256);
    function fundingInterval() external view returns (uint256);
    function toInsuranceRatio() external view returns (uint256);
    function owner() external view returns (address);
    function setBaseFundingRate(uint256 _rateBps) external;
    function setMaxFundingRate(uint256 _maxRateBps) external;
    function setSkewFactor(uint256 _factor) external;
    function setFundingInterval(uint256 _interval) external;
}

/**
 * @title VerifyFundingRateParams
 * @notice 验证并对齐 FundingRate.sol 链上参数与引擎/Keeper 配置
 *
 * 目标参数 (三层统一):
 *   baseFundingRateBps = 1     (0.01%)
 *   maxFundingRateBps  = 50    (0.5%)
 *   skewFactor         = 5000  (50%)
 *   fundingInterval    = 900   (15 minutes)
 *   toInsuranceRatio   = 10000 (100%)
 *
 * 执行:
 *   forge script script/VerifyFundingRateParams.s.sol \
 *     --rpc-url $BSC_TESTNET_RPC --broadcast --private-key $DEPLOYER_KEY
 */
contract VerifyFundingRateParams is Script {
    // BSC Testnet FundingRate contract
    address constant FUNDING_RATE = 0xa33f2c84589079e7AC6037D81B472AF9cf421cC8;

    // Expected values (aligned with engine DEFAULT_MEME_FUNDING_CONFIG)
    uint256 constant EXPECTED_BASE_RATE = 1;      // 0.01%
    uint256 constant EXPECTED_MAX_RATE = 50;       // 0.5%
    uint256 constant EXPECTED_SKEW_FACTOR = 5000;  // 50%
    uint256 constant EXPECTED_INTERVAL = 15 minutes;
    uint256 constant EXPECTED_INSURANCE_RATIO = 10000; // 100%

    function run() external {
        IFundingRate fr = IFundingRate(FUNDING_RATE);

        // Read current values
        uint256 currentBase = fr.baseFundingRateBps();
        uint256 currentMax = fr.maxFundingRateBps();
        uint256 currentSkew = fr.skewFactor();
        uint256 currentInterval = fr.fundingInterval();
        uint256 currentInsurance = fr.toInsuranceRatio();

        console.log("=== FundingRate Current Parameters ===");
        console.log("baseFundingRateBps:", currentBase);
        console.log("maxFundingRateBps:", currentMax);
        console.log("skewFactor:", currentSkew);
        console.log("fundingInterval:", currentInterval);
        console.log("toInsuranceRatio:", currentInsurance);

        bool needsUpdate = false;

        if (currentBase != EXPECTED_BASE_RATE) {
            console.log("!! baseFundingRateBps mismatch, updating to", EXPECTED_BASE_RATE);
            needsUpdate = true;
        }
        if (currentMax != EXPECTED_MAX_RATE) {
            console.log("!! maxFundingRateBps mismatch, updating to", EXPECTED_MAX_RATE);
            needsUpdate = true;
        }
        if (currentSkew != EXPECTED_SKEW_FACTOR) {
            console.log("!! skewFactor mismatch, updating to", EXPECTED_SKEW_FACTOR);
            needsUpdate = true;
        }
        if (currentInterval != EXPECTED_INTERVAL) {
            console.log("!! fundingInterval mismatch, updating to", EXPECTED_INTERVAL);
            needsUpdate = true;
        }

        if (!needsUpdate) {
            console.log("All parameters already aligned. No changes needed.");
            return;
        }

        vm.startBroadcast();

        if (currentBase != EXPECTED_BASE_RATE) {
            fr.setBaseFundingRate(EXPECTED_BASE_RATE);
        }
        if (currentMax != EXPECTED_MAX_RATE) {
            fr.setMaxFundingRate(EXPECTED_MAX_RATE);
        }
        if (currentSkew != EXPECTED_SKEW_FACTOR) {
            fr.setSkewFactor(EXPECTED_SKEW_FACTOR);
        }
        if (currentInterval != EXPECTED_INTERVAL) {
            fr.setFundingInterval(EXPECTED_INTERVAL);
        }

        vm.stopBroadcast();

        // Verify
        require(fr.baseFundingRateBps() == EXPECTED_BASE_RATE, "base rate not set");
        require(fr.maxFundingRateBps() == EXPECTED_MAX_RATE, "max rate not set");
        require(fr.skewFactor() == EXPECTED_SKEW_FACTOR, "skew factor not set");
        require(fr.fundingInterval() == EXPECTED_INTERVAL, "interval not set");

        console.log("=== Parameters Updated Successfully ===");
    }
}
