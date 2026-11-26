// U06F4：行动制内核三前半（K3a，docs/tasks/R10-U06K3a.md 契约 5）的纯逻辑：潮名与这周的效果、见闻卡的一句话、
// 识货簿、人物的好处与“再近一步有什么”、小结里的一行。组件在 ActK3.tsx；这里不碰 React。
//
// 内容文字（潮名与说明、见闻卡的句子、好处的说法）由另一位写在后端数据里；视图现在不带这几样，界面按约定的键
// 在静态数据 upbringing_act_texts 里找（act:tide:<港>:<潮>:name|desc、act:rumor:<卡>、act:perk:<种类>），
// 找不到或还是“（待写）”时按下面的办法拼一句垫底：潮用泛称“当季 / 换季”加这周的实际效果；见闻卡用“港名 + 货名 + 种类”；
// 好处按种类与参数写一句机制上的话。
import { tz, type ZhOnlyKey } from "../../../i18n/zhOnly";
import type { ActSummaryK3, ActView, Date3, PersonLevelView, RumorCardView, TideView } from "../../../ipc/actTypes";
import type { UpbringingView } from "../../../ipc/types";
import { INLAND_VOYAGE_KEYS, isInlandVoyage, PENDING, signed, weekOrdinal, type ActNames } from "./actKit";

/** 有字且不是“（待写）”。 */
const real = (s: string | null | undefined): s is string => !!s && s.trim() !== "" && s.trim() !== PENDING;

/**
 * 两种 2 级好处的百分点（规则表 [upbringing.act.perk]：job_partner_pct = 30、companion_pct = 10）。
 * 只是退路：视图给了 perks[].value（U06K3a3）就用视图的。
 */
export const PERK_PCT = { job_partner: 30, companion: 10 } as const;
/** 听一次得几张（规则 rumor.per_listen = 1）：退路，视图给了 rumors.per_listen 就用视图的。 */
export const RUMOR_PER_LISTEN = 1;

/** 这周听一次得几张：视图的 per_listen（后端已把潮多给的算进去）；没有时用规则表的退路 + 潮多给的。 */
export const perListen = (act: Pick<ActView, "rumors" | "tide">): number => act.rumors?.per_listen ?? RUMOR_PER_LISTEN + (act.tide?.rumors ?? 0);

/** 一样好处的数值：视图给的 value，没有用规则表的退路。 */
const perkValue = (p: PersonLevelView["perks"][number]): number | null =>
  typeof p.value === "number" ? p.value : p.kind === "job_partner" ? PERK_PCT.job_partner : p.kind === "companion" ? PERK_PCT.companion : null;

/** K3 的名字：港、货、潮、见闻卡、好处。港与货取静态数据（statics.locations / goods），取不到写键尾。 */
export interface K3Names {
  port(key: string): string;
  good(key: string): string;
  tide(key: string, current: boolean): string;
  tideDesc(key: string): string | null;
  rumor(card: Pick<RumorCardView, "key" | "port" | "good" | "kind" | "text">): string;
  /** 只有键（小结、行动记录里）：在 rumors.cards 里找到卡再拼；找不到写“一条消息” */
  rumorKey(key: string): string;
  perk(p: PersonLevelView["perks"][number]): string;
  /** K3b：关口成绩的说法（act:gate:<档>） */
  gate(g: "fail" | "ok" | "good"): string;
}

