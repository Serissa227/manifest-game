// 远景：按气候画 2–3 层（远山 / 丘陵 / 近处的林带、沙丘、海岛），越远越淡、越接近天空色。
// 轮廓由按横坐标取值的噪声生成：窗口变宽时原有部分不变，只向右延伸。
import { P } from "../palette";
import { Px, rgba, type Color, type Rgba } from "../px";
import { shadeForTime } from "./grade";
import type { Climate, TimeOfDay, Weather } from "./types";
import { ditherHit, h2, mix, seasonOf, vnoise } from "./util";

interface Shade {
  lit: Rgba;
  mid: Rgba;
  dark: Rgba;
}

function shade(lit: Color, mid: Color, dark: Color): Shade {
  return { lit: rgba(lit), mid: rgba(mid), dark: rgba(dark) };
}

/** 整组颜色向雾色靠拢 k（越远越大）。 */
function fade(s: Shade, hz: Rgba, k: number): Shade {
  return { lit: mix(s.lit, hz, k), mid: mix(s.mid, hz, k), dark: mix(s.dark, hz, k) };
}

function hazeOf(climate: Climate, season: number): Rgba {
  let hz = rgba(P.sky[3]);
  if (climate === "arid") hz = mix(hz, P.sand[4], 0.4);
  if (climate === "tropical") hz = mix(hz, P.teal[4], 0.3);
  if (season === 3) hz = mix(hz, P.stone[3], 0.45);
  return hz;
}

/** 在一列上从 top 画到底；color(y) 返回 0 表示不画。 */
function column(p: Px, x: number, top: number, color: (y: number) => Rgba): void {
  for (let y = Math.max(0, Math.ceil(top)); y < p.h; y++) {
    const c = color(y);
    if (c) p.data[y * p.w + x] = c;
  }
}

/** 底部雾带：最下面 mistH 行逐渐抖动成雾色。 */
function mist(p: Px, hz: Rgba, mistH: number, k = 0.35): void {
  for (let y = Math.max(0, p.h - mistH); y < p.h; y++) {
    const f = (y - (p.h - mistH)) / mistH;
    for (let x = 0; x < p.w; x++) {
      const i = y * p.w + x;
      if (p.data[i] & 0xff && ditherHit(x, y, f)) p.data[i] = mix(p.data[i], hz, k);
    }
  }
}

// ---------------------------------------------------------------- 山

interface Peak {
  x: number;
  y: number;
  /** 左、右坡的斜率（每横移一像素下降多少） */
  sl: number;
  sr: number;
  /** 山脊线向右下偏斜的程度 */
  ridge: number;
}

/** 按格子生成山峰（格子坐标固定，保证宽度变化时山形不变）。 */
function peaks(seed: number, w: number, spacing: number, yMin: number, yMax: number, sMin: number, sMax: number): Peak[] {
  const out: Peak[] = [];
  for (let g = -2; g * spacing < w + spacing * 2; g++) {
    const x = g * spacing + h2(seed, g) * spacing * 0.8;
    const y = yMin + h2(seed + 1, g) * (yMax - yMin);
    out.push({
      x,
      y,
      sl: sMin + h2(seed + 2, g) * (sMax - sMin),
      sr: sMin + h2(seed + 3, g) * (sMax - sMin),
      ridge: 0.15 + h2(seed + 4, g) * 0.35,
    });
  }
  return out;
}

interface MountainPaint {
  rock: Shade;
  snow?: Shade;
  /** 雪线：峰顶以下多少像素是雪（随峰高度变化） */
  snowDepth?: (pk: Peak) => number;
}

