// 曲目池与轮换（第九批 A01，2026-11-11，pools.ts / zones.ts / upbringing.ts / director.ts）：
// - 池的表：第一首是原来的那一首（大西洋的远洋例外）、都在曲目表里、不重复；
// - 经典世界（海区不写 music、势力不写 style）：每个情境的池里只有原来的那一首，没有《雾号》——行为与原来完全一样；
// - 寰宇的真实数据：每片海、每个港口的池的 primary 就是原来的选曲结果；每首多写的航海曲、港口曲、风暴与海战曲至少有一处轮得到；
// - 轮换（PoolRotations）：先放第一首；一遍奏完、留白够久、听够了才换；离开够久再回来才换；海战与事件放着的时候不换；洗牌不连着重复；
// - sceneOf：不给取曲的函数时结果与原来一样，给了就从池里取；scenePool 给出这一刻的池；
// - 养成：季节、这一带的曲目池里别的几首进平时的轮换，事件与比赛的池。
import { describe, expect, it } from "vitest";
import type { LocalWeatherView, Overview, StaticView } from "../ipc/types";
import { overview, statics } from "../test/fixtures";
import { TERRA16_FACTIONS, TERRA16_PLACES, TERRA16_REGIONS, terra16PortTrack, terra16Statics } from "../test/terra16";
import { likelyNext, sceneOf, scenePool } from "./director";
import { POOL_RULES, poolKey, PoolRotations, primaryPick, type PoolKind, type ScenePool } from "./pools";
import { rng } from "./score";
import { isTrackId, TRACK_IDS, type TrackId } from "./tracks";
import { MORE_TRACK_IDS } from "./tracks/more";
import {
  digestOf,
  everydayPool,
  publishUpbringing,
  seasonOfMonth,
  UB_EVENT_POOLS,
  UB_EVERYDAY,
  UB_SEASON_TRACKS,
  ubPoolOf,
  useUbMusic,
  voyageMoreOf,
  voyageTracksOf,
  type UbMusicDigest,
  type UbMusicSource,
} from "./upbringing";
import {
  battlePoolOf,
  battleTrackOf,
  EVENING_PORT_TRACKS,
  fogPoolOf,
  PORT_TRACK_POOL,
  portPoolIn,
  portTrackIn,
  SEA_TRACK_POOL,
  SEA_ZONE_POOL,
  seaPoolOf,
  seaTrackOf,
  stormPoolOf,
  SWAHILI_SEA_POOL,
  swahiliCoastOf,
} from "./zones";

const terra = terra16Statics();
const regionId = (key: string): number => {
  const id = TERRA16_REGIONS.findIndex((r) => r.key === key);
  if (id < 0) throw new Error(`寰宇没有海区 ${key}`);
  return id;
};

/** 在海上：旗舰队不停泊，当地天气在海区 region。 */
function atSea(region: number, sky = "clear"): Overview {
  return {
    ...overview,
    fleets: [{ ...overview.fleets[0], docked: null, x: 100, y: 60 }],
    local_weather: { region, region_name: "", sky, wind_dir: 2, wind_strength: 4, forecast: [] } as unknown as LocalWeatherView,
  };
}

