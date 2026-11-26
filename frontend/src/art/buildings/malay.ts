// 马来风格（malay）：马来群岛的港市（马六甲、文莱、亚齐、特尔纳特，兼收爪哇）。
// 高脚木屋：深红褐的竖板墙、门下木梯；陡峭的亚答（水椰叶）屋顶一行行横纹，屋脊两端弯弯翘起，
// 檐口挂一排刻着竹笋纹的封檐板；窗是落地的木百叶窗、下半截车木栏杆、上方镂空的通风雕板；
// 民居另一种屋顶是山墙朝街、刻着放射纹的“张帆”山墙；王宫式的大屋顶是黑色棕榈纤维的角形屋脊（两端尖角高翘）；
// 塔顶是爪哇式的多层攒尖顶；地标是三重攒尖顶的清真寺与红砖砌的爪哇式塔；城墙是藤条捆扎的木栅，墙台是高脚瞭望棚；
// 街上有竹竿油灯、带小顶的井、竹榻与弯顶的牛车；远景里是高脚屋、多层屋顶与椰子树。
import type { Facility } from "../../store/game";
import { P, ink, overlay } from "../palette";
import type { Px } from "../px";
import { drawEmblem } from "./emblems";
import { type Canvas, type Ramp, ashlar, bricks, fillProfile, gableFront, h01, hipProfile, tintOpaque } from "./kit";
import { lantern, opening, steps } from "./parts";
import { type DoorKind, type Kit, type RoofKind, type WallKind, type WinKind, eaveShadow } from "./style";
import { type CultureArt, type FarCtx, farWindows, spots } from "./townArt";

/** 亚答（水椰叶）屋顶：褐色 */
const AT: Ramp = [P.wood[0], P.wood[1], P.straw[0], P.straw[1], P.straw[2]];
/** 黑色棕榈纤维（王宫、清真寺的屋顶） */
const IJ: Ramp = [P.iron[0], P.cloth.black[1], P.iron[1], P.cloth.black[2], P.iron[2]];
/** 深红褐的木墙 */
const DW: Ramp = [P.wood[0], P.brick[0], P.wood[1], P.wood[2], P.wood[3]];
const W = P.wood;
/** 王家的黄与绿（门窗与雕板的描漆） */
const YL: Ramp = [P.gold[1], P.gold[2], P.gold[3]];
const GN: Ramp = [P.leaf[0], P.leaf[1], P.leaf[2]];
/** 爪哇的红砖 */
const BR: Ramp = P.brick;

// ───────────────────────── 屋顶 ─────────────────────────

/** 亚答纹理：一排排横向的叶片（每 2 行一道暗线），左亮右暗。 */
function attapTex(x0: number, x1: number, R: Ramp, seed: number) {
  const mid = (x0 + x1) / 2;
  return (xx: number, yy: number, e: { fromTop: number; fromBot: number }): string => {
    const right = xx > mid;
    if (e.fromBot === 0) return R[0];
    const row = e.fromBot % 2;
    let col: string = row === 0 ? R[1] : h01(xx >> 1, yy, seed) < 0.25 ? R[2] : R[3];
    if (e.fromTop === 0) col = R[3];
    if (right && col === R[3]) col = R[2];
    else if (right && col === R[2]) col = R[1];
    return col;
  };
}

/** 封檐板：檐口下一排竹笋纹的三角齿（黄木）。 */
function fringe(c: Canvas, x0: number, x1: number, y: number): void {
  const p = c.p;
  p.hline(x0, x1, y, YL[1]);
  for (let xx = x0; xx <= x1; xx++) {
    const ph = (xx - x0) % 4;
    if (ph === 1 || ph === 2) p.set(xx, y + 1, YL[0]);
    if (ph === 1) p.set(xx, y + 2, YL[0]);
  }
}

/** 陡峭的亚答顶：屋脊两端弯弯翘起；返回 { yt, x0, x1, peak }。 */
function attapRoof(c: Canvas, x: number, w: number, y: number, h: number, over: number, R: Ramp = AT, horn = 3): { yt: number; x0: number; x1: number; peak: number } {
  const p = c.p;
  const x0 = x - over;
  const x1 = x + w - 1 + over;
  const yb = y + 1;
  const yt = yb - h + 1;
  const inset = Math.min(Math.floor((x1 - x0) / 2) - 2, Math.round(h * 0.55));
  fillProfile(p, x0, x1, hipProfile(x0, x1, yt, yb, inset, 0.9, 2), attapTex(x0, x1, R, c.seed + x));
  // 屋脊与两端翘起的脊角
  const rx0 = x0 + inset - 1;
  const rx1 = x1 - inset + 1;
  p.hline(rx0, rx1, yt - 1, R[0]);
  p.hline(rx0 + 1, rx1 - 1, yt - 2, R[2]);
  let peak = yt - 2;
  for (const [ex, dir] of [
    [rx0, -1],
    [rx1, 1],
  ] as const) {
    for (let i = 1; i <= horn; i++) {
      const yy = yt - 1 - Math.round((i * i) / 2);
      p.set(ex + dir * i, yy, R[i === horn ? 3 : 1]);
      p.set(ex + dir * i, yy + 1, R[0]);
      peak = Math.min(peak, yy);
    }
  }
  fringe(c, x0, x1, yb + 1);
  c.markRoof(x0, peak, x1 - x0 + 1, yb - peak + 1, R, 1);
  c.eave(x0 + 1, x1 - 1, yb + 2);
  eaveShadow(c, x, w, y + 3, 1);
  return { yt, x0, x1, peak };
}

