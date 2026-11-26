// 海面：8 帧无缝循环。远处浅、近处深；横向浪带随帧生长、漂移、消散；反光碎点闪烁。
// 所有动画量都以 SEA_FRAMES 为周期（帧号取模），因此第 0 帧与第 8 帧完全相同。
// 天况：阴雨雾雪让海面发灰、反光变少；暴风雨浪更多更长、浪尖泛白。
import { P } from "../palette";
import { Px, rgba, type Rgba } from "../px";
import { gradeWeatherColor } from "./grade";
import type { TimeOfDay, Weather } from "./types";
import { bands, h2, mix, type Stop } from "./util";

/** 海浪循环的帧数。 */
export const SEA_FRAMES = 8;

/** 岸边白浪图的高度。 */
export const FOAM_H = 6;

interface SeaTones {
  stops: Stop[];
  crest: Rgba;
  crestFar: Rgba;
  trough: Rgba;
  glint: Rgba;
  glint2: Rgba;
  /** 反光带的中心（相对宽度），与天空中太阳 / 月亮的位置对应 */
  pathX: number;
  pathK: number;
}

function tones(time: TimeOfDay): SeaTones {
  if (time === "dawn") {
    // 黎明：远处映着粉色的天光，近处仍是偏冷的深蓝
    return {
      stops: [
        [0, mix(P.sea[4], P.blossom[2], 0.45)],
        [0.14, mix(P.sea[3], P.blossom[1], 0.3)],
        [0.45, mix(P.sea[2], P.dusk[0], 0.3)],
        [0.85, mix(P.sea[1], P.night[1], 0.3)],
      ],
      crest: mix(P.blossom[3], P.sea[4], 0.45),
      crestFar: mix(P.blossom[3], P.white, 0.3),
      trough: mix(P.sea[1], P.dusk[0], 0.4),
      glint: rgba(P.white),
      glint2: rgba(P.blossom[3]),
      pathX: 0.78,
      pathK: 0.9,
    };
  }
  if (time === "dusk") {
    return {
      stops: [
        [0, mix(P.sea[3], P.dusk[3], 0.5)],
        [0.14, mix(P.sea[3], P.dusk[2], 0.4)],
        [0.45, mix(P.sea[2], P.dusk[1], 0.35)],
        [0.85, mix(P.sea[1], P.dusk[0], 0.3)],
      ],
      crest: mix(P.dusk[3], P.dusk[4], 0.3),
      crestFar: mix(P.dusk[4], P.sea[3], 0.3),
      trough: mix(P.sea[1], P.dusk[0], 0.45),
      glint: rgba(P.lamp[2]),
      glint2: rgba(P.dusk[4]),
      pathX: 0.22,
      pathK: 1,
    };
  }
  if (time === "night") {
    return {
      stops: [
        [0, mix(P.sea[2], P.night[3], 0.55)],
        [0.14, mix(P.sea[1], P.night[2], 0.5)],
        [0.5, mix(P.sea[1], P.night[1], 0.55)],
        [0.9, mix(P.sea[0], P.night[0], 0.4)],
      ],
      crest: mix(P.sea[2], P.night[3], 0.5),
      crestFar: mix(P.sea[3], P.night[3], 0.5),
      trough: mix(P.sea[0], P.night[0], 0.5),
      glint: rgba(P.snow[2]),
      glint2: mix(P.snow[0], P.night[3], 0.4),
      pathX: 0.8,
      pathK: 0.7,
    };
  }
  return {
    stops: [
      [0, mix(P.sea[4], P.sky[3], 0.35)],
      [0.12, rgba(P.sea[3])],
      [0.42, mix(P.sea[3], P.sea[2], 0.55)],
      [0.8, rgba(P.sea[2])],
    ],
    crest: rgba(P.sea[4]),
    crestFar: mix(P.sea[4], P.foam, 0.4),
    trough: mix(P.sea[1], P.sea[2], 0.35),
    glint: rgba(P.white),
    glint2: rgba(P.foam),
    pathX: 0.16,
    pathK: 0.6,
  };
}

/** 一道浪花在生命周期（8 帧）中的长度比例：生长 → 保持 → 消散。 */
const LIFE = [0.35, 0.65, 0.9, 1, 1, 0.8, 0.5, 0] as const;

function wrapFrame(frame: number): number {
  return ((Math.floor(frame) % SEA_FRAMES) + SEA_FRAMES) % SEA_FRAMES;
}

/** 各天况的浪高（0 平静 – 1 暴风雨）与反光倍数。 */
const ROUGH: Readonly<Record<Weather, number>> = { clear: 0, cloudy: 0.15, snow: 0.2, fog: 0, rain: 0.4, storm: 1 };
const GLINT: Readonly<Record<Weather, number>> = { clear: 1, cloudy: 0.5, snow: 0.35, fog: 0.1, rain: 0.2, storm: 0 };

/** 按天况改色：色带与浪色都经过 gradeWeatherColor（晴天原样返回）。 */
function weathered(t: SeaTones, weather: Weather, time: TimeOfDay): SeaTones {
  if (weather === "clear") return t;
  const g = (c: Rgba) => gradeWeatherColor(c, weather, time);
  return {
    stops: t.stops.map(([pos, c]) => [pos, g(c)] as const),
    crest: g(t.crest),
    crestFar: g(t.crestFar),
    trough: g(t.trough),
    glint: g(t.glint),
    glint2: g(t.glint2),
    pathX: t.pathX,
    pathK: t.pathK * GLINT[weather],
  };
}

