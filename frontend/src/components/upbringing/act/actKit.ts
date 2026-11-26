// 养成行动制界面的纯逻辑：按键取名字（地点、人、活动、门、家业、寒暄句）、地点的场景图、周的写法、停因的一行字、
// 日历按周分组、成长区间的写法、K1 行动的固定效果。组件只管画，这里的函数不碰 React。
import { tz, type ZhOnlyKey } from "../../../i18n/zhOnly";
import type { ActCalendarMark, ActPlaceView, ActView, ActionKind, ActionRecordView, FreeSkipView, LessonSlotView, LineView, MarkerView, StopKey } from "../../../ipc/actTypes";
import type { CaptainDefsView, UpbringingView, WorldDate } from "../../../ipc/types";
import { sceneArtPath, seasonal } from "../ubKit";
import { SCENE_FILES } from "../sceneAssets";
import { reasonOf, ta, type ActTextKey } from "./actText";

// ───────────── 名字 ─────────────

/** 视图里只有键：名字从原来的养成视图（places、companions、lessons、activities、calendar、skills）与静态数据里按键找。 */
export interface ActNames {
  place(key: string): string;
  person(key: string | null | undefined): string;
  /** U06F9：取得到这人的名字吗（取不到时 person() 写“某人”，不露键） */
  hasPerson(key: string): boolean;
  /** U06F9：远足点的名字（目标写成“远足:节点”或只有节点）；没去过（“?”）或取不到为空串 */
  excursion(target: string | null | undefined): string;
  portrait(key: string): string | null;
  activity(key: string | null | undefined): string;
  line(key: string | null | undefined): string;
  attr(key: string): string;
  skill(key: string): string;
  duty(key: string): string;
  dutyDesc(key: string): string | null;
  greet(key: string | null | undefined): string;
  item(key: string): string;
  mark(m: ActCalendarMark): string;
  /** K3b：出海的名字（数据 act:voyage:<键>:name；还是“（待写）”时写“第 n 趟出海”） */
  voyage(key: string): string;
}

/** U06F6：不出海的那两趟（与 k3Kit.INLAND_VOYAGES 同一张；actKit 不引 k3Kit，免得互相引用）——后端没给 at_sea 时的退路 */
export const INLAND_VOYAGE_KEYS: ReadonlySet<string> = new Set(["mio_voyage_6a", "mio_voyage_6b"]);

/** U06F7：这一趟不出海吗——视图给了 at_sea（FIX7b；在海上那一程的 voyage 或航次列表里的那一项）就照它，没给按键认。 */
export function isInlandVoyage(act: Pick<ActView, "voyage" | "voyages">, key: string | null | undefined): boolean {
  if (!key) return false;
  const here = act.voyage?.key === key ? act.voyage.at_sea : undefined;
  const listed = (act.voyages ?? []).find((v) => v.key === key)?.at_sea;
  const atSea = here ?? listed;
  return typeof atSea === "boolean" ? !atSea : INLAND_VOYAGE_KEYS.has(key);
}

/** 出海地点名还没写时，按用途垫底（venue / kind → 界面字）。 */
const VENUE_FALLBACK: Readonly<Record<string, ZhOnlyKey>> = {
  deck: "ub.act.name.deck",
  dock: "ub.act.name.dock",
};

/** 内容文字还没写（数据里是“（待写）”）或后端没给时的占位。 */
export const PENDING = "（待写）";

/** 一个标记叫什么：后端给了章标题（且不是“（待写）”）就用它，否则“某人的事”，连人也没有时“一件事”。 */
export function markerLabel(m: Pick<MarkerView, "person" | "title"> | null | undefined, person: (key: string) => string): string {
  const title = m?.title?.trim();
  if (title && title !== PENDING) return title;
  return m?.person ? ta("pl.markerOf", { who: person(m.person) }) : ta("pl.markerSomeone");
}

/** 有字（数据里的“（待写）”也算有字，原样显示——另一个任务正在写，界面只保证取得到）。 */
const present = (s: string | null | undefined): s is string => !!s && s.trim() !== "";

/** 后端没给名字时的退路：键的最后一段（`mio_home_dock` → `dock`，`act:x:y` → `y`）。 */
export function keyTail(k: string): string {
  const seg = k.split(":").filter(Boolean).pop() ?? k;
  const parts = seg.split("_").filter(Boolean);
  return parts.length > 1 ? parts[parts.length - 1] : seg;
}

/**
 * 名字从哪儿来（U06F2 对过后端）：
 * - 门名、家业名与说明、寒暄句：静态数据 `upbringing_act_texts`（act.rs 的 texts()），键 `act:line:<门>:name`、`act:duty:<键>:name|desc`、`act:greet:…`；
 * - 地点、人、活动、技能、日历：原来的养成视图（places / companions / lessons / activities / skills / calendar）；
 * - 物品：物品栏（只有拥有的）→ 键的最后一段（后端没给货架物品名，见交接）。
 */