export function makeK3Names(
  act: Pick<ActView, "rumors">,
  view: Pick<UpbringingView, "town">,
  names: ActNames,
  texts: Readonly<Record<string, string>>,
  locations: readonly { key: string; name: string }[] | undefined,
  goods: readonly { key: string; name: string }[] | undefined,
): K3Names {
  const locs = new Map((locations ?? []).map((l) => [l.key, l.name]));
  const gds = new Map((goods ?? []).map((g) => [g.key, g.name]));
  const port = view.town?.key ?? "";
  // 潮的文字键带港口：先按所在城市找，找不到再找任一港口下同名的潮
  const tideText = (key: string, part: "name" | "desc"): string | null => {
    const own = texts[`act:tide:${port}:${key}:${part}`];
    if (real(own)) return own;
    const suffix = `:${key}:${part}`;
    for (const [k, v] of Object.entries(texts)) if (k.startsWith("act:tide:") && k.endsWith(suffix) && real(v)) return v;
    return null;
  };
  const cards = new Map((act.rumors?.cards ?? []).map((c) => [c.key, c]));
  const n: K3Names = {
    port: (k) => locs.get(k) ?? tz("ub.act.name.port"),
    good: (k) => gds.get(k) ?? tz("ub.act.name.good"),
    tide: (k, current) => tideText(k, "name") ?? tz(current ? "ub.act.tide.now" : "ub.act.tide.other"),
    tideDesc: (k) => tideText(k, "desc"),
    rumor: (c) => {
      // K3R1：先用视图卡上的正文；旧后端没有时查静态表（act:rumor:<卡>），再没有才拼“港 + 货 + 种类”
      if (real(c.text)) return c.text;
      const own = texts[`act:rumor:${c.key}`];
      if (real(own)) return own;
      const good = c.good ? n.good(c.good) : tz("ub.act.rumor.someGood");
      const kind = c.kind === "demand" || c.kind === "supply" || c.kind === "pirates" ? c.kind : "demand";
      return tz(`ub.act.rumor.${kind}` as ZhOnlyKey, { port: n.port(c.port), good });
    },
    rumorKey: (k) => {
      const c = cards.get(k);
      if (c) return n.rumor(c);
      const own = texts[`act:rumor:${k}`];
      return real(own) ? own : tz("ub.act.rumor.title");
    },
    gate: (g) => gateName(texts, g),
    perk: (p) => {
      // 数据里的说法（第二趟起视图带出）是一句话、不带数：后面用括号补上机制（+30%、哪门课第 3 档）
      const own = texts[`act:perk:${p.kind}`];
      const v = perkValue(p);
      if (real(own)) {
        const detail =
          p.kind === "job_partner" && v !== null
            ? tz("ub.act.perk.detail.job", { n: v })
            : p.kind === "companion" && v !== null
              ? tz("ub.act.perk.detail.companion", { n: v })
              : p.kind === "teach" && p.line
                ? tz("ub.act.perk.detail.teach", { line: names.line(p.line) })
                : null;
        return detail ? `${own}（${detail}）` : own;
      }
      switch (p.kind) {
        case "rumor":
          return tz("ub.act.perk.rumor");
        case "job_partner":
          return tz("ub.act.perk.job_partner", { n: v ?? PERK_PCT.job_partner });
        case "companion":
          return tz("ub.act.perk.companion", { n: v ?? PERK_PCT.companion });
        case "teach":
          return p.line ? tz("ub.act.perk.teach", { line: names.line(p.line) }) : tz("ub.act.perk.teachBare");
        case "introduce":
          return tz("ub.act.perk.introduce");
        default:
          return tz("ub.act.perk.other");
      }
    },
  };
  return n;
}

// ───────────── 潮汐 ─────────────

export interface Chip {
  key: string;
  text: string;
  tone?: "up" | "down";
  title?: string;
}

/** 一个工种组叫什么：地点里这一组的第一份工的名字（视图的 tide.jobs 按组给）。 */
export function jobGroupName(act: Pick<ActView, "places">, names: ActNames, group: string): string {
  for (const p of act.places) for (const j of p.jobs) if (j.group === group) return names.activity(j.activity);
  return names.activity(group);
}

/** 这一组这周实际一次能挣多少（视图的 income 已含潮与合伙）：取各地点里这一组的第一份工。 */
function groupIncome(act: Pick<ActView, "places">, group: string): [number, number] | null {
  for (const p of act.places) for (const j of p.jobs) if (j.group === group) return j.income;
  return null;
}

