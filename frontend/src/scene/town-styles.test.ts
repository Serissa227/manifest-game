// 港口街景与城镇里的第九批文化风格（style 字段为 japanese、ming、ottoman、swahili、malay、maya 或它们的细名）：
// 热点几何照旧成立，画面换成各自的街景；经典世界的势力不受影响。
import { describe, expect, it } from "vitest";
import { COLONY_KEYS, CULTURE_BASE, CULTURE_STYLES, FACTION_STYLE } from "../art/buildings";
import { composePortScene, facilitiesAt, layoutPortScene, SCENE_HEIGHT, type PortSceneParams, type Rect, type SceneColony } from "./port";

function overlaps(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

function sameImage(a: PortSceneParams, b: PortSceneParams, frame = 5): boolean {
  const x = composePortScene(a, frame).px.clone();
  const y = composePortScene(b, frame).px.clone();
  return x.w === y.w && x.data.every((v, i) => v === y.data[i]);
}

function port(style: string | null, width: number, over: Partial<PortSceneParams> = {}): PortSceneParams {
  return {
    key: "terra-port",
    kind: "port",
    faction: "terra",
    style,
    flag: "#c0392b",
    facilities: facilitiesAt("port", true, true),
    season: width % 4,
    width,
    flagship: { type: 1, sail: "square" },
    others: 2,
    ...over,
  };
}

describe("文化风格的港口与城市街景", () => {
  it("热点都在画面内、互不重叠，每个设施恰好一个；布局函数与合成结果一致", () => {
    for (const style of CULTURE_STYLES) {
      for (const [kind, widths] of [
        ["port", [400, 640, 960, 1400]],
        ["city", [400, 640]],
      ] as const) {
        for (const width of widths) {
          const c = port(style, width, { kind, facilities: facilitiesAt(kind, kind === "port", true) });
          const { px, hotspots } = composePortScene(c, 7);
          const tag = `${style}/${kind}/${width}`;
          expect(px.w, tag).toBe(width);
          expect(px.h, tag).toBe(SCENE_HEIGHT);
          expect(hotspots.map((h) => h.facility).sort(), tag).toEqual([...c.facilities].sort());
          for (const h of hotspots) {
            expect(h.w, `${tag} ${h.facility}`).toBeGreaterThan(8);
            expect(h.h, `${tag} ${h.facility}`).toBeGreaterThan(8);
            expect(h.x).toBeGreaterThanOrEqual(0);
            expect(h.y).toBeGreaterThanOrEqual(0);
            expect(h.x + h.w).toBeLessThanOrEqual(width);
            expect(h.y + h.h).toBeLessThanOrEqual(SCENE_HEIGHT);
          }
          for (let i = 0; i < hotspots.length; i++) {
            for (let j = i + 1; j < hotspots.length; j++) expect(overlaps(hotspots[i], hotspots[j]), `${tag}: ${hotspots[i].facility} × ${hotspots[j].facility}`).toBe(false);
          }
          expect(layoutPortScene(c).hotspots, tag).toEqual(hotspots);
        }
      }
    }
  });

  it("文化风格画成自己的街景（与粗分风格的街景不同），同参数同帧画出同样的图，悬停改变描边", () => {
    for (const style of CULTURE_STYLES) {
      const c = port(style, 640);
      expect(sameImage(c, port(CULTURE_BASE[style], 640)), style).toBe(false);
      expect(sameImage(c, { ...c }), style).toBe(true);
      expect(sameImage(c, { ...c, hover: "market" }), style).toBe(false);
      // 夜里与白天不同（亮灯的民居、设施与远景）
      expect(sameImage(c, { ...c, time: "night" }), style).toBe(false);
    }
  });

  it("第九批的细名按回退表画：爪哇画成马来、印度画成奥斯曼、安第斯画成玛雅、朝鲜画成明", () => {
    for (const [name, town] of [
      ["javanese", "malay"],
      ["indian", "ottoman"],
      ["andean", "maya"],
      ["korean", "ming"],
    ] as const) {
      expect(sameImage(port(name, 480), port(town, 480)), name).toBe(true);
      expect(sameImage(port(name, 480), port(CULTURE_BASE[town], 480)), name).toBe(false);
    }
  });

  it("经典世界的势力（不带文化风格名）照旧：style 写成粗分风格与只给势力 key 画出同样的图", () => {
    for (const [faction, style] of Object.entries(FACTION_STYLE)) {
      expect(sameImage(port(null, 480, { faction }), port(style, 480, { faction }))).toBe(true);
    }
  });
});

describe("文化风格的殖民地", () => {
  const LARGE: SceneColony = { population: 1200, buildings: COLONY_KEYS.map((key) => ({ key, level: 3 })) };

  it("所有者是文化风格时，3 级殖民建筑按所有者的风格画；细名按回退表；热点不重叠", () => {
    const col = (style: string): PortSceneParams => ({
      key: "terra-colony",
      kind: "colony",
      faction: "terra",
      style,
      flag: "#c0392b",
      terrain: "jungle",
      colony: LARGE,
      facilities: facilitiesAt("colony", true, false),
      season: 1,
      width: 960,
      flagship: { type: 1, sail: "square" },
      others: 1,
    });
    for (const style of CULTURE_STYLES) {
      const c = col(style);
      expect(sameImage(c, col("frontier")), style).toBe(false);
      const { buildings, hotspots } = composePortScene(c, 3);
      const rects: Rect[] = [...buildings, ...hotspots];
      for (let i = 0; i < rects.length; i++) for (let j = i + 1; j < rects.length; j++) expect(overlaps(rects[i], rects[j]), style).toBe(false);
    }
    expect(sameImage(col("javanese"), col("malay"))).toBe(true);
  });
});
