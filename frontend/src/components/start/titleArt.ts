// 标题画面的像素美术：黄昏的港湾（灯塔、岬角与守塔人小屋、夕阳与海面倒影、归航的船、远帆、远处港镇的灯火、
// 海鸥、星星），以及开局窗口用到的装饰小图（窗框、羊皮纸底纹、罗盘徽记、菜单指针、翻页箭头、剧本卡片的小景）。
//
// 场景由共享美术模块（海面、云、远山、船、海鸥、按时间调色）与本文件自绘的部分（天空与夕阳、灯塔、岬角、
// 远处港镇、光束）合成。其他模块的图一律按“黄昏”调色后再贴，整幅画的色调与港口街景的黄昏保持一致。
// 本场景的光源是右侧低垂的夕阳：受光面在右，灯塔与岩壁的左侧处在阴影里（逆光的黄昏场景）。
// 只用确定性随机（rng / hash32），同一 (宽度, 帧号) 永远画出同一幅画。
import { drawSkyline, type TownStyle } from "../../art/buildings";
import { P, ink } from "../../art/palette";
import { Px, luma, rgba, type Color, type Rgba } from "../../art/px";
import { memo } from "../../art/render";
import { hash32, rng } from "../../art/rng";
import { SEA_FRAMES, drawCloud, drawDistantLand, drawGull, drawSea, gradeColor, shadeForTime } from "../../art/scenery";
import { SHIP_FRAMES, drawShip, drawShipByKey, shipArtKey } from "../../art/ships";

/** 标题场景的逻辑高度（像素）；宽度随窗口变化。 */
export const TITLE_H = 200;
/** 海平线所在的行。 */
export const HORIZON = 112;
/** 灯塔光束转一圈的帧数（10 帧/秒）。 */
export const BEAM_PERIOD = 56;
/** 场景的最小逻辑宽度。 */
export const TITLE_MIN_W = 240;
/** 共享海面在黄昏时的反光带位置（占宽度的比例，见 art/scenery/sea.ts）：生成更宽的海面再平移，使反光落在夕阳正下方。 */
const SEA_PATH_X = 0.22;

// ───────────────────────────── 通用小工具 ─────────────────────────────

/** 2×2 有序抖动：level 1 = 25%，2 = 50%，3 = 75%。 */
function hit(x: number, y: number, level: number): boolean {
  if (level <= 0) return false;
  if (level === 1) return x % 2 === 0 && y % 2 === 0;
  if (level === 2) return (x + y) % 2 === 0;
  if (level === 3) return !(x % 2 === 1 && y % 2 === 1);
  return true;
}

/**
 * 按明度把图重新着色到一条色阶上（由暗到亮），保留透明度。
 * 明度先按图中实际的最暗、最亮值拉伸，所以任何画法的图都会用满整条色阶。
 */
export function remapToRamp(src: Px, ramp: readonly string[]): Px {
  const cols = ramp.map((c) => rgba(c));
  const out = src.clone();
  let lo = 255;
  let hi = 0;
  for (const v of out.data) {
    if (!(v & 0xff)) continue;
    const l = luma(v);
    if (l < lo) lo = l;
    if (l > hi) hi = l;
  }
  const span = Math.max(1, hi - lo);
  for (let i = 0; i < out.data.length; i++) {
    const v = out.data[i];
    const a = v & 0xff;
    if (!a) continue;
    const k = Math.min(cols.length - 1, Math.floor(((luma(v) - lo) / span) * cols.length));
    out.data[i] = ((cols[k] & 0xffffff00) | a) >>> 0;
  }
  return out;
}

/** 竖直分段渐变：weights 决定各段的相对高度；每段末尾 blend 行内用 25% / 50% / 75% 抖动过渡到下一段。 */
function bandedGradient(p: Px, y0: number, h: number, colors: readonly string[], weights: readonly number[], blend = 6) {
  const total = weights.reduce((a, b) => a + b, 0);
  const edges: number[] = [];
  let acc = 0;
  for (const w of weights) {
    acc += w;
    edges.push(Math.round((acc / total) * h));
  }
  let k = 0;
  for (let i = 0; i < h; i++) {
    while (k < edges.length - 1 && i >= edges[k]) k++;
    const remaining = edges[k] - i;
    const next = k + 1 < colors.length ? colors[k + 1] : null;
    const level = next && remaining <= blend ? Math.min(3, Math.ceil(((blend - remaining + 1) / blend) * 3)) : 0;
    const y = y0 + i;
    for (let x = 0; x < p.w; x++) p.put(x, y, next && hit(x, y, level) ? next : colors[k]);
  }
}

/** 椭圆范围内按抖动图案点色（只画在 yMin..yMax 之间）。 */
function ditherEllipse(p: Px, cx: number, cy: number, rx: number, ry: number, c: Color, level: number, yMin: number, yMax: number) {
  for (let y = Math.max(yMin, Math.floor(cy - ry)); y <= Math.ceil(cy + ry) && y < yMax; y++) {
    for (let x = Math.floor(cx - rx); x <= Math.ceil(cx + rx); x++) {
      const nx = (x - cx) / rx;
      const ny = (y - cy) / ry;
      if (nx * nx + ny * ny <= 1 && hit(x, y, level)) p.set(x, y, c);
    }
  }
}

function hex2(a: number): string {
  return Math.max(0, Math.min(255, Math.round(a)))
    .toString(16)
    .padStart(2, "0");
}

/** 黄昏调色后的单个颜色（与共享景物模块一致）。 */
function dusk(c: string): Rgba {
  return gradeColor(c, "dusk");
}

// ───────────────────────────── 天空、夕阳、星星 ─────────────────────────────

/** 夕阳的横坐标：场景宽度的约 45%。 */
export function sunX(w: number): number {
  return Math.max(118, Math.round(w * 0.45));
}

