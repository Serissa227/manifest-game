// 街景的昼夜与天气表现（EXPANSION.md §9.3）：亮灯比例、灯光晕、窗光泛光、炊烟、灯塔光束、雨雪雾叠加层、闪电、行人疏密。
// 全部是纯函数（或按图对象记忆化的纯函数），不碰 DOM；由 port.ts 在合成底图与每帧时调用。
import { P } from "../art/palette";
import { Px, rgba, type Rgba } from "../art/px";
import {
  applyFlash,
  drawBolt,
  drawFogLayer,
  drawRainLayer,
  drawSnowLayer,
  fogOffset,
  gradeColor,
  lightningAt,
  RAIN_FRAMES,
  SNOW_FRAMES,
  type FogBand,
  type TimeOfDay,
  type Weather,
} from "../art/scenery";
import { ditherHit, h2, mix } from "../art/scenery/util";

/** 一幅街景的外观：时段、天况与风。 */
export interface SceneLook {
  time: TimeOfDay;
  weather: Weather;
  /** 风的东西分量 −1..1（风的去向） */
  windX: number;
  /** 风力 0–10 */
  windStrength: number;
  /** 暴风雨时是否闪电 */
  lightning: boolean;
  /** 是否给出了天况（旧后端没有天气时为 false：寒冷港口冬季照旧飘小雪） */
  hasWeather: boolean;
}

/** 由街景参数得出外观；缺省为白天、晴、微风向东（与没有天气之前的画面一致）。 */
export function lookOf(p: { time?: TimeOfDay; weather?: Weather; windX?: number; windStrength?: number; lightning?: boolean }): SceneLook {
  const wx = Number.isFinite(p.windX) ? Math.max(-1, Math.min(1, p.windX as number)) : 1;
  const ws = Number.isFinite(p.windStrength) ? Math.max(0, Math.min(10, p.windStrength as number)) : 4.5;
  return { time: p.time ?? "day", weather: p.weather ?? "clear", windX: wx, windStrength: ws, lightning: p.lightning !== false, hasWeather: p.weather !== undefined };
}

/** 亮灯的比例（0–1）：夜里大多数窗户亮着，黄昏近半，黎明三成；白天只有阴雨、暴风雨时零星亮灯。 */
export function litShare(time: TimeOfDay, weather: Weather): number {
  if (time === "night") return 0.8;
  if (time === "dusk") return 0.45;
  if (time === "dawn") return 0.3;
  if (weather === "storm") return 0.35;
  if (weather === "rain" || weather === "snow" || weather === "fog") return 0.15;
  return 0;
}

/** 灯光晕的强度（0–1）：夜里最亮，黄昏、黎明减弱，白天只有阴雨时隐约可见。 */
export function glowStrength(time: TimeOfDay, weather: Weather): number {
  if (time === "night") return 1;
  if (time === "dusk") return 0.6;
  if (time === "dawn") return 0.45;
  if (weather === "storm") return 0.4;
  if (weather === "rain" || weather === "snow" || weather === "fog") return 0.25;
  return 0;
}

// ───────────────────────── 按图记忆化的几何 ─────────────────────────

const GLOW_A = rgba(P.lamp[1]);
const GLOW_B = rgba(P.lamp[2]);

const centers = new WeakMap<Px, readonly [number, number] | null>();

/** 图里灯光色像素的中心（没有灯光色时为 null）。 */
export function glowCenter(px: Px): readonly [number, number] | null {
  const hit = centers.get(px);
  if (hit !== undefined) return hit;
  let sx = 0;
  let sy = 0;
  let n = 0;
  for (let y = 0; y < px.h; y++) {
    for (let x = 0; x < px.w; x++) {
      const v = px.data[y * px.w + x];
      if (v === GLOW_A || v === GLOW_B) {
        sx += x;
        sy += y;
        n++;
      }
    }
  }
  const out = n ? ([Math.round(sx / n), Math.round(sy / n)] as const) : null;
  centers.set(px, out);
  return out;
}

const tops = new WeakMap<Px, readonly [number, number]>();

/** 图的最高点（最上一行不透明像素的中点）：炊烟从这里升起。 */
export function topPoint(px: Px): readonly [number, number] {
  const hit = tops.get(px);
  if (hit) return hit;
  let out: readonly [number, number] = [Math.floor(px.w / 2), 0];
  outer: for (let y = 0; y < px.h; y++) {
    let a = -1;
    let b = -1;
    for (let x = 0; x < px.w; x++) {
      if (px.data[y * px.w + x] & 0xff) {
        if (a < 0) a = x;
        b = x;
      }
    }
    if (a >= 0) {
      out = [Math.round((a + b) / 2), y];
      break outer;
    }
  }
  tops.set(px, out);
  return out;
}

