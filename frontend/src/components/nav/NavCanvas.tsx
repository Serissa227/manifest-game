// 航行视图的海图画布：以舰队为中心的局部海图（64 × 64 格一块的瓦片，由共用的后台线程按需生成、LRU 缓存，
// 内存上限桌面 200 MB、手机 120 MB），船沿当天的航迹按应用层时钟的分钟移动（预测就是结果），叠上航迹、预测、视野、
// 看见过的港口、风与洋流。点海面（不拖动）把航向转向那一点。没有 2D 画布（测试环境）时不画，点海面照样能用。
//
// M01“细海图”：带细图层的地图（寰宇）改用细节瓦片——32 × 32 格一块、每格 24 个美术像素；地形与迷雾各一张（迷雾变了只重画迷雾）；
// 视野外一圈提前画，船走着不等瓦片。经典世界照旧。
//
// H10a（第十轮）：
// - 船位与船头交给 map/navMotion.ts：船头顺着航迹（对地航向、转速上限每秒 120°），换日时不清空、误差 0.3 秒内缓掉；
// - 缩放连续（navZoom.ts：每格 96–240 像素，缺省 144，滚轮、按钮步进，记住上次的值），朝目标缓动；
// - 船的大小与地形缩放脱钩：屏上船长 0.3 格、夹在 36–64 像素，别的船约 0.25 格，平滑缩放与旋转；
// - 镜头跟随：沿航向前视约 15% 屏宽，缓动的时间常数约 0.25 秒，时钟停着时回正；
// - 航迹线按播放到的分钟切成“走过 / 预测”。
//
// H10c（第十轮）：
// 寰宇的航行画面改用高清瓦片（art/map/hd.ts：8 × 8 格一块、每格 96 像素，岸线由细海岸平滑、与细碰撞的出入不到一个细格），
// 由专用的线程池（map/hdTiles.ts）按需生成；每块先出一张每格 24 像素的低清版垫着（约 1/16 的活），高清的到了再换；
// 迷雾同一分辨率（art/map/hdFog.ts，由海图的后台线程算），迷雾变了时旧的迷雾先留着、新的到了再换（只会比新的多盖，不会先露出没探明的海）。
// 放大用平滑插值。世界海图（Pixi）照旧用细节瓦片。
import { useEffect, useMemo, useRef, useState } from "react";
import { drawAnchorMark, drawShipTop, SHIP_TOP_H, SHIP_TOP_W } from "../../art/navArt";
import { toCanvas } from "../../art/render";
import type { ChartSource } from "../../hooks/useChartSource";
import { steerTo, useNavStore } from "../../hooks/useNavigation";
import { t } from "../../i18n";
import type { CoursePreview, NavView, Overview } from "../../ipc/types";
import { acquireChartHub, type ChartHub } from "../../map/chartHub";
import type { RgbaImage } from "../../map/chartWork";
import { attachFogFeed, fogLookup, useChartFog } from "../../map/fogStore";
import { cameraTiles, drawNav, toCell, toScreen, type NavCamera } from "../../map/navDraw";
import { lookSettled, stepLook, type LookState } from "../../map/navLook";
import { questMarkTarget } from "../../map/questMark";
import { flagshipMotion, OthersMotion, SNAP_CELLS, splitTrail } from "../../map/navMotion";
import type { PlacedShip } from "../../map/navSea";
import { modX, wrapDx } from "../../map/wrap";
import { pickHail } from "./hailStore";
import { account, tileBudget } from "../../map/memory";
import { HD_FINE_AT, HD_FINE_K, HD_K, HD_PREVIEW_K, HD_TILE } from "../../art/map/hd";
import { acquireHdPool, hdTileKey, type HdPool, type HdTileRequest, type HdTileResult } from "../../map/hdTiles";
import { HD_BUDGET, HD_FOG_BUDGET, imageBytes, LruCache, NAV_CELL_PX, NAV_TILE, parseTileKey, tileKey, worldScaleOf } from "../../map/tiles";
import { useClockStore } from "../../store/clock";
import { MINUTES_PER_DAY } from "../../time/daylight";
import { headingToward, positionAt, sightedPorts } from "./navKit";
import { CLASSIC_NAV_DEFAULT_ZOOM, CLASSIC_NAV_ZOOMS, navZoomKind, otherShipLengthPx, shipLengthPx, useNavZoom, wheelNavZoom } from "./navZoom";

