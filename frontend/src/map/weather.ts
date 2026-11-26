// 航海图的昼夜与天气（EXPANSION.md §9.3）：夜色浓度与港口标记的夜间色调、各海区当天天况标记的摆放与漂移。
// 纯函数，不碰 PixiJS，由 map/renderer.ts 调用（便于单元测试）。
//
// 海区范围：前端只知道各海区的中心（概览 winds 的 x、y，即海区矩形的中点），把每个海格归给最近的中心。
// 旧世界的海区是等大的矩形网格，这样划分与后端完全一致；形状不规则的外洋海区是近似，只影响标记摆在哪里。
import { WIND_DIRS } from "../art/map";
import { hash32 } from "../art/rng";
import type { RegionWeatherView, SkyKind } from "../ipc/types";
import { lightingFollowsClock, nightAmount, type DaylightPref } from "../time/daylight";

// ───────────────────────────── 夜色 ─────────────────────────────

/** 夜色层的颜色（深蓝）。 */
export const NIGHT_COLOR = 0x0b1640;
/** 夜色最浓时夜色层的不透明度。 */
export const NIGHT_MAX_ALPHA = 0.5;
/** 夜色从无到最浓的淡入淡出时长（毫秒）。 */
export const NIGHT_FADE_MS = 1500;
/** 夜里地点标记的色调（乘到精灵颜色上：压暗偏蓝）。 */
export const NIGHT_PLACE_TINT = 0x7d88c0;

/**
 * 海图的夜色浓度 0..1：光照跟随时钟时按时刻（白天 0、夜晚 1，黎明与黄昏线性过渡），
 * 否则（4× 及以上的防闪烁、或偏好为“始终白天”）为 0。与 useScenePhase 同一规则。
 */
export function chartNight(minute: number, speed: number, pref: DaylightPref = "clock"): number {
  return lightingFollowsClock(speed, pref) ? nightAmount(minute) : 0;
}

/** 夜色层的不透明度。 */
export function nightAlpha(amount: number): number {
  return clamp01(amount) * NIGHT_MAX_ALPHA;
}

/** 两种颜色（0xRRGGBB）按 t 混合。 */
export function mixColor(a: number, b: number, t: number): number {
  const k = clamp01(t);
  const ch = (shift: number) => {
    const x = (a >>> shift) & 0xff;
    const y = (b >>> shift) & 0xff;
    return Math.round(x + (y - x) * k) & 0xff;
  };
  return (ch(16) << 16) | (ch(8) << 8) | ch(0);
}

/** 夜里地点标记的色调：白天为白（不变色），夜色越浓越接近 NIGHT_PLACE_TINT。 */
export function placeTint(amount: number): number {
  return mixColor(0xffffff, NIGHT_PLACE_TINT, amount);
}

/** 向目标值缓动一步：每毫秒最多变化 1 / NIGHT_FADE_MS。 */
export function approachNight(current: number, target: number, dtMs: number): number {
  const step = Math.max(0, dtMs) / NIGHT_FADE_MS;
  if (Math.abs(target - current) <= step) return target;
  return current + Math.sign(target - current) * step;
}

function clamp01(v: number): number {
  return Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : 0;
}

// ───────────────────────────── 海区与天况标记 ─────────────────────────────

/** 海图网格（与 StaticView.map 相同：'#' 为陆地）。 */
export interface ChartGrid {
  width: number;
  height: number;
  rows: readonly string[];
}

/** 海区中心（格坐标）。 */
export interface RegionCenter {
  region: number;
  x: number;
  y: number;
}

