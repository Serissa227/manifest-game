// 外壳用到的像素图：图标、主角头像与季节图标（带缓存，避免每次渲染重画）。
import { drawIcon, type IconName } from "../../art/icons";
import { drawCaptainPortrait } from "../../art/portraits";
import type { Px } from "../../art/px";
import { memo } from "../../art/render";

/** 16×16 界面图标。 */
export function iconPx(name: IconName): Px {
  return memo(`shell-icon:${name}`, () => drawIcon(name));
}

/** 主角头像（64×64）。 */
export function captainPx(portrait: number): Px {
  return memo(`shell-captain:${portrait}`, () => drawCaptainPortrait(portrait));
}

const SEASONS: IconName[] = ["spring", "summer", "autumn", "winter"];

/** 季节图标（0 春 1 夏 2 秋 3 冬）。 */
export function seasonIcon(season: number): IconName {
  return SEASONS[((season % 4) + 4) % 4];
}

/** 提醒类型对应的日志图标。 */
export function noticeIcon(kind: string): IconName {
  switch (kind) {
    case "marginCall":
      return "futures";
    case "negativeCash":
      return "coin";
    case "loanOverdue":
      return "bank";
    case "lowSupplies":
      return "food";
    case "colonyStarving":
    case "colonyLowFood":
      return "colony";
    case "discoveryUnreported":
      return "discovery";
    default:
      return "quest";
  }
}
