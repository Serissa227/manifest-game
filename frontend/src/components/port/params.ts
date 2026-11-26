// 由静态数据与概览得出港口街景的参数（街景组件与测试共用）。
import { hash32 } from "../../art/rng";
import { shipKeyOverride } from "../../art/ships";
import { locById } from "../../ipc/byId";
import type { LocView, Overview, StaticView } from "../../ipc/types";
import { facilitiesAt, type PortSceneParams, type SceneColony, type SceneShip } from "../../scene/port";
import { flagship } from "../../store/game";

/** 殖民地街景的输入：殖民建筑与人口，可选的建筑风格与旗色（所有者是势力时用势力的风格与旗色）。 */
export interface ColonySceneInput extends SceneColony {
  /** 建筑风格；缺省为开拓者风格（frontier） */
  style?: string | null;
  /** 所有者的旗色 */
  flag?: string;
}

/** 街景里的船：船型下标与帆装；船型 key 与经典世界同一下标的不同（寰宇·十六世纪的新船型）时另带 key。 */
function sceneShip(statics: StaticView, kind: number): SceneShip {
  const key = shipKeyOverride(statics.ships, kind);
  const ship: SceneShip = { type: kind, sail: statics.ships[kind]?.sail ?? "square" };
  return key ? { ...ship, key } : ship;
}

/** 旧数据把地形、古迹直接写在地点上（后端的正式字段是 site.terrain）；两种写法都认。 */
interface LegacySiteFields {
  terrain?: string | null;
  ruins?: boolean | null;
}

/**
 * 街景参数（不含宽度与悬停）。港口与城市按势力数据的 style 字段决定建筑风格（缺省按势力 key）。
 * 地点是殖民点（kind 为 site）时：给出 colony 画成殖民地，否则画成荒野海湾。
 */
export function sceneParams(
  statics: StaticView,
  overview: Overview | null,
  loc: number,
  colony?: ColonySceneInput | null,
): Omit<PortSceneParams, "width" | "hover"> {
  // 不在静态数据里的地点（没看见过、已滤掉）：调用方先查过，这里只是兜底，按无名的荒野海湾画
  const l: LocView = locById(statics, loc) ?? { id: loc, key: `loc-${loc}`, name: "", kind: "site", x: -1, y: -1, faction: 0, shipyard: false };
  const legacy = l as typeof l & LegacySiteFields;
  const faction = statics.factions[l.faction];
  const fleet = flagship(overview);
  const lead = fleet && fleet.docked === loc ? fleet.ships[0] : undefined;
  // 其他停泊的船：自己的其他舰队、此地的其他商会船，再加一两艘往来的船（按地点固定）
  const mine = (overview?.fleets ?? []).filter((f) => f !== fleet && f.docked === loc).length;
  const ai = (overview?.others ?? []).filter((m) => m.x === l.x && m.y === l.y).length;
  const kind: PortSceneParams["kind"] = l.kind === "site" ? (colony ? "colony" : "site") : l.kind;
  const base = {
    key: l.key,
    name: l.name,
    kind,
    faction: faction?.key ?? "",
    style: faction?.style ?? null,
    flag: faction?.color,
    facilities: facilitiesAt(
      kind,
      l.shipyard,
      statics.exchanges.some((e) => e.port === loc),
    ),
    season: overview?.season ?? 0,
    flagship: lead ? sceneShip(statics, lead.kind) : null,
    others: Math.min(3, 1 + (hash32(l.key) % 2) + mine + ai),
  };
  if (kind === "port" || kind === "city") return base;
  return {
    ...base,
    terrain: l.site?.terrain ?? legacy.terrain ?? null,
    ruins: legacy.ruins ?? null,
    style: colony ? (colony.style ?? "frontier") : null,
    // 殖民地挂所有者的旗（殖民点的 faction 是占位的 0，所以所有者的旗色由调用方给出）
    flag: colony?.flag ?? base.flag,
    colony: colony ? { buildings: colony.buildings, population: colony.population } : null,
  };
}
