// 航海图的重活：整张海图位图（按季节）与迷雾（增量），并转成 ImageData 用的 RGBA 字节。
// 纯函数与纯数据，不碰 DOM：既在后台线程（chart.worker.ts）里跑，也是没有 Worker 时主线程的后备实现。
// 400×170 格的大地图生成一次整图约 0.3 秒、迷雾画家初始化约 0.3 秒，放在后台线程里就不会卡住界面。
//
// 第九批（FRAMEWORK §5.4）：大地图（1080 × 396）的世界图每格 2 像素（scale = 2：整图与迷雾的矩形都 2×2 缩小后再交回），
// 每格 4 像素的整图留在这里，航行视图的瓦片（64 × 64 格、每格 12 像素，盖好迷雾）按需从它裁出放大。
// 性能商议（2026-10-07）：大地图的迷雾不再经过整张 '0' / '1' 文本——位图（全量重同步，fogSync）与 fog_delta 的区间
// （fogRuns）直接到这里，画家按变化的格聚成几块、局部重画（远隔的两支舰队各是一块），每块单独交回。经典世界照旧传文本。
// 内存（性能商议第 5 条的后续）：迷雾画家直接按世界图的分辨率存迷雾图（大地图每格 2 像素，不再有每格 4 像素的整张迷雾图），
// 云团毯按块生成、边缘噪声按块现算（art/map/fog.ts）；经典世界切瓦片直接用记忆化缓存里的那张海图（不再另拷一份）。
import { FogPainter, chartMemoKey, drawChart, type ChartInput, type PxRect } from "../art/map";
import { detailContext, paintDetailTile, type DetailContext } from "../art/map/detail";
import { releaseFogCaches } from "../art/map/fog";
import { HD_TILE } from "../art/map/hd";
import { hdFogTile } from "../art/map/hdFog";
import { paintChart } from "../art/map/terrain";
import type { Px } from "../art/px";
import { forgetMemo, memo, memoBytes } from "../art/render";
import { runCells, unpackBits, type CellBox, type FogRun } from "./fogBits";
import { BASE_CELL_PX, downsample, fogTileImage, tileImage } from "./tiles";

/** 位图中的一块矩形区域（海图像素坐标），data 为 RGBA 字节（可直接构造 ImageData）。 */
export interface RgbaImage {
  x: number;
  y: number;
  w: number;
  h: number;
  data: Uint8ClampedArray<ArrayBuffer>;
}

/** 把位图 px 的 rect 区域转成 RGBA 字节（区域会裁到位图范围内）。 */
export function rgbaOf(px: Px, rect: PxRect = { x: 0, y: 0, w: px.w, h: px.h }): RgbaImage {
  const x0 = Math.max(0, Math.floor(rect.x));
  const y0 = Math.max(0, Math.floor(rect.y));
  const x1 = Math.min(px.w, Math.floor(rect.x + rect.w));
  const y1 = Math.min(px.h, Math.floor(rect.y + rect.h));
  const w = Math.max(0, x1 - x0);
  const h = Math.max(0, y1 - y0);
  const data = new Uint8ClampedArray(new ArrayBuffer(w * h * 4));
  let o = 0;
  for (let y = y0; y < y1; y++) {
    let i = y * px.w + x0;
    for (let x = x0; x < x1; x++, i++) {
      const v = px.data[i];
      data[o++] = v >>> 24;
      data[o++] = (v >>> 16) & 0xff;
      data[o++] = (v >>> 8) & 0xff;
      data[o++] = v & 0xff;
    }
  }
  return { x: x0, y: y0, w, h, data };
}

/** 某个季节的整张海图（0 春 1 夏 2 秋 3 冬）。 */
export function chartImage(input: ChartInput, season: number): RgbaImage {
  return rgbaOf(drawChart(input, { season }));
}

/** 迷雾变化涉及的格（含两端；"all" 为整张）。航行视图据此作废瓦片。 */
export type FogCells = CellBox | "all" | null;

/** 迷雾的一块变化：RGBA（世界图坐标）与涉及的格。 */
export interface FogPart {
  img: RgbaImage;
  cells: CellBox | "all";
}

/**
 * 迷雾：记住上一次的探索状态，每次只返回变化的矩形（第一次返回整张图；没有变化时为 null）。
 * 返回的图按世界图的分辨率（scale 为 2 时每格 2 像素，矩形的坐标也是世界图的）；cells 照旧按格。
 * 画家在第一次更新时才创建。
 */
