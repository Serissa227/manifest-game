// 东西环绕（FRAMEWORK §5.2）的坐标工具：取模、最短差、跨缝的区间与矩形、跨缝的折线、相机的可见副本与点选取模。
// 不环绕的地图（经典世界）：这些函数退化为普通的差、裁剪与越界判断，行为与以前相同。
// 坐标单位由调用方决定（格或海图像素），W 是同一单位下一整张图的宽度。

/** 横坐标按宽度取模，结果在 [0, W)（W 不是正数时原样返回）。 */
export function modX(x: number, W: number): number {
  if (!(W > 0)) return x;
  const r = x % W;
  // +0 把 -0 变成 0
  return r < 0 ? r + W : r + 0;
}

/** 从 a 到 b 的横向差：环绕时取最短的一条，结果在 [-W/2, W/2)；不环绕时就是 b − a。 */
export function wrapDx(a: number, b: number, W: number, wrap: boolean): number {
  const d = b - a;
  if (!wrap || !(W > 0)) return d;
  return modX(d + W / 2, W) - W / 2;
}

/** 两点的距离（横向按 wrapDx）。 */
export function wrapDist(a: { x: number; y: number }, b: { x: number; y: number }, W: number, wrap: boolean): number {
  return Math.hypot(wrapDx(a.x, b.x, W, wrap), b.y - a.y);
}

/** 横向区间。 */
export interface Span {
  x: number;
  w: number;
}

/**
 * 区间 [x, x + w) 落在 [0, W) 里的部分：环绕时按宽度取模，跨缝拆成两段（宽于整张图时就是整张）；
 * 不环绕时裁到 [0, W)（完全在外时为空）。
 */
export function wrapSpans(x: number, w: number, W: number, wrap: boolean): Span[] {
  if (!(w > 0) || !(W > 0)) return [];
  if (!wrap) {
    const x0 = Math.max(0, x);
    const x1 = Math.min(W, x + w);
    return x1 > x0 ? [{ x: x0, w: x1 - x0 }] : [];
  }
  if (w >= W) return [{ x: 0, w: W }];
  const x0 = modX(x, W);
  if (x0 + w <= W) return [{ x: x0, w }];
  return [
    { x: x0, w: W - x0 },
    { x: 0, w: x0 + w - W },
  ];
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** 矩形落在 [0, W) × [0, H) 里的部分：横向按 wrapSpans 拆分（跨缝时两块），纵向裁剪。 */
export function wrapRects(r: Rect, W: number, H: number, wrap: boolean): Rect[] {
  const y0 = Math.max(0, r.y);
  const y1 = Math.min(H, r.y + r.h);
  if (y1 <= y0) return [];
  return wrapSpans(r.x, r.w, W, wrap).map((s) => ({ x: s.x, y: y0, w: s.w, h: y1 - y0 }));
}

type Pt = readonly [number, number];

/** 横向连续的折线：相邻两点的横向差取最短的一条（跨缝的航线不会横穿整张图）。不环绕时原样复制。 */
export function unwrapPath(pts: readonly Pt[], W: number, wrap: boolean): [number, number][] {
  const out: [number, number][] = [];
  let prev: number | null = null;
  for (const [x, y] of pts) {
    const ux: number = prev === null || !wrap ? x : prev + wrapDx(prev, x, W, true);
    out.push([ux, y]);
    prev = ux;
  }
  return out;
}

/**
 * 折线在 [0, W) 里的各段：先展开成横向连续，再在越过接缝处断开（断点插值到接缝上），各段平移回 [0, W)。
 * 不环绕时只有一段（原样）。用于在不能无限平移的画面（地点列表的小图、导出的整张图）上分段画跨缝的航线。
 */
export function seamSegments(pts: readonly Pt[], W: number, wrap: boolean): [number, number][][] {
  if (pts.length === 0) return [];
  if (!wrap || !(W > 0)) return [pts.map(([x, y]) => [x, y] as [number, number])];
  const u = unwrapPath(pts, W, true);
  const segs: [number, number][][] = [];
  const band = (x: number) => Math.floor(x / W);
  let k = band(u[0][0]);
  let cur: [number, number][] = [[u[0][0] - k * W, u[0][1]]];
  for (let i = 1; i < u.length; i++) {
    const [ax, ay] = u[i - 1];
    const [bx, by] = u[i];
    const kb = band(bx);
    // 一步可能跨过不止一条接缝（极端情况），逐条处理；断点落在接缝上（这一段的 W 或 0，下一段的 0 或 W）
    while (k !== kb) {
      const dir = kb > k ? 1 : -1;
      const edge = (dir > 0 ? k + 1 : k) * W;
      const t = (edge - ax) / (bx - ax);
      const ey = ay + (by - ay) * t;
      cur.push([edge - k * W, ey]);
      segs.push(cur);
      k += dir;
      cur = [[edge - k * W, ey]];
    }
    cur.push([bx - k * W, by]);
  }
  segs.push(cur);
  return segs;
}

/**
 * 视野 [left, right)（海图坐标）里看得见的副本：返回偏移量 k·MW 的列表。不环绕时只有 0。
 * 环绕地图的海图与迷雾在这些偏移上各画一份（接缝两侧多画一屏）。
 */
export function visibleCopies(left: number, right: number, MW: number, wrap: boolean): number[] {
  if (!wrap || !(MW > 0)) return [0];
  const k0 = Math.floor(left / MW);
  const k1 = Math.floor((right - 1e-9) / MW);
  const out: number[] = [];
  for (let k = k0; k <= k1; k++) out.push(k * MW);
  return out;
}

/** 离 ref 最近的副本位置：x + k·MW 中离 ref 最近的一个（摆放标记与地名用）。不环绕时就是 x。 */
export function nearestCopy(x: number, ref: number, MW: number, wrap: boolean): number {
  if (!wrap || !(MW > 0)) return x;
  return ref + wrapDx(ref, x, MW, true);
}

/**
 * 相机的横向位置（海图左上角在画布上的 x，屏幕像素）按一整张图在屏幕上的宽度取模，结果在 (−mapW, 0]：
 * 无限平移时数值不会越来越大，画面不变（海图每隔 mapW 重复一次）。
 */
export function wrapCamX(camX: number, mapW: number): number {
  if (!(mapW > 0)) return camX;
  const r = modX(camX, mapW);
  return r === 0 ? 0 : r - mapW;
}

/**
 * 海图坐标（像素）→ 格：环绕时横向取模；不环绕时越界返回 null。
 */
export function pickCell(wx: number, wy: number, cellPx: number, W: number, H: number, wrap: boolean): { x: number; y: number } | null {
  if (!(cellPx > 0)) return null;
  let x = Math.floor(wx / cellPx);
  const y = Math.floor(wy / cellPx);
  if (y < 0 || y >= H) return null;
  if (wrap) x = modX(x, W);
  else if (x < 0 || x >= W) return null;
  return { x, y };
}
