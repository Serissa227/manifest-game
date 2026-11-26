// 远景：后排的屋顶剪影、塔楼与城墙。只用少量色阶，最后整体罩一层雾色（空气透视：偏淡、偏冷）。
// 宽度任意、可无缝横向重复：所有元素都按宽度取模绘制（跨过右边界的部分从左边接上）。
import type { ArchStyle, TownStyle } from "../buildings";
import { P, overlay } from "../palette";
import { Px, rgba } from "../px";
import { hash32 } from "../rng";
import { type DrawOpts, type Ramp, h01, tintOpaque } from "./kit";
import { seedTag } from "./style";
import { cultureArt } from "./cultures";
import { type Far, type FarCtx, farWindows, wrap } from "./townArt";

export const SKYLINE_H = 64;

/** 前排的薄雾（远景天色 sky[4]，约 35% 不透明）。 */
const THIN_FOG = "#dcecf859";

const EASTERN_FAR: Far = { roof: [P.jade[0], P.jade[1], P.jade[2]], wall: [P.plaster[1], P.plaster[2], P.plaster[3]], accent: [P.red[0], P.red[1], P.red[2]] };
const NORDIC_FAR: Far = { roof: [P.slate[0], P.slate[1], P.slate[2]], wall: [P.stone[1], P.stone[2], P.stone[3]], accent: [P.wood[1], P.wood[2], P.wood[3]] };
const LOWLAND_FAR: Far = { roof: [P.autumn[0], P.autumn[1], P.autumn[2]], wall: [P.brick[1], P.brick[2], P.brick[3]], accent: [P.plaster[1], P.plaster[2], P.plaster[3]] };

/** 风格 → 远景配色。 */
const FAR: Readonly<Record<ArchStyle, Far>> = {
  mediterranean: { roof: [P.brick[1], P.brick[2], P.brick[3]], wall: [P.plaster[1], P.plaster[2], P.plaster[3]], accent: [P.leaf[0], P.leaf[1], P.leaf[2]] },
  nordic: NORDIC_FAR,
  lowland: LOWLAND_FAR,
  desert: { roof: [P.sand[1], P.sand[2], P.sand[3]], wall: [P.sand[2], P.sand[3], P.sand[4]], accent: [P.teal[0], P.teal[1], P.teal[2]] },
  islands: { roof: [P.straw[0], P.straw[1], P.straw[2]], wall: [P.wood[1], P.wood[2], P.wood[3]], accent: [P.blossom[0], P.blossom[1], P.blossom[2]] },
  eastern: EASTERN_FAR,
  frontier: { roof: [P.wood[0], P.stone[1], P.stone[2]], wall: [P.wood[1], P.wood[2], P.wood[3]], accent: [P.leaf[0], P.leaf[1], P.leaf[2]] },
};

type Ctx = FarCtx;

