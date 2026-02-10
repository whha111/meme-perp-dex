import { createPublicClient, http, parseEther, encodeFunctionData } from "viem";
import { baseSepolia } from "viem/chains";

const client = createPublicClient({ chain: baseSepolia, transport: http("https://sepolia.base.org") });

const TOKEN_FACTORY = "0x8de2Ce2a0f974b4CB00EC5B56BD89382690b5523" as `0x${string}`;
const TPEPE = "0x423744F02934B7718888C40134d3C0d00030A551" as `0x${string}`;
const USER = "0xaecb229194314999e396468eb091b42e44bc3c8c" as `0x${string}`;

const calldata = encodeFunctionData({
  abi: [{ type: "function", name: "buy", inputs: [{ name: "tokenAddress", type: "address" }, { name: "minTokensOut", type: "uint256" }], outputs: [], stateMutability: "payable" }],
  functionName: "buy",
  args: [TPEPE, 1n],
});

try {
  const result = await client.call({
    to: TOKEN_FACTORY,
    data: calldata,
    value: parseEther("0.05"),
    account: USER,
  });
  console.log("Success:", result);
} catch (e: any) {
  console.log("Full error:", JSON.stringify(e, null, 2).slice(0, 2000));
  // 尝试提取 revert data
  if (e.cause?.data) {
    console.log("\nRevert data:", e.cause.data);
  }
  if (e.walk) {
    const inner = e.walk();
    console.log("\nInner error:", inner?.message?.slice(0, 500));
    console.log("Inner data:", inner?.data);
  }
}