export class FogJob {
  private painter: FogPainter | null = null;
  /** 最近一次变化涉及的格 */
  lastCells: FogCells = null;

  /** 每格 1 字节的探索状态（1 已揭开；还没收到迷雾时为 null，表示全部揭开）：就是画家手上的那份，不另存。 */
  get revealed(): Uint8Array | null {
    return this.painter?.revealed ?? null;
  }

  /** 画家手上的迷雾图（世界图分辨率；还没画过时为 null）。内存账本与测试用。 */
  get image(): Px | null {
    return this.painter?.px ?? null;
  }

  /** 迷雾持有的字节（世界图分辨率的迷雾图、探索状态与这种尺寸的云团毯块缓存）。 */
  heldBytes(): number {
    return this.painter?.heldBytes() ?? 0;
  }

  /** 放手：画家与这种尺寸的云团毯块缓存都释放（离开世界）。 */
  release(): void {
    this.painter = null;
    this.lastCells = null;
    releaseFogCaches(this.width, this.height, this.wrap);
  }

  constructor(
    readonly width: number,
    readonly height: number,
    /** 东西相连：迷雾在接缝两侧连续 */
    readonly wrap = false,
    /** 世界图的缩小倍数（大地图 2）：迷雾图按这个分辨率存、交回 */
    readonly scale: 1 | 2 = 1,
  ) {}

  private paint(): FogPainter {
    return (this.painter ??= new FogPainter(this.width, this.height, this.wrap, this.scale));
  }

  /** 画家的矩形（海图像素）→ 迷雾图里的那一块 RGBA（世界图坐标）。 */
  private imageOf(painter: FogPainter, rect: PxRect): RgbaImage {
    const k = this.scale;
    return rgbaOf(painter.px, { x: rect.x / k, y: rect.y / k, w: rect.w / k, h: rect.h / k });
  }

  /** 整张迷雾图（世界图分辨率；还没画过时为 null）：后来的订阅者（例如晚一步建好的世界图）要整张。 */
  full(): RgbaImage | null {
    return this.painter && this.revealed ? rgbaOf(this.painter.px) : null;
  }

  update(rows: readonly string[]): RgbaImage | null {
    const painter = this.paint();
    const rect = painter.update(rows);
    this.lastCells = rect ? this.cellsOf(rect) : null;
    return rect ? this.imageOf(painter, rect) : null;
  }

  /** 全量重同步：位图（每格一位，行优先、字节内低位在前）整张换上，整张重画。 */
  sync(bits: Uint8Array): FogPart[] {
    const painter = this.paint();
    const rect = painter.replace(unpackBits(bits, this.width, this.height));
    this.lastCells = "all";
    return [{ img: this.imageOf(painter, rect), cells: "all" }];
  }

  /**
   * fog_delta 的区间：揭开这些格，按变化聚成几块各自局部重画，每块单独交回（没有新揭开的为空）。
   * 还没有整张的状态时（不应发生：调用方先 sync）从全部未揭开开始。
   */
  runs(runs: readonly FogRun[]): FogPart[] {
    const painter = this.paint();
    const cells = runCells(runs, this.width, this.height);
    let rects = painter.reveal(cells);
    if (rects === null) {
      const rev = new Uint8Array(Math.max(1, this.width) * Math.max(1, this.height));
      for (const c of cells) rev[c] = 1;
      rects = [painter.replace(rev)];
    }
    const parts = rects.map((rect) => ({ img: this.imageOf(painter, rect), cells: this.cellsOf(rect) }));
    this.lastCells = parts.length === 0 ? null : parts.length === 1 ? parts[0].cells : "all";
    return parts;
  }

  /** 像素矩形涉及的格（整张为 "all"）。 */
  private cellsOf(rect: PxRect): CellBox | "all" {
    const C = BASE_CELL_PX;
    return rect.x === 0 && rect.y === 0 && rect.w >= this.width * C && rect.h >= this.height * C
      ? "all"
      : { x0: Math.floor(rect.x / C), y0: Math.floor(rect.y / C), x1: Math.ceil((rect.x + rect.w) / C) - 1, y1: Math.ceil((rect.y + rect.h) / C) - 1 };
  }
}