/** 一栋远处的房子：墙 + 按风格的屋顶。 */
function farHouse(k: Ctx, style: ArchStyle, x: number, w: number, h: number, seed: number): void {
  const p = k.p;
  const b = k.base;
  const f = k.f;
  const wallTop = b - h;
  p.rect(x, wallTop, w, h, f.wall[1]);
  p.vline(x + w - 1, wallTop, b - 1, f.wall[0]);
  p.vline(x, wallTop, b - 1, f.wall[2]);
  farWindows(k, x, wallTop + 2, w, h - 2, seed);
  const R = f.roof;
  if (style === "mediterranean" && h01(seed, 4, 5) < 0.3) {
    // 平顶屋：一道白色女儿墙，偶尔一座小阁
    p.hline(x - 1, x + w, wallTop, f.wall[2]);
    p.hline(x - 1, x + w, wallTop + 1, f.wall[0]);
    if (w > 12) {
      p.rect(x + 2, wallTop - 4, 5, 4, f.wall[1]);
      p.hline(x + 1, x + 7, wallTop - 5, R[1]);
      p.set(x + 3, wallTop - 3, f.wall[0]);
      k.roofs.push([x + 1, wallTop - 5, 7, 2]);
    }
    return;
  }
  if (style === "desert") {
    p.hline(x - 1, x + w, wallTop, f.wall[2]);
    if (h01(seed, 1, 5) < 0.5) p.rect(x + 1, wallTop - 2, 3, 2, f.wall[1]);
    if (h01(seed, 2, 5) < 0.35) {
      // 小圆顶
      const r = Math.max(2, Math.floor(w / 4));
      const cx = x + Math.floor(w / 2);
      p.ellipse(cx, wallTop, r, r, f.accent[1]);
      p.rect(cx - r - 1, wallTop + 1, r * 2 + 3, r + 1, f.wall[1]);
      p.set(cx - 1, wallTop - r + 1, f.accent[2]);
      k.roofs.push([cx - r, wallTop - r, r * 2 + 1, r]);
    }
    return;
  }
  if (style === "lowland") {
    // 山墙朝街的三角屋顶
    const hw = Math.floor(w / 2) + 1;
    const cx = x + Math.floor(w / 2);
    const rh = Math.round(hw * 0.9);
    p.poly(
      [
        [cx - hw, wallTop + 1],
        [cx + 0.5, wallTop - rh],
        [cx + hw + 1, wallTop + 1],
      ],
      R[1],
    );
    p.line(cx - hw, wallTop, cx, wallTop - rh + 1, R[2]);
    k.roofs.push([cx - hw, wallTop - rh, hw * 2 + 1, rh + 1]);
    return;
  }
  const over = style === "islands" ? 3 : style === "eastern" ? 3 : style === "mediterranean" ? 2 : 1;
  const rh =
    style === "nordic"
      ? Math.round(w * 0.55)
      : style === "islands"
        ? Math.round(w * 0.5)
        : style === "frontier"
          ? Math.round(w * 0.42)
          : style === "mediterranean"
            ? Math.max(3, Math.round(w * 0.2))
            : Math.max(4, Math.round(w * 0.3));
  const inset = style === "nordic" ? Math.round(rh * 0.5) : style === "islands" ? Math.round(rh * 0.7) : style === "frontier" ? Math.round(rh * 0.8) : rh + 1;
  const x0 = x - over;
  const x1 = x + w - 1 + over;
  for (let xx = x0; xx <= x1; xx++) {
    const d = Math.min(xx - x0, x1 - xx);
    const t = Math.min(1, d / Math.max(1, inset));
    const curve = style === "islands" ? Math.sqrt(t) : style === "eastern" ? t * t : t;
    const top = wallTop - Math.round(curve * rh);
    const lift = style === "eastern" && d < 2 ? 2 - d : 0;
    p.vline(xx, top - lift, wallTop + 1 - lift, xx > (x0 + x1) / 2 + inset / 2 ? R[0] : R[1]);
    if (xx < (x0 + x1) / 2) p.set(xx, top - lift, R[2]);
  }
  k.roofs.push([x0, wallTop - rh - 2, x1 - x0 + 1, rh + 3]);
  if (style === "mediterranean") {
    // 筒瓦的竖垄：屋面上每 3 列一道亮线
    for (let xx = x0 + 2; xx < x1 - 1; xx += 3) {
      for (let yy = wallTop - rh + 2; yy <= wallTop; yy++) if (p.get(xx, yy) === rgba(R[1])) p.set(xx, yy, R[2]);
    }
  }
  if (style === "frontier" && h01(seed, 3, 5) < 0.55) {
    // 石烟囱与一棵松树
    const cx = x + Math.round(w * 0.7);
    p.rect(cx, wallTop - rh + 2, 2, 5, P.stone[1]);
    farPine(k, x + w + 2, b, 12 + Math.floor(h01(seed, 6, 5) * 10));
  }
  if (style === "nordic" && h01(seed, 3, 5) < 0.6) {
    const cx = x + Math.round(w * 0.7);
    p.rect(cx, wallTop - rh + 1, 2, 5, f.wall[0]);
  }
  if (style === "islands") {
    // 高脚：墙下留出一排柱脚
    for (let xx = x + 1; xx < x + w; xx += 4) p.vline(xx, b - 3, b - 1, f.wall[0]);
    p.rect(x + 2, b - 3, w - 3, 3, null);
    for (let xx = x + 1; xx < x + w; xx += 4) p.vline(xx, b - 3, b - 1, f.wall[0]);
  }
}

