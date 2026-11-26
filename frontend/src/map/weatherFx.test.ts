// 天气特效的纯逻辑：按天气选效果、玩家所在处的天况、海区的压暗与台阶渐淡、
// 雨线池、闪电的节奏（短、稀、可关）、数量与画布尺寸的上限，以及雨线、雪片、闪电的像素图。
import { describe, expect, it } from "vitest";
import { drawLightningBolt, drawRainStreak, drawSnowFlake } from "../art/map";
import type { Px } from "../art/px";
import type { FleetView, Overview, RegionWeatherView, SkyKind } from "../ipc/types";
import { overview } from "../test/fixtures";
import type { ChartGrid, RegionCenter } from "./weather";
import {
  CSS_AREA_PER_DROP,
  DROP_CAP,
  DropPool,
  EDGE_LEVELS,
  FALL_RAIN,
  FALL_SNOW,
  FALL_STORM,
  FLASH_GAP_MS,
  FLASH_MS,
  LightningClock,
  SCREEN_MAX_PIXELS,
  SKY_FX,
  dropBudget,
  dropShape,
  flashStrength,
  fxPixel,
  lightningAllowed,
  paintWeather,
  playerSky,
  regionField,
  screenCanvas,
  screenFx,
  skyFx,
  stepLevel,
  texelAt,
  vignetteAlpha,
  vignetteBand,
  weatherSignature,
  windSide,
} from "./weatherFx";

/** 固定种子的伪随机数（mulberry32）。 */
function seeded(seed = 1): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 90×30 格：左右两个海区（中心 22 与 67），中间一道南北向的陆地，左上角一个小岛。 */
function grid(): ChartGrid {
  const rows: string[] = [];
  for (let y = 0; y < 30; y++) {
    let s = "";
    for (let x = 0; x < 90; x++) {
      const land = (x >= 44 && x <= 45 && y >= 8) || (x >= 4 && x <= 7 && y >= 3 && y <= 5);
      s += land ? "#" : "~";
    }
    rows.push(s);
  }
  return { width: 90, height: 30, rows };
}
const CENTERS: RegionCenter[] = [
  { region: 0, x: 22, y: 15 },
  { region: 1, x: 67, y: 15 },
];
const wx = (region: number, sky: SkyKind, wind_dir = 2): RegionWeatherView => ({ region, sky, wind_dir, wind_strength: 5 });

const atSea = (patch: Partial<FleetView> = {}): FleetView => ({ ...overview.fleets[0], docked: null, x: 70, y: 15, ...patch });
const withFleet = (patch: Partial<Overview>): Overview => ({ ...overview, ...patch });

