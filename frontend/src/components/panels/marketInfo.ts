// 行情的参照信息（交易所与行情窗口共用）：远方行情的时效与来源（docs/ECONOMY.md 第 7 节）、库存档位、钱袋状态，
// 以及交易所每一行里的“比基准价贵还是便宜”“近来是涨是跌”。
import { t, tk } from "../../i18n";
import type { SeenView } from "../../ipc/types";

/** 行情的时效与来源，例如“3 天前 · 随船消息”。 */
export function seenLabel(s: SeenView): string {
  const source = tk(`info.src.${s.source}`);
  return s.age <= 0 ? t("info.seenToday", { source }) : t("info.seen", { age: s.age, source });
}

/** 库存档位：按库存 / 目标库存分五档（0 紧缺、1 偏少、2 正常、3 偏多、4 充足）。 */
export function stockBand(stock: number, target: number): number {
  const r = stock / Math.max(1, target);
  if (r < 0.5) return 0;
  if (r < 0.85) return 1;
  if (r <= 1.15) return 2;
  if (r <= 1.6) return 3;
  return 4;
}

/** 流动性系数（万分之一）对应的钱袋状态：不到 0.97 吃紧、超过 1.03 充裕（ECONOMY.md 6.9）。 */
export function purseState(bp: number): "tight" | "flush" | "normal" {
  return bp <= 9_700 ? "tight" : bp >= 10_300 ? "flush" : "normal";
}

/** 现价相对基准价的涨跌（百分数，保留一位小数）：正数是比平常贵。基准价为 0 时为 0。 */
export function vsBase(price: number, base: number): number {
  return base > 0 ? Math.round(((price - base) * 1000) / base) / 10 : 0;
}

/** 比例（万分之一，10000 = 一样）换成涨跌的百分数（保留一位小数）：12000 → 20，9000 → −10。 */
export function bpPct(bp: number): number {
  return Math.round((bp - 10_000) / 10) / 10;
}

/** 近来的走势：价格序列（最早的在前）首尾相比的涨跌（百分数，保留一位小数）；不足两天时为 0。 */
export function trendPct(history: readonly number[]): number {
  if (history.length < 2) return 0;
  const first = history[0];
  const last = history[history.length - 1];
  return first > 0 ? Math.round(((last - first) * 1000) / first) / 10 : 0;
}

/** 与昨天相比的方向：1 涨、-1 跌、0 平（只有一天时与基准价比）。 */
export function dayMove(history: readonly number[], price: number, base: number): 1 | -1 | 0 {
  const prev = history.length >= 2 ? history[history.length - 2] : base;
  return price > prev ? 1 : price < prev ? -1 : 0;
}