/** 角形屋脊（王宫）：马鞍形的屋面，屋脊中间下凹、两端高高翘成尖角，中间再立一对小角。返回最高点。 */
function gonjong(c: Canvas, x: number, w: number, y: number): number {
  const p = c.p;
  const over = 4;
  const x0 = x - over;
  const x1 = x + w - 1 + over;
  const yb = y + 1;
  const base = Math.min(12, Math.max(8, Math.round(w * 0.12) + 3));
  const horn = Math.min(16, Math.round(w * 0.2) + 4);
  const ridge = (xx: number) => {
    const u = Math.abs((xx - (x0 + x1) / 2) / ((x1 - x0) / 2));
    return yb - base - Math.round(horn * Math.pow(u, 3));
  };
  fillProfile(
    p,
    x0,
    x1,
    (xx) => {
      if (xx < x0 || xx > x1) return null;
      const d = Math.min(xx - x0, x1 - xx);
      return [ridge(xx) + (d < 2 ? 2 - d : 0), yb] as const;
    },
    attapTex(x0, x1, IJ, c.seed + 5),
  );
  // 两端尖角：细细地再挑出去
  let peak = yb;
  for (const [ex, dir] of [
    [x0, -1],
    [x1, 1],
  ] as const) {
    const ty = ridge(ex);
    for (let i = 1; i <= 3; i++) p.set(ex + dir * i, ty - i * 2, IJ[3]).set(ex + dir * i, ty - i * 2 + 1, IJ[1]);
    p.set(ex + dir * 3, ty - 7, YL[1]);
    peak = Math.min(peak, ty - 7);
  }
  // 屋脊线
  for (let xx = x0 + 2; xx <= x1 - 2; xx++) p.set(xx, ridge(xx) - 1, IJ[4]);
  // 正中一对小角
  const cx = x + Math.floor(w / 2);
  for (const dir of [-1, 1] as const) {
    const bx = cx + dir * 6;
    const by = ridge(bx);
    p.line(bx, by, bx + dir * 2, by - 6, IJ[3]);
    p.set(bx + dir * 2, by - 7, YL[1]);
    peak = Math.min(peak, by - 7);
  }
  fringe(c, x0, x1, yb + 1);
  c.markRoof(x0, peak, x1 - x0 + 1, yb - peak + 1, IJ, 1);
  c.eave(x0 + 1, x1 - 1, yb + 2);
  eaveShadow(c, x, w, y + 3, 1);
  return peak;
}

/** 爪哇式攒尖顶：tiers 层，层层收窄，层间露一道通风的木板；顶上金色的宝冠（mustaka）。底层墙顶 y。返回最高点。 */
function tajug(c: Canvas, x: number, w: number, y: number, tiers: number, R: Ramp = IJ): number {
  const p = c.p;
  let bx = x;
  let bw = w;
  let by = y;
  let top = y;
  for (let i = 0; i < tiers; i++) {
    const last = i === tiers - 1;
    const over = i === 0 ? 4 : 3;
    const x0 = bx - over;
    const x1 = bx + bw - 1 + over;
    const h = last ? Math.round((x1 - x0) * 0.55) : Math.max(5, Math.round(bw * 0.18) + 2);
    const yb = by + 1;
    const yt = yb - h + 1;
    const inset = last ? Math.floor((x1 - x0) / 2) + 1 : Math.round(h * 0.9);
    fillProfile(p, x0, x1, hipProfile(x0, x1, yt, yb, inset, 0.85, 2), attapTex(x0, x1, R, c.seed + i));
    c.markRoof(x0, yt, x1 - x0 + 1, h, R, 1);
    fringe(c, x0, x1, yb + 1);
    eaveShadow(c, bx, bw, by + 3, 1);
    top = yt;
    if (last) break;
    // 层间的木板墙（通风格）
    const nw = Math.max(6, Math.round(bw * 0.62));
    const nx = bx + Math.floor((bw - nw) / 2);
    const ny = yt - 3;
    p.rect(nx, ny, nw, 4, DW[2]);
    for (let xx = nx + 1; xx < nx + nw - 1; xx += 2) p.set(xx, ny + 1, c.o.lit ? P.lamp[1] : DW[0]);
    bx = nx;
    bw = nw;
    by = ny;
  }
  // 宝冠
  const cx = x + Math.floor(w / 2);
  p.stamp(["..a..", ".aba.", "abcba", ".aaa."], { a: YL[0], b: YL[1], c: YL[2] }, cx - 2, top - 4);
  p.vline(cx, top - 7, top - 5, YL[1]);
  return top - 7;
}

