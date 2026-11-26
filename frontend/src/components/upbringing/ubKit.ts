// 养成主画面（docs/UI-CONTRACT.md I6）的纯逻辑：本月日程的草稿（每旬一格或两格）、某格要补选的东西、提交的命令、
// 一个月的预计收益（成长值、疲劳、心情、零用钱）、倒计时与数值条的色调。合法性由后端给（enabled / blocked_reason），这里不重算。
import type { IconName } from "../../art/icons";
import { SCENE_FILES, SCENE_SEASONS, SCENE_WET_MONTHS } from "./sceneAssets";
import type { ActivityView, AfterChoice, CalendarMark, Meter, PlanSlotInput, PlanView, SlotView, UpbringingView } from "../../ipc/types";

/** 一格：第几旬的课业（lesson）还是课后（after；家乡期唯一的一格也叫 after）。 */
export interface Cell {
  index: number;
  part: "lesson" | "after";
}

export const cellId = (c: Cell): string => `${c.index}:${c.part}`;

/** U05：这一局的日程按周排（养成视图的 plan.mode === "week"）。 */
export const isWeekly = (view: Pick<UpbringingView, "plan">): boolean => view.plan.mode === "week";

/**
 * 这一阶段开始了没有（X02）。阶段带入学标记的（澪的家乡期第一段要开场剧情 c9_mio_home_start 设 c9_family_mio），
 * 标记设上之前后端 `upbringing_stage_on` 找不到阶段，视图的 stage 是 null（类型上没写 null，旧代码按总有阶段写的）、
 * 课表一格也没有、活动表是空的。
 */
export const stageStarted = (view: Pick<UpbringingView, "stage">): boolean => (view.stage as string | null | undefined) != null;

/** 按周时这一格还能排（没结算、没落在换阶段之后）。按旬时每格都算。 */
export const openSlot = (s: SlotView): boolean => s.status !== "done" && s.status !== "locked" && !s.locked;

/** 本月的格子：家乡期每旬一格，学院期每旬两格（课业在前）。按周（U05）：本周每格一格，课业格放课、别的格放课业以外的活动。 */
export function cellsOf(view: Pick<UpbringingView, "stage" | "plan">): Cell[] {
  const out: Cell[] = [];
  if (isWeekly(view)) {
    for (const s of view.plan.slots) out.push({ index: s.index, part: s.column === "lesson" ? "lesson" : "after" });
    return out;
  }
  for (const s of view.plan.slots) {
    if (view.stage === "academy") out.push({ index: s.index, part: "lesson" });
    out.push({ index: s.index, part: "after" });
  }
  return out;
}

/** 日程草稿：每格选了什么（课业格只存活动 key；课后格存活动与补选的地点、同伴、书、远足点）。 */
export interface Draft {
  lesson: Record<number, string | null>;
  after: Record<number, AfterChoice | null>;
}

/** 从后端的本月日程起草（已经排过的照旧带上）。按周时本周还没排的格先照常设周课表填上（课表铺不上停下来时，只改出问题的那一格就行）。 */
export function draftOf(plan: PlanView): Draft {
  const d: Draft = { lesson: {}, after: {} };
  for (const s of plan.slots) {
    const table = plan.mode === "week" && !s.lesson && !s.after && openSlot(s) ? s.timetable : null;
    const lesson = table ? table.lesson : s.lesson;
    const after = table ? table.after : s.after;
    d.lesson[s.index] = lesson ?? null;
    d.after[s.index] = after ? { ...after } : null;
  }
  return d;
}

/** 把自动日程（或"照上月"）的结果放进草稿；没给的格子不动。 */
export function applySlots(draft: Draft, slots: PlanSlotInput[]): Draft {
  const next: Draft = { lesson: { ...draft.lesson }, after: { ...draft.after } };
  for (const s of slots) {
    if (s.lesson !== undefined) next.lesson[s.index] = s.lesson;
    if (s.after !== undefined) next.after[s.index] = s.after ? { ...s.after } : null;
  }
  return next;
}

