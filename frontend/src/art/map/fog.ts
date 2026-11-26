// 迷雾：未探索的格子盖上羊皮纸云团，边缘用有序抖动过渡。
// FogPainter 保存上一次的探索状态与画好的迷雾图，探索进度变化时只重画变化的格子附近，
// 渲染器据此只更新纹理的一小块（大地图上航行时每天都会揭开新的格子）。
// 第九批：东西相连的地图（wrap）上，云团毯横向首尾相接、距离场按环绕计算，接缝两侧的迷雾连续；不环绕时与以前逐像素相同。
// 性能商议（2026-10-07）：fog_delta 的区间直接交给画家（reveal）——按变化的格聚成几块，每块带羽化边距只在局部窗口里
// 算距离场、重画，远隔的两支舰队不再合成一个大包围盒；结果与整张重画逐像素相同（有单元测试）。整张替换（replace）是全量重同步。
// 内存（性能商议第 5 条的后续，2026-10-07）：大地图（1080 × 396）每格 4 像素的整张迷雾图、云团毯与边缘噪声的格点表
// 合计约 75 MiB，手机上光是这张图的基础缓冲就超过 120 MB 的总预算。现在：
// - 迷雾图按世界图的分辨率存（scale = 2 时每格 2 像素：每格 4 像素画好一块就当场 2×2 取平均写进去，与以前“整张每格 4 像素
//   画好、交出时再缩小”逐像素相同）；
// - 云团毯按 128 像素见方的块放在按字节计的 LRU 里（上限 CLOUD_CACHE_BYTES），块里只生成要重画的那部分（舰队往前走时
//   补上新露出的一条）；任意矩形生成的云团毯与整张一次画出逐像素相同（每朵云按整张时的次序画，只写落在矩形里的像素）；
// - 边缘噪声按要重画的矩形现算局部的格点、用到才算（noise.ts 的 fbmWindow），取值与整张的格点表逐位相同；
// - 逐格先看 3 × 3 的距离：整格揭开、整格云团的直接写，只有迷雾边缘的格逐像素插值、抖动（结果与逐像素判断相同）。
// 经典世界、寰宇大地图的迷雾与改动前逐像素相同（map/fogMemory.test.ts 有改动前算出的指纹）；每天的增量与整张重画都比以前快。
import { P } from "../palette";
import { Px, rgba, type Rgba } from "../px";
import { FbmScratch, bayer, chamfer, fbm, fbmWindow, hash2, type Field } from "./noise";
import { CHART_CELL } from "./types";

const C = CHART_CELL;
const R = (c: string): Rgba => rgba(c);

/** 云团毯的块（像素见方）：32 格，与迷雾聚块的 CLUSTER 对齐。 */
export const CLOUD_BLOCK = 128;
/** 云团毯块缓存的上限（字节，所有尺寸合计）：每块 64 KiB，约 32 块——每天的揭雾只碰到舰队附近的几块。 */
export const CLOUD_CACHE_BYTES = 2 * 1024 * 1024;

/** 云团毯（这种尺寸）的键：块缓存按它分组。 */
function cloudKey(pw: number, ph: number, wrap: boolean): string {
  return `fogcloud:${pw}x${ph}${wrap ? ":wrap" : ""}`;
}

/** 这种尺寸（格）的迷雾的云团毯的键（内存账本、释放用）。 */
export function fogCloudKey(width: number, height: number, wrap: boolean): string {
  return cloudKey(Math.max(1, width) * C, Math.max(1, height) * C, wrap);
}

/** 云团毯的颜色（第一次用到时解析）。 */
let cloudColors: { white: Rgba; paper: Rgba; shade: Rgba; rim: Rgba; line: Rgba } | null = null;
const colors = () =>
  (cloudColors ??= { white: R(P.white), paper: R(P.paper), shade: R(P.parchment), rim: R(P.parchmentDark), line: R(P.parchmentDeep) });

/** 积云的网格间距（像素）。 */
const SX = 30;
const SY = 14;
/** 一朵云的局部遮罩每行的长度（64 列、左右各留一列 0）；行数 35（32 行、上一行与下两行的 0）。 */
const MASK_W = 66;
/** 一朵云的圆（最多 4 个，每个是圆心 x、圆心 y、半径；逐朵重复使用）。 */
const CIRCLES = new Int32Array(12);
/** 一朵云的局部遮罩（逐朵只清要用的行；四周那一圈从不写入，始终是 0）。 */
const MASK = new Uint8Array(MASK_W * 35);

/** 区间 [a, b] 与 [x0, x1] 是否相交（环绕时 [a, b] 按宽度 pw 取模）。 */
function spanHits(a: number, b: number, x0: number, x1: number, pw: number, wrap: boolean): boolean {
  if (!wrap) return b >= x0 && a <= x1;
  if (b - a + 1 >= pw) return true;
  const a2 = ((a % pw) + pw) % pw;
  const b2 = a2 + (b - a);
  return (b2 >= x0 && a2 <= x1) || b2 - pw >= x0;
}

/**
 * 迷雾的“云团毯”的一块：整张羊皮纸上的一堆堆积云（与海图同尺寸 pw × ph），只取像素 [x0, x0 + w) × [y0, y0 + h)。
 * wrap：横向首尾相接（每朵云只按它在一圈里的位置取随机数，越过右边的部分画回左边）。
 * 与一次画整张逐像素相同：底纹按坐标算；云按整张时的次序（gy 由上到下、gx 由左到右）逐朵画、后画的盖住先画的，
 * 只写落在块里的像素——每个像素的最终值只取决于写到它的那几朵云的先后，跳过与块不相交的云、块外的像素都不改变块内的结果。
 * 给了 into 时写进它（第 y 行从 offset + y·stride 起），否则新建一份 w × h 的。
 */