const anchors = new WeakMap<Px, number>();

/** 图的立足点（最下一行不透明像素的中点 x）：旗杆翻转时以它为轴，旗杆不挪位置。 */
export function anchorX(px: Px): number {
  const hit = anchors.get(px);
  if (hit !== undefined) return hit;
  let out = Math.floor(px.w / 2);
  for (let y = px.h - 1; y >= 0; y--) {
    let a = -1;
    let b = -1;
    for (let x = 0; x < px.w; x++) {
      if (px.data[y * px.w + x] & 0xff) {
        if (a < 0) a = x;
        b = x;
      }
    }
    if (a >= 0) {
      out = Math.round((a + b) / 2);
      break;
    }
  }
  anchors.set(px, out);
  return out;
}

// ───────────────────────── 底图上的灯光 ─────────────────────────

/** 打包颜色按 k 向 c 混合（保留不透明度）。 */
function toward(v: Rgba, c: Rgba, k: number): Rgba {
  const ch = (s: number) => Math.round(((v >>> s) & 0xff) * (1 - k) + ((c >>> s) & 0xff) * k) & 0xff;
  return ((ch(24) << 24) | (ch(16) << 16) | (ch(8) << 8) | (v & 0xff)) >>> 0;
}

/** 窗光泛光：灯光色像素四周一圈淡淡的暖色（只在 mask 为 1 的城镇像素上），让亮窗在夜里“透”出光来。 */
export function bloom(px: Px, mask: Uint8Array, k: number): void {
  if (!(k > 0)) return;
  const d = px.data;
  const W = px.w;
  const H = px.h;
  const warm = rgba(P.lamp[0]);
  const touched = new Uint8Array(d.length);
  const glow = (v: Rgba) => v === GLOW_A || v === GLOW_B;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      if (!mask[i] || !glow(d[i])) continue;
      for (const [dx, dy] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ] as const) {
        const xx = x + dx;
        const yy = y + dy;
        if (xx < 0 || yy < 0 || xx >= W || yy >= H) continue;
        const j = yy * W + xx;
        if (touched[j] || !mask[j] || glow(d[j])) continue;
        touched[j] = 1;
      }
    }
  }
  for (let j = 0; j < d.length; j++) if (touched[j]) d[j] = toward(d[j], warm, 0.3 * k);
}

/**
 * 灯光晕：以 (cx, cy) 为心、半径 r 的一圈抖动暖光（越往外越稀），groundY 给出时在地面上再铺一片椭圆光斑。
 * k 为强度（0–1）。
 */
export function lightPool(px: Px, cx: number, cy: number, r: number, k: number, groundY?: number): void {
  if (!(k > 0) || r <= 0) return;
  const d = px.data;
  const W = px.w;
  const warm = rgba(P.lamp[1]);
  const soft = rgba(P.lamp[2]);
  for (let y = Math.floor(cy - r); y <= Math.ceil(cy + r); y++) {
    for (let x = Math.floor(cx - r); x <= Math.ceil(cx + r); x++) {
      if (!px.inBounds(x, y)) continue;
      const dist = Math.hypot(x + 0.5 - cx, y + 0.5 - cy);
      if (dist > r) continue;
      const frac = 1 - dist / r;
      const i = y * W + x;
      if (d[i] === warm || d[i] === soft) continue;
      if (ditherHit(x, y, frac * 0.9 * k)) d[i] = toward(d[i], warm, (0.16 + 0.26 * frac) * k);
    }
  }
  if (groundY === undefined) return;
  const rx = r * 1.3;
  const ry = Math.max(2, r * 0.28);
  for (let y = Math.floor(groundY - ry); y <= Math.ceil(groundY + ry); y++) {
    for (let x = Math.floor(cx - rx); x <= Math.ceil(cx + rx); x++) {
      if (!px.inBounds(x, y)) continue;
      const nx = (x + 0.5 - cx) / rx;
      const ny = (y + 0.5 - groundY) / ry;
      const e = 1 - nx * nx - ny * ny;
      if (e <= 0) continue;
      const i = y * W + x;
      if (ditherHit(x, y, e * k)) d[i] = toward(d[i], warm, 0.22 * k);
    }
  }
}

// ───────────────────────── 每帧：炊烟、灯塔光束 ─────────────────────────

/**
 * 炊烟：每个烟源升起一串烟团（一缕连续的烟柱），越往上越大越淡，朝风的去向飘散（风越大越斜）。
 * sources 为 x, y 交替的烟源坐标；暴风雨时不冒烟，雨雪天烟少。
 */
