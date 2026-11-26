// 开局向导的纯逻辑（docs/ECONOMY.md 第 5 节）：步骤、生日与星座、年龄、身世加点、自由分配、奇才之法、开局效果与提交的命令。
// 属性的计算与内核 manifest_core::captain（sign_of、background_attrs、allocated_attrs、check_create）逐条一致：界面据此禁用超分、越界的操作，
// 提交的命令总能通过内核校验。随机只影响界面的默认值与“随机”按钮，取值由“第几次随机”确定性地算出（测试可复现）。
//
// 属性组（UI-CONTRACT I2）：第九批的世界把属性分成几组（资质、本领、品行……），每组有自己的起点、取值范围、
// 自由分配的点数与开局上限；alloc 按世界属性表的顺序（含隐藏属性，隐藏的不分点）。经典世界与旧后端只有一组，
// 由 [points] 换算（attrGroups），算出来的每个数都与原来的六项算法相同。
import { Rng } from "../../art/rng";
import { GENIUS_METHODS } from "../../forecast/methods";
import { monthLengths } from "../../i18n";
import type {
  AttributeGroupView,
  AttributeKey,
  CaptainCreation,
  CaptainDefsView,
  CaptainEffectView,
  CaptainOptionView,
  CaptainProfileView,
  CaptainSignView,
  HeroView,
  StaticView,
} from "../../ipc/types";

/** 经典世界的六项属性（顺序即命令里 alloc 的顺序，与内核 ATTRIBUTES 一致）。 */
export const ATTRIBUTE_KEYS: readonly AttributeKey[] = ["seamanship", "commerce", "arms", "stewardship", "numeracy", "eloquence"];
/** 经典世界里算学的下标；第九批的世界按 key 找（numeracyIndex）。 */
export const NUMERACY = 4;
/** 航海历每月 30 天。 */
export const DAYS_PER_MONTH = 30;
/** 一年 360 天。 */
export const DAYS_PER_YEAR = DAYS_PER_MONTH * 12;

/** 世界日历的月数（经典世界 12；第九批的世界按 StaticView.world.calendar，见 i18n 的 setWorld）。 */
export function monthCount(): number {
  return monthLengths().length;
}

/** 世界日历第 month 月的天数（经典世界每月 30 天；月份不存在时为 0）。生日的“日”只能在这之内（内核按世界日历校验）。 */
export function birthdayDays(month: number): number {
  return monthLengths()[month - 1] ?? 0;
}
/** 年龄的快捷按钮（只显示允许范围之内的）。 */
export const AGE_PRESETS: readonly number[] = [16, 18, 20, 25, 30, 40];

export type StepKey = "scenario" | "look" | "birthday" | "name" | "background" | "attrs" | "confirm";

/**
 * 向导的步骤：有身世数据时七步；没有（旧数据、旧后端）时只有剧本、外貌、姓名与启航。
 * 选了推荐角色（带主角的剧本）时外貌、生日、姓名、身世与属性都已定好，只剩剧本与启航两步。
 */
export function wizardSteps(defs: CaptainDefsView | null | undefined, hero = false): StepKey[] {
  if (hero && defs) return ["scenario", "confirm"];
  return defs ? ["scenario", "look", "birthday", "name", "background", "attrs", "confirm"] : ["scenario", "look", "name", "confirm"];
}

/** 开局向导里列出的选项：只给某位推荐角色用的选项（hero）不列出。 */
export function wizardOptions(defs: CaptainDefsView, qi: number): CaptainOptionView[] {
  return (defs.questions[qi]?.options ?? []).filter((o) => !o.hero);
}

/** 推荐角色的属性：身世与星座加点、自由分配与最终属性（与内核一致）。 */
export function heroAttrs(defs: CaptainDefsView, hero: HeroView): { bg: number[]; alloc: number[]; attrs: number[] } {
  const bg = backgroundAttrs(defs, hero.answers, hero.month, hero.day);
  const alloc = fitAlloc(defs, bg, hero.alloc);
  return { bg, alloc, attrs: finalAttrs(bg, alloc) };
}

/** 推荐角色的 CreateCaptain 内容（数据加载时已校验，总能通过内核校验）；身世答不全时为空。 */
export function heroCreation(defs: CaptainDefsView, hero: HeroView, startYear: number): CaptainCreation | null {
  if (!answersOk(defs, hero.answers)) return null;
  const { alloc } = heroAttrs(defs, hero);
  return {
    birthday: { year: birthYear(startYear, hero.age), month: hero.month, day: hero.day },
    answers: [...hero.answers],
    alloc,
    genius: hero.genius ?? null,
  };
}

