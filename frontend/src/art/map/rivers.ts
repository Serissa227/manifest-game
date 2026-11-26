// 河流（rivers.toml）：沿格中心的折线做 Catmull-Rom 样条，再加一点垂直于流向的摆动（蜿蜒），
// 从源头的 1 像素细线逐渐加宽到入海处（宽度等级 1–3）；最后一段接到相邻的海格，入海口连着海。
// 宽的河在低洼的入海口分出几条汊流（三角洲），否则末段放宽成喇叭形的河口。河水只画在陆地像素上。
import { hash2, vnoise } from "./noise";
import { VEG, type CoastPx, type Geo } from "./geo";
import type { ChartRiver } from "./types";

/** 样条上的一个采样点（像素坐标，像素 px 的中心为 px + 0.5）与半径。 */
export interface RiverSample {
  x: number;
  y: number;
  r: number;
}

/** 一条河的笔画：主流与汊流。 */
export interface RiverStroke {
  main: RiverSample[];
  branches: RiverSample[][];
  /** 入海口附近的河口是否放宽（没有三角洲时） */
  delta: boolean;
}

type P2 = [number, number];

/** 沿 Catmull-Rom 样条采样（步长约 0.4 像素）。 */
function spline(pts: readonly P2[], step = 0.4): P2[] {
  const out: P2[] = [];
  const n = pts.length;
  if (n === 0) return out;
  if (n === 1) return [pts[0]];
  for (let i = 0; i + 1 < n; i++) {
    const p0 = pts[Math.max(0, i - 1)];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[Math.min(n - 1, i + 2)];
    const len = Math.hypot(p2[0] - p1[0], p2[1] - p1[1]);
    const k = Math.max(1, Math.ceil(len / step));
    for (let s = 0; s < k; s++) {
      const t = s / k;
      const t2 = t * t;
      const t3 = t2 * t;
      const f = (a: number, b: number, c: number, d: number) => 0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3);
      out.push([f(p0[0], p1[0], p2[0], p3[0]), f(p0[1], p1[1], p2[1], p3[1])]);
    }
  }
  out.push(pts[n - 1]);
  return out;
}

/** 河流宽度等级 → 入海处的半径（像素）。 */
const MOUTH_R = [0.6, 0.85, 1.3, 1.8];

/** 与格 (x, y) 相邻、离陆地最远的海格（没有时为 null）。 */
function seaNeighbor(geo: Geo, x: number, y: number): P2 | null {
  const { W, H, terr, seaDist } = geo;
  let best: P2 | null = null;
  let bd = -1;
  for (const [dx, dy] of [
    [0, 1],
    [1, 0],
    [0, -1],
    [-1, 0],
    [1, 1],
    [-1, 1],
    [1, -1],
    [-1, -1],
  ]) {
    const xx = x + dx;
    const yy = y + dy;
    if (xx < 0 || yy < 0 || xx >= W || yy >= H) continue;
    const i = yy * W + xx;
    if (terr[i] === 2) continue;
    // 正交的邻格优先（对角相邻时河口会斜着穿过岸角）
    const d = seaDist[i] + (dx === 0 || dy === 0 ? 10 : 0);
    if (d > bd) {
      bd = d;
      best = [xx, yy];
    }
  }
  return best;
}

/** 离 (tx, ty)（格）最近、且不是陆地的格（半径 3 以内；没有时为 null）。 */
function nearestSea(geo: Geo, tx: number, ty: number): P2 | null {
  const { W, H, terr } = geo;
  const cx = Math.round(tx);
  const cy = Math.round(ty);
  let best: P2 | null = null;
  let bd = Infinity;
  for (let dy = -3; dy <= 3; dy++)
    for (let dx = -3; dx <= 3; dx++) {
      const x = cx + dx;
      const y = cy + dy;
      if (x < 0 || y < 0 || x >= W || y >= H || terr[y * W + x] === 2) continue;
      const d = (x - tx) ** 2 + (y - ty) ** 2;
      if (d < bd) {
        bd = d;
        best = [x, y];
      }
    }
  return best;
}