/** 本周潮带来的变化，逐条写成小签：打工（带实际钱数）、谁在哪儿、听消息多几张、哪儿去不了、家业会不会失手。 */
export function tideEffects(act: Pick<ActView, "places" | "family_duty">, view: Pick<UpbringingView, "excursions">, tide: TideView, names: ActNames): Chip[] {
  const out: Chip[] = [];
  for (const [g, pct] of Object.entries(tide.jobs)) {
    if (!pct) continue;
    const job = jobGroupName(act, names, g);
    const inc = groupIncome(act, g);
    const text = !inc
      ? tz("ub.act.tide.jobBare", { job, pct: signed(pct) })
      : inc[0] === inc[1]
        ? tz("ub.act.tide.job", { job, pct: signed(pct), n: inc[0] })
        : tz("ub.act.tide.jobRange", { job, pct: signed(pct), lo: inc[0], hi: inc[1] });
    out.push({ key: `job:${g}`, text, tone: pct > 0 ? "up" : "down" });
  }
  for (const who of tide.people) {
    const at = act.places.find((p) => p.people.some((x) => x.key === who));
    out.push({
      key: `who:${who}`,
      text: at ? tz("ub.act.tide.person", { who: names.person(who), place: names.place(at.key) }) : tz("ub.act.tide.personBare", { who: names.person(who) }),
    });
  }
  if (tide.rumors > 0) out.push({ key: "rumors", text: tz("ub.act.tide.rumors", { n: tide.rumors }), tone: "up" });
  if (tide.closed.length > 0) {
    // U06F5：没去过的远足点视图里名字是“?”（state = unknown）——不逐个列“?”，合成一句“另有 n 处没去过的地方”
    const { known, unknown } = closedNodes(view, tide.closed);
    if (known.length > 0) out.push({ key: "closed", text: tz("ub.act.tide.closed", { what: known.map((k) => k.name).join("、") }), tone: "down" });
    if (unknown > 0)
      out.push({ key: "closedUnknown", text: tz(known.length > 0 ? "ub.act.tide.closedMore" : "ub.act.tide.closedUnknown", { n: unknown }), tone: "down" });
  }
  for (const [d, pct] of Object.entries(tide.duty_fail)) if (pct > 0) out.push({ key: `duty:${d}`, text: tz("ub.act.tide.dutyFail", { duty: names.duty(d), n: pct }), tone: "down" });
  return out;
}

/** 关掉的远足点分成两类：去过的（有名字、可列）与没去过的（只数个数）。 */
export function closedNodes(view: Pick<UpbringingView, "excursions">, closed: readonly string[]): { known: { key: string; excursion: string; node: string; name: string }[]; unknown: number } {
  const known: { key: string; excursion: string; node: string; name: string }[] = [];
  let unknown = 0;
  for (const c of closed) {
    const [ex, node = ""] = c.split(":");
    const n = view.excursions.find((e) => e.key === ex)?.nodes.find((x) => x.key === node);
    if (!n || n.state === "unknown" || n.name.trim() === "" || n.name.trim() === "?") unknown += 1;
    else known.push({ key: c, excursion: ex, node, name: n.name });
  }
  return { known, unknown };
}

/** 日历条每一栏（本周 + 后四周）的潮：同上周的标“潮不变”，换了的写名字。offset 与 calendarWeeks 的一致。 */
export function tideWeeks(act: Pick<ActView, "week" | "tide">, n = 5, away: ReadonlySet<number> = new Set()): { offset: number; kinds: string[]; changed: boolean }[] {
  const t = act.tide;
  if (!t) return [];
  const out: { offset: number; kinds: string[]; changed: boolean }[] = [];
  // away：人不在家乡的周（出海）——不出签，也不拿来比“换没换”；回来的第一周跟出海前最后一周比，出海前没有可比的就当作换了（写名字）
  let prev: string | null = away.has(0) ? null : t.this_week.join("|");
  for (let i = 0; i < n; i++) {
    if (away.has(i)) continue;
    const kinds = i === 0 ? t.this_week : (t.next.find((x) => x.week === act.week.index + i)?.kinds ?? null);
    if (kinds === null) continue;
    const sig = kinds.join("|");
    out.push({ offset: i, kinds, changed: i > 0 && sig !== prev });
    prev = sig;
  }
  return out;
}

/** 这项家业这周的失手机会（%）；没有潮或不失手为 0。 */
export const dutyRisk = (act: Pick<ActView, "tide">, duty: string): number => act.tide?.duty_fail[duty] ?? 0;

// ───────────── 识货：打工那一行的货 ─────────────

export interface JobGood {
  good: string;
  name: string | null;
  seen: number;
  need: number;
  known: boolean;
}

