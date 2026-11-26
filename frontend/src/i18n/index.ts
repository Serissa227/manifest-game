import type { Locale, WorldDate, WorldView } from "../ipc/types";
import { en } from "./en";
import { currentLocale } from "./locale";
import { zhCN, type StringKey } from "./zh-CN";

type Vars = Record<string, string | number>;

// ───────────────────────────── 语言与字符串表 ─────────────────────────────

/** 各语言的字符串表（en 与 zh-CN 的键、占位符一一对应，见 en.test.ts 与 translation.ts）。 */
const TABLES: Readonly<Record<Locale, Readonly<Record<string, string>>>> = {
  "zh-CN": zhCN,
  // L01F：中文的第二套剧情文本——界面字仍用中文那套表
  "zh-CN-x-gemini": zhCN,
  en,
};

/** 当前语言的字符串表（键缺失时由 lookup 回退到中文）。 */
export function activeTable(): Readonly<Record<string, string>> {
  return TABLES[currentLocale()] ?? zhCN;
}

/** 按当前语言取一条字符串；当前语言缺这个键时回退到中文，中文也没有时为 undefined。 */
export function lookup(key: string): string | undefined {
  const table = activeTable();
  if (Object.prototype.hasOwnProperty.call(table, key)) return table[key];
  const zh = zhCN as Readonly<Record<string, string>>;
  return Object.prototype.hasOwnProperty.call(zh, key) ? zh[key] : undefined;
}

/** 数字格式化用的语言标签。 */
function numberTag(): string {
  return currentLocale() === "en" ? "en-US" : "zh-CN";
}

/** 数字：按当前语言加千分位（两种语言都写作 12,345）。 */
export function num(v: number): string {
  return v.toLocaleString(numberTag());
}

/**
 * 小数：千分位、最多两位小数；不是有限数（空值）时写作“-”。
 * 图表提示框用：拟合与预测是小数，照图表库的默认写法会写出十几位。
 */
export function decimal(v: unknown): string {
  return typeof v === "number" && Number.isFinite(v) ? v.toLocaleString(numberTag(), { maximumFractionDigits: 2 }) : "-";
}

/** 列表：按当前语言的分隔符连接（中文“、”，英文“, ”）。 */
export function listJoin(items: readonly string[]): string {
  return items.join(lookup("listSep") ?? "、");
}

// ───────────────────────────── 世界配置：货币与纪年 ─────────────────────────────

/** 没有静态数据（或旧数据没有 world）时的默认货币与纪年。 */
export const DEFAULT_CURRENCY = "金币";
export const DEFAULT_START_YEAR = 1502;
/** 英文界面的默认货币与纪年（术语表 EXPANSION.md §12.2）。 */
export const DEFAULT_CURRENCY_EN = "gold";
export const DEFAULT_ERA = "航海历";
export const DEFAULT_ERA_EN = "Mariner's Reckoning";

/** 经典世界的日历：12 个月、每月 30 天（与 manifest_core::calendar 的缺省一致）。 */
const CLASSIC_MONTHS: readonly number[] = Array.from({ length: 12 }, () => 30);

let world: { currency: string; era: string; startYear: number; months: readonly number[]; monthNames: readonly string[] } = {
  currency: DEFAULT_CURRENCY,
  era: DEFAULT_ERA,
  startYear: DEFAULT_START_YEAR,
  months: CLASSIC_MONTHS,
  monthNames: [],
};

/**
 * 设置货币名称、纪年与世界日历（月长与月份名）（加载静态数据时由 store 调用；传空恢复默认）。
 * 第九批的世界按 calendar.months（如公历的 31、28、31……）；calendar.month_names 为空或与月数不等时不用月份名（日期写数字）。
 */
export function setWorld(w: Partial<WorldView> | null | undefined): void {
  const months = w?.calendar?.months?.filter((m) => Number.isFinite(m) && m > 0) ?? [];
  const usable = months.length > 0 ? months : CLASSIC_MONTHS;
  const names = (w?.calendar?.month_names ?? []).map((n) => (typeof n === "string" ? n.trim() : ""));
  world = {
    currency: w?.currency?.trim() || DEFAULT_CURRENCY,
    era: w?.era?.trim() || DEFAULT_ERA,
    startYear: typeof w?.start_year === "number" && Number.isFinite(w.start_year) ? w.start_year : DEFAULT_START_YEAR,
    months: usable,
    monthNames: names.length === usable.length && names.every((n) => n.length > 0) ? names : [],
  };
}

/** 世界日历的第 month 月（1 起）的名字；日历没有月份名时为 null（日期写数字）。 */
export function monthName(month: number): string | null {
  return world.monthNames[month - 1] ?? null;
}

