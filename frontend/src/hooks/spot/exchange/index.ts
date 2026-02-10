/**
 * Exchange Hooks (Mock 版本)
 *
 * 导出所有 DEX 相关的 Hooks
 * TODO: 对接真实合约后更新
 */

export {
  useUniswapV2Quote,
  useTokenBalance,
  type QuoteParams,
  type QuoteResult,
} from "./useUniswapV2Quote";

export {
  useUniswapV2Swap,
  useTokenAllowance,
  SwapStatus,
  type SwapParams,
  type UseUniswapV2SwapResult,
} from "./useUniswapV2Swap";

export {
  useUserOrders,
  usePairOrders,
  useOrderExecutable,
  useCreateLimitOrder,
  useCancelOrder,
  useExecuteOrder,
  OrderType,
  OrderStatus,
  type LimitOrder,
} from "./useLimitOrder";

export {
  useUniswapV2Liquidity,
  usePairAddress,
  useLPBalance,
  usePairReserves,
  usePairTotalSupply,
  LiquidityStatus,
  type AddLiquidityETHParams,
  type RemoveLiquidityETHParams,
  type UseUniswapV2LiquidityResult,
} from "./useUniswapV2Liquidity";