/** 向导里的身世草稿（姓名与外貌另外保存）。answers 按问题顺序，没回答的为 null；alloc 按属性顺序。 */
export interface CaptainDraft {
  month: number;
  day: number;
  age: number;
  answers: (string | null)[];
  alloc: number[];
  /** 自选的奇才之法；算学够时没选则默认第一种 */
  genius: string | null;
}

/** 第 roll 次随机的生日：月、日均匀，年龄在允许范围内均匀。 */
export function rollBirthday(defs: CaptainDefsView, roll: number): Pick<CaptainDraft, "month" | "day" | "age"> {
  const r = new Rng(`birthday-${roll}`);
  const { age_min, age_max } = defs.points;
  const month = 1 + Math.floor(r.next() * monthCount());
  return {
    month,
    day: 1 + Math.floor(r.next() * birthdayDays(month)),
    age: age_min + Math.floor(r.next() * (Math.max(age_min, age_max) - age_min + 1)),
  };
}

/** 把年龄夹进允许的范围（取整）。 */
export function clampAge(defs: CaptainDefsView, age: number): number {
  const { age_min, age_max } = defs.points;
  return Math.min(Math.max(age_min, age_max), Math.max(age_min, Math.round(age)));
}

/** 向导里年龄的缺省值（数据的 age_default，夹进范围）。 */
export function defaultAge(defs: CaptainDefsView): number {
  return clampAge(defs, defs.points.age_default);
}

/** 新的草稿：生日的月与日按 roll 随机，年龄取缺省值（不随机），身世未答，点数未分。 */
export function newDraft(defs: CaptainDefsView, roll: number): CaptainDraft {
  return {
    ...rollBirthday(defs, roll),
    age: defaultAge(defs),
    answers: defs.questions.map(() => null),
    alloc: attrKeys(defs).map(() => 0),
    genius: null,
  };
}

/** 经典六项里的下标（找不到为 −1）。 */
export function attrIndex(key: string): number {
  return (ATTRIBUTE_KEYS as readonly string[]).indexOf(key);
}

// ───────────────────────────── 属性表与属性组 ─────────────────────────────

/** 属性的 key（alloc 的顺序）：世界的属性表；没有身世数据时按经典六项。 */
export function attrKeys(defs: CaptainDefsView): string[] {
  return defs.attributes.length > 0 ? defs.attributes.map((a) => a.key) : [...ATTRIBUTE_KEYS];
}

/** 属性在 alloc 里的下标（找不到为 −1）。 */
export function attrIndexIn(defs: CaptainDefsView, key: string): number {
  return attrKeys(defs).indexOf(key);
}

/** 算学的下标（世界没有算学时为 −1：没有算学奇才）。 */
export function numeracyIndex(defs: CaptainDefsView): number {
  return attrIndexIn(defs, "numeracy");
}

/** 由 [points] 换算出的经典组（经典世界、旧后端；与内核 AttributeGroup::classic 一致，名字留空、界面不显示组名）。 */
export function classicGroup(defs: CaptainDefsView): AttributeGroupView {
  const p = defs.points;
  return { key: "classic", name: "", range: [0, p.max], start: p.base, free: p.free, creation_cap: p.creation_cap };
}

/** 属性组：后端给了用后端的，否则是一个经典组。 */
export function attrGroups(defs: CaptainDefsView): AttributeGroupView[] {
  return defs.groups && defs.groups.length > 0 ? defs.groups : [classicGroup(defs)];
}

/** 第 i 项属性所在的组的下标（属性没写组或组不存在时归第一组，与内核的旧格式一致）。 */
export function groupIndexOf(defs: CaptainDefsView, i: number): number {
  const key = defs.attributes[i]?.group;
  const at = key === undefined ? -1 : attrGroups(defs).findIndex((g) => g.key === key);
  return at < 0 ? 0 : at;
}

/** 第 i 项属性所在的组。 */
export function groupOf(defs: CaptainDefsView, i: number): AttributeGroupView {
  return attrGroups(defs)[groupIndexOf(defs, i)];
}

/** 第 i 项属性是否隐藏（觉醒之前不显示、不分点）。 */
export function isHiddenAttr(defs: CaptainDefsView, i: number): boolean {
  return !!defs.attributes[i]?.hidden;
}

