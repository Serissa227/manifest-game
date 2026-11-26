// 从游戏状态的变化看出该响什么（纯函数，测试直接检查）：比较前后两次概览——现金、货舱、船、船员、粮水、速度、海盗的遭遇；
// 另外按卷轴提示与错误的文字认出存档、读档与“钱不够”。交易所、造船厂、雇船员这些界面的代码一行不改，声音全靠状态的差。
//
// 规则：
// - 读档、新开局、日子倒退或一次跳过 5 天以上时不算（与短乐句的时机同一个判断，见 cues.ts）；
// - 玩家自己的操作（买卖、修船、买船、雇人、补给、存取款、改速度）要“刚才有过用户操作”才响：
//   游戏运行时每天的结算也会动现金，没有这一条的话高倍速下会不停地响；
// - 出港、入港、海盗的遭遇自动结算（远处的炮声）不要求用户操作——它们本来就是游戏里发生的事。
import { zhCN } from "../../i18n/zh-CN";
import { en } from "../../i18n/en";
import type { CargoLine, Overview } from "../../ipc/types";

/**
 * 概览的变化里认出来的事。sale（卖出一种货）由调用方再按“一串”决定响“卖出”还是“全部卖出”；
 * saleMany 是同一次更新里卖掉了好几种货（将来交易所若改成一条命令卖光全部，也照样是“全部卖出”）。
 */
export type StateEvent =
  | "sale"
  | "saleMany"
  | "buy"
  | "pay"
  | "receive"
  | "depart"
  | "arrive"
  | "repair"
  | "shipyard"
  | "hire"
  | "resupply"
  | "pause"
  | "resume"
  | "speedUp"
  | "speedDown"
  | "volley";

/** 前后两次概览是不是同一局里接连的两刻（读档、新开局、日子倒退、一次跳过好几天都不是）。 */
export function continuous(prev: Overview, next: Overview): boolean {
  if (prev.scenario !== next.scenario || next.day < prev.day || next.day - prev.day > 5) return false;
  const a = prev.fleets[0];
  const b = next.fleets[0];
  return !a || !b || a.id === b.id;
}

type Holder = { id: string; cargo: readonly CargoLine[] };

function holders(o: Overview): Holder[] {
  return [...o.fleets.map((f) => ({ id: `f${f.id}`, cargo: f.cargo })), ...o.caravans.map((c) => ({ id: `c${c.id}`, cargo: c.cargo }))];
}

/** 各舰队、商队货舱的变化：增加的件数与减少的件数（按持有者与货物逐项比），以及减少了的有几项（持有者 × 货物）。 */
export function cargoMoves(prev: Overview, next: Overview): { up: number; down: number; lines: number } {
  const before = new Map<string, number>();
  const after = new Map<string, number>();
  for (const h of holders(prev)) for (const l of h.cargo) before.set(`${h.id}:${l.good}`, (before.get(`${h.id}:${l.good}`) ?? 0) + l.qty);
  for (const h of holders(next)) for (const l of h.cargo) after.set(`${h.id}:${l.good}`, (after.get(`${h.id}:${l.good}`) ?? 0) + l.qty);
  let up = 0;
  let down = 0;
  let lines = 0;
  for (const k of new Set([...before.keys(), ...after.keys()])) {
    const d = (after.get(k) ?? 0) - (before.get(k) ?? 0);
    if (d > 0) up += d;
    else if (d < 0) {
      down -= d;
      lines++;
    }
  }
  return { up, down, lines };
}

const shipCount = (o: Overview) => o.fleets.reduce((a, f) => a + f.ships.length, 0);
const refitCount = (o: Overview) => o.fleets.reduce((a, f) => a + f.ships.reduce((b, s) => b + (s.refits?.length ?? 0), 0), 0);

/**
 * 两次概览之间发生的、要出声的事（可能有几件，按先后列出）。gesture：刚才（几秒内）有过用户操作。
 */
