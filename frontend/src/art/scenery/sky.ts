// 天空与云：黎明 / 白天 / 黄昏 / 夜晚 × 季节 × 天气（晴、多云、雨、雾、暴风雨、雪）。
// 天空是整幅背景（分段色带 + 抖动过渡），含太阳、月亮与星星；云单独成图，由街景自行摆放。
// 雨丝、雪花、雾带等会动的叠加层在 weatherfx.ts。
import { P } from "../palette";
import { Px, rgba, type Rgba } from "../px";
import { rng } from "../rng";
import type { SkyOpts, TimeOfDay, Weather } from "./types";
import { bands, ditherHit, h2, mix, seasonOf, type Stop } from "./util";

function norm(opts: SkyOpts): { season: 0 | 1 | 2 | 3; time: TimeOfDay; weather: Weather } {
  return { season: seasonOf(opts.season), time: opts.time ?? "day", weather: opts.weather ?? "clear" };
}

/** 天空色带的停靠点（自上而下）。港口街景也可以用它取“天空色”给远景、雾气着色。 */
export function skyStops(opts: SkyOpts): Stop[] {
  const { season, time, weather } = norm(opts);
  const c = (v: string) => rgba(v);
  let stops: [number, Rgba][];
  if (weather === "rain" || weather === "fog" || weather === "snow") return overcastStops(weather, time, season);
  if (weather === "storm") {
    stops = [
      [0, mix(P.stone[0], P.night[1], 0.45)],
      [0.24, mix(P.stone[0], P.stone[1], 0.55)],
      [0.48, c(P.stone[1])],
      [0.7, mix(P.stone[1], P.stone[2], 0.5)],
    ];
    if (time === "dusk") stops = stops.map(([p, v]) => [p, mix(v, P.dusk[1], 0.28)]);
    if (time === "night") stops = stops.map(([p, v]) => [p, mix(v, P.night[0], 0.62)]);
    if (time === "dawn") stops = stops.map(([p, v], i) => [p, mix(v, i < 2 ? P.dusk[0] : P.blossom[1], 0.22)]);
    return stops;
  }
  if (time === "dawn") {
    // 黎明：高处仍是夜色未褪的靛蓝，往下是淡紫、粉与近地平线的浅粉白（清冷偏粉）
    stops = [
      [0, mix(P.night[2], P.sky[0], 0.5)],
      [0.2, mix(P.sky[1], P.dusk[0], 0.38)],
      [0.4, mix(P.sky[2], P.blossom[2], 0.42)],
      [0.58, mix(P.blossom[2], P.dusk[4], 0.3)],
      [0.74, mix(P.blossom[3], P.sky[4], 0.45)],
    ];
  } else if (time === "day") {
    stops = [
      [0, c(P.sky[1])],
      [0.24, c(P.sky[2])],
      [0.46, c(P.sky[3])],
      [0.64, c(P.sky[4])],
    ];
  } else if (time === "dusk") {
    stops = [
      [0, c(P.dusk[0])],
      [0.18, c(P.dusk[1])],
      [0.34, c(P.dusk[2])],
      [0.48, c(P.dusk[3])],
      [0.6, c(P.dusk[4])],
    ];
  } else {
    stops = [
      [0, c(P.night[0])],
      [0.3, c(P.night[1])],
      [0.52, c(P.night[2])],
      [0.7, c(P.night[3])],
    ];
  }
  // 季节：春夏明亮、秋偏暖、冬偏冷灰
  const seasonal = (v: Rgba, i: number): Rgba => {
    if (time === "dawn") {
      if (season === 3) return mix(v, P.stone[3], 0.22);
      if (season === 2) return mix(v, P.gold[3], 0.05 + i * 0.02);
      if (season === 1) return i === 0 ? mix(v, P.sky[0], 0.2) : v;
      return mix(v, P.teal[4], 0.04);
    }
    if (season === 0) return time === "day" ? mix(v, P.teal[4], 0.06 + i * 0.02) : v;
    if (season === 1) return time === "day" && i === 0 ? mix(v, P.sky[0], 0.25) : v;
    if (season === 2) return time === "night" ? mix(v, P.dusk[0], 0.12) : mix(v, P.gold[3], 0.1 + i * 0.03);
    if (time === "night") return mix(v, P.slate[1], 0.25);
    return mix(v, P.stone[3], time === "day" ? 0.4 : 0.22);
  };
  stops = stops.map(([p, v], i) => [p, seasonal(v, i)]);
  if (weather === "cloudy") {
    stops = stops.map(([p, v]) => {
      if (time === "day") return [p, mix(mix(v, P.stone[3], 0.5), P.stone[1], 0.12)];
      if (time === "dusk" || time === "dawn") return [p, mix(v, P.stone[1], 0.42)];
      return [p, mix(v, P.stone[0], 0.3)];
    });
  }
  return stops;
}

