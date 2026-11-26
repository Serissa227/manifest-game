// 从交易所外面请它切到某一页（新手教程的“买货”“账台”两步要看买入页：船上有货时交易所默认打开卖出页）。
// 请求只用一次：交易所照办后清掉，以后再打开交易所照常按“有货先卖”选页。
import { create } from "zustand";
import type { Side } from "./trade";

interface MarketUi {
  /** 请交易所切到哪一页；没有请求时为 null */
  side: Side | null;
  /** 每次请求加一（交易所已经开着时靠它知道有新请求） */
  nonce: number;
}

export const useMarketUi = create<MarketUi>(() => ({ side: null, nonce: 0 }));

/** 请交易所切到某一页（交易所开着就马上切，没开着就在下次打开时切）。 */
export function showMarketSide(side: Side): void {
  useMarketUi.setState((s) => ({ side, nonce: s.nonce + 1 }));
}

/** 交易所照办之后取走请求。 */
export function takeMarketSide(): Side | null {
  const side = useMarketUi.getState().side;
  if (side) useMarketUi.setState({ side: null });
  return side;
}