export function cloudBlock(
  pw: number,
  ph: number,
  wrap: boolean,
  x0: number,
  y0: number,
  w: number,
  h: number,
  into?: Uint32Array,
  stride = w,
  offset = 0,
): Uint32Array {
  const d = into ?? new Uint32Array(Math.max(0, w * h));
  if (w <= 0 || h <= 0) return d;
  const { white, paper, shade, rim, line } = colors();
  const x1 = x0 + w - 1;
  const y1 = y0 + h - 1;
  // 底色：羊皮纸，带一层稀疏的斜线（像版画里的阴影线）：(x + y) % 6 === 0 且 x 为偶数处描深（逐行递推，不逐点取模）
  for (let y = 0; y < h; y++) {
    const wy = y0 + y;
    let k = (x0 + wy) % 6;
    let odd = x0 & 1;
    const row = offset + y * stride;
    for (let x = 0; x < w; x++) {
      d[row + x] = k === 0 && odd === 0 ? rim : shade;
      k = k === 5 ? 0 : k + 1;
      odd ^= 1;
    }
  }
  // 一朵积云 = 中间一个大圆、两侧较小的圆、平底；自上而下叠放，后画的盖住先画的。
  // 云有大中小几种，位置在网格里大幅抖动，疏密按低频噪声变化（不再是砖墙式的规则平铺）
  const mask = MASK;
  // 疏密：fbm(x / 90, y / 90)（与以前预先算格点的 fbmField(pw + 64, ph + 64, 90, 219) 逐位相同；每朵云只取一个点）
  const dense = (x: number, y: number) => fbm(x / 90, y / 90, 219);
  // 环绕：一圈的列数（宽度是 30 的整数倍时首尾正好接上）；每朵云只画一次，越界的像素按宽度取模
  const cols = Math.max(1, Math.round(pw / SX));
  for (let gy = -1; gy * SY < ph + 20; gy++) {
    // 这一行的云画到的纵向范围：cy ∈ [gy·SY − 5, gy·SY + 4]，像素 cy − 21 … cy + 12
    if (gy * SY + 16 < y0 || gy * SY - 26 > y1) continue;
    const shift = gy & 1 ? SX / 2 : 0;
    for (let gx = wrap ? 0 : -1; wrap ? gx < cols : gx * SX < pw + 30; gx++) {
      // 横向范围：cx ∈ [gx·SX + shift − 12, … + 11]，像素 cx − 33 … cx + 32（先粗筛，再按真实的 cx 判断）
      if (!spanHits(gx * SX + shift - 45, gx * SX + shift + 43, x0, x1, pw, wrap)) continue;
      const cx = gx * SX + shift + Math.floor(hash2(gx, gy, 201) * 24) - 12;
      if (!spanHits(cx - 33, cx + 32, x0, x1, pw, wrap)) continue;
      const cy = gy * SY + Math.floor(hash2(gx, gy, 202) * 10) - 5;
      if (cy + 12 < y0 || cy - 21 > y1) continue;
      const dn = dense(Math.max(0, cx + 32), Math.max(0, cy + 32));
      // 稀的地方跳过一些云，露出羊皮纸的阴影线
      if (dn < 0.42 && hash2(gx, gy, 208) < 0.55) continue;
      const v = Math.floor(hash2(gx, gy, 209) * 4);
      // 大中小四种：5、7、9、11
      const base = 5 + 2 * v + (dn > 0.58 ? 1 : 0);
      const r0 = base + Math.floor(hash2(gx, gy, 203) * 2);
      const r1 = Math.max(3, Math.round(r0 * 0.6) + Math.floor(hash2(gx, gy, 204) * 3) - 1);
      const r2 = Math.max(3, Math.round(r0 * 0.6) + Math.floor(hash2(gx, gy, 205) * 3) - 1);
      // 圆（圆心 x、圆心 y、半径）：中间的大圆、左右两个小圆，一半的云右上方再叠一个
      const circles = CIRCLES;
      circles[0] = cx;
      circles[1] = cy;
      circles[2] = r0;
      circles[3] = cx - r0 - r1 + 4;
      circles[4] = cy + r0 - r1;
      circles[5] = r1;
      circles[6] = cx + r0 + r2 - 4;
      circles[7] = cy + r0 - r2;
      circles[8] = r2;
      let nc = 3;
      if (hash2(gx, gy, 206) < 0.5) {
        circles[9] = cx + r0 - 1;
        circles[10] = cy - 3;
        circles[11] = Math.max(4, r0 - 4);
        nc = 4;
      }
      const bottom = cy + r0 - 1;
      // 局部遮罩（64×32，原点在 cx-32, cy-20）：格 (x, y) 在平底以上、且在某个圆里（dx² + dy² ≤ r² + r）时记下第一个包含它的圆
      // （下标 + 1）。按圆逐行填整数区间（|dx| ≤ ⌊√(r² + r − dy²)⌋，与逐点判断同一个集合）；只算块里要画的行与上下各一行
      // （描边要看上下邻居）。遮罩四周各留一圈 0（下标 (y + 1)·MASK_W + x + 1），取邻居不必判断越界。
      const ox = cx - 32;
      const oy = cy - 20;
      const ya = Math.max(-1, y0 - oy);
      const yb = Math.min(32, y1 - oy);
      const ma = Math.max(0, ya - 1);
      const mb = Math.min(31, yb + 1);
      mask.fill(0, (ma + 1) * MASK_W, (mb + 2) * MASK_W);
      // 遮罩的包围盒（只有它外扩一格之内的像素可能被写到：云里、或左右上方挨着云）
      let mx0 = 64;
      let mx1 = -1;
      let my0 = 32;
      let my1 = -1;
      for (let ci = 0; ci < nc; ci++) {
        const ccx = circles[ci * 3];
        const ccy = circles[ci * 3 + 1];
        const r = circles[ci * 3 + 2];
        const rr = r * r + r;
        for (let y = ma; y <= mb; y++) {
          const wy = oy + y;
          if (wy > bottom) break;
          const dy = wy - ccy;
          const rem = rr - dy * dy;
          if (rem < 0) continue;
          let m = Math.floor(Math.sqrt(rem));
          while (m * m > rem) m--;
          while ((m + 1) * (m + 1) <= rem) m++;
          const xa = Math.max(0, ccx - m - ox);
          const xb = Math.min(63, ccx + m - ox);
          if (xa > xb) continue;
          const row = (y + 1) * MASK_W + 1;
          for (let x = xa; x <= xb; x++) if (mask[row + x] === 0) mask[row + x] = ci + 1;
          if (xa < mx0) mx0 = xa;
          if (xb > mx1) mx1 = xb;
          if (y < my0) my0 = y;
          if (y > my1) my1 = y;
        }
      }
      const yLo = Math.max(ya, my0);
      const yHi = Math.min(yb, my1 + 1);
      // 横向：这朵云的窗口不跨接缝时（不环绕的图总是如此）直接裁到块里，不必逐点取模
      const straight = !wrap || (ox + mx0 - 1 >= 0 && ox + mx1 + 1 < pw);
      const xLo = straight ? Math.max(mx0 - 1, x0 - ox) : mx0 - 1;
      const xHi = straight ? Math.min(mx1 + 1, x1 - ox) : mx1 + 1;
      for (let y = yLo; y <= yHi; y++) {
        const wy = oy + y;
        const rowM = (y + 1) * MASK_W + 1;
        const rowD = offset + (wy - y0) * stride - x0;
        for (let x = xLo; x <= xHi; x++) {
          let wx = ox + x;
          if (!straight) {
            wx = ((wx % pw) + pw) % pw;
            if (wx < x0 || wx > x1) continue;
          }
          const i = rowD + wx;
          const m = mask[rowM + x];
          if (m === 0) {
            // 描边：云的外缘（底边更深）
            const up = mask[rowM - MASK_W + x];
            if (mask[rowM + x - 1] || mask[rowM + x + 1] || up) d[i] = rim;
            if (up && !mask[rowM + MASK_W + x]) d[i] = line;
            continue;
          }
          // 受光：第一个包含它的圆的左上部分更白；底部两行是阴影。
          // （与以前相同，按取模后的坐标判断：越过接缝画回来的那部分不在任何圆里，不受光。）
          let c = paper;
          if (wx === ox + x) {
            const k = (m - 1) * 3;
            const r = circles[k + 2];
            const nx = (wx - circles[k]) / r;
            const ny = (wy - circles[k + 1]) / r;
            if (nx + ny < -0.75 && nx * nx + ny * ny > 0.2) c = white;
          } else {
            for (let ci = 0; ci < nc; ci++) {
              const r = circles[ci * 3 + 2];
              const dx = wx - circles[ci * 3];
              const dy = wy - circles[ci * 3 + 1];
              if (dx * dx + dy * dy <= r * r + r) {
                const nx = dx / r;
                const ny = dy / r;
                if (nx + ny < -0.75 && nx * nx + ny * ny > 0.2) c = white;
                break;
              }
            }
          }
          if (wy >= bottom - 1) c = shade;
          else if (wy === bottom - 2 && (wx & 1) === 0) c = shade;
          d[i] = c;
        }
      }
      // 大圆里的一道卷曲线
      if (hash2(gx, gy, 207) < 0.6) {
        for (let a = 0; a < 7; a++) {
          const t = 0.6 + a * 0.28;
          let wx = Math.round(cx + Math.cos(t) * (r0 - 4));
          const wy = Math.round(cy + Math.sin(t) * (r0 - 5));
          if (wrap) wx = ((wx % pw) + pw) % pw;
          if (wx >= x0 && wy >= y0 && wx <= x1 && wy <= y1 && wy < bottom - 1) d[offset + (wy - y0) * stride + (wx - x0)] = rim;
        }
      }
    }
  }
  return d;
}