/** 海区取样的间距（格）：每隔几格取一个候选点。 */
export const SAMPLE_STEP = 3;
/** 各天况在一个标准大小（约 60×40 格海面）的海区里摆几个标记（雾与暴风雨更显眼）。 */
export const MARKS_PER_REGION: Readonly<Record<SkyKind, number>> = { clear: 0, cloudy: 3, rain: 3, snow: 3, fog: 5, storm: 4 };
/** 标准大小海区的候选格数（60×40 格 ÷ 取样间距²）：海面更大或更小的海区按比例多摆或少摆。 */
export const REF_SAMPLES = 240;
/** 整张海图最多的标记数（控制精灵数量，不拖慢帧率）。 */
export const MAX_WEATHER_MARKS = 160;
/** 同一海区两个标记之间的最小距离（格）。 */
export const MARK_GAP = 8;
/** 标记离海区中心（风向箭头处）的最小距离（格）。 */
export const MARK_CENTER_GAP = 4;
/** 各天况标记的基础不透明度。 */
export const MARK_ALPHA: Readonly<Record<SkyKind, number>> = { clear: 0, cloudy: 0.8, rain: 0.85, snow: 0.9, fog: 0.8, storm: 0.95 };
/** 漂移一个来回的时长（毫秒）。 */
export const DRIFT_CYCLE_MS = 6400;
/** 各天况一个来回的漂移距离（像素）：雾慢而短，云与雨长一些。 */
export const DRIFT_TRAVEL: Readonly<Record<SkyKind, number>> = { clear: 0, cloudy: 14, rain: 12, snow: 12, fog: 8, storm: 12 };

/** 格 (x, y) 是否为海（地图外按陆地处理）。 */
export function isSea(grid: ChartGrid, x: number, y: number): boolean {
  if (x < 0 || y < 0 || x >= grid.width || y >= grid.height) return false;
  const ch = grid.rows[y]?.[x];
  return ch !== undefined && ch !== "#";
}

/** 海区里天况标记的个数：天况的基数按海面大小（候选格数 / REF_SAMPLES）缩放到 0.5–2.5 倍；有海面就至少一个。 */
export function markCount(sky: SkyKind, samples: number): number {
  const base = Object.prototype.hasOwnProperty.call(MARKS_PER_REGION, sky) ? MARKS_PER_REGION[sky] : 0;
  if (base <= 0 || samples <= 0) return 0;
  const k = Math.max(0.5, Math.min(2.5, samples / REF_SAMPLES));
  return Math.max(1, Math.round(base * k));
}

/**
 * 各海区的候选格：每隔 step 格取一个海格，归给最近的海区中心（距离相同时取列表里靠前的）。
 * 返回 海区 → 候选格列表（按行优先的顺序）。
 */
export function regionSamples(grid: ChartGrid, centers: readonly RegionCenter[], step = SAMPLE_STEP): Map<number, [number, number][]> {
  const out = new Map<number, [number, number][]>();
  if (centers.length === 0) return out;
  const s = Math.max(1, Math.floor(step));
  const start = Math.floor(s / 2);
  for (let y = start; y < grid.height; y += s) {
    for (let x = start; x < grid.width; x += s) {
      if (!isSea(grid, x, y)) continue;
      let best = centers[0];
      let bestD = Infinity;
      for (const c of centers) {
        const d = (c.x - x) ** 2 + (c.y - y) ** 2;
        if (d < bestD) {
          best = c;
          bestD = d;
        }
      }
      let list = out.get(best.region);
      if (!list) {
        list = [];
        out.set(best.region, list);
      }
      list.push([x, y]);
    }
  }
  return out;
}

/** 海图上的一个天况标记。 */
export interface WeatherMark {
  /** 稳定的键（海区与格位置）：天况不变时同一个标记留在原处 */
  key: string;
  region: number;
  sky: SkyKind;
  /** 锚点（格坐标） */
  x: number;
  y: number;
  /** 云团外形 0–2 */
  variant: number;
  /** 漂移的相位 0..1（各标记错开，不会齐步走） */
  phase: number;
  /** 当天的风向（去向，0 = 北）：标记顺着它漂 */
  dir: number;
}