function drawDuskSky(w: number): Px {
  const p = new Px(w, HORIZON);
  bandedGradient(
    p,
    0,
    HORIZON,
    [P.night[1], P.night[2], P.dusk[0], P.dusk[1], P.dusk[2], P.dusk[3], P.dusk[4]],
    [3.2, 2.6, 2.4, 2, 1.6, 1.2, 0.8],
  );
  // 夕阳：横向拉长的光晕（只在海平线附近），再画日轮
  const sx = sunX(w);
  const sy = HORIZON + 3;
  ditherEllipse(p, sx, sy, 76, 34, P.dusk[3], 1, HORIZON - 34, HORIZON);
  ditherEllipse(p, sx, sy, 52, 24, P.dusk[4], 1, HORIZON - 24, HORIZON);
  ditherEllipse(p, sx, sy, 34, 18, P.dusk[4], 2, HORIZON - 18, HORIZON);
  p.ellipse(sx, sy, 24, 15, P.dusk[4]);
  p.circle(sx, sy, 17, P.gold[3]);
  p.circle(sx, sy, 15, P.lamp[2]);
  p.ellipse(sx - 4, sy - 7, 6, 4, P.white);
  // 横过夕阳的细长云带：上缘暗、下缘被照亮
  const streaks: [number, number, number][] = [
    [-58, 14, HORIZON - 27],
    [-10, 44, HORIZON - 18],
    [-66, -20, HORIZON - 10],
    [12, 62, HORIZON - 7],
  ];
  for (const [a, b, y] of streaks) {
    const x0 = sx + a;
    const x1 = sx + b;
    p.hline(x0 + 3, x1 - 3, y - 1, P.dusk[1]);
    p.hline(x0, x1, y, P.dusk[1]);
    p.hline(x0 + 1, x1 - 1, y + 1, P.dusk[2]);
    p.hline(x0 + 5, x1 - 6, y + 2, P.dusk[3]);
  }
  return p;
}

interface Star {
  x: number;
  y: number;
  bright: boolean;
  phase: number;
}

function stars(w: number): Star[] {
  const r = rng(`title-stars-${w}`);
  const out: Star[] = [];
  const n = Math.round(w / 7);
  for (let i = 0; i < n; i++) {
    const y = Math.floor(Math.pow(r.next(), 1.6) * 52);
    out.push({ x: r.int(0, w - 1), y, bright: r.chance(0.25), phase: r.int(0, 29) });
  }
  return out;
}

function drawStars(p: Px, frame: number) {
  for (const s of stars(p.w)) {
    const t = (frame + s.phase) % 30;
    if (s.bright) {
      p.set(s.x, s.y, P.white);
      if (t < 4) {
        // 闪烁：亮星短暂出现十字光芒
        p.set(s.x - 1, s.y, P.sky[3]).set(s.x + 1, s.y, P.sky[3]).set(s.x, s.y - 1, P.sky[3]).set(s.x, s.y + 1, P.sky[3]);
      }
    } else if (t > 3) {
      p.set(s.x, s.y, s.y < 30 ? P.sky[3] : P.dusk[2]);
    }
  }
}

function drawClouds(p: Px, frame: number) {
  // variant：3 卷云、2 长条层云、4 小云团、7 低矮的云堤（见 art/scenery/sky.ts）
  const clouds = [
    { v: 3, x0: 0.12, y: 12, speed: 0.03, high: true },
    { v: 11, x0: 0.7, y: 24, speed: 0.025, high: true },
    { v: 2, x0: 0.34, y: 50, speed: 0.05, high: false },
    { v: 4, x0: 0.86, y: 64, speed: 0.06, high: false },
    { v: 7, x0: 0.02, y: 84, speed: 0.07, high: false },
  ];
  for (const c of clouds) {
    const img = memo(`title-cloud-${c.v}-${c.high}`, () => {
      const raw = drawCloud(c.v, { season: 1, time: "dusk" });
      // 高处的云在暗蓝的天上只被夕阳染上一点粉紫
      return c.high ? remapToRamp(raw, [P.dusk[0], P.dusk[1], P.dusk[2]]) : raw;
    });
    const span = p.w + img.w;
    const x = Math.round((((p.w * c.x0 + frame * c.speed) % span) + span) % span) - img.w;
    p.blit(img, x, c.y);
  }
}

// ───────────────────────────── 远景：远山、远处港镇的灯火 ─────────────────────────────

function farIslands(w: number): Px {
  // 夕阳就在旁边：远山逆光，调成两阶紫色剪影（保留原图的轮廓与层次）
  return memo(`title-islands-${w}`, () =>
    remapToRamp(drawDistantLand(Math.max(40, Math.round(w * 0.3)), 16, "temperate", 1, { time: "dusk" }), [
      P.cloth.purple[0],
      P.dusk[0],
      P.dusk[0],
      P.dusk[1],
    ]),
  );
}

interface FarHouse {
  x: number;
  w: number;
  h: number;
  roof: "flat" | "gable" | "tower" | "eave";
  windows: [number, number][];
}

const TOWN_W = 84;

/** 远处港镇的剪影：一排小房子、一座塔，窗里亮着灯（按帧有几盏忽明忽暗）。 */
function farTownLayout(): FarHouse[] {
  const r = rng("title-far-town");
  const out: FarHouse[] = [];
  let x = 2;
  while (x < TOWN_W - 6) {
    const tower = out.length === 4;
    const w = tower ? 5 : r.int(6, 11);
    const h = tower ? 22 : r.int(6, 13);
    const roof = tower ? "tower" : r.pick(["flat", "gable", "gable", "eave"] as const);
    const windows: [number, number][] = [];
    for (let wy = 3; wy < h - 1; wy += 3) {
      for (let wx = 1; wx < w - 1; wx += 2) if (r.chance(0.3)) windows.push([wx, wy]);
    }
    out.push({ x, w, h, roof, windows });
    x += w + r.int(-1, 1);
  }
  return out;
}

