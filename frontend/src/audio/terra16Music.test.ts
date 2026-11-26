// 配乐的数据接线（2026-10-11）：寰宇世界的势力在数据里写文化细名（english、siamese、ottoman_maghreb……），海区写细的音乐分区
// （east_china_sea、sulu、west_africa……），选曲只认风格名与海区的 music，不认任何世界的势力 key、地点 key 或海区 key（FRAMEWORK §2）。
// 用寰宇的真实数据（data/worlds/terra16 的势力、海区、港口与城市，停泊的海区按 data/maps/earth 的锚地与海区格算）逐个查：
// - 地方特色第二阶段的每首新港口曲至少有一个地点放得到，每首新航海曲至少有一片海放得到，海战变奏至少有一片海放得到；
//   放不到的列在豁免清单里写明原因（数据里没有这个文化的势力，不编造势力），并查它们确实放不到——数据以后补上了，这里会提醒把它移出清单；
// - 港口曲只看风格名：任何势力 key 配同一个风格名，结果都一样；
// - 势力写的每个风格名都在 world.toml 的 [art] styles 里，都有街景的去处（城镇风格本身，或 TOWN_ALIASES 里有它），不会退成缺省的地中海式。
// 养成的节日曲（《夏祭的囃子》《上元灯市》）由养成视图的 culture 选，不在这里查（见 DECISIONS）。
import { describe, expect, it } from "vitest";
import { isTownStyle, TOWN_ALIASES } from "../art/buildings";
import { EARTH_REGION_KEYS, TERRA16_ART_STYLES, TERRA16_FACTIONS, TERRA16_PLACES, TERRA16_REGIONS, terra16PortTrack, terra16Statics } from "../test/terra16";
import { TRACKS, type TrackId } from "./tracks";
import { battleTrackOf, PORT_STYLE_TRACK, portTrackIn, portTrackOf, seaTrackOf } from "./zones";

/** 地方特色第二阶段的 28 首新港口曲（DECISIONS“第二阶段·整合”一节的清单）。 */
const NEW_PORT_TRACKS: readonly TrackId[] = [
  "port_iberia", "port_italy",
  "port_flanders", "port_england", "port_france", "port_hansa", "port_russia",
  "port_arabia", "port_persia", "port_maghreb",
  "port_levant",
  "port_ethiopia", "port_kongo", "port_guinea", "port_benin",
  "port_mughal", "port_malabar",
  "port_siam", "port_burma", "port_vietnam", "port_philippines",
  "port_korea", "port_ryukyu", "port_jurchen",
  "port_aztec", "port_caribbean", "port_brazil",
  "port_polynesia",
];
/** 新的航海曲（停在海上时放）。 */
const NEW_SEA_TRACKS: readonly TrackId[] = ["sea_arctic", "sea_arabic", "sea_guinea", "sea_india", "sea_sulu", "sea_east_china", "sea_brazil"];
/** 新的海战变奏。 */
const NEW_BATTLE_TRACKS: readonly TrackId[] = ["battle_ottoman"];

/**
 * 寰宇里放不到的新曲与原因：数据里没有这个文化的势力（不为了放曲子编造势力）。曲子在“声音”设置里指定曲目时照样听得到，
 * 以后的世界或数据写了这些风格名就会放（风格名都已登记在 PORT_STYLE_TRACK）。
 */
const EXEMPT: Readonly<Partial<Record<TrackId, { styles: readonly string[]; why: string }>>> = {
  port_guinea: { styles: ["mande", "senegambia", "west_african"], why: "曼丁与塞内冈比亚：寰宇里没有这一带的势力，也没有这一带的港口" },
  port_aztec: { styles: ["aztec", "nahua", "mexica", "mesoamerican"], why: "阿兹特克与纳瓦人：1553 年已没有阿兹特克的政权，特诺奇蒂特兰属新西班牙（frontier）" },
  port_caribbean: { styles: ["taino", "caribbean"], why: "加勒比的泰诺：寰宇里没有泰诺的势力，加勒比的港口属西班牙" },
};

const known = TERRA16_PLACES.filter((p) => TERRA16_FACTIONS.some((f) => f.key === p.faction));

