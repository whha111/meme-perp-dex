import { createPublicClient, http, type Address, getContract } from 'viem';
import { baseSepolia } from 'viem/chains';

const client = createPublicClient({
  chain: baseSepolia,
  transport: http('https://base-sepolia.g.alchemy.com/v2/Dr8sMe-1MYIF7jBYuZZj8PMOPAAeJ16d'),
});

const TOKEN_FACTORY = '0xE0ddf67E89f5773c960Bc2329109815E8c66BAAe' as Address;

const ABI = [
  {
    inputs: [],
    name: 'priceFeed',
    outputs: [{ type: 'address' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [],
    name: 'owner',
    outputs: [{ type: 'address' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [],
    name: 'PERP_ENABLE_THRESHOLD',
    outputs: [{ type: 'uint256' }],
    stateMutability: 'view',
    type: 'function',
  },
] as const;

async function check() {
  console.log('=== TokenFactory 配置检查 ===\n');

  try {
    const priceFeedAddr = await client.readContract({
      address: TOKEN_FACTORY,
      abi: ABI,
      functionName: 'priceFeed',
    });
    console.log('TokenFactory.priceFeed:', priceFeedAddr);
  } catch (e: any) {
    console.log('读取 priceFeed 失败:', e.message?.slice(0, 150));
  }

  try {
    const owner = await client.readContract({
      address: TOKEN_FACTORY,
      abi: ABI,
      functionName: 'owner',
    });
    console.log('TokenFactory.owner:', owner);
  } catch (e: any) {
    console.log('读取 owner 失败:', e.message?.slice(0, 100));
  }

  try {
    const threshold = await client.readContract({
      address: TOKEN_FACTORY,
      abi: ABI,
      functionName: 'PERP_ENABLE_THRESHOLD',
    });
    console.log('PERP_ENABLE_THRESHOLD:', threshold.toString(), 'wei');
    console.log('  即:', Number(threshold) / 1e18, 'ETH');
  } catch (e: any) {
    console.log('读取 PERP_ENABLE_THRESHOLD 失败:', e.message?.slice(0, 100));
  }
}

check().catch(console.error);
