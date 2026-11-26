// 航海图上的天况标记（EXPANSION.md §9.3）：云团（多云）、雨云、雾带、暴风雨云与雪云，以及夜里港口的灯火。
// 标记画在各海区当天的天况处，由渲染器（map/renderer.ts）平铺在海区里并随风向缓缓漂移。
// 云团用“赛璐璐”式分块着色：上缘亮、下缘与右缘暗，不用抖动噪点；雾带是半透明的横向长条，不描边。
// 全部是纯函数，结果按参数记忆化。
import type { SkyKind } from "../../ipc/types";
import { P, ink } from "../palette";
import { Px } from "../px";
import { memo } from "../render";

/** 雨、雪、暴风雨的下落动画帧数（多云与雾只有一帧）。 */
export const WEATHER_FRAMES = 2;
/** 云团的外形种类数（同一种天况的几个标记不会长得一模一样）。 */
export const WEATHER_VARIANTS = 3;

type Ramp = readonly string[];
type Circle = readonly [number, number, number];

/** 白云。 */
const WHITE: Ramp = P.snow;
/** 雨云。 */
const GRAY: Ramp = [P.stone[1], P.stone[2], P.stone[3], P.stone[4]];
/** 暴风雨的乌云。 */
const DARK: Ramp = [P.slate[0], P.slate[1], P.slate[2], P.slate[3]];

/** 三种云团外形：圆心与半径（像素），底边在 base 行。 */
const PUFFS: readonly (readonly Circle[])[] = [
  [
    [5.5, 7, 3.6],
    [11.5, 5, 4.8],
    [17.5, 6.5, 4],
    [21, 8.2, 2.4],
  ],
  [
    [4.5, 7.4, 3.2],
    [9.5, 5.2, 4.2],
    [15, 4.6, 4.4],
    [20, 7, 3.3],
  ],
  [
    [3.6, 8.2, 2.4],
    [8, 6, 4.4],
    [14, 6.4, 4],
    [19.5, 7.4, 3.4],
  ],
];

/** 把云团外形横向放大到宽 w（原型宽约 24 像素），纵向放大 k 倍。 */
function scalePuffs(circles: readonly Circle[], sx: number, sy: number): Circle[] {
  return circles.map(([x, y, r]) => [x * sx, y * sy, r * Math.min(sx, sy)] as const);
}

/** 分块着色的云：上缘与左缘最亮，右缘偏暗，底边两行最暗。 */
function puff(p: Px, circles: readonly Circle[], base: number, ramp: Ramp, ox = 0, oy = 0): Px {
  const inside = (x: number, y: number) => {
    if (y > base) return false;
    return circles.some(([cx, cy, r]) => {
      const dx = x + 0.5 - cx;
      const dy = y + 0.5 - cy;
      return dx * dx + dy * dy <= r * r;
    });
  };
  const n = ramp.length;
  for (let y = 0; y <= base; y++) {
    for (let x = 0; x < p.w - ox; x++) {
      if (!inside(x, y)) continue;
      const top = !inside(x, y - 1);
      const left = !inside(x - 1, y);
      const right = !inside(x + 1, y);
      let c = ramp[n - 2];
      if (right) c = ramp[n - 3];
      if (top || (left && y < base - 1)) c = ramp[n - 1];
      if (y === base) c = ramp[Math.max(0, n - 4)];
      else if (y === base - 1 && !top) c = ramp[n - 3];
      p.put(ox + x, oy + y, c);
    }
  }
  return p;
}

/** 雨丝：斜向左下的短线，frame 让雨丝往下落。 */
function rain(p: Px, x0: number, y0: number, w: number, h: number, frame: number, seed: number, light: string, dark: string, gap = 4): Px {
  const fall = frame * 2;
  for (let col = 0; col * gap < w; col++) {
    const x = x0 + col * gap + ((seed + col * 3) % 2);
    const off = (col * 5 + seed) % h;
    for (let k = 0; k < 2; k++) {
      const y = y0 + ((off + fall + k * Math.ceil(h / 2)) % h);
      p.set(x, y, light);
      p.set(x - 1, y + 1, dark);
    }
  }
  return p;
}