describe("曲目池的表", () => {
  const tables: [string, Readonly<Partial<Record<TrackId, readonly TrackId[]>>>][] = [
    ["SEA_TRACK_POOL", SEA_TRACK_POOL],
    ["PORT_TRACK_POOL", PORT_TRACK_POOL],
    ["UB_EVENT_POOLS", UB_EVENT_POOLS],
  ];

  it("按原来的曲子查的三张表：第一首就是原来的那一首，池里不止一首、不重复、都在曲目表里", () => {
    for (const [name, table] of tables) {
      for (const [primary, tracks] of Object.entries(table) as [TrackId, readonly TrackId[]][]) {
        expect(tracks[0], `${name} ${primary}`).toBe(primary);
        expect(tracks.length, `${name} ${primary}`).toBeGreaterThan(1);
        expect(new Set(tracks).size, `${name} ${primary}`).toBe(tracks.length);
        for (const id of tracks) expect(isTrackId(id), `${name} ${id}`).toBe(true);
      }
    }
  });

  it("种类不串：航海曲的池里都是航海曲（或远洋的《晨星洋》），港口曲的池里都是港口曲，养成的池里都是养成的曲子", () => {
    for (const tracks of [...Object.values(SEA_TRACK_POOL), ...Object.values(SEA_ZONE_POOL)]) for (const id of tracks ?? []) expect(id.startsWith("sea_") || id === "ocean", id).toBe(true);
    for (const tracks of Object.values(PORT_TRACK_POOL)) for (const id of tracks ?? []) expect(id.startsWith("port_"), id).toBe(true);
    for (const tracks of Object.values(UB_EVENT_POOLS)) for (const id of tracks ?? []) expect(id.startsWith("ub_"), id).toBe(true);
    for (const id of EVENING_PORT_TRACKS) expect(Object.values(PORT_TRACK_POOL).some((t) => t?.includes(id)), id).toBe(true);
  });

  it("大西洋的远洋：有轮换时放自己的《信风带》与三首远洋的曲子，不再放伊比利亚沿岸的那一首；斯瓦希里海岸是《达乌船的归期》打头", () => {
    expect(SEA_ZONE_POOL.atlantic).toEqual(["sea_atlantic", "sea_swell", "sea_night", "ocean"]);
    expect(SEA_ZONE_POOL.atlantic).not.toContain("sea_iberia");
    expect(SWAHILI_SEA_POOL).toEqual(["sea_swahili", "sea_monsoon"]);
    expect(SEA_ZONE_POOL.swahili).toBe(SWAHILI_SEA_POOL);
    expect(SEA_TRACK_POOL.sea_monsoon).toEqual(["sea_monsoon", "sea_swell", "sea_night", "ocean"]);
    expect(SEA_TRACK_POOL.sea_pacific).toEqual(["sea_pacific", "sea_swell", "sea_night", "ocean"]);
  });

  it("轮换的节奏：海与港口一遍奏完就换，海战与养成的事件放着的时候不换", () => {
    for (const kind of ["sea", "port", "storm"] as PoolKind[]) expect(POOL_RULES[kind].rest, kind).toBeGreaterThan(0);
    for (const kind of ["battle", "event"] as PoolKind[]) expect(POOL_RULES[kind].rest, kind).toBeNull();
    // 航海曲的留白最短 25 秒、港口曲 10 秒、风暴 3 秒：换下一首的时刻都落在留白里
    expect(POOL_RULES.sea.rest).toBeLessThan(25);
    expect(POOL_RULES.port.rest).toBeLessThan(10);
    expect(POOL_RULES.storm.rest).toBeLessThan(3);
  });
});

describe("经典世界照旧（海区不写 music、势力不写 style）", () => {
  it("每片海、每种天气、每场海战的池里只有原来的那一首；雾天没有《雾号》", () => {
    for (let region = 0; region < 26; region++) {
      for (const pos of [{ x: 10, y: 10 }, { x: 300, y: 60 }, null]) {
        const sea = seaPoolOf(region, pos, statics);
        expect(sea, `海区 ${region}`).toEqual({ primary: seaTrackOf(region, pos, statics), tracks: [seaTrackOf(region, pos, statics)], kind: "sea" });
        expect(fogPoolOf(region, pos, statics)).toBeNull();
      }
      expect(stormPoolOf(region, statics)).toEqual({ primary: "storm", tracks: ["storm"], kind: "storm" });
      expect(battlePoolOf(region, statics)).toEqual({ primary: "battle", tracks: ["battle"], kind: "battle" });
    }
    expect(seaPoolOf(null, null, null).tracks).toEqual([seaTrackOf(null, null, null)]);
    expect(stormPoolOf(3, null).tracks).toEqual(["storm"]);
  });

  it("势力没写风格名：港口的池里只有原来的那一首（不论时刻）；写了风格名才有第二首", () => {
    for (const key of ["esperan", "vandel", "nord", "kadir", "bichao", "yaohua", "no_such_faction"]) {
      for (const minute of [600, 1320, undefined]) {
        const pool = portPoolIn(key, undefined, null, minute);
        expect(pool.tracks, key).toEqual([portTrackIn(key, undefined, null)]);
        expect(portPoolIn(key, "  ", null, minute).tracks, key).toEqual([portTrackIn(key, "  ", null)]);
      }
    }
    expect(portPoolIn("x", "nordic", null).tracks).toEqual(["port_nordic", "port_town"]);
    expect(portPoolIn("x", "frontier", null).tracks).toEqual(["port_frontier", "port_indies"]);
  });

  it("配乐导演的场景：经典的静态数据里 sceneOf 给不给取曲的函数结果都一样", () => {
    const first = (p: ScenePool) => p.tracks[0];
    for (const o of [atSea(0), atSea(4, "rain"), atSea(12, "storm"), atSea(5, "fog"), overview]) {
      expect(sceneOf(true, statics, o, null, null, first)).toEqual(sceneOf(true, statics, o));
    }
  });
});

