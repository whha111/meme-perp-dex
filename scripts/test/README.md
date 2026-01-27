# 永续合约测试脚本

## 测试范围

| 编号 | 测试项目 | 文件 | 说明 |
|------|----------|------|------|
| 00 | 环境准备 | 00-setup.ts | 检查配置、授权 Matcher、添加支持代币 |
| 01 | USDT 充值 | 01-deposit.ts | 给测试钱包充 USDT 并存入 Settlement |
| 02 | 市价开仓 | 02-market-open.ts | 测试市价订单撮合开仓 |
| 03 | 限价开仓 | 03-limit-open.ts | 测试限价订单撮合开仓 |
| 04 | 平仓 | 04-close-position.ts | 用户自行平仓、Matcher 批量平仓 |
| 05 | 爆仓清算 | 05-liquidation.ts | 高杠杆仓位清算、清算奖励、保险基金 |
| 06 | 资金费率 | 06-funding-rate.ts | 资金费设置和结算 |
| 07 | 盈利提现 | 07-withdraw.ts | Settlement 余额提现到钱包 |
| 08 | 精度测试 | 08-precision.ts | 订单面值、价格、杠杆精度 |
| 09 | 状态检查 | 09-status-check.ts | 查看所有仓位、余额、系统状态 |

## 快速开始

```bash
cd /Users/qinlinqiu/Desktop/meme-perp-dex/scripts

# 安装依赖
npm install

# 运行单个测试
npm run test:setup     # 环境准备
npm run test:deposit   # USDT 充值
npm run test:market-open  # 市价开仓
# ... 以此类推

# 运行所有测试
npm run test:all

# 查看系统状态
npm run test:status
```

## 测试钱包

测试使用 200 个预置钱包，位于:
```
/Users/qinlinqiu/Desktop/Namespace/scripts/market-maker/wallets.json
```

当前状态:
- 每个钱包约 0.089 ETH（用于 gas）
- 总 ETH: ~17.84 ETH

## 合约地址

| 合约 | 地址 |
|------|------|
| Settlement V4 | 0x8dd0De655628c0E8255e3d6c38c3DF2BE36e4D8d |
| USDT | 0x223095F2c63DB913Baa46FdC2f401E65cB8799F4 |
| TokenFactory | 0xE0ddf67E89f5773c960Bc2329109815E8c66BAAe |

## 测试顺序

**推荐按以下顺序执行:**

1. `00-setup.ts` - 检查并配置环境
2. `01-deposit.ts` - 充值 USDT
3. `02-market-open.ts` - 市价开仓
4. `03-limit-open.ts` - 限价开仓
5. `04-close-position.ts` - 平仓
6. `05-liquidation.ts` - 清算测试
7. `06-funding-rate.ts` - 资金费测试
8. `07-withdraw.ts` - 提现测试
9. `08-precision.ts` - 精度测试
10. `09-status-check.ts` - 查看最终状态

## 注意事项

1. **资金费间隔**: 当前合约设置为 8 小时，需要改为 5 分钟需重新部署
2. **USDT 来源**: 如果 USDT 不足，脚本会尝试 mint（仅测试代币支持）
3. **清算测试**: 会创建高杠杆仓位并模拟价格波动触发清算

## 测试报告

运行 `npm run test:all` 后会生成:
- 控制台输出: 实时测试结果
- `test/test-report.json`: 详细测试报告

## 遇到问题

1. **余额不足**: 先运行 `01-deposit.ts`
2. **Matcher 未授权**: 运行 `00-setup.ts` 会自动授权
3. **USDT 未支持**: 运行 `00-setup.ts` 会自动添加
