// 街景规划的公共部分：港口 / 城市（port.ts）与殖民地 / 殖民点（colony.ts）共用的类型与排布函数。
import type { Px } from "../art/px";
import type { ArchStyle, TownStyle } from "../art/buildings";
import type { PortraitSpec } from "../art/portraits";
import type { Rng } from "../art/rng";
import type { Climate } from "../art/scenery";
import type { Facility } from "../store/game";

/** 街景的逻辑高度（像素）。 */
export const SCENE_HEIGHT = 270;
/** 海平线 */
export const HORIZON = 146;
/** 主角的船停在栈桥边时，船底所在的行 */
export const BERTH_BOTTOM = SCENE_HEIGHT - 5;

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** 可点击的设施区域（逻辑像素，互不重叠，都在画面内）。 */
export interface Hotspot extends Rect {
  facility: Facility;
}

/** 殖民地里可点击的殖民建筑（与设施热点互不重叠）。 */
export interface BuildingHotspot extends Rect {
  /** 殖民建筑 key（colony.toml） */
  building: string;
  /** 建筑等级 1–3 */
  level: number;
}

/** 一次贴图操作。 */
export interface Op {
  px: Px;
  x: number;
  y: number;
  flipX?: boolean;
  /** 设施建筑：悬停时在它之后画亮描边 */
  fac?: Facility;
  /** 殖民建筑：悬停时同样画亮描边 */
  bld?: string;
  /** 亮灯变体（窗户、灯笼亮起）：夜里、黄昏与阴雨天按比例换用；尺寸必须与 px 相同，否则不换 */
  lit?: () => Px;
  /** 光源：亮灯时在灯光色像素的中心画一圈暖色光晕，值为光晕半径（街灯、灯笼） */
  glow?: number;
  /** 旗杆：风朝西吹时以旗杆为轴水平翻转，让旗朝风的去向飘 */
  flag?: boolean;
  /** 冒炊烟：烟从图的最高处升起，朝风的去向飘散 */
  smoke?: boolean;
  /** 亮灯的优先级 0–1（越小越先亮）：按时段的亮灯比例决定这一处亮不亮；缺省 0（最先亮，如设施） */
  litRank?: number;
}

export interface WalkerPlan {
  spec: PortraitSpec;
  /** 脚底所在的行 */
  feet: number;
  x0: number;
  x1: number;
  /** 每帧移动的像素（0 表示站着不动） */
  speed: number;
  phase: number;
  /** 站着的人朝左 */
  faceLeft: boolean;
}

export interface CloudPlan {
  variant: number;
  y: number;
  x0: number;
  speed: number;
}

export interface GullPlan {
  cx: number;
  cy: number;
  rx: number;
  ry: number;
  period: number;
  phase: number;
}

/** 街景的静态规划（布局与贴图操作），按参数缓存。 */
export interface Plan {
  width: number;
  style: ArchStyle;
  /** 画建筑用的城镇风格（第九批的文化风格；缺省同 style） */
  town?: TownStyle;
  climate: Climate;
  snow: boolean;
  kind: "port" | "city" | "colony" | "site";
  /** 城镇区（或陆地）的右边界：港口右侧是海湾，城市右侧是城门外 */
  townW: number;
  /** 城镇（不透明部分）的贴图操作，按由远到近的顺序 */
  ops: Op[];
  hotspots: Hotspot[];
  /** 殖民地的殖民建筑热点 */
  buildings: BuildingHotspot[];
  /** 殖民点：留给“建立殖民地”按钮的空地 */
  found: Rect | null;
  walkers: WalkerPlan[];
  clouds: CloudPlan[];
  gulls: GullPlan[];
  /** 城市：城门外路上的商队 */
  caravan: { x0: number; x1: number; feet: number; animal: number; count: number; driver: PortraitSpec } | null;
  /** 栈桥或殖民地码头（在海面之前画）；px 缺省时按风格画港口栈桥 */
  pier: { x: number; w: number; px?: Px; y?: number } | null;
  /** 主角的船：pier 为停在栈桥边（左边界 berthX），anchor 为下锚在湾里（左边界 berthX、船底 anchorBottom） */
  berthMode: "pier" | "anchor";
  berthX: number;
  anchorBottom: number;
  /** 湾里的浮标 */
  buoys: { x: number; y: number }[];
  /** 殖民地 / 殖民点的岸线浪花点（x, y 交替）；港口用岸壁一线，为 null */
  foam: Int16Array | null;
  /** 远方灯塔的灯室位置：夜里亮起、扫出光束；没有灯塔时缺省 */
  beacon?: { x: number; y: number } | null;
}