export function drawSmoke(px: Px, sources: ArrayLike<number>, frame: number, look: SceneLook): void {
  if (look.weather === "storm" || sources.length === 0) return;
  const puffs = look.weather === "rain" || look.weather === "snow" ? 6 : 10;
  // 浅灰的烟、偏暗的背光面：落在浅色墙面前与蓝天上都看得见
  const lite = gradeColor(mix(P.stone[3], P.stone[4], 0.35), look.time, look.weather);
  const base = gradeColor(P.stone[3], look.time, look.weather);
  const deep = gradeColor(mix(P.stone[2], P.stone[3], 0.4), look.time, look.weather);
  const lean = (look.windX === 0 ? 0.12 : look.windX) * (0.18 + look.windStrength * 0.06);
  const LIFE = 50;
  const W = px.w;
  for (let s = 0; s < sources.length; s += 2) {
    const sx = sources[s];
    const sy = sources[s + 1];
    const seed = h2(0x5305, sx, sy);
    for (let k = puffs - 1; k >= 0; k--) {
      const age = (frame * 0.6 + k * (LIFE / puffs) + seed * LIFE) % LIFE;
      const fade = age / LIFE;
      const rise = age * 0.6;
      const wob = Math.sin((age + seed * 20) / 6) * (0.4 + fade);
      const cx = sx + age * lean + wob;
      const cy = sy - 1 - rise;
      const r = 0.8 + age / 18;
      const strength = 0.8 * (1 - fade) ** 0.8;
      for (let y = Math.floor(cy - r); y <= Math.ceil(cy + r); y++) {
        for (let x = Math.floor(cx - r); x <= Math.ceil(cx + r); x++) {
          if (x < 0 || y < 0 || x >= W || y >= px.h) continue;
          const dx = x + 0.5 - cx;
          const dy = y + 0.5 - cy;
          const d = Math.hypot(dx, dy);
          if (d > r) continue;
          // 越老越稀疏：用有序抖动剔掉一部分像素，烟团边缘也更稀
          if (!ditherHit(x, y, (1 - fade * 0.7) * (d > r - 0.8 ? 0.6 : 1))) continue;
          const i = y * W + x;
          const c = dx + dy < -r * 0.5 ? lite : dx + dy > r * 0.6 ? deep : base;
          px.data[i] = toward(px.data[i], c, strength);
        }
      }
    }
  }
}

/**
 * 灯塔：灯室亮起，光束左右扫过（40 帧一圈），光束只画在遮罩为 0 的天空与海面上。k 为强度。
 */
export function drawBeacon(px: Px, bx: number, by: number, frame: number, k: number, mask: Uint8Array): void {
  if (!(k > 0)) return;
  const W = px.w;
  const warm = rgba(P.lamp[2]);
  const soft = rgba(P.lamp[1]);
  px.put(bx, by, warm).put(bx - 1, by, soft).put(bx + 1, by, soft);
  const a = ((frame % 40) / 40) * Math.PI * 2;
  const len = Math.round(Math.cos(a) * 30);
  const dir = Math.sign(len);
  const n = Math.abs(len);
  for (let i = 2; i <= n; i++) {
    const x = bx + dir * i;
    const fade = 1 - i / (n + 1);
    for (const [dy, kk] of [
      [0, 0.55],
      [-1, 0.25],
      [1, 0.25],
    ] as const) {
      const y = by + dy + Math.round((i * Math.sin(a)) / 10);
      if (x < 0 || x >= W || y < 0 || y >= px.h) continue;
      const j = y * W + x;
      if (mask[j]) continue;
      if (dy !== 0 && !ditherHit(x, y, fade)) continue;
      px.data[j] = toward(px.data[j], warm, kk * fade * k);
    }
  }
}

// ───────────────────────── 每帧：雨、雪、雾、闪电 ─────────────────────────

/** 稀疏的叠加层：不透明度非零的像素下标与颜色（雨丝、雪花只占画面的一小部分，这样贴图更快、占内存更少）。 */
interface Sparse {
  idx: Int32Array;
  col: Uint32Array;
}

function sparseOf(p: Px): Sparse {
  let n = 0;
  for (const v of p.data) if (v & 0xff) n++;
  const idx = new Int32Array(n);
  const col = new Uint32Array(n);
  let k = 0;
  for (let i = 0; i < p.data.length; i++) {
    const v = p.data[i];
    if (!(v & 0xff)) continue;
    idx[k] = i;
    col[k] = v;
    k++;
  }
  return { idx, col };
}

