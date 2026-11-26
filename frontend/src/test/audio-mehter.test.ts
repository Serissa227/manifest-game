// 配乐导演：海战曲的奥斯曼变奏（地方特色第二阶段）——第九批的世界在黎凡特、红海或奥斯曼港口的海上遇到海盗时放《新月的战鼓》，
// 照样立即切换、预取；经典世界照旧是《黑帆》；希腊与黎凡特风格的港口放《酒色的海湾》。
import { describe, expect, it } from "vitest";
import { likelyNext, sceneOf } from "../audio/director";
import type { LocalWeatherView, Overview, PendingView, StaticView } from "../ipc/types";
import { overview, statics } from "./fixtures";

/** 舰队在海区 region 的海上（或停在地点 docked）。 */
function at(region: number, extra: Partial<Overview> = {}, docked: number | null = null): Overview {
  const weather = { region, region_name: "", sky: "clear", wind_dir: 2, wind_strength: 4, forecast: [] } as unknown as LocalWeatherView;
  return { ...overview, fleets: [{ ...overview.fleets[0], docked, x: 100, y: 60 }], local_weather: weather, ...extra };
}

/** 第九批式的静态数据：海区 0–5，海区 4 写了黎凡特的 music，海区 5 写了伊比利亚，其余没写。 */
const terra: StaticView = {
  ...statics,
  regions: [0, 1, 2, 3, 4, 5].map((id) => ({ id, name: `海区${id}`, ...(id === 4 ? { music: "levant" } : id === 5 ? { music: "iberia" } : {}) })),
};

const pirates = { pending_battles: [{ id: 7 } as PendingView] };

describe("海战曲的奥斯曼变奏", () => {
  it("黎凡特的海上遇到海盗、海战进行中：《新月的战鼓》，立即切换", () => {
    expect(sceneOf(true, terra, at(4, pirates))).toMatchObject({ track: "battle_ottoman", urgent: true });
    expect(sceneOf(true, terra, at(4, { tactical_battles: [3] })).track).toBe("battle_ottoman");
    // 平时还是这片海的航海曲
    expect(sceneOf(true, terra, at(4)).track).toBe("sea_levant");
  });

  it("别的海（伊比利亚、没写 music 的）与经典世界：照旧是《黑帆》", () => {
    expect(sceneOf(true, terra, at(5, pirates)).track).toBe("battle");
    expect(sceneOf(true, terra, at(0, pirates)).track).toBe("battle");
    for (let r = 0; r < 25; r++) expect(sceneOf(true, statics, at(r, pirates)).track, `${r}`).toBe("battle");
  });

  it("预取：黎凡特的海上接下来可能放的是《新月的战鼓》，别处是《黑帆》", () => {
    expect(likelyNext(terra, at(4))).toContain("battle_ottoman");
    expect(likelyNext(terra, at(4))).not.toContain("battle");
    expect(likelyNext(terra, at(5))).toContain("battle");
    expect(likelyNext(statics, at(4))).toContain("battle");
  });

  it("希腊与黎凡特风格的港口：《酒色的海湾》", () => {
    const greek: StaticView = { ...statics, factions: statics.factions.map((f, i) => (i === 0 ? { ...f, style: "greek" } : f)) };
    expect(sceneOf(true, greek, at(4, {}, 0)).track).toBe("port_levant");
    // 经典世界的同一个港口照旧
    expect(sceneOf(true, statics, at(4, {}, 0)).track).toBe("port_mediterranean");
  });

  it("威尼斯治下的希腊岛屿（势力风格是地中海）停泊在黎凡特的海区：《酒色的海湾》；奥斯曼的港口、别的海与经典世界照旧；在海上驶向它时预取这一首", () => {
    /** 地点 0 停泊在海区 region，势力 0 的风格是 style。 */
    const docked = (region: number, style: string | null): StaticView => ({
      ...terra,
      factions: terra.factions.map((f, i) => (i === 0 ? { ...f, key: style === "ottoman" ? "ottoman" : "venice", style } : f)),
      locations: terra.locations.map((l, i) => (i === 0 ? { ...l, region } : l)),
    });
    expect(sceneOf(true, docked(4, "mediterranean"), at(4, {}, 0)).track).toBe("port_levant");
    // 寰宇的数据里威尼斯写 venetian（配乐的数据接线，2026-10-11）：在黎凡特的海区照样换成《酒色的海湾》
    expect(sceneOf(true, docked(4, "venetian"), at(4, {}, 0)).track).toBe("port_levant");
    expect(sceneOf(true, docked(4, "ottoman"), at(4, {}, 0)).track).toBe("port_ottoman");
    // 别的海：写 venetian 的威尼斯放意大利的《商馆与凉廊》；写粗分的地中海就是地中海的一首（原来按势力 key 细分成意大利，见 DECISIONS“测试期望值变更”）
    expect(sceneOf(true, docked(5, "venetian"), at(5, {}, 0)).track).toBe("port_italy");
    expect(sceneOf(true, docked(0, "venetian"), at(0, {}, 0)).track).toBe("port_italy");
    expect(sceneOf(true, docked(5, "mediterranean"), at(5, {}, 0)).track).toBe("port_mediterranean");
    // 经典世界：海区不写 music，停泊处的海区不影响港口曲
    const classic: StaticView = { ...statics, locations: statics.locations.map((l, i) => (i === 0 ? { ...l, region: 0 } : l)) };
    expect(sceneOf(true, classic, at(0, {}, 0)).track).toBe("port_mediterranean");
    // 在海上驶向它：预取《酒色的海湾》
    const sailing = at(4, { fleets: [{ ...overview.fleets[0], docked: null, dest: 0, x: 100, y: 60 }] });
    expect(likelyNext(docked(4, "mediterranean"), sailing)).toContain("port_levant");
  });
});