describe("寰宇的真实数据", () => {
  const pools = TERRA16_REGIONS.map((_, id) => seaPoolOf(id, null, terra));

  it("每片海的池：primary 就是原来的选曲结果，第一首轮得到，池里的曲子都在曲目表里", () => {
    pools.forEach((pool, id) => {
      expect(pool.primary, TERRA16_REGIONS[id].key).toBe(seaTrackOf(id, null, terra));
      expect(pool.kind).toBe("sea");
      expect(pool.tracks.length).toBeGreaterThanOrEqual(1);
      for (const t of pool.tracks) expect(TRACK_IDS, t).toContain(t);
    });
  });

  it("大西洋的远洋八片海：《信风带》打头；伊比利亚沿岸五片海：《圣文森特角的帆》与《加那利的顺风》", () => {
    const atlantic = TERRA16_REGIONS.map((r, id) => ({ r, id })).filter((x) => x.r.music === "atlantic");
    expect(atlantic.length).toBe(8);
    for (const { id, r } of atlantic) {
      expect(pools[id].primary, r.key).toBe("sea_iberia");
      expect(pools[id].tracks, r.key).toEqual(["sea_atlantic", "sea_swell", "sea_night", "ocean"]);
    }
    for (const key of ["azores", "biscay", "iberia", "alboran", "canaries"]) expect(pools[regionId(key)].tracks, key).toEqual(["sea_iberia", "sea_canaries"]);
  });

  it("斯瓦希里海（写的是笼统的 indian，停泊的都是斯瓦希里的港口）：《达乌船的归期》打头；印度洋别的海不是", () => {
    const swahili = regionId("swahili");
    expect(TERRA16_REGIONS[swahili].music).toBe("indian");
    expect(swahiliCoastOf(swahili, terra)).toBe(true);
    expect(pools[swahili].primary).toBe("sea_monsoon");
    expect(pools[swahili].tracks).toEqual(["sea_swahili", "sea_monsoon"]);
    for (const key of ["south_indian_ocean", "mozambique_channel", "maldives", "andaman", "agulhas"]) {
      expect(swahiliCoastOf(regionId(key), terra), key).toBe(false);
      expect(pools[regionId(key)].tracks, key).toEqual(["sea_monsoon", "sea_swell", "sea_night", "ocean"]);
    }
    // 印度沿岸的几片海照旧是《雨季的船歌》打头，另有《恒河口的船歌》
    for (const key of ["gujarat", "malabar", "ceylon", "bengal_bay"]) expect(pools[regionId(key)].tracks, key).toEqual(["sea_india", "sea_bengal"]);
  });

  it("各片近海的第二首：地中海、爱琴海与黎凡特、阿拉伯的海、北海、北大西洋的西北角、日本、明的沿海与东海、东南亚、加勒比", () => {
    const want: Record<string, TrackId[]> = {
      tyrrhenian: ["sea_med", "sea_tyrrhenian"],
      adriatic: ["sea_med", "sea_tyrrhenian"],
      aegean: ["sea_levant", "sea_aegean"],
      black_sea: ["sea_levant", "sea_aegean"],
      red_sea: ["sea_arabic", "sea_gulf"],
      persian_gulf: ["sea_arabic", "sea_gulf"],
      north_sea: ["sea_hansa", "sea_channel"],
      english_channel: ["sea_hansa", "sea_channel"],
      baltic: ["sea_hansa", "sea_channel"],
      grand_banks: ["sea_north", "sea_banks"],
      labrador: ["sea_north", "sea_banks"],
      seto_inland: ["sea_japan", "sea_kuroshio"],
      kuroshio: ["sea_japan", "sea_kuroshio"],
      taiwan_strait: ["sea_ming", "sea_lanterns"],
      east_china_sea: ["sea_east_china", "sea_lanterns"],
      malacca: ["sea_nusantara", "sea_malacca"],
      java_sea: ["sea_nusantara", "sea_malacca"],
      west_caribbean: ["sea_caribbean", "sea_treasure"],
      mexico_gulf: ["sea_caribbean", "sea_treasure"],
      polynesia: ["sea_pacific", "sea_swell", "sea_night", "ocean"],
    };
    for (const [key, tracks] of Object.entries(want)) expect(pools[regionId(key)].tracks, key).toEqual(tracks);
    // 还没有第二首的海只有原来的那一首
    for (const key of ["white_barents", "guinea_gulf", "peru_current", "brazil_current", "sulu", "dark_sea"]) expect(pools[regionId(key)].tracks.length, key).toBe(1);
  });

  it("风暴、雾与海战：东亚的海是《台风》与《海上的战鼓》打头，别处是《怒涛》《烈风》与《黑帆》《舷炮》；奥斯曼的海战变奏照旧；雾天是《雾号》", () => {
    for (const key of ["east_china_sea", "yellow_sea", "seto_inland", "taiwan_strait", "philippine_sea"]) {
      expect(stormPoolOf(regionId(key), terra), key).toEqual({ primary: "storm", tracks: ["storm_typhoon", "storm"], kind: "storm" });
    }
    for (const key of ["north_sea", "iberia", "south_atlantic", "malacca", "arabian_sea"]) {
      expect(stormPoolOf(regionId(key), terra).tracks, key).toEqual(["storm", "storm_gale"]);
    }
    for (const key of ["east_china_sea", "bohai", "seto_inland", "taiwan_strait"]) {
      expect(battlePoolOf(regionId(key), terra), key).toEqual({ primary: "battle", tracks: ["battle_east", "battle"], kind: "battle" });
    }
    for (const key of ["north_sea", "iberia", "south_atlantic", "malacca"]) expect(battlePoolOf(regionId(key), terra).tracks, key).toEqual(["battle", "battle_broadside"]);
    TERRA16_REGIONS.forEach((r, id) => {
      const pool = battlePoolOf(id, terra);
      expect(pool.primary, r.key).toBe(battleTrackOf(id, terra));
      if (pool.primary === "battle_ottoman") expect(pool.tracks, r.key).toEqual(["battle_ottoman"]);
      // 雾：每片写了音乐分区的海都有《雾号》，primary 仍是这片海的航海曲
      expect(fogPoolOf(id, null, terra), r.key).toEqual({ primary: seaTrackOf(id, null, terra), tracks: ["sea_fog"], kind: "sea" });
    });
    expect(battlePoolOf(regionId("aegean"), terra).primary).toBe("battle_ottoman");
  });

  it("每个港口与城市的池：primary 就是原来的选曲结果；伊比利亚、日本、明、奥斯曼、马来、意大利、法兰西、斯瓦希里、新大陆沿岸与北方中欧的城镇各有第二首", () => {
    const styleOf = new Map(TERRA16_FACTIONS.map((f) => [f.key, f.style]));
    const known = TERRA16_PLACES.filter((p) => styleOf.has(p.faction));
    const heard = new Set<TrackId>();
    for (const p of known) {
      const music = p.region === null ? null : TERRA16_REGIONS[p.region].music;
      const pool = portPoolIn(p.faction, styleOf.get(p.faction) ?? null, music);
      expect(pool.primary, p.key).toBe(terra16PortTrack(p.key));
      expect(pool.tracks[0], p.key).toBe(pool.primary);
      for (const t of pool.tracks) heard.add(t);
    }
    for (const id of ["port_iberia_eve", "port_indies", "port_japan_eve", "port_ming_tea", "port_ottoman_cafe", "port_malay_night", "port_town", "port_lagoon", "port_estuary", "port_taarab"] as const) {
      expect(heard.has(id), `${id} 在寰宇里轮不到`).toBe(true);
    }
    const poolAt = (place: string, minute?: number) => {
      const p = TERRA16_PLACES.find((x) => x.key === place)!;
      return portPoolIn(p.faction, styleOf.get(p.faction) ?? null, p.region === null ? null : TERRA16_REGIONS[p.region].music, minute).tracks;
    };
    expect(poolAt("lisbon")).toEqual(["port_iberia", "port_iberia_eve"]);
    expect(poolAt("sakai")).toEqual(["port_japan", "port_japan_eve"]);
    expect(poolAt("yuegang")).toEqual(["port_ming", "port_ming_tea"]);
    expect(poolAt("istanbul")).toEqual(["port_ottoman", "port_ottoman_cafe"]);
    expect(poolAt("gresik")).toEqual(["port_malay", "port_malay_night"]);
    expect(poolAt("veracruz")).toEqual(["port_frontier", "port_indies"]);
    expect(poolAt("danzig")).toEqual(["port_nordic", "port_town"]);
    expect(poolAt("venice")).toEqual(["port_italy", "port_lagoon"]);
    expect(poolAt("marseille")).toEqual(["port_france", "port_estuary"]);
    expect(poolAt("kilwa")).toEqual(["port_swahili", "port_taarab"]);
    // 爱琴海上威尼斯治下的希腊人的港口照旧换成《酒色的海湾》，没有第二首
    expect(poolAt("candia")).toEqual(["port_levant"]);
    // 红海与海湾上奥斯曼治下的阿拉伯人的港口照旧换成《乳香与咖啡的码头》，没有第二首
    expect(poolAt("jeddah")).toEqual(["port_arabia"]);
    // 天黑以后进港：写傍晚的那一首排在前面；白天、黎明照旧
    expect(poolAt("lisbon", 22 * 60)).toEqual(["port_iberia_eve", "port_iberia"]);
    expect(poolAt("lisbon", 18 * 60)).toEqual(["port_iberia_eve", "port_iberia"]);
    expect(poolAt("lisbon", 3 * 60)).toEqual(["port_iberia_eve", "port_iberia"]);
    expect(poolAt("lisbon", 6 * 60)).toEqual(["port_iberia", "port_iberia_eve"]);
    expect(poolAt("lisbon", 12 * 60)).toEqual(["port_iberia", "port_iberia_eve"]);
    expect(poolAt("sakai", 23 * 60)).toEqual(["port_japan_eve", "port_japan"]);
    expect(poolAt("gresik", 20 * 60)).toEqual(["port_malay_night", "port_malay"]);
    // 没有写傍晚的那一首的池不看时刻
    expect(poolAt("yuegang", 22 * 60)).toEqual(["port_ming", "port_ming_tea"]);
  });

  it("多写的航海曲、风暴与海战曲、港口曲：每一首在寰宇里至少有一处轮得到（养成的八首由养成的池管）", () => {
    const styleOf = new Map(TERRA16_FACTIONS.map((f) => [f.key, f.style]));
    const heard = new Set<TrackId>();
    TERRA16_REGIONS.forEach((_, id) => {
      for (const pool of [seaPoolOf(id, null, terra), stormPoolOf(id, terra), battlePoolOf(id, terra), fogPoolOf(id, null, terra)]) for (const t of pool?.tracks ?? []) heard.add(t);
    });
    for (const p of TERRA16_PLACES) {
      if (!styleOf.has(p.faction)) continue;
      for (const t of portPoolIn(p.faction, styleOf.get(p.faction) ?? null, p.region === null ? null : TERRA16_REGIONS[p.region].music).tracks) heard.add(t);
    }
    for (const t of Object.values(UB_EVENT_POOLS).flat()) if (t) heard.add(t);
    for (const t of Object.values(UB_SEASON_TRACKS)) heard.add(t);
    for (const id of MORE_TRACK_IDS) expect(heard.has(id), `${id} 没有接进任何曲目池`).toBe(true);
  });
});

