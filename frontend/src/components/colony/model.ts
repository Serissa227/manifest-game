// 殖民地界面的纯计算：建筑定义查询、产量换算、税率与袭击风险估算、士气因素、建议的殖民地名称、
// 建立殖民地的条件检查，以及殖民点 / 殖民地街景的输入。不碰 DOM，测试可直接调用。
import { styleOf } from "../../art/buildings";
import { PLAYER_FLAG } from "../../art/map";
import { P } from "../../art/palette";
import { hash32 } from "../../art/rng";
import { t, tk } from "../../i18n";
import type {
  ColoniesView,
  ColonyBuildingView,
  ColonyView,
  FleetView,
  Overview,
  SiteClaimView,
  SiteView,
  StaticView,
} from "../../ipc/types";
import type { ColonySceneInput } from "../port/params";
import { locById } from "../../ipc/byId";

/** 殖民地名称的长度上限（与内核一致：1–16 个字）。 */
export const COLONY_NAME_MAX = 16;

/** 建筑定义；id 越界时为 undefined。 */
export function buildingDef(statics: StaticView, id: number): ColonyBuildingView | undefined {
  return statics.colony_buildings[id];
}

/** 由建筑 key 找建筑 id（街景热点报告的是 key）。 */
export function buildingIdOf(statics: StaticView, key: string): number | null {
  const b = statics.colony_buildings.find((d) => d.key === key);
  return b ? b.id : null;
}

/** 每天件数 × 10000 → 显示用的数字（最多一位小数）。 */
export function perDay(q10000: number): string {
  const v = Math.round(q10000 / 1000) / 10;
  return Number.isInteger(v) ? String(v) : v.toFixed(1);
}

/** 字数（按字符计，与内核按 char 计数一致）。 */
export function nameLength(name: string): number {
  return [...name].length;
}

/** 殖民地名称是否合法：去掉首尾空白后 1–16 个字。 */
export function validName(name: string): boolean {
  const n = nameLength(name.trim());
  return n >= 1 && n <= COLONY_NAME_MAX;
}

/** 建议的殖民地名称：前半与后半各取一个组合，按殖民点与次数确定性挑选。 */
export function suggestName(siteKey: string, n: number): string {
  // 中文表用“、”分隔，英文表用逗号分隔；两种语言的条目一一对应，同一个种子得到对应的名字
  const split = (s: string) =>
    s
      .split(/[、,，]/)
      .map((x) => x.trim())
      .filter(Boolean);
  const pre = split(t("colony.namePrefixes"));
  const suf = split(t("colony.nameSuffixes"));
  if (pre.length === 0 || suf.length === 0) return t("colony.hereTitle");
  const h = hash32(`${siteKey}#${n}`);
  const name = t("colony.nameJoin", { prefix: pre[h % pre.length], suffix: suf[Math.floor(h / pre.length) % suf.length] });
  return [...name].slice(0, COLONY_NAME_MAX).join("");
}

// ───────────────────────── 税率 ─────────────────────────

export interface TaxLevel {
  index: number;
  /** 收入占税收基数的百分比 */
  share: number;
  /** 士气目标的增减 */
  morale: number;
  /** 按当前人口估算的月税收；当前档位收入为 0 时无法换算，为 null */
  income: number | null;
}

/** 各税率档位对士气与收入的影响（收入按当前档位的估算线性换算）。 */
export function taxLevels(statics: StaticView, colony: ColonyView): TaxLevel[] {
  const levels = statics.rules.colony_tax_levels;
  const cur = levels[colony.tax]?.[0] ?? 0;
  return levels.map(([share, morale], index) => ({
    index,
    share,
    morale,
    income: index === colony.tax ? colony.tax_estimate : cur > 0 ? Math.round((colony.tax_estimate * share) / cur) : share === 0 ? 0 : null,
  }));
}

/** 带正负号的整数文字。 */
export function signed(n: number): string {
  return n > 0 ? `+${n}` : String(n);
}

// ───────────────────────── 袭击 ─────────────────────────

export type RaidRisk = "low" | "mid" | "high";

/** 每日遭袭概率（万分之一）→ 一个月（30 天）内至少遭袭一次的概率（万分之一）。 */
export function raidMonthlyBp(dailyBp: number): number {
  const p = Math.max(0, Math.min(1, dailyBp / 10000));
  return Math.round((1 - (1 - p) ** 30) * 10000);
}

/** 月遭袭概率的档次：5% 以下低，15% 以下中，其余高。 */
export function raidRisk(dailyBp: number): RaidRisk {
  const m = raidMonthlyBp(dailyBp);
  return m < 500 ? "low" : m < 1500 ? "mid" : "high";
}

// ───────────────────────── 士气 ─────────────────────────

export interface MoraleFactor {
  key: string;
  label: string;
  /** 已知的数值（带正负）；只知道方向时为 null */
  delta: number | null;
  /** 方向：提升 / 拖累 / 中性 */
  dir: "up" | "down" | "flat";
  /** 悬停提示 */
  hint?: string;
}

/** 距今多少天内遭袭算“近期”（与内核的袭击士气惩罚一致）。 */
export const RECENT_RAID_DAYS = 30;