function drawFarTown(p: Px, frame: number, x0: number) {
  const base = HORIZON + 1;
  const body = rgba(P.cloth.purple[0]);
  const rim = rgba(P.dusk[1]);
  // 港镇脚下的岸与码头
  p.rect(x0 - 6, base - 2, p.w - x0 + 6, 3, body);
  p.hline(x0 - 8, p.w, base - 3, rim);
  p.hline(x0 - 22, x0 - 6, base - 1, body);
  for (let px = x0 - 22; px < x0 - 6; px += 4) p.vline(px, base, base + 1, body);
  for (const [i, hs] of farTownLayout().entries()) {
    const hx = x0 + hs.x;
    const top = base - 2 - hs.h;
    p.rect(hx, top, hs.w, hs.h, body);
    // 屋顶：夕阳在左边，屋顶和墙的左缘被照亮
    if (hs.roof === "gable") {
      for (let k = 0; k <= Math.floor(hs.w / 2); k++) p.hline(hx + k, hx + hs.w - 1 - k, top - 1 - k, body);
      for (let k = 0; k <= Math.floor(hs.w / 2); k++) p.put(hx + k, top - 1 - k, rim);
    } else if (hs.roof === "eave") {
      p.hline(hx - 1, hx + hs.w, top - 1, body).hline(hx, hx + hs.w - 1, top - 2, body).hline(hx + 1, hx + hs.w - 2, top - 3, body);
      p.put(hx - 1, top - 1, rim).put(hx, top - 2, rim).put(hx + 1, top - 3, rim);
    } else if (hs.roof === "tower") {
      p.hline(hx - 1, hx + hs.w, top, body).vline(hx + 2, top - 5, top - 1, body).put(hx + 2, top - 6, rim);
      p.put(hx + 2, top - 3, P.lamp[1]);
    } else {
      p.hline(hx, hx + hs.w - 1, top, rim);
    }
    p.vline(hx, top, base - 3, rim);
    // 窗灯：少数几盏按帧闪烁
    for (const [j, [wx, wy]] of hs.windows.entries()) {
      const flick = hash32(`town-lamp-${i}-${j}`) % 5 === 0 && (Math.floor(frame / 7) + i + j) % 3 === 0;
      if (!flick) p.put(hx + wx, top + wy, j % 3 === 0 ? P.lamp[2] : P.lamp[1]);
    }
  }
}

/** 港镇灯火在水面上的倒影：细碎的竖向亮点，随帧摇曳。 */
function drawTownReflections(p: Px, frame: number, x0: number) {
  const f = Math.floor(frame / 3);
  for (const [i, hs] of farTownLayout().entries()) {
    if (hs.windows.length === 0) continue;
    const x = x0 + hs.x + (hs.windows[0][0] ?? 0);
    for (let k = 0; k < 4; k++) {
      const y = HORIZON + 2 + k * 2 + ((f + i) % 2);
      if ((hash32(`town-refl-${i}-${k}`) + f) % 3 !== 0) p.set(x + ((k + f) % 2), y, k < 2 ? "#ffcf5acc" : "#ffcf5a77");
    }
  }
}

/** 静态背景（天空、夕阳、远山），按宽度缓存。 */
function background(w: number): Px {
  return memo(`title-bg-${w}`, () => {
    const p = new Px(w, TITLE_H);
    p.blit(drawDuskSky(w), 0, 0);
    const isl = farIslands(w);
    p.blit(isl, Math.min(w - TOWN_W - isl.w + 30, sunX(w) + 34), HORIZON + 1 - isl.h);
    return p;
  });
}

// ───────────────────────────── 海面与倒影 ─────────────────────────────

/** 黄昏的海面（共享景物模块），平移到反光带正对夕阳。 */
function duskSea(w: number, frame: number): Px {
  const f = ((frame % SEA_FRAMES) + SEA_FRAMES) % SEA_FRAMES;
  return memo(`title-sea-${w}-${f}`, () => {
    const ws = 2 * w + 40;
    const full = drawSea(ws, TITLE_H - HORIZON, f, { time: "dusk" });
    const off = Math.max(0, Math.min(ws - w, Math.round(SEA_PATH_X * ws) - sunX(w)));
    return full.crop(off, 0, w, TITLE_H - HORIZON);
  });
}

/** 夕阳在海面上的碎金倒影：越近越宽，按帧闪动。 */
function drawSunGlitter(p: Px, frame: number) {
  const sx = sunX(p.w);
  const phase = Math.floor(frame / 2);
  p.hline(sx - 34, sx + 34, HORIZON, P.dusk[3]);
  p.hline(sx - 18, sx + 18, HORIZON, P.dusk[4]);
  p.hline(sx - 8, sx + 8, HORIZON + 1, P.lamp[2]);
  for (let y = HORIZON + 2; y < TITLE_H; y += 2) {
    const d = y - HORIZON;
    const half = 8 + d * 0.3;
    const count = 1 + Math.floor(d / 22);
    for (let k = 0; k < count; k++) {
      const hsh = hash32(`glit-${y}-${k}-${(phase + k * 3 + y) % 7}`);
      const off = ((hsh % 1000) / 1000) * 2 - 1;
      const len = 2 + ((hsh >>> 10) % Math.max(2, Math.round(8 - d / 16)));
      const x0 = Math.round(sx + off * half - len / 2);
      const near = Math.abs(off) < 0.4;
      const c = d < 16 ? (near ? P.lamp[2] : P.dusk[4]) : d < 48 ? (near ? P.dusk[4] : P.dusk[3]) : near ? P.dusk[3] : P.dusk[2];
      p.hline(x0, x0 + len - 1, y, c);
    }
  }
}

// ───────────────────────────── 船与海鸥 ─────────────────────────────

/** 归航的大船：按帧取图，按黄昏调色。 */
function heroShip(frame: number): Px {
  const f = ((frame % SHIP_FRAMES) + SHIP_FRAMES) % SHIP_FRAMES;
  return memo(`title-ship-${f}`, () => shadeForTime(drawShip(2, "square", { size: "large", frame: f, flag: P.red[2] }), "dusk"));
}

function farSail(kind: number, frame: number): Px {
  const f = ((frame % SHIP_FRAMES) + SHIP_FRAMES) % SHIP_FRAMES;
  return memo(`title-farsail-${kind}-${f}`, () => shadeForTime(drawShip(kind, kind % 2 ? "lateen" : "square", { size: "small", frame: f }), "dusk"));
}

function gullSprite(frame: number): Px {
  const f = ((frame % 4) + 4) % 4;
  return memo(`title-gull-${f}`, () => remapToRamp(drawGull(f), [ink.deep, P.cloth.purple[0], P.dusk[0]]));
}