/** 阴天类（雨、雾、雪）的天空：低饱和的灰色调，按时段染色。 */
function overcastStops(weather: "rain" | "fog" | "snow", time: TimeOfDay, season: number): Stop[] {
  let stops: [number, Rgba][];
  if (weather === "rain") {
    // 雨：铅灰偏蓝，低处稍亮
    stops = [
      [0, mix(P.stone[0], P.slate[1], 0.5)],
      [0.3, mix(P.stone[1], P.slate[1], 0.45)],
      [0.56, mix(P.stone[1], P.slate[2], 0.4)],
      [0.78, mix(P.stone[2], P.stone[3], 0.3)],
    ];
  } else if (weather === "fog") {
    // 雾：几乎一片灰白，只在高处略深
    stops = [
      [0, mix(P.stone[2], P.sky[3], 0.35)],
      [0.36, mix(P.stone[3], P.sky[4], 0.3)],
      [0.66, mix(P.stone[3], P.snow[2], 0.55)],
    ];
  } else {
    // 雪：偏冷的浅灰，低处近白
    stops = [
      [0, mix(P.stone[2], P.snow[0], 0.5)],
      [0.3, mix(P.stone[3], P.snow[0], 0.4)],
      [0.58, mix(P.snow[1], P.stone[3], 0.35)],
      [0.8, mix(P.snow[2], P.stone[4], 0.4)],
    ];
  }
  if (season === 3) stops = stops.map(([p, v]) => [p, mix(v, P.slate[3], 0.08)]);
  if (time === "dusk") stops = stops.map(([p, v], i) => [p, mix(v, i < 2 ? P.dusk[0] : P.dusk[2], 0.3)]);
  else if (time === "dawn") stops = stops.map(([p, v], i) => [p, mix(v, i < 2 ? P.dusk[0] : P.blossom[2], 0.24)]);
  else if (time === "night") stops = stops.map(([p, v], i) => [p, mix(v, i < 2 ? P.night[0] : P.night[1], weather === "fog" ? 0.66 : 0.72)]);
  return stops;
}

/** 在已有底色上画一圈抖动光晕：越往外越稀疏。 */
function glow(p: Px, cx: number, cy: number, r0: number, r1: number, color: Rgba, strength: number): void {
  const d = p.data;
  for (let y = Math.floor(cy - r1); y <= Math.ceil(cy + r1); y++) {
    for (let x = Math.floor(cx - r1); x <= Math.ceil(cx + r1); x++) {
      if (!p.inBounds(x, y)) continue;
      const dist = Math.hypot(x + 0.5 - cx, y + 0.5 - cy);
      if (dist <= r0 || dist > r1) continue;
      const frac = 1 - (dist - r0) / (r1 - r0);
      if (ditherHit(x, y, frac * 0.9)) {
        const i = y * p.w + x;
        d[i] = mix(d[i], color, strength);
      }
    }
  }
}

