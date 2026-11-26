// 航行视图的画法（2D 画布）：以舰队为中心的局部海图——瓦片（tiles.ts，已盖好迷雾）、视野圈、今天走过的航迹、
// 照现在的舵与帆的预测（预测就是结果）、拖动罗经盘时的预测、会停下的地方、看见过的港口、风与洋流的流线、按航向旋转的船。
// 坐标：格坐标 (x, y)（格 i 占 [i, i+1)），镜头中心在船上；环绕地图的点都摆在离镜头最近的那一份上。
// 纯绘制（给什么画什么），不持有状态；没有 2D 画布（测试环境）时调用方不调用这里。
import { P, ink } from "../art/palette";
import { headingVector } from "../components/nav/navKit";
import type { NavCell, NavSightings } from "../ipc/types";
import { declutter, type Box } from "./camera";
import { drawCells, drawShips, type PlacedShip } from "./navSea";
import { drawSightings } from "./navSights";
import { drawQuestMark, type QuestMarkTarget } from "./questMark";
import { visibleTiles, type TileSlot } from "./tiles";
import { nearestCopy } from "./wrap";

/** 航行视图的镜头：中心（格）、每格像素、画布大小（CSS 像素）与地图尺寸。 */
export interface NavCamera {
  cx: number;
  cy: number;
  cellPx: number;
  viewW: number;
  viewH: number;
  width: number;
  height: number;
  wrap: boolean;
}

/** 格坐标 → 画布坐标（环绕时取离镜头最近的那一份）。 */
export function toScreen(cam: NavCamera, x: number, y: number): { sx: number; sy: number } {
  const ux = nearestCopy(x, cam.cx, cam.width, cam.wrap);
  return { sx: cam.viewW / 2 + (ux - cam.cx) * cam.cellPx, sy: cam.viewH / 2 + (y - cam.cy) * cam.cellPx };
}

/** 画布坐标 → 格坐标（横向展开，未取模）。 */
export function toCell(cam: NavCamera, sx: number, sy: number): { x: number; y: number } {
  return { x: cam.cx + (sx - cam.viewW / 2) / cam.cellPx, y: cam.cy + (sy - cam.viewH / 2) / cam.cellPx };
}

/** 视野里的瓦片（按镜头）。tileCells 为每块的边长（格；缺省 64，细节瓦片 32）；pad 为四周多取的屏幕像素（提前画视野外一圈）。 */
export function cameraTiles(cam: NavCamera, tileCells?: number, pad = 0): TileSlot[] {
  return visibleTiles(cam.cx, cam.cy, cam.viewW + 2 * pad, cam.viewH + 2 * pad, cam.cellPx, cam.width, cam.height, cam.wrap, tileCells);
}

export interface NavPort {
  x: number;
  y: number;
  name: string;
}

export interface NavDrawInput {
  cam: NavCamera;
  /** 瓦片的图（还没生成的为 null，先画海色） */
  tile: (slot: TileSlot) => CanvasImageSource | null;
  /** 一块瓦片的像素尺寸（每格 tilePx 像素） */
  tilePx: number;
  /** 每块瓦片的边长（格）：缺省 64；细节瓦片（M01）是 32 */
  tileCells?: number;
  /** 盖在瓦片上的另一张图（细节瓦片的迷雾；没有为 null）：瓦片画出来了才画 */
  overlay?: (slot: TileSlot) => CanvasImageSource | null;
  /**
   * 线条、箭头、流线这些“笔画”的基准格宽（像素）：缺省就是镜头的格宽。细节瓦片的镜头格宽是 24 / 48 / 72，
   * 笔画照这个基准画（缺省档 48 像素时给 18，与改动前缺省档的笔画一样粗），不跟着地图一起变成粗杠。
   */
  unitPx?: number;
  /** 港口锚标与海上所见小标记的像素倍率：缺省照格宽算（原来的算法）。H10a 起细节瓦片下与地形缩放脱钩（2 或 3 倍） */
  spriteScale?: number;
  /**
   * 自己的船：art 是船头朝上的俯视图（artW × artH 是它在“1 倍”时的尺寸，图本身可以是放大过的高清图），
   * lengthPx 是屏上的船长（像素；H10a：0.3 格、夹在 36–64）。给了 lengthPx 时平滑缩放、平滑旋转；不给时照旧按 spriteScale 的整数倍。
   */
  ship: { x: number; y: number; heading: number; art: CanvasImageSource | null; artW: number; artH: number; lengthPx?: number };
  /** 别的船的屏上长度（像素；H10a：约 0.25 格）。不给时与自己的船同一像素倍率（原来的画法） */
  otherLengthPx?: number;
  /** 瓦片放大时平滑插值（不给时最近邻；H10c 的高清瓦片用平滑） */
  smoothTiles?: boolean;
  sight: number;
  trail: readonly (readonly [number, number])[];
  forecast: readonly (readonly [number, number])[];
  preview: readonly (readonly [number, number])[] | null;
  stops: readonly { x: number; y: number; kind: string }[];
  ports: readonly NavPort[];
  portArt: CanvasImageSource | null;
  portArtW: number;
  portArtH: number;
  wind: { dir: number; force: number } | null;
  current: { dir: number; speed: number } | null;
  /** 动画时钟（毫秒） */
  time: number;
  labelFont: string;
  /** 格是不是已揭开的海（洋流只画在这里）；不给时到处都画 */
  seaAt?: (x: number, y: number) => boolean;
  /** 格是否已揭开（风的流线不画在迷雾上）；不给时到处都画 */
  revealedAt?: (x: number, y: number) => boolean;
  /** H03：视野 × 2 以内的天气团 */
  cells?: readonly NavCell[];
  /** H03：视野里的别的船（已按分钟摆好位置） */
  ships?: readonly PlacedShip[];
  /** H03：当前分钟（追击航迹从这里往后画） */
  minute?: number | null;
  /** H04：海上所见的小标记 */
  sightings?: NavSightings["marks"];
  /** R10-Q02：置顶任务的去处（画面外时在边缘画箭头；没有为 null） */
  quest?: QuestMarkTarget | null;
}

