// 天况与时刻图标（EXPANSION.md §9.3）：顶栏与预报用的晴、多云、雨、雾、暴风雨、雪，
// 时刻旁的太阳（白天）、半日（黎明与黄昏）、月亮（夜晚），以及 8 个方向的风向小箭头。
// 规则与界面图标相同（见 icons.test.ts）：16×16、透明底、1 像素深色描边、左上受光、颜色克制。
// 云团、箭头这类块面用“赛璐璐”式分块着色：上缘与左缘最亮、下缘与右缘偏暗、底边最暗，不用抖动噪点。
import { Px } from "../px";
import { P, ball, canvas, ink, outline, type Ramp } from "./kit";

type Maker = () => Px;

/** 太阳：金 → 灯光白。 */
const SUN: Ramp = [P.gold[1], P.gold[2], P.gold[3], P.gold[4], P.lamp[2]];
/** 白云（雪的色阶）。 */
const WHITE_CLOUD: Ramp = P.snow;
/** 远处偏灰的云。 */
const PALE_CLOUD: Ramp = [P.stone[2], P.stone[3], P.snow[1], P.snow[2]];
/** 雨云。 */
const RAIN_CLOUD: Ramp = [P.stone[1], P.stone[2], P.stone[3], P.stone[4]];
/** 暴风雨的乌云。 */
const STORM_CLOUD: Ramp = [P.slate[0], P.slate[1], P.slate[2], P.slate[3]];
/** 月亮：淡金。 */
const MOON: Ramp = [P.gold[1], P.gold[3], P.gold[4], P.white];

/** 圆：[圆心 x, 圆心 y, 半径]。 */
type Circle = readonly [number, number, number];

/** 像素 (x, y) 是否落在若干圆的并集里、且不低于底边 base。 */
function inPuffs(circles: readonly Circle[], base: number, x: number, y: number): boolean {
  if (y > base) return false;
  return circles.some(([cx, cy, r]) => {
    const dx = x + 0.5 - cx;
    const dy = y + 0.5 - cy;
    return dx * dx + dy * dy <= r * r;
  });
}

/**
 * 分块着色：mask 里的像素按邻接关系取色——上缘、左缘最亮，右缘偏暗，下缘最暗，其余为主色。
 * ramp 由暗到亮至少 4 阶。
 */
function celShade(p: Px, inside: (x: number, y: number) => boolean, ramp: Ramp): Px {
  const n = ramp.length;
  for (let y = 0; y < 16; y++) {
    for (let x = 0; x < 16; x++) {
      if (!inside(x, y)) continue;
      const top = !inside(x, y - 1);
      const left = !inside(x - 1, y);
      const bottom = !inside(x, y + 1);
      const right = !inside(x + 1, y);
      let c = ramp[n - 2];
      if (right) c = ramp[n - 3];
      if (top || (left && !bottom)) c = ramp[n - 1];
      if (bottom) c = ramp[Math.max(0, n - 4)];
      else if (!inside(x, y + 2) && !top) c = ramp[n - 3];
      p.put(x, y, c);
    }
  }
  return p;
}

/** 蓬松的云：几个圆叠成凸起的上缘，底边平直。 */
function cloud(p: Px, circles: readonly Circle[], base: number, ramp: Ramp): Px {
  return celShade(p, (x, y) => inPuffs(circles, base, x, y), ramp);
}

/** 字符网格（'#' 为实心）转成判定函数，(ox, oy) 为左上角在画布上的位置。 */
function maskOf(rows: readonly string[], ox: number, oy: number): (x: number, y: number) => boolean {
  return (x, y) => rows[y - oy]?.[x - ox] === "#";
}

/** 太阳的光芒：k 条，从半径 r0 到 r1，起始角 a0（弧度），相邻两条亮暗交替。 */
function rays(p: Px, cx: number, cy: number, k: number, r0: number, r1: number, a0 = 0, span = Math.PI * 2): Px {
  const step = span >= Math.PI * 2 ? span / k : span / Math.max(1, k - 1);
  for (let i = 0; i < k; i++) {
    const a = a0 + i * step;
    const x0 = cx + Math.cos(a) * r0;
    const y0 = cy + Math.sin(a) * r0;
    const x1 = cx + Math.cos(a) * r1;
    const y1 = cy + Math.sin(a) * r1;
    p.line(Math.floor(x0), Math.floor(y0), Math.floor(x1), Math.floor(y1), i % 2 ? P.gold[3] : P.lamp[1]);
  }
  return p;
}

/** 雨丝：从 (x, y) 向左下斜落的两像素短线。 */
function drop(p: Px, x: number, y: number, c: string = P.sky[3], tip: string = P.sky[4]): Px {
  return p.put(x, y, tip).put(x - 1, y + 1, c);
}

/** 雪花：十字形的五个像素。 */
function flake(p: Px, x: number, y: number): Px {
  return p.put(x, y, P.white).put(x - 1, y, P.snow[2]).put(x + 1, y, P.snow[1]).put(x, y - 1, P.snow[2]).put(x, y + 1, P.snow[1]);
}

