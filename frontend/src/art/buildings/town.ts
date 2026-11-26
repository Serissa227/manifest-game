// 城墙与城门：内陆城市街景用。城墙段落宽度任意、可无缝横向重复（石块、砖缝、垛口、墙台都按宽度取模排布）；
// 城门是一座独立的门楼，底边是地面线。
import type { ArchStyle, TownStyle } from "../buildings";
import { P, ink, overlay } from "../palette";
import { Px } from "../px";
import { hash32 } from "../rng";
import { archInset, desert, dome, merlon } from "./desert";
import { brackets, eastern, pearl, tier } from "./eastern";
import { SH, chinkedLogs, frontier, logCorner, shingleTex } from "./frontier";
import { islands, thatchTex } from "./islands";
import { type DrawOpts, type Ramp, Canvas, adobe, ashlar, bricks, coral, fillProfile, finish, gableFront, h01, outline, planks, plaster, snowPass, tintOpaque } from "./kit";
import { lowland, sheaf, tileTex } from "./lowland";
import { AZ, TR, TRAV, archFill, balustrade, barrelTex, mediterranean } from "./mediterranean";
import { nordic, slateTex } from "./nordic";
import { seedTag } from "./style";
import { cultureArt } from "./cultures";
import { spots, wrap, wrapCourses } from "./townArt";

export const WALL_H = 64;

/** 每种风格的墙体色阶与垛口样式。 */
function wallBody(c: Canvas, style: ArchStyle, W: number, top: number): void {
  const p = c.p;
  const H = c.gy;
  const s = c.seed;
  if (style === "mediterranean") {
    // 石灰华条石墙，墙腰一道白色线脚
    wrapCourses(p, W, top, H - top, TRAV, 4, 7, 12, s, 2);
    p.rect(0, top, W, 2, P.white);
    p.hline(0, W - 1, top + 1, TRAV[2]);
    p.hline(0, W - 1, top + 14, TRAV[4]);
    p.hline(0, W - 1, top + 15, TRAV[1]);
  } else if (style === "frontier") {
    // 夯土坡上一排削尖的圆木栅，两道横档
    p.rect(0, H - 8, W, 8, P.sand[1]);
    for (let x = 0; x < W; x++) {
      if (h01(x, 3, s) < 0.3) p.put(x, H - 8, P.leaf[2]);
      if (h01(x, 4, s) < 0.25) p.put(x, H - 5, P.sand[0]);
    }
    const logs = spots(W, 5);
    logs.forEach((x0, i) => {
      const x1 = (logs[i + 1] ?? W) - 1;
      const tip = top - 4 - (i % 2) * 2;
      for (let x = x0; x <= x1; x++) {
        const u = x - x0;
        const col = u === 0 ? P.wood[3] : u === x1 - x0 ? P.wood[1] : P.wood[2];
        p.vline(x, tip + Math.round(Math.abs(u - (x1 - x0) / 2) * 1.5), H - 9, col);
      }
    });
    for (const yy of [top + 5, top + 20]) {
      p.hline(0, W - 1, yy, P.wood[3]);
      p.hline(0, W - 1, yy + 1, P.wood[1]);
    }
  } else if (style === "lowland") {
    wrapCourses(p, W, top, H - top, [P.brick[0], P.brick[1], P.brick[2], P.brick[3], P.brick[4]], 3, 5, 7, s, 2);
    // 白石压顶
    p.rect(0, top, W, 2, P.plaster[3]);
    p.hline(0, W - 1, top + 1, P.plaster[1]);
  } else if (style === "desert") {
    p.rect(0, top, W, H - top, P.sand[3]);
    for (let i = 0; i < Math.floor((W * (H - top)) / 80); i++) {
      const x = Math.floor(h01(i, s, 1) * W);
      const y = top + 3 + Math.floor(h01(i, s, 2) * (H - top - 6));
      for (let k = 0; k < 3; k++) p.put((x + k) % W, y, P.sand[2]);
      p.put((x + 1) % W, y + 1, P.sand[2]);
    }
    wrapCourses(p, W, H - 10, 10, P.sand, 5, 8, 12, s, 2);
  } else if (style === "islands") {
    // 珊瑚石墙基 + 木栅
    wrapCourses(p, W, H - 12, 12, [P.blossom[0], P.blossom[1], P.blossom[2], P.blossom[3], P.white], 4, 6, 10, s, 2);
    const logs = spots(W, 5);
    logs.forEach((x0, i) => {
      const x1 = (logs[i + 1] ?? W) - 1;
      const tip = top - 3 - (i % 2);
      for (let x = x0; x <= x1; x++) {
        const u = x - x0;
        const col = u === 0 ? P.wood[3] : u === x1 - x0 ? P.wood[1] : P.wood[2];
        p.vline(x, tip + Math.abs(u - (x1 - x0) / 2) * 1.2, H - 13, col);
      }
      p.hline(x0, x1, top + 6, P.straw[1]);
      p.hline(x0, x1, top + 18, P.straw[1]);
    });
  } else {
    const ramp = P.stone;
    wrapCourses(p, W, top, H - top, ramp, 4, 6, 11, s, 2);
    if (style === "eastern") {
      // 东方：墙顶一道琉璃瓦檐
      for (let x = 0; x < W; x++) {
        p.put(x, top - 3, P.jade[3]);
        p.put(x, top - 2, x % 3 === 1 ? P.jade[3] : P.jade[2]);
        p.put(x, top - 1, x % 3 === 1 ? P.jade[4] : P.jade[1]);
      }
      c.markRoof(0, top - 3, W, 3, P.jade, 1);
      tintOpaque(p, 0, top, W, 2, overlay.shadow);
    }
  }
  // 垛口（群岛与开拓者是木栅，不另加）
  if (style !== "islands" && style !== "frontier") {
    const m = spots(W, 8);
    const mt = style === "eastern" ? top - 9 : top - 6;
    for (const x of m) {
      wrap(W, (dx) => {
        const xx = x + dx;
        if (style === "desert") merlon(c, xx + 2, top);
        else {
          const col = style === "lowland" ? P.brick : style === "mediterranean" ? TRAV : P.stone;
          p.rect(xx, mt, 5, top - mt - (style === "eastern" ? 3 : 0), col[2]);
          p.hline(xx, xx + 4, mt, col[3]);
          p.vline(xx + 4, mt, top - 1, col[1]);
          if (style === "lowland") p.hline(xx, xx + 4, mt, P.plaster[3]);
        }
      });
    }
    // 射孔
    for (const x of spots(W, 16)) {
      wrap(W, (dx) => {
        p.rect(x + dx + 6, top + 8, 1, 4, ink.deep);
        p.set(x + dx + 5, top + 10, ink.deep).set(x + dx + 7, top + 10, ink.deep);
      });
    }
  }
}