/** 白天的太阳：亮核 + 左上高光 + 抖动光晕。 */
function sun(p: Px, cx: number, cy: number, r: number, dim: boolean): void {
  if (dim) {
    // 多云：隔着云层的淡白日轮
    for (let y = Math.floor(cy - r); y <= cy + r; y++) {
      for (let x = Math.floor(cx - r); x <= cx + r; x++) {
        if (!p.inBounds(x, y)) continue;
        const dd = Math.hypot(x + 0.5 - cx, y + 0.5 - cy);
        if (dd <= r) p.data[y * p.w + x] = mix(p.data[y * p.w + x], P.white, dd > r - 1.2 ? 0.35 : 0.5);
      }
    }
    return;
  }
  glow(p, cx, cy, r + 1, r + 9, rgba(P.lamp[2]), 0.28);
  glow(p, cx, cy, r, r + 4, rgba(P.white), 0.3);
  for (let y = Math.floor(cy - r - 1); y <= cy + r + 1; y++) {
    for (let x = Math.floor(cx - r - 1); x <= cx + r + 1; x++) {
      const dx = x + 0.5 - cx;
      const dy = y + 0.5 - cy;
      const dd = Math.hypot(dx, dy);
      if (dd > r) continue;
      let c: string = P.lamp[2];
      if (dd > r - 1.3 && dx + dy > 0) c = P.lamp[1];
      else if (Math.hypot(dx + r * 0.3, dy + r * 0.3) < r * 0.55) c = P.white;
      p.put(x, y, c);
    }
  }
}

/** 黄昏的落日：大而低，下半截被横向云带切成几条。 */
function duskSun(p: Px, cx: number, cy: number, r: number, dim: boolean): void {
  glow(p, cx, cy, r, r + 16, rgba(P.dusk[4]), dim ? 0.18 : 0.32);
  glow(p, cx, cy, r, r + 6, rgba(P.lamp[2]), dim ? 0.12 : 0.25);
  const slits = [0.3, 0.55, 0.75, 0.9].map((k) => Math.round(cy + r * k));
  const gap = [1, 1, 2, 2];
  for (let y = Math.floor(cy - r); y <= cy + r; y++) {
    const si = slits.findIndex((s, i) => y >= s && y < s + gap[i]);
    if (si >= 0) continue;
    for (let x = Math.floor(cx - r); x <= cx + r; x++) {
      if (!p.inBounds(x, y)) continue;
      const dx = x + 0.5 - cx;
      const dy = y + 0.5 - cy;
      if (Math.hypot(dx, dy) > r) continue;
      const t = (dy + r) / (2 * r);
      let c: Rgba = t < 0.35 ? rgba(P.lamp[2]) : t < 0.7 ? rgba(P.lamp[1]) : mix(P.lamp[1], P.dusk[3], 0.6);
      if (t >= 0.3 && t < 0.4 && ditherHit(x, y, 0.5)) c = rgba(P.lamp[1]);
      if (t >= 0.65 && t < 0.75 && ditherHit(x, y, 0.5)) c = mix(P.lamp[1], P.dusk[3], 0.6);
      if (dim) c = mix(c, p.data[y * p.w + x], 0.45);
      p.data[y * p.w + x] = c;
    }
  }
}