/** 远处的一棵松树（开拓者远景）：底在 b，高 h。 */
function farPine(k: Ctx, cx: number, b: number, h: number): void {
  const p = k.p;
  const f = k.f;
  for (let i = 0; i < h; i++) {
    const hw = Math.floor((i % 5) * 0.6 + i * 0.22);
    const y = b - h + i;
    p.hline(cx - hw, cx + hw, y, f.accent[1]);
    if (hw > 0) p.set(cx - hw, y, f.accent[2]);
  }
  p.vline(cx, b - 2, b - 1, f.wall[0]);
  k.roofs.push([cx - 3, b - h, 7, 3]);
}

/** 远处的柏树（地中海远景）：底在 b，高 h。 */
function farCypress(k: Ctx, cx: number, b: number, h: number): void {
  const p = k.p;
  const f = k.f;
  for (let i = 0; i < h; i++) {
    const t = i / h;
    const hw = t < 0.15 ? 0 : t < 0.45 ? 1 : 2;
    p.hline(cx - hw, cx + hw, b - h + i, f.accent[1]);
    if (hw > 0) p.set(cx + hw, b - h + i, f.accent[0]);
  }
}

/** 远处的塔：每种风格一种。 */
function farTower(k: Ctx, style: ArchStyle, x: number, seed: number): number {
  const p = k.p;
  const b = k.base;
  const f = k.f;
  const R = f.roof;
  const tall = Math.min(34 + Math.floor(h01(seed, 9, 1) * 14), b - 24);
  if (style === "mediterranean") {
    if (h01(seed, 11, 1) < 0.5) {
      // 圆顶教堂：鼓座上的大圆顶 + 两侧柏树
      const cx = x + 12;
      p.rect(cx - 9, b - 14, 19, 14, f.wall[1]);
      p.vline(cx + 9, b - 14, b - 1, f.wall[0]);
      p.rect(cx - 6, b - 20, 13, 6, f.wall[2]);
      for (let xx = cx - 4; xx <= cx + 4; xx += 3) p.vline(xx, b - 19, b - 17, f.wall[0]);
      p.ellipse(cx, b - 21, 7, 7, R[1]);
      p.rect(cx - 8, b - 20, 17, 6, f.wall[2]);
      for (let xx = cx - 4; xx <= cx + 4; xx += 3) p.vline(xx, b - 19, b - 16, f.wall[0]);
      p.set(cx - 3, b - 26, R[2]).set(cx - 2, b - 27, R[2]).set(cx - 4, b - 24, R[2]);
      p.vline(cx, b - 31, b - 28, f.wall[2]);
      k.roofs.push([cx - 7, b - 28, 15, 7]);
      k.lights.push([cx - 4, b - 9], [cx + 4, b - 9]);
      farCypress(k, x + 1, b, 14);
      farCypress(k, x + 24, b, 11);
      return 27;
    }
    // 钟楼：细高的白塔、钟室开口、低矮的瓦顶
    const w = 7;
    p.rect(x, b - tall, w, tall, f.wall[1]);
    p.vline(x + w - 1, b - tall, b - 1, f.wall[0]);
    p.vline(x, b - tall, b - 1, f.wall[2]);
    p.rect(x + 2, b - tall + 3, 3, 4, f.wall[0]);
    p.hline(x - 1, x + w, b - tall + 1, f.wall[2]);
    p.poly(
      [
        [x - 1, b - tall + 1],
        [x + w / 2, b - tall - 6],
        [x + w + 1, b - tall + 1],
      ],
      R[1],
    );
    p.line(x - 1, b - tall, x + 3, b - tall - 5, R[2]);
    k.roofs.push([x - 1, b - tall - 6, w + 3, 7]);
    k.lights.push([x + 3, b - tall + 12]);
    farCypress(k, x + 11, b, 16);
    return 14;
  }
  if (style === "frontier") {
    // 原木瞭望塔：两根斜腿、交叉撑、顶上小屋；旁边两棵松树
    const cx = x + 6;
    const top = b - tall;
    p.line(cx - 5, b - 1, cx - 3, top + 6, f.wall[0]);
    p.line(cx + 5, b - 1, cx + 3, top + 6, f.wall[0]);
    for (let y = top + 10; y < b - 4; y += 9) {
      p.line(cx - 4, y, cx + 4, y + 8, f.wall[1]);
      p.line(cx + 4, y, cx - 4, y + 8, f.wall[1]);
    }
    p.rect(cx - 5, top, 11, 6, f.wall[1]);
    p.rect(cx - 3, top + 2, 7, 2, f.wall[0]);
    k.lights.push([cx, top + 2]);
    p.poly(
      [
        [cx - 7, top + 1],
        [cx + 0.5, top - 6],
        [cx + 8, top + 1],
      ],
      R[1],
    );
    k.roofs.push([cx - 7, top - 6, 16, 7]);
    p.vline(cx, top - 10, top - 6, f.wall[0]);
    p.rect(cx + 1, top - 10, 3, 2, P.cloth.green[1]);
    farPine(k, x + 16, b, 20);
    farPine(k, x + 22, b, 14);
    return 26;
  }
  if (style === "eastern") {
    // 多层塔：层层收分的翘角檐
    let w = 14;
    let y = b;
    const cx = x + 7;
    for (let i = 0; i < 5; i++) {
      const hh = i === 0 ? 10 : 6;
      p.rect(cx - Math.floor(w / 2) + 2, y - hh, w - 4, hh, f.wall[1]);
      p.vline(cx - Math.floor(w / 2) + 2, y - hh, y - 1, f.accent[1]);
      k.lights.push([cx, y - Math.floor(hh / 2)]);
      y -= hh;
      p.hline(cx - Math.floor(w / 2) - 1, cx + Math.floor(w / 2) + 1, y, R[1]);
      p.hline(cx - Math.floor(w / 2), cx + Math.floor(w / 2), y - 1, R[1]);
      p.set(cx - Math.floor(w / 2) - 1, y - 1, R[2]).set(cx + Math.floor(w / 2) + 1, y - 1, R[0]);
      p.hline(cx - Math.floor(w / 2) + 2, cx + Math.floor(w / 2) - 2, y - 2, R[2]);
      k.roofs.push([cx - Math.floor(w / 2) - 1, y - 2, w + 3, 3]);
      y -= 2;
      w = Math.max(6, w - 2);
    }
    p.vline(cx, y - 5, y, f.accent[2]);
    return 16;
  }
  if (style === "nordic") {
    // 石塔 + 尖顶 + 小旗
    const w = 8;
    p.rect(x, b - tall, w, tall, f.wall[1]);
    p.vline(x + w - 1, b - tall, b - 1, f.wall[0]);
    p.vline(x, b - tall, b - 1, f.wall[2]);
    k.lights.push([x + 3, b - tall + 6]);
    const sh = 16;
    p.poly(
      [
        [x - 1, b - tall + 1],
        [x + w / 2, b - tall - sh],
        [x + w + 1, b - tall + 1],
      ],
      R[1],
    );
    p.line(x - 1, b - tall, x + 3, b - tall - sh + 1, R[2]);
    k.roofs.push([x - 1, b - tall - sh, w + 3, sh + 2]);
    p.vline(x + 4, b - tall - sh - 4, b - tall - sh, f.accent[0]);
    p.rect(x + 5, b - tall - sh - 4, 3, 1, f.accent[1]);
    return 12;
  }
  if (style === "lowland") {
    // 风车：收分的塔身 + 斜十字风叶
    const cx = x + 8;
    const top = b - 26;
    p.poly(
      [
        [cx - 6, b],
        [cx - 4, top],
        [cx + 5, top],
        [cx + 7, b],
      ],
      f.accent[1],
    );
    p.line(cx - 6, b - 1, cx - 4, top, f.accent[2]);
    p.ellipse(cx + 0.5, top, 5, 3, R[1]);
    k.roofs.push([cx - 5, top - 3, 12, 4]);
    for (const [dx, dy] of [
      [1, 1],
      [-1, 1],
      [1, -1],
      [-1, -1],
    ] as const) {
      p.line(cx, top + 1, cx + dx * 11, top + 1 + dy * 11, f.wall[0]);
      p.line(cx + dx, top + 1, cx + dx * 11 + dx, top + 1 + dy * 11, f.accent[2]);
    }
    return 18;
  }
  if (style === "desert") {
    // 高窄望楼 + 大圆顶
    const w = 7;
    p.rect(x, b - tall - 4, w, tall + 4, f.wall[1]);
    p.vline(x + w - 1, b - tall - 4, b - 1, f.wall[0]);
    p.vline(x, b - tall - 4, b - 1, f.wall[2]);
    p.hline(x - 1, x + w, b - tall + 4, f.wall[2]);
    p.ellipse(x + 3, b - tall - 5, 3, 3, f.accent[1]);
    p.set(x + 2, b - tall - 7, f.accent[2]);
    p.vline(x + 3, b - tall - 11, b - tall - 9, P.gold[2]);
    k.roofs.push([x, b - tall - 8, w, 4]);
    k.lights.push([x + 3, b - tall + 1]);
    const dx = x + 14;
    p.rect(dx - 7, b - 16, 15, 16, f.wall[1]);
    p.ellipse(dx, b - 16, 7, 7, f.accent[1]);
    p.rect(dx - 8, b - 15, 17, 8, f.wall[1]);
    p.set(dx - 3, b - 21, f.accent[2]).set(dx - 2, b - 22, f.accent[2]);
    k.roofs.push([dx - 7, b - 23, 15, 8]);
    return 24;
  }
  // 群岛：高尖茅草顶的会堂 + 两棵椰子树
  const cx = x + 8;
  p.rect(cx - 5, b - 12, 11, 9, f.wall[1]);
  for (let xx = cx - 5; xx <= cx + 5; xx += 3) p.vline(xx, b - 3, b - 1, f.wall[0]);
  p.poly(
    [
      [cx - 9, b - 10],
      [cx + 0.5, b - 34],
      [cx + 10, b - 10],
    ],
    R[1],
  );
  p.line(cx - 9, b - 11, cx, b - 33, R[2]);
  k.roofs.push([cx - 9, b - 34, 20, 25]);
  for (const [px, ph, lean] of [
    [x + 20, 24, 1],
    [x + 27, 18, -1],
  ] as const) {
    // 弯弯的树干
    for (let k = 0; k < ph; k++) {
      const dx = Math.round(lean * (k / ph) ** 2 * 3);
      p.set(px + dx, b - 1 - k, f.wall[0]);
    }
    const tx = px + lean * 3;
    const ty = b - ph;
    // 下垂的叶片：每片一段短弧
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
    p.set(tx, ty, P.wood[1]);
  }
  return 30;
}

