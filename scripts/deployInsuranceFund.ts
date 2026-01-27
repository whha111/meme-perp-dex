import { createPublicClient, createWalletClient, http, formatEther, parseEther, type Address } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { baseSepolia } from "viem/chains";
import { readFileSync } from "fs";
import { join } from "path";

const RPC_URL = "https://base-sepolia-rpc.publicnode.com";
const CONTRACTS_DIR = "/Users/qinlinqiu/Desktop/meme-perp-dex/contracts";
const DEPLOYER_KEY = "0xf9a07bb59ea400ef88bfbcf314d89f357c8580d1a4fb543e48cfb98b02b41d2c";

// 现有合约地址 (checksummed)
const VAULT = "0x467a18E3Ec98587Cd88683E6F9e1792C480C09c7" as Address;
const PRICE_FEED = "0xd69A4DB60cEc962A46C6B9Bc8CC0883081c4eFb7" as Address;
const RISK_MANAGER = "0x0D34E3E4379CFAD56a038E0f4C573Cdbe84Dba24" as Address;

const client = createPublicClient({
  chain: baseSepolia,
  transport: http(RPC_URL),
});

const account = privateKeyToAccount(DEPLOYER_KEY);
const walletClient = createWalletClient({
  account,
  chain: baseSepolia,
  transport: http(RPC_URL),
});

// 读取合约 ABI 和 bytecode
function getContractArtifact(contractName: string) {
  const artifactPath = join(CONTRACTS_DIR, `out/${contractName}.sol/${contractName}.json`);
  const artifact = JSON.parse(readFileSync(artifactPath, "utf8"));
  return {
    abi: artifact.abi,
    bytecode: artifact.bytecode.object as `0x${string}`,
  };
}

const VAULT_ABI = [
  {
    inputs: [{ name: "_insuranceFund", type: "address" }],
    name: "setInsuranceFund",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [{ name: "contractAddr", type: "address" }, { name: "authorized", type: "bool" }],
    name: "setAuthorizedContract",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [],
    name: "insuranceFund",
    outputs: [{ type: "address" }],
    stateMutability: "view",
    type: "function",
  },
] as const;

async function main() {
  console.log("=== 部署 InsuranceFund 和更新 PositionManager ===\n");
  console.log("Deployer:", account.address);

  const balance = await client.getBalance({ address: account.address });
  console.log("Deployer Balance:", formatEther(balance), "ETH\n");

  // 1. 部署 InsuranceFund
  console.log("步骤 1: 部署 InsuranceFund...");
  const insuranceFundArtifact = getContractArtifact("InsuranceFund");

  const insuranceFundHash = await walletClient.deployContract({
    abi: insuranceFundArtifact.abi,
    bytecode: insuranceFundArtifact.bytecode,
    args: [],
  });

  console.log("  Tx Hash:", insuranceFundHash);
  const insuranceFundReceipt = await client.waitForTransactionReceipt({ hash: insuranceFundHash });
  const insuranceFundAddress = insuranceFundReceipt.contractAddress!;
  console.log("  InsuranceFund 部署成功:", insuranceFundAddress);

  // 2. 部署新的 PositionManager
  console.log("\n步骤 2: 部署新的 PositionManager...");
  const pmArtifact = getContractArtifact("PositionManager");

  const pmHash = await walletClient.deployContract({
    abi: pmArtifact.abi,
    bytecode: pmArtifact.bytecode,
    args: [VAULT, PRICE_FEED, RISK_MANAGER],
  });

  console.log("  Tx Hash:", pmHash);
  const pmReceipt = await client.waitForTransactionReceipt({ hash: pmHash });
  const pmAddress = pmReceipt.contractAddress!;
  console.log("  PositionManager 部署成功:", pmAddress);

  // 3. 配置 InsuranceFund
  console.log("\n步骤 3: 配置 InsuranceFund...");

  // 设置 Vault
  const setVaultHash = await walletClient.writeContract({
    address: insuranceFundAddress,
    abi: insuranceFundArtifact.abi,
    functionName: "setVault",
    args: [VAULT],
  });
  await client.waitForTransactionReceipt({ hash: setVaultHash });
  console.log("  ✅ InsuranceFund.setVault");

  // 设置 PositionManager
  const setPmHash = await walletClient.writeContract({
    address: insuranceFundAddress,
    abi: insuranceFundArtifact.abi,
    functionName: "setPositionManager",
    args: [pmAddress],
  });
  await client.waitForTransactionReceipt({ hash: setPmHash });
  console.log("  ✅ InsuranceFund.setPositionManager");

  // 4. 配置 Vault
  console.log("\n步骤 4: 配置 Vault...");

  // 设置 InsuranceFund
  const setIfHash = await walletClient.writeContract({
    address: VAULT,
    abi: VAULT_ABI,
    functionName: "setInsuranceFund",
    args: [insuranceFundAddress],
  });
  await client.waitForTransactionReceipt({ hash: setIfHash });
  console.log("  ✅ Vault.setInsuranceFund");

  // 授权新 PositionManager
  const authPmHash = await walletClient.writeContract({
    address: VAULT,
    abi: VAULT_ABI,
    functionName: "setAuthorizedContract",
    args: [pmAddress, true],
  });
  await client.waitForTransactionReceipt({ hash: authPmHash });
  console.log("  ✅ Vault.setAuthorizedContract(PositionManager)");

  // 5. 向 InsuranceFund 注入初始资金
  console.log("\n步骤 5: 向 InsuranceFund 注入初始资金...");
  const fundAmount = parseEther("0.1"); // 0.1 ETH 初始资金

  const fundHash = await walletClient.sendTransaction({
    to: insuranceFundAddress,
    value: fundAmount,
  });
  await client.waitForTransactionReceipt({ hash: fundHash });
  console.log("  ✅ 已注入", formatEther(fundAmount), "ETH");

  // 验证配置
  console.log("\n=== 部署完成 ===");
  console.log("InsuranceFund:", insuranceFundAddress);
  console.log("PositionManager:", pmAddress);

  const ifBalance = await client.getBalance({ address: insuranceFundAddress });
  console.log("InsuranceFund Balance:", formatEther(ifBalance), "ETH");

  const vaultInsuranceFund = await client.readContract({
    address: VAULT,
    abi: VAULT_ABI,
    functionName: "insuranceFund",
  });
  console.log("Vault.insuranceFund:", vaultInsuranceFund);

  console.log("\n请更新前端配置 NEXT_PUBLIC_POSITION_MANAGER_ADDRESS 为:", pmAddress);
}

main().catch((e) => {
  console.error("错误:", e.message);
  process.exit(1);
});
