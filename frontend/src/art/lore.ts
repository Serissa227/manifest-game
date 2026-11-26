// 寰宇的场景插画（public/scenes/，tools/scenes/build_lore.py 生成清单 loreArt.ts）：生物、传说之船、秘境街景、港口、历史事件。
// key 带种类前缀：creature_<生物>、ship_<传说之船>、realm_<秘境>、port_<港口>、event_<历史事件>。清单里没有的 key 一律不显示插画。
// 每个 key 有一到多版（不同时段与天况）：按当时的时辰与当地天气挑最贴切的一版；同样贴切的几版按 seed 轮换。
// 挑中的一版没画出当地正在下的雨、雪、雾时，画面上再叠一层天气（loreOverlay）。
import type { SkyKind } from "../ipc/types";
import type { Phase } from "../time/daylight";
import { publicImage } from "./imageUrl";
import { LORE_ART, type LoreVariant } from "./loreArt";

export type { LoreVariant };

/** 挑图的依据：时段、天况、轮换种子（都可缺省；全缺省时用最早的一版） */
export interface LoreContext {
  phase?: Phase;
  sky?: SkyKind;
  seed?: number;
}

// 港口只有大图（港口窗口标题下），不出中图
const NO_MEDIUM = ["port_"];

/** 这个 key 的全部版本（最早的一版在前）；没有插画时为空。 */
export function loreVariants(key: string | null | undefined): readonly LoreVariant[] {
  if (!key || !Object.prototype.hasOwnProperty.call(LORE_ART, key)) return [];
  return LORE_ART[key];
}

/** 时段的贴切程度：相同 6；黎明与黄昏互通 3；白天与晨昏 2；夜与昼 0（时段比天况要紧：同时段不同天况胜过同天况差一个时段）。 */
function phaseFit(want: Phase, have: Phase): number {
  if (want === have) return 6;
  if (want === "night" || have === "night") return 0;
  if (want === "day" || have === "day") return 2;
  return 3;
}

/** 天况的贴切程度：相同 3；雨与暴风雨、晴与多云、多云与雾 / 雪 1；其余 0。 */
function skyFit(want: SkyKind, have: SkyKind): number {
  if (want === have) return 3;
  const near: readonly (readonly [SkyKind, SkyKind])[] = [
    ["rain", "storm"],
    ["clear", "cloudy"],
    ["cloudy", "fog"],
    ["cloudy", "snow"],
  ];
  return near.some(([a, b]) => (a === want && b === have) || (a === have && b === want)) ? 1 : 0;
}

/** 按时段与天况挑一版：时段权重大于天况；同分的几版按 seed 轮换。没有插画时为 null。 */
export function pickLore(key: string | null | undefined, ctx: LoreContext = {}): LoreVariant | null {
  const vs = loreVariants(key);
  if (vs.length === 0) return null;
  if (ctx.phase === undefined && ctx.sky === undefined) return vs[0];
  const score = (v: LoreVariant) => (ctx.phase === undefined ? 0 : phaseFit(ctx.phase, v[1])) + (ctx.sky === undefined ? 0 : skyFit(ctx.sky, v[2]));
  const best = Math.max(...vs.map(score));
  const tied = vs.filter((v) => score(v) === best);
  const seed = Math.abs(Math.floor(ctx.seed ?? 0));
  return tied[seed % tied.length];
}

/** 一版插画的地址：大图 1536×672、中图 768×336（2026-11-12 A02 起；没有原图的几版仍是旧尺寸；港口没有中图，为 null）。 */
export function loreSrc(file: string, size: "large" | "medium"): string | null {
  if (size === "medium" && NO_MEDIUM.some((p) => file.startsWith(p))) return null;
  return publicImage(`scenes/${file}${size === "medium" ? "-m" : ""}.webp`);
}

/** 插画的地址（按 ctx 挑版本，缺省用最早的一版）：没有这张图时为 null。 */
export function loreArt(key: string | null | undefined, size: "large" | "medium", ctx?: LoreContext): string | null {
  const v = pickLore(key, ctx);
  return v ? loreSrc(v[0], size) : null;
}

/** 要叠在画面上的天气：当地在下雨、暴风雨、下雪或起雾，而挑中的一版没画出来时。 */
export function loreOverlay(v: LoreVariant, sky: SkyKind | undefined): SkyKind | null {
  if (sky !== "rain" && sky !== "storm" && sky !== "snow" && sky !== "fog") return null;
  if (v[2] === sky || (sky === "rain" && v[2] === "storm")) return null;
  return sky;
}

/** 文本 key 的轮换种子（同一天里同一张图不变，换一天可能换一版）。 */
export function loreSeed(key: string, day: number): number {
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) | 0;
  return Math.abs(h + Math.floor(day));
}