/** '0' / '1' 文本 → 每格 1 字节（缺行、缺字视为已揭开，与迷雾画家一致）。 */
export function revealedOf(rows: readonly string[], width: number, height: number): Uint8Array {
  const W = Math.max(1, width);
  const H = Math.max(1, height);
  const rev = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) {
    const row = rows[y];
    for (let x = 0; x < W; x++) rev[y * W + x] = row === undefined || row[x] !== "0" ? 1 : 0;
  }
  return rev;
}

/**
 * 后台线程（或主线程后备）的全部状态：海图输入、世界图的缩小倍数、各季节每格 4 像素的整图（大地图只留当前一季）与迷雾。
 * chart 返回世界图（scale 倍缩小），fog 返回世界图坐标下变化的矩形，tile 返回航行视图的一块瓦片。
 */
export class ChartWorkState {
  /** 大地图切瓦片用的整图（只留一季；经典世界直接用记忆化缓存里的海图，不放这里） */
  private readonly bases = new Map<number, RgbaImage>();
  readonly fog: FogJob;
  /** 经典世界最近要过的季节（记忆化缓存里只留这两季的整图） */
  private recent: number[] = [];
  /** 记忆化缓存里这张图的各季海图的键（下标为季节；算一次：键要对整张图层取哈希） */
  private memoKeys: string[] | null = null;
  /** 细节瓦片的画具（M01；第一次要细节瓦片时才建，没有细图层的地图为 null） */
  private detailCtx: DetailContext | null | undefined;

  constructor(
    readonly input: ChartInput,
    readonly scale: 1 | 2 = 1,
  ) {
    this.fog = new FogJob(input.width, input.height, input.wrapX === true, scale);
  }

  private chartKeys(): string[] {
    this.memoKeys ??= [0, 1, 2, 3].map((x) => chartMemoKey(this.input, x));
    return this.memoKeys;
  }

  /**
   * 每格 4 像素的整图（切瓦片用）：只留要的这一季——换季时先放掉旧的再画，峰值只有一张整图（性能商议 2026-10-07）。
   * 大地图不经过记忆化缓存（不然每一季 26 MiB 的海图都会留在缓存里）；经典世界直接取记忆化缓存里与世界图共用的那张
   * （与 drawChart 同一个键、同一种画法；以前另拷一份 RGBA，多占一张整图）。
   */
  base(season: number): RgbaImage | Px {
    const s = ((season % 4) + 4) % 4;
    if (this.scale === 1) return memo(this.chartKeys()[s], () => paintChart(this.input, s));
    let b = this.bases.get(s);
    if (!b) {
      this.bases.clear();
      b = rgbaOf(paintChart(this.input, s));
      this.bases.set(s, b);
    }
    return b;
  }

  /** 大地图切瓦片用的整图（scale > 1 时才有）。 */
  private bigBase(season: number): RgbaImage {
    return this.base(season) as RgbaImage;
  }

  /** 世界图：scale 为 1 时交出整图的一份拷贝（原图留着切瓦片；交给主线程时会被转移走），否则 2×2 缩小。 */
  chart(season: number): RgbaImage {
    if (this.scale === 1) {
      // 经典世界：与以前一样每次现算整图（记忆化缓存里有就直接取），缓存里只留最近要过的两季（要显示的与预先生成的下一季）
      const s = ((season % 4) + 4) % 4;
      this.recent = [s, ...this.recent.filter((x) => x !== s)].slice(0, 2);
      const keys = this.chartKeys();
      const drop = new Set(keys.filter((_, x) => !this.recent.includes(x)));
      forgetMemo((k) => drop.has(k));
      return chartImage(this.input, season);
    }
    return downsample(this.bigBase(season), this.scale);
  }

  /**
   * 这一份状态持有的字节（内存账本用）：大地图切瓦片用的整图、迷雾（世界图分辨率的迷雾图、探索状态、云团毯的块缓存），
   * 以及记忆化缓存里这张图的各季海图（经典世界的世界图与瓦片共用）。
   */
  heldBytes(): number {
    let n = 0;
    for (const b of this.bases.values()) n += b.data.byteLength;
    const keys = new Set(this.chartKeys());
    return n + this.fog.heldBytes() + memoBytes((k) => keys.has(k));
  }

  /** 放手（离开世界）：整图、迷雾、云团毯的块缓存，以及记忆化缓存里这张图的各季海图都释放。 */
  release(): void {
    this.bases.clear();
    this.detailCtx = undefined;
    this.recent = [];
    const keys = new Set(this.chartKeys());
    forgetMemo((k) => keys.has(k));
    this.fog.release();
  }

