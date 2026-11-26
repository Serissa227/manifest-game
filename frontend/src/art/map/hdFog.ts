// 高清瓦片上的迷雾（H10c）：与高清地形同一种分辨率（8 × 8 粗格一块、每细格 k 像素），已揭开处透明、未探明处是羊皮纸。
// 迷雾的状态是粗格级的（每格揭开没有），这里把它平滑成一张连续的“雾浓度”：粗格中心的 0 / 1 按二次 B 样条插值，
// 取样位置按平滑噪声挪一挪（边缘不沿格线、像墨晕开的纸边），再在 0.4–0.6 之间平滑过渡；
// 纸面有细的纤维纹与几乎看不出的斜线，靠近边缘处颜色略深（像旧纸被熏过的边），揭开的一侧落一道淡淡的阴影。
// 孤零零一格揭开的海（四周都没探明）中心的雾浓度是 0.44，大半露出来；孤零零一格没探明的中心是 0.56，大半盖住。
import { P } from "../palette";
import { rgba } from "../px";
import { noiseAt, scratchF32, smoothstep } from "./hdField";
import { tileTable } from "./noise";
import { DETAIL_CELL } from "./types";

/** 迷雾瓦片：左上角的世界像素坐标与 RGBA 字节。 */
export interface HdFogImage {
  x: number;
  y: number;
  w: number;
  h: number;
  data: Uint8ClampedArray<ArrayBuffer>;
}

function rgb(c: string): [number, number, number] {
  const v = rgba(c);
  return [(v >>> 24) & 0xff, (v >>> 16) & 0xff, (v >>> 8) & 0xff];
}
const PAPER = rgb(P.parchment);
const PAPER_EDGE = rgb(P.parchmentDark);
const SHADOW: [number, number, number] = [60, 44, 26];

let tables: { warpA: Float32Array; warpB: Float32Array; grain: Float32Array; fiber: Float32Array } | null = null;
function noise() {
  return (tables ??= {
    warpA: tileTable(512, 20, 4101),
    warpB: tileTable(512, 20, 4103),
    grain: tileTable(256, 3, 4107),
    fiber: tileTable(256, 12, 4109),
  });
}

/** 二次 B 样条的三个权重。 */
function bs(t: number, out: Float32Array) {
  out[0] = 0.5 * (0.5 - t) * (0.5 - t);
  out[1] = 0.75 - t * t;
  out[2] = 0.5 * (0.5 + t) * (0.5 + t);
}

/**
 * 一块高清迷雾瓦片：瓦片 (tx, ty) 盖粗格 [tx·tile, tx·tile + tile) × [ty·tile, …)；k 为每细格的像素。
 * revealed（每粗格 1 字节，1 已揭开）为 null（还没有迷雾）或这一块连同四周三格都已揭开时返回 null（不必贴图）。
 */