// ---------------------------------------------------------------- 天况

/** 晴：光芒四射的太阳（四正长、四斜短）。 */
const skyClear: Maker = () => {
  const p = canvas();
  const c = 7.5;
  for (let k = 0; k < 8; k++) {
    const a = (k * Math.PI) / 4 - Math.PI / 2;
    const long = k % 2 === 0;
    const r1 = long ? 6.4 : 6.6;
    p.line(Math.round(c + Math.cos(a) * 5 - 0.5), Math.round(c + Math.sin(a) * 5 - 0.5), Math.round(c + Math.cos(a) * r1 - 0.5), Math.round(c + Math.sin(a) * r1 - 0.5), long ? P.lamp[1] : P.gold[3]);
  }
  ball(p, c, c, 4.1, 4.1, SUN, true);
  return outline(p, ink.brown);
};

/** 多云：后面一朵偏灰的小云，前面一朵白色的大云。 */
const skyCloudy: Maker = () => {
  const p = canvas();
  cloud(
    p,
    [
      [9.5, 5.5, 2.6],
      [12, 6.5, 2.3],
      [7.4, 7, 1.8],
    ],
    7,
    PALE_CLOUD,
  );
  cloud(
    p,
    [
      [4, 10.6, 2.4],
      [7.2, 9, 3.3],
      [10.6, 10.8, 2.5],
      [12.2, 11.8, 1.7],
    ],
    12,
    WHITE_CLOUD,
  );
  return outline(p, ink.blue);
};

/** 雨：灰色雨云，下面斜落的雨丝。 */
const skyRain: Maker = () => {
  const p = canvas();
  cloud(
    p,
    [
      [3.8, 6.5, 2.4],
      [7.2, 4.8, 3.4],
      [10.8, 6, 2.8],
      [12.8, 7.4, 1.6],
    ],
    8,
    RAIN_CLOUD,
  );
  for (const [x, y] of [
    [4, 10],
    [8, 10],
    [12, 10],
    [6, 13],
    [10, 13],
  ] as const)
    drop(p, x, y);
  return outline(p, ink.blue);
};

/** 雾：长短错落、一层层横飘的雾带。 */
const skyFog: Maker = () => {
  const p = canvas();
  const bands: readonly [number, number, number][] = [
    [4, 11, 2],
    [2, 10, 5],
    [5, 13, 8],
    [2, 11, 11],
  ];
  for (const [x0, x1, y] of bands) {
    p.hline(x0, x1, y, P.snow[2]);
    p.put(x0, y, P.white).put(x0 + 1, y, P.white);
    p.hline(x0 + 1, x1 - 1, y + 1, P.snow[1]);
    p.put(x1, y, P.snow[1]);
  }
  return outline(p, ink.blue);
};

/** 暴风雨：乌云、金色的闪电与斜雨。 */
const skyStorm: Maker = () => {
  const p = canvas();
  cloud(
    p,
    [
      [3.6, 5.2, 2.5],
      [7.4, 3.9, 3.3],
      [11, 4.9, 2.9],
      [13, 6.2, 1.6],
    ],
    6,
    STORM_CLOUD,
  );
  // 闪电：从云底斜劈而下，折一次
  const bolt = [
    "...##",
    "..##.",
    ".##..",
    "#####",
    "..##.",
    ".##..",
    "##...",
    "#....",
  ];
  celShade(p, maskOf(bolt, 5, 7), [P.gold[2], P.gold[3], P.gold[4], P.lamp[2]]);
  drop(p, 3, 9, P.sky[2], P.sky[3]);
  drop(p, 12, 9, P.sky[2], P.sky[3]);
  drop(p, 12, 13, P.sky[2], P.sky[3]);
  drop(p, 3, 13, P.sky[2], P.sky[3]);
  return outline(p, ink.deep);
};

/** 雪：白云下飘着三片雪花。 */
const skySnow: Maker = () => {
  const p = canvas();
  cloud(
    p,
    [
      [3.8, 6.2, 2.4],
      [7.3, 4.6, 3.3],
      [10.8, 5.8, 2.7],
      [12.7, 7, 1.6],
    ],
    8,
    WHITE_CLOUD,
  );
  flake(p, 4, 11);
  flake(p, 9, 11);
  flake(p, 12, 13);
  return outline(p, ink.blue);
};

// ---------------------------------------------------------------- 时刻

/** 海平线：两行海面，带浪花高光。 */
function horizon(p: Px, y: number, glint: string = P.foam): Px {
  p.hline(1, 14, y, P.sea[3]);
  p.hline(1, 14, y + 1, P.sea[2]);
  for (const x of [2, 7, 12]) p.put(x, y, glint).put(x + 1, y, P.sea[4]);
  return p;
}