export function makeNames(
  view: UpbringingView,
  act: ActView,
  attrs: CaptainDefsView["attributes"] | undefined,
  items: ReadonlyMap<string, string>,
  texts: Readonly<Record<string, string>> = {},
): ActNames {
  const places = new Map(view.places.map((p) => [p.key, p]));
  const people = new Map<string, { name: string; portrait: string | null }>();
  for (const p of view.places) for (const x of p.people) people.set(x.key, { name: x.name, portrait: x.portrait });
  for (const c of view.companions) people.set(c.key, { name: c.name, portrait: c.portrait ?? people.get(c.key)?.portrait ?? null });
  // U06F3 第三趟：小结“人”一栏露键名——再查后端给的显示名（可选）与书信的寄信人
  for (const c of act.summary?.affinity_changes ?? []) if (!people.has(c.person) && present(c.name)) people.set(c.person, { name: c.name, portrait: null });
  for (const l of view.letters ?? []) if (!people.has(l.from) && present(l.from_name)) people.set(l.from, { name: l.from_name, portrait: null });
  const acts = new Map([...view.lessons, ...view.activities].map((a) => [a.key, a.name]));
  const lines = new Map(act.lines.map((l) => [l.key, l]));
  const calNames = new Map(view.calendar.map((c) => [`${c.kind}:${c.key}`, c.name]));
  const calAny = new Map(view.calendar.map((c) => [c.key, c.name]));
  const skills = new Map(view.skills.map((s) => [s.key, s.name]));
  // U06F4 第二趟：技能名再从活动、课的技能表里补（主角还没学过的技能不在 view.skills 里，课表里就露出 calligraphy 这样的键）
  for (const a of [...view.lessons, ...view.activities]) for (const sk of a.skills ?? []) if (!skills.has(sk.skill) && present(sk.name)) skills.set(sk.skill, sk.name);
  // 行动制视图的地点自带名字（K3 起；出海的甲板、停靠港只在这里有）
  const actPlaces = new Map(act.places.map((p) => [p.key, p]));
  const lineIndex = new Map(act.lines.map((l, i) => [l.key, i]));
  // 活动 → 它是哪门课的第几档（活动名取不到时写“<门名> · 第 n 档”）
  const tierOf = new Map<string, { line: string; tier: number }>();
  for (const l of act.lines) l.tiers.forEach((t, i) => !tierOf.has(t.activity) && tierOf.set(t.activity, { line: l.key, tier: i }));
  const exams = new Map((view.exams ?? []).map((e) => [e.key, e.name]));
  const viewItems = new Map<string, string>();
  for (const p of act.places) for (const s of p.shop) if (present(s.name)) viewItems.set(s.item, s.name);
  for (const g of act.gift_items) if (present(g.name)) viewItems.set(g.item, g.name);
  const markers = new Map(act.markers.map((m) => [m.track, m]));
  const n: ActNames = {
    place: (k) => {
      const own = actPlaces.get(k);
      if (present(own?.name) && own.name !== PENDING) return own.name;
      const old = places.get(k)?.name;
      if (present(old)) return old;
      // 出海的地点名还是“（待写）”：按用途写“甲板 / 码头”，再不行写“一处地方”，不露键
      const venue = own?.venue ?? own?.kind;
      return venue && Object.prototype.hasOwnProperty.call(VENUE_FALLBACK, venue) ? tz(VENUE_FALLBACK[venue]) : tz("ub.act.name.place");
    },
    person: (k) => (k ? (people.get(k)?.name ?? tz("ub.act.name.person")) : ""),
    hasPerson: (k) => people.has(k),
    excursion: (t) => {
      if (!t) return "";
      const [a, b] = t.includes(":") ? t.split(":") : [null, t];
      for (const e of view.excursions ?? []) {
        if (a && e.key !== a) continue;
        const node = e.nodes.find((x) => x.key === b);
        if (!node) continue;
        const nm = node.name.trim();
        if (node.state === "unknown" || !nm || nm === "?") return "";
        return !e.name || e.name === nm ? nm : `${e.name} · ${nm}`;
      }
      return "";
    },
    portrait: (k) => people.get(k)?.portrait ?? null,
    activity: (k) => {
      if (!k) return "";
      const own = acts.get(k);
      if (present(own) && own !== PENDING) return own;
      // U06F4 第二趟：取不到名字时写“<门名> · 第 n 档”，再不行写“一样活计”，不露键
      const t = tierOf.get(k);
      if (t) {
        const ln = texts[`act:line:${t.line}:name`];
        if (present(ln) && ln !== PENDING) return `${ln} · ${ta("tt.tier", { n: t.tier + 1 })}`;
      }
      return tz("ub.act.name.activity");
    },
    line: (k) => {
      if (!k) return "";
      const own = texts[`act:line:${k}:name`];
      if (present(own) && own !== PENDING) return own;
      // 后端没给、或数据里还是“（待写）”：借第一档那项活动的名字（课表一排都是“（待写）”就没法排课；玩家至少认得这是什么课）
      const first = lines.get(k)?.tiers[0]?.activity;
      const own2 = first ? acts.get(first) : undefined;
      if (present(own2) && own2 !== PENDING) return own2;
      // U06F4 第二趟：再取不到就写“第 n 门课”（按课表里的次序），不露键
      return tz("ub.act.name.line", { n: (lineIndex.get(k) ?? 0) + 1 });
    },
    attr: (k) => attrs?.find((a) => a.key === k)?.name ?? tz("ub.act.name.attr"),
    skill: (k) => skills.get(k) ?? tz("ub.act.name.skill"),
    duty: (k) => {
      const s = texts[`act:duty:${k}:name`];
      return present(s) ? s : PENDING;
    },
    dutyDesc: (k) => {
      const s = texts[`act:duty:${k}:desc`];
      return present(s) ? s : null;
    },
    greet: (k) => {
      const s = k ? texts[k] : undefined;
      return present(s) ? s : PENDING;
    },
    item: (k) => {
      // 后端给了货架 / 礼物的名字（U06K1b）就用；没有再走物品栏 → 键尾
      const own = viewItems.get(k) ?? items.get(k);
      // U06F9：取不到名字写“一样东西”，不露键尾
      return present(own) ? own : tz("ub.act.name.item");
    },
    voyage: (k) => {
      const own = texts[`act:voyage:${k}:name`];
      if (present(own) && own !== PENDING) return own;
      const i = (act.voyages ?? []).findIndex((v) => v.key === k);
      return tz("ub.act.voyage.nth", { n: i >= 0 ? i + 1 : 1 });
    },
    mark: (m) => {
      if (m.kind === "voyage") return n.voyage(m.key);
      if (m.kind === "marker_due") {
        // HOTFIX1：后端在 calendar[].name 给了章标题就用标题（“（待写）”不用），没有再按人名起名
        if (present(m.name) && m.name !== PENDING) return m.name;
        const who = markers.get(m.key)?.person;
        return ta("cal.markerDue", { who: who ? n.person(who) : ta("pl.markerSomeone") });
      }
      // 行动制日历的键（节日、考试、学院日程、排期事件）多半与原来养成视图的 calendar 对得上；对不上时按种类写一个泛称，不露键
      if (present(m.name)) return m.name;
      return calNames.get(`${m.kind}:${m.key}`) ?? calAny.get(m.key) ?? exams.get(m.key) ?? ta(`cal.any.${m.kind}` as ActTextKey);
    },
  };
  return n;
}

