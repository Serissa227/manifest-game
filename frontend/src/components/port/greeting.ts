// 设施掌柜：头像参数、姓名、头衔与问候语。问候语模板在 i18n/zh-CN.port.ts，
// 按“地点 + 设施 + 日期”确定性挑选（同一天再进来还是同一句，隔天换一句），并嵌入当地数据。
// 数据为零时不说“眼下有 0 样货正走俏”：整个设施空着（没有航海士、没有委托、没有船厂……）换成设施的专门一句；
// 挑中的句子里某个计数为 0 时换成这句的零值说法（键为原句键加 `.zero`）。
import { styleOf, type ArchStyle } from "../../art/buildings";
import { keeperCast, type KeeperPlace } from "../../art/portraitCast";
import type { PortraitSpec } from "../../art/portraits";
import { hash32 } from "../../art/rng";
import { pct, tk } from "../../i18n";
import { zhCN } from "../../i18n/zh-CN";
import type { LocView, PortView } from "../../ipc/types";
import type { Facility } from "../../store/game";

/** 每种设施的常规问候句数（键为 portGreet.<设施>.0 .. n-1）。 */
export const GREETING_COUNT: Record<Facility, number> = {
  market: 5,
  shipyard: 4,
  tavern: 4,
  guild: 4,
  bank: 4,
  exchange: 4,
  warehouse: 4,
  invest: 4,
  office: 4,
};

/**
 * 问候语里的计数（与数值）占位符：句子里出现其中任何一个且它的值为 0 时，整句换成零值说法。
 * 声望 {rep} 可以为负数，只有恰好为 0（籍籍无名）时才换。
 */
export const GREETING_COUNTS = ["specialty", "popular", "count", "mates", "contracts", "used", "capacity", "rate", "loanRate", "dev", "rep"] as const;

export interface GreetingContext {
  /** 地点 key（种子） */
  locKey: string;
  /** 地名 */
  port: string;
  /** 所属势力名 */
  faction: string;
  /** 游戏日（第几天） */
  day: number;
  season: number;
  /** 主角姓名；没有时称“船长” */
  captain?: string | null;
  view: PortView;
}

/** 问候语的计数与数值（占位符 → 值），见 zh-CN.port.ts 顶部的说明。 */
export function greetingCounts(fac: Facility, v: PortView): Record<(typeof GREETING_COUNTS)[number], number> {
  return {
    specialty: v.market.filter((r) => r.specialty).length,
    popular: v.market.filter((r) => r.popular).length,
    // 交易所：这里出售的货（开放市场以本地特产为主；旧后端的行没有 sold，都算）
    count: fac === "shipyard" ? v.shipyard.length : v.market.filter((r) => r.sold !== false).length,
    mates: v.mates_here.length,
    contracts: v.contracts.filter((c) => c.status === "open").length,
    used: v.warehouse.used,
    capacity: v.warehouse.capacity,
    rate: v.bank.deposit_rate_bp,
    loanRate: v.bank.rate_bp,
    dev: v.invest.development,
    rep: v.office.reputation,
  };
}

/** 句子里值为 0 的计数占位符（按出现顺序）。 */
function zeroCounts(template: string, counts: Record<string, number>): string[] {
  const names = new Set<string>(GREETING_COUNTS);
  const out: string[] = [];
  for (const m of template.matchAll(/\{([^{}:]+)(?::[^{}]+)?\}/g)) {
    const name = m[1];
    if (names.has(name) && counts[name] === 0 && !out.includes(name)) out.push(name);
  }
  return out;
}

/**
 * 在字符串表 `table` 里为设施 `fac` 的第 `index` 句挑出最终的键：
 * 句中没有为 0 的计数时就是原句；否则用它的零值说法 `<原句键>.zero`；
 * 删掉了零值说法时，改用本设施里下一句没有零计数的常规句（都没有时仍用原句）。
 */
