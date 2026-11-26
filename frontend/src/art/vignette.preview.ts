// 航行小画面预览（npx vite-node scripts/art-preview.ts vignette）：四个时段 × 六种天况（含船），以及暴风雨的 8 帧。
import { P } from "./palette";
import { sheet, type Preview } from "./px";
import { shadeCached, TIMES_OF_DAY, WEATHERS } from "./scenery";
import { drawShip } from "./ships";
import { drawVoyageVignette } from "./vignette";

const W = 72;
const H = 30;

function frame(f: number, time: (typeof TIMES_OF_DAY)[number], weather: (typeof WEATHERS)[number]) {
  const { px, waterline, swell } = drawVoyageVignette(W, H, f, { time, weather, windX: 1 });
  const ship = shadeCached(drawShip(1, "square", { size: "small", flag: P.gold[3], frame: f % 4 }), time, weather);
  const bob = Math.round([0, 0, 1, 1, 1, 0, -1, -1][f % 8] * swell);
  const out = px.clone();
  out.blit(ship, Math.floor(W * 0.36) - Math.floor(ship.w / 2), waterline - ship.h + 3 + bob);
  return out;
}

export default function preview(): Preview[] {
  const grid = TIMES_OF_DAY.flatMap((time) => WEATHERS.map((weather) => frame(3, time, weather)));
  const storm = Array.from({ length: 8 }, (_, f) => frame(f, "night", "storm"));
  return [
    { name: "vignette-time-weather", px: sheet(grid, { cols: WEATHERS.length, gap: 2, bg: "#000000" }), scale: 4 },
    { name: "vignette-storm-frames", px: sheet(storm, { cols: 8, gap: 2, bg: "#000000" }), scale: 4 },
  ];
}
