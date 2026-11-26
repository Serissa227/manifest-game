// 配乐跟着环境走：海区 → 航海曲的地域（与 data/world/regions.toml 的顺序对齐）、表外的海区按港口的文化推断、没有海区时按坐标。
import { describe, expect, it } from "vitest";
import regionsToml from "../../../data/world/regions.toml?raw";
import eastAsiaToml from "../../../data/worlds/terra16/factions/09_eastasia.toml?raw";
import { FACTION_STYLE, styleOf } from "../art/buildings";
import pacificToml from "../../../data/worlds/terra16/factions/12_pacific.toml?raw";
import type { LocView, StaticView } from "../ipc/types";
import { statics } from "../test/fixtures";
import { TRACK_IDS, TRACKS } from "./tracks";
import { MUSIC_ZONE_TRACK, musicTrackOf, OLD_WORLD, PORT_STYLE_TRACK, portTrackOf, REGION_ZONES, seaTrackOf, seaZoneOf, ZONE_TRACK, type SeaZone } from "./zones";

/** regions.toml 里各海区的 key（按文件顺序）。 */
const dataKeys = [...regionsToml.matchAll(/^key\s*=\s*"([^"]+)"/gm)].map((m) => m[1]);
/** 寰宇东亚的势力（key 与数据里写的 style）。 */
const eastAsia = eastAsiaToml
  .split(/^\[\[factions\]\]/m)
  .slice(1)
  .map((block) => [/^key\s*=\s*"([^"]+)"/m.exec(block)?.[1] ?? "", /^style\s*=\s*"([^"]+)"/m.exec(block)?.[1] ?? null] as const);

describe("海区 → 航海曲", () => {
  it("表与 regions.toml 的海区一一对齐（key 只追加，编号就是海区 id）", () => {
    expect(dataKeys.length).toBeGreaterThanOrEqual(REGION_ZONES.length);
    expect(REGION_ZONES.map(([key]) => key)).toEqual(dataKeys.slice(0, REGION_ZONES.length));
    // 现有数据的每个海区都写进了表（以后追加的新海区按港口文化推断，这里提醒一并考虑）
    expect(REGION_ZONES.length).toBe(dataKeys.length);
  });

  it("七种地域各有一首航海曲，都是曲目表里的曲子，不与港口曲、海战曲共用", () => {
    const tracks = Object.values(ZONE_TRACK);
    expect(new Set(tracks).size).toBe(7);
    for (const id of tracks) {
      expect(TRACK_IDS).toContain(id);
      expect(id.startsWith("port_") || id === "battle" || id === "title" || id === "storm").toBe(false);
    }
    expect(ZONE_TRACK.inner).toBe("sea");
    expect(ZONE_TRACK.ocean).toBe("ocean");
    // 每种地域至少有一片海
    const used = new Set(REGION_ZONES.map(([, z]) => z));
    for (const z of Object.keys(ZONE_TRACK) as SeaZone[]) expect(used.has(z), z).toBe(true);
  });

  it("按海区选：北方的冷海、内海、群岛、沙漠海岸、东方、新大陆沿岸、远洋", () => {
    const zone = (key: string) => seaZoneOf(REGION_ZONES.findIndex(([k]) => k === key), { x: 0, y: 0 }, null);
    expect(zone("frost_west")).toBe("north");
    expect(zone("north_watch")).toBe("north");
    expect(zone("frost_reach")).toBe("north");
    expect(zone("cuilan_sea")).toBe("inner");
    expect(zone("golden_sea")).toBe("inner");
    expect(zone("tide_sea")).toBe("islands");
    expect(zone("camel_sea")).toBe("south");
    expect(zone("south_waste")).toBe("south");
    expect(zone("yaohua_sea")).toBe("eastern");
    expect(zone("emerald")).toBe("newworld");
    expect(zone("giants_gate")).toBe("ocean");
    expect(zone("morningstar")).toBe("ocean");
    expect(TRACKS[ZONE_TRACK[zone("icespring")]].title.zh).toBe("北风与白鲸");
  });

  it("表外的海区：按停泊在那片海的港口多半属于哪种文化；只有殖民点时算新大陆；什么都没有时按坐标", () => {
    const region = REGION_ZONES.length + 3;
    const loc = (id: number, kind: LocView["kind"], faction: number): LocView => ({ ...statics.locations[0], id, key: `l${id}`, kind, faction, region });
    const withLocs = (locs: LocView[], styles: (string | null)[] = [null, null]): StaticView => ({
      ...statics,
      factions: statics.factions.map((f, i) => ({ ...f, style: styles[i] ?? f.style })),
      locations: [...statics.locations, ...locs],
    });
    // 两个北地港口对一个地中海港口
    const north = withLocs([loc(10, "port", 1), loc(11, "port", 1), loc(12, "city", 0)], [null, "nordic"]);
    expect(seaZoneOf(region, { x: 300, y: 60 }, north)).toBe("north");
    // 势力没写 style 时按 key：cuilan → 地中海 → 内海
    expect(seaZoneOf(region, { x: 300, y: 60 }, withLocs([loc(10, "port", 0)]))).toBe("inner");
    // 只有殖民点
    expect(seaZoneOf(region, { x: 10, y: 10 }, withLocs([loc(10, "site", 0)]))).toBe("newworld");
    // 那片海没有停泊处：按坐标
    expect(seaZoneOf(region, { x: 10, y: 10 }, statics)).toBe("inner");
    expect(seaZoneOf(region, { x: OLD_WORLD.w + 5, y: 10 }, statics)).toBe("ocean");
    // 票数相同时取先出现的（结果确定）
    const tie = withLocs([loc(10, "port", 1), loc(11, "port", 0)], [null, "desert"]);
    expect(seaZoneOf(region, null, tie)).toBe("south");
  });

  it("后端没有给出海区（旧后端）：按坐标分旧世界的内海与外洋，与原来的两首一致", () => {
    expect(seaZoneOf(null, { x: 100, y: 60 }, statics)).toBe("inner");
    expect(seaZoneOf(undefined, { x: 300, y: 60 }, statics)).toBe("ocean");
    expect(seaZoneOf(null, { x: 100, y: 150 }, statics)).toBe("ocean");
    expect(seaZoneOf(null, null, statics)).toBe("inner");
    // 不合法的海区编号也按坐标
    expect(seaZoneOf(-1, { x: 300, y: 60 }, statics)).toBe("ocean");
    expect(seaZoneOf(2.5, { x: 100, y: 60 }, statics)).toBe("inner");
  });
});