/** 在某格放一个活动（课后格的补选清空，等玩家再选）。 */
export function assign(draft: Draft, cell: Cell, activity: string | null): Draft {
  const next: Draft = { lesson: { ...draft.lesson }, after: { ...draft.after } };
  if (cell.part === "lesson") next.lesson[cell.index] = activity;
  else next.after[cell.index] = activity ? { activity } : null;
  return next;
}

/** 补选课后格的地点、同伴、书或远足点。 */
export function refine(draft: Draft, index: number, patch: Partial<AfterChoice>): Draft {
  const cur = draft.after[index];
  if (!cur) return draft;
  return { lesson: { ...draft.lesson }, after: { ...draft.after, [index]: { ...cur, ...patch } } };
}

/** 某格选的活动 key。 */
export function chosenAt(draft: Draft, cell: Cell): string | null {
  return cell.part === "lesson" ? (draft.lesson[cell.index] ?? null) : (draft.after[cell.index]?.activity ?? null);
}

/** 这一格的活动还要补选什么（按活动的 needs，已经选了的不算）。 */
export function missingNeeds(choice: AfterChoice | null, act: ActivityView | undefined): ActivityView["needs"] {
  if (!choice || !act) return [];
  return act.needs.filter((n) => {
    switch (n) {
      case "place":
        return !choice.place;
      case "companion":
        return !choice.companion;
      case "book":
        return !choice.book;
      case "excursion":
        return !choice.excursion || !choice.node;
    }
  });
}

/** 按 key 找活动（课业与课后两张表一起找）。 */
export function activityIndex(view: Pick<UpbringingView, "lessons" | "activities">): Map<string, ActivityView> {
  const m = new Map<string, ActivityView>();
  for (const a of view.lessons) m.set(a.key, a);
  for (const a of view.activities) m.set(a.key, a);
  return m;
}

/** 草稿是否排满（每格都有活动、需要补选的都补了）。 */
export function isComplete(view: Pick<UpbringingView, "stage" | "plan" | "lessons" | "activities">, draft: Draft): boolean {
  const acts = activityIndex(view);
  return openCells(view).every((c) => {
    const key = chosenAt(draft, c);
    if (!key) return false;
    if (c.part === "lesson") return true;
    return missingNeeds(draft.after[c.index] ?? null, acts.get(key)).length === 0;
  });
}

/**
 * FE2：后端的 timetable_problem 说的是“上一次交上去的课表”哪一格排不上；玩家在前端改了草稿（自动安排、手选）以后，
 * 那句话就过时了。这里判断它还该不该显示：出问题的那一格（index）在草稿里排上了、而且跟原来的不一样 → 过时；
 * 整张课表的问题（index = null）在草稿改过并排满以后 → 过时。没改过时照旧显示（真排不上的照写）。
 */
export function problemStale(view: Pick<UpbringingView, "stage" | "plan" | "lessons" | "activities">, draft: Draft): boolean {
  const p = view.plan.timetable_problem;
  if (!p) return false;
  const base = draftOf(view.plan);
  if (p.index === null) return planDirty(view, draft) && isComplete(view, draft);
  const cells = openCells(view).filter((c) => c.index === p.index);
  if (cells.length === 0) return false;
  return cells.every((c) => {
    const now = chosenAt(draft, c);
    return !!now && JSON.stringify([now, c.part === "after" ? draft.after[c.index] : null]) !== JSON.stringify([chosenAt(base, c), c.part === "after" ? base.after[c.index] : null]);
  });
}

/** 要排的格：按旬是全部格子；按周只算本周还没结算、没落在换阶段之后的格。 */
export function openCells(view: Pick<UpbringingView, "stage" | "plan">): Cell[] {
  if (!isWeekly(view)) return cellsOf(view);
  const open = new Set(view.plan.slots.filter(openSlot).map((s) => s.index));
  return cellsOf(view).filter((c) => open.has(c.index));
}