const sparseCache = new Map<string, Sparse>();
const SPARSE_LIMIT = 96;

function sparseMemo(key: string, make: () => Px): Sparse {
  const hit = sparseCache.get(key);
  if (hit) {
    sparseCache.delete(key);
    sparseCache.set(key, hit);
    return hit;
  }
  const s = sparseOf(make());
  sparseCache.set(key, s);
  if (sparseCache.size > SPARSE_LIMIT) {
    const oldest = sparseCache.keys().next().value;
    if (oldest !== undefined) sparseCache.delete(oldest);
  }
  return s;
}

/** 半透明混合（目标不透明）。 */
function over(dst: Rgba, src: Rgba): Rgba {
  const a = (src & 0xff) / 255;
  if (a >= 1) return src;
  const ch = (s: number) => Math.round(((src >>> s) & 0xff) * a + ((dst >>> s) & 0xff) * (1 - a)) & 0xff;
  return ((ch(24) << 24) | (ch(16) << 16) | (ch(8) << 8) | 0xff) >>> 0;
}

function applySparse(px: Px, s: Sparse): void {
  const d = px.data;
  for (let k = 0; k < s.idx.length; k++) {
    const i = s.idx[k];
    d[i] = over(d[i], s.col[k]);
  }
}

/** 风的东西分量量化成 5 档（叠加层按档缓存）。 */
function windStep(wx: number): number {
  return Math.round(Math.max(-1, Math.min(1, wx)) * 2) / 2;
}

/** 雾带：远处一条（画在城镇之后）、近处两条薄雾（压在画面上，但很淡，不挡建筑）。 */
export interface FogPlan {
  far: readonly FogBand[];
  near: readonly FogBand[];
}

const fogTex = new Map<string, Px>();

function fogTexture(w: number, h: number, time: TimeOfDay, bands: readonly FogBand[], tag: string): Px {
  const key = `${w}|${h}|${time}|${tag}`;
  const hit = fogTex.get(key);
  if (hit) return hit;
  const p = drawFogLayer(w, h, { time, bands });
  fogTex.set(key, p);
  if (fogTex.size > 8) {
    const oldest = fogTex.keys().next().value;
    if (oldest !== undefined) fogTex.delete(oldest);
  }
  return p;
}

/** 把横向循环的雾图按平移量贴上（只处理雾带所在的行；behind 给出时只画在遮罩为 0 处）。 */
function blitFog(px: Px, tex: Px, off: number, bands: readonly FogBand[], behind?: Uint8Array): void {
  const W = px.w;
  const d = px.data;
  let y0 = px.h;
  let y1 = 0;
  for (const b of bands) {
    y0 = Math.min(y0, Math.floor(b.cy - b.hh * 2.2));
    y1 = Math.max(y1, Math.ceil(b.cy + b.hh * 2.2));
  }
  y0 = Math.max(0, y0);
  y1 = Math.min(px.h - 1, y1);
  for (let y = y0; y <= y1; y++) {
    const row = y * tex.w + off;
    for (let x = 0; x < W; x++) {
      const v = tex.data[row + x];
      if (!(v & 0xff)) continue;
      const i = y * W + x;
      if (behind && behind[i]) continue;
      d[i] = over(d[i], v);
    }
  }
}

/**
 * 每帧的天气叠加：雨丝（暴风雨更密更斜）、雪花、雾带、闪电提亮与远处的闪电。
 * mask 为城镇遮罩（远处的雾与闪电只画在天空处）；fog 为雾带的位置（按街景构图给出）。
 */