export function hdFogTile(revealed: Uint8Array | null, width: number, height: number, wrap: boolean, tx: number, ty: number, k: number, tile: number): HdFogImage | null {
  if (!revealed) return null;
  const cx0 = tx * tile;
  const cy0 = ty * tile;
  const cw = Math.max(0, Math.min(tile, width - cx0));
  const ch = Math.max(0, Math.min(tile, height - cy0));
  if (cw === 0 || ch === 0) return null;
  // 四周多取 3 格（B 样条一格、挪位不到一格，再留一格）
  const M = 3;
  const gw = cw + 2 * M;
  const gh = ch + 2 * M;
  const raw = scratchF32("fog-raw", gw * gh);
  let any = false;
  for (let gy = 0; gy < gh; gy++) {
    const y = Math.max(0, Math.min(height - 1, cy0 + gy - M));
    for (let gx = 0; gx < gw; gx++) {
      let x = cx0 + gx - M;
      x = wrap ? ((x % width) + width) % width : Math.max(0, Math.min(width - 1, x));
      const v = revealed[y * width + x] ? 0 : 1;
      raw[gy * gw + gx] = v;
      if (v) any = true;
    }
  }
  if (!any) return null;
  const S = DETAIL_CELL;
  const cellPx = S * k;
  const w = cw * cellPx;
  const h = ch * cellPx;
  const X0 = cx0 * cellPx;
  const Y0 = cy0 * cellPx;
  const data = new Uint8ClampedArray(new ArrayBuffer(w * h * 4));
  const out = new Uint32Array(data.buffer);
  const N = noise();
  const wx = new Float32Array(3);
  const wy = new Float32Array(3);
  // 整块是雾、四周三格也都是雾：直接铺纸（不必逐像素插值）
  let all = true;
  for (let i = 0; i < gw * gh && all; i++) if (!raw[i]) all = false;
  for (let oy = 0; oy < h; oy++) {
    const Y = Y0 + oy;
    const v = (Y + 0.5) / k;
    for (let ox = 0; ox < w; ox++) {
      const X = X0 + ox;
      const u = (X + 0.5) / k;
      let f = 1;
      if (!all) {
        // 雾浓度：粗格坐标（格心在 i + 0.5），取样位置挪不到半格
        const cu = (u + (noiseAt(N.warpA, 9, u, v) - 0.5) * 22) / S - cx0 + M;
        const cv = (v + (noiseAt(N.warpB, 9, u, v) - 0.5) * 22) / S - cy0 + M;
        const sx = Math.max(1, Math.min(gw - 2, Math.floor(cu)));
        const sy = Math.max(1, Math.min(gh - 2, Math.floor(cv)));
        bs(Math.max(-0.5, Math.min(0.5, cu - sx - 0.5)), wx);
        bs(Math.max(-0.5, Math.min(0.5, cv - sy - 0.5)), wy);
        f = 0;
        for (let j = 0; j < 3; j++) {
          const row = (sy - 1 + j) * gw + sx - 1;
          f += (raw[row] * wx[0] + raw[row + 1] * wx[1] + raw[row + 2] * wx[2]) * wy[j];
        }
        if (f <= 0.2) continue;
        f += (noiseAt(N.grain, 8, u * 0.7, v * 0.7) - 0.5) * 0.08;
      }
      const a = smoothstep(0.4, 0.6, f);
      // 揭开的一侧：一道淡淡的阴影（纸边压在海面上）
      const sh = (1 - a) * smoothstep(0.24, 0.4, f) * 0.22;
      if (a <= 0 && sh <= 0) continue;
      // 纸：纤维纹与细颗粒，边上颜色略深
      const grain = 1 + (noiseAt(N.grain, 8, u * 3, v * 3) - 0.5) * 0.06 + (noiseAt(N.fiber, 8, u * 0.35, v * 1.6) - 0.5) * 0.05;
      const edge = 1 - smoothstep(0.52, 0.85, f);
      // 几乎看不出的斜线（与世界图的迷雾同一个意思）
      const hatch = ((X + Y) % Math.max(3, 3 * k)) < Math.max(1, k * 0.35) ? 0.965 : 1;
      let r = (PAPER[0] + (PAPER_EDGE[0] - PAPER[0]) * edge * 0.55) * grain * hatch;
      let g = (PAPER[1] + (PAPER_EDGE[1] - PAPER[1]) * edge * 0.55) * grain * hatch;
      let b = (PAPER[2] + (PAPER_EDGE[2] - PAPER[2]) * edge * 0.55) * grain * hatch;
      // 预乘之前按“纸 + 阴影”合成：alpha = a + sh·(1 − a)
      const al = a + sh * (1 - a);
      if (al <= 0) continue;
      const kp = a / al;
      r = r * kp + SHADOW[0] * (1 - kp);
      g = g * kp + SHADOW[1] * (1 - kp);
      b = b * kp + SHADOW[2] * (1 - kp);
      const A = Math.round(al * 255);
      out[oy * w + ox] = ((A << 24) | (Math.min(255, Math.max(0, b | 0)) << 16) | (Math.min(255, Math.max(0, g | 0)) << 8) | Math.min(255, Math.max(0, r | 0))) >>> 0;
    }
  }
  return { x: X0, y: Y0, w, h, data };
}