/** 张帆山墙：三角墙面刻着放射纹（黄、褐相间），山尖与两端各一只卷须形的翘角。返回最高点。 */
function tebarLayar(c: Canvas, cx: number, y: number, hw: number, h: number, R: Ramp = AT): number {
  const p = c.p;
  const apex = gableFront(
    c,
    cx,
    y,
    hw,
    h,
    (t) => {
      // 放射纹：从底边正中散开
      for (let yy = y - h - 1; yy <= y + 1; yy++) {
        for (let xx = cx - hw; xx <= cx + hw + 1; xx++) {
          const a = Math.atan2(y + 1 - yy, xx - cx - 0.5);
          const ray = Math.floor((a / Math.PI) * 14) % 2 === 0;
          t.set(xx, yy, ray ? YL[0] : DW[2]);
        }
      }
    },
    [R[1], R[2], R[3]],
    { thick: 3, over: 3, mark: R },
  );
  // 翘角：山尖一对弯须，两端檐角各一只
  p.set(cx - 1, apex - 1, R[3]).set(cx - 2, apex - 2, R[3]).set(cx + 1, apex - 1, R[3]).set(cx + 2, apex - 2, R[3]);
  p.set(cx - 3, apex - 2, YL[1]).set(cx + 3, apex - 2, YL[1]);
  return apex - 2;
}

function roof(c: Canvas, x: number, w: number, y: number, kind: RoofKind = "main"): number {
  if (kind === "grand") return gonjong(c, x, w, y);
  if (kind === "tower") return tajug(c, x, w, y, 3);
  if (kind === "gable") {
    const cx = x + Math.floor(w / 2);
    const hw = Math.floor(w / 2) + 1;
    const top = tebarLayar(c, cx, y, hw, Math.round(hw * 1.05));
    fringe(c, x - 3, x + w + 2, y + 2);
    eaveShadow(c, x, w, y + 3, 1);
    return top;
  }
  if (kind === "porch") {
    const cx = x + Math.floor(w / 2);
    const hw = Math.floor(w / 2);
    return tebarLayar(c, cx, y, hw, Math.round(hw * 0.75));
  }
  if (kind === "shed") return attapRoof(c, x, w, y, 9, 3, AT, 2).peak;
  const h = Math.min(20, Math.max(10, Math.round(w * 0.22) + 4));
  return attapRoof(c, x, w, y, h, 4, AT, w >= 40 ? 4 : 3).peak;
}

// ───────────────────────── 门窗 ─────────────────────────

const winSizes: Record<WinKind, readonly [number, number]> = {
  std: [6, 9],
  tall: [6, 12],
  small: [4, 4],
  round: [7, 7],
  wide: [14, 8],
};

const doorSizes: Record<DoorKind, readonly [number, number]> = {
  std: [8, 12],
  double: [12, 13],
  grand: [14, 15],
  open: [16, 12],
  iron: [12, 13],
  barn: [18, 16],
};

/** 镂空雕板（通风）：深色底上一串金黄的小孔花纹。 */
function kerawang(p: Px, x: number, y: number, w: number, h: number): void {
  p.rect(x, y, w, h, DW[3]);
  for (let yy = y; yy < y + h; yy++) {
    for (let xx = x; xx < x + w; xx++) {
      const a = (xx - x + (yy - y) * 2) % 4 === 0;
      if (a) p.set(xx, yy, DW[0]);
    }
  }
}

function window(c: Canvas, x: number, y: number, kind: WinKind = "std"): void {
  const p = c.p;
  const [w, h] = winSizes[kind];
  const lit = c.o.lit;
  if (kind === "small" || kind === "round") {
    // 通风雕板
    p.rect(x - 1, y - 1, w + 2, h + 2, YL[0]);
    kerawang(p, x, y, w, h);
    return;
  }
  if (kind === "wide") {
    // 一排百叶窗
    p.rect(x - 1, y - 1, w + 2, h + 2, YL[0]);
    for (let yy = y; yy < y + h; yy++) p.hline(x, x + w - 1, yy, (yy - y) % 2 ? DW[1] : lit ? P.lamp[1] : DW[3]);
    for (let xx = x + 4; xx < x + w; xx += 5) p.vline(xx, y, y + h - 1, YL[0]);
    c.ledge(x - 1, x + w, y + h);
    return;
  }
  // 落地窗：上方镂空雕板，窗洞下半截车木栏杆，两侧敞开的木百叶
  p.rect(x - 1, y - 1, w + 2, h + 2, YL[0]);
  kerawang(p, x, y, w, 2);
  p.rect(x, y + 2, w, h - 2, lit ? P.lamp[1] : ink.brown);
  if (lit) p.rect(x + 1, y + 3, w - 2, h - 5, P.lamp[2]);
  const by = y + h - 3;
  p.hline(x, x + w - 1, by, DW[4]);
  for (let xx = x; xx < x + w; xx += 2) p.vline(xx, by + 1, y + h - 1, DW[4]);
  for (const sx of [x - 3, x + w + 1]) {
    p.rect(sx, y + 1, 2, h - 1, GN[1]);
    for (let yy = y + 2; yy < y + h; yy += 2) p.hline(sx, sx + 1, yy, GN[0]);
  }
  c.ledge(x - 1, x + w, y + h);
}

