# 做市商测试指南

## 概述

这个测试脚本实现了完整的做市商模拟流程，包含：

1. ✅ 生成 200 个测试主钱包
2. ✅ 用主钱包的 ETH 买入现货代币
3. ✅ 创建 100 个派生交易钱包
4. ✅ 给派生钱包充值 10,000 USDT
5. ✅ 用 100 个钱包进行双边做市
6. ✅ 实时输出订单簿深度
7. ✅ 记录所有遇到的问题

## 运行前准备

### 1. 启动服务

```bash
# 启动撮合引擎 (端口 8081)
cd /Users/qinlinqiu/Desktop/meme-perp-dex/backend/src/matching
bun run server.ts

# 启动前端 (端口 3000)
cd /Users/qinlinqiu/Desktop/meme-perp-dex/frontend
npm run dev
```

### 2. 环境配置

需要设置环境变量或修改配置：

```bash
# 方式 1: 环境变量
export MINTER_PRIVATE_KEY="0x..."  # 有 USDT mint 权限的私钥

# 方式 2: 使用已有钱包
# 确保 main-wallets.json 的第一个钱包有 USDT mint 权限
```

### 3. 资金准备

- **主钱包**: 每个需要约 0.0001 ETH (用于买现货)
- **Minter 钱包**: 需要有 USDT 合约的 mint 权限

## 运行脚本

### 完整运行

```bash
cd /Users/qinlinqiu/Desktop/meme-perp-dex/backend/src/matching
bun run market-making-test.ts
```

### 跳过某些阶段

```bash
# 跳过现货代币买入
bun run market-making-test.ts --skip-buy

# 跳过 USDT mint
bun run market-making-test.ts --skip-mint

# 同时跳过两者
bun run market-making-test.ts --skip-buy --skip-mint
```

## 运行过程

### 阶段 1: 设置钱包
- 生成/加载 200 个主钱包
- 创建 100 个派生钱包（使用确定性签名派生）
- 钱包数据保存在 `main-wallets.json` 和 `trading-wallets.json`

### 阶段 1.5: 买入现货代币
- 每个主钱包用 0.0001 ETH 买入现货代币
- 通过 TokenFactory 的 bonding curve 机制
- 设置 1% 滑点保护
- 记录成功/失败统计

### 阶段 2: 充值 USDT
- 给每个派生钱包 mint 10,000 USDT
- 使用有权限的 minter 钱包
- 每 10 个钱包暂停 2 秒，避免 RPC 限流
- 验证前 10 个钱包余额

### 阶段 3: 做市交易
- 生成双边订单簿（50 买单 + 50 卖单）
- 价差范围: 1% - 10%
- 每个订单大小: 100-1000 代币
- 杠杆: 10x
- 每 5 秒更新一次订单
- 价格随机游走 (±2%)
- 运行 5 分钟后自动停止

## 查看效果

### 1. 控制台输出

实时显示：
- 🔑 钱包生成进度
- 💰 买币/充值统计
- 📊 每次迭代的订单簿深度 (前5档)
- ✅/❌ 订单提交成功/失败
- 📈 价格变动

### 2. 前端查看

打开浏览器访问：
```
http://localhost:3000/perp?symbol=0x13Bb1Ff472FBd7831b676d5b4040CC2aEAFc12cd
```

可以看到：
- K线图实时变化
- 订单簿深度
- 成交记录
- 持仓信息

### 3. 输出文件

- `main-wallets.json` - 主钱包列表
- `trading-wallets.json` - 派生钱包列表
- `market-making-problems.log` - 所有遇到的问题记录

## 可能遇到的问题

### 1. ETH 余额不足

**问题**: 主钱包没有足够的 ETH 买币

**解决**:
```bash
# 使用水龙头给钱包充值
# Base Sepolia Faucet: https://www.alchemy.com/faucets/base-sepolia

# 或跳过买币阶段
bun run market-making-test.ts --skip-buy
```

### 2. USDT mint 权限不足

**问题**: Minter 钱包没有 mint 权限

**解决**:
```bash
# 设置有权限的钱包私钥
export MINTER_PRIVATE_KEY="0x..."

# 或跳过 mint 阶段
bun run market-making-test.ts --skip-mint
```

### 3. 撮合引擎未运行

**问题**: 订单提交失败，无法连接到 http://localhost:8081

**解决**:
```bash
cd /Users/qinlinqiu/Desktop/meme-perp-dex/backend/src/matching
bun run server.ts
```

### 4. RPC 限流

**问题**: 大量请求被限流

**解决**: 脚本已内置限流保护
- 买币: 每 5 个钱包暂停 1 秒
- Mint: 每 10 个钱包暂停 2 秒
- 订单: 每个订单间隔 200ms

### 5. Gas 费用不足

**问题**: 交易失败，gas 不足

**解决**: 给主钱包/派生钱包充值更多 ETH

## 测试代币信息

- **代币地址**: 0x13Bb1Ff472FBd7831b676d5b4040CC2aEAFc12cd
- **网络**: Base Sepolia (Chain ID: 84532)
- **TokenFactory**: 0x2884d5BD8a846c5Cc3247Dbb03dfC3C8Ca8b1444
- **Settlement**: 0x6804fB89076783b4Bb30091b7514Ddb2d502c037
- **USDT**: 0x83214D0a99EB664c3559D1619Ef9B5f78A655C4e

## 日志分析

查看问题日志：
```bash
cat /Users/qinlinqiu/Desktop/meme-perp-dex/backend/src/matching/market-making-problems.log
```

日志包含：
- 时间戳
- 问题描述
- 失败的钱包地址/订单信息
- 错误原因

## 停止测试

### 正常停止
- 脚本运行 5 分钟后自动停止

### 手动停止
```bash
Ctrl + C
```
脚本会捕获信号，保存问题日志后退出

## 技术细节

### EIP-712 订单签名
- Domain: MemePerp v1
- Chain ID: 84532
- Verifying Contract: Settlement 地址
- Order Type: LIMIT (限价单)

### 订单参数
- Size: 1e18 精度 (代币数量)
- Price: 1e12 精度 (USD 价格)
- Leverage: 基点 (10000 = 1x)
- Deadline: 1 小时有效期

### Nonce 管理
- 每个钱包独立 nonce
- 本地缓存，避免频繁查询
- 提交成功后自动递增

## 预期结果

成功运行后，你应该看到：

1. ✅ 200 个主钱包生成
2. ✅ 100 个派生钱包创建
3. ✅ 部分主钱包成功买入现货代币 (取决于 ETH 余额)
4. ✅ 100 个派生钱包充值 10,000 USDT
5. ✅ 每 5 秒提交 10 个订单到撮合引擎
6. ✅ 前端显示实时 K线、订单簿、成交记录
7. ✅ 所有问题记录到日志文件

## 下一步

测试完成后，可以：
1. 分析 `market-making-problems.log` 找出系统瓶颈
2. 调整做市参数（价差、订单数量、更新频率）
3. 扩展到更多代币对
4. 实现更复杂的做市策略（网格交易、套利等）