/** 提交的 PlanMonth 各段（家乡期不带 lesson）。按周（U05）提交 PlanWeek：每格只填 lesson 或 after 之一，落在换阶段之后的格留空。 */
export function toSlots(view: Pick<UpbringingView, "stage" | "plan">, draft: Draft): PlanSlotInput[] {
  if (isWeekly(view)) {
    return view.plan.slots.map((s) => {
      if (s.locked || s.status === "locked") return { index: s.index, lesson: null, after: null };
      return s.column === "lesson"
        ? { index: s.index, lesson: draft.lesson[s.index] ?? null, after: null }
        : { index: s.index, lesson: null, after: draft.after[s.index] ?? null };
    });
  }
  return view.plan.slots.map((s) => {
    const after = draft.after[s.index] ?? null;
    return view.stage === "academy" ? { index: s.index, lesson: draft.lesson[s.index] ?? null, after } : { index: s.index, after };
  });
}

/** 一个月的预计：成长值取区间中点之和，疲劳、心情、零用钱（收入取中点减费用）按格累加。 */
export interface Projection {
  growth: Map<string, number>;
  fatigue: number;
  mood: number;
  cash: number;
}

export function project(view: Pick<UpbringingView, "stage" | "plan" | "lessons" | "activities">, draft: Draft): Projection {
  const acts = activityIndex(view);
  const p: Projection = { growth: new Map(), fatigue: 0, mood: 0, cash: 0 };
  if (isWeekly(view)) {
    // 按周（U05）：本周还没结算的格按精确值（八分之一）加总，最后再取整——卡片上的单格取整值加起来会有误差。
    const e = { growth: new Map<string, number>(), fatigue: 0, mood: 0, cash: 0 };
    for (const c of openCells(view)) {
      const a = acts.get(chosenAt(draft, c) ?? "");
      if (!a) continue;
      const x = eighthsOf(a);
      for (const g of x.gains) e.growth.set(g.attr, (e.growth.get(g.attr) ?? 0) + (g.range[0] + g.range[1]) / 2);
      e.fatigue += x.fatigue;
      e.mood += x.mood;
      e.cash += (x.income[0] + x.income[1]) / 2 - x.cost;
    }
    for (const [k, v] of e.growth) p.growth.set(k, Math.round(v / 8));
    p.fatigue = Math.round(e.fatigue / 8);
    p.mood = Math.round(e.mood / 8);
    p.cash = Math.round(e.cash / 8);
    return p;
  }
  for (const c of cellsOf(view)) {
    const a = acts.get(chosenAt(draft, c) ?? "");
    if (!a) continue;
    for (const g of a.gains) p.growth.set(g.attr, (p.growth.get(g.attr) ?? 0) + Math.round((g.range[0] + g.range[1]) / 2));
    p.fatigue += a.fatigue;
    p.mood += a.mood;
    p.cash += Math.round((a.income[0] + a.income[1]) / 2) - a.cost;
  }
  return p;
}

/** 一张活动卡的精确值（八分之一为单位）；旧后端没有 eighths 时按整格（× 8）算。 */
export function eighthsOf(a: ActivityView): NonNullable<ActivityView["eighths"]> {
  if (a.eighths) return a.eighths;
  return {
    cost: a.cost * 8,
    income: [a.income[0] * 8, a.income[1] * 8],
    fatigue: a.fatigue * 8,
    mood: a.mood * 8,
    gains: a.gains.map((g) => ({ attr: g.attr, range: [g.range[0] * 8, g.range[1] * 8] as [number, number] })),
  };
}

