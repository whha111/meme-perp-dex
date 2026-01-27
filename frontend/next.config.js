/** @type {import('next').NextConfig} */
const nextConfig = {
  // Enable standalone output for Docker deployment
  output: 'standalone',

  // 关闭 Strict Mode 避免双重挂载导致的 WebSocket 连接/断开循环
  reactStrictMode: false,

  // 禁用开发指示器避免 WebSocket URL 错误
  devIndicators: {
    buildActivity: false,
    buildActivityPosition: 'bottom-right',
  },

  // 实验性功能：加速开发模式
  experimental: {
    // 优化包导入
    optimizePackageImports: ['@rainbow-me/rainbowkit', 'wagmi', 'viem', 'lucide-react'],
  },

  webpack: (config, { dev }) => {
    config.externals.push('pino-pretty', 'lokijs', 'encoding');

    // Resolve MetaMask SDK react-native dependency warning
    config.resolve.fallback = {
      ...config.resolve.fallback,
      '@react-native-async-storage/async-storage': false,
    };

    // 开发模式优化
    if (dev) {
      config.watchOptions = {
        poll: 1000,
        aggregateTimeout: 300,
      };
    }

    return config;
  },
};

module.exports = nextConfig;
