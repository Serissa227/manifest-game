// 群岛风格（islands）：高脚木台、竹篾与编席墙、厚厚的棕榈叶茅草顶（脊端交叉的木杆）、珊瑚石墙、贝壳与渔网装饰。
import type { Facility } from "../../store/game";
import { P } from "../palette";
import { drawEmblem } from "./emblems";
import { type Canvas, bamboo, coral, fillProfile, gableFront, h01, hipProfile, siding, woven } from "./kit";
import { opening, wallLamp } from "./parts";
import { type DoorKind, type Kit, type RoofKind, type WallKind, type WinKind, eaveShadow, pickTone } from "./style";

const ST = P.straw;
const W = P.wood;
const TE = P.teal;
const CO = P.blossom;

/** 茅草纹理：从下沿往上每 5 行一层，每层下缘是参差的草尖、上面压着上一层的阴影；左亮右暗。 */
export function thatchTex(x0: number, x1: number, seed: number) {
  const mid = (x0 + x1) / 2;
  const span = Math.max(1, (x1 - x0) / 2);
  return (xx: number, _yy: number, e: { fromTop: number; fromBot: number }): string | null => {
    const layer = Math.floor(e.fromBot / 5);
    const k = e.fromBot % 5;
    const r = h01(xx, layer, seed);
    const r2 = h01(xx >> 1, layer, seed + 1);
    const side = (xx - mid) / span; // -1 左 … 1 右
    let col: string;
    if (k === 0) {
      if (layer === 0 && r < 0.3) return null;
      col = r < 0.3 ? ST[1] : r < 0.7 ? ST[2] : ST[3];
    } else if (k === 1) col = r2 < 0.25 ? ST[2] : ST[3];
    else if (k === 2) col = r < 0.22 ? ST[1] : ST[2];
    else if (k === 3) col = r2 < 0.4 ? ST[1] : ST[2];
    else col = r < 0.5 ? ST[0] : ST[1];
    if (e.fromTop === 0) col = side < 0.3 ? ST[3] : ST[2];
    if (side > 0.55) col = col === ST[3] ? ST[2] : col === ST[2] ? ST[1] : col;
    if (side < -0.55 && col === ST[0]) col = ST[1];
    return col;
  };
}