/** 船在画面中的横坐标：从岬角后面驶出，向右边的港镇归航，循环往复；第 0 帧正好在夕阳倒影前。 */
export function shipX(w: number, shipW: number, frame: number): number {
  const span = w + shipW + 40;
  const start = Math.round(w * 0.36) - Math.round(shipW / 2);
  return Math.round(-shipW + ((((frame * 0.2 + start + shipW) % span) + span) % span));
}

function drawShipWithWake(p: Px, frame: number) {
  const ship = heroShip(Math.floor(frame / 3));
  const x = shipX(p.w, ship.w, frame);
  const water = HORIZON + 42;
  const bob = [0, 0, 1, 1][Math.floor(frame / 6) % 4];
  const y = water - ship.h + 3 + bob;
  // 倒影：翻转、压暗、逐行错位
  for (let row = 0; row < 14; row += 2) {
    const sy = ship.h - 4 - row;
    if (sy < 0) break;
    const wob = [0, 1, 0, -1][(row + Math.floor(frame / 3)) % 4];
    p.blit(ship.crop(0, sy, ship.w, 1), x + wob, water + row + 1, { tint: P.cloth.purple[0], alpha: 0.6 - row * 0.035 });
  }
  p.blit(ship, x, y);
  // 船头浪花与尾迹
  const b = ship.bounds();
  if (b) {
    const foam = dusk(P.foam);
    const bowX = x + b.x + b.w - 8;
    const k = Math.floor(frame / 2) % 3;
    p.hline(bowX - 3, bowX + 2 + k, water + 1 + bob, foam);
    p.hline(bowX, bowX + 4, water + 2 + bob, P.dusk[3]);
    for (let i = 0; i < 5; i++) {
      const wx = x + b.x + 2 - i * 7 - ((frame >> 1) % 7);
      p.hline(wx, wx + 3 - (i >> 1), water + 1 + (i & 1), i < 2 ? foam : P.dusk[2]);
    }
  }
}

function drawFarSails(p: Px, frame: number) {
  const sails = [
    { kind: 0, base: 0.62, speed: 0.03 },
    { kind: 3, base: 0.76, speed: 0.02 },
  ];
  sails.forEach((s, i) => {
    const sp = farSail(s.kind, Math.floor(frame / 4) + i);
    const span = p.w + 40;
    const x = Math.round((((p.w * s.base - frame * s.speed) % span) + span) % span) - 20;
    p.blit(sp, x, HORIZON + 2 - sp.h + (i === 0 ? 1 : 0));
  });
}

function drawGulls(p: Px, frame: number) {
  const gulls = [
    { x0: 0.24, y: 44, speed: 0.55, amp: 4, ph: 0 },
    { x0: 0.52, y: 30, speed: 0.4, amp: 3, ph: 9 },
    { x0: 0.78, y: 60, speed: 0.48, amp: 5, ph: 17 },
  ];
  for (const g of gulls) {
    const span = p.w + 30;
    const x = Math.round((((p.w * g.x0 + frame * g.speed) % span) + span) % span) - 15;
    const y = g.y + Math.round(g.amp * Math.sin((frame + g.ph) / 9));
    p.blit(gullSprite(Math.floor((frame + g.ph) / 2)), x, y);
  }
}

// ───────────────────────────── 岬角、守塔人小屋、灯塔 ─────────────────────────────

/** 岬角顶面（平台）所在的行。 */
const PLATEAU = HORIZON - 12;

/** 岬角平台 x 处的地面行（带一点起伏）。 */
function plateauY(x: number): number {
  const bump = (hash32(`plateau-${Math.floor(x / 7)}`) % 3) - 1;
  return PLATEAU + (x < 50 ? bump : Math.floor((x - 50) / 2));
}

/** 岩壁右缘：分段折线（悬崖、岩架、入水），每 4 行带一点确定性的锯齿。 */
function cliffEdge(y: number): number {
  const pts: [number, number][] = [
    [PLATEAU, 52],
    [HORIZON - 6, 58],
    [HORIZON + 1, 60],
    [HORIZON + 6, 66],
    [HORIZON + 18, 69],
    [HORIZON + 28, 75],
    [HORIZON + 48, 79],
    [TITLE_H, 86],
  ];
  let x = pts[pts.length - 1][1];
  for (let i = 0; i + 1 < pts.length; i++) {
    const [y0, x0] = pts[i];
    const [y1, x1] = pts[i + 1];
    if (y >= y0 && y <= y1) {
      x = x0 + ((x1 - x0) * (y - y0)) / Math.max(1, y1 - y0);
      break;
    }
  }
  const jag = (hash32(`cliff-${Math.floor(y / 4)}`) % 3) - 1;
  return Math.round(x + jag);
}

const REEFS: readonly (readonly [number, number, number, number])[] = [
  [86, HORIZON + 44, 6, 4],
  [79, HORIZON + 80, 8, 5],
];

/** 岩块的种子点（Voronoi 分块）与每块的色调（0 阴影、1 岩色、2 受光）：越靠右、越靠上越亮，水线以下偏暗。 */
function rockSeeds(): { x: number; y: number; tone: number }[] {
  const r = rng("title-rock-seeds");
  const out: { x: number; y: number; tone: number }[] = [];
  for (let y = PLATEAU - 6; y < TITLE_H + 10; y += 11) {
    for (let x = -8 + ((y / 11) % 2) * 7; x < 104; x += r.int(13, 19)) {
      const sx = x + r.int(-3, 3);
      const sy = y + r.int(-3, 3);
      const bias = (sx - 38) / 40 - (sy - HORIZON) / 70;
      const roll = r.next() * 0.8 + bias * 0.75;
      out.push({ x: sx, y: sy, tone: roll > 0.95 ? 2 : roll > 0.35 ? 1 : 0 });
    }
  }
  return out;
}

/** 岩块 a 与相邻岩块 b 的边界是否在 a 的右上侧（朝着夕阳）。 */
function towardSunOf(a: { x: number; y: number }, b: { x: number; y: number }): boolean {
  return b.x - a.x - (b.y - a.y) > 0;
}

