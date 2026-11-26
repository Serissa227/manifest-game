// 天气特效：航海图按海区画当天的天气，玩家所在处另有全画面的雨幕、压暗与闪电。
// 这里是纯函数与不碰画布的小状态机（便于单元测试）；画法在 map/weatherLayer.ts（PixiJS，海图上按海区，地点与舰队标记之下）
// 与 components/WeatherScreen.tsx（2D 画布，整个海图视口，航行 HUD 之下）。
//
// 各天况：
// - 暴风雨：压暗（夜航的深蓝）、密集的斜雨、偶尔的闪电照亮（闪白很短：亮 70 ms、暗 60 ms、再弱亮 50 ms；两次至少隔 5 秒）；
// - 雨：轻一些的压暗与稀疏的斜雨，不闪电；
// - 雾：一层淡雾（浅灰白）；
// - 雪：极淡的一层与缓缓飘落的雪片；
// - 晴、多云：不加东西（多云照旧只有云团标记）。
// 像素风：海区边缘分几级台阶渐淡（不用抖动噪点），雨线、雪片与闪电都画在整像素上。
// 防闪烁与无障碍：4× 及以上不闪电（与航行小画面同一规则）；系统要求减少动态效果时只留静止的压暗与雨线、不闪电；
// 设置里“天气特效”关掉时都不画（海图上的天况小标记照旧）。
import { P } from "../art/palette";
import type { Overview, RegionWeatherView, SkyKind } from "../ipc/types";
import { dayLengthMs, MIN_CYCLE_DAY_MS } from "../time/daylight";
import { isSea, type ChartGrid, type RegionCenter } from "./weather";

// ───────────────────────────── 各天况的效果 ─────────────────────────────

/** 有特效的天况（晴与多云没有）。 */
export type FxSky = "storm" | "rain" | "fog" | "snow";
export const FX_SKIES: readonly FxSky[] = ["storm", "rain", "fog", "snow"];

/** "#rrggbb" → 0xRRGGBB（PixiJS 的 tint）。 */
export function hexColor(c: string): number {
  return Number.parseInt(c.slice(1, 7), 16);
}

/** 海图上一个海区的天气效果。 */
export interface SkyFx {
  /** 压暗或雾的颜色（0xRRGGBB） */
  tint: number;
  /** 海区里最浓处的不透明度（边缘按台阶渐淡） */
  shade: number;
  /** 降水：雨线、雪片，或没有 */
  fall: "rain" | "snow" | null;
  /** 降水的密度 0..1（暴风雨为 1） */
  density: number;
  /** 雨线更长、更斜、落得更快（暴风雨） */
  heavy: boolean;
  /** 偶尔的闪电照亮 */
  lightning: boolean;
}

export const SKY_FX: Readonly<Record<FxSky, SkyFx>> = {
  storm: { tint: hexColor(P.night[1]), shade: 0.34, fall: "rain", density: 1, heavy: true, lightning: true },
  rain: { tint: hexColor(P.slate[1]), shade: 0.15, fall: "rain", density: 0.45, heavy: false, lightning: false },
  fog: { tint: hexColor(P.snow[2]), shade: 0.24, fall: null, density: 0, heavy: false, lightning: false },
  snow: { tint: hexColor(P.snow[1]), shade: 0.1, fall: "snow", density: 0.55, heavy: false, lightning: false },
};

function isFxSky(sky: unknown): sky is FxSky {
  return typeof sky === "string" && (FX_SKIES as readonly string[]).includes(sky);
}

/** 某天况在海图上的效果；晴、多云与不认识的天况为 null（不加东西）。 */
export function skyFx(sky: unknown): SkyFx | null {
  return isFxSky(sky) ? SKY_FX[sky] : null;
}

/** 这个速度下能不能闪电：一天短于 2 秒（4× 及以上）时不闪（与航行小画面、昼夜光影同一条防闪烁规则）；暂停时照常。 */
export function lightningAllowed(speed: number): boolean {
  return dayLengthMs(speed) >= MIN_CYCLE_DAY_MS;
}

// ───────────────────────────── 全画面效果 ─────────────────────────────