/** 在候选格里挑出 count 个彼此相距至少 gap、离中心至少 centerGap 的格（按确定的散列顺序，挑不够时放宽）。 */
function pick(cands: readonly [number, number][], count: number, center: RegionCenter | undefined, region: number): [number, number][] {
  if (count <= 0 || cands.length === 0) return [];
  const order = cands
    .map((p) => ({ p, h: hash32(`wx:${region}:${p[0]},${p[1]}`) }))
    .sort((a, b) => a.h - b.h || a.p[1] - b.p[1] || a.p[0] - b.p[0])
    .map((e) => e.p);
  const chosen: [number, number][] = [];
  const far = (p: readonly [number, number], gap: number) => chosen.every((q) => (q[0] - p[0]) ** 2 + (q[1] - p[1]) ** 2 >= gap * gap);
  const clear = (p: readonly [number, number], gap: number) => !center || (center.x - p[0]) ** 2 + (center.y - p[1]) ** 2 >= gap * gap;
  // 由严到宽三轮：先守住间距与中心留白，再只守一半间距，最后不设限
  for (const [gap, centerGap] of [
    [MARK_GAP, MARK_CENTER_GAP],
    [MARK_GAP / 2, MARK_CENTER_GAP / 2],
    [0, 0],
  ] as const) {
    for (const p of order) {
      if (chosen.length >= count) return chosen;
      if (chosen.includes(p)) continue;
      if (far(p, gap) && clear(p, centerGap)) chosen.push(p);
    }
  }
  return chosen;
}

/**
 * 各海区当天的天况标记：晴天没有；不认识的天况忽略；每个海区的个数见 markCount，
 * 总数超过上限 cap 时各海区按序号轮流取（先各取一个，再各取第二个……）。结果只由输入决定。
 */
export function weatherMarks(
  samples: ReadonlyMap<number, readonly [number, number][]>,
  weather: readonly RegionWeatherView[],
  centers: readonly RegionCenter[],
  cap = MAX_WEATHER_MARKS,
): WeatherMark[] {
  const byRegion = new Map<number, RegionWeatherView>();
  for (const w of weather) if (!byRegion.has(w.region)) byRegion.set(w.region, w);
  const perRegion: WeatherMark[][] = [];
  for (const region of [...byRegion.keys()].sort((a, b) => a - b)) {
    const w = byRegion.get(region);
    if (!w || !Object.prototype.hasOwnProperty.call(MARKS_PER_REGION, w.sky)) continue;
    const cands = samples.get(region) ?? [];
    const center = centers.find((c) => c.region === region);
    const cells = pick(cands, markCount(w.sky, cands.length), center, region);
    perRegion.push(
      cells.map(([x, y]) => {
        const h = hash32(`wxm:${region}:${x},${y}`);
        return {
          key: `${region}:${x},${y}`,
          region,
          sky: w.sky,
          x,
          y,
          variant: h % 3,
          phase: ((h >>> 8) % 1000) / 1000,
          dir: ((Math.round(Number.isFinite(w.wind_dir) ? w.wind_dir : 0) % 8) + 8) % 8,
        };
      }),
    );
  }
  const out: WeatherMark[] = [];
  const limit = Math.max(0, Math.floor(cap));
  for (let k = 0; out.length < limit; k++) {
    let any = false;
    for (const list of perRegion) {
      if (k >= list.length) continue;
      any = true;
      if (out.length >= limit) break;
      out.push(list[k]);
    }
    if (!any) break;
  }
  return out;
}

/** 标记在时刻 t（毫秒）的漂移：沿风的去向来回（锚点两侧各一半距离），两端淡入淡出。 */
export function driftOffset(t: number, dir: number, phase: number, travel: number): { dx: number; dy: number; alpha: number } {
  const u = ((((Number.isFinite(t) ? t : 0) / DRIFT_CYCLE_MS + phase) % 1) + 1) % 1;
  const along = Math.round((u - 0.5) * Math.max(0, travel));
  const [ux, uy] = WIND_DIRS[((Math.round(dir) % 8) + 8) % 8];
  const alpha = u < 0.2 ? u / 0.2 : u > 0.8 ? (1 - u) / 0.2 : 1;
  // “|| 0” 把 −0 规范成 0
  return { dx: ux * along || 0, dy: uy * along || 0, alpha };
}

/** 天况标记的签名：天况、风向与位置都不变时渲染器不必重排精灵。 */
export function marksSignature(marks: readonly WeatherMark[]): string {
  return marks.map((m) => `${m.key}:${m.sky}:${m.dir}`).join(";");
}