  /** 迷雾：变化的矩形（世界图坐标；画家直接按世界图的分辨率画）；没有变化为 null。 */
  fogUpdate(rows: readonly string[]): RgbaImage | null {
    return this.fog.update(rows);
  }

  /** 迷雾的全量重同步（位图）：整张（世界图坐标）。 */
  fogSync(bits: Uint8Array): FogPart[] {
    return this.fog.sync(bits);
  }

  /** 迷雾的增量（fog_delta 的区间）：变化的几块（世界图坐标）；没有新揭开的为空。 */
  fogRuns(runs: readonly FogRun[]): FogPart[] {
    return this.fog.runs(runs);
  }

  /** 整张迷雾（世界图坐标）；还没有迷雾时为 null。 */
  fogFull(): RgbaImage | null {
    return this.fog.full();
  }

  /** 航行视图的一块瓦片（盖好迷雾）。 */
  tile(season: number, tx: number, ty: number): RgbaImage {
    const { width, height } = this.input;
    return tileImage(this.base(season), BASE_CELL_PX, this.fog.revealed, width, height, this.input.wrapX === true, tx, ty);
  }

  /**
   * 细节瓦片（M01“细海图”）：32 × 32 格、每格 24 个美术像素的地形（不盖迷雾——迷雾是另一张，见 fogTile）。
   * 没有细图层的地图返回 null。
   */
  detailTile(season: number, tx: number, ty: number): RgbaImage | null {
    if (this.detailCtx === undefined) this.detailCtx = detailContext(this.input);
    return this.detailCtx ? paintDetailTile(this.detailCtx, season, tx, ty) : null;
  }

  /** 高清瓦片（H10c，8 × 8 格、每细格 k 像素）上的迷雾；这一块与四周三格都已揭开、或还没有迷雾时为 null。 */
  hdFogTile(tx: number, ty: number, k: number): RgbaImage | null {
    const { width, height } = this.input;
    return hdFogTile(this.fog.revealed, width, height, this.input.wrapX === true, tx, ty, k, HD_TILE);
  }

  /** 细节瓦片上的迷雾（已揭开处透明）；这一块没有未探明的格、或还没有迷雾时为 null。 */
  fogTile(tx: number, ty: number): RgbaImage | null {
    const { width, height } = this.input;
    return fogTileImage(this.fog.revealed, width, height, this.input.wrapX === true, tx, ty);
  }
}

/** 主线程发给后台线程的请求。 */
export type ChartRequest =
  | { kind: "init"; input: ChartInput; scale?: 1 | 2 }
  | { kind: "chart"; season: number }
  | { kind: "fog"; rows: string[] }
  | { kind: "fogSync"; bits: Uint8Array }
  | { kind: "fogRuns"; runs: FogRun[] }
  | { kind: "fogFull" }
  | { kind: "tile"; season: number; tx: number; ty: number }
  | { kind: "detail"; season: number; tx: number; ty: number }
  | { kind: "fogTile"; tx: number; ty: number }
  | { kind: "hdFog"; tx: number; ty: number; k: number };

/** 后台线程的回复（chart 与 fog 各自按请求的顺序回复）。 */
export type ChartResponse =
  | { kind: "chart"; season: number; img: RgbaImage; /** 后台线程持有的字节（内存账本） */ held?: number }
  | { kind: "fog"; img: RgbaImage | null; cells?: FogCells; /** fogFull 的补发（不占迷雾的队列） */ full?: boolean; held?: number }
  /** fogSync / fogRuns 的回复：变化的几块（没有变化为空） */
  | { kind: "fogParts"; parts: FogPart[]; held?: number }
  | { kind: "tile"; season: number; tx: number; ty: number; img: RgbaImage }
  /** 细节瓦片的地形（没有细图层时 img 为 null）与迷雾（没有未探明的格时 img 为 null） */
  | { kind: "detail"; season: number; tx: number; ty: number; img: RgbaImage | null }
  | { kind: "fogTile"; tx: number; ty: number; img: RgbaImage | null }
  /** 高清瓦片的迷雾（H10c；没有未探明的格时 img 为 null） */
  | { kind: "hdFog"; tx: number; ty: number; k: number; img: RgbaImage | null }
  | { kind: "error"; message: string };
