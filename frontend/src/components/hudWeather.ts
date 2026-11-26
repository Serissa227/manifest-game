// 顶栏时刻与天气的纯函数（EXPANSION.md §9.3）：时段名、日月图标、天况名、风名（去向 → 来向）、预报的日子，
// 以及从概览里安全地取出当地天气（旧后端没有 local_weather / minute 时优雅降级：不显示天气，时刻取 8:00）。
import { drawSkyIcon, drawWindIcon, type SkyIconName } from "../art/icons";
import type { Px } from "../art/px";
import { memo } from "../art/render";
import { dayParts, t, tk } from "../i18n";
import type { DayWeatherView, LocalWeatherView, Overview, SkyKind } from "../ipc/types";
import { periodOf, phaseOf } from "../time/daylight";

/** 全部天况（与内核 `Sky` 的顺序一致）。 */
export const SKY_KINDS: readonly SkyKind[] = ["clear", "cloudy", "rain", "fog", "storm", "snow"];

/** 是否为已知的天况名（后端追加新天况时，旧前端按不认识处理）。 */
export function isSkyKind(v: unknown): v is SkyKind {
  return typeof v === "string" && (SKY_KINDS as readonly string[]).includes(v);
}

/** 天况对应的图标名。 */
export function skyIcon(sky: SkyKind): SkyIconName {
  return `sky_${sky}`;
}

/** 天况名（“多云”）。 */
export function skyName(sky: SkyKind): string {
  return tk(`sky.${sky}`);
}

/** 天况与时刻图标的像素图（同名共用一张，界面重绘时不必重画）。 */
export function skyIconPx(name: SkyIconName): Px {
  return memo(`hud-sky:${name}`, () => drawSkyIcon(name));
}

/** 风向小箭头的像素图（dir 为风的去向）。 */
export function windIconPx(dir: number): Px {
  const d = normDir(dir);
  return memo(`hud-wind:${d}`, () => drawWindIcon(d));
}

/** 时段名（“上午”）。 */
export function periodName(minute: number): string {
  return tk(`period.${periodOf(minute)}`);
}

/** 时刻旁的日月图标：黎明与黄昏为半日，白天为太阳，夜晚为月亮（只看真实时刻，与“昼夜光影”偏好无关）。 */
export function clockIcon(minute: number): SkyIconName {
  switch (phaseOf(minute)) {
    case "dawn":
    case "dusk":
      return "sun_half";
    case "day":
      return "sun";
    default:
      return "moon";
  }
}

/** 把风向规范到 0–7（0 = 北，顺时针）；非法值按北。 */
export function normDir(dir: number): number {
  const d = Math.round(Number.isFinite(dir) ? dir : 0);
  return ((d % 8) + 8) % 8;
}

/**
 * 风的来向（0–7）。后端的 wind_dir 是风的去向，而中文的“X 风”指风从哪里吹来：
 * 吹向东（2）的风从西（6）吹来，是“西风”。
 */
export function windFrom(dir: number): number {
  return (normDir(dir) + 4) % 8;
}

/** 风力规范到 0–10 的整数。 */
export function normStrength(strength: number): number {
  const s = Math.round(Number.isFinite(strength) ? strength : 0);
  return Math.max(0, Math.min(10, s));
}

/** 风的文字：“东北风 4 级”；风力为 0 时为“无风”。dir 为风的去向。 */
export function windText(dir: number, strength: number): string {
  const n = normStrength(strength);
  if (n === 0) return t("hudWindCalm");
  return t("hudWind", { dir: tk(`compass.${windFrom(dir)}`), n });
}

/** 预报的日子：“明天”“后天”，更远的为“N 天后”。 */
export function forecastLabel(today: number, day: number): string {
  const n = Math.round(day - today);
  if (n === 1) return t("hudForecastTomorrow");
  if (n === 2) return t("hudForecastAfter");
  return t("hudForecastLater", { n });
}

/** 预报日子的月日（“1月14日”）。 */
export function forecastDate(day: number): string {
  const p = dayParts(day);
  return t("hudForecastDate", { month: p.month, date: p.date });
}

/** 一天的预报是否可用（天况已知、数值有限）。 */
function validDay(d: DayWeatherView | null | undefined): d is DayWeatherView {
  return !!d && isSkyKind(d.sky) && Number.isFinite(d.day) && Number.isFinite(d.wind_dir) && Number.isFinite(d.wind_strength);
}

/**
 * 概览里的当地天气；旧后端（没有 local_weather）、为空或天况不认识时返回 null（顶栏不显示天气与风）。
 * 预报只保留可用的、晚于今天的日子，按日期排序，最多两天。
 */
export function localWeather(o: Pick<Overview, "day" | "local_weather"> | null | undefined): LocalWeatherView | null {
  const w = o?.local_weather;
  if (!w || !isSkyKind(w.sky) || !Number.isFinite(w.wind_dir) || !Number.isFinite(w.wind_strength)) return null;
  const today = o?.day ?? 0;
  const forecast = (Array.isArray(w.forecast) ? w.forecast : [])
    .filter(validDay)
    .filter((d) => d.day > today)
    .sort((a, b) => a.day - b.day)
    .slice(0, 2);
  return { ...w, region_name: typeof w.region_name === "string" ? w.region_name : "", forecast };
}