function door(c: Canvas, cx: number, bottom: number, kind: DoorKind = "std"): void {
  const p = c.p;
  const [w, h] = doorSizes[kind];
  const x = cx - Math.floor(w / 2);
  const y = bottom - h;
  p.rect(x - 2, y - 4, w + 4, h + 4, YL[0]);
  p.hline(x - 2, x + w + 1, y - 4, YL[1]);
  kerawang(p, x, y - 3, w, 2);
  if (kind === "open") opening(c, x, y, w, h);
  else {
    const leaf = kind === "iron" ? P.iron : kind === "barn" ? W : DW;
    p.rect(x, y, w, h, leaf[2]);
    p.vline(x, y, bottom - 1, leaf[3]);
    p.vline(cx, y, bottom - 1, leaf[0]);
    if (kind !== "barn") {
      // 门板上的方格雕饰（每扇两格）
      for (const px of [x + 1, cx + 1]) {
        const pw = Math.floor(w / 2) - 2;
        if (pw < 2) continue;
        p.rect(px, y + 2, pw, Math.floor(h / 2) - 3, leaf[1]);
        p.rect(px, y + Math.floor(h / 2), pw, Math.floor(h / 2) - 2, leaf[1]);
        p.set(px, y + 2, YL[1]);
      }
    } else for (let xx = x + 2; xx < x + w - 1; xx += 3) p.vline(xx, y, bottom - 1, W[1]);
  }
  // 高脚屋：门下木梯
  const g = c.gy;
  if (g - bottom >= 3) {
    for (let yy = bottom; yy < g; yy++) {
      const i = yy - bottom;
      const lx = x + 1 - Math.floor(i / 2);
      const rx = x + w - 2 + Math.floor(i / 2);
      p.set(lx, yy, DW[2]).set(rx, yy, DW[2]);
      if (i % 2 === 1) p.hline(lx + 1, rx - 1, yy, DW[4]);
    }
  }
}

/** 招牌：黄边绿框的雕花木板。 */
function sign(c: Canvas, cx: number, y: number, fac: Facility): number {
  const p = c.p;
  const x = cx - 7;
  p.rect(x, y, 15, 13, YL[1]);
  p.hline(x, x + 14, y, YL[2]);
  p.rect(x + 1, y + 1, 13, 11, GN[1]);
  p.rect(x + 2, y + 2, 11, 9, ink.deep);
  drawEmblem(p, fac, x + 3, y + 2, malay.flag);
  for (const sx of [x - 1, x + 15]) p.set(sx, y + 6, YL[1]);
  c.ledge(x, x + 14, y);
  return 13;
}

// ───────────────────────── 墙 ─────────────────────────

function wall(c: Canvas, x: number, y: number, w: number, h: number, kind: WallKind = "main"): void {
  const p = c.p;
  if (kind === "stone") {
    // 爪哇红砖：细缝、顶上一道叠涩线脚
    bricks(p, x, y, w, h, BR, c.seed + x);
    for (const yy of [y + 2, y + h - 4]) {
      p.hline(x, x + w - 1, yy, BR[4]);
      p.hline(x, x + w - 1, yy + 1, BR[1]);
    }
    p.vline(x, y, y + h - 1, BR[3]);
    p.vline(x + w - 1, y, y + h - 1, BR[0]);
    return;
  }
  if (kind === "plain") {
    // 竹编墙：人字纹
    for (let yy = y; yy < y + h; yy++) {
      for (let xx = x; xx < x + w; xx++) {
        const k = ((xx - x + (yy - y)) >> 1) % 2 === 0;
        const m = ((xx - x - (yy - y) + 999) >> 1) % 2 === 0;
        p.set(xx, yy, (xx - x) % 8 < 4 ? (k ? P.straw[3] : P.straw[1]) : m ? P.straw[2] : P.straw[1]);
      }
    }
  } else {
    // 深红褐的竖板墙
    for (let xx = x; xx < x + w; xx++) {
      const ph = (xx - x) % 4;
      p.vline(xx, y, y + h - 1, ph === 0 ? DW[1] : ph === 1 ? DW[3] : DW[2]);
    }
    if (kind === "upper" || kind === "main") {
      // 墙顶一道镂空雕板
      kerawang(p, x + 2, y + 1, w - 4, 2);
      p.hline(x, x + w - 1, y + 3, YL[0]);
    }
  }
  // 框架：两端立柱
  p.rect(x, y, 2, h, DW[0]);
  p.vline(x + 1, y, y + h - 1, DW[2]);
  p.rect(x + w - 2, y, 2, h, DW[0]);
}

/** 高脚：一道地板梁，石墩上的一排木柱，柱间斜撑。 */
function stilts(c: Canvas, x: number, w: number, h: number): void {
  const p = c.p;
  const g = c.gy;
  const top = g - h;
  p.rect(x, top, w, 2, DW[2]);
  p.hline(x, x + w - 1, top, DW[4]);
  p.hline(x, x + w - 1, top + 1, DW[0]);
  for (let px = x + 1; px < x + w - 1; px += 7) {
    p.rect(px, top + 2, 2, h - 2, DW[1]);
    p.vline(px, top + 2, g - 1, DW[3]);
    p.rect(px - 1, g - 2, 4, 2, P.stone[2]);
  }
  p.rect(x + w - 3, top + 2, 2, h - 2, DW[1]);
  p.rect(x + w - 4, g - 2, 4, 2, P.stone[2]);
  tintOpaque(p, x, top + 2, w, 1, overlay.shadow);
  for (let px = x + 3; px < x + w - 7; px += 14) p.line(px, top + 2, px + 4, g - 3, DW[1]);
}