/** 墙台（突出的方塔），每 ~72 像素一座。 */
function wallTower(c: Canvas, style: ArchStyle, x: number, top: number): void {
  const p = c.p;
  const H = c.gy;
  const w = 16;
  const t = top - 10;
  if (style === "islands") {
    // 高脚瞭望棚
    for (const px of [x + 2, x + w - 4]) {
      p.rect(px, t - 4, 2, H - 12 - (t - 4), P.wood[1]);
      p.vline(px, t - 4, H - 13, P.wood[2]);
    }
    p.rect(x, t - 6, w, 3, P.wood[2]);
    p.hline(x, x + w - 1, t - 6, P.wood[3]);
    woven(p, x + 1, t - 12, w - 2, 6);
    const x0 = x - 3;
    const x1 = x + w + 2;
    fillProfile(
      p,
      x0,
      x1,
      (xx) => {
        if (xx < x0 || xx > x1) return null;
        const u = 1 - Math.abs(xx - (x0 + x1) / 2) / ((x1 - x0) / 2 + 0.5);
        return [t - 12 - Math.round(u * 10), t - 11] as const;
      },
      thatchTex(x0, x1, 5),
    );
    c.markRoof(x0, t - 22, x1 - x0 + 1, 12, P.straw, 1);
    return;
  }
  if (style === "frontier") {
    // 木堡：原木墙，上层外挑，木瓦四角锥顶，射击孔
    const bt = t - 4;
    chinkedLogs(p, x + 1, bt + 10, w - 2, H - 9 - (bt + 10), x);
    chinkedLogs(p, x - 2, bt, w + 4, 10, x + 1);
    logCorner(p, x - 3, bt, 10);
    logCorner(p, x + w - 1, bt, 10);
    p.hline(x - 2, x + w + 1, bt + 10, P.wood[0]);
    for (const sx of [x + 3, x + w - 5]) p.rect(sx, bt + 3, 2, 3, ink.deep);
    p.rect(x + 6, bt + 16, 3, 2, ink.deep);
    const x0 = x - 5;
    const x1 = x + w + 4;
    fillProfile(
      p,
      x0,
      x1,
      (xx) => {
        if (xx < x0 || xx > x1) return null;
        const d = Math.min(xx - x0, x1 - xx) + 0.5;
        return [bt - Math.round((d / ((x1 - x0) / 2)) * 10), bt] as const;
      },
      shingleTex(x0, x1, 99, x),
    );
    c.markRoof(x0, bt - 10, x1 - x0 + 1, 11, SH, 1);
    return;
  }
  const ramp = style === "lowland" ? [P.brick[0], P.brick[1], P.brick[2], P.brick[3], P.brick[4]] : style === "desert" ? P.sand : style === "mediterranean" ? TRAV : P.stone;
  if (style === "desert") adobe(p, x, t, w, H - t, P.sand, x);
  else ashlar(p, x, t, w, H - t, ramp, { course: style === "lowland" ? 3 : 4, min: 4, max: 8, seed: x });
  p.vline(x, t, H - 1, ramp[3]);
  p.vline(x + w - 1, t, H - 1, ramp[1]);
  p.rect(x + 6, t + 8, 3, 6, ink.deep);
  p.set(x + 7, t + 7, ink.deep);
  if (style === "eastern") {
    tier(c, x + 1, w - 2, t - 1, 6, 4, 2);
    brackets(c, x + 1, w - 2, t + 1);
  } else if (style === "nordic") {
    const x0 = x - 1;
    const x1 = x + w;
    fillProfile(
      p,
      x0,
      x1,
      (xx) => {
        if (xx < x0 || xx > x1) return null;
        const d = Math.min(xx - x0, x1 - xx) + 0.5;
        return [t - Math.round((d / ((x1 - x0) / 2)) * 16), t] as const;
      },
      slateTex(x0, 99, x1),
    );
    c.markRoof(x0, t - 16, x1 - x0 + 1, 17, P.slate, 1);
  } else if (style === "mediterranean") {
    // 方塔：白色线脚、拱形窗、低矮的筒瓦四角锥
    p.hline(x - 1, x + w, t, P.white);
    p.hline(x - 1, x + w, t + 1, TRAV[2]);
    const x0 = x - 2;
    const x1 = x + w + 1;
    fillProfile(
      p,
      x0,
      x1,
      (xx) => {
        if (xx < x0 || xx > x1) return null;
        const d = Math.min(xx - x0, x1 - xx) + 0.5;
        return [t - 1 - Math.round((d / ((x1 - x0) / 2)) * 8), t - 1] as const;
      },
      barrelTex(x0, x1, 99),
    );
    c.markRoof(x0, t - 9, x1 - x0 + 1, 9, TR, 1);
  } else if (style === "lowland") {
    const x0 = x - 1;
    const x1 = x + w;
    fillProfile(
      p,
      x0,
      x1,
      (xx) => {
        if (xx < x0 || xx > x1) return null;
        const d = Math.min(xx - x0, x1 - xx) + 0.5;
        return [t - Math.round((d / ((x1 - x0) / 2)) * 9), t] as const;
      },
      tileTex(x0, x1, 99),
    );
    c.markRoof(x0, t - 9, x1 - x0 + 1, 10, P.autumn, 1);
  } else {
    p.hline(x - 1, x + w, t, P.sand[4]);
    merlon(c, x + 2, t);
    merlon(c, x + w - 3, t);
    dome(c, x + Math.floor(w / 2), t, 4);
  }
}