/**
 * 块缓存里的一块：整块大小的像素（第一次用到时分配），以及其中已经生成的矩形（块内像素坐标、含两端；还没生成时 gx1 < 0）。
 * 只生成用到的部分：每天的揭雾只碰到块里舰队附近的一角，舰队往前走时只补上新露出来的一条（同一个像素生成几次都一样）。
 */
interface CloudEntry {
  px: Uint32Array;
  bw: number;
  gx0: number;
  gy0: number;
  gx1: number;
  gy1: number;
}

/** 云团毯块的 LRU（所有尺寸共用一个上限）：键为 `${云团毯的键}#${块号}`，Map 的次序即新旧（最后的最新）。 */
const cloudCache = new Map<string, CloudEntry>();
let cloudCacheBytes = 0;

/**
 * 云团毯（尺寸 pw × ph）的第 (bx, by) 块（块按 CLOUD_BLOCK 像素见方，最后一块可以不满），保证其中
 * [xs, xe) × [ys, ye)（整张图的像素坐标）已经生成。返回整块的像素（行宽为块宽）。
 * 已经生成的矩形不包含它时，把两者的包围盒减去已经生成的部分（上下左右至多四条）补上，再把包围盒记为已生成。
 */
export function cloudFor(pw: number, ph: number, wrap: boolean, bx: number, by: number, xs: number, ys: number, xe: number, ye: number): Uint32Array {
  const key = `${cloudKey(pw, ph, wrap)}#${bx},${by}`;
  const bx0 = bx * CLOUD_BLOCK;
  const by0 = by * CLOUD_BLOCK;
  let e = cloudCache.get(key);
  if (e) {
    cloudCache.delete(key);
    cloudCache.set(key, e);
  } else {
    const bw = Math.min(CLOUD_BLOCK, pw - bx0);
    const bh = Math.min(CLOUD_BLOCK, ph - by0);
    e = { px: new Uint32Array(bw * bh), bw, gx0: 0, gy0: 0, gx1: -1, gy1: -1 };
    cloudCache.set(key, e);
    cloudCacheBytes += e.px.byteLength;
    // 超过上限：从最久没用的开始淘汰（至少留刚放进去的）
    for (const [k, v] of cloudCache) {
      if (cloudCacheBytes <= CLOUD_CACHE_BYTES || cloudCache.size <= 1) break;
      if (k === key) continue;
      cloudCache.delete(k);
      cloudCacheBytes -= v.px.byteLength;
    }
  }
  const ent = e;
  const rx0 = xs - bx0;
  const ry0 = ys - by0;
  const rx1 = xe - 1 - bx0;
  const ry1 = ye - 1 - by0;
  const fill = (x0: number, y0: number, x1: number, y1: number) => {
    if (x1 >= x0 && y1 >= y0) cloudBlock(pw, ph, wrap, bx0 + x0, by0 + y0, x1 - x0 + 1, y1 - y0 + 1, ent.px, ent.bw, y0 * ent.bw + x0);
  };
  if (ent.gx1 < 0) {
    // 第一次：只生成要的这一片
    fill(rx0, ry0, rx1, ry1);
    ent.gx0 = rx0;
    ent.gy0 = ry0;
    ent.gx1 = rx1;
    ent.gy1 = ry1;
  } else if (rx0 < ent.gx0 || ry0 < ent.gy0 || rx1 > ent.gx1 || ry1 > ent.gy1) {
    // 包围盒减去已生成的矩形：上、下两条（整个包围盒的宽），左、右两条（已生成矩形的高）
    const nx0 = Math.min(ent.gx0, rx0);
    const ny0 = Math.min(ent.gy0, ry0);
    const nx1 = Math.max(ent.gx1, rx1);
    const ny1 = Math.max(ent.gy1, ry1);
    fill(nx0, ny0, nx1, ent.gy0 - 1);
    fill(nx0, ent.gy1 + 1, nx1, ny1);
    fill(nx0, ent.gy0, ent.gx0 - 1, ent.gy1);
    fill(ent.gx1 + 1, ent.gy0, nx1, ent.gy1);
    ent.gx0 = nx0;
    ent.gy0 = ny0;
    ent.gx1 = nx1;
    ent.gy1 = ny1;
  }
  return ent.px;
}

