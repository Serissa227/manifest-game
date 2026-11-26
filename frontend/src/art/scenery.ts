// 景物：天空、云、远山、海面、码头、树木、地面、海鸥。
// 接口由界面代码依赖，不要改；画法可以随意重写（各画法在 ./scenery/ 目录下分文件实现）。
import type { ArchStyle } from "./buildings";
import type { Climate } from "./scenery/types";

export type { Climate, SkyOpts, TimeOfDay, Weather } from "./scenery/types";
export { TIMES_OF_DAY, WEATHERS } from "./scenery/types";

/** 建筑风格 → 气候（决定树木、远山、地面的样子）。 */
export function climateOf(style: ArchStyle): Climate {
  return (
    {
      mediterranean: "temperate",
      nordic: "cold",
      lowland: "temperate",
      desert: "arid",
      islands: "tropical",
      eastern: "temperate",
      frontier: "temperate",
    } as const
  )[style];
}

export { drawCloud, drawSky, skyStops } from "./scenery/sky";
export { drawDistantLand } from "./scenery/land";
export { SEA_FRAMES, drawSea, drawShoreFoam, FOAM_H } from "./scenery/sea";
export { drawPier, PIER_DECK_Y, PIER_H } from "./scenery/pier";
export { drawTree, TREE_KINDS, treeKind } from "./scenery/trees";
export { drawGround } from "./scenery/ground";
export { drawGull, GULL_FRAMES } from "./scenery/gull";
export { gradeColor, gradeWeatherColor, shadeForTime, shadeCached, GLOW_COLORS } from "./scenery/grade";
export {
  applyFlash,
  drawBolt,
  drawFogLayer,
  drawRainLayer,
  drawSnowLayer,
  fogOffset,
  lightningAt,
  FOG_PERIOD,
  LIGHTNING_MIN_GAP_S,
  RAIN_FRAMES,
  SNOW_FRAMES,
  type FogBand,
  type FxOpts,
} from "./scenery/weatherfx";