/**
 * 一份工能摸到的货（U06K3a3 的 jobs[].goods：{ good, name, seen, need, known }）。第一趟的夹具拼过只有键的形状，
 * 那种按识货簿（rumors.goods）补进度。
 */
export function jobGoodRows(j: Pick<ActView["places"][number]["jobs"][number], "goods">, rumors: ActView["rumors"]): JobGood[] {
  return (j.goods ?? []).map((g) => {
    if (typeof g !== "string") return { good: g.good, name: g.name ?? null, seen: g.seen, need: g.need, known: g.known };
    const row = rumors?.goods.find((x) => x.good === g);
    return { good: g, name: null, seen: row?.seen ?? 0, need: row?.need ?? 3, known: row?.known ?? false };
  });
}

/** “谷物 1/3”“盐✓”。 */
export const jobGoodText = (g: JobGood, k3: Pick<K3Names, "good">): string => {
  const name = real(g.name) ? g.name : k3.good(g.good);
  return g.known ? `${name}✓` : `${name} ${g.seen}/${g.need}`;
};

// ───────────── 见闻卡 ─────────────

/**
 * U06F7：卡上要不要写有效期——已经作数、离止日还有一年以上的不写（多数卡盖住整个养成期）；
 * 还没到起始日的写“1555 年 5 月起作数”，一年内到期的写“到 1556 年 3 月为止”。不写时返回 null。
 */
export function rumorValidShort(c: Pick<RumorCardView, "valid">, today: Date3): string | null {
  const ym = (d: Date3) => d[0] * 12 + (d[1] - 1);
  if (ym(c.valid[0]) > ym(today)) return tz("ub.act.rumor.validFrom", { y: c.valid[0][0], m: c.valid[0][1] });
  if (ym(c.valid[1]) - ym(today) < 12) return tz("ub.act.rumor.validTo", { y: c.valid[1][0], m: c.valid[1][1] });
  return null;
}

/** “1557 年 1 月到 1558 年 12 月作数”。 */
export const rumorValid = (c: Pick<RumorCardView, "valid">): string =>
  tz("ub.act.rumor.valid", { y1: c.valid[0][0], m1: c.valid[0][1], y2: c.valid[1][0], m2: c.valid[1][1] });

/** 能听消息的地方：地点、能不能听、听不了的原因码 / 说明。 */
export function rumorSpots(act: Pick<ActView, "places">): { place: string; cost: number; enabled: boolean; reason: string | null; reason_text: string | null }[] {
  const out: { place: string; cost: number; enabled: boolean; reason: string | null; reason_text: string | null }[] = [];
  for (const p of act.places)
    for (const a of p.actions)
      if (a.kind === "rumor") out.push({ place: p.key, cost: a.cost, enabled: a.enabled, reason: a.reason, reason_text: a.reason_text ?? null });
  return out;
}

/** 一张卡结业时折多少（开船清单 capital_preview 里 kind = rumor 的那一行的 value）；清单里没有时 null。 */
export function rumorValue(act: Pick<ActView, "capital_preview">): number | null {
  const row = act.capital_preview?.rows.find((r) => r.kind === "rumor");
  return row ? row.value : null;
}

// ───────────── 人物 ─────────────

export interface PersonNext {
  person: string;
  /** 下一样还没到手的好处 */
  perk: PersonLevelView["perks"][number] | null;
  /** 到下一级还差多少好感（null = 到顶） */
  gap: number | null;
}

/**
 * 认得的人（取得到名字的：在地点里见过、同伴、书信、小结里出现过；取不到名字的不列，免得露出键），按“离下一样好处有多近”排：
 * 下一级就有好处的在前（差得少的更前），再是更远的好处，最后是没有好处的。
 */
export function knownPeople(people: readonly PersonLevelView[], names: ActNames): PersonLevelView[] {
  const named = people.filter((p) => names.hasPerson(p.key));
  const rank = (p: PersonLevelView) => {
    const next = p.perks.filter((k) => !k.active && k.level > p.level).sort((a, b) => a.level - b.level)[0];
    const gap = p.next_at === null ? 999 : p.next_at - p.affinity;
    if (!next) return 3000 + gap;
    // 给了各级的线就按“到那样好处还差多少”排；没给时下一级的在前
    const toPerk = gapTo(p, next.level);
    if (toPerk !== null) return toPerk;
    return next.level === p.level + 1 ? gap : 1000 + (next.level - p.level) * 100 + gap;
  };
  return [...named].sort((a, b) => rank(a) - rank(b));
}