/** 玩家所在处的全画面效果。 */
export interface ScreenFx {
  sky: FxSky;
  /** 压暗的颜色（CSS） */
  tint: string;
  /** 视口中间与四边的不透明度：四边分三级台阶加深（像素风的暗角） */
  center: number;
  edge: number;
  /** 降水与密度 */
  fall: "rain" | "snow" | null;
  density: number;
  heavy: boolean;
  /** 闪电（已扣掉“减少动态效果”与 4× 及以上） */
  lightning: boolean;
  /** 静止：系统要求减少动态效果时只画一帧（压暗与雨线纹理），不动、不闪 */
  still: boolean;
}

const SCREEN_BASE: Readonly<Record<FxSky, Omit<ScreenFx, "sky" | "lightning" | "still">>> = {
  storm: { tint: P.night[0], center: 0.16, edge: 0.36, fall: "rain", density: 1, heavy: true },
  rain: { tint: P.slate[0], center: 0.05, edge: 0.2, fall: "rain", density: 0.45, heavy: false },
  fog: { tint: P.snow[2], center: 0.08, edge: 0.36, fall: null, density: 0, heavy: false },
  snow: { tint: P.snow[1], center: 0.03, edge: 0.14, fall: "snow", density: 0.55, heavy: false },
};

export interface ScreenFxOpts {
  /** 设置里的“天气特效”开着 */
  enabled: boolean;
  /** 系统要求减少动态效果 */
  reduced: boolean;
  /** 游戏速度（4× 及以上不闪电） */
  speed: number;
}

/** 全画面效果：天况为暴风雨、雨、雾、雪时有，晴与多云没有；开关关掉时没有。 */
export function screenFx(sky: SkyKind | null | undefined, opts: ScreenFxOpts): ScreenFx | null {
  if (!opts.enabled || !isFxSky(sky)) return null;
  const base = SCREEN_BASE[sky];
  return { sky, ...base, lightning: sky === "storm" && !opts.reduced && lightningAllowed(opts.speed), still: opts.reduced };
}

/**
 * 玩家此刻所处的天况（全画面效果用）：旗舰队（手动航行的世界里也是它）在海上时取它所在海区当天的天况
 * （后端的 local_weather；旧后端没有时按舰队所在格找最近的海区中心查 weather）。停泊在港、没有舰队、养成期为 null。
 */
export function playerSky(o: Overview | null | undefined): SkyKind | null {
  if (!o || o.mode === "upbringing") return null;
  const f = o.fleets?.[0];
  if (!f || f.docked !== null) return null;
  if (o.local_weather) return o.local_weather.sky;
  const list = o.weather ?? [];
  const centers = o.winds ?? [];
  if (list.length === 0 || centers.length === 0) return null;
  const x = f.pos?.x ?? f.x;
  const y = f.pos?.y ?? f.y;
  let best = centers[0];
  let bestD = Infinity;
  for (const c of centers) {
    const d = (c.x - x) ** 2 + (c.y - y) ** 2;
    if (d < bestD) {
      best = c;
      bestD = d;
    }
  }
  return list.find((w) => w.region === best.region)?.sky ?? null;
}

// ───────────────────────────── 海区的范围与渐淡 ─────────────────────────────

/** 海区范围位图的纹素数上限：超过时一个纹素管 2×2 格（大地图）。 */
export const FIELD_MAX_TEXELS = 200_000;
/** 海区边缘渐淡的半宽（格）。 */
export const EDGE_CELLS = 3;
/** 渐淡的台阶数（不用抖动：一级一级地淡下去）。 */
export const EDGE_LEVELS = 4;

/** 一个纹素管几格：经典世界一格一个，大地图 2×2 格一个。 */
export function fieldStep(width: number, height: number): number {
  return width * height > FIELD_MAX_TEXELS ? 2 : 1;
}

/** 海区的范围：每个纹素归给最近的海区中心（与天况标记同一个划分办法），另记它是不是海。 */
export interface RegionField {
  /** 一个纹素管几格 */
  step: number;
  w: number;
  h: number;
  /** 纹素所属海区在 ids 里的下标（陆地也归给最近的海区：渐淡不在海岸处断开） */
  owner: Int16Array;
  /** 纹素是不是海（管的格里海格过半） */
  sea: Uint8Array;
  /** 海区序号 */
  ids: readonly number[];
  /** 东西相连（渐淡与最近中心都按环绕算） */
  wrap: boolean;
  /** 海区中心的签名：中心不变时不必重算 */
  key: string;
}

