import { createPublicClient, http, formatEther, parseEther, decodeFunctionData, decodeErrorResult } from "viem";
import { baseSepolia } from "viem/chains";

const client = createPublicClient({ chain: baseSepolia, transport: http("https://sepolia.base.org") });

const TOKEN_FACTORY = "0x8de2Ce2a0f974b4CB00EC5B56BD89382690b5523" as const;
const TPEPE = "0x423744F02934B7718888C40134d3C0d00030A551" as const;

const ABI = [
  { type: "function", name: "buy", inputs: [{ name: "tokenAddress", type: "address" }, { name: "minTokensOut", type: "uint256" }], outputs: [], stateMutability: "payable" },
  { type: "function", name: "previewBuy", inputs: [{ name: "tokenAddress", type: "address" }, { name: "ethIn", type: "uint256" }], outputs: [{ name: "", type: "uint256" }], stateMutability: "view" },
  { type: "function", name: "getCurrentPrice", inputs: [{ name: "tokenAddress", type: "address" }], outputs: [{ name: "", type: "uint256" }], stateMutability: "view" },
  { type: "function", name: "getPoolState", inputs: [{ name: "tokenAddress", type: "address" }], outputs: [{ name: "", type: "tuple", components: [{ name: "realETHReserve", type: "uint256" }, { name: "realTokenReserve", type: "uint256" }, { name: "soldTokens", type: "uint256" }, { name: "isGraduated", type: "bool" }, { name: "isActive", type: "bool" }, { name: "creator", type: "address" }, { name: "createdAt", type: "uint64" }, { name: "metadataURI", type: "string" }]}], stateMutability: "view" },
  { type: "error", name: "InsufficientLiquidity", inputs: [{ name: "requested", type: "uint256" }, { name: "available", type: "uint256" }] },
  { type: "error", name: "PoolNotActive", inputs: [] },
  { type: "error", name: "InvalidAmount", inputs: [] },
] as const;

const USER = "0xaecb229194314999e396468eb091b42e44bc3c8c";

async function main() {
  // 1. 查池子状态
  console.log("=== 池子状态 ===");
  const pool = await client.readContract({ address: TOKEN_FACTORY, abi: ABI, functionName: "getPoolState", args: [TPEPE] }) as any;
  console.log("isActive:", pool.isActive);
  console.log("isGraduated:", pool.isGraduated);
  console.log("realETHReserve:", formatEther(pool.realETHReserve), "ETH");
  console.log("realTokenReserve:", formatEther(pool.realTokenReserve), "tokens");

  const price = await client.readContract({ address: TOKEN_FACTORY, abi: ABI, functionName: "getCurrentPrice", args: [TPEPE] });
  console.log("currentPrice:", formatEther(price), "ETH/token");

  // 2. previewBuy 测试不同金额
  console.log("\n=== previewBuy 测试 ===");
  for (const eth of ["0.05", "0.1", "0.5"]) {
    try {
      const preview = await client.readContract({ address: TOKEN_FACTORY, abi: ABI, functionName: "previewBuy", args: [TPEPE, parseEther(eth)] });
      console.log(`buy ${eth} ETH -> ${formatEther(preview)} tokens`);
    } catch (e: any) {
      console.log(`buy ${eth} ETH -> ERROR:`, e.shortMessage || e.message?.slice(0, 200));
    }
  }

  // 3. 模拟实际买入交易
  console.log("\n=== 模拟买入 (eth_call) ===");
  for (const eth of ["0.05", "0.1"]) {
    try {
      await client.simulateContract({
        address: TOKEN_FACTORY,
        abi: ABI,
        functionName: "buy",
        args: [TPEPE, 1n], // minTokensOut = 1 (几乎无滑点保护)
        value: parseEther(eth),
        account: USER as `0x${string}`,
      });
      console.log(`simulate buy ${eth} ETH with minTokensOut=1 -> SUCCESS`);
    } catch (e: any) {
      console.log(`simulate buy ${eth} ETH -> REVERT:`, e.shortMessage || e.message?.slice(0, 300));
    }
  }

  // 4. 查最近的失败交易
  console.log("\n=== 查最近失败交易 ===");
  const block = await client.getBlockNumber();
  // 查最近 200 个区块的交易
  for (let b = block; b > block - 200n; b -= 50n) {
    const blockData = await client.getBlock({ blockNumber: b, includeTransactions: true });
    for (const tx of blockData.transactions) {
      if (typeof tx === 'object' && tx.from?.toLowerCase() === USER.toLowerCase() && tx.to?.toLowerCase() === TOKEN_FACTORY.toLowerCase()) {
        const receipt = await client.getTransactionReceipt({ hash: tx.hash });
        if (receipt.status === "reverted") {
          console.log(`TX ${tx.hash}`);
          console.log(`  value: ${formatEther(tx.value)} ETH`);
          console.log(`  block: ${receipt.blockNumber}`);
          try {
            const decoded = decodeFunctionData({ abi: ABI, data: tx.input });
            console.log(`  function: ${decoded.functionName}`);
            console.log(`  args:`, decoded.args?.map(a => typeof a === 'bigint' ? a.toString() : a));
          } catch {}
        }
      }
    }
  }
}

main().catch(console.error);
