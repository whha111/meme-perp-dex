import { createPublicClient, http, formatUnits, formatEther, type Address } from 'viem';
import { baseSepolia } from 'viem/chains';

const client = createPublicClient({
  chain: baseSepolia,
  transport: http('https://base-sepolia.g.alchemy.com/v2/Dr8sMe-1MYIF7jBYuZZj8PMOPAAeJ16d'),
});

const TOKEN = '0x6Bf5C512a5714D610379b1EA0Dec0BEFb46888f7' as Address;
const TOKEN_FACTORY = '0xE0ddf67E89f5773c960Bc2329109815E8c66BAAe' as Address;
const PRICE_FEED = '0xd69A4DB60cEc962A46C6B9Bc8CC0883081c4eFb7' as Address;

async function check() {
  // 从 TokenFactory 计算实际现货价格
  const poolState = await client.readContract({
    address: TOKEN_FACTORY,
    abi: [{
      inputs: [{ name: 'tokenAddress', type: 'address' }],
      name: 'getPoolState',
      outputs: [{
        components: [
          { name: 'realETHReserve', type: 'uint256' },
          { name: 'realTokenReserve', type: 'uint256' },
          { name: 'soldTokens', type: 'uint256' },
          { name: 'isGraduated', type: 'bool' },
          { name: 'isActive', type: 'bool' },
          { name: 'creator', type: 'address' },
          { name: 'createdAt', type: 'uint64' },
          { name: 'metadataURI', type: 'string' },
        ],
        type: 'tuple',
      }],
      stateMutability: 'view',
      type: 'function',
    }],
    functionName: 'getPoolState',
    args: [TOKEN],
  });

  // 计算现货价格 (ETH per token)
  const spotPrice = poolState.realETHReserve * BigInt(1e18) / poolState.realTokenReserve;

  // PriceFeed 标记价格
  const markPrice = await client.readContract({
    address: PRICE_FEED,
    abi: [{
      inputs: [{ name: 'token', type: 'address' }],
      name: 'getTokenMarkPrice',
      outputs: [{ type: 'uint256' }],
      stateMutability: 'view',
      type: 'function',
    }],
    functionName: 'getTokenMarkPrice',
    args: [TOKEN],
  });

  console.log('=== COP400 价格对比 ===');
  console.log('现货价格 (从池子计算):', formatUnits(spotPrice, 18), 'ETH');
  console.log('标记价格 (PriceFeed):', formatUnits(markPrice, 18), 'ETH');
  console.log('');
  console.log('池子状态:');
  console.log('  ETH储备:', formatEther(poolState.realETHReserve), 'ETH');
  console.log('  代币储备:', formatEther(poolState.realTokenReserve));

  // 计算价格差异
  const priceDiff = Number(spotPrice - markPrice) / Number(markPrice) * 100;
  console.log('');
  console.log('价格差异:', priceDiff.toFixed(2), '%');
}

check().catch(console.error);
