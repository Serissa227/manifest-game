// 航海图镜头的纯计算（网页自适应：双指缩放、缩放按钮与滚轮共用）。
// 镜头 cam：s 为放大倍数，(x, y) 为海图左上角在画布上的位置（CSS 像素）；海图坐标 (wx, wy) 显示在 (x + wx·s, y + wy·s)。

export interface Cam {
  s: number;
  x: number;
  y: number;
}

/** 缩放到 next 倍，并让画布上 (px, py) 这一点下面的海图位置不动。 */
export function zoomAt(cam: Cam, next: number, px: number, py: number): Cam {
  if (!(next > 0) || !Number.isFinite(next)) return { ...cam };
  return {
    s: next,
    x: px - ((px - cam.x) * next) / cam.s,
    y: py - ((py - cam.y) * next) / cam.s,
  };
}

/** 双指缩放：按两指距离的比例连续缩放（d0 是按下时的距离），夹在 [min, max]。 */
export function pinchScale(s0: number, d0: number, d: number, min: number, max: number): number {
  if (!(d0 > 0) || !(d > 0)) return s0;
  return Math.max(min, Math.min(max, (s0 * d) / d0));
}

/** 离 s 最近的档位的下标（按倍数的比例、也就是对数距离比较：1.5 倍到 2 倍与 2 倍到 2.67 倍一样远）。 */
export function nearestLevel(s: number, levels: readonly number[]): number {
  let best = 0;
  let bestD = Infinity;
  levels.forEach((lv, i) => {
    const d = Math.abs(Math.log(lv / s));
    if (d < bestD) {
      best = i;
      bestD = d;
    }
  });
  return best;
}

/** 松手时对齐到最近的档位（除“看全图”外都是整数或半整数倍，像素不走样）。 */
export function snapScale(s: number, levels: readonly number[]): number {
  return levels.length === 0 ? s : levels[nearestLevel(s, levels)];
}

/** 按钮或滚轮：从最近的档位往上（dir = 1）或往下（-1）跳一档，到头了停在两端。 */
export function stepScale(s: number, levels: readonly number[], dir: 1 | -1): number {
  if (levels.length === 0) return s;
  const i = nearestLevel(s, levels);
  return levels[Math.max(0, Math.min(levels.length - 1, i + dir))];
}

/**
 * 大地图上“标记”（地点、舰队、选中框、发现物）在屏幕上的倍数：每个美术像素占几个 CSS 像素。
 * 与镜头倍数分开算——海图放大时标记只长一半，港口密的地方不再糊成一团：
 * 看全图（s ≤ 1）时标记跟着海图一起缩小；1–2 倍之间保持原尺寸；2 倍以上取镜头倍数的一半
 * （缺省的 3 倍镜头下是 1.5 倍，约为改动前 2 倍镜头下的四分之三）。
 */
export function markerScale(s: number): number {
  if (!(s > 0) || !Number.isFinite(s)) return 1;
  return s <= 1 ? s : Math.max(1, s / 2);
}

/**
 * 带细图层的大地图（寰宇，M01“细海图”）上标记的倍数：世界图的近档用细节瓦片（每格 24 个美术像素），
 * 镜头倍数 6 / 12 / 18 就是美术像素的 1× / 2× / 3×——标记的像素倍率与地形一致（不会一个糊一个清）：
 * 缺省的 12 倍镜头（一格 48 屏幕像素）下都是 2 倍，港口标记的图样 34 × 36 像素、约四分之三格（连描边 38 × 40）。
 * 远档（镜头不到 6 倍，一格不到 24 像素）标记保持原尺寸，看全图（不到 1 倍）时跟着海图缩小。
 */
export function detailMarkerScale(s: number): number {
  if (!(s > 0) || !Number.isFinite(s)) return 1;
  return s <= 1 ? s : s < 6 ? 1 : s / 6;
}

/** 屏幕上的一个矩形（CSS 像素）。 */
export interface Box {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/** 两个矩形是否相交（贴边不算）。 */
export function boxesOverlap(a: Box, b: Box): boolean {
  return a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;
}

/**
 * 地名避让：按给定的先后（越靠前越要紧）贪心摆放，后来的与已经摆下的相交就不显示。
 * forced 的（悬停、选中、目的地、自己舰队停泊的地点）一定显示，并且先占位。返回要显示的下标集合。
 */
export function declutter(boxes: readonly (Box | null)[], order: readonly number[], forced: ReadonlySet<number>): Set<number> {
  const shown = new Set<number>();
  const placed: Box[] = [];
  for (const i of order) {
    const b = boxes[i];
    if (b && forced.has(i)) {
      shown.add(i);
      placed.push(b);
    }
  }
  for (const i of order) {
    const b = boxes[i];
    if (!b || shown.has(i)) continue;
    if (placed.some((p) => boxesOverlap(p, b))) continue;
    shown.add(i);
    placed.push(b);
  }
  return shown;
}

/** 两个触点之间的距离与中点。 */
export function pinchOf(a: { x: number; y: number }, b: { x: number; y: number }): { d: number; cx: number; cy: number } {
  return { d: Math.hypot(a.x - b.x, a.y - b.y), cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2 };
}