function woven(p: Px, x: number, y: number, w: number, h: number): void {
  p.pattern(x, y, w, h, ["aabc", "abbc", "bcaa", "cbba"], { a: P.straw[3], b: P.straw[2], c: P.straw[1] });
}

/** 城墙段落：宽 width、高 WALL_H，可无缝横向重复。 */
export function drawCityWallImpl(style: TownStyle, width: number, o: DrawOpts): Px {
  const W = Number.isFinite(width) ? Math.max(1, Math.floor(width)) : 1;
  const c = new Canvas(W, WALL_H, style, { ...o }, hash32(`wall/${seedTag(style)}`));
  const top = WALL_H - 34;
  const art = cultureArt(style);
  if (art) {
    // 六种文化风格：墙体与墙台由各自的文件来画
    art.wallBody(c, W, top);
    for (const x of spots(W, 72)) wrap(W, (dx) => art.wallTower(c, x + dx + 20, top));
  } else {
    wallBody(c, style as ArchStyle, W, top);
    for (const x of spots(W, 72)) wrap(W, (dx) => wallTower(c, style as ArchStyle, x + dx + 20, top));
  }
  // 积雪与描边都按左右取模处理，保证首尾相接
  if (o.snow) snowPass(c, true);
  outline(c.p, true);
  return c.p;
}