/** 岬角：棱角分明的大块岩石堆成的悬崖，顶上长草；右上受光（夕阳），左侧与下部在阴影里。宽 100、从平台到场景底边。 */
function drawHeadland(): Px {
  return memo("title-headland", () => {
    const top = PLATEAU - 3;
    const w = 100;
    const h = TITLE_H - top;
    const p = new Px(w, h);
    const inside = (x: number, sy: number) => x >= 0 && sy >= plateauY(x) && x <= cliffEdge(sy);
    const deep = rgba(ink.deep);
    const [shadow, base, lit] = [rgba(P.cloth.purple[0]), rgba(P.stone[0]), rgba(P.dusk[1])];
    const tones = [rgba(P.cloth.purple[0]), rgba(P.stone[0]), rgba(P.dusk[1]), rgba(P.dusk[2])];
    const seeds = rockSeeds();
    for (let y = 0; y < h; y++) {
      const sy = y + top;
      const wet = sy > HORIZON + 30 ? 1 : 0;
      const edge = cliffEdge(sy);
      for (let x = 0; x < w; x++) {
        if (!inside(x, sy)) continue;
        // 最近与次近的种子：两者距离相近处是岩块的边界
        let d1 = Infinity;
        let d2 = Infinity;
        let a = seeds[0];
        let b = seeds[0];
        for (const sd of seeds) {
          const dx = (x - sd.x) * 0.85;
          const dy = (sy - sd.y) * 1.3;
          const d = dx * dx + dy * dy;
          if (d < d1) {
            d2 = d1;
            b = a;
            d1 = d;
            a = sd;
          } else if (d < d2) {
            d2 = d;
            b = sd;
          }
        }
        const gap = Math.sqrt(d2) - Math.sqrt(d1);
        let tone = Math.max(0, a.tone - wet);
        let c: number;
        // 色调不同的岩块之间、以及部分同色岩块之间才有暗色裂缝，其余连成大块
        const crack = a.tone !== b.tone || hash32(`crack-${a.x},${a.y}|${b.x},${b.y}`) % 3 !== 0;
        if (gap < 1.2 && crack) c = deep;
        else if (gap < 1.2) c = tones[Math.max(0, tone - (towardSunOf(a, b) ? 0 : 1))];
        else {
          // 岩块朝右上（向着夕阳）的棱边提亮一阶，朝左下的棱边压暗一阶
          const towardSun = towardSunOf(a, b);
          if (gap < 2.4) tone = towardSun ? Math.min(3, tone + 1) : Math.max(0, tone - 1);
          c = tones[tone];
        }
        // 外轮廓：受光的边缘
        if (x === edge) c = sy < HORIZON + 26 ? tones[3] : tones[2];
        p.data[y * w + x] = c;
      }
    }
    // 顶上的草（黄昏调色）
    const grass = [dusk(P.leaf[0]), dusk(P.leaf[1]), dusk(P.leaf[2])];
    for (let x = 0; x < w; x++) {
      const sy = plateauY(x);
      const gy = sy - top;
      if (gy < 0 || gy >= h || !inside(x, sy)) continue;
      const tuft = hash32(`grass-${x}`) % 5;
      p.data[gy * w + x] = grass[1];
      if (gy + 1 < h) p.data[(gy + 1) * w + x] = grass[0];
      if (tuft === 0 && gy > 0) p.data[(gy - 1) * w + x] = grass[2];
      if (tuft === 1 && gy > 1) {
        p.data[(gy - 1) * w + x] = grass[1];
        p.data[(gy - 2) * w + x] = grass[2];
      }
    }
    // 岩脚入水处的礁石（上半露出水面）：大部分在阴影里，只有右上缘受光
    for (const [cx, cy, rx, ry] of REEFS) {
      for (let y = cy - ry; y <= cy; y++) {
        for (let x = cx - rx; x <= cx + rx; x++) {
          const nx = (x - cx) / (rx + 0.5);
          const ny = (y - cy) / (ry + 0.5);
          const d = nx * nx + ny * ny;
          if (d > 1 || x < 0 || x >= w) continue;
          const light = nx * 0.8 - ny * 0.6;
          const c = d > 0.72 && light > 0.45 ? lit : light > 0.35 ? base : shadow;
          p.data[(y - top) * w + x] = c;
        }
      }
    }
    return p;
  });
}

/** 灯塔精灵（28×76）；灯室中心在精灵内 (14, 12)。 */
export const LIGHTHOUSE_W = 28;
export const LIGHTHOUSE_H = 76;
const LANTERN = { x: 14, y: 12 } as const;

