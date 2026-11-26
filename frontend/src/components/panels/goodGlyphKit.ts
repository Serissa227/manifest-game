// 交易品手绘图标的小工具（与组件分开放，热更新才认）。
import { GOOD_ART_KEYS } from "../../art/goodArt";

const GOOD_ART: ReadonlySet<string> = new Set(GOOD_ART_KEYS);

/** 这种货有没有手绘图标。 */
export function hasGoodArt(key: string | undefined): boolean {
  return !!key && GOOD_ART.has(key);
}

/** 手绘图标在界面上的边长（像素）：一倍 26，两倍 42，三倍 58。 */
export function goodArtSize(scale: number): number {
  return Math.round(16 * scale + 10);
}