// ───────────────────────── 城门 ─────────────────────────

/** 圆拱门洞：中心 cx，底在 bottom，宽 w、高 h（含拱）。 */
function archway(c: Canvas, cx: number, bottom: number, w: number, h: number, frame: Ramp, pointed = false): void {
  const p = c.p;
  const x = cx - Math.floor(w / 2);
  const r = Math.floor(w / 2);
  // 拱券石
  for (let yy = bottom - h - 2; yy < bottom; yy++) {
    const fromTop = yy - (bottom - h - 2);
    const k = pointed ? archInset(w + 4, fromTop) : fromTop < r + 2 ? Math.round(r + 2 - Math.sqrt(Math.max(0, (r + 2) ** 2 - (r + 2 - fromTop) ** 2))) : 0;
    p.hline(x - 2 + k, x + w + 1 - k, yy, frame[3]);
    p.set(x + w + 1 - k, yy, frame[1]);
  }
  for (let yy = bottom - h; yy < bottom; yy++) {
    const fromTop = yy - (bottom - h);
    const k = pointed ? archInset(w, fromTop) : fromTop < r ? Math.round(r - Math.sqrt(Math.max(0, r * r - (r - fromTop) ** 2))) : 0;
    p.hline(x + k, x + w - 1 - k, yy, ink.brown);
    if (fromTop > r) p.set(x + k, yy, P.wood[0]);
  }
  // 门洞深处的地面透出一点亮
  p.hline(x + 2, x + w - 3, bottom - 1, P.stone[1]);
  p.set(cx, bottom - h - 2, frame[4] ?? frame[3]);
}

function gateEastern(c: Canvas): void {
  const p = c.p;
  const g = c.gy;
  const cx = Math.floor(c.w / 2);
  const bw = 76;
  const x = cx - bw / 2;
  const top = g - 36;
  ashlar(p, x, top, bw, 36, P.stone, { course: 4, min: 6, max: 11, seed: 3 });
  p.vline(x, top, g - 1, P.stone[3]);
  p.vline(x + bw - 1, top, g - 1, P.stone[1]);
  archway(c, cx, g, 18, 24, P.stone);
  // 门扇半开：朱漆门钉
  for (const [dx, w] of [
    [-9, 4],
    [5, 4],
  ] as const) {
    p.rect(cx + dx, g - 16, w, 16, P.red[2]);
    p.vline(cx + dx, g - 16, g - 1, P.red[3]);
    for (let yy = g - 14; yy < g - 2; yy += 3) p.set(cx + dx + 2, yy, P.gold[3]);
  }
  // 匾额
  eastern.sign(c, cx, top + 1, "office");
  // 城楼
  const tw = 48;
  const tx = cx - tw / 2;
  const ty = top - 14;
  p.rect(tx - 4, top - 2, tw + 8, 2, P.stone[3]);
  for (let bx = tx - 4; bx < tx + tw + 4; bx += 2) p.set(bx, top - 3, P.red[1]);
  eastern.wall(c, tx, ty, tw, 14, "main");
  for (const px of [tx + 2, tx + 14, tx + tw - 17, tx + tw - 5]) eastern.post(c, px, ty + 1, top - 3, "column");
  const r1 = tier(c, tx, tw, ty, 8, 7, 3);
  brackets(c, tx, tw, ty + 2);
  const ux = tx + 8;
  const uw = tw - 16;
  const uy = r1 - 6;
  eastern.wall(c, ux, uy, uw, r1 - uy + 3, "plain");
  const r2 = tier(c, ux, uw, uy, 8, 6, 3);
  brackets(c, ux, uw, uy + 2);
  pearl(c, cx, r2, false);
}

