// 置顶任务的去处在地图上的标记（R10-Q02）：世界海图（QuestChartMark.tsx，DOM 叠层）与航行画面（navDraw.ts 里一处调用）共用。
// 地图要大、标记要小：一圈细细的金色描边 + 头上一枚小三角，像钉在港口上的一枚图钉；
// 目的地在画面外时，在画面边缘给一枚指向它的小箭头，旁边写地名。
// 去处取概览里的 quest_pin：go.port，其次眼下那一行的地点（questKit.ts 的 pinPlace）；只在航海期、地方看得见时标。
import { pinPlace } from "../components/people/questKit";
import type { Overview, StaticView } from "../ipc/types";
import { useGame } from "../store/game";

export interface QuestMarkTarget {
  loc: number;
  /** 地点所在的格（格 i 占 [i, i+1)，标记画在格中心） */
  x: number;
  y: number;
  name: string;
}

let cacheKey = "";
let cacheOverview: Overview | null = null;
let cacheStatics: StaticView | null = null;
let cached: QuestMarkTarget | null = null;

/** 按概览与静态数据算去处（同一份概览与静态数据只算一次：航行画面每帧都问）。 */
export function questMarkOf(o: Overview | null, statics: StaticView | null): QuestMarkTarget | null {
  if (o === cacheOverview && statics === cacheStatics) return cached;
  cacheOverview = o;
  cacheStatics = statics;
  const pin = o?.quest_pin;
  const place = o && o.mode !== "upbringing" && pin && pin.phase !== "upbringing" ? pinPlace(pin) : null;
  const l = place && place.loc !== null && statics ? statics.locations.find((x) => x.id === place.loc) : undefined;
  const key = l ? `${l.id}|${l.x}|${l.y}|${place?.label ?? l.name}` : "";
  if (key !== cacheKey) {
    cacheKey = key;
    cached = l ? { loc: l.id, x: l.x, y: l.y, name: place?.label ?? l.name } : null;
  }
  return cached;
}

/** 此刻的去处（从全局 store 取）。 */
export function questMarkTarget(): QuestMarkTarget | null {
  const g = useGame.getState();
  return questMarkOf(g.overview, g.statics);
}

/** 画面边缘的箭头离边多远（像素）。 */
export const EDGE_INSET = 26;

export interface MarkSpot {
  /** 标记（或边缘箭头）在画面上的位置 */
  x: number;
  y: number;
  /** 在画面里（画标记）还是画面外（画边缘箭头） */
  inside: boolean;
  /** 箭头的朝向（弧度，0 指右、顺时针；y 轴向下） */
  angle: number;
}

