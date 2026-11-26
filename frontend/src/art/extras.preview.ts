// 面板额外小图的预览（npx vite-node scripts/art-preview.ts extras）。
import {
  ANIMAL_KINDS,
  INDUSTRY_KINDS,
  drawAnimal,
  drawGuard,
  drawIndustryIcon,
  drawSeaTile,
  drawSeal,
  drawTack,
  drawTrendArrow,
  drawWindRose,
} from "./extras";
import { P } from "./palette";
import { Px, sheet, type Preview } from "./px";

/** 平铺海面贴图，检查接缝。 */
function tiled(frame: number): Px {
  const tile = drawSeaTile(frame);
  const p = new Px(64, 48);
  for (let y = 0; y < p.h; y += tile.h) for (let x = 0; x < p.w; x += tile.w) p.blit(tile, x, y);
  return p;
}

export default function preview(): Preview[] {
  const animals = Array.from({ length: ANIMAL_KINDS }, (_, i) => [drawAnimal(i, 0), drawAnimal(i, 1)]).flat();
  const industries = Array.from({ length: INDUSTRY_KINDS }, (_, i) => drawIndustryIcon(i));
  const seals = [95, 82, 70, 58, 45, 30].map(drawSeal);
  const roses = [0, 1, 2, 3, 4, 5].map(drawWindRose);
  const small = [drawGuard(), drawTack(), drawTrendArrow("up"), drawTrendArrow("down"), drawTrendArrow("flat")];
  return [
    { name: "animals", px: sheet(animals, { cols: 2, bg: P.paper }), scale: 4 },
    { name: "industry", px: sheet(industries, { cols: 4, bg: P.paper }), scale: 4 },
    { name: "seals", px: sheet(seals, { cols: 6, bg: P.paper }), scale: 4 },
    // 火漆印放大：可信度自高到低，蜡色变暗、裂纹与崩口变多
    { name: "seals-detail", px: sheet([99, 80, 55, 10].map(drawSeal), { cols: 4, bg: P.parchment }), scale: 8 },
    { name: "windrose", px: sheet(roses, { cols: 6, bg: P.paper }), scale: 3 },
    { name: "small", px: sheet(small, { cols: 5, bg: P.paper }), scale: 5 },
    { name: "seatile", px: sheet([tiled(0), tiled(1)], { cols: 2 }), scale: 3 },
    // 实际显示尺寸（2 倍）下的总览
    { name: "overview-2x", px: sheet([...animals.filter((_, i) => i % 2 === 0), ...industries, drawSeal(72), drawGuard()], { cols: 5, bg: P.parchment }), scale: 2 },
  ];
}
