/**
 * 订单管理模块
 *
 * 功能:
 * 1. 订单提交
 * 2. 订单取消
 * 3. 订单查询
 * 4. 订单状态更新
 */

import { type Address } from "viem";
import { OrderRepo, BalanceRepo } from "../database/redis";
import { logger } from "../utils/logger";
import type { Order, OrderStatus } from "../types";

// ============================================================
// Order Submission
// ============================================================

// SubmitOrderParams interface kept for type reference
// Order submission is handled directly in server.ts handleOrderSubmit function
export interface SubmitOrderParams {
  trader: Address;
  token: Address;
  isLong: boolean;
  size: bigint;
  price: bigint;
  leverage: bigint;
  orderType: string;
  timeInForce?: string;
  reduceOnly?: boolean;
  postOnly?: boolean;
  takeProfitPrice?: bigint;
  stopLossPrice?: bigint;
  triggerPrice?: bigint;
  deadline: bigint;
  nonce: bigint;
  signature: string;
  source?: string;
  clientOrderId?: string;
}

// submitOrder function has been removed - use engine.submitOrder() in server.ts instead
// This function was duplicating the logic in server.ts:handleOrderSubmit()

/**
 * 取消订单
 */
export async function cancelOrder(orderId: string, trader: Address): Promise<Order> {
  const order = await OrderRepo.get(orderId);
  if (!order) {
    throw new Error("Order not found");
  }

  if (order.trader.toLowerCase() !== trader.toLowerCase()) {
    throw new Error("Not authorized");
  }

  if (order.status !== 0 && order.status !== 1) { // PENDING or PARTIALLY_FILLED
    throw new Error("Order cannot be cancelled");
  }

  // 计算未成交部分的保证金和手续费
  const unfilledSize = order.size - order.filledSize;
  const unfilledMargin = (order.margin * unfilledSize) / order.size;
  const unfilledFee = (order.fee * unfilledSize) / order.size;
  const toRefund = unfilledMargin + unfilledFee;

  // 退还冻结余额
  if (!order.reduceOnly && toRefund > 0n) {
    await BalanceRepo.unfreezeMargin(trader, toRefund);
  }

  // 更新订单状态
  const updatedOrder = await OrderRepo.update(orderId, { status: 3 }); // CANCELLED
  if (!updatedOrder) {
    throw new Error("Failed to update order");
  }

  // 从触发列表移除
  await OrderRepo.removeFromTrigger(order);

  logger.info("Order", `Order cancelled: ${orderId}`);
  return updatedOrder;
}

/**
 * 查询订单
 */
export async function getOrder(orderId: string): Promise<Order | null> {
  return OrderRepo.get(orderId);
}

/**
 * 查询用户订单
 */
export async function getUserOrders(
  trader: Address,
  status?: OrderStatus
): Promise<Order[]> {
  return OrderRepo.getByUser(trader, status);
}

/**
 * 查询代币待处理订单
 */
export async function getPendingOrders(token: Address): Promise<Order[]> {
  return OrderRepo.getPendingByToken(token);
}

/**
 * 更新订单成交
 */
export async function updateOrderFill(
  orderId: string,
  fillSize: bigint,
  fillPrice: bigint
): Promise<Order | null> {
  const order = await OrderRepo.get(orderId);
  if (!order) return null;

  const newFilledSize = order.filledSize + fillSize;
  const totalValue = order.totalFillValue + fillSize * fillPrice;
  const avgPrice = totalValue / newFilledSize;

  const updates: Partial<Order> = {
    filledSize: newFilledSize,
    avgFillPrice: avgPrice,
    totalFillValue: totalValue,
    lastFillTime: Date.now(),
  };

  // 更新状态
  if (newFilledSize >= order.size) {
    updates.status = 2; // FILLED
  } else if (newFilledSize > 0n) {
    updates.status = 1; // PARTIALLY_FILLED
  }

  return OrderRepo.update(orderId, updates);
}

// ============================================================
// Validation
// ============================================================

// validateOrderParams and verifyOrderSignature have been removed
// These functions were only used by the deleted submitOrder function
// Server.ts has its own implementation of these validations

export default {
  cancelOrder,
  getOrder,
  getUserOrders,
  getPendingOrders,
  updateOrderFill,
};
