// 按时间与天气给整张图调色：黎明清冷偏粉、黄昏偏暖紫、夜晚压暗偏蓝；多云、雨、暴风雨去饱和压暗，雾蒙上一层灰白，雪天偏冷。
// 远景、树、地面、码头等不随时间变化的素材，由街景合成时统一调色；也可以只调单个颜色。
import { P } from "../palette";
import { Px, rgba, type Color, type Rgba } from "../px";
import type { TimeOfDay, Weather } from "./types";

interface Grade {
  /** 去饱和比例（0–1） */
  desat: number;
  /** 整体亮度倍数 */
  dim: number;
  /** 按时间的“乘 + 加” */
  mul: readonly number[];
  add: readonly number[];
  /** 雾：最后向雾色混合的比例与雾色 */
  haze: number;
  hazeRgb: readonly number[];
}

/** 雾色：随时段变化（白天灰白、黎明灰粉、黄昏灰紫、夜里深灰蓝）。 */
const FOG_RGB: Readonly<Record<TimeOfDay, readonly number[]>> = {
  day: [200, 208, 218],
  dawn: [196, 184, 202],
  dusk: [150, 124, 142],
  night: [44, 52, 80],
};

/** 调色参数：先按天气去饱和、压暗，再按时间做“乘 + 加”，雾天最后蒙一层雾色。 */
function params(time: TimeOfDay, weather: Weather): Grade {
  let desat = 0;
  let dim = 1;
  let haze = 0;
  let tint: readonly number[] = [1, 1, 1];
  switch (weather) {
    case "cloudy":
      desat = 0.28;
      dim = 0.9;
      break;
    case "storm":
      desat = 0.45;
      dim = 0.74;
      break;
    case "rain":
      desat = 0.36;
      dim = 0.82;
      tint = [0.96, 0.99, 1.04];
      break;
    case "fog":
      desat = 0.4;
      dim = 0.96;
      haze = time === "night" ? 0.22 : 0.3;
      break;
    case "snow":
      desat = 0.22;
      dim = 0.96;
      tint = [0.96, 0.99, 1.05];
      break;
    default:
      break;
  }
  const hazeRgb = FOG_RGB[time];
  const withTint = (mul: readonly number[]) => mul.map((m, i) => m * tint[i]);
  if (time === "dusk") return { desat, dim, mul: withTint([0.9, 0.68, 0.64]), add: [22, 8, 24], haze, hazeRgb };
  if (time === "night") return { desat, dim, mul: withTint([0.3, 0.36, 0.55]), add: [8, 12, 30], haze, hazeRgb };
  // 黎明：整体略暗、偏冷，红与蓝抬一点，呈清冷的粉紫
  if (time === "dawn") return { desat: Math.max(desat, 0.12), dim, mul: withTint([0.78, 0.72, 0.86]), add: [18, 8, 24], haze, hazeRgb };
  return { desat, dim, mul: withTint([1, 1, 1]), add: [0, 0, 0], haze, hazeRgb };
}

const memo = new Map<string, Map<Rgba, Rgba>>();

/** 单个颜色按时间与天气调色（保留不透明度）。 */
export function gradeColor(c: Color, time: TimeOfDay = "day", weather: Weather = "clear"): Rgba {
  const v = rgba(c);
  if ((time === "day" && weather === "clear") || (v & 0xff) === 0) return v;
  const key = `${time}/${weather}`;
  let table = memo.get(key);
  if (!table) {
    table = new Map();
    memo.set(key, table);
  }
  const hit = table.get(v);
  if (hit !== undefined) return hit;
  const { desat, dim, mul, add, haze, hazeRgb } = params(time, weather);
  let r = (v >>> 24) & 0xff;
  let g = (v >>> 16) & 0xff;
  let b = (v >>> 8) & 0xff;
  const l = 0.299 * r + 0.587 * g + 0.114 * b;
  r = (r + (l - r) * desat) * dim;
  g = (g + (l - g) * desat) * dim;
  b = (b + (l - b) * desat) * dim;
  const ch = (x: number, i: number) => {
    const y = x * mul[i] + add[i];
    return Math.max(0, Math.min(255, Math.round(y * (1 - haze) + hazeRgb[i] * haze)));
  };
  const out = ((ch(r, 0) << 24) | (ch(g, 1) << 16) | (ch(b, 2) << 8) | (v & 0xff)) >>> 0;
  if (table.size < 4096) table.set(v, out);
  return out;
}

const weatherMemo = new Map<string, Map<Rgba, Rgba>>();

/**
 * 只按天况调色（去饱和、压暗、雾色），不做时段的“乘 + 加”：给已经按时段画好的素材（天空色带、按时段取色的海面）叠加天气。
 * 雾色仍随时段变化，所以要给出 time。
 */
export function gradeWeatherColor(c: Color, weather: Weather = "clear", time: TimeOfDay = "day"): Rgba {
  const v = rgba(c);
  if (weather === "clear" || (v & 0xff) === 0) return v;
  const key = `${time}/${weather}`;
  let table = weatherMemo.get(key);
  if (!table) {
    table = new Map();
    weatherMemo.set(key, table);
  }
  const hit = table.get(v);
  if (hit !== undefined) return hit;
  const day = params("day", weather);
  const { haze, hazeRgb } = params(time, weather);
  const l = 0.299 * ((v >>> 24) & 0xff) + 0.587 * ((v >>> 16) & 0xff) + 0.114 * ((v >>> 8) & 0xff);
  const ch = (shift: number, i: number) => {
    const x = (v >>> shift) & 0xff;
    const y = (x + (l - x) * day.desat) * day.dim * day.mul[i];
    return Math.max(0, Math.min(255, Math.round(y * (1 - haze) + hazeRgb[i] * haze)));
  };
  const out = ((ch(24, 0) << 24) | (ch(16, 1) << 16) | (ch(8, 2) << 8) | (v & 0xff)) >>> 0;
  if (table.size < 4096) table.set(v, out);
  return out;
}

/** 夜里仍然发亮的颜色（灯光、亮窗）：调色时默认保留原色。 */
export const GLOW_COLORS: readonly string[] = [P.lamp[1], P.lamp[2]];

/** 整张图按时间与天气调色，返回新图（白天晴天时返回副本）。keepGlow 为真时灯光色不变暗。 */
export function shadeForTime(px: Px, time: TimeOfDay = "day", weather: Weather = "clear", keepGlow = true): Px {
  const out = px.clone();
  if (time === "day" && weather === "clear") return out;
  const keep = new Set(keepGlow ? GLOW_COLORS.map((c) => rgba(c)) : []);
  for (let i = 0; i < out.data.length; i++) {
    const v = out.data[i];
    if (keep.has(v)) continue;
    out.data[i] = gradeColor(v, time, weather);
  }
  return out;
}

const shaded = new WeakMap<Px, Map<string, Px>>();

/**
 * 带缓存的 shadeForTime（灯光色保留）：同一张图、同一（时段, 天况）只调色一次；白天晴天直接返回原图。
 * 返回的图与缓存共享，调用方不要修改它。街景的建筑、树、船、行人等记忆化的小图都经过这里。
 */
export function shadeCached(px: Px, time: TimeOfDay = "day", weather: Weather = "clear"): Px {
  if (time === "day" && weather === "clear") return px;
  let m = shaded.get(px);
  if (!m) {
    m = new Map();
    shaded.set(px, m);
  }
  const key = `${time}/${weather}`;
  const hit = m.get(key);
  if (hit) return hit;
  const out = shadeForTime(px, time, weather, true);
  m.set(key, out);
  return out;
}