describe("第九批：海区数据的 music 字段（音乐分区）", () => {
  /** 静态数据：海区 id 0、1、2 各写了 music（或没写）。 */
  const withMusic = (music: (string | null | undefined)[]): StaticView => ({
    ...statics,
    regions: music.map((m, id) => ({ id, name: `海区${id}`, ...(m === undefined ? {} : { music: m }) })),
  });

  it("写了曲目编号就用它；写了分区名按表查（不区分大小写，空格与连字符当下划线）；不认识或没写时为 null", () => {
    expect(musicTrackOf("sea_japan")).toBe("sea_japan");
    expect(musicTrackOf("iberia")).toBe("sea_iberia");
    expect(musicTrackOf("Indian-Ocean")).toBe("sea_monsoon");
    expect(musicTrackOf(" indian ocean ")).toBe("sea_monsoon");
    expect(musicTrackOf("china")).toBe("sea_ming");
    expect(musicTrackOf("JAPAN")).toBe("sea_japan");
    expect(musicTrackOf("nowhere")).toBeNull();
    expect(musicTrackOf("")).toBeNull();
    expect(musicTrackOf(null)).toBeNull();
    expect(musicTrackOf(undefined)).toBeNull();
  });

  it("分区表里的曲子都在曲目表里，都是航海曲（或彼界的曲子），不指向港口曲、海战、主题曲、风暴、养成或学院的曲子", () => {
    for (const [key, id] of Object.entries(MUSIC_ZONE_TRACK)) {
      expect(TRACK_IDS, key).toContain(id);
      expect(id.startsWith("port_") || id.startsWith("ub_") || id.startsWith("ac_") || id === "battle" || id === "title" || id === "storm", key).toBe(false);
    }
    // 经典世界的七种地域名照旧对到原来的航海曲
    for (const zone of Object.keys(ZONE_TRACK) as SeaZone[]) expect(MUSIC_ZONE_TRACK[zone]).toBe(ZONE_TRACK[zone]);
    // 十二首新的航海曲都有分区对得上
    const fresh = ["sea_iberia", "sea_monsoon", "sea_ming", "sea_japan", "sea_med", "sea_hansa", "sea_levant", "sea_nusantara", "sea_caribbean", "sea_andes", "sea_pacific", "sea_dark"];
    for (const id of fresh) expect(Object.values(MUSIC_ZONE_TRACK)).toContain(id);
  });

  it("第二轮的分区名：地中海、北海与波罗的海、黎凡特与红海、东南亚、加勒比、安第斯、太平洋、黑暗之海", () => {
    const want: Record<string, string[]> = {
      sea_med: ["mediterranean", "italy", "adriatic", "aegean"],
      sea_hansa: ["baltic", "north_sea", "hansa"],
      // 红海、亚丁湾、阿拉伯海与波斯湾在地方特色第二阶段有了自己的一首（原来与黎凡特共用 sea_levant，见 DECISIONS“测试期望值变更”）
      sea_levant: ["levant", "ottoman"],
      sea_arabic: ["arabic", "red_sea"],
      sea_nusantara: ["malacca", "java", "moluccas", "nusantara"],
      sea_caribbean: ["caribbean", "yucatan", "antilles"],
      sea_andes: ["andes", "peru"],
      sea_pacific: ["pacific", "polynesia"],
      sea_dark: ["dark_sea", "atlantis"],
    };
    for (const [id, keys] of Object.entries(want)) for (const k of keys) expect(musicTrackOf(k), k).toBe(id);
    // 彼界（第三轮）：亚特兰蒂斯的外围是黑暗之海，七岛里面是《银枝与白花》
    expect(musicTrackOf("realm")).toBe("realm_elves");
    expect(musicTrackOf("seven_isles")).toBe("realm_elves");
    // 北方的新曲子不顶替经典世界的《北风与白鲸》：经典的 north 地域与海区表照旧
    expect(musicTrackOf("north")).toBe("sea_north");
    expect(musicTrackOf("Red Sea")).toBe("sea_arabic");
    expect(musicTrackOf("North-Sea")).toBe("sea_hansa");
  });

  it("海区写了认得的 music 就按它选，覆盖表与坐标的规则", () => {
    const s = withMusic(["iberia", "sea_ming", "japan"]);
    expect(seaTrackOf(0, { x: 0, y: 0 }, s)).toBe("sea_iberia");
    expect(seaTrackOf(1, { x: 0, y: 0 }, s)).toBe("sea_ming");
    expect(seaTrackOf(2, { x: 999, y: 999 }, s)).toBe("sea_japan");
    // 海区 0 在经典的表里是北方的冷海：写了 music 就不再看表
    expect(seaZoneOf(0, { x: 0, y: 0 }, s)).toBe("north");
  });

  it("没写 music、写了不认识的、找不到这个海区、没有静态数据、没有海区编号：照经典的规则（与原来完全一样）", () => {
    const s = withMusic([undefined, "mystery_sea", null]);
    for (const region of [0, 1, 2, 3, REGION_ZONES.length + 5]) {
      for (const pos of [{ x: 10, y: 10 }, { x: OLD_WORLD.w + 5, y: 10 }, null]) {
        expect(seaTrackOf(region, pos, s)).toBe(ZONE_TRACK[seaZoneOf(region, pos, s)]);
        expect(seaTrackOf(region, pos, null)).toBe(ZONE_TRACK[seaZoneOf(region, pos, null)]);
      }
    }
    expect(seaTrackOf(null, { x: 100, y: 60 }, s)).toBe("sea");
    expect(seaTrackOf(undefined, { x: 300, y: 60 }, s)).toBe("ocean");
    expect(seaTrackOf(-1, { x: 300, y: 60 }, withMusic(["japan"]))).toBe("ocean");
    // 经典世界的静态数据（海区没有 music）：逐个海区与原来一致
    for (let region = 0; region < REGION_ZONES.length; region++) expect(seaTrackOf(region, null, statics)).toBe(ZONE_TRACK[REGION_ZONES[region][1]]);
  });
});