/** 经典世界的缩放档位（每格像素；测试仍引用，界面已改成连续缩放，见 navZoom.ts）。 */
export const NAV_ZOOMS = CLASSIC_NAV_ZOOMS;
/** 经典世界的缺省档：每格 18 像素。 */
export const NAV_DEFAULT_ZOOM = CLASSIC_NAV_DEFAULT_ZOOM;
/**
 * 两帧之间至少隔多久（毫秒；性能，11-10）：时钟在走时约 72 帧封顶（120 / 144 Hz 的屏幕不必每帧都把整张海图重画一遍），
 * 时钟停着、只有风与洋流的流线在飘时约 30 帧。船位、航向、预测、镜头这些一变就立刻画，不受这两个间隔限制。
 */
export const NAV_FRAME_MS = 13;
export const NAV_IDLE_FRAME_MS = 32;
/** 镜头前视：屏宽的多少（H10a）。方向的慢平均与限速见 map/navLook.ts（H10iF2）。 */
export const LOOK_AHEAD = 0.15;
/** 缩放缓动的时间常数（毫秒）。 */
const ZOOM_TAU_MS = 90;
/** 船图先按最近邻放大的倍数（再平滑缩到屏上，像素边缘不糊）。 */
const SHIP_UP = 4;
/** 每帧至多把几块 RGBA 转成画布（主线程后备与迷雾是 RGBA；一下子到一大批时分几帧转，不在一帧里卡住）。 */
const CONVERT_PER_FRAME = 3;
const LABEL_FONT = 'bold 12px "Microsoft YaHei", "PingFang SC", "Noto Sans CJK SC", sans-serif';

/**
 * H10iF2 验收用的探针（开发模式下每帧写到 window.__navProbe，只读的快照）：画出来的船头、后端的舵向、
 * 镜头相对船的偏移（屏幕像素）、船的屏幕坐标、自动航行的模式（手动为 manual）、播放到的日子与分钟（从 6:00 起）、时钟倍速。
 * H10iF3：`day` / `minute` 改成播放到的真实日子与当天分钟（外推越过日界时已经是下一天，不再是“前一天的 1440 以后”）；
 * 另加 `waiting`（播放已越过后端确认的那一天的结束，正在等后端结算）、`source`（"authoritative" 后端给的航迹 /
 * "predicted" 外推的预测 / "none" 还没有航迹）、`leadMs`（播放领先后端估计时刻的实时毫秒，负为落后）、
 * `lastFix`（上一次新航迹到时画面与它的位置差，格）、`still`（船真的停了，镜头只在这时回正）。
 */
interface NavProbe {
  at: number;
  heading: number;
  helm: number;
  camOff: { x: number; y: number };
  ship: { sx: number; sy: number };
  mode: string;
  day: number;
  minute: number | null;
  speed: number;
  waiting: boolean;
  source: "authoritative" | "predicted" | "none";
  leadMs: number;
  /** H10iF4：画面领先后端最后确认的分钟多少游戏分钟（负为落后）；封顶 240 的就是它 */
  leadMin: number;
  /** H10iF4：画面领先后端此刻的估计（确认的分钟加推送之间按倍速的外推）多少游戏分钟 */
  leadEstMin: number;
  lastFix: number | null;
  still: boolean;
}

/** 量帧耗时用（实机测性能时由页面脚本放一个数组到 globalThis.__navPerf；平时不存在，不记）。 */
interface NavPerfEntry {
  at: number;
  ms: number;
  day: number;
  minute: number;
  z: number;
  x: number;
  y: number;
  heading: number;
  /** 这一帧画的高清瓦片：高清、低清垫底、羊皮纸（还没有） */
  hd?: [number, number, number];
  /** 镜头相对船的偏移（屏幕像素） */
  ox: number;
  oy: number;
  /** 播放到的分钟、时钟倍速、正在播的航迹所属的日子、航行视图的日子与分钟 */
  pm: number | null;
  spd: number;
  cd: number;
  nd: number;
  nm: number;
}

/** 缓存里的一块瓦片：RGBA（还没转成画布时）与画布。 */
interface TileEntry {
  img: RgbaImage | null;
  canvas: HTMLCanvasElement | null;
  w: number;
  h: number;
}

/** 高清瓦片与它的迷雾：后台线程转好的位图，或 RGBA（第一次画的时候再转成画布）。 */
interface HdEntry {
  bitmap: ImageBitmap | null;
  rgba: Uint8ClampedArray<ArrayBuffer> | null;
  canvas: HTMLCanvasElement | null;
  w: number;
  h: number;
  /** 迷雾：这一块没有未探明的格（不必贴） */
  empty?: boolean;
  /** 迷雾：已过期（新的在路上；旧的只会比新的多盖，先用着） */
  stale?: boolean;
}

/** 高清缓存里一项占的字节。 */
function hdEntryBytes(e: HdEntry): number {
  return e.empty ? 64 : e.w * e.h * 4;
}

