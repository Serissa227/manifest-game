// 景物预览（npx vite-node scripts/art-preview.ts scenery）：
// 各建筑风格 × 四季的整幅示范合成（天空 + 远景 + 海 + 码头 + 树 + 地面），四个时段 × 六种天况的示范合成，
// 云、远景、海面帧条（含暴风雨）、雨丝 / 雪花 / 雾带叠加层的帧条与闪电、白浪、码头、树、地面（两块拼接检查接缝）、海鸥。
import { ARCH_STYLES, type ArchStyle } from "./buildings";
import { Px, sheet, type Preview } from "./px";
import {
  applyFlash,
  drawBolt,
  drawFogLayer,
  drawRainLayer,
  drawSnowLayer,
  fogOffset,
  FOAM_H,
  RAIN_FRAMES,
  SEA_FRAMES,
  SNOW_FRAMES,
  TIMES_OF_DAY,
  WEATHERS,
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
  shadeForTime,
  skyStops,
  type Climate,
  type SkyOpts,
  type TimeOfDay,
  type Weather,
} from "./scenery";

const W = 320;
const H = 180;

/** 一幅示范港景：左侧街面与树，右侧码头伸入海中。 */
function composeScene(style: ArchStyle, season: number, sky: Omit<SkyOpts, "season"> = {}, frame = 0, w = W, h = H, withFx = true): Px {
  const opts: SkyOpts = { season, ...sky };
  const climate = climateOf(style);
  const p = drawSky(w, h, opts);
  const clouds: [number, number, number][] = [
    [0, 96, 14],
    [3, 180, 10],
    [1, 230, 34],
    [2, 8, 58],
    [5, 150, 50],
  ];
  for (const [v, x, y] of clouds) p.blit(drawCloud(v, opts), x, y);
  const horizon = Math.round(h * 0.64);
  const land = drawDistantLand(w, 64, climate, season, sky);
  p.blit(land, 0, horizon - land.h);
  p.blit(drawSea(w, h - horizon, frame, { time: sky.time, weather: sky.weather }), 0, horizon);
  // 码头
  const pierX = Math.round(w * 0.52);
  const pierY = h - 44;
  const g8 = (px: Px) => shadeForTime(px, sky.time, sky.weather);
  const pier = g8(drawPier(w - pierX, style));
  p.blit(pier, pierX, pierY);
  const foam = drawShoreFoam(w, frame, { time: sky.time });
  const water = pierY + pier.h - 6;
  p.blit(foam.crop(pierX, 0, w - pierX, FOAM_H), pierX, water);
  // 街面（岸）
  const gw = pierX + 8;
  const groundY = h - 30;
  const gh = h - groundY;
  const g = g8(drawGround(gw, gh, style, season));
  p.blit(g, 0, groundY);
  // 岸边石墙
  p.blit(foam.crop(0, 0, 16, FOAM_H), gw, h - 8);
  // 树
  const kinds = TREE_KINDS[climate].length;
  const trees = [0, kinds, kinds * 2, 1].map((v, i) => [v, 18 + i * 44] as const);
  for (const [v, x] of trees) {
    const t = g8(drawTree(climate, season, v));
    p.blit(t, x - Math.floor(t.w / 2), groundY + 10 - t.h);
  }
  // 海鸥（夜里与暴风雨时不飞）
  if (sky.time !== "night" && sky.weather !== "storm") {
    p.blit(g8(drawGull(frame)), Math.round(w * 0.6), 34);
    p.blit(g8(drawGull(frame + 2)), Math.round(w * 0.68), 44);
  }
  // 天气叠加层
  const fx = { time: sky.time, windX: 0.6, heavy: sky.weather === "storm" };
  if (!withFx) return p;
  if (sky.weather === "rain" || sky.weather === "storm") p.blit(drawRainLayer(w, h, frame, fx), 0, 0);
  if (sky.weather === "snow") p.blit(drawSnowLayer(w, h, frame, fx), 0, 0);
  if (sky.weather === "fog") p.blit(drawFogLayer(w, h, fx), -fogOffset(frame), 0);
  return p;
}

