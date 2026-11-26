// 第四批景物（EXPANSION.md §9.3）：黎明与雨、雾、雪的天空、云、海面，雨丝 / 雪花 / 雾带叠加层与闪电。
// 约束：确定性、尺寸、帧循环、夜比昼暗、暴风雨比晴天暗、灯光色保留。
import { afterEach, describe, expect, it, vi } from "vitest";
import { P } from "./palette";
import { Px, rgba } from "./px";
import {
  applyFlash,
  drawBolt,
  drawCloud,
  drawFogLayer,
  drawRainLayer,
  drawSea,
  drawSky,
  drawSnowLayer,
  drawTree,
  FOG_PERIOD,
  fogOffset,
  gradeWeatherColor,
  lightningAt,
  RAIN_FRAMES,
  SEA_FRAMES,
  shadeCached,
  shadeForTime,
  SNOW_FRAMES,
  TIMES_OF_DAY,
  WEATHERS,
  type TimeOfDay,
  type Weather,
} from "./scenery";

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

/** 平均亮度（不透明像素的 0.299R + 0.587G + 0.114B 的平均）。 */
function meanLuma(p: Px): number {
  let s = 0;
  let n = 0;
  for (const v of p.data) {
    if (!(v & 0xff)) continue;
    s += 0.299 * ((v >>> 24) & 0xff) + 0.587 * ((v >>> 16) & 0xff) + 0.114 * ((v >>> 8) & 0xff);
    n++;
  }
  return n ? s / n : 0;
}

afterEach(() => vi.restoreAllMocks());