/** 黎明的朝阳：刚露出海平线的淡金日轮，外圈一层粉色的柔光。 */
function dawnSun(p: Px, cx: number, cy: number, r: number, dim: boolean): void {
  glow(p, cx, cy, r, r + 18, rgba(P.blossom[3]), dim ? 0.16 : 0.3);
  glow(p, cx, cy, r, r + 7, rgba(P.lamp[2]), dim ? 0.12 : 0.26);
  for (let y = Math.floor(cy - r); y <= cy + r; y++) {
    for (let x = Math.floor(cx - r); x <= cx + r; x++) {
      if (!p.inBounds(x, y)) continue;
      const dx = x + 0.5 - cx;
      const dy = y + 0.5 - cy;
      const dd = Math.hypot(dx, dy);
      if (dd > r) continue;
      const t = (dy + r) / (2 * r);
      let c: Rgba = t < 0.45 ? rgba(P.white) : t < 0.8 ? rgba(P.lamp[2]) : mix(P.lamp[2], P.blossom[2], 0.5);
      if (t >= 0.4 && t < 0.5 && ditherHit(x, y, 0.5)) c = rgba(P.lamp[2]);
      if (dd > r - 1.1) c = mix(c, P.blossom[3], 0.5);
      if (dim) c = mix(c, p.data[y * p.w + x], 0.5);
      p.data[y * p.w + x] = c;
    }
  }
}

/** 月牙：左亮右暗，带两三个环形山，外圈淡淡的光晕。 */
function moon(p: Px, cx: number, cy: number, r: number, dim: boolean): void {
  if (!dim) glow(p, cx, cy, r, r + 7, rgba(P.night[3]), 0.5);
  const ox = cx + r * 0.62;
  const oy = cy - r * 0.35;
  for (let y = Math.floor(cy - r); y <= cy + r; y++) {
    for (let x = Math.floor(cx - r); x <= cx + r; x++) {
      if (!p.inBounds(x, y)) continue;
      const dx = x + 0.5 - cx;
      const dy = y + 0.5 - cy;
      if (Math.hypot(dx, dy) > r) continue;
      if (Math.hypot(x + 0.5 - ox, y + 0.5 - oy) < r * 0.92) continue;
      let c: Rgba = rgba(P.snow[2]);
      if (Math.hypot(dx, dy) > r - 1.2 && dx < 0) c = rgba(P.snow[3]);
      if (Math.hypot(x + 0.5 - (cx - r * 0.45), y + 0.5 - (cy + r * 0.25)) < r * 0.2) c = rgba(P.snow[1]);
      if (Math.hypot(x + 0.5 - (cx - r * 0.2), y + 0.5 - (cy + r * 0.62)) < r * 0.14) c = rgba(P.snow[1]);
      if (dim) c = mix(c, p.data[y * p.w + x], 0.5);
      p.data[y * p.w + x] = c;
    }
  }
}

/** 星空：按格子哈希撒星（坐标固定，窗口变宽时原有星星不动）；maxK 限定星星只出现在上方的比例内（黎明只剩高处几颗）。 */
function stars(p: Px, density: number, maxK = 0.78): void {
  const CW = 11;
  const CH = 9;
  const maxY = Math.floor(p.h * maxK);
  for (let gy = 0; gy * CH < maxY; gy++) {
    for (let gx = 0; gx * CW < p.w; gx++) {
      if (h2(0x51a2, gx, gy) > density) continue;
      const x = gx * CW + Math.floor(h2(0x51a3, gx, gy) * CW);
      const y = gy * CH + Math.floor(h2(0x51a4, gx, gy) * CH);
      if (!p.inBounds(x, y) || y >= maxY) continue;
      // 越接近地平线越稀
      if (y > p.h * 0.5 && h2(0x51a6, gx, gy) < (y / p.h - 0.5) * 2.5) continue;
      const kind = h2(0x51a5, gx, gy);
      const bg = p.get(x, y);
      if (kind < 0.07) {
        p.put(x, y, P.white);
        for (const [dx, dy] of [
          [1, 0],
          [-1, 0],
          [0, 1],
          [0, -1],
        ] as const) {
          if (p.inBounds(x + dx, y + dy)) p.put(x + dx, y + dy, mix(p.get(x + dx, y + dy), P.snow[1], 0.55));
        }
      } else if (kind < 0.35) {
        p.put(x, y, P.snow[2]);
      } else {
        p.put(x, y, mix(bg, P.snow[1], 0.45));
      }
    }
  }
}