describe("第九批：港口曲", () => {
  it("经典的建筑风格与经典世界的势力照旧；没有专属港口曲的第九批风格名回退到最接近的已有风格", () => {
    expect(portTrackOf("cuilan", null)).toBe("port_mediterranean");
    expect(portTrackOf("yaohua", null)).toBe("port_eastern");
    expect(portTrackOf("chisha", undefined)).toBe("port_desert");
    expect(portTrackOf("x", "nordic")).toBe("port_nordic");
    expect(portTrackOf("x", "eastern")).toBe("port_eastern");
    // 第二阶段起伊比利亚与希腊（黎凡特）各有自己的港口曲（原来回退到 port_mediterranean，见 DECISIONS“测试期望值变更”）
    expect(portTrackOf("x", "iberian")).toBe("port_iberia");
    expect(portTrackOf("x", "greek")).toBe("port_levant");
    // 地方特色第二阶段起 arabic 有了自己的港口曲（见下面的“第二阶段”）；整合后埃塞俄比亚也有（非洲一支，原来回退到沙漠，见 DECISIONS“测试期望值变更”）
    expect(portTrackOf("x", "arabic")).toBe("port_arabia");
    expect(portTrackOf("x", "ethiopian")).toBe("port_ethiopia");
    // “polynesian”在地方特色第二阶段有了自己的港口曲（见下面“太平洋”一项）；粗分的 islands 与经典的碧潮群岛照旧
    expect(portTrackOf("x", "islands")).toBe("port_islands");
    expect(portTrackOf("bichao", null)).toBe("port_islands");
    // 加勒比在第二阶段·美洲有了自己的港口曲（以前回退到 port_frontier）；殖民地风格照旧回退到 frontier
    expect(portTrackOf("x", "caribbean")).toBe("port_caribbean");
    expect(portTrackOf("x", "colonial")).toBe("port_frontier");
    // 地方特色第二阶段起女真有自己的港口曲（原来回退到经典的 eastern）；经典的 eastern 风格照旧
    expect(portTrackOf("x", "jurchen")).toBe("port_jurchen");
    expect(portTrackOf(undefined, "nowhere")).toBe("port_mediterranean");
  });

  it("第三轮：六种文化城镇风格与几种细名有自己的港口曲（细名先经 TOWN_ALIASES 换成城镇风格）", () => {
    const want: Record<string, string> = {
      japanese: "port_japan",
      ming: "port_ming",
      ottoman: "port_ottoman",
      swahili: "port_swahili",
      malay: "port_malay",
      maya: "port_maya",
      // 地方特色第二阶段起朝鲜、琉球有自己的港口曲（原来回退到明）
      korean: "port_korea",
      ryukyu: "port_ryukyu",
      chinese: "port_ming",
      indian: "port_india",
      mughal: "port_mughal",
      andean: "port_andes",
      inca: "port_andes",
      javanese: "port_malay",
      moluccan: "port_malay",
      // 阿兹特克在第二阶段·美洲有了自己的港口曲（以前借玛雅的一首）
      aztec: "port_aztec",
    };
    for (const [style, track] of Object.entries(want)) expect(portTrackOf("x", style), style).toBe(track);
    // 每种文化城镇风格都有港口曲，港口曲都在曲目表里
    for (const style of ["japanese", "ming", "ottoman", "swahili", "malay", "maya"]) expect(PORT_STYLE_TRACK[style], style).toBeTruthy();
    for (const id of Object.values(PORT_STYLE_TRACK)) expect(TRACK_IDS).toContain(id);
  });

  it("有新文化的专属港口曲时直接用它，不再回退", () => {
    const table = { japanese: "storm" as const };
    expect(portTrackOf("x", "japanese", table)).toBe("storm");
    expect(portTrackOf("x", "ming", table)).toBe("port_eastern");
  });
});

