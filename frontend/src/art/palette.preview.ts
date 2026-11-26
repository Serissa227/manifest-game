// 调色板预览：每条色阶一行（npx vite-node scripts/art-preview.ts palette）。
import { P, ink } from "./palette";
import { Px, type Preview } from "./px";

export default function preview(): Preview[] {
  const ramps: string[][] = [[ink.deep, ink.brown, ink.blue]];
  for (const v of Object.values(P)) {
    if (typeof v === "string") ramps.push([v]);
    else if (Array.isArray(v)) ramps.push([...v]);
    else for (const r of Object.values(v)) ramps.push([...(r as readonly string[])]);
  }
  const cell = 8;
  const px = new Px(cell * 6, cell * ramps.length);
  ramps.forEach((ramp, row) => ramp.forEach((c, i) => px.rect(i * cell, row * cell, cell, cell, c)));
  return [{ name: "palette", px, scale: 4 }];
}