/** 暴风雨的斜向雨丝（半透明，按格子哈希分布）。 */
function rain(p: Px, time: TimeOfDay): void {
  const CW = 6;
  const CH = 13;
  const k = time === "night" ? 0.22 : 0.32;
  for (let gy = -1; gy * CH < p.h; gy++) {
    for (let gx = 0; gx * CW < p.w + CH; gx++) {
      if (h2(0x7a11, gx, gy) > 0.6) continue;
      const x0 = gx * CW + Math.floor(h2(0x7a12, gx, gy) * CW);
      const y0 = gy * CH + Math.floor(h2(0x7a13, gx, gy) * CH);
      const len = 3 + Math.floor(h2(0x7a14, gx, gy) * 4);
      for (let i = 0; i < len; i++) {
        const x = x0 - Math.floor(i / 2);
        const y = y0 + i;
        if (!p.inBounds(x, y)) continue;
        const j = y * p.w + x;
        p.data[j] = mix(p.data[j], P.snow[1], k);
      }
    }
  }
}

/** 整幅天空背景（含太阳或月亮，不含云）。雨、雪天阴云密布，看不见日月；雾天只剩一轮淡淡的光盘。 */
export function drawSky(w: number, h: number, opts: SkyOpts): Px {
  const { time, weather } = norm(opts);
  const p = new Px(w, h);
  bands(p.data, w, 0, h, skyStops(opts));
  const dim = weather === "cloudy" || weather === "fog";
  if (weather === "rain" || weather === "snow") {
    // 阴云：高处几条更深的云影横带，让天空不至于平涂
    const shade = time === "night" ? rgba(P.night[0]) : mix(P.stone[0], P.slate[1], 0.5);
    for (let y = 0; y < Math.floor(h * 0.4); y++) {
      const k = 0.5 * (1 - y / (h * 0.4));
      for (let x = 0; x < w; x++) {
        if (h2(0x3c01, x >> 4, y >> 2) < 0.55 && ditherHit(x, y, k)) p.data[y * w + x] = mix(p.data[y * w + x], shade, 0.35);
      }
    }
  } else if (weather !== "storm") {
    if (time === "dawn") {
      if (weather !== "fog") stars(p, dim ? 0.05 : 0.2, 0.3);
      const r = Math.max(6, Math.min(12, Math.round(h * 0.04)));
      dawnSun(p, Math.round(w * 0.78) + 0.5, Math.round(h * 0.44) + 0.5, r, dim);
    } else if (time === "day") {
      const r = Math.max(5, Math.min(9, Math.round(h * 0.03)));
      sun(p, Math.round(w * 0.16) + 0.5, Math.round(h * 0.2) + 0.5, r, dim);
    } else if (time === "dusk") {
      const r = Math.max(8, Math.min(16, Math.round(h * 0.055)));
      duskSun(p, Math.round(w * 0.22) + 0.5, Math.round(h * 0.46) + 0.5, r, dim);
    } else {
      if (weather !== "fog") stars(p, dim ? 0.08 : 0.42);
      const r = Math.max(5, Math.min(8, Math.round(h * 0.026)));
      moon(p, Math.round(w * 0.8) + 0.5, Math.round(h * 0.18) + 0.5, r, dim);
    }
  } else {
    rain(p, time);
  }
  return p;
}

// ---------------------------------------------------------------- 云

interface Tones {
  hi: Rgba;
  mid: Rgba;
  lo: Rgba;
  deep: Rgba;
}