export const malay: Kit = {
  style: "malay",
  flag: [YL[0], YL[1], YL[2]],
  trim: DW,
  plinthH: 6,
  awning: [P.cloth.ochre, P.cloth.green],
  lamp: "brass",
  tavernRoof: "gable",
  stilted: true,
  wall,
  plinth(c, x, w, h) {
    if (h > 7) {
      // 正式建筑：砖石台基
      const p = c.p;
      ashlar(p, x, c.gy - h, w, h, P.stone, { course: 3, min: 6, max: 10, seed: c.seed + 17, light: 2 });
      p.hline(x, x + w - 1, c.gy - h, P.stone[4]);
      return;
    }
    stilts(c, x, w, h);
  },
  roof,
  band(c, x, w, y) {
    const p = c.p;
    p.hline(x - 1, x + w, y, DW[3]);
    for (let i = 0; i < w + 2; i++) p.set(x - 1 + i, y + 1, i % 3 === 1 ? YL[1] : DW[0]);
    p.hline(x - 1, x + w, y + 2, DW[1]);
  },
  post(c, x, y0, y1, kind = "post") {
    const p = c.p;
    if (kind === "column") {
      // 漆绿的木柱，金黄的箍
      p.rect(x, y0, 3, y1 - y0 + 1, GN[1]);
      p.vline(x, y0, y1, GN[2]);
      p.vline(x + 2, y0, y1, GN[0]);
      for (let yy = y0 + 2; yy < y1; yy += 6) p.hline(x, x + 2, yy, YL[1]);
      p.rect(x - 1, y1 - 1, 5, 2, P.stone[2]);
      return 3;
    }
    p.rect(x, y0, 2, y1 - y0 + 1, DW[1]);
    p.vline(x, y0, y1, DW[3]);
    return 2;
  },
  winSize: (kind = "std") => winSizes[kind],
  window,
  doorSize: (kind = "std") => doorSizes[kind],
  door,
  sign,
  decor(c, x, w, y) {
    const p = c.p;
    // 檐下挂一只圆顶鸟笼，另一头一盏油灯
    const bx = x + 4;
    const by = y + 4;
    p.vline(bx + 2, by, by + 1, P.iron[2]);
    p.stamp([".aaa.", "a.a.a", "aba.a", "a.a.a", "ccccc"], { a: P.straw[2], b: P.leaf[3], c: DW[2] }, bx, by + 2);
    lantern(c, x + w - 4, y + 4, "brass");
  },
};

// ───────────────────────── 地标：三重攒尖顶的清真寺与红砖塔 ─────────────────────────

function landmark(c: Canvas): void {
  const p = c.p;
  const g = c.gy;
  // 红砖塔（爪哇式）：叠涩的台基、带壁龛的塔身、嵌瓷盘，顶上一座两重攒尖的小亭
  const tcx = 15;
  const tb = g;
  ashlar(p, tcx - 12, tb - 6, 25, 6, BR, { course: 3, min: 4, max: 7, seed: 3, light: 2 });
  p.hline(tcx - 12, tcx + 12, tb - 6, BR[4]);
  let y = tb - 6;
  const stages = [
    { w: 21, h: 26 },
    { w: 19, h: 24 },
    { w: 17, h: 18 },
  ];
  for (const s of stages) {
    const sx = tcx - Math.floor(s.w / 2);
    bricks(p, sx, y - s.h, s.w, s.h, BR, s.h);
    p.vline(sx, y - s.h, y - 1, BR[3]);
    p.vline(sx + s.w - 1, y - s.h, y - 1, BR[0]);
    // 叠涩线脚
    p.hline(sx - 1, sx + s.w, y - s.h, BR[4]);
    p.hline(sx - 1, sx + s.w, y - s.h + 1, BR[1]);
    p.hline(sx - 2, sx + s.w + 1, y - 2, BR[3]);
    // 壁龛与瓷盘
    p.rect(tcx - 2, y - s.h + 5, 5, s.h - 10, BR[1]);
    p.rect(tcx - 1, y - s.h + 6, 3, s.h - 12, ink.brown);
    for (const dx of [-6, 6]) {
      p.circle(tcx + dx, y - Math.floor(s.h / 2), 1, P.white);
      p.set(tcx + dx, y - Math.floor(s.h / 2), P.cloth.blue[1]);
    }
    y -= s.h;
  }
  // 塔顶小亭
  p.rect(tcx - 6, y - 7, 13, 7, DW[2]);
  for (const px of [tcx - 6, tcx + 5]) p.rect(px, y - 7, 2, 7, DW[0]);
  p.rect(tcx - 2, y - 6, 5, 4, c.o.lit ? P.lamp[1] : ink.brown);
  tajug(c, tcx - 6, 13, y - 7, 2);
  // 清真寺：白灰台基、四面的廊、三重攒尖顶
  const mcx = 60;
  const mw = 52;
  const mx = mcx - mw / 2;
  ashlar(p, mx - 4, g - 5, mw + 8, 5, P.stone, { course: 5, min: 7, max: 11, seed: 9, light: 3 });
  p.hline(mx - 4, mx + mw + 3, g - 5, P.stone[4]);
  steps(c, mcx, 14, 4, g, P.stone);
  const ht = g - 5 - 18;
  wall(c, mx, ht, mw, 18, "main");
  door(c, mcx, g - 5, "double");
  for (const wx of [mx + 6, mx + mw - 12]) window(c, wx, ht + 5, "std");
  for (const px of [mx - 2, mx + 12, mx + mw - 15, mx + mw - 1]) malay.post(c, px, ht, g - 6, "column");
  tajug(c, mx, mw, ht, 3);
}