/** 这种尺寸（格）的云团毯在块缓存里的字节（内存账本用）。 */
export function fogCloudBytes(width: number, height: number, wrap: boolean): number {
  const prefix = `${fogCloudKey(width, height, wrap)}#`;
  let n = 0;
  for (const [k, v] of cloudCache) if (k.startsWith(prefix)) n += v.px.byteLength;
  return n;
}

/** 这种尺寸（格）的云团毯最多占多少字节：块缓存的上限与整张取小（基础缓冲的估计用）。 */
export function fogCloudBudget(width: number, height: number): number {
  return Math.min(CLOUD_CACHE_BYTES, Math.max(1, width) * C * Math.max(1, height) * C * 4);
}

/** 迷雾边缘噪声的尺度（像素）与种子。 */
const FOG_NOISE_SCALE = 7;
const FOG_NOISE_SEED = 211;

/**
 * 释放这种尺寸的迷雾共用的大对象：云团毯的块缓存（离开世界时调用）。返回释放的字节数。
 * 边缘噪声不再常驻（每次重画按块现算局部的格点），这里没有要释放的。
 */
export function releaseFogCaches(width: number, height: number, wrap: boolean): number {
  const prefix = `${fogCloudKey(width, height, wrap)}#`;
  let freed = 0;
  for (const [k, v] of [...cloudCache]) {
    if (!k.startsWith(prefix)) continue;
    cloudCache.delete(k);
    cloudCacheBytes -= v.px.byteLength;
    freed += v.px.byteLength;
  }
  return freed;
}

/** 像素矩形。 */
export interface PxRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * 格子变化能影响到的范围（格）：迷雾边缘只取决于离已揭开格子 2.1 格以内的距离，
 * 双线性采样再扩 1 格，留 1 格余量。
 */
const FOG_REACH = 5;

/**
 * 局部重画时距离场窗口比重画的矩形多出的格数。要用到的距离不超过 2.1 + √2（双线性采样的四格彼此相邻，距离场相邻格之差
 * 不超过 √2；更远的四格必定都是整块云团），这些格的最短路径与路径上各格的最近源都在矩形外 7 格以内，取 10 格：
 * 窗口里算出的距离与整张算的逐位相同（浮点的舍入顺序也相同）。
 */
const LOCAL_MARGIN = 10;
/** 聚块的格子边长：变化的格按这样的方块归组，再合并相交的矩形。 */
const CLUSTER = 32;

/**
 * 距离场（格到最近的已揭开格的距离）与格 (x, y) 在里面的下标：d[row(y) + col(x)]。下标与采样相同：纵向夹到图内；
 * 横向不环绕时夹到图内，环绕时可以越过接缝一格。
 */
interface DistGrid {
  d: Float32Array;
  row: (y: number) => number;
  col: (x: number) => number;
}

/** 格矩形（含两端）。 */
export interface CellRect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/**
 * 变化的格 → 要重画的格矩形（已外扩 reach、裁到图内；环绕时跨接缝的拆成两块）。按 CLUSTER 见方的格子分组，
 * 相交的矩形合并：同一处的揭雾合成一块，远隔的几处各是各的。
 */
