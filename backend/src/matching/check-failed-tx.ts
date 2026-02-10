import { createPublicClient, http, decodeErrorResult, parseAbi, formatEther } from "viem";
import { baseSepolia } from "viem/chains";

const client = createPublicClient({ chain: baseSepolia, transport: http("https://sepolia.base.org") });

const txHashes = [
  "0x9b411f56b33728a3b2dbeb74af4b6ab643a9c7e81daccecf6e055888ad09e4dc",
  "0x47e6905f5cab67d45f0dcaa00a0ef4ad89684b8aa4f038359c70bfb1a3f40e49",
  "0x1cdc8774a01690524337b3ad420b9cfd85cb80d96a4e548089e2bcb0ff85429c",
];

// TokenFactory errors
const TOKEN_FACTORY_ERRORS = parseAbi([
  "error TokenNotFound()",
  "error InsufficientLiquidity()",
  "error SlippageExceeded(uint256 expected, uint256 actual)",
  "error TransferFailed()",
  "error Graduated()",
  "error NotGraduated()",
  "error InvalidAmount()",
]);

async function main() {
  for (const hash of txHashes) {
    console.log(`\n${"=".repeat(60)}`);
    console.log(`TX: ${hash}`);

    const receipt = await client.getTransactionReceipt({ hash: hash as `0x${string}` });
    console.log(`Status: ${receipt.status}`);
    console.log(`Block: ${receipt.blockNumber}`);
    console.log(`Gas used: ${receipt.gasUsed}`);

    const tx = await client.getTransaction({ hash: hash as `0x${string}` });
    console.log(`From: ${tx.from}`);
    console.log(`To: ${tx.to}`);
    console.log(`Value: ${formatEther(tx.value)} ETH`);
    console.log(`Selector: ${tx.input.slice(0, 10)}`);

    // Try to simulate to get revert reason
    try {
      await client.call({
        from: tx.from,
        to: tx.to as `0x${string}`,
        data: tx.input,
        value: tx.value,
        blockNumber: receipt.blockNumber - 1n,
      });
      console.log("Simulation: SUCCESS (unexpected for a failed tx)");
    } catch (e: any) {
      // Try to decode the error
      const errorData = e.cause?.data || e.data;
      if (errorData) {
        console.log(`Error data: ${errorData}`);
        try {
          const decoded = decodeErrorResult({
            abi: TOKEN_FACTORY_ERRORS,
            data: errorData,
          });
          console.log(`Decoded error: ${decoded.errorName}`, decoded.args);
        } catch {
          console.log("Could not decode error with known ABI");
        }
      } else {
        console.log(`Error message: ${e.message?.slice(0, 300)}`);
      }
    }
  }
}

main().catch(console.error);