function mountains(p: Px, seed: number, pks: readonly Peak[], paint: MountainPaint): void {
  for (let x = 0; x < p.w; x++) {
    let best = Infinity;
    let owner = pks[0];
    for (const pk of pks) {
      const d = x < pk.x ? (pk.x - x) * pk.sl : (x - pk.x) * pk.sr;
      const s = pk.y + d;
      if (s < best) {
        best = s;
        owner = pk;
      }
    }
    // 边缘的锯齿：小幅噪声
    const top = best + (vnoise(seed + 9, x, 3) - 0.5) * 2.2;
    const sd = paint.snowDepth ? paint.snowDepth(owner) : 0;
    column(p, x, top, (y) => {
      const ridgeX = owner.x + (y - owner.y) * owner.ridge + (vnoise(seed + 11, y, 4) - 0.5) * 4;
      const lit = x < ridgeX;
      // 受光面上几道斜向沟壑（比受光色暗一阶）
      const gully = lit && Math.abs(((x - ridgeX + (y - owner.y) * 0.9) % 9) + 9) % 9 < 1 && y - owner.y > 3;
      const line = sd > 0 ? owner.y + sd * (0.55 + 0.9 * vnoise(seed + 13, x, 5)) : -Infinity;
      if (paint.snow && y < line) {
        const edge = y > line - 2 && ditherHit(x, y, 0.5);
        if (edge) return lit ? paint.rock.lit : paint.rock.dark;
        return lit ? paint.snow.lit : paint.snow.dark;
      }
      if (gully) return paint.rock.mid;
      // 受光与背光交界处抖动一列
      if (Math.abs(x - ridgeX) < 1 && ditherHit(x, y, 0.5)) return paint.rock.mid;
      return lit ? paint.rock.lit : paint.rock.dark;
    });
  }
}

// ---------------------------------------------------------------- 丘陵（平滑轮廓，按坡向着色）

function hills(p: Px, surf: (x: number) => number, s: Shade, rim = true): void {
  for (let x = 0; x < p.w; x++) {
    const top = surf(x);
    const slope = surf(x + 2) - surf(x - 2);
    column(p, x, top, (y) => {
      const depth = y - Math.ceil(top);
      if (rim && depth === 0 && slope < 0.8) return s.lit;
      // 0 = 朝左（亮）… 1 = 朝右（暗）；越往下坡向的影响越弱，避免整列的竖条纹
      const fall = Math.max(0.25, 1 - depth / 9);
      const frac = ((slope + 1.2) / 2.4 - 0.5) * fall + 0.5;
      if (frac < 0.35) return s.lit;
      if (frac > 0.75) return ditherHit(x, y, (frac - 0.75) * 4) ? s.dark : s.mid;
      return ditherHit(x, y, (0.55 - frac) * 3) ? s.lit : s.mid;
    });
  }
}

/** 一团圆形树冠 / 灌木：左上亮、右下暗。 */
function canopy(p: Px, cx: number, cy: number, r: number, s: Shade): void {
  for (let y = Math.floor(cy - r); y <= cy + r; y++) {
    for (let x = Math.floor(cx - r); x <= cx + r; x++) {
      if (!p.inBounds(x, y)) continue;
      const dx = x + 0.5 - cx;
      const dy = y + 0.5 - cy;
      if (dx * dx + dy * dy > (r + 0.3) * (r + 0.3)) continue;
      const l = dx * 0.7 + dy * 0.7;
      p.data[y * p.w + x] = l < -r * 0.25 ? s.lit : l > r * 0.35 ? s.dark : s.mid;
    }
  }
}

/** 远处冬天的落叶树：枝梢是一团抖动的细枝，顶上一点积雪，下面一根短干。 */
function twigs(p: Px, cx: number, cy: number, r: number, c: Rgba, snow: Rgba): void {
  for (let y = Math.floor(cy - r); y <= cy + r; y++) {
    for (let x = Math.floor(cx - r); x <= cx + r; x++) {
      if (!p.inBounds(x, y)) continue;
      const dx = x + 0.5 - cx;
      const dy = y + 0.5 - cy;
      if (dx * dx + dy * dy > r * r) continue;
      if (dy < -r * 0.45 && dx < r * 0.3) p.data[y * p.w + x] = snow;
      else if (ditherHit(x, y, 0.5)) p.data[y * p.w + x] = c;
    }
  }
  for (let y = Math.round(cy); y <= cy + r + 2; y++) if (p.inBounds(Math.round(cx), y)) p.data[y * p.w + Math.round(cx)] = c;
}

