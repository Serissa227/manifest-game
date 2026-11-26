// 高清海图瓦片（H10c）用的场：细格上的有符号距离（精确欧氏距离变换）、二次 B 样条放大到高清像素、
// 任意倍率的细高程插值。纯函数与纯数据，不碰 DOM；后台线程与主线程后备共用。
//
// 岸线为什么能与碰撞对上（docs/drafts/h10c-handoff.md 第 3 节）：
//   g(c) = 细格中心 c 到“另一类细格”的距离减 0.5（陆为正、水为负）。真正的有符号距离 G 是 1-利普希茨的、
//   零点正好是细格的边；g 与 G 在格心上相差不到 0.21（g ≥ G ≥ g − 0.21）。
//   二次 B 样条是格心样本的凸组合、并且精确重现线性函数，所以插值 ĝ(p) 与 G(p) 之差 ≤ Σ wᵢ·|cᵢ − p| + 0.21 ≤ 0.71 + 0.21。
//   画出来的岸线是 ĝ = 0 的地方，那里 |G| ≤ 0.92：离真正的细格边界不到 0.92 个细格。
import type { FineLayers } from "./fine";

/** 足够大的“没有”。 */
const FAR = 1e20;

// 逐块重复使用的草稿缓冲（后台线程里一块一块地画，不会重入）
const f32s = new Map<string, Float32Array>();
const f64s = new Map<string, Float64Array>();
const i32s = new Map<string, Int32Array>();
const u8s = new Map<string, Uint8Array>();

export function scratchF32(name: string, n: number): Float32Array {
  let b = f32s.get(name);
  if (!b || b.length < n) f32s.set(name, (b = new Float32Array(n)));
  return b;
}
function scratchF64(name: string, n: number): Float64Array {
  let b = f64s.get(name);
  if (!b || b.length < n) f64s.set(name, (b = new Float64Array(n)));
  return b;
}
function scratchI32(name: string, n: number): Int32Array {
  let b = i32s.get(name);
  if (!b || b.length < n) i32s.set(name, (b = new Int32Array(n)));
  return b;
}
export function scratchU8(name: string, n: number): Uint8Array {
  let b = u8s.get(name);
  if (!b || b.length < n) u8s.set(name, (b = new Uint8Array(n)));
  return b;
}