// ───────────────────────── 城门与城墙：木栅 ─────────────────────────

/** 一根木栅：方木、顶削尖，两道藤条捆扎。 */
function stake(p: Px, x: number, top: number, bottom: number, wd = 4): void {
  for (let xx = x; xx < x + wd; xx++) {
    const u = xx - x;
    const tip = top + Math.abs(u - (wd - 1) / 2) * 1.2;
    p.vline(xx, Math.round(tip), bottom - 1, u === 0 ? DW[3] : u === wd - 1 ? DW[0] : DW[2]);
  }
}

function gate(c: Canvas): void {
  const p = c.p;
  const g = c.gy;
  const cx = Math.floor(c.w / 2);
  // 两侧木栅
  for (let x = cx - 50; x < cx + 50; x += 4) {
    if (Math.abs(x + 2 - cx) < 22) continue;
    stake(p, x, g - 32 - ((x >> 2) % 2) * 2, g);
  }
  for (const yy of [g - 26, g - 12]) {
    p.hline(cx - 50, cx + 49, yy, P.straw[1]);
    p.hline(cx - 50, cx + 49, yy + 1, P.straw[0]);
  }
  // 门楼：两根粗柱、木板门、上面一座角形屋脊的小楼
  for (const px of [cx - 20, cx + 16]) {
    p.rect(px, g - 46, 5, 46, DW[2]);
    p.vline(px, g - 46, g - 1, DW[3]);
    p.vline(px + 4, g - 46, g - 1, DW[0]);
    p.rect(px - 1, g - 3, 7, 3, P.stone[2]);
  }
  // 敞开的木板门
  p.rect(cx - 15, g - 28, 31, 28, ink.brown);
  p.rect(cx - 11, g - 5, 23, 5, P.sand[2]);
  for (const dx of [-15, 12]) {
    p.rect(cx + dx, g - 28, 4, 28, DW[2]);
    for (let yy = g - 26; yy < g; yy += 4) p.hline(cx + dx, cx + dx + 3, yy, DW[0]);
  }
  // 门上的小楼
  const lw = 40;
  const lx = cx - lw / 2;
  const lt = g - 46;
  p.rect(lx - 2, lt + 10, lw + 4, 3, DW[3]);
  p.hline(lx - 2, lx + lw + 1, lt + 12, DW[0]);
  wall(c, lx, lt - 2, lw, 12, "upper");
  for (const wx of [lx + 6, lx + lw - 12]) window(c, wx, lt + 1, "wide");
  malay.sign(c, cx, lt - 1, "office");
  gonjong(c, lx, lw, lt - 2);
}

function wallBody(c: Canvas, W: number, top: number): void {
  const p = c.p;
  const H = c.gy;
  // 土坡
  p.rect(0, H - 8, W, 8, P.sand[1]);
  for (let x = 0; x < W; x++) {
    if (h01(x, 3, c.seed) < 0.3) p.put(x, H - 8, P.leaf[2]);
    if (h01(x, 4, c.seed) < 0.2) p.put(x, H - 5, P.sand[0]);
  }
  // 方木栅，顶端削尖、高低相间
  const posts = spots(W, 4);
  posts.forEach((x0, i) => {
    const x1 = (posts[i + 1] ?? W) - 1;
    const wd = x1 - x0 + 1;
    const tip = top - 4 - (i % 3 === 0 ? 2 : 0);
    for (let xx = x0; xx <= x1; xx++) {
      const u = xx - x0;
      const t = Math.round(tip + Math.abs(u - (wd - 1) / 2) * 1.2);
      p.put(xx, t, DW[3]);
      for (let yy = t + 1; yy < H - 8; yy++) p.put(xx, yy, u === 0 ? DW[3] : u === wd - 1 ? DW[0] : DW[2]);
    }
  });
  // 两道藤条捆扎与一道斜撑
  for (const yy of [top + 4, top + 18]) {
    for (let x = 0; x < W; x++) {
      p.put(x, yy, (x >> 1) % 2 ? P.straw[2] : P.straw[1]);
      p.put(x, yy + 1, P.straw[0]);
    }
  }
}

function wallTower(c: Canvas, x: number, top: number): void {
  const p = c.p;
  const H = c.gy;
  // 高脚瞭望棚
  const w = 18;
  const t = top - 16;
  for (const px of [x + 1, x + w - 3]) {
    p.rect(px, t + 8, 2, H - 8 - t - 8, DW[1]);
    p.vline(px, t + 8, H - 9, DW[3]);
  }
  p.line(x + 3, t + 10, x + w - 4, H - 10, DW[1]);
  p.rect(x - 1, t + 7, w + 2, 2, DW[3]);
  p.hline(x - 1, x + w, t + 8, DW[0]);
  wall(c, x, t, w, 7, "plain");
  attapRoof(c, x, w, t, 8, 3, AT, 3);
}