/** 云的四阶色：亮面、主体、暗面、平底。随时间、天气、季节变化。 */
function cloudTones(opts: SkyOpts): Tones {
  const { season, time, weather } = norm(opts);
  const c = (v: string) => rgba(v);
  let t: Tones;
  if (weather === "storm") {
    t = { hi: c(P.stone[2]), mid: mix(P.stone[1], P.stone[2], 0.4), lo: c(P.stone[1]), deep: mix(P.stone[1], P.stone[0], 0.6) };
  } else if (weather === "rain") {
    t = { hi: mix(P.stone[3], P.stone[2], 0.35), mid: mix(P.stone[2], P.slate[3], 0.3), lo: mix(P.stone[1], P.stone[2], 0.5), deep: mix(P.stone[1], P.slate[1], 0.4) };
  } else if (weather === "snow") {
    t = { hi: c(P.snow[2]), mid: mix(P.snow[1], P.stone[3], 0.5), lo: mix(P.snow[0], P.stone[2], 0.5), deep: mix(P.stone[2], P.snow[0], 0.3) };
  } else if (weather === "fog") {
    t = { hi: c(P.stone[4]), mid: mix(P.stone[3], P.stone[4], 0.55), lo: c(P.stone[3]), deep: mix(P.stone[2], P.stone[3], 0.55) };
  } else if (weather === "cloudy") {
    t = { hi: c(P.stone[4]), mid: c(P.stone[3]), lo: mix(P.stone[2], P.stone[3], 0.35), deep: c(P.stone[2]) };
  } else {
    t = { hi: c(P.white), mid: c(P.sky[4]), lo: c(P.snow[1]), deep: mix(P.snow[0], P.sky[2], 0.3) };
  }
  const map = (f: (v: Rgba) => Rgba): Tones => ({ hi: f(t.hi), mid: f(t.mid), lo: f(t.lo), deep: f(t.deep) });
  if (time === "dusk") {
    t =
      weather === "clear"
        ? { hi: c(P.dusk[4]), mid: mix(P.dusk[3], P.dusk[4], 0.3), lo: mix(P.dusk[3], P.dusk[2], 0.55), deep: mix(P.dusk[2], P.dusk[1], 0.4) }
        : map((v) => mix(v, P.dusk[1], 0.45));
  } else if (time === "night") {
    t =
      weather === "clear"
        ? { hi: mix(P.night[3], P.snow[0], 0.4), mid: c(P.night[3]), lo: mix(P.night[2], P.night[3], 0.4), deep: c(P.night[2]) }
        : map((v) => mix(v, P.night[0], 0.66));
  } else if (time === "dawn") {
    // 黎明的云：朝阳一侧镶粉边，背光处偏冷紫
    t =
      weather === "clear"
        ? { hi: c(P.blossom[3]), mid: mix(P.blossom[2], P.dusk[4], 0.35), lo: mix(P.blossom[1], P.sky[2], 0.55), deep: mix(P.dusk[0], P.sky[1], 0.5) }
        : map((v) => mix(v, P.blossom[1], 0.28));
  } else if (weather === "clear") {
    if (season === 2) t = map((v) => mix(v, P.gold[4], 0.12));
    if (season === 3) t = map((v) => mix(v, P.stone[3], 0.28));
  }
  return t;
}

type Puff = readonly [number, number, number, number];

/**
 * 由若干团“棉絮”组成的云：把每团看作半个椭球，取各团高度的最大值得到一张起伏的“高度图”，
 * 再按法线与左上方光线的夹角分成四阶（亮、主体、暗、底），团与团相接处自然出现褶皱。
 * 下方的团略微靠前（高度加成），最后压平底部。
 */