/** 在 p 上铺一排远景（房子与塔），元素按宽度取模绘制。六种文化风格的房子与塔由 cultures.ts 登记的画法来画。 */
function row(k: Ctx, style: TownStyle, seed: number, towerRate: number, hMin: number, hMax: number): void {
  const art = cultureArt(style);
  const house = (c: Ctx, x: number, w: number, h: number, sd: number) => (art ? art.farHouse(c, x, w, h, sd) : farHouse(c, style as ArchStyle, x, w, h, sd));
  const tower = (c: Ctx, x: number, sd: number) => (art ? art.farTower(c, x, sd) : farTower(c, style as ArchStyle, x, sd));
  const W = k.W;
  let x = Math.floor(h01(seed, 0, 9) * 8);
  let i = 0;
  let sinceTower = 0;
  while (x < W) {
    const r = h01(i, seed, 1);
    const at = x;
    const idx = i;
    // 每隔一段必出一座塔，保证任何宽度下都能认出风格
    if ((r < towerRate || sinceTower > 110) && W - x > 24) {
      let used = 0;
      wrap(W, (dx) => {
        used = tower(k, at + dx, seed + idx);
      });
      x += used + 3;
      sinceTower = 0;
    } else {
      const w = 10 + Math.floor(h01(i, seed, 2) * 12);
      const h = hMin + Math.floor(h01(i, seed, 3) * (hMax - hMin));
      wrap(W, (dx) => house(k, at + dx, w, h, seed + idx));
      const step = w + Math.floor(h01(i, seed, 4) * 3);
      x += step;
      sinceTower += step;
    }
    i++;
  }
}

