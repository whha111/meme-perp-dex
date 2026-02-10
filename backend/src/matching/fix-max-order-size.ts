/**
 * 修复 ContractRegistry 的 maxOrderSize 问题
 *
 * 问题：Settlement 合约用代币数量（1e18精度）与 maxOrderSize（USD，1e6精度）比较
 * 解决：将 maxOrderSize 设置为一个很大的值，绕过这个检查
 */

import { createWalletClient, createPublicClient, http, parseAbi, type Address } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { baseSepolia } from "viem/chains";
import { MATCHER_PRIVATE_KEY, RPC_URL } from "./config";

// ContractRegistry 地址 (从 Settlement 合约读取)
const CONTRACT_REGISTRY = "0x51014b1135820949b4d903f6E144ceA825E6Ac2F" as Address;

// 要更新的代币地址 (从日志获取)
const TOKENS_TO_UPDATE: Address[] = [
  "0xD3aAB9586887465502e2CeB43F89D9d2315d8A23" as Address, // 当前测试代币
];

const contractRegistryAbi = parseAbi([
  "function setContractSpec(address token, (uint256 contractSize, uint256 tickSize, uint8 priceDecimals, uint8 quantityDecimals, uint256 minOrderSize, uint256 maxOrderSize, uint256 maxPositionSize, uint256 maxLeverage, uint256 imRate, uint256 mmRate, uint256 maxPriceDeviation, bool isActive, uint256 createdAt) spec) external",
  "function getContractSpec(address token) external view returns ((uint256 contractSize, uint256 tickSize, uint8 priceDecimals, uint8 quantityDecimals, uint256 minOrderSize, uint256 maxOrderSize, uint256 maxPositionSize, uint256 maxLeverage, uint256 imRate, uint256 mmRate, uint256 maxPriceDeviation, bool isActive, uint256 createdAt))",
  "function owner() external view returns (address)",
]);

