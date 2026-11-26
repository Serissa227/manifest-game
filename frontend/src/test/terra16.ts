// 测试用：寰宇世界（data/worlds/terra16）的真实数据，粗读成配乐选曲要用的样子——
// 势力（key、style）、海区（key、music，编号即 regions.toml 里的顺序）、港口与城市（key、所属势力、停泊格所在的海区），
// 以及 world.toml 的 [art] styles。停泊的海区照后端的算法：data/maps/earth/anchors.toml 里港口锚地格的 pos，
// 在 seas.txt 里查海区标记，再按 maps/earth/regions.toml 的 mark 对到海区（与寰宇 regions.toml 同一个顺序）；城市在内陆，没有停泊的海区。
// 只取选曲用得到的几个字段（行首的 key = "…" 一类），不是完整的 TOML 解析器。
import type { FactionView, LocView, NamedView, StaticView } from "../ipc/types";
import { statics as base } from "./fixtures";
import { portTrackIn } from "../audio/zones";
import type { TrackId } from "../audio/tracks";

const glob = (files: Record<string, string>): string[] => Object.keys(files).sort().map((k) => files[k].replace(/\r\n/g, "\n"));
const FACTION_FILES = glob(import.meta.glob<string>("../../../data/worlds/terra16/factions/*.toml", { query: "?raw", import: "default", eager: true }));
const PLACE_FILES = glob({
  ...import.meta.glob<string>("../../../data/worlds/terra16/ports_*.toml", { query: "?raw", import: "default", eager: true }),
  ...import.meta.glob<string>("../../../data/worlds/terra16/cities.toml", { query: "?raw", import: "default", eager: true }),
});
const [REGIONS_TOML] = glob(import.meta.glob<string>("../../../data/worlds/terra16/regions.toml", { query: "?raw", import: "default", eager: true }));
const [WORLD_TOML] = glob(import.meta.glob<string>("../../../data/worlds/terra16/world.toml", { query: "?raw", import: "default", eager: true }));
const [ANCHORS_TOML] = glob(import.meta.glob<string>("../../../data/maps/earth/anchors.toml", { query: "?raw", import: "default", eager: true }));
const [EARTH_REGIONS_TOML] = glob(import.meta.glob<string>("../../../data/maps/earth/regions.toml", { query: "?raw", import: "default", eager: true }));
const [SEAS_TXT] = glob(import.meta.glob<string>("../../../data/maps/earth/seas.txt", { query: "?raw", import: "default", eager: true }));

