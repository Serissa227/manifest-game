// 景物模块共用的类型（由 scenery.ts 统一导出给界面代码）。

export type Climate = "temperate" | "cold" | "arid" | "tropical";
/** 天况：与内核 `Sky`（EXPANSION.md §9.1）同名；clear / cloudy / storm 为早期的三种，其余为第四批追加。 */
export type Weather = "clear" | "cloudy" | "storm" | "rain" | "fog" | "snow";
/** 光照时段：黎明 5–7（清冷偏粉的晨光）、白天、黄昏、夜晚（见 time/daylight.ts 的 Phase）。 */
export type TimeOfDay = "day" | "dusk" | "night" | "dawn";

/** 全部天况（预览与测试用）。 */
export const WEATHERS: readonly Weather[] = ["clear", "cloudy", "rain", "fog", "storm", "snow"];
/** 全部光照时段（预览与测试用）。 */
export const TIMES_OF_DAY: readonly TimeOfDay[] = ["dawn", "day", "dusk", "night"];

export interface SkyOpts {
  /** 季节 0 春 1 夏 2 秋 3 冬 */
  season: number;
  weather?: Weather;
  time?: TimeOfDay;
}