describe("轮换（PoolRotations）", () => {
  const sea: ScenePool = { primary: "sea_iberia", tracks: ["sea_iberia", "sea_canaries"], kind: "sea" };
  const ocean: ScenePool = { primary: "sea_iberia", tracks: ["sea_atlantic", "sea_swell", "sea_night", "ocean"], kind: "sea" };
  const battle: ScenePool = { primary: "battle", tracks: ["battle", "battle_broadside"], kind: "battle" };
  const heart: ScenePool = { primary: "ub_heart", tracks: ["ub_heart", "ub_heart_walk"], kind: "event" };
  const playing = (track: string, rested = -1) => ({ track, resting: rested >= 0, rested: Math.max(0, rested) });

  it("还没进过的池取第一首（不是 primary）；取曲是纯查询；不轮换的取法取 primary", () => {
    const r = new PoolRotations(rng(1));
    expect(r.pick(ocean)).toBe("sea_atlantic");
    expect(r.pick(sea)).toBe("sea_iberia");
    expect(primaryPick(ocean)).toBe("sea_iberia");
    expect(poolKey(sea)).not.toBe(poolKey({ ...sea, tracks: [...sea.tracks].reverse() }));
    expect(r.preview(ocean, 10)).toBe("sea_atlantic");
  });

  it("一遍奏完、在留白里停够了、这一首也听够了：换下一首并说“立即换”；差一样都不换", () => {
    const r = new PoolRotations(rng(2));
    expect(r.step(sea, null, 0)).toBe(false);
    expect(r.pick(sea)).toBe("sea_iberia");
    // 开始放：从第 1 秒听到第 68 秒
    expect(r.step(sea, playing("sea_iberia"), 1)).toBe(false);
    expect(r.step(sea, playing("sea_iberia"), 40)).toBe(false);
    // 留白里只停了 5 秒：不换
    expect(r.step(sea, playing("sea_iberia", 5), 73)).toBe(false);
    expect(r.pick(sea)).toBe("sea_iberia");
    // 停够了 12 秒：换
    expect(r.step(sea, playing("sea_iberia", POOL_RULES.sea.rest! + 0.5), 80.5)).toBe(true);
    expect(r.pick(sea)).toBe("sea_canaries");
    // 新的一首还没开始放：不再换
    expect(r.step(sea, playing("sea_iberia", 14), 82)).toBe(false);
    expect(r.pick(sea)).toBe("sea_canaries");
  });

  it("这一首只听了一小段（不满 min 秒）就奏完了：再奏一遍，不换", () => {
    const r = new PoolRotations(rng(3));
    r.step(sea, null, 0);
    r.step(sea, playing("sea_iberia"), 100);
    expect(r.step(sea, playing("sea_iberia", 20), 100 + POOL_RULES.sea.min - 10)).toBe(false);
    expect(r.pick(sea)).toBe("sea_iberia");
  });

  it("引擎放的不是轮到的这一首（场景还没稳定、旧曲子还在放）时不计时也不换", () => {
    const r = new PoolRotations(rng(4));
    r.step(sea, null, 0);
    expect(r.step(sea, playing("port_iberia", 30), 200)).toBe(false);
    expect(r.pick(sea)).toBe("sea_iberia");
  });

  it("离开再回来：离开够久、上一首也听够了才换；离开得短（一阵风暴）接着放原来那一首", () => {
    const r = new PoolRotations(rng(5));
    r.step(sea, null, 0);
    r.step(sea, playing("sea_iberia"), 1);
    // 听了 50 秒，进港（另一个情境）
    r.step(null, playing("sea_iberia"), 51);
    // 只离开了 10 秒就回来：原来那一首
    expect(r.preview(sea, 61)).toBe("sea_iberia");
    r.step(sea, playing("port_iberia"), 61);
    expect(r.pick(sea)).toBe("sea_iberia");
    // 再离开，过了很久回来：下一首
    r.step(null, null, 62);
    expect(r.preview(sea, 62 + POOL_RULES.sea.away)).toBe("sea_canaries");
    expect(r.pick(sea)).toBe("sea_iberia");
    expect(r.step(sea, null, 62 + POOL_RULES.sea.away)).toBe(false);
    expect(r.pick(sea)).toBe("sea_canaries");
  });

  it("离开够久、可上一首没怎么听（刚出港就又进港）：回来还是它", () => {
    const r = new PoolRotations(rng(6));
    r.step(sea, null, 0);
    r.step(sea, playing("sea_iberia"), 1);
    r.step(null, null, 1 + POOL_RULES.sea.heard - 5);
    r.step(sea, null, 500);
    expect(r.pick(sea)).toBe("sea_iberia");
  });

  it("海战与养成的事件：放着的时候奏完多少遍都不换，下一场 / 下一件才换", () => {
    for (const pool of [battle, heart]) {
      const r = new PoolRotations(rng(7));
      const [a, b] = pool.tracks;
      r.step(pool, null, 0);
      r.step(pool, playing(a), 1);
      expect(r.step(pool, playing(a, 60), 300), pool.kind).toBe(false);
      expect(r.pick(pool)).toBe(a);
      r.step(null, null, 301);
      r.step(pool, null, 301 + POOL_RULES[pool.kind].away + 1);
      expect(r.pick(pool), pool.kind).toBe(b);
    }
  });

  it("各个池各记各的：从海上进港再出港，海的轮换不受港口的影响", () => {
    const port: ScenePool = { primary: "port_iberia", tracks: ["port_iberia", "port_iberia_eve"], kind: "port" };
    const r = new PoolRotations(rng(8));
    r.step(sea, null, 0);
    r.step(sea, playing("sea_iberia"), 1);
    r.step(port, playing("sea_iberia"), 60);
    expect(r.pick(port)).toBe("port_iberia");
    expect(r.pick(sea)).toBe("sea_iberia");
    r.step(port, playing("port_iberia"), 62);
    r.step(sea, playing("port_iberia"), 200);
    expect(r.pick(sea)).toBe("sea_canaries");
    expect(r.pick(port)).toBe("port_iberia");
  });

  it("四首的池：一副牌轮完每首都放到，同一首不连着放；同一个种子次序相同", () => {
    const order = (seed: number): TrackId[] => {
      const r = new PoolRotations(rng(seed));
      const out: TrackId[] = [];
      let t = 0;
      r.step(ocean, null, t);
      for (let i = 0; i < 12; i++) {
        const cur = r.pick(ocean);
        out.push(cur);
        r.step(ocean, playing(cur), t + 1);
        t += 100;
        expect(r.step(ocean, playing(cur, 13), t)).toBe(true);
      }
      return out;
    };
    const a = order(11);
    expect(a[0]).toBe("sea_atlantic");
    for (let i = 1; i < a.length; i++) expect(a[i], `第 ${i} 首`).not.toBe(a[i - 1]);
    expect(new Set(a.slice(0, 4)).size).toBe(4);
    for (const id of ocean.tracks) expect(a).toContain(id);
    expect(order(11)).toEqual(a);
  });

  it("只有一首的池不记状态；没有音频时间（还没有引擎）时什么都不动", () => {
    const r = new PoolRotations(rng(9));
    const single: ScenePool = { primary: "sea_arctic", tracks: ["sea_arctic"], kind: "sea" };
    expect(r.step(single, playing("sea_arctic", 30), 500)).toBe(false);
    expect(r.pick(single)).toBe("sea_arctic");
    expect(r.step(sea, playing("sea_iberia", 30), null)).toBe(false);
    expect(r.pick(sea)).toBe("sea_iberia");
  });
});