describe("按天气选效果", () => {
  it("暴风雨最暗、雨最密、会闪电；雨轻一些、不闪电；雾是浅色的一层、没有降水；雪有雪片；晴与多云不加东西", () => {
    const storm = skyFx("storm");
    const rain = skyFx("rain");
    const fog = skyFx("fog");
    const snow = skyFx("snow");
    expect(storm && rain && fog && snow).toBeTruthy();
    if (!storm || !rain || !fog || !snow) return;
    expect(storm.shade).toBeGreaterThan(rain.shade);
    expect(storm.density).toBe(1);
    expect(rain.density).toBeLessThan(storm.density);
    expect(storm.lightning).toBe(true);
    expect(rain.lightning || fog.lightning || snow.lightning).toBe(false);
    expect(storm.fall).toBe("rain");
    expect(storm.heavy).toBe(true);
    expect(rain.fall).toBe("rain");
    expect(rain.heavy).toBe(false);
    expect(fog.fall).toBeNull();
    expect(snow.fall).toBe("snow");
    // 雾是浅色的（明度高），暴风雨是夜航的深蓝
    const luma = (c: number) => 0.299 * ((c >>> 16) & 0xff) + 0.587 * ((c >>> 8) & 0xff) + 0.114 * (c & 0xff);
    expect(luma(fog.tint)).toBeGreaterThan(200);
    expect(luma(storm.tint)).toBeLessThan(40);
    expect(skyFx("clear")).toBeNull();
    expect(skyFx("cloudy")).toBeNull();
    expect(skyFx("hail")).toBeNull();
    expect(skyFx(undefined)).toBeNull();
  });

  it("全画面效果：开关关掉、晴、多云没有；暴风雨四边比中间暗；4× 及以上与减少动态效果时不闪电，减少动态效果时静止", () => {
    const on = { enabled: true, reduced: false, speed: 1 };
    expect(screenFx("storm", { ...on, enabled: false })).toBeNull();
    expect(screenFx("clear", on)).toBeNull();
    expect(screenFx("cloudy", on)).toBeNull();
    expect(screenFx(null, on)).toBeNull();
    const storm = screenFx("storm", on);
    expect(storm?.lightning).toBe(true);
    expect(storm?.still).toBe(false);
    expect(storm && storm.edge > storm.center).toBe(true);
    // 暂停时照常闪（画面静止，不会频闪）；2× 也闪；4× 及以上不闪
    expect(screenFx("storm", { ...on, speed: 0 })?.lightning).toBe(true);
    expect(screenFx("storm", { ...on, speed: 2 })?.lightning).toBe(true);
    for (const speed of [4, 8, 16, 32]) {
      expect(lightningAllowed(speed)).toBe(false);
      expect(screenFx("storm", { ...on, speed })?.lightning).toBe(false);
    }
    const still = screenFx("storm", { ...on, reduced: true });
    expect(still?.lightning).toBe(false);
    expect(still?.still).toBe(true);
    // 静止时压暗与雨线照旧
    expect(still?.fall).toBe("rain");
    expect(still?.center).toBe(storm?.center);
    // 雨比暴风雨轻、不闪电
    const rain = screenFx("rain", on);
    expect(rain?.lightning).toBe(false);
    expect(rain && storm && rain.edge < storm.edge && rain.density < storm.density).toBe(true);
    expect(screenFx("fog", on)?.fall).toBeNull();
    expect(screenFx("snow", on)?.fall).toBe("snow");
  });

  it("玩家所在处：旗舰队在海上时取它所在海区的天况；停泊、没有舰队、养成期为 null；旧后端按最近的海区中心查", () => {
    const local = (sky: SkyKind) => ({ region: 1, region_name: "东洋", sky, wind_dir: 2, wind_strength: 6, forecast: [] });
    expect(playerSky(withFleet({ fleets: [atSea()], local_weather: local("storm") }))).toBe("storm");
    expect(playerSky(withFleet({ fleets: [atSea()], local_weather: local("clear") }))).toBe("clear");
    // 停泊在港：港口画面不加
    expect(playerSky(withFleet({ local_weather: local("storm") }))).toBeNull();
    expect(playerSky(withFleet({ fleets: [], local_weather: local("storm") }))).toBeNull();
    expect(playerSky(withFleet({ mode: "upbringing", fleets: [atSea()], local_weather: local("storm") }))).toBeNull();
    expect(playerSky(null)).toBeNull();
    // 旧后端没有 local_weather：按舰队位置（手动航行用小数坐标）找最近的海区中心
    const winds = CENTERS.map((c) => ({ ...c, dir: 2, strength: 4 }));
    const weather = [wx(0, "rain"), wx(1, "storm")];
    expect(playerSky(withFleet({ fleets: [atSea({ x: 70, y: 15 })], winds, weather, local_weather: undefined }))).toBe("storm");
    expect(playerSky(withFleet({ fleets: [atSea({ x: 70, y: 15, pos: { x: 10.5, y: 12.25 } })], winds, weather, local_weather: undefined }))).toBe("rain");
    expect(playerSky(withFleet({ fleets: [atSea()], winds, weather: [], local_weather: undefined }))).toBeNull();
  });
});