// ───────────── 日期与周 ─────────────

/** 寰宇每月固定四周（1–7、8–14、15–21、22–月末）：日期 → 月内第几周（1–4）。 */
export const weekOfMonth = (d: WorldDate): number => Math.min(4, Math.floor((d[2] - 1) / 7) + 1);

/** 周的绝对序号（同一套四周制），用来算“第几周之后”。 */
export const weekOrdinal = (d: WorldDate): number => (d[0] * 12 + (d[1] - 1)) * 4 + weekOfMonth(d) - 1;

export const weekTitle = (from: WorldDate): string => ta("top.week", { y: from[0], m: from[1], w: weekOfMonth(from) });

/** 本周与后四周：每周一栏，栏里是这一周的日历事项。 */
export function calendarWeeks(act: Pick<ActView, "week" | "calendar">, n = 5): { offset: number; label: string; marks: ActCalendarMark[] }[] {
  const base = weekOrdinal(act.week.from);
  const out = Array.from({ length: n }, (_, i) => ({
    offset: i,
    label: i === 0 ? ta("cal.thisWeek") : ta("cal.weekN", { n: (((weekOfMonth(act.week.from) - 1 + i) % 4) + 1) }),
    marks: [] as ActCalendarMark[],
  }));
  for (const m of act.calendar) {
    const off = weekOrdinal(m.date) - base;
    if (off >= 0 && off < n) out[off].marks.push(m);
  }
  for (const w of out) w.marks.sort((a, b) => a.date[1] - b.date[1] || a.date[2] - b.date[2]);
  return out;
}

// ───────────── 数 ─────────────

/** 百分之一点 → “0.9”这样的一位小数（整数时不带小数）。 */
export function hundredths(v: number): string {
  const x = Math.round(v / 10) / 10;
  return Number.isInteger(x) ? String(x) : x.toFixed(1);
}

/** 十分之一点 → 一位小数。 */
export const tenths = (v: number): string => {
  const x = v / 10;
  return Number.isInteger(x) ? String(x) : x.toFixed(1);
};

export const signed = (v: number): string => (v > 0 ? `+${v}` : v < 0 ? `−${Math.abs(v)}` : "±0");

/** 一格课的预计：主要的两项成长区间（按上端从大到小）。 */
export function slotGains(s: Pick<LessonSlotView, "gains">, attr: (k: string) => string, top = 2): string[] {
  return Object.entries(s.gains)
    .sort((a, b) => b[1][1] - a[1][1])
    .slice(0, top)
    // K2：阶梯下给的是确定值（lo = hi），只写一个数
    .map(([k, [lo, hi]]) => (hundredths(lo) === hundredths(hi) ? `${attr(k)} +${hundredths(hi)}` : ta("tt.gain", { attr: attr(k), lo: hundredths(lo), hi: hundredths(hi) })));
}