/** 海区中心的签名。 */
export function centersKey(centers: readonly RegionCenter[]): string {
  return centers.map((c) => `${c.region}@${c.x},${c.y}`).join(";");
}

/**
 * 算出海区的范围（只在海区中心变了时算一次：大地图约十万个纹素）。frame：海图四周画框压着的格数——画框上不画天气
 * （环绕地图的画框只有上下两边）。
 */
export function regionField(
  grid: ChartGrid,
  centers: readonly RegionCenter[],
  wrap = false,
  step = fieldStep(grid.width, grid.height),
  frame = 0,
): RegionField {
  const s = Math.max(1, Math.floor(step));
  const f = Math.max(0, Math.floor(frame));
  const framed = (x: number, y: number) => y < f || y >= grid.height - f || (!wrap && (x < f || x >= grid.width - f));
  const w = Math.max(1, Math.ceil(grid.width / s));
  const h = Math.max(1, Math.ceil(grid.height / s));
  const owner = new Int16Array(w * h).fill(-1);
  const sea = new Uint8Array(w * h);
  for (let ty = 0; ty < h; ty++) {
    for (let tx = 0; tx < w; tx++) {
      let n = 0;
      let seaN = 0;
      for (let dy = 0; dy < s; dy++) {
        for (let dx = 0; dx < s; dx++) {
          const x = tx * s + dx;
          const y = ty * s + dy;
          if (x >= grid.width || y >= grid.height) continue;
          n++;
          if (isSea(grid, x, y) && !framed(x, y)) seaN++;
        }
      }
      const i = ty * w + tx;
      sea[i] = seaN > 0 && seaN * 2 >= n ? 1 : 0;
      const cx = tx * s + (s - 1) / 2;
      const cy = ty * s + (s - 1) / 2;
      let best = -1;
      let bestD = Infinity;
      centers.forEach((c, k) => {
        let dx = Math.abs(c.x - cx);
        if (wrap) dx = Math.min(dx, grid.width - dx);
        const d = dx * dx + (c.y - cy) ** 2;
        if (d < bestD) {
          best = k;
          bestD = d;
        }
      });
      owner[i] = best;
    }
  }
  return { step: s, w, h, owner, sea, ids: centers.map((c) => c.region), wrap, key: centersKey(centers) };
}

/** 方框模糊（横向按环绕或夹边，纵向夹边），原地修改。 */
function boxBlur(a: Float32Array, w: number, h: number, r: number, wrap: boolean): void {
  const tmp = new Float32Array(a.length);
  const k = 1 / (2 * r + 1);
  const ix = (x: number) => (wrap ? ((x % w) + w) % w : Math.max(0, Math.min(w - 1, x)));
  const iy = (y: number) => Math.max(0, Math.min(h - 1, y));
  for (let y = 0; y < h; y++) {
    const row = y * w;
    let sum = 0;
    for (let d = -r; d <= r; d++) sum += a[row + ix(d)];
    for (let x = 0; x < w; x++) {
      tmp[row + x] = sum * k;
      sum += a[row + ix(x + r + 1)] - a[row + ix(x - r)];
    }
  }
  for (let x = 0; x < w; x++) {
    let sum = 0;
    for (let d = -r; d <= r; d++) sum += tmp[iy(d) * w + x];
    for (let y = 0; y < h; y++) {
      a[y * w + x] = sum * k;
      sum += tmp[iy(y + r + 1) * w + x] - tmp[iy(y - r) * w + x];
    }
  }
}

/** 降水的种类（WeatherPaint.fall）。 */
export const FALL_NONE = 0;
export const FALL_RAIN = 1;
export const FALL_STORM = 2;
export const FALL_SNOW = 3;
export type FallKind = typeof FALL_RAIN | typeof FALL_STORM | typeof FALL_SNOW;

/** 一天的天气画成的位图（按纹素）：压暗与雾、暴风雨的范围（闪电照亮）、降水的种类与浓度、风的东西向。 */
export interface WeatherPaint {
  w: number;
  h: number;
  step: number;
  /** 压暗与雾（RGBA，直通不透明度）；只在海上 */
  rgba: Uint8ClampedArray<ArrayBuffer>;
  /** 暴风雨的范围 0..255（闪电照亮的遮罩）；只在海上 */
  storm: Uint8Array;
  /** 降水的种类（FALL_*）；只在海上 */
  fall: Uint8Array;
  /** 降水的浓度 0..255（海区边缘按台阶渐淡） */
  level: Uint8Array;
  /** 风的东西向 −1 / 0 / 1（雨线朝风的去向斜落） */
  wind: Int8Array;
  /** 有没有任何效果、暴风雨、降水 */
  any: boolean;
  storms: boolean;
  falls: boolean;
}