describe("海区的压暗与台阶渐淡", () => {
  const g = grid();
  const field = regionField(g, CENTERS);

  it("纹素归给最近的海区中心，陆地标出来；经典世界一格一个纹素", () => {
    expect(field.step).toBe(1);
    expect([field.w, field.h]).toEqual([90, 30]);
    expect(field.owner[15 * 90 + 10]).toBe(0);
    expect(field.owner[15 * 90 + 80]).toBe(1);
    expect(field.sea[20 * 90 + 44]).toBe(0);
    expect(field.sea[4 * 90 + 5]).toBe(0);
    expect(field.sea[0]).toBe(1);
    // 大地图：2×2 格一个纹素
    const rows = Array.from({ length: 300 }, () => "~".repeat(800));
    const big = regionField({ width: 800, height: 300, rows }, [{ region: 0, x: 400, y: 150 }]);
    expect(big.step).toBe(2);
    expect([big.w, big.h]).toEqual([400, 150]);
  });

  it("海图四周的画框上不画天气（环绕地图只有上下两边的画框）", () => {
    const framed = regionField(g, CENTERS, false, 1, 2);
    const at = (f: typeof framed, x: number, y: number) => f.sea[y * 90 + x];
    for (const [x, y] of [
      [0, 15],
      [1, 15],
      [89, 15],
      [30, 0],
      [30, 29],
    ])
      expect(at(framed, x, y), `${x},${y}`).toBe(0);
    expect(at(framed, 2, 15)).toBe(1);
    expect(at(framed, 87, 27)).toBe(1);
    const p = paintWeather(framed, [wx(0, "storm"), wx(1, "storm")]);
    expect(p.rgba[(15 * 90 + 0) * 4 + 3]).toBe(0);
    expect(p.fall[15 * 90 + 1]).toBe(0);
    const wrapped = regionField(g, CENTERS, true, 1, 2);
    expect(at(wrapped, 0, 15)).toBe(1);
    expect(at(wrapped, 30, 1)).toBe(0);
  });

  it("暴风雨的海区比下雨的暗；只画在海上；晴天没有；雾是浅色的一层", () => {
    const p = paintWeather(field, [wx(0, "rain"), wx(1, "storm")]);
    const alpha = (x: number, y: number) => p.rgba[(y * 90 + x) * 4 + 3];
    expect(p.any).toBe(true);
    expect(p.storms).toBe(true);
    expect(alpha(75, 15)).toBeGreaterThan(alpha(15, 15));
    expect(alpha(75, 15)).toBe(Math.round(SKY_FX.storm.shade * 255));
    expect(alpha(15, 15)).toBe(Math.round(SKY_FX.rain.shade * 255));
    // 陆地不压暗
    expect(alpha(44, 20)).toBe(0);
    expect(alpha(5, 4)).toBe(0);
    // 暴风雨的范围（闪电照亮）只在暴风雨的海区
    expect(p.storm[15 * 90 + 75]).toBe(255);
    expect(p.storm[15 * 90 + 15]).toBe(0);
    // 降水：暴风雨的雨更密
    expect(p.fall[15 * 90 + 75]).toBe(FALL_STORM);
    expect(p.fall[15 * 90 + 15]).toBe(FALL_RAIN);
    expect(p.level[15 * 90 + 75]).toBeGreaterThan(p.level[15 * 90 + 15]);
    // 风向东：雨线朝东斜
    expect(p.wind[15 * 90 + 75]).toBe(1);

    const clear = paintWeather(field, [wx(0, "clear"), wx(1, "cloudy")]);
    expect(clear.any || clear.storms || clear.falls).toBe(false);
    expect(clear.rgba.every((v) => v === 0)).toBe(true);

    const fog = paintWeather(field, [wx(0, "fog"), wx(1, "snow")]);
    const i = (15 * 90 + 15) * 4;
    expect(fog.rgba[i]).toBeGreaterThan(200);
    expect(fog.fall[15 * 90 + 15]).toBe(0);
    expect(fog.fall[15 * 90 + 75]).toBe(FALL_SNOW);
    expect(fog.storms).toBe(false);
  });

  it("海区边缘分几级台阶渐淡（不用抖动）：沿一行走过去，暴风雨的浓度单调地一级一级降到 0", () => {
    const p = paintWeather(field, [wx(0, "clear"), wx(1, "storm")]);
    // 第 5 行（陆地之上，两个海区在第 44.5 列附近交界）从东往西
    const row = 5;
    const levels: number[] = [];
    for (let x = 89; x >= 30; x--) levels.push(p.storm[row * 90 + x]);
    for (let k = 1; k < levels.length; k++) expect(levels[k]).toBeLessThanOrEqual(levels[k - 1]);
    expect(levels[0]).toBe(255);
    expect(levels[levels.length - 1]).toBe(0);
    // 只有 EDGE_LEVELS + 1 种取值（0、1/4、1/2、3/4、1）
    const distinct = new Set(p.storm);
    const allowed = Array.from({ length: EDGE_LEVELS + 1 }, (_, k) => Math.round((k / EDGE_LEVELS) * 255));
    expect(distinct.size).toBeLessThanOrEqual(EDGE_LEVELS + 1);
    for (const v of distinct) expect(allowed).toContain(v);
    expect(stepLevel(0.6)).toBe(0.5);
    expect(stepLevel(1.0000001)).toBe(1);
    expect(stepLevel(-0.1)).toBe(0);
  });

  it("东西相连的地图：渐淡跨过东西两边不断开", () => {
    const rows = Array.from({ length: 10 }, () => "~".repeat(60));
    const centers: RegionCenter[] = [
      { region: 0, x: 2, y: 5 },
      { region: 1, x: 30, y: 5 },
    ];
    const f = regionField({ width: 60, height: 10, rows }, centers, true);
    // 第 58 列离 0 号中心（跨过东西边）比离 1 号近
    expect(f.owner[5 * 60 + 58]).toBe(0);
    const p = paintWeather(f, [wx(0, "storm"), wx(1, "clear")]);
    expect(p.storm[5 * 60 + 59]).toBe(255);
    expect(p.storm[5 * 60 + 0]).toBe(255);
    // 纹素下标按环绕取模
    expect(texelAt(p, -2, 20, 4, 240)).toBe(5 * 60 + 59);
    expect(texelAt(p, -2, 20, 4)).toBe(-1);
  });

  it("天气签名只看各海区的天况与风的东西向，与顺序无关", () => {
    expect(weatherSignature([wx(1, "storm", 2), wx(0, "rain", 6)])).toBe(weatherSignature([wx(0, "rain", 6), wx(1, "storm", 2)]));
    expect(weatherSignature([wx(0, "rain", 1)])).toBe(weatherSignature([wx(0, "rain", 3)]));
    expect(weatherSignature([wx(0, "rain", 1)])).not.toBe(weatherSignature([wx(0, "storm", 1)]));
    expect([0, 1, 2, 3, 4, 5, 6, 7].map(windSide)).toEqual([0, 1, 1, 1, 0, -1, -1, -1]);
  });
});

