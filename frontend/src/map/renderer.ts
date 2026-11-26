// PixiJS 航海图：像素海图位图（最近邻缩放）、港口与城市标记、殖民点与发现物、道路、舰队与商队精灵、航线点线、
// 风向箭头、迷雾纹理、选中框与旗舰标记。支持拖动平移、滚轮缩放（整数倍为主），航行时镜头跟随旗舰队。
// 触屏（网页自适应）：一指拖动、双指缩放（松手时对齐到最近的档位），点别家船队显示信息卡；镜头的计算在 camera.ts。
// 美术全部来自 art/map.ts 与 art/ships.ts（纯函数生成的像素图）；这里只负责摆放、动画与交互。
// 按需加载 pixi.js，初始化失败（例如没有 WebGL）时由调用方回退到地点列表。
//
// 大地图（400×170 格 = 1600×680 像素）：海图与迷雾按块（每块不超过 MAX_TILE）贴成画布纹理。
// 整张海图（约 0.3 秒）与迷雾（初始化约 0.3 秒）交给后台线程生成（chartJobs.ts），不卡界面；
// 海图就绪前先显示海色底，迷雾到位后才淡入海图（不会先露出未探索的区域）。季节切换时下一季已预先生成好，直接换图。
// 迷雾增量重画，只把变化的矩形写回画布并重新上传所在的块。每帧只移动精灵、换动画帧，不重画整张图。
//
// 昼夜与天气（EXPANSION.md §9.3）：夜里整张海图叠一层深蓝（港口与城市亮起灯火，地点与舰队标记压暗偏蓝），
// 浓度由 setNight 给出（光照不跟随时钟时为 0），时段切换时淡入淡出；各海区当天的天况标记（云团、雨、雾、
// 暴风雨、雪）平铺在海区里、随当天的风向缓缓漂移，画在迷雾之下（未探索的海域看不见），数量有上限。
// 天气特效：按海区的压暗与雾在海图之上、天况标记之下，斜落的雨线、雪片与闪电照亮在
// 天况标记之上，都在迷雾之下；开关与减少动态效果由 setWeatherFx 给出。
//
// 第九批（FRAMEWORK §5.2、§5.4）：
// - 东西相连的地图（ChartInput.wrapX）：相机横向无限平移（按一整张图的宽度取模），海图与迷雾在左右各多贴一份；
//   地点、舰队、航线、风向与天况标记都摆在离视野中心最近的那一份上（wrap.ts 的 nearestCopy），点选按宽度取模；
// - 大地图（1080 × 396）的世界图每格 2 像素（纹理放大 2 倍贴上），海图的计算与航行视图共用一个后台线程（chartHub.ts）；
// - 看见过的地点（Overview.sighted）：给出时只画看见过的地点，没看见的不画、不能点选。
// - 大地图的迷雾（性能商议 2026-10-07）：给了 opts.fogMap 时渲染器直接从迷雾的 store（map/fogStore.ts）把位图与区间
//   喂给后台线程，不再经过整张文本；地点是否揭开按位图查。经典世界照旧由 setFog 给文本。
import type { Container, Sprite, Text, Texture } from "pixi.js";
import {
  CHART_CELL,
  CHART_FRAME,
  FLAGSHIP_FRAMES,
  FLASH_FRAMES,
  PLAYER_FLAG,
  SELECT_FRAMES,
  WEATHER_FRAMES,
  WIND_DIRS,
  chartInput,
  drawCaravanMarker,
  drawChevron,
  drawCityMarker,
  drawCompassRose,
  drawDestPin,
  drawDiscoveryFlash,
  drawDiscoveryMarker,
  drawFlagshipRing,
  drawPlaceDot,
  drawPortLight,
  drawPortMarker,
  drawRouteDot,
  drawSelectFrame,
  drawSiteMarker,
  drawWake,
  drawWeatherMark,
  drawWindArrow,
  markerStyle,
  siteMarkKey,
} from "../art/map";
import { P } from "../art/palette";
import type { Px } from "../art/px";
import { toCanvas } from "../art/render";
import { hash32 } from "../art/rng";
import { drawShipByKey, shipArtKey, SHIP_FRAMES } from "../art/ships";
import { useNavStore } from "../hooks/useNavigation";
import { useVoyageStore } from "../hooks/useVoyage";
import { tk } from "../i18n";
import { currentLocale } from "../i18n/locale";
import type { ChartInput } from "../art/map";
import { locById } from "../ipc/byId";
import type { FoundView, LocView, Overview, StaticView } from "../ipc/types";
import { useGame } from "../store/game";
import { declutter, detailMarkerScale, markerScale, pinchOf, pinchScale, snapScale, stepScale, zoomAt, type Box } from "./camera";
import { acquireChartHub, chartHubKey } from "./chartHub";
import type { RgbaImage } from "./chartWork";
import { attachFogFeed, fogLookup, rowsLookup, useChartFog, type FogLookup } from "./fogStore";
import { account } from "./memory";
import { DETAIL_BUDGET, DETAIL_CELL_PX, DETAIL_TILE_CELLS, LruCache, tileKey, visibleTiles } from "./tiles";
import { nearestCopy, unwrapPath, wrapCamX, wrapDx } from "./wrap";
import { useFoundStore } from "./found";
import { CONDITION_COLORS, OTHER_FLAGS, discoveryMarks, isSite, portConditions, siteMark, siteStates, type SiteState } from "./marks";
import {
  DRIFT_TRAVEL,
  MARK_ALPHA,
  NIGHT_COLOR,
  approachNight,
  driftOffset,
  marksSignature,
  nightAlpha,
  placeTint,
  regionSamples,
  weatherMarks,
  type WeatherMark,
} from "./weather";
import { createWeatherLayer, type WeatherFxOptions } from "./weatherLayer";
import { sampleFlagship } from "./navMotion";
import { dayLengthMs } from "../time/daylight";
import { createChartCells } from "./chartCells";
import { createMonsoonLayer } from "./monsoonLayer";
import type { MonsoonView } from "../ipc/routing";
import { watchMapVisibility } from "./visibility";

/** 悬停在别家船队标记上：概览 others 里的下标、所属商会，以及标记在画布上的位置（CSS 像素，相对画布左上角）。 */
export interface FleetHover {
  index: number;
  owner: string;
  owner_en?: string;
  x: number;
  y: number;
}

export interface MapRenderer {
  /** 登记“悬停别家船队”的回调：指针移到别家船队的标记上（或移开，为 null）时调用，只在变化时调用；传 null 取消。 */
  setHoverFleet?: (cb: ((hit: FleetHover | null) => void) | null) => void;
  update: (o: Overview | null, selectedLoc: number | null) => void;
  /** 更新迷雾（每行一个字符串，'1' 为已揭开）。 */
  setFog: (rows: string[]) => void;
  /** 迷雾直接取自迷雾的 store（创建时给了 fogMap）：调用方不必再用 setFog 交整张文本。 */
  fogFromStore?: boolean;
  /** 夜色浓度 0..1（见 map/weather.ts 的 chartNight；光照不跟随时钟时为 0）。第一次立即生效，之后淡入淡出。 */
  setNight?: (amount: number) => void;
  /** 天气特效的开关：设置里的“天气特效”、减少动态效果、海图自己闪不闪电（见 map/weatherLayer.ts）。 */
  setWeatherFx?: (opts: WeatherFxOptions) => void;
  /** H07 季风历：按月的风向流线与洋流（null 收起；见 map/monsoonLayer.ts）；reduced 为减少动态效果。 */
  setMonsoon?: (data: MonsoonView | null, reduced?: boolean) => void;
  /** 缩放一档（1 放大、-1 缩小），以视野中心为准（网页自适应：海图上的缩放按钮）。 */
  zoomBy?: (dir: 1 | -1) => void;
  /** 看全图。 */
  zoomFit?: () => void;
  /** R10-Q02：格坐标（可带小数，格中心是 +0.5）→ 画布上的位置（CSS 像素）。只读，给 DOM 叠层用。 */
  cellToScreen?: (x: number, y: number) => { x: number; y: number };
  destroy: () => void;
}

const C = CHART_CELL;
/** 缩放档位（除“看全图”外都是整数或半整数，像素不走样）。 */
const ZOOMS = [1, 1.5, 2, 3, 4, 6];
/** 大地图（寰宇）的缺省镜头倍数：每格 12 像素（原来与经典世界一样是 2）。 */
export const BIG_MAP_ZOOM = 3;
/**
 * 带细图层的大地图（寰宇，M01“细海图”）的档位：远档沿用整张海图（一格 4–12 屏幕像素），
 * 近档用细节瓦片——镜头 6 / 12 / 18 倍，一格 24 / 48 / 72 屏幕像素，正好是细节美术像素的 1× / 2× / 3×（整数倍、最近邻，不糊）。
 */
const DETAIL_ZOOMS = [1, 1.5, 2, 3, 6, 12, 18];
/** 带细图层的大地图的缺省镜头倍数：一格 48 屏幕像素。 */
export const DETAIL_MAP_ZOOM = 12;
/** 镜头到这个倍数（一格 24 屏幕像素）起改用细节瓦片。 */
export const DETAIL_MIN_ZOOM = DETAIL_CELL_PX / CHART_CELL;
/** 世界图的帧率上限：有东西在平滑地动时与平时（见动画循环末尾）。 */
export const BUSY_FPS = 60;
export const IDLE_FPS = 30;
/** 单张纹理的最大边长：更大的位图切成多块贴图（各 WebGL 实现都支持 2048）。 */
const MAX_TILE = 2048;
/** 殖民点与发现物的名字在放大到这个倍数以上时才显示（地点多，缩小时只显示港口名）。 */
const MINOR_LABEL_SCALE = 1.5;
/** 缩到这个倍数以下（窄窗口看全图）时连港口名也不显示。 */
const PORT_LABEL_SCALE = 0.45;
const LABEL_FONT = '"Microsoft YaHei", "PingFang SC", "Noto Sans CJK SC", sans-serif';
/** 地名下方英文小行的字体（双行名字，EXPANSION.md §12.3） */
const LABEL_FONT_LATIN = 'Georgia, "Palatino Linotype", "Times New Roman", serif';
/** 新发现物闪现的时长（毫秒）与每帧时长。 */
const FLASH_MS = 3600;
const FLASH_FRAME_MS = 120;
/** 海图淡入的时长（毫秒）。 */
const TERRAIN_FADE_MS = 360;

/** 格中心的像素坐标。 */
const cx = (x: number) => x * C + C / 2;

interface Unit {
  root: Container;
  body: Sprite;
  ring?: Sprite;
  chev?: Sprite;
  wake?: Sprite;
  /** 当前显示位置与目标位置（海图像素） */
  x: number;
  y: number;
  tx: number;
  ty: number;
  /** 1 朝右，-1 朝左 */
  face: 1 | -1;
  /** 生成精灵纹理的参数 */
  art: (frame: number, face: 1 | -1) => [string, () => Px];
  /** 相对所在位置的偏移（标记的美术像素：停泊的船靠在码头右侧、商队站在城门旁），大地图上按标记的倍数摆 */
  ox: number;
  oy: number;
  moving: boolean;
  phase: number;
  seen: boolean;
  /** H10a：朝目标匀速滑过去的速度（海图像素 / 毫秒）：推送一次、匀速走到下一次推送，不再“推送一次跳一次” */
  vx?: number;
  vy?: number;
}

/** 第九批的可选参数：海图输入（含投影与环绕；缺省由静态数据整理）与共用后台线程的键。 */
export interface MapRendererOpts {
  input?: ChartInput;
  hubKey?: string;
  /** 大地图：迷雾取自迷雾的 store 里这张地图的（map/fogStore.ts 的 fogMapKey），位图与区间直接喂给后台线程 */
  fogMap?: string;
}

