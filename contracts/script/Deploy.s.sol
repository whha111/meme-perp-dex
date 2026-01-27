// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Script.sol";

import "../src/core/MemeToken.sol";
import "../src/core/LPToken.sol";
import "../src/core/Vault.sol";
import "../src/core/PriceFeed.sol";
import "../src/core/AMM.sol";
import "../src/core/LendingPool.sol";
import "../src/core/RiskManager.sol";
import "../src/core/PositionManager.sol";
import "../src/core/FundingRate.sol";
import "../src/core/Liquidation.sol";
import "../src/core/Router.sol";
import "../src/core/ContractSpec.sol";
import "../src/core/TokenFactory.sol";

/**
 * @title Deploy
 * @notice 部署脚本
 * @dev 按顺序部署所有合约并配置权限
 */
contract Deploy is Script {
    // 部署的合约地址
    MemeToken public memeToken;
    LPToken public lpToken;
    LPToken public ammLpToken;
    Vault public vault;
    PriceFeed public priceFeed;
    AMM public amm;
    LendingPool public lendingPool;
    RiskManager public riskManager;
    PositionManager public positionManager;
    FundingRate public fundingRate;
    Liquidation public liquidation;
    Router public router;
    ContractSpec public contractSpec;
    TokenFactory public tokenFactory;

    function run() external {
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(deployerPrivateKey);

        console.log("Deployer:", deployer);
        console.log("Deployer balance:", deployer.balance);

        vm.startBroadcast(deployerPrivateKey);

        // 1. 部署代币合约
        console.log("\n--- Deploying Tokens ---");
        memeToken = new MemeToken();
        console.log("MemeToken deployed at:", address(memeToken));

        lpToken = new LPToken("MEME LP Token", "MEME-LP");
        console.log("LPToken (Lending) deployed at:", address(lpToken));

        ammLpToken = new LPToken("MEME AMM LP", "MEME-ALP");
        console.log("LPToken (AMM) deployed at:", address(ammLpToken));

        // 2. 部署核心合约
        console.log("\n--- Deploying Core Contracts ---");
        vault = new Vault();
        console.log("Vault deployed at:", address(vault));

        priceFeed = new PriceFeed();
        console.log("PriceFeed deployed at:", address(priceFeed));

        amm = new AMM(address(memeToken), address(ammLpToken));
        console.log("AMM deployed at:", address(amm));

        lendingPool = new LendingPool(address(memeToken), address(lpToken));
        console.log("LendingPool deployed at:", address(lendingPool));

        riskManager = new RiskManager();
        console.log("RiskManager deployed at:", address(riskManager));

        contractSpec = new ContractSpec();
        console.log("ContractSpec deployed at:", address(contractSpec));

        // 3. 部署交易合约
        console.log("\n--- Deploying Trading Contracts ---");
        positionManager = new PositionManager(
            address(vault),
            address(priceFeed),
            address(riskManager)
        );
        console.log("PositionManager deployed at:", address(positionManager));

        fundingRate = new FundingRate(
            address(positionManager),
            address(vault),
            address(priceFeed)
        );
        console.log("FundingRate deployed at:", address(fundingRate));

        liquidation = new Liquidation(
            address(positionManager),
            address(vault),
            address(riskManager),
            address(priceFeed)
        );
        console.log("Liquidation deployed at:", address(liquidation));

        // 4. 部署路由和代币工厂
        console.log("\n--- Deploying Router & TokenFactory ---");
        router = new Router(address(memeToken));
        console.log("Router deployed at:", address(router));

        // Base Sepolia Uniswap V2 Router
        address uniswapRouter = 0x8cFe327CEc66d1C090Dd72bd0FF11d690C33a2Eb;
        tokenFactory = new TokenFactory(deployer, deployer, uniswapRouter);
        console.log("TokenFactory deployed at:", address(tokenFactory));

        // 5. 配置合约权限和关联
        console.log("\n--- Configuring Contracts ---");

        // LP Token 铸造权限
        lpToken.setMinter(address(lendingPool), true);
        ammLpToken.setMinter(address(amm), true);
        console.log("LP Token minters set");

        // Vault 授权
        vault.setAuthorizedContract(address(positionManager), true);
        vault.setAuthorizedContract(address(liquidation), true);
        vault.setAuthorizedContract(address(fundingRate), true);
        vault.setLendingPool(address(lendingPool));
        console.log("Vault authorized contracts set");

        // PriceFeed 配置
        priceFeed.setAMM(address(amm));
        console.log("PriceFeed AMM set");

        // AMM 配置
        amm.setPriceFeed(address(priceFeed));
        console.log("AMM PriceFeed set");

        // LendingPool 授权
        lendingPool.setAuthorizedContract(address(positionManager), true);
        console.log("LendingPool authorized contracts set");

        // RiskManager 配置
        riskManager.setPositionManager(address(positionManager));
        riskManager.setVault(address(vault));
        console.log("RiskManager configured");

        // PositionManager 配置
        positionManager.setFundingRate(address(fundingRate));
        positionManager.setAuthorizedContract(address(liquidation), true);
        console.log("PositionManager configured");

        // Router 配置
        router.setVault(address(vault));
        router.setAMM(address(amm));
        router.setLendingPool(address(lendingPool));
        router.setPositionManager(address(positionManager));
        console.log("Router configured");

        // 6. 转移代币到 AMM (初始流动性)
        uint256 ammAmount = 400_000_000 * 1e18;
        memeToken.transfer(address(amm), ammAmount);
        console.log("Transferred MEME to AMM:", ammAmount / 1e18);

        vm.stopBroadcast();

        // 7. 输出部署结果
        console.log("\n========================================");
        console.log("Deployment completed!");
        console.log("========================================");
        console.log("\nContract Addresses:");
        console.log("MemeToken:        ", address(memeToken));
        console.log("LPToken (Lending):", address(lpToken));
        console.log("LPToken (AMM):    ", address(ammLpToken));
        console.log("Vault:            ", address(vault));
        console.log("PriceFeed:        ", address(priceFeed));
        console.log("AMM:              ", address(amm));
        console.log("LendingPool:      ", address(lendingPool));
        console.log("RiskManager:      ", address(riskManager));
        console.log("PositionManager:  ", address(positionManager));
        console.log("FundingRate:      ", address(fundingRate));
        console.log("Liquidation:      ", address(liquidation));
        console.log("Router:           ", address(router));
        console.log("ContractSpec:     ", address(contractSpec));
        console.log("TokenFactory:     ", address(tokenFactory));
        console.log("\n========================================");
    }
}
