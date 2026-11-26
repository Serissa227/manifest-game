// 东西相连的海图（FRAMEWORK §5.2）：左右各补 margin 列（取自对侧），整张画完再裁掉补上的部分。
// 这样接缝两侧的海岸、距离场、河流、道路与人文景观都是连续的（只有逐像素的纹理噪声在接缝处不连续，几乎看不出来）。
// 画法本身（terrain.ts 等）不需要知道环绕。
import { Px } from "../px";
import { NEW_WORLD_X, type ChartInput, type ChartLandmark, type ChartPlace, type ChartRiver, type ChartRoad } from "./types";

/** 环绕地图左右各补的列数（格）：大于海岸平滑、植被扭曲、人文景观与道路的影响范围。 */
export const WRAP_MARGIN = 16;

/** 一行的左右各补 m 个字符（取自对侧）；行比地图窄时先补成深海。 */
function padRow(row: string, W: number, m: number, fill: string): string {
  const r = row.length >= W ? row.slice(0, W) : row + fill.repeat(W - row.length);
  return r.slice(W - m) + r + r.slice(0, m);
}

function padRows(rows: readonly string[] | undefined, W: number, H: number, m: number, fill: string): string[] | undefined {
  if (!rows) return undefined;
  const out: string[] = [];
  for (let y = 0; y < H; y++) out.push(padRow(rows[y] ?? "", W, m, fill));
  return out;
}

/** 补边后的横坐标：原坐标 +m，靠近两边的再在对侧补一份（返回所有副本的偏移量）。 */
function copiesOf(xs: readonly number[], W: number, m: number): number[] {
  const offs = [m];
  if (xs.some((x) => x >= W - m)) offs.push(m - W);
  if (xs.some((x) => x < m)) offs.push(m + W);
  return offs;
}

/** 横向连续的折线：相邻两点的差按最短的一条（跨缝的道路、河流不会横穿整张图）。 */
function unwrapXs(pts: readonly (readonly [number, number])[], W: number): [number, number][] {
  const out: [number, number][] = [];
  let prev: number | null = null;
  for (const [x, y] of pts) {
    let ux = x;
    if (prev !== null) {
      while (ux - prev > W / 2) ux -= W;
      while (ux - prev < -W / 2) ux += W;
    }
    out.push([ux, y]);
    prev = ux;
  }
  return out;
}

/**
 * 补边后的海图输入：宽 W + 2m、不再环绕（补出的部分与对侧一样），地点、道路、河流与地标平移 m 列，
 * 靠近两边的再在对侧补一份。投影的西缘相应左移 m 列。原地点排在前面（首都等“第一个”的判断不受副本影响）。
 */
export function padWrapInput(input: ChartInput, m = WRAP_MARGIN): ChartInput {
  const W = Math.max(1, input.width);
  const H = Math.max(1, input.height);
  const places: ChartPlace[] = [];
  const extra: ChartPlace[] = [];
  for (const p of input.places ?? []) {
    places.push({ ...p, x: p.x + m });
    if (p.x >= W - m) extra.push({ ...p, x: p.x + m - W });
    if (p.x < m) extra.push({ ...p, x: p.x + m + W });
  }
  const roads: ChartRoad[] = [];
  for (const r of input.roads ?? []) {
    const [a, b] = unwrapXs([r.from, r.to], W);
    for (const off of copiesOf([a[0], b[0]], W, m)) roads.push({ from: [a[0] + off, a[1]], to: [b[0] + off, b[1]] });
  }
  const rivers: ChartRiver[] = [];
  for (const r of input.rivers ?? []) {
    const path = unwrapXs(r.path, W);
    for (const off of copiesOf(
      path.map(([x]) => x),
      W,
      m,
    ))
      rivers.push({ ...r, path: path.map(([x, y]) => [x + off, y] as const) });
  }
  const landmarks: ChartLandmark[] = [];
  for (const l of input.landmarks ?? []) {
    for (const off of copiesOf([l.x, l.x + (l.w ?? 1) - 1], W, m)) landmarks.push({ ...l, x: l.x + off });
  }
  const p = input.projection;
  return {
    ...input,
    width: W + 2 * m,
    height: H,
    rows: padRows(input.rows, W, H, m, "~") ?? [],
    relief: padRows(input.relief, W, H, m, "."),
    biomes: padRows(input.biomes, W, H, m, "."),
    places: [...places, ...extra],
    roads,
    rivers,
    landmarks,
    projection: p ? { ...p, west: p.west - m * p.arcmin_per_cell } : p,
    // 没有投影时“新大陆”按列判断：起始列随补边右移
    newWorldX: p ? input.newWorldX : (input.newWorldX ?? NEW_WORLD_X) + m,
    wrapX: false,
    // 细图层不动，记下补边后的第 0 列对应它的哪一列（没有细图层的地图不带这个字段）
    ...(input.fine ? { fineOffsetX: (input.fineOffsetX ?? 0) - m } : {}),
  };
}

/** 从 src 裁出 [x, x + w) 列（整高），按行整段复制。 */
export function cropColumns(src: Px, x: number, w: number): Px {
  const out = new Px(w, src.h);
  for (let y = 0; y < src.h; y++) out.data.set(src.data.subarray(y * src.w + x, y * src.w + x + w), y * w);
  return out;
}
