// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Script.sol";
import "../src/core/Settlement.sol";
import "../src/core/ContractRegistry.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/**
 * @title MockUSDT
 * @notice 测试用 USDT 代币（6位小数）
 */
contract MockUSDT is ERC20 {
    constructor() ERC20("Mock USDT", "USDT") {
        // 给部署者 mint 1亿 USDT
        _mint(msg.sender, 100_000_000 * 1e6);
    }

    function decimals() public pure override returns (uint8) {
        return 6;
    }

    /// @notice 任何人都可以 mint（仅用于测试）
    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}

/**
 * @title MockUSDC
 * @notice 测试用 USDC 代币（6位小数）
 */
contract MockUSDC is ERC20 {
    constructor() ERC20("Mock USDC", "USDC") {
        _mint(msg.sender, 100_000_000 * 1e6);
    }

    function decimals() public pure override returns (uint8) {
        return 6;
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}

/**
 * @title MockUSD1
 * @notice 测试用 USD1 代币（18位小数 - 类似 DAI）
 */
contract MockUSD1 is ERC20 {
    constructor() ERC20("Mock USD1", "USD1") {
        _mint(msg.sender, 100_000_000 * 1e18);
    }

    function decimals() public pure override returns (uint8) {
        return 18;
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}

/**
 * @title DeploySettlement
 * @notice 部署 Settlement 合约（多稳定币版本）
 * @dev 部署步骤：
 *   1. 设置环境变量 PRIVATE_KEY、RPC_URL
 *   2. 可选：设置 USDT_ADDRESS、USDC_ADDRESS、USD1_ADDRESS（不设置则部署 Mock 版本）
 *   3. 运行：forge script script/DeploySettlement.s.sol --rpc-url $RPC_URL --broadcast
 *   4. 记录部署的合约地址
 *   5. 配置授权撮合者地址
 *
 * 多稳定币支持：
 *   - 支持 USDT (6 decimals)、USDC (6 decimals)、USD1 (18 decimals) 等
 *   - 所有币种统一转换为 6 位小数精度存储
 *   - 用户可以存入任意支持的币种，提取任意支持的币种
 */
contract DeploySettlement is Script {
    Settlement public settlement;
    ContractRegistry public registry;
    address public usdtAddress;
    address public usdcAddress;
    address public usd1Address;
    address public wethAddress;

    function run() external {
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(deployerPrivateKey);

        // 从环境变量读取配置
        address matcherAddress = vm.envOr("MATCHER_ADDRESS", deployer);
        address insuranceFundAddress = vm.envOr("INSURANCE_FUND_ADDRESS", deployer);
        address feeReceiverAddress = vm.envOr("FEE_RECEIVER_ADDRESS", deployer);
        usdtAddress = vm.envOr("USDT_ADDRESS", address(0));
        usdcAddress = vm.envOr("USDC_ADDRESS", address(0));
        usd1Address = vm.envOr("USD1_ADDRESS", address(0));
        // Base Sepolia WETH address
        wethAddress = vm.envOr("WETH_ADDRESS", address(0x4200000000000000000000000000000000000006));

        console.log("===========================================");
        console.log("Deploying Settlement Contract (Multi-Token)");
        console.log("===========================================");
        console.log("Deployer:", deployer);
        console.log("Deployer balance:", deployer.balance / 1e18, "ETH");
        console.log("Matcher:", matcherAddress);
        console.log("Insurance Fund:", insuranceFundAddress);
        console.log("Fee Receiver:", feeReceiverAddress);

        vm.startBroadcast(deployerPrivateKey);

        // 1. 部署或使用现有的稳定币
        console.log("\n--- Deploying Stablecoins ---");

        if (usdtAddress == address(0)) {
            MockUSDT mockUsdt = new MockUSDT();
            usdtAddress = address(mockUsdt);
            console.log("MockUSDT deployed at:", usdtAddress);
        } else {
            console.log("Using existing USDT:", usdtAddress);
        }

        if (usdcAddress == address(0)) {
            MockUSDC mockUsdc = new MockUSDC();
            usdcAddress = address(mockUsdc);
            console.log("MockUSDC deployed at:", usdcAddress);
        } else {
            console.log("Using existing USDC:", usdcAddress);
        }

        if (usd1Address == address(0)) {
            MockUSD1 mockUsd1 = new MockUSD1();
            usd1Address = address(mockUsd1);
            console.log("MockUSD1 deployed at:", usd1Address);
        } else {
            console.log("Using existing USD1:", usd1Address);
        }

        // 2. 部署 ContractRegistry 合约
        console.log("\n--- Deploying ContractRegistry ---");
        registry = new ContractRegistry();
        console.log("ContractRegistry deployed at:", address(registry));

        // 3. 部署 Settlement 合约
        console.log("\n--- Deploying Settlement ---");
        settlement = new Settlement();
        console.log("Settlement deployed at:", address(settlement));

        // 4. 设置 ContractRegistry
        settlement.setContractRegistry(address(registry));
        console.log("ContractRegistry set in Settlement");

        // 5. 添加支持的稳定币
        console.log("\n--- Adding Supported Tokens ---");
        settlement.addSupportedToken(usdtAddress, 6);
        console.log("Added USDT (6 decimals):", usdtAddress);

        settlement.addSupportedToken(usdcAddress, 6);
        console.log("Added USDC (6 decimals):", usdcAddress);

        settlement.addSupportedToken(usd1Address, 18);
        console.log("Added USD1 (18 decimals):", usd1Address);

        // 添加 WETH 支持 (18 decimals)
        settlement.addSupportedToken(wethAddress, 18);
        console.log("Added WETH (18 decimals):", wethAddress);

        // 6. 配置授权撮合者
        console.log("\n--- Configuring Settlement ---");
        settlement.setAuthorizedMatcher(matcherAddress, true);
        console.log("Authorized matcher:", matcherAddress);

        // 7. 设置保险基金地址
        settlement.setInsuranceFund(insuranceFundAddress);
        console.log("Insurance fund set:", insuranceFundAddress);

        // 8. 设置手续费接收者
        settlement.setFeeReceiver(feeReceiverAddress);
        console.log("Fee receiver set:", feeReceiverAddress);

        // 9. 可选：设置旧版 PositionManager 地址（用于互斥检查）
        address legacyPositionManager = vm.envOr("LEGACY_POSITION_MANAGER", address(0));
        if (legacyPositionManager != address(0)) {
            settlement.setLegacyPositionManager(legacyPositionManager);
            console.log("Legacy PositionManager set:", legacyPositionManager);
        }

        vm.stopBroadcast();

        // 10. 输出部署结果
        console.log("\n===========================================");
        console.log("Deployment Completed!");
        console.log("===========================================");
        console.log("\n--- Contract Addresses ---");
        console.log("Settlement:", address(settlement));
        console.log("ContractRegistry:", address(registry));
        console.log("USDT:", usdtAddress);
        console.log("USDC:", usdcAddress);
        console.log("USD1:", usd1Address);
        console.log("WETH:", wethAddress);
        console.log("\n--- Precision Info ---");
        console.log("Internal storage: 6 decimals (matches USDT/USDC)");
        console.log("USDT/USDC: 1 token = 1e6");
        console.log("USD1: 1 token = 1e18 (auto-converted to 1e6 on deposit)");
        console.log("\n--- Next Steps ---");
        console.log("1. Update frontend/.env.local:");
        console.log("   NEXT_PUBLIC_SETTLEMENT_ADDRESS=", address(settlement));
        console.log("   NEXT_PUBLIC_CONTRACT_REGISTRY_ADDRESS=", address(registry));
        console.log("   NEXT_PUBLIC_USDT_ADDRESS=", usdtAddress);
        console.log("   NEXT_PUBLIC_USDC_ADDRESS=", usdcAddress);
        console.log("   NEXT_PUBLIC_USD1_ADDRESS=", usd1Address);
        console.log("\n2. Update backend/.env:");
        console.log("   SETTLEMENT_ADDRESS=", address(settlement));
        console.log("   CONTRACT_REGISTRY_ADDRESS=", address(registry));
        console.log("   USDT_ADDRESS=", usdtAddress);
        console.log("   USDC_ADDRESS=", usdcAddress);
        console.log("   USD1_ADDRESS=", usd1Address);
        console.log("\n3. User deposit flow (any supported token):");
        console.log("   token.approve(settlement, amount)");
        console.log("   settlement.deposit(tokenAddress, amount)");
        console.log("\n4. User withdraw flow (any supported token):");
        console.log("   settlement.withdraw(tokenAddress, amount)");
        console.log("===========================================");
    }
}