export function weatherOverlay(px: Px, look: SceneLook, frame: number, mask: Uint8Array, fog: FogPlan): void {
  const W = px.w;
  const H = px.h;
  const { time, weather } = look;
  const wx = windStep(look.windX === 0 ? 0.2 : look.windX);
  if (weather === "fog") {
    const dir = look.windX < 0 ? -1 : 1;
    const far = fogTexture(W, H, time, fog.far, "far");
    blitFog(px, far, fogOffset(frame, dir, 3), fog.far, mask);
    const near = fogTexture(W, H, time, fog.near, "near");
    blitFog(px, near, fogOffset(frame, dir, 2), fog.near);
  }
  if (weather === "rain" || weather === "storm") {
    const heavy = weather === "storm";
    const f = ((frame % RAIN_FRAMES) + RAIN_FRAMES) % RAIN_FRAMES;
    applySparse(px, sparseMemo(`rain|${W}|${H}|${time}|${heavy}|${wx}|${f}`, () => drawRainLayer(W, H, f, { time, heavy, windX: wx })));
  }
  if (weather === "snow") {
    // 雪每 2 帧落一格（10 fps 下每秒 5 格，飘得慢）
    const f = ((Math.floor(frame / 2) % SNOW_FRAMES) + SNOW_FRAMES) % SNOW_FRAMES;
    applySparse(px, sparseMemo(`snow|${W}|${H}|${time}|${wx}|${f}`, () => drawSnowLayer(W, H, f, { time, windX: wx })));
  }
  if (weather === "storm" && look.lightning) {
    const k = lightningAt(frame, 10);
    if (k > 0) {
      if (k >= 0.15) {
        // 远处的一道闪电：只画在天空里
        const c = Math.floor(frame / 50);
        const bolt = drawBolt(c, 34 + Math.floor(h2(0xb017, c) * 24));
        const bx = Math.floor(h2(0xb018, c) * Math.max(1, W - bolt.w));
        for (let y = 0; y < bolt.h; y++) {
          for (let x = 0; x < bolt.w; x++) {
            const v = bolt.data[y * bolt.w + x];
            const i = (y + 4) * W + bx + x;
            if (!(v & 0xff) || mask[i]) continue;
            px.data[i] = over(px.data[i], v);
          }
        }
      }
      applyFlash(px, k);
    }
  }
}

/** 行人疏密：夜里、雨雪与暴风雨时街上的人少一些（按行人序号确定性地挑出留在街上的人）。 */
export function keepWalker(i: number, look: SceneLook): boolean {
  let keep = 1;
  if (look.time === "night") keep = 0.4;
  else if (look.time === "dawn") keep = 0.6;
  if (look.weather === "storm") keep = Math.min(keep, 0.25);
  else if (look.weather === "rain" || look.weather === "snow") keep = Math.min(keep, 0.6);
  return keep >= 1 || h2(0x3a1c, i) < keep;
}

/** 海鸥：夜里与暴风雨时不飞，雨雪天只剩一只。 */
export function gullCount(n: number, look: SceneLook): number {
  if (look.time === "night" || look.weather === "storm") return 0;
  if (look.weather === "rain" || look.weather === "snow") return Math.min(1, n);
  return n;
}

/** 舞台比街景高时向上延伸的天空颜色：按时段与天况取天空最上方的颜色再压深一点。 */
export function skyDeepColor(top: Rgba): Rgba {
  return toward(top, rgba(P.night[0]), 0.25);
}

/** 两张同尺寸的图按 t 混合：dst = dst·(1 − t) + other·t（时段、天况切换时的淡入淡出）。 */
export function crossfade(dst: Px, other: Px, t: number): void {
  if (dst.w !== other.w || dst.h !== other.h || !(t > 0)) return;
  const d = dst.data;
  const o = other.data;
  const k = Math.min(1, t);
  const k1 = 1 - k;
  for (let i = 0; i < d.length; i++) {
    const a = d[i];
    const b = o[i];
    if (a === b) continue;
    const r = ((a >>> 24) & 0xff) * k1 + ((b >>> 24) & 0xff) * k;
    const g = ((a >>> 16) & 0xff) * k1 + ((b >>> 16) & 0xff) * k;
    const bl = ((a >>> 8) & 0xff) * k1 + ((b >>> 8) & 0xff) * k;
    d[i] = (((r & 0xff) << 24) | ((g & 0xff) << 16) | ((bl & 0xff) << 8) | 0xff) >>> 0;
  }
}

/**
 * 外观切换的淡入淡出：记住上一次画的外观，外观变了就在 frames 帧内从旧外观过渡到新外观（街景 10 fps 时 8 帧 ≈ 0.8 秒）。
 * step 返回本帧还要混入的旧外观（没有过渡时为 null）与新外观所占的比例 t。
 */
export class LookFader<T> {
  private curKey: string | null = null;
  private prev: T | null = null;
  private cur: T | null = null;
  private start = 0;

  constructor(readonly frames: number) {}

  step(key: string, look: T, frame: number): { prev: T | null; t: number } {
    if (this.curKey === null) {
      this.curKey = key;
      this.cur = look;
      return { prev: null, t: 1 };
    }
    if (key !== this.curKey) {
      // 过渡途中又变了：从当前画面上的旧外观重新开始过渡
      this.prev = this.cur;
      this.curKey = key;
      this.start = frame;
    }
    this.cur = look;
    if (this.prev === null) return { prev: null, t: 1 };
    const t = (frame - this.start + 1) / (this.frames + 1);
    if (frame < this.start || t >= 1) {
      this.prev = null;
      return { prev: null, t: 1 };
    }
    return { prev: this.prev, t };
  }
}
