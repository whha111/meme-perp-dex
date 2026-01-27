import { createPublicClient, http, type Address } from 'viem';
import { baseSepolia } from 'viem/chains';

const client = createPublicClient({
  chain: baseSepolia,
  transport: http('https://base-sepolia.g.alchemy.com/v2/Dr8sMe-1MYIF7jBYuZZj8PMOPAAeJ16d'),
});

const TOKEN_FACTORY = '0xE0ddf67E89f5773c960Bc2329109815E8c66BAAe' as Address;
const PRICE_FEED = '0xd69A4DB60cEc962A46C6B9Bc8CC0883081c4eFb7' as Address;

const ABI = [
  {
    inputs: [],
    name: 'owner',
    outputs: [{ type: 'address' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [],
    name: 'tokenFactory',
    outputs: [{ type: 'address' }],
    stateMutability: 'view',
    type: 'function',
  },
] as const;

async function check() {
  console.log('=== 合约 Owner 检查 ===\n');

  // TokenFactory owner
  const tfOwner = await client.readContract({
    address: TOKEN_FACTORY,
    abi: ABI,
    functionName: 'owner',
  });
  console.log('TokenFactory owner:', tfOwner);

  // PriceFeed owner
  const pfOwner = await client.readContract({
    address: PRICE_FEED,
    abi: ABI,
    functionName: 'owner',
  });
  console.log('PriceFeed owner:', pfOwner);

  // PriceFeed tokenFactory
  const pfTokenFactory = await client.readContract({
    address: PRICE_FEED,
    abi: ABI,
    functionName: 'tokenFactory',
  });
  console.log('PriceFeed.tokenFactory:', pfTokenFactory);
  console.log('\n是否匹配 TokenFactory:', pfTokenFactory.toLowerCase() === TOKEN_FACTORY.toLowerCase() ? '✅ 是' : '❌ 否');
}

check().catch(console.error);