function gateNordic(c: Canvas): void {
  const p = c.p;
  const g = c.gy;
  const cx = Math.floor(c.w / 2);
  const gw = 40;
  const x = cx - gw / 2;
  const top = g - 38;
  ashlar(p, x, top, gw, 38, P.stone, { course: 4, min: 5, max: 9, seed: 5 });
  archway(c, cx, g, 16, 24, P.stone);
  // 吊闸（铁栅，落下一半）
  for (let xx = cx - 7; xx <= cx + 7; xx += 3) p.vline(xx, g - 23, g - 12, P.iron[2]);
  for (let yy = g - 22; yy <= g - 12; yy += 4) p.hline(cx - 7, cx + 7, yy, P.iron[1]);
  for (let xx = cx - 7; xx <= cx + 7; xx += 3) p.set(xx, g - 11, P.iron[3]);
  // 垛口
  for (let xx = x; xx < x + gw; xx += 7) {
    p.rect(xx, top - 5, 4, 5, P.stone[2]);
    p.hline(xx, xx + 3, top - 5, P.stone[3]);
  }
  nordic.sign(c, cx, top + 1, "office");
  // 两座圆塔 + 尖顶
  for (const tx of [x - 14, x + gw - 2]) {
    const tw = 16;
    const tt = g - 52;
    ashlar(p, tx, tt, tw, 52, P.stone, { course: 4, min: 4, max: 7, seed: tx });
    for (let yy = tt; yy < g; yy++) {
      p.set(tx, yy, P.stone[3]);
      p.set(tx + tw - 1, yy, P.stone[0]);
      p.set(tx + tw - 2, yy, P.stone[1]);
    }
    p.rect(tx + 7, tt + 10, 2, 6, ink.deep);
    p.rect(tx + 7, tt + 26, 2, 6, c.o.lit ? P.lamp[1] : ink.deep);
    p.rect(tx - 1, tt - 2, tw + 2, 2, P.stone[3]);
    const x0 = tx - 1;
    const x1 = tx + tw;
    fillProfile(
      p,
      x0,
      x1,
      (xx) => {
        if (xx < x0 || xx > x1) return null;
        const d = Math.min(xx - x0, x1 - xx) + 0.5;
        return [tt - 2 - Math.round((d / ((x1 - x0) / 2)) * 22), tt - 2] as const;
      },
      slateTex(x0, 99, x1),
    );
    c.markRoof(x0, tt - 24, x1 - x0 + 1, 23, P.slate, 1);
    const tcx = tx + Math.floor(tw / 2);
    p.vline(tcx, tt - 30, tt - 24, P.iron[1]);
    p.rect(tcx + 1, tt - 30, 4, 2, P.cloth.blue[1]);
  }
}

function gateLowland(c: Canvas): void {
  const p = c.p;
  const g = c.gy;
  const cx = Math.floor(c.w / 2);
  const bw = 60;
  const x = cx - bw / 2;
  const top = g - 40;
  bricks(p, x, top, bw, 40, P.brick, 5);
  for (let yy = top; yy < g; yy += 3) {
    const long = ((yy - top) / 3) % 2 === 0;
    p.rect(x, yy, long ? 4 : 2, 2, P.plaster[3]);
    p.rect(x + bw - (long ? 4 : 2), yy, long ? 4 : 2, 2, P.plaster[2]);
  }
  archway(c, cx, g, 18, 24, [P.plaster[0], P.plaster[1], P.plaster[2], P.plaster[3], P.white]);
  // 敞开的绿门扇
  p.rect(cx - 13, g - 18, 3, 18, P.cloth.green[1]);
  p.rect(cx + 11, g - 18, 3, 18, P.cloth.green[1]);
  lowland.band(c, x, bw, top + 8);
  lowland.sign(c, cx, top + 11, "office");
  // 山墙：砖砌、圆窗、麦穗顶饰
  const apex = gableFront(
    c,
    cx,
    top - 1,
    bw / 2 - 2,
    20,
    (t) => bricks(t, x, top - 22, bw, 22, P.brick, 9),
    [P.autumn[0], P.autumn[2], P.autumn[3]],
    { thick: 3, over: 3, mark: P.autumn },
  );
  p.circle(cx, top - 9, 4, P.plaster[3]);
  p.circle(cx, top - 9, 3, c.o.lit ? P.lamp[2] : P.white);
  p.vline(cx, top - 12, top - 9, P.iron[0]);
  p.hline(cx, cx + 2, top - 9, P.iron[0]);
  sheaf(c, cx, apex);
  // 两侧小角楼
  for (const tx of [x - 10, x + bw - 2]) {
    bricks(p, tx, g - 34, 12, 34, P.brick, tx);
    p.vline(tx, g - 34, g - 1, P.brick[3]);
    p.vline(tx + 11, g - 34, g - 1, P.brick[1]);
    p.rect(tx + 5, g - 26, 2, 5, ink.deep);
    const x0 = tx - 1;
    const x1 = tx + 12;
    fillProfile(
      p,
      x0,
      x1,
      (xx) => {
        if (xx < x0 || xx > x1) return null;
        const d = Math.min(xx - x0, x1 - xx) + 0.5;
        return [g - 34 - Math.round((d / ((x1 - x0) / 2)) * 10), g - 34] as const;
      },
      tileTex(x0, x1, 99),
    );
    c.markRoof(x0, g - 44, x1 - x0 + 1, 11, P.autumn, 1);
  }
}