/** 一块海面（frame 取 0..SEA_FRAMES-1 循环，首尾相接无跳变）。weather 缺省为晴。 */
export function drawSea(w: number, h: number, frame: number, opts: { time?: TimeOfDay; weather?: Weather } = {}): Px {
  const f = wrapFrame(frame);
  const time = opts.time ?? "day";
  const weather = opts.weather ?? "clear";
  const t = weathered(tones(time), weather, time);
  const rough = ROUGH[weather];
  const glintK = GLINT[weather];
  const foamBase = time === "night" ? mix(P.foam, P.night[3], 0.5) : time === "dusk" ? mix(P.foam, P.dusk[3], 0.3) : rgba(P.foam);
  const foam = gradeWeatherColor(foamBase, weather, time);
  const p = new Px(w, h);
  const d = p.data;
  bands(d, w, 0, h, t.stops, 0.5);
  const put = (x: number, y: number, c: Rgba) => {
    if (x >= 0 && x < w && y >= 0 && y < h) d[y * w + x] = c;
  };
  // 横向浪带：行距与浪长随“近大远小”增加
  let y = 1;
  let k = 0;
  while (y < h) {
    const depth = y / Math.max(1, h);
    const cell = Math.round(10 + depth * 30);
    const lmax = Math.round((3 + depth * 11) * (1 + rough * 0.7));
    const rowOff = Math.floor(h2(0x5e1, k) * cell);
    const drift = (0.3 + depth * 0.6) * (1 + rough * 0.8);
    for (let i = -1; i * cell < w + cell; i++) {
      if (h2(0x5e2, k, i) > 0.72 + rough * 0.2) continue;
      const age = (f + Math.floor(h2(0x5e3, k, i) * SEA_FRAMES)) % SEA_FRAMES;
      const len = Math.round(lmax * LIFE[age]);
      if (len <= 0) continue;
      const x0 = i * cell + rowOff + Math.floor(h2(0x5e4, k, i) * cell * 0.5) + Math.floor(age * drift);
      const crest = depth < 0.2 ? t.crestFar : t.crest;
      for (let j = 0; j < len; j++) put(x0 + j, y, crest);
      // 浪峰下方的暗槽，让浪有体积
      if (len > 2) for (let j = 1; j <= len; j++) put(x0 + j, y + 1, t.trough);
      // 近处的大浪：峰上再加一道亮线
      if (depth > 0.55 && len > 5) for (let j = 2; j < len - 2; j++) put(x0 + j, y - 1, t.crestFar);
      // 暴风雨：浪尖泛起白沫，近处的浪更高（多一道暗槽）
      if (rough >= 0.9 && len > 3) {
        for (let j = 1; j < Math.min(len - 1, 2 + Math.floor(depth * 5)); j++) put(x0 + j, y - 1, foam);
        if (depth > 0.4) for (let j = 2; j <= len + 1; j++) put(x0 + j, y + 2, t.trough);
      }
    }
    y += 2 + Math.floor(depth * 5 * (1 - rough * 0.3)) + (h2(0x5e5, k) < 0.5 ? 1 : 0);
    k++;
  }
  // 反光碎点：随帧亮起又熄灭；太阳 / 月亮下方更密
  const CW = 9;
  const CH = 5;
  const pathC = t.pathX * w;
  for (let gy = 0; gy * CH < h; gy++) {
    for (let gx = 0; gx * CW < w; gx++) {
      const x = gx * CW + Math.floor(h2(0x5f1, gx, gy) * CW);
      const yy = gy * CH + Math.floor(h2(0x5f2, gx, gy) * CH);
      const near = Math.max(0, 1 - Math.abs(x - pathC) / (18 + (yy / h) * 30));
      const dens = 0.1 * glintK + near * t.pathK * 0.8;
      if (h2(0x5f3, gx, gy) > dens) continue;
      const age = (f + Math.floor(h2(0x5f4, gx, gy) * SEA_FRAMES)) % SEA_FRAMES;
      if (age === 0 || age === 2) put(x, yy, t.glint2);
      else if (age === 1) {
        put(x, yy, t.glint);
        put(x - 1, yy, t.glint2);
        put(x + 1, yy, t.glint2);
      }
    }
  }
  return p;
}

/**
 * 岸边与码头桩的白浪：宽 w、高 FOAM_H 的透明底长条，顶边即水线。
 * 浪沫厚度随帧起伏（同样以 SEA_FRAMES 为周期），下方散着气泡。
 */
export function drawShoreFoam(w: number, frame: number, opts: { time?: TimeOfDay } = {}): Px {
  const f = wrapFrame(frame);
  const time = opts.time ?? "day";
  const dimK = time === "night" ? 0.5 : time === "dusk" ? 0.25 : time === "dawn" ? 0.2 : 0;
  const dimTo = time === "dusk" ? P.dusk[2] : time === "dawn" ? P.blossom[1] : P.night[2];
  const white = mix(P.white, dimTo, dimK);
  const foam = mix(P.foam, dimTo, dimK);
  const edge = mix(P.sea[4], dimTo, dimK);
  const p = new Px(w, FOAM_H);
  const ph = (f / SEA_FRAMES) * Math.PI * 2;
  for (let x = 0; x < w; x++) {
    const a = 1.6 + 1.1 * Math.sin((x / 26) * Math.PI * 2 + ph) + 0.7 * Math.sin((x / 11) * Math.PI * 2 - ph * 2);
    const th = Math.max(1, Math.min(FOAM_H - 2, Math.round(a)));
    for (let y = 0; y < th; y++) p.put(x, y, y === 0 ? white : foam);
    if ((x + f) % 2 === 0) p.put(x, th, edge);
    // 气泡
    const bub = (f + Math.floor(h2(0xf0a, x) * SEA_FRAMES)) % SEA_FRAMES;
    if (h2(0xf0b, x) < 0.22 && bub < 4) p.put(x, Math.min(FOAM_H - 1, th + 1 + (bub >> 1)), foam);
  }
  return p;
}