/** 当前世界一年的天数。 */
export function yearDays(): number {
  return world.months.reduce((a, b) => a + b, 0);
}

/** 当前世界日历每月的天数（经典世界 12 × 30）。 */
export function monthLengths(): readonly number[] {
  return world.months;
}

/** 含汉字（或全角符号）的文字：英文界面遇到时说明后端还没有给出英文，换成英文的默认写法。 */
function hasCjk(s: string): boolean {
  return /[\u3000-\u9fff\uf900-\ufaff\uff00-\uffef]/.test(s);
}

/** 当前的货币名称（中文界面如“金币”；英文界面为 statics 给出的英文，后端尚未翻译时为 “gold”）。 */
export function currency(): string {
  if (currentLocale() === "en" && hasCjk(world.currency)) return DEFAULT_CURRENCY_EN;
  return world.currency;
}

/**
 * 纪年名称（中文界面如“航海历”；英文界面为 statics 给出的英文，后端尚未翻译时为 “Mariner's Reckoning”）。
 * era 缺省时取当前静态数据的纪年。
 */
export function eraName(era?: string | null): string {
  const e = era?.trim() || world.era;
  if (currentLocale() === "en" && hasCjk(e)) return DEFAULT_ERA_EN;
  return e;
}

/** 年序（从 1 开始）→ 纪年年份：start_year + year − 1。 */
export function calendarYear(year: number): number {
  return world.startYear + year - 1;
}

/** 日期的组成部分（Overview 的字段）；calendar_year 缺失时由年序推算。 */
export interface DateParts {
  year: number;
  month: number;
  date: number;
  calendar_year?: number | null;
}

/** 绝对天数（从 0 起算）→ 日期的组成部分。 */
export function dayParts(day: number): DateParts {
  const d = Math.max(0, Math.floor(day));
  const len = yearDays();
  let rest = d % len;
  let month = 1;
  for (const m of world.months) {
    if (rest < m) break;
    rest -= m;
    month += 1;
  }
  return { year: Math.floor(d / len) + 1, month, date: rest + 1 };
}

/**
 * 日期文字：中文“1502年1月13日”，英文 “13 Mar 1502”。年份优先用 calendar_year，缺失时用 start_year + year − 1。
 * 世界日历有月份名时写月份名（“1502年雾月13日” / “13 Fogmonth 1502”）。
 */
export function dateText(d: DateParts): string {
  const year = typeof d.calendar_year === "number" ? d.calendar_year : calendarYear(d.year);
  const name = monthName(d.month);
  if (name) return t("layout.dateFullNamed", { year, month: name, date: d.date });
  return t("dateFull", { year, month: d.month, date: d.date });
}

/** 短日期（手机顶栏）：“1月13日” / “13 Jan”；有月份名时写月份名。 */
export function dateShortText(month: number, date: number): string {
  const name = monthName(month);
  return name ? t("layout.dateShortNamed", { month: name, date }) : t("layout.dateShort", { month, date });
}

/**
 * 概览的日期（UI-CONTRACT I1）：后端给了世界日历的当天 world_date [年, 月, 日] 时以它为准，
 * 旧后端没有时照旧用 year / month / date / calendar_year。
 */
export function overviewDate(o: DateParts & { world_date?: WorldDate | null }): DateParts {
  const w = o.world_date;
  if (Array.isArray(w) && w.length === 3 && w.every((x) => typeof x === "number" && Number.isFinite(x))) {
    return { year: o.year, calendar_year: w[0], month: w[1], date: w[2] };
  }
  return o;
}

/** 日期加季节：中文“1502年1月13日（春）”，英文 “13 Mar 1502 (Spring)”。 */
export function dateSeasonText(d: DateParts, season: number): string {
  return t("dateSeason", { date: dateText(d), season: tk(`season.${season}`) });
}

/** 绝对天数 → 日期文字（例如限期、建立日、发现日）。 */
export function dayDate(day: number): string {
  return dateText(dayParts(day));
}

// ───────────────────────────── 占位符 ─────────────────────────────