describe("第四批景物：新的时段与天况", () => {
  it("新组合确定、不用 Math.random，尺寸符合约定", () => {
    vi.spyOn(Math, "random").mockImplementation(() => {
      throw new Error("美术代码不得使用 Math.random");
    });
    const makers: (() => Px)[] = [
      () => drawSky(160, 90, { season: 0, time: "dawn", weather: "clear" }),
      () => drawSky(160, 90, { season: 3, time: "night", weather: "snow" }),
      () => drawSky(160, 90, { season: 1, time: "dusk", weather: "rain" }),
      () => drawSky(160, 90, { season: 2, time: "day", weather: "fog" }),
      () => drawCloud(3, { season: 1, time: "dawn", weather: "rain" }),
      () => drawSea(80, 40, 5, { time: "dawn", weather: "storm" }),
      () => drawRainLayer(120, 70, 3, { time: "night", heavy: true, windX: -0.6 }),
      () => drawSnowLayer(120, 70, 17, { windX: 0.4 }),
      () => drawFogLayer(90, 60, { time: "dawn" }),
      () => drawBolt(7, 30),
    ];
    for (const make of makers) expect(same(make(), make())).toBe(true);
    for (const [w, h] of [
      [97, 41],
      [1, 1],
      [333, 12],
    ]) {
      const r = drawRainLayer(w, h, 2, { heavy: true });
      const sn = drawSnowLayer(w, h, 2);
      const fg = drawFogLayer(w, h);
      expect([r.w, r.h]).toEqual([w, h]);
      expect([sn.w, sn.h]).toEqual([w, h]);
      expect([fg.w, fg.h]).toEqual([w + FOG_PERIOD, h]);
    }
    expect(TIMES_OF_DAY).toEqual(["dawn", "day", "dusk", "night"]);
    expect(WEATHERS).toEqual(["clear", "cloudy", "rain", "fog", "storm", "snow"]);
  });

  it("四个时段 × 六种天况的天空两两不同，都铺满整幅；云与海面也随天况变化", () => {
    const skies = TIMES_OF_DAY.flatMap((time) => WEATHERS.map((weather) => drawSky(120, 80, { season: 1, time, weather })));
    expect(skies).toHaveLength(24);
    for (let i = 0; i < skies.length; i++) {
      expect(opaqueCount(skies[i])).toBe(120 * 80);
      for (let j = i + 1; j < skies.length; j++) expect(same(skies[i], skies[j])).toBe(false);
    }
    for (const weather of WEATHERS.filter((w) => w !== "clear")) {
      expect(same(drawCloud(0), drawCloud(0, { season: 0, weather }))).toBe(false);
      expect(same(drawSea(64, 40, 2), drawSea(64, 40, 2, { weather }))).toBe(false);
    }
    expect(same(drawCloud(1, { season: 1 }), drawCloud(1, { season: 1, time: "dawn" }))).toBe(false);
    expect(same(drawSea(64, 40, 2), drawSea(64, 40, 2, { time: "dawn" }))).toBe(false);
  });

  it("夜比昼暗、暴风雨比晴天暗（平均亮度）；黎明介于夜与昼之间", () => {
    const lum = (time: TimeOfDay, weather: Weather) => meanLuma(drawSky(120, 80, { season: 1, time, weather }));
    expect(lum("night", "clear")).toBeLessThan(lum("day", "clear"));
    expect(lum("dawn", "clear")).toBeLessThan(lum("day", "clear"));
    expect(lum("dawn", "clear")).toBeGreaterThan(lum("night", "clear"));
    expect(lum("day", "storm")).toBeLessThan(lum("day", "clear"));
    expect(lum("day", "rain")).toBeLessThan(lum("day", "cloudy"));
    for (const weather of WEATHERS) expect(lum("night", weather)).toBeLessThan(lum("day", weather));
    // 素材调色：夜晚、暴风雨、雨、黎明都比白天晴暗
    const tree = drawTree("temperate", 1, 0);
    const base = meanLuma(tree);
    expect(meanLuma(shadeForTime(tree, "night"))).toBeLessThan(base * 0.6);
    expect(meanLuma(shadeForTime(tree, "day", "storm"))).toBeLessThan(base);
    expect(meanLuma(shadeForTime(tree, "day", "rain"))).toBeLessThan(base);
    expect(meanLuma(shadeForTime(tree, "dawn"))).toBeLessThan(base);
    // 海面：夜晚、暴风雨更暗
    expect(meanLuma(drawSea(96, 48, 0, { time: "night" }))).toBeLessThan(meanLuma(drawSea(96, 48, 0)));
    expect(meanLuma(drawSea(96, 48, 0, { weather: "storm" }))).toBeLessThan(meanLuma(drawSea(96, 48, 0)));
  });

  it("灯光色在夜里、黄昏、黎明与各种天况下都保留原色；缓存调色返回同一张图", () => {
    const p = new Px(4, 1).put(0, 0, P.lamp[1]).put(1, 0, P.lamp[2]).put(2, 0, P.wood[3]).put(3, 0, P.white);
    for (const time of TIMES_OF_DAY) {
      for (const weather of WEATHERS) {
        const g = shadeForTime(p, time, weather);
        expect(g.get(0, 0)).toBe(rgba(P.lamp[1]));
        expect(g.get(1, 0)).toBe(rgba(P.lamp[2]));
        if (time !== "day" || weather !== "clear") expect(g.get(2, 0)).not.toBe(rgba(P.wood[3]));
      }
    }
    const tree = drawTree("cold", 3, 1);
    expect(shadeCached(tree, "day", "clear")).toBe(tree);
    expect(shadeCached(tree, "night", "fog")).toBe(shadeCached(tree, "night", "fog"));
    expect(same(shadeCached(tree, "night", "fog"), shadeForTime(tree, "night", "fog"))).toBe(true);
    // 只按天况调色：晴天不变，雾天向雾色靠拢
    expect(gradeWeatherColor(P.sea[2], "clear")).toBe(rgba(P.sea[2]));
    expect(gradeWeatherColor(P.sea[2], "fog")).not.toBe(rgba(P.sea[2]));
  });

  it("海面在各天况下同样首尾相接地循环", () => {
    for (const weather of WEATHERS) {
      for (const time of ["dawn", "night"] as const) {
        expect(same(drawSea(48, 30, 1, { time, weather }), drawSea(48, 30, 1 + SEA_FRAMES, { time, weather }))).toBe(true);
      }
    }
  });
});