/** 影响士气目标的因素：税率、民心建筑、消费品满足度、断粮、近期遭袭。 */
export function moraleFactors(statics: StaticView, colony: ColonyView, today: number): MoraleFactor[] {
  const list: MoraleFactor[] = [];
  const tax = statics.rules.colony_tax_levels[colony.tax];
  if (tax) {
    list.push({
      key: "tax",
      label: t("colony.factorTax", { name: tk(`colonyTax.${colony.tax}`) }),
      delta: tax[1],
      dir: tax[1] > 0 ? "up" : tax[1] < 0 ? "down" : "flat",
    });
  }
  for (const [b, level] of colony.buildings) {
    const d = buildingDef(statics, b);
    if (!d || d.morale <= 0 || level <= 0) continue;
    list.push({ key: `b${b}`, label: t("colony.factorBuilding", { name: d.name, level }), delta: d.morale * level, dir: "up" });
  }
  const sat = colony.last_month.satisfaction_bp;
  list.push({
    key: "goods",
    label: t("colony.factorGoods", { pct: Math.round(sat / 100) }),
    delta: null,
    dir: sat >= 8000 ? "up" : sat < 3000 ? "down" : "flat",
    hint: t("colony.factorGoodsHint"),
  });
  if (colony.starving_days > 0) {
    list.push({ key: "starving", label: t("colony.factorStarving", { days: colony.starving_days }), delta: null, dir: "down" });
  }
  if (colony.last_raid !== null && today - colony.last_raid <= RECENT_RAID_DAYS) {
    list.push({ key: "raid", label: t("colony.factorRaid", { day: colony.last_raid }), delta: null, dir: "down" });
  }
  return list;
}

// ───────────────────────── 建立殖民地 ─────────────────────────

/** 可作殖民者的人数范围：至少 min_settlers，至多船员减去最低船员。max < min 时无法建立。 */
export function settlerRange(fleet: FleetView, minSettlers: number): { min: number; max: number } {
  return { min: minSettlers, max: fleet.crew - fleet.crew_min };
}

export interface FoundCheck {
  key: string;
  label: string;
  ok: boolean;
}

/** 建立条件逐项检查（费用、物资、殖民者）；fleet 为空时物资与殖民者按“无舰队”不满足。 */
export function foundChecks(statics: StaticView, overview: Pick<Overview, "cash"> | null, site: SiteView, fleet: FleetView | undefined): FoundCheck[] {
  const cash = overview?.cash ?? 0;
  const list: FoundCheck[] = [
    { key: "cost", label: t("colony.condCost", { v: site.found_cost, cash }), ok: cash >= site.found_cost },
  ];
  for (const [g, need] of site.found_materials) {
    const have = fleet?.cargo.find((c) => c.good === g)?.qty ?? 0;
    list.push({
      key: `m${g}`,
      label: t("colony.condMaterial", { name: statics.goods[g]?.name ?? String(g), need, have }),
      ok: have >= need,
    });
  }
  const range = fleet ? settlerRange(fleet, site.min_settlers) : null;
  list.push({ key: "settlers", label: t("colony.condSettlers", { n: site.min_settlers }), ok: !!range && range.max >= range.min });
  return list;
}

// ───────────────────────── 街景输入 ─────────────────────────

/** 势力据点（被势力占领的殖民点）的样子：一座栅栏堡、住宅与礼拜堂。 */
const FACTION_OUTPOST = [
  { key: "fort", level: 1 },
  { key: "housing", level: 1 },
  { key: "chapel", level: 1 },
] as const;

/** 其他商会的殖民地（看不到详情）：住宅、农庄与伐木场。 */
const OTHER_COLONY = [
  { key: "housing", level: 1 },
  { key: "farm", level: 1 },
  { key: "lumber", level: 1 },
] as const;

/** 其他商会殖民地的旗色（按地点固定）。 */
const OTHER_FLAGS = [P.stone[3], P.wood[3], P.brick[2], P.sand[3]];

/** 殖民点的归属；不是殖民点或无人占领时为 null。 */
export function claimAt(overview: Pick<Overview, "site_claims"> | null, loc: number): SiteClaimView | null {
  return overview?.site_claims?.find((c) => c.loc === loc) ?? null;
}

/** 此地的玩家殖民地 id（概览摘要或归属表里有一处即可）；没有时为 null。 */
export function myColonyAt(overview: Pick<Overview, "colonies" | "site_claims"> | null, loc: number): number | null {
  const s = overview?.colonies?.find((c) => c.loc === loc);
  if (s) return s.id;
  const c = claimAt(overview, loc);
  return c && c.mine && c.colony !== null ? c.colony : null;
}

/**
 * 殖民点的街景输入：玩家殖民地按实际建筑与人口（开拓者风格、主角旗色）；势力据点按势力风格与旗色；
 * 其他商会的殖民地画成一个小聚落；无人占领的殖民点返回 null（画成荒野海湾）。
 */
export function colonySceneInput(
  statics: StaticView,
  overview: Overview | null,
  loc: number,
  colonies: ColoniesView | null,
): ColonySceneInput | null {
  const l = locById(statics, loc);
  if (!l || l.kind !== "site") return null;
  const claim = claimAt(overview, loc);
  const mine = myColonyAt(overview, loc);
  if (mine !== null) {
    const view = colonies?.colonies.find((c) => c.id === mine || c.loc === loc);
    const summary = overview?.colonies?.find((c) => c.id === mine);
    const buildings = (view?.buildings ?? [])
      .map(([b, level]) => ({ key: statics.colony_buildings[b]?.key ?? "", level }))
      .filter((b) => b.key !== "" && b.level > 0);
    return { buildings, population: summary?.population ?? view?.population ?? 0, style: "frontier", flag: PLAYER_FLAG };
  }
  if (claim && claim.faction !== null) {
    const f = statics.factions[claim.faction];
    return { buildings: [...FACTION_OUTPOST], population: 60, style: styleOf(f?.key, f?.style), flag: f?.color };
  }
  if (claim && claim.colony !== null) {
    return { buildings: [...OTHER_COLONY], population: 90, style: "frontier", flag: OTHER_FLAGS[hash32(l.key) % OTHER_FLAGS.length] };
  }
  return null;
}