/** 量高清瓦片用（实机测时由页面脚本放一个数组到 globalThis.__hdPerf；平时不存在，不记）。 */
interface HdPerfEntry {
  at: number;
  key: string;
  ms: number;
  k: number;
}

/** RGBA → 画布（没有 2D 画布时为 null）。 */
function canvasOf(img: RgbaImage): HTMLCanvasElement | null {
  if (typeof document === "undefined") return null;
  const c = document.createElement("canvas");
  c.width = img.w;
  c.height = img.h;
  const ctx = c.getContext("2d");
  if (!ctx) return null;
  ctx.putImageData(new ImageData(img.data, img.w, img.h), 0, 0);
  return c;
}

/** 按最近邻放大 k 倍（平滑缩小时边缘才清楚）。没有画布时为 null。 */
function upscale(src: HTMLCanvasElement | null, k: number): HTMLCanvasElement | null {
  if (!src || typeof document === "undefined") return null;
  const c = document.createElement("canvas");
  c.width = src.width * k;
  c.height = src.height * k;
  const ctx = c.getContext("2d");
  if (!ctx) return src;
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(src, 0, 0, c.width, c.height);
  return c;
}

export interface NavCanvasProps {
  source: ChartSource;
  nav: NavView;
  overview: Overview | null;
  /** 固定的每格像素（测试用）；不给时用 navZoom.ts 的连续缩放（滚轮、按钮、记住上次的值） */
  zoom?: number;
}

