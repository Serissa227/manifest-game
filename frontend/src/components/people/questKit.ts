// 任务视图（R10-Q01 契约 4）的出字与排序（R10-Q02）：后端只给“种类 + 参数”，这里按种类写成短句。
// 句子在 i18n/zhOnly.ts 的 quest.* 键（先只写中文）。数量用“一、两、三……十”，再多写阿拉伯数字。
// 地点看不见（hide_unknown_ports）时后端给 null，这里写“一个还没找到的地方”，不泄露。
import { dateShortText, dateText, money, num } from "../../i18n";
import { ZH_ONLY, tz, type ZhOnlyKey } from "../../i18n/zhOnly";
import type {
  QuestFailure,
  QuestImplicitRow,
  QuestKind,
  QuestPin,
  QuestPlace,
  QuestReward,
  QuestRow,
  QuestStatus,
  QuestView,
  WorldDate,
} from "../../ipc/types";

/** 任务日志里各组的先后（契约 4 的 QuestKind）。 */
export const QUEST_KINDS: readonly QuestKind[] = ["main", "guide", "character", "request", "contract", "annual_goal", "history"];

const CN = ["零", "一", "两", "三", "四", "五", "六", "七", "八", "九", "十"];

/** 句子里的数量：1–10 写汉字（“买一回货”“添两条船”），再多写阿拉伯数字、两边空一格（“买 12 回货”）。 */
export function countWord(n: number): string {
  const k = Math.max(0, Math.round(n));
  return k >= 1 && k <= 10 ? CN[k] : ` ${num(k)} `;
}

/** 把句子里因为数量两边的空格挤出来的多余空白收拾掉。 */
function tidy(s: string): string {
  return s.replace(/\s{2,}/g, " ").trim();
}

function zh(key: string, vars?: Record<string, string | number>): string {
  return tidy(tz(key as ZhOnlyKey, vars));
}

/** 有没有这一句（种类没写到的键回退到通用的说法）。 */
function hasKey(key: string): boolean {
  return key in ZH_ONLY;
}

export function kindName(kind: QuestKind): string {
  return zh(`quest.kind.${kind}`);
}

export function statusName(status: QuestStatus): string {
  return zh(`quest.status.${status}`);
}

/** 地点的名字；看不见的地方写“一个还没找到的地方”。 */
export function placeName(p: QuestPlace | null | undefined): string {
  return p?.label ?? tz("quest.row.somewhere");
}

/** 日子：同一年写“1月7日”，跨年写全（“1558年1月7日”）。 */
export function questDate(d: WorldDate, nowYear: number | null): string {
  const [y, m, day] = d;
  return nowYear === y ? dateShortText(m, day) : dateText({ year: y, calendar_year: y, month: m, date: day });
}

/** 显式目标行的句子（数据里写了 text 时用数据里的）。 */
export function rowText(r: QuestRow): string {
  if (r.text) return r.text;
  const p = r.params;
  const L = r.labels ?? {};
  const place = placeName(r.place);
  const someone = L.person ?? tz("quest.row.someone");
  const something = (k: string) => L[k] ?? tz("quest.row.something");
  const ge = p.ge ?? r.need;
  switch (r.kind) {
    case "deliver":
      return r.place ? zh("quest.row.deliver", { qty: countWord(p.qty ?? r.need), good: something("good"), place }) : zh("quest.row.deliverHere", { qty: countWord(p.qty ?? r.need), good: something("good") });
    case "item":
      return (p.qty ?? 1) > 1 ? zh("quest.row.itemQty", { qty: countWord(p.qty ?? 1), item: something("item") }) : zh("quest.row.item", { item: something("item") });
    case "at":
      return zh("quest.row.at", { place });
    case "person":
      return zh("quest.row.person", { person: someone });
    case "affinity":
      return zh("quest.row.affinity", { person: someone, ge });
    case "cash":
      return zh("quest.row.cash", { money: money(ge) });
    case "fame":
      return zh("quest.row.fame", { ge: num(ge) });
    case "wait":
      return zh("quest.row.wait", { n: countWord(p.days ?? r.need) });
    case "battle":
      return zh("quest.row.battle", { n: countWord(p.wins ?? r.need) });
    case "discovery":
      return zh(p.reported ? "quest.row.discoveryReported" : "quest.row.discovery", { discovery: something("discovery") });
    case "attr":
      return zh("quest.row.attr", { attr: something("attr"), ge });
    case "growth":
      return zh("quest.row.growth", { attr: something("attr"), ge });
    case "skill":
      return zh("quest.row.skill", { skill: something("skill"), ge });
    case "bond":
      return zh("quest.row.bond", { person: someone, level: p.level ?? "C" });
    case "visited":
      return r.place ? zh("quest.row.visitedAt", { place }) : zh("quest.row.visitedCount", { n: countWord(ge) });
    case "ports_known":
      return zh("quest.row.portsKnown", { n: countWord(ge) });
    case "house_level":
      return r.place ? zh("quest.row.houseAt", { place, ge }) : zh("quest.row.houseAny", { ge });
    case "warehouse":
      if (r.place) return zh("quest.row.warehouseAt", { place });
      return p.ge && p.ge > 1 ? zh("quest.row.warehouseCount", { n: countWord(p.ge) }) : zh("quest.row.warehouse");
    case "industries":
      if (r.place) return zh("quest.row.industriesAt", { place, n: countWord(ge) });
      return L.industry ? zh("quest.row.industriesKind", { n: countWord(ge), industry: L.industry }) : zh("quest.row.industries", { n: countWord(ge) });
    case "ships":
      return zh("quest.row.ships", { n: countWord(ge) });
    case "ship_tier":
      // 船价分档从 0 数（0 档最便宜）；0 档写“有一条船”
      return ge <= 0 ? zh("quest.row.ships", { n: countWord(1) }) : zh("quest.row.shipTier", { ge });
    case "mates":
      return zh("quest.row.mates", { n: countWord(ge) });
    case "post":
      return zh("quest.row.post", { post: something("post") });
    case "rank":
      // 货档从 0 数：0 粗货、1 行货、2 细货、3 珍货（与交易所里的叫法一样）
      return zh("quest.row.rank", { place, rank: tz(rankKey(ge)) });
    case "deed":
      return deedText(p.deed ?? "", r.need);
    case "any":
      return anyText(r);
    default:
      return tz("quest.row.unknown");
  }
}