export function drawLighthouse(): Px {
  return memo("title-lighthouse", () => {
    const p = new Px(LIGHTHOUSE_W, LIGHTHOUSE_H);
    const top = 22;
    const bottom = 67;
    // 塔身：上窄下宽，红白相间；左侧背光，右侧被夕阳照亮
    for (let y = top; y <= bottom; y++) {
      const t = (y - top) / (bottom - top);
      const hw = 5.5 + t * 3.5;
      const l = Math.round(14 - hw);
      const r = Math.round(14 + hw) - 1;
      const red = Math.floor((y - top) / 9) % 2 === 1;
      const ramp = red ? [P.red[0], P.red[1], P.red[2], P.dusk[3]] : [P.plaster[0], P.plaster[1], P.plaster[2], P.dusk[4]];
      const width = r - l + 1;
      for (let x = l; x <= r; x++) {
        const u = (x - l) / Math.max(1, width - 1);
        let c: string;
        if (x === l || x === r) c = ink.brown;
        else if (u < 0.2) c = ramp[0];
        else if (u < 0.45) c = ramp[1];
        else if (u < 0.78) c = ramp[2];
        else c = ramp[3];
        // 两段颜色之间的阴影过渡用抖动
        if (u >= 0.18 && u < 0.24 && hit(x, y, 2)) c = ramp[1];
        p.put(x, y, c);
      }
    }
    // 小窗：一扇亮着灯
    p.rect(13, 34, 2, 4, ink.brown).rect(13, 35, 2, 2, P.lamp[1]);
    p.rect(13, 52, 2, 4, ink.brown).rect(13, 53, 2, 2, P.iron[1]);
    // 石砌塔基
    for (let y = 68; y < LIGHTHOUSE_H; y++) {
      for (let x = 3; x <= 24; x++) {
        const edge = x === 3 || x === 24 || y === 68;
        const u = (x - 3) / 21;
        const brick = (y - 68) % 3 === 2 || (x + (Math.floor((y - 68) / 3) % 2) * 3) % 6 === 0;
        let c: string = u < 0.3 ? P.stone[0] : u < 0.8 ? P.stone[1] : P.stone[2];
        if (brick) c = u < 0.3 ? ink.blue : P.stone[0];
        if (edge) c = ink.blue;
        p.put(x, y, c);
      }
    }
    // 拱门
    p.rect(12, 70, 4, 6, P.wood[0]).hline(13, 14, 69, P.wood[0]).rect(13, 71, 2, 5, P.wood[1]);
    p.set(14, 73, P.gold[2]);
    // 回廊：平台与栏杆
    p.hline(4, 23, 21, ink.brown).hline(5, 22, 20, P.iron[2]).hline(5, 22, 19, P.iron[1]);
    p.hline(5, 22, 15, P.iron[2]);
    for (let x = 5; x <= 22; x += 2) p.vline(x, 16, 18, P.iron[1]);
    p.hline(4, 23, 15, ink.brown).set(4, 16, ink.brown).set(23, 16, ink.brown);
    // 灯室：发光的玻璃与窗棂
    p.rect(9, 8, 10, 7, ink.brown);
    p.rect(10, 9, 8, 6, P.lamp[2]);
    p.rect(12, 10, 4, 4, P.white);
    p.vline(11, 9, 14, P.iron[1]).vline(16, 9, 14, P.iron[1]);
    // 圆顶与尖顶
    p.hline(8, 19, 7, ink.brown);
    p.hline(9, 18, 6, P.red[1]).hline(14, 17, 6, P.red[2]);
    p.hline(10, 17, 5, P.red[1]).hline(14, 16, 5, P.red[2]);
    p.hline(11, 16, 4, P.red[1]).set(15, 4, P.red[3]);
    p.hline(12, 15, 3, P.red[0]);
    p.vline(13, 0, 2, P.iron[2]).set(14, 1, P.gold[3]).set(13, 0, P.gold[2]);
    return p;
  });
}

/** 守塔人的小屋（22×18），窗里亮着灯；烟囱在 (16, 1)。 */
function drawCottage(): Px {
  return memo("title-cottage", () => {
    const p = new Px(22, 18);
    // 墙：左侧背光
    p.rect(2, 8, 18, 10, P.plaster[1]).rect(12, 8, 8, 10, P.plaster[2]).rect(2, 8, 4, 10, P.plaster[0]);
    p.vline(1, 8, 17, ink.brown).vline(20, 8, 17, ink.brown);
    // 屋顶（两坡，右坡受光）
    for (let i = 0; i < 8; i++) {
      p.hline(i, 21 - i, 8 - i, i === 7 ? ink.brown : P.red[1]);
      p.hline(11, 20 - i, 8 - i, i === 7 ? ink.brown : P.red[2]);
      p.set(i, 8 - i, ink.brown).set(21 - i, 8 - i, ink.brown);
    }
    p.hline(0, 21, 8, P.red[0]);
    // 烟囱
    p.rect(15, 1, 3, 5, P.stone[1]).vline(17, 1, 5, P.stone[2]).hline(14, 18, 0, ink.blue);
    // 亮窗与门
    p.rect(5, 11, 4, 4, ink.brown).rect(6, 12, 2, 2, P.lamp[1]);
    p.rect(13, 11, 4, 7, ink.brown).rect(14, 12, 2, 6, P.wood[1]);
    return shadeForTime(p, "dusk");
  });
}
const COTTAGE_X = 1;
const LIGHTHOUSE_X = 24;

function cottageTop(): number {
  return plateauY(COTTAGE_X + 11) - 18 + 1;
}

/** 灯室中心在场景中的坐标。 */
export function lanternAt(): { x: number; y: number } {
  const base = plateauY(LIGHTHOUSE_X + 14) + 1;
  return { x: LIGHTHOUSE_X + LANTERN.x, y: base - LIGHTHOUSE_H + LANTERN.y };
}

function drawBeam(p: Px, frame: number) {
  const { x: lx, y: ly } = lanternAt();
  const theta = (2 * Math.PI * (frame % BEAM_PERIOD)) / BEAM_PERIOD;
  const c = Math.cos(theta);
  const s = Math.sin(theta);
  const len = Math.round(200 * Math.abs(c));
  if (len > 8) {
    // 光束：由近到远分段变淡、变宽，远端自然消失
    const dir = c > 0 ? 1 : -1;
    const segs = 7;
    for (let i = 0; i < segs; i++) {
      const a0 = i / segs;
      const a1 = (i + 1) / segs;
      const x0 = lx + dir * (2 + len * a0);
      const x1 = lx + dir * (2 + len * a1);
      const h0 = 1.5 + len * 0.085 * a0;
      const h1 = 1.5 + len * 0.085 * a1;
      const fade = Math.pow(1 - a0, 1.4);
      const quad = (k: number, alpha: number) =>
        p.poly(
          [
            [x0, ly - h0 * k],
            [x1, ly - h1 * k],
            [x1, ly + h1 * k],
            [x0, ly + h0 * k],
          ],
          `#ffe39a${hex2(alpha)}`,
        );
      quad(1, 0x22 * fade);
      quad(0.45, 0x2a * fade);
    }
  }
  // 光束正对观众时灯室最亮
  if (s > 0.8) {
    p.circle(lx, ly, 8, "#fff2b024");
    p.circle(lx, ly, 5, "#fff2b040");
    p.hline(lx - 10, lx + 10, ly, "#fff2b066");
    p.vline(lx, ly - 7, ly + 7, "#fff2b055");
  } else {
    p.circle(lx, ly, 4, "#fff2b022");
  }
}