/** 一条结果的成长写成“航海 +1 · 学识 +2”的小签（只列非零）。 */
export function deltaChips(rec: Record<string, number>, name: (k: string) => string): { key: string; text: string; up: boolean }[] {
  return Object.entries(rec)
    .filter(([, v]) => v !== 0)
    .map(([k, v]) => ({ key: k, text: `${name(k)} ${signed(v)}`, up: v > 0 }));
}

/** 百分之一点的增减写成小签（+0.4、+1.2），零不写。 */
export function fracChips(rec: Record<string, number>, name: (k: string) => string): { key: string; text: string; up: boolean }[] {
  return Object.entries(rec)
    .filter(([, v]) => hundredths(v) !== "0")
    .map(([k, v]) => ({ key: k, text: `${name(k)} ${v > 0 ? "+" : "−"}${hundredths(Math.abs(v))}`, up: v > 0 }));
}

/** 一条行动（或家业）的结果写成小签：钱、疲劳、心情、好感、成长、技能。 */
export function resultChips(names: ActNames, r: ActionRecordView["result"]): { key: string; text: string; up: boolean }[] {
  const out: { key: string; text: string; up: boolean }[] = [];
  if (r.cash) out.push({ key: "cash", text: `${ta("top.cash")} ${signed(r.cash)}`, up: r.cash > 0 });
  if (r.fatigue) out.push({ key: "fat", text: `${ta("top.fatigue")} ${signed(r.fatigue)}`, up: r.fatigue < 0 });
  if (r.mood) out.push({ key: "mood", text: `${ta("top.mood")} ${signed(r.mood)}`, up: r.mood > 0 });
  for (const [k, v] of Object.entries(r.affinity)) if (v) out.push({ key: `aff:${k}`, text: `${names.person(k)} ${signed(v)}`, up: v > 0 });
  out.push(...deltaChips(r.growth, names.attr), ...deltaChips(r.skill, names.skill));
  return out;
}

// ───────────── K1 行动的固定效果（规则表 [upbringing.act]，契约 1；视图没给这些数，见交接“与契约对不上”第 3 条） ─────────────

export const K1_EFFECTS = {
  rest: 15,
  pray: { fatigue: 6, mood: 4, resolve: 1.5 },
  talk: { affinity: 5, mood: 2 },
  excursionFatigue: 4,
} as const;

export type ActEffects = {
  rest: number;
  pray: { fatigue: number; mood: number; resolve: number };
  talk: { affinity: number; mood: number };
  excursionFatigue: number;
};

/**
 * 界面写的行动效果（与 K1_EFFECTS 同形、量都按正数写，文案里自带 +/−）：视图顶层给了 effects（U06K1b，带正负号、growth 以百分之一点计）
 * 就用它，缺哪项哪项用 K1_EFFECTS。参拜的“意志”取 growth.resolve。
 */
export function actEffects(act: Pick<ActView, "effects">): ActEffects {
  const e = act.effects ?? {};
  const abs = (v: number | undefined, d: number) => (typeof v === "number" ? Math.abs(v) : d);
  const resolve = e.pray?.growth?.resolve;
  return {
    rest: abs(e.rest?.fatigue, K1_EFFECTS.rest),
    pray: {
      fatigue: abs(e.pray?.fatigue, K1_EFFECTS.pray.fatigue),
      mood: abs(e.pray?.mood, K1_EFFECTS.pray.mood),
      resolve: typeof resolve === "number" ? Math.abs(resolve) / 100 : K1_EFFECTS.pray.resolve,
    },
    talk: { affinity: abs(e.talk?.affinity, K1_EFFECTS.talk.affinity), mood: abs(e.talk?.mood, K1_EFFECTS.talk.mood) },
    excursionFatigue: abs(e.excursion?.fatigue, K1_EFFECTS.excursionFatigue),
  };
}

/** 行动名。 */
export const actionName = (k: ActionKind): string => ta(`action.${k}` as ActTextKey);

// ───────────── 停因 ─────────────

export interface StopLine {
  key: StopKey;
  label: string;
  hint: string;
  /** 要玩家拿主意（照后端的 stop_info；旧后端用 REMIND_ONLY_STOPS） */
  blocking: boolean;
}

/** 周初停下来的原因：每条一个短标签与一句说明（目标键换成名字）。 */
export function stopLines(act: ActView, names: ActNames, cash: number): StopLine[] {
  return act.stops.map((key) => ({ ...stopLine(act, names, cash, key), blocking: stopBlocking(act, key) }));
}