/** 远景一条（宽 width、高 SKYLINE_H），可无缝横向重复。后排更淡，前排稍实，最前面一道城墙。 */
export function drawSkylineImpl(style: TownStyle, width: number, o: DrawOpts): Px {
  const W = Number.isFinite(width) ? Math.max(1, Math.floor(width)) : 1;
  const seed = hash32(`skyline/${seedTag(style)}`);
  const art = cultureArt(style);
  const f = art ? art.far : FAR[style as ArchStyle];
  // 1. 后排：高低错落，罩两层雾
  const back = new Px(W, SKYLINE_H);
  const kb: Ctx = { p: back, W, base: SKYLINE_H - 10, f, o, lights: [], roofs: [] };
  row(kb, style, seed + 101, 0.08, 14, 30);
  // 2. 前排
  const p = new Px(W, SKYLINE_H);
  const k: Ctx = { p, W, base: SKYLINE_H - 6, f, o, lights: [], roofs: [] };
  row(k, style, seed, 0.12, 6, 18);
  // 3. 最前面一道城墙（群岛为木栅），把底边连成一片
  const wallTop = SKYLINE_H - 8;
  if (art) art.farWall(k, wallTop);
  else frontWall(p, style as ArchStyle, W, wallTop, f);
  // 4. 积雪：屋顶区域的上沿换成雪色
  if (o.snow) {
    for (const kk of [kb, k]) {
      for (const [rx, ry, rw, rh] of kk.roofs) {
        for (let xx = rx; xx < rx + rw; xx++) {
          const cx = ((xx % W) + W) % W;
          for (let yy = Math.max(1, ry); yy < ry + rh; yy++) {
            if (!kk.p.isOpaque(cx, yy)) continue;
            if (!kk.p.isOpaque(cx, yy - 1)) {
              kk.p.put(cx, yy, P.snow[3]);
              if (kk.p.isOpaque(cx, yy + 1)) kk.p.put(cx, yy + 1, P.snow[2]);
            }
            break;
          }
        }
      }
    }
    p.hline(0, W - 1, wallTop, P.snow[3]);
  }
  // 5. 空气透视：后排罩一层浓雾，前排罩一层薄雾
  tintOpaque(back, 0, 0, W, SKYLINE_H, overlay.fog);
  tintOpaque(p, 0, 0, W, SKYLINE_H, THIN_FOG);
  const out = new Px(W, SKYLINE_H).blit(back, 0, 0).blit(p, 0, 0);
  // 6. 夜里点灯（不受雾影响；后排灯少一些）
  if (o.lit) {
    for (const [kk, rate] of [
      [kb, 0.35],
      [k, 0.7],
    ] as const) {
      for (const [lx, ly] of kk.lights) {
        const xx = ((lx % W) + W) % W;
        if (kk.p.isOpaque(xx, ly) && out.get(xx, ly) !== 0 && h01(lx, ly, 3) < rate) out.put(xx, ly, P.lamp[h01(lx, ly, 4) < 0.3 ? 2 : 1]);
      }
    }
  }
  return out;
}