describe("雨线池", () => {
  const spawnAt = (kind: typeof FALL_RAIN | typeof FALL_STORM | typeof FALL_SNOW, wind = 1) => (rng: () => number) => ({ x: rng() * 100, y: rng() * 100, kind, wind });

  it("几帧内补到目标数，不会超过；目标变少时到寿的不再重生；没地方落时不出现", () => {
    const pool = new DropPool(seeded(3));
    for (let f = 0; f < 12; f++) pool.step(16, 200, spawnAt(FALL_STORM));
    expect(pool.drops.length).toBe(200);
    for (let f = 0; f < 100; f++) {
      pool.step(16, 200, spawnAt(FALL_STORM));
      expect(pool.drops.length).toBeLessThanOrEqual(200);
    }
    // 目标降到 50：一秒内（暴风雨的雨线寿命不到半秒）降下来
    for (let f = 0; f < 70; f++) pool.step(16, 50, spawnAt(FALL_STORM));
    expect(pool.drops.length).toBeLessThanOrEqual(50);
    const empty = new DropPool(seeded(4));
    for (let f = 0; f < 20; f++) empty.step(16, 100, () => null);
    expect(empty.drops).toHaveLength(0);
  });

  it("雨顺着雨线的斜度落（每落 run 像素侧移 1 像素，朝风的去向）；暴风雨的雨线更长更斜、落得更快；雪慢", () => {
    const pool = new DropPool(seeded(5));
    pool.step(0, 40, spawnAt(FALL_STORM, -1));
    for (const d of pool.drops) {
      expect(d.dir).toBe(-1);
      expect(d.vx / d.vy).toBeCloseTo(-1 / d.run);
    }
    const rain = dropShape(FALL_RAIN, true, 1, 0.99);
    const storm = dropShape(FALL_STORM, true, 1, 0.99);
    expect(storm.len).toBeGreaterThan(rain.len);
    expect(storm.run).toBeLessThan(rain.run);
    // 没有东西风也略向东斜
    expect(dropShape(FALL_RAIN, false, 0, 0).dir).toBe(1);
    const snow = new DropPool(seeded(6));
    snow.step(0, 20, spawnAt(FALL_SNOW, 0));
    for (const d of snow.drops) expect(Math.abs(d.vy)).toBeLessThan(60);
    // 一帧最多推进 100 毫秒（页面切回来不跳很远）：雪片寿命两秒以上，这一帧不会到寿重生
    const one = new DropPool(() => 0.5);
    one.step(0, 1, spawnAt(FALL_SNOW, 1));
    const d = one.drops[0];
    const y0 = d.y;
    one.step(10_000, 1, spawnAt(FALL_SNOW, 1));
    expect(one.drops[0]).toBe(d);
    expect(d.y - y0).toBeCloseTo(d.vy * 0.1);
  });
});