/**
 * 港口锚标的倍数：与镜头的格宽分开算——缺省的每格 18 像素下仍是原尺寸，
 * 每格 24 像素起才放大一倍。原来按四舍五入算，18 像素时就已经是两倍。
 */
export function navMarkScale(cellPx: number): number {
  return Math.max(1, Math.floor(cellPx / 12));
}

/** 港口名的行高（像素，12 px 粗体加描边）。 */
const NAV_LABEL_H = 16;
const NO_FOCUS: ReadonlySet<number> = new Set();
/** 港口名的宽度按字体与名字记下来：每帧都要排，不必每帧都量。 */
const labelWidths = new Map<string, number>();
function labelWidth(ctx: CanvasRenderingContext2D, font: string, name: string): number {
  const key = `${font}|${name}`;
  let w = labelWidths.get(key);
  if (w === undefined) {
    w = ctx.measureText(name).width;
    if (labelWidths.size > 2000) labelWidths.clear();
    labelWidths.set(key, w);
  }
  return w;
}

/** 折线（格坐标）：逐点取离镜头最近的那一份，跨缝时自然连着画。 */
function polyline(ctx: CanvasRenderingContext2D, cam: NavCamera, pts: readonly (readonly [number, number])[], from?: { x: number; y: number }) {
  if (pts.length === 0) return;
  ctx.beginPath();
  let first = true;
  // 第一个点摆在离镜头最近的那一份上，之后相邻两点按最短的一条连（跨缝时横向展开到上一点附近）
  let prevX = nearestCopy(from ? from.x : pts[0][0], cam.cx, cam.width, cam.wrap);
  if (from) {
    ctx.moveTo(cam.viewW / 2 + (prevX - cam.cx) * cam.cellPx, cam.viewH / 2 + (from.y - cam.cy) * cam.cellPx);
    first = false;
  }
  for (const [x, y] of pts) {
    const ux = nearestCopy(x, prevX, cam.width, cam.wrap);
    prevX = ux;
    const sx = cam.viewW / 2 + (ux - cam.cx) * cam.cellPx;
    const sy = cam.viewH / 2 + (y - cam.cy) * cam.cellPx;
    if (first) {
      ctx.moveTo(sx, sy);
      first = false;
    } else ctx.lineTo(sx, sy);
  }
  ctx.stroke();
}

