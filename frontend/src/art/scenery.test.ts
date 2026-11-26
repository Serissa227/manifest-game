// 景物美术的约束：确定性、尺寸、海面循环、季节与天气的差异、只用确定性随机。
import { afterEach, describe, expect, it, vi } from "vitest";
import { ARCH_STYLES } from "./buildings";
import type { Px } from "./px";
import {
  FOAM_H,
  GULL_FRAMES,
  PIER_H,
  SEA_FRAMES,
  TREE_KINDS,
  climateOf,
  drawCloud,
  drawDistantLand,
  drawGround,
  drawGull,
  drawPier,
  drawSea,
  drawShoreFoam,
  drawSky,
  drawTree,
  gradeColor,
  shadeForTime,
  type Climate,
  type TimeOfDay,
  type Weather,
} from "./scenery";

const CLIMATES: Climate[] = ["temperate", "cold", "arid", "tropical"];
const TIMES: TimeOfDay[] = ["day", "dusk", "night"];
const WEATHERS: Weather[] = ["clear", "cloudy", "storm"];

function same(a: Px, b: Px): boolean {
  if (a.w !== b.w || a.h !== b.h) return false;
  for (let i = 0; i < a.data.length; i++) if (a.data[i] !== b.data[i]) return false;
  return true;
}

function opaqueCount(p: Px): number {
  let n = 0;
  for (const v of p.data) if (v & 0xff) n++;
  return n;
}

afterEach(() => vi.restoreAllMocks());

describe("景物：确定性与尺寸", () => {
  it("同样的参数永远画出同样的图，且不使用 Math.random", () => {
    vi.spyOn(Math, "random").mockImplementation(() => {
      throw new Error("美术代码不得使用 Math.random");
    });
    const makers: (() => Px)[] = [
      () => drawSky(200, 120, { season: 2, time: "night", weather: "cloudy" }),
      () => drawCloud(5, { season: 1, time: "dusk" }),
      () => drawDistantLand(180, 60, "tropical", 1),
      () => drawSea(90, 40, 3, { time: "dusk" }),
      () => drawShoreFoam(90, 5),
      () => drawPier(120, "islands"),
      () => drawTree("arid", 0, 7),
      () => drawGround(96, 24, "nordic", 3),
      () => drawGull(2),
    ];
    for (const make of makers) expect(same(make(), make())).toBe(true);
  });

  it("各函数返回约定的尺寸", () => {
    expect([drawSky(321, 181, { season: 0 }).w, drawSky(321, 181, { season: 0 }).h]).toEqual([321, 181]);
    const sea = drawSea(77, 33, 0);
    expect([sea.w, sea.h]).toEqual([77, 33]);
    const land = drawDistantLand(150, 64, "cold", 3);
    expect([land.w, land.h]).toEqual([150, 64]);
    const pier = drawPier(97, "eastern");
    expect([pier.w, pier.h]).toEqual([97, PIER_H]);
    const foam = drawShoreFoam(55, 1);
    expect([foam.w, foam.h]).toEqual([55, FOAM_H]);
    for (const style of ARCH_STYLES) {
      const g = drawGround(64, 20, style, 1);
      expect([g.w, g.h]).toEqual([64, 20]);
      // 地面铺满、没有透明洞
      expect(opaqueCount(g)).toBe(64 * 20);
    }
  });

  it("按建筑风格对应气候", () => {
    expect(ARCH_STYLES.map(climateOf)).toEqual(["temperate", "cold", "temperate", "arid", "tropical", "temperate", "temperate"]);
  });
});

describe("天空与云", () => {
  it("时间、天气、季节都会改变天空", () => {
    const skies = TIMES.flatMap((time) => WEATHERS.map((weather) => drawSky(120, 80, { season: 1, time, weather })));
    for (let i = 0; i < skies.length; i++) for (let j = i + 1; j < skies.length; j++) expect(same(skies[i], skies[j])).toBe(false);
    const seasons = [0, 1, 2, 3].map((s) => drawSky(120, 80, { season: s }));
    for (let i = 0; i < 4; i++) for (let j = i + 1; j < 4; j++) expect(same(seasons[i], seasons[j])).toBe(false);
    // 天空铺满整幅
    expect(opaqueCount(skies[0])).toBe(120 * 80);
  });

  it("至少 6 种不同的云，variant 相同则图相同", () => {
    const clouds = Array.from({ length: 8 }, (_, v) => drawCloud(v));
    for (let i = 0; i < clouds.length; i++) {
      expect(opaqueCount(clouds[i])).toBeGreaterThan(20);
      for (let j = i + 1; j < clouds.length; j++) expect(same(clouds[i], clouds[j])).toBe(false);
    }
    expect(same(drawCloud(11, { season: 3 }), drawCloud(11, { season: 3 }))).toBe(true);
    // 同一种云在暴风雨里更暗
    expect(same(drawCloud(0), drawCloud(0, { season: 0, weather: "storm" }))).toBe(false);
  });
});