export function fogDirtyRects(xs: ArrayLike<number>, ys: ArrayLike<number>, n: number, W: number, H: number, wrap: boolean, reach = FOG_REACH): CellRect[] {
  const blocks = new Map<number, CellRect>();
  const bw = Math.ceil(W / CLUSTER);
  for (let i = 0; i < n; i++) {
    const x = xs[i];
    const y = ys[i];
    const k = Math.floor(y / CLUSTER) * bw + Math.floor(x / CLUSTER);
    const b = blocks.get(k);
    if (!b) blocks.set(k, { x0: x, y0: y, x1: x, y1: y });
    else {
      if (x < b.x0) b.x0 = x;
      if (x > b.x1) b.x1 = x;
      if (y < b.y0) b.y0 = y;
      if (y > b.y1) b.y1 = y;
    }
  }
  let rects: CellRect[] = [];
  for (const b of blocks.values()) {
    const y0 = Math.max(0, b.y0 - reach);
    const y1 = Math.min(H - 1, b.y1 + reach);
    let x0 = b.x0 - reach;
    let x1 = b.x1 + reach;
    if (!wrap) {
      rects.push({ x0: Math.max(0, x0), y0, x1: Math.min(W - 1, x1), y1 });
    } else if (x1 - x0 + 1 >= W) {
      rects.push({ x0: 0, y0, x1: W - 1, y1 });
    } else {
      // 环绕：越过接缝的部分画到对侧
      if (x0 < 0) {
        rects.push({ x0: x0 + W, y0, x1: W - 1, y1 });
        x0 = 0;
      }
      if (x1 > W - 1) {
        rects.push({ x0: 0, y0, x1: x1 - W, y1 });
        x1 = W - 1;
      }
      rects.push({ x0, y0, x1, y1 });
    }
  }
  // 合并相交的矩形（直到没有可合并的）
  let merged = true;
  while (merged && rects.length > 1) {
    merged = false;
    const out: CellRect[] = [];
    for (const r of rects) {
      const hit = out.find((o) => o.x0 <= r.x1 && r.x0 <= o.x1 && o.y0 <= r.y1 && r.y0 <= o.y1);
      if (hit) {
        hit.x0 = Math.min(hit.x0, r.x0);
        hit.y0 = Math.min(hit.y0, r.y0);
        hit.x1 = Math.max(hit.x1, r.x1);
        hit.y1 = Math.max(hit.y1, r.y1);
        merged = true;
      } else out.push({ ...r });
    }
    rects = out;
  }
  return rects;
}

/**
 * 迷雾画家：update 传入最新的探索状态（每行一个字符串，'1' 为已揭开；缺行、缺字视为已揭开），
 * 返回需要重新贴图的像素矩形（海图像素、每格 CHART_CELL 像素；没有变化时为 null）。
 * 画好的迷雾图在 px 中：scale 为 1 时与海图同尺寸；为 2 时（大地图的世界图）每格 2 像素——每格 4 像素画好的一块
 * 当场 2×2 按不透明度加权取平均写进去（同 map/tiles.ts 的 downsample），与以前整张画好再缩小逐像素相同。
 */
export class FogPainter {
  readonly px: Px;
  private rev: Uint8Array | null = null;

  /** 当前的探索状态（每格 1 字节，1 为已揭开；还没画过时为 null）。航行视图的瓦片按它盖雾。 */
  get revealed(): Uint8Array | null {
    return this.rev;
  }

  /** 画家持有的字节：迷雾图、探索状态，以及这种尺寸的云团毯在块缓存里的块（边缘噪声不常驻）。 */
  heldBytes(): number {
    return this.px.data.byteLength + (this.rev?.byteLength ?? 0) + fogCloudBytes(this.width, this.height, this.wrap);
  }

  constructor(
    readonly width: number,
    readonly height: number,
    /** 东西相连（第九批）：云团毯首尾相接、距离场按环绕计算 */
    readonly wrap = false,
    /** 迷雾图的缩小倍数（大地图的世界图 2：每格 2 像素；缺省 1，与海图同尺寸） */
    readonly scale: 1 | 2 = 1,
  ) {
    const W = Math.max(1, width);
    const H = Math.max(1, height);
    this.px = new Px((W * C) / scale, (H * C) / scale);
  }

  update(explored: readonly string[]): PxRect | null {
    const W = Math.max(1, this.width);
    const H = Math.max(1, this.height);
    const rev = new Uint8Array(W * H);
    for (let y = 0; y < H; y++) {
      const row = explored[y];
      for (let x = 0; x < W; x++) rev[y * W + x] = row === undefined || row[x] !== "0" ? 1 : 0;
    }
    // 变化的格子的包围盒
    let x0 = 0;
    let y0 = 0;
    let x1 = W - 1;
    let y1 = H - 1;
    const old = this.rev;
    if (old) {
      x0 = W;
      y0 = H;
      x1 = -1;
      y1 = -1;
      for (let y = 0; y < H; y++) {
        for (let x = 0; x < W; x++) {
          if (old[y * W + x] === rev[y * W + x]) continue;
          if (x < x0) x0 = x;
          if (x > x1) x1 = x;
          if (y < y0) y0 = y;
          if (y > y1) y1 = y;
        }
      }
      if (x1 < 0) return null;
      // 环绕：变化挨着接缝时影响到对侧，这几行整行重画
      const nearSeam = this.wrap && (x0 - FOG_REACH < 0 || x1 + FOG_REACH > W - 1);
      x0 = nearSeam ? 0 : Math.max(0, x0 - FOG_REACH);
      y0 = Math.max(0, y0 - FOG_REACH);
      x1 = nearSeam ? W - 1 : Math.min(W - 1, x1 + FOG_REACH);
      y1 = Math.min(H - 1, y1 + FOG_REACH);
    }
    this.rev = rev;
    const rect = { x: x0 * C, y: y0 * C, w: (x1 - x0 + 1) * C, h: (y1 - y0 + 1) * C };
    this.paint(rev, rect);
    return rect;
  }

  /**
   * 整张换成 rev（每格 1 字节，1 为已揭开；画家接管这个数组，之后原地修改）：整张重画，返回整张的矩形。
   * 全量重同步（换了一局、读档、刚打开）用它。
   */
  replace(rev: Uint8Array): PxRect {
    const W = Math.max(1, this.width);
    const H = Math.max(1, this.height);
    this.rev = rev.length === W * H ? rev : Uint8Array.from({ length: W * H }, (_, i) => rev[i] ?? 1);
    const rect = { x: 0, y: 0, w: W * C, h: H * C };
    this.paint(this.rev, rect);
    return rect;
  }

