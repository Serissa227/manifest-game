// 教程向导小乌鸦的帧与动作节奏（GuideCrow.tsx 用；组件文件只导出组件，保持热更新可用）。
import { GUIDE_CROW_ART } from "../../art/portraitAssets";

export type GuideCrowFrame = "idle" | "blink" | "caw" | "wing" | "tilt";

/** 说一阵话：说话帧与待机帧交替的拍数与每拍的毫秒数。 */
export const TALK_BEATS = 8;
export const TALK_BEAT_MS = 150;
/** 说完之后扬翅膀停留的毫秒数。 */
export const WING_MS = 520;
/** 闲着时歪头的间隔（毫秒）与停留时长。 */
export const TILT_GAP_MS: readonly [number, number] = [7000, 13000];
export const TILT_MS = 900;

/** 条带里某一帧的下标（找不到时为待机帧）。 */
export function frameIndex(frame: GuideCrowFrame): number {
  return Math.max(0, GUIDE_CROW_ART.frames.indexOf(frame));
}