export function personNext(p: PersonLevelView): PersonNext {
  const perk = p.perks.filter((k) => !k.active && k.level > p.level).sort((a, b) => a.level - b.level)[0] ?? null;
  return { person: p.key, perk, gap: p.next_at === null ? null : Math.max(0, p.next_at - p.affinity) };
}

/** 到某一级还差多少好感：视图给了各级的线（levels，从 1 级起，U06K3a3）就算得出；只有 next_at 时只算得出下一级。 */
export function gapTo(p: PersonLevelView, level: number): number | null {
  const line = p.levels?.[level - 1] ?? (level === p.level + 1 ? p.next_at : null);
  return typeof line === "number" ? Math.max(0, line - p.affinity) : null;
}

/** “汐再 13：在同一处打工多挣 30%”——离得最近的一样好处；都没有时 null。 */
export function nearestPerkHint(people: readonly PersonLevelView[], names: ActNames, k3: K3Names): string | null {
  for (const p of knownPeople(people, names)) {
    const nx = personNext(p);
    if (!nx.perk) continue;
    const gap = gapTo(p, nx.perk.level);
    if (gap !== null) return tz("ub.act.people.hint", { who: names.person(p.key), n: gap, what: k3.perk(nx.perk) });
    return tz("ub.act.people.hintLv", { who: names.person(p.key), lv: nx.perk.level, what: k3.perk(nx.perk) });
  }
  return null;
}

export const levelName = (n: number): string => (n <= 0 ? tz("ub.act.people.level0") : tz("ub.act.people.level", { n }));

// ───────────── K3b 见习出海 ─────────────

/** 关口成绩的说法：数据（act:gate:<档>）→ 界面的垫底。 */
export function gateName(texts: Readonly<Record<string, string>>, grade: "fail" | "ok" | "good"): string {
  const s = texts[`act:gate:${grade}`];
  return real(s) ? s : tz(`ub.act.gate.${grade}` as ZhOnlyKey);
}

/** 底栏小签上的一小段：在海上写“第 2/3 程”，报了写出发日，有能报的写“n 趟可报”。 */
export function voyageChipText(act: Pick<ActView, "voyage" | "voyages">): string {
  if (act.voyage) return tz("ub.act.voyage.leg", { i: act.voyage.leg + 1, n: act.voyage.legs });
  const list = act.voyages ?? [];
  const joined = list.find((v) => v.status === "joined");
  if (joined) return tz("ub.act.voyage.chipJoined", { date: `${joined.start[0]} 年 ${joined.start[1]} 月 ${joined.start[2]} 日` });
  // FIX7：只数现在报名期开着、能报的（status = open 且 registration_open 不是 false）；将来的（future）不算
  const open = list.filter((v) => v.status === "open" && v.registration_open !== false).length;
  return open > 0 ? tz("ub.act.voyage.chipOpen", { n: open }) : tz("ub.act.voyage.chipNone");
}

/**
 * U06F6：不出海的那几趟（数据 voyages/mio.toml：6a“溯川练小早”、6b“风后探沙脊”，回乡赶上野分，改成在四万十川与河口练船）。
 * 视图没有字段分得出“出不出海”（见交接：建议后端给 voyages[].at_sea），界面先按键认；界面上不写“出海 / 停靠”、不用海上的甲板图。
 */
export const INLAND_VOYAGES: ReadonlySet<string> = INLAND_VOYAGE_KEYS;
export const isInland = (key: string | null | undefined): boolean => !!key && INLAND_VOYAGES.has(key);

/** 报名从哪天起开：出发那一周往前数 4 周（同 act_voyage_registration_open：week < start ≤ week + 4）的周首。 */
export function registrationOpens(start: [number, number, number]): [number, number, number] {
  const ord = weekOrdinal(start) - 4;
  const year = Math.floor(ord / 48);
  const month = Math.floor((ord % 48) / 4) + 1;
  const day = (ord % 4) * 7 + 1;
  return [year, month, day];
}

