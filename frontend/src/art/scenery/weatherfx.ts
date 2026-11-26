// 天气叠加层：雨丝、雪花、雾带（透明底，多帧，确定性），以及暴风雨的柔和闪电。
// 叠加层由街景、航行小画面贴在整幅画面上；全部由坐标哈希决定，同样的参数永远画出同样的图，帧号按周期取模、首尾相接。
//
// 雨与雪的循环：在“斜切坐标” u = x − s·y 中，雨丝是竖直的，图案只沿 y 向下移动、y 方向以 TH 为周期；
// 每帧下移 dy，TH = dy × 帧数，所以最后一帧接回第一帧，而屏幕上的雨丝沿着风的斜向落下。
import { P } from "../palette";
import { Px, rgba, type Rgba } from "../px";
import type { TimeOfDay } from "./types";
import { ditherHit, h2, mix } from "./util";

/** 雨的循环帧数。 */
export const RAIN_FRAMES = 8;
/** 雪的循环帧数（雪落得慢，周期更长）。 */
export const SNOW_FRAMES = 32;
/** 雾带横向循环的周期（像素）：雾图比画面宽这么多，按帧平移后取窗口。 */
export const FOG_PERIOD = 256;

export interface FxOpts {
  /** 时段：决定雨雪雾的颜色（夜里暗一些） */
  time?: TimeOfDay;
  /** 风的东西分量 −1（向西）..1（向东）：雨丝与雪花朝风的去向斜落；缺省 0.4（微向东） */
  windX?: number;
  /** 暴风雨：雨更密、更长、更斜 */
  heavy?: boolean;
}

function wrap(frame: number, n: number): number {
  return ((Math.floor(frame) % n) + n) % n;
}

function clampWind(w: number | undefined): number {
  const v = Number.isFinite(w) ? (w as number) : 0.4;
  return Math.max(-1, Math.min(1, v));
}

/** 半透明色：rgb 取 base，不透明度 a（0–255）。 */
function withAlpha(base: Rgba, a: number): Rgba {
  return ((base & 0xffffff00) | Math.max(0, Math.min(255, Math.round(a)))) >>> 0;
}

/** 雨丝的颜色：比背景亮一些的冷灰，夜里压暗。 */
function rainColor(time: TimeOfDay): Rgba {
  if (time === "night") return mix(P.night[3], P.snow[0], 0.45);
  if (time === "dusk") return mix(P.snow[1], P.dusk[3], 0.3);
  if (time === "dawn") return mix(P.snow[1], P.blossom[2], 0.3);
  return mix(P.snow[1], P.white, 0.3);
}

interface RainLayer {
  /** 格子宽（u 方向）与高 */
  cw: number;
  ch: number;
  /** 每帧下移的像素 */
  dy: number;
  len: readonly [number, number];
  density: number;
  alpha: number;
  seed: number;
}

/**
 * 雨丝叠加层：宽 w、高 h 的透明底图，frame 以 RAIN_FRAMES 为周期。远近两层：远处的雨丝短而淡、落得慢，近处的长而亮、落得快。
 */