export async function createMapRenderer(
  container: HTMLElement,
  statics: StaticView,
  onPick: (loc: number) => void,
  opts: MapRendererOpts = {},
): Promise<MapRenderer> {
  const PIXI = await import("pixi.js");
  const app = new PIXI.Application();
  await app.init({
    background: P.sea[0],
    width: Math.max(1, container.clientWidth),
    height: Math.max(1, container.clientHeight),
    antialias: false,
    roundPixels: true,
    resolution: typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1,
    autoDensity: true,
  });
  container.appendChild(app.canvas);
  app.canvas.style.imageRendering = "pixelated";
  app.canvas.style.display = "block";

  let destroyed = false;
  /** 动画时钟（毫秒）与上一次重画精灵时的帧号 */
  let elapsed = 0;
  let frameNo = -1;
  const W = statics.map.width;
  const H = statics.map.height;
  const MW = W * C;
  const MH = H * C;
  const input = opts.input ?? chartInput(statics);
  /** 东西相连（相机横向无限平移） */
  const wrap = input.wrapX === true;
  /** 海图坐标 x 摆在离视野中心最近的那一份上（不环绕时原样） */
  const atView = (x: number) => (wrap ? nearestCopy(x, viewWorldX(), MW, true) : x);

  // —— 纹理缓存：同一张像素图只上传一次 ——
  const textures = new Map<string, Texture>();
  const texFromCanvas = (canvas: HTMLCanvasElement | null): Texture => {
    if (!canvas) return PIXI.Texture.EMPTY;
    const source = new PIXI.CanvasSource({ resource: canvas });
    source.scaleMode = "nearest";
    return new PIXI.Texture({ source });
  };
  const tex = (key: string, make: () => Px): Texture => {
    let t = textures.get(key);
    if (!t) {
      t = texFromCanvas(toCanvas(make()));
      textures.set(key, t);
    }
    return t;
  };

  // —— 分块贴图：大位图切成不超过 MAX_TILE 的块，每块一张画布纹理；可以只重画其中一个矩形 ——
  interface Tile {
    x: number;
    y: number;
    canvas: HTMLCanvasElement;
    tex: Texture;
  }
  // k：位图每像素占海图的几个像素（大地图的世界图每格 2 像素，k = 2）；环绕地图左右各多贴一份（共用纹理）
  const tiled = (layer: Container, w: number, h: number, k = 1) => {
    const tiles: Tile[] = [];
    for (let ty = 0; ty < h; ty += MAX_TILE) {
      for (let tx = 0; tx < w; tx += MAX_TILE) {
        const canvas = document.createElement("canvas");
        canvas.width = Math.min(MAX_TILE, w - tx);
        canvas.height = Math.min(MAX_TILE, h - ty);
        const t = texFromCanvas(canvas);
        for (const off of wrap ? [-MW, 0, MW] : [0]) {
          const sprite = new PIXI.Sprite(t);
          sprite.position.set(tx * k + off, ty * k);
          sprite.scale.set(k);
          layer.addChild(sprite);
        }
        tiles.push({ x: tx, y: ty, canvas, tex: t });
      }
    }
    return {
      /** 把一块 RGBA 图（海图像素坐标）写到对应的块上，并让 GPU 重新上传这些块。 */
      put(img: RgbaImage) {
        if (img.w <= 0 || img.h <= 0) return;
        let data: ImageData | null = null;
        for (const t of tiles) {
          const x0 = Math.max(img.x, t.x);
          const y0 = Math.max(img.y, t.y);
          const x1 = Math.min(img.x + img.w, t.x + t.canvas.width);
          const y1 = Math.min(img.y + img.h, t.y + t.canvas.height);
          if (x1 <= x0 || y1 <= y0) continue;
          const ctx = t.canvas.getContext("2d");
          if (!ctx) continue;
          data ??= new ImageData(img.data, img.w, img.h);
          // 只写本块覆盖的部分（dirty 矩形以图的左上角为原点）
          ctx.putImageData(data, img.x - t.x, img.y - t.y, x0 - img.x, y0 - img.y, x1 - x0, y1 - y0);
          t.tex.source.update();
        }
      },
      destroy() {
        for (const t of tiles) if (t.tex !== PIXI.Texture.EMPTY) t.tex.destroy(true);
      },
    };
  };

  // —— 细节瓦片（M01“细海图”）：近档按需向后台线程要，纹理按字节 LRU；地形与迷雾各一张 ——
  interface DetailTex {
    tex: Texture | null;
    bytes: number;
  }
  /** 细节瓦片的纹理有变（到了新的一块、换季、迷雾作废）：下一帧重摆 */
  let detailDirty = false;
  /** 被淘汰的纹理不能还挂在精灵上 */
  const dropTexture = (e: DetailTex) => {
    if (!e.tex) return;
    for (const sp of detailSprites.values()) {
      if (sp.terrain.texture === e.tex) sp.terrain.texture = PIXI.Texture.EMPTY;
      if (sp.fog.texture === e.tex) sp.fog.texture = PIXI.Texture.EMPTY;
    }
    e.tex.destroy(true);
  };
  const detailTex = new LruCache<DetailTex>(DETAIL_BUDGET, (e) => e.bytes, (_k, e) => dropTexture(e));
  /** 迷雾瓦片：tex 为 null 表示这一块没有迷雾 */
  const detailFog = new LruCache<DetailTex>(DETAIL_BUDGET / 4, (e) => e.bytes, (_k, e) => dropTexture(e));
  const detailSprites = new Map<string, { terrain: Sprite; fog: Sprite; used: boolean }>();
  const texOfImage = (img: RgbaImage): Texture => {
    const canvas = document.createElement("canvas");
    canvas.width = img.w;
    canvas.height = img.h;
    canvas.getContext("2d")?.putImageData(new ImageData(img.data, img.w, img.h), 0, 0);
    return texFromCanvas(canvas);
  };
  const noteDetail = () => {
    detailDirty = true;
    account(`${hub.key}:detail`, detailTex.bytes + detailFog.bytes);
  };
  /** 迷雾变化涉及的格：相交的迷雾瓦片作废（迷雾的边缘伸到两格之外）。 */
  const dropDetailFog = (cells: { x0: number; y0: number; x1: number; y1: number } | "all") => {
    if (detailFog.size === 0) return;
    if (cells === "all") detailFog.clear();
    else {
      const T = DETAIL_TILE_CELLS;
      detailFog.dropWhere((key) => {
        const [tx, ty] = key.split(":").map(Number);
        return !(cells.x1 < tx * T - 2 || cells.x0 > tx * T + T + 2 || cells.y1 < ty * T - 2 || cells.y0 > ty * T + T + 2);
      });
    }
    noteDetail();
  };

  // —— 图层 ——
  const world = new PIXI.Container();
  app.stage.addChild(world);
  let season = useGame.getState().overview?.season ?? 1;
  // 海图的计算与航行视图共用一个后台线程（大地图的世界图每格 2 像素：scale = 2）
  const hub = acquireChartHub(opts.hubKey ?? chartHubKey(statics), input);
  const k = hub.scale;
  // 大地图（寰宇）：地点密，缺省镜头放大一档，标记的大小与镜头倍数分开算，地名互相避让；经典世界照旧
  const bigMap = k > 1;
  const terrainLayer = new PIXI.Container();
  // 整张海图（远档）与细节瓦片（近档，M01）各一层：近档的瓦片到齐以后整张的那层就不画了
  const terrainBase = new PIXI.Container();
  const detailLayer = new PIXI.Container();
  detailLayer.visible = false;
  terrainLayer.addChild(terrainBase, detailLayer);
  const terrain = tiled(terrainBase, Math.ceil(MW / k), Math.ceil(MH / k), k);
  /** 有细节瓦片（带细图层的寰宇）：档位、缺省镜头与标记的倍数都按细节美术的密度来 */
  const detail = hub.detail;
  const zooms = detail ? DETAIL_ZOOMS : ZOOMS;
  const weatherLayer = new PIXI.Container();
  const windLayer = new PIXI.Container();
  const routeLayer = new PIXI.Container();
  const otherLayer = new PIXI.Container();
  const fogLayer = new PIXI.Container();
  const fogBase = new PIXI.Container();
  const detailFogLayer = new PIXI.Container();
  detailFogLayer.visible = false;
  fogLayer.addChild(fogBase, detailFogLayer);
  const fog = tiled(fogBase, Math.ceil(MW / k), Math.ceil(MH / k), k);
  // 内存账本（map/memory.ts）：世界图的海图与迷雾两张画布（GPU 上另有一份纹理，不在这里记）
  const canvasLedger = `${hub.key}:canvas`;
  account(canvasLedger, 2 * Math.ceil(MW / k) * Math.ceil(MH / k) * 4);
  // 海图就绪、且迷雾到位后才显示海图（淡入），不会先露出未探索的区域。
  // 概览里还没有探索记录（fog_version 为 0）时没有迷雾可等；3 秒内一直没收到迷雾（查询失败）时照常显示。
  let chartReady = false;
  /** 近档的细节瓦片已经顶上来了（视野里的都到齐过一次）：之后还没到的块先盖一块羊皮纸色 */
  let nearActive = false;
  let fogReady = false;
  /** 已经收到过迷雾数据（在后台计算中） */
  let fogAsked = false;
  let fogGiveUp = false;
  let fadeStart: number | null = null;
  terrainLayer.visible = false;
  terrainLayer.alpha = 0;
  const fogExpected = () => !fogReady && !fogGiveUp && (useGame.getState().overview?.fog_version ?? 0) > 0;
  const showTerrain = () => {
    if (terrainLayer.visible || !(chartReady || nearActive) || fogExpected()) return;
    terrainLayer.visible = true;
    fadeStart = null;
  };
  const jobs = hub.jobs;
  const unsubHub = hub.subscribe({
    chart: (s, img) => {
      if (destroyed || s !== ((season % 4) + 4) % 4) return;
      terrain.put(img);
      chartReady = true;
      showTerrain();
    },
    fog: (img, cells) => {
      if (destroyed) return;
      if (img) fog.put(img);
      fogReady = true;
      showTerrain();
      // 细节瓦片的迷雾：变化涉及的几块作废、重新要（地形不受迷雾影响，不动）
      if (cells) dropDetailFog(cells);
    },
    detail: (s, tx, ty, img) => {
      if (destroyed || !img) return;
      detailTex.set(tileKey(s, tx, ty), { tex: texOfImage(img), bytes: img.w * img.h * 4 });
      noteDetail();
    },
    fogTile: (tx, ty, img) => {
      if (destroyed) return;
      detailFog.set(`${tx}:${ty}`, img ? { tex: texOfImage(img), bytes: img.w * img.h * 4 } : { tex: null, bytes: 64 });
      noteDetail();
    },
  });
  // 整张海图要过了没有。带细图层的大地图缺省镜头就在近档：先要细节瓦片，整张海图等近档到齐（或镜头拉到远档）再画——
  // 后台线程一次只做一件事，整张图要好几秒，排在前面的话近档只能干等
  let chartAsked = false;
  const askChart = () => {
    if (chartAsked) return;
    chartAsked = true;
    jobs.chart(season);
  };
  if (!detail) askChart();
  const fogWait = setTimeout(() => {
    if (fogAsked) return;
    fogGiveUp = true;
    showTerrain();
  }, 3000);
  const discLayer = new PIXI.Container();
  const placeLayer = new PIXI.Container();
  const selectSprite = new PIXI.Sprite(PIXI.Texture.EMPTY);
  const hoverSprite = new PIXI.Sprite(PIXI.Texture.EMPTY);
  const fleetLayer = new PIXI.Container();
  const destSprite = new PIXI.Sprite(PIXI.Texture.EMPTY);
  hoverSprite.alpha = 0.6;
  // 夜色：整张海图（含迷雾）上的一层深蓝；灯火在地点标记之上
  const nightSprite = new PIXI.Sprite(PIXI.Texture.WHITE);
  nightSprite.tint = NIGHT_COLOR;
  nightSprite.width = wrap ? MW * 3 : MW;
  nightSprite.height = MH;
  if (wrap) nightSprite.x = -MW;
  nightSprite.alpha = 0;
  nightSprite.visible = false;
  const lightLayer = new PIXI.Container();
  lightLayer.visible = false;
  // 天气特效：按海区的压暗（天况标记之下）与雨线、闪电（天况标记之上），都在迷雾之下
  const wxLedger = `${hub.key}:weather-fx`;
  // H03：旗舰队附近的天气团（map/chartCells.ts）
  const chartCells = createChartCells(PIXI, weatherLayer, C, atView);
  const wxFx = createWeatherLayer(PIXI, {
    grid: statics.map,
    wrap,
    MW,
    MH,
    cell: C,
    // 画框宽 CHART_FRAME 个位图像素；大地图的世界图每个位图像素合 k 个海图像素
    frameCells: Math.ceil((CHART_FRAME * k) / C),
    view: () => ({
      s: cam.s,
      x0: -cam.x / cam.s,
      y0: -cam.y / cam.s,
      x1: (screenW() - cam.x) / cam.s,
      y1: (screenH() - cam.y) / cam.s,
      cssW: screenW(),
      cssH: screenH(),
    }),
    tex,
    dpr: () => (typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1),
    phone: () =>
      Math.min(screenW(), screenH()) < 560 ||
      (typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia("(pointer: coarse)").matches),
    account: (bytes) => account(wxLedger, bytes),
  });
  // H07 季风历：迷雾与夜色之上、自己的航线之下（只画已有海图的海区，后端已经筛过）
  const monsoon = createMonsoonLayer(PIXI, { cell: C, wrap, MW });
  // 天况、其他商会、海盗与风向在迷雾之下（未探索的海域看不见）；自己的航线、发现物、地点与舰队在迷雾之上
  world.addChild(
    terrainLayer,
    wxFx.under,
    weatherLayer,
    wxFx.over,
    windLayer,
    otherLayer,
    fogLayer,
    nightSprite,
    monsoon.root,
    routeLayer,
    discLayer,
    placeLayer,
    lightLayer,
    hoverSprite,
    selectSprite,
    destSprite,
    fleetLayer,
  );
  // 屏幕空间：地名与右下角的罗盘
  const labelLayer = new PIXI.Container();
  const compass = new PIXI.Sprite(tex("rose:ui", () => drawCompassRose(15)));
  compass.alpha = 0.92;
  app.stage.addChild(labelLayer, compass);

  // —— 镜头 ——
  const cam = { s: 1, x: 0, y: 0 };
  /** 标记（地点、舰队、选中框、发现物）在屏幕上的倍数：大地图上与镜头倍数分开算（camera.ts 的 markerScale），经典世界跟着镜头。 */
  // 带细图层的大地图：近档与细节美术像素的倍率一致（camera.ts 的 detailMarkerScale）
  const mk = () => (detail ? detailMarkerScale(cam.s) : bigMap ? markerScale(cam.s) : cam.s);
  /** 标记在海图坐标里的倍数（world 容器已经按 cam.s 放大，这里除回去）；经典世界恒为 1。 */
  const ms = () => (bigMap ? mk() / cam.s : 1);
  /** 上一次摆放标记时的镜头倍数：倍数变了要把所有标记按新的大小重摆 */
  let scaledAt = cam.s;
  let follow = true;
  let userMoved = false;
  const screenW = () => app.screen.width;
  const screenH = () => app.screen.height;
  // 环绕地图“看全图”只需铺满高度（横向本来就连着），但至少要让左右多贴的两份盖住整个画面
  const fitScale = () => (wrap ? Math.max(screenH() / MH, screenW() / MW) : Math.min(screenW() / MW, screenH() / MH));
  const coverScale = () => Math.max(screenW() / MW, screenH() / MH);
  const levels = () => {
    const fit = fitScale();
    return [fit, ...zooms.filter((z) => z > fit * 1.04)];
  };
  /**
   * 海图两侧被界面遮住的宽度：镜头居中时避开它们。
   * - 左：左侧栏里**展开着**的小窗（航行状态、地点、图例）。只剩几枚收起的标题签（新界面的缺省）时不算遮住，海图照整幅居中；
   * - 右：靠右的功能窗口（港口、舰队……）。窗口开着时旗舰队与选中的地点摆在窗口左边看得见的那一块里，不再被它盖住。
   * 量一次管半秒（镜头跟随时每帧都要用）；选中的地点变了、窗口刚打开时由 update 作废重量。
   */
  let safeCache = { at: -Infinity, left: 0, right: 0 };
  const safeArea = () => {
    const now = performance.now();
    if (now - safeCache.at < 500) return safeCache;
    const box = container.getBoundingClientRect();
    let left = 0;
    const side = container.parentElement?.querySelector<HTMLElement>(".chart-side");
    if (side) {
      let right = 0;
      let bottom = 0;
      for (const el of Array.from(side.children)) {
        if (el.classList.contains("collapsed")) continue;
        const r = el.getBoundingClientRect();
        if (r.width <= 0 || r.height <= 0) continue;
        right = Math.max(right, r.right - box.left);
        bottom = Math.max(bottom, r.bottom - box.top);
      }
      if (right > 0 && right < screenW() * 0.45 && bottom > screenH() * 0.3) left = right + 8;
    }
    let right = 0;
    const win = container.closest(".shell-main")?.querySelector<HTMLElement>(".gw.gw-right");
    if (win) {
      const cover = box.right - win.getBoundingClientRect().left;
      // 整页的窗口（手机）盖满舞台：看不见海图，不必避让
      if (cover > 0 && cover < screenW() * 0.6) right = cover + 8;
    }
    safeCache = { at: now, left, right };
    return safeCache;
  };
  const safeLeft = () => safeArea().left;
  const safeRight = () => safeArea().right;

  /** 视野中心下的海图横坐标（环绕地图摆放标记的参照）。 */
  function viewWorldX() {
    // 同 viewCenterX（那个定义在后面，这里先用到）
    return ((safeLeft() + screenW() - safeRight()) / 2 - cam.x) / cam.s;
  }
  /** 环绕地图：镜头移动后把标记挪到离视野中心最近的那一份上（在下面各部分建好之后接上）。 */
  let relayoutWorld: () => void = () => {};

  // —— 地点标记与地名（港口、内陆城市、殖民点） ——
  const flagOf = (faction: number) => statics.factions[faction]?.color ?? "#ffffff";
  /** 势力数据中的建筑风格（FactionView.style；未写为 null，由势力 key 推断） */
  const styleFieldOf = (faction: number) => statics.factions[faction]?.style;
  /** 某格是否已揭开（还没有迷雾时为 null：全部当作揭开） */
  let fogAt: FogLookup | null = null;
  const revealed = (x: number, y: number) => fogAt === null || fogAt(x, y);
  /** 看见过的地点（Overview.sighted；没有这个字段时为 null，全部画出） */
  let sighted: Set<number> | null = null;
  let sightedKey = "";
  const shownPlace = (id: number) => sighted === null || sighted.has(id);
  /** 有归属的殖民点的状态（来自概览的 site_claims 与 colonies，见 marks.ts） */
  let sites = new Map<number, SiteState>();
  interface Place {
    id: number;
    /** 这个地点的静态数据（静态数据按看见过的地点过滤时，下标不等于 id：直接记下这一条） */
    loc: LocView;
    site: boolean;
    sprite: Sprite;
    label: Text;
    /** 当前纹理的键（变化时才换纹理） */
    key: string;
    /** 夜里的灯火（港口与城市；殖民点没有） */
    light: Sprite | null;
    /** 地名下方的市况小字（港口与城市；平稳时为空） */
    cond: Text | null;
    /** 完整标记的纹理键与画法（挤在一起、排在后面的只画小圆点，见 positionPlaces） */
    make: () => Px;
    /** 这一次摆放时是不是只画成小圆点 */
    dot: boolean;
    /** 要紧程度（越小越要紧）：有船厂的港口、各势力的头一个地点排在前面 */
    rank: number;
  }
  const places: Place[] = statics.locations.map((l) => {
    const site = isSite(l);
    const sprite = new PIXI.Sprite(PIXI.Texture.EMPTY);
    placeLayer.addChild(sprite);
    let light: Sprite | null = null;
    if (!site) {
      light = new PIXI.Sprite(tex("port-light", drawPortLight));
      light.visible = false;
      lightLayer.addChild(light);
    }
    const label = new PIXI.Text({
      text: l.name,
      style: {
        fontFamily: LABEL_FONT,
        fontSize: l.kind === "port" ? 12 : site ? 10 : 11,
        fontWeight: "bold",
        fill: P.white,
        stroke: { color: "#1a1423", width: 3 },
      },
    });
    label.anchor.set(0.5, 0);
    labelLayer.addChild(label);
    let cond: Text | null = null;
    if (!site) {
      cond = new PIXI.Text({
        text: "",
        style: { fontFamily: LABEL_FONT, fontSize: 10, fontWeight: "bold", fill: P.white, stroke: { color: "#1a1423", width: 3 } },
      });
      cond.anchor.set(0.5, 0);
      cond.visible = false;
      labelLayer.addChild(cond);
    }
    return { id: l.id, loc: l, site, sprite, label, key: "", light, cond, make: () => drawPlaceDot("port", P.white), dot: false, rank: 0 };
  });
  // 要紧程度：各势力的头一个地点（首府）、有船厂的港口最要紧，其次港口、城市、殖民点；同档按编号
  {
    const firstOf = new Set<number>();
    const seenFaction = new Set<number>();
    for (const p of places) {
      if (p.site || seenFaction.has(p.loc.faction)) continue;
      seenFaction.add(p.loc.faction);
      firstOf.add(p.id);
    }
    for (const p of places) p.rank = (firstOf.has(p.id) ? 0 : p.loc.shipyard ? 1 : 2) * 3 + (p.site ? 2 : p.loc.kind === "port" ? 0 : 1);
  }
  const refreshPlaces = () => {
    for (const p of places) {
      const l = p.loc;
      const known = revealed(l.x, l.y);
      let key: string;
      let make: () => Px;
      if (p.site) {
        const mark = siteMark(statics, sites.get(l.id));
        key = siteMarkKey(mark, !known);
        make = () => drawSiteMarker(mark, { unknown: !known });
      } else {
        const style = markerStyle(statics.factions[l.faction]?.key, styleFieldOf(l.faction));
        const flag = flagOf(l.faction);
        key = `${l.kind}:${style}:${flag}:${known ? 1 : 0}`;
        make = () => (l.kind === "port" ? drawPortMarker(style, flag, { unknown: !known }) : drawCityMarker(style, flag, { unknown: !known }));
      }
      if (p.key === key) continue;
      p.key = key;
      p.make = make;
      p.dot = false;
      p.sprite.texture = tex(key, make);
      p.label.style.fill = known ? (p.site ? P.paper : P.white) : P.parchmentDeep;
      p.label.style.stroke = { color: known ? "#1a1423" : P.paper, width: 3 };
    }
    positionPlaces();
  };
  /** 地点标记与灯火的位置（环绕地图摆在离视野中心最近的那一份上）；没看见的地点不画。 */
  function positionPlaces() {
    // 标记的底部锚点（停泊格中心）不随标记的大小变：位置按标记自己的倍数从锚点往回算
    const z = ms();
    // 带细图层的大地图：标记互相避让——按要紧程度先后摆，与已经摆下的完整标记相叠的只画成小圆点
    // （远档上港口密的地方不再整片盖住；近档标记只有四分之三格，本来就不相叠，全都照画）
    if (detail) {
      const focus = labelFocus();
      const boxes: (Box | null)[] = places.map((p) => {
        if (!shownPlace(p.id)) return null;
        const l = p.loc;
        // 完整标记连描边 19 × 20，底边在格心下方 5 像素（殖民点略小，按同样的占位算）
        return { x0: cx(l.x) - 9.5 * z, y0: cx(l.y) - 15 * z, x1: cx(l.x) + 9.5 * z, y1: cx(l.y) + 5 * z };
      });
      const order = places.map((_, i) => i).sort((a, b) => places[a].rank - places[b].rank || places[a].id - places[b].id);
      const forced = new Set<number>();
      places.forEach((p, i) => {
        if (focus.has(p.id)) forced.add(i);
      });
      const full = declutter(boxes, order, forced);
      places.forEach((p, i) => {
        const dot = boxes[i] !== null && !full.has(i);
        if (dot === p.dot) return;
        p.dot = dot;
        const l = p.loc;
        const known = revealed(l.x, l.y);
        const flag = p.site ? P.paper : flagOf(l.faction);
        const kind = p.site ? "site" : l.kind === "city" ? "city" : "port";
        p.sprite.texture = dot ? tex(`dot:${kind}:${flag}:${known ? 1 : 0}`, () => drawPlaceDot(kind, flag, { unknown: !known })) : tex(p.key, p.make);
      });
    }
    for (const p of places) {
      const l = p.loc;
      const shown = shownPlace(p.id);
      p.sprite.visible = shown;
      const w = p.sprite.texture.width;
      const h = p.sprite.texture.height;
      p.sprite.scale.set(z);
      // 港口与殖民点：码头（海滩）压在停泊格中心；城市：城墙底边压在格中心；小圆点居中压在格中心
      if (p.dot) p.sprite.position.set(atView(cx(l.x)) - (w / 2) * z, cx(l.y) - (h / 2) * z);
      else p.sprite.position.set(atView(cx(l.x)) - Math.floor(w / 2) * z, cx(l.y) - (h - (l.kind === "city" ? 4 : 5)) * z);
      // 灯火点在建筑的中下部（未到访的地点不点灯）
      if (p.light) {
        p.light.visible = shown && revealed(l.x, l.y);
        p.light.scale.set(z);
        const lx = p.sprite.x + ((w - p.light.texture.width) / 2) * z;
        const ly = p.sprite.y + (h * 0.58 - p.light.texture.height / 2) * z;
        // 经典世界（z = 1）照旧落在整像素上
        p.light.position.set(z === 1 ? Math.round(lx) : lx, z === 1 ? Math.round(ly) : ly);
      }
    }
  }

  // —— 发现物：主角发现之后才显示（图标 + 名字）；位置来自 api.discoveries() 的 found（见 found.ts） ——
  interface Disc {
    x: number;
    y: number;
    sprite: Sprite;
    label: Text;
    /** 新发现时的闪光（画在图标下面） */
    flash: Sprite;
    /** 闪现开始的时刻（elapsed）；null 表示不在闪现 */
    flashAt: number | null;
  }
  const discs = new Map<number, Disc>();
  let discoveredKey = "";
  /** 待闪现的发现物（标记还没建好时先记下） */
  const flashQueue = new Set<number>();

  /** 镜头变化后的附加布局（地名的英文小行，在悬停与选中的逻辑建好之后接上） */
  let afterLayout: () => void = () => {};
  /** 地名避让时一定要显示的地点（悬停、选中、目的地、自己舰队停泊的地点；在那些逻辑建好之后接上） */
  let labelFocus: () => ReadonlySet<number> = () => new Set();
  const KIND_RANK: Record<string, number> = { port: 0, city: 1 };
  const layoutScreen = () => {
    const m = mk();
    const sw = screenW();
    const sh = screenH();
    // 画面之外的地名不画（大地图上几百个地名，只有眼前的几十个要排）
    const onScreen = (x: number, y: number) => x > -160 && x < sw + 160 && y > -40 && y < sh + 30;
    for (const p of places) {
      const l = p.loc;
      p.label.position.set(Math.round(cam.x + atView(cx(l.x)) * cam.s), Math.round(cam.y + cx(l.y) * cam.s + (p.dot ? 4 : l.kind === "city" ? 5 : 6) * m));
      // 港口名在看全图时也显示（窄窗口缩得很小时隐去，免得挤成一团）；城市放大到接近原尺寸才显示；殖民点再放大一些
      p.label.visible =
        shownPlace(p.id) &&
        (p.site ? cam.s >= MINOR_LABEL_SCALE : l.kind === "port" ? cam.s >= PORT_LABEL_SCALE : cam.s >= 0.9) &&
        onScreen(p.label.x, p.label.y);
      if (p.cond) {
        p.cond.position.set(p.label.x, Math.round(p.label.y + p.label.height - 2));
        p.cond.visible = p.label.visible && p.cond.text !== "";
      }
    }
    for (const d of discs.values()) {
      d.label.position.set(Math.round(cam.x + atView(cx(d.x)) * cam.s), Math.round(cam.y + cx(d.y) * cam.s + 8 * m));
      // 闪现时无论缩放都显示名字
      d.label.visible = d.sprite.visible && (cam.s >= MINOR_LABEL_SCALE || d.flashAt !== null) && onScreen(d.label.x, d.label.y);
    }
    if (bigMap) {
      // 地名互相避让：港口密的地方（濑户内海、地中海）不再叠成一团。先后：有市况的、到访过的、港口先于城市先于殖民点，
      // 同档按编号（平移时谁显示谁不显示不会跳）；悬停、选中、目的地与自己舰队所在的地点一定显示。发现物的名字排在地点之后。
      const focus = labelFocus();
      const boxes: (Box | null)[] = [];
      const order: number[] = [];
      const forced = new Set<number>();
      const boxOf = (t: Text, extra: Text | null): Box => {
        const w = t.width;
        const h = t.height + (extra && extra.visible ? extra.height - 2 : 0);
        return { x0: t.x - w / 2 - 2, y0: t.y, x1: t.x + w / 2 + 2, y1: t.y + h };
      };
      const ranks: number[] = [];
      places.forEach((p, i) => {
        if (!p.label.visible) {
          boxes.push(null);
          ranks.push(0);
          return;
        }
        boxes.push(boxOf(p.label, p.cond));
        const l = p.loc;
        // 三档按字典序：市况（0 / 9）、到访过（0 / 3）、种类（0–2）；带细图层的大地图再加一档：只画成小圆点的排在完整标记之后
        ranks.push((p.dot ? 20 : 0) + (p.cond && p.cond.text !== "" ? 0 : 9) + (revealed(l.x, l.y) ? 0 : 3) + (p.site ? 2 : (KIND_RANK[l.kind] ?? 1)));
        order.push(i);
        if (focus.has(p.id)) forced.add(i);
      });
      order.sort((a, b) => ranks[a] - ranks[b] || places[a].id - places[b].id);
      const discList = [...discs.values()];
      discList.forEach((d, j) => {
        const i = places.length + j;
        boxes.push(d.label.visible ? boxOf(d.label, null) : null);
        if (!d.label.visible) return;
        order.push(i);
        if (d.flashAt !== null) forced.add(i);
      });
      const shown = declutter(boxes, order, forced);
      places.forEach((p, i) => {
        if (!p.label.visible || shown.has(i)) return;
        p.label.visible = false;
        if (p.cond) p.cond.visible = false;
      });
      discList.forEach((d, j) => {
        if (d.label.visible && !shown.has(places.length + j)) d.label.visible = false;
      });
    }
    afterLayout();
    const k = Math.max(1, Math.min(3, Math.floor(Math.min(screenW(), screenH()) / 220)));
    compass.scale.set(k);
    compass.position.set(Math.round(screenW() - compass.texture.width * k - 12), Math.round(screenH() - compass.texture.height * k - 12));
  };
  /** 发现物的图标居中压在所在格上，大小按标记的倍数。 */
  const placeDisc = (d: Disc) => {
    const z = ms();
    d.sprite.scale.set(z);
    d.sprite.position.set(atView(cx(d.x)) - Math.floor(d.sprite.texture.width / 2) * z, cx(d.y) - Math.floor(d.sprite.texture.height / 2) * z);
  };
  const refreshDiscoveries = (found: readonly FoundView[]) => {
    const marks = discoveryMarks(statics, found);
    const key = marks.map((m) => `${m.id}@${m.x},${m.y}`).join(";");
    if (key === discoveredKey) return;
    discoveredKey = key;
    const shown = new Set<number>();
    for (const m of marks) {
      shown.add(m.id);
      let d = discs.get(m.id);
      if (!d) {
        const flash = new PIXI.Sprite(PIXI.Texture.EMPTY);
        flash.visible = false;
        const sprite = new PIXI.Sprite(tex(`disc:${m.kind}`, () => drawDiscoveryMarker(m.kind)));
        discLayer.addChild(flash, sprite);
        const label = new PIXI.Text({
          text: m.name,
          style: {
            fontFamily: LABEL_FONT,
            fontSize: 10,
            fontStyle: "italic",
            fontWeight: "bold",
            fill: P.gold[4],
            stroke: { color: "#1a1423", width: 3 },
          },
        });
        label.anchor.set(0.5, 0);
        labelLayer.addChild(label);
        d = { x: m.x, y: m.y, sprite, label, flash, flashAt: null };
        discs.set(m.id, d);
      }
      d.x = m.x;
      d.y = m.y;
      placeDisc(d);
      d.sprite.visible = true;
      if (flashQueue.delete(m.id)) d.flashAt = elapsed;
    }
    for (const [id, d] of discs) {
      if (shown.has(id)) continue;
      d.sprite.visible = false;
      d.label.visible = false;
      d.flash.visible = false;
      d.flashAt = null;
    }
    layoutScreen();
  };
  /** 新发现：让这些发现物的标记闪现一阵（标记还没建好时等建好后再闪）。 */
  const flashDiscoveries = (ids: readonly number[]) => {
    for (const id of ids) {
      const d = discs.get(id);
      if (d && d.sprite.visible) d.flashAt = elapsed;
      else flashQueue.add(id);
    }
    frameNo = -1;
    layoutScreen();
  };
  refreshPlaces();

  const applyCam = () => {
    const sw = screenW();
    const sh = screenH();
    const mw = MW * cam.s;
    const mh = MH * cam.s;
    // 横向：放得下就居中在左侧栏与右侧功能窗口之间的可见区域；放不下时，允许把地图的西缘拖到左侧栏右边、东缘拖到功能窗口左边，
    // 看清被遮住的部分。环绕地图：横向无限平移，按一整张图的宽度取模
    const left = safeLeft();
    const right = safeRight();
    if (wrap) cam.x = wrapCamX(cam.x, mw);
    else if (mw <= sw - left - right) cam.x = left + (sw - left - right - mw) / 2;
    else cam.x = Math.min(left, Math.max(sw - right - mw, cam.x));
    cam.y = mh <= sh ? (sh - mh) / 2 : Math.min(0, Math.max(sh - mh, cam.y));
    cam.x = Math.round(cam.x);
    cam.y = Math.round(cam.y);
    world.scale.set(cam.s);
    world.position.set(cam.x, cam.y);
    // 镜头倍数变了：大地图上标记的大小与镜头分开算，全部按新的大小重摆（经典世界标记跟着 world 一起缩放，不用动）
    const rescaled = bigMap && cam.s !== scaledAt;
    scaledAt = cam.s;
    // 镜头落到整像素以后与上一次一模一样（跟随旗舰队时每帧都会算一遍，船走得慢时多半没动）：标记与地名不必重排（性能，11-10）
    const sig = `${cam.x},${cam.y},${cam.s},${sw},${sh},${left},${right}`;
    if (sig === camApplied && !rescaled) return;
    camApplied = sig;
    if (rescaled) positionPlaces();
    // 环绕地图：标记摆在离视野中心最近的那一份上。会换份的只有离视野中心半圈远的标记（在画面外），所以视野中心每走过
    // 十六分之一圈才重摆一次，不必镜头每动一个像素就把几百个标记、航线与天况全摆一遍；缩得很小、半圈都在画面里时照旧每次都摆
    let wrapMoved = false;
    if (wrap) {
      const bucket = Math.floor(viewWorldX() / (MW / 16));
      wrapMoved = bucket !== wrapBucket || (MW * cam.s * 7) / 16 < sw / 2 + 96;
      wrapBucket = bucket;
    }
    if (wrapMoved || rescaled) relayoutWorld();
    layoutScreen();
    wxFx.relayout();
    updateDetail();
  };
  /**
   * 细节瓦片的摆放：镜头到了近档（一格 ≥ 24 屏幕像素）就按视野要瓦片（地形与迷雾各一张，视野外多要一圈），
   * 第一次要等视野里的都到齐才从整张海图切过去（不闪一片空白）；切过去以后整张海图与整张迷雾不画，
   * 新进视野、还没到的块先盖羊皮纸色（不露出没探明的海）。回到远档就切回整张海图。
   */
  function updateDetail() {
    detailDirty = false;
    if (!detail) return;
    const want = cam.s >= DETAIL_MIN_ZOOM - 1e-6;
    if (!want) {
      // 远档要整张海图
      askChart();
      if (nearActive || detailLayer.visible) {
        nearActive = false;
        detailLayer.visible = false;
        detailFogLayer.visible = false;
        terrainBase.visible = true;
        fogBase.visible = true;
        for (const sp of detailSprites.values()) {
          sp.terrain.visible = false;
          sp.fog.visible = false;
        }
      }
      return;
    }
    const T = DETAIL_TILE_CELLS;
    const cellPx = cam.s * C;
    const midX = (screenW() / 2 - cam.x) / cellPx;
    const midY = (screenH() / 2 - cam.y) / cellPx;
    const s = ((season % 4) + 4) % 4;
    const slots = visibleTiles(midX, midY, screenW(), screenH(), cellPx, W, H, wrap, T);
    for (const sp of detailSprites.values()) sp.used = false;
    let allReady = slots.length > 0;
    for (const slot of slots) {
      let t = detailTex.get(tileKey(s, slot.tx, slot.ty));
      const f = detailFog.get(`${slot.tx}:${slot.ty}`);
      if (!t) {
        jobs.detail(s, slot.tx, slot.ty);
        // 换季：新一季的这一块画好之前先留着手上别的季节的（上一季的优先），不闪一片空白
        for (const back of [3, 2, 1]) {
          t = detailTex.peek(tileKey((s + back) % 4, slot.tx, slot.ty));
          if (t) break;
        }
      }
      if (!f) jobs.fogTile(slot.tx, slot.ty);
      const key = `${slot.x}:${slot.y}`;
      let sp = detailSprites.get(key);
      if (!sp) {
        sp = { terrain: new PIXI.Sprite(PIXI.Texture.EMPTY), fog: new PIXI.Sprite(PIXI.Texture.EMPTY), used: true };
        detailLayer.addChild(sp.terrain);
        detailFogLayer.addChild(sp.fog);
        detailSprites.set(key, sp);
      }
      sp.used = true;
      const x = slot.x * C;
      const y = slot.y * C;
      const tw = Math.min(T, W - slot.tx * T) * C;
      const th = Math.min(T, H - slot.ty * T) * C;
      if (t?.tex && f) {
        sp.terrain.texture = t.tex;
        sp.terrain.position.set(x, y);
        sp.terrain.scale.set(C / DETAIL_CELL_PX);
        sp.terrain.visible = true;
        sp.fog.visible = f.tex !== null;
        if (f.tex) {
          sp.fog.texture = f.tex;
          sp.fog.tint = 0xffffff;
          sp.fog.position.set(x, y);
          sp.fog.scale.set(C / DETAIL_CELL_PX);
        }
      } else {
        allReady = false;
        sp.terrain.visible = false;
        // 还没到：盖一块羊皮纸色
        sp.fog.texture = PIXI.Texture.WHITE;
        sp.fog.tint = P.parchment;
        sp.fog.position.set(x, y);
        sp.fog.width = tw;
        sp.fog.height = th;
        sp.fog.visible = true;
      }
    }
    for (const [key, sp] of detailSprites) {
      if (sp.used) continue;
      sp.terrain.destroy();
      sp.fog.destroy();
      detailSprites.delete(key);
    }
    // 视野外一圈（半块瓦片宽）提前要：平移、跟船时不等瓦片
    const pad = (T / 2) * cellPx;
    for (const slot of visibleTiles(midX, midY, screenW() + 2 * pad, screenH() + 2 * pad, cellPx, W, H, wrap, T)) {
      if (!detailTex.has(tileKey(s, slot.tx, slot.ty))) jobs.detail(s, slot.tx, slot.ty);
      if (!detailFog.has(`${slot.tx}:${slot.ty}`)) jobs.fogTile(slot.tx, slot.ty);
    }
    if (!nearActive && allReady) {
      nearActive = true;
      // 近档到齐了：海图可以露出来了；整张海图这时才在后台慢慢画（拉到远档时用）
      showTerrain();
      askChart();
    }
    detailLayer.visible = nearActive;
    detailFogLayer.visible = nearActive;
    terrainBase.visible = !nearActive;
    fogBase.visible = !nearActive;
  }
  /** 上一次摆好时的镜头（位置、倍数、画布大小、两侧遮挡），与环绕地图上视野中心所在的十六分之一圈 */
  let camApplied = "";
  let wrapBucket = Number.NaN;
  /** 视野中心（去掉左侧栏与右侧功能窗口后的可见区域中心）。 */
  const viewCenterX = () => (safeLeft() + screenW() - safeRight()) / 2;
  const centerOn = (px: number, py: number) => {
    cam.x = viewCenterX() - px * cam.s;
    cam.y = screenH() / 2 - py * cam.s;
    applyCam();
  };
  const initialView = () => {
    // 默认 2 倍、大地图 3 倍（至少铺满画面），镜头对准旗舰队或选中的地点
    const cover = coverScale();
    cam.s = zooms.find((z) => z >= Math.max(detail ? DETAIL_MAP_ZOOM : bigMap ? BIG_MAP_ZOOM : 2, cover)) ?? zooms[zooms.length - 1];
    if (Math.min(screenW(), screenH()) < 240) cam.s = Math.max(fitScale(), 1);
    aim();
  };
  /** 镜头对准旗舰队（没有舰队时对准选中的地点，再没有就对准海图中央），倍数不变。 */
  const aim = () => {
    const g = useGame.getState();
    const f = g.overview?.fleets[0];
    const l = g.selectedLoc !== null ? locById(statics, g.selectedLoc) : undefined;
    if (f) centerOn(cx(f.x), cx(f.y));
    else if (l) centerOn(cx(l.x), cx(l.y));
    else centerOn(MW / 2, MH / 2);
    const area = safeArea();
    aimedLeft = area.left;
    aimedRight = area.right;
  };
  /** 上一次对准镜头时两侧被遮住的宽度：变了（功能窗口开关、左侧栏展开收起）而玩家还没自己动过镜头时，照新的可见区域再对准一次 */
  let aimedLeft = 0;
  let aimedRight = 0;
  initialView();

  // 画布尺寸跟随容器（容器被隐藏时暂停动画）
  let lastSize = `${container.clientWidth}x${container.clientHeight}`;
  const { sync: syncTicker, dispose: unsubStage } = watchMapVisibility(container, app.ticker);
  const resize = () => {
    const w = container.clientWidth;
    const h = container.clientHeight;
    const size = `${w}x${h}`;
    syncTicker();
    if (w <= 0 || h <= 0) return;
    if (size === lastSize) return;
    const first = lastSize.startsWith("0x") || lastSize.endsWith("x0");
    lastSize = size;
    app.renderer.resize(w, h);
    if (first && !userMoved) initialView();
    else applyCam();
  };
  const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(resize) : null;
  ro?.observe(container);
  syncTicker();

  // —— 交互：拖动、滚轮、点选与悬停；触屏上双指缩放、点船队看信息卡（网页自适应） ——
  const toWorld = (sx: number, sy: number) => [(sx - cam.x) / cam.s, (sy - cam.y) / cam.s] as const;
  /** 屏幕坐标处的地点（标记的范围，或以格中心为圆心的小圆）；手指点的判定范围大一些（约 22 CSS 像素） */
  const hitLoc = (sx: number, sy: number, touch = false): number | null => {
    const [wx, wy] = toWorld(sx, sy);
    // 判定范围按标记在屏幕上的大小算（标记的倍数 m），再换回海图坐标；经典世界 m = cam.s，与原来的写法相同
    const m = mk();
    const reach = (touch ? Math.max(12 * m, 22) : Math.max(9 * m, 10)) / cam.s;
    let best: number | null = null;
    let bestD = Infinity;
    for (const l of statics.locations) {
      // 没看见的地点不能点选；环绕地图的横向差取最短的一条（点选按宽度取模）
      if (!shownPlace(l.id)) continue;
      const dx = wrapDx(cx(l.x), wx, MW, wrap);
      const dy = wy - cx(l.y);
      // 标记向上延伸：上方判定得更宽
      const d = dx * dx + (dy < 0 ? (dy * 0.55) ** 2 : dy * dy);
      if (d < reach * reach && d < bestD) {
        best = l.id;
        bestD = d;
      }
    }
    return best;
  };
  let hovered: number | null = null;
  /** 悬停着的别家船队（概览 others 的下标） */
  let hoveredFleet: number | null = null;
  let onHoverFleet: ((hit: FleetHover | null) => void) | null = null;
  /** 屏幕坐标处的别家船队标记（按标记当前显示的位置判定） */
  const hitFleet = (sx: number, sy: number, touch = false): number | null => {
    const others = lastOverview?.others ?? [];
    const [wx, wy] = toWorld(sx, sy);
    const m = mk();
    const reach = (touch ? Math.max(10 * m, 18) : Math.max(7 * m, 9)) / cam.s;
    let best: number | null = null;
    let bestD = Infinity;
    others.forEach((_, i) => {
      const u = units.get(`other:${i}`);
      if (!u) return;
      const d = wrapDx(u.x, wx, MW, wrap) ** 2 + (wy - u.y) ** 2;
      if (d < reach * reach && d < bestD) {
        best = i;
        bestD = d;
      }
    });
    return best;
  };
  /** 通知界面悬停的船队变了（移开、换了一支，或概览里已经没有这支） */
  const hoverFleet = (i: number | null) => {
    const m = i === null ? undefined : lastOverview?.others[i];
    const next = m ? i : null;
    if (next === hoveredFleet) return;
    hoveredFleet = next;
    if (!onHoverFleet) return;
    const u = next === null ? undefined : units.get(`other:${next}`);
    onHoverFleet(
      m && u && next !== null
        ? { index: next, owner: m.owner, owner_en: m.owner_en, x: Math.round(cam.x + atView(u.x) * cam.s), y: Math.round(cam.y + u.y * cam.s) }
        : null,
    );
  };
  let down: { x: number; y: number; cx: number; cy: number } | null = null;
  let dragging = false;
  /** 按在海图上的各个触点（双指缩放用） */
  const touches = new Map<number, { x: number; y: number }>();
  /** 双指缩放：按下时的倍数、两指距离，与那时两指中点下的海图位置 */
  let pinch: { s0: number; d0: number; wx: number; wy: number } | null = null;
  const startPinch = () => {
    const [a, b] = [...touches.values()];
    const p = pinchOf(a, b);
    const [wx, wy] = toWorld(p.cx, p.cy);
    pinch = { s0: cam.s, d0: p.d, wx, wy };
    // 两指落下：这一下既不是拖动也不是点选
    down = null;
    dragging = false;
    follow = false;
    userMoved = true;
    hoverFleet(null);
  };
  const movePinch = () => {
    if (!pinch || touches.size < 2) return;
    const [a, b] = [...touches.values()];
    const p = pinchOf(a, b);
    cam.s = pinchScale(pinch.s0, pinch.d0, p.d, levels()[0], zooms[zooms.length - 1]);
    // 两指中点下始终是按下时的那一处海图（捏合的同时也可以平移）
    cam.x = p.cx - pinch.wx * cam.s;
    cam.y = p.cy - pinch.wy * cam.s;
    applyCam();
  };
  const endPinch = () => {
    if (!pinch) return;
    // 松手时对齐到最近的缩放档位（像素不走样），以视野中心为准
    Object.assign(cam, zoomAt(cam, snapScale(cam.s, levels()), viewCenterX(), screenH() / 2));
    pinch = null;
    applyCam();
  };
  app.stage.eventMode = "static";
  app.stage.hitArea = app.screen;
  const setCursor = () => {
    const picking = useVoyageStore.getState().picking;
    app.canvas.style.cursor = dragging ? "grabbing" : hovered !== null ? "pointer" : picking ? "crosshair" : "grab";
  };
  app.stage.on("pointerdown", (e) => {
    if (e.pointerType !== "mouse") {
      touches.set(e.pointerId, { x: e.global.x, y: e.global.y });
      if (touches.size === 2) {
        startPinch();
        return;
      }
      if (touches.size > 2) return;
    }
    down = { x: e.global.x, y: e.global.y, cx: cam.x, cy: cam.y };
    dragging = false;
  });
  app.stage.on("pointermove", (e) => {
    if (touches.has(e.pointerId)) touches.set(e.pointerId, { x: e.global.x, y: e.global.y });
    if (pinch) {
      movePinch();
      return;
    }
    if (down) {
      const dx = e.global.x - down.x;
      const dy = e.global.y - down.y;
      if (!dragging && dx * dx + dy * dy > 16) {
        dragging = true;
        follow = false;
        userMoved = true;
      }
      if (dragging) {
        cam.x = down.cx + dx;
        cam.y = down.cy + dy;
        applyCam();
      }
    } else if (e.pointerType === "mouse") {
      const h = hitLoc(e.global.x, e.global.y);
      if (h !== hovered) {
        hovered = h;
        placeHover();
      }
      hoverFleet(hitFleet(e.global.x, e.global.y));
    }
    if (dragging) hoverFleet(null);
    setCursor();
  });
  const onLeave = () => hoverFleet(null);
  app.canvas.addEventListener("pointerleave", onLeave);
  const release = (e: { global: { x: number; y: number }; pointerType?: string; pointerId?: number } | null) => {
    if (e?.pointerId !== undefined && touches.delete(e.pointerId) && pinch) {
      // 双指缩放中抬起一根手指：结束缩放，剩下的那根不再当作拖动或点选
      if (touches.size < 2) endPinch();
      down = null;
      dragging = false;
      return;
    }
    if (down && !dragging && e) {
      const touch = e.pointerType !== undefined && e.pointerType !== "mouse";
      const loc = hitLoc(e.global.x, e.global.y, touch);
      if (touch) {
        // 触屏没有悬停：点别家船队显示它的信息卡（再点一次或点别处收起）；点地点照常选中
        const f = loc === null ? hitFleet(e.global.x, e.global.y, true) : null;
        hoverFleet(f !== null && f !== hoveredFleet ? f : null);
      }
      if (loc !== null) onPick(loc);
    }
    down = null;
    dragging = false;
    setCursor();
  };
  app.stage.on("pointerup", (e) => release(e));
  app.stage.on("pointerupoutside", (e) => {
    touches.delete(e.pointerId);
    if (pinch && touches.size < 2) endPinch();
    release(null);
  });
  /** 缩放一档（滚轮、缩放按钮），以画布上 (mx, my) 为中心。 */
  const zoomStep = (dir: 1 | -1, mx: number, my: number) => {
    const next = stepScale(cam.s, levels(), dir);
    if (next === cam.s) return;
    Object.assign(cam, zoomAt(cam, next, mx, my));
    userMoved = true;
    applyCam();
  };
  const onWheel = (e: WheelEvent) => {
    e.preventDefault();
    const rect = app.canvas.getBoundingClientRect();
    zoomStep(e.deltaY < 0 ? 1 : -1, e.clientX - rect.left, e.clientY - rect.top);
  };
  app.canvas.addEventListener("wheel", onWheel, { passive: false });

  // —— 选中框、悬停框、目的地 ——
  let selected: number | null = null;
  const placeFrame = (sprite: Sprite, loc: number | null) => {
    const l = loc !== null ? locById(statics, loc) : undefined;
    sprite.visible = !!l;
    const z = ms();
    sprite.scale.set(z);
    if (l) sprite.position.set(atView(cx(l.x)) - 14 * z, cx(l.y) - 17 * z);
  };
  const selectedOrTarget = () => useVoyageStore.getState().target ?? selected;

  // 双行名字（EXPANSION.md §12.3）：中文界面里，悬停（没有悬停时为选中或目的地）的地点在名字下方加一小行英文原名；
  // 英文界面地名本身就是英文，不加
  const enLabel = new PIXI.Text({
    text: "",
    style: { fontFamily: LABEL_FONT_LATIN, fontSize: 9, fill: P.paper, stroke: { color: "#1a1423", width: 3 } },
  });
  enLabel.anchor.set(0.5, 0);
  enLabel.alpha = 0.85;
  enLabel.visible = false;
  labelLayer.addChild(enLabel);
  const placeEnLabel = () => {
    const loc = hovered ?? selectedOrTarget();
    const p = loc !== null ? places[loc] : undefined;
    const l = loc !== null ? locById(statics, loc) : undefined;
    const en = l && currentLocale() !== "en" ? (l.name_en?.trim() ?? "") : "";
    if (!p || !l || !en || en === l.name || !p.label.visible) {
      enLabel.visible = false;
      return;
    }
    if (enLabel.text !== en) enLabel.text = en;
    enLabel.position.set(p.label.x, Math.round(p.label.y + p.label.height - 3));
    enLabel.visible = true;
  };
  afterLayout = placeEnLabel;
  const placeHover = () => {
    placeFrame(hoverSprite, hovered !== null && hovered !== selectedOrTarget() ? hovered : null);
    // 带细图层的大地图：悬停、选中的地点一定画完整的标记，周围的要重新避让
    if (detail) positionPlaces();
    // 大地图：悬停、选中的地点一定显示名字，周围的名字要重新避让（重排完会顺带摆好英文小行）
    if (bigMap) layoutScreen();
    else placeEnLabel();
  };

  // —— 舰队、商队、其他商会与海盗 ——
  const units = new Map<string, Unit>();
  // 船按船型 key 画（寰宇·十六世纪的新船型各有画法）；其他商会与海盗船只是点缀，按经典世界的顺序取 key
  const shipArt =
    (key: string, sail: "square" | "lateen", opts: { flag?: string; pirate?: boolean }) =>
    (frame: number, face: 1 | -1): [string, () => Px] => [
      `ship:${key}:${sail}:${opts.flag ?? ""}:${opts.pirate ? 1 : 0}:${frame}:${face}`,
      () => {
        const px = drawShipByKey(key, sail, { size: "small", flag: opts.flag, pirate: opts.pirate, frame });
        return face === 1 ? px : px.flipX();
      },
    ];
  const caravanArt = (frame: number, face: 1 | -1): [string, () => Px] => [
    `caravan:${frame}:${face}`,
    () => (face === 1 ? drawCaravanMarker(frame) : drawCaravanMarker(frame).flipX()),
  ];
  const upsert = (
    key: string,
    layer: Container,
    x: number,
    y: number,
    art: Unit["art"],
    extras: { flagship?: boolean; ox?: number; oy?: number } = {},
  ): Unit => {
    let u = units.get(key);
    if (!u) {
      const root = new PIXI.Container();
      const body = new PIXI.Sprite(PIXI.Texture.EMPTY);
      u = { root, body, x, y, tx: x, ty: y, face: 1, art, ox: 0, oy: 0, moving: false, phase: hash32(key) % 7, seen: true };
      if (extras.flagship) {
        u.ring = new PIXI.Sprite(PIXI.Texture.EMPTY);
        u.chev = new PIXI.Sprite(PIXI.Texture.EMPTY);
        root.addChild(u.ring);
      }
      u.wake = new PIXI.Sprite(PIXI.Texture.EMPTY);
      root.addChild(u.wake, body);
      if (u.chev) root.addChild(u.chev);
      layer.addChild(root);
      units.set(key, u);
    }
    // 环绕地图：目标取离当前位置最近的那一份（跨缝时不会横穿整张图）
    if (wrap) x = u.x + wrapDx(u.x, x, MW, true);
    // 大跳（新开局、读档）直接瞬移，否则平滑移过去
    if (Math.abs(u.x - x) > 60 || Math.abs(u.y - y) > 60) {
      u.x = x;
      u.y = y;
    }
    // H10a：目标变了就按“到下一次推送的时间”（游戏在走时约一天的实时长度，最长 6 秒；停着时 0.26 秒）匀速滑过去。
    // H10b：一天的长度以后端的 day_ms 为准（dayLengthMs 读它）；海上慢档一天 6 秒，上限随之放到 6 秒。
    if (x !== u.tx || y !== u.ty) {
      const speed = lastOverview?.speed ?? 0;
      const dur = speed > 0 ? Math.max(260, Math.min(6000, dayLengthMs(speed))) : 260;
      u.vx = (x - u.x) / dur;
      u.vy = (y - u.y) / dur;
    }
    const dx = x - u.tx;
    if (dx !== 0) u.face = dx > 0 ? 1 : -1;
    u.moving = dx !== 0 || y !== u.ty;
    u.tx = x;
    u.ty = y;
    u.art = art;
    u.ox = extras.ox ?? 0;
    u.oy = extras.oy ?? 0;
    u.seen = true;
    return u;
  };

  const drawUnit = (u: Unit, f: number, t: number) => {
    const [key, make] = u.art(f % SHIP_FRAMES, u.face);
    u.body.texture = tex(key, make);
    const w = u.body.texture.width;
    const h = u.body.texture.height;
    // 船在浪上起伏：每半秒上下 1 像素
    const bob = Math.floor(t / 500 + u.phase) % 2;
    if (!bigMap) {
      u.root.position.set(Math.round(atView(u.x)), Math.round(u.y));
    } else {
      // 大地图：整支标记按自己的倍数画（船身、尾迹、旗舰的光环都是它的子节点），偏移也按这个倍数
      const z = ms();
      u.root.scale.set(z);
      u.root.position.set(atView(u.x) + u.ox * z, u.y + u.oy * z);
    }
    u.body.position.set(-Math.floor(w / 2), -h + 3 + bob);
    if (u.wake) {
      u.wake.visible = u.moving;
      if (u.moving) {
        u.wake.texture = tex(`wake:${f % 4}:${u.face}`, () => (u.face === 1 ? drawWake(f % 4) : drawWake(f % 4).flipX()));
        u.wake.position.set(u.face === 1 ? -Math.floor(w / 2) - 6 : Math.floor(w / 2) - 3, 0);
      }
    }
    if (u.ring && u.chev) {
      const rf = Math.floor(t / 110) % FLAGSHIP_FRAMES;
      u.ring.texture = tex(`fring:${rf}`, () => drawFlagshipRing(rf));
      u.ring.position.set(-Math.floor(u.ring.texture.width / 2), -4);
      u.chev.texture = tex(`chev:${rf}`, () => drawChevron(rf));
      u.chev.position.set(-Math.floor(u.chev.texture.width / 2), -h - 8);
    }
  };

  // —— 航线点线 ——
  const routeDots: Sprite[] = [];
  let routeUsed = 0;
  const dot = (x: number, y: number, kind: "route" | "plan") => {
    let s = routeDots[routeUsed];
    if (!s) {
      s = new PIXI.Sprite(PIXI.Texture.EMPTY);
      routeLayer.addChild(s);
      routeDots.push(s);
    }
    routeUsed++;
    s.texture = tex(`rdot:${kind}`, () => drawRouteDot(kind));
    // 带细图层的大地图：航线点与别的标记一样按标记的倍数画（镜头 12 倍时不至于一个点半格大）
    const z = detail ? ms() : 1;
    s.scale.set(z);
    s.position.set(x - 2 * z, y - 2 * z);
    s.visible = true;
  };
  let lastOverview: Overview | null = null;
  let destLoc: number | null = null;
  const drawRoutes = () => {
    routeUsed = 0;
    destLoc = null;
    const o = lastOverview;
    for (const f of o?.fleets ?? []) {
      if (f.docked !== null || f.path.length < 2) continue;
      // 从船的当前位置往后，每隔一格画一个点
      let start = f.path.findIndex(([x, y]) => x === f.x && y === f.y);
      if (start < 0) start = 0;
      for (let i = start + 1; i < f.path.length; i += 2) dot(atView(cx(f.path[i][0])), cx(f.path[i][1]), "route");
      if (f === o?.fleets[0]) destLoc = f.dest;
    }
    const plan = useVoyageStore.getState().plan;
    if (plan) {
      for (let i = 1; i < plan.path.length; i += 2) dot(atView(cx(plan.path[i][0])), cx(plan.path[i][1]), "plan");
      destLoc = plan.dest;
    } else if (useVoyageStore.getState().target !== null) {
      destLoc = useVoyageStore.getState().target;
    }
    for (let i = routeUsed; i < routeDots.length; i++) routeDots[i].visible = false;
    const l = destLoc !== null ? locById(statics, destLoc) : undefined;
    destSprite.visible = !!l;
    const z = ms();
    destSprite.scale.set(z);
    if (l) destSprite.position.set(atView(cx(l.x)) - 5 * z, cx(l.y) - 5 * z);
  };

  // —— 风向箭头 ——
  const windSprites: Sprite[] = [];
  const drawWinds = (o: Overview | null) => {
    const winds = o?.winds ?? [];
    winds.forEach((w, i) => {
      let s = windSprites[i];
      if (!s) {
        s = new PIXI.Sprite(PIXI.Texture.EMPTY);
        s.alpha = 0.85;
        windLayer.addChild(s);
        windSprites.push(s);
      }
      const dir = ((w.dir % 8) + 8) % 8;
      s.texture = tex(`wind:${dir}:${w.strength}`, () => drawWindArrow(dir, w.strength));
      s.visible = true;
      // 风向箭头与天况标记也是“标记”：大地图上与地点一样按标记的倍数画
      const z = ms();
      s.scale.set(z);
      s.position.set(atView(cx(w.x)) - Math.floor(s.texture.width / 2) * z, cx(w.y) - Math.floor(s.texture.height / 2) * z);
    });
    for (let i = winds.length; i < windSprites.length; i++) windSprites[i].visible = false;
  };

  // —— 天况标记：各海区当天的天况，平铺在海区里、随风向缓缓漂移（旧后端没有 weather 时不画） ——
  const wxSprites: Sprite[] = [];
  let wxMarks: WeatherMark[] = [];
  let wxSig = "";
  let samplesKey = "";
  let samples = new Map<number, [number, number][]>();
  /** 摆好这一帧的天况标记：换下落帧、沿风向漂移、两端淡入淡出。 */
  const animateWeather = () => {
    const wf = Math.floor(elapsed / 260) % WEATHER_FRAMES;
    wxMarks.forEach((m, i) => {
      const s = wxSprites[i];
      if (!s) return;
      // 多云与雾只有一帧：不为第二帧另传一张相同的纹理
      const fr = m.sky === "rain" || m.sky === "snow" || m.sky === "storm" ? wf : 0;
      s.texture = tex(`wx:${m.sky}:${m.variant}:${fr}`, () => drawWeatherMark(m.sky, m.variant, fr));
      const d = driftOffset(elapsed, m.dir, m.phase, DRIFT_TRAVEL[m.sky]);
      const z = ms();
      s.scale.set(z);
      s.position.set(atView(cx(m.x)) - Math.floor(s.texture.width / 2) * z + d.dx, cx(m.y) - Math.floor(s.texture.height / 2) * z + d.dy);
      s.alpha = MARK_ALPHA[m.sky] * d.alpha;
    });
  };
  const drawWeather = (o: Overview | null) => {
    const weather = o?.weather ?? [];
    let marks: WeatherMark[] = [];
    if (weather.length > 0) {
      // 海区范围按风向箭头所在的海区中心划分；中心不变时只算一次
      const centers = (o?.winds ?? []).map((w) => ({ region: w.region, x: w.x, y: w.y }));
      const key = centers.map((c) => `${c.region}@${c.x},${c.y}`).join(";");
      if (key !== samplesKey) {
        samplesKey = key;
        samples = regionSamples(statics.map, centers);
      }
      marks = weatherMarks(samples, weather, centers);
    }
    const sig = marksSignature(marks);
    if (sig === wxSig) return;
    wxSig = sig;
    wxMarks = marks;
    marks.forEach((_, i) => {
      let s = wxSprites[i];
      if (!s) {
        s = new PIXI.Sprite(PIXI.Texture.EMPTY);
        weatherLayer.addChild(s);
        wxSprites.push(s);
      }
      s.visible = true;
    });
    for (let i = marks.length; i < wxSprites.length; i++) wxSprites[i].visible = false;
    animateWeather();
  };

  // 地名避让时一定要显示的地点：悬停、选中或目的地、航线的终点、自己舰队停泊的地点
  labelFocus = () => {
    const ids = new Set<number>();
    if (hovered !== null) ids.add(hovered);
    const sel = selectedOrTarget();
    if (sel !== null) ids.add(sel);
    if (destLoc !== null) ids.add(destLoc);
    for (const f of lastOverview?.fleets ?? []) if (f.docked !== null) ids.add(f.docked);
    return ids;
  };

  // 环绕地图：镜头移动后，标记挪到离视野中心最近的那一份上；大地图换了镜头倍数后，标记按新的大小重摆
  relayoutWorld = () => {
    positionPlaces();
    for (const d of discs.values()) placeDisc(d);
    placeFrame(selectSprite, selectedOrTarget());
    placeFrame(hoverSprite, hovered !== null && hovered !== selectedOrTarget() ? hovered : null);
    drawRoutes();
    drawWinds(lastOverview);
    animateWeather();
    frameNo = -1;
  };

  // —— 夜色：夜色层、灯火与地点标记的色调随浓度变化；目标值变化时淡入淡出 ——
  let nightNow = 0;
  let nightTarget = 0;
  let nightGiven = false;
  let tintNow = -1;
  const applyNight = () => {
    const on = nightNow > 0.001;
    nightSprite.visible = on;
    nightSprite.alpha = nightAlpha(nightNow);
    lightLayer.visible = on;
    lightLayer.alpha = Math.min(1, nightNow * 1.25);
    const tint = placeTint(nightNow);
    if (tint !== tintNow) {
      tintNow = tint;
      placeLayer.tint = tint;
      discLayer.tint = tint;
      // 自己的舰队只压暗一半，夜里也看得清
      fleetLayer.tint = placeTint(nightNow * 0.5);
    }
  };

  // —— 动画 ——
  /** 发现物的闪现：换闪光帧，时间到了收起。 */
  const animateFlashes = () => {
    let ended = false;
    for (const d of discs.values()) {
      if (d.flashAt === null) continue;
      const t = elapsed - d.flashAt;
      if (t >= FLASH_MS) {
        d.flashAt = null;
        d.flash.visible = false;
        d.sprite.alpha = 1;
        ended = true;
        continue;
      }
      const ff = Math.floor(t / FLASH_FRAME_MS) % FLASH_FRAMES;
      d.flash.texture = tex(`dflash:${ff}`, () => drawDiscoveryFlash(ff));
      const z = ms();
      d.flash.scale.set(z);
      d.flash.position.set(atView(cx(d.x)) - Math.floor(d.flash.texture.width / 2) * z, cx(d.y) - Math.floor(d.flash.texture.height / 2) * z);
      d.flash.visible = true;
      // 图标本身也一明一暗
      d.sprite.alpha = Math.floor(t / (FLASH_FRAME_MS * 2)) % 2 === 0 ? 1 : 0.55;
    }
    if (ended) layoutScreen();
  };
  // H10a：手动航行的旗舰队在世界海图上与航行画面共用一份平滑（map/navMotion.ts）：每帧按航迹走、船头左右按对地航向翻，
  // 不等每天一次的推送。只在世界海图在前面（航行视图按 Tab 切到这里）时这样做——盖在航行画面下面时不必每帧重画。
  const flagshipDriven = () => {
    const first = lastOverview?.fleets[0];
    const s = useNavStore.getState();
    return !!first && first.docked === null && s.view === "world" && s.nav?.fleet === first.id;
  };
  const driveFlagship = (): boolean => {
    if (!flagshipDriven()) return false;
    const first = lastOverview?.fleets[0];
    const u = first ? units.get(`fleet:${first.id}`) : undefined;
    const m = u ? sampleFlagship(performance.now(), W, wrap) : null;
    if (!u || !m) return false;
    let x = m.x * C;
    const y = m.y * C;
    if (wrap) x = u.x + wrapDx(u.x, x, MW, true);
    const changed = Math.abs(x - u.x) > 0.01 || Math.abs(y - u.y) > 0.01;
    u.x = u.tx = x;
    u.y = u.ty = y;
    u.vx = u.vy = undefined;
    u.moving = m.moving;
    // 左右翻转带一点回差（偏离正南北 15° 以上才翻），船头指着正北、正南时不来回闪
    const e = Math.sin((m.heading * Math.PI) / 180);
    const face: 1 | -1 = e > 0.26 ? 1 : e < -0.26 ? -1 : u.face;
    const flipped = face !== u.face;
    u.face = face;
    return changed || flipped || m.animating;
  };
  app.ticker.add((ticker) => {
    const dt = ticker.deltaMS;
    elapsed += dt;
    // 海图淡入
    if (terrainLayer.visible && terrainLayer.alpha < 1) {
      fadeStart ??= elapsed;
      terrainLayer.alpha = Math.min(1, (elapsed - fadeStart) / TERRAIN_FADE_MS);
    }
    animateFlashes();
    if (detailDirty) updateDetail();
    // 天气特效：雨线下落、闪电、新旧压暗的交叉淡入淡出
    wxFx.frame(dt);
    monsoon.frame(elapsed, cam.s);
    // 夜色淡入淡出
    if (nightNow !== nightTarget) {
      nightNow = approachNight(nightNow, nightTarget, dt);
      applyNight();
    }
    const fading = (terrainLayer.visible && terrainLayer.alpha < 1) || nightNow !== nightTarget;
    const f = Math.floor(elapsed / 170);
    const k = Math.min(1, dt / 260);
    let moved = driveFlagship();
    for (const u of units.values()) {
      if (Math.abs(u.tx - u.x) > 0.05 || Math.abs(u.ty - u.y) > 0.05) {
        if (u.vx !== undefined && u.vy !== undefined) {
          // 匀速滑向目标，不越过
          const nx = u.x + u.vx * dt;
          const ny = u.y + u.vy * dt;
          u.x = (u.tx - u.x) * (u.tx - nx) <= 0 ? u.tx : nx;
          u.y = (u.ty - u.y) * (u.ty - ny) <= 0 ? u.ty : ny;
        } else {
          u.x += (u.tx - u.x) * k;
          u.y += (u.ty - u.y) * k;
        }
        moved = true;
      }
    }
    if (f !== frameNo || moved) {
      frameNo = f;
      for (const u of units.values()) drawUnit(u, f, elapsed);
      const sf = Math.floor(elapsed / 220) % SELECT_FRAMES;
      selectSprite.texture = tex(`select:${sf}`, () => drawSelectFrame(sf));
      hoverSprite.texture = tex("select:0", () => drawSelectFrame(0));
      const df = Math.floor(elapsed / 300) % 4;
      destSprite.texture = tex(`dest:${df}`, () => drawDestPin(df));
      // 风向箭头沿风向缓缓漂动
      const drift = Math.floor(elapsed / 260) % 4;
      (lastOverview?.winds ?? []).forEach((w, i) => {
        const s = windSprites[i];
        if (!s) return;
        const [dx, dy] = WIND_DIRS[((w.dir % 8) + 8) % 8];
        const z = ms();
        // 漂动的步子：带细图层的大地图上按标记的倍数（镜头放大了，箭头不跟着一步跳半格）
        const step = detail ? drift * z : drift;
        s.position.set(atView(cx(w.x)) - Math.floor(s.texture.width / 2) * z + dx * step, cx(w.y) - Math.floor(s.texture.height / 2) * z + dy * step);
        s.alpha = drift === 3 ? 0.55 : 0.85;
      });
      animateWeather();
    }
    // 两侧被界面遮住的宽度变了（从街景切过来时功能窗口刚收起、左侧栏展开或收起）：玩家还没自己动过镜头时重新对准，
    // 不让旗舰队停在已经不存在的“窗口左边那一块”的中央
    const area = safeArea();
    if (area.left !== aimedLeft || area.right !== aimedRight) {
      if (!userMoved && !down) aim();
      else {
        aimedLeft = area.left;
        aimedRight = area.right;
      }
    }
    // 航行时镜头跟随旗舰队
    const flag = units.get(`fleet:${lastOverview?.fleets[0]?.id ?? -1}`);
    const atSea = lastOverview?.fleets[0]?.docked === null;
    let panning = false;
    if (follow && atSea && flag && !down) {
      const tx = viewCenterX() - atView(flag.x) * cam.s;
      const ty = screenH() / 2 - flag.y * cam.s;
      if (Math.abs(tx - cam.x) > 1 || Math.abs(ty - cam.y) > 1) {
        cam.x += (tx - cam.x) * Math.min(1, dt / 400);
        cam.y += (ty - cam.y) * Math.min(1, dt / 400);
        applyCam();
        panning = true;
      }
    }
    // 帧率（性能，11-10）：有东西在平滑地动——拖动、双指缩放、镜头跟随、舰队在走、海图与夜色的淡入淡出——时每秒 60 帧；
    // 否则 30 帧就够（像素动画本身每秒不到十帧，雨线按经过的时间走）。原来不设上限，120 / 144 Hz 的屏幕上整张海图每帧都重画一遍
    app.ticker.maxFPS = down !== null || pinch !== null || moved || panning || fading ? BUSY_FPS : IDLE_FPS;
  });

  // 待确认的航线与目的地变化时重画
  const unsubVoyage = useVoyageStore.subscribe((s, old) => {
    if (s.plan !== old.plan || s.target !== old.target) {
      drawRoutes();
      placeFrame(selectSprite, selectedOrTarget());
      placeHover();
    }
    // 规划航线的两端不都在视野里时，镜头移到航线中点
    if (s.plan && s.plan !== old.plan && s.plan.path.length > 0) {
      const xs = unwrapPath(s.plan.path, W, wrap).map(([x]) => cx(x));
      const ys = s.plan.path.map(([, y]) => cx(y));
      const inView = (x: number, y: number) => {
        const sx = cam.x + x * cam.s;
        const sy = cam.y + y * cam.s;
        return sx > 40 && sy > 40 && sx < screenW() - 40 && sy < screenH() - 40;
      };
      const n = xs.length - 1;
      if (!inView(xs[0], ys[0]) || !inView(xs[n], ys[n])) {
        follow = false;
        centerOn((Math.min(...xs) + Math.max(...xs)) / 2, (Math.min(...ys) + Math.max(...ys)) / 2);
      }
    }
    if (s.picking !== old.picking) setCursor();
  });
  setCursor();

  // 已发现的发现物与新发现的闪现
  const unsubFound = useFoundStore.subscribe((s, old) => {
    if (s.found !== old.found) refreshDiscoveries(s.found);
    if (s.freshSeq !== old.freshSeq && s.fresh.length > 0) flashDiscoveries(s.fresh);
  });
  refreshDiscoveries(useFoundStore.getState().found);

  // 大地图的迷雾：从迷雾的 store 喂给共用的后台线程（与航行视图共用一份喂法），地点按位图查揭开没有
  const fogMap = opts.fogMap;
  let detachFog = () => {};
  let unsubFog = () => {};
  if (fogMap !== undefined) {
    detachFog = attachFogFeed(hub, fogMap);
    let seenSeq = -1;
    const onFogStore = () => {
      const st = useChartFog.getState();
      if (st.map !== fogMap || st.seq === seenSeq) return;
      const look = fogLookup(st, fogMap);
      if (!look) return;
      seenSeq = st.seq;
      fogAt = look;
      fogAsked = true;
      refreshPlaces();
    };
    unsubFog = useChartFog.subscribe(onFogStore);
    onFogStore();
  }

  let lastDocked: number | null | undefined;
  let lastSitesKey = "";
  let lastConditionsKey = "";
  return {
    fogFromStore: fogMap !== undefined,
    // R10-Q02：只读，给海图上的 DOM 叠层（置顶任务的标记）换算位置；环绕地图取离视野中心最近的那一份
    cellToScreen(x, y) {
      let sx = cam.x + x * C * cam.s;
      if (wrap) {
        const mw = MW * cam.s;
        if (mw > 0) sx += Math.round((screenW() / 2 - sx) / mw) * mw;
      }
      return { x: sx, y: cam.y + y * C * cam.s };
    },
    update(o, selectedLoc) {
      lastOverview = o;
      // 看见过的地点（第九批的世界；没有这个字段时全部画出）
      const nextSighted = Array.isArray(o?.sighted) ? o.sighted : null;
      const nextKey = nextSighted ? nextSighted.join(",") : "";
      if (nextKey !== sightedKey || (nextSighted === null) !== (sighted === null)) {
        sightedKey = nextKey;
        sighted = nextSighted ? new Set(nextSighted) : null;
        positionPlaces();
        layoutScreen();
      }
      if (selectedLoc !== selected) {
        selected = selectedLoc;
        // 在列表里选中的地点不在视野中央时，镜头移过去
        const l = selectedLoc !== null ? locById(statics, selectedLoc) : undefined;
        if (l) {
          // 点了地点常常同时打开港口窗口：两侧遮住多少重新量一次，被窗口盖住的地点也算“不在视野里”
          safeCache.at = -Infinity;
          const left = safeLeft();
          const right = safeRight();
          const sx = cam.x + atView(cx(l.x)) * cam.s;
          const sy = cam.y + cx(l.y) * cam.s;
          const margin = Math.min(screenW() - left - right, screenH()) * 0.15;
          if (sx < left + margin || sx > screenW() - right - margin || sy < margin || sy > screenH() - margin) {
            follow = false;
            centerOn(cx(l.x), cx(l.y));
          }
          // 镜头已经照这一次量到的遮挡看过选中的地点：动画循环不必再因为“窗口刚打开”去对准旗舰队
          aimedLeft = left;
          aimedRight = right;
        }
      }
      placeFrame(selectSprite, selectedOrTarget());
      placeHover();
      if (o && o.season !== season) {
        // 季节变化：换一张海图（树色与积雪）。下一季已在后台预先生成，通常立即换上
        season = o.season;
        if (chartAsked) jobs.chart(season);
        // 细节瓦片按季节另画：换季后重新要（旧季的留在缓存里，转回来不必重画）
        detailDirty = true;
      }
      drawWinds(o);
      drawWeather(o);
      chartCells.update(o);
      wxFx.update(o);
      // 殖民点的占领与殖民地状态（有变化时才重换标记）
      const nextSites = siteStates(o);
      const sitesKey = JSON.stringify([...nextSites.values()]);
      if (sitesKey !== lastSitesKey) {
        lastSitesKey = sitesKey;
        sites = nextSites;
        refreshPlaces();
      }
      // 港口市况：地名下方的小字（有变化时才重排）
      const conditions = portConditions(o);
      const conditionsKey = [...conditions].map(([l, c]) => `${l}:${c}`).join(",");
      if (conditionsKey !== lastConditionsKey) {
        lastConditionsKey = conditionsKey;
        for (const p of places) {
          if (!p.cond) continue;
          const c = conditions.get(p.id);
          p.cond.text = c ? tk(`portCondition.${c}`) : "";
          p.cond.style.fill = c ? CONDITION_COLORS[c] : P.white;
        }
        layoutScreen();
      }
      // 迷雾：概览表明有探索记录后才等待迷雾
      showTerrain();
      for (const u of units.values()) u.seen = false;
      if (o) {
        o.fleets.forEach((f, i) => {
          const ship = f.ships[0];
          const kind = ship?.kind ?? 0;
          const sail = statics.ships[kind]?.sail ?? "square";
          // 停泊时船靠在码头右侧，不挡住港口标记；手动航行时用小数坐标（格坐标，格 i 占 [i, i+1)）
          const pos = f.docked === null ? f.pos : undefined;
          // 靠在码头右侧的偏移：经典世界直接加进位置（照旧平滑移过去）；大地图上按标记的倍数摆（镜头倍数变了也跟着变）
          const dockX = f.docked !== null ? 10 : 0;
          const dockY = f.docked !== null ? 2 : 0;
          const x = pos ? pos.x * C : cx(f.x) + (bigMap ? 0 : dockX);
          const y = pos ? pos.y * C : cx(f.y) + (bigMap ? 0 : dockY);
          const u = upsert(`fleet:${f.id}`, fleetLayer, x, y, shipArt(shipArtKey(statics.ships, kind), sail, { flag: PLAYER_FLAG }), {
            flagship: i === 0,
            ox: bigMap ? dockX : 0,
            oy: bigMap ? dockY : 0,
          });
          // 航向：手动航行按 heading（偏东朝右），否则沿航线的下一格
          const next = f.path.find(([px, py]) => px !== f.x || py !== f.y);
          if (typeof f.heading === "number" && f.docked === null) {
            // 旗舰队手动航行、世界海图在前面时，朝向由每帧的平滑（ticker 里的 driveFlagship）给，这里不按舵向翻
            if (!(i === 0 && flagshipDriven())) {
              const e = Math.sin((f.heading * Math.PI) / 180);
              if (Math.abs(e) > 1e-6) u.face = e > 0 ? 1 : -1;
            }
          } else if (next && next[0] !== f.x) u.face = wrapDx(f.x, next[0], W, wrap) > 0 ? 1 : -1;
          if (f.docked !== null) u.moving = false;
        });
        const first = o.fleets[0];
        if (first) {
          // 出港时镜头重新跟随
          if (lastDocked !== undefined && lastDocked !== null && first.docked === null) follow = true;
          lastDocked = first.docked;
        }
        o.others.forEach((m, i) => {
          const h = hash32(m.owner);
          upsert(`other:${i}`, otherLayer, cx(m.x), cx(m.y), shipArt(shipArtKey(null, h % 8), h % 3 === 0 ? "lateen" : "square", { flag: OTHER_FLAGS[h % OTHER_FLAGS.length] }));
        });
        o.pirates.forEach(([x, y], i) => {
          upsert(`pirate:${i}`, otherLayer, cx(x), cx(y), shipArt(shipArtKey(null, i % 3 === 0 ? 6 : 0), i % 2 === 0 ? "lateen" : "square", { pirate: true }));
        });
        for (const c of o.caravans) {
          const at = c.at ?? c.leg?.[0];
          const l = at !== undefined && at !== null ? locById(statics, at) : undefined;
          if (!l) continue;
          let x = cx(l.x);
          let y = cx(l.y);
          if (c.leg) {
            const to = locById(statics, c.leg[1]);
            if (to) {
              const p = c.leg[2] / 10000;
              x += (cx(to.x) - x) * p;
              y += (cx(to.y) - y) * p;
            }
          }
          // 停在城里的商队站在城门旁边
          const gateX = c.leg ? 0 : 9;
          const gateY = c.leg ? 0 : 3;
          upsert(`caravan:${c.id}`, otherLayer, Math.round(x) + (bigMap ? 0 : gateX), Math.round(y) + (bigMap ? 0 : gateY), caravanArt, {
            ox: bigMap ? gateX : 0,
            oy: bigMap ? gateY : 0,
          });
        }
      }
      for (const [key, u] of units) {
        if (u.seen) continue;
        u.root.destroy({ children: true });
        units.delete(key);
      }
      // 悬停着的船队已经不在概览里（离港、沉没）：收起信息卡
      if (hoveredFleet !== null && !o?.others[hoveredFleet]) hoverFleet(null);
      drawRoutes();
      frameNo = -1;
    },
    setFog(rows) {
      fogAt = rowsLookup(rows);
      fogAsked = true;
      // 后台线程只重画变化的格子附近，回来后只把这一块写回纹理
      jobs.fog(rows);
      refreshPlaces();
    },
    setHoverFleet(cb) {
      onHoverFleet = cb;
    },
    zoomBy(dir) {
      zoomStep(dir, viewCenterX(), screenH() / 2);
    },
    zoomFit() {
      cam.s = levels()[0];
      follow = false;
      userMoved = true;
      centerOn(MW / 2, MH / 2);
    },
    setWeatherFx(opts) {
      wxFx.setOptions(opts);
    },
    setMonsoon(data, reduced) {
      monsoon.setReduced(!!reduced);
      monsoon.set(data);
    },
    setNight(amount) {
      const a = Number.isFinite(amount) ? Math.max(0, Math.min(1, amount)) : 0;
      nightTarget = a;
      // 第一次（刚打开海图）直接到位，之后由动画时钟淡入淡出
      if (!nightGiven) {
        nightGiven = true;
        nightNow = a;
        applyNight();
      }
    },
    destroy() {
      destroyed = true;
      clearTimeout(fogWait);
      unsubFog();
      detachFog();
      unsubHub();
      account(canvasLedger, 0);
      account(`${hub.key}:detail`, 0);
      detailTex.clear();
      detailFog.clear();
      wxFx.destroy();
      monsoon.destroy();
      account(wxLedger, 0);
      hub.release();
      unsubVoyage();
      unsubFound();
      unsubStage();
      ro?.disconnect();
      app.canvas.removeEventListener("wheel", onWheel);
      app.canvas.removeEventListener("pointerleave", onLeave);
      app.destroy(true, { children: true });
      for (const t of textures.values()) if (t !== PIXI.Texture.EMPTY) t.destroy(true);
      terrain.destroy();
      fog.destroy();
      textures.clear();
    },
  };
}