function stopLine(act: ActView, names: ActNames, cash: number, key: StopKey): Omit<StopLine, "blocking"> {
  const targets = act.stop_targets[key] ?? act.stop_info?.find((s) => s.kind === key)?.targets ?? [];
  switch (key) {
    case "tier_open": {
      // K2：目标写成“门:档”（档从 0 起，规划方定）；旧的只给门键时照旧写。
      // U06F4 第二趟：门名一律走 names.line（不露键）；后端在 stop_target_names 里给了显示名（U06K3a3）就用后端的
      const shown = act.stop_target_names?.tier_open ?? [];
      const lineName = (line: string, i: number) => {
        const own = shown[i];
        return own && own.trim() !== "" && own !== PENDING ? own : names.line(line);
      };
      return {
        key,
        label: ta("stop.tier_open"),
        hint: targets.some((t) => t.includes(":"))
          ? targets
              .map((t, i) => {
                const [line, tier] = t.split(":");
                return tz("ub.act.stop.tier_open.hint", { line: lineName(line, i), n: Number(tier) + 1 });
              })
              .join("；")
          : ta("stop.tier_open.hint", { what: targets.map((t, i) => lineName(t, i)).join("、") || "—" }),
      };
    }
    case "fee":
      return { key, label: ta("stop.fee"), hint: ta("stop.fee.hint", { need: act.lessons.fee_week, have: cash }) };
    case "fatigue":
      return { key, label: ta("stop.fatigue"), hint: ta("stop.fatigue.hint", { n: act.fatigue.projected }) };
    case "calendar": {
      const marks = act.calendar.filter((m) => weekOrdinal(m.date) === weekOrdinal(act.week.from) && m.kind !== "marker_due");
      const what = marks.length > 0 ? marks.map((m) => `${m.date[2]} 日${names.mark(m)}`).join("、") : tz("ub.act.stop.calendarSome");
      return { key, label: ta("stop.calendar"), hint: ta("stop.calendar.hint", { what }) };
    }
    case "mission_due":
      return { key, label: ta("stop.mission_due"), hint: ta("stop.mission_due.hint") };
    case "key_marker": {
      const found = targets.map((t) => act.markers.find((m) => m.track === t)).filter((m): m is MarkerView => !!m);
      const what = found.length > 0 ? found.map((m) => markerLabel(m, names.person)).join("、") : ta("pl.markerSomeone");
      return { key, label: ta("stop.key_marker"), hint: ta("stop.key_marker.hint", { what }) };
    }
    case "restage":
      // 开局第一周与换阶段都报 restage（目标是阶段键，分不出是哪一种），一句话两种都说得通
      return { key, label: ta("stop.restage"), hint: ta("stop.restage.hint") };
    case "blocked":
      return { key, label: ta("stop.blocked"), hint: ta("stop.blocked.hint", { what: targets.map((t) => Number(t) + 1).join("、") || "?" }) };
    case "voyage":
      // K3b：出海的第一周周初停一下（课表换成船上活计、地点换成甲板与停靠港）
      return {
        key,
        label: act.voyage && isInlandVoyage(act, act.voyage.key) ? tz("ub.act.voyage.chipInland") : tz("ub.act.stop.voyage"),
        hint: !act.voyage
          ? tz("ub.act.stop.voyage.bare")
          : isInlandVoyage(act, act.voyage.key)
            ? tz("ub.act.stop.voyage.inland", { name: names.voyage(act.voyage.key) })
            : tz("ub.act.stop.voyage.hint", { name: names.voyage(act.voyage.key), n: act.voyage.legs }),
      };
    case "ill":
      // K2：周末病倒，病中第一周的周初停一下
      return { key, label: tz("ub.act.stop.ill"), hint: act.illness ? tz("ub.act.illness.hint", { n: act.illness.weeks_left }) : tz("ub.act.stop.ill.hint") };
    default:
      // 不认识的停因（后端新加的）：写一句通用的话，不崩
      return { key, label: tz("ub.act.stop.other"), hint: tz("ub.act.stop.other.hint") };
  }
}

// ───────────── 课表 ─────────────

/** 这一阶段能上的门（门的阶段、学院与本周相同）。 */
export function stageLines(act: Pick<ActView, "lines" | "week">): LineView[] {
  return act.lines.filter((l) => l.stage === act.week.stage && (act.week.stage === "home" || l.academy === act.week.academy));
}

/** 在某门的地方、本周在场的人（可以邀来同行）。 */
export function peopleAt(act: Pick<ActView, "places">, place: string): string[] {
  return act.places.find((p) => p.key === place)?.people.map((p) => p.key) ?? [];
}

/** 这一格现在正在上（平日里最近结算的下一格；都结算了是最后一格）。 */
export function currentSlot(act: Pick<ActView, "lessons" | "week">): LessonSlotView | undefined {
  const slots = act.lessons.slots.filter((s) => !s.past);
  return slots.find((s) => !s.result && s.day >= act.week.day) ?? [...slots].reverse().find((s) => s.result) ?? slots[0];
}

// ───────────── 地点的场景图 ─────────────