/** 一棵冷杉的剪影：分层的三角形，左亮右暗；snow 为真时每层上缘积雪。 */
function fir(p: Px, cx: number, baseY: number, hh: number, hw: number, s: Shade, snow: Rgba | 0): void {
  const apex = baseY - hh;
  for (let y = Math.floor(apex); y <= baseY; y++) {
    const t = (y - apex) / hh;
    const tier = (y - Math.floor(apex)) % 3;
    const half = Math.max(0, hw * t + (tier === 2 ? 0.8 : tier === 1 ? 0.3 : -0.3));
    for (let x = Math.floor(cx - half); x <= Math.ceil(cx + half); x++) {
      if (!p.inBounds(x, y) || Math.abs(x + 0.5 - cx) > half + 0.5) continue;
      let c = x + 0.5 < cx ? s.lit : s.dark;
      if (Math.abs(x + 0.5 - cx) < 0.7) c = s.mid;
      if (snow && tier === 0 && x + 0.5 < cx + half * 0.4) c = snow;
      p.data[y * p.w + x] = c;
    }
  }
}

// ---------------------------------------------------------------- 各气候

function temperate(p: Px, season: number, hz: Rgba): void {
  const { w, h } = p;
  // 远山（冬季满头积雪，春季残雪）
  const snowK = season === 3 ? 0.9 : season === 0 ? 0.35 : season === 2 ? 0.15 : 0;
  mountains(p, 101, peaks(101, w, 64, h * 0.08, h * 0.42, 0.55, 0.95), {
    rock: fade(shade(P.slate[3], mix(P.slate[3], P.slate[2], 0.5), P.slate[2]), hz, 0.55),
    snow: fade(shade(P.snow[3], P.snow[2], P.snow[1]), hz, 0.3),
    snowDepth: snowK ? (pk) => (h * 0.5 - pk.y) * snowK * 0.5 : undefined,
  });
  mist(p, hz, Math.round(h * 0.35), 0.3);
  // 中景丘陵
  const hillCol: Shade = [
    shade(P.leaf[4], P.leaf[3], mix(P.leaf[3], P.leaf[2], 0.6)),
    shade(P.leaf[3], mix(P.leaf[3], P.leaf[2], 0.5), P.leaf[2]),
    shade(mix(P.autumn[3], P.leaf[3], 0.35), mix(P.autumn[2], P.leaf[2], 0.45), mix(P.autumn[1], P.leaf[2], 0.5)),
    shade(P.snow[3], P.snow[2], P.snow[1]),
  ][season];
  const hillSurf = (x: number) => h * 0.5 + (vnoise(211, x, 46) - 0.5) * h * 0.34 + (vnoise(212, x, 15) - 0.5) * h * 0.08;
  hills(p, hillSurf, fade(hillCol, hz, 0.34));
  // 田块：中景丘陵上零星的条纹田
  const fieldCol = [P.leaf[4], P.straw[3], P.gold[3], P.snow[2]][season];
  const fieldDark = [P.leaf[3], P.straw[2], P.autumn[2], P.snow[1]][season];
  for (let x = 0; x < w; x++) {
    const cell = Math.floor(x / 23);
    if (h2(221, cell) > 0.4) continue;
    const top = Math.ceil(hillSurf(x)) + 3;
    const fx = x - cell * 23;
    if (fx < 3 || fx > 19) continue;
    for (let y = top; y < Math.min(h, top + 7); y++) {
      p.data[y * w + x] = mix((y - top) % 2 === 0 ? fieldCol : fieldDark, hz, 0.34);
    }
  }
  // 近处：两三排树冠组成的林带（冬季是光秃的枝梢与积雪）
  const nearCol: Shade = [
    shade(P.leaf[3], P.leaf[2], P.leaf[1]),
    shade(P.leaf[2], mix(P.leaf[2], P.leaf[1], 0.5), P.leaf[1]),
    shade(P.autumn[2], P.autumn[1], mix(P.autumn[1], P.leaf[0], 0.4)),
    shade(P.snow[3], P.snow[2], P.snow[1]),
  ][season];
  const nearSurf = (x: number) => h * 0.8 + (vnoise(231, x, 34) - 0.5) * h * 0.1;
  const nearF = fade(nearCol, hz, 0.14);
  hills(p, nearSurf, season === 3 ? nearF : fade(shade(P.leaf[1], P.leaf[1], P.leaf[0]), hz, 0.14), false);
  const twig = mix(mix(P.wood[1], P.stone[2], 0.45), hz, 0.2);
  for (let row = 0; row < 3; row++) {
    const step = 5;
    for (let i = -1; i * step < w + 10; i++) {
      const cx = i * step + h2(232 + row * 7, i) * 3 + row * 2.5;
      const r = 1.8 + h2(233 + row * 7, i) * 1.8 + row * 0.5;
      const cy = nearSurf(cx) - (2 - row) * 2.2 - r * 0.2;
      if (season === 3) {
        twigs(p, cx, cy, r, twig, mix(P.snow[3], hz, 0.08));
        continue;
      }
      let s = fade(nearCol, hz, 0.2 - row * 0.05);
      const k = h2(234 + row * 7, i);
      if (season === 0 && k < 0.22) s = fade(shade(P.blossom[3], P.blossom[2], P.blossom[1]), hz, 0.14);
      if (season === 2 && k < 0.3) s = fade(shade(P.autumn[3], P.gold[2], P.autumn[1]), hz, 0.14);
      if (season === 2 && k > 0.82) s = fade(shade(P.leaf[2], P.leaf[1], P.leaf[0]), hz, 0.14);
      canopy(p, cx, cy, r, s);
    }
  }
}

