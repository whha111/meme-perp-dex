// LimitOrderBook contract configuration
export const LIMIT_ORDER_BOOK_ADDRESS = "0xD307b7624B869CEde087Ac82f59251CdCa3764BD" as const;

export const LIMIT_ORDER_BOOK_ABI = [
  // Read functions
  {
    inputs: [{ name: "orderId", type: "uint256" }],
    name: "getOrder",
    outputs: [
      {
        components: [
          { name: "id", type: "uint256" },
          { name: "maker", type: "address" },
          { name: "orderType", type: "uint8" },
          { name: "tokenIn", type: "address" },
          { name: "tokenOut", type: "address" },
          { name: "amountIn", type: "uint256" },
          { name: "amountOutMin", type: "uint256" },
          { name: "deadline", type: "uint256" },
          { name: "status", type: "uint8" },
          { name: "createdAt", type: "uint256" },
          { name: "filledAt", type: "uint256" },
          { name: "filledAmount", type: "uint256" },
        ],
        name: "",
        type: "tuple",
      },
    ],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [{ name: "user", type: "address" }],
    name: "getUserOrders",
    outputs: [{ name: "", type: "uint256[]" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [{ name: "orderIds", type: "uint256[]" }],
    name: "getOrders",
    outputs: [
      {
        components: [
          { name: "id", type: "uint256" },
          { name: "maker", type: "address" },
          { name: "orderType", type: "uint8" },
          { name: "tokenIn", type: "address" },
          { name: "tokenOut", type: "address" },
          { name: "amountIn", type: "uint256" },
          { name: "amountOutMin", type: "uint256" },
          { name: "deadline", type: "uint256" },
          { name: "status", type: "uint8" },
          { name: "createdAt", type: "uint256" },
          { name: "filledAt", type: "uint256" },
          { name: "filledAmount", type: "uint256" },
        ],
        name: "",
        type: "tuple[]",
      },
    ],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [{ name: "orderId", type: "uint256" }],
    name: "isOrderExecutable",
    outputs: [
      { name: "executable", type: "bool" },
      { name: "expectedOut", type: "uint256" },
    ],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [{ name: "orderId", type: "uint256" }],
    name: "getOrderLimitPrice",
    outputs: [{ name: "price", type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [
      { name: "tokenIn", type: "address" },
      { name: "tokenOut", type: "address" },
    ],
    name: "getPairOrders",
    outputs: [{ name: "", type: "uint256[]" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [],
    name: "nextOrderId",
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [],
    name: "executionFeeBps",
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
  // Write functions
  {
    inputs: [
      { name: "orderType", type: "uint8" },
      { name: "tokenIn", type: "address" },
      { name: "tokenOut", type: "address" },
      { name: "amountIn", type: "uint256" },
      { name: "amountOutMin", type: "uint256" },
      { name: "deadline", type: "uint256" },
    ],
    name: "createOrder",
    outputs: [{ name: "orderId", type: "uint256" }],
    stateMutability: "payable",
    type: "function",
  },
  {
    inputs: [{ name: "orderId", type: "uint256" }],
    name: "executeOrder",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [{ name: "orderId", type: "uint256" }],
    name: "cancelOrder",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
  // Events
  {
    anonymous: false,
    inputs: [
      { indexed: true, name: "orderId", type: "uint256" },
      { indexed: true, name: "maker", type: "address" },
      { indexed: false, name: "orderType", type: "uint8" },
      { indexed: false, name: "tokenIn", type: "address" },
      { indexed: false, name: "tokenOut", type: "address" },
      { indexed: false, name: "amountIn", type: "uint256" },
      { indexed: false, name: "amountOutMin", type: "uint256" },
      { indexed: false, name: "deadline", type: "uint256" },
    ],
    name: "OrderCreated",
    type: "event",
  },
  {
    anonymous: false,
    inputs: [
      { indexed: true, name: "orderId", type: "uint256" },
      { indexed: true, name: "maker", type: "address" },
      { indexed: true, name: "executor", type: "address" },
      { indexed: false, name: "amountIn", type: "uint256" },
      { indexed: false, name: "amountOut", type: "uint256" },
      { indexed: false, name: "fee", type: "uint256" },
    ],
    name: "OrderExecuted",
    type: "event",
  },
  {
    anonymous: false,
    inputs: [
      { indexed: true, name: "orderId", type: "uint256" },
      { indexed: true, name: "maker", type: "address" },
    ],
    name: "OrderCancelled",
    type: "event",
  },
  {
    anonymous: false,
    inputs: [{ indexed: true, name: "orderId", type: "uint256" }],
    name: "OrderExpired",
    type: "event",
  },
] as const;

// Order status enum
export enum OrderStatus {
  Active = 0,
  Filled = 1,
  Cancelled = 2,
  Expired = 3,
}

// Order type enum
export enum OrderType {
  Buy = 0,
  Sell = 1,
}

// Order structure
export interface LimitOrder {
  id: bigint;
  maker: string;
  orderType: OrderType;
  tokenIn: string;
  tokenOut: string;
  amountIn: bigint;
  amountOutMin: bigint;
  deadline: bigint;
  status: OrderStatus;
  createdAt: bigint;
  filledAt: bigint;
  filledAmount: bigint;
}

// Helper to get status label
export function getOrderStatusLabel(status: OrderStatus): string {
  switch (status) {
    case OrderStatus.Active:
      return "Active";
    case OrderStatus.Filled:
      return "Filled";
    case OrderStatus.Cancelled:
      return "Cancelled";
    case OrderStatus.Expired:
      return "Expired";
    default:
      return "Unknown";
  }
}

// Helper to get status color
export function getOrderStatusColor(status: OrderStatus): string {
  switch (status) {
    case OrderStatus.Active:
      return "text-yellow-500";
    case OrderStatus.Filled:
      return "text-okx-up";
    case OrderStatus.Cancelled:
      return "text-okx-text-tertiary";
    case OrderStatus.Expired:
      return "text-okx-down";
    default:
      return "text-okx-text-secondary";
  }
}