/**
 * 日本线三座城的地点场景（第十轮 A03 补画，public/scenes/，会动）：城市（视图的 town.key）→ 地点种类 → 场景。
 * 这里没写的种类再查下面的日本通用表。A04：外景多有季节版（SCENE_SEASONS，placeScene 按当月挑，缺的季退回常景）；
 * 下田的作坊换成重画的 boatshed_tosa（旧图背景有不该有的天守），京都补了书库与局前的小庭。
 */
const TOWN_PLACE_SCENES: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  // 土佐下田（四万十川口的港町）：码头用原来的 dock_jp（画的就是土佐南部的港町），祭所用 shrine_jp（海边山上的神社）
  shimoda_tosa: {
    home: "home_tosa",
    classroom: "temple_school_tosa",
    library: "study_tosa",
    market: "market_tosa",
    workshop: "boatshed_tosa",
    trading_house: "shokan_tosa",
    roof: "roof_tosa",
    garden: "garden_tosa",
  },
  // 京都宫中：讲读间仍是宫中的室内 court_jp；书库是三条西家的土仓，小庭是回廊围着的坪庭（A04）
  kyoto: {
    library: "library_kyoto",
    garden: "tsuboniwa_kyoto",
    market: "incense_kyoto",
    dock: "ferry_kamo",
    roof: "tsukimi_kyoto",
    dorm: "tsubone_kyoto",
    shrine: "temple_kyoto",
  },
  // U06F5：见习出海的停靠港（A06 补画，美术交接 a05-handoff.md 第十三节）——浦户、堺的码头
  urado: { dock: "dock_urado" },
  sakai: { dock: "dock_sakai" },
  // 能岛（村上水军的岛）
  noshima: {
    classroom: "shed_noshima",
    library: "tidechest_noshima",
    garden: "netyard_noshima",
    market: "fishboat_noshima",
    dock: "berth_noshima",
    roof: "lookout_noshima",
    dorm: "bunk_noshima",
    shrine: "ryujin_noshima",
  },
};

/**
 * 日本（寰宇的澪）各种地点的场景插画（public/scenes/，会动）：上面三座城以外、或那座城没画的种类按 kind 选；
 * 没有日本专画的借最像的一张。别的文化走 ubKit 的通用借图（classroom → classroom_eu 等）。
 */
const JP_PLACE_SCENES: Readonly<Record<string, string>> = {
  home: "home_rest",
  dorm: "dorm_night",
  classroom: "court_jp",
  library: "court_jp", // 没有日本的书房画，借宫中的室内
  market: "dock_jp", // 没有日本的市集画：用港町（街市就在码头边）
  dock: "dock_jp",
  workshop: "shipyard",
  roof: "roof_stars",
  shrine: "shrine_jp",
  trading_house: "countinghouse",
  garden: "kemari_jp",
  // U06F5：出海各程的“甲板”（数据里 kind = dock、venue = deck，界面按 venue 换成这一种）
  deck: "deck_kobaya",
  // U06F8：回乡不出海的两趟（溯川、探河口）船上用四万十川上的小早
  river: "river_kobaya_shimanto",
};

const GENERIC_PLACE_SCENES: Readonly<Record<string, string>> = {
  market: "souq",
  trading_house: "countinghouse",
  shrine: "temple_cn",
  garden: "forest",
  dock: "harbor_eu",
};

const SCENE_SET = new Set(SCENE_FILES);

/**
 * 地点的场景种类：出海时甲板（venue = deck）用小早的甲板；其余照数据的 kind。
 * 出海中场景按这一程停靠的港挑（town 换成 voyage.port），见 ActPlace / ActVoyage。
 */
export const sceneKindOf = (p: Pick<ActPlaceView, "kind" | "venue">, inland = false, river = false): string =>
  p.venue === "deck" ? (river ? "river" : inland ? p.kind : "deck") : p.kind;

/**
 * U06F8：船上的场景用四万十川小早的航次——只有 6a“溯川练小早”（数据 voyages/mio.toml；地点结构没有场景字段，界面按航次认）。
 * 6b“风后探沙脊”也不出海，但照规划方的意思不动（仍用家乡的栈桥）；别的航次的甲板照旧是 deck_kobaya。
 */
export const RIVER_VOYAGE_KEYS: ReadonlySet<string> = new Set(["mio_voyage_6a"]);
export const isRiverVoyage = (key: string | null | undefined): boolean => !!key && RIVER_VOYAGE_KEYS.has(key);

