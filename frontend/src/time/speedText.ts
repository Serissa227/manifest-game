// 倍速档位的文字（H10b 起海上多一档“极快”）：档名、每天的实时长度。
// 界面文字先只写了中文（i18n/zhOnly.ts）。sea 为真时按海上四档（Overview.sea_clock），否则按港内三档。
import { tz } from "../i18n/zhOnly";
import { nearestSeaTier, nearestTier, SEA_TIER_NAMES, tierDayMs, tiersFor, TIER_NAMES } from "./daylight";

/** 某倍速所在的一档的名字（慢 / 普通 / 快，海上还有极快；旧的倍速归到最近的一档）。 */
export function tierName(speed: number, sea = false): string {
  const name = sea ? SEA_TIER_NAMES[nearestSeaTier(speed)] : TIER_NAMES[nearestTier(speed)];
  return tz(`time.tier.${name}` as const);
}

/** 一档每天的实时秒数（照后端的日长：港内 2 / 1 / 0.5，海上 6 / 3 / 1 / 0.5）。 */
export function tierSecs(speed: number, sea = false): number {
  return tierDayMs(speed, sea) / 1000;
}

/** 这一档的快捷键（港内 1 / 2 / 3，海上 1 / 2 / 3 / 4）。 */
export function tierKey(speed: number, sea = false): string {
  const tier = sea ? nearestSeaTier(speed) : nearestTier(speed);
  return String(tiersFor(sea).indexOf(tier) + 1);
}
