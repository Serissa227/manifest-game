// 海图上的动态标记数据：殖民点的状态（未开拓 / 被势力占领 / 殖民地）与主角已发现的发现物。
// 渲染器、地点列表与出航确认框共用这里的整理函数，保证海图与列表一致。
//
// 数据来源（manifest-app 的 views.rs）：
//   StaticView.locations[].kind === "site"    殖民点；地形在 LocView.site.terrain；faction 为占位的 0，无意义
//   Overview.site_claims: SiteClaimView[]     有归属的殖民点 { loc, faction, colony, mine }（无主的不列出）
//   Overview.colonies: ColonySummaryView[]    玩家殖民地的名称与人口（按 loc 对应）
//   api.discoveries().found: FoundView[]      已发现的发现物 { id, day, reported, x, y }（位置只在发现后给出）
//   StaticView.discoveries[]                  发现物目录：名称与种类（不含位置）
//   StaticView.factions[].style / color       势力的建筑风格与旗色
// 直接从子模块取（不经过 art/map 的总入口）：useVoyage 在首屏就用到这里，总入口会把整套海图画法带进首屏的代码
import { PLAYER_FLAG } from "../art/map/places";
import type { SiteMark } from "../art/map/types";
import { P } from "../art/palette";
import { hash32 } from "../art/rng";
import type { DiscoveryDefView, FoundView, LocView, Overview, PortConditionView, StaticView } from "../ipc/types";

/** 港口市况在海图上的字色（地名下方的小字；平稳不显示）。 */
export const CONDITION_COLORS: Readonly<Record<PortConditionView["condition"], string>> = {
  boom: P.gold[3],
  glut: P.teal[3],
  depression: P.slate[4],
  famine: P.red[3],
};

/** 概览里到过的港口与城市的市况（ECONOMY.md 6.4；不是“平稳”的才列出）。 */
export function portConditions(o: Overview | null | undefined): Map<number, PortConditionView["condition"]> {
  return new Map((o?.port_conditions ?? []).map((c) => [c.loc, c.condition]));
}

/** 殖民点的状态：无主（未开拓）、被势力占领、我的殖民地、他人的殖民地。 */
export type SiteStatus = "wild" | "claimed" | "mine" | "other";

/** 殖民点的动态状态（由概览整理）。 */
export interface SiteState {
  loc: number;
  status: SiteStatus;
  /** 占领该点的势力 id（claimed） */
  faction: number | null;
  /** 殖民地 id（mine / other） */
  colony: number | null;
  /** 玩家殖民地的名称与人口（mine；他人的殖民地概览里没有这些信息） */
  name?: string;
  population?: number;
}

/** 其他商会的旗色（按名字取，与海图上的船旗一致）。 */
export const OTHER_FLAGS: readonly string[] = [P.cloth.crimson[2], P.cloth.purple[2], P.teal[3], P.cloth.blue[2], P.brick[3], P.cloth.green[2]];

/** 其他商会（按名字）的旗色。 */
export function ownerFlag(owner: string): string {
  return OTHER_FLAGS[hash32(owner) % OTHER_FLAGS.length];
}

/** 殖民地规模分档（按人口）：0 小（< 100）、1 中（< 300）、2 大。 */
export function colonySize(population: number | undefined): number {
  const n = population ?? 0;
  return n >= 300 ? 2 : n >= 100 ? 1 : 0;
}

/** 是否为殖民点。 */
export function isSite(l: Pick<LocView, "kind"> | { kind: string }): boolean {
  return (l.kind as string) === "site";
}

/** 世界里是否有殖民点。 */
export function hasSites(statics: StaticView | null | undefined): boolean {
  return !!statics?.locations.some((l) => isSite(l));
}

/** 世界里是否有发现物。 */
export function hasDiscoveries(statics: StaticView | null | undefined): boolean {
  return (statics?.discoveries?.length ?? 0) > 0;
}

/** 有归属的殖民点的状态（按地点下标；无主的殖民点不在其中，状态见 siteState）。 */
export function siteStates(o: Overview | null | undefined): Map<number, SiteState> {
  const out = new Map<number, SiteState>();
  if (!o) return out;
  const colonies = new Map((o.colonies ?? []).map((c) => [c.loc, c]));
  for (const c of o.site_claims ?? []) {
    if (!c || typeof c.loc !== "number") continue;
    if (c.colony !== null && c.colony !== undefined) {
      const mine = colonies.get(c.loc);
      out.set(
        c.loc,
        c.mine
          ? { loc: c.loc, status: "mine", faction: null, colony: c.colony, name: mine?.name, population: mine?.population }
          : { loc: c.loc, status: "other", faction: null, colony: c.colony },
      );
    } else if (c.faction !== null && c.faction !== undefined) {
      out.set(c.loc, { loc: c.loc, status: "claimed", faction: c.faction, colony: null });
    }
  }
  // 概览里有殖民地摘要、但归属表还没列出的（旧数据）：按我的殖民地处理
  for (const c of o.colonies ?? []) {
    if (!out.has(c.loc)) out.set(c.loc, { loc: c.loc, status: "mine", faction: null, colony: c.id, name: c.name, population: c.population });
  }
  return out;
}

/** 某个殖民点的状态（没有归属时为 wild）。 */
export function siteState(states: Map<number, SiteState>, loc: number): SiteState {
  return states.get(loc) ?? { loc, status: "wild", faction: null, colony: null };
}

/** 殖民点标记的画法参数：我的殖民地用金色的旗，他人的殖民地按殖民地编号取旗色，势力占领用势力色。 */
export function siteMark(statics: StaticView, state: SiteState | undefined): SiteMark {
  switch (state?.status) {
    case "mine":
      return { colony: { flag: PLAYER_FLAG, size: colonySize(state.population) } };
    case "other":
      return { colony: { flag: ownerFlag(`colony:${state.colony ?? 0}`), size: 0 } };
    case "claimed":
      return { claim: (state.faction !== null && statics.factions[state.faction]?.color) || P.stone[3] };
    default:
      return {};
  }
}

/** 海图上的一件已发现的发现物：目录里的名称与种类 + 发现后给出的位置。 */
export interface DiscoveryMark {
  id: number;
  key: string;
  name: string;
  kind: string;
  x: number;
  y: number;
  day: number;
  reported: boolean;
}

/** 发现物目录（按 id）。 */
export function discoveryDefs(statics: StaticView | null | undefined): Map<number, DiscoveryDefView> {
  return new Map((statics?.discoveries ?? []).map((d) => [d.id, d]));
}

/** 已发现的发现物标记：只列出 found 里有的（未发现的没有位置，不显示）；目录里查不到的跳过。 */
export function discoveryMarks(statics: StaticView | null | undefined, found: readonly FoundView[]): DiscoveryMark[] {
  const defs = discoveryDefs(statics);
  const out: DiscoveryMark[] = [];
  for (const f of found) {
    const d = defs.get(f.id);
    if (!d) continue;
    out.push({ id: f.id, key: d.key, name: d.name, kind: d.kind, x: f.x, y: f.y, day: f.day, reported: f.reported });
  }
  return out;
}