// ───────────────────────── 远景 ─────────────────────────

function farPalm(k: FarCtx, x: number, h: number, lean: 1 | -1): void {
  const p = k.p;
  const b = k.base;
  for (let i = 0; i < h; i++) p.set(x + Math.round(lean * (i / h) ** 2 * 3), b - 1 - i, DW[1]);
  const tx = x + lean * 3;
  const ty = b - h;
  for (const [dx, dy] of [
    [-5, 3],
    [5, 3],
    [-4, 0],
    [4, 0],
    [0, -2],
  ] as const) {
    const mx = tx + Math.round(dx * 0.6);
    const my = ty + Math.min(0, dy) - 1;
    p.line(tx, ty, mx, my, P.leaf[1]);
    p.line(mx, my, tx + dx, ty + dy, P.leaf[1]);
  }
}

function farHouse(k: FarCtx, x: number, w: number, h: number, seed: number): void {
  const p = k.p;
  const b = k.base;
  const f = k.f;
  // 高脚：墙离地 3 行，下面一排柱脚
  const lift = 3;
  const wh = Math.max(4, h - lift);
  const wallTop = b - lift - wh;
  p.rect(x, wallTop, w, wh, f.wall[1]);
  p.vline(x, wallTop, b - lift - 1, f.wall[2]);
  p.vline(x + w - 1, wallTop, b - lift - 1, f.wall[0]);
  for (let xx = x + 1; xx < x + w; xx += 4) p.vline(xx, b - lift, b - 1, f.wall[0]);
  farWindows(k, x, wallTop, w, wh, seed);
  // 陡峭的亚答顶，屋脊两端翘起
  const over = 2;
  const rh = Math.max(4, Math.round(w * 0.45));
  const x0 = x - over;
  const x1 = x + w - 1 + over;
  const inset = Math.round(rh * 0.6);
  for (let xx = x0; xx <= x1; xx++) {
    const d = Math.min(xx - x0, x1 - xx);
    const t = Math.min(1, d / Math.max(1, inset));
    const top = wallTop - Math.round(Math.sqrt(t) * rh);
    p.vline(xx, top, wallTop, xx > (x0 + x1) / 2 ? f.roof[0] : f.roof[1]);
    if (xx < (x0 + x1) / 2) p.set(xx, top, f.roof[2]);
  }
  const rx0 = x0 + inset;
  const rx1 = x1 - inset;
  p.set(rx0 - 1, wallTop - rh - 1, f.roof[2]).set(rx0 - 2, wallTop - rh - 2, f.roof[2]);
  p.set(rx1 + 1, wallTop - rh - 1, f.roof[2]).set(rx1 + 2, wallTop - rh - 2, f.roof[2]);
  k.roofs.push([x0, wallTop - rh - 2, x1 - x0 + 1, rh + 3]);
  if (h01(seed, 6, 5) < 0.35) farPalm(k, x + w + 2, 16 + Math.floor(h01(seed, 8, 5) * 10), h01(seed, 9, 5) < 0.5 ? 1 : -1);
}

/** 远景的三重攒尖顶清真寺。 */
function farMosque(k: FarCtx, x: number): number {
  const p = k.p;
  const b = k.base;
  const f = k.f;
  const cx = x + 13;
  p.rect(cx - 10, b - 8, 21, 8, f.wall[2]);
  k.lights.push([cx - 5, b - 4], [cx + 5, b - 4]);
  let y = b - 8;
  let hw = 13;
  for (let i = 0; i < 3; i++) {
    const h = i === 2 ? 9 : 5;
    for (let row = 0; row < h; row++) {
      const half = i === 2 ? Math.round(hw * (1 - row / h)) : hw - Math.round(row * 1.1);
      p.hline(cx - half, cx + half, y - row, row === 0 ? f.roof[0] : f.roof[1]);
      p.set(cx - half, y - row, f.roof[2]);
    }
    k.roofs.push([cx - hw, y - h, hw * 2 + 1, h + 1]);
    y -= h;
    if (i < 2) {
      p.rect(cx - Math.round(hw * 0.5), y - 1, Math.round(hw) + 1, 2, f.wall[1]);
      y -= 2;
      hw = Math.round(hw * 0.68);
    }
  }
  p.set(cx, y - 1, P.gold[2]).set(cx, y - 2, P.gold[3]);
  farPalm(k, x + 28, 22, -1);
  return 30;
}

function farTower(k: FarCtx, x: number, seed: number): number {
  if (h01(seed, 11, 1) < 0.65) return farMosque(k, x);
  // 角形屋脊的王宫
  const p = k.p;
  const b = k.base;
  const f = k.f;
  const w = 24;
  p.rect(x, b - 10, w, 7, f.wall[1]);
  for (let xx = x + 1; xx < x + w; xx += 4) p.vline(xx, b - 3, b - 1, f.wall[0]);
  k.lights.push([x + 6, b - 7], [x + 17, b - 7]);
  for (let xx = x - 2; xx <= x + w + 1; xx++) {
    const u = Math.abs((xx - (x + w / 2)) / (w / 2 + 2));
    const top = b - 18 - Math.round(10 * Math.pow(u, 3));
    p.vline(xx, top, b - 10, xx > x + w / 2 ? IJ[1] : IJ[2]);
  }
  k.roofs.push([x - 2, b - 28, w + 4, 18]);
  return w + 4;
}