function cold(p: Px, season: number, hz: Rgba): void {
  const { w, h } = p;
  const winter = season === 3;
  mountains(p, 301, peaks(301, w, 46, h * 0.02, h * 0.3, 0.9, 1.6), {
    rock: fade(shade(P.slate[3], P.slate[2], mix(P.slate[2], P.slate[1], 0.5)), hz, 0.48),
    snow: fade(shade(P.snow[3], P.snow[2], P.snow[1]), hz, 0.25),
    snowDepth: (pk) => (h * 0.62 - pk.y) * (winter ? 0.95 : season === 1 ? 0.35 : 0.55),
  });
  mist(p, hz, Math.round(h * 0.3), 0.3);
  mountains(p, 311, peaks(311, w, 58, h * 0.36, h * 0.56, 0.7, 1.1), {
    rock: fade(shade(P.slate[2], mix(P.slate[2], P.slate[1], 0.5), P.slate[1]), hz, 0.28),
    snow: fade(shade(P.snow[3], P.snow[2], P.snow[1]), hz, 0.18),
    snowDepth: (pk) => (h * 0.8 - pk.y) * (winter ? 0.9 : season === 1 ? 0.12 : 0.3),
  });
  mist(p, hz, Math.round(h * 0.22), 0.25);
  // 近处的针叶林带
  const ground = (x: number) => h * 0.84 + (vnoise(321, x, 30) - 0.5) * h * 0.08;
  const groundCol = winter ? shade(P.snow[3], P.snow[2], P.snow[1]) : shade(mix(P.leaf[1], P.slate[2], 0.4), mix(P.leaf[1], P.slate[1], 0.5), P.leaf[0]);
  hills(p, ground, fade(groundCol, hz, 0.12), false);
  const firCol = fade(shade(mix(P.leaf[2], P.slate[2], 0.35), mix(P.leaf[1], P.slate[1], 0.35), mix(P.leaf[0], P.slate[0], 0.3)), hz, 0.12);
  const snowC = winter ? mix(P.snow[3], hz, 0.08) : season === 0 ? 0 : 0;
  for (let i = -1; i * 4 < w + 8; i++) {
    const cx = i * 4 + h2(322, i) * 3;
    const hh = h * 0.12 + h2(323, i) * h * 0.14;
    fir(p, cx, ground(cx) + 2, hh, hh * 0.32, firCol, snowC);
  }
}

