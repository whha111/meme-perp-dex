import { createPublicClient, http, type Address } from 'viem';
import { baseSepolia } from 'viem/chains';

const client = createPublicClient({
  chain: baseSepolia,
  transport: http('https://base-sepolia.g.alchemy.com/v2/Dr8sMe-1MYIF7jBYuZZj8PMOPAAeJ16d'),
});

const TOKEN_FACTORY = '0xE0ddf67E89f5773c960Bc2329109815E8c66BAAe' as Address;
const PRICE_FEED = '0xd69A4DB60cEc962A46C6B9Bc8CC0883081c4eFb7' as Address;

async function check() {
  console.log('=== PriceFeed 配置检查 ===\n');

  // 检查 PriceFeed 的 tokenFactory 地址
  try {
    const tokenFactoryInPriceFeed = await client.readContract({
      address: PRICE_FEED,
      abi: [{
        inputs: [],
        name: 'tokenFactory',
        outputs: [{ type: 'address' }],
        stateMutability: 'view',
        type: 'function',
      }],
      functionName: 'tokenFactory',
    });

    console.log('PriceFeed 中的 TokenFactory:', tokenFactoryInPriceFeed);
    console.log('实际 TokenFactory:', TOKEN_FACTORY);
    console.log('是否匹配:', tokenFactoryInPriceFeed.toLowerCase() === TOKEN_FACTORY.toLowerCase() ? '✅ 是' : '❌ 否');
  } catch (e: any) {
    console.log('无法读取 tokenFactory:', e.message?.slice(0, 100));
  }

  // 检查 TokenFactory 的 priceFeed 地址
  console.log('\n');
  try {
    const priceFeedInFactory = await client.readContract({
      address: TOKEN_FACTORY,
      abi: [{
        inputs: [],
        name: 'priceFeed',
        outputs: [{ type: 'address' }],
        stateMutability: 'view',
        type: 'function',
      }],
      functionName: 'priceFeed',
    });

    console.log('TokenFactory 中的 PriceFeed:', priceFeedInFactory);
    console.log('实际 PriceFeed:', PRICE_FEED);
    console.log('是否匹配:', priceFeedInFactory.toLowerCase() === PRICE_FEED.toLowerCase() ? '✅ 是' : '❌ 否');
  } catch (e: any) {
    console.log('无法读取 priceFeed:', e.message?.slice(0, 100));
  }
}

check().catch(console.error);