export function pickGreeting(table: Record<string, string>, fac: Facility, index: number, counts: Record<string, number>): string {
  const n = Math.max(1, GREETING_COUNT[fac]);
  const key = `portGreet.${fac}.${index % n}`;
  const text = table[key];
  if (text === undefined || zeroCounts(text, counts).length === 0) return key;
  const zero = `${key}.zero`;
  if (table[zero] !== undefined && zeroCounts(table[zero], counts).length === 0) return zero;
  for (let step = 1; step < n; step++) {
    const alt = `portGreet.${fac}.${(index + step) % n}`;
    if (table[alt] !== undefined && zeroCounts(table[alt], counts).length === 0) return alt;
  }
  return key;
}

/**
 * 问候语的模板键：数据为零时换成专门的一句（没有航海士、没有委托、没有船厂……，或句中计数为 0 时的零值说法）。
 * 挑选一律按中文表（英文表的键与占位符与它一一对应，见 i18n.test.ts），所以切换语言不会换成另一句，只是换一种语言说。
 */
export function greetingKey(fac: Facility, ctx: GreetingContext): string {
  const v = ctx.view;
  if (fac === "tavern" && v.mates_here.length === 0) return "portGreet.tavern.nomate";
  if (fac === "shipyard" && v.shipyard.length === 0) return "portGreet.shipyard.none";
  if (fac === "guild" && v.contracts.filter((c) => c.status === "open").length === 0) return "portGreet.guild.none";
  if (fac === "exchange" && v.exchange === null) return "portGreet.exchange.none";
  const n = GREETING_COUNT[fac];
  const i = hash32(`${ctx.locKey}|${fac}|${ctx.day}`) % n;
  return pickGreeting(zhCN as Record<string, string>, fac, i, greetingCounts(fac, v));
}

/** 掌柜的问候语（已填入当地数据）。 */
export function greeting(fac: Facility, ctx: GreetingContext): string {
  const v = ctx.view;
  const name = ctx.captain?.trim();
  const captain = name ? tk("portKeeperCaptainNamed", { name }) : tk("portKeeperCaptain");
  const c = greetingCounts(fac, v);
  return tk(greetingKey(fac, ctx), {
    port: ctx.port,
    captain,
    faction: ctx.faction,
    season: tk(`season.${ctx.season}`),
    specialty: c.specialty,
    popular: c.popular,
    count: c.count,
    mates: c.mates,
    contracts: c.contracts,
    rate: pct(c.rate),
    loanRate: pct(c.loanRate),
    used: c.used,
    capacity: c.capacity,
    dev: c.dev,
    rep: c.rep,
  });
}

/**
 * 掌柜所在的地点（港口与城市，不含殖民点）：key、海图坐标与文化（所属势力的建筑风格），给 keeperAssetId 让相邻港口换一位。
 * 只取决于静态数据，界面按静态数据缓存一次即可。
 */
export function keeperPlaces(locations: readonly LocView[], factions: readonly { key: string; style?: string | null }[]): KeeperPlace[] {
  return locations
    .filter((l) => l.kind !== "site")
    .map((l) => {
      const f = factions[l.faction];
      return { key: l.key, x: l.x, y: l.y, region: styleOf(f?.key, f?.style) };
    });
}

/**
 * 设施掌柜：肖像素材、回退用的头像参数、姓名与头衔。同一港口同一设施永远是同一个人。
 * 肖像按港口的文化与设施在 a / b / c 三位里取（三位都可选，见 portraitCast.keeperAssetId）；给了 places（keeperPlaces 的结果）
 * 就让每个港口与离它最近的两个同文化港口不是同一位。姓名、回退头像与头衔的称呼（酒馆老板 / 老板娘）都跟随肖像的性别（见 keeperCast）。
 * name 为中文音译、nameEn 为拉丁字母原形（两种语言对应同一个人）；头衔按当前语言。
 */
export function keeper(
  locKey: string,
  fac: Facility,
  region: ArchStyle,
  places?: readonly KeeperPlace[],
  style?: string | null,
): { spec: PortraitSpec; asset: string | null; name: string; nameEn: string; title: string } {
  const { asset, spec, name, nameEn } = keeperCast(locKey, fac, region, places, style);
  const title = spec.female && fac === "tavern" ? tk("portKeeperTitle.tavern.f") : tk(`portKeeperTitle.${fac}`);
  return { spec, asset, name, nameEn, title };
}