/** 一组属性：组的定义、组的下标与要显示的属性（下标，按属性表顺序；隐藏的不列）。 */
export interface AttrBucket {
  group: AttributeGroupView;
  index: number;
  items: number[];
}

/** 每组要显示的属性；没有可显示属性的组也保留（界面自己决定画不画）。 */
export function groupedAttrs(defs: CaptainDefsView): AttrBucket[] {
  const keys = attrKeys(defs);
  return attrGroups(defs).map((group, gi) => ({
    group,
    index: gi,
    items: keys.map((_, i) => i).filter((i) => groupIndexOf(defs, i) === gi && !isHiddenAttr(defs, i)),
  }));
}

/**
 * 经典的属性版面：只有一组，可显示的正好是经典六项（按原来的顺序）。
 * 这时开局向导与船长卡照原来的样子画（逐 DOM 不变）；否则按组画（组名、各组的点数、雷达图）。
 */
export function isClassicLayout(defs: CaptainDefsView): boolean {
  if (attrGroups(defs).length !== 1) return false;
  const shown = attrKeys(defs).filter((_, i) => !isHiddenAttr(defs, i));
  return shown.length === ATTRIBUTE_KEYS.length && shown.every((k, i) => k === ATTRIBUTE_KEYS[i]);
}

/** 一年里的第几天：1 月 1 日为 0，经典世界的 12 月 30 日为 359（按世界日历的月长累加）。 */
export function dayOfYear(month: number, day: number): number {
  return monthLengths().slice(0, Math.max(0, month - 1)).reduce((a, b) => a + b, 0) + (day - 1);
}

/** 世界日历里有没有这一天。 */
function validDay(month: number, day: number): boolean {
  return month >= 1 && month <= monthCount() && day >= 1 && day <= birthdayDays(month);
}

/** 现行的十二星座（按生日判定的；旧版星宫不算），保持后端给的顺序（白羊座起）。 */
export function zodiacSigns(defs: CaptainDefsView): (CaptainSignView & { start: [number, number] })[] {
  return defs.signs.filter((s): s is CaptainSignView & { start: [number, number] } => !s.legacy && s.start !== null);
}

/**
 * 生日所在的星座（与内核 CaptainDefs::sign_of 一致）：首日不晚于生日的现行星座里首日最晚的一个；
 * 生日早于所有首日（1 月上旬）时是首日最晚的那个——跨年的摩羯座。日子不合法时为空。
 */
export function signOf(defs: CaptainDefsView, month: number, day: number): CaptainSignView | undefined {
  if (!validDay(month, day)) return undefined;
  const at = dayOfYear(month, day);
  let before: { o: number; s: CaptainSignView } | undefined;
  let latest: { o: number; s: CaptainSignView } | undefined;
  for (const s of zodiacSigns(defs)) {
    const o = dayOfYear(s.start[0], s.start[1]);
    if (o <= at && (!before || o >= before.o)) before = { o, s };
    if (!latest || o >= latest.o) latest = { o, s };
  }
  return (before ?? latest)?.s;
}

/** 按 key 找星座（旧存档的旧版星宫也找得到）。 */
export function signByKey(defs: CaptainDefsView, key: string): CaptainSignView | undefined {
  return defs.signs.find((s) => s.key === key);
}

/** 第 qi 道问题的选项 key 对应的选项（不属于这道题时为空）。 */
export function optionOf(defs: CaptainDefsView, qi: number, key: string | null | undefined): CaptainOptionView | undefined {
  if (!key) return undefined;
  return defs.questions[qi]?.options.find((o) => o.key === key);
}

/** 出生年份：开局年份减年龄（与内核一致，年龄 = 开局年份 − 出生年份）。 */
export function birthYear(startYear: number, age: number): number {
  return startYear - age;
}

/**
 * 身世与星座加点之后（自由分配之前）的属性：各组的起点 + 各选项 + 星座，单项夹在组的下限与开局上限之间
 * （与内核 background_attrs 一致；经典组的下限是 0）。
 */
export function backgroundAttrs(defs: CaptainDefsView, answers: readonly (string | null)[], month: number, day: number): number[] {
  const keys = attrKeys(defs);
  const out = keys.map((_, i) => groupOf(defs, i).start);
  answers.forEach((key, qi) => {
    for (const [k, v] of optionOf(defs, qi, key)?.attrs ?? []) {
      const i = keys.indexOf(k);
      if (i >= 0) out[i] += v;
    }
  });
  const sign = signOf(defs, month, day);
  const si = sign ? keys.indexOf(sign.attribute) : -1;
  if (si >= 0) out[si] += 1;
  return out.map((v, i) => {
    const g = groupOf(defs, i);
    return Math.min(Math.max(g.range[0], g.creation_cap), Math.max(g.range[0], v));
  });
}

