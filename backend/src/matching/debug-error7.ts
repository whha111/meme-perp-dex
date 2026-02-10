import { toFunctionSelector } from "viem";

// Maybe it's an event selector collision or Panic error
// Panic(uint256) = 0x4e487b71
console.log("Panic:", toFunctionSelector("error Panic(uint256)").slice(0, 10));

// Could be from internal Solidity - try openchain
const resp = await fetch("https://api.openchain.xyz/signature-database/v1/lookup?function=0xb45b7087&filter=true");
const data = await resp.json();
console.log("OpenChain result:", JSON.stringify(data, null, 2));

// Try sig.eth.samczsun.com
const resp2 = await fetch("https://sig.eth.samczsun.com/api/v1/signatures?all=true&function=0xb45b7087");
const data2 = await resp2.json();
console.log("samczsun result:", JSON.stringify(data2, null, 2));