describe("闪电的节奏", () => {
  it("一次闪电不超过 180 毫秒（亮、暗一下、弱亮），两次之间至少隔 5 秒；关掉时一次也不闪", () => {
    expect(FLASH_MS).toBeLessThanOrEqual(180);
    expect(flashStrength(0)).toBe(1);
    expect(flashStrength(100)).toBe(0);
    expect(flashStrength(150)).toBeGreaterThan(0);
    expect(flashStrength(150)).toBeLessThan(1);
    expect(flashStrength(FLASH_MS)).toBe(0);
    expect(flashStrength(-1)).toBe(0);
    const clock = new LightningClock(seeded(7));
    const starts: number[] = [];
    let longest = 0;
    let run = 0;
    let t = 0;
    let seq = 0;
    for (; t < 120_000; t += 16) {
      const f = clock.step(16, true);
      if (clock.seq !== seq) {
        seq = clock.seq;
        starts.push(t);
      }
      run = clock.flashing ? run + 16 : 0;
      longest = Math.max(longest, run);
      expect(f).toBeLessThanOrEqual(1);
    }
    expect(starts.length).toBeGreaterThanOrEqual(120_000 / FLASH_GAP_MS[1] - 2);
    expect(starts.length).toBeLessThanOrEqual(120_000 / FLASH_GAP_MS[0]);
    for (let k = 1; k < starts.length; k++) expect(starts[k] - starts[k - 1]).toBeGreaterThanOrEqual(FLASH_GAP_MS[0]);
    expect(longest).toBeLessThanOrEqual(FLASH_MS + 16);

    const off = new LightningClock(seeded(8));
    for (let k = 0; k < 60_000 / 16; k++) expect(off.step(16, false)).toBe(0);
    expect(off.seq).toBe(0);
    // 截图与调试：能闪时立即闪一次；关掉时不理
    off.trigger();
    expect(off.step(0, false)).toBe(0);
    off.trigger();
    expect(off.step(0, true)).toBe(1);
    expect(off.seq).toBe(1);
  });
});

