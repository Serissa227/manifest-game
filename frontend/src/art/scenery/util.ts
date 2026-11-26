// 景物共用的小工具：混色、有序抖动、按坐标取值的确定性噪声。
// 全部是纯函数，不依赖 DOM；随机一律由坐标哈希得到（同样的输入永远画出同样的图）。
import { rgba, type Color, type Px, type Rgba } from "../px";

/** 两种颜色按 t（0–1）线性混合，返回不透明的打包颜色。用于从共享调色板派生少量过渡色。 */
export function mix(a: Color, b: Color, t: number): Rgba {
  const A = rgba(a);
  const B = rgba(b);
  const k = Math.max(0, Math.min(1, t));
  const ch = (s: number) => Math.round(((A >>> s) & 0xff) * (1 - k) + ((B >>> s) & 0xff) * k) & 0xff;
  return ((ch(24) << 24) | (ch(16) << 16) | (ch(8) << 8) | 0xff) >>> 0;
}

/** 2×2 有序抖动：frac（0–1）量化成 0/25/50/75/100% 五档，返回该像素是否取“下一种颜色”。 */
export function ditherHit(x: number, y: number, frac: number): boolean {
  const level = Math.round(Math.max(0, Math.min(1, frac)) * 4);
  const b = [0, 2, 3, 1][((y & 1) << 1) | (x & 1)];
  return b < level;
}

/** 整数坐标哈希 → [0, 1)。seed 区分不同用途，x / y 为格子坐标。 */
export function h2(seed: number, x: number, y = 0): number {
  let h = (seed ^ Math.imul(x | 0, 0x27d4eb2d) ^ Math.imul((y | 0) + 0x3c6ef372, 0x165667b1)) >>> 0;
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

/** 一维值噪声（平滑插值），period 为格子宽度，返回 [0, 1)。 */
export function vnoise(seed: number, x: number, period: number): number {
  const u = x / period;
  const i = Math.floor(u);
  const f = u - i;
  const s = f * f * (3 - 2 * f);
  return h2(seed, i) * (1 - s) + h2(seed, i + 1) * s;
}

/** 规范化季节：0 春 1 夏 2 秋 3 冬。 */
export function seasonOf(season: number): 0 | 1 | 2 | 3 {
  return ((((Math.floor(season) || 0) % 4) + 4) % 4) as 0 | 1 | 2 | 3;
}

/** 颜色停靠点：pos 为 0–1 的位置。 */
export type Stop = readonly [number, Rgba];

/**
 * 竖向分段色带：相邻停靠点之间保持纯色，只在交界附近用 2×2 抖动过渡（16 位机常见做法）。
 * 直接写像素数组，比逐点混合快，适合整幅天空与海面。
 */
export function bands(data: Uint32Array, w: number, y0: number, y1: number, stops: readonly Stop[], soft = 0.35): void {
  const h = y1 - y0;
  if (h <= 0 || stops.length === 0) return;
  for (let y = y0; y < y1; y++) {
    const t = h <= 1 ? 0 : (y - y0) / (h - 1);
    let k = 0;
    while (k + 1 < stops.length && stops[k + 1][0] <= t) k++;
    const a = stops[k];
    const b = stops[Math.min(stops.length - 1, k + 1)];
    let frac = 0;
    if (b !== a && b[0] > a[0]) {
      const f = (t - a[0]) / (b[0] - a[0]);
      // 只在交界 soft 宽度内抖动
      frac = (f - (0.5 - soft / 2)) / soft;
    }
    const row = y * w;
    for (let x = 0; x < w; x++) data[row + x] = ditherHit(x, y, frac) ? b[1] : a[1];
  }
}

/** 在透明像素上补 1 像素描边（不改变图的尺寸）。 */
export function outlineInPlace(p: Px, c: Rgba): void {
  const src = p.data.slice();
  for (let y = 0; y < p.h; y++) {
    for (let x = 0; x < p.w; x++) {
      if (src[y * p.w + x] & 0xff) continue;
      const hit =
        (x > 0 && src[y * p.w + x - 1] & 0xff) ||
        (x < p.w - 1 && src[y * p.w + x + 1] & 0xff) ||
        (y > 0 && src[(y - 1) * p.w + x] & 0xff) ||
        (y < p.h - 1 && src[(y + 1) * p.w + x] & 0xff);
      if (hit) p.data[y * p.w + x] = c;
    }
  }
}