/** 雪花：十字形或单点，frame 让雪片往下飘。 */
function snow(p: Px, x0: number, y0: number, w: number, h: number, frame: number, seed: number): Px {
  for (let col = 0; col * 5 < w; col++) {
    const x = x0 + col * 5 + ((seed + col) % 3);
    const y = y0 + ((col * 3 + seed + frame * 2) % Math.max(1, h - 1));
    if (col % 2 === 0) p.set(x, y, P.white).set(x - 1, y, P.snow[2]).set(x + 1, y, P.snow[2]).set(x, y - 1, P.snow[2]).set(x, y + 1, P.snow[1]);
    else p.set(x, y, P.white).set(x, y + 1, P.snow[1]);
  }
  return p;
}

/** 云团（多云）：白色的蓬松云，半透明的深蓝描边。 */
function cloudMark(variant: number): Px {
  const p = new Px(24, 11);
  puff(p, PUFFS[variant], 10, WHITE);
  return p.outlined("#14213d99");
}

/** 描好边的云下面接一段降水区（雨丝、雪片不描边，免得在海上显得脏）。 */
function withFall(cloud: Px, fallH: number, draw: (p: Px, top: number) => void): Px {
  const p = new Px(cloud.w, cloud.h + fallH);
  draw(p, cloud.h - 1);
  return p.blit(cloud, 0, 0);
}

/** 雨云：灰云下垂着斜雨。 */
function rainMark(variant: number, frame: number): Px {
  const cloud = puff(new Px(24, 11), PUFFS[variant], 10, GRAY).outlined("#14213daa");
  return withFall(cloud, 6, (p, top) => rain(p, 5, top, 18, 7, frame, variant, P.sky[4], P.sky[3]));
}

/** 雪云：白云下飘着雪片。 */
function snowMark(variant: number, frame: number): Px {
  const cloud = puff(new Px(24, 11), PUFFS[variant], 10, WHITE).outlined("#14213d99");
  return withFall(cloud, 6, (p, top) => snow(p, 4, top + 1, 19, 6, frame, variant));
}

/** 暴风雨：更大更暗的乌云、金色的闪电（不闪烁）与密集的斜雨。 */
function stormMark(variant: number, frame: number): Px {
  const cloud = puff(new Px(26, 12), scalePuffs(PUFFS[variant], 26 / 24, 1.05), 11, DARK).outlined(ink.deep);
  return withFall(cloud, 6, (p, top) => {
    rain(p, 4, top, 21, 7, frame, variant, P.sky[4], P.sky[3], 3);
    // 闪电：从云底折一次劈下（带深色描边，压在雨上）
    const bx = 10 + variant * 2;
    const bolt = new Px(4, 7).stamp(["..##", ".##.", "####", ".##.", "##..", "#...", "#..."], { "#": P.gold[3] });
    bolt.set(2, 0, P.lamp[2]).set(1, 2, P.lamp[2]);
    p.blit(bolt.outlined(ink.deep), bx - 1, top - 1);
  });
}

/** 雾：三条长短错落的半透明雾带，不描边（在海上看得见、又不遮住海岸）。 */
function fogMark(variant: number): Px {
  const p = new Px(32, 12);
  const bands: readonly (readonly [number, number, number])[] = [
    [4 + variant, 25, 1],
    [0, 21 + variant, 5],
    [7, 31 - variant, 9],
  ];
  for (const [x0, x1, y] of bands) {
    // 雾带两端淡、中间浓；上沿亮、下沿略暗
    for (let x = x0; x <= x1; x++) {
      const edge = Math.min(x - x0, x1 - x);
      const a = edge < 2 ? "66" : edge < 4 ? "99" : "cc";
      p.set(x, y, `${P.white}${a}`);
      p.set(x, y + 1, `${P.snow[2]}${a}`);
      if (edge >= 3) p.set(x, y + 2, `${P.snow[0]}66`);
    }
  }
  return p;
}

/**
 * 天况标记：sky 为天况（晴天没有标记，返回 1×1 的透明图），variant 选云团外形（0–2），
 * frame 为下落动画帧（雨、雪、暴风雨各 2 帧）。
 */