/** 棕榈茅草顶。y 为墙顶；返回最高点。 */
function roof(c: Canvas, x: number, w: number, y: number, kind: RoofKind = "main"): number {
  const p = c.p;
  const over = kind === "porch" ? 3 : 5;
  const x0 = x - over;
  const x1 = x + w - 1 + over;
  const yb = y + 2;
  if (kind === "tower") {
    // 尖锥茅草顶
    const h = Math.round(w * 1.1) + 4;
    const cx = (x0 + x1) / 2;
    const prof = (xx: number) => {
      if (xx < x0 || xx > x1) return null;
      const t = 1 - Math.abs(xx - cx) / ((x1 - x0) / 2 + 0.5);
      return [yb - Math.round(Math.pow(t, 1.3) * h) - 1, yb] as const;
    };
    fillProfile(p, x0, x1, prof, thatchTex(x0, x1, c.seed));
    const top = yb - h - 1;
    p.vline(Math.round(cx), top - 5, top, W[1]);
    p.set(Math.round(cx), top - 6, TE[3]).set(Math.round(cx) - 1, top - 4, CO[2]).set(Math.round(cx) + 1, top - 4, CO[2]);
    c.markRoof(x0, top, x1 - x0 + 1, h + 3, ST, 1);
    return top - 6;
  }
  if (kind === "gable") {
    // A 字形高尖茅草顶：编席三角墙，两坡厚茅草，顶端交叉木杆
    const cx = x + Math.floor(w / 2);
    const hw = Math.floor(w / 2);
    const h = Math.round(hw * 1.2);
    const apex = gableFront(c, cx, y + 1, hw, h, (t) => woven(t, x, y - h, w, h + 2, ST), [ST[0], ST[2], ST[3]], { thick: 6, over: 4, mark: ST });
    // 茅草层次：两坡上加几道暗色压边
    for (let k = 1; k < 4; k++) {
      const yy = apex + Math.round((h * k) / 4);
      const dx = Math.round(((yy - apex) * (hw + 0.5)) / h);
      p.hline(cx - dx - 3, cx - dx + 1, yy + 2, ST[1]);
      p.hline(cx + dx - 1, cx + dx + 3, yy + 2, ST[0]);
    }
    p.line(cx - 1, apex, cx - 4, apex - 4, W[1]);
    p.line(cx + 1, apex, cx + 4, apex - 4, W[2]);
    p.rect(cx - 1, apex + Math.round(h * 0.45), 3, 4, c.o.lit ? P.lamp[1] : W[0]);
    eaveShadow(c, x, w, y + 3, 1);
    return apex - 4;
  }
  const h = kind === "porch" ? 7 : kind === "shed" ? 12 : Math.min(24, Math.max(12, Math.round(w * 0.28) + 5));
  const yt = yb - h + 1;
  const inset = Math.min(Math.floor((x1 - x0) / 2) - 1, Math.round(h * 0.9));
  fillProfile(p, x0, x1, hipProfile(x0, x1, yt, yb, inset, 0.7, 3), thatchTex(x0, x1, c.seed + x));
  // 屋脊：一道扎紧的草束，两端交叉木杆
  const rx0 = x0 + inset - 1;
  const rx1 = x1 - inset + 1;
  p.hline(rx0, rx1, yt - 1, ST[0]);
  p.hline(rx0, rx1, yt, ST[1]);
  for (let xx = rx0 + 1; xx < rx1; xx += 4) p.set(xx, yt - 1, W[3]);
  let peak = yt - 1;
  if (kind !== "porch") {
    for (const [ex, dir] of [
      [rx0, -1],
      [rx1, 1],
    ] as const) {
      p.line(ex, yt - 1, ex + dir * 3, yt - 5, W[1]);
      p.line(ex - dir, yt - 1, ex - dir * 4, yt - 5, W[2]);
    }
    peak = yt - 5;
  }
  if (kind === "grand") {
    // 正中立一根彩绘图腾尖柱
    const cx = x + Math.floor(w / 2);
    p.rect(cx - 1, yt - 8, 3, 8, TE[2]);
    p.vline(cx - 1, yt - 8, yt - 1, TE[3]);
    p.vline(cx + 1, yt - 8, yt - 1, TE[1]);
    p.hline(cx - 1, cx + 1, yt - 5, CO[1]);
    p.set(cx, yt - 9, CO[2]).set(cx, yt - 10, P.white);
    peak = Math.min(peak, yt - 10);
  }
  c.markRoof(x0, yt - 1, x1 - x0 + 1, h + 1, ST, 1);
  eaveShadow(c, x, w, y + 3, 2);
  c.eave(x0 + 2, x1 - 2, yb);
  return peak;
}

const winSizes: Record<WinKind, readonly [number, number]> = {
  std: [7, 6],
  tall: [7, 9],
  small: [5, 4],
  round: [7, 7],
  wide: [12, 6],
};

const doorSizes: Record<DoorKind, readonly [number, number]> = {
  std: [8, 12],
  double: [12, 13],
  grand: [14, 15],
  open: [16, 12],
  iron: [12, 13],
  barn: [18, 16],
};

/** 方窗洞 + 上方撑开的编席窗板。 */
function window(c: Canvas, x: number, y: number, kind: WinKind = "std"): void {
  const p = c.p;
  const [w, h] = winSizes[kind];
  const lit = c.o.lit;
  if (kind === "round") {
    p.circle(x + 3, y + 3, 3, W[1]);
    p.circle(x + 3, y + 3, 2, lit ? P.lamp[1] : W[0]);
    for (const [dx, dy] of [
      [-1, -1],
      [1, 1],
      [1, -1],
      [-1, 1],
    ] as const) p.set(x + 3 + dx, y + 3 + dy, ST[2]);
    return;
  }
  p.rect(x - 1, y - 1, w + 2, h + 2, W[1]);
  p.rect(x, y, w, h, lit ? P.lamp[1] : W[0]);
  if (lit) p.rect(x + 1, y + 2, w - 2, h - 2, P.lamp[2]);
  else p.hline(x, x + w - 1, y + h - 1, W[1]);
  // 窗板：略窄于窗、向外撑开（透视缩短成 3 行）
  if (kind !== "small") {
    woven(p, x - 1, y - 4, w + 2, 3, ST);
    p.hline(x - 1, x + w, y - 4, ST[3]);
    p.hline(x - 1, x + w, y - 2, ST[1]);
    p.set(x + w - 1, y - 1, W[2]);
  }
  p.hline(x - 1, x + w, y + h + 1, TE[2]);
  c.ledge(x - 1, x + w, y + h + 1);
}