export default function preview(): Preview[] {
  const out: Preview[] = [];
  const seasons = [0, 1, 2, 3];
  // 1) 各建筑风格 × 四季
  for (const style of ARCH_STYLES) {
    out.push({ name: `scene-${style}`, px: sheet(seasons.map((s) => composeScene(style, s)), { cols: 2, gap: 2, bg: "#000000" }), scale: 2 });
  }
  // 2) 天空：四个时段 × 六种天况（夏季），外加四季各时段的天空
  const times: TimeOfDay[] = [...TIMES_OF_DAY];
  const weathers: Weather[] = [...WEATHERS];
  const skies: Px[] = [];
  for (const t of times) for (const wth of weathers) skies.push(composeScene("eastern", 1, { time: t, weather: wth }, 0, 200, 112));
  out.push({ name: "sky-time-weather", px: sheet(skies, { cols: weathers.length, gap: 2, bg: "#000000" }), scale: 2 });
  // 寒冷港口冬季的雪景与雾景（黎明、夜晚）
  const winter: Px[] = [];
  for (const t of ["dawn", "night"] as const) for (const wth of ["snow", "fog"] as const) winter.push(composeScene("nordic", 3, { time: t, weather: wth }, 3, 240, 135));
  out.push({ name: "winter-snow-fog", px: sheet(winter, { cols: 2, gap: 2, bg: "#000000" }), scale: 2 });
  const sky4: Px[] = [];
  for (const t of times) for (const s of seasons) sky4.push(drawSky(160, 90, { season: s, time: t }));
  out.push({ name: "sky-seasons", px: sheet(sky4, { cols: 4, gap: 2, bg: "#000000" }), scale: 2 });
  // 3) 云：各类型在不同光照下
  const cloudRows: Px[] = [];
  const lights: SkyOpts[] = [
    { season: 1 },
    { season: 3 },
    { season: 1, time: "dawn" },
    { season: 1, time: "dusk" },
    { season: 1, time: "night" },
    { season: 1, weather: "cloudy" },
    { season: 1, weather: "rain" },
    { season: 1, weather: "fog" },
    { season: 1, weather: "snow" },
    { season: 1, weather: "storm" },
  ];
  for (const o of lights) {
    const bg = skyStops(o)[1][1];
    const cs = sheet(
      Array.from({ length: 8 }, (_, v) => drawCloud(v, o)),
      { cols: 8, gap: 4 },
    );
    cloudRows.push(new Px(cs.w, cs.h).fill(bg).blit(cs, 0, 0));
  }
  out.push({ name: "clouds", px: sheet(cloudRows, { cols: 1, gap: 2 }), scale: 3 });
  // 4) 远景：四种气候 × 四季
  const climates: Climate[] = ["temperate", "cold", "arid", "tropical"];
  const lands: Px[] = [];
  for (const c of climates) {
    for (const s of seasons) {
      const bg = drawSky(200, 70, { season: s });
      lands.push(bg.blit(drawDistantLand(200, 64, c, s), 0, 6));
    }
  }
  out.push({ name: "land", px: sheet(lands, { cols: 4, gap: 2, bg: "#000000" }), scale: 2 });
  // 5) 海面帧条：8 帧 × 四个时段，外加雨与暴风雨
  const seaFrames: Px[] = [];
  for (const t of times) for (let f = 0; f < SEA_FRAMES; f++) seaFrames.push(drawSea(96, 48, f, { time: t }));
  for (const wth of ["rain", "storm"] as const) for (let f = 0; f < SEA_FRAMES; f++) seaFrames.push(drawSea(96, 48, f, { weather: wth }));
  out.push({ name: "sea-frames", px: sheet(seaFrames, { cols: SEA_FRAMES, gap: 2, bg: "#000000" }), scale: 3 });
  // 5b) 天气叠加层：雨（晴天底色上）、暴风雨、雪（前 8 帧）、雾带平移，以及闪电提亮与闪电
  const fxBg = (t: TimeOfDay, wth: Weather) => composeScene("lowland", 1, { time: t, weather: wth }, 0, 96, 64, false);
  const fxFrames: Px[] = [];
  for (let f = 0; f < RAIN_FRAMES; f++) fxFrames.push(fxBg("day", "rain").blit(drawRainLayer(96, 64, f, { windX: 0.6 }), 0, 0));
  for (let f = 0; f < RAIN_FRAMES; f++) fxFrames.push(fxBg("night", "storm").blit(drawRainLayer(96, 64, f, { time: "night", heavy: true, windX: -0.8 }), 0, 0));
  for (let f = 0; f < 8; f++) fxFrames.push(fxBg("day", "snow").blit(drawSnowLayer(96, 64, f * (SNOW_FRAMES / 8), { windX: 0.3 }), 0, 0));
  const fog = drawFogLayer(96, 64, { time: "day" });
  for (let f = 0; f < 8; f++) fxFrames.push(fxBg("day", "fog").blit(fog, -fogOffset(f * 30), 0));
  for (let f = 0; f < 4; f++) {
    const bg = fxBg("dusk", "storm");
    if (f === 1) bg.blit(drawBolt(f + 3, 30), 60, 2);
    applyFlash(bg, [0, 0.16, 0.07, 0][f]);
    fxFrames.push(bg);
  }
  out.push({ name: "weather-fx", px: sheet(fxFrames, { cols: 8, gap: 2, bg: "#000000" }), scale: 3 });
  const foams: Px[] = [];
  for (let f = 0; f < SEA_FRAMES; f++) foams.push(new Px(96, 12).fill("#2f86b8").blit(drawShoreFoam(96, f), 0, 3));
  out.push({ name: "foam-frames", px: sheet(foams, { cols: 1, gap: 1, bg: "#000000" }), scale: 3 });
  // 6) 码头
  out.push({
    name: "piers",
    px: sheet(
      ARCH_STYLES.map((s) => new Px(160, 34).fill("#2f86b8").blit(drawPier(160, s), 0, 4)),
      { cols: 1, gap: 2, bg: "#000000" },
    ),
    scale: 3,
  });
  // 7) 树：每种气候 × 四季 × 前若干变体
  for (const c of climates) {
    const n = TREE_KINDS[c].length * (c === "temperate" ? 4 : 3);
    const items: Px[] = [];
    for (const s of seasons) for (let v = 0; v < n; v++) items.push(drawTree(c, s, v));
    out.push({ name: `trees-${c}`, px: sheet(items, { cols: n, gap: 3, bg: "#8fb0c8" }), scale: 3 });
  }
  // 8) 地面：各建筑风格 × 四季，每块 96 宽，左右各拼一块检查接缝
  const grounds: Px[] = [];
  for (const style of ARCH_STYLES) {
    for (const s of seasons) {
      const g = drawGround(96, 28, style, s);
      grounds.push(new Px(192, 28).blit(g, 0, 0).blit(g, 96, 0));
    }
  }
  out.push({ name: "ground", px: sheet(grounds, { cols: 4, gap: 3, bg: "#000000" }), scale: 3 });
  // 9) 海鸥
  out.push({ name: "gull", px: sheet([0, 1, 2, 3].map((f) => drawGull(f)), { cols: 4, gap: 3, bg: "#6f95d6" }), scale: 8 });
  return out;
}
