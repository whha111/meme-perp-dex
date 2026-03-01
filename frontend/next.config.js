const { withSentryConfig } = require("@sentry/nextjs");

/** @type {import('next').NextConfig} */
const nextConfig = {
  // Enable standalone output for Docker deployment
  output: 'standalone',

  // Security headers (prevent clickjacking, XSS, etc.)
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          // CSP: Prevent XSS while allowing Next.js/Web3 wallet requirements
          {
            key: 'Content-Security-Policy',
            value: [
              "default-src 'self'",
              "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
              "style-src 'self' 'unsafe-inline'",
              "img-src 'self' data: https: blob:",
              "font-src 'self' data:",
              // http: needed for local dev (matching engine on different port)
              "connect-src 'self' http://localhost:* wss: ws: https:",
              "frame-src 'self' https:",
            ].join('; '),
          },
          // HSTS: Force HTTPS for 1 year (including subdomains)
          { key: 'Strict-Transport-Security', value: 'max-age=31536000; includeSubDomains' },
        ],
      },
    ];
  },

  // 代理外部 API 避免浏览器 CORS 限制
  async rewrites() {
    return [
      {
        source: '/api/proxy/binance/:path*',
        destination: 'https://api.binance.com/api/:path*',
      },
    ];
  },

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
    // Server-only packages (Sentry/OpenTelemetry Node.js instrumentation)
    serverComponentsExternalPackages: [
      'import-in-the-middle',
      'require-in-the-middle',
      '@opentelemetry/instrumentation',
      '@fastify/otel',
    ],
  },

  webpack: (config, { dev }) => {
    config.externals.push(
      'pino-pretty', 'pino', 'lokijs', 'encoding',
      'import-in-the-middle', 'require-in-the-middle'
    );

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

module.exports = process.env.NEXT_PUBLIC_SENTRY_DSN
  ? withSentryConfig(nextConfig, {
      silent: true,
      hideSourceMaps: true,
    })
  : nextConfig;