/** 风的去向 0–7 → 东西向（东北、东、东南为 1，西南、西、西北为 −1，正北正南为 0）。 */
export function windSide(dir: number): -1 | 0 | 1 {
  const d = ((Math.floor(Number.isFinite(dir) ? dir : 0) % 8) + 8) % 8;
  if (d === 0 || d === 4) return 0;
  return d < 4 ? 1 : -1;
}

/** 当天天气的签名：各海区的天况与风向不变时不必重画。 */
export function weatherSignature(weather: readonly RegionWeatherView[]): string {
  return [...weather]
    .sort((a, b) => a.region - b.region)
    .map((w) => `${w.region}:${w.sky}:${windSide(w.wind_dir)}`)
    .join(";");
}

/** 把渐淡后的浓度量化成 EDGE_LEVELS 级台阶。 */
export function stepLevel(v: number): number {
  return Math.max(0, Math.min(1, Math.round(v * EDGE_LEVELS) / EDGE_LEVELS));
}

/** 把当天各海区的天气画成位图（海区边缘分几级台阶渐淡；陆地不画）。 */
export function paintWeather(field: RegionField, weather: readonly RegionWeatherView[]): WeatherPaint {
  const { w, h } = field;
  const n = w * h;
  const byRegion = new Map<number, RegionWeatherView>();
  for (const r of weather) if (!byRegion.has(r.region)) byRegion.set(r.region, r);
  const skyOf = field.ids.map((id) => {
    const sky = byRegion.get(id)?.sky;
    return isFxSky(sky) ? sky : null;
  });
  const windOf = field.ids.map((id) => windSide(byRegion.get(id)?.wind_dir ?? 0));
  // 每种天况一张浓度图：海区里为 1，边缘向外渐淡（陆地也参与：海岸处不断开）
  const levels = new Map<FxSky, Float32Array>();
  const r = Math.max(1, Math.round(EDGE_CELLS / field.step));
  for (const sky of FX_SKIES) {
    if (!skyOf.includes(sky)) continue;
    const a = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const o = field.owner[i];
      a[i] = o >= 0 && skyOf[o] === sky ? 1 : 0;
    }
    // 两遍方框模糊约等于一个三角形的核：边缘过渡更圆
    boxBlur(a, w, h, r, field.wrap);
    boxBlur(a, w, h, r, field.wrap);
    for (let i = 0; i < n; i++) a[i] = stepLevel(a[i]);
    levels.set(sky, a);
  }
  const rgba = new Uint8ClampedArray(n * 4);
  const storm = new Uint8Array(n);
  const fall = new Uint8Array(n);
  const level = new Uint8Array(n);
  const wind = new Int8Array(n);
  let any = false;
  let storms = false;
  let falls = false;
  const stormLv = levels.get("storm");
  for (let i = 0; i < n; i++) {
    if (!field.sea[i]) continue;
    // 压暗：几种天况在边缘交界处取最浓的一种
    let best: FxSky | null = null;
    let bestA = 0;
    for (const [sky, a] of levels) {
      const v = a[i] * SKY_FX[sky].shade;
      if (v > bestA) {
        best = sky;
        bestA = v;
      }
    }
    if (best) {
      const tint = SKY_FX[best].tint;
      rgba[i * 4] = (tint >>> 16) & 0xff;
      rgba[i * 4 + 1] = (tint >>> 8) & 0xff;
      rgba[i * 4 + 2] = tint & 0xff;
      rgba[i * 4 + 3] = Math.round(bestA * 255);
      any = true;
    }
    if (stormLv && stormLv[i] > 0) {
      storm[i] = Math.round(stormLv[i] * 255);
      storms = true;
    }
    // 降水：按所属海区的天况落，浓度取那种天况在这里的渐淡
    const o = field.owner[i];
    const sky = o >= 0 ? skyOf[o] : null;
    const fx = sky ? SKY_FX[sky] : null;
    if (sky && fx?.fall) {
      const lv = levels.get(sky)?.[i] ?? 0;
      if (lv > 0) {
        fall[i] = fx.fall === "snow" ? FALL_SNOW : fx.heavy ? FALL_STORM : FALL_RAIN;
        level[i] = Math.round(lv * fx.density * 255);
        wind[i] = windOf[o];
        falls = true;
      }
    }
  }
  return { w, h, step: field.step, rgba, storm, fall, level, wind, any, storms, falls };
}