/** 贝壳珠帘门洞；double/grand 为竹门；iron 为包铜的硬木门。 */
function door(c: Canvas, cx: number, bottom: number, kind: DoorKind = "std"): void {
  const p = c.p;
  const [w, h] = doorSizes[kind];
  const x = cx - Math.floor(w / 2);
  const y = bottom - h;
  // 彩绘门框（民居换色：青绿、朱红、金黄）
  const acc = pickTone(c, [TE, P.red, P.gold]);
  p.rect(x - 2, y - 2, w + 4, h + 2, acc[2]);
  p.vline(x - 2, y - 2, bottom - 1, acc[3]);
  p.vline(x + w + 1, y - 2, bottom - 1, acc[1]);
  p.hline(x - 3, x + w + 2, y - 2, W[1]);
  for (let i = x - 1; i < x + w + 1; i += 3) p.set(i, y - 1, CO[1]);
  if (kind === "std" || kind === "open") {
    opening(c, x, y, w, h);
    // 珠帘
    for (let xx = x + 1; xx < x + w - 1; xx += 2) {
      const len = h - 3 - (h01(xx, y, 5) < 0.5 ? 1 : 0);
      for (let yy = y + 1; yy < y + len; yy += 2) p.set(xx, yy, (xx + yy) % 4 === 1 ? TE[3] : CO[3]);
    }
  } else if (kind === "iron") {
    p.rect(x, y, w, h, W[1]);
    for (let xx = x; xx < x + w; xx += 3) p.vline(xx, y, bottom - 1, W[0]);
    for (let yy = y + 2; yy < bottom - 1; yy += 3) for (let xx = x + 1; xx < x + w - 1; xx += 3) p.set(xx, yy, P.gold[3]);
  } else {
    bamboo(p, x, y, w, h, ST, 3);
    if (w >= 12) p.vline(cx, y, bottom - 1, W[1]);
    p.hline(x, x + w - 1, y + 3, W[1]);
    p.hline(x, x + w - 1, bottom - 4, W[1]);
  }
  // 高脚屋：门下的木梯
  const g = c.gy;
  if (g - bottom >= 3) {
    for (let yy = bottom; yy < g; yy++) {
      const i = yy - bottom;
      const lx = x + 1 - Math.floor(i / 2);
      const rx = x + w - 2 + Math.floor(i / 2);
      p.set(lx, yy, W[1]).set(rx, yy, W[1]);
      if (i % 2 === 1) p.hline(lx + 1, rx - 1, yy, W[3]);
    }
  }
}

/** 漂流木招牌：粗绳吊着，四角缀贝壳。 */
function sign(c: Canvas, cx: number, y: number, fac: Facility): number {
  const p = c.p;
  const x = cx - 7;
  p.line(x + 2, y + 2, x + 5, y, ST[1]);
  p.line(x + 12, y + 2, x + 9, y, ST[1]);
  p.hline(x + 5, x + 9, y, ST[1]);
  p.rect(x, y + 2, 15, 13, W[2]);
  p.hline(x, x + 14, y + 2, W[3]);
  p.hline(x, x + 14, y + 14, W[1]);
  p.set(x + 3, y + 8, W[3]).set(x + 11, y + 11, W[1]);
  p.rect(x + 2, y + 4, 11, 9, TE[0]);
  drawEmblem(p, fac, x + 3, y + 4, TE.slice(1));
  for (const [sx, sy] of [
    [x, y + 2],
    [x + 14, y + 2],
    [x, y + 14],
    [x + 14, y + 14],
  ] as const) {
    p.set(sx, sy, CO[3]);
  }
  c.ledge(x, x + 14, y + 2);
  return 15;
}

/** 高脚木台：一道地板梁，下面一排立柱与斜撑。 */
function stilts(c: Canvas, x: number, w: number, h: number): void {
  const p = c.p;
  const g = c.gy;
  const top = g - h;
  p.rect(x, top, w, 2, W[2]);
  p.hline(x, x + w - 1, top, W[3]);
  p.hline(x, x + w - 1, top + 1, W[1]);
  for (let px = x + 1; px < x + w - 1; px += 8) {
    p.rect(px, top + 2, 2, h - 2, W[1]);
    p.vline(px, top + 2, g - 1, W[2]);
  }
  p.rect(x + w - 3, top + 2, 2, h - 2, W[1]);
  for (let px = x + 3; px < x + w - 8; px += 16) p.line(px, top + 2, px + 5, g - 1, W[1]);
}