export default function NavCanvas({ source, nav, overview, zoom }: NavCanvasProps) {
  const ref = useRef<HTMLCanvasElement>(null);
  const hubRef = useRef<ChartHub | null>(null);
  const cache = useRef<LruCache<TileEntry> | null>(null);
  /** 高清瓦片（H10c）：地形与迷雾的缓存、线程池、在路上的迷雾请求、上一次报给线程池的清单 */
  const hd = useRef<{
    lru: LruCache<HdEntry>;
    fog: LruCache<HdEntry>;
    pool: HdPool;
    fogInflight: Set<string>;
    lastWant: string;
    /** 连同四周三格都已揭开的块（不必贴迷雾） */
    clear: Set<string>;
  } | null>(null);
  /** 记下一块高清迷雾是在哪个迷雾版本时请求的 */
  const fogAskedRef = useRef<((key: string) => void) | null>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const season = overview?.season ?? 1;
  const statics = source.statics;
  const W = statics.map.width;
  const H = statics.map.height;
  const wrap = source.wrap;
  const fogMap = source.fogMap;
  const kind = navZoomKind(source);
  const ports = useMemo(() => sightedPorts(statics, overview), [statics, overview]);

  // 最新的绘制参数（动画循环里读，不触发重渲染）
  const live = useRef({ nav, zoom, season, statics, ports, kind });
  /** H06：上一帧摆好的别的船（点海面时判断点中了哪条） */
  const placed = useRef<PlacedShip[]>([]);
  /** 上一帧的镜头与画面上的船位（点海面时换算） */
  const camAt = useRef<NavCamera | null>(null);
  const shipAt = useRef<{ x: number; y: number } | null>(null);
  useEffect(() => {
    live.current = { nav, zoom, season, statics, ports, kind };
  });

  // 共用海图的后台线程：瓦片就绪时放进缓存；迷雾变化时作废相关的瓦片
  useEffect(() => {
    const hub = acquireChartHub(source.hubKey, source.input);
    hubRef.current = hub;
    // 瓦片的配额 = 总预算（桌面 200 MB、手机 120 MB）扣掉这张图的基础缓冲（整图、迷雾、世界图），至少留约 10 块（map/memory.ts）
    const ledger = `${source.hubKey}:tiles`;
    const detail = hub.detail;
    // 经典世界的旧瓦片：按总预算扣掉基础缓冲（寰宇走下面的高清瓦片，这一份不用）
    const lru = new LruCache<TileEntry>(
      tileBudget(source.input.width, source.input.height, worldScaleOf(source.input.width, source.input.height)),
      (e) => imageBytes(e),
      () => account(ledger, lru.bytes),
    );
    // 迷雾的版本：每次变化加一；记下每块高清迷雾最后一次变化与最后一次请求时的版本
    let fogEpoch = 0;
    const fogDirty = new Map<string, number>();
    const fogAsked = new Map<string, number>();
    fogAskedRef.current = (key) => fogAsked.set(key, fogEpoch);
    // 高清瓦片（H10c，只有带细图层的地图）：地形与迷雾各一份缓存；位图被挤出去时释放
    const releaseHd = (_k: string, e: HdEntry) => e.bitmap?.close();
    const hdLru = detail ? new LruCache<HdEntry>(HD_BUDGET, hdEntryBytes, releaseHd) : null;
    const hdFogLru = detail ? new LruCache<HdEntry>(HD_FOG_BUDGET, hdEntryBytes, releaseHd) : null;
    const pool = detail ? acquireHdPool(source.hubKey, source.input) : null;
    const note = () => account(ledger, lru.bytes + (hdLru?.bytes ?? 0) + (hdFogLru?.bytes ?? 0));
    hd.current = hdLru && hdFogLru && pool ? { lru: hdLru, fog: hdFogLru, pool, fogInflight: new Set(), lastWant: "", clear: new Set() } : null;
    cache.current = lru;
    const unpool = pool?.subscribe((r: HdTileResult) => {
      if (!hdLru) return;
      hdLru.set(r.req.key, { bitmap: r.bitmap, rgba: r.bitmap ? null : r.rgba, canvas: null, w: r.w, h: r.h });
      note();
      const perf = (globalThis as { __hdPerf?: HdPerfEntry[] }).__hdPerf;
      perf?.push({ at: performance.now(), key: r.req.key, ms: r.ms, k: r.req.k });
    });
    const T = detail ? HD_TILE : NAV_TILE;
    const unsub = hub.subscribe({
      tile: (s, tx, ty, img) => {
        if (detail) return;
        const canvas = canvasOf(img);
        lru.set(tileKey(s, tx, ty), { img: canvas ? null : img, canvas, w: img.w, h: img.h });
        account(ledger, lru.bytes);
      },
      hdFog: (tx, ty, k, img) => {
        const h = hd.current;
        if (!h) return;
        const key = `${k}:${tx}:${ty}`;
        h.fogInflight.delete(key);
        // 请求之后迷雾又变过：这一份已经过期（照样先用着，比新的多盖一点），下一帧再要
        const stale = (fogDirty.get(key) ?? -1) > (fogAsked.get(key) ?? -1);
        h.fog.set(key, img ? { bitmap: null, rgba: img.data, canvas: null, w: img.w, h: img.h, stale } : { bitmap: null, rgba: null, canvas: null, w: 0, h: 0, empty: true, stale });
        note();
      },
      // 迷雾的变化可能分成几块（远隔的几处揭雾各一块），每块各回调一次
      fog: (_img, cells) => {
        if (!cells) return;
        if (hdFogLru) {
          // 高清瓦片：地形不受迷雾影响；相交的迷雾标成过期（留着用，新的到了再换）。迷雾的边缘伸得到三格之外
          fogEpoch++;
          // 整张重同步（读档等）：“已全揭开”的记录作废
          if (cells === "all") hd.current?.clear.clear();
          for (const key of hdFogLru.keys()) {
            const p = /^(\d+):(-?\d+):(-?\d+)$/.exec(key);
            if (!p) continue;
            const x0 = Number(p[2]) * T - 3;
            const y0 = Number(p[3]) * T - 3;
            if (cells !== "all" && (cells.x1 < x0 || cells.x0 > x0 + T + 6 || cells.y1 < y0 || cells.y0 > y0 + T + 6)) continue;
            const e = hdFogLru.peek(key);
            if (e) e.stale = true;
            fogDirty.set(key, fogEpoch);
          }
          return;
        }
        if (cells === "all") lru.clear();
        else {
          // 迷雾的边缘会影响到两格之外：相交的瓦片作废，重新生成
          lru.dropWhere((k) => {
            const at = parseTileKey(k);
            if (!at) return false;
            const x0 = at.tx * T - 2;
            const y0 = at.ty * T - 2;
            return !(cells.x1 < x0 || cells.x0 > x0 + T + 4 || cells.y1 < y0 || cells.y0 > y0 + T + 4);
          });
        }
      },
    });
    // 后台线程要知道当前的季节（世界图也用同一个）。细节瓦片不从整张海图裁：带细图层的地图不必在这里画整张图（要好几秒）
    if (!detail) hub.jobs.chart(live.current.season);
    // 迷雾：从迷雾的 store 喂给后台线程（与世界图的渲染器共用一份喂法；大地图给位图与区间，经典世界给文本）
    const detachFog = attachFogFeed(hub, source.fogMap);
    return () => {
      detachFog();
      unsub();
      unpool?.();
      pool?.release();
      lru.clear();
      hdLru?.clear();
      hdFogLru?.clear();
      account(ledger, 0);
      cache.current = null;
      hd.current = null;
      fogAskedRef.current = null;
      hubRef.current = null;
      hub.release();
    };
  }, [source]);

  // 画布大小跟随容器
  useEffect(() => {
    const el = ref.current?.parentElement;
    if (!el) return;
    const sync = () => setSize({ w: el.clientWidth, h: el.clientHeight });
    sync();
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(sync) : null;
    ro?.observe(el);
    return () => ro?.disconnect();
  }, []);


  // 动画循环：有 2D 画布时才跑
  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext("2d") ?? null;
    if (!canvas || !ctx || size.w <= 0 || size.h <= 0 || typeof requestAnimationFrame !== "function") return;
    const dpr = typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1;
    canvas.width = Math.round(size.w * dpr);
    canvas.height = Math.round(size.h * dpr);
    // 船图：先按最近邻放大 SHIP_UP 倍，画的时候再平滑缩到屏上的船长（H10c 换成高清俯视图时直接换这里的图）
    const shipArts = new Map<string, HTMLCanvasElement | null>();
    const shipArt = (sail: string, f: number) => {
      const k = `${sail}:${f}`;
      if (!shipArts.has(k)) shipArts.set(k, upscale(toCanvas(drawShipTop(sail as NavView["sail"], f)), SHIP_UP));
      return shipArts.get(k) ?? null;
    };
    const anchor = toCanvas(drawAnchorMark(true));
    let raf = 0;
    const t0 = performance.now();
    const others = new OthersMotion();
    let previousPreview: CoursePreview | null | undefined;
    let previewPoints: (readonly [number, number])[] | null = null;
    let previousNav: NavView | undefined;
    let previousCourse: CoursePreview | null | undefined;
    let stops: { x: number; y: number; kind: NavView["stops"][number]["kind"] }[] = [];
    // 镜头：画面缩放（朝目标缓动）与镜头相对船的偏移（屏幕像素：沿航向前视，缓动）
    let zShown: number | null = null;
    let lookState: LookState | null = null;
    let lastPos: { x: number; y: number } | null = null;
    let lastAt: number | null = null;
    let animating = false;
    // 上一帧画的时候各样东西的样子：有一样变了就立刻画；都没变、也没有在缓动的时按间隔画（只剩流线与船尾的浪在动）
    let drawnAt = Number.NEGATIVE_INFINITY;
    let drawn: readonly unknown[] = [];
    const frame = () => {
      raf = requestAnimationFrame(frame);
      const { nav: n, zoom: zFixed, season: s, statics: st, kind: zk } = live.current;
      const { course, preview, draft } = useNavStore.getState();
      const clock = useClockStore.getState();
      const at = performance.now();
      const zTarget = zFixed ?? useNavZoom.getState()[zk];
      const state: readonly unknown[] = [n, zTarget, s, st, course, preview, draft, clock.speed, clock.minute, clock.sampledAt, live.current.ports];
      const same = state.length === drawn.length && state.every((v, i) => v === drawn[i]);
      if (same && !animating && at - drawnAt < (clock.speed > 0 || draft !== null ? NAV_FRAME_MS : NAV_IDLE_FRAME_MS)) return;
      const dt = lastAt === null ? 0 : Math.max(0, Math.min(100, at - lastAt));
      // 镜头前视按两帧之间的实际间隔算（stepLook 里夹 1 秒）
      const lookDt = lastAt === null ? 0 : Math.max(0, at - lastAt);
      lastAt = at;
      drawnAt = at;
      drawn = state;
      const perf = (globalThis as { __navPerf?: NavPerfEntry[] }).__navPerf;
      const began = perf ? performance.now() : 0;

      // 缩放：朝目标缓动（约 0.1 秒），足够近了直接到
      const z = zShown === null || Math.abs(zShown - zTarget) < 0.05 ? zTarget : zShown + (zTarget - zShown) * (1 - Math.exp(-dt / ZOOM_TAU_MS));
      const zooming = z !== zTarget;
      zShown = z;

      // 船位与船头（navMotion：按航迹前后点算对地航向、换日不清空、误差 0.3 秒内缓掉）
      const m = flagshipMotion.sample(n, course, draft, clock, at, W, wrap);
      const pos = m ? { x: m.x, y: m.y } : n.pos;
      const heading = m?.heading ?? draft ?? n.heading;
      const minute = m?.minute ?? null;
      const played = m?.course ?? null;
      const playedDay = m?.courseDay ?? n.day;
      shipAt.current = pos;

      // 镜头：沿航向前视约 15% 屏宽；纵向最多前视三成屏高。
      // H10iF2：前视的方向取船头的慢平均、平移限速（navLook.ts），船头一变海图不再跟着甩；
      // 头一帧、读档 / 瞬移（船位一帧跳了 4 格以上）当场到位。
      // H10iF3：只有船真的停了（收帆、锚泊、停在停点上）才回正；暂停、等后端结算、跨日都不归零（X07：每天一呼一吸）
      const look = m && !m.still ? LOOK_AHEAD * size.w : 0;
      const maxY = 0.3 * size.h;
      const jumped = lastPos !== null && Math.hypot(wrapDx(lastPos.x, pos.x, W, wrap), pos.y - lastPos.y) > SNAP_CELLS;
      lastPos = pos;
      lookState = stepLook(lookState, heading, look, maxY, lookDt, jumped);
      const camOff = lookState.off;
      const panning = !lookSettled(lookState, heading, look, maxY);
      const cam: NavCamera = { cx: pos.x + camOff.x / z, cy: pos.y + camOff.y / z, cellPx: z, viewW: size.w, viewH: size.h, width: W, height: H, wrap };
      camAt.current = cam;
      // H10iF2 验收用的探针（只在开发模式下挂；正式包里这段被裁掉）：画出来的船头、镜头相对船的偏移、船的屏幕坐标、模式与游戏分钟
      if (import.meta.env.DEV) {
        const sp = toScreen(cam, pos.x, pos.y);
        (window as unknown as { __navProbe?: NavProbe }).__navProbe = Object.freeze({
          at,
          heading,
          helm: n.heading,
          camOff: Object.freeze({ x: camOff.x, y: camOff.y }),
          ship: Object.freeze({ sx: sp.sx, sy: sp.sy }),
          mode: n.autopilot?.mode ?? (n.autopilot ? "sail" : "manual"),
          day: minute === null ? playedDay : playedDay + Math.floor(minute / MINUTES_PER_DAY),
          minute: minute === null ? null : minute - Math.floor(minute / MINUTES_PER_DAY) * MINUTES_PER_DAY,
          speed: clock.speed,
          waiting: m?.waiting ?? false,
          source: !m || m.minute === null ? "none" : m.predicted ? "predicted" : "authoritative",
          leadMs: m?.leadMs ?? 0,
          leadMin: m?.leadMin ?? 0,
          leadEstMin: m?.leadEstMin ?? 0,
          lastFix: m?.lastFix ?? null,
          still: m?.still ?? true,
        });
      }

      if (preview !== previousPreview) {
        previewPoints = preview ? preview.points.map(([x, y]) => [x, y] as const) : null;
        previousPreview = preview;
      }
      if (n !== previousNav || played !== previousCourse) {
        // 会停下的地方：航行视图与正在播的航迹是同一天的才画（换日后、新航迹到之前先不画）
        stops =
          played !== null && playedDay === n.day
            ? (n.stops ?? []).flatMap((stop) => {
                const p = positionAt(played.points, stop.minute, W, wrap);
                return p ? [{ x: p.x, y: p.y, kind: stop.kind }] : [];
              })
            : [];
        previousNav = n;
        previousCourse = played;
      }
      // 航迹线：按播放到的分钟切成“走过 / 预测”
      const lines = splitTrail(n, played, playedDay, minute, pos);

      const time = performance.now() - t0;
      const lru = cache.current;
      const hub = hubRef.current;
      const h = hd.current;
      const detail = hub?.detail === true && h !== null;
      const rows = st.map.rows;
      // 高清瓦片：先要视野里的低清垫底，再要视野里的高清，再要视野外一圈（船走过去时已经画好）；迷雾同样先低清后高清
      let converts = CONVERT_PER_FRAME;
      const hdCount: [number, number, number] = [0, 0, 0];
      // 揭开了没有：大地图直接查位图（不建文本），经典世界查文本
      const fogAt = fogLookup(useChartFog.getState(), fogMap);
      const revealedAt = (x: number, y: number) => !fogAt || fogAt(x, y);
      /** 这一块连同四周三格都已揭开（迷雾只会越揭越多，记下来不再查）：不必等后台线程的迷雾 */
      const clearOf = (tx: number, ty: number): boolean => {
        const key = `${tx}:${ty}`;
        if (!h || !fogAt) return false;
        if (h.clear.has(key)) return true;
        for (let y = Math.max(0, ty * HD_TILE - 3); y < Math.min(H, ty * HD_TILE + HD_TILE + 3); y++)
          for (let x = tx * HD_TILE - 3; x < tx * HD_TILE + HD_TILE + 3; x++) if (!fogAt(wrap ? modX(x, W) : Math.max(0, Math.min(W - 1, x)), y)) return false;
        h.clear.add(key);
        return true;
      };
      // 精度的档：正式的每格 96 像素；放大到一格 168 个设备像素以上（96 的要拉伸 1.75 倍以上）再要每格 192 像素的
      const tiers = z * dpr >= HD_FINE_AT ? [HD_FINE_K, HD_K] : [HD_K];
      if (detail && hub && h) {
        const view = cameraTiles(cam, HD_TILE);
        const inView = new Set(view.map((v) => `${v.tx}:${v.ty}`));
        const ring = cameraTiles(cam, HD_TILE, HD_TILE * z).filter((v) => !inView.has(`${v.tx}:${v.ty}`));
        const want: HdTileRequest[] = [];
        const add = (slots: typeof view) => {
          for (const v of slots) {
            const low = hdTileKey(HD_PREVIEW_K, s, v.tx, v.ty);
            if (!h.lru.has(low) && !tiers.some((k) => h.lru.has(hdTileKey(k, s, v.tx, v.ty)))) want.push({ key: low, season: s, tx: v.tx, ty: v.ty, k: HD_PREVIEW_K });
          }
          // 先补齐正式精度，再要更细的一档
          for (const k of [...tiers].reverse()) {
            for (const v of slots) {
              const key = hdTileKey(k, s, v.tx, v.ty);
              if (!h.lru.has(key)) want.push({ key, season: s, tx: v.tx, ty: v.ty, k });
            }
          }
        };
        add(view);
        add(ring);
        const sig = want.map((r) => r.key).join("|");
        if (sig !== h.lastWant) {
          h.lastWant = sig;
          h.pool.want(want);
        }
        for (const k of [HD_PREVIEW_K, HD_K]) {
          for (const v of [...view, ...ring]) {
            if (clearOf(v.tx, v.ty)) continue;
            const key = `${k}:${v.tx}:${v.ty}`;
            const e = h.fog.peek(key);
            if ((e && !e.stale) || h.fogInflight.has(key)) continue;
            h.fogInflight.add(key);
            fogAskedRef.current?.(key);
            hub.jobs.hdFog(v.tx, v.ty, k);
          }
        }
      }
      /** 一项高清缓存的图（RGBA 的第一次画时转成画布，每帧至多转几块） */
      const hdImage = (e: HdEntry | undefined): CanvasImageSource | null => {
        if (!e) return null;
        if (e.bitmap) return e.bitmap;
        if (e.canvas) return e.canvas;
        if (!e.rgba || converts <= 0) return null;
        converts--;
        e.canvas = canvasOf({ x: 0, y: 0, w: e.w, h: e.h, data: e.rgba });
        if (e.canvas) e.rgba = null;
        return e.canvas;
      };
      // 别的船：与自己的船同一套平滑（分钟按航行视图那一天算）
      const shipMinute = minute === null ? null : minute + (playedDay - n.day) * MINUTES_PER_DAY;
      const ships = (placed.current = n.ships ? others.place(n.ships, shipMinute, n, at, W, wrap) : []);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      drawNav(ctx, {
        cam,
        tilePx: detail ? HD_K * 24 : NAV_CELL_PX,
        tileCells: detail ? HD_TILE : NAV_TILE,
        // 笔画与港口锚标不跟着地图一起放大（H10a）：缺省每格 144 像素时笔画基准 18 像素（与改动前缺省档一样粗），锚标 2 倍
        unitPx: detail ? Math.max(14, Math.min(26, z * 0.125)) : undefined,
        spriteScale: detail ? (z >= 200 ? 3 : 2) : undefined,
        smoothTiles: detail,
        tile: (slot) => {
          if (detail && h) {
            // 迷雾还没到（高清、低清都没有，也不是整块都已揭开）就先不露出地形（免得先看见没探明的海）
            const clear = clearOf(slot.tx, slot.ty);
            if (!clear && !h.fog.peek(`${HD_K}:${slot.tx}:${slot.ty}`) && !h.fog.peek(`${HD_PREVIEW_K}:${slot.tx}:${slot.ty}`)) {
              hdCount[2]++;
              return null;
            }
            // 高清（最细的一档优先）→ 低清垫底 → 换季时先借别的季节的（上一季优先），都没有才是羊皮纸色
            for (const k of tiers) {
              const full = hdImage(h.lru.get(hdTileKey(k, s, slot.tx, slot.ty)));
              if (full) {
                hdCount[0]++;
                return full;
              }
            }
            let img = hdImage(h.lru.get(hdTileKey(HD_PREVIEW_K, s, slot.tx, slot.ty)));
            for (const back of [3, 2, 1]) {
              if (img) break;
              img = hdImage(h.lru.peek(hdTileKey(HD_K, (s + back) % 4, slot.tx, slot.ty))) ?? hdImage(h.lru.peek(hdTileKey(HD_PREVIEW_K, (s + back) % 4, slot.tx, slot.ty)));
            }
            hdCount[img ? 1 : 2]++;
            return img;
          }
          const key = tileKey(s, slot.tx, slot.ty);
          const e = lru?.get(key);
          if (!e) {
            hub?.jobs.tile(s, slot.tx, slot.ty);
            return null;
          }
          if (!e.canvas && e.img) {
            e.canvas = canvasOf(e.img);
            if (e.canvas) e.img = null;
          }
          return e.canvas;
        },
        overlay:
          detail && h
            ? (slot) => {
                if (clearOf(slot.tx, slot.ty)) return null;
                // 高清的迷雾优先；还没到（或这一帧转不过来）时用低清的
                const fe = h.fog.get(`${HD_K}:${slot.tx}:${slot.ty}`);
                if (fe?.empty) return null;
                const img = hdImage(fe);
                if (img) return img;
                const le = h.fog.get(`${HD_PREVIEW_K}:${slot.tx}:${slot.ty}`);
                if (le?.empty) return null;
                return hdImage(le);
              }
            : undefined,
        ship: {
          x: pos.x,
          y: pos.y,
          heading,
          // H10iF 抢风：船图没有迎风调帆的画法，照满帆画（帆一直吃着风）
          art: shipArt(n.autopilot?.mode === "beat" ? "full" : n.sail, Math.floor(time / 400) % 2),
          artW: SHIP_TOP_W,
          artH: SHIP_TOP_H,
          lengthPx: shipLengthPx(z),
        },
        otherLengthPx: otherShipLengthPx(z),
        sight: n.sight,
        trail: lines.walked,
        forecast: lines.ahead,
        preview: previewPoints,
        stops,
        ports: live.current.ports,
        portArt: anchor,
        portArtW: 11,
        portArtH: 12,
        wind: n.wind ? { dir: n.wind.dir, force: n.wind.force } : null,
        current: n.current,
        time,
        labelFont: LABEL_FONT,
        seaAt: (x, y) => (rows[y]?.[x] ?? "#") !== "#" && revealedAt(x, y),
        revealedAt,
        cells: n.cells,
        ships,
        minute: shipMinute,
        sightings: n.sightings?.marks,
        quest: questMarkTarget(),
      });
      animating = (m?.animating ?? false) || others.animating || zooming || panning;
      if (perf) {
        perf.push({ at, ms: performance.now() - began, hd: hdCount, day: clock.day, minute: clock.minute, z, x: pos.x, y: pos.y, heading, ox: camOff.x, oy: camOff.y, pm: minute, spd: clock.speed, cd: playedDay, nd: n.day, nm: n.minute });
        if (perf.length > 20000) perf.splice(0, perf.length - 20000);
      }
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [size, W, H, wrap, fogMap]);

  // 滚轮连续缩放（以船为中心：镜头相对船的偏移按屏幕像素记，缩放时船在屏上的位置不变）。要拦下页面滚动，所以用原生的非被动监听
  useEffect(() => {
    const el = ref.current;
    if (!el || zoom !== undefined) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const unit = e.deltaMode === 1 ? 33 : e.deltaMode === 2 ? 300 : 1;
      wheelNavZoom(kind, e.deltaY * unit);
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [kind, zoom]);

  // 点海面（没有拖动）：把航向转向那一点（H06：点中了能喊话的船就打开喊话卡片）
  const down = useRef<{ x: number; y: number } | null>(null);
  return (
    <canvas
      ref={ref}
      className="nav-canvas"
      role="img"
      aria-label={t("nav.map")}
      data-testid="nav-canvas"
      style={{ width: "100%", height: "100%" }}
      onPointerDown={(e) => {
        down.current = { x: e.clientX, y: e.clientY };
      }}
      onPointerUp={(e) => {
        const d = down.current;
        down.current = null;
        if (!d || Math.hypot(e.clientX - d.x, e.clientY - d.y) > 6) return;
        const r = e.currentTarget.getBoundingClientRect();
        const sx = e.clientX - r.left;
        const sy = e.clientY - r.top;
        // 镜头不一定正对着船（前视）：按上一帧的镜头换成格坐标，再取相对画面上的船的方向
        const ship = shipAt.current ?? nav.pos;
        const cam: NavCamera = camAt.current ?? {
          cx: ship.x,
          cy: ship.y,
          cellPx: zoom ?? useNavZoom.getState()[kind],
          viewW: r.width,
          viewH: r.height,
          width: W,
          height: H,
          wrap,
        };
        const c = toCell(cam, sx, sy);
        if (pickHail(placed.current, wrap ? modX(c.x, W) : c.x, c.y)) return;
        const h = headingToward(wrapDx(ship.x, c.x, W, wrap), c.y - ship.y);
        if (h !== null) void steerTo(h);
      }}
    />
  );
}
