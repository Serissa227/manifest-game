// 地方特色第二阶段·非洲：港口曲与航海曲的对应（埃塞俄比亚、刚果与安哥拉、几内亚海岸）；经典世界照旧。
import { describe, expect, it } from "vitest";
import africaToml from "../../../data/worlds/terra16/factions/06_africa.toml?raw";
import classicFactionsToml from "../../../data/factions.toml?raw";
import westAfricaPortsToml from "../../../data/worlds/terra16/ports_atlantic_islands_west_africa.toml?raw";
import eastAfricaPortsToml from "../../../data/worlds/terra16/ports_east_africa.toml?raw";
import { FACTION_STYLE, townStyleOf } from "../art/buildings";
import type { StaticView } from "../ipc/types";
import { statics } from "../test/fixtures";
import { TRACK_IDS, TRACKS } from "./tracks";
import { MUSIC_ZONE_TRACK, musicTrackOf, PORT_STYLE_TRACK, portTrackOf, seaTrackOf, ZONE_TRACK } from "./zones";

/** 势力表里的 key 与 style（按文件顺序）。 */
function factionsOf(toml: string): { key: string; style: string | null }[] {
  return toml
    .split(/^\[\[factions\]\]/m)
    .slice(1)
    .map((block) => ({ key: /^key\s*=\s*"([^"]+)"/m.exec(block)![1], style: /^style\s*=\s*"([^"]+)"/m.exec(block)?.[1] ?? null }));
}

/** 港口表里每个港口的 key 与所属势力。 */
function portsOf(toml: string): { key: string; faction: string }[] {
  return toml
    .split(/^\[\[ports\]\]/m)
    .slice(1)
    .map((block) => ({ key: /^key\s*=\s*"([^"]+)"/m.exec(block)?.[1] ?? "", faction: /^faction\s*=\s*"([^"]+)"/m.exec(block)?.[1] ?? "" }));
}