function farWall(k: FarCtx, top: number): void {
  const p = k.p;
  const W = k.W;
  p.rect(0, top, W, 8, DW[1]);
  p.hline(0, W - 1, top + 3, P.straw[1]);
  const n = Math.max(1, Math.round(W / 3));
  for (let j = 0; j < n; j++) {
    const mx = Math.round((j * W) / n);
    p.vline(mx, top - 3, top, DW[2]);
    p.set(mx, top - 4, DW[3]);
  }
}

// ───────────────────────── 街道小物件 ─────────────────────────

/** 竹竿油灯：竹竿顶上一只带小屋顶的玻璃油灯。 */
function lamp(c: Canvas): void {
  const p = c.p;
  const g = c.gy;
  const lit = c.o.lit;
  p.rect(5, g - 22, 2, 22, P.straw[2]);
  p.vline(5, g - 22, g - 1, P.straw[3]);
  for (let y = g - 20; y < g; y += 5) p.hline(5, 6, y, P.straw[1]);
  p.rect(2, g - 29, 8, 7, DW[0]);
  p.rect(3, g - 28, 6, 5, lit ? P.lamp[2] : P.lamp[0]);
  if (!lit) p.set(4, g - 27, P.lamp[1]);
  p.hline(1, 10, g - 30, AT[2]);
  p.hline(2, 9, g - 31, AT[3]);
  p.set(0, g - 31, AT[3]).set(11, g - 31, AT[3]);
  if (lit) tintOpaque(p, 0, g - 32, 12, 12, overlay.glow, 2);
}

/** 井：砖砌井栏，木架上的小亚答顶（屋脊两端翘起）。 */
function well(c: Canvas): void {
  const p = c.p;
  const g = c.gy;
  bricks(p, 2, g - 7, 18, 7, BR, 3);
  p.hline(1, 20, g - 8, BR[4]);
  p.rect(3, g - 21, 2, 13, DW[2]);
  p.rect(17, g - 21, 2, 13, DW[1]);
  p.hline(4, 17, g - 18, DW[3]);
  p.vline(11, g - 17, g - 11, P.straw[1]);
  p.rect(9, g - 11, 5, 3, P.leaf[1]);
  for (let i = 0; i < 4; i++) p.hline(1 + i, 20 - i, g - 22 - i, i === 3 ? AT[3] : i === 0 ? AT[1] : AT[2]);
  p.set(0, g - 23, AT[3]).set(21, g - 23, AT[3]);
  p.set(3, g - 26, AT[3]).set(18, g - 26, AT[3]);
}

/** 竹榻：一张矮矮的竹片平台。 */
function bench(p: Px): void {
  const g = p.h;
  for (let x = 1; x < 17; x++) p.vline(x, g - 5, g - 4, x % 2 ? P.straw[3] : P.straw[2]);
  p.hline(1, 16, g - 6, P.straw[1]);
  for (const x of [2, 8, 14]) p.vline(x, g - 3, g - 1, DW[1]);
}

/** 牛车：两只大轮，车上搭着弯弯的马鞍形篷顶（或装胡椒麻袋）。 */
function cart(p: Px, v: number): void {
  const g = p.h;
  p.rect(2, g - 10, 20, 3, DW[2]);
  p.hline(2, 21, g - 10, DW[3]);
  p.line(22, g - 9, 29, g - 8, DW[1]);
  if (v % 2 === 0) {
    // 弯顶篷
    for (let x = 2; x < 22; x++) {
      const u = Math.abs((x - 11.5) / 10);
      const top = g - 18 - Math.round(4 * u * u);
      p.vline(x, top, g - 16, x > 12 ? AT[1] : AT[2]);
      p.set(x, top, AT[3]);
    }
    for (const x of [3, 20]) p.vline(x, g - 15, g - 11, DW[1]);
  } else {
    for (const [x, y] of [
      [3, g - 15],
      [10, g - 15],
      [6, g - 19],
    ] as const) {
      p.rect(x, y, 7, 5, P.parchmentDark);
      p.hline(x, x + 6, y, P.parchment);
      p.set(x + 3, y, P.parchmentDeep);
    }
  }
  p.ring(11, g - 5, 5, 5, DW[1]);
  p.ring(11, g - 5, 4, 4, DW[3]);
  for (const [dx, dy] of [
    [0, -4],
    [0, 4],
    [-4, 0],
    [4, 0],
    [3, 3],
    [-3, -3],
    [3, -3],
    [-3, 3],
  ] as const)
    p.line(11, g - 5, 11 + dx, g - 5 + dy, DW[2]);
  p.set(11, g - 5, P.iron[2]);
}

export const MALAY: CultureArt = {
  kit: malay,
  landmark,
  gate,
  wallBody,
  wallTower,
  far: { roof: [AT[0], AT[1], AT[2]], wall: [DW[1], DW[2], DW[3]], accent: [YL[0], YL[1], YL[2]] },
  farHouse,
  farTower,
  farWall,
  props: {
    flag: [YL[0], YL[1], YL[2]],
    stall: [P.cloth.ochre, P.cloth.green],
    lamp,
    well,
    bench,
    cart,
  },
};