/** 按周时草稿与后端的本周日程有没有不同（只比还能排的格）：不同就在开始这一周前先提交 PlanWeek。 */
export function planDirty(view: Pick<UpbringingView, "stage" | "plan">, draft: Draft): boolean {
  if (!isWeekly(view)) return false;
  const open = new Set(view.plan.slots.filter(openSlot).map((s) => s.index));
  const mine = toSlots(view, draft)
    .filter((s) => open.has(s.index))
    .map((s) => ({ lesson: s.lesson ?? null, after: s.after ?? null }));
  const theirs = view.plan.slots
    .filter((s) => open.has(s.index))
    .map((s) => (s.column === "lesson" ? { lesson: s.lesson ?? null, after: null } : { lesson: null, after: s.after ?? null }));
  return JSON.stringify(mine) !== JSON.stringify(theirs);
}

/** 疲劳加上本月预计以后会不会过高（过高会生病、闹脾气，FRAMEWORK §7.4）：按满值的 80% 警告。 */
export function fatigueWarning(fatigue: Meter, delta: number): boolean {
  return fatigue.max > 0 && fatigue.value + delta >= Math.round(fatigue.max * 0.8);
}

/** 数值条的色调：体力与心情高为好，疲劳高为坏。 */
export function meterTone(kind: "stamina" | "fatigue" | "mood" | "fame", m: Meter): "good" | "warn" | "bad" {
  const r = m.max > 0 ? m.value / m.max : 0;
  if (kind === "fatigue") return r >= 0.8 ? "bad" : r >= 0.55 ? "warn" : "good";
  if (kind === "fame") return "good";
  return r <= 0.25 ? "bad" : r <= 0.5 ? "warn" : "good";
}

/** 日历标记按日期排序，取最近的 n 个（倒计时用）。 */
export function upcoming(marks: CalendarMark[], n: number): CalendarMark[] {
  return [...marks].filter((m) => m.days_left >= 0).sort((a, b) => a.days_left - b.days_left || a.key.localeCompare(b.key)).slice(0, n);
}

// ───────────── 按周播放（P10：寰宇的养成每过完一周停一下，等玩家开始下一周） ─────────────

/** 一周有几天（与后端 `clock::UPBRINGING_WEEK_DAYS` 一致）；月内 1–7、8–14、15–21、22–28，余下的到月末算最后一周。 */
export const WEEK_DAYS = 7;

/** 这个月里的一周：第几周、首末日（都含）、过完了 / 这一周 / 还没到。 */
export interface WeekSpan {
  number: number;
  from: number;
  to: number;
  state: "done" | "current" | "upcoming";
}

/** 这个月最后一天是几号：按周排程（U05）时后端直接给；否则取本月日程最后一旬的末日（没有日程时按今天所在周的末日，至少 28）。 */
export function monthLastDay(view: Pick<UpbringingView, "plan" | "week">): number {
  if (view.week?.month_days) return view.week.month_days;
  const days = view.plan.slots.map((s) => s.to[2]).filter((d) => Number.isFinite(d));
  return Math.max(28, view.week?.to[2] ?? 0, ...days);
}

/** 把一个月按周分段；today 是今天几号（它所在的那一周是“这一周”）。给了 count（按周排程固定 4 周）时最后一周吃掉月末零头。 */
export function monthWeeks(last: number, today: number, count?: number): WeekSpan[] {
  const out: WeekSpan[] = [];
  const end = Math.max(1, Math.floor(last));
  for (let from = 1, n = 1; from <= end; from += WEEK_DAYS, n++) {
    const final = count !== undefined && n >= count;
    const to = final ? end : Math.min(from + WEEK_DAYS - 1, end);
    out.push({ number: n, from, to, state: today > to ? "done" : today >= from ? "current" : "upcoming" });
    if (final) break;
  }
  return out;
}

/**
 * 周条上的主按钮此刻该做什么：
 * - `story`：有一段收起的剧情在等回应，先把它重新交给玩家（否则时间走不动）；
 * - `start`：停在一周的头一天，开始这一周；
 * - `resume`：这一周过到一半停下了（玩家暂停，或答完剧情没有自动接着走），继续；
 * - `pause`：正在走，暂停；
 * - `plan`：月初还在排日程，由日程里的“开始这个月”开始（周条不另给按钮）；
 * - 没有周（不按周播放的世界、养成结束）时为 null。
 */
