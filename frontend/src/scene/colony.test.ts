// 殖民地与殖民点街景：尺寸、热点（设施与殖民建筑）、主角的船、“建立殖民地”空地、地形与确定性。
import { describe, expect, it } from "vitest";
import { COLONY_KEYS } from "../art/buildings";
import { sceneParams } from "../components/port/params";
import { overview, statics } from "../test/fixtures";
import { composePortScene, facilitiesAt, layoutPortScene, SCENE_HEIGHT, TERRAINS, type PortSceneParams, type Rect, type SceneColony } from "./port";

function overlaps(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

function inside(r: Rect, w: number): boolean {
  return r.x >= 0 && r.y >= 0 && r.x + r.w <= w && r.y + r.h <= SCENE_HEIGHT;
}

function sameImage(a: PortSceneParams, b: PortSceneParams, frame = 5): boolean {
  const x = composePortScene(a, frame).px.clone();
  const y = composePortScene(b, frame).px.clone();
  return x.w === y.w && x.data.every((v, i) => v === y.data[i]);
}

const SMALL: SceneColony = { population: 30, buildings: [{ key: "housing", level: 1 }, { key: "farm", level: 1 }] };
const MEDIUM: SceneColony = {
  population: 240,
  buildings: [
    { key: "housing", level: 2 },
    { key: "farm", level: 2 },
    { key: "lumber", level: 1 },
    { key: "storehouse", level: 2 },
    { key: "chapel", level: 1 },
    { key: "fort", level: 1 },
    { key: "dock", level: 1 },
  ],
};
const LARGE: SceneColony = { population: 1200, buildings: COLONY_KEYS.map((key) => ({ key, level: 3 })) };

function colonyParams(colony: SceneColony, width: number, over: Partial<PortSceneParams> = {}): PortSceneParams {
  return {
    key: "new-haven",
    kind: "colony",
    faction: "cuilan",
    style: "frontier",
    flag: "#c0392b",
    terrain: "forest",
    colony,
    facilities: facilitiesAt("colony", false, false),
    season: width % 4,
    width,
    flagship: { type: 1, sail: "square" },
    others: 2,
    ...over,
  };
}

describe("殖民地街景", () => {
  const cases: PortSceneParams[] = [];
  for (const [i, colony] of [SMALL, MEDIUM, LARGE].entries()) {
    for (const width of [400, 480, 640, 960, 1400]) {
      cases.push(colonyParams(colony, width, { terrain: TERRAINS[(i * 3 + width) % TERRAINS.length], style: i === 2 ? "mediterranean" : "frontier" }));
    }
  }

  it("尺寸正确；每座建成的殖民建筑与每个设施恰好一个热点，都在画面内、互不重叠", () => {
    for (const c of cases) {
      const { px, hotspots, buildings } = composePortScene(c, 7);
      const tag = `${c.colony?.buildings.length} 座 @${c.width} ${c.terrain}`;
      expect([px.w, px.h], tag).toEqual([c.width, SCENE_HEIGHT]);
      expect(hotspots.map((h) => h.facility).sort(), tag).toEqual([...c.facilities].sort());
      const built = [...new Set((c.colony?.buildings ?? []).filter((b) => b.level >= 1).map((b) => b.key))].sort();
      expect(buildings.map((b) => b.building).sort(), tag).toEqual(built);
      const all: Rect[] = [...hotspots, ...buildings];
      for (const h of all) {
        expect(h.w, tag).toBeGreaterThan(4);
        expect(h.h, tag).toBeGreaterThan(4);
        expect(inside(h, c.width), tag).toBe(true);
      }
      for (let i = 0; i < all.length; i++) for (let j = i + 1; j < all.length; j++) expect(overlaps(all[i], all[j]), tag).toBe(false);
      // 热点报告真实等级（画面太挤时可以按低一级的样子画）
      for (const b of buildings) expect(b.level, tag).toBe(Math.max(...(c.colony?.buildings ?? []).filter((x) => x.key === b.building).map((x) => x.level)));
      // 布局函数与合成结果一致
      const lay = layoutPortScene(c);
      expect(lay.hotspots).toEqual(hotspots);
      expect(lay.buildings).toEqual(buildings);
      expect(lay.found).toBeNull();
    }
  });

  it("同样的参数与帧号画出同样的图；帧号变化时画面在动；悬停殖民建筑画出描边", () => {
    const c = cases[7];
    expect(sameImage(c, c)).toBe(true);
    const a = composePortScene(c, 12).px.clone();
    const later = composePortScene(c, 40).px.clone();
    expect(Array.from(later.data)).not.toEqual(Array.from(a.data));
    expect(sameImage(c, { ...c, hoverBuilding: "chapel" })).toBe(false);
    expect(sameImage(c, { ...c, hover: "market" })).toBe(false);
    const buf = composePortScene(c, 1).px;
    expect(composePortScene(c, 2, buf).px).toBe(buf);
  });

  it("码头决定能否靠岸：有码头时船停在码头外，没有码头时下锚在湾里", () => {
    const docked = layoutPortScene(colonyParams(MEDIUM, 640));
    const dock = docked.buildings.find((b) => b.building === "dock");
    expect(dock).toBeDefined();
    expect(docked.berth).not.toBeNull();
    const berth = docked.berth!;
    expect(inside(berth, 640)).toBe(true);
    // 船底贴近画面下沿（停在栈桥外侧），船身与码头有交叠
    expect(berth.y + berth.h).toBeGreaterThan(250);
    expect(berth.x).toBeLessThan(dock!.x + dock!.w);

    const anchored = layoutPortScene(colonyParams(SMALL, 640));
    expect(anchored.buildings.find((b) => b.building === "dock")).toBeUndefined();
    const ab = anchored.berth!;
    expect(ab).not.toBeNull();
    expect(inside(ab, 640)).toBe(true);
    expect(ab.y + ab.h).toBeLessThan(berth.y + berth.h);
    // 下锚的船在陆地之外：不压在殖民建筑上
    for (const b of anchored.buildings) expect(overlaps(ab, b)).toBe(false);
    expect(layoutPortScene(colonyParams(SMALL, 640, { flagship: null })).berth).toBeNull();
  });

  it("人口决定行人、建筑与等级改变画面、风格与地形改变画面", () => {
    const base = colonyParams(MEDIUM, 640, { flagship: null, others: 0 });
    expect(sameImage(base, { ...base, colony: { ...MEDIUM, population: 1200 } })).toBe(false);
    expect(sameImage(base, { ...base, colony: { ...MEDIUM, buildings: MEDIUM.buildings.map((b) => ({ ...b, level: 3 })) } })).toBe(false);
    expect(sameImage(base, { ...base, style: "mediterranean", colony: LARGE })).toBe(false);
    expect(sameImage(base, { ...base, terrain: "desert" })).toBe(false);
    // 等级 0 的建筑不画
    const withZero = { ...base, colony: { ...MEDIUM, buildings: [...MEDIUM.buildings, { key: "tavern", level: 0 }] } };
    expect(layoutPortScene(withZero).buildings.map((b) => b.building)).not.toContain("tavern");
  });

  it("没有殖民建筑的殖民地也能画；未知的地形按森林处理", () => {
    const empty = colonyParams({ population: 0, buildings: [] }, 400, { facilities: [], terrain: "moon" });
    const { px, hotspots, buildings } = composePortScene(empty, 3);
    expect(px.w).toBe(400);
    expect(hotspots).toEqual([]);
    expect(buildings).toEqual([]);
    expect(sameImage(empty, { ...empty, terrain: "forest" })).toBe(true);
  });

  it("静态层缓存：同一殖民地连续合成每帧足够快（平均 < 40 ms）", () => {
    const c = colonyParams(LARGE, 960);
    composePortScene(c, 0);
    const t0 = performance.now();
    for (let f = 1; f <= 10; f++) composePortScene(c, f);
    expect((performance.now() - t0) / 10).toBeLessThan(40);
  });
});

describe("殖民点街景", () => {
  const site = (terrain: string, width: number, over: Partial<PortSceneParams> = {}): PortSceneParams => ({
    key: `site-${terrain}`,
    kind: "site",
    faction: "",
    terrain,
    facilities: facilitiesAt("site", true, true),
    season: 1,
    width,
    flagship: { type: 0, sail: "lateen" },
    others: 1,
    ...over,
  });

  it("没有设施与殖民建筑；画面里留出“建立殖民地”的空地", () => {
    expect(facilitiesAt("site", true, true)).toEqual([]);
    for (const terrain of TERRAINS) {
      for (const width of [400, 640, 1400]) {
        const p = site(terrain, width);
        const { px, hotspots, buildings } = composePortScene(p, 9);
        expect([px.w, px.h]).toEqual([width, SCENE_HEIGHT]);
        expect(hotspots).toEqual([]);
        expect(buildings).toEqual([]);
        const lay = layoutPortScene(p);
        expect(lay.found, terrain).not.toBeNull();
        const f = lay.found!;
        expect(f.w).toBeGreaterThanOrEqual(60);
        expect(f.h).toBeGreaterThanOrEqual(24);
        expect(inside(f, width)).toBe(true);
        // 空地不被主角的船挡住
        expect(lay.berth).not.toBeNull();
        expect(overlaps(f, lay.berth!)).toBe(false);
      }
    }
  });

  it("八种地形画出八种不同的荒野；季节、古迹残垣改变画面；同参数完全相同", () => {
    const imgs = TERRAINS.map((t) => composePortScene(site(t, 640, { key: "same-bay" }), 4).px.clone());
    for (let i = 0; i < imgs.length; i++) {
      for (let j = i + 1; j < imgs.length; j++) expect(imgs[i].data.every((v, k) => v === imgs[j].data[k]), `${TERRAINS[i]}/${TERRAINS[j]}`).toBe(false);
    }
    const p = site("jungle", 640);
    expect(sameImage(p, p)).toBe(true);
    expect(sameImage(p, { ...p, season: 3 })).toBe(false);
    expect(sameImage({ ...p, ruins: true }, { ...p, ruins: false })).toBe(false);
    // 苔原的冬天积雪
    const tundra = composePortScene(site("tundra", 640, { season: 3 }), 0).px;
    expect(tundra.data.some((v) => v === 0xffffffff)).toBe(true);
  });
});

describe("殖民地的设施与街景参数", () => {
  it("殖民地只有交易所与仓库，有船厂时加船厂；港口与城市不变", () => {
    expect(facilitiesAt("colony", false, true)).toEqual(["market", "warehouse"]);
    expect(facilitiesAt("colony", true, false)).toEqual(["market", "shipyard", "warehouse"]);
    expect(facilitiesAt("port", true, true)).toHaveLength(9);
    expect(facilitiesAt("city", true, false)).not.toContain("shipyard");
  });

  it("地点是殖民点时：没有殖民地数据画荒野，给出殖民地数据画殖民地（默认开拓者风格）", () => {
    const withSite = {
      ...statics,
      locations: [...statics.locations, { id: 3, key: "silvermist_mouth", name: "银雾河口", kind: "site" as never, x: 0, y: 0, faction: 0, shipyard: false, terrain: "swamp" }],
    };
    const wild = sceneParams(withSite, overview, 3);
    expect(wild.kind).toBe("site");
    expect(wild.terrain).toBe("swamp");
    expect(wild.facilities).toEqual([]);
    expect(wild.colony).toBeNull();
    const col = sceneParams(withSite, overview, 3, { ...MEDIUM });
    expect(col.kind).toBe("colony");
    expect(col.style).toBe("frontier");
    expect(col.colony?.buildings).toEqual(MEDIUM.buildings);
    expect(col.facilities).toEqual(["market", "warehouse"]);
    const owned = sceneParams(withSite, overview, 3, { ...MEDIUM, style: "mediterranean", flag: "#123456" });
    expect(owned.style).toBe("mediterranean");
    expect(owned.flag).toBe("#123456");
    // 港口不受影响
    expect(sceneParams(withSite, overview, 0).kind).toBe("port");
    expect(sceneParams(withSite, overview, 0).colony).toBeUndefined();
  });
});