export function drawWeatherMark(sky: SkyKind, variant = 0, frame = 0): Px {
  const v = ((Math.floor(variant) % WEATHER_VARIANTS) + WEATHER_VARIANTS) % WEATHER_VARIANTS;
  const animated = sky === "rain" || sky === "snow" || sky === "storm";
  const f = animated ? ((Math.floor(frame) % WEATHER_FRAMES) + WEATHER_FRAMES) % WEATHER_FRAMES : 0;
  return memo(`wx:${sky}:${v}:${f}`, () => {
    switch (sky) {
      case "cloudy":
        return cloudMark(v);
      case "rain":
        return rainMark(v, f);
      case "snow":
        return snowMark(v, f);
      case "storm":
        return stormMark(v, f);
      case "fog":
        return fogMark(v);
      default:
        return new Px(1, 1);
    }
  });
}

/** 图例用的天况小样：一小块海面上的天况标记（雾是半透明的白，放在羊皮纸上看不见，所以统一垫海色）。 */
export function weatherSwatch(sky: SkyKind): Px {
  return memo(`wx-swatch:${sky}`, () => {
    const p = new Px(30, 18).fill(P.sea[2]);
    p.hline(0, 29, 17, P.sea[1]);
    const m = drawWeatherMark(sky, 0, 0);
    p.blit(m, Math.floor((30 - m.w) / 2), Math.floor((18 - m.h) / 2), { alpha: 0.9 });
    return p.outlined(ink.blue);
  });
}

/** 图例用的灯火小样：夜色里的一团暖光。 */
export function lightSwatch(): Px {
  return memo("light-swatch", () => {
    const p = new Px(16, 12).fill(P.night[2]);
    p.hline(0, 15, 11, P.night[1]);
    p.blit(drawPortLight(), 2, 1);
    return p.outlined(ink.deep);
  });
}

/** 港口灯火：夜里港口与城市标记上的一团暖光（中心亮、四周渐淡）。图的中心对准灯光。 */
export function drawPortLight(): Px {
  return memo("port-light", () => {
    const p = new Px(11, 9);
    p.ellipse(5, 4, 5, 4, `${P.lamp[1]}22`);
    p.ellipse(5, 4, 3.6, 2.8, `${P.lamp[1]}44`);
    p.ellipse(5, 4, 2.2, 1.6, `${P.lamp[1]}88`);
    p.set(4, 4, P.lamp[2]).set(6, 4, P.lamp[1]).set(5, 3, P.lamp[2]).set(5, 4, P.white);
    return p;
  });
}

// ───────────── 天气特效的小图 ─────────────
// 航海图上按海区落下的雨线与雪片、闪电（map/weatherLayer.ts），以及玩家所在处的全画面雨幕（components/WeatherScreen.tsx）。
// 全部画在整像素上：雨线是一格一格的阶梯斜线，闪电是折线，不描边、不用抖动噪点。

/** 天气特效小图的色调：白天的冷灰白、黄昏偏暖、夜里压暗偏蓝（全画面效果按时段取；海图上的统一用白天，夜色层会压暗）。 */
export type FxTone = "day" | "dusk" | "night";

/** 雨线的三段颜色：[头（最亮）, 身, 尾]（不带不透明度）。 */
function rainRamp(tone: FxTone): readonly [string, string, string] {
  if (tone === "night") return [P.snow[0], P.night[3], P.night[2]];
  if (tone === "dusk") return ["#d6cad6", P.snow[1], P.stone[3]];
  return [P.snow[2], P.snow[1], P.snow[0]];
}

/**
 * 一条雨线：len 像素长，每落下 run 像素向 dir 侧（1 东、−1 西）挪 1 像素——整像素的阶梯斜线。
 * 底端是雨滴的头（最亮），往上渐淡。near 为近处的雨（亮），否则是远处的雨（淡）。图的左上角对齐雨线的尾。
 */
export function drawRainStreak(len: number, run: number, dir: 1 | -1, tone: FxTone = "day", near = true): Px {
  const n = Math.max(1, Math.min(16, Math.round(len)));
  const r = Math.max(1, Math.round(run));
  const d = dir < 0 ? -1 : 1;
  return memo(`fx-rain:${n}:${r}:${d}:${tone}:${near ? 1 : 0}`, () => {
    const shift = Math.floor((n - 1) / r);
    const p = new Px(shift + 1, n);
    const [head, body, tail] = rainRamp(tone);
    const a = near ? ["dd", "aa", "66"] : ["99", "77", "44"];
    for (let i = 0; i < n; i++) {
      // i = 0 是尾（最上），i = n − 1 是头（最下）
      const k = Math.floor(i / r);
      const x = d > 0 ? k : shift - k;
      const c = i === n - 1 ? `${head}${a[0]}` : i >= n / 2 ? `${body}${a[1]}` : `${tail}${a[2]}`;
      p.put(x, i, c);
    }
    return p;
  });
}