/** 海图坐标（海图像素，环绕地图可以越出 0..MW）处的纹素下标；越界为 −1。cell 为每格的海图像素。 */
export function texelAt(paint: Pick<WeatherPaint, "w" | "h" | "step">, px: number, py: number, cell: number, wrapW?: number): number {
  const size = cell * paint.step;
  let tx = Math.floor(px / size);
  const ty = Math.floor(py / size);
  if (wrapW !== undefined) tx = ((tx % paint.w) + paint.w) % paint.w;
  if (tx < 0 || ty < 0 || tx >= paint.w || ty >= paint.h) return -1;
  return ty * paint.w + tx;
}

// ───────────────────────────── 雨线与雪片 ─────────────────────────────

/** 一条雨线或一片雪。坐标与速度的单位由调用方定（全画面：画布像素；海图：海图像素）。 */
export interface Drop {
  x: number;
  y: number;
  vx: number;
  vy: number;
  age: number;
  life: number;
  kind: FallKind;
  /** 近处（亮、长、快）或远处 */
  near: boolean;
  /** 雨线的长度（像素）、斜度（每落 run 像素侧移 1 像素）与朝向 */
  len: number;
  run: number;
  dir: 1 | -1;
}

/** 新的一滴落在哪里、什么样。 */
export interface DropSpawn {
  x: number;
  y: number;
  kind: FallKind;
  /** 风的东西向 −1 / 0 / 1 */
  wind: number;
}

/** 雨线的形状：远处短，近处长；暴风雨更长、更斜（每落 2 像素侧移 1），雨每落 3 像素侧移 1；没有东西风时略向东斜。 */
export function dropShape(kind: FallKind, near: boolean, wind: number, rnd: number): { len: number; run: number; dir: 1 | -1 } {
  const dir: 1 | -1 = wind < 0 ? -1 : 1;
  if (kind === FALL_SNOW) return { len: 1, run: 1, dir };
  const storm = kind === FALL_STORM;
  const [lo, hi] = near ? (storm ? [8, 12] : [5, 7]) : storm ? [4, 6] : [3, 4];
  return { len: lo + Math.floor(rnd * (hi - lo + 1)), run: storm ? 2 : wind === 0 ? 4 : 3, dir };
}

/** 下落的速度（像素/秒）。 */
export function dropSpeed(kind: FallKind, near: boolean): number {
  if (kind === FALL_SNOW) return near ? 34 : 20;
  if (kind === FALL_STORM) return near ? 430 : 270;
  return near ? 310 : 200;
}

/** 一滴的寿命（毫秒）范围。 */
function dropLife(kind: FallKind): readonly [number, number] {
  if (kind === FALL_SNOW) return [2200, 4200];
  return kind === FALL_STORM ? [220, 440] : [260, 520];
}

/** 一帧最长按这么多毫秒推进（页面切回来时不一下子跳很远）。 */
export const MAX_STEP_MS = 100;

/**
 * 雨线与雪片的池子：到寿的在新的地方重生，活着的多于目标数时到寿的不再重生；新的一滴分几帧补上（不会齐步）。
 * rng 可以换成固定种子的伪随机数（测试用）。
 */
export class DropPool {
  readonly drops: Drop[] = [];
  constructor(private readonly rng: () => number = Math.random) {}

  clear(): void {
    this.drops.length = 0;
  }

  private make(s: DropSpawn, fresh: boolean): Drop {
    const near = this.rng() < 0.45;
    const shape = dropShape(s.kind, near, s.wind, this.rng());
    const vy = dropSpeed(s.kind, near);
    // 雨顺着雨线的斜度落（每落 run 像素侧移 1 像素）；雪顺着风缓缓飘
    const vx = s.kind === FALL_SNOW ? s.wind * 8 + (this.rng() - 0.5) * 6 : (shape.dir * vy) / shape.run;
    const [lo, hi] = dropLife(s.kind);
    const life = lo + this.rng() * (hi - lo);
    // 第一次铺满时各滴的年龄错开，不会同时到寿、同时重生
    return { x: s.x, y: s.y, vx, vy, age: fresh ? this.rng() * life * 0.8 : 0, life, kind: s.kind, near, ...shape };
  }