/** 岩壁与礁石边拍岸的浪花。 */
function drawCliffFoam(p: Px, frame: number) {
  const f = Math.floor(frame / 3);
  const foam = dusk(P.foam);
  for (let y = HORIZON + 2; y < TITLE_H; y += 3) {
    const e = cliffEdge(y);
    const n = (hash32(`foam-${y}`) + f) % 4;
    if (n === 3) continue;
    p.hline(e + 1, e + 1 + n, y, n === 0 ? foam : P.dusk[3]);
  }
  for (const [cx, cy, rx] of REEFS) {
    const k = (f + cx) % 3;
    p.hline(cx - rx - 1 - k, cx + rx + 1 + k, cy + 1, foam);
    p.hline(cx - rx + 1, cx + rx - 1, cy + 2, P.dusk[3]);
  }
}

function drawSmoke(p: Px, frame: number) {
  const top = cottageTop();
  for (let k = 0; k < 4; k++) {
    const age = (frame + k * 9) % 36;
    const x = COTTAGE_X + 16 + Math.round(age / 5) + (k % 2);
    const y = top - Math.round(age / 2.4);
    const size = age < 12 ? 1 : 2;
    p.rect(x, y, size, size, age < 20 ? "#7a3f6ecc" : "#7a3f6e77");
  }
}

// ───────────────────────────── 合成 ─────────────────────────────

/** 标题场景的一帧（宽 w，高 TITLE_H）。同一 (w, frame) 永远得到同一幅画。 */
export function drawTitleScene(w: number, frame: number): Px {
  const width = Math.max(TITLE_MIN_W, Math.floor(w));
  const p = background(width).clone();
  const townX = width - TOWN_W;
  drawStars(p, frame);
  drawClouds(p, frame);
  drawGulls(p, frame);
  drawFarTown(p, frame, townX);
  p.blit(duskSea(width, Math.floor(frame / 2)), 0, HORIZON);
  drawTownReflections(p, frame, townX);
  drawSunGlitter(p, frame);
  drawFarSails(p, frame);
  drawShipWithWake(p, frame);
  drawCliffFoam(p, frame);
  p.blit(drawHeadland(), 0, PLATEAU - 3);
  p.blit(drawCottage(), COTTAGE_X, cottageTop());
  drawSmoke(p, frame);
  const lh = drawLighthouse();
  p.blit(lh, LIGHTHOUSE_X, plateauY(LIGHTHOUSE_X + 14) + 1 - lh.h);
  drawBeam(p, frame);
  return p;
}

// ───────────────────────────── 界面装饰 ─────────────────────────────

/** 窗框（24×24，九宫格切片 8）：深色木框 + 黄铜包角与铆钉。用作 CSS border-image。 */
export function drawWindowFrame(): Px {
  return memo("title-frame", () => {
    const n = 24;
    const p = new Px(n, n);
    const ring = (i: number, light: string, dark: string) => {
      p.hline(i, n - 1 - i, i, light).vline(i, i, n - 1 - i, light);
      p.hline(i, n - 1 - i, n - 1 - i, dark).vline(n - 1 - i, i, n - 1 - i, dark);
    };
    ring(0, ink.brown, ink.brown);
    ring(1, P.wood[3], P.wood[1]);
    ring(2, P.wood[2], P.wood[1]);
    ring(3, P.wood[2], P.wood[1]);
    ring(4, P.wood[2], P.wood[0]);
    ring(5, P.wood[1], P.wood[0]);
    ring(6, ink.brown, ink.brown);
    ring(7, P.parchmentDeep, P.parchmentDark);
    p.rect(8, 8, 8, 8, P.parchment);
    // 四角的黄铜包角
    const corner = (cx: number, cy: number) => {
      p.rect(cx - 3, cy - 3, 7, 7, ink.brown);
      p.rect(cx - 2, cy - 2, 5, 5, P.gold[2]);
      p.hline(cx - 2, cx + 1, cy - 2, P.gold[3]).vline(cx - 2, cy - 2, cy + 1, P.gold[3]);
      p.hline(cx - 1, cx + 2, cy + 2, P.gold[1]).vline(cx + 2, cy - 1, cy + 2, P.gold[1]);
      p.set(cx, cy, P.gold[4]).set(cx + 1, cy + 1, P.gold[1]);
    };
    corner(3, 3);
    corner(n - 4, 3);
    corner(3, n - 4);
    corner(n - 4, n - 4);
    return p;
  });
}

/** 羊皮纸底纹（48×48，可平铺）：稀疏的浅色长纹与深色短纤维，低对比、不成噪点。 */
export function drawParchmentTile(): Px {
  return memo("title-parchment", () => {
    const n = 48;
    const p = new Px(n, n).fill(P.parchment);
    const r = rng("parchment");
    for (let i = 0; i < 10; i++) {
      const x = r.int(0, n - 1);
      const y = r.int(0, n - 1);
      const len = r.int(4, 8);
      for (let k = 0; k < len; k++) p.put((x + k) % n, y, P.paper);
      if (r.chance(0.5)) for (let k = 1; k < len - 1; k++) p.put((x + k) % n, (y + 1) % n, P.paper);
    }
    for (let i = 0; i < 8; i++) {
      const x = r.int(0, n - 1);
      const y = r.int(0, n - 1);
      const len = r.int(2, 3);
      for (let k = 0; k < len; k++) p.put((x + k) % n, y, P.parchmentDark);
    }
    return p;
  });
}

/** 罗盘徽记（33×33 加描边）：标题的装饰。 */
export function drawCompassRose(): Px {
  return memo("title-compass", () => {
    const p = new Px(33, 33);
    const c = 16;
    p.ring(c, c, 14, 14, ink.brown).ring(c, c, 13, 13, P.gold[2]).ring(c, c, 12, 12, P.gold[1]);
    for (let a = 0; a < 16; a++) {
      const t = (a / 16) * Math.PI * 2;
      p.set(Math.round(c + Math.cos(t) * 13), Math.round(c + Math.sin(t) * 13), a % 4 === 0 ? P.gold[4] : P.gold[3]);
    }
    // 斜向的短尖：一对三角形
    const diag: [number, number][] = [
      [1, 1],
      [1, -1],
      [-1, 1],
      [-1, -1],
    ];
    for (const [dx, dy] of diag) {
      const o = c + 0.5;
      const tip: [number, number] = [o + dx * 9, o + dy * 9];
      p.poly([[o, o], tip, [o + dx * 2 - dy * 2, o + dy * 2 + dx * 2]], P.gold[3]);
      p.poly([[o, o], tip, [o + dx * 2 + dy * 2, o + dy * 2 - dx * 2]], P.gold[1]);
    }
    // 四个正方向的长尖：一半亮一半暗，北向用朱红
    const arm = (dx: number, dy: number, lightC: string, darkC: string) => {
      const o = c + 0.5;
      const tip: [number, number] = [o + dx * 16, o + dy * 16];
      p.poly([[o, o], tip, [o - dy * 3.5, o + dx * 3.5]], lightC);
      p.poly([[o, o], tip, [o + dy * 3.5, o - dx * 3.5]], darkC);
    };
    arm(0, -1, P.red[3], P.red[1]);
    arm(1, 0, P.plaster[3], P.plaster[1]);
    arm(0, 1, P.plaster[3], P.plaster[1]);
    arm(-1, 0, P.plaster[3], P.plaster[1]);
    p.circle(c, c, 2, P.gold[2]).set(c, c, P.gold[4]);
    return p.outlined(ink.brown);
  });
}