describe("海面循环", () => {
  it("第 0 帧与第 8 帧（取模）完全一致，负帧号同样取模", () => {
    for (const time of TIMES) {
      expect(same(drawSea(64, 40, 0, { time }), drawSea(64, 40, SEA_FRAMES, { time }))).toBe(true);
      expect(same(drawSea(64, 40, 3, { time }), drawSea(64, 40, 3 + SEA_FRAMES * 2, { time }))).toBe(true);
      expect(same(drawSea(64, 40, -1, { time }), drawSea(64, 40, SEA_FRAMES - 1, { time }))).toBe(true);
    }
    expect(same(drawShoreFoam(64, 0), drawShoreFoam(64, SEA_FRAMES))).toBe(true);
  });

  it("相邻帧不同（真的在动），宽高任意也能画", () => {
    for (let f = 0; f < SEA_FRAMES; f++) expect(same(drawSea(64, 40, f), drawSea(64, 40, f + 1))).toBe(false);
    for (const [w, h] of [
      [1, 1],
      [3, 200],
      [640, 12],
    ]) {
      const p = drawSea(w, h, 5);
      expect(opaqueCount(p)).toBe(w * h);
    }
  });
});

describe("远景、码头、树、地面、海鸥", () => {
  it("远景：每种气候四季各不相同，且有透明的天空部分", () => {
    for (const c of CLIMATES) {
      const lands = [0, 1, 2, 3].map((s) => drawDistantLand(160, 60, c, s));
      for (const l of lands) {
        expect(opaqueCount(l)).toBeGreaterThan(160 * 10);
        expect(opaqueCount(l)).toBeLessThan(160 * 60);
      }
      // 冬季一定与夏季不同
      expect(same(lands[1], lands[3])).toBe(false);
    }
    // 给出夜晚时整幅调暗
    expect(same(drawDistantLand(100, 40, "temperate", 1), drawDistantLand(100, 40, "temperate", 1, { time: "night" }))).toBe(false);
  });

  it("码头：五种风格各不相同", () => {
    const piers = ARCH_STYLES.map((s) => drawPier(140, s));
    for (let i = 0; i < piers.length; i++) for (let j = i + 1; j < piers.length; j++) expect(same(piers[i], piers[j])).toBe(false);
  });

  it("树：每个树种至少 3 个造型变体，四季变化，底部贴地", () => {
    for (const c of CLIMATES) {
      const kinds = TREE_KINDS[c].length;
      for (let k = 0; k < kinds; k++) {
        const variants = [0, 1, 2].map((i) => drawTree(c, 1, k + i * kinds));
        for (let i = 0; i < 3; i++) for (let j = i + 1; j < 3; j++) expect(same(variants[i], variants[j])).toBe(false);
        for (const t of variants) {
          expect(t.w).toBeGreaterThan(8);
          expect(t.h).toBeGreaterThan(14);
          // 最下两行里有像素（树根与投影），图的底边就是地面
          let bottom = 0;
          for (let x = 0; x < t.w; x++) if (t.isOpaque(x, t.h - 1) || t.isOpaque(x, t.h - 2)) bottom++;
          expect(bottom).toBeGreaterThan(0);
        }
      }
    }
    // 温带阔叶树：春花、夏绿、秋黄、冬枯各不相同
    const year = [0, 1, 2, 3].map((s) => drawTree("temperate", s, 0));
    for (let i = 0; i < 4; i++) for (let j = i + 1; j < 4; j++) expect(same(year[i], year[j])).toBe(false);
    // 寒带松树冬季积雪
    expect(same(drawTree("cold", 1, 0), drawTree("cold", 3, 0))).toBe(false);
  });

  it("地面横向无缝：拼接处的突变不比图内任何相邻两列更大", () => {
    const diff = (p: Px, x0: number, x1: number) => {
      let n = 0;
      for (let y = 0; y < p.h; y++) if (p.get(x0, y) !== p.get(x1, y)) n++;
      return n;
    };
    for (const style of ARCH_STYLES) {
      for (const season of [1, 3]) {
        for (const w of [80, 97]) {
          const g = drawGround(w, 24, style, season);
          let inner = 0;
          for (let x = 0; x + 1 < w; x++) inner = Math.max(inner, diff(g, x, x + 1));
          expect(diff(g, w - 1, 0)).toBeLessThanOrEqual(inner);
        }
      }
    }
    // 冬季寒冷港口有积雪（整体更亮）
    const lum = (p: Px) => {
      let s = 0;
      for (const v of p.data) s += ((v >>> 24) & 0xff) + ((v >>> 16) & 0xff) + ((v >>> 8) & 0xff);
      return s / p.data.length;
    };
    expect(lum(drawGround(80, 24, "nordic", 3))).toBeGreaterThan(lum(drawGround(80, 24, "nordic", 1)));
  });

  it("海鸥：4 帧振翅，尺寸一致、各帧不同、取模循环", () => {
    const frames = Array.from({ length: GULL_FRAMES }, (_, f) => drawGull(f));
    expect(GULL_FRAMES).toBe(4);
    for (const f of frames) expect([f.w, f.h]).toEqual([frames[0].w, frames[0].h]);
    for (let i = 0; i < 4; i++) for (let j = i + 1; j < 4; j++) expect(same(frames[i], frames[j])).toBe(false);
    expect(same(drawGull(5), frames[1])).toBe(true);
  });
});

describe("按时间调色", () => {
  it("白天晴天不变，夜晚压暗，灯光色默认保留", () => {
    expect(gradeColor("#8a5a32")).toBe(gradeColor("#8a5a32", "day", "clear"));
    const night = gradeColor("#dcaa6e", "night");
    expect((night >>> 24) & 0xff).toBeLessThan(0xdc);
    const tree = drawTree("temperate", 1, 0);
    const dark = shadeForTime(tree, "night");
    expect(same(tree, dark)).toBe(false);
    expect(same(tree, shadeForTime(tree, "day", "clear"))).toBe(true);
  });
});