/** 太阳（白天）：高悬在海平线上的日轮。 */
const sun: Maker = () => {
  const p = canvas();
  rays(p, 8, 6.5, 8, 4.3, 5.4, -Math.PI / 2);
  ball(p, 8, 6.3, 3.2, 3.2, SUN, true);
  horizon(p, 12);
  return outline(p, ink.brown);
};

/** 半日（黎明与黄昏）：半轮太阳贴着海平线，海面上一道金色倒影。 */
const sunHalf: Maker = () => {
  const p = canvas();
  rays(p, 8, 10, 5, 5.8, 7.2, -Math.PI + 0.45, Math.PI - 0.9);
  for (let y = 5; y <= 10; y++) {
    for (let x = 2; x <= 14; x++) {
      const dx = x + 0.5 - 8;
      const dy = y + 0.5 - 10.9;
      const d = Math.hypot(dx, dy);
      if (d > 5.2) continue;
      // 上缘最亮，越往下越橙
      let c: string = P.gold[3];
      if (dy < -4 || (dx < -2 && dy < -2.5)) c = P.gold[4];
      else if (y >= 9) c = P.gold[2];
      if (d > 4.4 && dx > 1) c = P.gold[2];
      p.put(x, y, c);
    }
  }
  p.put(6, 6, P.lamp[2]);
  horizon(p, 11, P.gold[3]);
  // 倒影：海面上断续的金色短线
  p.hline(6, 9, 12, P.gold[3]).hline(7, 8, 13, P.gold[2]);
  return outline(p, ink.brown);
};

/** 月亮（夜晚）：一弯新月与两颗小星。 */
const moon: Maker = () => {
  const p = canvas();
  const inMoon = (x: number, y: number) => {
    const ax = x + 0.5 - 7;
    const ay = y + 0.5 - 8;
    const bx = x + 0.5 - 9.6;
    const by = y + 0.5 - 6.2;
    return ax * ax + ay * ay <= 5.6 * 5.6 && bx * bx + by * by > 4.6 * 4.6;
  };
  celShade(p, inMoon, MOON);
  // 星：十字小星与一个亮点
  p.put(12, 11, P.white).put(11, 11, P.gold[4]).put(13, 11, P.gold[3]).put(12, 10, P.gold[4]).put(12, 12, P.gold[3]);
  p.put(12, 3, P.gold[4]).put(13, 3, P.gold[3]);
  return outline(p, ink.deep);
};

// ---------------------------------------------------------------- 风向小箭头

/** 朝东的箭头：两像素粗的箭杆与实心箭头。 */
const ARROW_E = [
  ".........#...",
  ".........##..",
  ".........###.",
  "#############",
  "#############",
  ".........###.",
  ".........##..",
  ".........#...",
];

/** 朝东北的箭头：斜向箭杆与右上角的直角箭头。 */
const ARROW_NE = [
  ".......######",
  "........#####",
  ".........####",
  ".........####",
  "........##.##",
  ".......##...#",
  "......##.....",
  ".....##......",
  "....##.......",
  "...##........",
  "..##.........",
  ".##..........",
  "##...........",
];

/** 把字符网格顺时针转 90°。 */
function rotateCw(rows: readonly string[]): string[] {
  const h = rows.length;
  const w = rows[0]?.length ?? 0;
  const out: string[] = [];
  for (let x = 0; x < w; x++) {
    let s = "";
    for (let y = h - 1; y >= 0; y--) s += rows[y][x];
    out.push(s);
  }
  return out;
}

/** 风向（风的去向，0 = 北，顺时针 8 方向）对应的箭头网格。 */
function arrowRows(dir: number): string[] {
  const d = ((Math.round(dir) % 8) + 8) % 8;
  // 东（2）与东北（1）为基准，其余每转 90° 加 2
  let rows = d % 2 === 0 ? [...ARROW_E] : [...ARROW_NE];
  const base = d % 2 === 0 ? 2 : 1;
  const turns = (((d - base) / 2) % 4 + 4) % 4;
  for (let i = 0; i < turns; i++) rows = rotateCw(rows);
  return rows;
}

/** 风向小箭头（16×16）：箭头指向风的去向，白色箭身、上缘受光。 */
export function windIcon(dir: number): Px {
  const rows = arrowRows(dir);
  const ox = Math.floor((16 - rows[0].length) / 2);
  const oy = Math.floor((16 - rows.length) / 2);
  const p = canvas();
  celShade(p, maskOf(rows, ox, oy), [P.sky[2], P.sky[3], P.sky[4], P.white]);
  return outline(p, ink.blue);
}

/** 天况图标名（与 SkyKind 一一对应：sky_ + 天况）。 */
export const SKY_ICONS = {
  sky_clear: skyClear,
  sky_cloudy: skyCloudy,
  sky_rain: skyRain,
  sky_fog: skyFog,
  sky_storm: skyStorm,
  sky_snow: skySnow,
  sun,
  sun_half: sunHalf,
  moon,
} satisfies Record<string, Maker>;