/** “任一”行：分支一句接一句，中间写“或者”（任务日志里分支另起一行列出，见 anyBranches）。 */
export function anyText(r: QuestRow): string {
  const list = r.any ?? [];
  if (list.length === 0) return tz("quest.row.unknown");
  return list.map(rowText).join(tz("quest.row.anyOr"));
}

/** “任一”行的分支（不是 any 行时为空）。 */
export function anyBranches(r: QuestRow): QuestRow[] {
  return r.kind === "any" ? (r.any ?? []) : [];
}

/** 货档的叫法（与交易所 panels/trade.ts 的 rankKey 同一套键）。 */
function rankKey(rank: number): ZhOnlyKey {
  const k = Math.max(0, Math.min(3, Math.floor(rank)));
  return `mk.rank.${k}` as ZhOnlyKey;
}

/** 没办成的原因（Q01b 的失败码；不认识的码当 other）。 */
export function failureText(code: QuestFailure | string | null | undefined): string | null {
  if (!code) return null;
  const key = `quest.failure.${code}`;
  return zh(hasKey(key) ? key : "quest.failure.other");
}

/** 做过某件事 N 次（契约 3 的键表；没写到的键用通用的说法）。 */
export function deedText(deed: string, n: number): string {
  const key = `quest.deed.${deed}`;
  return zh(hasKey(key) ? key : "quest.deed.unknown", { n: countWord(n) });
}

/** 计数型的行写“2/5”；“是否”型（need 为 1）、“任一”的父行与做完了的不写。 */
export function rowProgress(r: QuestRow): string | null {
  if (r.done || r.need <= 1) return null;
  if (r.kind === "cash" || r.kind === "any") return null;
  return tz("quest.progress", { done: num(Math.min(r.have, r.need)), total: num(r.need) });
}

/** 隐式行的句子。 */
export function implicitText(r: QuestImplicitRow, nowYear: number | null): string {
  switch (r.kind) {
    case "go_to":
      return zh(r.done ? "quest.implicit.go_toDone" : "quest.implicit.go_to", { place: placeName(r.place) });
    case "wait_until":
      return r.days > 0
        ? zh("quest.implicit.wait_untilDays", { date: questDate(r.date, nowYear), n: countWord(r.days) })
        : zh("quest.implicit.wait_until", { date: questDate(r.date, nowYear) });
    case "days_left":
      return zh("quest.implicit.days_left", { date: questDate(r.date, nowYear) });
  }
}

/** 一行（显式或隐式）是不是显式的目标行。 */
export function isExplicit(r: QuestRow | QuestImplicitRow): r is QuestRow {
  return "params" in r;
}

/** 追踪条上那一行的句子。 */
export function anyRowText(r: QuestRow | QuestImplicitRow, nowYear: number | null): string {
  return isExplicit(r) ? rowText(r) : implicitText(r, nowYear);
}

/** 奖励的一小段。 */
export function rewardText(r: QuestReward): string {
  switch (r.kind) {
    case "cash":
      return zh("quest.reward.cash", { money: money(r.value) });
    case "fame":
      return zh("quest.reward.fame", { v: num(r.value) });
    case "reputation":
      return zh("quest.reward.reputation", { label: r.label ?? r.faction, v: num(r.value) });
    case "item":
      return r.qty > 1 ? zh("quest.reward.itemQty", { label: r.label ?? r.item, qty: r.qty }) : zh("quest.reward.item", { label: r.label ?? r.item });
    case "chart":
      return zh("quest.reward.chart", { label: r.label ?? r.region });
    case "skill":
      return zh("quest.reward.skill", { label: r.label ?? r.skill, v: num(r.value) });
    case "growth":
      return zh("quest.reward.growth", { label: r.label ?? r.attr, v: num(r.value) });
    case "join":
      return zh("quest.reward.join", { label: r.label ?? r.person });
    case "memory":
      return zh("quest.reward.memory");
    case "penalty":
      return zh("quest.reward.penalty", { money: money(r.value) });
  }
}

