import { createWalletClient, http, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { baseSepolia } from "viem/chains";

const PRIVATE_KEY = "0xf9a07bb59ea400ef88bfbcf314d89f357c8580d1a4fb543e48cfb98b02b41d2c";
const SETTLEMENT_ADDRESS = "0xa139057B6f391fb123bFdA22763418E80ddf9c8F" as Address;
const TOKEN = "0x01c6058175eDA34Fc8922EeAe32BC383CB203211" as Address;
const API_URL = "http://localhost:8081";

const getEIP712Domain = (settlementAddress: Address, chainId: number) => ({
  name: "MemePerp",
  version: "1",
  chainId,
  verifyingContract: settlementAddress,
});

const ORDER_TYPES = {
  Order: [
    { name: "trader", type: "address" },
    { name: "token", type: "address" },
    { name: "isLong", type: "bool" },
    { name: "size", type: "uint256" },
    { name: "leverage", type: "uint256" },
    { name: "price", type: "uint256" },
    { name: "deadline", type: "uint256" },
    { name: "nonce", type: "uint256" },
    { name: "orderType", type: "uint8" },
  ],
} as const;

async function main() {
  const account = privateKeyToAccount(PRIVATE_KEY as Hex);
  console.log("Account:", account.address);

  const walletClient = createWalletClient({
    account,
    chain: baseSepolia,
    transport: http(),
  });

  const nonceRes = await fetch(`${API_URL}/api/user/${account.address}/nonce`);
  const nonceData = await nonceRes.json();
  const nonce = BigInt(nonceData.nonce || 0);

  const size = 600638238384929100000000000n;
  const leverage = 100000n;
  const price = 0n;
  const deadline = BigInt(Math.floor(Date.now() / 1000) + 3600);

  const message = {
    trader: account.address,
    token: TOKEN,
    isLong: false,
    size,
    leverage,
    price,
    deadline,
    nonce,
    orderType: 0,
  };

  const domain = getEIP712Domain(SETTLEMENT_ADDRESS, 84532);
  const signature = await walletClient.signTypedData({
    account,
    domain,
    types: ORDER_TYPES,
    primaryType: "Order",
    message,
  });

  const submitRes = await fetch(`${API_URL}/api/order/submit`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      trader: account.address,
      token: TOKEN,
      isLong: false,
      size: size.toString(),
      leverage: leverage.toString(),
      price: price.toString(),
      deadline: deadline.toString(),
      nonce: nonce.toString(),
      orderType: 0,
      signature,
    }),
  });

  const result = await submitRes.json();
  console.log("Result:", JSON.stringify(result, null, 2));
}

main().catch(console.error);