describe("数量与画布的上限", () => {
  it("雨线数随视口面积增减，有上限；手机更少；设备像素比高于 2 时少画；密度为 0 时不画", () => {
    expect(dropBudget(600, 400, 1, false)).toBe(Math.round((600 * 400) / CSS_AREA_PER_DROP));
    expect(dropBudget(1920, 1080, 1, false)).toBe(DROP_CAP.desktop);
    expect(dropBudget(3840, 2160, 1, false)).toBe(DROP_CAP.desktop);
    expect(dropBudget(1920, 1080, 1, true)).toBe(DROP_CAP.phone);
    expect(dropBudget(390, 844, 3, true)).toBeLessThan(DROP_CAP.phone);
    expect(dropBudget(390, 844, 3, true)).toBeLessThan(dropBudget(390, 844, 2, true));
    expect(dropBudget(1920, 1080, 1, false, 0.45)).toBeLessThan(dropBudget(1920, 1080, 1, false));
    expect(dropBudget(1920, 1080, 1, false, 0)).toBe(0);
    expect(dropBudget(0, 0, 1, false)).toBe(0);
    expect(dropBudget(800, 600, Number.NaN, false)).toBeGreaterThan(0);
  });

  it("全画面画布：像素块至少 2 个 CSS 像素、按设备像素取整；像素数不超过上限（手机更低）；盖得住整个视口", () => {
    const cases: [number, number, number, boolean][] = [
      [1600, 1000, 1, false],
      [1920, 1080, 1.25, false],
      [2560, 1440, 1, false],
      [2560, 1440, 2, false],
      [3840, 2160, 1, false],
      [3840, 2160, 1.5, false],
      [390, 844, 3, true],
      [844, 390, 2, true],
      [1024, 1366, 2, true],
    ];
    for (const [w, h, dpr, phone] of cases) {
      const c = screenCanvas(w, h, dpr, phone);
      const label = `${w}×${h}@${dpr}${phone ? " 手机" : ""}`;
      expect(Number.isInteger(c.px), label).toBe(true);
      expect(c.px / dpr, label).toBeGreaterThanOrEqual(2 - 1e-9);
      expect(c.w * c.h, label).toBeLessThanOrEqual(phone ? SCREEN_MAX_PIXELS.phone : SCREEN_MAX_PIXELS.desktop);
      expect(c.cssW, label).toBeGreaterThanOrEqual(w - 1e-6);
      expect(c.cssH, label).toBeGreaterThanOrEqual(h - 1e-6);
      // 不会盖出去一个像素块以上
      expect(c.cssW - w, label).toBeLessThan(c.px / dpr + 1e-6);
    }
    expect(screenCanvas(0, 500, 1, false)).toMatchObject({ w: 0, h: 0 });
    // 一般的桌面窗口：像素块就是 2 个 CSS 像素
    expect(screenCanvas(1600, 1000, 1, false).px).toBe(2);
    expect(screenCanvas(1600, 1000, 2, false).px).toBe(4);
  });

  it("海图上雨线的“像素”随镜头倍数取整，1–2 个 CSS 像素（与全画面的像素块一样大，放大时不成粗棍）", () => {
    expect([0.3, 1, 1.5, 2, 3, 4, 6].map(fxPixel)).toEqual([1, 1, 2, 2, 2, 2, 2]);
    expect(fxPixel(Number.NaN)).toBe(1);
  });

  it("暗角：中间不加深，四边分三级台阶（圆角矩形），越往外越暗", () => {
    const w = 200;
    const h = 120;
    expect(vignetteBand(100, 60, w, h)).toBe(0);
    expect(vignetteBand(0, 0, w, h)).toBe(3);
    expect(vignetteBand(0, 60, w, h)).toBe(3);
    let prev = 0;
    for (let x = 100; x >= 0; x--) {
      const b = vignetteBand(x, 60, w, h);
      expect(b).toBeGreaterThanOrEqual(prev);
      prev = b;
    }
    const bands = new Set<number>();
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) bands.add(vignetteBand(x, y, w, h));
    expect([...bands].sort()).toEqual([0, 1, 2, 3]);
    expect(vignetteAlpha(0, 0.1, 0.4)).toBeCloseTo(0.1);
    expect(vignetteAlpha(3, 0.1, 0.4)).toBeCloseTo(0.4);
    expect(vignetteAlpha(2, 0.1, 0.4)).toBeCloseTo(0.3);
  });
});