export function drawRainLayer(w: number, h: number, frame: number, opts: FxOpts = {}): Px {
  const f = wrap(frame, RAIN_FRAMES);
  const time = opts.time ?? "day";
  const heavy = !!opts.heavy;
  const wind = clampWind(opts.windX);
  // 斜率：风越偏东西越斜；暴风雨更斜
  const s = Math.sign(wind || 1) * (0.12 + Math.abs(wind) * 0.38) * (heavy ? 1.5 : 1);
  const base = rainColor(time);
  const p = new Px(w, h);
  const layers: RainLayer[] = [
    { cw: 5, ch: 12, dy: 4, len: [2, 3], density: heavy ? 0.5 : 0.3, alpha: heavy ? 0x60 : 0x48, seed: 0x7b01 },
    { cw: 9, ch: 16, dy: 8, len: heavy ? [6, 9] : [4, 7], density: heavy ? 0.62 : 0.4, alpha: heavy ? 0x98 : 0x78, seed: 0x7b21 },
  ];
  for (const L of layers) {
    // y 方向的周期必须等于一个循环里下移的总量，最后一帧才能接回第一帧
    const th = L.dy * RAIN_FRAMES;
    const rows = Math.max(1, Math.round(th / L.ch));
    const colHi = withAlpha(base, L.alpha);
    const colLo = withAlpha(base, L.alpha * 0.55);
    const uMin = Math.min(0, -s * h) - 2;
    const uMax = w + Math.max(0, -s * h) + 2 + Math.abs(s) * h;
    for (let cu = Math.floor(uMin / L.cw); cu * L.cw < uMax; cu++) {
      for (let r = 0; r < rows; r++) {
        if (h2(L.seed, cu, r) > L.density) continue;
        const u = cu * L.cw + Math.floor(h2(L.seed + 1, cu, r) * L.cw);
        const len = L.len[0] + Math.floor(h2(L.seed + 2, cu, r) * (L.len[1] - L.len[0] + 1));
        const y0 = (r * (th / rows) + Math.floor(h2(L.seed + 3, cu, r) * (th / rows)) + L.dy * f) % th;
        for (let k = -1; y0 + k * th - len < h; k++) {
          const head = y0 + k * th;
          for (let i = 0; i < len; i++) {
            const y = Math.floor(head - i);
            if (y < 0 || y >= h) continue;
            const x = Math.round(u + s * y);
            if (x < 0 || x >= w) continue;
            p.data[y * w + x] = i === 0 ? colHi : i < len - 1 ? colHi : colLo;
          }
        }
      }
    }
  }
  return p;
}

/** 雪花叠加层：宽 w、高 h 的透明底图，frame 以 SNOW_FRAMES 为周期。远处 1 像素的细雪，近处十字形的大片，左右轻摆、朝风的去向飘。 */
export function drawSnowLayer(w: number, h: number, frame: number, opts: FxOpts = {}): Px {
  const f = wrap(frame, SNOW_FRAMES);
  const time = opts.time ?? "day";
  const wind = clampWind(opts.windX);
  const s = wind * 0.5;
  const night = time === "night";
  const white = night ? mix(P.snow[1], P.night[3], 0.35) : rgba(P.white);
  const soft = night ? mix(P.snow[0], P.night[2], 0.4) : rgba(P.snow[2]);
  const p = new Px(w, h);
  const layers = [
    { cw: 7, ch: 9, dy: 1, density: 0.34, big: false, seed: 0x5a01 },
    { cw: 14, ch: 16, dy: 2, density: 0.36, big: true, seed: 0x5a21 },
  ];
  for (const L of layers) {
    const th = L.dy * SNOW_FRAMES;
    const rows = Math.max(1, Math.round(th / L.ch));
    const uMin = Math.min(0, -s * h) - 3;
    const uMax = w + Math.abs(s) * h + 3;
    for (let cu = Math.floor(uMin / L.cw); cu * L.cw < uMax; cu++) {
      for (let r = 0; r < rows; r++) {
        if (h2(L.seed, cu, r) > L.density) continue;
        const u = cu * L.cw + Math.floor(h2(L.seed + 1, cu, r) * L.cw);
        const y0 = (r * (th / rows) + Math.floor(h2(L.seed + 2, cu, r) * (th / rows)) + L.dy * f) % th;
        const phase = h2(L.seed + 3, cu, r) * Math.PI * 2;
        const sway = Math.round(Math.sin((f / SNOW_FRAMES) * Math.PI * 2 * (L.big ? 2 : 1) + phase) * (L.big ? 1.5 : 1));
        for (let k = -1; y0 + k * th - 2 < h; k++) {
          const y = Math.floor(y0 + k * th);
          const x = Math.round(u + s * y) + sway;
          if (L.big) {
            const put = (xx: number, yy: number, c: Rgba) => {
              if (xx >= 0 && yy >= 0 && xx < w && yy < h) p.data[yy * w + xx] = c;
            };
            put(x, y, white);
            if (h2(L.seed + 4, cu, r) < 0.5) {
              put(x - 1, y, soft);
              put(x + 1, y, soft);
              put(x, y - 1, soft);
              put(x, y + 1, soft);
            } else put(x + 1, y, soft);
          } else if (x >= 0 && y >= 0 && x < w && y < h) {
            p.data[y * w + x] = withAlpha(soft, 0xc0);
          }
        }
      }
    }
  }
  return p;
}

