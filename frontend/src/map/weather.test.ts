// 航海图的昼夜与天气（EXPANSION.md §9.3）：夜色浓度与防闪烁规则、海区划分、天况标记的布局与数量、漂移，
// 以及天况标记与灯火的美术（尺寸、确定性、各天况不同）。
import { describe, expect, it } from "vitest";
import { WEATHER_FRAMES, WEATHER_VARIANTS, drawPortLight, drawWeatherMark, lightSwatch, weatherSwatch } from "../art/map";
import type { Px } from "../art/px";
import type { RegionWeatherView, SkyKind } from "../ipc/types";
import { scenePhase } from "../time/daylight";
import {
  DRIFT_TRAVEL,
  MARKS_PER_REGION,
  MARK_CENTER_GAP,
  MAX_WEATHER_MARKS,
  NIGHT_MAX_ALPHA,
  NIGHT_PLACE_TINT,
  REF_SAMPLES,
  approachNight,
  chartNight,
  driftOffset,
  isSea,
  markCount,
  marksSignature,
  mixColor,
  nightAlpha,
  placeTint,
  regionSamples,
  weatherMarks,
  type ChartGrid,
  type RegionCenter,
} from "./weather";

function same(a: Px, b: Px): boolean {
  if (a.w !== b.w || a.h !== b.h) return false;
  for (let i = 0; i < a.data.length; i++) if (a.data[i] !== b.data[i]) return false;
  return true;
}

/** 120×40 格的海图：左右两个海区（各 60×40，中心在矩形中点），中间一道南北向的陆地，右上角一个岛。 */
function grid(): ChartGrid {
  const rows: string[] = [];
  for (let y = 0; y < 40; y++) {
    let s = "";
    for (let x = 0; x < 120; x++) {
      const land = (x >= 58 && x <= 61 && y >= 10) || (x >= 95 && x <= 105 && y >= 5 && y <= 12);
      s += land ? "#" : y % 2 === 0 ? "~" : "-";
    }
    rows.push(s);
  }
  return { width: 120, height: 40, rows };
}
const CENTERS: RegionCenter[] = [
  { region: 0, x: 29, y: 19 },
  { region: 1, x: 89, y: 19 },
];
const wx = (region: number, sky: SkyKind, wind_dir = 2): RegionWeatherView => ({ region, sky, wind_dir, wind_strength: 4 });

describe("海图的夜色", () => {
  it("光照跟随时钟时按时刻：白天 0、夜晚 1，黎明与黄昏过渡；与 scenePhase 同一防闪烁规则", () => {
    expect(chartNight(720, 1)).toBe(0);
    expect(chartNight(1320, 1)).toBe(1);
    expect(chartNight(120, 0)).toBe(1); // 暂停时也跟随（画面静止，不闪烁）
    expect(chartNight(360, 2)).toBeCloseTo(0.5);
    expect(chartNight(1080, 1)).toBeCloseTo(0.5);
    // 4× 及以上一天短于 2 秒：固定为白天
    for (const speed of [4, 8, 16, 32]) {
      expect(chartNight(1320, speed)).toBe(0);
      expect(scenePhase(1320, speed)).toBe("day");
    }
    // 偏好“始终白天”
    expect(chartNight(1320, 1, "day")).toBe(0);
    expect(scenePhase(1320, 1, "day")).toBe("day");
    // 跟随时，画面时段为夜晚的时刻夜色最浓，为白天的时刻没有夜色
    for (let m = 0; m < 1440; m += 10) {
      if (scenePhase(m, 1) === "night") expect(chartNight(m, 1), `${m}`).toBe(1);
      if (scenePhase(m, 1) === "day") expect(chartNight(m, 1), `${m}`).toBe(0);
    }
  });

  it("夜色层的不透明度、地点色调与淡入淡出", () => {
    expect(nightAlpha(0)).toBe(0);
    expect(nightAlpha(1)).toBe(NIGHT_MAX_ALPHA);
    expect(nightAlpha(2)).toBe(NIGHT_MAX_ALPHA);
    expect(nightAlpha(Number.NaN)).toBe(0);
    expect(NIGHT_MAX_ALPHA).toBeGreaterThan(0.2);
    expect(NIGHT_MAX_ALPHA).toBeLessThan(0.8);
    expect(placeTint(0)).toBe(0xffffff);
    expect(placeTint(1)).toBe(NIGHT_PLACE_TINT);
    // 夜里偏蓝：蓝通道高于红通道
    expect(NIGHT_PLACE_TINT & 0xff).toBeGreaterThan((NIGHT_PLACE_TINT >>> 16) & 0xff);
    expect(mixColor(0x000000, 0xff8000, 0.5)).toBe(0x804000);
    // 1.5 秒从白天淡到黑夜，中途不越过目标
    expect(approachNight(0, 1, 750)).toBeCloseTo(0.5);
    expect(approachNight(0.9, 1, 750)).toBe(1);
    expect(approachNight(1, 0, 150)).toBeCloseTo(0.9);
    expect(approachNight(0.3, 0.3, 16)).toBe(0.3);
  });
});