function arid(p: Px, season: number, hz: Rgba): void {
  const { w, h } = p;
  const cool = (s: Shade): Shade => (season === 3 ? fade(s, rgba(P.stone[2]), 0.12) : s);
  // 远处的台地：平顶、陡壁、横向岩层
  const mesaSpacing = 92;
  const mesas: { cx: number; half: number; top: number; steep: number }[] = [];
  for (let g = -1; g * mesaSpacing < w + mesaSpacing; g++) {
    if (h2(401, g) < 0.22) continue;
    mesas.push({
      cx: g * mesaSpacing + h2(402, g) * mesaSpacing * 0.6,
      half: 8 + h2(403, g) * 22,
      top: h * 0.18 + h2(404, g) * h * 0.3,
      steep: 1.8 + h2(405, g) * 1.4,
    });
  }
  const far = fade(cool(shade(P.sand[3], P.sand[2], mix(P.sand[1], P.sand[2], 0.4))), hz, 0.5);
  const topC = mix(P.sand[4], hz, 0.45);
  const strata = mix(P.sand[1], hz, 0.5);
  for (let x = 0; x < w; x++) {
    let best = h * 0.72 + (vnoise(406, x, 40) - 0.5) * 4;
    let owner: (typeof mesas)[number] | null = null;
    for (const m of mesas) {
      const d = Math.max(0, Math.abs(x - m.cx) - m.half) * m.steep;
      const s = m.top + d + (vnoise(407, x, 3) - 0.5) * 1.5;
      if (s < best) {
        best = s;
        owner = m;
      }
    }
    column(p, x, best, (y) => {
      if (!owner) return far.mid;
      const top = Math.ceil(best);
      if (y === top) return topC;
      if ((y - Math.round(owner.top)) % 5 === 3 && ditherHit(x, y, 0.75)) return strata;
      if (x < owner.cx - owner.half) return far.lit;
      if (x > owner.cx + owner.half) return far.dark;
      return y - top < 2 ? far.lit : far.mid;
    });
  }
  mist(p, hz, Math.round(h * 0.34), 0.3);
  // 中景沙丘：缓坡迎风、陡坡背风
  const dune = (x: number, seed: number, period: number, amp: number) => {
    const u = x / period + vnoise(seed, x, period * 2) * 0.8;
    const f = u - Math.floor(u);
    const shape = f < 0.72 ? f / 0.72 : (1 - f) / 0.28;
    return shape * shape * (3 - 2 * shape) * amp;
  };
  const midSurf = (x: number) => h * 0.64 - dune(x, 411, 70, h * 0.2) - (vnoise(412, x, 50) - 0.5) * h * 0.08;
  hills(p, midSurf, fade(cool(shade(P.sand[4], P.sand[3], P.sand[2])), hz, 0.26));
  // 近处低沙丘与零星灌木
  const nearSurf = (x: number) => h * 0.82 - dune(x, 421, 46, h * 0.1);
  hills(p, nearSurf, fade(cool(shade(P.sand[3], mix(P.sand[3], P.sand[2], 0.5), P.sand[2])), hz, 0.1), false);
  const scrub = fade(shade(mix(P.leaf[2], P.sand[2], 0.35), mix(P.leaf[1], P.sand[1], 0.4), P.leaf[0]), hz, 0.12);
  for (let i = 0; i * 13 < w; i++) {
    if (h2(431, i) < 0.5) continue;
    const cx = i * 13 + h2(432, i) * 10;
    canopy(p, cx, nearSurf(cx) - 0.5, 1.2 + h2(433, i) * 1.2, scrub);
  }
}