/** 雾色：随时段变化（与 grade.ts 的雾色一致的亮度层次）。 */
function fogColor(time: TimeOfDay): Rgba {
  if (time === "night") return mix(P.night[3], P.stone[2], 0.4);
  if (time === "dusk") return mix(P.stone[3], P.dusk[3], 0.35);
  if (time === "dawn") return mix(P.stone[4], P.blossom[2], 0.35);
  return rgba(P.snow[2]);
}

/** 一条雾带：中心行 cy、半高 hh、最大浓度 k（0–1）。 */
export interface FogBand {
  cy: number;
  hh: number;
  k: number;
}

/**
 * 雾带叠加层：宽 w + FOG_PERIOD、高 h 的透明底图，横向以 FOG_PERIOD 为周期（左右无缝），由若干条厚薄起伏的横带组成。
 * 用 fogOffset(frame) 取当前帧的横向平移量，把图贴在 x = −offset 处即可；bands 缺省为画面中下部的三条。
 */
export function drawFogLayer(w: number, h: number, opts: FxOpts & { bands?: readonly FogBand[] } = {}): Px {
  const time = opts.time ?? "day";
  const col = fogColor(time);
  const W = w + FOG_PERIOD;
  const p = new Px(W, h);
  const bands = opts.bands ?? [
    { cy: Math.round(h * 0.48), hh: Math.max(3, Math.round(h * 0.09)), k: 0.8 },
    { cy: Math.round(h * 0.66), hh: Math.max(2, Math.round(h * 0.06)), k: 0.55 },
    { cy: Math.round(h * 0.86), hh: Math.max(2, Math.round(h * 0.05)), k: 0.4 },
  ];
  // 周期噪声：格子序号对周期取模，保证 x 与 x + FOG_PERIOD 完全相同
  const cells = 8;
  const cellW = FOG_PERIOD / cells;
  const pnoise = (seed: number, x: number): number => {
    const u = x / cellW;
    const i = Math.floor(u);
    const t = u - i;
    const s = t * t * (3 - 2 * t);
    const a = h2(seed, ((i % cells) + cells) % cells);
    const b = h2(seed, (((i + 1) % cells) + cells) % cells);
    return a * (1 - s) + b * s;
  };
  for (const [bi, b] of bands.entries()) {
    for (let x = 0; x < W; x++) {
      // 雾带的厚薄与上下起伏
      const thick = b.hh * (0.55 + 0.9 * pnoise(0x6f01 + bi * 7, x));
      const mid = b.cy + (pnoise(0x6f02 + bi * 7, x) - 0.5) * b.hh * 1.2;
      const y0 = Math.max(0, Math.floor(mid - thick));
      const y1 = Math.min(h - 1, Math.ceil(mid + thick));
      for (let y = y0; y <= y1; y++) {
        const d = Math.abs(y + 0.5 - mid) / Math.max(1, thick);
        const dens = b.k * (1 - d * d);
        if (dens <= 0.08) continue;
        // 底层是一层很淡的连续薄雾，浓处再用抖动点出更白的雾絮，既柔和又保留像素感
        const i = y * W + x;
        const a = Math.round(0x18 + dens * 0x48) + (ditherHit(x, y, dens * 0.8) ? 0x30 : 0);
        const prev = p.data[i] & 0xff;
        if (a > prev) p.data[i] = withAlpha(col, a);
      }
    }
  }
  return p;
}