/**
 * 在 [x0, x1) 内排开一排建筑：放得下时按间隔均匀分布（两端留半个间隔），放不下时等量交叠。
 * 返回的每一项在原项上加上左边界 x。
 */
export function placeRow<T extends { px: Px }>(items: T[], x0: number, x1: number, r: Rng): (T & { x: number })[] {
  const n = items.length;
  if (n === 0) return [];
  const span = x1 - x0;
  const total = items.reduce((a, it) => a + it.px.w, 0);
  const out: (T & { x: number })[] = [];
  if (total <= span) {
    const unit = (span - total) / n;
    // 间隔带一点确定性的起伏，避免排得像棋盘
    const jit = items.map(() => r.range(0.75, 1.25));
    const sum = jit.reduce((a, b) => a + b, 0);
    let x = x0 + (unit * jit[0] * n) / sum / 2;
    for (let i = 0; i < n; i++) {
      out.push({ ...items[i], x: Math.round(x) });
      const next = i + 1 < n ? jit[i + 1] : jit[i];
      x += items[i].px.w + (unit * n * (jit[i] + next)) / (2 * sum);
    }
  } else if (n === 1) {
    out.push({ ...items[0], x: Math.round(x0 + (span - total) / 2) });
  } else {
    const ov = (total - span) / (n - 1);
    let x = x0;
    for (const it of items) {
      out.push({ ...it, x: Math.round(x) });
      x += it.px.w - ov;
    }
  }
  return out;
}

/** 矩形 a 减去（在它前面的）矩形 b，保留面积最大的一块；完全被挡住时返回空矩形。 */
export function cutRect(a: Rect, b: Rect): Rect {
  const ix0 = Math.max(a.x, b.x);
  const iy0 = Math.max(a.y, b.y);
  const ix1 = Math.min(a.x + a.w, b.x + b.w);
  const iy1 = Math.min(a.y + a.h, b.y + b.h);
  if (ix0 >= ix1 || iy0 >= iy1) return a;
  const pieces: Rect[] = [
    { x: a.x, y: a.y, w: b.x - a.x, h: a.h },
    { x: b.x + b.w, y: a.y, w: a.x + a.w - (b.x + b.w), h: a.h },
    { x: a.x, y: a.y, w: a.w, h: b.y - a.y },
    { x: a.x, y: b.y + b.h, w: a.w, h: a.y + a.h - (b.y + b.h) },
  ].filter((p) => p.w > 0 && p.h > 0);
  if (pieces.length === 0) return { x: a.x, y: a.y, w: 0, h: 0 };
  return pieces.reduce((best, p) => (p.w * p.h > best.w * best.h ? p : best));
}

/** 一排建筑之间（以及两端）的空隙。 */
export function gapsOf(row: { x: number; px: Px }[], x0: number, x1: number): [number, number][] {
  const out: [number, number][] = [];
  let x = x0;
  for (const p of row) {
    if (p.x - x > 0) out.push([x, p.x]);
    x = Math.max(x, p.x + p.px.w);
  }
  if (x1 - x > 0) out.push([x, x1]);
  return out;
}

export function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

export function clipRect(r: Rect, w: number, h: number): Rect {
  const x0 = clamp(r.x, 0, w);
  const y0 = clamp(r.y, 0, h);
  const x1 = clamp(r.x + r.w, 0, w);
  const y1 = clamp(r.y + r.h, 0, h);
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}