describe("第四批景物：雨、雪、雾的叠加层与闪电", () => {
  it("雨丝：相邻帧不同、以 RAIN_FRAMES 为周期；透明底、只占一小部分；暴风雨更密", () => {
    for (let f = 0; f < RAIN_FRAMES; f++) expect(same(drawRainLayer(80, 60, f), drawRainLayer(80, 60, f + 1))).toBe(false);
    expect(same(drawRainLayer(80, 60, 0, { windX: -1 }), drawRainLayer(80, 60, RAIN_FRAMES, { windX: -1 }))).toBe(true);
    expect(same(drawRainLayer(80, 60, -2), drawRainLayer(80, 60, RAIN_FRAMES - 2))).toBe(true);
    const light = opaqueCount(drawRainLayer(160, 90, 0));
    const heavy = opaqueCount(drawRainLayer(160, 90, 0, { heavy: true }));
    expect(light).toBeGreaterThan(160 * 90 * 0.01);
    expect(light).toBeLessThan(160 * 90 * 0.2);
    expect(heavy).toBeGreaterThan(light);
    // 风向改变雨丝的斜向
    expect(same(drawRainLayer(80, 60, 0, { windX: 1 }), drawRainLayer(80, 60, 0, { windX: -1 }))).toBe(false);
  });

  it("雪花：相邻帧不同、以 SNOW_FRAMES 为周期，稀疏", () => {
    for (let f = 0; f < 6; f++) expect(same(drawSnowLayer(80, 60, f), drawSnowLayer(80, 60, f + 1))).toBe(false);
    expect(same(drawSnowLayer(80, 60, 3), drawSnowLayer(80, 60, 3 + SNOW_FRAMES))).toBe(true);
    const n = opaqueCount(drawSnowLayer(160, 90, 0));
    expect(n).toBeGreaterThan(40);
    expect(n).toBeLessThan(160 * 90 * 0.15);
  });

  it("雾带：横向以 FOG_PERIOD 为周期无缝，平移量循环；半透明、不整片盖死", () => {
    const fog = drawFogLayer(60, 50);
    for (let y = 0; y < fog.h; y++) for (let x = 0; x < 60; x++) expect(fog.get(x, y)).toBe(fog.get(x + FOG_PERIOD, y));
    expect(fogOffset(0)).toBe(0);
    expect(fogOffset(3 * 3 * FOG_PERIOD)).toBe(0);
    expect(fogOffset(3, 1)).not.toBe(fogOffset(3, -1));
    let maxA = 0;
    for (const v of fog.data) maxA = Math.max(maxA, v & 0xff);
    expect(maxA).toBeGreaterThan(0);
    expect(maxA).toBeLessThan(0xd0);
  });

  it("闪电：间隔 ≥ 3 秒（10 fps 与 5 fps），强度柔和，确实会闪；提亮让画面变亮", () => {
    for (const fps of [10, 5]) {
      const starts: number[] = [];
      let max = 0;
      for (let f = 0; f < fps * 600; f++) {
        const k = lightningAt(f, fps);
        max = Math.max(max, k);
        if (k > 0 && lightningAt(f - 1, fps) === 0) starts.push(f);
      }
      expect(starts.length).toBeGreaterThan(20);
      expect(max).toBeLessThanOrEqual(0.2);
      for (let i = 1; i < starts.length; i++) expect(starts[i] - starts[i - 1]).toBeGreaterThanOrEqual(3 * fps);
    }
    expect(lightningAt(-5)).toBe(0);
    const p = drawSky(40, 30, { season: 1, weather: "storm" });
    const before = meanLuma(p);
    applyFlash(p, 0.16);
    expect(meanLuma(p)).toBeGreaterThan(before);
    expect(opaqueCount(drawBolt(3))).toBeGreaterThan(20);
  });
});
