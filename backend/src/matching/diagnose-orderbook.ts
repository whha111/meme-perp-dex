/**
 * 诊断订单簿问题
 */

const API_URL = "http://localhost:8081";
const TOKEN = "0x01eA557E2B17f65604568791Edda8dE1Ae702BE8";

async function diagnose() {
  console.log("=== 订单簿诊断 ===\n");

  // 1. 检查健康状态
  console.log("1. 服务健康检查:");
  const health = await fetch(`${API_URL}/health`).then(r => r.json());
  console.log(`   状态: ${health.status || health.success ? "✅" : "❌"}`);
  console.log("");

  // 2. 检查订单簿
  console.log("2. 订单簿状态:");
  const orderbook = await fetch(`${API_URL}/api/orderbook/${TOKEN}`).then(r => r.json());
  console.log(`   买单: ${orderbook.data?.bids?.length || 0}`);
  console.log(`   卖单: ${orderbook.data?.asks?.length || 0}`);
  console.log("");

  // 3. 检查挂单
  console.log("3. 挂单列表:");
  const pending = await fetch(`${API_URL}/api/orders/pending`).then(r => r.json());
  console.log(`   挂单数量: ${pending.data?.length || 0}`);
  console.log("");

  // 4. 检查所有订单
  console.log("4. 所有订单:");
  const allOrders = await fetch(`${API_URL}/api/orders?limit=10`).then(r => r.json());
  console.log(`   总订单数: ${allOrders.data?.length || 0}`);
  if (allOrders.data && allOrders.data.length > 0) {
    console.log(`   最近订单:`);
    allOrders.data.slice(0, 3).forEach((o: any) => {
      console.log(`   - ${o.orderId}: ${o.status} (${o.isLong ? "LONG" : "SHORT"})`);
    });
  }
  console.log("");

  // 5. 检查成交
  console.log("5. 成交记录:");
  const trades = await fetch(`${API_URL}/api/trades/${TOKEN}?limit=10`).then(r => r.json());
  console.log(`   成交数量: ${trades.trades?.length || trades.data?.length || 0}`);
  console.log("");

  // 6. 检查某个钱包的订单
  const testWallet = "0x89D99FbcA2684d03124ecB80fe6c8a253048C976";
  console.log(`6. 钱包订单 (${testWallet.slice(0, 12)}...):`);
  const userOrders = await fetch(`${API_URL}/api/user/${testWallet}/orders?limit=10`).then(r => r.json());
  console.log(`   订单数量: ${userOrders.data?.length || 0}`);
  if (userOrders.data && userOrders.data.length > 0) {
    console.log(`   订单状态:`);
    userOrders.data.slice(0, 3).forEach((o: any) => {
      console.log(`   - ${o.status} @ $${(Number(o.price) / 1e12).toFixed(8)}`);
    });
  }
  console.log("");

  console.log("=== 诊断完成 ===");
}

diagnose().catch(console.error);
