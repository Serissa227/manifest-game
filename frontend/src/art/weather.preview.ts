// 航海图天况标记预览（npx vite-node scripts/art-preview.ts weather）：
// 各天况 × 3 种外形 × 下落帧，放在海色底上；夜里（叠一层深蓝）的同一组标记与港口灯火。
import { WEATHER_FRAMES, WEATHER_VARIANTS, drawPortLight, drawPortMarker, drawWeatherMark, markerStyle } from "./map";
import type { SkyKind } from "../ipc/types";
import { P } from "./palette";
import { Px, type Preview } from "./px";

const SKIES: SkyKind[] = ["cloudy", "rain", "fog", "storm", "snow"];

/** 一张海色底板，把标记按行排开（每行一种天况）。night 为 true 时再叠一层夜色，并在港口标记上点灯。 */
function board(night: boolean): Px {
  const cellW = 36;
  const cellH = 24;
  const cols = WEATHER_VARIANTS * WEATHER_FRAMES + 1;
  const p = new Px(cols * cellW + 8, SKIES.length * cellH + 8).fill(P.sea[2]);
  // 浅海的斑纹，便于看清半透明的雾
  for (let y = 0; y < p.h; y += 6) for (let x = (y / 6) % 2 === 0 ? 0 : 3; x < p.w; x += 6) p.set(x, y, P.sea[3]);
  SKIES.forEach((sky, row) => {
    let col = 0;
    for (let v = 0; v < WEATHER_VARIANTS; v++) {
      for (let f = 0; f < WEATHER_FRAMES; f++, col++) {
        const m = drawWeatherMark(sky, v, f);
        p.blit(m, 4 + col * cellW + Math.floor((cellW - m.w) / 2), 4 + row * cellH + Math.floor((cellH - m.h) / 2), { alpha: 0.85 });
      }
    }
    const port = drawPortMarker(markerStyle("cuilan"), "#c0392b");
    p.blit(port, 4 + col * cellW + Math.floor((cellW - port.w) / 2), 4 + row * cellH + 2);
  });
  if (night) {
    const shade = new Px(p.w, p.h).fill("#0b1640");
    p.blit(shade, 0, 0, { alpha: 0.5 });
    const light = drawPortLight();
    const col = WEATHER_VARIANTS * WEATHER_FRAMES;
    SKIES.forEach((_, row) => p.blit(light, 4 + col * cellW + Math.floor((cellW - light.w) / 2), 4 + row * cellH + 8));
  }
  return p;
}

export default function preview(): Preview[] {
  return [
    { name: "marks-day", px: board(false), scale: 4 },
    { name: "marks-night", px: board(true), scale: 4 },
    { name: "marks-actual", px: board(false), scale: 2 },
  ];
}