describe("非洲的港口曲（地方特色第二阶段）", () => {
  const africa = factionsOf(africaToml);

  it("非洲四首的港口曲：寰宇数据里放它们的正好是埃塞俄比亚、刚果、恩东戈、贝宁（按数据写的风格名）；经典世界的势力一首也不放", () => {
    // 配乐的数据接线（2026-10-11）：原来查前端的势力表（PORT_FACTION_TRACK）里指向这四首的条目，现在数据写细名、前端不认势力 key，
    // 改成查“按数据写的风格名，放这四首的势力”（见 DECISIONS“测试期望值变更”）
    const AFRICA: readonly string[] = ["port_ethiopia", "port_kongo", "port_guinea", "port_benin"];
    const mine = africa.filter((f) => AFRICA.includes(portTrackOf(f.key, f.style)));
    expect(mine.map((f) => f.key).sort()).toEqual(["benin", "ethiopia", "kongo", "ndongo"]);
    for (const f of mine) expect(TRACK_IDS, f.key).toContain(portTrackOf(f.key, f.style));
    const classic = factionsOf(classicFactionsToml);
    expect(classic.length).toBeGreaterThanOrEqual(6);
    for (const f of classic) expect(AFRICA, f.key).not.toContain(portTrackOf(f.key, f.style));
    for (const key of Object.keys(FACTION_STYLE)) expect(AFRICA, key).not.toContain(portTrackOf(key, null));
  });

  it("埃塞俄比亚、刚果、恩东戈、贝宁在数据里写文化细名，港口曲是各自的一首（贝宁是贝宁湾自己的一首，不借曼丁的）；其余非洲势力照旧", () => {
    const style = (key: string) => africa.find((f) => f.key === key)?.style ?? null;
    // 原来四个都写借来的 swahili、由前端按势力 key 认；现在写 ethiopian、kongo、ndongo、edo（见 DECISIONS“测试期望值变更”）
    expect({ ethiopia: style("ethiopia"), kongo: style("kongo"), ndongo: style("ndongo"), benin: style("benin") }).toEqual({ ethiopia: "ethiopian", kongo: "kongo", ndongo: "ndongo", benin: "edo" });
    expect(portTrackOf("ethiopia", style("ethiopia"))).toBe("port_ethiopia");
    expect(portTrackOf("kongo", style("kongo"))).toBe("port_kongo");
    expect(portTrackOf("ndongo", style("ndongo"))).toBe("port_kongo");
    expect(portTrackOf("benin", style("benin"))).toBe("port_benin");
    // 街景：恩东戈、贝宁照旧借斯瓦希里海岸；埃塞俄比亚与刚果按 TOWN_ALIASES 已有的映射（沙漠、拓荒者）
    expect(townStyleOf("ndongo", style("ndongo"))).toBe("swahili");
    expect(townStyleOf("benin", style("benin"))).toBe("swahili");
    expect(townStyleOf("ethiopia", style("ethiopia"))).toBe("desert");
    expect(townStyleOf("kongo", style("kongo"))).toBe("frontier");
    // 斯瓦希里诸城、阿朱兰、穆塔帕仍是《珊瑚石的城》；桑海、卡涅姆—博尔努仍按沙漠风格；
    // 阿达尔（泽拉港）的 style 照旧写 desert：按风格是沙漠的一首，停在亚丁湾（music 写 arabic）时换成《乳香与咖啡的码头》（见 arabiaPersiaMaghreb.test.ts）
    for (const key of ["swahili_cities", "ajuran", "mutapa"]) expect(portTrackOf(key, style(key)), key).toBe("port_swahili");
    for (const key of ["songhai", "kanem_bornu"]) expect(portTrackOf(key, style(key)), key).toBe("port_desert");
    expect(style("adal")).toBe("desert");
    expect(portTrackOf("adal", style("adal"))).toBe("port_desert");
  });

  it("这些势力的港口：马萨瓦（埃塞俄比亚）、姆平达（刚果）、罗安达（恩东戈）、瓜托（贝宁）", () => {
    const ports = [...portsOf(westAfricaPortsToml), ...portsOf(eastAfricaPortsToml)];
    const factionOf = (key: string) => ports.find((p) => p.key === key)?.faction;
    const styleOfPort = (key: string) => africa.find((f) => f.key === factionOf(key))?.style ?? null;
    expect(portTrackOf(factionOf("massawa"), styleOfPort("massawa"))).toBe("port_ethiopia");
    expect(portTrackOf(factionOf("mpinda"), styleOfPort("mpinda"))).toBe("port_kongo");
    expect(portTrackOf(factionOf("luanda"), styleOfPort("luanda"))).toBe("port_kongo");
    expect(portTrackOf(factionOf("ughaton"), styleOfPort("ughaton"))).toBe("port_benin");
    // 葡萄牙的埃尔米纳、圣多美仍按葡萄牙（数据写 portuguese：伊比利亚的《橙花码头》）
    expect(factionOf("elmina")).toBe("portugal");
    expect(portTrackOf("portugal", "portuguese")).toBe("port_iberia");
  });

  it("细的风格名：埃塞俄比亚、刚果与安哥拉、曼丁与塞内冈比亚、贝宁湾（以后数据改写 style 时直接用）", () => {
    const want: Record<string, string> = {
      ethiopian: "port_ethiopia",
      abyssinian: "port_ethiopia",
      kongo: "port_kongo",
      ndongo: "port_kongo",
      angolan: "port_kongo",
      west_african: "port_guinea",
      mande: "port_guinea",
      senegambia: "port_guinea",
      edo: "port_benin",
      benin: "port_benin",
      yoruba: "port_benin",
      akan: "port_benin",
    };
    for (const [style, id] of Object.entries(want)) expect(portTrackOf("x", style), style).toBe(id);
    for (const id of Object.values(PORT_STYLE_TRACK)) expect(TRACK_IDS).toContain(id);
    // 曼丁的一首只给曼丁与塞内冈比亚的名字；贝宁湾的名字一个也不落到它上面（评审后补）
    const styles = (id: string) =>
      Object.entries(PORT_STYLE_TRACK)
        .filter(([, t]) => t === id)
        .map(([k]) => k)
        .sort();
    expect(styles("port_guinea")).toEqual(["mande", "senegambia", "west_african"]);
    expect(styles("port_benin")).toEqual(["akan", "benin", "edo", "yoruba"]);
  });

  it("经典世界照旧：六个势力、七种建筑风格的港口曲与第二阶段之前完全一样", () => {
    expect(portTrackOf("cuilan", null)).toBe("port_mediterranean");
    expect(portTrackOf("jinsui", null)).toBe("port_lowland");
    expect(portTrackOf("chisha", null)).toBe("port_desert");
    expect(portTrackOf("bichao", null)).toBe("port_islands");
    expect(portTrackOf("shuangling", null)).toBe("port_nordic");
    expect(portTrackOf("yaohua", null)).toBe("port_eastern");
    for (const style of ["mediterranean", "nordic", "lowland", "desert", "islands", "eastern", "frontier"]) expect(portTrackOf("x", style), style).toBe(`port_${style}`);
    // 只按风格走：写借来的 swahili 就是斯瓦希里海岸的一首，与势力 key 无关
    expect(portTrackOf("kongo", "swahili", PORT_STYLE_TRACK)).toBe("port_swahili");
    expect(portTrackOf("kongo", "swahili")).toBe("port_swahili");
  });
});

describe("非洲西岸的航海曲（地方特色第二阶段）", () => {
  /** 静态数据的副本：海区 0、1 写上给定的 music。 */
  function withMusic(music: (string | null)[]): StaticView {
    return { ...statics, regions: music.map((m, i) => ({ id: i, name: `海区${i}`, music: m })) };
  }

  it("几内亚湾、刚果、安哥拉、本格拉等分区名对到《赤道的长浪》；它是航海曲，不与港口曲共用", () => {
    for (const k of ["west_africa", "cape_verde", "senegambia", "guinea", "Guinea Gulf", "gulf-of-guinea", "gold_coast", "kongo", "angola", "benguela", "african_atlantic"]) {
      expect(musicTrackOf(k), k).toBe("sea_guinea");
    }
    expect(TRACKS.sea_guinea.meter).toEqual([6, 8]);
    expect(Object.values(MUSIC_ZONE_TRACK)).toContain("sea_guinea");
    expect(Object.values(PORT_STYLE_TRACK)).not.toContain("sea_guinea");
  });

  it("经典世界照旧：south 地域仍是《驼铃与海风》，大西洋（atlantic）仍是伊比利亚的一首", () => {
    expect(ZONE_TRACK.south).toBe("sea_south");
    expect(MUSIC_ZONE_TRACK.south).toBe("sea_south");
    expect(musicTrackOf("atlantic")).toBe("sea_iberia");
    expect(musicTrackOf("swahili")).toBe("sea_monsoon");
    const s = withMusic(["guinea", null]);
    expect(seaTrackOf(0, { x: 0, y: 0 }, s)).toBe("sea_guinea");
    expect(seaTrackOf(1, { x: 0, y: 0 }, s)).toBe(seaTrackOf(1, { x: 0, y: 0 }, withMusic([null, null])));
  });
});