/** 雾带在第 frame 帧的横向平移量（0..FOG_PERIOD-1）：每 speedDiv 帧移动 1 像素，dir 为 1 向右、−1 向左。 */
export function fogOffset(frame: number, dir = 1, speedDiv = 3): number {
  const step = Math.floor(Math.floor(frame) / Math.max(1, speedDiv));
  const d = dir < 0 ? -1 : 1;
  return (((-d * step) % FOG_PERIOD) + FOG_PERIOD) % FOG_PERIOD;
}

// ───────────────────────── 闪电 ─────────────────────────

/** 两次闪电之间至少间隔的秒数。 */
export const LIGHTNING_MIN_GAP_S = 3;
/** 每个“闪电周期”的秒数：一个周期最多闪一次。 */
const LIGHTNING_CYCLE_S = 5;

/**
 * 第 frame 帧（每秒 fps 帧）的闪电提亮强度，0 表示不闪。每 5 秒的周期里最多闪一次，
 * 闪的起点限定在周期的前 2 秒，所以相邻两次闪电的起点至少相隔 3 秒；每次只亮两帧（先亮后弱），强度柔和（≤ 0.16）。
 */
export function lightningAt(frame: number, fps = 10): number {
  const f = Math.floor(frame);
  if (f < 0) return 0;
  const cycle = Math.max(1, Math.round(LIGHTNING_CYCLE_S * fps));
  const gap = Math.ceil(LIGHTNING_MIN_GAP_S * fps);
  const c = Math.floor(f / cycle);
  const within = f - c * cycle;
  // 大约三成的周期不闪，节奏不那么机械
  if (h2(0x11e7, c) < 0.3) return 0;
  const start = Math.floor(h2(0x11e8, c) * Math.max(1, cycle - gap - 1));
  if (within === start) return 0.16;
  if (within === start + 1) return 0.07;
  return 0;
}

/** 闪电的提亮：整幅画面向冷白色混合 k（原地修改）。 */
export function applyFlash(px: Px, k: number): void {
  if (!(k > 0)) return;
  const d = px.data;
  const tr = 236;
  const tg = 242;
  const tb = 255;
  for (let i = 0; i < d.length; i++) {
    const v = d[i];
    const a = v & 0xff;
    if (!a) continue;
    const r = (v >>> 24) & 0xff;
    const g = (v >>> 16) & 0xff;
    const b = (v >>> 8) & 0xff;
    d[i] = (((r + (tr - r) * k) << 24) | ((g + (tg - g) * k) << 16) | ((b + (tb - b) * k) << 8) | a) >>> 0;
  }
}

/** 远处的一道闪电（透明底，约 12×40）：之字形的主干与一条短岔，seed 决定走向。 */
export function drawBolt(seed: number, height = 40): Px {
  const h = Math.max(12, Math.floor(height));
  const w = 14;
  const p = new Px(w, h);
  const core = rgba(P.white);
  const halo = withAlpha(mix(P.snow[1], P.white, 0.5), 0x90);
  let x = Math.floor(w / 2);
  let branchAt = Math.floor(h * (0.35 + h2(seed, 99) * 0.3));
  for (let y = 0; y < h; y++) {
    if (y % 4 === 0 && y > 0) x += h2(seed, y) < 0.5 ? -1 : 1;
    x = Math.max(2, Math.min(w - 3, x));
    p.data[y * w + x] = core;
    if (p.data[y * w + x - 1] === 0) p.data[y * w + x - 1] = halo;
    if (p.data[y * w + x + 1] === 0) p.data[y * w + x + 1] = halo;
    if (y === branchAt) {
      // 短岔：斜向下几像素
      const dir = h2(seed, 7) < 0.5 ? -1 : 1;
      for (let i = 1; i < 7 && y + i < h; i++) {
        const bx = x + dir * Math.ceil(i / 2);
        if (bx >= 0 && bx < w) p.data[(y + i) * w + bx] = i < 4 ? core : halo;
      }
      branchAt = -1;
    }
  }
  return p;
}