  /**
   * 揭开若干格（格的下标 y·W + x；已经揭开的忽略）：按变化的格聚成几块，每块外扩 FOG_REACH 格、在局部窗口里算距离场重画。
   * 返回重画的像素矩形（没有新揭开的为空数组）。还没有整张的探索状态（没调用过 replace / update）时不画，返回 null。
   * 变化的范围超过半张图时直接整张重画。
   */
  reveal(cells: ArrayLike<number>): PxRect[] | null {
    const rev = this.rev;
    if (!rev) return null;
    const W = Math.max(1, this.width);
    const H = Math.max(1, this.height);
    const xs: number[] = [];
    const ys: number[] = [];
    for (let i = 0; i < cells.length; i++) {
      const c = cells[i];
      if (c < 0 || c >= W * H || rev[c]) continue;
      rev[c] = 1;
      xs.push(c % W);
      ys.push(Math.floor(c / W));
    }
    if (xs.length === 0) return [];
    const rects = fogDirtyRects(xs, ys, xs.length, W, H, this.wrap);
    let area = 0;
    for (const r of rects) area += (r.x1 - r.x0 + 1) * (r.y1 - r.y0 + 1);
    if (area * 2 > W * H) {
      const all = { x: 0, y: 0, w: W * C, h: H * C };
      this.paint(rev, all);
      return [all];
    }
    return rects.map((r) => {
      this.paintLocal(rev, r);
      return { x: r.x0 * C, y: r.y0 * C, w: (r.x1 - r.x0 + 1) * C, h: (r.y1 - r.y0 + 1) * C };
    });
  }

  private paint(rev: Uint8Array, rect: PxRect) {
    const W = Math.max(1, this.width);
    const H = Math.max(1, this.height);
    const clampY = (y: number) => (y < 0 ? 0 : y >= H ? H - 1 : y);
    let grid: DistGrid;
    if (this.wrap) {
      // 环绕：左右各补 M 列（取自对侧）再算距离场，采样时偏移 M 格（横向不夹），接缝两侧连续
      const M = FOG_REACH + 3;
      const Wp = W + 2 * M;
      const revP = new Uint8Array(Wp * H);
      for (let y = 0; y < H; y++) for (let x = 0; x < Wp; x++) revP[y * Wp + x] = rev[y * W + ((((x - M) % W) + W) % W)];
      const distP = chamfer(Wp, H, (i) => revP[i] === 1);
      grid = { d: distP, row: (y) => clampY(y) * Wp, col: (x) => x + M };
    } else {
      // 不环绕：采样的下标夹到图内（同 noise.ts 的 sampler）
      const dist = chamfer(W, H, (i) => rev[i] === 1);
      grid = { d: dist, row: (y) => clampY(y) * W, col: (x) => (x < 0 ? 0 : x >= W ? W - 1 : x) };
    }
    this.paintPixels(rev, rect, grid);
  }

  /**
   * 局部重画格矩形 r：距离场只在 r 外扩 LOCAL_MARGIN 格的窗口里算（环绕时窗口按展开的坐标，越过接缝的格取对侧），
   * 采样的下标与整张时相同（不环绕时夹到图内；环绕时不夹），逐像素的结果与整张重画相同。
   */
  private paintLocal(rev: Uint8Array, r: CellRect) {
    const W = Math.max(1, this.width);
    const H = Math.max(1, this.height);
    const wrap = this.wrap;
    const m = LOCAL_MARGIN;
    const wx0 = wrap ? r.x0 - m : Math.max(0, r.x0 - m);
    const wx1 = wrap ? r.x1 + m : Math.min(W - 1, r.x1 + m);
    const wy0 = Math.max(0, r.y0 - m);
    const wy1 = Math.min(H - 1, r.y1 + m);
    const ww = wx1 - wx0 + 1;
    const wh = wy1 - wy0 + 1;
    const src = new Uint8Array(ww * wh);
    for (let y = 0; y < wh; y++) {
      const row = (wy0 + y) * W;
      for (let x = 0; x < ww; x++) {
        const gx = wx0 + x;
        src[y * ww + x] = rev[row + (wrap ? ((gx % W) + W) % W : gx)];
      }
    }
    const d = chamfer(ww, wh, (i) => src[i] === 1);
    const rect = { x: r.x0 * C, y: r.y0 * C, w: (r.x1 - r.x0 + 1) * C, h: (r.y1 - r.y0 + 1) * C };
    // 格 (x, y) 的距离，下标同整张时的采样，只是换到窗口里：纵向夹到图内；不环绕时横向也夹，环绕时按展开的坐标
    // （窗口比 r 大 LOCAL_MARGIN 格，取得到 r 外一格）
    const grid: DistGrid = {
      d,
      row: (y) => ((y < 0 ? 0 : y >= H ? H - 1 : y) - wy0) * ww,
      col: (x) => (wrap ? x : x < 0 ? 0 : x >= W ? W - 1 : x) - wx0,
    };
    this.paintPixels(rev, rect, grid);
  }

