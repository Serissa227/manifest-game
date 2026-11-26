// 地图的内存账本（性能商议 2026-10-07 第 5 条）：整图、迷雾、世界图、瓦片按字节各记各的。
//
// 以前只有航行视图的瓦片按字节限额（桌面 200 MB、手机 120 MB），后台线程里每格 4 像素的整图（1080 × 396 一张就是 26 MiB）、
// 迷雾图与云团毯、记忆化缓存里各季节的海图、主线程的世界图与画布都在限额之外。现在：
// - 这些大对象按 `${海图的键}:${用途}` 记进账本（后台线程的由它在回复里报上来；没有 Worker 时主线程自己记）；
// - 瓦片的配额 = 总预算（MEMORY_BUDGET）扣掉这张图的基础缓冲（按尺寸算出的整图、迷雾、世界图与画布），至少留 TILE_FLOOR；
// - 换季时只留要显示的一季（经典世界多留预先生成的下一季），离开世界（最后一个使用者放手）时这张图的账清零、大对象释放。
// 第 5 条的后续（2026-10-07）：大地图的迷雾图按世界图的分辨率存、云团毯按块生成（LRU）、边缘噪声不常驻（art/map/fog.ts），
// 1080 × 396 的基础缓冲约 122 MiB → 约 55 MiB，手机上瓦片的配额从下限 24 MiB 升到约 65 MiB。
import { fogCloudBudget } from "../art/map/fog";
import { BASE_CELL_PX, memoryBudget } from "./tiles";

const MiB = 1024 * 1024;
/** 瓦片至少留这么多（约 10 块 64 × 64 格、每格 12 像素的瓦片：手机最小缩放下一屏约 6 块）。 */
export const TILE_FLOOR = 24 * MiB;

const ledger = new Map<string, number>();

/** 记一笔（同一个 owner 覆盖上一笔；0 或负数等于删掉）。 */
export function account(owner: string, bytes: number): void {
  if (bytes > 0) ledger.set(owner, bytes);
  else ledger.delete(owner);
}

/** 删掉以 prefix 开头的账（离开世界）。 */
export function dropAccounts(prefix: string): void {
  for (const k of [...ledger.keys()]) if (k.startsWith(prefix)) ledger.delete(k);
}

/** 账上的合计（只算以 prefix 开头的；不给时全部）。 */
export function accountedBytes(prefix = ""): number {
  let n = 0;
  for (const [k, v] of ledger) if (k.startsWith(prefix)) n += v;
  return n;
}

/** 账本的拷贝（调试与测试用）。 */
export function ledgerSnapshot(): Record<string, number> {
  return Object.fromEntries(ledger);
}

/**
 * 一张地图的基础缓冲（字节，按尺寸估计；与真正分配的缓冲对得上，见 memory.test.ts、fogMemory.test.ts）：
 * - 后台线程：每格 4 像素的整图（大地图是切瓦片用的一季；经典世界是记忆化缓存里与世界图、瓦片共用的两季——显示的与预先生成的下一季）、
 *   世界图分辨率的迷雾图（大地图每格 2 像素）、探索状态（每格 1 字节）、云团毯的块缓存（上限与整张取小）；
 * - 主线程：世界图（scale 倍缩小；经典世界另有预先生成的下一季）与世界图的海图、迷雾两张画布。
 * 不算的：边缘噪声的格点与距离场（每次重画按矩形现算、用完就丢；大地图整张重画时峰值约 4 MiB）、GPU 上的纹理。
 */
export function baseBytes(width: number, height: number, scale: 1 | 2): number {
  const pw = width * BASE_CELL_PX;
  const ph = height * BASE_CELL_PX;
  const full = pw * ph * 4;
  const world = (pw / scale) * (ph / scale) * 4;
  const charts = scale === 1 ? 2 * full : full;
  const worker = charts + world + width * height + fogCloudBudget(width, height);
  const main = world * (scale === 1 ? 2 : 1) + world * 2;
  return worker + main;
}

/** 航行视图的瓦片配额：总预算扣掉这张图的基础缓冲，至少 TILE_FLOOR。 */
export function tileBudget(width: number, height: number, scale: 1 | 2, total = memoryBudget()): number {
  return Math.max(TILE_FLOOR, total - baseBytes(width, height, scale));
}