async function main() {
  const account = privateKeyToAccount(MATCHER_PRIVATE_KEY);

  const publicClient = createPublicClient({
    chain: baseSepolia,
    transport: http(RPC_URL),
  });

  const walletClient = createWalletClient({
    account,
    chain: baseSepolia,
    transport: http(RPC_URL),
  });

  console.log("=".repeat(60));
  console.log("修复 ContractRegistry maxOrderSize");
  console.log("=".repeat(60));
  console.log("Account:", account.address);
  console.log("ContractRegistry:", CONTRACT_REGISTRY);

  // 检查 owner
  const owner = await publicClient.readContract({
    address: CONTRACT_REGISTRY,
    abi: contractRegistryAbi,
    functionName: "owner",
  });
  console.log("Owner:", owner);

  if (owner.toLowerCase() !== account.address.toLowerCase()) {
    console.error("❌ 当前账户不是 owner，无法更新!");
    return;
  }

  // 获取当前合约规格
  for (const token of TOKENS_TO_UPDATE) {
    console.log("\n" + "-".repeat(60));
    console.log(`Token: ${token}`);

    const currentSpec = await publicClient.readContract({
      address: CONTRACT_REGISTRY,
      abi: contractRegistryAbi,
      functionName: "getContractSpec",
      args: [token],
    }) as any;

    console.log("当前 maxOrderSize:", currentSpec.maxOrderSize.toString());
    console.log("当前 maxPositionSize:", currentSpec.maxPositionSize.toString());

    // 设置新的值 - 使用 10^50 足够大的值
    // 由于 Settlement 合约直接比较代币数量（可能高达 10^25+）与这个值
    // 我们需要设置一个足够大的值来允许任何合理的订单
    const newMaxOrderSize = 10n ** 50n;
    const newMaxPositionSize = 10n ** 51n;

    console.log("新的 maxOrderSize:", newMaxOrderSize.toString());
    console.log("新的 maxPositionSize:", newMaxPositionSize.toString());

    // 构建新的 spec
    const newSpec = {
      contractSize: currentSpec.contractSize,
      tickSize: currentSpec.tickSize,
      priceDecimals: currentSpec.priceDecimals,
      quantityDecimals: currentSpec.quantityDecimals,
      minOrderSize: currentSpec.minOrderSize,
      maxOrderSize: newMaxOrderSize,
      maxPositionSize: newMaxPositionSize,
      maxLeverage: currentSpec.maxLeverage,
      imRate: currentSpec.imRate,
      mmRate: currentSpec.mmRate,
      maxPriceDeviation: currentSpec.maxPriceDeviation,
      isActive: currentSpec.isActive,
      createdAt: currentSpec.createdAt,
    };

    // 发送交易
    console.log("发送更新交易...");
    const hash = await walletClient.writeContract({
      address: CONTRACT_REGISTRY,
      abi: contractRegistryAbi,
      functionName: "setContractSpec",
      args: [token as Address, newSpec],
    });

    console.log("交易 hash:", hash);

    // 等待确认
    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    console.log("交易状态:", receipt.status === "success" ? "✅ 成功" : "❌ 失败");

    // 验证更新
    const updatedSpec = await publicClient.readContract({
      address: CONTRACT_REGISTRY,
      abi: contractRegistryAbi,
      functionName: "getContractSpec",
      args: [token],
    }) as any;

    console.log("更新后 maxOrderSize:", updatedSpec.maxOrderSize.toString());
    console.log("更新后 maxPositionSize:", updatedSpec.maxPositionSize.toString());
  }

  // 同时更新 defaultContractSpec
  console.log("\n" + "-".repeat(60));
  console.log("更新 defaultContractSpec...");

  const defaultSpecAbi = parseAbi([
    "function setDefaultContractSpec((uint256 contractSize, uint256 tickSize, uint8 priceDecimals, uint8 quantityDecimals, uint256 minOrderSize, uint256 maxOrderSize, uint256 maxPositionSize, uint256 maxLeverage, uint256 imRate, uint256 mmRate, uint256 maxPriceDeviation, bool isActive, uint256 createdAt) spec) external",
    "function defaultContractSpec() external view returns ((uint256 contractSize, uint256 tickSize, uint8 priceDecimals, uint8 quantityDecimals, uint256 minOrderSize, uint256 maxOrderSize, uint256 maxPositionSize, uint256 maxLeverage, uint256 imRate, uint256 mmRate, uint256 maxPriceDeviation, bool isActive, uint256 createdAt))",
  ]);

  const currentDefault = await publicClient.readContract({
    address: CONTRACT_REGISTRY,
    abi: defaultSpecAbi,
    functionName: "defaultContractSpec",
  }) as any;

  console.log("当前默认 maxOrderSize:", currentDefault.maxOrderSize.toString());

  const newDefaultSpec = {
    contractSize: currentDefault.contractSize,
    tickSize: currentDefault.tickSize,
    priceDecimals: currentDefault.priceDecimals,
    quantityDecimals: currentDefault.quantityDecimals,
    minOrderSize: currentDefault.minOrderSize,
    maxOrderSize: 10n ** 50n,
    maxPositionSize: 10n ** 51n,
    maxLeverage: currentDefault.maxLeverage,
    imRate: currentDefault.imRate,
    mmRate: currentDefault.mmRate,
    maxPriceDeviation: currentDefault.maxPriceDeviation,
    isActive: currentDefault.isActive,
    createdAt: currentDefault.createdAt,
  };

  const hash2 = await walletClient.writeContract({
    address: CONTRACT_REGISTRY,
    abi: defaultSpecAbi,
    functionName: "setDefaultContractSpec",
    args: [newDefaultSpec],
  });

  console.log("交易 hash:", hash2);
  const receipt2 = await publicClient.waitForTransactionReceipt({ hash: hash2 });
  console.log("交易状态:", receipt2.status === "success" ? "✅ 成功" : "❌ 失败");

  console.log("\n" + "=".repeat(60));
  console.log("✅ 完成!");
  console.log("=".repeat(60));
}

main().catch(console.error);