describe("配乐导演的场景（sceneOf / scenePool / likelyNext）", () => {
  const first = (p: ScenePool) => p.tracks[0];
  const second = (p: ScenePool) => p.tracks[1] ?? p.tracks[0];

  it("海上：不给取曲的函数时是原来的那一首，给了就从池里取；scenePool 给出这一刻的池", () => {
    const mid = regionId("south_atlantic");
    expect(sceneOf(true, terra, atSea(mid)).track).toBe("sea_iberia");
    expect(sceneOf(true, terra, atSea(mid), null, null, first).track).toBe("sea_atlantic");
    expect(sceneOf(true, terra, atSea(mid), null, null, second).track).toBe("sea_swell");
    expect(scenePool(true, terra, atSea(mid))).toEqual(seaPoolOf(mid, { x: 100, y: 60 }, terra));
    const seto = regionId("seto_inland");
    expect(sceneOf(true, terra, atSea(seto), null, null, second).track).toBe("sea_kuroshio");
  });

  it("风暴、雾、海战：各自的池；雾天不给取曲的函数时照旧放航海曲", () => {
    const ecs = regionId("east_china_sea");
    expect(sceneOf(true, terra, atSea(ecs, "storm")).track).toBe("storm");
    expect(sceneOf(true, terra, atSea(ecs, "storm"), null, null, first).track).toBe("storm_typhoon");
    expect(scenePool(true, terra, atSea(ecs, "storm"))?.kind).toBe("storm");
    expect(sceneOf(true, terra, atSea(ecs, "fog")).track).toBe("sea_east_china");
    expect(sceneOf(true, terra, atSea(ecs, "fog"), null, null, first).track).toBe("sea_fog");
    expect(sceneOf(true, terra, atSea(ecs, "rain"), null, null, first).track).toBe("sea_east_china");
    const pirates = { ...atSea(ecs), pending_battles: [{ id: 1 }] } as unknown as Overview;
    expect(sceneOf(true, terra, pirates)).toMatchObject({ track: "battle", urgent: true });
    expect(sceneOf(true, terra, pirates, null, null, first)).toMatchObject({ track: "battle_east", urgent: true });
    expect(scenePool(true, terra, pirates)?.kind).toBe("battle");
  });

  it("主题曲没有池", () => {
    expect(scenePool(false, terra, atSea(0))).toBeNull();
    expect(scenePool(true, terra, null)).toBeNull();
  });

  it("后台预取：给了取曲的函数就按它取接下来的航海曲、海战与风暴", () => {
    const ecs = regionId("east_china_sea");
    const next = likelyNext(terra, atSea(ecs), null, null, first);
    expect(next).toContain("battle_east");
    expect(next).toContain("storm_typhoon");
    const plain = likelyNext(terra, atSea(ecs));
    expect(plain).toContain("battle");
    expect(plain).toContain("storm");
    expect(plain).not.toContain("battle_east");
  });
});

