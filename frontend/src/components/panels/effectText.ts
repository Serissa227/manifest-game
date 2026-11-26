// 组合事件效果的格式化：情报窗口的“大事记”卡片与殖民地窗口的“事件影响”共用。
// 一条效果写成“对象 · 方向与幅度 · 持续”（各部分之间用 pnCeSep 分隔），文字都在 zh-CN.panels.ts 的 pnCe* 键里。
import { pct, t } from "../../i18n";
import type { EffectView } from "../../ipc/types";
import { tz } from "../../i18n/zhOnly";

/** 作用于殖民地的效果（对象写成“殖民地（殖民点）”，产量效果另写建筑）。 */
const COLONY_EFFECTS: ReadonlySet<string> = new Set(["colony_output", "colony_morale", "colony_growth"]);

/** 是否是殖民地效果：按 key 判断，旧词表之外的新效果按字段判断（带殖民地名或建筑）。 */
export function isColonyEffect(e: EffectView): boolean {
  return COLONY_EFFECTS.has(e.effect) || !!e.colony || !!e.building || e.all_buildings === true;
}

/** 带符号的数值：正数加“+”，负数用减号“−”。 */
function signed(v: number): { sign: string; abs: number } {
  return { sign: v < 0 ? t("pnCeMinus") : t("pnCePlus"), abs: Math.abs(v) };
}

export interface EffectTextOptions {
  /** 省略殖民地本身（殖民地窗口里列本殖民地的效果时用） */
  omitColony?: boolean;
}

/**
 * 效果的对象（可能有几段）：
 * - 殖民地效果：“殖民地（殖民点）”（殖民地已不存在时只写殖民点），产量效果再加建筑名或“全部建筑”；
 * - 占领殖民点：“殖民点 → 势力”；
 * - 发现物传闻：“「发现物」据传在某海区一带”；
 * - 其余：地点、商品、海区，两个势力写“甲 ↔ 乙”。
 * 都没有时返回空数组（调用方决定是否写“各地”）。
 */
export function effectTargets(e: EffectView, opts: EffectTextOptions = {}): string[] {
  const who: string[] = [];
  if (e.effect === "site_claim") {
    const site = e.loc ?? "";
    who.push(e.faction_a ? t("pnCeClaim", { site, faction: e.faction_a }) : site);
    return who.filter((x) => x !== "");
  }
  if (e.effect === "discovery_rumor" || e.discovery) {
    const discovery = e.discovery ?? "";
    if (discovery) who.push(e.region ? t("pnCeRumor", { discovery, region: e.region }) : t("pnCeRumorNoRegion", { discovery }));
    else if (e.region) who.push(e.region);
    return who;
  }
  if (isColonyEffect(e)) {
    if (!opts.omitColony) {
      if (e.colony && e.loc) who.push(t("pnCeColony", { colony: e.colony, site: e.loc }));
      else if (e.colony || e.loc) who.push((e.colony ?? e.loc) as string);
    }
    if (e.building) who.push(e.building);
    else if (e.all_buildings) who.push(t("pnCeAllBuildings"));
    return who;
  }
  for (const x of [e.loc, e.good, e.region]) if (x) who.push(x);
  if (e.faction_a && e.faction_b) who.push(t("pnCePair", { a: e.faction_a, b: e.faction_b }));
  else if (e.faction_a) who.push(e.faction_a);
  return who;
}

/** 方向与幅度：系数类为“提示 ±百分比”（mult_bp 为万分之一，10000 表示不变），变化量类为“提示 ±变化量”，其余只写提示。 */
export function effectMagnitude(e: EffectView): string | null {
  if (e.mult_bp !== null && e.mult_bp !== undefined) {
    const { sign, abs } = signed(e.mult_bp - 10000);
    return t("pnCeMult", { hint: e.hint, sign, pct: pct(abs) });
  }
  if (e.delta !== null && e.delta !== undefined) {
    const { sign, abs } = signed(e.delta);
    // E02：“港口发展”的变化量是档（一档约为现有发展度的 5%，至少 1 点），不是点
    if (e.effect === "development") return tz("dev.effectDelta", { hint: e.hint, sign, v: abs });
    return t("pnCeDelta", { hint: e.hint, sign, v: abs });
  }
  return e.hint ? e.hint : null;
}

/**
 * 一条效果格式化为“对象 · 方向与幅度 · 持续”：
 * 对象见 effectTargets（都没有时写“各地”；省略殖民地时不写）；持续为“持续 N 天”，一次性效果为“一次性”。
 */
export function effectText(e: EffectView, opts: EffectTextOptions = {}): string {
  const parts: string[] = [];
  const who = effectTargets(e, opts);
  if (who.length > 0) parts.push(who.join(t("pnCeSep")));
  else if (!opts.omitColony) parts.push(t("pnCeWorld"));
  const size = effectMagnitude(e);
  if (size) parts.push(size);
  parts.push(e.days ? t("pnCeDays", { days: e.days }) : t("pnCeOnce"));
  return parts.join(t("pnCeSep"));
}