describe("寰宇世界的真实数据", () => {
  it("读到了势力、海区、港口与城市；地图生成的海区与寰宇的海区同样多、同一个顺序；每个港口都算得出停泊的海区", () => {
    expect(TERRA16_FACTIONS.length).toBeGreaterThanOrEqual(122);
    expect(TERRA16_REGIONS.length).toBe(93);
    expect(EARTH_REGION_KEYS).toEqual(TERRA16_REGIONS.map((r) => r.key));
    for (const r of TERRA16_REGIONS) expect(r.music, r.key).toBeTruthy();
    const ports = TERRA16_PLACES.filter((p) => p.kind === "port");
    expect(ports.length).toBeGreaterThan(180);
    for (const p of ports) expect(p.region, p.key).not.toBeNull();
    expect(known.length).toBeGreaterThanOrEqual(220);
  });

  it("宿务港的势力 cebu_rajahnate 有了势力条目（原来在势力表里找不到）：停宿务放《霍洛的锣》", () => {
    expect(TERRA16_FACTIONS.find((f) => f.key === "cebu_rajahnate")?.style).toBe("philippine");
    expect(terra16PortTrack("cebu")).toBe("port_philippines");
  });
});

describe("每首新曲在寰宇里都有地方放（放不到的列入豁免清单）", () => {
  const heard = new Set(known.map((p) => terra16PortTrack(p.key)));

  it("新港口曲：至少一个港口或城市放得到", () => {
    expect(NEW_PORT_TRACKS.length).toBe(28);
    for (const id of NEW_PORT_TRACKS) {
      expect(TRACKS[id], id).toBeTruthy();
      if (EXEMPT[id]) continue;
      expect(heard.has(id), `${id}（${TRACKS[id].title.zh}）在寰宇里放不到`).toBe(true);
    }
  });

  it("豁免清单里的曲子确实放不到，原因写明；它们的风格名都登记了（别的世界写了就放）", () => {
    for (const [id, e] of Object.entries(EXEMPT) as [TrackId, { styles: readonly string[]; why: string }][]) {
      expect(NEW_PORT_TRACKS).toContain(id);
      expect(e.why.length, id).toBeGreaterThan(10);
      expect(heard.has(id), `${id} 已经放得到了，请移出豁免清单`).toBe(false);
      for (const s of e.styles) expect(PORT_STYLE_TRACK[s], s).toBe(id);
      // 寰宇的势力没有一个写这些风格名
      for (const f of TERRA16_FACTIONS) expect(e.styles, f.key).not.toContain(f.style);
    }
  });

  it("新航海曲：至少一片海放得到；海战变奏也是", () => {
    const statics = terra16Statics();
    const seas = new Set(TERRA16_REGIONS.map((_, id) => seaTrackOf(id, null, statics)));
    for (const id of NEW_SEA_TRACKS) expect(seas.has(id), `${id}（${TRACKS[id].title.zh}）在寰宇里放不到`).toBe(true);
    const battles = new Set(TERRA16_REGIONS.map((_, id) => battleTrackOf(id, statics)));
    for (const id of NEW_BATTLE_TRACKS) expect(battles.has(id), id).toBe(true);
  });
});

describe("选曲只认风格名与 music，不认世界的 key", () => {
  it("港口曲：寰宇的任何势力 key 配同一个风格名，结果都与一个不存在的势力一样", () => {
    const styles = [...new Set(TERRA16_FACTIONS.map((f) => f.style).filter((s): s is string => s !== null)), "mediterranean", "nordic", "desert", null];
    for (const f of TERRA16_FACTIONS) {
      for (const s of styles) expect(portTrackOf(f.key, s), `${f.key} ${s}`).toBe(portTrackOf("no_such_faction", s));
    }
  });

  it("寰宇的每个地点：港口曲只由所属势力的风格名与停泊海区的 music 决定（换成不存在的势力 key，结果一样）", () => {
    const styleOf = new Map(TERRA16_FACTIONS.map((f) => [f.key, f.style]));
    for (const p of known) {
      const music = p.region === null ? null : TERRA16_REGIONS[p.region].music;
      expect(terra16PortTrack(p.key), p.key).toBe(portTrackIn("no_such_faction", styleOf.get(p.faction) ?? null, music));
    }
  });
});

describe("势力的风格名与街景", () => {
  it("势力写的每个风格名都在 world.toml 的 [art] styles 里", () => {
    for (const f of TERRA16_FACTIONS) {
      expect(f.style, f.key).not.toBeNull();
      expect(TERRA16_ART_STYLES, f.key).toContain(f.style);
    }
  });

  it("[art] styles 的每个名字都有街景的去处：本身是城镇风格，或在 TOWN_ALIASES 里（不会退成缺省的地中海式）", () => {
    expect(TERRA16_ART_STYLES.length).toBeGreaterThan(40);
    for (const s of TERRA16_ART_STYLES) expect(isTownStyle(s) || Object.prototype.hasOwnProperty.call(TOWN_ALIASES, s), s).toBe(true);
  });
});