/** 近处剪影棕榈：弯曲的树干 + 放射状叶片。 */
function palmSilhouette(p: Px, x0: number, baseY: number, hh: number, lean: number, c: Rgba, c2: Rgba): void {
  let tx = x0;
  let ty = baseY;
  for (let i = 0; i < hh; i++) {
    tx = x0 + lean * (i / hh) * (i / hh) * hh * 0.35;
    ty = baseY - i;
    p.set(Math.round(tx), ty, c);
  }
  const fronds: [number, number][] = [
    [-1, -0.2],
    [-0.8, 0.5],
    [-0.3, 0.9],
    [0.4, 0.9],
    [0.9, 0.4],
    [1, -0.25],
    [0.2, -0.6],
  ];
  fronds.forEach(([dx, dy], k) => {
    const len = hh * 0.36;
    for (let i = 1; i <= len; i++) {
      const t = i / len;
      const x = tx + dx * i;
      const y = ty + dy * i * 0.6 + t * t * len * 0.5;
      p.set(Math.round(x), Math.round(y), k % 2 ? c2 : c);
      if (t < 0.7) p.set(Math.round(x), Math.round(y) + 1, c);
    }
  });
}

function tropical(p: Px, season: number, hz: Rgba): void {
  const { w, h } = p;
  const dry = season === 3 ? 0.18 : 0;
  // 远处的火山岛
  const vSpacing = 260;
  for (let g = -1; g * vSpacing < w + vSpacing; g++) {
    const cx = g * vSpacing + 60 + h2(501, g) * 120;
    // 峰顶留出上方空间给烟
    const top = h * 0.3 + h2(502, g) * h * 0.1;
    const slope = 0.75 + h2(503, g) * 0.3;
    const crater = 3 + h2(504, g) * 2;
    const rock = fade(shade(mix(P.stone[2], P.sand[2], 0.25), mix(P.stone[1], P.sand[1], 0.3), mix(P.stone[1], P.stone[0], 0.4)), hz, 0.48);
    const green = fade(shade(mix(P.leaf[2], P.teal[2], 0.4), mix(P.leaf[1], P.teal[1], 0.4), mix(P.leaf[1], P.teal[0], 0.5)), hz, 0.48);
    // 山坡在下半截放缓，像真正的火山锥
    const surf = (x: number) => {
      const dx = Math.abs(x + 0.5 - cx);
      if (dx < crater) return top + (crater - dx) * 0.5;
      const d = dx - crater;
      const s0 = top + d * slope * (1 - Math.min(0.5, d / 140));
      return s0 + (vnoise(505, x, 3) - 0.5) * 1.4;
    };
    for (let x = Math.max(0, Math.floor(cx - 160)); x <= Math.min(w - 1, cx + 160); x++) {
      const s0 = surf(x);
      if (s0 >= h) continue;
      column(p, x, s0, (y) => {
        const ridge = cx + (y - top) * 0.18 + (vnoise(507, y, 5) - 0.5) * 3;
        const lit = x + 0.5 < ridge;
        const bare = y < top + (h - top) * 0.3 + (vnoise(506, x, 4) - 0.5) * 5;
        const s2 = bare ? rock : green;
        // 放射状的冲沟
        const rel = (x + 0.5 - cx) / Math.max(1, y - top);
        const gully = y - top > 4 && Math.abs(((rel * 9) % 1 + 1) % 1 - 0.5) < 0.06;
        if (gully) return lit ? s2.mid : s2.dark;
        return lit ? s2.lit : s2.dark;
      });
    }
    // 火山口上方一串升起、渐渐飘向右侧的烟团（左上亮、右下暗）
    for (let k = 0; k < 5; k++) {
      const r = 2.4 + k * 1.05;
      const sx = cx + 0.5 + k * k * 1.1;
      const sy = top - 3 - k * 4;
      for (let y = Math.floor(sy - r); y <= sy + r; y++) {
        for (let x = Math.floor(sx - r); x <= sx + r; x++) {
          if (!p.inBounds(x, y)) continue;
          const dx = x + 0.5 - sx;
          const dy = y + 0.5 - sy;
          if (dx * dx + dy * dy > r * r) continue;
          if (k === 4 && !ditherHit(x, y, 0.5)) continue;
          const lit = dx * 0.7 + dy * 0.7 < -r * 0.2;
          p.data[y * w + x] = mix(lit ? P.stone[4] : P.stone[3], hz, 0.25 + k * 0.08);
        }
      }
    }
  }
  mist(p, hz, Math.round(h * 0.3), 0.3);
  // 中景：丛林覆盖的圆丘小岛，岛与岛之间露出海平线
  const iSpacing = 112;
  const midCol = fade(
    shade(mix(mix(P.leaf[3], P.teal[3], 0.2), P.straw[2], dry), mix(P.leaf[2], P.teal[2], 0.2), mix(P.leaf[1], P.teal[1], 0.3)),
    hz,
    0.26,
  );
  for (let g = -1; g * iSpacing < w + iSpacing; g++) {
    if (h2(511, g) < 0.2) continue;
    const cx = g * iSpacing + h2(512, g) * iSpacing * 0.5;
    const half = 22 + h2(513, g) * 30;
    const peak = h * 0.36 + h2(514, g) * h * 0.18;
    const surf = (x: number) => {
      const t = (x - cx) / half;
      if (Math.abs(t) >= 1) return h + 10;
      const bump = Math.cos((t * Math.PI) / 2);
      return h - (h - peak) * Math.pow(bump, 0.8) + (vnoise(515, x, 4) - 0.5) * 2.5;
    };
    const tmp = new Px(w, h);
    hills(tmp, surf, midCol);
    p.blit(tmp, 0, 0);
  }
  // 近处：低矮沙洲与椰林剪影
  const nSpacing = 110;
  const palmC = fade(shade(P.leaf[1], P.leaf[1], P.leaf[0]), hz, 0.1);
  const sandC = mix(P.straw[3], hz, 0.12);
  for (let g = -1; g * nSpacing < w + nSpacing; g++) {
    if (h2(521, g) < 0.35) continue;
    const cx = g * nSpacing + h2(522, g) * nSpacing * 0.5;
    const half = 22 + h2(523, g) * 26;
    for (let x = Math.floor(cx - half); x <= cx + half; x++) {
      if (x < 0 || x >= w) continue;
      const t = Math.abs(x - cx) / half;
      const top = h - 2 - (1 - t * t) * h * 0.08;
      column(p, x, top, (y) => (y >= h - 2 ? sandC : palmC.mid));
    }
    const n = 2 + Math.floor(h2(524, g) * 3);
    for (let k = 0; k < n; k++) {
      const px = cx - half * 0.6 + (k / Math.max(1, n - 1)) * half * 1.2 + (h2(525 + k, g) - 0.5) * 6;
      const hh = h * 0.2 + h2(530 + k, g) * h * 0.14;
      palmSilhouette(p, px, h - 3, hh, h2(535 + k, g) < 0.5 ? -1 : 1, palmC.mid, palmC.dark);
    }
  }
}

/**
 * 远山 / 丘陵 / 沙丘 / 海岛剪影，宽 w 高 h，底部对齐。
 * sky 可选：给出时间与天气时整幅按天色调色（黄昏偏暖紫、夜晚压暗），与同样参数的天空衔接。
 */
export function drawDistantLand(w: number, h: number, climate: Climate, season: number, sky: { time?: TimeOfDay; weather?: Weather } = {}): Px {
  const s = seasonOf(season);
  const p = new Px(Math.max(1, Math.floor(w)), Math.max(1, Math.floor(h)));
  const hz = hazeOf(climate, s);
  if (climate === "temperate") temperate(p, s, hz);
  else if (climate === "cold") cold(p, s, hz);
  else if (climate === "arid") arid(p, s, hz);
  else tropical(p, s, hz);
  const time = sky.time ?? "day";
  const weather = sky.weather ?? "clear";
  return time === "day" && weather === "clear" ? p : shadeForTime(p, time, weather, false);
}
