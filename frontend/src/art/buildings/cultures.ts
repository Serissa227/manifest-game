// 第九批六种文化城镇风格的画法汇总（接口见 townArt.ts）。landmarks / town / skyline / props 用 cultureArt 取画法；
// 七种经典风格不在表里（返回 undefined），照旧走原来的画法。
import type { CultureStyle, TownStyle } from "../buildings";
import { JAPANESE } from "./japanese";
import { MALAY } from "./malay";
import { MAYA } from "./maya";
import { MING } from "./ming";
import { OTTOMAN } from "./ottoman";
import { SWAHILI } from "./swahili";
import type { CultureArt } from "./townArt";

/** 文化风格 → 画法。 */
export const CULTURES: Readonly<Record<CultureStyle, CultureArt>> = {
  japanese: JAPANESE,
  ming: MING,
  ottoman: OTTOMAN,
  swahili: SWAHILI,
  malay: MALAY,
  maya: MAYA,
};

/** 城镇风格的文化画法；经典七种风格返回 undefined。 */
export function cultureArt(style: TownStyle): CultureArt | undefined {
  return Object.prototype.hasOwnProperty.call(CULTURES, style) ? CULTURES[style as CultureStyle] : undefined;
}