/** 一维的平方距离变换（Felzenszwalb–Huttenlocher 下包络）：f 为输入（特征处 0、其余 FAR），d 为输出。 */
function edt1d(f: Float64Array, n: number, d: Float64Array, v: Int32Array, z: Float64Array) {
  let k = 0;
  v[0] = 0;
  z[0] = -FAR;
  z[1] = FAR;
  for (let q = 1; q < n; q++) {
    const fq = f[q] + q * q;
    let s = (fq - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
    while (s <= z[k]) {
      k--;
      s = (fq - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
    }
    k++;
    v[k] = q;
    z[k] = s;
    z[k + 1] = FAR;
  }
  k = 0;
  for (let q = 0; q < n; q++) {
    while (z[k + 1] < q) k++;
    const dq = q - v[k];
    d[q] = dq * dq + f[v[k]];
  }
}

/**
 * 二维精确的平方欧氏距离变换：feature[i] 非 0 的格是特征，out[i] = 到最近特征格中心的平方距离（格）。
 * 没有特征时全是 FAR。
 */
export function edt(w: number, h: number, feature: (i: number) => boolean, out: Float64Array): Float64Array {
  const n = Math.max(w, h);
  const f = scratchF64("edt-f", n);
  const d = scratchF64("edt-d", n);
  const z = scratchF64("edt-z", n + 1);
  const v = scratchI32("edt-v", n);
  // 先按列
  for (let x = 0; x < w; x++) {
    for (let y = 0; y < h; y++) f[y] = feature(y * w + x) ? 0 : FAR;
    edt1d(f, h, d, v, z);
    for (let y = 0; y < h; y++) out[y * w + x] = d[y];
  }
  // 再按行
  for (let y = 0; y < h; y++) {
    const row = y * w;
    for (let x = 0; x < w; x++) f[x] = out[row + x];
    edt1d(f, w, d, v, z);
    for (let x = 0; x < w; x++) out[row + x] = d[x];
  }
  return out;
}

/**
 * 细格上的有符号距离（细格；正在 inside 一侧，负在另一侧），夹到 ±clamp：
 * g = 到另一类最近格心的距离 − 0.5（贴边的格正好 ±0.5，与真正的有符号距离相差不到 0.21）。
 * cls 是每细格的类别，inside(c) 判断一个类别算不算“里面”；ignore(c) 为真的格两边都不算（不当特征），
 * 它们取两侧距离之差的一半（中垂线的有符号距离），场在那里也连续。
 */
export function signedField(
  w: number,
  h: number,
  inside: (i: number) => boolean,
  outside: (i: number) => boolean,
  clamp: number,
  out: Float32Array,
): Float32Array {
  const n = w * h;
  const dIn = edt(w, h, inside, scratchF64("sdf-in", n));
  const dOut = edt(w, h, outside, scratchF64("sdf-out", n));
  for (let i = 0; i < n; i++) {
    let g: number;
    if (inside(i)) g = Math.sqrt(dOut[i]) - 0.5;
    else if (outside(i)) g = 0.5 - Math.sqrt(dIn[i]);
    else g = 0.5 * (Math.sqrt(dOut[i]) - Math.sqrt(dIn[i]));
    out[i] = g > clamp ? clamp : g < -clamp ? -clamp : g;
  }
  return out;
}

/** 二次 B 样条在偏移 t（样本宽，−0.5..0.5，相对最近样本中心）上的三个权重。 */
function bspline(t: number, out: Float32Array, at: number) {
  out[at] = 0.5 * (0.5 - t) * (0.5 - t);
  out[at + 1] = 0.75 - t * t;
  out[at + 2] = 0.5 * (0.5 + t) * (0.5 + t);
}

/**
 * 细格上的场放大到高清像素（二次 B 样条，坡度连续）：场的窗口宽 fw、高 fh，瓦片在窗口里从细格 (m, m) 开始；
 * 输出 w × h 像素，每细格 k 像素（像素中心在细格坐标 m + (o + 0.5) / k）。
 */
export function upsampleField(field: Float32Array, fw: number, fh: number, m: number, k: number, w: number, h: number, out: Float32Array): Float32Array {
  const wx = scratchF32("up-wx", w * 3);
  const sx = scratchI32("up-sx", w);
  for (let o = 0; o < w; o++) {
    const u = m + (o + 0.5) / k;
    const s = Math.floor(u);
    bspline(u - s - 0.5, wx, o * 3);
    sx[o] = s < 1 ? 1 : s > fw - 2 ? fw - 2 : s;
  }
  // 横向：只算用得到的行
  const r0 = Math.max(0, Math.floor(m + 0.5 / k) - 1);
  const r1 = Math.min(fh - 1, Math.floor(m + (h - 0.5) / k) + 1);
  const rows = r1 - r0 + 1;
  const tmp = scratchF32("up-tmp", rows * w);
  for (let r = 0; r < rows; r++) {
    const src = (r0 + r) * fw;
    const o0 = r * w;
    for (let o = 0; o < w; o++) {
      const i = src + sx[o];
      const q = o * 3;
      tmp[o0 + o] = field[i - 1] * wx[q] + field[i] * wx[q + 1] + field[i + 1] * wx[q + 2];
    }
  }
  const wy = scratchF32("up-wy", 3);
  for (let o = 0; o < h; o++) {
    const v = m + (o + 0.5) / k;
    let s = Math.floor(v);
    bspline(v - s - 0.5, wy, 0);
    s = s < r0 + 1 ? r0 + 1 : s > r1 - 1 ? r1 - 1 : s;
    const a = (s - 1 - r0) * w;
    const b = (s - r0) * w;
    const c = (s + 1 - r0) * w;
    const row = o * w;
    const w0 = wy[0];
    const w1 = wy[1];
    const w2 = wy[2];
    for (let x = 0; x < w; x++) out[row + x] = tmp[a + x] * w0 + tmp[b + x] * w1 + tmp[c + x] * w2;
  }
  return out;
}

/**
 * 细高程在高清像素窗口上的平滑插值（二次 B 样条）：窗口左上角是世界像素 (x0, y0)（每细格 k 像素、每粗格 24k 像素），
 * 宽 w、高 h。clamp 为 1 时样本先夹到 ≥ 0 并做一次 [1 2 1] 模糊（陆地：细高程在不少地方是成块的粗数据），−1 时夹到 ≤ 0（水深）。
 * 与细节瓦片（detail.ts 的 elevationWindow）是同一种插值，只是像素可以比细格密。
 */
export function elevationHd(f: FineLayers, sub: number, x0: number, y0: number, w: number, h: number, k: number, clamp: -1 | 1, out: Float32Array): Float32Array {
  // 一个高程样本占多少世界像素
  const step = (sub / f.elevPer) * k;
  const sx0 = Math.floor((x0 + 0.5) / step - 0.5) - 1;
  const sy0 = Math.floor((y0 + 0.5) / step - 0.5) - 1;
  const ncol = Math.floor((x0 + w - 0.5) / step - 0.5) + 2 - sx0 + 1;
  const nrow = Math.floor((y0 + h - 0.5) / step - 0.5) + 2 - sy0 + 1;
  const { elevW, elevH, elevation } = f;
  const samples = scratchF32("eh-samples", ncol * nrow);
  for (let r = 0; r < nrow; r++) {
    let ey = sy0 + r;
    ey = ey < 0 ? 0 : ey >= elevH ? elevH - 1 : ey;
    for (let c = 0; c < ncol; c++) {
      const ex = (((sx0 + c) % elevW) + elevW) % elevW;
      let v = elevation[ey * elevW + ex];
      if (clamp > 0) v = v < 0 ? 0 : v;
      else v = v > 0 ? 0 : v;
      samples[r * ncol + c] = v;
    }
  }
  if (clamp > 0) {
    const blur = scratchF32("eh-blur", ncol * nrow);
    for (let r = 0; r < nrow; r++) {
      const o = r * ncol;
      for (let c = 0; c < ncol; c++) blur[o + c] = (samples[o + (c > 0 ? c - 1 : c)] + 2 * samples[o + c] + samples[o + (c < ncol - 1 ? c + 1 : c)]) * 0.25;
    }
    for (let r = 0; r < nrow; r++) {
      const o = r * ncol;
      const up = (r > 0 ? r - 1 : r) * ncol;
      const dn = (r < nrow - 1 ? r + 1 : r) * ncol;
      for (let c = 0; c < ncol; c++) samples[o + c] = (blur[up + c] + 2 * blur[o + c] + blur[dn + c]) * 0.25;
    }
  }
  const wx = scratchF32("eh-wx", w * 3);
  const cx = scratchI32("eh-cx", w);
  for (let o = 0; o < w; o++) {
    const e = (x0 + o + 0.5) / step;
    const s = Math.floor(e - 0.5);
    // 最近的样本中心是 s 或 s + 1
    const near = e - (s + 0.5) < 0.5 ? s : s + 1;
    bspline(e - near - 0.5, wx, o * 3);
    cx[o] = near - sx0;
  }
  const tmp = scratchF32("eh-tmp", nrow * w);
  for (let r = 0; r < nrow; r++) {
    const base = r * ncol;
    const o0 = r * w;
    for (let o = 0; o < w; o++) {
      const i = base + cx[o];
      const q = o * 3;
      tmp[o0 + o] = samples[i - 1] * wx[q] + samples[i] * wx[q + 1] + samples[i + 1] * wx[q + 2];
    }
  }
  const wy = scratchF32("eh-wy", 3);
  for (let o = 0; o < h; o++) {
    const e = (y0 + o + 0.5) / step;
    const s = Math.floor(e - 0.5);
    const near = e - (s + 0.5) < 0.5 ? s : s + 1;
    bspline(e - near - 0.5, wy, 0);
    const r = near - sy0;
    const a = (r - 1) * w;
    const b = r * w;
    const c = (r + 1) * w;
    const row = o * w;
    const w0 = wy[0];
    const w1 = wy[1];
    const w2 = wy[2];
    for (let x = 0; x < w; x++) out[row + x] = tmp[a + x] * w0 + tmp[b + x] * w1 + tmp[c + x] * w2;
  }
  return out;
}

/**
 * 原地的方框模糊（每个方向半宽 r 像素，做 passes 遍；两遍就是三角形的核）：边上按最近的值延伸。
 * 用来把放大后的有符号距离再抹平一点（岸线上一格一格的台阶变成圆滑的线）；岸线不会因此跑出界，见 hd.ts 的夹紧。
 */
export function boxBlur(a: Float32Array, w: number, h: number, r: number, passes: number): Float32Array {
  if (r <= 0 || passes <= 0) return a;
  const n = Math.max(w, h);
  const pre = scratchF64("box-pre", n + 2 * r + 2);
  const inv = 1 / (2 * r + 1);
  // 一行（或一列）：从 start 起、步长 step、长 len；前缀和两端按最近的值延伸 r 个
  const run = (start: number, step: number, len: number) => {
    pre[0] = 0;
    for (let i = 0; i < len + 2 * r; i++) {
      const j = i - r;
      pre[i + 1] = pre[i] + a[start + (j < 0 ? 0 : j >= len ? len - 1 : j) * step];
    }
    for (let i = 0; i < len; i++) a[start + i * step] = (pre[i + 2 * r + 1] - pre[i]) * inv;
  };
  for (let p = 0; p < passes; p++) {
    for (let y = 0; y < h; y++) run(y * w, 1, w);
    for (let x = 0; x < w; x++) run(x, w, h);
  }
  return a;
}

/** 可平铺噪声表（边长 size = 1 << shift）上的双线性取值：u、v 可以是小数与负数。 */
export function noiseAt(t: Float32Array, shift: number, u: number, v: number): number {
  const m = (1 << shift) - 1;
  const x0 = Math.floor(u);
  const y0 = Math.floor(v);
  const fx = u - x0;
  const fy = v - y0;
  const xa = x0 & m;
  const xb = (x0 + 1) & m;
  const ya = (y0 & m) << shift;
  const yb = ((y0 + 1) & m) << shift;
  const a = t[ya | xa];
  const b = t[ya | xb];
  const c = t[yb | xa];
  const d = t[yb | xb];
  return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
}

/** 平滑阶跃。 */
export function smoothstep(e0: number, e1: number, x: number): number {
  const t = x <= e0 ? 0 : x >= e1 ? 1 : (x - e0) / (e1 - e0);
  return t * t * (3 - 2 * t);
}