describe("海区与天况标记", () => {
  it("海格按最近的海区中心划分，陆地不取样", () => {
    const g = grid();
    expect(isSea(g, 0, 0)).toBe(true);
    expect(isSea(g, 59, 20)).toBe(false);
    expect(isSea(g, -1, 0)).toBe(false);
    expect(isSea(g, 120, 0)).toBe(false);
    const s = regionSamples(g, CENTERS);
    expect([...s.keys()].sort()).toEqual([0, 1]);
    for (const [x, y] of s.get(0) ?? []) {
      expect(x).toBeLessThan(60);
      expect(isSea(g, x, y)).toBe(true);
    }
    for (const [x, y] of s.get(1) ?? []) {
      expect(x).toBeGreaterThanOrEqual(60);
      expect(isSea(g, x, y)).toBe(true);
    }
    expect(regionSamples(g, []).size).toBe(0);
  });

  it("晴天没有标记；雾与暴风雨比多云更多；标记在海上、在自己的海区里、离风向箭头有距离", () => {
    const g = grid();
    const s = regionSamples(g, CENTERS);
    expect(weatherMarks(s, [wx(0, "clear"), wx(1, "clear")], CENTERS)).toEqual([]);
    const n0 = s.get(0)?.length ?? 0;
    const n1 = s.get(1)?.length ?? 0;
    const count = (sky: SkyKind) => weatherMarks(s, [wx(0, sky)], CENTERS).length;
    expect(count("cloudy")).toBe(markCount("cloudy", n0));
    expect(count("cloudy")).toBeGreaterThanOrEqual(2);
    expect(count("fog")).toBeGreaterThan(count("cloudy"));
    expect(count("storm")).toBeGreaterThan(count("cloudy"));
    const marks = weatherMarks(s, [wx(0, "fog", 1), wx(1, "storm", 6)], CENTERS);
    expect(marks.filter((m) => m.region === 0)).toHaveLength(markCount("fog", n0));
    expect(marks.filter((m) => m.region === 1)).toHaveLength(markCount("storm", n1));
    for (const m of marks) {
      expect(isSea(g, m.x, m.y)).toBe(true);
      expect(m.region === 0 ? m.x < 60 : m.x >= 60).toBe(true);
      const c = CENTERS[m.region];
      expect(Math.hypot(m.x - c.x, m.y - c.y)).toBeGreaterThanOrEqual(MARK_CENTER_GAP);
      expect(m.variant).toBeGreaterThanOrEqual(0);
      expect(m.variant).toBeLessThan(WEATHER_VARIANTS);
      expect(m.phase).toBeGreaterThanOrEqual(0);
      expect(m.phase).toBeLessThan(1);
      expect(m.dir).toBe(m.region === 0 ? 1 : 6);
    }
    // 同一海区的标记彼此散开
    const fog = marks.filter((m) => m.region === 0);
    for (let i = 0; i < fog.length; i++) for (let j = i + 1; j < fog.length; j++) expect(Math.hypot(fog[i].x - fog[j].x, fog[i].y - fog[j].y)).toBeGreaterThanOrEqual(4);
  });

  it("结果确定、与输入顺序无关；天况变了标记仍留在原处；不认识的天况与没有中心的海区忽略", () => {
    const s = regionSamples(grid(), CENTERS);
    const a = weatherMarks(s, [wx(0, "rain"), wx(1, "cloudy")], CENTERS);
    const b = weatherMarks(s, [wx(1, "cloudy"), wx(0, "rain")], CENTERS);
    expect(b).toEqual(a);
    expect(marksSignature(a)).toBe(marksSignature(b));
    // 雨转雪：位置不变，只换天况
    const snow = weatherMarks(s, [wx(0, "snow"), wx(1, "cloudy")], CENTERS);
    expect(snow.map((m) => m.key)).toEqual(a.map((m) => m.key));
    expect(marksSignature(snow)).not.toBe(marksSignature(a));
    expect(weatherMarks(s, [{ region: 0, sky: "hail" as SkyKind, wind_dir: 0, wind_strength: 0 }], CENTERS)).toEqual([]);
    expect(weatherMarks(s, [wx(7, "storm")], CENTERS)).toEqual([]);
  });

  it("标记个数按海面大小缩放：标准海区取基数，大洋多摆（至多 2.5 倍），小海区少摆但至少一个", () => {
    expect(markCount("fog", REF_SAMPLES)).toBe(MARKS_PER_REGION.fog);
    expect(markCount("storm", REF_SAMPLES * 2)).toBe(MARKS_PER_REGION.storm * 2);
    expect(markCount("cloudy", REF_SAMPLES * 10)).toBe(Math.round(MARKS_PER_REGION.cloudy * 2.5));
    expect(markCount("rain", 10)).toBe(Math.max(1, Math.round(MARKS_PER_REGION.rain * 0.5)));
    expect(markCount("snow", 1)).toBeGreaterThanOrEqual(1);
    expect(markCount("clear", REF_SAMPLES)).toBe(0);
    expect(markCount("fog", 0)).toBe(0);
    expect(markCount("hail" as SkyKind, REF_SAMPLES)).toBe(0);
  });

  it("数量受控：超过上限时各海区轮流取", () => {
    // 20 个海区都在暴风雨
    const rows = Array.from({ length: 40 }, () => "~".repeat(400));
    const g: ChartGrid = { width: 400, height: 40, rows };
    const centers: RegionCenter[] = Array.from({ length: 20 }, (_, i) => ({ region: i, x: i * 20 + 10, y: 20 }));
    const s = regionSamples(g, centers);
    const all = weatherMarks(
      s,
      centers.map((c) => wx(c.region, "storm")),
      centers,
    );
    expect(all.length).toBeLessThanOrEqual(MAX_WEATHER_MARKS);
    const capped = weatherMarks(
      s,
      centers.map((c) => wx(c.region, "storm")),
      centers,
      30,
    );
    expect(capped).toHaveLength(30);
    // 每个海区先各取一个，再取第二个
    const per = new Map<number, number>();
    for (const m of capped) per.set(m.region, (per.get(m.region) ?? 0) + 1);
    expect(per.size).toBe(20);
    for (const n of per.values()) expect(n === 1 || n === 2).toBe(true);
  });

  it("漂移：沿风的去向来回，距离有限，两端淡入淡出，相位错开", () => {
    const travel = DRIFT_TRAVEL.cloudy;
    const east = [0, 1600, 3200, 4800].map((t) => driftOffset(t, 2, 0, travel));
    for (const d of east) {
      expect(d.dy).toBe(0);
      expect(Math.abs(d.dx)).toBeLessThanOrEqual(Math.ceil(travel / 2));
    }
    // 向东漂：前半程 dx 递增
    expect(east[1].dx).toBeGreaterThan(east[0].dx);
    expect(east[2].dx).toBeGreaterThan(east[1].dx);
    // 往东北漂：dx 与 −dy 同向
    const ne = driftOffset(5000, 1, 0, travel);
    expect(ne.dx).toBe(-ne.dy);
    // 两端淡、中间实
    expect(driftOffset(0, 2, 0, travel).alpha).toBe(0);
    expect(driftOffset(3200, 2, 0, travel).alpha).toBe(1);
    expect(driftOffset(6300, 2, 0, travel).alpha).toBeLessThan(0.1);
    // 相位不同，同一时刻位置不同
    expect(driftOffset(1000, 2, 0.5, travel).dx).not.toBe(driftOffset(1000, 2, 0, travel).dx);
    // 晴天不漂
    expect(driftOffset(1000, 2, 0.3, DRIFT_TRAVEL.clear).dx).toBe(0);
  });
});