function gateDesert(c: Canvas): void {
  const p = c.p;
  const g = c.gy;
  const cx = Math.floor(c.w / 2);
  const bw = 50;
  const x = cx - bw / 2;
  const top = g - 46;
  adobe(p, x, top, bw, 46, P.sand, 3);
  archway(c, cx, g, 20, 30, P.teal, true);
  // 拱外一圈沙色边
  desert.band(c, x, bw, top + 6);
  for (let i = 0; i < bw; i++) p.set(x + i, top + 3, i % 6 < 3 ? P.teal[2] : P.red[2]);
  p.hline(x - 1, x + bw, top, P.sand[4]);
  for (const mx of [x + 3, x + 12, x + bw - 13, x + bw - 4]) merlon(c, mx, top);
  merlon(c, cx, top, true);
  desert.sign(c, cx, top + 9, "office");
  // 两座收分的高塔
  for (const tx of [x - 14, x + bw]) {
    const tt = g - 58;
    adobe(p, tx, tt, 14, 58, P.sand, tx);
    p.vline(tx, tt, g - 1, P.sand[4]);
    p.vline(tx + 13, tt, g - 1, P.sand[1]);
    for (const yy of [tt + 12, tt + 30]) {
      p.hline(tx - 1, tx + 14, yy, P.sand[4]);
      p.hline(tx - 1, tx + 14, yy + 1, P.sand[2]);
    }
    desert.window(c, tx + 5, tt + 16, "small");
    desert.window(c, tx + 5, tt + 34, "small");
    p.hline(tx - 1, tx + 14, tt, P.sand[4]);
    dome(c, tx + 7, tt, 5);
  }
}

function gateIslands(c: Canvas): void {
  const p = c.p;
  const g = c.gy;
  const cx = Math.floor(c.w / 2);
  // 珊瑚石墙基 + 两侧木栅
  coral(p, cx - 40, g - 8, 80, 8, 5);
  for (let x = cx - 40; x < cx + 40; x += 4) {
    if (Math.abs(x + 2 - cx) < 14) continue;
    p.rect(x, g - 30, 4, 22, P.wood[2]);
    p.vline(x, g - 30, g - 9, P.wood[3]);
    p.vline(x + 3, g - 30, g - 9, P.wood[1]);
    p.set(x + 1, g - 31, P.wood[3]).set(x + 2, g - 31, P.wood[2]);
  }
  p.hline(cx - 40, cx + 39, g - 24, P.straw[1]);
  // 两根彩绘门柱
  for (const px of [cx - 14, cx + 11]) {
    p.rect(px, g - 46, 4, 46, P.teal[2]);
    p.vline(px, g - 46, g - 1, P.teal[3]);
    p.vline(px + 3, g - 46, g - 1, P.teal[1]);
    for (let yy = g - 42; yy < g - 4; yy += 8) {
      p.hline(px, px + 3, yy, P.red[2]);
      p.hline(px, px + 3, yy + 1, P.blossom[2]);
    }
    p.rect(px - 1, g - 50, 6, 4, P.wood[1]);
    p.set(px + 1, g - 51, P.blossom[3]).set(px + 2, g - 51, P.blossom[3]);
  }
  // 横梁 + A 字茅草门顶
  p.rect(cx - 17, g - 46, 35, 3, P.wood[2]);
  p.hline(cx - 17, cx + 17, g - 46, P.wood[3]);
  const x0 = cx - 20;
  const x1 = cx + 20;
  fillProfile(
    p,
    x0,
    x1,
    (xx) => {
      if (xx < x0 || xx > x1) return null;
      const u = 1 - Math.abs(xx - cx) / 20.5;
      return [g - 47 - Math.round(Math.pow(u, 0.9) * 18), g - 45] as const;
    },
    thatchTex(x0, x1, 9),
  );
  c.markRoof(x0, g - 66, x1 - x0 + 1, 21, P.straw, 1);
  p.line(cx - 1, g - 65, cx - 5, g - 70, P.wood[1]);
  p.line(cx + 1, g - 65, cx + 5, g - 70, P.wood[2]);
  islands.sign(c, cx, g - 42, "office");
  // 门下挂一串贝壳
  for (let x = cx - 9; x <= cx + 9; x += 3) p.set(x, g - 26 + (Math.abs(x - cx) % 2), P.blossom[3]);
}