/**
 * 替换占位符。
 * - `{name}`：替换为 vars.name；vars 里没有时原样保留。
 * - `{cur}`：没有显式给出时自动填当前货币名称（中文“金币”，英文 “gold”）。
 * - 带格式说明的占位符 `{name:格式}`，vars.name 按格式转换后填入：
 *   - `{name:cal}`   年序（从 1 开始）→ 纪年年份，如 1 → 1502
 *   - `{name:date}`  绝对天数 → 日期文字，如 12 → “1502年1月13日” / “13 Jan 1502”
 *   - `{name:money}` 数字 → 金额文字，如 4000 → “4,000 金币” / “4,000 gold”
 *   - `{name:num}`   数字 → 带千分位的数字，如 12345 → “12,345”
 *   - `{name:bp}`    万分数 → 百分数文字，如 10500 → “105%”
 *   - `{name:@前缀}` 查表 `前缀.值`（表中没有时用原值），如 `{reason:@colonyLoss}` + abandoned → “colonyLoss.abandoned”的文字；
 *     英文日期用 `{month:@month}` 把月份数字换成 “Jan”…“Dec”
 *   - `{name:plural(单数,复数)}` 数字 + 名词的单复数（英文用），如 `{n:plural(day,days)}`：1 → “1 day”，3 → “3 days”
 */
function fill(text: string, vars?: Vars): string {
  if (!text.includes("{")) return text;
  return text.replace(/\{([^{}:]+)(?::([^{}]+))?\}/g, (whole, name: string, spec: string | undefined) => {
    const v = vars?.[name] ?? (name === "cur" ? currency() : undefined);
    if (v === undefined) return whole;
    if (!spec) return String(v);
    return format(v, spec);
  });
}

function format(v: string | number, spec: string): string {
  const n = typeof v === "number" ? v : Number(v);
  switch (spec) {
    case "cal":
      return Number.isFinite(n) ? String(calendarYear(n)) : String(v);
    case "date":
      return Number.isFinite(n) ? dayDate(n) : String(v);
    case "money":
      return Number.isFinite(n) ? money(n) : String(v);
    case "num":
      return Number.isFinite(n) ? num(n) : String(v);
    case "bp":
      return Number.isFinite(n) ? `${pct(n, 1)}%` : String(v);
    default: {
      if (spec.startsWith("@")) return lookup(`${spec.slice(1)}.${v}`) ?? String(v);
      const plural = /^plural\(([^,()]*),([^,()]*)\)$/.exec(spec);
      if (plural) return `${String(v)} ${Number.isFinite(n) && Math.abs(n) === 1 ? plural[1] : plural[2]}`;
      return String(v);
    }
  }
}

/** 取界面字符串（按当前语言，缺键回退中文）；`vars` 中的 `{name}` 占位符会被替换（格式说明见 fill）。 */
export function t(key: StringKey, vars?: Vars): string {
  return fill(lookup(key) ?? zhCN[key], vars);
}

/**
 * 先只写了中文的界面字符串（i18n/zhOnly.ts）：中英两张表里有这个键时照表取（以后补了英文、把键搬进两张表就自动用上），
 * 否则用给出的中文。中英两张表的键必须一一对应（en.test.ts、translation.ts），“先不写英文”的新文案不能只进中文表。
 */
export function tzh(key: string, zh: string, vars?: Vars): string {
  return fill(lookup(key) ?? zh, vars);
}

/** 取动态组合的键（如 `account.Cash`）；两种语言的表中都没有时返回键名本身。 */
export function tk(key: string, vars?: Vars): string {
  return fill(lookup(key) ?? key, vars);
}

/** 金额：千分位 + 货币单位（中文 “12,345 金币”，英文 “12,345 gold”，不加复数）。 */
export function money(v: number): string {
  return t("unitMoney", { v: num(Math.round(v)) });
}

/** 万分之一 → 百分数文字。 */
export function pct(bp: number, digits = 2): string {
  return String(Number((bp / 100).toFixed(digits)));
}

// ───────────────────────────── 专名：当前语言与另一种写法 ─────────────────────────────

/** 带英文正名的专名（静态数据与视图的 name / name_en）。 */
export interface Named {
  name: string;
  /** 英文正名；旧后端或玩家自己起的名字没有 */
  name_en?: string | null;
}

/**
 * 专名在当前语言下的写法：英文界面优先用英文正名（name_en），中文界面用 name。
 * 后端按当前语言给 name（EXPANSION.md §12.3），英文界面下两者通常相同；name_en 缺失时一律用 name。
 */
export function nameOf(v: Named | null | undefined): string {
  if (!v) return "";
  const en = v.name_en?.trim();
  return currentLocale() === "en" && en ? en : v.name;
}

/** 专名的另一种写法（表格、列表、句子里悬停提示用）：中文界面给英文正名；与正文相同或没有时为 undefined。 */
export function otherName(v: Named | null | undefined): string | undefined {
  if (!v) return undefined;
  const en = v.name_en?.trim();
  if (!en || currentLocale() === "en" || en === v.name) return undefined;
  return en;
}

export { currentLocale, detectLocale, setLocale, useLocale } from "./locale";
export type { StringKey };