function puffCloud(W: number, H: number, puffs: readonly Puff[], t: Tones): Px {
  const p = new Px(W, H);
  const base = H - 1;
  const top = Math.min(...puffs.map((q) => q[1]));
  const ps = puffs.map(([cx0, cy, rx, ry]) => [Math.max(rx + 0.5, Math.min(W - rx - 1.5, cx0)), cy, rx, ry, (cy - top) * 0.45] as const);
  const height = (x: number, y: number): number => {
    let best = -1;
    for (const [cx, cy, rx, ry, z] of ps) {
      const nx = (x - cx) / (rx + 0.5);
      const ny = (y - cy) / (ry + 0.5);
      const d = 1 - nx * nx - ny * ny;
      if (d <= 0) continue;
      const hgt = Math.sqrt(d) * Math.min(rx, ry) * 1.1 + z;
      if (hgt > best) best = hgt;
    }
    return best;
  };
  const hm = new Float32Array((W + 2) * (H + 2)).fill(-1);
  for (let y = -1; y <= H; y++) for (let x = -1; x <= W; x++) hm[(y + 1) * (W + 2) + x + 1] = height(x + 0.5, y + 0.5);
  const at = (x: number, y: number) => {
    const v = hm[(y + 1) * (W + 2) + x + 1];
    return v < 0 ? 0 : v;
  };
  // 光线：左上偏前
  const L = [-0.55, -0.62, 0.56];
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (hm[(y + 1) * (W + 2) + x + 1] < 0 || y > base) continue;
      const nx = at(x - 1, y) - at(x + 1, y);
      const ny = at(x, y - 1) - at(x, y + 1);
      const nz = 1.6;
      const len = Math.hypot(nx, ny, nz);
      const l = (nx * L[0] + ny * L[1] + nz * L[2]) / len;
      // 带一点抖动的四阶量化
      const q = l + (ditherHit(x, y, 0.5) ? 0.04 : -0.04);
      let c = q > 0.78 ? t.hi : q > 0.5 ? t.mid : q > 0.22 ? t.lo : t.deep;
      // 平底：最下一行是暗面色，其上一行与主体之间用抖动过渡
      if (y === base) c = c === t.deep ? t.deep : t.lo;
      else if (y === base - 1 && c !== t.deep && ditherHit(x, y, 0.5)) c = t.lo;
      p.data[y * W + x] = c;
    }
  }
  // 顶边：朝上的边缘补一像素亮边（左侧三分之二），轮廓更清楚
  for (let x = 0; x < W * 0.66; x++) {
    for (let y = 1; y < H - 3; y++) {
      if (p.isOpaque(x, y) && !p.isOpaque(x, y - 1) && p.data[y * W + x] !== t.deep) p.data[y * W + x] = t.hi;
    }
  }
  return p;
}

/** 细长的卷云：几条两端收尖的横线。 */
function wispCloud(W: number, seed: number, t: Tones): Px {
  const r = rng(`wisp:${seed}`);
  const n = r.int(3, 4);
  const p = new Px(W, n * 2 + 1);
  for (let k = 0; k < n; k++) {
    const len = r.int(Math.floor(W * 0.45), W - 4);
    const x0 = r.int(0, W - len);
    const y = k * 2;
    for (let i = 0; i < len; i++) {
      const edge = i < 3 || i >= len - 3;
      p.put(x0 + i, y, edge ? t.mid : t.hi);
      if (!edge && i > 4 && i < len - 5) p.put(x0 + i + 1, y + 1, t.lo);
    }
  }
  return p;
}

/**
 * 一朵云；variant 相同则图相同。variant % 8 决定类型：
 * 0 大积云、1 中积云、2 长条层云、3 卷云、4 小云团、5 成串的小云、6 高耸的积云塔、7 低矮的云堤。
 */