describe("天况标记与灯火的美术", () => {
  const SKIES: SkyKind[] = ["cloudy", "rain", "fog", "storm", "snow"];

  it("每种天况的标记都有内容、尺寸适中，彼此不同；晴天没有标记；同一参数结果相同", () => {
    const marks = SKIES.map((s) => drawWeatherMark(s, 0, 0));
    for (const [i, m] of marks.entries()) {
      expect(m.w, SKIES[i]).toBeGreaterThanOrEqual(20);
      expect(m.w, SKIES[i]).toBeLessThanOrEqual(34);
      expect(m.h, SKIES[i]).toBeLessThanOrEqual(22);
      let opaque = 0;
      for (let y = 0; y < m.h; y++) for (let x = 0; x < m.w; x++) if (m.isOpaque(x, y)) opaque++;
      expect(opaque, SKIES[i]).toBeGreaterThan(60);
    }
    for (let i = 0; i < marks.length; i++) for (let j = i + 1; j < marks.length; j++) expect(same(marks[i], marks[j]), `${SKIES[i]} / ${SKIES[j]}`).toBe(false);
    const clear = drawWeatherMark("clear", 0, 0);
    expect([clear.w, clear.h]).toEqual([1, 1]);
    expect(clear.isOpaque(0, 0)).toBe(false);
    expect(same(drawWeatherMark("storm", 1, 1), drawWeatherMark("storm", 1, 1))).toBe(true);
  });

  it("三种外形各不相同；雨、雪、暴风雨有下落动画，多云与雾只有一帧；帧号与外形取模", () => {
    for (const sky of SKIES) {
      const v = Array.from({ length: WEATHER_VARIANTS }, (_, k) => drawWeatherMark(sky, k, 0));
      for (let i = 0; i < v.length; i++) for (let j = i + 1; j < v.length; j++) expect(same(v[i], v[j]), `${sky} ${i}/${j}`).toBe(false);
      const animated = sky === "rain" || sky === "snow" || sky === "storm";
      expect(same(drawWeatherMark(sky, 0, 0), drawWeatherMark(sky, 0, 1)), sky).toBe(!animated);
      expect(same(drawWeatherMark(sky, 0, WEATHER_FRAMES), drawWeatherMark(sky, 0, 0))).toBe(true);
      expect(same(drawWeatherMark(sky, WEATHER_VARIANTS + 1, 0), drawWeatherMark(sky, 1, 0))).toBe(true);
    }
  });

  it("暴风雨最暗，雾是半透明的（不遮住海岸）", () => {
    const avgLuma = (p: Px) => {
      let sum = 0;
      let n = 0;
      for (const v of p.data) {
        if (!(v & 0xff)) continue;
        sum += 0.299 * ((v >>> 24) & 0xff) + 0.587 * ((v >>> 16) & 0xff) + 0.114 * ((v >>> 8) & 0xff);
        n++;
      }
      return sum / Math.max(1, n);
    };
    const storm = avgLuma(drawWeatherMark("storm", 0, 0));
    for (const sky of ["cloudy", "rain", "snow"] as const) expect(storm).toBeLessThan(avgLuma(drawWeatherMark(sky, 0, 0)));
    const fog = drawWeatherMark("fog", 0, 0);
    for (const v of fog.data) if (v & 0xff) expect(v & 0xff).toBeLessThan(0xff);
  });

  it("灯火与图例小样", () => {
    const light = drawPortLight();
    expect(light.w).toBeLessThanOrEqual(12);
    expect(light.isOpaque(Math.floor(light.w / 2), Math.floor(light.h / 2))).toBe(true);
    // 中心不透明、边缘半透明
    expect(light.get(Math.floor(light.w / 2), Math.floor(light.h / 2)) & 0xff).toBe(0xff);
    expect(light.get(0, Math.floor(light.h / 2)) & 0xff).toBeLessThan(0x80);
    for (const sky of SKIES) expect(weatherSwatch(sky).h).toBeLessThanOrEqual(20);
    expect(lightSwatch().h).toBeLessThanOrEqual(20);
    expect(same(weatherSwatch("fog"), weatherSwatch("rain"))).toBe(false);
  });
});
