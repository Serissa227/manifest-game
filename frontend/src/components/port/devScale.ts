// E02 港口发展度（1–9999）的界面算法：阶段名、本阶段进度、增长构成、投一笔钱涨几点。
// 数字全部来自内核视图 InvestView.growth（views.rs `DevGrowthView`）；这里只排版，外加一条与内核同式的预览：
// “投 N 金币涨几点”照 manifest-core `development::purchase` 逐点买（每点 coef × √现值，向下取整；不够一点的折成零头），
// coef 从视图给的“现在一点的价钱”反推（point_cost = ⌊coef × ⌊√(d × 10⁸)⌋ ÷ 10⁴⌋，反推是精确的）。后端没有任意金额的预览接口。
// growth 缺省（规则关着的世界、旧后端）时一律回到旧样子：只写数字。
import { useEffect } from "react";
import type { DevGrowthView, DevMonthView, YardStepView } from "../../ipc/types";
import { decimal, num } from "../../i18n";
import { tz, type ZhOnlyKey } from "../../i18n/zhOnly";
import { useGame } from "../../store/game";

/** 万分之一。 */
const BP = 10_000;

/**
 * 阶段的分界（寰宇 `rules.toml [development] stages`）：序号 = 不大于发展度的分界个数。
 * 视图只给“现在”这一阶段的上下界；船厂台阶、升阶提示要给别的发展度起名，所以界面留一份同样的表（改规则时一起改）。
 */
export const STAGE_BOUNDS = [30, 100, 300, 1000, 3000, 9999] as const;

/** 阶段的名字（序号 0–6）。 */
export function stageName(stage: number): string {
  return tz(`dev.stage.${Math.max(0, Math.min(6, stage))}` as ZhOnlyKey);
}

/** 阶段的一句场面话（序号 0–6）。 */
export function stageScene(stage: number): string {
  return tz(`dev.scene.${Math.max(0, Math.min(6, stage))}` as ZhOnlyKey);
}

/** 阶段名 + 数值，例如“小港 52”（港口窗口标题下、投资页的“发展度”一行）。 */
export function devLabel(g: DevGrowthView): string {
  return tz("dev.label", { stage: stageName(g.stage), dev: num(g.value) });
}

/** 某个发展度落在第几阶段（用界面那份分界表）。 */
export function stageOf(value: number): number {
  return STAGE_BOUNDS.filter((b) => b <= value).length;
}

/** 本阶段内走了多少（0–1）；最高阶段为 1。 */
export function stageProgress(g: DevGrowthView): number {
  if (g.stage_to == null) return 1;
  const span = g.stage_to - g.stage_from;
  if (span <= 0) return 1;
  const done = g.value - g.stage_from + g.frac_bp / BP;
  return Math.max(0, Math.min(1, done / span));
}

/** 万分之一点写成带正负号、最多两位小数的点数（“+1.27”“−0.3”“0”）。 */
export function pointsText(bp: number): string {
  const v = Math.round(bp / 100) / 100;
  if (v === 0) return "0";
  return `${v > 0 ? "+" : "−"}${decimal(Math.abs(v))}`;
}

/** 万分之一写成最多两位小数的倍数（“1.4”）。 */
export function timesText(bp: number): string {
  return decimal(Math.round(bp / 100) / 100);
}

/** 上个月增长构成的六项（“合计”另写）：键、数值（万分之一点，回落记为负）。 */
export type GrowthPart = "busy" | "specialty" | "invest" | "works" | "events" | "decay";

export const GROWTH_PARTS: readonly GrowthPart[] = ["busy", "specialty", "invest", "works", "events", "decay"];

/** 构成的一项（回落翻成负数，好画成往左的条）。 */
export function partValue(m: DevMonthView, part: GrowthPart): number {
  return part === "decay" ? -m.decay : m[part];
}

// ───────────── 与内核同式的逐点买入（manifest-core development::purchase / point_cost） ─────────────

/** 向下取整的整数平方根（与 fixed.rs `isqrt` 同）。 */
export function isqrt(v: number): number {
  if (v <= 0) return 0;
  let r = Math.floor(Math.sqrt(v));
  while (r * r > v) r -= 1;
  while ((r + 1) * (r + 1) <= v) r += 1;
  return r;
}

function rootBp(dev: number, max: number): number {
  return isqrt(Math.max(1, Math.min(max, dev)) * 100_000_000);
}

/** 从视图的“现在一点的价钱”反推每点系数 coef（向上取整的整除正好还原）。 */
export function investCoef(g: DevGrowthView): number {
  const s = rootBp(g.value, g.max);
  return Math.max(1, Math.floor((g.point_cost * BP + s - 1) / s));
}

/** 发展度 dev 时一整点的价钱。 */
export function pointCostAt(coef: number, dev: number, max: number): number {
  return Math.max(1, Math.floor((coef * rootBp(dev, max)) / BP));
}

export interface InvestPreview {
  /** 投完的发展度与零头（万分之一点） */
  value: number;
  frac_bp: number;
  /** 涨了几个整点 */
  gain: number;
}

/** 投 amount 金币后的发展度（与内核逐点买入同式；到上限停，多出的钱照旧记进累计投资）。 */
export function previewInvest(g: DevGrowthView, amount: number): InvestPreview {
  const coef = investCoef(g);
  let dev = Math.max(1, Math.min(g.max, g.value));
  let frac = Math.max(0, Math.min(BP - 1, g.frac_bp));
  let left = Math.max(0, Math.floor(amount));
  while (dev < g.max && left > 0) {
    const cost = pointCostAt(coef, dev, g.max);
    const need = cost - Math.floor((cost * frac) / BP);
    if (left >= need) {
      left -= need;
      dev += 1;
      frac = 0;
    } else {
      frac += Math.floor((left * BP) / cost);
      break;
    }
  }
  return { value: dev, frac_bp: frac, gain: dev - g.value };
}

/** 从现在投到发展度 target 一共要多少钱（target 不高于现值时为 0）。 */
export function costToReach(g: DevGrowthView, target: number): number {
  const coef = investCoef(g);
  const goal = Math.min(g.max, target);
  let dev = Math.max(1, g.value);
  let frac = Math.max(0, Math.min(BP - 1, g.frac_bp));
  let total = 0;
  while (dev < goal) {
    const cost = pointCostAt(coef, dev, g.max);
    total += cost - Math.floor((cost * frac) / BP);
    frac = 0;
    dev += 1;
  }
  return total;
}

/** 船厂还没到的第一道台阶（都到了或没有船厂时为空）。 */
export function nextYardStep(steps: readonly YardStepView[] | undefined): YardStepView | null {
  return (steps ?? []).find((s) => !s.reached) ?? null;
}

/** 这一局里各港最近见到的阶段（港口窗口刷新时比对；只在内存里，读档后重新记）。 */
const seenStage = new Map<number, number>();

/**
 * 港口升了一个阶段时提示一句：港口窗口开着、视图刷新（投资之后、月初结算之后）发现阶段比上回见到的高，就 notify。
 * 头一回见到这座港只记下、不提示；阶段往下掉不提示（回落是慢慢的，投资页的构成里看得到）。
 */
export function useStageUpNotice(loc: number | null, portName: string, growth: DevGrowthView | null | undefined): void {
  const stage = growth?.stage ?? null;
  useEffect(() => {
    if (loc === null || stage === null) return;
    const before = seenStage.get(loc);
    seenStage.set(loc, stage);
    if (before !== undefined && stage > before) {
      useGame.getState().notify(tz("dev.stageUp", { port: portName, from: stageName(before), to: stageName(stage) }));
    }
  }, [loc, stage, portName]);
}