export function drawCloud(variant: number, opts: SkyOpts = { season: 0 }): Px {
  const v = Math.abs(Math.floor(variant)) || 0;
  const type = v % 8;
  const r = rng(`cloud:${v}`);
  const t = cloudTones(opts);
  const puffs: Puff[] = [];
  const row = (n: number, W: number, cy: number, rx: number, ry: number, jitter = 1) => {
    for (let i = 0; i < n; i++) {
      const cx = rx + 1 + ((W - 2 * rx - 3) * i) / Math.max(1, n - 1);
      puffs.push([cx + r.range(-jitter, jitter), cy + r.range(-jitter, jitter), rx * r.range(0.85, 1.15), ry * r.range(0.85, 1.1)]);
    }
  };
  switch (type) {
    case 0: {
      const W = r.int(52, 64);
      const H = r.int(22, 27);
      const b = H - 1;
      row(5, W, b - H * 0.14, W * 0.1, H * 0.2);
      puffs.push([W * 0.26, b - H * 0.34, W * 0.13, H * 0.28]);
      puffs.push([W * r.range(0.44, 0.5), b - H * 0.56, W * 0.19, H * 0.4]);
      puffs.push([W * 0.7, b - H * 0.38, W * 0.15, H * 0.32]);
      puffs.push([W * r.range(0.58, 0.64), b - H * 0.68, W * 0.1, H * 0.2]);
      return puffCloud(W, H, puffs, t);
    }
    case 1: {
      const W = r.int(34, 42);
      const H = r.int(15, 18);
      const b = H - 1;
      row(4, W, b - H * 0.16, W * 0.12, H * 0.22);
      puffs.push([W * r.range(0.36, 0.46), b - H * 0.52, W * 0.2, H * 0.4]);
      puffs.push([W * 0.68, b - H * 0.36, W * 0.14, H * 0.28]);
      return puffCloud(W, H, puffs, t);
    }
    case 2: {
      const W = r.int(64, 84);
      const H = r.int(8, 10);
      const b = H - 1;
      row(Math.round(W / 11), W, b - 2.5, 6, 3, 1.2);
      for (let i = 0; i < 3; i++) puffs.push([W * r.range(0.2, 0.8), b - 4.5, r.range(6, 10), 3.2]);
      return puffCloud(W, H, puffs, t);
    }
    case 3:
      return wispCloud(r.int(40, 60), v, t);
    case 4: {
      const W = r.int(16, 21);
      const H = r.int(8, 9);
      const b = H - 1;
      puffs.push([W * 0.3, b - 2.5, 4, 3]);
      puffs.push([W * 0.52, b - 4, 5, 4]);
      puffs.push([W * 0.74, b - 2.5, 3.5, 2.8]);
      return puffCloud(W, H, puffs, t);
    }
    case 5: {
      const W = r.int(26, 34);
      const H = r.int(9, 11);
      const b = H - 1;
      row(4, W, b - 2.8, 4.5, 3.2, 1.2);
      puffs.push([W * r.range(0.3, 0.4), b - 5, 5, 4]);
      puffs.push([W * r.range(0.6, 0.7), b - 4.5, 4.5, 3.6]);
      return puffCloud(W, H, puffs, t);
    }
    case 6: {
      // 高耸的积云：宽底、中段三团、顶上一团偏左，整体呈圆顶山形
      const W = r.int(44, 54);
      const H = r.int(26, 31);
      const b = H - 1;
      row(5, W, b - H * 0.1, W * 0.1, H * 0.13);
      puffs.push([W * 0.24, b - H * 0.3, W * 0.15, H * 0.2]);
      puffs.push([W * 0.5, b - H * 0.36, W * 0.2, H * 0.24]);
      puffs.push([W * 0.76, b - H * 0.28, W * 0.14, H * 0.18]);
      puffs.push([W * r.range(0.38, 0.46), b - H * 0.6, W * 0.17, H * 0.22]);
      puffs.push([W * 0.6, b - H * 0.55, W * 0.13, H * 0.18]);
      puffs.push([W * r.range(0.42, 0.5), b - H * 0.76, W * 0.11, H * 0.16]);
      return puffCloud(W, H, puffs, t);
    }
    default: {
      const W = r.int(76, 96);
      const H = r.int(14, 17);
      const b = H - 1;
      row(Math.round(W / 12), W, b - 3, 7, 3.6, 1.2);
      row(Math.round(W / 18), W * 0.86, b - 7, 8, 4.5, 2);
      puffs.push([W * r.range(0.3, 0.6), b - H * 0.62, 9, 5]);
      return puffCloud(W, H, puffs, t);
    }
  }
}