describe("养成：季节、这一带别的曲子、事件的池", () => {
  const source = (o: Partial<UbMusicSource> = {}): UbMusicSource => ({ stage: "home", phase: "plan", calendar: [], today: [1553, 1, 1], ...o });
  const digest = (o: Partial<UbMusicDigest> = {}): UbMusicDigest => ({ stage: "home", phase: "plan", festival: false, contestDay: false, contestOpen: false, ...o });
  const japan = {
    factions: [{ key: "tosa", style: "japanese" }],
    regions: [{ id: 0, music: "japan" }],
    locations: [
      { id: 0, key: "shimoda_tosa", kind: "port", faction: 0, region: 0, x: 900, y: 150 },
      { id: 1, key: "kyoto", kind: "city", faction: 0, region: null, x: 905, y: 145 },
    ],
  } as unknown as StaticView;

  it("月份 → 季节；摘要按养成视图的当天算季节", () => {
    expect([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map(seasonOfMonth)).toEqual(["winter", "winter", "spring", "spring", "spring", "summer", "summer", "summer", "autumn", "autumn", "autumn", "winter"]);
    for (const bad of [0, 13, 2.5, "3", null, undefined]) expect(seasonOfMonth(bad)).toBeNull();
    expect(digestOf(source({ today: [1553, 4, 9] })).season).toBe("spring");
    expect(digestOf(source({ today: [1553, 12, 30] })).season).toBe("winter");
    expect(Object.values(UB_SEASON_TRACKS)).toEqual(["ub_spring", "ub_summer", "ub_autumn", "ub_winter"]);
  });

  it("平时的曲目池：这个季节的那一首排在三首通用的平时曲之后；没有季节（手写的摘要）时与原来一样", () => {
    expect(everydayPool(digest({ protagonist: "mio", season: "summer" }))).toEqual(["ub_home", "ub_home_japan", ...UB_EVERYDAY, "ub_summer", "title"]);
    expect(everydayPool(digest({ protagonist: "mio" }))).toEqual(["ub_home", "ub_home_japan", ...UB_EVERYDAY, "title"]);
    const pools = (["spring", "summer", "autumn", "winter"] as const).map((season) => everydayPool(digest({ season })));
    pools.forEach((p, i) => {
      expect(p.filter((id) => Object.values(UB_SEASON_TRACKS).includes(id))).toEqual([Object.values(UB_SEASON_TRACKS)[i]]);
    });
  });

  it("这一带的曲目池里别的几首：港口的池再取一首、海的池再取两首，不与已有的重复；内陆城市只有港口的；认不出时为空", () => {
    expect(voyageTracksOf(japan, "shimoda_tosa")).toEqual(["port_japan", "sea_japan", "ocean"]);
    expect(voyageMoreOf(japan, "shimoda_tosa")).toEqual(["port_japan_eve", "sea_kuroshio"]);
    expect(voyageMoreOf(japan, "kyoto")).toEqual(["port_japan_eve"]);
    expect(voyageMoreOf(japan, "nowhere")).toEqual([]);
    expect(voyageMoreOf(null, "shimoda_tosa")).toEqual([]);
    // 寰宇的里斯本：伊比利亚的第二首港口曲与第二首航海曲
    expect(voyageMoreOf(terra, "lisbon")).toEqual(["port_iberia_eve", "sea_canaries"]);
    // 远洋的池里已经有《晨星洋》：不重复，最多再取两首
    expect(voyageMoreOf(terra, "kilwa")).toEqual(["port_taarab", "sea_swahili"]);
  });

  it("发布摘要时带上季节与这一带别的曲子，平时的轮换里都轮得到", () => {
    useUbMusic.setState({ digest: null });
    publishUpbringing(source({ today: [1553, 7, 2], town: { key: "shimoda_tosa" }, protagonist: { key: "mio" } }), false, japan);
    const d = useUbMusic.getState().digest!;
    expect(d.voyage).toEqual(["port_japan", "sea_japan", "ocean"]);
    expect(d.voyageMore).toEqual(["port_japan_eve", "sea_kuroshio"]);
    expect(d.season).toBe("summer");
    expect(everydayPool(d)).toEqual(["ub_home", "ub_home_japan", ...UB_EVERYDAY, "ub_summer", "port_japan", "sea_japan", "ocean", "port_japan_eve", "sea_kuroshio", "title"]);
    // 换了季节：摘要变了
    let notified = 0;
    const off = useUbMusic.subscribe(() => notified++);
    publishUpbringing(source({ today: [1553, 7, 20], town: { key: "shimoda_tosa" }, protagonist: { key: "mio" } }), false, japan);
    expect(notified).toBe(0);
    publishUpbringing(source({ today: [1553, 9, 1], town: { key: "shimoda_tosa" }, protagonist: { key: "mio" } }), false, japan);
    expect(notified).toBe(1);
    expect(useUbMusic.getState().digest?.season).toBe("autumn");
    off();
    useUbMusic.setState({ digest: null });
  });

  it("事件与比赛的池：心动、悲伤、紧张、比赛各两首；平时、节日、结业的曲子没有池", () => {
    expect(ubPoolOf("ub_heart")).toEqual({ primary: "ub_heart", tracks: ["ub_heart", "ub_heart_walk"], kind: "event" });
    expect(ubPoolOf("ub_sad")?.tracks).toEqual(["ub_sad", "ub_lamp_out"]);
    expect(ubPoolOf("ub_tense")?.tracks).toEqual(["ub_tense", "ub_footsteps"]);
    expect(ubPoolOf("ub_contest")?.tracks).toEqual(["ub_contest", "ub_final"]);
    for (const id of ["ub_home", "ub_festival", "ub_graduation", "ub_letter", "ub_mystic", "ub_study", "title"] as const) expect(ubPoolOf(id), id).toBeNull();
  });

  it("养成中的场景：事件的曲子不给取曲的函数时照旧，给了就从池里取；平时的轮换不经过池", () => {
    const tender = { ...overview, mode: "upbringing", story: { line: null, pending: { day: 1, fleet: 0, kind: "bond", key: "ev", title: "", text: "", speaker: { name: "" }, choices: [], mood: "tender" }, last: null, journal: [] } } as unknown as Overview;
    const second = (p: ScenePool) => p.tracks[1];
    expect(sceneOf(true, statics, tender, digest()).track).toBe("ub_heart");
    expect(sceneOf(true, statics, tender, digest(), null, second)).toMatchObject({ track: "ub_heart_walk", urgent: true });
    expect(scenePool(true, statics, tender, digest())?.kind).toBe("event");
    const plain = { ...overview, mode: "upbringing" } as Overview;
    expect(scenePool(true, statics, plain, digest())).toBeNull();
    expect(sceneOf(true, statics, plain, digest(), null, second).track).toBe("ub_home");
    expect(sceneOf(true, statics, plain, digest({ contestDay: true }), null, second).track).toBe("ub_final");
  });
});