  /**
   * 推进 dtMs 毫秒：移动（速度乘 unit：每“特效像素”合多少坐标单位）、到寿的重生、补到 target 滴。
   * spawn 返回 null 时这一滴这一帧先不出现。
   */
  step(dtMs: number, target: number, spawn: (rng: () => number) => DropSpawn | null, unit = 1): void {
    const dt = Math.max(0, Math.min(MAX_STEP_MS, Number.isFinite(dtMs) ? dtMs : 0));
    const want = Math.max(0, Math.floor(target));
    const k = (dt / 1000) * unit;
    for (const d of this.drops) {
      d.age += dt;
      d.x += d.vx * k;
      d.y += d.vy * k;
    }
    for (let i = this.drops.length - 1; i >= 0; i--) {
      const d = this.drops[i];
      if (d.age < d.life) continue;
      const s = this.drops.length > want ? null : spawn(this.rng);
      if (s) this.drops[i] = this.make(s, false);
      else {
        this.drops[i] = this.drops[this.drops.length - 1];
        this.drops.pop();
      }
    }
    // 补上缺的：每帧最多补八分之一，几帧内铺满
    const add = Math.min(want - this.drops.length, Math.max(4, Math.ceil(want / 8)));
    for (let j = 0; j < add; j++) {
      const s = spawn(this.rng);
      if (s) this.drops.push(this.make(s, true));
    }
  }
}

// ───────────────────────────── 闪电 ─────────────────────────────

/** 两次闪电之间的间隔（毫秒）：5–13 秒，不规则。 */
export const FLASH_GAP_MS: readonly [number, number] = [5000, 13000];
/** 一次闪电的节奏：[持续毫秒, 亮度 0..1]——先亮、暗一下、再弱弱地亮一下。闪白很短，不晃眼。 */
export const FLASH_PATTERN: readonly (readonly [number, number])[] = [
  [70, 1],
  [60, 0],
  [50, 0.5],
];
/** 一次闪电的总时长（毫秒）。 */
export const FLASH_MS = FLASH_PATTERN.reduce((s, [ms]) => s + ms, 0);

/** 闪电开始后 t 毫秒的亮度 0..1。 */
export function flashStrength(t: number): number {
  if (!(t >= 0)) return 0;
  let at = 0;
  for (const [ms, v] of FLASH_PATTERN) {
    if (t < at + ms) return v;
    at += ms;
  }
  return 0;
}

/**
 * 闪电的时钟：每隔 5–13 秒闪一次（开头至少等 2.5 秒）。enabled 为假（减少动态效果、4× 及以上、开关关掉、看不见暴风雨）时不闪，
 * 正在闪的立即收住。seq 是第几次闪电（画法据此换一道闪电的位置与形状）。
 */
export class LightningClock {
  seq = 0;
  private wait: number;
  private at = -1;
  constructor(private readonly rng: () => number = Math.random) {
    this.wait = 2500 + this.rng() * (FLASH_GAP_MS[1] - 2500);
  }

  private gap(): number {
    return FLASH_GAP_MS[0] + this.rng() * (FLASH_GAP_MS[1] - FLASH_GAP_MS[0]);
  }

  /** 正在闪（含暗一下的那一段）。 */
  get flashing(): boolean {
    return this.at >= 0;
  }

  /** 下一次 step（能闪的话）立即闪一次（截图与调试用）。 */
  trigger(): void {
    if (this.at < 0) this.wait = 0;
  }

  /** 推进 dtMs 毫秒，返回这一帧的亮度 0..1。 */
  step(dtMs: number, enabled: boolean): number {
    const dt = Math.max(0, Math.min(MAX_STEP_MS, Number.isFinite(dtMs) ? dtMs : 0));
    if (!enabled) {
      this.at = -1;
      // 重新开着时至少再等一个最短间隔
      this.wait = Math.max(this.wait, FLASH_GAP_MS[0] / 2);
      return 0;
    }
    if (this.at >= 0) {
      this.at += dt;
      if (this.at >= FLASH_MS) {
        this.at = -1;
        this.wait = this.gap();
        return 0;
      }
      return flashStrength(this.at);
    }
    this.wait -= dt;
    if (this.wait > 0) return 0;
    this.at = 0;
    this.seq++;
    return flashStrength(0);
  }
}