export type WeekAction = "story" | "start" | "resume" | "pause" | "plan";
export function weekAction(
  view: Pick<UpbringingView, "week" | "phase" | "today">,
  o: { paused: boolean; storyWaiting: boolean },
): WeekAction | null {
  if (!view.week) return null;
  if (view.phase === "plan") return o.storyWaiting ? "story" : "plan";
  if (view.phase !== "running") return null;
  if (o.storyWaiting) return "story";
  if (!o.paused) return "pause";
  return view.today[2] <= view.week.from[2] ? "start" : "resume";
}

/** 活动分页：按种类分组（顺序固定；没有活动的种类不显示）。 */
export const KIND_ORDER: readonly ActivityView["kind"][] = [
  "lesson",
  "job",
  "training",
  "adventure",
  "voyage",
  "social",
  "club",
  "free",
  "date",
  "craft",
  "reading",
  "contest",
  "rest",
];

export function kindsOf(list: ActivityView[]): ActivityView["kind"][] {
  const have = new Set(list.map((a) => a.kind));
  return KIND_ORDER.filter((k) => have.has(k));
}

/** 成长值换算成结业属性的进度（0–1）：成长值上限 1000。 */
export function growthRatio(value: number): number {
  return Math.max(0, Math.min(1, value / 1000));
}

// ───────────── 活动的小场景（UbScene）与右栏的分页 ─────────────

/** 场景 key → 远景的种类与图标。未知的场景按"室内"画。 */
const SCENES: Record<string, { look: string; icon: IconName }> = {
  dock: { look: "harbor", icon: "cargo" },
  harbor: { look: "harbor", icon: "anchor" },
  deck: { look: "sea", icon: "sail" },
  sea: { look: "sea", icon: "sail" },
  river: { look: "river", icon: "water" },
  market: { look: "street", icon: "market" },
  street: { look: "street", icon: "port" },
  tavern: { look: "warm", icon: "tavern" },
  classroom: { look: "indoor", icon: "report" },
  library: { look: "indoor", icon: "quest" },
  court: { look: "court", icon: "star" },
  shrine: { look: "shrine", icon: "relic" },
  temple: { look: "shrine", icon: "relic" },
  church: { look: "court", icon: "relic" },
  madrasa: { look: "desert", icon: "report" },
  garden: { look: "garden", icon: "spring" },
  forest: { look: "forest", icon: "discovery" },
  cave: { look: "cave", icon: "discovery" },
  ruin: { look: "cave", icon: "relic" },
  field: { look: "garden", icon: "autumn" },
  festival: { look: "night", icon: "star" },
  dorm: { look: "night", icon: "clock" },
  roof: { look: "night", icon: "star" },
  workshop: { look: "warm", icon: "build" },
  shipyard: { look: "harbor", icon: "shipyard" },
  arena: { look: "street", icon: "battle" },
  home: { look: "warm", icon: "port" },
  rest: { look: "warm", icon: "morale" },
};

export function sceneOf(key: string): { look: string; icon: IconName } {
  return Object.prototype.hasOwnProperty.call(SCENES, key) ? SCENES[key] : { look: "indoor", icon: "quest" };
}

export type SideTab = "attrs" | "bonds" | "calendar" | "album" | "letters" | "diary" | "path";
export const SIDE_TABS: readonly SideTab[] = ["attrs", "bonds", "calendar", "album", "letters", "diary", "path"];

/** 通用场景 key（不分文化）借用一张合适的插画。 */
const SCENE_ALIASES: Readonly<Record<string, string>> = {
  classroom: "classroom_eu",
  library: "library",
  tavern: "tavern_eu",
  shipyard: "shipyard",
  workshop: "printing_shop",
  cave: "cave",
  forest: "forest",
  ruin: "ruin",
  home: "home_rest",
  rest: "home_rest",
  dorm: "dorm_night",
  roof: "roof_stars",
  harbor: "harbor_eu",
  festival: "festival_eu",
};