/** 第 i 项属性开局时最多到几（组的开局上限，不小于 0）。 */
function capOf(defs: CaptainDefsView, i: number): number {
  return Math.max(0, groupOf(defs, i).creation_cap);
}

/** 把自由分配夹进上限：改了身世或生日后，超出开局上限的点数退回待分配；每组合计不超过本组的 free；隐藏属性不分点。 */
export function fitAlloc(defs: CaptainDefsView, bg: readonly number[], alloc: readonly number[]): number[] {
  const left = attrGroups(defs).map((g) => Math.max(0, g.free));
  return attrKeys(defs).map((_, i) => {
    if (isHiddenAttr(defs, i)) return 0;
    const gi = groupIndexOf(defs, i);
    const v = Math.min(left[gi], Math.max(0, Math.min(Math.trunc(alloc[i] ?? 0), capOf(defs, i) - (bg[i] ?? 0))));
    left[gi] -= v;
    return v;
  });
}

export function sum(xs: readonly number[]): number {
  return xs.reduce((a, b) => a + b, 0);
}

/** 尚未分配的点数（各组合计）。 */
export function pointsLeft(defs: CaptainDefsView, alloc: readonly number[]): number {
  return sum(attrGroups(defs).map((g) => g.free)) - sum(alloc);
}

/** 第 gi 组尚未分配的点数。 */
export function groupLeft(defs: CaptainDefsView, alloc: readonly number[], gi: number): number {
  const g = attrGroups(defs)[gi];
  if (!g) return 0;
  return g.free - sum(attrKeys(defs).map((_, i) => (groupIndexOf(defs, i) === gi ? (alloc[i] ?? 0) : 0)));
}

export function canInc(defs: CaptainDefsView, bg: readonly number[], alloc: readonly number[], i: number): boolean {
  return (
    !isHiddenAttr(defs, i) && groupLeft(defs, alloc, groupIndexOf(defs, i)) > 0 && bg[i] + alloc[i] < groupOf(defs, i).creation_cap
  );
}

export function canDec(alloc: readonly number[], i: number): boolean {
  return alloc[i] > 0;
}

/** 第 roll 次随机分配：逐组把本组的 free 点一点一点随机投到本组还有空位的（不隐藏的）属性上。 */
export function rollAlloc(defs: CaptainDefsView, bg: readonly number[], roll: number): number[] {
  const r = new Rng(`alloc-${roll}`);
  const keys = attrKeys(defs);
  const out = keys.map(() => 0);
  attrGroups(defs).forEach((g, gi) => {
    for (let k = 0; k < g.free; k++) {
      const room = keys
        .map((_, i) => i)
        .filter((i) => groupIndexOf(defs, i) === gi && !isHiddenAttr(defs, i) && bg[i] + out[i] < g.creation_cap);
      if (room.length === 0) break;
      out[room[Math.floor(r.next() * room.length)]] += 1;
    }
  });
  return out;
}

/** 第 roll 次随机回答第 qi 道问题：选项多于一个时不与当前相同。 */
export function rollAnswer(defs: CaptainDefsView, qi: number, current: string | null, roll: number): string | null {
  const options = wizardOptions(defs, qi);
  if (options.length === 0) return null;
  const pool = options.length > 1 ? options.filter((o) => o.key !== current) : options;
  const r = new Rng(`answer-${qi}-${roll}`);
  return pool[Math.floor(r.next() * pool.length)].key;
}

/** 最终属性 = 身世与星座 + 自由分配。 */
export function finalAttrs(bg: readonly number[], alloc: readonly number[]): number[] {
  return bg.map((v, i) => v + (alloc[i] ?? 0));
}

/** 开局算学够不够当算学奇才（世界没有算学这一项时不是）。 */
export function isGenius(defs: CaptainDefsView, attrs: readonly number[]): boolean {
  const i = numeracyIndex(defs);
  return i >= 0 && (attrs[i] ?? 0) >= defs.points.genius_numeracy;
}

/** 提交用的奇才之法：算学够时为所选（没选或选了不认识的，默认第一种），不够时为空。 */
export function geniusChoice(defs: CaptainDefsView, attrs: readonly number[], chosen: string | null): string | null {
  if (!isGenius(defs, attrs)) return null;
  return chosen && GENIUS_METHODS.includes(chosen as (typeof GENIUS_METHODS)[number]) ? chosen : GENIUS_METHODS[0];
}

