// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Script.sol";

// Core
import "../src/spot/MemeToken.sol";
import "../src/spot/LPToken.sol";
import "../src/common/Vault.sol";
import "../src/common/PriceFeed.sol";
import "../src/spot/AMM.sol";
import "../src/spot/LendingPool.sol";
import "../src/perpetual/RiskManager.sol";
import "../src/perpetual/PositionManager.sol";
import "../src/perpetual/FundingRate.sol";
import "../src/perpetual/Liquidation.sol";
import "../src/spot/Router.sol";
import "../src/perpetual/ContractSpec.sol";
import "../src/spot/TokenFactory.sol";

// Settlement
import "../src/perpetual/Settlement.sol";
import "../src/common/ContractRegistry.sol";
import "../src/perpetual/InsuranceFund.sol";
import "../src/perpetual/SettlementV2.sol";

// PerpVault
import "../src/perpetual/PerpVault.sol";

// Mock stablecoins for testnet
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract MockUSDT is ERC20 {
    constructor() ERC20("Mock USDT", "USDT") { _mint(msg.sender, 100_000_000 * 1e6); }
    function decimals() public pure override returns (uint8) { return 6; }
    function mint(address to, uint256 amount) external { _mint(to, amount); }
}

contract MockUSDC is ERC20 {
    constructor() ERC20("Mock USDC", "USDC") { _mint(msg.sender, 100_000_000 * 1e6); }
    function decimals() public pure override returns (uint8) { return 6; }
    function mint(address to, uint256 amount) external { _mint(to, amount); }
}

contract MockUSD1 is ERC20 {
    constructor() ERC20("Mock USD1", "USD1") { _mint(msg.sender, 100_000_000 * 1e18); }
    function decimals() public pure override returns (uint8) { return 18; }
    function mint(address to, uint256 amount) external { _mint(to, amount); }
}

/**
 * @title DeployAllV2
 * @notice Comprehensive deployment: all core + Settlement V1/V2 + PerpVault
 * @dev Deploy command:
 *   forge script script/DeployAllV2.s.sol --rpc-url $BASE_SEPOLIA_RPC_URL --broadcast -vvv
 */
