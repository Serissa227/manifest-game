// 街景的昼夜与天气（EXPANSION.md §9.3）：夜里有亮窗、夜比昼暗、暴风雨比晴天暗、默认外观不变、热点不随外观变化、
// 雨雪帧在动、风向改变画面、闪电可关、殖民地与殖民点同样生效、交叉淡化与外观切换、每帧足够快。
import { describe, expect, it } from "vitest";
import { COLONY_KEYS } from "../art/buildings";
import { P } from "../art/palette";
import { rgba, type Px } from "../art/px";
import { lightningAt, TIMES_OF_DAY } from "../art/scenery";
import { crossfade, keepWalker, litShare, LookFader, lookOf } from "./look";
import { composePortScene, facilitiesAt, layoutPortScene, SCENE_HEIGHT, type PortSceneParams } from "./port";

const PORT: PortSceneParams = {
  key: "chenggang",
  kind: "port",
  faction: "cuilan",
  flag: "#c0392b",
  facilities: facilitiesAt("port", true, true),
  season: 1,
  width: 640,
  flagship: { type: 1, sail: "square" },
  others: 2,
};

const COLONY: PortSceneParams = {
  key: "new-haven",
  kind: "colony",
  faction: "cuilan",
  style: "frontier",
  flag: "#c0392b",
  terrain: "forest",
  colony: { population: 600, buildings: COLONY_KEYS.map((key) => ({ key, level: 2 })) },
  facilities: facilitiesAt("colony", false, false),
  season: 1,
  width: 640,
  flagship: { type: 1, sail: "square" },
  others: 1,
};

const SITE: PortSceneParams = { key: "site-x", kind: "site", faction: "", terrain: "island", facilities: [], season: 1, width: 640, flagship: null, others: 1 };

function img(p: PortSceneParams, frame = 5): Px {
  return composePortScene(p, frame).px.clone();
}

function same(a: Px, b: Px): boolean {
  return a.w === b.w && a.h === b.h && a.data.every((v, i) => v === b.data[i]);
}

function meanLuma(p: Px): number {
  let s = 0;
  for (const v of p.data) s += 0.299 * ((v >>> 24) & 0xff) + 0.587 * ((v >>> 16) & 0xff) + 0.114 * ((v >>> 8) & 0xff);
  return s / p.data.length;
}

const LAMP = [rgba(P.lamp[1]), rgba(P.lamp[2])];

/** 灯光色像素（亮窗、街灯）在热点矩形（设施建筑）与整幅画面里的个数。 */
function lampPixels(p: Px, rects: readonly { x: number; y: number; w: number; h: number }[] = [{ x: 0, y: 0, w: p.w, h: p.h }]): number {
  let n = 0;
  for (const r of rects) {
    for (let y = r.y; y < r.y + r.h; y++) {
      for (let x = r.x; x < r.x + r.w; x++) if (LAMP.includes(p.get(x, y))) n++;
    }
  }
  return n;
}

describe("街景：昼夜", () => {
  it("不给时段与天况时与“白天、晴”完全相同（原有画面不变）", () => {
    expect(same(img(PORT), img({ ...PORT, time: "day", weather: "clear" }))).toBe(true);
    expect(same(img(COLONY), img({ ...COLONY, time: "day", weather: "clear" }))).toBe(true);
  });

  it("夜里窗户与街灯亮起：设施建筑上的亮窗远多于白天，夜比昼暗、黄昏与黎明介于其间", () => {
    const day = img({ ...PORT, time: "day", weather: "clear" });
    const night = img({ ...PORT, time: "night", weather: "clear" });
    const rects = layoutPortScene(PORT).hotspots;
    expect(lampPixels(night, rects)).toBeGreaterThan(lampPixels(day, rects) * 2 + 40);
    expect(lampPixels(night)).toBeGreaterThan(lampPixels(day) + 200);
    const lum = (time: (typeof TIMES_OF_DAY)[number]) => meanLuma(img({ ...PORT, time, weather: "clear" }));
    expect(lum("night")).toBeLessThan(lum("day") * 0.6);
    expect(lum("dusk")).toBeLessThan(lum("day"));
    expect(lum("dawn")).toBeLessThan(lum("day"));
    expect(lum("dusk")).toBeGreaterThan(lum("night"));
    expect(lum("dawn")).toBeGreaterThan(lum("night"));
  });

  it("热点与主角的船的位置不随时段、天况与风变化", () => {
    const base = layoutPortScene(PORT);
    for (const time of TIMES_OF_DAY) {
      for (const weather of ["clear", "storm", "fog"] as const) {
        const r = composePortScene({ ...PORT, time, weather, windX: -1 }, 3);
        expect(r.hotspots).toEqual(base.hotspots);
        expect(layoutPortScene({ ...PORT, time, weather }).berth).toEqual(base.berth);
      }
    }
  });

  it("殖民地与殖民点同样按时段调色，殖民地夜里亮灯", () => {
    const cDay = img({ ...COLONY, time: "day", weather: "clear" });
    const cNight = img({ ...COLONY, time: "night", weather: "clear" });
    expect(meanLuma(cNight)).toBeLessThan(meanLuma(cDay) * 0.6);
    const rects = layoutPortScene(COLONY).buildings;
    expect(lampPixels(cNight, rects)).toBeGreaterThan(lampPixels(cDay, rects));
    const sDay = img({ ...SITE, time: "day", weather: "clear" });
    expect(meanLuma(img({ ...SITE, time: "night", weather: "clear" }))).toBeLessThan(meanLuma(sDay) * 0.6);
    expect(same(img({ ...SITE, time: "dawn", weather: "fog" }), sDay)).toBe(false);
  });
});