/** 草稿里的生日是否合法（世界日历里有这一天——经典世界月 1–12、日 1–30——年龄在范围内）。 */
export function birthdayOk(defs: CaptainDefsView, d: Pick<CaptainDraft, "month" | "day" | "age">): boolean {
  const { age_min, age_max } = defs.points;
  return validDay(d.month, d.day) && d.age >= age_min && d.age <= age_max;
}

/** 身世是否答完（每道题一个属于这道题的选项）。 */
export function answersOk(defs: CaptainDefsView, answers: readonly (string | null)[]): boolean {
  return defs.questions.length === answers.length && answers.every((a, qi) => optionOf(defs, qi, a) !== undefined);
}

/** 草稿对应的 CreateCaptain 内容；不完整（生日不合法、身世没答完、点数没分完）时为空。 */
export function creationOf(defs: CaptainDefsView, draft: CaptainDraft, startYear: number): CaptainCreation | null {
  if (!birthdayOk(defs, draft) || !answersOk(defs, draft.answers)) return null;
  const bg = backgroundAttrs(defs, draft.answers, draft.month, draft.day);
  const alloc = fitAlloc(defs, bg, draft.alloc);
  if (pointsLeft(defs, alloc) !== 0) return null;
  return {
    birthday: { year: birthYear(startYear, draft.age), month: draft.month, day: draft.day },
    answers: draft.answers.map((a) => a ?? ""),
    alloc,
    genius: geniusChoice(defs, finalAttrs(bg, alloc), draft.genius),
  };
}

/** 身世带来的开局效果（按问题顺序，跳过没有效果或没回答的）。 */
export function startEffects(defs: CaptainDefsView, answers: readonly (string | null)[]): CaptainEffectView[] {
  return answers.flatMap((a, qi) => {
    const e = optionOf(defs, qi, a)?.effect;
    return e ? [e] : [];
  });
}

/**
 * 属性的效果数值（与内核一致，属性 × 10 相当于航海士的 1–100 能力）：
 * 航海 → 旗舰航速 +属性%（上限 10%）；交易 → 交易税 −属性%（上限 10%）；武艺 → 旗舰海战 +属性 × 5%（上限 50%）；
 * 管理 → 工资 −属性%（上限 10%）；口才 → 议价 +0.3% / 点、招募费 −2% / 点；算学 → 同时追踪 3 + 算学 条预测。
 * 世界自己的属性（经典六项以外的 key）没有固定的效果文字，为 null。
 */
export function attributeEffect(key: string, value: number): Record<string, number> | null {
  const v = Math.max(0, value);
  switch (key) {
    case "seamanship":
    case "commerce":
    case "stewardship":
      return { n: Math.min(10, v) };
    case "arms":
      return { n: Math.min(50, v * 5) };
    case "eloquence":
      return { bargain: Number((v * 0.3).toFixed(1)), hire: v * 2 };
    case "numeracy":
      return { n: 3 + v };
    default:
      return null;
  }
}

/**
 * 评价的读数（与内核 check_value 一致）：各项属性（夹进组的取值范围）× 权重之和。
 * 开局向导的船长卡用它预览；游戏里用档案的 profile.ratings。
 */
export function ratingValues(defs: CaptainDefsView, attrs: readonly number[]): [string, number][] {
  const keys = attrKeys(defs);
  return (defs.ratings ?? []).map((r): [string, number] => [
    r.key,
    r.weights.reduce((acc, [k, w]) => {
      const i = keys.indexOf(k);
      if (i < 0) return acc;
      const g = groupOf(defs, i);
      const v = Math.min(Math.max(g.range[0], g.range[1]), Math.max(g.range[0], attrs[i] ?? 0));
      return acc + v * w;
    }, 0),
  ]);
}

/** 主角的算学够不够在行情窗口里手调参数与拟合窗口：没有主角档案（旧存档）或数据没有身世时不受限。 */
export function manualTuning(statics: StaticView | null, profile: CaptainProfileView | null | undefined): { ok: boolean; need: number } {
  const need = statics?.captain?.points.manual_numeracy ?? 0;
  if (!profile || !statics?.captain) return { ok: true, need };
  const numeracy = profile.attrs.find(([k]) => k === "numeracy")?.[1] ?? 0;
  return { ok: numeracy >= need, need };
}
