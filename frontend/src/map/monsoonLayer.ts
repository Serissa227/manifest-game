// H07 季风历：世界图上按月画风向流线与洋流（数据来自后端的 monsoon 查询，只含已有海图的海区里的取样点）。
//
// 每个取样点一道顺风的虚线流线（风越大越长，前端带箭头），有洋流的点旁边另有一道淡蓝的短点线。
// 流线是三段相位轮流显示的虚线（每 350 毫秒换一段），看上去顺着风向流动；系统要求减少动态效果时只显示第一段、不动。
// 线宽恒为一个屏幕像素（PixiJS 的 pixelLine），镜头放大缩小都不变粗。东西相连的地图左右各多摆一份。
// 图层在迷雾之上、航线之下，不接收指针事件。纯几何（monsoonStreaks）可单测。
import type { Container, Graphics, GraphicsContext } from "pixi.js";
import type { MonsoonView } from "../ipc/routing";

type Pixi = typeof import("pixi.js");

/** 流线的相位数与每段显示的毫秒数。 */
export const MONSOON_PHASES = 3;
const PHASE_MS = 350;

/** 一条线段（海图像素）与它的种类。 */
export interface Streak {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  kind: "wind" | "gale" | "head" | "current";
}

/** 风与流的去向（0 北，顺时针 8 向）→ 海图上的单位向量（y 向下）。 */
export function dirVector(dir: number): [number, number] {
  const a = ((((dir % 8) + 8) % 8) * Math.PI) / 4;
  return [Math.sin(a), -Math.cos(a)];
}

/** 镜头倍数 → 取样的疏密：远看时每隔一个取样点画一道、流线加长一倍（一格只有几个屏幕像素时太密太短就看不清）。 */
export function monsoonStride(scale: number): number {
  return scale < 1.75 ? 2 : 1;
}

/** 一份季风数据在某个相位下的全部线段。`cell` 是每格的海图像素；`stride` 见 monsoonStride。 */
export function monsoonStreaks(data: MonsoonView, cell: number, phase: number, stride = 1): Streak[] {
  const out: Streak[] = [];
  const span = data.step * stride * cell;
  const half = Math.floor(data.step / 2);
  for (const [x, y, wd, ws, cd, cs] of data.points) {
    if (stride > 1 && ((x - half) / data.step) % stride !== 0) continue;
    if (stride > 1 && ((y - half) / data.step) % stride !== 0) continue;
    const cx = x * cell + cell / 2;
    const cy = y * cell + cell / 2;
    if (ws > 0) {
      const [dx, dy] = dirVector(wd);
      const len = Math.min(0.85, 0.3 + 0.06 * ws) * span;
      const kind = ws >= 7 ? "gale" : "wind";
      // 虚线：周期 len/2，每段 len/4，按相位往下风挪
      const period = len / 2;
      const offset = ((phase % MONSOON_PHASES) * period) / MONSOON_PHASES;
      for (let t = -len / 2 + offset - period; t < len / 2; t += period) {
        const a = Math.max(-len / 2, t);
        const b = Math.min(len / 2, t + period / 2);
        if (b <= a) continue;
        out.push({ x1: cx + dx * a, y1: cy + dy * a, x2: cx + dx * b, y2: cy + dy * b, kind });
      }
      // 箭头：前端两道斜线
      const tipX = cx + (dx * len) / 2;
      const tipY = cy + (dy * len) / 2;
      const head = Math.max(cell, len / 5);
      for (const side of [-1, 1]) {
        const c = Math.cos((side * 5 * Math.PI) / 6);
        const s = Math.sin((side * 5 * Math.PI) / 6);
        const hx = dx * c - dy * s;
        const hy = dx * s + dy * c;
        out.push({ x1: tipX, y1: tipY, x2: tipX + hx * head, y2: tipY + hy * head, kind: "head" });
      }
    }
    if (cs > 0) {
      const [dx, dy] = dirVector(cd);
      // 在流线旁边错开四分之一个取样间隔
      const ox = cx - dy * span * 0.25;
      const oy = cy + dx * span * 0.25;
      const len = Math.min(0.6, 0.15 * cs + 0.1) * span;
      const dots = 2 + cs;
      for (let i = 0; i < dots; i++) {
        const a = -len / 2 + (len * i) / dots;
        const b = a + len / dots / 2;
        out.push({ x1: ox + dx * a, y1: oy + dy * a, x2: ox + dx * b, y2: oy + dy * b, kind: "current" });
      }
    }
  }
  return out;
}

const COLORS: Record<Streak["kind"], [number, number]> = {
  wind: [0xf4ecd8, 0.75],
  gale: [0xffd27a, 0.9],
  head: [0xf4ecd8, 0.85],
  current: [0x7fd4ff, 0.8],
};

export interface MonsoonLayer {
  root: Container;
  /** 换一份数据（null 收起）。 */
  set: (data: MonsoonView | null) => void;
  /** 动画时钟（毫秒）与镜头倍数。 */
  frame: (elapsed: number, scale: number) => void;
  setReduced: (reduced: boolean) => void;
  destroy: () => void;
}

export function createMonsoonLayer(PIXI: Pixi, opts: { cell: number; wrap: boolean; MW: number }): MonsoonLayer {
  const root = new PIXI.Container();
  root.visible = false;
  root.eventMode = "none";
  let contexts: GraphicsContext[] = [];
  let shown: Graphics[] = [];
  let phase = -1;
  let reduced = false;
  let data: MonsoonView | null = null;
  let stride = 1;
  const copies = opts.wrap ? [-opts.MW, 0, opts.MW] : [0];

  const clear = () => {
    for (const g of shown) g.destroy();
    for (const c of contexts) c.destroy();
    shown = [];
    contexts = [];
    root.removeChildren();
    phase = -1;
  };

  const build = (data: MonsoonView, p: number): GraphicsContext => {
    const ctx = new PIXI.GraphicsContext();
    const streaks = monsoonStreaks(data, opts.cell, p, stride);
    for (const kind of Object.keys(COLORS) as Streak["kind"][]) {
      let any = false;
      for (const s of streaks) {
        if (s.kind !== kind) continue;
        ctx.moveTo(s.x1, s.y1).lineTo(s.x2, s.y2);
        any = true;
      }
      if (any) ctx.stroke({ width: 1, color: COLORS[kind][0], alpha: COLORS[kind][1], pixelLine: true });
    }
    return ctx;
  };

  const show = (p: number) => {
    if (p === phase || contexts.length === 0) return;
    phase = p;
    for (const g of shown) g.destroy();
    shown = copies.map((x) => {
      const g = new PIXI.Graphics(contexts[p]);
      g.x = x;
      root.addChild(g);
      return g;
    });
  };

  const rebuild = () => {
    clear();
    if (!data || data.points.length === 0) {
      root.visible = false;
      return;
    }
    for (let p = 0; p < MONSOON_PHASES; p++) contexts.push(build(data, p));
    root.visible = true;
    show(0);
  };

  return {
    root,
    set(next) {
      data = next;
      rebuild();
    },
    frame(elapsed, scale) {
      if (!root.visible) return;
      const want = monsoonStride(scale);
      if (want !== stride) {
        stride = want;
        rebuild();
      }
      if (reduced) return;
      show(Math.floor(elapsed / PHASE_MS) % MONSOON_PHASES);
    },
    setReduced(value) {
      reduced = value;
      if (reduced) show(0);
    },
    destroy() {
      clear();
      root.destroy({ children: true });
    },
  };
}