// ───────────────────────────── 数量与画布的上限 ─────────────────────────────

/** 同时落着的雨线 / 雪片的上限：桌面 640、手机 220。 */
export const DROP_CAP = { desktop: 640, phone: 220 } as const;
/** 暴风雨里每多少 CSS 像素² 一条雨线（雨与雪按密度折减）。 */
export const CSS_AREA_PER_DROP = 2400;

/** 视口里同时落着的雨线数：随视口面积与密度增减，有上限（手机更少）；设备像素比高于 2 时按比例少画（每条的填充更贵）。 */
export function dropBudget(cssW: number, cssH: number, dpr: number, phone: boolean, density = 1): number {
  const cap = phone ? DROP_CAP.phone : DROP_CAP.desktop;
  const area = Math.max(0, cssW) * Math.max(0, cssH);
  const r = Number.isFinite(dpr) && dpr > 0 ? dpr : 1;
  const k = r > 2 ? 2 / r : 1;
  const d = Math.max(0, Math.min(1, Number.isFinite(density) ? density : 0));
  return Math.max(0, Math.round(Math.min(cap, area / CSS_AREA_PER_DROP) * d * k));
}

/** 全画面画布的像素数上限：桌面约 48 万、手机 16 万（大屏时一个像素块更大）。 */
export const SCREEN_MAX_PIXELS = { desktop: 480_000, phone: 160_000 } as const;

/** 全画面画布的尺寸：画布像素数 w × h，每个画布像素占 px × px 个设备像素（整数，像素块对齐），画布的 CSS 尺寸。 */
export interface ScreenCanvas {
  w: number;
  h: number;
  px: number;
  cssW: number;
  cssH: number;
}

/**
 * 全画面画布：一个像素块至少 2 个 CSS 像素（像素风的方块感，也省填充），按设备像素取整对齐；
 * 画布像素数超过上限时把像素块放大，直到不超过（手机的上限更低）。
 */
export function screenCanvas(cssW: number, cssH: number, dpr: number, phone: boolean): ScreenCanvas {
  const r = Number.isFinite(dpr) && dpr > 0 ? dpr : 1;
  if (!(cssW > 0) || !(cssH > 0)) return { w: 0, h: 0, px: Math.max(2, Math.round(2 * r)), cssW: 0, cssH: 0 };
  const devW = Math.max(1, Math.round(cssW * r));
  const devH = Math.max(1, Math.round(cssH * r));
  const cap = phone ? SCREEN_MAX_PIXELS.phone : SCREEN_MAX_PIXELS.desktop;
  let px = Math.max(2, Math.round(2 * r));
  while (Math.ceil(devW / px) * Math.ceil(devH / px) > cap) px++;
  const w = Math.ceil(devW / px);
  const h = Math.ceil(devH / px);
  return { w, h, px, cssW: (w * px) / r, cssH: (h * px) / r };
}

/**
 * 海图上雨线的“像素”（CSS 像素）：随镜头倍数取整，1–2。与全画面效果的像素块（2 个 CSS 像素）一样大，
 * 放得很大时也不至于成一根粗棍；缩得很小时 1 个像素。
 */
export function fxPixel(camScale: number): number {
  return Math.max(1, Math.min(2, Math.round(Number.isFinite(camScale) ? camScale : 1)));
}

/** 全画面压暗的暗角：画布像素 (x, y) 处是第几级（0 中间，3 最外圈）。四边分三级台阶，圆角矩形，不用渐变与抖动。 */
export function vignetteBand(x: number, y: number, w: number, h: number): number {
  const nx = Math.abs(((x + 0.5) / w) * 2 - 1);
  const ny = Math.abs(((y + 0.5) / h) * 2 - 1);
  // 超椭圆（圆角矩形）：四角比四边更暗一点
  const d = Math.pow(nx ** 4 + ny ** 4, 0.25);
  return d > 0.97 ? 3 : d > 0.9 ? 2 : d > 0.8 ? 1 : 0;
}

/** 暗角第 band 级的不透明度（中间 center，最外圈 edge，中间两级等分）。 */
export function vignetteAlpha(band: number, center: number, edge: number): number {
  const b = Math.max(0, Math.min(3, Math.floor(band)));
  return center + ((edge - center) * b) / 3;
}