/** TOML 的 [[表]] 一块一块切开（只看这张表的块）。 */
function blocks(text: string, table: string): string[] {
  return text.split(/^\[\[/m).slice(1).filter((chunk) => chunk.startsWith(`${table}]]`));
}

/** 块里行首的字符串字段（basic string，不含转义）；没有时 undefined。 */
function field(chunk: string, name: string): string | undefined {
  return new RegExp(`^${name}\\s*=\\s*"([^"]*)"`, "m").exec(chunk)?.[1];
}

export interface Terra16Faction {
  key: string;
  style: string | null;
}
export interface Terra16Region {
  key: string;
  music: string | null;
}
export interface Terra16Place {
  key: string;
  kind: "port" | "city";
  faction: string;
  /** 停泊格所在海区的编号（寰宇 regions.toml 的顺序）；城市或没有锚地时为 null */
  region: number | null;
}

export const TERRA16_FACTIONS: readonly Terra16Faction[] = FACTION_FILES.flatMap((text) =>
  blocks(text, "factions").map((b) => ({ key: field(b, "key") ?? "", style: field(b, "style") ?? null })),
);

export const TERRA16_REGIONS: readonly Terra16Region[] = blocks(REGIONS_TOML, "regions").map((b) => ({ key: field(b, "key") ?? "", music: field(b, "music") ?? null }));

/** world.toml 的 [art] styles（可以跨行）。 */
export const TERRA16_ART_STYLES: readonly string[] = (() => {
  const art = /^\[art\][\s\S]*?^styles\s*=\s*\[([\s\S]*?)\]/m.exec(WORLD_TOML)?.[1] ?? "";
  return [...art.matchAll(/"([^"]+)"/g)].map((m) => m[1]);
})();

/** 港口锚地格（x, y）。 */
const ANCHORS = new Map(
  blocks(ANCHORS_TOML, "ports").map((b) => {
    const pos = /^pos\s*=\s*\[\s*(\d+)\s*,\s*(\d+)\s*\]/m.exec(b);
    return [field(b, "key") ?? "", pos ? ([Number(pos[1]), Number(pos[2])] as const) : null] as const;
  }),
);

/** 海区标记（单字符，basic 或 literal string）→ 海区编号。 */
const MARKS = new Map(
  blocks(EARTH_REGIONS_TOML, "regions").map((b, i) => {
    const m = /^mark\s*=\s*(?:"([^"\\])"|'([^'])')/m.exec(b);
    return [m ? (m[1] ?? m[2]) : "", i] as const;
  }),
);
/** 地图上每一格的海区标记（按码点切开）。 */
const SEAS = SEAS_TXT.split("\n")
  .filter((line) => !line.startsWith("//"))
  .map((line) => Array.from(line));

/** 地图生成的海区与寰宇 regions.toml 对得上（同样多、同一个顺序）。 */
export const EARTH_REGION_KEYS: readonly string[] = blocks(EARTH_REGIONS_TOML, "regions").map((b) => field(b, "key") ?? "");

function regionAt(place: string): number | null {
  const pos = ANCHORS.get(place);
  if (!pos) return null;
  const mark = SEAS[pos[1]]?.[pos[0]];
  return mark !== undefined && MARKS.has(mark) ? (MARKS.get(mark) ?? null) : null;
}

export const TERRA16_PLACES: readonly Terra16Place[] = PLACE_FILES.flatMap((text) => [
  ...blocks(text, "ports").map((b) => ({ key: field(b, "key") ?? "", kind: "port" as const, faction: field(b, "faction") ?? "", region: null as number | null })),
  ...blocks(text, "cities").map((b) => ({ key: field(b, "key") ?? "", kind: "city" as const, faction: field(b, "faction") ?? "", region: null as number | null })),
]).map((p) => (p.kind === "port" ? { ...p, region: regionAt(p.key) } : p));

const FACTION_OF = new Map(TERRA16_FACTIONS.map((f) => [f.key, f]));

/** 寰宇里停在这个地点时的港口曲（与配乐导演一样：所属势力的 key 与 style，再按停泊海区的 music 换一次）。 */
export function terra16PortTrack(place: string): TrackId {
  const p = TERRA16_PLACES.find((x) => x.key === place);
  if (!p) throw new Error(`寰宇世界没有地点 ${place}`);
  const f = FACTION_OF.get(p.faction);
  if (!f) throw new Error(`寰宇世界没有势力 ${p.faction}（地点 ${place}）`);
  const music = p.region === null ? null : TERRA16_REGIONS[p.region].music;
  return portTrackIn(f.key, f.style, music);
}

/** 寰宇世界的静态视图（只填选曲用得到的势力、海区与地点；势力表里找不到的势力不收它的地点）。 */
export function terra16Statics(): StaticView {
  const factions: FactionView[] = TERRA16_FACTIONS.map((f, id) => ({ ...base.factions[0], id, key: f.key, name: f.key, style: f.style }));
  const regions: NamedView[] = TERRA16_REGIONS.map((r, id) => ({ id, name: r.key, ...(r.music === null ? {} : { music: r.music }) }));
  const index = new Map(TERRA16_FACTIONS.map((f, i) => [f.key, i]));
  const locations: LocView[] = TERRA16_PLACES.filter((p) => index.has(p.faction)).map((p, id) => ({
    ...base.locations[0],
    id,
    key: p.key,
    name: p.key,
    kind: p.kind,
    faction: index.get(p.faction) ?? 0,
    region: p.region,
  }));
  return { ...base, factions, regions, locations };
}