/** 雪片：远处 1 像素的细雪，近处十字形的大片。 */
export function drawSnowFlake(big: boolean, tone: FxTone = "day"): Px {
  return memo(`fx-snow:${big ? 1 : 0}:${tone}`, () => {
    const white = tone === "night" ? P.snow[1] : P.white;
    const soft = tone === "night" ? `${P.snow[0]}aa` : `${P.snow[2]}cc`;
    if (!big) return new Px(1, 1).put(0, 0, `${white}cc`);
    const p = new Px(3, 3);
    p.put(1, 0, soft).put(0, 1, soft).put(2, 1, soft).put(1, 2, soft).put(1, 1, white);
    return p;
  });
}

/** 确定性的伪随机 0..1（闪电的折线按 seed 走）。 */
function boltRand(seed: number, i: number): number {
  let h = (Math.imul(seed | 0, 0x9e3779b1) ^ Math.imul(i + 0x632be5ab, 0x85ebca6b)) >>> 0;
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d);
  h = Math.imul(h ^ (h >>> 12), 0x297a2d39);
  h ^= h >>> 15;
  return (h >>> 0) / 4294967296;
}

/**
 * 一道闪电：高 h 像素的折线（每段往下 2–5 像素、横移 1–3 像素），白芯一像素、左右各一像素淡蓝的光；
 * 中途分出一小支岔。seed 决定形状（同一个 seed 永远同一道）。图的上沿正中是闪电的起点。
 */
export function drawLightningBolt(h: number, seed = 0): Px {
  const H = Math.max(8, Math.min(160, Math.round(h)));
  const s = Math.floor(seed) >>> 0;
  return memo(`fx-bolt:${H}:${s}`, () => {
    const W = Math.max(9, Math.round(H * 0.45)) | 1;
    const p = new Px(W, H);
    const glow = `${P.sky[3]}88`;
    const core = P.white;
    const line = (pts: readonly (readonly [number, number])[], pass: 0 | 1) => {
      for (let k = 1; k < pts.length; k++) {
        const [x0, y0] = pts[k - 1];
        const [x1, y1] = pts[k];
        const steps = Math.max(1, y1 - y0);
        for (let j = 0; j <= steps; j++) {
          const x = Math.round(x0 + ((x1 - x0) * j) / steps);
          const y = y0 + j;
          if (pass === 0) p.set(x - 1, y, glow).set(x + 1, y, glow);
          else p.put(x, y, core);
        }
      }
    };
    const trunk: [number, number][] = [[Math.floor(W / 2), 0]];
    let i = 0;
    while (trunk[trunk.length - 1][1] < H - 1) {
      const [x, y] = trunk[trunk.length - 1];
      const dy = 2 + Math.floor(boltRand(s, i++) * 4);
      const side = boltRand(s, i++) < 0.5 ? -1 : 1;
      const dx = side * (1 + Math.floor(boltRand(s, i++) * 3));
      trunk.push([Math.max(2, Math.min(W - 3, x + dx)), Math.min(H - 1, y + dy)]);
    }
    // 岔：从主干的三分之一处分出，往另一侧斜下几段
    const from = trunk[Math.max(1, Math.floor(trunk.length / 3))];
    const fork: [number, number][] = [from];
    const way = from[0] < W / 2 ? 1 : -1;
    for (let k = 0; k < 3 && fork[fork.length - 1][1] < H - 1; k++) {
      const [x, y] = fork[fork.length - 1];
      const nx = Math.max(1, Math.min(W - 2, x + way * (1 + Math.floor(boltRand(s, 50 + k) * 2))));
      fork.push([nx, Math.min(H - 1, y + 2 + Math.floor(boltRand(s, 60 + k) * 3))]);
    }
    // 先铺两条线的光、再画白芯：芯压在光上
    line(fork, 0);
    line(trunk, 0);
    line(fork, 1);
    line(trunk, 1);
    return p;
  });
}