contract DeployAllV2 is Script {

    function run() external {
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(deployerPrivateKey);
        // Base Sepolia WETH
        address weth = 0x4200000000000000000000000000000000000006;
        // Base Sepolia Uniswap V2 Router
        address uniswapRouter = 0x8cFe327CEc66d1C090Dd72bd0FF11d690C33a2Eb;

        console.log("========================================");
        console.log("DeployAllV2 - Full Redeployment");
        console.log("========================================");
        console.log("Deployer:", deployer);
        console.log("Balance:", deployer.balance / 1e18, "ETH");

        vm.startBroadcast(deployerPrivateKey);

        // ============================================================
        // 1. Deploy Tokens
        // ============================================================
        console.log("\n--- 1. Tokens ---");
        MemeToken memeToken = new MemeToken();
        console.log("MemeToken:", address(memeToken));

        LPToken lpToken = new LPToken("MEME LP Token", "MEME-LP");
        console.log("LPToken (Lending):", address(lpToken));

        LPToken ammLpToken = new LPToken("MEME AMM LP", "MEME-ALP");
        console.log("LPToken (AMM):", address(ammLpToken));

        // Mock stablecoins
        MockUSDT usdt = new MockUSDT();
        console.log("MockUSDT:", address(usdt));

        MockUSDC usdc = new MockUSDC();
        console.log("MockUSDC:", address(usdc));

        MockUSD1 usd1 = new MockUSD1();
        console.log("MockUSD1:", address(usd1));

        // ============================================================
        // 2. Deploy Core Contracts
        // ============================================================
        console.log("\n--- 2. Core Contracts ---");
        Vault vault = new Vault();
        console.log("Vault:", address(vault));

        PriceFeed priceFeed = new PriceFeed();
        console.log("PriceFeed:", address(priceFeed));

        AMM amm = new AMM(address(memeToken), address(ammLpToken));
        console.log("AMM:", address(amm));

        LendingPool lendingPool = new LendingPool(deployer, deployer);
        console.log("LendingPool:", address(lendingPool));

        RiskManager riskManager = new RiskManager();
        console.log("RiskManager:", address(riskManager));

        ContractSpec contractSpec = new ContractSpec();
        console.log("ContractSpec:", address(contractSpec));

        // ============================================================
        // 3. Deploy Trading Contracts
        // ============================================================
        console.log("\n--- 3. Trading Contracts ---");
        PositionManager positionManager = new PositionManager(
            address(vault), address(priceFeed), address(riskManager)
        );
        console.log("PositionManager:", address(positionManager));

        FundingRate fundingRate = new FundingRate(
            address(positionManager), address(vault), address(priceFeed)
        );
        console.log("FundingRate:", address(fundingRate));

        Liquidation liquidation = new Liquidation(
            address(positionManager), address(vault), address(riskManager), address(priceFeed)
        );
        console.log("Liquidation:", address(liquidation));

        // ============================================================
        // 4. Deploy Router & TokenFactory
        // ============================================================
        console.log("\n--- 4. Router & TokenFactory ---");
        Router router = new Router(address(memeToken));
        console.log("Router:", address(router));

        TokenFactory tokenFactory = new TokenFactory(deployer, deployer, uniswapRouter);
        console.log("TokenFactory:", address(tokenFactory));

        // ============================================================
        // 5. Deploy Settlement V1 + InsuranceFund + ContractRegistry
        // ============================================================
        console.log("\n--- 5. Settlement V1 + InsuranceFund ---");
        ContractRegistry registry = new ContractRegistry();
        console.log("ContractRegistry:", address(registry));

        InsuranceFund insuranceFund = new InsuranceFund();
        console.log("InsuranceFund:", address(insuranceFund));

        Settlement settlement = new Settlement();
        console.log("Settlement (V1):", address(settlement));

        // ============================================================
        // 6. Deploy SettlementV2 (dYdX-style, ERC-20 collateral)
        // ============================================================
        console.log("\n--- 6. SettlementV2 ---");
        // Use WETH as collateral token, deployer as platform signer
        SettlementV2 settlementV2 = new SettlementV2(weth, deployer, deployer);
        console.log("SettlementV2:", address(settlementV2));

        // ============================================================
        // 7. Deploy PerpVault (GMX-style LP pool)
        // ============================================================
        console.log("\n--- 7. PerpVault ---");
        PerpVault perpVault = new PerpVault();
        console.log("PerpVault:", address(perpVault));

        // ============================================================
        // 8. Configure All Permissions
        // ============================================================
        console.log("\n--- 8. Configuring Permissions ---");

        // LP Token minters
        ammLpToken.setMinter(address(amm), true);

        // LendingPool <-> TokenFactory
        lendingPool.setTokenFactory(address(tokenFactory));
        tokenFactory.setLendingPool(address(lendingPool));

        // Vault authorizations
        vault.setAuthorizedContract(address(positionManager), true);
        vault.setAuthorizedContract(address(liquidation), true);
        vault.setAuthorizedContract(address(fundingRate), true);
        vault.setLendingPool(address(lendingPool));

        // PriceFeed <-> TokenFactory
        priceFeed.setTokenFactory(address(tokenFactory));
        tokenFactory.setPriceFeed(address(priceFeed));

        // AMM
        amm.setPriceFeed(address(priceFeed));

        // LendingPool
        lendingPool.setAuthorizedContract(address(positionManager), true);

        // RiskManager
        riskManager.setPositionManager(address(positionManager));
        riskManager.setVault(address(vault));

        // PositionManager
        positionManager.setFundingRate(address(fundingRate));
        positionManager.setAuthorizedContract(address(liquidation), true);
        positionManager.setTokenFactory(address(tokenFactory));

        // Router
        router.setVault(address(vault));
        router.setAMM(address(amm));
        router.setLendingPool(address(lendingPool));
        router.setPositionManager(address(positionManager));

        // Settlement V1 configuration
        settlement.setContractRegistry(address(registry));
        settlement.addSupportedToken(address(usdt), 6);
        settlement.addSupportedToken(address(usdc), 6);
        settlement.addSupportedToken(address(usd1), 18);
        settlement.addSupportedToken(weth, 18);
        settlement.setWETH(weth);
        settlement.setAuthorizedMatcher(deployer, true);
        settlement.setInsuranceFund(address(insuranceFund));
        settlement.setFeeReceiver(deployer);

        // InsuranceFund configuration
        insuranceFund.setSettlement(address(settlement));
        insuranceFund.setAuthorizedContract(deployer, true);

        // SettlementV2 configuration
        settlementV2.setAuthorizedUpdater(deployer, true);

        // PerpVault configuration
        perpVault.setAuthorizedContract(deployer, true); // matching engine

        // Transfer MEME to AMM for initial liquidity
        uint256 ammAmount = 400_000_000 * 1e18;
        memeToken.transfer(address(amm), ammAmount);

        console.log("All permissions configured!");

        vm.stopBroadcast();

        // ============================================================
        // 9. Output All Addresses
        // ============================================================
        console.log("\n========================================");
        console.log("DEPLOYMENT COMPLETE - All Addresses:");
        console.log("========================================");
        console.log("\n[Core]");
        console.log("MemeToken:       ", address(memeToken));
        console.log("LPToken:         ", address(lpToken));
        console.log("LPToken (AMM):   ", address(ammLpToken));
        console.log("Vault:           ", address(vault));
        console.log("PriceFeed:       ", address(priceFeed));
        console.log("AMM:             ", address(amm));
        console.log("LendingPool:     ", address(lendingPool));
        console.log("RiskManager:     ", address(riskManager));
        console.log("ContractSpec:    ", address(contractSpec));
        console.log("Router:          ", address(router));
        console.log("TokenFactory:    ", address(tokenFactory));

        console.log("\n[Perpetual]");
        console.log("PositionManager: ", address(positionManager));
        console.log("FundingRate:     ", address(fundingRate));
        console.log("Liquidation:     ", address(liquidation));
        console.log("PerpVault:       ", address(perpVault));

        console.log("\n[Settlement]");
        console.log("Settlement (V1): ", address(settlement));
        console.log("SettlementV2:    ", address(settlementV2));
        console.log("InsuranceFund:   ", address(insuranceFund));
        console.log("ContractRegistry:", address(registry));

        console.log("\n[Stablecoins]");
        console.log("USDT:            ", address(usdt));
        console.log("USDC:            ", address(usdc));
        console.log("USD1:            ", address(usd1));
        console.log("WETH:            ", weth);
        console.log("========================================");
    }
}