describe("地方特色第二阶段：朝鲜、琉球、女真与满洲的港口曲", () => {
  it("文化名的几种写法都有自己的港口曲", () => {
    const want: Record<string, string> = {
      korean: "port_korea",
      joseon: "port_korea",
      ryukyu: "port_ryukyu",
      ryukyuan: "port_ryukyu",
      jurchen: "port_jurchen",
      manchu: "port_jurchen",
    };
    for (const [style, track] of Object.entries(want)) {
      expect(PORT_STYLE_TRACK[style], style).toBe(track);
      expect(portTrackOf("x", style), style).toBe(track);
    }
  });

  it("寰宇的朝鲜、琉球、建州、叶赫、乌拉在数据里写文化细名，按风格名放自己的港口曲；别的写 ming 的势力照旧是明", () => {
    // 配乐的数据接线（2026-10-11）：原来这五个势力写借来的街景 ming，由前端按势力 key 认（PORT_FACTION_TRACK）；
    // 现在数据写 korean、ryukyu、jurchen，选曲只看风格名（见 DECISIONS“测试期望值变更”）
    const want: Record<string, readonly [string, string]> = {
      joseon: ["korean", "port_korea"],
      ryukyu: ["ryukyu", "port_ryukyu"],
      jianzhou: ["jurchen", "port_jurchen"],
      yehe: ["jurchen", "port_jurchen"],
      ula: ["jurchen", "port_jurchen"],
      ming: ["ming", "port_ming"],
      wang_zhi: ["ming", "port_ming"],
    };
    const styles = new Map(eastAsia);
    for (const [key, [style, track]] of Object.entries(want)) {
      expect(styles.get(key), key).toBe(style);
      expect(portTrackOf(key, style), key).toBe(track);
    }
    // 东亚的势力里放朝鲜、琉球、女真三首的正好是这五个
    const mine = eastAsia.filter(([key, style]) => ["port_korea", "port_ryukyu", "port_jurchen"].includes(portTrackOf(key, style)));
    expect(mine.map(([k]) => k).sort()).toEqual(["jianzhou", "joseon", "ryukyu", "ula", "yehe"]);
    // 不认势力 key：写借来的 ming 就是明的港口曲
    expect(portTrackOf("joseon", "ming")).toBe("port_ming");
  });

  it("经典世界照旧：六个势力的港口曲与粗分的建筑风格一致；经典的 eastern 风格仍是《瑶华》一类的 port_eastern", () => {
    for (const key of Object.keys(FACTION_STYLE)) {
      expect(portTrackOf(key, null), key).toBe(`port_${styleOf(key, null)}`);
      expect(portTrackOf(key, undefined), key).toBe(`port_${FACTION_STYLE[key]}`);
    }
    expect(portTrackOf("x", "eastern")).toBe("port_eastern");
    expect(portTrackOf("yaohua", "eastern")).toBe("port_eastern");
  });
});