/** 地点的场景图（相对 public/ 的路径与文件名主干）；有季节版的按当月挑。都没有时为 null（界面画底色）。town 是视图的 town.key。 */
export function placeScene(kind: string, culture: string | null | undefined, month: number, town?: string | null): { src: string; file: string } | null {
  const mine = town && Object.prototype.hasOwnProperty.call(TOWN_PLACE_SCENES, town) ? TOWN_PLACE_SCENES[town][kind] : undefined;
  const own = mine ?? (culture === "japanese" ? JP_PLACE_SCENES[kind] : GENERIC_PLACE_SCENES[kind]);
  if (own && SCENE_SET.has(own)) {
    const file = seasonal(own, month);
    return { src: `scenes/${file}.webp`, file };
  }
  const path = sceneArtPath(kind, "large", month);
  if (!path) return null;
  return { src: path, file: path.replace(/^scenes\//, "").replace(/\.webp$/, "") };
}

/**
 * 有专画的课（第十轮 A04：京都的“香木与贝覆”“药柜里的草药与看护”“历书、星宿与方位忌”）：数据里这门课的 scene 指向它们，
 * 课业格就在这门课自己的场景里出结果，不用地点（讲读间）的场景。别的课照旧按地点挑。
 */
const OWN_LESSON_SCENES: ReadonlySet<string> = new Set(["incense_lesson_kyoto", "herbs_lesson_kyoto", "stars_lesson_kyoto"]);

/**
 * U06F9：这门课 / 这件活计自己写了场景键时，行动制里优先用它（数据给课程线的各档、打工的活计写了 dojo_tosa 之类），
 * 地点的图只作退路。先按活计键查文化表（守夜、操练、体能），再取活动自己的 scene（养成视图的 lessons / activities），
 * 都经 sceneArtPath（含按文化换图）。取不到为 null。
 */
export function activityScene(activity: string | null | undefined, acts: readonly { key: string; scene: string }[], month: number): { src: string; file: string } | null {
  if (!activity) return null;
  const scene = acts.find((a) => a.key === activity)?.scene ?? "";
  const path = sceneArtPath(scene || activity, "large", month, activity);
  if (!path) return null;
  return { src: path, file: path.replace(/^scenes\//, "").replace(/\.webp$/, "") };
}

/** 这一格课的专画（没有为 null）：activity 是这一格结算 / 要上的活动键，lessons 是养成视图的课表（带各课的 scene）。 */
export function lessonScene(activity: string | null | undefined, lessons: readonly { key: string; scene: string }[], month: number): { src: string; file: string } | null {
  const scene = activity ? lessons.find((l) => l.key === activity)?.scene : undefined;
  if (!scene || !OWN_LESSON_SCENES.has(scene) || !SCENE_SET.has(scene)) return null;
  const file = seasonal(scene, month);
  return { src: `scenes/${file}.webp`, file };
}

// ───────────── 地点上的东西 ─────────────

/** 地图上一个地点挂着的标记（按到期先后）。 */
/** FIX7b：这个标记现在点得开吗（后端给了 openable = false 才算点不开；旧后端不给，当作点得开）。 */
export const markerOpen = (m: Pick<MarkerView, "openable"> | null | undefined): boolean => !!m && m.openable !== false;

/** 地图上一个地点挂着的、现在点得开的标记（按到期先后）——地图与地点上醒目的“!”只数这些；点不开的另由 ActPlace 照画、写原因。 */
export const markersAt = (act: Pick<ActView, "markers">, place: string) =>
  act.markers.filter((m) => m.place === place && markerOpen(m)).sort((a, b) => a.weeks_left - b.weeks_left);

/** 地图上的小图标：有标记 / 货架 / 活干。 */
export function spotBadges(p: ActPlaceView, act: Pick<ActView, "markers">): { marker: boolean; key: boolean; shop: boolean; job: boolean } {
  const ms = markersAt(act, p.key);
  return { marker: ms.length > 0, key: ms.some((m) => m.key), shop: p.shop.length > 0, job: p.jobs.length > 0 };
}

/** 行动点的小圆点：● 剩下的，○ 用掉的。 */
export function pointDots(left: number, max: number): ("on" | "off")[] {
  const m = Math.max(0, Math.min(12, max));
  return Array.from({ length: m }, (_, i) => (i < left ? "on" : "off"));
}

/** 课业格：这周（没过去的格里）上了几格、共几格。 */
export function lessonCount(act: Pick<ActView, "lessons">): { done: number; total: number } {
  const slots = act.lessons.slots.filter((s) => !s.past);
  return { done: slots.filter((s) => s.result).length, total: slots.length };
}

// ───────────── 周末地图下方“这周值得想的” ─────────────

export interface ThinkHint {
  key: string;
  text: string;
  /** 点了进哪个地点（null = 只是提醒） */
  place: string | null;
  urgent: boolean;
}

/**
 * 周末地图下方的几条提醒（至多 3 条）：这周不看就过期的标记、要紧的标记、累了、某份工差一两次就升级、家业还没做。
 * 只从视图里的数推，不另算规则；点一条直接进那个地方。
 */
export function thinkHints(act: ActView, names: ActNames): ThinkHint[] {
  const out: ThinkHint[] = [];
  for (const m of act.markers.filter(markerOpen).sort((a, b) => a.weeks_left - b.weeks_left || Number(b.key) - Number(a.key))) {
    if (m.weeks_left <= 1) out.push({ key: `m:${m.track}`, text: ta("hint.markerLast", { what: markerLabel(m, names.person) }), place: m.place, urgent: true });
    else if (m.key) out.push({ key: `m:${m.track}`, text: ta("hint.markerKey", { what: markerLabel(m, names.person), n: m.weeks_left }), place: m.place, urgent: true });
  }
  const restAt = act.places.find((p) => p.actions.some((a) => a.kind === "rest" && a.enabled));
  if (act.fatigue.value >= 50 && restAt) out.push({ key: "tired", text: ta("hint.tired", { n: act.fatigue.value }), place: restAt.key, urgent: false });
  for (const p of act.places)
    for (const j of p.jobs) {
      if (j.next_at === null) continue;
      const left = j.next_at - j.progress;
      if (left > 0 && left <= 2) out.push({ key: `j:${j.activity}`, text: ta("hint.jobUp", { job: names.activity(j.activity), n: left }), place: p.key, urgent: false });
    }
  // K3b：出海期间家业停，不提醒
  // FIX7：家业整栏做不了（病中等）时也不提醒
  if (act.family_duty && !act.family_duty.done_this_week && !act.voyage && act.family_duty.enabled !== false) out.push({ key: "duty", text: ta("hint.duty"), place: null, urgent: false });
  // U06F4：这周还没听过消息、又有地方听得到（见闻卡结业时折成行情）
  const listen = act.places.find((p) => p.actions.some((a) => a.kind === "rumor" && a.enabled));
  if (act.rumors && listen && !act.free.done.some((d) => d.kind === "rumor"))
    out.push({ key: "rumor", text: tz("ub.act.hint.rumor", { place: names.place(listen.key) }), place: listen.key, urgent: false });
  return out.slice(0, 3);
}

/**
 * FIX7：照周末模板跳过的一步写成“码头·打工（码头搬运）——原因”。打工的目标是工种的组（模板只记组），名字取这一组眼下的那份工；
 * 原因用后端填好参数的 reason_text，没有时查退路表，再没有写“做不了”。
 */
export function skipText(act: Pick<ActView, "places" | "markers">, names: ActNames, s: FreeSkipView): string {
  let what = actionName(s.kind);
  if (s.target) {
    let target = "";
    if (s.kind === "job") {
      let job: string | null = null;
      for (const p of act.places) for (const j of p.jobs) if (!job && (j.group === s.target || j.activity === s.target)) job = j.activity;
      target = names.activity(job ?? s.target);
    } else if (s.kind === "marker") target = markerLabel(act.markers.find((m) => m.track === s.target), names.person);
    else if (s.kind === "self_study") target = names.line(s.target.split(":")[0]);
    else if (s.kind === "excursion") target = names.excursion(s.target);
    else target = names.person(s.target);
    if (target) what = `${what}（${target}）`;
  }
  const why = reasonOf(s.reason_text, s.reason) ?? tz("ub.act.free.skipWhy");
  return tz("ub.act.free.skip", { place: names.place(s.place), what, why });
}

/** 记下的周末安排写成一行：“码头·打工、家中·休养”。 */
export function templateList(act: ActView, names: ActNames): string {
  return act.free.template.map((s) => `${names.place(s.place)}·${actionName(s.kind)}`).join("、");
}

/**
 * U06F3 第四趟：周初的停因里哪些要玩家拿主意（“下一周”遇到就停在周初），哪些只是提醒（照样开课，开课后底栏提一句）。
 * FIX6F：后端现在在视图里给每条停因的分类（`stop_info[].blocking`，与它的自动推进同一张表），有就照它；
 * 下面这张表只给不带 stop_info 的旧后端当退路——只是提醒：calendar（这周有节日 / 考试 / 学院的事）、mission_due（主命这周到期）；
 * 其余都停：tier_open、fee、fatigue、key_marker、restage、blocked、ill，以及界面不认识的新种类。
 */
export const REMIND_ONLY_STOPS: readonly StopKey[] = ["calendar", "mission_due"];

/** 这一条停因要不要玩家拿主意：后端给了 stop_info 就照它，没给（旧后端、或这一条不在里面）用 REMIND_ONLY_STOPS。 */
export function stopBlocking(act: Pick<ActView, "stop_info">, key: StopKey): boolean {
  const info = act.stop_info?.find((s) => s.kind === key);
  return info ? info.blocking : !REMIND_ONLY_STOPS.includes(key);
}

/** 周初有没有要玩家拿主意的停因（“下一周”之后界面要不要接着开课看它）。 */
export function needsDecision(act: Pick<ActView, "stops" | "stop_info">): boolean {
  return act.stops.some((s) => stopBlocking(act, s)) || (act.stop_info ?? []).some((s) => s.blocking);
}

/** 这一阶段能不能开课：学费够、没有排不上的格。返回拦着的原因（null = 能开）。 */
export function startBlock(act: ActView): string | null {
  if (act.stops.includes("blocked")) return ta("plan.blocked");
  const short = act.lessons.fee_week - act.money.cash;
  if (short > 0) return ta("plan.short", { n: short });
  return null;
}
