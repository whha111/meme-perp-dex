# MEME Perp DEX

去中心化 MEME 币永续合约交易平台

## 项目结构

```
meme-perp-dex/
├── frontend/          # React + TypeScript 前端
├── backend/           # Go + Gin 后端
├── contracts/         # Solidity + Foundry 智能合约
├── docs/              # 项目文档
│   ├── PRD.md                    # 产品需求文档
│   ├── API_SPECIFICATION.md      # API 规范
│   ├── DEVELOPMENT_STANDARDS.md  # 开发规范
│   └── SYSTEM_ARCHITECTURE.md    # 系统架构
├── docker-compose.yml # Docker 编排
└── Makefile          # 构建脚本
```

## 技术栈

### 前端
- React 18 + TypeScript
- Vite 构建
- Zustand 状态管理
- TanStack Query 数据请求
- Wagmi + Viem Web3 连接
- Tailwind CSS 样式
- Lightweight Charts K线图

### 后端
- Go 1.22+
- Gin Web 框架
- GORM ORM
- PostgreSQL + TimescaleDB
- Redis 缓存
- WebSocket 实时推送

### 智能合约
- Solidity 0.8.20
- Foundry 开发框架
- OpenZeppelin 安全库

## 快速开始

### 环境要求
- Node.js 18+
- pnpm 8+
- Go 1.22+
- Foundry
- Docker & Docker Compose
- PostgreSQL 16+
- Redis 7+

### 安装依赖

```bash
# 前端
make install-frontend

# 后端
cd backend && go mod download

# 合约
cd contracts && forge install
```

### 开发模式

```bash
# 启动前端开发服务器
make dev-frontend

# 启动后端 API 服务
make dev-backend

# 编译合约
make build-contracts
```

### Docker 启动

```bash
# 构建并启动所有服务
make docker-up

# 停止服务
make docker-down
```

## 功能模块

### 内盘认购 (Presale)
- 50 BNB 认购 10 亿 MEME
- 可退款机制
- 满额后自动开启交易

### 现货交易 (Spot)
- AMM 自动做市
- BNB <-> MEME 兑换
- 实时价格更新

### 永续合约 (Perpetual)
- 最高 100x 杠杆
- 全仓/逐仓模式
- 止盈止损
- 4 小时资金费率结算
- 自动清算

### LP 流动性池
- MEME 存入赚取利息
- 为空头提供借贷
- 100% 本金保障

## 文档

- [产品需求文档](docs/PRD.md)
- [API 规范](docs/API_SPECIFICATION.md)
- [开发规范](docs/DEVELOPMENT_STANDARDS.md)
- [系统架构](docs/SYSTEM_ARCHITECTURE.md)

## 许可证

MIT License