/**
 * 活动场景的插画（public/scenes/<文件>.webp 与缩略的 <文件>-s.webp；tools/scenes/build.py 生成清单 sceneAssets.ts）：
 * 场景 key → 文件名主干。没有插画的场景照旧用底色 + 图标（UbScene）。
 */
export const SCENE_ART: Readonly<Record<string, string>> = (() => {
  const have = new Set(SCENE_FILES);
  const out: Record<string, string> = {};
  for (const k of SCENE_FILES) out[k] = k;
  for (const [k, v] of Object.entries(SCENE_ALIASES)) if (have.has(v) && !(k in out)) out[k] = v;
  return out;
})();

/** 月份 → 季节（北半球：3–5 春、6–8 夏、9–11 秋、12–2 冬）。有季节版的场景都在北半球的温带。 */
export function seasonOfMonth(month: number): "spring" | "summer" | "autumn" | "winter" {
  const m = ((Math.floor(month) - 1 + 12) % 12) + 1;
  if (m >= 3 && m <= 5) return "spring";
  if (m >= 6 && m <= 8) return "summer";
  if (m >= 9 && m <= 11) return "autumn";
  return "winter";
}

/**
 * 有季节版的场景按当月挑一版（热带场景分雨季、旱季）；养成主画面的城镇背景（townKit.ts）也用它。
 * 没有这一季的版本时退回“常景”：标成夏的那一版（第十轮 A04：画了樱花的市集等，原图定为春景，另出不带花的 --summer 当常景）；
 * 也没有夏版时用最早的一版。
 */
export function seasonal(art: string, month: number | undefined): string {
  if (month === undefined || !Number.isFinite(month) || !Object.prototype.hasOwnProperty.call(SCENE_SEASONS, art)) return art;
  const wet = Object.prototype.hasOwnProperty.call(SCENE_WET_MONTHS, art) ? SCENE_WET_MONTHS[art] : null;
  const want = wet ? (wet.includes(month) ? "wet" : "dry") : seasonOfMonth(month);
  const vs = SCENE_SEASONS[art];
  return vs.find((v) => v[1] === want)?.[0] ?? vs.find((v) => v[1] === "summer")?.[0] ?? art;
}

/**
 * U06F6：按主角家庭的文化换场景图。各家共用的事件、活计、课程里有些图是西洋 / 中国 / 阿拉伯的（u06c4 交接“第四趟”的清单），
 * 放在日本的澪身上出戏；养成期里（UpbringingScreen 挂着时设 sceneCulture）遇到这些键换成现成的日本图。别的文化不换、航海期不换。
 * U06F8：A07 补画了茶屋、操练场、夜里的望楼、四万十川的小早、京都的印书作坊五张，茶屋、操练场、印书作坊接进下表；
 * 夜里守望（watch_keeping）与操练（command_drill、conditioning）这几项活计的图在数据里仍写 harbor_eu（落到码头），
 * 由数据那一路直接改写成 watch_night_tosa / dojo_tosa（这五个键已登记在 SCENE_FILES，可直接当场景键用）。
 */