/** 地中海：凯旋门式的石灰华城门。大半圆拱与拱心石、拱上一块蓝白瓷砖匾与招牌、顶上石栏杆与瓶饰；两侧方塔，筒瓦尖顶、拱形窗，敞开的铁艺门扇。 */
function gateMediterranean(c: Canvas): void {
  const p = c.p;
  const g = c.gy;
  const cx = Math.floor(c.w / 2);
  const bw = 52;
  const x = cx - bw / 2;
  const top = g - 44;
  ashlar(p, x, top, bw, 44, TRAV, { course: 4, min: 7, max: 12, seed: 7, light: 2 });
  p.vline(x, top, g - 1, TRAV[4]);
  p.vline(x + bw - 1, top, g - 1, TRAV[1]);
  // 壁柱
  for (const px of [x + 3, x + bw - 6]) {
    p.rect(px, top + 6, 3, 38, TRAV[3]);
    p.vline(px, top + 6, g - 1, TRAV[4]);
    p.vline(px + 2, top + 6, g - 1, TRAV[1]);
  }
  archway(c, cx, g, 22, 28, TRAV);
  // 敞开的铁艺门扇
  for (const dx of [-15, 12]) {
    for (let yy = g - 20; yy < g; yy++) p.set(cx + dx, yy, P.iron[1]).set(cx + dx + 2, yy, P.iron[1]);
    for (let yy = g - 20; yy < g; yy += 3) p.set(cx + dx + 1, yy, P.iron[2]);
  }
  // 瓷砖匾
  for (let xx = cx - 12; xx <= cx + 12; xx++) {
    for (let yy = top + 3; yy <= top + 8; yy++) {
      const edge = yy === top + 3 || yy === top + 8 || xx === cx - 12 || xx === cx + 12;
      p.set(xx, yy, edge ? TRAV[4] : ((xx >> 1) + (yy >> 1)) % 2 ? AZ[1] : P.white);
    }
  }
  // 顶部檐口、栏杆与瓶饰
  p.hline(x - 2, x + bw + 1, top, TRAV[4]);
  p.hline(x - 2, x + bw + 1, top + 1, TRAV[1]);
  balustrade(c, x - 1, x + bw, top - 5);
  for (const ux of [x, cx, x + bw - 1]) p.stamp([".a.", "abc", "abc", ".b.", "abc"], { a: TRAV[4], b: TRAV[3], c: TRAV[1] }, ux - 1, top - 10);
  mediterranean.sign(c, cx, top + 10, "office");
  // 两座方塔
  for (const tx of [x - 15, x + bw - 1]) {
    const tw = 16;
    const tt = g - 60;
    plaster(p, tx, tt, tw, 60, P.plaster, tx);
    ashlar(p, tx, g - 16, tw, 16, TRAV, { course: 4, min: 5, max: 8, seed: tx, light: 2 });
    p.vline(tx, tt, g - 1, P.white);
    p.vline(tx + tw - 1, tt, g - 1, P.plaster[1]);
    for (const yy of [g - 16, tt + 14]) {
      p.hline(tx - 1, tx + tw, yy, TRAV[4]);
      p.hline(tx - 1, tx + tw, yy + 1, TRAV[1]);
    }
    archFill(c, tx + 6, tt + 3, 4, 9, () => (c.o.lit ? P.lamp[1] : ink.brown));
    archFill(c, tx + 6, tt + 24, 4, 8, () => ink.deep);
    const x0 = tx - 2;
    const x1 = tx + tw + 1;
    fillProfile(
      p,
      x0,
      x1,
      (xx) => {
        if (xx < x0 || xx > x1) return null;
        const d = Math.min(xx - x0, x1 - xx) + 0.5;
        return [tt - Math.round((d / ((x1 - x0) / 2)) * 10), tt] as const;
      },
      barrelTex(x0, x1, 99),
    );
    c.markRoof(x0, tt - 10, x1 - x0 + 1, 11, TR, 1);
    const tcx = tx + Math.floor(tw / 2);
    p.vline(tcx, tt - 16, tt - 10, P.iron[1]);
    p.rect(tcx + 1, tt - 16, 4, 2, mediterranean.flag[1]);
    p.set(tcx + 1, tt - 14, mediterranean.flag[0]);
  }
}