  /**
   * 逐像素（整张与局部共用同一段画法）：grid 给出格的距离，像素的距离是以格心为采样点的双线性插值（同 noise.ts 的 sampler）。
   * rect 为海图像素、按格对齐。按云团毯的块分片画：每片要用到云团时才取那一块云团毯（块缓存里只生成用到的部分）；
   * 边缘噪声在用到时才算格点——每天的小矩形整块共用一份（格点的缓冲重复使用），整张重画时每片各算各的（不为整张图存格点表）。
   * 画好写进迷雾图（scale 为 2 时 2×2 取平均）。
   */
  private paintPixels(rev: Uint8Array, rect: PxRect, grid: DistGrid) {
    const B = CLOUD_BLOCK;
    const x1 = rect.x + rect.w;
    const y1 = rect.y + rect.h;
    let rectNoise: Field | null = null;
    const noiseOf =
      rect.w * rect.h <= 4 * B * B
        ? () => (rectNoise ??= fbmWindow(rect.x, rect.y, rect.w, rect.h, FOG_NOISE_SCALE, FOG_NOISE_SEED, NOISE_SCRATCH))
        : (xs: number, ys: number, sw: number, sh: number) => fbmWindow(xs, ys, sw, sh, FOG_NOISE_SCALE, FOG_NOISE_SEED, NOISE_SCRATCH);
    for (let by = Math.floor(rect.y / B); by * B < y1; by++) {
      for (let bx = Math.floor(rect.x / B); bx * B < x1; bx++) {
        const xs = Math.max(rect.x, bx * B);
        const ys = Math.max(rect.y, by * B);
        const xe = Math.min(x1, (bx + 1) * B);
        const ye = Math.min(y1, (by + 1) * B);
        if (xe > xs && ye > ys) this.paintPiece(rev, xs, ys, xe, ye, bx, by, grid, noiseOf);
      }
    }
  }

  /**
   * 画一片 [xs, xe) × [ys, ye)（按格对齐，落在云团毯的第 (bx, by) 块里）。逐格取它与四周 8 格的距离（行列的下标先算好，
   * 横向逐格滑动）：格里每个像素的双线性插值的四个格心都在这 3 × 3 里（下标的夹法与采样相同），插值就地按同样的运算次序算，
   * 结果逐位相同。9 个都是 0 时整格揭开（插值恒为 0）；都不小于 2.2 时整格是云团（插值不小于 2.2 减去舍入误差，必定 ≥ 2.1）——
   * 这两种整格直接写；其余（迷雾的边缘）逐像素按距离与噪声抖动。
   */
  private paintPiece(
    rev: Uint8Array,
    xs: number,
    ys: number,
    xe: number,
    ye: number,
    bx: number,
    by: number,
    grid: DistGrid,
    noiseOf: (xs: number, ys: number, sw: number, sh: number) => Field,
  ) {
    const W = Math.max(1, this.width);
    const H = Math.max(1, this.height);
    const PW = W * C;
    const B = CLOUD_BLOCK;
    const sw = xe - xs;
    const sh = ye - ys;
    // scale 为 1 直接写进迷雾图；为 2 先写进一片的暂存，画完再 2×2 取平均
    const direct = this.scale === 1;
    const out = direct ? this.px.data : scratchOf(sw * sh);
    const bw = Math.min(B, PW - bx * B);
    const bx0 = bx * B;
    const by0 = by * B;
    const nb = NEIGHBORS;
    const d = grid.d;
    // 这一片的格（含两端外的一圈）在距离场里的行、列下标
    const gx0 = xs / C;
    const gx1 = xe / C;
    const gy0 = ys / C;
    const gy1 = ye / C;
    const colOff = COL_OFF;
    const rowOff = ROW_OFF;
    for (let i = 0; i <= gx1 - gx0 + 1; i++) colOff[i] = grid.col(gx0 - 1 + i);
    for (let j = 0; j <= gy1 - gy0 + 1; j++) rowOff[j] = grid.row(gy0 - 1 + j);
    let cloud: Uint32Array | null = null;
    let noise: Field | null = null;
    for (let gy = gy0; gy < gy1; gy++) {
      const r0 = rowOff[gy - gy0];
      const r1 = rowOff[gy - gy0 + 1];
      const r2 = rowOff[gy - gy0 + 2];
      // 3 × 3 的左、中两列（逐格向右滑动一列）
      let a0 = d[r0 + colOff[0]];
      let a1 = d[r1 + colOff[0]];
      let a2 = d[r2 + colOff[0]];
      let b0 = d[r0 + colOff[1]];
      let b1 = d[r1 + colOff[1]];
      let b2 = d[r2 + colOff[1]];
      for (let gx = gx0; gx < gx1; gx++) {
        const ci = colOff[gx - gx0 + 2];
        const c0 = d[r0 + ci];
        const c1 = d[r1 + ci];
        const c2 = d[r2 + ci];
        nb[0] = a0;
        nb[1] = b0;
        nb[2] = c0;
        nb[3] = a1;
        nb[4] = b1;
        nb[5] = c1;
        nb[6] = a2;
        nb[7] = b2;
        nb[8] = c2;
        const lo = Math.min(a0, a1, a2, b0, b1, b2, c0, c1, c2);
        const hi = Math.max(a0, a1, a2, b0, b1, b2, c0, c1, c2);
        a0 = b0;
        a1 = b1;
        a2 = b2;
        b0 = c0;
        b1 = c1;
        b2 = c2;
        const full = hi === 0 ? 0 : lo >= 2.2 ? 1 : -1;
        if (full !== 0) cloud ??= cloudFor(PW, H * C, this.wrap, bx, by, xs, ys, xe, ye);
        // 已揭开、且距离为 0 的格（距离为 0 就是揭开的格）：只有贴着迷雾的一侧才可能被边缘抖动盖到
        const open = rev[gy * W + gx] !== 0 && nb[4] === 0;
        const p0 = gx * C;
        for (let iy = 0; iy < C; iy++) {
          const py = gy * C + iy;
          const orow = direct ? py * PW : (py - ys) * sw - xs;
          if (full === 0) {
            // 整格揭开
            for (let px = p0; px < p0 + C; px++) out[orow + px] = 0;
            continue;
          }
          // 这里 cloud 已经取到（full 不为 0）
          const cl = cloud as Uint32Array;
          const crow = (py - by0) * bw - bx0;
          if (full === 1) {
            // 整格云团
            for (let px = p0; px < p0 + C; px++) out[orow + px] = cl[crow + px];
            continue;
          }
          // 纵向的插值：同 sampler（v = (py + 0.5) / C − 0.5 → 上下两行与权重），查表（见 SUB_W）
          const fy = SUB_W[iy];
          const ra = SUB_I[iy] * 3;
          const rb = ra + 3;
          for (let ix = 0; ix < C; ix++) {
            const px = p0 + ix;
            const fx = SUB_W[ix];
            const ca = SUB_I[ix];
            const top = nb[ra + ca] + (nb[ra + ca + 1] - nb[ra + ca]) * fx;
            const bot = nb[rb + ca] + (nb[rb + ca + 1] - nb[rb + ca]) * fx;
            const sv = top + (bot - top) * fy;
            if (open && sv < 0.35) {
              out[orow + px] = 0;
              continue;
            }
            // 离已揭开的格子足够远：整块云团（噪声最多让距离减少 0.55）
            if (sv >= 2.1) {
              out[orow + px] = cl[crow + px];
              continue;
            }
            noise ??= noiseOf(xs, ys, sw, sh);
            const dd = sv + (noise(px, py) - 0.5) * 1.1;
            const a = (dd - 0.45) / 1.1;
            out[orow + px] = a > 0 && (a >= 1 || bayer(px, py) < a) ? cl[crow + px] : 0;
          }
        }
      }
    }
    if (!direct) this.commitHalf(out, xs, ys, sw, sh);
  }