describe("地方特色第二阶段：太平洋", () => {
  /** 寰宇·十六世纪的太平洋势力（数据里的 key 与 style）。 */
  const pacific = [...pacificToml.matchAll(/^key\s*=\s*"([^"]+)"\s*\nname\s*=\s*"[^"]*"\s*\nstyle\s*=\s*"([^"]+)"/gm)].map((m) => [m[1], m[2]] as const);

  it("太平洋岛民的细名都用《潟湖的鼓声》", () => {
    for (const style of ["polynesian", "hawaiian", "tahitian", "samoan", "tongan", "maori", "micronesian", "chamorro", "melanesian", "fijian"]) {
      expect(portTrackOf("x", style), style).toBe("port_polynesia");
    }
    expect(TRACKS.port_polynesia.title.zh).toBe("潟湖的鼓声");
  });

  it("寰宇的太平洋势力写岛民的细名（polynesian、chamorro）；同样写 islands 的马尔代夫、帝汶与经典世界照旧（图皮南巴归美洲一支）", () => {
    // 配乐的数据接线（2026-10-11）：原来两个势力写粗分的 islands、由前端按势力 key 认（PORT_FACTION_FALLBACK）；
    // 现在数据写 polynesian、chamorro，选曲只看风格名（见 DECISIONS“测试期望值变更”）
    expect(pacific.length).toBeGreaterThanOrEqual(2);
    expect(Object.fromEntries(pacific)).toEqual({ chamorro: "chamorro", polynesia: "polynesian" });
    for (const [key, style] of pacific) expect(portTrackOf(key, style), key).toBe("port_polynesia");
    for (const key of ["maldives", "timor"]) expect(portTrackOf(key, "islands"), key).toBe("port_islands");
    // 图皮南巴在数据里写 tupi，放《巴西木的海岸》（原来写 islands、按势力 key 认）
    expect(portTrackOf("tupinamba", "tupi")).toBe("port_brazil");
    for (const [key, track] of [["cuilan", "port_mediterranean"], ["shuangling", "port_nordic"], ["jinsui", "port_lowland"], ["chisha", "port_desert"], ["bichao", "port_islands"], ["yaohua", "port_eastern"]] as const) {
      expect(portTrackOf(key, null), key).toBe(track);
    }
    // 只看风格名：写了有专属港口曲的细名就是它，写粗分的 islands 就是《珊瑚潮》，与势力 key 无关
    expect(portTrackOf("polynesia", "japanese")).toBe("port_japan");
    expect(portTrackOf("polynesia", "islands")).toBe("port_islands");
    expect(portTrackOf("chamorro", "islands", PORT_STYLE_TRACK)).toBe("port_islands");
  });

  it("海区的音乐分区：太平洋、波利尼西亚、密克罗尼西亚、美拉尼西亚、大洋洲都是《星路》", () => {
    for (const k of ["pacific", "polynesia", "micronesia", "melanesia", "oceania", "Oceania"]) expect(musicTrackOf(k), k).toBe("sea_pacific");
  });
});