/** 面板键的显示名（mechanics.toml 的 panels）；不认识的键原样。 */
export function panelName(key: string): string {
  const k = `quest.panel.${key}`;
  return hasKey(k) ? zh(k) : key;
}

/** 玩法键的显示名（mechanics.toml 的 mechanics）；不认识的键原样。 */
export function mechanicName(key: string): string {
  const k = `quest.mech.${key}`;
  return hasKey(k) ? zh(k) : key;
}

/** 任务的标题：轨道名；委托写“委托 · 货名”；年度目标写“今年的目标”。 */
export function questTitle(q: { kind: QuestKind; title: string | null; rows?: readonly QuestRow[]; row?: QuestRow | QuestImplicitRow | null }): string {
  if (q.title) return q.title;
  if (q.kind === "contract") {
    const row = q.rows?.[0] ?? (q.row && isExplicit(q.row) ? q.row : null);
    const good = row?.labels?.good;
    return good ? zh("quest.title.contract", { good }) : zh("quest.title.contractPlain");
  }
  if (q.kind === "annual_goal") return zh("quest.title.goal");
  return zh("quest.title.untitled");
}

/** 任务日志里一条的“眼下这一行”：第一条没完成的显式行，都完成了取第一条没完成的隐式行。 */
export function nextRow(q: QuestView): QuestRow | QuestImplicitRow | null {
  return q.rows.find((r) => !r.done) ?? q.implicit.find((r) => r.kind !== "go_to" || !r.done) ?? null;
}

/** 还在办（进行中、等时机）。 */
export function isOpen(q: { status: QuestStatus }): boolean {
  return q.status === "active" || q.status === "waiting";
}

/** 任务日志的排序：置顶的在前；进行中先于等时机；有期限的按剩余天数；再按标题。 */
export function sortQuests(list: readonly QuestView[]): QuestView[] {
  const rank: Record<QuestStatus, number> = { active: 0, waiting: 1, done: 2, missed: 3, failed: 4 };
  const left = (q: QuestView) => q.days_left ?? Infinity;
  return [...list].sort(
    (a, b) =>
      Number(b.pinned) - Number(a.pinned) ||
      rank[a.status] - rank[b.status] ||
      left(a) - left(b) ||
      questTitle(a).localeCompare(questTitle(b), "zh-CN") ||
      a.id.localeCompare(b.id),
  );
}

/** 按种类分组（只留有条目的组，顺序照 QUEST_KINDS；不认识的种类排在最后）。 */
export function groupQuests(list: readonly QuestView[]): { kind: QuestKind; items: QuestView[] }[] {
  const out = new Map<QuestKind, QuestView[]>();
  for (const q of sortQuests(list)) {
    const arr = out.get(q.kind) ?? [];
    arr.push(q);
    out.set(q.kind, arr);
  }
  const order = (k: QuestKind) => {
    const i = QUEST_KINDS.indexOf(k);
    return i < 0 ? QUEST_KINDS.length : i;
  };
  return [...out.entries()].sort(([a], [b]) => order(a) - order(b)).map(([kind, items]) => ({ kind, items }));
}

/** 剩余天数的一小段（今天到期 / 还剩 N 天）；没有期限为 null。 */
export function daysLeftText(days: number | null | undefined): string | null {
  if (typeof days !== "number") return null;
  return days <= 0 ? tz("quest.dueToday") : tz("quest.daysLeft", { n: days });
}

/** 快到期了（十天以内）。 */
export function urgent(days: number | null | undefined): boolean {
  return typeof days === "number" && days <= 10;
}

/**
 * 追踪条上值得写出来的那一行：后端在显式行都做完时取第一条隐式行，可能是“人已在某地”——那一句不算还要做的事，不写
 * （目标文字 hint 已经写在上面）。
 */
export function pinRow(pin: Pick<QuestPin, "row">): QuestRow | QuestImplicitRow | null {
  const r = pin.row;
  if (!r) return null;
  if (!isExplicit(r) && r.kind === "go_to" && r.done) return null;
  return r;
}

/** 置顶任务的“去处”：go.port，其次眼下这一行的地点、去某地的隐式行。没有、或地方还看不见时为 null。 */
export function pinPlace(pin: Pick<QuestPin, "go" | "row"> | null | undefined): QuestPlace | null {
  if (!pin) return null;
  const fromRow = pin.row ? (isExplicit(pin.row) ? pin.row.place : pin.row.kind === "go_to" ? pin.row.place : null) : null;
  const p = pin.go?.port ?? fromRow ?? null;
  return p && p.loc !== null ? p : null;
}