export const islands: Kit = {
  style: "islands",
  flag: [TE[1], TE[2], TE[3]],
  trim: W,
  plinthH: 5,
  awning: [TE, [ST[1], ST[2], ST[3]]],
  wall(c, x, y, w, h, kind: WallKind = "main") {
    const p = c.p;
    if (kind === "stone") {
      coral(p, x, y, w, h, c.seed + y);
      return;
    }
    if (kind === "plain") {
      // 刷漆的木板墙（青绿、朱红或金黄）
      const paint = pickTone(c, [TE, P.red, P.gold]);
      siding(p, x, y, w, h, [paint[0], paint[1], paint[2], paint[3]]);
    } else if (kind === "upper") {
      woven(p, x, y, w, h, ST);
      for (let px = x + 12; px < x + w - 6; px += 12) {
        p.rect(px, y, 2, h, W[2]);
        p.vline(px + 1, y, y + h - 1, W[1]);
      }
    } else bamboo(p, x, y, w, h, W, c.seed + x);
    // 框架：两端立柱与一道青绿压顶板
    p.rect(x, y, 2, h, W[1]);
    p.vline(x, y, y + h - 1, W[2]);
    p.rect(x + w - 2, y, 2, h, W[0]);
    p.vline(x + w - 2, y, y + h - 1, W[1]);
  },
  plinth(c, x, w, h) {
    if (h > 5) {
      // 正式建筑：珊瑚石台基
      coral(c.p, x, c.gy - h, w, h, c.seed + 17);
      c.p.hline(x, x + w - 1, c.gy - h, CO[3]);
      return;
    }
    stilts(c, x, w, h);
  },
  roof,
  band(c, x, w, y) {
    const p = c.p;
    p.hline(x, x + w - 1, y, W[2]);
    p.hline(x, x + w - 1, y + 1, W[1]);
    for (let i = x + 2; i < x + w - 1; i += 5) {
      p.set(i, y, ST[3]);
      p.set(i, y + 1, ST[2]);
    }
  },
  post(c, x, y0, y1, kind = "post") {
    const p = c.p;
    if (kind === "column") {
      p.rect(x, y0, 3, y1 - y0 + 1, TE[2]);
      p.vline(x, y0, y1, TE[3]);
      p.vline(x + 2, y0, y1, TE[1]);
      for (let yy = y0 + 3; yy < y1; yy += 5) p.hline(x, x + 2, yy, CO[1]);
      p.rect(x - 1, y0, 5, 1, W[1]);
      return 3;
    }
    p.rect(x, y0, 2, y1 - y0 + 1, W[2]);
    p.vline(x + 1, y0, y1, W[1]);
    for (let yy = y0 + 2; yy < y1; yy += 6) p.hline(x, x + 1, yy, ST[3]);
    return 2;
  },
  winSize: (kind = "std") => winSizes[kind],
  window,
  doorSize: (kind = "std") => doorSizes[kind],
  door,
  sign,
  decor(c, x, w, y, bottom) {
    const p = c.p;
    // 墙角挂一张渔网，缀两只浮球
    const nx = x + w - 13;
    const ny = y + 6;
    for (let i = 0; i < 10; i += 3) {
      p.line(nx + i, ny, nx + i + 4, ny + 8, ST[0]);
      p.line(nx + i + 4, ny, nx + i, ny + 8, ST[0]);
    }
    p.hline(nx, nx + 13, ny, W[1]);
    p.set(nx + 3, ny + 8, TE[3]).set(nx + 9, ny + 8, P.red[2]);
    // 屋檐下一串贝壳；春夏再挂一串花
    for (let i = x + 4; i < x + 16; i += 3) p.set(i, y + 6 + ((i - x) % 2), CO[3]);
    if (c.o.season <= 1) {
      for (let i = x + 20; i < x + w - 16; i += 2) {
        const dy = Math.abs(((i - x) % 12) - 6) > 3 ? 0 : 1;
        p.set(i, y + 5 + dy, (i - x) % 4 === 0 ? CO[1] : c.o.season === 0 ? CO[2] : P.gold[3]);
      }
    }
    wallLamp(c, x, bottom - 15, "shell", -1);
  },
};

/** 让风格套件之外的模块也能画高脚木台（民居用）。 */
export { stilts };