/** 菜单指针（9×9 加描边）：指向右边的黄铜箭头。 */
export function drawMenuCursor(): Px {
  return memo("title-cursor", () =>
    new Px(9, 9)
      .poly(
        [
          [0, 0],
          [9, 4.5],
          [0, 9],
          [2.5, 4.5],
        ],
        P.gold[2],
      )
      .poly(
        [
          [0, 0],
          [9, 4.5],
          [2.5, 4.5],
        ],
        P.gold[3],
      )
      .outlined(ink.brown),
  );
}

/** 翻页箭头（5×7 加描边）：◀ ▶ 按钮上的像素图标。 */
export function drawArrowIcon(dir: "left" | "right"): Px {
  return memo(`title-arrow-${dir}`, () => {
    const p = new Px(5, 7)
      .poly(
        [
          [0, 0],
          [5, 3.5],
          [0, 7],
        ],
        P.gold[3],
      )
      .hline(0, 1, 5, P.gold[2])
      .hline(0, 3, 4, P.gold[2])
      .outlined(ink.brown);
    return dir === "left" ? p.flipX() : p;
  });
}

/** 没有主角的旧存档用的徽记（64×64，与主角头像同尺寸）：书桌上的航海日志与羽毛笔。 */
export function drawSaveEmblem(): Px {
  return memo("title-save-emblem", () => {
    const p = new Px(64, 64).fill(P.cloth.navy[1]);
    p.rect(0, 46, 64, 18, P.wood[1]).hline(0, 63, 46, P.wood[2]).hline(0, 63, 47, P.wood[0]);
    // 日志本：封面、书页、书签
    p.rect(11, 16, 40, 37, ink.brown);
    p.rect(12, 17, 38, 35, P.wood[1]).hline(12, 49, 17, P.wood[2]).vline(12, 17, 51, P.wood[2]);
    p.rect(17, 21, 29, 27, P.parchment).hline(17, 45, 21, P.paper).vline(31, 21, 47, P.parchmentDark);
    for (let y = 26; y < 46; y += 4) {
      p.hline(20, 28, y, P.parchmentDark);
      p.hline(34, 42, y, P.parchmentDark);
    }
    p.rect(39, 13, 4, 12, P.red[2]).set(40, 25, P.red[1]).vline(42, 13, 24, P.red[1]);
    // 羽毛笔
    p.line(48, 13, 35, 43, P.white).line(49, 13, 36, 43, P.plaster[2]).line(50, 14, 38, 40, P.plaster[1]);
    p.line(35, 43, 33, 46, ink.brown);
    return p;
  });
}
/** 剧本卡片上的小景（148×100）：起始港的远景、海面与开局的座船。 */
export function drawScenarioVignette(opts: {
  /** 起始港的城镇风格（第九批的文化风格画各自的远景） */
  style: TownStyle;
  /** key：船型 key（按 key 画，寰宇·十六世纪的新船型各有画法）；缺省按 type 取经典世界的 key */
  ship?: { type: number; sail: "square" | "lateen"; key?: string };
  flag?: string;
  variant: number;
}): Px {
  const { style, ship, flag, variant } = opts;
  const shipKey = ship ? (ship.key ?? shipArtKey(null, ship.type)) : "none";
  return memo(`title-vignette-${style}-${shipKey}-${ship?.sail ?? ""}-${flag ?? ""}-${variant}`, () => {
    const w = 148;
    const h = 100;
    const sea = 74;
    const p = new Px(w, h);
    const skies = [
      [P.sky[1], P.sky[2], P.sky[3], P.sky[4]],
      [P.dusk[0], P.dusk[1], P.dusk[2], P.dusk[3]],
      [P.sky[0], P.sky[1], P.sky[2], P.sky[3]],
    ];
    const skyRamp = skies[variant % skies.length];
    bandedGradient(p, 0, sea, skyRamp, [1.2, 1, 1, 0.8], 4);
    // 起始港的远景：两阶的朦胧剪影
    const town = remapToRamp(drawSkyline(style, 96, { season: 0 }), [skyRamp[1], skyRamp[2]]);
    p.blit(town, 2, sea - town.h + 1);
    const time = variant % skies.length === 1 ? "dusk" : "day";
    p.blit(drawSea(w, h - sea, variant % SEA_FRAMES, { time }), 0, sea);
    if (ship) {
      let img = drawShipByKey(shipKey, ship.sail, { size: "large", flag, frame: variant % SHIP_FRAMES });
      if (time === "dusk") img = shadeForTime(img, "dusk");
      const b = img.bounds() ?? { x: 0, y: 0, w: img.w, h: img.h };
      const sx = Math.round(w - b.w - 8 - b.x);
      const water = sea + 10;
      p.blit(img, sx, water - b.y - b.h + 2);
      // 船首与船尾的浪花
      const foam = time === "dusk" ? dusk(P.foam) : rgba(P.foam);
      p.hline(sx + b.x + b.w - 10, sx + b.x + b.w - 2, water + 1, foam);
      p.hline(sx + b.x + 2, sx + b.x + 8, water + 1, foam);
      p.hline(sx + b.x - 6, sx + b.x - 2, water + 2, foam);
    }
    return p;
  });
}
