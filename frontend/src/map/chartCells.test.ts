// H03 世界海图上的天气团：像素与航行视图同一种块图，世界图上更粗、更淡。
import { describe, expect, it } from "vitest";
import { CHART_CELL_BLOCKS, chartCellPixels } from "./chartCells";
import { cellColors } from "./navSea";

describe("世界海图上的天气团", () => {
  it("边长按半径与世界图的块数算、有内外几级、比航行视图淡", () => {
    const c = { id: "60:10:0", kind: "storm" as const, x: 10, y: 10, r: 5 };
    const { n, rgba } = chartCellPixels(c);
    expect(n).toBe(2 * 5 * CHART_CELL_BLOCKS);
    const alphas = new Set<number>();
    for (let i = 3; i < rgba.length; i += 4) if (rgba[i] > 0) alphas.add(rgba[i]);
    expect(alphas.size).toBeGreaterThanOrEqual(2);
    const strongest = Math.max(...cellColors("storm").map((x) => x[3]));
    expect(Math.max(...alphas)).toBeLessThan(strongest);
    // 雾与风暴颜色不同
    const fog = chartCellPixels({ ...c, kind: "fog" });
    expect(Array.from(fog.rgba)).not.toEqual(Array.from(rgba));
  });
});
