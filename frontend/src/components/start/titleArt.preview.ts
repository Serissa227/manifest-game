// 标题画面美术预览（在 frontend 下运行 npx vite-node scripts/art-preview.ts titleArt）。
import type { Preview } from "../../art/px";
import { Px, sheet } from "../../art/px";
import {
  BEAM_PERIOD,
  drawArrowIcon,
  drawCompassRose,
  drawLighthouse,
  drawMenuCursor,
  drawParchmentTile,
  drawSaveEmblem,
  drawScenarioVignette,
  drawTitleScene,
  drawWindowFrame,
} from "./titleArt";

export default function preview(): Preview[] {
  const frames = [0, Math.round(BEAM_PERIOD / 4), Math.round(BEAM_PERIOD / 2), 200];
  const tile = drawParchmentTile();
  const parchment = new Px(96, 64);
  for (let y = 0; y < 64; y += tile.h) for (let x = 0; x < 96; x += tile.w) parchment.blit(tile, x, y);
  return [
    ...frames.map((f) => ({ name: `scene-320-f${f}`, px: drawTitleScene(320, f), scale: 3 })),
    { name: "scene-480", px: drawTitleScene(480, 37), scale: 2 },
    { name: "scene-240", px: drawTitleScene(240, 11), scale: 3 },
    { name: "lighthouse", px: drawLighthouse(), scale: 6, bg: "#3b2a5c" },
    {
      name: "ui",
      px: sheet([drawWindowFrame(), drawCompassRose(), drawMenuCursor(), drawArrowIcon("left"), drawArrowIcon("right"), drawSaveEmblem(), parchment], {
        cols: 7,
        gap: 6,
        bg: "#23305e",
      }),
      scale: 5,
    },
    {
      name: "vignettes",
      px: sheet(
        [
          drawScenarioVignette({ style: "eastern", ship: { type: 0, sail: "lateen" }, flag: "#c8373a", variant: 0 }),
          drawScenarioVignette({ style: "lowland", ship: { type: 1, sail: "square" }, flag: "#dca434", variant: 1 }),
          drawScenarioVignette({ style: "islands", ship: { type: 1, sail: "square" }, flag: "#239a9a", variant: 2 }),
        ],
        { cols: 3, gap: 6 },
      ),
      scale: 3,
    },
  ];
}