/** 七种经典风格最前面的一道城墙（群岛与开拓者为木栅），把底边连成一片。 */
function frontWall(p: Px, style: ArchStyle, W: number, wallTop: number, f: Far): void {
  const palisade = style === "islands" || style === "frontier";
  const wallC: Ramp = palisade
    ? [P.wood[0], P.wood[1], P.wood[2]]
    : style === "lowland"
      ? [P.brick[0], P.brick[1], P.brick[2]]
      : style === "desert"
        ? f.wall
        : style === "mediterranean"
          ? [P.parchmentDark, P.parchment, P.paper]
          : [P.stone[1], P.stone[2], P.stone[3]];
  p.rect(0, wallTop, W, 8, wallC[1]);
  p.hline(0, W - 1, wallTop, wallC[2]);
  const n = Math.max(1, Math.round(W / 4));
  for (let j = 0; j < n; j++) {
    const mx = Math.round((j * W) / n);
    if (palisade) {
      p.vline(mx, wallTop - 3, wallTop, wallC[1]);
      p.set(mx, wallTop - 4, wallC[2]);
    } else if (style === "eastern") {
      p.hline(mx, mx + 2, wallTop - 1, f.roof[1]);
    } else {
      p.rect(mx, wallTop - 2, 2, 2, wallC[2]);
    }
  }
}