/** 开拓者：木栅城门。两座外挑的原木堡夹着敞开的木板大门，门上横着一根圆木门楣挂着招牌，堡顶插旗。 */
function gateFrontier(c: Canvas): void {
  const p = c.p;
  const g = c.gy;
  const cx = Math.floor(c.w / 2);
  // 两侧木栅
  for (let x = cx - 44; x < cx + 44; x += 4) {
    if (Math.abs(x + 2 - cx) < 30) continue;
    const tip = g - 30 - ((x >> 2) % 2);
    p.rect(x, tip, 4, g - tip, P.wood[2]);
    p.vline(x, tip, g - 1, P.wood[3]);
    p.vline(x + 3, tip, g - 1, P.wood[1]);
    p.set(x + 1, tip - 1, P.wood[3]).set(x + 2, tip - 1, P.wood[2]);
  }
  // 敞开的木板大门（向里开，露出城里的土路）
  p.rect(cx - 12, g - 26, 24, 26, ink.brown);
  p.rect(cx - 10, g - 6, 20, 6, P.sand[2]);
  p.dither(cx - 10, g - 12, 20, 6, P.leaf[1], 1);
  // 两扇向里敞开的门板（斜着看只露出窄窄一条）
  for (const dx of [-12, 8]) {
    planks(p, cx + dx, g - 25, 4, 25, P.wood, 1, 2);
    p.hline(cx + dx, cx + dx + 3, g - 20, P.wood[1]);
    p.hline(cx + dx, cx + dx + 3, g - 6, P.wood[1]);
  }
  // 门楣：一根横放的粗圆木
  p.rect(cx - 16, g - 31, 32, 4, P.wood[2]);
  p.hline(cx - 16, cx + 15, g - 31, P.wood[3]);
  p.hline(cx - 16, cx + 15, g - 28, P.wood[1]);
  p.stamp(["abba", "bcdb", "bddb", "abba"], { a: P.wood[1], b: P.wood[2], c: P.wood[4], d: P.wood[3] }, cx - 19, g - 31);
  p.stamp(["abba", "bcdb", "bddb", "abba"], { a: P.wood[1], b: P.wood[2], c: P.wood[4], d: P.wood[3] }, cx + 15, g - 31);
  frontier.sign(c, cx, g - 27, "office");
  // 两座木堡
  for (const tx of [cx - 30, cx + 16]) {
    const tw = 14;
    chinkedLogs(p, tx, g - 40, tw, 40, tx);
    logCorner(p, tx - 2, g - 40, 40);
    logCorner(p, tx + tw - 2, g - 40, 40);
    // 外挑的上层
    const ut = g - 54;
    chinkedLogs(p, tx - 3, ut, tw + 6, 14, tx + 1);
    p.hline(tx - 3, tx + tw + 2, ut + 14, P.wood[0]);
    for (let i = 0; i < 3; i++) p.line(tx - 3 + i * 8, ut + 15, tx + i * 8, ut + 18, P.wood[1]);
    p.rect(tx + 2, ut + 5, 2, 3, ink.deep);
    p.rect(tx + tw - 4, ut + 5, 2, 3, c.o.lit ? P.lamp[1] : ink.deep);
    p.rect(tx + 6, g - 26, 2, 3, ink.deep);
    const x0 = tx - 6;
    const x1 = tx + tw + 5;
    fillProfile(
      p,
      x0,
      x1,
      (xx) => {
        if (xx < x0 || xx > x1) return null;
        const d = Math.min(xx - x0, x1 - xx) + 0.5;
        return [ut - Math.round((d / ((x1 - x0) / 2)) * 11), ut] as const;
      },
      shingleTex(x0, x1, 99, tx),
    );
    c.markRoof(x0, ut - 11, x1 - x0 + 1, 12, SH, 1);
    const tcx = tx + Math.floor(tw / 2);
    p.vline(tcx, ut - 20, ut - 11, P.wood[1]);
    p.rect(tcx + 1, ut - 20, 5, 3, frontier.flag[1]);
    p.hline(tcx + 1, tcx + 5, ut - 20, frontier.flag[2]);
  }
}

/** 风格 → 城门。 */
const GATES: Readonly<Record<ArchStyle, (c: Canvas) => void>> = {
  mediterranean: gateMediterranean,
  nordic: gateNordic,
  lowland: gateLowland,
  desert: gateDesert,
  islands: gateIslands,
  eastern: gateEastern,
  frontier: gateFrontier,
};

/** 城门（已描边、裁边，底边是地面线）。 */
export function drawGateImpl(style: TownStyle, o: DrawOpts): Px {
  const c = new Canvas(112, 100, style, { ...o }, hash32(`gate/${seedTag(style)}`));
  const art = cultureArt(style);
  if (art) art.gate(c);
  else GATES[style as ArchStyle](c);
  return finish(c);
}