describe("街景：天气", () => {
  it("暴风雨与雨天比晴天暗；雾、雪各有不同的画面", () => {
    const clear = meanLuma(img({ ...PORT, time: "day", weather: "clear" }));
    expect(meanLuma(img({ ...PORT, time: "day", weather: "storm" }))).toBeLessThan(clear * 0.85);
    expect(meanLuma(img({ ...PORT, time: "day", weather: "rain" }))).toBeLessThan(clear);
    const fog = img({ ...PORT, time: "day", weather: "fog" });
    const snow = img({ ...PORT, time: "day", weather: "snow" });
    expect(same(fog, snow)).toBe(false);
    expect(same(fog, img({ ...PORT, time: "day", weather: "clear" }))).toBe(false);
  });

  it("雨、雪、雾的画面逐帧在动", () => {
    for (const weather of ["rain", "storm", "snow", "fog"] as const) {
      const a = img({ ...PORT, time: "day", weather, lightning: false }, 10);
      const b = img({ ...PORT, time: "day", weather, lightning: false }, 12);
      expect(same(a, b)).toBe(false);
    }
  });

  it("风向改变画面（云、旗、炊烟、雨丝）；同样的参数画出同样的图", () => {
    const east = img({ ...PORT, time: "day", weather: "rain", windX: 1, windStrength: 6 }, 40);
    const west = img({ ...PORT, time: "day", weather: "rain", windX: -1, windStrength: 6 }, 40);
    expect(same(east, west)).toBe(false);
    expect(same(west, img({ ...PORT, time: "day", weather: "rain", windX: -1, windStrength: 6 }, 40))).toBe(true);
  });

  it("闪电是柔和的短暂提亮：闪的那一帧更亮；关掉闪电（4× 及以上）时不闪", () => {
    let f = 0;
    while (lightningAt(f) < 0.15) f++;
    const storm = { ...PORT, time: "dusk" as const, weather: "storm" as const };
    const flash = img(storm, f);
    const off = img({ ...storm, lightning: false }, f);
    expect(meanLuma(flash)).toBeGreaterThan(meanLuma(off));
    expect(meanLuma(flash) - meanLuma(off)).toBeLessThan(40);
    // 不闪的帧，开不开闪电都一样
    let g = f + 5;
    while (lightningAt(g) > 0) g++;
    expect(same(img(storm, g), img({ ...storm, lightning: false }, g))).toBe(true);
  });

  it("夜里与雨雪天街上的行人少，晴天白天人人都在", () => {
    const day = lookOf({});
    const night = lookOf({ time: "night" });
    const storm = lookOf({ weather: "storm" });
    const kept = (l: ReturnType<typeof lookOf>) => Array.from({ length: 200 }, (_, i) => keepWalker(i, l)).filter(Boolean).length;
    expect(kept(day)).toBe(200);
    expect(kept(night)).toBeLessThan(120);
    expect(kept(storm)).toBeLessThan(kept(night));
    expect(litShare("day", "clear")).toBe(0);
    expect(litShare("night", "clear")).toBeGreaterThan(litShare("dusk", "clear"));
  });
});

describe("外观切换的淡入淡出", () => {
  it("LookFader：外观变化后在指定帧数内从旧外观过渡到新外观，然后停止", () => {
    const f = new LookFader<string>(4);
    expect(f.step("day", "day", 0)).toEqual({ prev: null, t: 1 });
    expect(f.step("day", "day", 1).prev).toBeNull();
    const ts: number[] = [];
    for (let frame = 10; frame < 16; frame++) {
      const s = f.step("night", "night", frame);
      if (s.prev !== null) {
        expect(s.prev).toBe("day");
        ts.push(s.t);
      }
    }
    expect(ts).toHaveLength(4);
    for (let i = 1; i < ts.length; i++) expect(ts[i]).toBeGreaterThan(ts[i - 1]);
    expect(ts[ts.length - 1]).toBeLessThan(1);
    expect(f.step("night", "night", 20).prev).toBeNull();
  });

  it("crossfade 按比例混合两张图", () => {
    const a = img({ ...PORT, time: "day", weather: "clear" });
    const b = img({ ...PORT, time: "night", weather: "clear" });
    const mid = a.clone();
    crossfade(mid, b, 0.5);
    const la = meanLuma(a);
    const lb = meanLuma(b);
    const lm = meanLuma(mid);
    expect(lm).toBeLessThan(la);
    expect(lm).toBeGreaterThan(lb);
    const none = a.clone();
    crossfade(none, b, 0);
    expect(same(none, a)).toBe(true);
  });
});

describe("街景：性能", () => {
  it("四个时段各合成一次（含底图调色）都不慢；夜雨中连续合成每帧足够快（平均 < 40 ms）", () => {
    const p = { ...PORT, width: 960, key: "perf-port" };
    for (const time of TIMES_OF_DAY) {
      const t0 = performance.now();
      composePortScene({ ...p, time, weather: "clear" }, 0);
      expect(performance.now() - t0).toBeLessThan(1500);
    }
    const rain = { ...p, time: "night" as const, weather: "rain" as const };
    composePortScene(rain, 0);
    const t0 = performance.now();
    for (let f = 1; f <= 10; f++) composePortScene(rain, f);
    expect((performance.now() - t0) / 10).toBeLessThan(40);
    expect(composePortScene(rain, 11).px.h).toBe(SCENE_HEIGHT);
  });
});