const CULTURE_SCENES: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  japanese: {
    harbor_eu: "dock_jp", // 码头搬运、航海课、操练、守夜、体能；事件“绳头认清”
    harbor_cn: "dock_jp",
    harbor_algiers: "dock_jp",
    tavern_eu: "teahouse_tosa", // 茶屋帮工（U06F8 起用下田的茶屋；原来借的市集）
    classroom_eu: "temple_school_tosa", // 音乐与诗（寺里的学堂）
    shexue_cn: "study_tosa", // 习字（书房）
    souq: "shokan_tosa", // 通事的活计（商馆）
    temple_cn: "temple_kyoto",
    // U06F7：第二趟实测（“图边的盘曲”配的是哥特书房）后把澪够得着的场景键过了一遍（交接 U06F7 一节有全表）
    library: "study_tosa", // 书房（别名 library 落到哥特式的书库）
    countinghouse: "shokan_tosa", // 账房（西式账房）→ 商馆
    deck_dhow_night: "deck_kobaya", // 夜里的阿拉伯船甲板 → 小早的甲板
    festival_eu: "festival_jp",
    lantern_cn: "festival_jp_bon", // 灯会 → 盂兰盆
    market_cn: "market_tosa",
    pearl_dive: "swim_tosa", // 采珠潜水 → 下田的凫水
    roof_stars: "roof_tosa",
    home_rest: "home_tosa",
    dorm_night: "tsubone_kyoto",
    shipyard: "boatshed_tosa", // 西式船坞 → 下田的船棚
    // U06F8：新画的三张
    fencing_eu: "dojo_tosa", // 剑术练习 → 河口边的沙地操练场（原来没换）
    printing_shop: "printshop_kyoto", // 印书工坊（别名 workshop 落到它，也跟着换）→ 京都的木版印书作坊（原来没换）
  },
};
/**
 * U06F8：按活计键先查的一层（只对日本）——几项共用活计挤在同一个场景键下（守夜、操练、体能都写 harbor_eu），
 * 整键换成码头以后分不出来；拿得到活计键的调用处（sceneArtPath 的第 4 个参数）先按活计键查，查不到再按场景键换。
 * night_patrol（dorm_night）不动。
 */
const CULTURE_ACTIVITY_SCENES: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  japanese: {
    watch_keeping: "watch_night_tosa", // 守夜 → 夜里栈桥尽头的望楼
    command_drill: "dojo_tosa", // 操练 → 河口边的沙地操练场
    conditioning: "dojo_tosa", // 体能 → 同上
  },
};
/** 这项活计在当前文化下有没有自己的图（按活计键）；没有为 null。 */
export function cultureActivityScene(activity: string | null | undefined, culture: string | null = sceneCulture): string | null {
  if (!activity || !culture || !Object.prototype.hasOwnProperty.call(CULTURE_ACTIVITY_SCENES, culture)) return null;
  const table = CULTURE_ACTIVITY_SCENES[culture];
  return Object.prototype.hasOwnProperty.call(table, activity) ? table[activity] : null;
}

let sceneCulture: string | null = null;
/** 养成画面挂着时设成主角家庭的文化（UpbringingScreen），卸下时设回 null。 */
export function setSceneCulture(culture: string | null | undefined): void {
  sceneCulture = culture ?? null;
}
/** 按当前文化换掉的场景键（不换时原样返回）。 */
export function cultureScene(scene: string, culture: string | null = sceneCulture): string {
  const table = culture && Object.prototype.hasOwnProperty.call(CULTURE_SCENES, culture) ? CULTURE_SCENES[culture] : null;
  return table && Object.prototype.hasOwnProperty.call(table, scene) ? table[scene] : scene;
}

/** 场景插画的图片路径（相对 public/）：小格用缩略图；给了月份时有季节版的场景挑当季的一版。没有插画时为 null。 */
export function sceneArtPath(sceneKey: string, size: "small" | "large", month?: number, activity?: string | null): string | null {
  // U06F8：拿得到活计键时先按活计键查（守夜、操练、体能），查不到再按场景键换
  const scene = cultureActivityScene(activity) ?? cultureScene(sceneKey);
  let art = Object.prototype.hasOwnProperty.call(SCENE_ART, scene) ? SCENE_ART[scene] : undefined;
  // U06F7：别名（library、classroom、tavern、harbor……）先落到文件名，再按文化换一次（“图边的盘曲”写的是 library）
  if (art) {
    const swapped = cultureScene(art);
    if (swapped !== art && Object.prototype.hasOwnProperty.call(SCENE_ART, swapped)) art = SCENE_ART[swapped];
  }
  return art ? `scenes/${seasonal(art, month)}${size === "small" ? "-s" : ""}.webp` : null;
}