/** 画一帧航行视图。 */
export function drawNav(ctx: CanvasRenderingContext2D, d: NavDrawInput): void {
  const { cam } = d;
  const { viewW, viewH, cellPx } = cam;
  ctx.imageSmoothingEnabled = d.smoothTiles === true;
  if (d.smoothTiles) ctx.imageSmoothingQuality = "high";
  ctx.fillStyle = P.sea[1];
  ctx.fillRect(0, 0, viewW, viewH);

  // 瓦片
  const T = d.tileCells ?? 64;
  for (const slot of cameraTiles(cam, T)) {
    const img = d.tile(slot);
    const s = { sx: viewW / 2 + (slot.x - cam.cx) * cellPx, sy: viewH / 2 + (slot.y - cam.cy) * cellPx };
    const cw = Math.min(T, cam.width - slot.tx * T);
    const ch = Math.min(T, cam.height - slot.ty * T);
    // 两端各自取整（连续缩放时每格像素不是整数，宽高分别取整会在相邻两块之间留一像素的缝）
    const x0 = Math.round(s.sx);
    const y0 = Math.round(s.sy);
    const w = Math.round(s.sx + cw * cellPx) - x0;
    const h = Math.round(s.sy + ch * cellPx) - y0;
    if (img) {
      ctx.drawImage(img, x0, y0, w, h);
      const over = d.overlay?.(slot);
      if (over) ctx.drawImage(over, x0, y0, w, h);
    } else {
      // 还没生成：羊皮纸色的底，免得先露出未探明的海
      ctx.fillStyle = P.parchment;
      ctx.fillRect(x0, y0, w, h);
    }
  }
  // 瓦片之后的小图（锚标、所见）照旧按硬边画
  ctx.imageSmoothingEnabled = false;

  // 视野四角对应的格（流线按海面上的位置摆放，跟着海走，不跟着镜头走）
  const tl = toCell(cam, 0, 0);
  const br = toCell(cam, viewW, viewH);
  const fx = (x: number) => (cam.wrap ? ((Math.floor(x) % cam.width) + cam.width) % cam.width : Math.floor(x));
  // 笔画的基准格宽 u，与它相对镜头格宽的比例 k（流线的间距、长短按 k 缩：镜头放大了，流线不跟着稀成几根）
  const u = d.unitPx ?? cellPx;
  const k = u / cellPx;

  // 洋流：沿流向缓缓漂动的小箭头（青色、半透明），每 6 格一个，只画在已揭开的海上
  if (d.current && d.current.speed > 0) {
    const v = headingVector(d.current.dir);
    const STEP = 6 * k;
    const shift = ((d.time / 1000) * Math.min(3, d.current.speed) * 0.35 * k) % STEP;
    const len = u * 0.9;
    ctx.strokeStyle = "rgba(79, 208, 196, 0.42)";
    ctx.lineWidth = Math.max(1, u / 9);
    ctx.lineCap = "round";
    for (let j = Math.floor(tl.y / STEP) - 1; j * STEP < br.y + STEP; j++) {
      const gy = j * STEP;
      for (let i = Math.floor(tl.x / STEP) - 1; i * STEP < br.x + STEP; i++) {
        const gx = i * STEP;
        // 隔行错开半格，看起来不像方格
        const cxw = gx + ((j & 1) * STEP) / 2 + v.x * shift;
        const cyw = gy + v.y * shift;
        if (cyw < 0 || cyw >= cam.height) continue;
        if (d.seaAt && !d.seaAt(fx(cxw), Math.floor(cyw))) continue;
        const ox = viewW / 2 + (cxw - cam.cx) * cellPx;
        const oy = viewH / 2 + (cyw - cam.cy) * cellPx;
        const hx = ox + v.x * len;
        const hy = oy + v.y * len;
        ctx.beginPath();
        ctx.moveTo(ox - v.x * len, oy - v.y * len);
        ctx.lineTo(hx, hy);
        // 箭头的两翼
        const bx = v.x * len * 0.45;
        const by = v.y * len * 0.45;
        ctx.moveTo(hx - bx - by, hy - by + bx);
        ctx.lineTo(hx, hy);
        ctx.lineTo(hx - bx + by, hy - by - bx);
        ctx.stroke();
      }
    }
  }

  // 风：顺着风的去向飘的白色流线（按海面位置的伪随机散布），风越大越多越长；迷雾上不画
  if (d.wind && d.wind.force > 0) {
    const to = headingVector(d.wind.dir + 180);
    const CELL = 5 * k;
    const density = Math.min(0.9, 0.2 + d.wind.force * 0.07);
    const travel = (3 + d.wind.force * 0.4) * k;
    ctx.strokeStyle = "rgba(216, 244, 248, 0.55)";
    ctx.lineWidth = Math.max(1, u / 10);
    for (let j = Math.floor(tl.y / CELL) - 1; j * CELL < br.y + CELL; j++) {
      const gy = j * CELL;
      for (let i = Math.floor(tl.x / CELL) - 1; i * CELL < br.x + CELL; i++) {
        const gx = i * CELL;
        // 流线的种子按网格的编号取（k 为 1 时就是原来按格坐标的算法）
        const key = k === 1 ? fx(gx) * 7919 + gy * 104729 : (((i % 4096) + 4096) % 4096) * 7919 + j * 104729;
        const h1 = Math.abs(Math.sin(key * 12.9898) * 43758.5453) % 1;
        if (h1 > density) continue;
        const h2 = Math.abs(Math.sin(key * 78.233) * 12543.123) % 1;
        const h3 = Math.abs(Math.sin(key * 39.425) * 24634.634) % 1;
        // 每条流线沿风向走一段、淡入淡出，然后从原处重来
        const life = ((d.time / 1000) * (0.15 + d.wind.force * 0.02) + h2) % 1;
        const wx = gx + h2 * CELL + to.x * life * travel;
        const wy = gy + h3 * CELL + to.y * life * travel;
        if (d.revealedAt && !d.revealedAt(fx(wx), Math.floor(wy))) continue;
        const sx = viewW / 2 + (wx - cam.cx) * cellPx;
        const sy = viewH / 2 + (wy - cam.cy) * cellPx;
        const len = u * (1.2 + d.wind.force * 0.15);
        ctx.globalAlpha = Math.sin(life * Math.PI);
        ctx.beginPath();
        ctx.moveTo(sx, sy);
        ctx.lineTo(sx + to.x * len, sy + to.y * len);
        ctx.stroke();
      }
    }
    ctx.globalAlpha = 1;
  }

  // H03 天气团：盖在海面与流线之上、航迹与船之下
  if (d.cells && d.cells.length > 0) drawCells(ctx, cam, d.cells, d.time, d.wind ? d.wind.dir : null, d.smoothTiles === true);

  // 视野圈
  const ship = toScreen(cam, d.ship.x, d.ship.y);
  if (d.sight > 0) {
    ctx.save();
    ctx.setLineDash([u * 0.6, u * 0.6]);
    ctx.strokeStyle = "rgba(243, 227, 195, 0.55)";
    ctx.lineWidth = Math.max(1, u / 10);
    ctx.beginPath();
    ctx.arc(ship.sx, ship.sy, d.sight * cellPx, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  // 今天走过的航迹（实线）、照现在的舵与帆的预测（白点线）、调整中的预测（金色虚线）
  ctx.save();
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  if (d.trail.length > 0) {
    ctx.strokeStyle = "rgba(43, 27, 23, 0.7)";
    ctx.lineWidth = Math.max(1.5, u / 5);
    polyline(ctx, cam, d.trail);
  }
  if (d.forecast.length > 0) {
    ctx.setLineDash([2, u * 0.5]);
    ctx.strokeStyle = "rgba(255, 255, 255, 0.85)";
    ctx.lineWidth = Math.max(2, u / 5);
    polyline(ctx, cam, d.forecast, { x: d.ship.x, y: d.ship.y });
  }
  if (d.preview && d.preview.length > 0) {
    ctx.setLineDash([u * 0.7, u * 0.4]);
    ctx.strokeStyle = P.gold[3];
    ctx.lineWidth = Math.max(2, u / 4);
    polyline(ctx, cam, d.preview, { x: d.ship.x, y: d.ship.y });
  }
  ctx.restore();

  // 会停下的地方：小菱形（陆地红、港口金、暴风雨紫、看见新地方青）
  for (const s of d.stops) {
    const p = toScreen(cam, s.x, s.y);
    const r = Math.max(3, u * 0.35);
    ctx.fillStyle = s.kind === "land" ? P.red[2] : s.kind === "port" ? P.gold[3] : s.kind === "storm" ? "#8a5cc4" : P.teal[3];
    ctx.strokeStyle = ink.deep;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(p.sx, p.sy - r);
    ctx.lineTo(p.sx + r, p.sy);
    ctx.lineTo(p.sx, p.sy + r);
    ctx.lineTo(p.sx - r, p.sy);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  }

  // 看见过的港口：锚标与名字。名字互相避让（濑户内海那样港口挨着港口的地方不叠成一团）：离船近的先摆，摆不下的只留锚标
  const mk = d.spriteScale ?? navMarkScale(cellPx);
  ctx.font = d.labelFont;
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  const seen: { name: string; sx: number; sy: number; far: number }[] = [];
  for (const port of d.ports) {
    const p = toScreen(cam, port.x + 0.5, port.y + 0.5);
    if (p.sx < -80 || p.sy < -40 || p.sx > viewW + 80 || p.sy > viewH + 40) continue;
    if (d.portArt) ctx.drawImage(d.portArt, Math.round(p.sx - (d.portArtW * mk) / 2), Math.round(p.sy - (d.portArtH * mk) / 2), d.portArtW * mk, d.portArtH * mk);
    seen.push({ name: port.name, sx: p.sx, sy: p.sy + (d.portArtH * mk) / 2 + 2, far: (p.sx - ship.sx) ** 2 + (p.sy - ship.sy) ** 2 });
  }
  const boxes: Box[] = seen.map((s) => {
    const w = labelWidth(ctx, d.labelFont, s.name);
    return { x0: s.sx - w / 2 - 2, y0: s.sy, x1: s.sx + w / 2 + 2, y1: s.sy + NAV_LABEL_H };
  });
  const order = seen.map((_, i) => i).sort((a, b) => seen[a].far - seen[b].far || a - b);
  const shown = declutter(boxes, order, NO_FOCUS);
  ctx.lineWidth = 3;
  ctx.strokeStyle = "#1a1423";
  ctx.fillStyle = P.white;
  seen.forEach((s, i) => {
    if (!shown.has(i)) return;
    ctx.strokeText(s.name, s.sx, s.sy);
    ctx.fillText(s.name, s.sx, s.sy);
  });

  // 船：按航向旋转（船头朝上的俯视图），船尾拖一道白浪
  const v = headingVector(d.ship.heading);
  // 像素倍率：给了屏上船长（H10a）时按它算（小数，平滑缩放）；否则照旧——每格 12 像素时原尺寸、放大镜头时跟着整数倍放大
  const markScale = d.spriteScale ?? Math.max(1, Math.round(cellPx / 12));
  const smoothShip = d.ship.lengthPx !== undefined && d.ship.artH > 0;
  const scale = smoothShip ? d.ship.lengthPx! / d.ship.artH : markScale;
  // H04 海上所见、H03 别的船：画在自己的船下面（别的船给了屏上长度时按它，否则与自己的船同一像素倍率）
  if (d.sightings && d.sightings.length > 0) drawSightings(ctx, cam, d.sightings, markScale, d.time);
  if (d.ships && d.ships.length > 0) drawShips(ctx, cam, d.ships, d.otherLengthPx ?? scale, d.minute ?? null, u, d.otherLengthPx !== undefined);
  ctx.save();
  ctx.strokeStyle = "rgba(216, 244, 248, 0.7)";
  ctx.lineWidth = Math.max(1, scale);
  for (let i = 1; i <= 3; i++) {
    const back = (d.ship.artH * scale) / 2 + i * 3 * scale;
    const wob = Math.sin(d.time / 200 + i) * scale;
    ctx.beginPath();
    ctx.moveTo(ship.sx - v.x * back - v.y * (i * 1.5 * scale + wob), ship.sy - v.y * back + v.x * (i * 1.5 * scale + wob));
    ctx.lineTo(ship.sx - v.x * (back + 2 * scale), ship.sy - v.y * (back + 2 * scale));
    ctx.lineTo(ship.sx - v.x * back + v.y * (i * 1.5 * scale + wob), ship.sy - v.y * back - v.x * (i * 1.5 * scale + wob));
    ctx.stroke();
  }
  ctx.translate(ship.sx, ship.sy);
  ctx.rotate((d.ship.heading * Math.PI) / 180);
  if (d.ship.art) {
    if (smoothShip) {
      // 平滑缩放与旋转：不取整（取整会让转弯时船身一抖一抖）
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = "high";
      const w = d.ship.artW * scale;
      const h = d.ship.artH * scale;
      ctx.drawImage(d.ship.art, -w / 2, -h / 2, w, h);
    } else ctx.drawImage(d.ship.art, Math.round((-d.ship.artW * scale) / 2), Math.round((-d.ship.artH * scale) / 2), d.ship.artW * scale, d.ship.artH * scale);
  }
  ctx.restore();

  // R10-Q02 置顶任务的去处：港口上的一枚小图钉；在画面外时画面边缘一枚箭头（最后画，不被船与帆影盖住）
  if (d.quest) drawQuestMark(ctx, toScreen(cam, d.quest.x + 0.5, d.quest.y + 0.5), viewW, viewH, d.quest.name, d.time);
}