describe("雨线、雪片与闪电的像素图", () => {
  const opaque = (p: Px) => {
    let n = 0;
    for (let y = 0; y < p.h; y++) for (let x = 0; x < p.w; x++) if (p.isOpaque(x, y)) n++;
    return n;
  };

  it("雨线是整像素的阶梯斜线：每行一个像素，每落 run 行侧移 1 像素，头（底端）最亮", () => {
    const s = drawRainStreak(7, 2, 1);
    expect([s.w, s.h]).toEqual([4, 7]);
    expect(opaque(s)).toBe(7);
    for (let y = 0; y < 7; y++) {
      const xs = [...Array(s.w).keys()].filter((x) => s.isOpaque(x, y));
      expect(xs).toEqual([Math.floor(y / 2)]);
    }
    // 朝西：镜像
    const w = drawRainStreak(7, 2, -1);
    for (let y = 0; y < 7; y++) expect(w.isOpaque(s.w - 1 - Math.floor(y / 2), y)).toBe(true);
    // 头最不透明
    expect(s.get(3, 6) & 0xff).toBeGreaterThan(s.get(0, 0) & 0xff);
    // 远处的雨更淡；夜里更暗
    expect(drawRainStreak(4, 3, 1, "day", false).get(1, 3) & 0xff).toBeLessThan(drawRainStreak(4, 3, 1, "day", true).get(1, 3) & 0xff);
    const lum = (v: number) => ((v >>> 24) & 0xff) + ((v >>> 16) & 0xff) + ((v >>> 8) & 0xff);
    expect(lum(drawRainStreak(4, 3, 1, "night").get(1, 3))).toBeLessThan(lum(drawRainStreak(4, 3, 1, "day").get(1, 3)));
    // 半透明的像素都是整像素（没有抗锯齿的灰边）：不透明的像素数正好等于长度
    expect(opaque(drawRainStreak(9, 3, 1))).toBe(9);
  });

  it("雪片：远处一个像素、近处十字形", () => {
    expect([drawSnowFlake(false).w, drawSnowFlake(false).h]).toEqual([1, 1]);
    const big = drawSnowFlake(true);
    expect(opaque(big)).toBe(5);
    expect(big.isOpaque(0, 0)).toBe(false);
  });

  it("闪电：白芯淡蓝光的折线，从上沿一直劈到下沿；同一个 seed 同一道，不同的 seed 不同", () => {
    const a = drawLightningBolt(40, 1);
    const b = drawLightningBolt(40, 2);
    expect(a.h).toBe(40);
    expect(opaque(a)).toBeGreaterThan(40);
    // 每一行都有白芯（折线连着）
    for (let y = 0; y < a.h; y++) {
      const row = [...Array(a.w).keys()].some((x) => (a.get(x, y) & 0xff) === 0xff);
      expect(row, `第 ${y} 行`).toBe(true);
    }
    expect(drawLightningBolt(40, 1)).toBe(a);
    let same = true;
    for (let i = 0; i < a.data.length; i++) if (a.data[i] !== b.data[i]) same = false;
    expect(same).toBe(false);
    expect(drawLightningBolt(1000, 0).h).toBeLessThanOrEqual(160);
  });
});