/** 报了名 / 在海上的那几趟（周序用 actKit.weekOrdinal 的同一套）。 */
export function voyageWeeks(act: Pick<ActView, "voyages">): { key: string; ordinal: number; first: boolean; weeks: number }[] {
  const out: { key: string; ordinal: number; first: boolean; weeks: number }[] = [];
  for (const v of act.voyages ?? []) {
    if (v.status !== "joined" && v.status !== "sailing") continue;
    const start = weekOrdinal(v.start);
    for (let i = 0; i < v.weeks; i++) out.push({ key: v.key, ordinal: start + i, first: i === 0, weeks: v.weeks });
  }
  return out;
}

// ───────────── 小结 ─────────────

/**
 * 小结里 K3 的一行：家业这次的结果（失手 / 挣了多少）、到了里程的家业、听到的消息、认熟的货、升降级的人。
 * 家业的结果取 family_duty.last_result：后端只在“做家业的那一周”给，小结阶段周序已经进到下一周，真局里多半是 null（见交接）。
 */
export function summaryK3Chips(act: Pick<ActView, "family_duty" | "voyage" | "voyages">, k: ActSummaryK3 | null | undefined, names: ActNames, k3: K3Names): Chip[] {
  const out: Chip[] = [];
  // K3b：出海——归航那周写成绩与勋功；途中那几周写第几程
  const v = k?.voyage;
  if (v) {
    if (v.gate) {
      // 勋功与事迹分在 K2 那一行（summary.merit / score_delta）已经写了，这里只写成绩与这趟得的勋功
      out.push({
        key: "voy",
        text: `${tz(isInlandVoyage(act, v.key) ? "ub.act.sum.voyageInland" : "ub.act.sum.voyage", { name: names.voyage(v.key), grade: k3.gate(v.gate) })}${v.merit ? `（${tz("ub.act.sum.voyageMerit", { n: signed(v.merit) })}）` : ""}`,
        tone: v.gate === "fail" ? "down" : "up",
      });
    } else out.push({ key: "voy", text: tz("ub.act.sum.voyageLeg", { name: names.voyage(v.key), i: v.leg + 1, n: v.legs }) });
  }
  // 家业：U06K3a3 的 summary_k3.duty（随小结存）优先；没有再看 family_duty.last_result（只在做家业的那一周给）
  const d = k?.duty;
  if (d) {
    const duty = names.duty(d.key);
    if (d.success === false) out.push({ key: "duty", text: tz("ub.act.sum.dutyFailNamed", { duty }), tone: "down", title: tz("ub.act.duty.failed") });
    else out.push({ key: "duty", text: tz("ub.act.sum.dutyNamed", { duty, n: signed(d.cash) }), tone: d.cash > 0 ? "up" : undefined });
    if (d.fame) out.push({ key: "fame", text: tz("ub.act.sum.fame", { n: signed(d.fame) }), tone: d.fame > 0 ? "up" : "down" });
  } else {
    const r = act.family_duty?.last_result;
    if (r) {
      if (r.success === false) out.push({ key: "duty", text: tz("ub.act.sum.dutyFail"), tone: "down", title: tz("ub.act.duty.failed") });
      else if (r.cash) out.push({ key: "duty", text: tz("ub.act.sum.duty", { n: signed(r.cash) }), tone: r.cash > 0 ? "up" : "down" });
    }
  }
  if (!k) return out;
  for (const d of k.duty_milestones) out.push({ key: `ms:${d}`, text: tz("ub.act.sum.milestone", { duty: names.duty(d) }), tone: "up" });
  for (const c of k.rumors) out.push({ key: `r:${c}`, text: tz("ub.act.rumor.heard", { what: k3.rumorKey(c) }), tone: "up" });
  for (const g of k.goods) out.push({ key: `g:${g}`, text: tz("ub.act.sum.good", { good: k3.good(g) }), tone: "up" });
  for (const [who, [from, to]] of Object.entries(k.levels)) {
    if (from === to) continue;
    const up = to > from;
    out.push({ key: `lv:${who}`, text: tz(up ? "ub.act.sum.levelUp" : "ub.act.sum.levelDown", { who: names.person(who), n: to }), tone: up ? "up" : "down" });
  }
  return out;
}