/** 边缘箭头离四边的距离（像素）：画面上有按钮、仪表的那几边留宽一些，箭头不钻到它们底下。 */
export interface EdgeInsets {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

/** 航行画面：上方正中是仪表条、右下是罗经盘与按钮。 */
export const NAV_INSETS: EdgeInsets = { top: 84, right: EDGE_INSET, bottom: 110, left: EDGE_INSET };
/** 世界海图：右上是缩放按钮与季风历（一起约 90 像素宽）。 */
export const CHART_INSETS: EdgeInsets = { top: EDGE_INSET, right: 110, bottom: EDGE_INSET, left: EDGE_INSET };

/**
 * 目标在画面上的位置 (sx, sy) → 画标记还是在边缘画箭头。inset 是箭头离边的距离（一个数或四边各自）；
 * margin 是“还算在画面里”的余量。箭头摆在从“缩进后的框”的中心朝目标的射线与框的交点上。
 */
export function markSpot(sx: number, sy: number, w: number, h: number, inset: number | EdgeInsets = EDGE_INSET, margin = 6): MarkSpot {
  if (sx >= margin && sy >= margin && sx <= w - margin && sy <= h - margin) return { x: sx, y: sy, inside: true, angle: 0 };
  const ins = typeof inset === "number" ? { top: inset, right: inset, bottom: inset, left: inset } : inset;
  const x0 = Math.min(ins.left, w / 2);
  const x1 = Math.max(w - ins.right, w / 2);
  const y0 = Math.min(ins.top, h / 2);
  const y1 = Math.max(h - ins.bottom, h / 2);
  const cx = (x0 + x1) / 2;
  const cy = (y0 + y1) / 2;
  const dx = sx - cx;
  const dy = sy - cy;
  const angle = Math.atan2(dy, dx);
  const hw = Math.max(1, (x1 - x0) / 2);
  const hh = Math.max(1, (y1 - y0) / 2);
  const k = Math.min(dx !== 0 ? hw / Math.abs(dx) : Infinity, dy !== 0 ? hh / Math.abs(dy) : Infinity);
  return { x: cx + dx * k, y: cy + dy * k, inside: false, angle };
}

const GOLD = "#e8c063";
const INK = "#1a1423";

/**
 * 在 2D 画布上画（航行画面）：画面里是图钉（细圈 + 头上的小三角，圈慢慢一呼一吸），画面外是边缘的小箭头与地名。
 * (sx, sy) 是目标格中心在画布上的位置；time 是动画时钟（毫秒）。
 */
export function drawQuestMark(ctx: CanvasRenderingContext2D, at: { sx: number; sy: number }, viewW: number, viewH: number, name: string, time: number): void {
  const s = markSpot(at.sx, at.sy, viewW, viewH, NAV_INSETS);
  ctx.save();
  ctx.lineJoin = "round";
  if (s.inside) {
    const breathe = 0.5 + 0.5 * Math.sin(time / 420);
    // 细圈：半径 15 像素，描一道深色底再描金色，海上与陆地上都看得清
    ctx.lineWidth = 4;
    ctx.strokeStyle = "rgba(26, 20, 35, 0.55)";
    ctx.beginPath();
    ctx.arc(s.x, s.y, 15, 0, Math.PI * 2);
    ctx.stroke();
    ctx.lineWidth = 2;
    ctx.strokeStyle = GOLD;
    ctx.globalAlpha = 0.65 + 0.35 * breathe;
    ctx.beginPath();
    ctx.arc(s.x, s.y, 15, 0, Math.PI * 2);
    ctx.stroke();
    ctx.globalAlpha = 1;
    // 头上的小三角（尖朝下，指着港口），随呼吸上下浮一两像素
    const top = s.y - 30 - breathe * 2;
    ctx.beginPath();
    ctx.moveTo(s.x - 6, top);
    ctx.lineTo(s.x + 6, top);
    ctx.lineTo(s.x, top + 9);
    ctx.closePath();
    ctx.fillStyle = GOLD;
    ctx.strokeStyle = INK;
    ctx.lineWidth = 1.5;
    ctx.fill();
    ctx.stroke();
  } else {
    // 边缘的小箭头：底色深、描金，尖朝着目标
    ctx.save();
    ctx.translate(s.x, s.y);
    ctx.rotate(s.angle);
    ctx.beginPath();
    ctx.moveTo(10, 0);
    ctx.lineTo(-6, -7);
    ctx.lineTo(-3, 0);
    ctx.lineTo(-6, 7);
    ctx.closePath();
    ctx.fillStyle = GOLD;
    ctx.strokeStyle = INK;
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.fill();
    ctx.restore();
    // 地名写在箭头朝画面里的一侧
    if (name) {
      ctx.font = 'bold 12px "Microsoft YaHei", "PingFang SC", sans-serif';
      ctx.textBaseline = "middle";
      const back = { x: s.x - Math.cos(s.angle) * 16, y: s.y - Math.sin(s.angle) * 16 };
      const left = Math.cos(s.angle) > 0.3;
      ctx.textAlign = left ? "right" : Math.cos(s.angle) < -0.3 ? "left" : "center";
      const ty = Math.abs(Math.sin(s.angle)) > 0.8 ? back.y - Math.sign(Math.sin(s.angle)) * 4 : back.y;
      ctx.lineWidth = 3;
      ctx.strokeStyle = INK;
      ctx.fillStyle = "#f4ecd8";
      ctx.strokeText(name, back.x, ty);
      ctx.fillText(name, back.x, ty);
    }
  }
  ctx.restore();
}