  /**
   * scale = 2：把每格 4 像素画好的一片（左上角 (xs, ys)、偶数尺寸）2×2 按不透明度加权取平均写进迷雾图——
   * 与 map/tiles.ts 的 downsample 逐位相同（整数加权和、同样的除法与舍入；全透明的为 0）。
   */
  private commitHalf(src: Uint32Array, xs: number, ys: number, sw: number, sh: number) {
    const dst = this.px.data;
    const DW = this.px.w;
    const ox0 = xs >> 1;
    const oy0 = ys >> 1;
    for (let oy = 0; oy < sh >> 1; oy++) {
      const s0 = oy * 2 * sw;
      const s1 = s0 + sw;
      const drow = (oy0 + oy) * DW + ox0;
      for (let ox = 0; ox < sw >> 1; ox++) {
        const p0 = src[s0 + 2 * ox];
        const p1 = src[s0 + 2 * ox + 1];
        const p2 = src[s1 + 2 * ox];
        const p3 = src[s1 + 2 * ox + 1];
        // 四个一样（整片云团或整片揭开）：平均就是它自己
        if (p0 === p1 && p0 === p2 && p0 === p3) {
          dst[drow + ox] = p0;
          continue;
        }
        const a0 = p0 & 0xff;
        const a1 = p1 & 0xff;
        const a2 = p2 & 0xff;
        const a3 = p3 & 0xff;
        const a = a0 + a1 + a2 + a3;
        if (a === 0) {
          dst[drow + ox] = 0;
          continue;
        }
        const r = Math.round(((p0 >>> 24) * a0 + (p1 >>> 24) * a1 + (p2 >>> 24) * a2 + (p3 >>> 24) * a3) / a);
        const g = Math.round((((p0 >>> 16) & 0xff) * a0 + ((p1 >>> 16) & 0xff) * a1 + ((p2 >>> 16) & 0xff) * a2 + ((p3 >>> 16) & 0xff) * a3) / a);
        const b = Math.round((((p0 >>> 8) & 0xff) * a0 + ((p1 >>> 8) & 0xff) * a1 + ((p2 >>> 8) & 0xff) * a2 + ((p3 >>> 8) & 0xff) * a3) / a);
        dst[drow + ox] = ((r << 24) | (g << 16) | (b << 8) | Math.round(a / 4)) >>> 0;
      }
    }
  }
}

/** 一格与四周 8 格的距离（逐格重复使用）。 */
const NEIGHBORS = new Float64Array(9);
/** 一片的格在距离场里的列、行下标（一片最多 CLOUD_BLOCK / C 格，两端各多一格）。 */
const COL_OFF = new Int32Array(CLOUD_BLOCK / C + 2);
const ROW_OFF = new Int32Array(CLOUD_BLOCK / C + 2);
/**
 * 格内第 i 个像素（0 ≤ i < C）的采样：u = (i + 0.5) / C − 0.5 向下取整 → 左（上）邻格心在 3 × 3 里的列（行）号 SUB_I，
 * 小数部分是权重 SUB_W。C 是 2 的幂，(g·C + i + 0.5) / C − 0.5 = g + u 在浮点里是精确的，任何格 g 都可以查同一张表，
 * 与 sampler 逐像素现算的结果逐位相同。
 */
const SUB_I = new Int32Array(C);
const SUB_W = new Float64Array(C);
for (let i = 0; i < C; i++) {
  const u = (i + 0.5) / C - 0.5;
  const f = Math.floor(u);
  SUB_I[i] = f + 1;
  SUB_W[i] = u - f;
}
/** 边缘噪声的格点缓冲（每次重画重复使用，见 noise.ts 的 fbmWindow）。 */
const NOISE_SCRATCH = new FbmScratch();

/** 一片的暂存（scale = 2 时用；最大一块云团毯那么大，64 KiB，重复使用）。 */
let scratch = new Uint32Array(0);
function scratchOf(n: number): Uint32Array {
  if (scratch.length < n) scratch = new Uint32Array(n);
  return scratch;
}

/**
 * 迷雾覆盖层（与海图同尺寸）：未探索的格子盖上羊皮纸云团，边缘用有序抖动过渡。
 * explored 每行一个字符串，'1' 为已揭开；缺行视为已揭开。
 */
export function drawFog(explored: readonly string[], width: number, height: number, wrap = false): Px {
  const painter = new FogPainter(width, height, wrap);
  painter.update(explored);
  return painter.px;
}