export function stateEvents(prev: Overview | null | undefined, next: Overview | null | undefined, gesture: boolean): StateEvent[] {
  if (!prev || !next || prev === next || !continuous(prev, next)) return [];
  const out: StateEvent[] = [];
  const cash = next.cash - prev.cash;
  // 出港、入港：只看旗舰队（与短乐句一致）
  const a = prev.fleets[0];
  const b = next.fleets[0];
  if (a && b) {
    if (a.docked !== null && b.docked === null) out.push("depart");
    if (a.docked === null && b.docked !== null) out.push("arrive");
  }
  // 海盗的遭遇自动结算了（没有转成战术海战）：远处一阵炮声
  const pendingGone = prev.pending_battles.some((p) => !next.pending_battles.some((q) => q.id === p.id));
  const tacticalNew = next.tactical_battles.some((id) => !prev.tactical_battles.includes(id));
  if (pendingGone && !tacticalNew) out.push("volley");
  if (!gesture) return out;
  // 玩家的操作
  if (prev.speed !== next.speed) {
    if (next.speed === 0) out.push("pause");
    else if (prev.speed === 0) out.push("resume");
    else out.push(next.speed > prev.speed ? "speedUp" : "speedDown");
  }
  // 交易：现金增加、货舱只减不增是卖出；现金减少、货舱只增不减是买入（两边都动、现金不变的是转运）
  const moves = cargoMoves(prev, next);
  const sale = cash > 0 && moves.down > 0 && moves.up === 0;
  if (sale) out.push(moves.lines >= 2 ? "saleMany" : "sale");
  else if (cash < 0 && moves.up > 0 && moves.down === 0) out.push("buy");
  // 船：买船、建舰队、改装（花钱）；卖船（收钱）
  const ships = shipCount(next) - shipCount(prev);
  if (ships > 0 && cash < 0) out.push("shipyard");
  else if (ships < 0 && cash > 0 && !sale) out.push("receive");
  else if (refitCount(next) > refitCount(prev) && cash < 0) out.push("shipyard");
  // 停在港口的舰队：修船、雇人（或解雇）、补给粮水
  let repaired = false;
  let crewed = false;
  let supplied = false;
  for (const f of next.fleets) {
    const p = prev.fleets.find((x) => x.id === f.id);
    if (!p || f.docked === null || p.docked === null) continue;
    const hp = (v: typeof f) => v.ships.reduce((s, x) => s + x.durability, 0);
    // 船的数目没变、耐久涨了才是修船（买了一条新船耐久也会“涨”）
    if (f.ships.length === p.ships.length && hp(f) > hp(p) && cash < 0) repaired = true;
    if (f.crew > p.crew && cash < 0) crewed = true;
    if (f.crew < p.crew && p.ships.length === f.ships.length) crewed = true;
    if ((f.food > p.food || f.water > p.water) && cash < 0) supplied = true;
  }
  if (repaired) out.push("repair");
  if (crewed) out.push("hire");
  if (supplied) out.push("resupply");
  // 银行：存款、还贷（付钱）；取款、借款（收钱）。要求存款或贷款的变化与现金的变化相抵（利息只动一边，不算）
  const deposit = next.deposit - prev.deposit;
  const loans = next.loans - prev.loans;
  const matches = (a: number, b: number) => a !== 0 && Math.abs(a - b) <= Math.max(1, Math.abs(a) * 0.05);
  if (cash < 0 && (matches(deposit, -cash) || matches(-loans, -cash))) out.push("pay");
  if (cash > 0 && (matches(-deposit, cash) || matches(loans, cash))) out.push("receive");
  return out;
}

// ───────────────────────────── 卷轴提示与错误的文字

/** 把带 {占位符} 的模板变成匹配整句的正则（占位符匹配任意文字）。 */
function templateRx(tpl: string): RegExp {
  const parts = tpl.split(/\{[^}]+\}/).map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  return new RegExp(`^${parts.join("[\\s\\S]*")}$`);
}

const TABLES = [zhCN as Readonly<Record<string, string>>, en as Readonly<Record<string, string>>];
const rx = (key: string) => TABLES.map((t) => t[key]).filter((s): s is string => typeof s === "string").map(templateRx);
const SAVED = rx("saved");
const LOADED = rx("loaded");
const NO_CASH = rx("mk.noCash");
/** 后端的“现金不足”（data/texts.toml 与 data/locales/en/texts.toml 的 insufficient_cash） */
const NO_CASH_BACKEND = /^(现金不足|现金不够|Not enough (gold|cash))/i;

/** 卷轴提示对应的音效：存档、读档；其余为一般的提示。 */
export function messageEvent(message: string): "save" | "load" | "notify" {
  if (SAVED.some((r) => r.test(message))) return "save";
  if (LOADED.some((r) => r.test(message))) return "load";
  return "notify";
}

/** 错误对应的音效：钱不够是空钱袋，其余为“被拒”。 */
export function errorEvent(error: string): "broke" | "error" {
  return NO_CASH.some((r) => r.test(error)) || NO_CASH_BACKEND.test(error) ? "broke" : "error";
}

/** 航海日志里新出现的提醒（按种类与参数认；已经在的不算）。 */
export function newNotices(prev: Overview | null | undefined, next: Overview | null | undefined): number {
  if (!prev || !next || !continuous(prev, next)) return 0;
  const key = (n: { kind: string; args: [string, string][] }) => `${n.kind}:${n.args.map(([k, v]) => `${k}=${v}`).join(",")}`;
  const kinds = (n: { kind: string }) => n.kind;
  const had = new Set(prev.notices.map(kinds));
  const seen = new Set(prev.notices.map(key));
  // 同一种提醒只是数字变了（例如“粮水不足 4 天”→“3 天”）不算新的
  return next.notices.filter((n) => !seen.has(key(n)) && !had.has(n.kind)).length;
}