/** 一条河的笔画（像素坐标）。路径不足两格时为 null。 */
export function riverStroke(river: ChartRiver, geo: Geo, cell: number): RiverStroke | null {
  const { W, H, terr } = geo;
  const cells: P2[] = [];
  for (const p of river.path) {
    const x = Math.round(p[0]);
    const y = Math.round(p[1]);
    if (x < 0 || y < 0 || x >= W || y >= H) continue;
    const last = cells[cells.length - 1];
    if (last && last[0] === x && last[1] === y) continue;
    cells.push([x, y]);
  }
  if (cells.length < 2) return null;
  const seed = cells[0][0] * 7919 + cells[0][1] * 131 + cells.length;
  const center = (c: P2): P2 => [c[0] * cell + cell / 2, c[1] * cell + cell / 2];
  // 先把格中心的折线抹平两遍（去掉逐格的 45° 折角），再按沿程的值噪声垂直于流向摆动（蜿蜒）
  let base: P2[] = cells.map(center);
  for (let it = 0; it < 2; it++) {
    base = base.map((p, i) => {
      if (i === 0 || i === base.length - 1) return p;
      const a = base[i - 1];
      const b = base[i + 1];
      return [(a[0] + 2 * p[0] + b[0]) / 4, (a[1] + 2 * p[1] + b[1]) / 4];
    });
  }
  const pts: P2[] = base.map(([x, y], i) => {
    if (i === 0 || i === base.length - 1) return [x, y];
    const [ax, ay] = base[i - 1];
    const [bx, by] = base[i + 1];
    const len = Math.hypot(bx - ax, by - ay) || 1;
    const off = (vnoise(i / 2.3, 0.5, seed) - 0.5) * 3.2 + (hash2(cells[i][0], cells[i][1], seed) - 0.5) * 0.8;
    return [x - ((by - ay) / len) * off, y + ((bx - ax) / len) * off];
  });
  const [mx, my] = cells[cells.length - 1];
  const mouthSea = seaNeighbor(geo, mx, my);
  if (mouthSea) {
    const [sx, sy] = center(mouthSea);
    pts.push([sx, sy]);
  }
  const width = Math.max(1, Math.min(3, Math.round(river.width) || 1));
  const r1 = MOUTH_R[width];
  const mi = my * W + mx;
  const lowMouth = terr[mi] === 2 && geo.relief[mi] <= 1;
  const delta = mouthSea !== null && width >= 2 && lowMouth && (geo.veg[mi] === VEG.WETLAND || width === 3);
  const path = spline(pts);
  // 弧长 → 半径：源头 0.5（1 像素的细线），入海处 r1
  const acc: number[] = [0];
  for (let i = 1; i < path.length; i++) acc.push(acc[i - 1] + Math.hypot(path[i][0] - path[i - 1][0], path[i][1] - path[i - 1][1]));
  const total = acc[acc.length - 1] || 1;
  // 河口喇叭：最后约 1.5 格逐渐放宽（有三角洲时不放宽）
  const flareFrom = total - cell * 1.6;
  const main: RiverSample[] = path.map(([x, y], i) => {
    const t = acc[i] / total;
    let r = 0.5 + (r1 - 0.5) * Math.pow(t, 0.85);
    if (!delta && width >= 2 && acc[i] > flareFrom) r += ((acc[i] - flareFrom) / (total - flareFrom || 1)) * (width === 3 ? 2.2 : 1.3);
    return { x, y, r };
  });
  const branches: RiverSample[][] = [];
  if (delta && mouthSea) {
    // 三角洲：入海前约 5 格处分出两条汊流，呈扇形流向主河口两侧 3–4.5 格外的海；
    // 再从约 3 格处分出一条短的，扇面里多一道水
    const [ex, ey] = center(mouthSea);
    const fan: [number, number, number][] = [
      [Math.max(0, cells.length - 6), -1, 3 + hash2(1, 3, seed) * 1.5],
      [Math.max(0, cells.length - 6), 1, 3 + hash2(2, 3, seed) * 1.5],
      [Math.max(0, cells.length - 3), hash2(3, 3, seed) < 0.5 ? -1 : 1, 1.6],
    ];
    for (const [bi, side, spread] of fan) {
      const [bx, by] = pts[bi];
      const dx = ex - bx;
      const dy = ey - by;
      const len = Math.hypot(dx, dy) || 1;
      const nx = -dy / len;
      const ny = dx / len;
      const tgt = nearestSea(geo, (ex + nx * side * spread * cell) / cell - 0.5, (ey + ny * side * spread * cell) / cell - 0.5);
      if (!tgt) continue;
      const [tx, ty] = center(tgt);
      const mid: P2 = [(bx + tx) / 2 + nx * side * cell * 0.5, (by + ty) / 2 + ny * side * cell * 0.5];
      const bp = spline([[bx, by], mid, [tx, ty]]);
      branches.push(bp.map(([x, y], i) => ({ x, y, r: 0.55 + (i / Math.max(1, bp.length - 1)) * 0.45 })));
    }
  }
  return { main, branches, delta };
}

/**
 * 把一条河的笔画栅格化成像素：mask 中写 1（只写陆地像素），返回写到的像素下标。
 * 入海口外的海面（离岸 3 像素以内）返回在 mouthSea 里，画成浑浊的浅水。
 */
export function rasterStroke(stroke: RiverStroke, coast: CoastPx, mask: Uint8Array): { water: number[]; mouthSea: number[] } {
  const { PW, PH, land, outDist } = coast;
  const water: number[] = [];
  const mouthSea: number[] = [];
  const put = (s: RiverSample) => {
    if (s.r < 0.72) {
      const px = Math.floor(s.x);
      const py = Math.floor(s.y);
      if (px < 0 || py < 0 || px >= PW || py >= PH) return;
      const i = py * PW + px;
      if (land[i]) {
        if (!mask[i]) {
          mask[i] = 1;
          water.push(i);
        }
      } else if (outDist[i] <= 3) mouthSea.push(i);
      return;
    }
    const r2 = s.r * s.r + 0.2;
    const x0 = Math.floor(s.x - s.r - 0.5);
    const x1 = Math.ceil(s.x + s.r + 0.5);
    const y0 = Math.floor(s.y - s.r - 0.5);
    const y1 = Math.ceil(s.y + s.r + 0.5);
    for (let py = y0; py <= y1; py++) {
      if (py < 0 || py >= PH) continue;
      for (let px = x0; px <= x1; px++) {
        if (px < 0 || px >= PW) continue;
        const dx = px + 0.5 - s.x;
        const dy = py + 0.5 - s.y;
        if (dx * dx + dy * dy > r2) continue;
        const i = py * PW + px;
        if (land[i]) {
          if (!mask[i]) {
            mask[i] = 1;
            water.push(i);
          }
        } else if (outDist[i] <= 3) mouthSea.push(i);
      }
    }
  };
  for (const s of stroke.main) put(s);
  for (const b of stroke.branches) for (const s of b) put(s);
  return { water, mouthSea };
}
